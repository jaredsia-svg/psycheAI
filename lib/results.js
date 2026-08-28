// A short-lived memory of analyses that already finished.
//
// The problem this solves costs real money. An analysis is a single buffered
// POST that runs for minutes, and Node does not abort a handler when the
// client disconnects — so when a reader's connection dies mid-generation
// (a backgrounded phone, a wifi-to-cellular handover, a proxy cutting an idle
// socket, a deploy) the model call still completes, the day's budget or the
// reader's payment is still spent, and the finished report is written to a
// socket nobody is listening on. The reader sees a failure, retries, and pays
// for the identical work a second time.
//
// Keyed on the digest, so a retry is recognised as the same question rather
// than trusted to say so: the client sends no request id and could not be
// believed about one anyway. Same digest inside the window means the same
// report, handed back for free.
//
// Deliberately in memory rather than on disk, unlike lib/budget.js and
// lib/premiumLedger.js. Those record facts that must survive a restart — what
// was spent, what was paid for. This holds somebody's personality report, and
// the whole design of this app is that such a thing lives on the reader's
// device and nowhere else. Writing it to the server's filesystem to save a
// retry would trade the product's central promise for a convenience. A
// restart losing the cache costs one re-run; a file on disk would cost the
// claim the FAQ makes.
'use strict';

const { createHash } = require('node:crypto');

// Long enough to cover a reader who drops out, notices, and comes back — the
// realistic gap is under a minute. Short enough that it is not a store.
//
// It is also the window in which the same digest cannot produce a *different*
// report, which is the one real cost of caching at all: a reader who wanted a
// second opinion on identical evidence gets the first one back. That is a
// deliberate trade — an unwanted repeat is a mild disappointment, a
// double charge for a dropped connection is a refund request — and adding
// evidence changes the digest, which changes the key, which produces a
// genuinely new report.
const TTL_MS = Number(process.env.PSYCHEAI_RESULT_TTL_MS) || 30 * 60 * 1000;

// A ceiling so a busy day cannot grow this without bound. Reports run tens of
// kilobytes; a few hundred is single-digit megabytes, and the oldest entry is
// the one least likely to still be wanted.
const MAX_ENTRIES = Number(process.env.PSYCHEAI_RESULT_CACHE_MAX) || 200;

// Insertion-ordered, which is what makes evicting the oldest a `keys().next()`
// rather than a sort.
const entries = new Map();

/**
 * The cache key for one analysis.
 *
 * `kind` separates the free report from the paid sections: the two produce
 * different shapes from the same digest, and one must never be served for the
 * other. The digest is hashed rather than kept, so what sits in this module's
 * keys is not readable back into anybody's evidence.
 */
function keyFor(kind, digest) {
  return String(kind) + ':' +
    createHash('sha256').update(JSON.stringify(digest)).digest('hex');
}

function prune(now) {
  for (const [key, entry] of entries) {
    if (now - entry.at > TTL_MS) entries.delete(key);
  }
}

/** The finished analysis for this digest, or null. */
function get(kind, digest) {
  const now = Date.now();
  prune(now);
  const entry = entries.get(keyFor(kind, digest));
  if (!entry) return null;
  if (now - entry.at > TTL_MS) return null;
  return entry.value;
}

/** Remember a finished analysis. Only ever called after one really came back. */
function set(kind, digest, value) {
  const now = Date.now();
  prune(now);
  const key = keyFor(kind, digest);
  // Re-inserted rather than updated in place, so a repeat keeps its position
  // as the newest entry rather than aging out on its first write's clock.
  entries.delete(key);
  entries.set(key, { at: now, value });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
  return value;
}

/** Tests only — nothing in the running server clears this. */
function reset() {
  entries.clear();
}

module.exports = { get, set, keyFor, reset, TTL_MS, MAX_ENTRIES, size: () => entries.size };
