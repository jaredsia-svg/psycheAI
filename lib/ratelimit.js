// Per-caller ceilings on the routes that cost money to serve.
//
// Every other guard in this app answers "is this request allowed to do the
// expensive thing" — budget.js caps the day's free spend in aggregate,
// premiumLedger.js caps how often one payment can be redeemed, stripe.js
// refuses a payment that does not match its product's price. None of them
// answer "is this *caller* asking too often", because until now nothing
// counted per caller at all. That is the hole this file fills: an endpoint
// that is cheap for a script to call and expensive for us to answer is a
// standing invitation, whether the cost lands on the model budget or on
// Stripe's API quota.
//
// A token bucket rather than a fixed window, because a fixed window lets a
// caller spend the whole allowance in the last second of one window and the
// whole of the next in the first second of the following one — twice the
// intended rate, in a burst, at exactly the moment a flood is most useful to
// whoever is running it. A bucket refills continuously, so the average and
// the burst are the same number.
//
// In memory, deliberately, and shared with nothing. A restart forgives every
// caller, which is the right trade for a single-process app: the alternative
// is a datastore dependency and a persisted record of who called what and
// when, which is a privacy cost this app does not otherwise pay. The limits
// are a brake on automated abuse, not an audit trail.
'use strict';

// Each entry is `capacity` requests, refilled evenly across `windowMs`.
//
// The numbers differ by what the route actually costs us. `payment-intent` is
// the tightest because it is the one an attacker can drive without paying
// anything and without a model call: every hit creates a real object in the
// Stripe account. The model routes are looser in count but measured over a
// longer window, because a person who is genuinely retrying a failed report
// should not be locked out, while a script running flat out still hits the
// wall within a minute.
//
// All overridable, because the right ceiling depends on how the box is
// deployed — a single shared IP behind an office NAT wants a higher one than
// a per-user address does.
function tune(name, fallback) {
  const value = Number(process.env['PSYCHEAI_RATE_' + name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// The window a capacity is spread across. Separately overridable from the
// capacity because the two say different things: raising the capacity lets a
// caller burst harder, shortening the window lets them sustain more. An
// operator behind a shared NAT wants the first; a test that cannot wait ten
// minutes to watch a bucket refill wants the second.
function tuneWindow(name, fallback) {
  return tune(name + '_WINDOW_MS', fallback);
}

const MINUTE = 60 * 1000;
const LIMITS = {
  // Six intents in ten minutes. A reader who pays once needs one; a reader
  // whose wallet sheet fails and who tries again needs a handful. A script
  // wanting to litter the Stripe account with incomplete intents gets six.
  'payment-intent': { capacity: tune('PAYMENT_INTENT', 6), windowMs: tuneWindow('PAYMENT_INTENT', 10 * MINUTE) },
  // The free report. The daily budget already caps what everyone together can
  // spend; this caps what one caller can take out of it before anyone else
  // gets a turn.
  analyse: { capacity: tune('ANALYSE', 6), windowMs: tuneWindow('ANALYSE', 60 * MINUTE) },
  // Paid, and metered per payment by premiumLedger on top of this.
  compatibility: { capacity: tune('COMPATIBILITY', 8), windowMs: tuneWindow('COMPATIBILITY', 60 * MINUTE) },
  'premium-analysis': { capacity: tune('PREMIUM', 8), windowMs: tuneWindow('PREMIUM', 60 * MINUTE) },
  // Nonce issuance is cheap to serve, so this is high enough never to trouble
  // a real page and low enough that minting nonces cannot itself become the
  // flood — see lib/nonce.js on why that matters.
  nonce: { capacity: tune('NONCE', 60), windowMs: tuneWindow('NONCE', 60 * MINUTE) },
};

// Bounded, for the same reason results.js is: an unbounded map keyed by
// something the caller controls is a memory leak with a user interface. A
// Map iterates in insertion order, so the oldest key is simply the first one.
const MAX_KEYS = Number(process.env.PSYCHEAI_RATE_MAX_KEYS) || 5000;
const buckets = new Map();

/**
 * Which caller this is, as well as we can honestly tell.
 *
 * Behind a proxy the socket address is the proxy's, identical for everybody,
 * which would put every reader in the world in one bucket and lock them all
 * out together — a rate limiter that mistakes the whole internet for one
 * caller is worse than none. So X-Forwarded-For has to be read. But it is a
 * request header like any other: a caller can send whatever they like in it,
 * and a limiter that believes the leftmost entry can be defeated by
 * incrementing a number.
 *
 * The resolution is to count from the right. Each proxy *appends* the address
 * it received the connection from, so the rightmost entry was written by the
 * hop closest to us and is the only one a remote caller cannot forge. With
 * one proxy in front, that entry is the real client. PSYCHEAI_TRUST_PROXY
 * says how many hops to step back past; the default of one is what a single
 * load balancer looks like, and it falls back to the socket address when no
 * header is present at all, which is what a direct connection looks like.
 */
function clientKey(request) {
  const configured = Number(process.env.PSYCHEAI_TRUST_PROXY);
  const hops = Number.isFinite(configured) && configured >= 0 ? configured : 1;
  const header = (request && request.headers && request.headers['x-forwarded-for']) || '';
  const chain = String(header).split(',').map(part => part.trim()).filter(Boolean);
  if (hops > 0 && chain.length) {
    // One hop means the last entry, two means the one before it, and running
    // off the front of a shorter-than-expected chain falls back to the
    // leftmost rather than to undefined.
    return chain[Math.max(0, chain.length - hops)] || chain[0];
  }
  const socket = request && request.socket;
  return (socket && socket.remoteAddress) || 'unknown';
}

/**
 * Spend one token from `name`'s bucket for this caller.
 *
 * Returns `{ ok: true }` when the request may proceed, or `{ ok: false,
 * retryAfter }` with a whole number of seconds until the next token, which is
 * what the Retry-After header wants. An unknown limit name is allowed rather
 * than refused: a typo in a route table should not silently close a route.
 */
function take(name, key) {
  const limit = LIMITS[name];
  if (!limit) return { ok: true };

  const now = Date.now();
  const id = name + ':' + key;
  const perMs = limit.capacity / limit.windowMs;

  let bucket = buckets.get(id);
  if (!bucket) {
    if (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value);
    bucket = { tokens: limit.capacity, last: now };
  } else {
    // Re-inserted below, so an active caller moves to the young end of the
    // map and eviction falls on whoever has been quiet longest.
    buckets.delete(id);
    bucket.tokens = Math.min(limit.capacity, bucket.tokens + (now - bucket.last) * perMs);
    bucket.last = now;
  }
  buckets.set(id, bucket);

  if (bucket.tokens < 1) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)) };
  }
  bucket.tokens -= 1;
  return { ok: true };
}

/** Test seam: forget every caller. */
function reset() {
  buckets.clear();
}

module.exports = { take, clientKey, reset, LIMITS, MAX_KEYS, size: () => buckets.size };
