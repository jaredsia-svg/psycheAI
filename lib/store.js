// Durable storage: Upstash Redis over its REST API, or memory when it is not
// configured.
//
//   UPSTASH_REDIS_REST_URL    https://<name>.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  the REST token
//
// Everything that has to outlive a deploy goes through here: the day's
// totals (lib/stats.js), creator-code uses (lib/promo.js), the daily free
// budget (lib/budget.js), the paid-retry record (lib/premiumLedger.js), the
// shared rate-limit windows, which Instagram accounts have had their free
// card, and the friend-referral counts. Each of those keeps working in
// memory exactly as before; this adds the copy that survives.
//
// Two ways in:
//
//   run(commands)   await the answers — a pipeline of Redis commands, one
//                   round trip, e.g. [['INCR', 'k'], ['EXPIRE', 'k', 60]].
//                   Resolves to an array of results, or null when the store
//                   could not be reached (callers decide what that means).
//   send(commands)  fire and forget, for counts that must never slow a
//                   request down.
//
// Without the two variables set — local development and the test suite —
// the same commands run against an in-memory imitation, so nothing else in
// the server has to know which it is talking to. It implements only the
// commands this app uses.
//
// What is stored is counts, hashes and random codes: never a name, an
// address, a digest or a report. Keys are prefixed `psy:`.
'use strict';

const crypto = require('node:crypto');
const URL_ = String(process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const PREFIX = 'psy:';
const TIMEOUT_MS = Number(process.env.PSYCHEAI_STORE_TIMEOUT_MS) || 2500;

let remote = Boolean(URL_ && TOKEN);
let failures = 0;

// ---------- the in-memory imitation ----------

const memory = new Map();
const expiries = new Map();
function alive(key) {
  const at = expiries.get(key);
  if (at !== undefined && at <= Date.now()) { memory.delete(key); expiries.delete(key); }
  return memory.has(key);
}
function intOf(value) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? n : 0; }
const MEMORY = {
  GET: k => (alive(k) ? String(memory.get(k)) : null),
  SET(k, v, ...opts) {
    const flags = opts.map(o => String(o).toUpperCase());
    if (flags.includes('NX') && alive(k)) return null;
    memory.set(k, String(v));
    const ex = flags.indexOf('EX');
    if (ex >= 0) expiries.set(k, Date.now() + intOf(opts[ex + 1]) * 1000); else expiries.delete(k);
    return 'OK';
  },
  DEL: (...keys) => keys.reduce((n, k) => n + (alive(k) && memory.delete(k) ? 1 : 0), 0),
  INCR: k => MEMORY.INCRBY(k, 1),
  INCRBY(k, by) { const v = (alive(k) ? intOf(memory.get(k)) : 0) + intOf(by); memory.set(k, String(v)); return v; },
  DECRBY(k, by) { return MEMORY.INCRBY(k, -intOf(by)); },
  EXPIRE(k, s) { if (!alive(k)) return 0; expiries.set(k, Date.now() + intOf(s) * 1000); return 1; },
  HINCRBY(k, f, by) {
    const h = alive(k) ? memory.get(k) : new Map();
    const v = intOf(h.get(f)) + intOf(by);
    h.set(f, String(v)); memory.set(k, h); return v;
  },
  HSET(k, ...pairs) {
    const h = alive(k) ? memory.get(k) : new Map();
    let added = 0;
    for (let i = 0; i < pairs.length; i += 2) { if (!h.has(pairs[i])) added++; h.set(pairs[i], String(pairs[i + 1])); }
    memory.set(k, h); return added;
  },
  HGET: (k, f) => (alive(k) && memory.get(k).has(f) ? memory.get(k).get(f) : null),
  HGETALL: k => (alive(k) ? [...memory.get(k)].flat() : []),
  SADD(k, ...members) {
    const s = alive(k) ? memory.get(k) : new Set();
    let added = 0;
    for (const m of members) if (!s.has(String(m))) { s.add(String(m)); added++; }
    memory.set(k, s); return added;
  },
  SISMEMBER: (k, m) => (alive(k) && memory.get(k).has(String(m)) ? 1 : 0),
  SCARD: k => (alive(k) ? memory.get(k).size : 0),
  SMEMBERS: k => (alive(k) ? [...memory.get(k)] : []),
};

function runInMemory(commands) {
  return commands.map(([name, ...args]) => {
    const fn = MEMORY[String(name).toUpperCase()];
    if (!fn) throw new Error('store: command not available in memory: ' + name);
    return fn(...args.map(String));
  });
}

// ---------- Upstash ----------

function prefixed(commands) {
  // Every command here takes its key(s) first; DEL takes several.
  return commands.map(([name, ...args]) => {
    const upper = String(name).toUpperCase();
    if (upper === 'DEL') return [upper, ...args.map(k => PREFIX + k)];
    return [upper, PREFIX + args[0], ...args.slice(1).map(String)];
  });
}

async function runRemote(commands) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(URL_ + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(prefixed(commands)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const rows = await response.json();
    failures = 0;
    return rows.map(row => (row && 'result' in row ? row.result : null));
  } finally {
    clearTimeout(timer);
  }
}

/** The answers to `commands`, or null when the store could not be reached. */
async function run(commands) {
  if (!commands.length) return [];
  if (!remote) return runInMemory(commands);
  try {
    return await runRemote(commands);
  } catch (error) {
    failures++;
    // Said once per run of failures rather than per call.
    if (failures === 1 || failures % 50 === 0) {
      console.error('store: Upstash unreachable (' + (error && error.message) + ') — carrying on without it');
    }
    return null;
  }
}

/** Fire and forget. */
function send(commands) {
  run(commands).catch(() => {});
}

// The key every stored identifier is scrambled with: one-way, and the same
// across servers and deploys so a count kept under it keeps meaning the same
// thing. PSYCHEAI_HASH_SECRET when set; otherwise derived from the Upstash
// token; in memory-only mode, a fresh random one per process.
const SECRET = String(process.env.PSYCHEAI_HASH_SECRET || '').trim() ||
  (TOKEN ? crypto.createHash('sha256').update('psycheai:' + TOKEN).digest('hex') : crypto.randomBytes(32).toString('hex'));

/** A one-way code for `value` under `label` — what is stored in place of it. */
function keyed(label, value) {
  return crypto.createHmac('sha256', SECRET).update(String(label) + ':' + String(value)).digest('hex').slice(0, 32);
}

/** A hash's fields as an object of numbers. */
function numbers(flat) {
  const out = {};
  for (let i = 0; Array.isArray(flat) && i < flat.length; i += 2) out[flat[i]] = intOf(flat[i + 1]);
  return out;
}

module.exports = {
  run, send, numbers, keyed,
  enabled: () => remote,
  describe: () => ({ backend: remote ? 'upstash' : 'memory' }),
  // Tests only.
  _memory: { reset() { memory.clear(); expiries.clear(); } },
  _setRemote(value) { remote = Boolean(value) && Boolean(URL_ && TOKEN); },
};
