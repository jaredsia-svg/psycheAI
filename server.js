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
// long as the premium (Claude) engine itself is set up. Overridable so a real
// deployment is not stuck with a code that shipped in this repo's history.
const PROMO_CODE = process.env.PSYCHEAI_PROMO_CODE || 'jialatsia';
function isValidPromoCode(code) {
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
function cleanImages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= prompts.MAX_IMAGES) break;
    if (!item || typeof item.data !== 'string') continue;
    if (!IMAGE_MIMES.has(item.mime)) continue;
    if (item.data.length > MAX_IMAGE_BYTES) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) continue;
    out.push({
      mime: item.mime,
      data: item.data,
      takenAt: typeof item.takenAt === 'string' ? item.takenAt.slice(0, 10) : '',
      kind: typeof item.kind === 'string' ? item.kind.slice(0, 16) : 'post',
      hasCaption: Boolean(item.hasCaption),
    });
  }
  return out;
}

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

  if (promoCode && !isValidPromoCode(promoCode)) {
    sendJson(response, 402, { error: 'That code is not valid.' });
    return;
  }
  if (paymentIntentId && !promoCode) {
    if (!payments.hasKey()) {
      sendJson(response, 503, { error: 'Payments are not configured on this server. ' + payments.describe().hint });
      return;
    }
    await payments.verifyPaid(paymentIntentId, 'analysis');
    if (!paymentLedger.canUse(paymentIntentId, 'analysis')) {
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
  const result = await engine.analyseProfile(body.digest, cleanImages(body.images));

  // Both recorded only after the call actually came back, so a provider
  // outage neither spends the day's budget nor burns the reader's payment.
  if (paying) {
    if (paymentIntentId && !promoCode) paymentLedger.recordUse(paymentIntentId, 'analysis');
  } else {
    budget.record('analyse');
  }
  sendJson(response, 200, result);
}

// The report is typeset and downloaded entirely client-side and never reaches
// this endpoint at all — it exists only so an address can be recorded before
// the browser lets the download through. `recipients.record` is given the
// address and only the address; there is no parameter here an attachment
// could go in, and no code path that could write one.
async function handleRecordEmail(request, response) {
  const body = await readJsonBody(request);
  const address = recipients.validAddress(body && body.email);
  if (!address) {
    sendJson(response, 400, { error: 'That does not look like an email address.' });
    return;
  }
  recipients.record(address);
  sendJson(response, 200, { recorded: true });
}

// The amount is fixed in lib/stripe.js and never taken from the request — a
// client is not trusted with what it pays. There is nothing else for the body
// to carry: this route creates a PaymentIntent for exactly one product, the
// "Let us roast you" unlock, and nothing report-shaped is anywhere near its
// signature — same discipline as handleRecordEmail above.
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
    sendJson(response, 200, await engine.analysePremium(body.digest));
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
  const result = await engine.analysePremium(body.digest);
  paymentLedger.recordUse(paymentIntentId, 'premium');
  sendJson(response, 200, result);
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
  // A compatibility read is a free model call like any other, so it draws on
  // the same daily ceiling. It is not separately purchasable — there is no
  // product for it — so an exhausted day simply says come back tomorrow.
  if (!budget.canSpend()) {
    sendJson(response, 503, {
      error: 'PsycheAI has reached its free analysis limit for today. It resets at midnight UTC.',
      budgetExhausted: true,
    });
    return;
  }
  const engine = requireEngine(response);
  if (!engine) return;
  // An unknown mode or stance falls back rather than 400ing — the basis is a
  // presentation choice, not something worth failing a paid call over. The
  // stance only means anything for a professional run; the resolver defaults
  // it either way, so the engines never see an unexpected value.
  const result = await engine.analyseCompatibility(
    a, b, prompts.resolveMode(body.mode), prompts.resolveStance(body.stance));
  budget.record('compatibility');
  sendJson(response, 200, result);
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

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const route = decodeURIComponent(url.pathname);

  if (route.startsWith('/api/')) {
    const handler =
      route === '/api/status' && request.method === 'GET' ? () => handleStatus(response)
        : route === '/api/analyse' && request.method === 'POST' ? () => handleAnalyse(request, response)
          : route === '/api/compatibility' && request.method === 'POST' ? () => handleCompatibility(request, response)
            : route === '/api/record-email' && request.method === 'POST' ? () => handleRecordEmail(request, response)
              : route === '/api/recipients' && request.method === 'GET' ? () => handleRecipients(request, response, url)
                : route === '/api/create-payment-intent' && request.method === 'POST' ? () => handleCreatePaymentIntent(request, response)
                  : route === '/api/premium-analysis' && request.method === 'POST' ? () => handlePremiumAnalysis(request, response)
                    : null;

    if (!handler) {
      sendJson(response, 404, { error: 'No such endpoint.' });
      return;
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
});

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
module.exports = { premiumEngine, isValidPromoCode, server };
