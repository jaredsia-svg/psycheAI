// The one paid feature: an S$1.99 unlock for the four paid sections — the
// wellness read, the attachment read, the career coaching and the roast —
// taken on-site via Stripe's Payment Request Button so the browser offers
// Apple Pay or Google Pay directly rather than a typed-in card form.
//
// This is the one place PsycheAI keeps money rather than words. Everything
// else in the app is designed so the server never sees a reader's data; this
// route is the mirror image — the server has to be the one place a secret key
// lives, because a key that can create real charges cannot ship in a static
// page. What it is never handed, and has no field for, is the report itself:
// createPaymentIntent takes an amount and a description string, nothing a
// digest or a report could end up inside of by accident.
'use strict';

// PSYCHEAI_MOCK mirrors lib/provider.js's own flag rather than introducing a
// second one — a developer running `npm run mock` should never need a real
// Stripe account just to click through the unlock flow, the same way they
// never need a real Gemini key to click through analysis.
const MOCK = process.env.PSYCHEAI_MOCK === '1';
const SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
// Safe to send to the browser — it identifies the Stripe account, not a
// credential — but it is still read from the server rather than typed into
// docs/*.js, so the same deployment env vars that configure everything else
// configure this too, and a fork with no key set fails closed rather than
// shipping someone else's account id.
const PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';

// Singapore dollars, and the two constants below are one decision rather
// than two: 199 is cents *of CURRENCY*, so changing one without the other
// silently reprices the unlock. verifyPaid checks both against the
// PaymentIntent, so a charge taken in the wrong currency fails the gate
// rather than unlocking at whatever it happened to cost.
//
// Stripe settles this only if the account supports SGD — see the README's
// setup notes. A country/currency mismatch surfaces at PaymentIntent
// creation as a Stripe error, not silently at capture time.
const CURRENCY = 'sgd';
const UNLOCK_PRICE_CENTS = 199;
// The second thing this server sells: one more free-report generation, past
// the one every reader gets without paying. Cheaper than the unlock because
// it buys less — a re-run of the report they have already seen the shape of,
// against more data, rather than four sections they have never read.
const ANALYSIS_PRICE_CENTS = 99;

// Two products, one payment pipeline. Every amount below is read from here
// rather than passed in, because an amount a client could influence is an
// amount a client could set to zero — the same reasoning that keeps
// UNLOCK_PRICE_CENTS out of the request body. `verifyPaid` checks the
// retrieved PaymentIntent against the price of the product being claimed, so
// a S$0.99 analysis payment cannot be re-presented to unlock the S$1.99
// premium sections.
// How long a successful payment stays redeemable — see verifyPaid.
const REDEEM_WINDOW_MS = Number(process.env.PSYCHEAI_REDEEM_WINDOW_MS) || 30 * 24 * 60 * 60 * 1000;

const PRODUCTS = {
  unlock: { cents: UNLOCK_PRICE_CENTS, label: 'PsycheAI premium sections' },
  analysis: { cents: ANALYSIS_PRICE_CENTS, label: 'PsycheAI additional analysis' },
  // The compatibility read, priced level with the unlock because it costs the
  // same to produce: a full model call over two profile cards. It is a
  // separate product rather than a second use of `unlock` so that verifyPaid
  // can tell them apart — a S$1.99 that bought premium sections must not also
  // buy a compatibility report, and the only thing that distinguishes them at
  // the point of redemption is the product name they were verified against.
  compatibility: { cents: UNLOCK_PRICE_CENTS, label: 'PsycheAI compatibility report' },
};

function productOf(name) {
  const product = PRODUCTS[String(name || 'unlock')];
  if (!product) {
    throw Object.assign(new Error('Unknown product: ' + JSON.stringify(name)), { status: 400 });
  }
  return product;
}
// The merchant's own country, for Stripe's PaymentRequest — not the buyer's,
// which the wallet sheet supplies itself. It has to agree with the Stripe
// account's own country, so it defaults alongside CURRENCY rather than being
// left at a default the currency no longer matches.
const COUNTRY = process.env.STRIPE_ACCOUNT_COUNTRY || 'SG';

let client = null;
function stripeClient() {
  if (!client) client = new (require('stripe'))(SECRET_KEY);
  return client;
}

/** Whether a real charge could be attempted at all — real key, or mock mode. */
function hasKey() {
  return MOCK || Boolean(SECRET_KEY);
}

/**
 * Whether the *browser* has everything it needs to offer Apple Pay / Google
 * Pay. Mock mode never touches Stripe.js at all, so it does not need the
 * publishable key the real flow does.
 */
function ready() {
  return MOCK || Boolean(SECRET_KEY && PUBLISHABLE_KEY);
}

/**
 * Creates the PaymentIntent the client confirms against. `automatic_payment_
 * methods` rather than naming Apple Pay / Google Pay explicitly — Stripe
 * decides at confirm time which wallet the browser actually offers, so
 * hard-coding a method list here would just be a second place for that logic
 * to go stale.
 *
 * Mock mode never calls Stripe — the fake id is prefixed distinctly so a
 * response can be told apart from a real one on sight, in a log or in a test
 * — and is recorded in mockIntents so retrievePaymentIntent can tell an id
 * this server actually issued apart from one somebody made up. The first
 * version of this skipped that step and just pattern-matched the `pi_mock_`
 * prefix, which meant any string shaped like a mock id verified as a
 * successful payment whether or not this server had ever created it — the
 * mock path was not actually exercising the check it exists to prove.
 */
const mockIntents = new Map();

async function createPaymentIntent(description, productName) {
  const product = productOf(productName);
  if (MOCK) {
    const id = 'pi_mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    // The amount and the creation time ride along with the id in mock mode,
    // because mock mode has no Stripe to retrieve them back from later — see
    // retrievePaymentIntent. The timestamp is stored rather than recovered
    // from the id: the id appends random noise straight onto the base-36
    // clock with no separator, so the two cannot be told apart again.
    mockIntents.set(id, { cents: product.cents, created: Date.now() });
    return {
      id, clientSecret: id + '_secret_mock', amount: product.cents, currency: CURRENCY,
      country: COUNTRY, publishableKey: '', mock: true,
    };
  }
  if (!SECRET_KEY) {
    throw Object.assign(new Error('Payments are not configured on this server.'), { status: 503 });
  }
  try {
    const intent = await stripeClient().paymentIntents.create({
      amount: product.cents,
      currency: CURRENCY,
      description: description || product.label,
      automatic_payment_methods: { enabled: true },
    });
    return {
      id: intent.id, clientSecret: intent.client_secret, amount: intent.amount, currency: intent.currency,
      country: COUNTRY, publishableKey: PUBLISHABLE_KEY, mock: false,
    };
  } catch (error) {
    throw describeError(error);
  }
}

/**
 * Stripe's own errors already carry a presentable `message` — card declines,
 * bad requests, rate limits — so this narrows down to the two things the
 * route handler actually reads rather than passing the whole SDK error
 * object across the route boundary. `statusCode` is Stripe's own name for it;
 * `status` is what the rest of this codebase's error objects use.
 */
function describeError(error) {
  if (error && error.status && error.message) return error;
  const status = (error && error.statusCode) || 500;
  const message = (error && error.message) || 'The payment could not be started.';
  return Object.assign(new Error(message), { status });
}

/**
 * Independently confirms with Stripe that a PaymentIntent actually succeeded,
 * rather than trusting whatever the client claims — this function existing
 * at all is the fix for the browser-side bypass: before it, "unlocked" was a
 * boolean the client set itself, with nothing on the server ever asking
 * Stripe whether a charge really went through.
 *
 * Mock mode accepts only an id this same process actually issued through
 * createPaymentIntent, checked against mockIntents rather than just the
 * `pi_mock_` shape — a made-up id, or a real one presented against a mock
 * server, is rejected exactly as a fabricated id would be against real
 * Stripe, rather than being silently accepted for merely looking right.
 */
async function retrievePaymentIntent(id) {
  if (MOCK) {
    if (!mockIntents.has(String(id || ''))) {
      throw Object.assign(new Error('No such PaymentIntent.'), { status: 402 });
    }
    // The amount this id was actually issued for, not the unlock price: mock
    // mode has to be able to tell a S$0.99 analysis payment from a S$1.99
    // unlock, or verifyPaid's product check is untested on the one path the
    // suites actually run.
    return {
      id: String(id), status: 'succeeded',
      amount: mockIntents.get(String(id)).cents, currency: CURRENCY,
      // Seconds, the unit Stripe uses. Mock ids carry their own creation time
      // in base 36 (see createPaymentIntent), so a mock intent ages exactly
      // the way a real one does and verifyPaid's redemption window is
      // exercised on the path the suites actually run rather than stubbed
      // past with "now".
      created: Math.floor(mockIntents.get(String(id)).created / 1000),
    };
  }
  if (!SECRET_KEY) {
    throw Object.assign(new Error('Payments are not configured on this server.'), { status: 503 });
  }
  try {
    const intent = await stripeClient().paymentIntents.retrieve(String(id || ''));
    return {
      id: intent.id, status: intent.status, amount: intent.amount,
      currency: intent.currency, created: intent.created,
    };
  } catch (error) {
    throw describeError(error);
  }
}

/**
 * The one check that actually gates paid content: retrieves the PaymentIntent
 * fresh and confirms both that it succeeded and that it was for the real
 * unlock price — status alone is not enough, since a client could otherwise
 * present some *other* real PaymentIntent it holds, for any amount, and pass
 * a check that only looked at whether something, somewhere, had succeeded.
 */
async function verifyPaid(paymentIntentId, productName) {
  const product = productOf(productName);
  const intent = await retrievePaymentIntent(paymentIntentId);
  if (intent.status !== 'succeeded') {
    throw Object.assign(new Error('This payment has not gone through yet.'), { status: 402 });
  }
  // A payment does not stay spendable forever.
  //
  // Without this, an intent created today and completed at any point after —
  // next week, next year — is still a live key to the paid routes, and the
  // ledger's per-payment cap is the only thing bounding it. That cap limits
  // how *many* times one payment is worth something; this limits how *long*.
  // Thirty days is well past any honest reader's retry — the resume path
  // exists for the one whose generation failed after a charge cleared, and
  // nobody comes back to that a month later — while closing the case where an
  // old intent is kept around and cashed in much later.
  // Fails open when `created` is absent rather than refusing the payment: this
  // is a second line behind the status and amount checks above, and a Stripe
  // response that one day stops carrying the field should cost us a window we
  // no longer enforce, not every reader their purchase. Both paths through
  // retrievePaymentIntent populate it today, and a check in the self-test
  // holds them to that, so this branch cannot go quiet without something
  // failing loudly first.
  const created = Number(intent.created);
  const ageMs = created > 0 ? Date.now() - created * 1000 : 0;
  if (ageMs > REDEEM_WINDOW_MS) {
    throw Object.assign(new Error('This payment is too old to use. Contact support if it was never honoured.'),
      { status: 402 });
  }
  // Against *this* product's price, not merely against some known price: a
  // S$0.99 analysis payment presented for the S$1.99 unlock has really
  // succeeded and really belongs to this account, and would sail through a
  // check that only asked whether it was one of ours.
  if (intent.amount !== product.cents || intent.currency !== CURRENCY) {
    throw Object.assign(new Error('This payment does not match the price of what it is being used for.'),
      { status: 402 });
  }
  return intent;
}

/** What the server reports at /api/status and prints on boot. */
function describe() {
  return {
    ready: ready(),
    mock: MOCK,
    publishableKey: MOCK ? '' : PUBLISHABLE_KEY,
    priceCents: UNLOCK_PRICE_CENTS,
    analysisPriceCents: ANALYSIS_PRICE_CENTS,
    currency: CURRENCY,
    country: COUNTRY,
    hint: ready() ? '' : 'Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY, or run with PSYCHEAI_MOCK=1.',
  };
}

module.exports = {
  hasKey, ready, createPaymentIntent, retrievePaymentIntent, verifyPaid, describeError, describe,
  UNLOCK_PRICE_CENTS, ANALYSIS_PRICE_CENTS, PRODUCTS, CURRENCY, COUNTRY, REDEEM_WINDOW_MS,
  __testing: {
    setClient(stub) { client = stub; },
    reset() { client = null; mockIntents.clear(); },
    // Backdates a mock intent so the redemption window can be tested without
    // a test that waits thirty days.
    ageMockIntent(id, ms) {
      const row = mockIntents.get(String(id));
      if (row) row.created -= ms;
      return Boolean(row);
    },
  },
};
