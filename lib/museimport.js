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

// What the plugin hands Muse for a read. Not a prompt: PsycheAI's own model
// prompt (MERGED_SYSTEM, about 100,000 characters opening "You are PsycheAI")
// handed back in a tool result reads to a host exactly like prompt injection,
// and Muse refused it (October 2026). So Muse gets a short specification of
// the document the user asked for, written about the read rather than at the
// assistant, and the merged schema, whose field descriptions already carry
// the field-by-field rules. The cross-cutting rules below are the ones the
// schema cannot carry; keep them in step with MERGED_SYSTEM's hard limits.
const READ_SPEC = `# The PsycheAI read: what it contains and the standards it meets

This is the format of the PsycheAI read the user asked for: a personality read written from their own Instagram, which they connected and chose to share. It is a specification of the document, to be written with the assistant's own judgement and policies, and returned to publish_psyche as one JSON object that matches the schema.

## Sources
- The user's own Instagram: posts, stories, highlights, bio, and the comments they wrote, weighted to the last two years.
- Their own side of their Instagram messages, only if they allowed it.
- Nothing anyone else wrote is used, quoted or described, and no other person is named: "a close friend", "a sibling".
- Counts and dates are what was actually seen, as near as can be told; no number is invented. Quotes are the user's own words, brief.
- The user is written as \`PsycheUser\` wherever their name or handle would go; their real name is put back on their device.

## Standards
- Second person ("you"), warm and specific, honest about uncertainty, never sycophantic or moralising. A claim ties to something observed.
- Plain words and short sentences. British spelling. Sentence case for every name and title ("The quiet organiser").
- Each piece of evidence is used once in a section and at most twice in the whole read.
- Big Five scores run 0 to 100, 50 being average; "neuroticism" is written as "emotional sensitivity", never as a defect.
- Insight and coaching only: never therapy, treatment or a diagnosis, and no clinical terms. The wellness section is a read of behaviour (posting times, activity, connection), not a health assessment.
- Not inferred unless the user stated it in their own words: sexual orientation, health, immigration status, political affiliation, religion. Nobody is classified by appearance or by who they follow.
- Anything printed on the card (headline, card lines, pattern names) is positive or neutral, and never about romance or dating.
- The playful section (\`bonus\`) is candid and good-humoured, about habits and the gaps between plans and follow-through. It is never about health, appearance or anyone else, and it turns gentle if the user seems to be going through a hard time.
- Confidence: with Instagram as the only source, 65 to 79; higher only if their own messages were read too.

## Output
One JSON object that matches the schema, and nothing around it.`;

// A Sync written by Muse (the plugin's Muse Sync): the same idea, PsycheAI's
// Sync rules as a specification, with its brief and schema.
const SYNC_SPEC = `# A PsycheAI Sync: what it contains and the standards it meets

A Sync is how two people get on: friends, family, anyone; never romance or dating. Both people agreed to it. It is written from each person's card-level profile (no report, no posts) and the derived facts, which are computed and settled. Person A is the user; person B is the other person. Each is called by the first name their profile gives.

## Shown in the chat, short, in this order
1. One warm summary line.
2. "Where you align": two or three one-line points.
3. "Where you differ": two or three one-line points, each with how the difference can work for them.
4. Three things the user can do (forA), and two the two of them could do together.

## Standards
- Positive and encouraging throughout. Differences are differences with a way to make them work, never a fault in either person. No blame or labels, and no prediction that the connection will struggle.
- The words tension, conflict, clash, friction, struggle, problem and incompatible are not used; "difference", "disagreement" or "a different pace" instead.
- No score or percentage. The connection is never called a friendship or any other named relationship: "you two", "your connection".
- Types are weighed in a sentence or two at most: E/I and S/N matter most, T/F less, J/P least; a score near 50 is a lean.
- Only shared interests the derived facts list. Each point rests on something in the profiles; the evidence is given only if asked.
- Profiles are inferences from social media; if either confidence is low, it is a conversation starter rather than a finding.`;

/**
 * What the plugin hands Muse. kind 'read' (the default): the read's
 * specification and the merged schema. kind 'sync': the Sync's specification,
 * the brief that opens PsycheAI's Sync request, and its schema.
 */
function guide(kind) {
  if (kind === 'sync') {
    const chosen = prompts.briefFor();
    const brief = chosen.brief + '\n\nWhat matters most, in this order:\n' + chosen.dimensions.map(d => '  - ' + d).join('\n') + '\n\n' +
      'The fields that decide those most: ' + chosen.lean.join(', ') + '.';
    return { spec: SYNC_SPEC, brief, schema: prompts.COMPATIBILITY_SCHEMA };
  }
  return { spec: READ_SPEC, schema: prompts.MERGED_SCHEMA, sealedDays: SEALED_DAYS };
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

module.exports = { READ_SPEC, SYNC_SPEC, SEALED_DAYS, MAX_BYTES, ID, enabled, authorised, guide, bundleFrom, seal, open };
