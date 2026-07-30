// Unit pass over everything except the model call itself.
//
// Builds a synthetic Instagram export as a real ZIP, then runs
// unzip → parse → digest → (mock) analysis → card → QR payload → decode,
// and validates the prompt schemas against the structured-output rules.
// The live model call is covered by tools/livetest.mjs, which needs a key.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

import { buildExportZip } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const docs = join(root, 'docs');

let passed = 0;
const failures = [];
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failures.push(label + (detail === undefined ? '' : ' — ' + detail));
};

// ---------- load the browser modules ----------

for (const file of ['zip.js', 'instagram.js', 'images.js', 'digest.js', 'card.js']) {
  runInThisContext(readFileSync(join(docs, file), 'utf8'), { filename: file });
}

const IG = globalThis.PsycheInstagram;
const Images = globalThis.PsycheImages;
const Digest = globalThis.PsycheDigest;
const Card = globalThis.PsycheCard;

const prompts = await import('../lib/prompts.js').then(m => m.default);
const mock = await import('../lib/mock.js').then(m => m.default);
const claude = await import('../lib/claude.js').then(m => m.default);
const gemini = await import('../lib/gemini.js').then(m => m.default);

// ---------- provider parity ----------
//
// Both providers share the prompts and schemas and must be interchangeable
// from the server's point of view, so assert the interface rather than
// trusting it.

for (const engine of [claude, gemini, mock]) {
  const missing = ['name', 'analyseProfile', 'analyseCompatibility', 'describeError', 'hasKey', 'MODEL']
    .filter(key => !(key in engine));
  check(engine.name + ' implements the provider interface', missing.length === 0, 'missing ' + missing);
  check(engine.name + ' names a model', typeof engine.MODEL === 'string' && engine.MODEL.length > 0);
}

check('providers are distinguishable', new Set([claude.name, gemini.name, mock.name]).size === 3);
check('gemini can list models for discovery', typeof gemini.listModels === 'function');

// Provider selection is env-driven, so exercise the branches rather than
// documenting them and hoping.
async function selectionFor(env) {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require("' + join(root, 'lib', 'provider.js') + '").describe()))'],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

const selections = {
  gemini: await selectionFor({ GEMINI_API_KEY: 'x' }),
  anthropic: await selectionFor({ ANTHROPIC_API_KEY: 'x' }),
  both: await selectionFor({ GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x' }),
  forced: await selectionFor({ GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', PSYCHEAI_PROVIDER: 'anthropic' }),
  mock: await selectionFor({ PSYCHEAI_MOCK: '1' }),
  none: await selectionFor({}),
  customModel: await selectionFor({ GEMINI_API_KEY: 'x', GEMINI_MODEL: 'gemini-3.1-pro-preview' }),
};

check('a Gemini key selects Gemini', selections.gemini.provider === 'gemini' && selections.gemini.ready);
check('an Anthropic key selects Anthropic', selections.anthropic.provider === 'anthropic' && selections.anthropic.ready);
check('Gemini wins when both keys are present', selections.both.provider === 'gemini');
check('PSYCHEAI_PROVIDER overrides the key order', selections.forced.provider === 'anthropic');
check('mock mode wins over everything', selections.mock.mock === true);
check('no key reports not-ready with a hint',
  selections.none.ready === false && /GEMINI_API_KEY/.test(selections.none.hint), selections.none.hint);
check('GEMINI_MODEL overrides the default model',
  selections.customModel.model === 'gemini-3.1-pro-preview', selections.customModel.model);

// ---------- schema validation ----------
//
// Structured outputs reject schemas that omit `additionalProperties: false`,
// omit a property from `required`, or use unsupported constraints. Getting
// this wrong is a 400 at request time, so check it here instead.

const UNSUPPORTED = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'];

function walkSchema(node, path, report) {
  if (!node || typeof node !== 'object') return;
  for (const key of UNSUPPORTED) {
    if (key in node) report.push(path + ' uses unsupported constraint "' + key + '"');
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) report.push(path + ' is missing additionalProperties:false');
    const properties = Object.keys(node.properties || {});
    const required = node.required || [];
    for (const property of properties) {
      if (!required.includes(property)) report.push(path + '.' + property + ' is not in required');
      walkSchema(node.properties[property], path + '.' + property, report);
    }
    for (const name of required) {
      if (!properties.includes(name)) report.push(path + ' requires "' + name + '" which it does not define');
    }
  }
  if (node.type === 'array') walkSchema(node.items, path + '[]', report);
}

// Gemini's responseJsonSchema takes real JSON Schema but honours only a
// documented subset of keywords; anything outside it is silently ignored,
// which is worse than an error. Keep both providers inside the intersection.
const GEMINI_SUPPORTED = new Set(['$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title',
  'description', 'enum', 'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum',
  'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required', 'propertyOrdering']);

function walkKeywords(node, path, report) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const key of Object.keys(node)) {
    if (!GEMINI_SUPPORTED.has(key)) report.push(path + ' uses "' + key + '"');
  }
  for (const key of Object.keys(node.properties || {})) walkKeywords(node.properties[key], path + '.' + key, report);
  if (node.items) walkKeywords(node.items, path + '[]', report);
}

for (const [name, schema] of [['PROFILE_SCHEMA', prompts.PROFILE_SCHEMA], ['COMPATIBILITY_SCHEMA', prompts.COMPATIBILITY_SCHEMA]]) {
  const report = [];
  walkSchema(schema, name, report);
  check(name + ' obeys the structured-output rules', report.length === 0, report.slice(0, 4).join('; '));

  const keywords = [];
  walkKeywords(schema, name, keywords);
  check(name + ' stays inside the keywords Gemini supports', keywords.length === 0, keywords.slice(0, 4).join('; '));
}

check('profile schema covers everything the brief asked for',
  ['bigFive', 'mbti', 'interests', 'beliefs', 'values', 'relationship', 'career', 'activity',
    'essence', 'card'].every(key => key in prompts.PROFILE_SCHEMA.properties));

// The one-line headline was removed from the profile page, and the noun now
// does that job — so it must not linger in the schema costing output tokens.
check('the profile asks for no unused headline', !('headline' in prompts.PROFILE_SCHEMA.properties));
check('the shareable card still has its own headline', 'headline' in prompts.CARD_SCHEMA.properties);

// "Who you are" has to stand alone for someone who reads no further.
check('the opening summary carries the findings from below',
  /land the findings from every section below/.test(prompts.PROFILE_SCHEMA.properties.summary.description));
check('the opening summary names the type and traits outright',
  /Name the type and the traits explicitly/.test(prompts.PROFILE_SCHEMA.properties.summary.description));
check('the opening summary may not contradict the sections',
  /do not contradict any section below/.test(prompts.PROFILE_SCHEMA.properties.summary.description));

const essenceProps = prompts.PROFILE_SCHEMA.properties.essence.properties;
check('the profile opens on a character, its franchise, an icon and a reason',
  ['character', 'franchise', 'icon', 'why'].every(k => k in essenceProps));
check('the character must be one the whole world would recognise',
  /globally famous/.test(essenceProps.character.description) &&
  /recognise/.test(essenceProps.character.description));
check('the character is matched on temperament, never on looks',
  /never on how anyone looks/.test(essenceProps.character.description));
check('the character may not be a flattering pick',
  /not a compliment/.test(essenceProps.character.description));
check('the icon is asked for as a single emoji standing for the character',
  /Exactly one emoji character/.test(essenceProps.icon.description));

// Love languages replaced "how to love you" and "who fits".
const relProps = prompts.PROFILE_SCHEMA.properties.relationship.properties;
check('the relationship section asks for love languages',
  'loveLanguages' in relProps);
check('the sections love languages replaced are gone',
  !('howToLoveThem' in relProps) && !('idealPartner' in relProps));

const loveProps = relProps.loveLanguages.properties;
check('love languages are split into giving and receiving',
  ['receiving', 'giving', 'caveat'].every(k => k in loveProps));
check('love languages ask for no commentary the report does not show',
  !('mismatch' in loveProps));
check('each side can carry more than one language',
  loveProps.receiving.type === 'array' && loveProps.giving.type === 'array');
check('languages are constrained to the canonical five',
  prompts.LOVE_LANGUAGES.length === 5 &&
  loveProps.receiving.items.properties.language.enum.length === 5 &&
  loveProps.giving.items.properties.language.enum === loveProps.receiving.items.properties.language.enum);
check('each language is ranked and evidenced',
  ['language', 'strength', 'why', 'inPractice']
    .every(k => k in loveProps.receiving.items.properties));
check('a language can be marked minor rather than invented',
  loveProps.receiving.items.properties.strength.enum.includes('minor'));

const attachProps = prompts.PROFILE_SCHEMA.properties.relationship.properties.attachment.properties;
check('attachment shows its working',
  ['style', 'why', 'derivedFrom', 'implications', 'caveat'].every(k => k in attachProps));
check('attachment names the signals it rests on',
  /Name the actual numbers or patterns/.test(attachProps.derivedFrom.description));
check('attachment spells out what it means for a partner',
  /what a partner will feel/.test(attachProps.implications.description));

const mbtiProps = prompts.PROFILE_SCHEMA.properties.mbti.properties;
check('MBTI names the type and works through the axes',
  ['type', 'nickname', 'letters', 'caveat'].every(k => k in mbtiProps));
// Every prose section around the axes has been dropped from the UI over
// time. None may stay in the schema burning output budget on text nobody
// renders — the per-axis writing carries the section now.
check('MBTI asks for nothing the report does not show',
  ['portrait', 'atYourBest', 'underStress', 'misreadAs', 'growthEdges', 'keyTakeaways']
    .every(k => !(k in mbtiProps)));
check('each MBTI letter carries strength and a practical reading',
  ['axis', 'choice', 'strength', 'why', 'inPractice'].every(k => k in mbtiProps.letters.items.properties));
check('a letter can be marked as a slight lean',
  mbtiProps.letters.items.properties.strength.enum.includes('slight'));

const enneagramProps = prompts.PROFILE_SCHEMA.properties.enneagram.properties;
check('Enneagram names a type, its wing and nickname',
  ['type', 'wing', 'nickname', 'confidence', 'why', 'caveat'].every(k => k in enneagramProps));
check('Enneagram type is one of the nine, or an honest Uncertain',
  prompts.PROFILE_SCHEMA.properties.enneagram.properties.type.enum
    .every(t => /^[1-9]$/.test(t) || t === 'Uncertain') &&
  prompts.PROFILE_SCHEMA.properties.enneagram.properties.type.enum.length === 10);
check('Enneagram stays short: no per-facet breakdown the way MBTI has one',
  !('letters' in enneagramProps) && !('facets' in enneagramProps));
check('Enneagram is asked to name the fear and desire the type centres on',
  /core fear and desire/.test(enneagramProps.why.description));
check('Enneagram caveat distinguishes it from MBTI rather than just hedging',
  /different lens from MBTI/.test(enneagramProps.caveat.description));
check('Enneagram\'s explanation is asked for at five or six sentences, not two or three',
  /Five or six sentences, not two or three/.test(enneagramProps.why.description));
check('Enneagram is asked to explain the type in plain language, not just cite it',
  /as if the reader has never heard of it/.test(enneagramProps.why.description));
check('Enneagram is asked to explain what the wing specifically adds, not just name it',
  /what the wing specifically adds or shifts/.test(enneagramProps.why.description));

const activityProps = prompts.PROFILE_SCHEMA.properties.activity.properties;
check('activity section covers behaviour, not just counts',
  ['summary', 'posting', 'rhythm', 'trajectory', 'engagement', 'blindSpots']
    .every(k => k in activityProps));
// Dropped from the profile page, so must not linger in the schema costing
// output tokens — the same discipline as the headline check above.
check('activity no longer asks for attention or implications',
  !('attention' in activityProps) && !('implications' in activityProps));
check('activity states what it cannot see', 'blindSpots' in activityProps);
check('relationship section has strengths and weaknesses',
  ['strengths', 'weaknesses'].every(k => k in prompts.PROFILE_SCHEMA.properties.relationship.properties));
check('career section has strengths and weaknesses',
  ['strengths', 'weaknesses'].every(k => k in prompts.PROFILE_SCHEMA.properties.career.properties));
// The basis is chosen by the user before the call, so the report answers one
// question rather than covering three at once.
check('compatibility offers three bases',
  ['romantic', 'platonic', 'professional'].every(k => k in prompts.COMPATIBILITY_MODES));
check('compatibility scores one basis, not several',
  ['mode', 'score', 'band', 'verdict'].every(k => k in prompts.COMPATIBILITY_SCHEMA.properties) &&
  !('romantic' in prompts.COMPATIBILITY_SCHEMA.properties) &&
  !('platonic' in prompts.COMPATIBILITY_SCHEMA.properties));
check('the answer echoes back which basis it used',
  prompts.COMPATIBILITY_SCHEMA.properties.mode.enum.join() === 'romantic,platonic,professional');
check('the report carries directional advice',
  ['forA', 'forB', 'together'].every(k =>
    k in prompts.COMPATIBILITY_SCHEMA.properties.howToPartner.properties));
check('an unknown basis falls back rather than throwing',
  prompts.resolveMode('nonsense') === 'romantic' && prompts.resolveMode('PROFESSIONAL') === 'professional');
check('each basis is briefed differently',
  new Set(Object.values(prompts.COMPATIBILITY_MODES).map(m => m.brief)).size === 3);
check('the chosen basis reaches the model',
  /\*\*Professional \/ work\*\* basis, and on that basis only/.test(
    prompts.compatibilityBlocks({}, {}, 'professional')[0].text));
check('MBTI is constrained to real types', prompts.MBTI_TYPES.length === 17 && prompts.MBTI_TYPES.includes('Uncertain'));

// The prompt is the actual product here, so assert the guardrails survive edits.
for (const [label, needle] of [
  ['tells the model not to identify other people', /Do not identify or speculate about specific other people/],
  ['blocks protected-attribute inference', /sexual orientation, health conditions/],
  ['blocks appearance-based classification', /classify anyone by appearance/],
  ['tells the model to weigh the sources', /Their own words/],
  ['warns about base rates', /Most people are near the middle/],
  // The images are the newest and sharpest way this could go wrong, so every
  // limit on them is pinned individually rather than as one loose match.
  ['says images may be attached', /you are also given up to twenty of their own photographs/i],
  ['protects other people in the photos', /do not describe, count, identify or infer anything whatsoever about them/i],
  ['blocks appearance inference from photos', /race, ethnicity, body, attractiveness, age, gender, wealth or health/i],
  ['blocks locating someone from a photo', /Do not read a location precisely enough/],
  ['blocks quoting text out of a photo', /Never quote text you can see inside a photograph/],
  ['says what may be taken from an image', /the setting, the activity, the company kept/],
  ['keeps images as weak evidence', /weakest evidence per item/],
  ['demands the per-axis writing be personal', /pasted into a stranger's profile/],
  ['wants one of the four axes to land uncomfortably', /let at least one of the four sting slightly/],
  ['forbids smuggling a summary into the last axis', /do not write one into the last axis instead/],
  ['separates giving from receiving love', /give them separately for receiving and for giving/],
  ['hedges the receiving side harder', /which is thinner evidence, so hedge it harder/],
  ['warns that touch is invisible in this data', /Physical touch is close to invisible in this data/],
  ['lets a close MBTI axis stay hedged', /a hedged letter is more useful than a confident wrong one/],
  ['asks Enneagram not to rephrase MBTI', /a short second lens beside MBTI, not a rephrasing of it/],
  ['lets an Enneagram wing stay blank', /left blank rather than forced/],
  ['asks Enneagram for five or six sentences of real explanation',
    /five or six sentences, because the reader should finish understanding the number and the wing/],
  ['flags disagreement between Enneagram and MBTI rather than hiding it',
    /if the Enneagram read and the MBTI read seem to pull in different directions/],
  ['asks for behaviour, not statistics', /read the account as behaviour, not statistics/],
  ['keeps observation and inference distinguishable', /the reader should be able to tell which is which/],
  ['does not moralise about screen time', /not to moralise about screen time/],
  ['wants a globally recognisable character', /a stranger in another country would picture them instantly/],
  ['rejects a compliment dressed as a character', /a compliment in a costume/],
  ['rejects a character only a fandom would know', /nobody outside a fandom could name/],
  ['forbids matching a character on appearance', /never on how they or anyone else looks/],
  ['refuses a bare attachment label', /A named style with no reasoning is worthless/],
]) {
  check('profile prompt ' + label, needle.test(prompts.PROFILE_SYSTEM));
}
for (const [label, needle] of [
  ['answers only the basis it was given', /Assess \*\*only\*\* that basis/],
  ['refuses to hedge across all three', /do not hedge by covering all three/],
  ['briefs the professional basis distinctly', /reliability, candour and dividing work well/],
  ['tells the model not to inflate', /Do not inflate/],
  ['respects the confidence figure', /respect it/],
]) {
  check('compatibility prompt ' + label, needle.test(prompts.COMPATIBILITY_SYSTEM));
}

// ---------- parse the synthetic export ----------

const file = new File([buildExportZip()], 'instagram-export.zip', { type: 'application/zip' });
const signals = await IG.readExports([file], { includeMessages: false });

check('reads posts', signals.counts.posts === 12, 'got ' + signals.counts.posts);
check('reads stories', signals.counts.stories === 30);
check('reads likes', signals.counts.likes === 240);
check('reads comments', signals.counts.comments === 40);
check('reads following', signals.following.length === 180);
check('reads followers', signals.counts.followers === 320);
check('reads curated topics', signals.topics.length === 6);
check('repairs mojibake in names', signals.profile.name === 'Aleç', JSON.stringify(signals.profile.name));
check('ignores non-JSON media', !signals.files.byRoute.media);

// ---------- image selection ----------
//
// Only selection is covered here. Decoding and downscaling need canvas and
// createImageBitmap, so the extraction half is exercised by the Chromium
// suite against these same files.

check('opting out of images indexes nothing', signals.mediaIndex.total === 0);
check('opting out of images selects nothing', Images.select(signals).length === 0);

const withImages = await IG.readExports(
  [new File([buildExportZip()], 'instagram-export.zip', { type: 'application/zip' })],
  { includeMessages: false, includeImages: true });

check('finds the stills referenced by the JSON', withImages.mediaRefs.length === 42,
  'got ' + withImages.mediaRefs.length);
check('indexes the image files in the archive', withImages.mediaIndex.total === 24,
  'got ' + withImages.mediaIndex.total);
check('resolves a media uri to its archive entry',
  Boolean(IG.findMedia(withImages.mediaIndex, 'media/posts/3.png')));
check('resolves a uri nested under an export folder',
  Boolean(IG.findMedia(withImages.mediaIndex, 'instagram-alec-2025/media/posts/3.png')));
check('does not invent a match for a missing file',
  IG.findMedia(withImages.mediaIndex, 'media/posts/999.png') === null);

const picked = Images.select(withImages);

check('selects at least ten images', picked.length >= 10, 'got ' + picked.length);
check('never exceeds the hard ceiling', picked.length <= Images.LIMITS.max);
check('drops stills whose file is not in the archive',
  picked.every(p => IG.findMedia(withImages.mediaIndex, p.path)));
check('drops files below the size floor',
  picked.every(p => p.bytes >= Images.LIMITS.minBytes) &&
  !picked.some(p => /thumb/.test(p.path)));
check('never sends a video', picked.every(p => !/\.(mp4|mov|webm)$/i.test(p.path)));
check('returns them oldest first',
  picked.every((p, i) => i === 0 || picked[i - 1].ts <= p.ts));
// Scoring alone would cluster the picks in whichever era has the biggest
// files, so check the result actually reaches across everything available.
const datedRefs = withImages.mediaRefs
  .filter(r => r.ts > 0 && IG.findMedia(withImages.mediaIndex, r.path))
  .map(r => r.ts);
const availableSpan = Math.max(...datedRefs) - Math.min(...datedRefs);
const pickedSpan = picked[picked.length - 1].ts - picked[0].ts;
check('spans the whole account history rather than one era',
  pickedSpan >= availableSpan * 0.8,
  Math.round(pickedSpan / 86400) + ' of ' + Math.round(availableSpan / 86400) + ' days');
check('takes no two images from the same day',
  new Set(picked.map(p => Math.floor(p.ts / 86400))).size === picked.length);
check('prefers posts over stories',
  picked.filter(p => p.kind === 'post').length > picked.filter(p => p.kind === 'story').length,
  JSON.stringify(picked.map(p => p.kind)));
check('favours the wordless posts the text misses',
  picked.some(p => p.captionLen === 0));
check('a lower count is honoured', Images.select(withImages, { count: 4 }).length === 4);
check('a count of zero sends nothing', Images.select(withImages, { count: 0 }).length === 0);
check('a count above the ceiling is clamped',
  Images.select(withImages, { count: 500 }).length <= Images.LIMITS.max);

// ---------- digest ----------

const digest = Digest.build(signals, { includeMessages: false });

check('digest declares its schema', digest.schema === 'psycheai-digest/1');
// The app no longer asks for a name, so the export's own must come through —
// mojibake repaired, since that is the name the other person will read.
check('digest takes the name from the export', digest.profile.name === 'Aleç', digest.profile.name);
check('digest carries complete counts', digest.counts.posts === 12 && digest.counts.postsLiked === 240);
check('digest samples captions', digest.samples.captions.length > 0 && digest.samples.captions.length <= Digest.LIMITS.captions);
check('digest samples comments', digest.samples.comments.length > 0);
check('digest carries the hour histogram', digest.rhythm.hourOfDay.length === 24);
check('digest carries the weekday histogram', digest.rhythm.dayOfWeek.length === 7);
check('digest explains its histogram indexing', /0=Sunday/.test(digest.rhythm.note));
check('digest measures posting regularity', typeof digest.rhythm.regularity === 'number');
check('digest samples follows across the whole list',
  digest.following.length === Digest.LIMITS.following || digest.following.length === signals.following.length);
check('digest passes through Instagram\'s own topics', digest.instagramTopics.includes('Running'));
check('digest ranks most-liked accounts', digest.mostLikedAccounts.length > 0 && digest.mostLikedAccounts[0].count > 0);
check('digest flags that its text is sampled', /text samples below are/.test(digest.coverage.samplingNote));
check('digest omits DMs when the user opts out', digest.directMessages === undefined);
check('the opt-out is recorded for the model to see', digest.coverage.directMessagesIncluded === false);
check('digest stays inside its size budget',
  digest.coverage.digestChars <= Digest.LIMITS.totalChars, digest.coverage.digestChars + ' chars');
check('digest holds no raw archive bytes', !JSON.stringify(digest).includes('PK'));

// Direct messages are included by default now, so the default path is tested
// against the real fixture rather than a hand-built stand-in.
const withDmSignals = await IG.readExports([file], { includeMessages: true });
const withDms = Digest.build(withDmSignals, { includeMessages: true });

check('DMs are parsed when included', withDmSignals.messages.threads === 3, String(withDmSignals.messages.threads));
check('the account owner is identified in the threads', withDmSignals.messages.owner === 'Aleç',
  JSON.stringify(withDmSignals.messages.owner));
check('sent and received are counted separately',
  withDmSignals.messages.sent === 18 && withDmSignals.messages.received === 18,
  withDmSignals.messages.sent + '/' + withDmSignals.messages.received);
check('digest includes DM aggregates', withDms.directMessages.threads === 3);
check('digest samples only the user\'s own messages',
  /Only the user's own messages/.test(withDms.directMessages.note));
check('DM sampling coverage is reported', withDms.coverage.sampling.ownMessages.available === 18);

// The privacy claim that matters: the other side of every conversation is
// counted and then thrown away.
const dmJson = JSON.stringify(withDms.directMessages);
check('the other side of a conversation never reaches the digest', !dmJson.includes('Their reply'));
check('the user\'s own messages do reach the digest', dmJson.includes('Own message'));
check('raw message text is dropped after summarising',
  withDmSignals.messageTexts.length === 0 && withDmSignals.messageEvents.length === 0);

// ---------- how images reach the model ----------

const withPhotos = Digest.build(withImages, {
  includeMessages: false, includeImages: true, imageCount: picked.length,
});
check('digest records that images were sent', withPhotos.coverage.images.included === true &&
  withPhotos.coverage.images.attached === picked.length);
check('digest records how many stills existed to choose from',
  withPhotos.coverage.images.availableStills === withImages.mediaRefs.length);
check('digest says images are a spread, not the latest few',
  /spread across the whole account history/.test(withPhotos.coverage.images.note));
check('opting out is visible to the model', digest.coverage.images.included === false &&
  digest.coverage.images.attached === 0);
check('no pixels ride along inside the digest',
  !JSON.stringify(withPhotos).includes('base64') && withPhotos.coverage.digestChars < 200000);

const fakeImages = [
  { mime: 'image/jpeg', data: 'AAAA', takenAt: '2019-03-04', kind: 'post', hasCaption: false },
  { mime: 'image/jpeg', data: 'BBBB', takenAt: '2024-11-20', kind: 'story', hasCaption: true },
];
const blocks = prompts.profileBlocks(withPhotos, fakeImages);
const imageBlocks = blocks.filter(b => b.type === 'image');

check('the digest leads the request', blocks[0].type === 'text' && blocks[0].text.includes('<evidence>'));
check('every image is passed through', imageBlocks.length === 2);
check('each image is dated for the model',
  /Image 1 — posted 2019-03-04, post, no caption\./.test(blocks.map(b => b.text || '').join('\n')) &&
  /Image 2 — posted 2024-11-20, story, had a caption\./.test(blocks.map(b => b.text || '').join('\n')));
check('each label sits immediately before its image',
  blocks.findIndex(b => b.type === 'image') === blocks.findIndex(b => /^Image 1 /.test(b.text || '')) + 1);
check('the image limits are restated in the user turn',
  blocks.some(b => /hard limits on what you may take from them/.test(b.text || '')));
check('no images means no image blocks',
  prompts.profileBlocks(withPhotos, []).every(b => b.type === 'text') &&
  prompts.profileBlocks(withPhotos, null).length === 1);
check('more images than the ceiling are truncated',
  prompts.profileBlocks(withPhotos, new Array(60).fill(fakeImages[0]))
    .filter(b => b.type === 'image').length === prompts.MAX_IMAGES);
check('the ceiling matches the client\'s own', prompts.MAX_IMAGES === Images.LIMITS.max);
check('compatibility never carries images',
  prompts.compatibilityBlocks({ name: 'A' }, { name: 'B' }).every(b => b.type === 'text'));

// ---------- scale: a heavy account ----------
//
// The small fixture never reaches the caps, so synthesise an account big
// enough to bind every one of them and confirm the digest still fits its
// budget and reports its own sampling honestly.

function heavySignals() {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  return {
    ...signals,
    captions: many(4000, i => 'Caption number ' + i + '. ' + 'A sentence about the day and what happened. '.repeat(3)),
    comments: many(3000, i => 'Comment number ' + i + ', a reply to somebody.'),
    searches: many(500, i => 'search term ' + i),
    topics: many(600, i => 'Topic ' + i),
    adInterests: many(600, i => 'Ad interest ' + i),
    following: many(4000, i => ({ name: 'account_number_' + i, ts: 0 })),
    likedAuthors: new Map(many(900, i => ['liked_author_' + i, 900 - i])),
    savedAuthors: new Map(many(400, i => ['saved_author_' + i, 400 - i])),
    commentedOn: new Map(many(700, i => ['engaged_' + i, 700 - i])),
  };
}

const heavy = Digest.build(heavySignals(), { includeMessages: false });

check('heavy account caps captions', heavy.samples.captions.length === Digest.LIMITS.captions,
  heavy.samples.captions.length + ' captions');
check('heavy account caps comments', heavy.samples.comments.length === Digest.LIMITS.comments);
check('heavy account caps following', heavy.following.length === Digest.LIMITS.following);
check('heavy account caps liked accounts', heavy.mostLikedAccounts.length === Digest.LIMITS.likedAuthors);
check('heavy account caps topics', heavy.instagramTopics.length === Digest.LIMITS.topics);
check('heavy account still fits the total budget',
  heavy.coverage.digestChars <= Digest.LIMITS.totalChars, heavy.coverage.digestChars + ' chars');
check('heavy account digest is under 400KB in practice',
  heavy.coverage.digestChars < 400000, heavy.coverage.digestChars + ' chars');

// The model is told what fraction it is seeing so it can calibrate confidence.
check('digest reports how much of each source was sampled',
  heavy.coverage.sampling.captions.shown === Digest.LIMITS.captions &&
  heavy.coverage.sampling.captions.available === 4000,
  JSON.stringify(heavy.coverage.sampling.captions));
check('sampling coverage is reported for follows too',
  heavy.coverage.sampling.following.shown === Digest.LIMITS.following &&
  heavy.coverage.sampling.following.available === 4000);
check('sampling counts stay honest on a small account',
  digest.coverage.sampling.captions.shown === digest.samples.captions.length &&
  digest.coverage.sampling.captions.available === signals.captions.length);
check('the prompt tells the model to use the sampling coverage',
  /coverage\.sampling/.test(prompts.PROFILE_SYSTEM));

// Follows are sampled across the whole list, not just the head — otherwise a
// long-standing account is read entirely from who they followed years ago.
check('follows are sampled across the whole list, not the head',
  heavy.following.includes('account_number_0') && heavy.following.some(name => {
    const n = Number(name.replace('account_number_', ''));
    return n > 3000;
  }));

// ---------- mock analysis and the card ----------

const analysis = await mock.analyseProfile(digest);
const report = analysis.data;

check('analysis fills every top-level section',
  Object.keys(prompts.PROFILE_SCHEMA.properties).every(key => key in report),
  Object.keys(report).join(','));

const cardPayload = await Card.encodeCard(report.card);
const decoded = await Card.decodeCard(cardPayload);

check('card payload is prefixed and compact', cardPayload.startsWith('K3') && cardPayload.length < 1200, cardPayload.length + ' chars');
check('card payload is comfortably scannable', cardPayload.length <= Card.COMFORTABLE_PAYLOAD, cardPayload.length + ' chars');
check('card round-trips', !!decoded);
check('card round-trips the name', decoded.name === report.card.name);
check('card round-trips the Big Five', JSON.stringify(decoded.bigFive) === JSON.stringify(report.card.bigFive));
check('card round-trips relationship weaknesses',
  JSON.stringify(decoded.relationshipWeaknesses) === JSON.stringify(report.card.relationshipWeaknesses));
check('card round-trips career strengths',
  JSON.stringify(decoded.careerStrengths) === JSON.stringify(report.card.careerStrengths));
check('card excludes the long-form report',
  !JSON.stringify(decoded).includes('Mock summary paragraph'));

check('a foreign code is rejected', (await Card.decodeCard('https://example.com/not-psycheai')) === null);
check('a corrupted payload is rejected', (await Card.decodeCard(cardPayload.slice(0, -8) + 'AAAAAAAA')) === null);
check('a payload without the version prefix is rejected', (await Card.decodeCard(cardPayload.slice(2))) === null);
check('a payload is extracted from a URL',
  Card.extractPayload('https://x.example/psycheai/#p=K3ABC-_123') === 'K3ABC-_123');

// Oversized model output must be trimmed, not passed through.
const bloated = Card.shape({
  ...report.card,
  name: 'x'.repeat(200),
  interests: Array.from({ length: 40 }, (_, i) => 'interest number ' + i + ' with an unreasonably long label attached'),
  summary: 'y'.repeat(2000),
});
check('card trims an over-long name', bloated.name.length <= Card.CAPS.name);
check('card trims an over-long summary', bloated.summary.length <= Card.CAPS.summary + 1);
check('card caps list length', bloated.interests.length === Card.CAPS.lists.interests);
check('card caps phrase length', bloated.interests.every(p => p.length <= Card.CAPS.phrase));
const bloatedPayload = await Card.encodeCard(bloated);
check('a trimmed card still fits a QR code', bloatedPayload.length <= Card.COMFORTABLE_PAYLOAD, bloatedPayload.length + ' chars');

// ---------- mock compatibility ----------

const other = { ...decoded, name: 'Jordan', interests: ['Running', 'Nightlife'] };
const compat = (await mock.analyseCompatibility(decoded, other, 'professional')).data;

check('compatibility fills every section',
  Object.keys(prompts.COMPATIBILITY_SCHEMA.properties).every(key => key in compat));
check('compatibility scores the chosen basis',
  Number.isInteger(compat.score) && compat.mode === 'professional');
check('compatibility names both people',
  compat.verdict.includes(decoded.name) && compat.verdict.includes('Jordan'));
check('compatibility gives each person their own advice',
  compat.howToPartner.forA.length > 0 && compat.howToPartner.forB.length > 0);

// ---------- provider retry behaviour ----------
//
// Runs in its own process against fake SDKs (tools/fixtures/retry-behaviour.cjs),
// because the real @google/genai and @anthropic-ai/sdk modules are already
// loaded and cached by this point — the fakes have to be in place before
// lib/gemini.js and lib/claude.js first require them, which means a fresh
// module registry. Each line of its output is one check folded into this
// file's own tally, so a break there fails `npm test` rather than needing a
// separate command anyone has to remember to run.
{
  const fixture = join(root, 'tools', 'fixtures', 'retry-behaviour.cjs');
  let output = '';
  try {
    output = execFileSync(process.execPath, [fixture], { encoding: 'utf8', timeout: 15000 });
  } catch (error) {
    // A non-zero exit still carries its check lines on stdout; only a crash
    // before it could print anything leaves nothing to parse.
    output = (error.stdout && error.stdout.toString()) || '';
    if (!output) check('provider retry behaviour fixture ran', false, error.message);
  }
  for (const line of output.split('\n').filter(Boolean)) {
    const result = JSON.parse(line);
    check(result.label, result.ok, result.detail === null ? undefined : result.detail);
  }
}

// ---------- results ----------

console.log('\nPsycheAI self-test');
console.log('  digest size       : ' + digest.coverage.digestChars + ' chars (small fixture)');
console.log('  heavy account     : ' + heavy.coverage.digestChars + ' chars, ' +
  heavy.coverage.sampling.captions.shown + '/' + heavy.coverage.sampling.captions.available + ' captions');
console.log('  QR payload        : ' + cardPayload.length + ' chars');
console.log('  images selected   : ' + picked.length + ' of ' + withImages.mediaRefs.length +
  ' stills, spanning ' + Math.round(pickedSpan / 86400) + ' days');

if (failures.length) {
  console.error('\n' + failures.length + ' failed, ' + passed + ' passed:');
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log('\n  ' + passed + ' checks passed\n');
