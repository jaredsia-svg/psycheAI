// A read written by Muse, through the PsycheAI plugin (app.psycheai.io).
//
// On the Muse path there is no export and no digest: Muse reads the reader's
// Instagram itself, on their behalf, and writes their card and report in the
// merged schema (MERGED_SCHEMA, the same answer the merged unlock asks a
// provider for), following the merged prompt with a preface (GUIDE_PREFACE).
// The plugin sends that answer here. It is held to exactly the checks a
// provider's merged answer is (checkMerged, splitMerged), so a Muse read
// lands on the reader's device in the same shape as any other bundle.
//
// **What the server holds cannot be read by it**, as with the short link
// (lib/links.js): the bundle is sealed with AES-256-GCM under a key made here
// for this read alone, only the sealed copy is stored, and the key goes back
// to the plugin in the link after the #, which browsers never send to a
// server. Kept SEALED_DAYS, so the reader can open it on another device in
// the first week; after that it is gone, and the read lives on their device
// and in their backup like any other.
//
// Only the plugin may send one: it signs each request with the secret the
// two servers share (PSYCHEAI_IMPORT_SECRET). Without the secret set, the
// route is off.
'use strict';

const crypto = require('node:crypto');
const store = require('./store');
const prompts = require('./prompts');
const mbtiScore = require('./mbtiScore');

const SEALED_DAYS = 7;
const MAX_BYTES = 400 * 1024;
const ID = /^[A-Za-z0-9_-]{16}$/;
const NAME_MAX = 60;

const secret = () => String(process.env.PSYCHEAI_IMPORT_SECRET || '');
const enabled = () => secret().length >= 16;

/** The plugin's request carries `Bearer <secret>`; compared in constant time. */
function authorised(header) {
  if (!enabled()) return false;
  const m = /^Bearer (.+)$/.exec(String(header || ''));
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest();
  const b = crypto.createHash('sha256').update(secret()).digest();
  return crypto.timingSafeEqual(a, b);
}

// What Muse is told on top of the merged prompt: where its evidence comes from,
// and the one convention the device relies on (PsycheUser for the reader).
const GUIDE_PREFACE = `# You are writing this read through Muse

You are writing a PsycheAI read for the person you are talking to, as Muse, through the PsycheAI plugin. The rules below were written for an evidence digest built from an Instagram export. You have no digest: you have their Instagram itself, with their permission. Wherever the rules say "the digest", "the evidence" or "the export", read it as what you can see there:
- their posts, stories, highlights, bio and the comments they wrote, across the years you can see, weighted to the last two;
- their own side of their Instagram messages, if they allowed it. Never use, quote or describe what anyone else wrote, and never name another person: say "a close friend", "a sibling".

Counts and dates are what you actually saw, as near as you can tell; never invent a number. Quote only their own words, briefly.

Write \`PsycheUser\` wherever you would write their name or handle, exactly as the rules below expect; their real name is put back on their device. Score confidence for Instagram as the only source (Instagram alone: 65–79), higher only if their own messages were part of what you read.

Answer with one JSON object that follows the schema you are given, and nothing else.`;

// A Sync written by Muse (the plugin's Muse Sync): PsycheAI's own Sync prompt
// and schema, so a Sync in Muse reads like one on psycheai.io. The plugin
// fills in the two card-level profiles and the derived facts, which it works
// out the way prompts.derivedFacts does, and Muse writes the answer in the chat.
const SYNC_PREFACE = `# You are writing this Sync through Muse

You are writing a PsycheAI Sync for the person you are talking to, as Muse, through the PsycheAI plugin. Both people agreed to it. You get each person's card-level profile (no report, no posts) and the derived facts. Person A is the person you are talking to; person B is the other one. Call each by the first name their profile gives.

Write it in the chat, short, in this order: the summary line; "Where you align" and "Where you differ" as two or three one-line points each; then three things the person you are talking to can do (your answer's forA), and two the two of them could do together. Keep the evidence to yourself unless they ask why. The rules below hold in full, the tone above all.`;

/**
 * What the plugin hands Muse. kind 'read' (the default): the preface and the
 * merged prompt, and the schema. kind 'sync': PsycheAI's Sync rules, the brief
 * that opens its user turn, and the schema.
 */
function guide(kind) {
  if (kind === 'sync') {
    const chosen = prompts.briefFor();
    const brief = 'Assess how these two people sync, vibe and relate to each other, **whatever their relationship**.\n\n' + chosen.brief + '\n\n' +
      'What matters most, in this order:\n' + chosen.dimensions.map(d => '  - ' + d).join('\n') + '\n\n' +
      'The fields that decide those most: ' + chosen.lean.join(', ') + '.';
    return { system: SYNC_PREFACE + '\n\n' + prompts.COMPATIBILITY_SYSTEM, brief, schema: prompts.COMPATIBILITY_SCHEMA };
  }
  return { system: GUIDE_PREFACE + '\n\n' + prompts.MERGED_SYSTEM, schema: prompts.MERGED_SCHEMA, sealedDays: SEALED_DAYS };
}

/**
 * Check a merged answer and turn it into the bundle the device adopts
 * ({ data: { ...report, freeCard } }), as mergedOrTwoCalls does for a
 * provider. Resolves to { ok, bundle } or { ok: false, problems }.
 */
function bundleFrom(answer) {
  const checked = prompts.checkMerged(answer);
  if (!checked.ok) return { ok: false, problems: checked.problems.slice(0, 12) };
  const split = prompts.splitMerged(checked.data);
  // The letters on the card from its own ledger, as for a provider's card;
  // there is no digest, so nothing computed is added to it.
  mbtiScore.scoreMbti(split.card, {}, []);
  return { ok: true, dropped: checked.dropped, bundle: { data: Object.assign({}, split.full, { freeCard: split.card }), model: 'Muse' } };
}

/** Seal a bundle under a fresh key. Resolves to { id, key } or null if the store is down. */
async function seal(bundle, name, now = Date.now()) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = JSON.stringify({ v: 1, source: 'muse', name: String(name || '').slice(0, NAME_MAX), at: now, bundle });
  const box = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
  const id = crypto.randomBytes(12).toString('base64url');
  const record = JSON.stringify({ iv: iv.toString('base64url'), box: box.toString('base64url') });
  const rows = await store.run([['SET', 'muse:' + id, record, 'EX', SEALED_DAYS * 86400]]);
  return rows ? { id, key: key.toString('base64url') } : null;
}

/** The sealed copy for an id, or null. */
async function open(id) {
  const key = String(id || '').trim();
  if (!ID.test(key)) return null;
  const rows = await store.run([['GET', 'muse:' + key]]);
  if (!rows || !rows[0]) return null;
  try {
    const record = JSON.parse(rows[0]);
    return typeof record.iv === 'string' && typeof record.box === 'string' ? record : null;
  } catch (error) { return null; }
}

module.exports = { GUIDE_PREFACE, SYNC_PREFACE, SEALED_DAYS, MAX_BYTES, ID, enabled, authorised, guide, bundleFrom, seal, open };
