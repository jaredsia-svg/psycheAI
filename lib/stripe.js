// The paid feature: a US$5 unlock for the full premium report — the written
// report behind the card, the roast and the four premium sections —
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

// The price table shared with the page (docs/prices.js): a reader pays the
// rounded local price in the markets it lists, USD everywhere else. Loaded
// here so the server charges, and checks, exactly what the page showed —
// verifyPaid holds a payment to the table's amount for its own currency, so
// one taken in a currency or at an amount the table does not list fails the
// gate rather than unlocking at whatever it happened to cost.
//
// A Stripe account outside the US charges in any of these and settles in its
// own currency — see the README's setup notes.
require('../docs/prices.js');
const Prices = globalThis.PsychePrices;
const CURRENCY = Prices.DEFAULT_CURRENCY;
const UNLOCK_PRICE_CENTS = Prices.amount(CURRENCY, 'unlock');
// The second thing this server sells: one more summary-card run, past the one
// every reader gets without paying. Cheaper than the unlock because it buys
// less — the card again, against more data, rather than the full report.
const ANALYSIS_PRICE_CENTS = Prices.amount(CURRENCY, 'analysis');

// Two products, one payment pipeline. Every amount below is read from here
// rather than passed in, because an amount a client could influence is an
// amount a client could set to zero — the same reasoning that keeps
// UNLOCK_PRICE_CENTS out of the request body. `verifyPaid` checks the
// retrieved PaymentIntent against the price of the product being claimed, so
// a US$2 analysis payment cannot be re-presented to unlock the US$5 premium
// report. Compatibility reports are free and are not sold here.
// How long a successful payment stays redeemable — see verifyPaid.
const REDEEM_WINDOW_MS = Number(process.env.PSYCHEAI_REDEEM_WINDOW_MS) || 30 * 24 * 60 * 60 * 1000;

const PRODUCTS = {
  unlock: { cents: UNLOCK_PRICE_CENTS, label: 'PsycheAI full premium report' },
  analysis: { cents: ANALYSIS_PRICE_CENTS, label: 'PsycheAI summary card re-run' },
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

async function createPaymentIntent(description, productName, requestedCurrency, discount) {
  const product = productOf(productName);
  // The currency is the one thing about the price a client chooses, and only
  // from the table: anything else is USD. The amount is the table's for that
  // currency and product, never the client's.
  const currency = Prices.known(requestedCurrency);
  const productKey = productName === 'analysis' ? 'analysis' : 'unlock';
  // A discount promo code, already checked by the caller: `{ code, percent }`.
  // The amount is still the table's, less the code's share, and the code and
  // share are written onto the PaymentIntent itself — by this server, where
  // no client can reach them — so verifyPaid can hold the payment to that
  // discounted price later without trusting anything the browser sends.
  const off = discount && discount.percent > 0 && discount.percent < 100 ? discount : null;
  const cents = off ? Prices.discounted(currency, productKey, off.percent) : Prices.amount(currency, productKey);
  const metadata = off ? { promo: String(off.code), percent: String(off.percent) } : undefined;
  if (MOCK) {
    const id = 'pi_mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    // The amount and the creation time ride along with the id in mock mode,
    // because mock mode has no Stripe to retrieve them back from later — see
    // retrievePaymentIntent. The timestamp is stored rather than recovered
    // from the id: the id appends random noise straight onto the base-36
    // clock with no separator, so the two cannot be told apart again.
    mockIntents.set(id, { cents, currency, metadata: metadata || {}, created: Date.now() });
    return {
      id, clientSecret: id + '_secret_mock', amount: cents, currency,
      country: COUNTRY, publishableKey: '', mock: true,
    };
  }
  if (!SECRET_KEY) {
    throw Object.assign(new Error('Payments are not configured on this server.'), { status: 503 });
  }
  try {
    const intent = await stripeClient().paymentIntents.create({
      amount: cents,
      currency,
      description: description || product.label,
      automatic_payment_methods: { enabled: true },
      ...(metadata ? { metadata } : {}),
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
    // mode has to be able to tell a US$2 analysis payment from a US$5
    // unlock, or verifyPaid's product check is untested on the one path the
    // suites actually run.
    return {
      id: String(id), status: 'succeeded',
      amount: mockIntents.get(String(id)).cents, currency: mockIntents.get(String(id)).currency,
      metadata: mockIntents.get(String(id)).metadata || {},
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
      currency: intent.currency, created: intent.created, metadata: intent.metadata || {},
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
  // US$2 analysis payment presented for the US$5 unlock has really
  // succeeded and really belongs to this account, and would sail through a
  // check that only asked whether it was one of ours.
  // In whichever of the table's currencies it was paid, at that currency's
  // price for this product.
  // Or at the discounted price this server itself wrote onto the intent when
  // a promo code took a share off — see createPaymentIntent.
  const paidIn = String(intent.currency || '').toLowerCase();
  const productKey = productName === 'analysis' ? 'analysis' : 'unlock';
  const meta = intent.metadata || {};
  const percent = Number(meta.percent);
  const price = meta.promo && percent > 0 && percent < 100
    ? Prices.discounted(paidIn, productKey, percent) : Prices.amount(paidIn, productKey);
  if (!Prices.TABLE[paidIn] || intent.amount !== price) {
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
