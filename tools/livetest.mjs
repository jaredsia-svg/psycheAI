// Live check against whichever provider is configured — Gemini or Anthropic.
// Skips cleanly without credentials, so it is safe to run in CI.
//
//   GEMINI_API_KEY=...    node tools/livetest.mjs
//   ANTHROPIC_API_KEY=... node tools/livetest.mjs
//   PSYCHEAI_PROVIDER=anthropic node tools/livetest.mjs   # when both are set
//
// This is the one thing the mock-mode suites cannot cover: that the prompts
// and schemas are actually accepted by the API and that the model fills every
// field. It makes two real calls and costs real tokens.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

import { buildExportZip } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const provider = await import('../lib/provider.js').then(m => m.default);
const status = provider.describe();

if (!status.ready || status.mock) {
  console.log('\n  livetest skipped — ' +
    (status.mock ? 'mock mode is on.' : 'no GEMINI_API_KEY or ANTHROPIC_API_KEY set.') + '\n');
  process.exit(0);
}

for (const file of ['zip.js', 'instagram.js', 'digest.js', 'card.js']) {
  runInThisContext(readFileSync(join(root, 'docs', file), 'utf8'), { filename: file });
}

const engine = provider.active;
const prompts = await import('../lib/prompts.js').then(m => m.default);

let passed = 0;
const failures = [];
const check = (label, ok, detail) => {
  if (ok) passed++;
  else failures.push(label + (detail === undefined ? '' : ' — ' + detail));
};

// Messages included, because that is what the app actually sends: handleFiles
// parses them unconditionally and only strips them if the reader unticks the
// row. Running this without them tested a digest no real user produces, and
// left the whole direct-message half of the prompt — including the breadth
// ratios the extraversion correction turns on — never exercised against a
// real model.
const signals = await globalThis.PsycheInstagram.readExports(
  [new File([buildExportZip()], 'export.zip')], { includeMessages: true });
const digest = globalThis.PsycheDigest.build(signals, { includeMessages: true });

console.log('Provider: ' + status.provider + ' · model: ' + status.model);
console.log('Sending a ' + digest.coverage.digestChars + '-char digest…');
const started = Date.now();
const profile = await engine.analyseProfile(digest);
console.log('  profile in ' + Math.round((Date.now() - started) / 1000) + 's, ' +
  profile.usage.outputTokens + ' output tokens');

const report = profile.data;
check('every top-level section is present',
  Object.keys(prompts.PROFILE_SCHEMA.properties).every(key => key in report),
  Object.keys(report).join(','));
check('big five scores are in range',
  Object.values(report.bigFive).every(t => t.score >= 0 && t.score <= 100));
check('each trait cites evidence',
  Object.values(report.bigFive).every(t => Array.isArray(t.evidence) && t.evidence.length > 0));
check('mbti is a real type', prompts.MBTI_TYPES.includes(report.mbti.type), report.mbti.type);
check('mbti explains all four letters', (report.mbti.letters || []).length === 4);
check('relationship strengths and weaknesses are both filled',
  report.relationship.strengths.length > 0 && report.relationship.weaknesses.length > 0);
check('career strengths and weaknesses are both filled',
  report.career.strengths.length > 0 && report.career.weaknesses.length > 0);
check('confidence is honest about a thin export', report.confidence.score <= 75, String(report.confidence.score));

// The extraversion correction, checked against a real model — which is the
// only place it can be checked at all, since the mock returns a canned report
// and the prompt-guard checks in selftest only prove the words are present,
// not that they land.
//
// The fixture is deliberately the shape that was being misread: 36 messages
// across 3 threads and *no* group threads, 22 distinct people commented on,
// 240 likes against 12 posts. High-ish traffic, narrow reach, heavy lurking —
// an introvert with a few close friends, which was coming back scored as an
// extravert off the message volume alone.
//
// Read defensively: the evidence check above already reports a missing array
// as its own failure, and dereferencing one here as well would turn that into
// a crash that takes the rest of the run — including the compatibility call —
// down with it.
const extraversion = (report.bigFive.extraversion || {}).score;
const extraversionEvidence = (report.bigFive.extraversion || {}).evidence || [];
check('a narrow, lurk-heavy account is not scored as an extravert',
  Number.isFinite(extraversion) && extraversion <= 65,
  extraversion + '/100 — 3 threads, 0 group threads, 240 likes against 12 posts');
check('the E/I axis reads introvert on that same evidence',
  /^I/.test(report.mbti.type) || report.mbti.type === 'Uncertain',
  report.mbti.type);
// A score is only as good as its reasoning: the correction is meant to move
// the model off raw volume, so the evidence it cites should not be a message
// count dressed up as sociability.
check('the extraversion evidence is not just a message count',
  extraversionEvidence.length > 0 &&
  !extraversionEvidence.every(e => /messag|dm\b/i.test(e)),
  JSON.stringify(extraversionEvidence));

const card = globalThis.PsycheCard.shape(report.card);
const payload = await globalThis.PsycheCard.encodeCard(card);
check('the real card fits a scannable QR code',
  payload.length <= globalThis.PsycheCard.COMFORTABLE_PAYLOAD, payload.length + ' chars');
check('the card round-trips', (await globalThis.PsycheCard.decodeCard(payload)) !== null);

const other = {
  ...card,
  name: 'Jordan',
  headline: 'Night-owl promoter who lives out',
  interests: ['Nightlife', 'Dance music', 'Bars'],
  values: ['Career success', 'Freedom'],
  bigFive: { openness: 78, conscientiousness: 24, extraversion: 88, agreeableness: 38, neuroticism: 62 },
  rhythm: 'night owl, out most evenings',
  attachment: 'possibly avoidant (tentative)',
};

console.log('Comparing the two cards…');
const compat = (await engine.analyseCompatibility(card, other)).data;

check('both modes are scored',
  Number.isInteger(compat.romantic.score) && Number.isInteger(compat.platonic.score),
  compat.romantic.score + '/' + compat.platonic.score);
check('scores are in range',
  [compat.romantic.score, compat.platonic.score].every(s => s >= 0 && s <= 100));
check('each person gets their own advice',
  compat.romantic.howToPartner.forA.length > 0 && compat.romantic.howToPartner.forB.length > 0);
check('the report names both people',
  JSON.stringify(compat).includes(card.name) && JSON.stringify(compat).includes('Jordan'));
check('caveats are stated', typeof compat.caveats === 'string' && compat.caveats.length > 20);

console.log('\nPsycheAI live test (' + status.provider + ' · ' + status.model + ')');
console.log('  QR payload    : ' + payload.length + ' chars');
console.log('  big five      : ' + Object.entries(report.bigFive).map(([k, v]) => k.slice(0, 4) + ' ' + v.score).join('  '));
console.log('  mbti          : ' + report.mbti.type + ' (' + report.mbti.confidence + ')');
console.log('  extraversion  : ' + extraversion + '/100 — ' +
  extraversionEvidence.join(' | '));
console.log('  confidence    : ' + report.confidence.score + ' (' + report.confidence.level + ')');
console.log('  compatibility : romantic ' + compat.romantic.score + ' / platonic ' + compat.platonic.score);

if (failures.length) {
  console.error('\n' + failures.length + ' failed, ' + passed + ' passed:');
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log('\n  ' + passed + ' live checks passed\n');
