// Single-use tickets for the routes that cost money to serve.
//
// What this does and does not buy is worth being exact about, because a nonce
// is easy to mistake for authentication and it is not that. There is no
// account in this app and nothing to authenticate against; anyone at all is
// allowed to ask for a report. What a nonce establishes is narrower and still
// worth having:
//
//   1. The caller made a round trip first. A blind `curl` at
//      /api/create-payment-intent no longer produces a PaymentIntent — it
//      produces a 400. To flood the endpoint you must now mint a ticket per
//      request, which doubles the traffic an attacker needs and, more to the
//      point, puts that minting under a rate limit of its own.
//   2. The request came from something that can read our responses. A form on
//      someone else's site can POST here cross-origin, but it cannot read the
//      nonce it would need to include, so the drive-by CSRF shape is closed.
//   3. A captured request cannot be replayed. Each ticket is spent on first
//      use and gone.
//
// What it emphatically does not do is stop a determined attacker: they can
// fetch a nonce and use it, exactly as the page does. The thing that actually
// bounds a flood is lib/ratelimit.js. This file raises the cost per attempt
// and closes the cross-site case; the limiter sets the ceiling. Neither is
// much use without the other, which is why they went in together.
//
// Kept in memory and never written down. A restart invalidates every
// outstanding ticket, which costs a reader mid-purchase one retry and costs
// this app no persisted record of who was doing what.
'use strict';

const { randomBytes } = require('node:crypto');

// Long enough to sit unused while a reader reads a price and decides, short
// enough that a ticket scraped from a page is worthless by the time anyone
// gets around to it.
const TTL_MS = Number(process.env.PSYCHEAI_NONCE_TTL_MS) || 10 * 60 * 1000;

// Bounded like every other in-memory table here, and for the same reason: the
// caller decides how many of these exist. Insertion-ordered, so the first key
// is the oldest.
const MAX_ENTRIES = Number(process.env.PSYCHEAI_NONCE_MAX) || 5000;

const issued = new Map();

// 24 bytes of real randomness. Not a counter, not a timestamp, not a hash of
// anything the caller can see: a guessable ticket is no ticket, and the whole
// value of the mechanism is that it cannot be produced without asking.
function issue() {
  sweep();
  if (issued.size >= MAX_ENTRIES) issued.delete(issued.keys().next().value);
  const token = randomBytes(24).toString('base64url');
  issued.set(token, Date.now() + TTL_MS);
  return token;
}

/**
 * Spend a ticket. True once for a live ticket, false for one that was never
 * issued, has already been used, or has expired — the caller cannot tell
 * those apart, and does not need to.
 *
 * Deleted before the expiry is checked rather than after, so an expired
 * ticket is cleaned up by the attempt to use it instead of lingering until
 * the next sweep.
 */
function spend(token) {
  if (typeof token !== 'string' || !token) return false;
  const expiry = issued.get(token);
  if (expiry === undefined) return false;
  issued.delete(token);
  return expiry > Date.now();
}

// Called on issue rather than on a timer: there is no work to do when nothing
// is being minted, and a timer would hold the process open for a table that
// is allowed to be empty.
function sweep() {
  const now = Date.now();
  for (const [token, expiry] of issued) {
    // Insertion order is expiry order — every ticket gets the same TTL — so
    // the first live one means the rest are live too.
    if (expiry > now) break;
    issued.delete(token);
  }
}

/** Test seam: forget every outstanding ticket. */
function reset() {
  issued.clear();
}

module.exports = { issue, spend, reset, TTL_MS, MAX_ENTRIES, size: () => issued.size };
