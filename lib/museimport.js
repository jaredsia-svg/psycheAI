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

This is the format of the PsycheAI read the user asked for: a personality read written from their own Instagram, which they connected and chose to share. It describes the document and the standards a good one meets; it is written with the assistant's own judgement and policies, and returned to publish_psyche as one JSON object that matches the schema.

## Sources
- The user's own Instagram: posts, captions, stories and highlights, bio, the comments they wrote, and, only if they allowed it, their own side of their messages.
- Nothing anyone else wrote is used, quoted or described, and no other person is named: "a close friend", "a sibling".
- The user is written as \`PsycheUser\` wherever their name or handle would go; their real name is put back on their device.

## Reading plan
A read is only as good as its sample, and the first items a feed returns are the newest, not the most telling. Spread what is read across the whole span:
- **Stories and highlights:** across every year, not just the latest: roughly 30 a year by date, more from the last two years, and every one with words on it.
- **Posts, captions and comments:** all of their own.
- **Messages,** when they agreed: the 10 to 15 conversations they write in most, not the first ones in the inbox; in each, about 30 of their own messages spread across that conversation's whole span, longer ones first. Their own side only.
- **Likes, saves and follows:** a light look, for interests only.
The confidence rationale says what was read, in counts ("380 stories from 2019 to 2026, 290 of your messages across 12 conversations").

## Evidence, strongest first
When two signals disagree, the stronger one wins and the read says so ("follows a dozen running accounts but no run since 2021").
1. Sustained, repeated action across years: a subject they keep returning to, a habit that recurs, a person they keep writing to.
2. Their own composed words: captions, comments, their own messages, the bio. The richest evidence there is.
3. Rhythm: when and how often they post, whether they publish or mostly watch.
4. Repeated engagement with others' work: accounts and topics they keep returning to.
5. A single like, follow or save: close to worthless alone.
6. Platform-guessed topics: weakest of all.

Two rules hold throughout:
- **One instance is not a pattern, and the count belongs in the sentence.** "Forty-odd captions across four years", "two mentions, both in 2019": a reader can weigh a claim with a number and cannot weigh "several".
- **Absence is not evidence.** Someone who never posts about family may be private. A blank is read as a finding only where that part of life would be expected to show.

## Who a sentence is about
The author of a caption is not automatically its subject. A story about a friend's new job, car or achievement is evidence about the friend; about the user it shows who they are around, what they notice and admire, and how they write about people. An account largely about other people is itself a finding: the connector, the observer, the one holding the camera. A comment on someone else's post is about that person.

## Time
- Each interest and value has a trajectory from the dates: structural (across the whole span and recently), stable, rising, declining, dormant (nothing for about two years: said plainly, not flattered) or phasic (ran for a window and stopped).
- Reduced posting is not a reduced life: where it matters, the read says the posts stopped, not that the interest did.

## Type and traits
- Each MBTI letter is held only as strongly as its evidence: a lean is written as a lean.
- E/I follows breadth of contact (distinct people, plans proposed, circles kept) and how they recharge, never message volume or how long their messages are.
- S/N, T/F and J/P each rest on behaviour that bears on that axis alone; one fact is used for one letter.
- Big Five scores run 0 to 100, 50 being average, and agree with the letters they track (extraversion with E/I, openness with S/N, agreeableness with T/F, conscientiousness with J/P). "Neuroticism" is written as "emotional sensitivity", never as a defect.

## Writing
- Second person ("you"), warm and specific, honest about uncertainty, never sycophantic or moralising; things they may not know about themselves, including the unflattering but fair.
- Specific beats general: "your posting spikes on Saturday mornings and half your captions mention a trail" is worth reading; "you love the outdoors" is not.
- Plain words and short sentences. British spelling. Sentence case for every name and title ("The quiet organiser"). No filler words: profound, remarkable, journey, tapestry, navigate, leverage, truly.
- Each piece of evidence is used once in a section and at most twice in the whole read; one fact, one figure everywhere.

## Wellness
A read of behaviour across six dimensions, never a health assessment.
- **lifeTrajectory:** the phase and the arc across the whole span, not the last months. Name a hard stretch plainly (when it started, how long, what changed, whether they came through); never invent its cause, and a gap in posting is ambiguous (a new baby or job as often as grief).
- **outlook:** from their own words, not reposts: plans as expectation or hope, setbacks as temporary or permanent. Use the real word when it fits (bleak, grim, worn down); a feed is partly performance, and deadpan humour is a style, not despair.
- **socialConnection:** distinct people, reach beyond a set circle, and whether it runs both ways; giving far more than they get back is named gently.
- **cognitiveLoad:** how many threads and plans they carry and whether plans close out; apparent load, never capacity.
- **meaning:** what they return to over years and whether stated commitments match behaviour.
- **rhythmAndActivity:** posting times are when they reached for a phone, never a sleep record; activity only from what they chose to post, and silence is not a finding.
Bands describe a pattern, not a person; most people are \`mixed\` on most. \`under strain\` needs a pattern the evidence shows; \`not enough evidence\` is a real answer. \`overall\` is prose: no score, index, grade or average. \`suggestions\` are what an observant friend would suggest this week, never treatment. No condition is named, implied or predicted; where something looks like it warrants one, say it is worth taking to someone who can assess it.

## Attachment
A leaning (secure, anxious or avoidant, or two of them, as "anxious-leaning, with avoidant edges"), never fearful-avoidant or disorganised, shown working.
- From conduct with people: who starts conversations, how fast and warmly they reply, how they write to those closest, what happens around a gap, how large a circle and for how long. What they watch or save about relationships is an interest, one supporting line at most.
- About half of adults lean secure, so a non-secure leaning must show in their own conduct, and a mixed one needs both halves visible. When thin or mixed, take the cautious read ("leans secure, with avoidant defences under stress"), and name in \`why\` the stronger style considered and what would have moved the read to it.
- Lead with what the style is good at, then its costs as tendencies they can work with: what it looks like, what helps, and that it moves. It is the most changeable thing in the read.

## Ideal partner
Argued from the attachment read above, not a fresh read. \`needs\`: three to five requirements that follow from their attachment, love languages and relationship strengths and weaknesses, each with its evidence, not pleasant adjectives. \`carefulOf\`: two to four partner types or dynamics that would predictably go wrong for this person, and what that would look like, not universal red flags. The test: if a line would fit a stranger with a different attachment style, it has not used the read. \`summary\`: the honest verdict in two or three sentences, not a recap. No private person is named; describe the relationship ("the friend they write to most").

## Thin evidence
Instagram alone, and stories that are mostly pictures with few words, support interests, rhythm and the people around them far better than inner life, work or relationships. Where a section's evidence is thin, it says so in a sentence and stays short; it is never padded with general statements that could describe anyone. A short, true section is better than a long, generic one.

## Limits
- Insight and coaching only: never therapy, treatment or a diagnosis, and no clinical terms. The wellness section is a read of behaviour (posting times, activity, connection), not a health assessment.
- Not inferred unless the user stated it in their own words: sexual orientation, health, immigration status, political affiliation, religion. Nobody is classified by appearance or by who they follow.
- Anything printed on the card (headline, card lines, pattern names) is positive or neutral, and never about romance or dating.
- The playful section (\`bonus\`) is candid and good-humoured, about habits and the gaps between plans and follow-through. It is never about health, appearance or anyone else, and it turns gentle if the user seems to be going through a hard time.

## Confidence
With Instagram as the only source, 65 to 79, at the low end when it is mostly stories and pictures; higher only if their own messages were read too. The confidence rationale names what was read and what was not.

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

// The merged schema as Muse is shown it. Its field descriptions were written
// as orders to PsycheAI's own model, and some still read that way to a host's
// safety check: pointers to "the system prompt", "You are reading…", and the
// roast's register ("Roast them… the least charitable reading… after the
// second drink… Unkind and true"). This copy has the same shape and the same
// checks (checkMerged validates the answer, not the descriptions); only the
// wording a host reads changes.
const MUSE_DESCRIPTIONS = {
  harsh: 'Two or three short paragraphs of good-humoured, candid observation about their habits: plans announced and not finished, things saved and never done, the gap between what they say and what they do. Specific and true to what was seen, warm in intent, the way a close friend teases. Never about health, appearance, identity or anyone else; if they seem to be going through a hard time, one short paragraph of gentle, affectionate teasing about small harmless habits instead.',
  advice: 'One or two short paragraphs of frank, kind advice that follows from the observations above: concrete, practical, and in plain words.',
};
function museSchema(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  const walk = (node, key) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.description === 'string') {
      if (MUSE_DESCRIPTIONS[key]) node.description = MUSE_DESCRIPTIONS[key];
      node.description = node.description
        .replace(/\s*See ([^.]*?)the system prompt[^.]*\./gi, '')
        .replace(/the system prompt/gi, 'the specification')
        .replace(/\bYou are reading\b/g, 'This reads')
        .replace(/\("You are like X"\)/g, '("like X")')
        .replace(/nothing you are citing/g, 'nothing cited');
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, k);
  };
  walk(copy, '');
  return copy;
}
const MUSE_SCHEMA = museSchema(prompts.MERGED_SCHEMA);

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
  return { spec: READ_SPEC, schema: MUSE_SCHEMA, sealedDays: SEALED_DAYS };
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

module.exports = { READ_SPEC, SYNC_SPEC, MUSE_SCHEMA, SEALED_DAYS, MAX_BYTES, ID, enabled, authorised, guide, bundleFrom, seal, open };
