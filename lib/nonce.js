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
//   3. A captured request is not trivially replayable.
//
// What it emphatically does not do is stop a determined attacker: they can
// fetch a nonce and use it, exactly as the page does. The thing that actually
// bounds a flood is lib/ratelimit.js. This file raises the cost per attempt
// and closes the cross-site case; the limiter sets the ceiling. Neither is
// much use without the other, which is why they went in together.
//
// ---------- why these are signed rather than remembered ----------
//
// The first version of this file kept a Map of issued tokens and spent them
// out of it. That is the obvious design and it was wrong for how this app is
// deployed, in a way that surfaced as readers being told to reload a page
// they had done nothing to.
//
// A Map lives in one process. Tickets are minted by /api/nonce and spent by a
// separate POST, and nothing guarantees those two requests reach the same
// process:
//
//   · More than one instance behind the load balancer, and a ticket minted by
//     one means nothing to the other.
//   · A zero-downtime deploy, where the outgoing and incoming processes serve
//     traffic together for a window — which happens on *every* push here,
//     even at a single instance.
//   · An ordinary restart, which forgot every outstanding ticket at once.
//
// docs/llm.js retries a refused ticket once, which covers a restart neatly:
// there is one bad moment and the second attempt lands after it. It does not
// cover the other two, because they are not moments — both attempts are
// equally likely to land on the wrong process, so a reader could be refused
// twice in a row and shown an error with no remedy in it. That is exactly
// what was reported.
//
// So validity is now carried in the ticket itself: an expiry and some
// randomness, signed with a key every instance derives identically. Any
// process can check any ticket without having been the one to mint it, and a
// restart invalidates nothing. Nothing about it is guessable — the signature
// is what cannot be produced without the key, which is the same property the
// Map's unguessable keys had.
//
// The honest cost is in property 3. Single use is now enforced per process
// rather than across the deployment: a token spent here cannot be spent here
// again, but a replay landing on a *different* instance inside the ticket's
// short life would be accepted. That is a real weakening and it is the right
// trade. Properties 1 and 2 — the round trip and the cross-site case, which
// are the reasons this file exists — are untouched by it, the rate limiter is
// unaffected and remains the actual ceiling, and replay was never the thing
// standing between this app and abuse. Being refused for nothing was a
// certainty; a cross-instance replay inside ten minutes is a hypothetical
// that buys an attacker one extra request they could have asked for anyway.
'use strict';

const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

// Long enough to sit unused while a reader reads a price and decides, short
// enough that a ticket scraped from a page is worthless by the time anyone
// gets around to it.
const TTL_MS = Number(process.env.PSYCHEAI_NONCE_TTL_MS) || 10 * 60 * 1000;

// Bounded like every other in-memory table here, and for the same reason: the
// caller decides how many of these exist. Insertion-ordered, so the first key
// is the oldest.
const MAX_ENTRIES = Number(process.env.PSYCHEAI_NONCE_MAX) || 5000;

/**
 * The signing key, which every instance has to derive to the same value
 * without being told it.
 *
 * PSYCHEAI_NONCE_SECRET is the explicit way and is read first. Failing that,
 * this hashes whichever provider or payment key the deployment already has:
 * those are set once for the service and are therefore identical across its
 * instances and stable across its restarts, which is exactly the property
 * needed. Hashed rather than used raw, and never sent anywhere, so a ticket
 * cannot be worked backwards into the key it was signed with.
 *
 * With none of them — a local checkout, the test suites — this falls back to
 * random bytes for this process alone. That is the old behaviour and it is
 * correct there: a single process is the only thing running, so there is no
 * second one to disagree with.
 */
const SIGNING_KEY = (() => {
  const explicit = String(process.env.PSYCHEAI_NONCE_SECRET || '').trim();
  if (explicit) return createHash('sha256').update('psycheai-nonce-v1:' + explicit).digest();
  const shared = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ||
    process.env.STRIPE_SECRET_KEY || '';
  if (shared) return createHash('sha256').update('psycheai-nonce-v1:' + shared).digest();
  return randomBytes(32);
})();

// Tokens already spent in *this* process. Best effort at single use — see the
// note above on what became of that property. Bounded and insertion-ordered,
// so eviction is the oldest first, and swept on spend rather than on a timer:
// there is nothing to clean up when nothing is being spent, and a timer would
// hold the process open for a table that is allowed to be empty.
const spent = new Map();

function sign(payload) {
  return createHmac('sha256', SIGNING_KEY).update(payload).digest('base64url');
}

/**
 * A fresh ticket: when it dies, some randomness, and a signature over both.
 *
 * The random half is not decoration. Without it two tickets minted in the
 * same millisecond would be identical, which would make the spent-set treat
 * one reader's request as the other's replay.
 */
function issue() {
  const payload = (Date.now() + TTL_MS) + '.' + randomBytes(18).toString('base64url');
  return payload + '.' + sign(payload);
}

/**
 * Spend a ticket. True once for a ticket this deployment really minted and
 * which has not expired; false for one that was forged, tampered with, has
 * already been spent on this process, or is out of date — the caller cannot
 * tell those apart, and does not need to.
 */
function spend(token) {
  if (typeof token !== 'string' || !token) return false;
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return false;

  const payload = token.slice(0, cut);
  const offered = token.slice(cut + 1);
  const expected = sign(payload);
  // Length-checked first because timingSafeEqual throws on a mismatch rather
  // than returning false, and the length of a signature is not a secret.
  if (offered.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(offered), Buffer.from(expected))) return false;

  const expiry = Number(payload.slice(0, payload.indexOf('.')));
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;

  sweep();
  if (spent.has(token)) return false;
  if (spent.size >= MAX_ENTRIES) spent.delete(spent.keys().next().value);
  spent.set(token, expiry);
  return true;
}

function sweep() {
  const now = Date.now();
  for (const [token, expiry] of spent) {
    // Insertion order is expiry order — every ticket gets the same TTL — so
    // the first live one means the rest are live too.
    if (expiry > now) break;
    spent.delete(token);
  }
}

/** Test seam: forget which tickets have been spent. */
function reset() {
  spent.clear();
}

module.exports = {
  issue, spend, reset, TTL_MS, MAX_ENTRIES,
  size: () => spent.size,
  // Seams for tools/selftest.mjs, which has to be able to prove that a ticket
  // minted by one process is accepted by another — the whole point of the
  // rewrite, and not observable from inside a single one.
  __testing: { sign, SIGNING_KEY },
};
