// Promo codes: the operator's one master code, and per-creator codes with a
// cap and an end date.
//
//   PSYCHEAI_PROMO_CODE=<random>              one code, no cap (the operator's)
//   PSYCHEAI_PROMO_CODES=AVA50:50:2026-12-31,BEN:20
//                                             creator codes: CODE[:cap[:last day]]
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
// The counts live in memory, like every other record this server keeps, so a
// restart starts them again. That is the honest limit of a server with no
// database: set caps with it in mind, and an end date bounds it.
'use strict';

const crypto = require('crypto');

let clock = () => new Date();

function parseCodes(raw) {
  const codes = new Map();
  for (const entry of String(raw || '').split(',')) {
    const [code, cap, until] = entry.trim().split(':').map(part => (part || '').trim());
    if (!code || !/^[A-Za-z0-9-]{3,32}$/.test(code)) continue;
    const limit = cap ? Number.parseInt(cap, 10) : Infinity;
    if (cap && !(limit > 0)) continue;
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) continue;
    codes.set(code.toLowerCase(), { code: code.toUpperCase(), cap: limit, until: until || null, used: new Set() });
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
 * What a code is. `{ ok: true, code, creator }` for one that may be used now;
 * `{ ok: false, reason }` otherwise, with a reason the reader can be shown.
 * `key` is what the code would unlock (the digest), so a code at its cap
 * still works for a report it already unlocked.
 */
function check(code, key) {
  const typed = typeof code === 'string' ? code.trim().toLowerCase() : '';
  if (!typed) return { ok: false, reason: 'That code is not valid.' };
  if (master && typed === master) return { ok: true, code: 'MASTER', creator: false };
  const entry = creators.get(typed);
  if (!entry) return { ok: false, reason: 'That code is not valid.' };
  if (entry.until && clock().toISOString().slice(0, 10) > entry.until) {
    return { ok: false, reason: 'That code has expired.' };
  }
  if (entry.used.size >= entry.cap && !entry.used.has(digestHash(key))) {
    return { ok: false, reason: 'That code has been used up.' };
  }
  return { ok: true, code: entry.code, creator: true };
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
  return true;
}

function describe() {
  return [...creators.values()].map(entry => ({
    code: entry.code, used: entry.used.size, cap: Number.isFinite(entry.cap) ? entry.cap : null, until: entry.until,
  }));
}

module.exports = {
  check, redeem, describe, configure,
  enabled: () => Boolean(master) || creators.size > 0,
  // Tests only.
  _setClock(fn) { clock = fn || (() => new Date()); },
};
