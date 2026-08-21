// Live check against whichever provider is configured — Grok, Gemini or
// Anthropic. Skips cleanly without credentials, so it is safe to run in CI.
//
//   XAI_API_KEY=...       node tools/livetest.mjs
//   GEMINI_API_KEY=...    node tools/livetest.mjs
//   ANTHROPIC_API_KEY=... node tools/livetest.mjs
//   PSYCHEAI_PROVIDER=anthropic node tools/livetest.mjs   # when more than one is set
//
// This is the one thing the mock-mode suites cannot cover: that the prompts
// and schemas are actually *accepted by the API* and that the model fills
// every field. It makes real calls and costs real tokens.
//
// PSYCHEAI_LIVETEST=premium runs only the paid call — the cheap way to check
// that the paid schema still compiles, which is the failure this file exists
// to catch early. The paid call always uses Gemini regardless of which
// provider above is configured for the free report, so this needs
// GEMINI_API_KEY specifically:
//
//   GEMINI_API_KEY=... PSYCHEAI_LIVETEST=premium node tools/livetest.mjs
//
// `free` runs only the profile and compatibility calls; the default runs all
// three.
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
    (status.mock ? 'mock mode is on.' : 'no XAI_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY set.') + '\n');
  process.exit(0);
}

for (const file of ['zip.js', 'instagram.js', 'digest.js', 'card.js']) {
  runInThisContext(readFileSync(join(root, 'docs', file), 'utf8'), { filename: file });
}

const engine = provider.active;
const prompts = await import('../lib/prompts.js').then(m => m.default);
// The real selection logic rather than a second copy of it, so this checks the
// engine production would actually use for the paid call. Importing server.js
// does not start a listener.
const server = await import('../server.js').then(m => m.default);

const ONLY = process.env.PSYCHEAI_LIVETEST || 'all';
if (!['all', 'free', 'premium'].includes(ONLY)) {
  console.error('PSYCHEAI_LIVETEST must be "all", "free" or "premium" — got ' + JSON.stringify(ONLY));
  process.exit(2);
}
const runFree = ONLY === 'all' || ONLY === 'free';
const runPaid = ONLY === 'all' || ONLY === 'premium';

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

// Declared out here so the summary below can print whatever ran.
let report = null;
let extraversion = null;
let extraversionEvidence = [];
let payload = '';
let compat = null;

if (runFree) {
  console.log('Provider: ' + status.provider + ' · model: ' + status.model);
  console.log('Sending a ' + digest.coverage.digestChars + '-char digest…');
  const started = Date.now();
  const profile = await engine.analyseProfile(digest);
  console.log('  profile in ' + Math.round((Date.now() - started) / 1000) + 's, ' +
    profile.usage.inputTokens + ' input / ' + profile.usage.outputTokens + ' output tokens');

  // The one place a context cache can actually be confirmed. Everything in the
  // mocked suites proves the request was *shaped* right; only a real call proves
  // Google honoured it. A cold first call reports nothing cached, which is
  // expected — the cache is created by that call for the next one to use — so
  // this runs the analysis twice and reports both.
  if (typeof profile.usage.cachedTokens === 'number') {
    console.log('  cached input on this call: ' + profile.usage.cachedTokens + ' tokens' +
      (profile.usage.cachedTokens ? '' : ' (cold — the cache is created by this call)'));
    const again = await engine.analyseProfile(digest);
    const hit = again.usage.cachedTokens || 0;
    console.log('  second call cached: ' + hit + ' of ' + again.usage.inputTokens + ' input tokens' +
      (hit ? ' — cache is live' : ' — NOT being served from cache, worth investigating'));
  }

  report = profile.data;
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
  // The fixture is deliberately the shape that was being misread, and it now
  // carries the confounder too: 13 threads in the archive but only 3 the reader
  // ever answered, 1 group chat they were added to and never spoke in, 240 likes
  // against 12 posts. An introvert with a few close friends and an inbox full of
  // mail they ignored — which is the account that was coming back scored as an
  // extravert, first off raw message volume and then, once that was corrected,
  // off the raw thread count instead.
  //
  // Read defensively: the evidence check above already reports a missing array
  // as its own failure, and dereferencing one here as well would turn that into
  // a crash that takes the rest of the run — including the compatibility call —
  // down with it.
  extraversion = (report.bigFive.extraversion || {}).score;
  extraversionEvidence = (report.bigFive.extraversion || {}).evidence || [];
  check('a narrow, lurk-heavy account is not scored as an extravert',
    Number.isFinite(extraversion) && extraversion <= 65,
    extraversion + '/100 — 3 of 13 threads answered, 0 of 1 groups spoken in, ' +
    '240 likes against 12 posts');
  // The specific way it went wrong the second time: the archive's 13 threads
  // read as reach when only 3 of them were ever answered.
  check('the raw thread count is not cited as evidence of reach',
    !extraversionEvidence.some(e => /\b13\b/.test(e)),
    JSON.stringify(extraversionEvidence));
  // And the third: the fixture has no group chats the reader spoke in, which is
  // the ordinary result on these platforms rather than a sign of anything. Group
  // life happens on WhatsApp and in rooms, neither of which is in this export,
  // so an empty count is not a finding and must not be offered as one. The
  // introvert read here has to rest on what is present — 3 of 13 threads
  // answered, 240 likes against 12 posts — not on a blank.
  check('an empty group-chat count is not cited as evidence of introversion',
    !extraversionEvidence.some(e => /group/i.test(e)),
    JSON.stringify(extraversionEvidence));
  check('the E/I axis reads introvert on that same evidence',
    /^I/.test(report.mbti.type) || report.mbti.type === 'Uncertain',
    report.mbti.type);
  // The two fields describe one trait and sit side by side in the summary card,
  // so a score of 62 above the letter I reads as the report arguing with itself.
  // The prompt makes that numeric, and this is the only place the rule can be
  // confirmed against a model rather than against the prompt's own wording.
  const eiAxis = (report.mbti.letters || []).find(l => l && /E\/?I/i.test(l.axis || ''));
  if (Number.isFinite(extraversion) && eiAxis) {
    const letter = String(eiAxis.choice || '').toUpperCase();
    const agrees = extraversion >= 55 ? letter === 'E'
      : extraversion <= 45 ? letter === 'I'
      : letter === 'E' || letter === 'I';
    check('the E/I letter agrees with the extraversion score',
      agrees, 'extraversion ' + extraversion + ' with letter ' + letter);
    check('and a middle-band score is hedged rather than asserted',
      extraversion < 46 || extraversion > 54 || eiAxis.strength === 'slight',
      'extraversion ' + extraversion + ', strength ' + eiAxis.strength);
    // The same blank barred from the Big Five evidence is barred here: the axis
    // reasoning is where it tended to reappear once the trait evidence was clean.
    check('the axis reasoning does not fall back on the empty group count',
      !/group/i.test(String(eiAxis.why || '')), String(eiAxis.why || '').slice(0, 140));
  }
  // A score is only as good as its reasoning: the correction is meant to move
  // the model off raw volume, so the evidence it cites should not be a message
  // count dressed up as sociability.
  check('the extraversion evidence is not just a message count',
    extraversionEvidence.length > 0 &&
    !extraversionEvidence.every(e => /messag|dm\b/i.test(e)),
    JSON.stringify(extraversionEvidence));

  // Whose life the captions describe. The fixture carries two captions in the
  // shape that was being misread — a named @handle owning the job in one and the
  // car in the other, with the account holder present only as the person who
  // wrote it down. Nothing in this export says the reader codes, founds
  // companies, or owns a vintage Toyota.
  //
  // Checked across the whole report rather than one section, because the damage
  // is that a borrowed fact propagates: into interests, into the essence pick,
  // into the card, and from there through a QR code into a compatibility report
  // about somebody who was never asked.
  const whole = JSON.stringify(report).toLowerCase();
  check('the reader is not given somebody else\'s job off a caption they wrote',
    !/\b(saas|startup founder|founded)\b/.test(whole),
    (/.{60}(saas|startup founder|founded).{60}/.exec(whole) || ['no match'])[0]);
  check('the reader is not given somebody else\'s car off a caption they wrote',
    !/vintage car|car collector|\bmr2\b|supercharger/.test(whole),
    (/.{60}(vintage car|car collector|mr2|supercharger).{60}/.exec(whole) || ['no match'])[0]);
  // The handles belong to other people and must not be quoted back as the
  // reader's own doing — naming them at all in a report they may hand to
  // somebody drags in a person who never agreed to any of this.
  check('neither third party is named anywhere in the report',
    !whole.includes('mokkzy') && !whole.includes('yuhanchong'),
    (/.{60}(mokkzy|yuhanchong).{60}/.exec(whole) || ['no match'])[0]);
  // The empty group-chat count again, across the whole report rather than the
  // one evidence list — an absence read as a finding tends to surface as a line
  // of prose in the behaviour section rather than as a cited number.
  check('an empty group-chat count is not leaned on anywhere in the report',
    !/no group|zero group|not in any group|absence of group|never.{0,20}group chat/i.test(whole),
    (/.{70}group.{70}/.exec(whole) || ['no mention'])[0]);

  const card = globalThis.PsycheCard.shape(report.card);
  payload = await globalThis.PsycheCard.encodeCard(card);
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

  // One basis, not three. The reader picks romantic, family/friends or
  // professional before the call and the report answers that one in full —
  // this used to send no mode at all and then read `compat.romantic` and
  // `compat.platonic` off the result, which is a shape the schema stopped
  // producing when the basis picker landed. It failed here every run, before
  // ever reaching anything below it.
  console.log('Comparing the two cards…');
  compat = (await engine.analyseCompatibility(card, other, 'romantic')).data;

  check('the report answers the basis it was asked for',
    compat.mode === 'romantic', compat.mode);
  check('it is scored, in range, and banded',
    Number.isInteger(compat.score) && compat.score >= 0 && compat.score <= 100 &&
    typeof compat.band === 'string' && compat.band.length > 0,
    compat.score + ' (' + compat.band + ')');
  check('every dimension it scored is evidenced',
    (compat.dimensions || []).length > 0 &&
    compat.dimensions.every(d => Number.isInteger(d.score) && (d.evidence || []).length > 0),
    (compat.dimensions || []).map(d => d.name + ' ' + d.score).join(' | '));
  check('each person gets their own advice',
    (compat.howToPartner.forA || []).length > 0 && (compat.howToPartner.forB || []).length > 0);
  check('the report names both people',
    JSON.stringify(compat).includes(card.name) && JSON.stringify(compat).includes('Jordan'));
  check('caveats are stated', typeof compat.caveats === 'string' && compat.caveats.length > 20);
}

// ---------- the paid call ----------
//
// The gap this closes: the paid analysis is fixed to one provider regardless
// of which one the free report uses, and until now it was the only call with
// no live coverage at all. It broke in production while that provider was
// Claude — the schema's compiled sampling grammar was refused with a 400 on
// every paid run, after the reader had been charged — and nothing in either
// mocked suite could have seen it, because neither talks to the real API.
//
// `constrained` is the check that matters most on a provider that reports it.
// lib/claude.js falls back to an unconstrained call when its compiled grammar
// is refused, which rescues the reader but silently drops the API's guarantee
// that the shape is right, so a green run that fell back is not the same as a
// green run and is reported either way rather than inferred from the absence
// of an error. lib/gemini.js — the paid call's current provider — has no such
// fallback and never sets this field; see the guard below.
let premium = null;
let paidWasConstrained = null;
if (runPaid) {
  const paidEngine = server.premiumEngine();
  if (!paidEngine) {
    console.log('\nPremium call skipped — no GEMINI_API_KEY set (the paid call always uses Gemini).');
  } else {
    console.log('\nSending the same digest to the paid call (' + paidEngine.MODEL + ')…');
    const paidStarted = Date.now();
    const result = await paidEngine.analysePremium(digest);
    premium = result.data;
    paidWasConstrained = result.constrained;
    console.log('  premium in ' + Math.round((Date.now() - paidStarted) / 1000) + 's, ' +
      result.usage.inputTokens + ' input / ' + result.usage.outputTokens + ' output tokens');

    // The headline result. `false` means the schema was refused and the prompt
    // carried it instead — the report is still usable, but the paid schema has
    // grown past what the API will compile and wants deduplicating again.
    //
    // Only asserted when the provider actually reports it: this ladder is
    // lib/claude.js's own fallback for a compiled-grammar refusal, which is
    // where `constrained` comes from, and lib/gemini.js has no equivalent —
    // its `responseJsonSchema` either compiles or the call fails outright, so
    // it never sets the field at all. `result.constrained !== false` would
    // read `undefined` as "compiled" and pass on Gemini regardless of what
    // actually happened, which is a check that cannot fail rather than one
    // that is currently green — so it is skipped rather than asserted for a
    // provider that does not report it, matching what the print line below
    // already says.
    if (result.constrained !== undefined) {
      check('the paid schema compiled — the API enforced it rather than falling back',
        result.constrained !== false,
        result.constrained === false
          ? 'FELL BACK: the compiled grammar was refused, so nothing enforced the shape'
          : 'enforced');
    }

    check('every paid section came back',
      Object.keys(prompts.PREMIUM_SCHEMA.properties).every(key => key in premium),
      Object.keys(premium).join(','));

    // All six, named, and none of them skipped. The schema requires them, so a
    // miss here means the schema was not enforced — which is exactly the state
    // the fallback path leaves things in.
    const dimensions = prompts.WELLNESS_DIMENSIONS.map(([key]) => key);
    check('all six wellness dimensions are present',
      dimensions.every(key => premium.wellness && premium.wellness[key]),
      dimensions.filter(key => !(premium.wellness || {})[key]).join(',') || 'all present');
    check('every dimension used a real band and a real confidence level',
      dimensions.every(key => {
        const facet = (premium.wellness || {})[key] || {};
        return prompts.WELLNESS_BANDS.includes(facet.band) &&
          prompts.CONFIDENCE_LEVELS.includes(facet.confidence);
      }),
      dimensions.map(key => key + '=' + ((premium.wellness || {})[key] || {}).band).join(' '));
    check('every dimension cites evidence rather than asserting',
      dimensions.every(key => {
        const facet = (premium.wellness || {})[key] || {};
        return Array.isArray(facet.evidence) && facet.evidence.length > 0;
      }));

    // The rule the whole section is built around, checked against a real model
    // rather than against the prompt's own wording — the only place it can be.
    const wellnessText = JSON.stringify(premium.wellness || {});
    check('the wellness read produced no score, index or rating',
      !/\b\d+\s*\/\s*(?:5|10|100)\b/.test(wellnessText) && !/"score"/.test(wellnessText) &&
      !/\b\d{1,3}\s*%/.test(wellnessText),
      (/.{50}(\d+\s*\/\s*(?:5|10|100)|\d{1,3}\s*%).{50}/.exec(wellnessText) || ['clean'])[0]);
    // The hard limit with the most to lose. The prompt bans naming a condition
    // however the reader framed the request; this is where that lands or does
    // not. Scoped to the model's own words — the app's fixed caveat is not in
    // this payload, so nothing here is allowed to say "diagnosis" at all.
    const clinical = ['depression', 'depressed', 'anxiety disorder', 'bipolar', 'ADHD', 'autism',
      'PTSD', 'OCD', 'insomnia', 'diagnos', 'mental illness', 'clinically', 'burnout syndrome'];
    const named = clinical.filter(word => new RegExp(word, 'i').test(wellnessText));
    check('the wellness read names no clinical condition', named.length === 0, named.join(', '));

    check('the attachment read shows its working, not just a label',
      Boolean(premium.attachment && premium.attachment.style && premium.attachment.why) &&
      (premium.attachment.derivedFrom || []).length > 0,
      premium.attachment && premium.attachment.style);
    check('and it is labelled as a guess',
      Boolean(premium.attachment && /guess|tentative|cannot be read reliably|not reliable/i
        .test(premium.attachment.caveat || '')),
      premium.attachment && premium.attachment.caveat);

    const actions = (premium.careerAssessment || {}).actions || [];
    check('the career coaching names an edge with evidence behind it',
      Boolean(premium.careerAssessment && premium.careerAssessment.edge &&
        premium.careerAssessment.edge.headline) &&
      ((premium.careerAssessment.edge || {}).evidence || []).length > 0);
    check('its actions carry real horizons',
      actions.length > 0 && actions.every(a => prompts.CAREER_HORIZONS.includes(a.horizon)),
      actions.map(a => a.horizon).join(' | '));
    // At least one has to be startable now, or the section is a wish list.
    check('at least one action is startable this week',
      actions.some(a => a.horizon === 'this week'),
      actions.map(a => a.horizon).join(' | '));

    check('the roast filled both of its halves',
      typeof premium.harsh === 'string' && premium.harsh.length > 200 &&
      typeof premium.advice === 'string' && premium.advice.length > 200,
      (premium.harsh || '').length + ' / ' + (premium.advice || '').length + ' chars');
    // The roast is licensed to drop the softening, not the ban. It is the most
    // likely place a condition gets named, precisely because it is the section
    // told to be unkind.
    const roastNamed = clinical.filter(word =>
      new RegExp(word, 'i').test(String(premium.harsh) + String(premium.advice)));
    check('and named no clinical condition either, despite being told to be harsh',
      roastNamed.length === 0, roastNamed.join(', '));
    // Third parties are barred from the paid call as firmly as the free one.
    const paidWhole = JSON.stringify(premium).toLowerCase();
    check('no third party from the fixture is named in the paid sections',
      !paidWhole.includes('mokkzy') && !paidWhole.includes('yuhanchong'),
      (/.{60}(mokkzy|yuhanchong).{60}/.exec(paidWhole) || ['no match'])[0]);
  }
}

console.log('\nPsycheAI live test (' + status.provider + ' · ' + status.model + ')');
if (report) {
  console.log('  QR payload    : ' + payload.length + ' chars');
  console.log('  big five      : ' + Object.entries(report.bigFive).map(([k, v]) => k.slice(0, 4) + ' ' + v.score).join('  '));
  console.log('  mbti          : ' + report.mbti.type + ' (' + report.mbti.confidence + ')');
  console.log('  extraversion  : ' + extraversion + '/100 — ' + extraversionEvidence.join(' | '));
  console.log('  confidence    : ' + report.confidence.score + ' (' + report.confidence.level + ')');
}
if (compat) {
  console.log('  compatibility : ' + compat.mode + ' ' + compat.score + '/100 (' + compat.band + ')');
}
// Printed rather than only checked, because this is the line somebody runs
// this command to read: whether the paid schema is still small enough for the
// API to compile, or whether the fallback is quietly carrying every paid run.
if (premium) {
  console.log('  wellness      : ' + prompts.WELLNESS_DIMENSIONS
    .map(([key]) => key.slice(0, 5) + ' ' + ((premium.wellness || {})[key] || {}).band).join('  '));
  console.log('  attachment    : ' + (premium.attachment || {}).style);
  console.log('  paid schema   : ' + (paidWasConstrained === false
    ? 'REFUSED — the fallback generated this, nothing enforced the shape'
    : paidWasConstrained === true ? 'compiled and enforced by the API'
      : 'not reported by this provider'));
}

if (failures.length) {
  console.error('\n' + failures.length + ' failed, ' + passed + ' passed:');
  for (const failure of failures) console.error('  ✗ ' + failure);
  process.exit(1);
}
console.log('\n  ' + passed + ' live checks passed\n');
