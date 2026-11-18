// A Psyche Sync, sent back to the person whose link it was.
//
// Whoever syncs with someone's personal link (psycheai.io/c/<id>#<key>) holds
// that link's key, and so does the device that made the link. The finished
// sync is locked in the sender's browser with that key (AES-GCM, the same
// lock as the link's own card, lib/links.js) and left here, under the link
// owner's invite code, for their device to collect. PsycheAI holds only the
// locked copy and cannot read it.
//
// **Only the owner collects.** Reading takes the owner's invite secret, which
// never leaves their device but for requests like this one: the code it
// hashes to is the mailbox. Writing takes the link's id and the code it
// carries, so only someone who was given the link can leave anything.
//
// **Small and short-lived.** At most MAX_WAITING syncs wait per person, each
// up to MAX_BLOB characters, for KEEP_DAYS; each is deleted once the owner's
// device has saved it (collected, then acknowledged).
'use strict';

const crypto = require('node:crypto');
const store = require('./store');
const links = require('./links');
const referral = require('./referral');

const KEEP_DAYS = 30;
const MAX_WAITING = 20;
const MAX_BLOB = 24000;
const BLOB = /^[A-Za-z0-9_-]+$/;
const ITEM = /^[0-9a-f]{16}$/;
const CODE = /^[0-9a-f]{12}$/;

const boxOf = code => 'syncbox:' + code;

/**
 * Leaves a locked sync for the owner of link `id`, whose invite code is
 * `ref`. Resolves to true when it was kept, or to the reason it was not.
 */
async function leave(id, ref, blob) {
  const code = String(ref || '').trim().toLowerCase();
  const b = String(blob || '').trim();
  if (!links.ID.test(String(id || '')) || !CODE.test(code)) return 'That link could not be found.';
  if (!b || b.length > MAX_BLOB || !BLOB.test(b)) return 'That sync could not be sent.';
  // The link has to exist and be this owner's: whoever leaves a sync was given it.
  const found = await links.open(id);
  if (!found || found.ref !== code) return 'That link could not be found.';
  const box = boxOf(code);
  const rows = await store.run([['HLEN', box]]);
  if (!rows) return 'Syncs cannot be sent right now.';
  if (Number(rows[0]) >= MAX_WAITING) return 'Too many syncs are waiting for this person.';
  const item = crypto.randomBytes(8).toString('hex');
  const saved = await store.run([['HSET', box, item, JSON.stringify({ blob: b, at: Date.now() })],
    ['EXPIRE', box, KEEP_DAYS * 86400]]);
  return saved ? true : 'Syncs cannot be sent right now.';
}

/** The syncs waiting for the owner of `secret`, oldest first, or null. */
async function collect(secret) {
  const code = ownerCode(secret);
  if (!code) return null;
  const rows = await store.run([['HGETALL', boxOf(code)]]);
  if (!rows) return null;
  const flat = Array.isArray(rows[0]) ? rows[0] : [];
  const items = [];
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const record = JSON.parse(flat[i + 1]);
      if (ITEM.test(flat[i]) && record && typeof record.blob === 'string' && Number(record.at) > cutoff) {
        items.push({ id: flat[i], blob: record.blob, at: Number(record.at) });
      }
    } catch (error) { /* a damaged entry is skipped */ }
  }
  return items.sort((a, b) => a.at - b.at);
}

/** Deletes the syncs the owner's device has saved. Resolves to how many went. */
async function acknowledge(secret, ids) {
  const code = ownerCode(secret);
  const done = (Array.isArray(ids) ? ids : []).map(String).filter(id => ITEM.test(id)).slice(0, MAX_WAITING);
  if (!code || !done.length) return 0;
  const rows = await store.run([['HDEL', boxOf(code), ...done]]);
  return rows ? Number(rows[0]) || 0 : 0;
}

function ownerCode(secret) {
  const s = String(secret || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? referral.codeOf(s) : '';
}

module.exports = { leave, collect, acknowledge, KEEP_DAYS, MAX_WAITING, MAX_BLOB };
