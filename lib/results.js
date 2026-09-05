// A short-lived memory of analyses — the ones that finished, and the ones
// still running.
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

// Analyses that are running right now, keyed the same way, holding the promise
// rather than a value.
//
// The settled cache above only helps a reader whose retry arrives *after* the
// first call finished. That is the smaller half of the problem. An analysis
// takes minutes, and the connection drops that readers actually report happen
// during those minutes — a phone backgrounded, a carrier handover, a proxy
// cutting a socket it thinks is idle. At that moment `entries` is empty,
// because nothing has finished, so the retry sails past it and starts a second
// model call for a question already being answered: twice the cost, twice the
// load, and a second connection just as likely to drop as the first.
//
// Registering the in-flight promise closes that window. A retry inside it
// attaches to the work already running and is handed the same report the
// moment it lands. The reader waits out the remainder rather than the whole
// thing again, and the provider is called once.
//
// The same trick lib/gemini.js uses for cache creation, and for the same
// reason: what you want to deduplicate is the work, not just its result.
const running = new Map();

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

/**
 * The analysis already running for this digest, or null.
 *
 * Synchronous on purpose. The caller checks this and then registers its own
 * work with `share` below, and the two must not have an `await` between them:
 * a yield there would let a second request see "nothing running" a moment
 * before the first registers, which is the exact race this exists to close.
 */
function pending(kind, digest) {
  return running.get(keyFor(kind, digest)) || null;
}

/**
 * Run `produce`, letting anything that asks the same question in the meantime
 * attach to it rather than start its own.
 *
 * Registered synchronously, so there is no window between `pending` returning
 * null and this promise being visible. Deregistered on settle — a failure
 * leaves nothing behind, so the next attempt really is a fresh one rather than
 * a subscription to an error that has already happened.
 */
function share(kind, digest, produce) {
  const key = keyFor(kind, digest);
  const existing = running.get(key);
  if (existing) return existing;

  const attempt = (async () => set(kind, digest, await produce()))();
  running.set(key, attempt);
  // Marks the promise handled so that a caller disconnecting mid-generation
  // cannot turn a provider failure into an unhandled rejection that takes the
  // process down. Everyone actually awaiting `attempt` still sees the error —
  // this is a second, separate subscription, not a swallow.
  attempt.catch(() => {});
  const done = () => { if (running.get(key) === attempt) running.delete(key); };
  attempt.then(done, done);
  return attempt;
}

/** Tests only — nothing in the running server clears this. */
function reset() {
  entries.clear();
  running.clear();
}

module.exports = {
  get, set, keyFor, pending, share, reset, TTL_MS, MAX_ENTRIES,
  size: () => entries.size,
  runningCount: () => running.size,
};
