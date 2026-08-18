// The one paid feature: a $1.99 unlock for the "Supplementary analysis"
// section, taken on-site via Stripe's Payment Request Button so the browser
// offers Apple Pay or Google Pay directly rather than a typed-in card form.
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

const CURRENCY = 'usd';
const UNLOCK_PRICE_CENTS = 199;
// The merchant's own country, for Stripe's PaymentRequest — not the buyer's,
// which the wallet sheet supplies itself. Only matters outside the US.
const COUNTRY = process.env.STRIPE_ACCOUNT_COUNTRY || 'US';

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
 * response can be told apart from a real one on sight, in a log or in a test.
 */
async function createPaymentIntent(description) {
  if (MOCK) {
    const id = 'pi_mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  hasKey, ready, createPaymentIntent, describeError, describe,
  UNLOCK_PRICE_CENTS, CURRENCY, COUNTRY,
  __testing: { setClient(stub) { client = stub; }, reset() { client = null; } },
};
