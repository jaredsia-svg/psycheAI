// The short personal link: psycheai.io/c/<id>#<key>.
//
// One link per reader that does both things the two long ones did: a friend
// who opens it is offered a compatibility reading against the reader's card,
// and the reader's invite code comes with it (lib/referral.js).
//
// **What the server holds cannot be read by it.** The browser locks the card
// summary (AES-GCM) with a key it makes itself, and sends only the locked
// copy. The key travels in the link after the #, which browsers never send to
// a server, so the copy kept here is opaque bytes to PsycheAI. Beside it: the
// reader's public invite code, which is a random code and names nobody.
//
// **The id is the reader's own.** It is derived from their invite secret
// (`idOf`), so only the browser holding that secret can write it, and the
// same reader always has the same link — a redrawn card replaces what it
// shows, and a link already in someone's bio stays current.
//
// Kept for a year, renewed each time the link is opened.
'use strict';

const crypto = require('node:crypto');
const store = require('./store');
const referral = require('./referral');

const KEEP_SECONDS = 365 * 86400;
const MAX_BLOB = 4096;
const ID = /^[A-Za-z0-9_-]{10}$/;
const BLOB = /^[A-Za-z0-9_-]+$/;

/** The link id a secret owns: 10 base64url characters of SHA-256('psycheai-link:' + secret). */
function idOf(secret) {
  return crypto.createHash('sha256').update('psycheai-link:' + secret).digest('base64url').slice(0, 10);
}

/** Saves the reader's locked card under their id. Resolves to the id, or null. */
async function publish(secret, blob) {
  const s = String(secret || '').trim().toLowerCase();
  const b = String(blob || '').trim();
  if (!/^[0-9a-f]{64}$/.test(s) || !b || b.length > MAX_BLOB || !BLOB.test(b)) return null;
  const id = idOf(s);
  const record = JSON.stringify({ blob: b, ref: referral.codeOf(s), at: Date.now() });
  const rows = await store.run([['SET', 'link:' + id, record, 'EX', KEEP_SECONDS]]);
  return rows ? id : null;
}

/** What a link holds — the locked card and the invite code — or null. Opening it renews it. */
async function open(id) {
  const key = String(id || '').trim();
  if (!ID.test(key)) return null;
  const rows = await store.run([['GET', 'link:' + key], ['EXPIRE', 'link:' + key, KEEP_SECONDS]]);
  if (!rows || !rows[0]) return null;
  try {
    const record = JSON.parse(rows[0]);
    return { blob: String(record.blob || ''), ref: String(record.ref || '') };
  } catch (error) { return null; }
}

module.exports = { idOf, publish, open, ID, MAX_BLOB };
