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

const store = require('./store');

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
  //
  // Twenty an hour, not the six this started at, because an address is very
  // often not a person. An office, a school and a café each look like one
  // caller, and a mobile carrier can put thousands of phones behind a single
  // address — six an hour shared between all of them turns readers away for
  // something they did not do, and the message they get blames them for it.
  // The first evidence of that was the test suite tripping this limit on its
  // own first run.
  //
  // Loosening it costs nothing defensively. The flooding this was added to
  // stop is bounded by 'payment-intent' below, which is a separate bucket, and
  // by the daily budget ceiling above it. Twenty is still far under what a
  // script achieves in a minute.
  analyse: { capacity: tune('ANALYSE', 20), windowMs: tuneWindow('ANALYSE', 60 * MINUTE) },
  // Paid, and metered per payment by premiumLedger on top of this.
  compatibility: { capacity: tune('COMPATIBILITY', 8), windowMs: tuneWindow('COMPATIBILITY', 60 * MINUTE) },
  'premium-analysis': { capacity: tune('PREMIUM', 8), windowMs: tuneWindow('PREMIUM', 60 * MINUTE) },
  // Nonce issuance is cheap to serve, so this is high enough never to trouble
  // a real page and low enough that minting nonces cannot itself become the
  // flood — see lib/nonce.js on why that matters.
  nonce: { capacity: tune('NONCE', 60), windowMs: tuneWindow('NONCE', 60 * MINUTE) },
  // A step of the journey (POST /api/event): a few per visit at most.
  event: { capacity: tune('EVENT', 300), windowMs: tuneWindow('EVENT', 60 * MINUTE) },
  // The invite-friends status and claim.
  referral: { capacity: tune('REFERRAL', 300), windowMs: tuneWindow('REFERRAL', 60 * MINUTE) },
  // Ask PsycheAI: each one is paid for with a credit, so this only stops a
  // runaway client.
  ask: { capacity: tune('ASK', 30), windowMs: tuneWindow('ASK', 60 * MINUTE) },
  // Sending a finished sync back to the person whose link it was: one per sync.
  'sync-send': { capacity: tune('SYNC_SEND', 30), windowMs: tuneWindow('SYNC_SEND', 60 * MINUTE) },
  // Opening a short personal link.
  link: { capacity: tune('LINK', 300), windowMs: tuneWindow('LINK', 60 * MINUTE) },
  // Polling for a finished analysis. Sized from what one report costs a
  // reader rather than from what feels tidy: a three-minute job polled every
  // few seconds is on the order of fifty requests, and a phone that sleeps and
  // wakes several times through one will make more. This is the one route
  // here that a well-behaved client hits in bulk, so it is generous — and it
  // can afford to be, because a poll starts no work and answers from a map.
  result: { capacity: tune('RESULT', 600), windowMs: tuneWindow('RESULT', 60 * MINUTE) },
  // The operator's daily totals (/api/stats): a token guards it, and this
  // stops anyone guessing at the token quickly.
  stats: { capacity: tune('STATS', 30), windowMs: tuneWindow('STATS', 60 * MINUTE) },
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
// Said for the first few proxied requests of a process (each new shape of chain, up to
// five): how many addresses the X-Forwarded-For chain holds, what kind each one is
// (private, cloudflare, public, or not an address), how many hops this server steps back
// (PSYCHEAI_TRUST_PROXY), and so which entry, of which kind, the limit counts by. Never an
// address. It lets the operator see from the log whether the setting picks the visitor:
// the entry it counts by should be "public"; "private" or "cloudflare" there means every
// visitor behind that hop shares one bucket (README "Who the limit counts").
const CHAIN_LOGS = 5;
const chainShapes = new Set();

// Cloudflare's published ranges (cloudflare.com/ips), so a Cloudflare hop can be named.
const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22'];
const CLOUDFLARE_V6 = ['2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:', '2a06:98c', '2a06:98d', '2a06:98e', '2a06:98f', '2c0f:f248:'];
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16'];

function v4(address) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.some(n => n > 255) ? null : ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function inRange(n, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return ((n & mask) >>> 0) === ((v4(base) & mask) >>> 0);
}
/** What kind of address an X-Forwarded-For entry is, never the address itself. */
function kindOf(entry) {
  let a = String(entry || '').trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a)) a = a.replace(/:\d+$/, '');
  if (a.startsWith('::ffff:')) a = a.slice(7);
  const n = v4(a);
  if (n !== null) {
    if (PRIVATE_V4.some(c => inRange(n, c))) return 'private';
    if (CLOUDFLARE_V4.some(c => inRange(n, c))) return 'cloudflare';
    return 'public';
  }
  if (/^[0-9a-f:]+$/.test(a) && a.includes(':')) {
    if (a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a)) return 'private';
    if (CLOUDFLARE_V6.some(p => a.startsWith(p))) return 'cloudflare';
    return 'public';
  }
  return 'not an address';
}
function logChain(chain, hops) {
  if (chainShapes.size >= CHAIN_LOGS) return;
  const kinds = chain.map(kindOf);
  const at = hops > 0 ? Math.max(0, chain.length - hops) : -1;
  const shape = kinds.join(',') + '|' + at;
  if (chainShapes.has(shape)) return;
  chainShapes.add(shape);
  console.log('ratelimit: a proxied request carried ' + chain.length + ' X-Forwarded-For entr' + (chain.length === 1 ? 'y' : 'ies') +
    ' (' + kinds.join(', ') + '); PSYCHEAI_TRUST_PROXY steps back ' + hops +
    (at >= 0 ? ', so the limit counts by entry ' + (at + 1) + ' (' + kinds[at] + ').' : ', so the limit counts by the connection.'));
}

function clientKey(request) {
  const configured = Number(process.env.PSYCHEAI_TRUST_PROXY);
  const hops = Number.isFinite(configured) && configured >= 0 ? configured : 1;
  const header = (request && request.headers && request.headers['x-forwarded-for']) || '';
  const chain = String(header).split(',').map(part => part.trim()).filter(Boolean);
  if (chain.length) logChain(chain, hops);
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

/**
 * The same limit, shared by every server process through the store, as a
 * fixed window: `name`'s capacity per window, counted under a one-way code
 * of the caller (never the address itself), kept only as long as the window.
 * A second layer behind take(): take() answers instantly from this process's
 * memory; this one holds when there is more than one process, and across a
 * deploy. Allows the request when the store is not configured or cannot be
 * reached — a store outage must not close the site.
 */
async function takeShared(name, key) {
  const limit = LIMITS[name];
  if (!limit || !store.enabled()) return { ok: true };
  const windowMs = limit.windowMs;
  const slot = Math.floor(Date.now() / windowMs);
  const id = 'rl:' + name + ':' + store.keyed('rl', key) + ':' + slot;
  const rows = await store.run([['INCR', id], ['EXPIRE', id, Math.ceil(windowMs / 1000) + 5]]);
  if (!rows) return { ok: true };
  if (Number(rows[0]) > limit.capacity) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil(((slot + 1) * windowMs - Date.now()) / 1000)) };
  }
  return { ok: true };
}

/** Test seam: forget every caller. */
function reset() {
  buckets.clear();
  chainShapes.clear();
}

module.exports = { take, takeShared, clientKey, reset, kindOf, LIMITS, MAX_KEYS, size: () => buckets.size };
