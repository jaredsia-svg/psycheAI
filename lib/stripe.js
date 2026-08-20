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
const mockIntents = new Set();

async function createPaymentIntent(description) {
  if (MOCK) {
    const id = 'pi_mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    mockIntents.add(id);
    return {
      id, clientSecret: id + '_secret_mock', amount: UNLOCK_PRICE_CENTS, currency: CURRENCY,
      country: COUNTRY, publishableKey: '', mock: true,
    };
  }
  if (!SECRET_KEY) {
    throw Object.assign(new Error('Payments are not configured on this server.'), { status: 503 });
  }
  try {
    const intent = await stripeClient().paymentIntents.create({
      amount: UNLOCK_PRICE_CENTS,
      currency: CURRENCY,
      description,
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
    return { id: String(id), status: 'succeeded', amount: UNLOCK_PRICE_CENTS, currency: CURRENCY };
  }
  if (!SECRET_KEY) {
    throw Object.assign(new Error('Payments are not configured on this server.'), { status: 503 });
  }
  try {
    const intent = await stripeClient().paymentIntents.retrieve(String(id || ''));
    return { id: intent.id, status: intent.status, amount: intent.amount, currency: intent.currency };
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
async function verifyPaid(paymentIntentId) {
  const intent = await retrievePaymentIntent(paymentIntentId);
  if (intent.status !== 'succeeded') {
    throw Object.assign(new Error('This payment has not gone through yet.'), { status: 402 });
  }
  if (intent.amount !== UNLOCK_PRICE_CENTS || intent.currency !== CURRENCY) {
    throw Object.assign(new Error('This payment does not match the unlock price.'), { status: 402 });
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
    currency: CURRENCY,
    country: COUNTRY,
    hint: ready() ? '' : 'Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY, or run with PSYCHEAI_MOCK=1.',
  };
}

module.exports = {
  hasKey, ready, createPaymentIntent, retrievePaymentIntent, verifyPaid, describeError, describe,
  UNLOCK_PRICE_CENTS, CURRENCY, COUNTRY,
  __testing: { setClient(stub) { client = stub; }, reset() { client = null; mockIntents.clear(); } },
};
