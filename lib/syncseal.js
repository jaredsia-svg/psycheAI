'use strict';
// The seal on a Psyche Sync: proof that its words are the ones this server's
// model wrote (October 2026).
//
// A sync sent back to a link's owner travels locked with that link's key, so
// the server never reads it, and until now the owner's device took the result
// on trust: anyone holding the link could leave a "sync" saying whatever they
// liked, shown as if PsycheAI had written it. Now every sync result leaves
// /api/compatibility carrying `seal`, a keyed hash of the rest of it, before
// the names go in (it says "Person A" and "Person B"). The sender's device
// keeps that sealed result and sends it on; the owner's device asks
// /api/sync/check whether the seal holds, and only then fills in the names
// and shows it.
//
// The key is the store's (lib/store.js keyed: PSYCHEAI_HASH_SECRET, or one
// derived from the Upstash token), so seals hold across deploys for as long
// as that does. What it does not prove: who ran the sync. A real result from
// one sync can be sent dressed as another's; its words are still the model's.

const crypto = require('node:crypto');
const store = require('./store');

function bodyOf(data) {
  const rest = Object.assign({}, data);
  delete rest.seal;
  return JSON.stringify(rest);
}

/** `data` with its seal added. */
function seal(data) {
  return Object.assign({}, data, { seal: store.keyed('sync-seal', bodyOf(data)) });
}

/** Whether `data` carries a seal this server made for exactly these words. */
function check(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.seal !== 'string') return false;
  const want = Buffer.from(store.keyed('sync-seal', bodyOf(data)));
  const got = Buffer.from(data.seal);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { seal, check };
