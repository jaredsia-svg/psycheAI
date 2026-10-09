// Promo codes: the operator's one master code, and per-creator codes with a
// cap and an end date.
//
//   PSYCHEAI_PROMO_CODE=<random>              one code, no cap (the operator's)
//   PSYCHEAI_PROMO_CODES=AVA:50:2026-12-31,BEN:20,HALF:100:2026-12-31:50
//                                             creator codes: CODE[:cap[:last day[:percent off]]]
//
// Percent off is 100 when left out — the code opens the full report on its
// own, with no payment, as every code did before. Anything from 1 to 99 makes
// it a discount instead: the payment sheet is re-priced to what is left of the
// local price (HALF above: US$2.50, S$3.50, £2), the reader still pays, and the
// code is spent once that payment's report is written. A discount code never
// opens anything by itself. Leave a field empty to skip it: HALF:100::50 has
// no last day.
//
// The master code was the only kind there was, and it could not be handed to
// a creator: whoever it leaked to had unlimited free reports, for as long as
// nobody noticed. A creator code has a cap — the number of different reports
// it can unlock — and optionally a last day (inclusive, UTC), after which it
// is refused. Redemptions are counted per code in lib/stats.js too, which is
// the one way to tell which creator's audience actually used the app.
//
// A cap counts distinct reports, not requests: the same reader retrying the
// same digest (a dropped connection, a reload mid-generation) does not spend
// a second use. Each code remembers SHA-256 hashes of the digests it has
// unlocked, never the digests.
//
// The uses are kept in the store (lib/store.js — Upstash when configured) as
// one set of report hashes per code, read back at boot (hydrate), so a deploy
// no longer hands every capped code a fresh allowance.
'use strict';

const crypto = require('crypto');
const store = require('./store');

let clock = () => new Date();

function parseCodes(raw) {
  const codes = new Map();
  for (const entry of String(raw || '').split(',')) {
    const [code, cap, until, off] = entry.trim().split(':').map(part => (part || '').trim());
    if (!code || !/^[A-Za-z0-9-]{3,32}$/.test(code)) continue;
    const limit = cap ? Number.parseInt(cap, 10) : Infinity;
    if (cap && !(limit > 0)) continue;
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) continue;
    // "50" or "50%". A malformed one drops the code rather than defaulting to
    // 100 — a typo must not turn a discount into a free report.
    const percent = off ? Number(off.replace(/%$/, '')) : 100;
    if (!(Number.isInteger(percent) && percent >= 1 && percent <= 100)) continue;
    codes.set(code.toLowerCase(), { code: code.toUpperCase(), cap: limit, until: until || null, percent, used: new Set() });
  }
  return codes;
}

let master = '';
let creators = new Map();
function configure(env) {
  master = String((env || process.env).PSYCHEAI_PROMO_CODE || '').trim().toLowerCase();
  creators = parseCodes((env || process.env).PSYCHEAI_PROMO_CODES);
}
configure(process.env);

function digestHash(key) {
  return crypto.createHash('sha256').update(JSON.stringify(key == null ? null : key)).digest('hex');
}

/**
 * What a code is. `{ ok: true, code, creator, percent }` for one that may be used now;
 * `{ ok: false, reason }` otherwise, with a reason the reader can be shown.
 * `key` is what the code would unlock (the digest), so a code at its cap
 * still works for a report it already unlocked.
 */
function check(code, key) {
  const typed = typeof code === 'string' ? code.trim().toLowerCase() : '';
  if (!typed) return { ok: false, reason: 'That code is not valid.' };
  if (master && typed === master) return { ok: true, code: 'MASTER', creator: false, percent: 100 };
  const entry = creators.get(typed);
  if (!entry) return { ok: false, reason: 'That code is not valid.' };
  if (entry.until && clock().toISOString().slice(0, 10) > entry.until) {
    return { ok: false, reason: 'That code has expired.' };
  }
  if (entry.used.size >= entry.cap && !entry.used.has(digestHash(key))) {
    return { ok: false, reason: 'That code has been used up.' };
  }
  return { ok: true, code: entry.code, creator: true, percent: entry.percent };
}

/**
 * Spends a use of a creator code on `key`, once a report has actually been
 * written for it. Returns true the first time a given report is counted.
 */
function redeem(code, key) {
  const typed = typeof code === 'string' ? code.trim().toLowerCase() : '';
  const entry = creators.get(typed);
  if (!entry) return false;
  const hash = digestHash(key);
  if (entry.used.has(hash)) return false;
  entry.used.add(hash);
  store.send([['SADD', 'promo:' + entry.code, hash]]);
  return true;
}

/** Each creator code's uses back from the store, at boot. */
async function hydrate() {
  const entries = [...creators.values()];
  const rows = await store.run(entries.map(entry => ['SMEMBERS', 'promo:' + entry.code]));
  if (!rows) return false;
  entries.forEach((entry, i) => { for (const hash of rows[i] || []) entry.used.add(hash); });
  return true;
}

function describe() {
  return [...creators.values()].map(entry => ({
    code: entry.code, used: entry.used.size, cap: Number.isFinite(entry.cap) ? entry.cap : null, until: entry.until,
    percent: entry.percent,
  }));
}

module.exports = {
  check, redeem, describe, configure, hydrate,
  enabled: () => Boolean(master) || creators.size > 0,
  // Tests only.
  _setClock(fn) { clock = fn || (() => new Date()); },
};
