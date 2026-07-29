// End-to-end check of the Kindred pipeline, runnable with `npm test`.
//
// Builds a synthetic Instagram export (a real ZIP, half stored and half
// deflated), then runs it all the way through: unzip → parse → analyse →
// questionnaire pre-fill → profile → QR payload → decode → compatibility
// report. The browser modules are plain scripts that attach to globalThis, so
// they load in Node unchanged.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

import { buildExportZip } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, '..', 'docs');

// ---------- tiny assertion harness ----------

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) { passed++; return; }
  failures.push(label + (detail === undefined ? '' : ' — ' + detail));
}

// Multi-select answers are order-independent; ranked top-3 answers are not.
function sameSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

function near(label, actual, min, max) {
  check(label, actual >= min && actual <= max, 'got ' + actual + ', wanted ' + min + '–' + max);
}

// ---------- load the browser modules ----------

for (const file of ['zip.js', 'lexicon.js', 'questionnaire.js', 'analysis.js', 'codec.js', 'compat.js', 'instagram.js']) {
  runInThisContext(readFileSync(join(docs, file), 'utf8'), { filename: file });
}

const Q = globalThis.KindredQuestions;
const IG = globalThis.KindredInstagram;
const A = globalThis.KindredAnalysis;
const Codec = globalThis.KindredCodec;
const Compat = globalThis.KindredCompat;

// ---------- run ----------

const file = new File([buildExportZip()], 'instagram-export.zip', { type: 'application/zip' });

const signals = await IG.readExports([file], { includeMessages: false });

check('reads posts', signals.counts.posts === 12, 'got ' + signals.counts.posts);
check('reads stories', signals.counts.stories === 30, 'got ' + signals.counts.stories);
check('reads likes', signals.counts.likes === 240, 'got ' + signals.counts.likes);
check('reads comments', signals.counts.comments === 40, 'got ' + signals.counts.comments);
check('reads following', signals.following.length === 180, 'got ' + signals.following.length);
check('reads followers', signals.counts.followers === 320, 'got ' + signals.counts.followers);
check('reads close friends', signals.counts.closeFriends === 6, 'got ' + signals.counts.closeFriends);
check('reads curated topics', signals.topics.length === 6, 'got ' + signals.topics.length);
check('reads ad interests', signals.adInterests.length === 4, 'got ' + signals.adInterests.length);
check('ignores non-JSON media', !signals.files.byRoute.media);
check('repairs mojibake in names', signals.profile.name === 'Aleç', 'got ' + JSON.stringify(signals.profile.name));
check('reads bio', /Trail runner/.test(signals.profile.bio));
check('deflate and stored entries both decoded', signals.files.used >= 9, 'used ' + signals.files.used);

const analysis = A.analyse(signals, { includeMessages: false });

check('produces a confidence figure', analysis.confidence > 0 && analysis.confidence <= 100, 'got ' + analysis.confidence);
check('detects running', analysis.themes.find(t => t.id === 'running').score >= 40,
  'running=' + analysis.themes.find(t => t.id === 'running').score);
check('detects hiking', analysis.themes.find(t => t.id === 'hiking').score >= 35,
  'hiking=' + analysis.themes.find(t => t.id === 'hiking').score);
check('detects family theme', analysis.themes.find(t => t.id === 'family').score >= 35,
  'family=' + analysis.themes.find(t => t.id === 'family').score);
check('does not invent nightlife', analysis.themes.find(t => t.id === 'nightclubs').score < 25,
  'nightclubs=' + analysis.themes.find(t => t.id === 'nightclubs').score);
check('reads the persona as agreeable', analysis.bigFive.agreeableness.score >= 55,
  'agreeableness=' + analysis.bigFive.agreeableness.score);
check('reads the persona as conscientious', analysis.bigFive.conscientiousness.score >= 55,
  'conscientiousness=' + analysis.bigFive.conscientiousness.score);
check('picks an early-bird rhythm', analysis.rhythm.chronotype === 'Early bird', 'got ' + analysis.rhythm.chronotype);
check('every trait carries evidence', Object.values(analysis.bigFive).every(t => t.evidence.length > 0));
check('suggests an MBTI', /^[EI][NS][FT][JP]$/.test(analysis.mbtiSuggestion), 'got ' + analysis.mbtiSuggestion);
check('writes a narrative', analysis.narrative.length >= 5 && analysis.narrative.every(s => s.body.length > 40));
check('pre-fills fitness activities', analysis.prefill.fitness.includes('Running'),
  'got ' + JSON.stringify(analysis.prefill.fitness));
check('pre-fills big five sliders', analysis.prefill.bigfive.openness === analysis.bigFive.openness.score);
check('lists caveats', analysis.caveats.length > 0);

// ---------- profiles ----------

function answersFor(overrides) {
  const answers = Q.emptyAnswers();
  Object.assign(answers, {
    country: 'Singapore',
    education: 'Undergrad',
    religion: 'Christianity',
    occupation: 'software engineer',
    interests: ['Cooking', 'Reading', 'Foodie'],
    fitness: ['Running', 'Hiking', 'Gym'],
    descriptors: ['Kind', 'Hardworking', 'Loyal'],
    priorities: ['Family and relationships', 'Health and physical fitness', 'Learning'],
    mbti: 'ENFJ',
    enneagram: '2 — The Helper',
    qualities: ['Kindness', 'Honesty', 'Loyalty'],
    love_give: ['Acts of service', 'Quality time'],
    love_receive: ['Words of affirmation', 'Quality time'],
    closeness: Q.CLOSENESS[0],
    ingredients: ['Communication', 'Respect', 'Friendship'],
    dealbreakers: ['Infidelity', 'Smoking', 'Gambling'],
  });
  answers.bigfive = { ...analysis.prefill.bigfive };
  answers.habits = { smoking: 'Never', drinking: 'Socially', gambling: 'Never', spending: 'Saver', opposite_friends: 'Some', kids: 'Yes' };
  answers.rhythm = { chronotype: 'Early bird', social_energy: 'A bit of both', planning: 'Planned ahead', conflict: 'Talk it out now' };
  answers.priorities_note = 'Family first, always.';
  return Object.assign(answers, overrides || {});
}

const alec = A.buildProfile(analysis, answersFor(), 'Alec');

// A deliberately contrasting persona, to exercise the low end of the engine.
const jordanAnswers = answersFor({
  country: 'Germany',
  education: 'Post grad',
  religion: 'Atheist',
  occupation: 'nightclub promoter',
  interests: ['Nightclubs', 'Bars', 'Gaming'],
  fitness: ['Dancing'],
  descriptors: ['Spontaneous and adaptable', 'Humorous', 'Adventurous'],
  priorities: ['Career success', 'Becoming rich', 'Freedom and creative expression'],
  mbti: 'ESTP',
  enneagram: '7 — The Enthusiast',
  qualities: ['Ambition', 'Humour', 'Physical attraction'],
  love_give: ['Gifts'],
  love_receive: ['Physical touch'],
  closeness: Q.CLOSENESS[2],
  ingredients: ['Fun', 'Chemistry', 'Physical attraction'],
  dealbreakers: ['Drinking', 'Others'],
});
jordanAnswers.bigfive = { openness: 78, conscientiousness: 24, extraversion: 88, agreeableness: 38, neuroticism: 62 };
jordanAnswers.habits = { smoking: 'Regularly', drinking: 'Regularly', gambling: 'Occasionally', spending: 'Spender', opposite_friends: 'Many', kids: 'No' };
jordanAnswers.rhythm = { chronotype: 'Night owl', social_energy: 'Out and social', planning: 'Spontaneous', conflict: 'Avoid confrontation' };
const jordan = A.buildProfile(analysis, jordanAnswers, 'Jordan');

check('profile keeps free text out of nothing', alec.notes.priorities === 'Family first, always.');
check('profile derives attachment from the closeness answer', alec.attachment === 'secure', 'got ' + alec.attachment);
check('profile derives avoidant attachment', jordan.attachment === 'avoidant', 'got ' + jordan.attachment);
check('profile categorises occupation', alec.background.occupationCategory === 'tech', 'got ' + alec.background.occupationCategory);

// ---------- codec ----------

for (const profile of [alec, jordan]) {
  const payload = Codec.encodeProfile(profile);
  const decoded = Codec.decodeProfile(payload);
  check('QR payload stays scannable in size for ' + profile.name, payload.length <= 160, payload.length + ' chars');
  check('decodes ' + profile.name, !!decoded);
  check('round-trips name for ' + profile.name, decoded.name === profile.name, decoded && decoded.name);
  check('round-trips country for ' + profile.name, decoded.background.country === profile.background.country);
  check('round-trips religion for ' + profile.name, decoded.background.religion === profile.background.religion);
  check('round-trips interests for ' + profile.name,
    sameSet(decoded.interests, profile.interests), JSON.stringify(decoded.interests));
  check('round-trips fitness for ' + profile.name,
    sameSet(decoded.fitness, profile.fitness), JSON.stringify(decoded.fitness));
  check('round-trips descriptors for ' + profile.name,
    JSON.stringify(decoded.descriptors) === JSON.stringify(profile.descriptors));
  check('round-trips priorities for ' + profile.name,
    JSON.stringify(decoded.priorities) === JSON.stringify(profile.priorities));
  check('round-trips dealbreakers for ' + profile.name,
    sameSet(decoded.dealbreakers, profile.dealbreakers), JSON.stringify(decoded.dealbreakers));
  check('preserves ranking order of top-3 answers for ' + profile.name,
    JSON.stringify(decoded.qualities) === JSON.stringify(profile.qualities), JSON.stringify(decoded.qualities));
  check('round-trips big five for ' + profile.name,
    JSON.stringify(decoded.bigFive) === JSON.stringify(profile.bigFive), JSON.stringify(decoded.bigFive));
  check('round-trips attachment for ' + profile.name, decoded.attachment === profile.attachment);
  check('round-trips habits for ' + profile.name,
    JSON.stringify(decoded.habits) === JSON.stringify(profile.habits));
  check('round-trips rhythm for ' + profile.name,
    JSON.stringify(decoded.rhythm) === JSON.stringify(profile.rhythm));
  check('round-trips mbti for ' + profile.name, decoded.mbti === profile.mbti);
  check('round-trips enneagram for ' + profile.name, decoded.enneagram === profile.enneagram);
  check('excludes free text from the QR payload for ' + profile.name,
    !JSON.stringify(decoded).includes('Family first'));
}

check('rejects a foreign QR code', Codec.decodeProfile('https://example.com/not-kindred') === null);
check('rejects a corrupted payload', Codec.decodeProfile(Codec.encodeProfile(alec).slice(0, -3) + 'AAA') === null);
check('extracts a payload from a URL',
  Codec.extractPayload('https://x.github.io/profile/#p=ABC-_123') === 'ABC-_123');

// ---------- compatibility ----------

const decodedJordan = Codec.decodeProfile(Codec.encodeProfile(jordan));
const clash = Compat.buildReport(alec, decodedJordan);

check('scores both modes', Number.isInteger(clash.romantic.total) && Number.isInteger(clash.platonic.total));
check('romantic score in range', clash.romantic.total >= 0 && clash.romantic.total <= 100);
near('mismatched pair scores low romantically', clash.romantic.total, 0, 55);
check('weights sum to 1 for romantic',
  Math.abs(clash.romantic.dimensions.reduce((s, d) => s + d.weight, 0) - 1) < 1e-9);
check('weights sum to 1 for platonic',
  Math.abs(clash.platonic.dimensions.reduce((s, d) => s + d.weight, 0) - 1) < 1e-9);
check('flags the smoking dealbreaker', clash.flags.hard.some(f => f.item === 'Smoking'), JSON.stringify(clash.flags.hard));
check('flags the drinking dealbreaker against Alec', clash.flags.soft.some(f => f.item === 'Drinking'));
check('lists uncheckable dealbreakers', clash.flags.toDiscuss.some(f => f.item === 'Infidelity'));
check('catches the children mismatch',
  clash.romantic.watchOuts.some(w => /children/i.test(w)), JSON.stringify(clash.romantic.watchOuts).slice(0, 200));
check('names the attachment pairing', /avoidant/i.test(clash.attachmentNote), clash.attachmentNote);
check('writes advice for both people',
  clash.romantic.playbook.forA.length >= 2 && clash.romantic.playbook.forB.length >= 2);
check('platonic playbook exists', clash.platonic.playbook.shared.length >= 1);
check('advice names both people',
  clash.romantic.playbook.forA.join(' ').includes('Jordan') || clash.romantic.playbook.forB.join(' ').includes('Alec'));
check('no undefined leaks into the prose',
  !JSON.stringify(clash).includes('undefined'), 'found "undefined" in report');
check('produces conversation starters', clash.conversationStarters.length >= 1);

// Someone who shares every activity but clashes on life direction should
// read clearly better as a friend than as a partner — that divergence is the
// whole point of scoring the two modes separately.
const rileyAnswers = answersFor({
  religion: 'Atheist',
  priorities: ['Career success', 'Becoming rich', 'Freedom and creative expression'],
  closeness: Q.CLOSENESS[2],
  ingredients: ['Fun', 'Chemistry', 'Teamwork'],
  qualities: ['Ambition', 'Humour', 'Intelligence'],
  love_give: ['Gifts'],
  love_receive: ['Physical touch'],
});
rileyAnswers.habits = { ...rileyAnswers.habits, kids: 'No' };
const riley = A.buildProfile(analysis, rileyAnswers, 'Riley');
const friendNotPartner = Compat.buildReport(alec, Codec.decodeProfile(Codec.encodeProfile(riley)));
check('same hobbies, different life plan reads better as friendship',
  friendNotPartner.platonic.total > friendNotPartner.romantic.total + 5,
  'romantic ' + friendNotPartner.romantic.total + ' vs platonic ' + friendNotPartner.platonic.total);
check('interests weigh more in the platonic mode',
  friendNotPartner.platonic.dimensions.find(d => d.id === 'interests').weight >
  friendNotPartner.romantic.dimensions.find(d => d.id === 'interests').weight);
check('attachment weighs more in the romantic mode',
  friendNotPartner.romantic.dimensions.find(d => d.id === 'attachment').weight >
  friendNotPartner.platonic.dimensions.find(d => d.id === 'attachment').weight);

// A near-identical pair should land high on both scales.
const twin = A.buildProfile(analysis, answersFor(), 'Sam');
const match = Compat.buildReport(alec, Codec.decodeProfile(Codec.encodeProfile(twin)));
near('well-matched pair scores high romantically', match.romantic.total, 78, 100);
near('well-matched pair scores high platonically', match.platonic.total, 75, 100);
check('well-matched pair has no hard flags', match.flags.hard.length === 0);
check('well-matched pair still lists things to discuss', match.flags.toDiscuss.length > 0);
check('every dimension is scored', match.romantic.dimensions.every(d => Number.isFinite(d.score)));
check('report is symmetric enough to be stable',
  Math.abs(Compat.buildReport(decodedJordan, alec).romantic.total - clash.romantic.total) <= 2,
  'reversed ' + Compat.buildReport(decodedJordan, alec).romantic.total + ' vs ' + clash.romantic.total);

// ---------- results ----------

console.log('\nKindred self-test');
console.log('  QR payload length : ' + Codec.encodeProfile(alec).length + ' chars');
console.log('  analysis confidence: ' + analysis.confidence + ' (' + analysis.confidenceLabel + ')');
console.log('  big five (IG)     : ' + Object.entries(analysis.bigFive).map(([k, v]) => k.slice(0, 4) + ' ' + v.score).join('  '));
console.log('  clashing pair     : romantic ' + clash.romantic.total + ' / platonic ' + clash.platonic.total);
console.log('  friend-not-partner: romantic ' + friendNotPartner.romantic.total + ' / platonic ' + friendNotPartner.platonic.total);
console.log('  matched pair      : romantic ' + match.romantic.total + ' / platonic ' + match.platonic.total);

if (failures.length) {
  console.error('\n' + failures.length + ' failed, ' + passed + ' passed:');
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\n  ' + passed + ' checks passed\n');
