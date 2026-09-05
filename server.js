// PsycheAI server: serves the static app and proxies the two model calls.
//
// The proxy exists because an API key cannot ship in a static page. Everything
// else still happens in the browser — the Instagram archive is unzipped and
// reduced to an evidence digest client-side, and only that digest is posted
// here. The raw export never leaves the user's device.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const provider = require('./lib/provider');
const prompts = require('./lib/prompts');
const recipients = require('./lib/recipients');
const payments = require('./lib/stripe');
const paymentLedger = require('./lib/premiumLedger');
const budget = require('./lib/budget');
const results = require('./lib/results');
const rateLimit = require('./lib/ratelimit');
const nonces = require('./lib/nonce');
// Required directly rather than reached through provider.active: the paid
// analysis is a fixed choice of its own, independent of whichever provider
// the free report used, so a deployment with only XAI_API_KEY set still has
// no premium engine — see premiumEngine() below — rather than silently
// falling back to whichever provider happened to win auto-detection.
//
// Both engines are required unconditionally (not just the chosen one) so
// PSYCHEAI_PREMIUM_PROVIDER below can flip between them with no code change —
// see the constant just below for how to revert.
const claude = require('./lib/claude');
const gemini = require('./lib/gemini');

// Which engine the paid pass runs on. Gemini 3.7 Flash is the current choice,
// on price — the same four sections cost a fraction as much to generate.
// Set PSYCHEAI_PREMIUM_PROVIDER=anthropic to put it back on Claude Sonnet 5,
// which is what this ran on before: that model is more expensive but follows
// the wellness section's hard limits more reliably, which is worth revisiting
// if Gemini's output quality on the paid sections turns out not to hold up.
const PREMIUM_PROVIDER = process.env.PSYCHEAI_PREMIUM_PROVIDER || 'gemini';
const PREMIUM_ENGINES = { anthropic: claude, gemini };

const ROOT = path.join(__dirname, 'docs');
const PORT = Number(process.env.PORT) || 3000;

// How many free-report generations a reader gets before the app asks them to
// pay for the next one. Enforced in the browser, not here — see handleAnalyse
// for why the server cannot tell whose first run it is, and the README for
// what that split does and does not buy.
const FREE_ANALYSES = Number(process.env.PSYCHEAI_FREE_ANALYSES || 1);

// A single backdoor around the whole payment flow, for the people who should
// not need to pay — friends, reviewers, whoever this server's operator wants
// to wave through. It bypasses verifyPaid and the usage ledger entirely
// rather than fabricating a fake PaymentIntent for them to flow through: a
// promo redemption never touches lib/stripe.js or lib/premiumLedger.js at
// all, so it works even on a deployment with no Stripe key configured, as
// long as the premium (Claude) engine itself is set up.
//
// There is no default, and that is the whole point.
//
// This used to fall back to a literal string when PSYCHEAI_PROMO_CODE was
// unset. That string was in this file, in the README, and in the test suite,
// and this repository is public — so the backdoor stood open to anyone who
// read it, and every paid gate in the app was decorative on any deployment
// that had not set the variable. A secret with a default committed beside it
// is not a secret; it is a password prompt that ships with the password.
//
// Unset now means promo redemption is switched off entirely rather than
// falling back to something guessable. An operator who wants the backdoor
// sets a random value in the environment; an operator who forgets gets no
// backdoor, which is the safe direction to fail in.
const PROMO_CODE = String(process.env.PSYCHEAI_PROMO_CODE || '').trim();
function isValidPromoCode(code) {
  if (!PROMO_CODE) return false;
  return typeof code === 'string' && code.trim().length > 0 &&
    code.trim().toLowerCase() === PROMO_CODE.toLowerCase();
}

// The digest is bounded client-side, but never trust that from the server.
// A dozen-odd downscaled JPEGs land near 1MB of base64; the rest is headroom.
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- helpers ----------

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

// How often a generating request writes a byte. Well inside the idle windows
// that actually bite — reverse proxies commonly cut a silent connection at 60
// seconds, mobile carriers sooner — and cheap enough to be invisible.
const KEEPALIVE_EVERY_MS = Number(process.env.PSYCHEAI_KEEPALIVE_PING_MS) || 15000;

/**
 * Run a long generation with bytes trickling out while it works.
 *
 * An analysis takes minutes and, until this existed, sent nothing at all until
 * it was finished. Everything between the browser and this process treats a
 * silent connection as a dead one: proxies cut it, mobile carriers drop the
 * NAT entry, a backgrounded phone discards the page. The reader then saw
 * "Could not reach the PsycheAI server", which was never true — the server was
 * mid-sentence.
 *
 * The trickle is whitespace, which is the trick that makes this safe. Leading
 * whitespace is legal JSON, so a client that has always called
 * `response.json()` keeps working with no change: it parses "   \n{...}"
 * exactly as it parsed "{...}". No new content type, no framing to agree on,
 * nothing for an old client to fail on.
 *
 * The cost is that the status code is committed before the work starts, so a
 * failure during generation cannot be a 502 any more — it is a 200 whose body
 * carries `{ error }`. `docs/llm.js` therefore treats an `error` field as a
 * failure whatever the status, and the pre-flight checks that *do* need real
 * status codes — payment, quota, bad body — all still run before this is
 * called and still send theirs.
 *
 * `X-Accel-Buffering: no` is not decoration: nginx and several hosted proxies
 * buffer a response body by default, which would hold the whitespace and
 * reproduce exactly the silence this removes.
 */
async function sendJsonWhileWorking(response, produce) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  const timer = setInterval(() => {
    // A space, not a newline: both are legal JSON whitespace, and a space
    // cannot be mistaken for a line-delimited protocol by anything reading
    // this by eye.
    if (!response.writableEnded) response.write(' ');
  }, KEEPALIVE_EVERY_MS);
  // Unref'd so a pending ping never holds the process open on shutdown.
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const payload = await produce();
    clearInterval(timer);
    response.end(JSON.stringify(payload));
  } catch (error) {
    clearInterval(timer);
    const described = error && error.status
      ? { message: error.message }
      : provider.active
        ? provider.active.describeError(error)
        : { message: (error && error.message) || 'Unknown server error.' };
    // The message only — never the body, which is somebody's evidence digest.
    console.error('[generation]', error && error.message ? error.message : error);
    if (!response.writableEnded) response.end(JSON.stringify({ error: described.message }));
  }
}

/**
 * Answer from what this process already has, if it has it: a report for this
 * exact question that finished minutes ago, or one being generated right now.
 *
 * Returns a promise to await when it took the request, or null when there is
 * nothing to serve and the caller should do the work itself.
 *
 * The decision is made synchronously and the awaiting is left to the caller,
 * which is not a style preference. Every call site registers its own work with
 * `results.share` immediately after a null from here, and an `await` in
 * between would let a second request look, see nothing running, and start a
 * duplicate generation a moment before the first one registered — the race
 * this whole path exists to close. Keep the two adjacent.
 *
 * The in-flight case goes through `sendJsonWhileWorking` rather than
 * `sendJson`, because attaching to work that started four minutes ago can
 * still mean waiting minutes for it, and a silent connection is what the
 * reader was retrying to escape in the first place.
 */
function servedFromMemory(response, kind, key) {
  const cached = results.get(kind, key);
  if (cached) {
    sendJson(response, 200, cached);
    return Promise.resolve();
  }
  const running = results.pending(kind, key);
  return running ? sendJsonWhileWorking(response, () => running) : null;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(Object.assign(new Error('Request body was not valid JSON.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

// ---------- routes ----------

async function handleStatus(response) {
  const premium = premiumEngine();
  sendJson(response, 200, {
    ...provider.describe(), payments: payments.describe(),
    premiumProvider: { name: premium ? premium.name : PREMIUM_PROVIDER, ready: Boolean(premium) },
    // How many analyses a reader gets before being asked to pay, and what one
    // costs after that. Served rather than hard-coded in docs/app.js so the
    // price on the button and the price Stripe charges cannot drift apart.
    freeAnalyses: FREE_ANALYSES,
  });
}

// Every analysis route needs a configured provider; refuse early and clearly
// rather than throwing an SDK error halfway through.
function requireEngine(response) {
  if (!provider.active) {
    sendJson(response, 503, {
      error: 'This server has no model provider configured. ' + provider.describe().hint,
    });
    return null;
  }
  return provider.active;
}

// The paid analysis runs on PREMIUM_PROVIDER's engine — a fixed choice, not
// whichever provider the free report happened to use — so it is resolved
// independently of provider.active rather than through requireEngine above.
// Mock mode is the one exception: PSYCHEAI_MOCK=1 (or PSYCHEAI_PROVIDER=mock)
// already makes provider.active the mock module, and premium follows it
// there too, the same way a developer testing the free report never needs a
// real API key. Outside mock mode, PREMIUM_PROVIDER's engine needs its own
// key regardless of what the main provider is running on — a server with
// only ANTHROPIC_API_KEY set has no premium engine while PREMIUM_PROVIDER is
// still 'gemini', for instance — see requirePremiumEngine below, which is
// what actually enforces this at the route.
function premiumEngine() {
  if (provider.active && provider.active.name === 'mock') return provider.active;
  const engine = PREMIUM_ENGINES[PREMIUM_PROVIDER];
  return engine && engine.hasKey() ? engine : null;
}

function requirePremiumEngine(response) {
  const engine = premiumEngine();
  if (!engine) {
    const named = PREMIUM_PROVIDER === 'anthropic'
      ? 'Claude, and needs ANTHROPIC_API_KEY'
      : 'Gemini, and needs GEMINI_API_KEY';
    sendJson(response, 503, {
      error: 'The paid analysis always uses ' + named + ' configured — set PSYCHEAI_PREMIUM_PROVIDER to switch which engine it uses.',
    });
    return null;
  }
  return engine;
}

// The browser already caps and downscales, but the endpoint is open to anyone
// who can reach it, so re-check the shape here rather than forwarding whatever
// arrives to a metered API.
// The free report, and the one route with two ways in.
//
// Without payment it is free, and bounded only by the server-wide daily
// ceiling in lib/budget.js. With a paymentIntentId or a promo code it is a
// purchased re-run, verified against Stripe the same way the premium route
// verifies its own, and it does *not* count against the free ceiling — the
// reader has paid for that call, so a busy day must not take it away from
// them after the charge cleared.
//
// What this deliberately does NOT do is decide whose first run it is. That
// would need the server to recognise a returning device, which is exactly
// what docs/index.html promises it never does ("no visitor count"). So the
// per-device allowance is the browser's own claim, made in docs/app.js, and
// what the server enforces is narrower and honest: a payment presented here
// must be real, must be for the right product, and must not already have been
// spent. See the README for the limits of that split.
async function handleAnalyse(request, response) {
  const body = await readJsonBody(request);
  if (!body || typeof body.digest !== 'object' || body.digest === null) {
    sendJson(response, 400, { error: 'Expected a "digest" object.' });
    return;
  }

  const promoCode = typeof body.promoCode === 'string' ? body.promoCode.trim() : '';
  const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
  const paying = Boolean(promoCode || paymentIntentId);

  // Which purchase is being spent here. 'analysis' is the ordinary S$0.99
  // re-run. 'unlock' is the S$1.99 premium purchase paying for the free
  // report as well, which it does in exactly one case: the reader added a
  // Google or Facebook export inside the unlock flow, so the paid sections
  // are about to describe evidence the free ones above them have never seen.
  // Refreshing them together is what that S$1.99 now buys.
  //
  // Naming the product cannot be used to pay less for more: verifyPaid checks
  // the retrieved PaymentIntent's amount against *this* product's price, so
  // an 'analysis' intent claiming to be an 'unlock' simply fails to verify.
  // The two are ledgered under different kinds so neither eats the other's
  // retries.
  const product = body.product === 'unlock' ? 'unlock' : 'analysis';
  const ledgerKind = product === 'unlock' ? 'bundled' : 'analysis';

  if (promoCode && !isValidPromoCode(promoCode)) {
    sendJson(response, 402, { error: 'That code is not valid.' });
    return;
  }
  if (paymentIntentId && !promoCode) {
    if (!payments.hasKey()) {
      sendJson(response, 503, { error: 'Payments are not configured on this server. ' + payments.describe().hint });
      return;
    }
    await payments.verifyPaid(paymentIntentId, product);
    if (!paymentLedger.canUse(paymentIntentId, ledgerKind)) {
      sendJson(response, 429, {
        error: 'This payment has already generated the maximum number of analyses. Contact support if yours failed to come through.',
      });
      return;
    }
  }

  // Checked before the model call, so a day that is already over budget costs
  // nothing rather than one more analysis. Paid calls skip the gate entirely.
  if (!paying && !budget.canSpend()) {
    sendJson(response, 503, {
      error: 'PsycheAI has reached its free analysis limit for today. It resets at midnight UTC — ' +
        'or you can run one now for a small fee.',
      budgetExhausted: true,
    });
    return;
  }

  const engine = requireEngine(response);
  if (!engine) return;

  // A report for this exact digest that finished minutes ago and never reached
  // the reader, or one still being generated for it — see lib/results.js.
  // Consulted before anything is spent: this is the same question already
  // being answered, so it costs neither the day's budget nor the reader's
  // payment a second time.
  const answered = servedFromMemory(response, 'analyse', body.digest);
  if (answered) {
    await answered;
    return;
  }

  // Same hold the two premium routes take, for the same check-then-act gap:
  // canUse read a count that recordUse will not write until the model comes
  // back. Only for a paid run — a free one is metered by the daily budget,
  // which is a server-wide count rather than a per-payment cap, and a promo
  // code carries no cap at all.
  const paidRun = Boolean(paymentIntentId && !promoCode);
  const release = paidRun ? paymentLedger.hold(paymentIntentId, ledgerKind) : () => {};
  if (!release) {
    sendJson(response, 429, {
      error: 'This payment is already generating an analysis. Wait for it to finish before trying again.',
    });
    return;
  }
  try {
    // `results.share` registers this generation before it awaits anything, so
    // a retry arriving while it runs attaches to it instead of starting a
    // second one, and stores the result on success. Storing it matters even
    // when the socket has already died — that is what makes the reader's next
    // attempt free — and the recording below happens once however many
    // connections end up waiting on this call.
    await sendJsonWhileWorking(response, () => results.share('analyse', body.digest, async () => {
      const result = await engine.analyseProfile(body.digest);

      // Both recorded only after the call actually came back, so a provider
      // outage neither spends the day's budget nor burns the reader's payment.
      if (paying) {
        if (paidRun) paymentLedger.recordUse(paymentIntentId, ledgerKind);
      } else {
        budget.record('analyse');
      }
      return result;
    }));
  } finally {
    release();
  }
}

// A single-use ticket for the routes below. Cheap to serve, rate-limited like
// everything else, and deliberately tied to nothing: it identifies no one and
// grants no privilege, it only proves the caller made a round trip and can
// read our replies. See lib/nonce.js for what that is and is not worth.
function handleNonce(response) {
  sendJson(response, 200, { nonce: nonces.issue() });
}

// The amount is fixed in lib/stripe.js and never taken from the request — a
// client is not trusted with what it pays. There is nothing else for the body
// to carry: this route creates a PaymentIntent for exactly one product, the
// "Let us roast you" unlock, and nothing report-shaped is anywhere near its
// signature.
async function handleCreatePaymentIntent(request, response) {
  if (!payments.hasKey()) {
    sendJson(response, 503, { error: 'Payments are not configured on this server. ' + payments.describe().hint });
    return;
  }
  // Which of the two products, and nothing else — never an amount. The price
  // of each lives in lib/stripe.js's PRODUCTS and is read from there, so the
  // only thing a client can influence here is *what* it is buying, not what
  // that costs. An unknown name is a 400 from productOf rather than a silent
  // fallback to the cheaper one.
  const body = await readJsonBody(request).catch(() => null);
  const product = body && typeof body.product === 'string' ? body.product : 'unlock';
  const label = product === 'analysis' ? 'PsycheAI — additional analysis' : 'PsycheAI — roast unlock';
  sendJson(response, 200, await payments.createPaymentIntent(label, product));
}

// The paid analysis — the roast. Gated on a fresh check with Stripe rather
// than on anything the client claims — verifyPaid() re-retrieves the
// PaymentIntent and confirms both that it succeeded and that it was for the
// real unlock price, and paymentLedger caps how many times one payment can
// be spent, so this is the one route in the app where "did the reader pay"
// is actually enforced server-side rather than trusted from a boolean in
// localStorage.
//
// A valid promoCode skips all of that — verifyPaid, hasKey, the ledger —
// rather than routing through them with a fabricated identity, because there
// is no payment to verify and no use to meter: see isValidPromoCode above.
//
// The digest travels in the request body exactly the way it does to
// /api/analyse — nothing is stored between the two calls, so this is not a
// second upload, it is the reader's browser resending evidence it already
// held rather than the server having kept a copy of it.
async function handlePremiumAnalysis(request, response) {
  const body = await readJsonBody(request);
  if (!body || typeof body.digest !== 'object' || body.digest === null) {
    sendJson(response, 400, { error: 'Expected a "digest" object.' });
    return;
  }
  const promoCode = typeof body.promoCode === 'string' ? body.promoCode.trim() : '';
  if (promoCode) {
    if (!isValidPromoCode(promoCode)) {
      sendJson(response, 402, { error: 'That code is not valid.' });
      return;
    }
    const engine = requirePremiumEngine(response);
    if (!engine) return;
    const answeredPromo = servedFromMemory(response, 'premium', body.digest);
    if (answeredPromo) {
      await answeredPromo;
      return;
    }
    await sendJsonWhileWorking(response, () =>
      results.share('premium', body.digest, () => engine.analysePremium(body.digest)));
    return;
  }

  const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
  if (!paymentIntentId) {
    sendJson(response, 400, { error: 'Expected a "paymentIntentId" or "promoCode" string.' });
    return;
  }
  if (!payments.hasKey()) {
    sendJson(response, 503, { error: 'Payments are not configured on this server. ' + payments.describe().hint });
    return;
  }
  await payments.verifyPaid(paymentIntentId, 'unlock');
  if (!paymentLedger.canUse(paymentIntentId, 'premium')) {
    sendJson(response, 429, {
      error: 'This payment has already generated the maximum number of analyses. Contact support if yours failed to come through.',
    });
    return;
  }
  const engine = requirePremiumEngine(response);
  if (!engine) return;
  // The most expensive thing in the product to lose to a dead socket: this one
  // was paid for. Served from the cache before the ledger is touched, so a
  // reader whose connection died collecting sections they had already bought
  // gets them back without spending a second use of the same payment — and
  // before the hold below, so that a reader who reconnects while their own
  // generation is still running is handed it rather than told to wait.
  const answeredPaid = servedFromMemory(response, 'premium', body.digest);
  if (answeredPaid) {
    await answeredPaid;
    return;
  }
  // Held across the generation, because canUse above read a count that
  // recordUse below will not write for several minutes — see lib/premiumLedger
  // on the race that gap opens. Taken after the cache check, so a reader
  // collecting something already generated is never turned away by it.
  const release = paymentLedger.hold(paymentIntentId, 'premium');
  if (!release) {
    sendJson(response, 429, {
      error: 'This payment is already generating an analysis. Wait for it to finish before trying again.',
    });
    return;
  }
  try {
    await sendJsonWhileWorking(response, () => results.share('premium', body.digest, async () => {
      const result = await engine.analysePremium(body.digest);
      paymentLedger.recordUse(paymentIntentId, 'premium');
      return result;
    }));
  } finally {
    release();
  }
}

// The address list, for whoever runs this server. Refused outright rather than
// served openly when no token is configured: a list of addresses that answers
// to anyone who guesses the path is worse than having no route.
function handleRecipients(request, response, url) {
  if (!recipients.configured()) {
    sendJson(response, 404, { error: 'No such endpoint.' });
    return;
  }
  const header = request.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  if (!recipients.authorised(token)) {
    sendJson(response, 401, { error: 'Not authorised.' });
    return;
  }
  const rows = recipients.list();
  sendJson(response, 200, { count: rows.length, recipients: rows });
}

async function handleCompatibility(request, response) {
  const body = await readJsonBody(request);
  const a = body && body.a;
  const b = body && body.b;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    sendJson(response, 400, { error: 'Expected two profile cards, "a" and "b".' });
    return;
  }
  // A compatibility read is now bought, not given.
  //
  // It used to draw on the same daily free ceiling as everything else, which
  // made the most expensive call in the app — a full model run over two
  // profile cards — the one thing anyone could have unlimited goes at for
  // nothing. It is priced level with the premium unlock because it costs the
  // same to produce.
  //
  // The shape below is deliberately the same as handlePremiumAnalysis's: a
  // promo code short-circuits everything, a real payment is re-verified with
  // Stripe rather than trusted from the client, the ledger caps how many
  // times one payment can be spent, and the result cache is consulted before
  // the ledger so that a reader whose connection died gets their report back
  // without paying for it twice. Two paid routes that authorise differently
  // is how one of them ends up wrong.
  const engine = requireEngine(response);
  if (!engine) return;
  // Resolved once, up here, because they are part of the cache key: the same
  // two cards read as colleagues and read as partners are different reports,
  // and keying on the pair alone would serve one where the other was asked
  // for. An unknown mode or stance falls back rather than 400ing — the basis
  // is a presentation choice, not something worth failing a paid call over.
  const mode = prompts.resolveMode(body.mode);
  const stance = prompts.resolveStance(body.stance);
  const cacheKey = { a, b, mode, stance };

  const promoCode = typeof body.promoCode === 'string' ? body.promoCode.trim() : '';
  if (promoCode) {
    if (!isValidPromoCode(promoCode)) {
      sendJson(response, 402, { error: 'That code is not valid.' });
      return;
    }
    const answeredPromo = servedFromMemory(response, 'compatibility', cacheKey);
    if (answeredPromo) {
      await answeredPromo;
      return;
    }
    await sendJsonWhileWorking(response, () => results.share('compatibility', cacheKey,
      () => engine.analyseCompatibility(a, b, mode, stance)));
    return;
  }

  const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
  if (!paymentIntentId) {
    sendJson(response, 402, { error: 'A compatibility report needs to be paid for.' });
    return;
  }
  if (!payments.hasKey()) {
    sendJson(response, 503, { error: 'Payments are not configured on this server. ' + payments.describe().hint });
    return;
  }
  await payments.verifyPaid(paymentIntentId, 'compatibility');
  if (!paymentLedger.canUse(paymentIntentId, 'compatibility')) {
    sendJson(response, 429, {
      error: 'This payment has already generated the maximum number of compatibility reports. ' +
        'Contact support if yours failed to come through.',
    });
    return;
  }
  const answeredPaid = servedFromMemory(response, 'compatibility', cacheKey);
  if (answeredPaid) {
    await answeredPaid;
    return;
  }
  // Same hold as the premium route, for the same reason.
  const release = paymentLedger.hold(paymentIntentId, 'compatibility');
  if (!release) {
    sendJson(response, 429, {
      error: 'This payment is already generating a report. Wait for it to finish before trying again.',
    });
    return;
  }
  try {
    await sendJsonWhileWorking(response, () => results.share('compatibility', cacheKey, async () => {
      const result = await engine.analyseCompatibility(a, b, mode, stance);
      paymentLedger.recordUse(paymentIntentId, 'compatibility');
      return result;
    }));
  } finally {
    release();
  }
}

function serveStatic(requestedPath, response) {
  const target = path.join(ROOT, requestedPath === '/' ? 'index.html' : requestedPath);

  // Never serve anything outside docs/, whatever the traversal attempt.
  const resolved = path.resolve(target);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
}

// What each costly route is protected by, in one table rather than as four
// copies of the same two checks at the top of four handlers — a guard that
// lives inside the thing it guards is a guard somebody adds a fifth route
// without.
//
// `limit` names a bucket in lib/ratelimit.js; `nonce` says the request must
// carry a live single-use ticket. The routes listed here are exactly the ones
// that cost real money to answer: three of them spend model budget, and the
// fourth creates an object in the Stripe account. /api/status and
// /api/recipients are absent deliberately — the first is a cacheable fact
// about the deployment, and the second has a token of its own.
const API_GUARDS = {
  '/api/nonce': { limit: 'nonce', nonce: false },
  '/api/analyse': { limit: 'analyse', nonce: true },
  '/api/compatibility': { limit: 'compatibility', nonce: true },
  '/api/create-payment-intent': { limit: 'payment-intent', nonce: true },
  '/api/premium-analysis': { limit: 'premium-analysis', nonce: true },
};

// The ticket travels in a header rather than in the body, for three reasons:
// the body of two of these routes is somebody's evidence digest and does not
// need one more field in it; the digest is the result cache's key, so a
// per-request value in there would make every request a cache miss; and a
// custom header cannot be set by the cross-site form POST that is the main
// thing a nonce is closing off.
const NONCE_HEADER = 'x-psycheai-nonce';

// ---------- security headers ----------
//
// Set on every response, static and API alike, because the researcher who
// asked for them was right that "live responses" is the unit that matters —
// headers on the HTML only would leave the JSON routes bare.
//
// Worth being accurate about what the CSP is doing here, because it would be
// easy to claim more. Model output is rendered into the page with innerHTML,
// which sounds alarming, but it goes through `esc()` in docs/app.js first —
// 191 call sites, escaping the five characters that matter. There is no known
// XSS to close. What the CSP buys is the *next* one: 191 escape sites is a
// lot of places for one to be missed later, and a missed escape with a CSP in
// front of it is a broken paragraph rather than a stolen report.
//
// The policy can afford to be strict because this app is unusually
// self-contained — every script is a file in docs/, there is not one inline
// <script> or on* handler in index.html, no web fonts, no analytics, no CDN.
// Stripe is the single exception and gets exactly the three origins its own
// documentation names, and nothing else does.
const CSP = [
  "default-src 'self'",
  // Scripts are all local files, plus Stripe.js, which app.js injects when a
  // reader actually reaches the payment sheet.
  "script-src 'self' https://js.stripe.com",
  // No 'unsafe-inline', which took removing every inline style in the app.
  // The seven static ones in index.html became .guide-mark-N classes; the
  // three that carry a computed number — a trait bar's width, the confidence
  // meter's width, the compatibility ring's --pct — travel as data attributes
  // and are applied by applyDataStyles() in app.js, because CSSOM writes are
  // not governed by this directive and style attributes are.
  //
  // The two <style> blocks app.js builds are both outside this policy and stay
  // as they are: one goes into a file the reader downloads and opens from
  // their own disk, the other sits inside an SVG loaded as an image, which is
  // its own document governed by img-src.
  "style-src 'self'",
  // data: for the SVG the psyche-card image is built from, blob: for every
  // object URL the app hands to a download link — the PDF, the card image,
  // the QR code.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // The app's own routes, and Stripe's API for the payment sheet.
  "connect-src 'self' https://api.stripe.com",
  // Stripe's payment sheets are iframes it opens itself.
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  // Nothing here is ever legitimately framed, and the app takes payments —
  // the exact case clickjacking is for. X-Frame-Options below says the same
  // thing for anything too old to read this.
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function applySecurityHeaders(request, response) {
  response.setHeader('Content-Security-Policy', CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  // Not 'no-referrer', which would suit this app's privacy claims but has a
  // history of upsetting payment providers' fraud checks. Origin-only on
  // cross-origin requests leaks no path, and the shared-profile payload lives
  // in the URL fragment, which is never sent in a Referer header at all.
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Hardware and capability access, denied by default and granted only where
  // this app actually uses something. A CSP governs what code may load; this
  // governs what that code may reach for once loaded, which is a different
  // question — an injected script under a strict CSP still inherits whatever
  // the page is permitted to touch.
  //
  // Two grants, both real: the camera, for scanning a QR code, and the
  // Payment Request API behind Apple Pay and Google Pay. `payment` names
  // js.stripe.com as well as self, because the wallet sheet is opened from
  // inside Stripe's own iframe rather than from our page — granting only
  // `self` there would leave the sheet unable to open, which is exactly the
  // kind of breakage a header like this causes quietly.
  //
  // Everything else is refused outright rather than left at the browser
  // default, including things this app has no notion of: a feature that
  // arrives in a future browser version is denied by omission.
  response.setHeader('Permissions-Policy', [
    'accelerometer=()',
    'ambient-light-sensor=()',
    'autoplay=()',
    'battery=()',
    'camera=(self)',
    'display-capture=()',
    'encrypted-media=()',
    'geolocation=()',
    'gyroscope=()',
    'idle-detection=()',
    'local-fonts=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=(self "https://js.stripe.com")',
    'screen-wake-lock=()',
    'serial=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', '));

  // HSTS only where it can mean anything, and — more importantly — never on
  // plain HTTP. A browser that accepts this header for localhost will refuse
  // to load *any* http://localhost afterwards, for a year, across every
  // project on that machine. That is a genuinely nasty thing to do to a
  // developer, so the header goes out only when the request demonstrably
  // arrived over TLS.
  const proto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = proto === 'https' || Boolean(request.socket && request.socket.encrypted);
  if (secure) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

const server = http.createServer((request, response) => {
  // Before anything branches, so no route can be added that forgets them.
  // setHeader rather than passing them to each writeHead: they survive into
  // whatever the handler eventually writes, including the 404 and 403 paths
  // in serveStatic and every sendJson refusal above.
  applySecurityHeaders(request, response);

  // Parsing the request line is the first thing that can throw, and until this
  // guard existed a throw here ended the process.
  //
  // `GET /%` was enough. decodeURIComponent raises URIError on a malformed
  // percent-escape, this ran outside any try/catch, and an uncaught exception
  // in a request handler takes Node down with it — so one request, needing no
  // nonce and passing no rate limit because both are checked further down,
  // was a complete outage for everybody. A supervisor restarting the process
  // does not help when the request can simply be sent again.
  //
  // A malformed path is a client error, so it is answered as one rather than
  // swallowed. new URL is inside the same guard: it throws on request lines
  // no browser sends but anything speaking HTTP can.
  let route;
  let url;
  try {
    url = new URL(request.url, 'http://localhost');
    route = decodeURIComponent(url.pathname);
  } catch (error) {
    sendJson(response, 400, { error: 'That is not a valid request path.' });
    return;
  }

  // Everything from here is wrapped, because the crash above was not really
  // about decodeURIComponent — it was about a synchronous throw anywhere in
  // this function being fatal to the whole server. The specific bug is fixed
  // above; this is so the next one costs a request instead of the site.
  //
  // Deliberately not a process-level uncaughtException handler. That would
  // also catch throws from timers and callbacks with no request in hand and
  // no way to answer, leaving the process running in a state nobody has
  // reasoned about. This catches only what one request can throw, where there
  // is a response to send and the damage is bounded to the caller who caused
  // it.
  try {
    routeRequest(route, url, request, response);
  } catch (error) {
    console.error('[' + route + '] unhandled: ' + (error && error.message ? error.message : error));
    if (!response.headersSent) sendJson(response, 500, { error: 'Something went wrong on the server.' });
    else response.end();
  }
});

function routeRequest(route, url, request, response) {
  if (route.startsWith('/api/')) {
    const handler =
      route === '/api/status' && request.method === 'GET' ? () => handleStatus(response)
        : route === '/api/nonce' && request.method === 'GET' ? () => handleNonce(response)
          : route === '/api/analyse' && request.method === 'POST' ? () => handleAnalyse(request, response)
            : route === '/api/compatibility' && request.method === 'POST' ? () => handleCompatibility(request, response)
              : route === '/api/recipients' && request.method === 'GET' ? () => handleRecipients(request, response, url)
                : route === '/api/create-payment-intent' && request.method === 'POST' ? () => handleCreatePaymentIntent(request, response)
                  : route === '/api/premium-analysis' && request.method === 'POST' ? () => handlePremiumAnalysis(request, response)
                    : null;

    if (!handler) {
      sendJson(response, 404, { error: 'No such endpoint.' });
      return;
    }

    // Before the handler, and before the body is read: a refused request
    // should cost us as little as the caller intended it to cost them.
    const guard = API_GUARDS[route];
    if (guard) {
      // The limit is spent first, so that a wrong or missing ticket still
      // costs a token. Checking the nonce first would make guessing tickets
      // free, which is the one way to probe this that must not be.
      const allowed = rateLimit.take(guard.limit, rateLimit.clientKey(request));
      if (!allowed.ok) {
        response.setHeader('Retry-After', String(allowed.retryAfter));
        sendJson(response, 429, {
          error: 'Too many requests from this connection. Try again in ' +
            allowed.retryAfter + ' seconds.',
          retryAfter: allowed.retryAfter,
        });
        return;
      }
      if (guard.nonce && !nonces.spend(request.headers[NONCE_HEADER])) {
        sendJson(response, 400, {
          error: 'This request is missing a valid one-time token. Reload the page and try again.',
          nonceRequired: true,
        });
        return;
      }
    }
    Promise.resolve()
      .then(handler)
      .catch(error => {
        const described = error && error.status
          ? { status: error.status, message: error.message }
          : provider.active
            ? provider.active.describeError(error)
            : { status: 500, message: (error && error.message) || 'Unknown server error.' };
        // The message only. This route's request body is somebody's personality
        // report, and an error handler that logs bodies would put it in the
        // server log — which is exactly the thing the design is built to avoid.
        console.error('[' + route + ']', error && error.message ? error.message : error);
        sendJson(response, described.status, { error: described.message });
      });
    return;
  }

  serveStatic(route, response);
}

// Node closes an idle keep-alive socket after 5 seconds by default, which is
// shorter than the reverse proxy in front of this server assumes when it holds
// connections open to reuse them. Render's own troubleshooting docs name that
// mismatch as the cause of intermittent timeouts and "Connection reset by
// peer" on Node services specifically, and recommend raising both of these.
//
// headersTimeout must stay *above* keepAliveTimeout: they run as one sequence
// per socket, and inverting them leaves the header timer expiring while the
// keep-alive timer still considers the socket healthy — an ambiguous state
// that closes sockets mid-handshake rather than idle. The gap is deliberate,
// not decorative.
//
// This does not govern how long a response may take to produce. That timer
// (`requestTimeout`, 5 minutes by default) measures receiving the *request*
// and stops once the body is in, so the paid call's minutes of generation
// afterwards are not on any of these clocks. What this fixes is the socket
// being reused between requests, which is where the resets actually came from.
const KEEP_ALIVE_MS = Number(process.env.PSYCHEAI_KEEPALIVE_MS) || 120000;
server.keepAliveTimeout = KEEP_ALIVE_MS;
server.headersTimeout = KEEP_ALIVE_MS + 5000;

// Guarded so tools/selftest.mjs can require() this file to reach
// premiumEngine() directly — the fastest, most deterministic way to prove
// which provider premium actually resolves to under a given env, with no
// HTTP round trip and no server left listening behind the test.
if (require.main === module) {
  server.listen(PORT, () => {
    const status = provider.describe();
    console.log('PsycheAI running at http://localhost:' + PORT);
    if (status.mock) console.log('  Mock mode — serving canned analyses, calling no API.');
    else if (status.ready) console.log('  Provider: ' + status.provider + ' · model: ' + status.model);
    else console.log('  Not configured. ' + status.hint);
  });
}

// `server` is exported unlistened — requiring this file never binds a port
// (see the require.main guard above), so a test can read the timeouts off it
// without a round trip or a socket left open behind the check.
// `sendJsonWhileWorking` is exported for the same reason `premiumEngine` is:
// it is the piece with real behaviour worth proving — that a slow generation
// writes bytes while it runs, and that what lands is still parseable JSON —
// and driving it through a real socket would make the test about timing
// rather than about the function.
module.exports = {
  premiumEngine, isValidPromoCode, server, sendJsonWhileWorking,
  API_GUARDS, NONCE_HEADER, CSP,
};
