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

// Four hours, raised from thirty minutes because thirty was chosen for a
// reader who drops out, notices immediately, and comes back — and that is not
// who needs this. Every recovery path in the app now leans on this window: the
// automatic retry in docs/llm.js, the "Try again" button, the offer to collect
// a purchase whose report never arrived, and — since analyses became
// background jobs — a phone rejoining one it started before it was put down.
// All of them still *work* past the window; they just stop being free, and
// cost a second model call and a second three-minute wait for work already
// done. Somebody who starts a report and comes back after lunch was outside
// thirty minutes and is inside four hours.
//
// It is also the window in which the same digest cannot produce a *different*
// report, which is the one real cost of caching at all: a reader who wanted a
// second opinion on identical evidence gets the first one back. That is a
// deliberate trade — an unwanted repeat is a mild disappointment, a
// double charge for a dropped connection is a refund request — and adding
// evidence changes the digest, which changes the key, which produces a
// genuinely new report. Four hours widens that window too, which is the
// honest cost of the change and is bounded by MAX_ENTRIES below either way.
const TTL_MS = Number(process.env.PSYCHEAI_RESULT_TTL_MS) || 4 * 60 * 60 * 1000;

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

// Why a job failed, kept briefly so that a poll can be told.
//
// Only needed since analyses became background jobs. When the caller was
// holding the connection, a failure travelled back down it and the reader saw
// the provider's own words. A polling client has no such connection: `running`
// deregisters on settle and `entries` is only written on success, so without
// this a failed job would simply stop existing, and the poll would report
// "never heard of it" — which reads as "start again from scratch" and is both
// wrong and expensive.
//
// Short-lived on purpose, and far shorter than a result. This exists to carry
// one message to a client already waiting for it, not to accumulate a log of
// everything that has ever gone wrong.
const FAILURE_TTL_MS = Number(process.env.PSYCHEAI_RESULT_FAILURE_TTL_MS) || 5 * 60 * 1000;
const failures = new Map();

// Fields that say when a digest was built rather than what is in it. Two
// digests differing only here are the same evidence and must not be two
// questions.
//
// `generatedAt` is a millisecond timestamp written by Digest.build, so any
// digest built a second time — which is exactly what the retry path on the
// welcome page does, since the archive is still in memory and gets rebuilt
// rather than reread from storage — carried a different key and sailed past a
// cache holding the answer it was about to pay for again. The cache looked
// like it worked, because the automatic retry inside docs/llm.js resends the
// identical body and hit it every time; the manual retry, the one a reader
// takes after being shown an error, never did.
const VOLATILE_FIELDS = ['generatedAt'];

/**
 * The cache key for one analysis.
 *
 * `kind` separates the free report from the paid sections: the two produce
 * different shapes from the same digest, and one must never be served for the
 * other. The digest is hashed rather than kept, so what sits in this module's
 * keys is not readable back into anybody's evidence.
 *
 * Only top-level volatile fields are stripped, and only by name. A deep walk
 * would be a licence for this list to grow into a normaliser, and a normaliser
 * that decides two different digests are the same question is how somebody
 * gets served a report about somebody else.
 */
function keyFor(kind, digest) {
  let subject = digest;
  if (digest && typeof digest === 'object' && !Array.isArray(digest) &&
      VOLATILE_FIELDS.some(field => field in digest)) {
    subject = {};
    // Rebuilt in the original order, minus the volatile keys: JSON.stringify
    // is order-sensitive, so a copy that reorders anything would defeat the
    // very stability this function exists to provide.
    for (const key of Object.keys(digest)) {
      if (!VOLATILE_FIELDS.includes(key)) subject[key] = digest[key];
    }
  }
  return String(kind) + ':' +
    createHash('sha256').update(JSON.stringify(subject)).digest('hex');
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

  // A new attempt clears the last one's failure: whatever the poll is about
  // to be told, it should be about this run rather than the one before it.
  failures.delete(key);
  const attempt = (async () => set(kind, digest, await produce()))();
  running.set(key, attempt);
  attempt.catch(error => {
    failures.set(key, {
      at: Date.now(),
      // The message only. The stack is for the server's log, and the body of
      // whatever failed is somebody's evidence digest.
      message: (error && error.message) || 'The analysis failed.',
    });
    while (failures.size > MAX_ENTRIES) {
      const oldest = failures.keys().next();
      if (oldest.done) break;
      failures.delete(oldest.value);
    }
  });
  // Marks the promise handled so that a caller disconnecting mid-generation
  // cannot turn a provider failure into an unhandled rejection that takes the
  // process down. Everyone actually awaiting `attempt` still sees the error —
  // this is a second, separate subscription, not a swallow.
  attempt.catch(() => {});
  const done = () => { if (running.get(key) === attempt) running.delete(key); };
  attempt.then(done, done);
  return attempt;
}

/**
 * What has become of one job, addressed by its key rather than by the digest
 * that produced it.
 *
 * The polling half of a background analysis. A client that started a job holds
 * the key it was handed and nothing else — it cannot be asked to send the
 * whole digest again on a timer just so the server can rediscover which job it
 * means, and the digest is the one thing worth not sending repeatedly.
 *
 * Four answers, and `unknown` is the interesting one: it means this process
 * has no memory of the job, which happens when it restarted or when the result
 * aged out. The client's remedy for that is to start the work again, which is
 * why it is reported as its own state rather than folded into a failure.
 */
function lookup(key) {
  const now = Date.now();
  prune(now);

  const entry = entries.get(key);
  if (entry && now - entry.at <= TTL_MS) return { status: 'done', value: entry.value };
  if (running.has(key)) return { status: 'running' };

  const failure = failures.get(key);
  if (failure) {
    if (now - failure.at <= FAILURE_TTL_MS) return { status: 'failed', error: failure.message };
    failures.delete(key);
  }
  return { status: 'unknown' };
}

/** Tests only — nothing in the running server clears this. */
function reset() {
  entries.clear();
  running.clear();
  failures.clear();
}

module.exports = {
  get, set, keyFor, pending, share, lookup, reset, TTL_MS, FAILURE_TTL_MS, MAX_ENTRIES,
  size: () => entries.size,
  runningCount: () => running.size,
};
