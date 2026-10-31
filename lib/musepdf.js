// A Muse report's PDF, made here when the plugin saves the report, so Muse
// can hand it over in the chat (README "Reads from Muse": "The PDF in the
// chat"). It is the same document the page downloads: the page's own PDF
// maker (docs/pdf.js) and vocabulary (docs/copy.js), fed the report the way
// the page adopts it (docs/reportshape.js, museProfile), run here in a sandbox
// of their own. The PDF is locked with the read's key like the read itself
// (lib/museimport.js sealPdf) and kept no longer than the read.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DOCS = path.join(__dirname, '..', 'docs');
let sandbox = null;

function load() {
  if (sandbox) return sandbox;
  const context = vm.createContext({ Blob, TextEncoder, TextDecoder, console, Math, Date, JSON, Intl });
  for (const file of ['copy.js', 'card.js', 'reportshape.js', 'pdf.js']) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, file), 'utf8'), context, { filename: file });
  }
  sandbox = context;
  return context;
}

/** "Psyche Report - Jared Sia - 29102026.pdf", as the page names it. */
function fileName(name, now = new Date()) {
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const who = String(name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim() || 'You';
  return `Psyche Report - ${who} - ${dd}${mm}${now.getUTCFullYear()}.pdf`;
}

/**
 * The PDF of a Muse report (the import bundle's data) as a Buffer.
 * Resolves to null if it can't be made; the read itself is unaffected.
 */
async function build(data, name, now = new Date()) {
  try {
    const ctx = load();
    const profile = ctx.PsycheReportShape.museProfile(data, name, ctx.PsycheCopy, ctx.PsycheCard);
    const date = now.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const blob = ctx.PsychePDF.build(profile.report, profile.card, {
      date, model: 'Muse', premiumModel: profile.premiumAnalysis ? 'Muse' : '', premiumDate: profile.premiumAnalysis ? date : '',
      history: [], asked: [], unlocked: ctx.PsycheReportShape.unlockedSections(profile), build: '',
      sources: [ctx.PsycheCopy.TEXT.sourceInstagram], counted: null,
    });
    return Buffer.from(await blob.arrayBuffer());
  } catch (error) {
    console.error('[musepdf] could not build the PDF:', error && error.message);
    return null;
  }
}

// ---------- a Muse Sync's PDF ----------
//
// The Sync the plugin keeps for two people (COMPATIBILITY_SCHEMA, platonic),
// as the same PDF My Syncs downloads (docs/pdf.js buildCompatibility). Made
// on request and sent straight back: nothing is kept here (README "A Muse
// Sync as a PDF").

const shortName = name => String(name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40);
const SYNC_TEXT = (r, n) => String(r || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** "Psyche Sync - Mei & Ana - 29102026.pdf". */
function syncFileName(a, b, now = new Date()) {
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `Psyche Sync - ${shortName(a) || 'You'} & ${shortName(b) || 'Them'} - ${dd}${mm}${now.getUTCFullYear()}.pdf`;
}

/** The written Sync, kept to the fields and lengths the PDF lays out. */
function syncReport(r) {
  const points = list => (Array.isArray(list) ? list : []).slice(0, 3).map(p => ({
    title: SYNC_TEXT(p && p.title, 80), detail: SYNC_TEXT(p && p.detail, 400),
    evidence: (Array.isArray(p && p.evidence) ? p.evidence : []).slice(0, 3).map(e => SYNC_TEXT(e, 200)).filter(Boolean),
  })).filter(p => p.title && p.detail);
  const tips = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).map(t => SYNC_TEXT(t, 240)).filter(Boolean);
  const play = (r && r.howToPartner) || {};
  return {
    mode: 'platonic', summary: SYNC_TEXT(r && r.summary, 240), align: points(r && r.align), differ: points(r && r.differ),
    howToPartner: { forA: tips(play.forA, 3), forB: tips(play.forB, 3), together: tips(play.together, 3) }, caveats: SYNC_TEXT(r && r.caveats, 400),
  };
}

/** The Sync's PDF as a Buffer, written to a (the viewer) about b; null if it can't be made. */
async function buildSync(report, a, b, now = new Date()) {
  try {
    const r = syncReport(report);
    if (!r.summary || !r.align.length) return null;
    const ctx = load();
    const T = ctx.PsycheCopy.TEXT;
    const blob = ctx.PsychePDF.buildCompatibility(r, {
      a: shortName(a) || 'You', b: shortName(b) || 'Them', modeLabel: T.syncName, stanceLabel: '', heading: T.compatRelate,
      date: now.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }), model: 'Muse',
    });
    return Buffer.from(await blob.arrayBuffer());
  } catch (error) {
    console.error('[musepdf] could not build the Sync PDF:', error && error.message);
    return null;
  }
}

// ---------- the report in short, for the chat ----------
//
// One line per section of the report, in its order (the PDF's "Inside this
// report"), each the section's own conclusion in its own words: a name, a
// title or a first sentence, never a retelling. Muse shows it under the card,
// so someone in Muse knows what the PDF holds without opening it.

const firstSentence = text => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.{20,240}?[.!?](?=\s|$)/);
  return m ? m[0] : t.slice(0, 200);
};
const listOf = items => {
  const xs = items.filter(Boolean);
  return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
};
const label = text => String(text || '').split(':')[0].trim();

// A placeholder copied from the schema's own wording ("Kind of work: why")
// is not a kind of work: it's dropped rather than shown.
const PLACEHOLDER = /^kind of work$/i;

// Each section is its points, one fact a bullet ("MBTI: …", "Big Five: …",
// "Wellbeing: …"), and finding is the same points as one paragraph. Muse shows
// the sections collapsed, so each carries the report's conclusions in full:
// names, titles and headlines, never a detail paragraph or the evidence.
function sections(report, Copy) {
  const r = report || {};
  const S = Copy.STRUCTURED || {};
  const out = [];
  const add = (title, points) => {
    const ps = points.filter(Boolean);
    if (ps.length) out.push({ title, points: ps, finding: ps.join(' ') });
  };
  const stop = t => String(t || '').trim().replace(/[.]?$/, '.');
  const titles = (list, n) => (Array.isArray(list) ? list : []).map(x => x && (x.title || x.headline)).filter(Boolean).slice(0, n);
  const essence = r.essence || {};
  const mbti = r.mbti || {};
  const who = [essence.character, mbti.type && (mbti.type + (mbti.nickname ? ' (' + mbti.nickname + ')' : ''))].filter(Boolean).join(' · ');
  add('Overview', [
    who ? who + '.' : '',
    r.card && r.card.headline ? stop(r.card.headline) : '',
    r.summary ? firstSentence(r.summary) : '',
    ...(r.patterns || []).filter(p => p && p.name).slice(0, 3)
      .map(p => 'Pattern: ' + p.name + (p.line ? ' — ' + firstSentence(p.line) : '.')),
  ]);

  const five = r.bigFive || {};
  const traits = { openness: 'Openness', conscientiousness: 'Conscientiousness', extraversion: 'Extraversion', agreeableness: 'Agreeableness', neuroticism: 'Emotional sensitivity' };
  const scored = Object.keys(traits).filter(k => five[k] && Number.isFinite(Number(five[k].score)))
    .sort((a, b) => Math.abs(five[b].score - 50) - Math.abs(five[a].score - 50))
    .map(k => traits[k] + ' ' + Math.round(five[k].score) + (five[k].band ? ' (' + five[k].band + ')' : ''));
  const letters = (mbti.letters || []).filter(l => l && l.choice).map(l => l.choice + (l.strength ? ' ' + String(l.strength).toLowerCase() : ''));
  const W = r.wellness || {};
  const bands = {};
  for (const [k, label] of Object.entries({ lifeTrajectory: 'life direction', outlook: 'outlook', socialConnection: 'connection', cognitiveLoad: 'mental load', meaning: 'meaning' })) {
    const band = W[k] && W[k].band;
    if (band && band !== 'not enough evidence') (bands[band] = bands[band] || []).push(label);
  }
  const bandLine = Object.entries(bands).map(([band, xs]) => band + ' on ' + listOf(xs)).join('; ');
  add('Who you are', [
    mbti.type ? 'MBTI: ' + mbti.type + (letters.length ? ' (' + letters.join(', ') + ')' : '') + '.' : '',
    scored.length ? 'Big Five: ' + scored.join(', ') + '.' : '',
    W.overall ? 'Wellbeing: ' + firstSentence(W.overall) : '',
    bandLine ? 'Wellbeing by area: ' + bandLine + '.' : '',
  ]);

  const motives = (r.topMotivators || []).map(k => (S.motivators && S.motivators[k] && S.motivators[k].label) || k).slice(0, 3);
  const values = (r.values || []).map(v => v && v.value).filter(Boolean).slice(0, 4);
  const interests = (r.interests || []).map(i => i && i.name).filter(Boolean).slice(0, 5);
  const beliefs = (r.beliefs || []).map(b => b && b.belief).filter(Boolean).slice(0, 3);
  add('What drives you', [
    motives.length ? 'Motivated most by: ' + listOf(motives) + '.' : '',
    r.motivators && r.motivators.reading ? firstSentence(r.motivators.reading) : '',
    values.length ? 'Values: ' + values.join('; ') + '.' : '',
    interests.length ? 'Interests: ' + interests.join('; ') + '.' : '',
    beliefs.length ? 'Beliefs: ' + beliefs.join('; ') + '.' : '',
  ]);

  const rel = r.relationship || {};
  const love = rel.loveLanguages || {};
  const primary = side => ((love[side] || []).find(l => l && l.strength === 'primary') || (love[side] || [])[0] || {}).language;
  const giving = primary('giving') === 'Receiving gifts' ? 'Giving gifts' : primary('giving');
  const attachment = r.attachment && r.attachment.style;
  const ideal = r.idealPartner || {};
  const relStrong = titles(rel.strengths, 3), relWeak = titles(rel.weaknesses, 3);
  const needs = titles(ideal.needs, 4), careful = titles(ideal.carefulOf, 3);
  add('How you connect', [
    primary('receiving') ? 'Love language: you feel cared for through ' + primary('receiving').toLowerCase() + (giving ? ' and show care through ' + giving.toLowerCase() : '') + '.' : '',
    attachment ? 'Attachment: ' + stop(attachment) : '',
    relStrong.length ? 'In relationships, at your best: ' + relStrong.join('; ') + '.' : '',
    relWeak.length ? 'Watch for: ' + relWeak.join('; ') + '.' : '',
    needs.length ? 'What you need from a partner: ' + needs.join('; ') + '.' : '',
    careful.length ? 'Be careful of: ' + careful.join('; ') + '.' : '',
    ideal.summary ? 'Best partner: ' + firstSentence(ideal.summary) : '',
  ]);

  const career = r.careerAssessment || {};
  const work = r.career || {};
  const fit = career.fit || {};
  const suits = (fit.suits || []).map(label).filter(x => x && !PLACEHOLDER.test(x)).slice(0, 3);
  const draining = (fit.draining || []).map(label).filter(x => x && !PLACEHOLDER.test(x)).slice(0, 2);
  const head = k => career[k] && career[k].headline ? stop(career[k].headline) : '';
  add('How you work', [
    head('edge') ? 'Your edge: ' + head('edge') : '',
    work.workStyle ? 'Work style: ' + firstSentence(work.workStyle) : '',
    titles(work.strengths, 3).length ? 'Strengths at work: ' + titles(work.strengths, 3).join('; ') + '.' : '',
    head('underused') ? 'Underused: ' + head('underused') : '',
    head('holdingBack') ? 'Holding you back: ' + head('holdingBack') : '',
    suits.length ? 'Suits you: ' + suits.join('; ') + '.' : '',
    draining.length ? 'Drains you: ' + draining.join('; ') + '.' : '',
  ]);

  const dev = r.development || {};
  const build = titles(dev.buildOn, 2), grow = titles(dev.develop, 2);
  const counter = ((dev.develop || [])[0] || {}).counterMove;
  // The plan, one step a horizon in the report's own order: career actions,
  // then the develop areas' own steps, then the wellbeing suggestions.
  const plan = [];
  const seen = new Set();
  const steps = [...(career.actions || []), ...[].concat(...(dev.develop || []).map(d => (d && d.actions) || []))];
  for (const h of ['this week', 'this quarter', 'this year']) {
    const a = steps.find(x => x && String(x.horizon || '').toLowerCase() === h && (x.title || x.step));
    if (!a) continue;
    const t = String(a.title || a.step).trim();
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    plan.push(h.charAt(0).toUpperCase() + h.slice(1) + ': ' + stop(t));
  }
  const care = titles(W.suggestions, 2);
  add('Putting it together', [
    build.length ? 'Build on: ' + build.join('; ') + '.' : '',
    grow.length ? 'Work on: ' + grow.join('; ') + '.' : '',
    counter ? 'When it shows: ' + firstSentence(counter) : '',
    ...plan,
    care.length ? 'For your wellbeing: ' + care.join('; ') + '.' : '',
  ]);

  if (r.bonus && r.bonus.harsh) add('Appendix', ['A deliberately harsh roast, then what an honest friend would tell you.']);
  return out;
}

// ---------- the report in the chat ----------
//
// The whole report as Muse draws it in one widget (psycheai-app README "The
// report in the chat"): its conclusions, scores and one-line readings, never
// the evidence, the "why" paragraphs, the scoring tables or the caveats. Each
// text is a title, a headline or a first sentence the report already wrote;
// the MBTI letters' lines and the motivators' meanings are fixed vocabulary.
const LETTER_LINES = {
  E: 'You get your energy from people and action.',
  I: 'You get your energy from time alone or with a few people you know well.',
  N: 'You look for the idea and where it leads before the detail.',
  S: 'You trust what is concrete, tested and in front of you.',
  T: 'You decide by testing the argument, then weigh the people.',
  F: 'You decide by what it means for the people involved.',
  J: 'You like things settled, planned and closed.',
  P: 'You keep options open and plan close to the day.',
};
const WELLBEING_AREAS = { lifeTrajectory: 'Direction', outlook: 'Outlook', socialConnection: 'Connection', cognitiveLoad: 'Mental load', meaning: 'Meaning' };

function view(report, Copy) {
  const r = report || {};
  const S = Copy.STRUCTURED || {};
  const list = x => (Array.isArray(x) ? x : []);
  const titles = (xs, n) => list(xs).map(x => x && (x.title || x.headline)).filter(Boolean).slice(0, n);
  const one = t => (t ? firstSentence(t) : '');
  const essence = r.essence || {};
  const mbti = r.mbti || {};
  const five = r.bigFive || {};
  const traits = Copy.TRAIT_LABELS || {};
  const W = r.wellness || {};
  const rel = r.relationship || {};
  const love = rel.loveLanguages || {};
  const ideal = r.idealPartner || {};
  const career = r.careerAssessment || {};
  const dev = r.development || {};
  const conf = r.confidence || {};
  const lang = (xs, giving) => list(xs).filter(l => l && l.language).slice(0, 3).map(l => ({
    language: giving && l.language === 'Receiving gifts' ? 'Giving gifts' : l.language,
    strength: l.strength || 'secondary', line: one(l.inPractice),
  }));
  const fit = xs => list(xs).map(label).filter(x => x && !PLACEHOLDER.test(x)).slice(0, 3);
  const steps = [...list(career.actions), ...[].concat(...list(dev.develop).map(d => list(d && d.actions)))];
  const plan = [];
  for (const h of ['this week', 'this quarter', 'this year']) {
    const a = steps.find(x => x && String(x.horizon || '').toLowerCase() === h && (x.title || x.step));
    if (a) plan.push({ when: h.charAt(0).toUpperCase() + h.slice(1), step: String(a.title || a.step).trim() });
  }
  return {
    overview: {
      character: essence.character || '', type: mbti.type || '', nickname: mbti.nickname || '',
      headline: (r.card && r.card.headline) || '', summary: one(r.summary),
      patterns: list(r.patterns).filter(p => p && p.name).slice(0, 3).map(p => ({ name: p.name, line: one(p.line) })),
    },
    whoYouAre: {
      mbti: list(mbti.letters).filter(l => l && l.choice).map(l => ({
        letter: l.choice, name: (Copy.MBTI_POLES && Copy.MBTI_POLES[l.choice] && Copy.MBTI_POLES[l.choice].name) || l.choice,
        strength: String(l.strength || '').toLowerCase(), line: LETTER_LINES[l.choice] || '',
      })),
      bigFive: Object.keys(traits).filter(k => five[k] && Number.isFinite(Number(five[k].score)))
        .map(k => ({ trait: traits[k], score: Math.round(five[k].score), line: one(five[k].reading) })),
      wellbeing: {
        summary: one(W.overall),
        areas: Object.keys(WELLBEING_AREAS).filter(k => W[k] && W[k].band && W[k].band !== 'not enough evidence')
          .map(k => ({ area: WELLBEING_AREAS[k], band: W[k].band })),
      },
    },
    whatDrivesYou: {
      motivators: list(r.motivators && r.motivators.scores).filter(m => m && m.value && Number.isFinite(Number(m.score))).map(m => {
        const c = (S.motivators && S.motivators[m.value]) || {};
        return { name: c.label || m.value, score: Math.round(m.score), group: c.group || '', meaning: c.meaning || '' };
      }),
      top: list(r.topMotivators).map(k => (S.motivators && S.motivators[k] && S.motivators[k].label) || k).slice(0, 3),
      reading: one(r.motivators && r.motivators.reading),
      values: list(r.values).map(v => v && v.value).filter(Boolean).slice(0, 4),
      interests: list(r.interests).map(i => i && i.name).filter(Boolean).slice(0, 5),
      beliefs: list(r.beliefs).map(b => b && b.belief).filter(Boolean).slice(0, 3),
    },
    howYouConnect: {
      loveLanguages: { receiving: lang(love.receiving), giving: lang(love.giving, true) },
      attachment: (r.attachment && r.attachment.style) || '',
      atYourBest: titles(rel.strengths, 3), watchFor: titles(rel.weaknesses, 3),
      partnerNeeds: titles(ideal.needs, 4), carefulOf: titles(ideal.carefulOf, 3), bestPartner: one(ideal.summary),
    },
    howYouWork: {
      edge: (career.edge && career.edge.headline) || '', underused: (career.underused && career.underused.headline) || '',
      holdingBack: (career.holdingBack && career.holdingBack.headline) || '',
      strengths: titles(r.career && r.career.strengths, 3), suits: fit(career.fit && career.fit.suits), drains: fit(career.fit && career.fit.draining),
    },
    puttingItTogether: {
      buildOn: titles(dev.buildOn, 2), workOn: titles(dev.develop, 2), whenItShows: one((list(dev.develop)[0] || {}).counterMove),
      plan, wellbeing: titles(W.suggestions, 2),
    },
    confidence: { score: Number.isFinite(Number(conf.score)) ? Math.round(conf.score) : null, level: conf.level || '', basedOn: list(conf.basedOn).slice(0, 4) },
  };
}

/** The whole report for the chat's widget, from the same adopted report as the PDF. */
function chatView(data, name) {
  try {
    const ctx = load();
    const profile = ctx.PsycheReportShape.museProfile(data, name, ctx.PsycheCopy, ctx.PsycheCard);
    return view(Object.assign({}, profile.report, profile.premiumAnalysis || {}), ctx.PsycheCopy);
  } catch (error) {
    console.error('[musepdf] could not lay out the report for the chat:', error && error.message);
    return null;
  }
}

/** The report in short: one line per section, from the same adopted report as the PDF. */
function summary(data, name) {
  try {
    const ctx = load();
    const profile = ctx.PsycheReportShape.museProfile(data, name, ctx.PsycheCopy, ctx.PsycheCard);
    return sections(Object.assign({}, profile.report, profile.premiumAnalysis || {}), ctx.PsycheCopy);
  } catch (error) {
    console.error('[musepdf] could not summarise the report:', error && error.message);
    return [];
  }
}

module.exports = { build, fileName, summary, chatView, buildSync, syncFileName };
