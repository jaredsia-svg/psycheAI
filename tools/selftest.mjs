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

import { buildExportZip, buildForeignExportZip } from './fixture.mjs';

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

// copy.js is here so the suite can hold the client's vocabulary against the
// server's — the working-relationship list exists in both and must not drift.
for (const file of ['zip.js', 'instagram.js', 'images.js', 'digest.js', 'card.js', 'copy.js']) {
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

// ---------- the sample report ----------
//
// docs/sample.json is what "See a sample report" renders, and it goes through
// the same renderProfile a real report does. So it has to satisfy the schema
// the model is held to, exactly: a field the sample is missing is a field the
// renderer reads as undefined in the one report every visitor sees. Written by
// hand rather than taken from lib/mock.js — the mock says "Mock reading for
// agreeableness" on purpose, which is right for a fixture and useless as a
// shop window.
const sample = JSON.parse(readFileSync(new URL('../docs/sample.json', import.meta.url), 'utf8'));

function schemaFaults(node, value, path) {
  const faults = [];
  if (node.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [path + ': not an object'];
    for (const key of node.required || []) {
      const at = path ? path + '.' + key : key;
      if (!(key in value)) faults.push(at + ': missing');
      else faults.push(...schemaFaults(node.properties[key], value[key], at));
    }
    for (const key of Object.keys(value)) {
      // A leading underscore marks a note to whoever edits the file, not data.
      if (key.startsWith('_') || node.properties[key]) continue;
      faults.push((path ? path + '.' : '') + key + ': not in the schema');
    }
  } else if (node.type === 'array') {
    if (!Array.isArray(value)) return [path + ': not an array'];
    value.forEach((item, i) => faults.push(...schemaFaults(node.items, item, path + '[' + i + ']')));
  } else if (node.enum) {
    if (!node.enum.includes(value)) faults.push(path + ': ' + JSON.stringify(value) + ' not in enum');
  } else if (node.type === 'integer' && !Number.isInteger(value)) {
    faults.push(path + ': not an integer');
  } else if (node.type === 'string' && typeof value !== 'string') {
    faults.push(path + ': not a string');
  }
  return faults;
}

const sampleFaults = schemaFaults(prompts.PROFILE_SCHEMA, sample, '');
check('the sample report satisfies the profile schema exactly', sampleFaults.length === 0,
  sampleFaults.slice(0, 6).join(' | '));
// It is the only report most visitors will ever read, and a sample that only
// flatters would misrepresent what the model actually returns.
check('the sample report is honest about weaknesses, not an advert',
  sample.relationship.weaknesses.length >= 2 && sample.career.weaknesses.length >= 2 &&
  sample.confidence.score < 100 && /tentative/i.test(sample.relationship.attachment.style),
  JSON.stringify({
    relationship: sample.relationship.weaknesses.length,
    career: sample.career.weaknesses.length,
    confidence: sample.confidence.score,
  }));
check('the sample report is named as a sample rather than as a person',
  sample.card.name === 'Sample', sample.card.name);

// The sample is the shop window for the bonus section too, so it has to
// demonstrate the rule rather than only be governed by it: genuinely
// unsparing, and naming no condition anywhere. The word list is the vocabulary
// a model reaches for first when it starts drifting from behaviour towards
// diagnosis, so finding any of it here means the exemplar is teaching the
// wrong thing.
const bonusText = [sample.bonus.harsh, sample.bonus.advice, sample.bonus.trajectory].join('\n');
check('the sample bonus section is actually unsparing rather than a soft version',
  bonusText.length > 1500 && sample.bonus.harsh.length > 500,
  bonusText.length + ' chars, harsh ' + sample.bonus.harsh.length);
const clinicalWords = ['depression', 'depressed', 'anxiety disorder', 'bipolar', 'ADHD', 'autism',
  'personality disorder', 'PTSD', 'OCD', 'diagnos', 'mental illness', 'clinically', 'disorder',
  'burnout syndrome', 'at risk of developing'];
const clinicalHits = clinicalWords.filter(word => new RegExp(word, 'i').test(bonusText));
check('the sample bonus names no condition, since it is a behavioural read',
  clinicalHits.length === 0, clinicalHits.join(', '));

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
  ['posting', 'rhythm', 'trajectory', 'diet'].every(k => k in activityProps));
// Four facets and nothing around them. The summary restated in prose what the
// facets say with evidence attached, and the blind-spots line duplicated the
// confidence section that closes the whole report — both out of the schema as
// well as the renderers.
check('the section is four facets, with no prose wrapped around them',
  Object.keys(activityProps).length === 4 &&
  !('summary' in activityProps) && !('blindSpots' in activityProps),
  Object.keys(activityProps).join(', '));
// `engagement` asked for the publish-against-read ratio as a facet of its own.
// That ratio is one sentence of the consumption read rather than a section
// beside it, and keeping both had two facets reaching for the same counts.
check('the publish-vs-read facet is gone rather than duplicated by the diet read',
  !('engagement' in activityProps) &&
  /publish-against-read ratio/.test(activityProps.diet.properties.detail.description));
const dietProps = activityProps.diet.properties;
check('the consumption read is one paragraph, headline and detail',
  ['headline', 'detail'].every(k => k in dietProps) && Object.keys(dietProps).length === 2,
  Object.keys(dietProps).join(', '));
// Dropped from the profile page, so must not linger in the schema costing
// output tokens — the same discipline as the headline check above. The four
// below went in one pass, for length: the behaviour section had grown past a
// screen and a half and was outweighing findings that say more about a person.
check('activity no longer asks for attention or implications',
  !('attention' in activityProps) && !('implications' in activityProps));
check('the cut subsections are gone from the schema, not just from the page',
  !('topAccounts' in dietProps) && !('algorithmRead' in dietProps) &&
  !('recommendations' in activityProps) && !('antiRecommendations' in activityProps),
  Object.keys(dietProps).concat(Object.keys(activityProps)).join(', '));
// The named-accounts list is what carried the two rules against inventing
// screen time and against naming somebody's friends. The list is gone, but the
// paragraph that replaced it reads the same counts, so the prompt still has to
// say both — this is the one cut that could quietly remove a guardrail.
check('the timing-data ban survived the account list being cut',
  /The export contains no timing data whatsoever/.test(prompts.PROFILE_SYSTEM));
check('the ban on naming private individuals survived it too',
  /do not name private individuals/i.test(prompts.PROFILE_SYSTEM));
// The unsparing section. Its licence is to drop the softening, not to drop the
// evidence, and above all not to invent a diagnosis — so each limit is pinned
// separately rather than trusted to one loose match.
const bonusProps = prompts.PROFILE_SCHEMA.properties.bonus.properties;
check('the bonus section carries both readings',
  ['harsh', 'advice'].every(k => k in bonusProps) && Object.keys(bonusProps).length === 2,
  Object.keys(bonusProps).join(', '));
// The five-year forecast was cut with the behaviour section's subsections. It
// was also the field carrying the longest statement of the no-diagnosis rule,
// so the checks below now read that rule off the hard limits instead — cutting
// a section must not quietly cut a guardrail with it.
check('the five-year forecast is gone from the schema rather than left unrendered',
  !('trajectory' in bonusProps));
// The register is now stated outright rather than left implied by "accurate
// without being kind" — the page calls it a roast, so the prompt has to ask
// for one or the two drift apart.
check('the section is asked for as a roast, not just as an unkind read',
  /This section is a roast/.test(prompts.PROFILE_SYSTEM) &&
  /Roast them/.test(bonusProps.harsh.description));
// The load-bearing half of that instruction. A roast that stops being
// evidence-bound is abuse from a stranger who read somebody's captions, and
// the licence to be funny is exactly where that would slip.
check('the roast is still held to the evidence, and told why that matters',
  /a licence to drop the softening, not a licence to make things up/.test(prompts.PROFILE_SYSTEM) &&
  /the target recognising themselves/.test(prompts.PROFILE_SYSTEM) &&
  /Generic insults are not roasting/.test(prompts.PROFILE_SYSTEM));
check('the harsh read stays inside what the evidence supports',
  /the least charitable reading of this person that the evidence still fully supports/i
    .test(bonusProps.harsh.description) &&
  /an invented insult is worse than a short section/.test(bonusProps.harsh.description));
check('the harsh read goes after patterns rather than the person',
  /nothing about their appearance, body, intelligence, worth or anything they cannot change/
    .test(bonusProps.harsh.description));
// The one the whole section turns on: a model naming a condition from posting
// patterns is a confident falsehood about somebody's health, in a document
// they keep. Stated twice over, because a licence to be harsh is exactly where
// it would erode.
check('being unkind is explicitly not a licence to diagnose',
  /Neither of them is a diagnosis, and being unkind is not a licence to become one/
    .test(prompts.PROFILE_SYSTEM));
check('the clinical vocabulary is named and banned rather than left to judgement',
  /not depression, not anxiety, not burnout as a condition/.test(prompts.PROFILE_SYSTEM));
check('the hard limits extend the health-condition ban into the bonus section',
  /This holds in the bonus section too, and holds hardest there/.test(prompts.PROFILE_SYSTEM) &&
  /no mental or physical health condition may be named, predicted or hinted at/
    .test(prompts.PROFILE_SYSTEM));
// A reader can ask for a diagnosis in the framing of the feature; the prompt
// has to refuse that rather than treat it as permission.
check('the ban survives the reader having asked for a diagnosis',
  /however the reader has framed what they want/.test(prompts.PROFILE_SYSTEM));

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

// ---------- who reports to whom ----------
//
// "Professional" was one question asked of three different situations. A
// manager needs to know how to get someone's best work without losing them; a
// report needs to know how to work for someone and keep their footing; peers
// need neither. Answering all three the same way gave two thirds of readers a
// report about the wrong thing.
check('a work run splits three ways',
  ['colleagues', 'superior', 'subordinate'].every(k => k in prompts.WORK_STANCES));
check('an unknown stance falls back to peers rather than throwing',
  prompts.resolveStance('nonsense') === 'colleagues' && prompts.resolveStance() === 'colleagues');
check('each stance asks its own five questions',
  Object.values(prompts.WORK_STANCES).every(s => s.dimensions.length === 5));
{
  const named = Object.values(prompts.WORK_STANCES).flatMap(s => s.dimensions);
  check('no two stances score the same thing',
    new Set(named).size === named.length, named.length + ' dimensions, ' + new Set(named).size + ' distinct');
}
check('a manager and a report are asked opposite questions',
  prompts.WORK_STANCES.superior.dimensions.includes('Whether problems reach you') &&
  prompts.WORK_STANCES.subordinate.dimensions.includes('Raising a problem safely'));
check('the peer stance keeps what professional always asked',
  prompts.WORK_STANCES.colleagues.dimensions.includes('Load balance'));

// briefFor is what actually swaps the question, so pin its behaviour rather
// than the shape of the table behind it.
check('a work run takes its dimensions from the stance, not the basis',
  JSON.stringify(prompts.briefFor('professional', 'superior').dimensions) ===
  JSON.stringify(prompts.WORK_STANCES.superior.dimensions));
check('the other two bases ignore the stance entirely',
  JSON.stringify(prompts.briefFor('romantic', 'superior').dimensions) ===
  JSON.stringify(prompts.COMPATIBILITY_MODES.romantic.dimensions) &&
  JSON.stringify(prompts.briefFor('platonic', 'subordinate').dimensions) ===
  JSON.stringify(prompts.COMPATIBILITY_MODES.platonic.dimensions));
check('a work run with no stance still answers as peers',
  JSON.stringify(prompts.briefFor('professional').dimensions) ===
  JSON.stringify(prompts.WORK_STANCES.colleagues.dimensions));
check('the heading follows the stance too',
  prompts.briefFor('professional', 'superior').heading === 'How to manage them' &&
  prompts.briefFor('professional', 'subordinate').heading === 'How to work for them');

// The direction is not symmetrical and person A is always the scanner, so a
// prompt that does not say which way round it runs is worse than useless.
{
  const a = { name: 'Sam' };
  const b = { name: 'Jordan' };
  const asBoss = prompts.compatibilityBlocks(a, b, 'professional', 'superior')[0].text;
  const asReport = prompts.compatibilityBlocks(a, b, 'professional', 'subordinate')[0].text;
  check('the manager turn says A manages B', /Person A manages person B/.test(asBoss));
  check('the report turn says A reports to B', /Person A reports to person B/.test(asReport));
  check('the two work turns are genuinely different briefs', asBoss !== asReport);
  check('the manager turn asks for the manager dimensions',
    prompts.WORK_STANCES.superior.dimensions.every(d => asBoss.includes(d)));
  check('the manager turn does not smuggle in the peer dimensions',
    !asBoss.includes('Load balance'));
  check('a work turn still carries the derived facts',
    asBoss.includes('<derived_facts>'));
}

// The stance has to survive the whole way down: client -> server -> provider
// -> prompt. Everything above tests the prompt end, and the UI suite tests the
// client end, but both providers sat in between building the user turn
// themselves — and dropping the fourth argument there is silent, because a
// peer brief is a perfectly valid brief. So patch the prompt builder, call
// each real provider, and read back what it actually passed.
{
  const realBlocks = prompts.compatibilityBlocks;
  const seen = [];
  prompts.compatibilityBlocks = (...args) => {
    seen.push(args);
    throw new Error('__stop_before_the_network__');
  };
  for (const engine of [gemini, claude]) {
    try {
      engine.analyseCompatibility({ name: 'A' }, { name: 'B' }, 'professional', 'subordinate');
    } catch (error) {
      if (!/__stop_before_the_network__/.test(error.message)) throw error;
    }
  }
  prompts.compatibilityBlocks = realBlocks;
  check('every provider forwards the stance, not just the basis',
    seen.length === 2 && seen.every(args => args[2] === 'professional' && args[3] === 'subordinate'),
    JSON.stringify(seen.map(args => args.slice(2))));
}

// A power difference is exactly where a report like this could do harm, so the
// prompt has to say so rather than leaving it to taste.
check('the prompt stays even-handed across a power gap',
  /only audits whoever has less power/.test(prompts.COMPATIBILITY_SYSTEM));
check('the prompt refuses to supply tactics for pushing somebody out',
  /a method for pushing somebody out/.test(prompts.COMPATIBILITY_SYSTEM));
check('the prompt warns that the direction is not symmetrical',
  /Person A is always the one who scanned/.test(prompts.COMPATIBILITY_SYSTEM));

// The client draws the picker from its own copy of the stance list, so the two
// have to name the same three things or the UI offers one the server drops.
{
  const clientStances = Object.keys(globalThis.PsycheCopy.WORK_STANCES);
  check('client and server name the same working relationships',
    JSON.stringify(clientStances.slice().sort()) ===
    JSON.stringify(Object.keys(prompts.WORK_STANCES).slice().sort()),
    clientStances.join(','));
  // Read defensively: if a stance is renamed on one side only, this has to say
  // which one is missing rather than dying on an undefined.
  const clientOption = key => {
    const entry = globalThis.PsycheCopy.WORK_STANCES[key];
    return entry && typeof entry.option === 'string' ? entry.option : '';
  };
  check('every stance option leaves a slot for the other person\'s name',
    ['superior', 'subordinate'].every(k => clientOption(k).includes('{name}')),
    ['superior', 'subordinate'].filter(k => !clientOption(k).includes('{name}')).join(',') || 'none');
  check('the peer option needs no name and has none',
    clientOption('colleagues').length > 0 && !clientOption('colleagues').includes('{name}'));
  check('the name actually gets filled in',
    globalThis.PsycheCopy.stanceText('I am the superior of {name}', 'Jordan') ===
    'I am the superior of Jordan');
  check('a missing name degrades to something readable',
    globalThis.PsycheCopy.stanceText('How to manage {name}', '') === 'How to manage them');
}

// The basis was renamed to cover relatives, so the brief has to actually say
// something about family rather than the label alone changing.
check('the friendship basis is labelled for family too',
  prompts.COMPATIBILITY_MODES.platonic.label === 'Family / Friends');
check('and its brief tells the model family is in scope',
  /relatives as well as friends/.test(prompts.COMPATIBILITY_MODES.platonic.brief));
check('the system prompt knows family did not choose each other',
  /people do not pick their family/.test(prompts.COMPATIBILITY_SYSTEM));
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
  // The consumption read is the one section that names third-party accounts
  // and the one that gives advice, so both of its ways of going wrong are
  // pinned rather than trusted to the schema alone.
  ['reads the four appetites as separate things', /what they subscribed to.*what actually catches them/],
  ['looks for the gap rather than the totals', /Read the \*\*gaps\*\*/],
  ['refuses to invent time it cannot measure', /The export contains no timing data whatsoever/],
  ['will not name a private individual', /a friend or a relative is described rather than named/],
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

// ---------- recognising the archive ----------
//
// A real export clears the recognition floor by a wide margin, which is the
// point: the floor is there to catch the wrong archive, not a quiet account.
// If this margin ever narrows, Instagram has renamed files and the routes need
// looking at before the floor starts turning real users away.
const realSources = Object.keys(signals.files.byRoute).filter(route => route !== 'messages');
check('a real export clears the recognition floor with room to spare',
  realSources.length >= 8, realSources.length + ' kinds: ' + realSources.join(', '));

// The archive the floor exists for: a Facebook download, which is full of JSON
// and shares three filenames with Instagram.
const foreign = new File([buildForeignExportZip()], 'facebook-export.zip', { type: 'application/zip' });
let foreignError = null;
try {
  await IG.readExports([foreign], { includeMessages: true });
} catch (error) {
  foreignError = error;
}
check('a Facebook download is refused rather than analysed', Boolean(foreignError),
  foreignError ? '' : 'it parsed without complaint');
check('the refusal says how little was read and what to try',
  Boolean(foreignError) && /Only 3 kinds of Instagram activity/.test(foreignError.message) &&
  /several \.zip parts/.test(foreignError.message),
  foreignError && foreignError.message);
// Messages are the one route Facebook gets exactly right, so if they counted,
// this archive would be three sources away from passing instead of one.
check('the refusal holds even though its messages parsed perfectly',
  Boolean(foreignError) && /Facebook or WhatsApp/.test(foreignError.message));

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
check('digest tells the model how to read its own coverage numbers',
  /where shown equals available you are reading\s+everything/.test(digest.coverage.samplingNote));
check('digest records which depth produced it', digest.coverage.depth === 'standard');
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

// ---------- comprehensive depth ----------
//
// The point of the second depth is that the price, not a row of per-source
// caps, is what bounds it. So the checks are: it really does send everything
// a normal account has, and it really does stop at the budget when an account
// is large enough to blow through it.

const deep = Digest.build(heavySignals(), { includeMessages: false, depth: 'comprehensive' });
const DEEP = Digest.DEPTHS.comprehensive.limits;

check('comprehensive records its own depth', deep.coverage.depth === 'comprehensive');
check('comprehensive sends far more than standard',
  deep.coverage.digestChars > heavy.coverage.digestChars * 2,
  deep.coverage.digestChars + ' vs ' + heavy.coverage.digestChars + ' chars');
// This synthetic account is deliberately past what the cap can hold — 4,000
// captions of ~150 characters is 600,000 on its own, against a 545,000 budget
// — so comprehensive is bound by the price here rather than sending everything.
// That is the honest shape of the feature: "as much as $0.50 buys", which for
// most accounts is all of it and for the very heaviest is not.
check('comprehensive sends far more captions than standard',
  deep.samples.captions.length > Digest.LIMITS.captions * 2,
  deep.samples.captions.length + ' vs ' + heavy.samples.captions.length);
check('comprehensive sends the whole follow list where it fits',
  deep.following.length === 4000, deep.following.length + ' of 4000');
check('comprehensive stays inside its own budget on an oversized account',
  deep.coverage.digestChars <= DEEP.totalChars,
  deep.coverage.digestChars + ' of ' + DEEP.totalChars);
check('comprehensive reports the fraction honestly when it cannot send it all',
  deep.coverage.sampling.captions.shown === deep.samples.captions.length &&
  deep.coverage.sampling.captions.available === 4000);

// An account of ordinary size is the case the feature is really for, and there
// it should send literally everything and say so.
{
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const ordinary = Digest.build({
    ...heavySignals(),
    captions: many(700, i => 'Caption number ' + i + '. A sentence about the day.'),
    comments: many(600, i => 'Comment number ' + i + ', a reply to somebody.'),
    following: many(900, i => ({ name: 'account_number_' + i, ts: 0 })),
  }, { includeMessages: false, depth: 'comprehensive' });

  check('an ordinary account gets every caption under comprehensive',
    ordinary.samples.captions.length === 700, ordinary.samples.captions.length + ' of 700');
  check('an ordinary account gets every comment and follow',
    ordinary.samples.comments.length === 600 && ordinary.following.length === 900);
  check('and comprehensive then reports full coverage, not a fraction',
    ordinary.coverage.sampling.captions.shown === ordinary.coverage.sampling.captions.available &&
    ordinary.coverage.sampling.following.shown === ordinary.coverage.sampling.following.available);
  check('the same account under standard would have been sampled instead',
    Digest.build({ ...heavySignals(),
      captions: many(700, i => 'Caption number ' + i + '. A sentence about the day.'),
    }, { includeMessages: false }).samples.captions.length === Digest.LIMITS.captions);
}

// The budget is the cost ceiling expressed in characters, so the arithmetic
// that produces it is worth pinning down rather than trusting.
{
  const CHARS_PER_TOKEN = 3.5;
  const images = Digest.DEPTHS.comprehensive.images;
  const worstCost = ((DEEP.totalChars / CHARS_PER_TOKEN) + 8600 + images * 258) * (1.50 / 1e6) +
    32768 * (7.50 / 1e6);
  check('a full comprehensive digest plus maximum output stays under the cap',
    worstCost <= Digest.COST_CAP + 1e-6, '$' + worstCost.toFixed(4) + ' vs $' + Digest.COST_CAP.toFixed(2));
  check('the budget is not needlessly conservative either',
    worstCost > Digest.COST_CAP - 0.01, '$' + worstCost.toFixed(4));
  check('a tighter cap buys a smaller digest', Digest.charBudget(0.25, 20) < Digest.charBudget(0.50, 20));
  check('a cap below the worst-case output alone buys nothing', Digest.charBudget(0.10, 20) === 0);
  check('images are charged against the same budget',
    Digest.charBudget(0.50, 0) > Digest.charBudget(0.50, 20));
}

// An export big enough to blow the budget has to be trimmed back to it, and
// the trimming has to be able to reach whichever list is actually large. The
// loop used to touch captions and comments only, which was safe while every
// other cap was in the low hundreds and is not safe now that they are not:
// this account's follow list alone would overrun the budget.
{
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const monstrous = Digest.build({
    ...heavySignals(),
    captions: many(200, i => 'Short caption ' + i),
    comments: many(200, i => 'Short comment ' + i),
    following: many(120000, i => ({ name: 'an_account_with_a_fairly_long_handle_' + i, ts: 0 })),
  }, { includeMessages: false, depth: 'comprehensive' });

  check('an export that overruns the budget is trimmed back inside it',
    monstrous.coverage.digestChars <= DEEP.totalChars,
    monstrous.coverage.digestChars + ' of ' + DEEP.totalChars);
  check('the trimming reaches the list that is actually oversized',
    monstrous.following.length < 120000, monstrous.following.length + ' follows kept');
  check('trimming does not gut the short lists to spare the long one',
    monstrous.samples.captions.length === 200 && monstrous.samples.comments.length === 200,
    monstrous.samples.captions.length + ' captions, ' + monstrous.samples.comments.length + ' comments');
  check('coverage numbers are restated after trimming, not left stale',
    monstrous.coverage.sampling.following.shown === monstrous.following.length &&
    monstrous.coverage.sampling.captions.shown === monstrous.samples.captions.length);
}

check('an unknown depth falls back to standard rather than throwing',
  Digest.build(signals, { includeMessages: false, depth: 'nonsense' }).coverage.depth === 'standard');
check('standard still sends 14 images and comprehensive 20',
  Digest.DEPTHS.standard.images === 14 && Digest.DEPTHS.comprehensive.images === 20);
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

check('card payload is prefixed and compact', cardPayload.startsWith(Card.VERSION) && cardPayload.length < 1600, cardPayload.length + ' chars');
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

// The card used to carry a tenth of the report, and specifically not the parts
// the compatibility prompt says decide the answer. Each of these was absent
// before K4, so each one is a thing the second model call could not see.
// Read defensively: if a field stops being emitted at all, this has to report
// which one rather than dying on an undefined and printing a stack trace.
const carries = (key, min) => typeof decoded[key] === 'string'
  ? decoded[key].length > min
  : Array.isArray(decoded[key]) && decoded[key].length > min;
for (const [label, present] of [
  ['love languages, which decide the romantic read', carries('loveReceiving', 0) && carries('loveGiving', 0)],
  ['the reasoning under the attachment guess', carries('attachmentWhy', 40)],
  ['contact appetite, which decides the platonic read', carries('energy', 10)],
  ['work style, which decides the professional read', carries('workStyle', 10)],
  ['the Enneagram type', carries('enneagram', 0)],
]) {
  check('the card carries ' + label, Boolean(present));
}

// A code someone saved as a JPEG months ago still has to read. K4 both renamed
// the keys on the wire and added fields, so a real K3 payload has to be built
// the old way — full-length keys, no packing — rather than re-prefixing a K4
// one, which would only prove the prefix check and not the format fallback.
const legacyCard = {
  name: 'Alex', headline: 'Old headline', summary: 'Old summary.', mbti: 'INFP',
  bigFive: { openness: 60, conscientiousness: 50, extraversion: 40, agreeableness: 70, neuroticism: 30 },
  interests: ['Running'], values: ['Family'], beliefs: [],
  relationshipStrengths: ['Shows up consistently', 'Warm in writing'],
  relationshipWeaknesses: ['Slow to raise problems'],
  careerStrengths: ['Follows through'], careerWeaknesses: ['Under-advocates'],
  attachment: 'leans secure (tentative)', rhythm: 'early riser', confidence: 64,
};
const legacyPayload = await (async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(legacyCard));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < packed.length; i += 3) {
    const [b0, b1, b2] = [packed[i], packed[i + 1], packed[i + 2]];
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return 'K3' + out;
})();
const legacyDecoded = await Card.decodeCard(legacyPayload);
check('a genuine K3 code still decodes', !!legacyDecoded);
check('a K3 code keeps the data it carried',
  legacyDecoded && legacyDecoded.name === 'Alex' && legacyDecoded.bigFive.agreeableness === 70 &&
  legacyDecoded.relationshipStrengths[0] === 'Shows up consistently');
check('a K3 code gains the fields it never had, as empties',
  Boolean(legacyDecoded) && ['enneagram', 'attachmentWhy', 'energy', 'workStyle'].every(k => legacyDecoded[k] === '') &&
  Array.isArray(legacyDecoded.loveGiving) && legacyDecoded.loveGiving.length === 0);
check('a payload with no known prefix is still rejected',
  (await Card.decodeCard('K9' + cardPayload.slice(2))) === null);
check('a K4 payload is genuinely packed, not just renamed',
  !JSON.stringify(Card.pack(Card.shape(report.card))).includes('relationshipStrengths'));
check('packing round-trips every field it carries',
  JSON.stringify(Card.shape(Card.unpack(Card.pack(Card.shape(report.card))))) ===
  JSON.stringify(Card.shape(report.card)));

// The other half: what a pre-K4 card looks like once inflated.
const legacyShape = Card.shape({
  name: 'Alex', headline: 'Old headline', summary: 'Old summary.', mbti: 'INFP',
  bigFive: { openness: 60, conscientiousness: 50, extraversion: 40, agreeableness: 70, neuroticism: 30 },
  interests: ['Running'], values: ['Family'], beliefs: [],
  relationshipStrengths: ['Shows up consistently', 'Warm in writing'],
  relationshipWeaknesses: ['Slow to raise problems'],
  careerStrengths: ['Follows through'], careerWeaknesses: ['Under-advocates'],
  attachment: 'leans secure (tentative)', rhythm: 'early riser', confidence: 64,
});
check('a pre-K4 card keeps its relationship phrases',
  legacyShape.relationshipStrengths[0] === 'Shows up consistently');
check('a pre-K4 card gains the new fields as empties, never undefined',
  ['enneagram', 'attachmentWhy', 'energy', 'workStyle'].every(key => legacyShape[key] === '') &&
  Array.isArray(legacyShape.loveGiving) && legacyShape.loveGiving.length === 0 &&
  Array.isArray(legacyShape.loveReceiving) && legacyShape.loveReceiving.length === 0);
check('a pre-K4 card keeps the data it did carry',
  legacyShape.name === 'Alex' && legacyShape.bigFive.agreeableness === 70 &&
  legacyShape.attachment === 'leans secure (tentative)');

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

// The caps only mean anything if the worst card they permit still scans. K4
// widened nearly every field, so this fills all of them to the brim with
// non-repeating words — the least compressible thing a real card could be —
// and checks the QR payload is still inside the comfortable budget. Without
// it the caps are a guess; a maximally-stuffed card overshot by 241 characters
// on the first sizing and the numbers were pulled back until it fit.
let noiseSeed = 7;
const WORDLIST = ('quiet loud steady sharp warm distant careful reckless plans drifts commits avoids conflict ' +
  'tension repair silence weekend morning evening trail summit kitchen camera studio office deadline standard ' +
  'rhythm cadence energy attention care effort trust candour friction upside risk boundary pattern signal ' +
  'evidence hedge confidence value belief interest strength weakness partner colleague project season ' +
  'reply latency burst message caption follower archive story reel carousel comment').split(/\s+/);
function noise(length) {
  let out = '';
  while (out.length < length) {
    noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    out += WORDLIST[noiseSeed % WORDLIST.length] + ' ';
  }
  return out.slice(0, length);
}
const CAPS = Card.CAPS;
const stuffed = {
  name: noise(CAPS.name), headline: noise(CAPS.headline), summary: noise(CAPS.summary),
  mbti: 'ENFJ', enneagram: noise(CAPS.enneagram),
  bigFive: { openness: 62, conscientiousness: 71, extraversion: 48, agreeableness: 77, neuroticism: 35 },
  attachment: noise(CAPS.attachment), attachmentWhy: noise(CAPS.attachmentWhy),
  rhythm: noise(CAPS.rhythm), energy: noise(CAPS.energy),
  workStyle: noise(CAPS.workStyle), confidence: 88,
};
for (const [key, count] of Object.entries(CAPS.lists)) {
  stuffed[key] = Array.from({ length: count }, () => noise(CAPS.phrase));
}
const stuffedPayload = await Card.encodeCard(stuffed);
check('a card filled to every cap still fits a QR code',
  stuffedPayload.length <= Card.COMFORTABLE_PAYLOAD,
  stuffedPayload.length + ' of ' + Card.COMFORTABLE_PAYLOAD + ' chars');

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

// One number for a whole pairing cannot show where the fit is thin, so the
// report breaks it into the five dimensions that matter for the chosen basis.
check('compatibility scores five separate dimensions', compat.dimensions.length === 5);
check('every dimension carries a score, a reading and its evidence',
  compat.dimensions.every(d => Number.isInteger(d.score) && d.reading && d.evidence.length));
check('the dimensions are the ones named for this basis',
  JSON.stringify(compat.dimensions.map(d => d.name)) ===
  JSON.stringify(prompts.COMPATIBILITY_MODES.professional.dimensions));
{
  const named = Object.values(prompts.COMPATIBILITY_MODES).flatMap(m => m.dimensions);
  const repeated = [...new Set(named.filter((d, i) => named.indexOf(d) !== i))];
  check('each basis is scored on dimensions chosen for it',
    named.length === 15 && repeated.length === 1 && repeated[0] === 'Energy match',
    'only "Energy match" is asked of more than one basis');
}
check('every basis scores the same number of dimensions',
  Object.values(prompts.COMPATIBILITY_MODES).every(m => m.dimensions.length === 5));

// Claims used to be assertable with nothing behind them. Now every strength
// and friction has to name what in the two profiles put it there.
check('strengths cite their evidence', compat.strengths.every(s => s.evidence && s.evidence.length));
check('frictions cite their evidence', compat.frictions.every(f => f.evidence && f.evidence.length));
check('the schema requires evidence on strengths and frictions',
  ['title', 'detail', 'evidence'].every(key =>
    key in prompts.COMPATIBILITY_SCHEMA.properties.strengths.items.properties &&
    key in prompts.COMPATIBILITY_SCHEMA.properties.frictions.items.properties));

// ---------- derived facts ----------
//
// Set intersection and subtraction handed to the model as settled arithmetic
// rather than asked of it. A model comparing two lists in prose will offer a
// near-match as a shared interest, or miss an exact one.
{
  const left = {
    name: 'Sam', interests: ['Trail running', 'Coffee', 'Design'], values: ['Family'],
    mbti: 'ENFJ', bigFive: { openness: 62, conscientiousness: 71, extraversion: 48, agreeableness: 77, neuroticism: 35 },
    confidence: 70,
  };
  const right = {
    name: 'Jordan', interests: ['coffee!', 'Nightlife', 'design'], values: ['Independence'],
    mbti: 'INTJ', bigFive: { openness: 80, conscientiousness: 40, extraversion: 30, agreeableness: 55, neuroticism: 60 },
    confidence: 45,
  };
  const facts = prompts.derivedFacts(left, right);

  check('derived facts match interests across case and punctuation',
    /Interests in common[^\n]*Coffee/.test(facts) && /Interests in common[^\n]*Design/.test(facts));
  check('derived facts do not invent an overlap',
    !/Trail running/.test(facts.split('\n')[0]) && !/Nightlife/.test(facts));
  check('derived facts report no overlap plainly',
    /Values in common: none/.test(facts));
  check('derived facts state both scores and the gap for every trait',
    /openness: Sam 62, Jordan 80 \(moderate gap, 18 points\)/.test(facts) &&
    /conscientiousness: Sam 71, Jordan 40 \(wide gap, 31 points\)/.test(facts) &&
    /agreeableness: Sam 77, Jordan 55 \(moderate gap, 22 points\)/.test(facts));
  check('derived facts count MBTI axis agreement',
    /MBTI ENFJ vs INTJ — shares 2 of 4 axes/.test(facts) &&
    /Same: N\/S \(N vs N\), J\/P \(J vs J\)/.test(facts) &&
    /Differs: E\/I \(E vs I\), T\/F \(F vs T\)/.test(facts));
  check('derived facts surface the weaker confidence',
    /Sam 70\/100, Jordan 45\/100/.test(facts));

  // A card that predates a field, or a model that returned a partial one, must
  // not take the comparison down with it.
  check('derived facts survive empty cards', typeof prompts.derivedFacts({}, {}) === 'string');
  check('derived facts skip MBTI when a type is Uncertain',
    !/MBTI/.test(prompts.derivedFacts({ ...left, mbti: 'Uncertain' }, right)));

  const blocks = prompts.compatibilityBlocks(left, right, 'platonic');
  check('the compatibility turn carries the derived facts',
    blocks[0].text.includes('<derived_facts>') && blocks[0].text.includes('shares 2 of 4 axes'));
  check('the compatibility turn names the dimensions to score',
    prompts.COMPATIBILITY_MODES.platonic.dimensions.every(d => blocks[0].text.includes(d)));
}

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
