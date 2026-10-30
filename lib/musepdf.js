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
// "Wellbeing: …"), and finding is the same points as one paragraph.
function sections(report, Copy) {
  const r = report || {};
  const S = Copy.STRUCTURED || {};
  const out = [];
  const add = (title, points) => {
    const ps = points.filter(Boolean);
    if (ps.length) out.push({ title, points: ps, finding: ps.join(' ') });
  };
  const essence = r.essence || {};
  const mbti = r.mbti || {};
  const patterns = (r.patterns || []).map(p => p && p.name).filter(Boolean).slice(0, 3);
  const who = [essence.character, mbti.type && (mbti.type + (mbti.nickname ? ' (' + mbti.nickname + ')' : ''))].filter(Boolean).join(' · ');
  add('Overview', [
    who ? who + '.' : '',
    r.card && r.card.headline ? String(r.card.headline).replace(/[.]?$/, '.') : '',
    patterns.length ? 'Your patterns: ' + listOf(patterns) + '.' : '',
  ]);

  const five = r.bigFive || {};
  const traits = { openness: 'Openness', conscientiousness: 'Conscientiousness', extraversion: 'Extraversion', agreeableness: 'Agreeableness', neuroticism: 'Emotional sensitivity' };
  const standout = Object.keys(traits).filter(k => five[k] && Number.isFinite(Number(five[k].score)))
    .sort((a, b) => Math.abs(five[b].score - 50) - Math.abs(five[a].score - 50)).slice(0, 2)
    .map(k => (five[k].score >= 50 ? 'high ' : 'low ') + traits[k] + ' (' + Math.round(five[k].score) + ')');
  const letters = (mbti.letters || []).filter(l => l && l.choice).map(l => l.choice + (l.strength ? ' ' + l.strength : ''));
  const wellbeing = r.wellness && r.wellness.overall ? firstSentence(r.wellness.overall) : '';
  add('Who you are', [
    mbti.type ? 'MBTI: ' + mbti.type + (letters.length ? ' (' + letters.join(', ') + ')' : '') + '.' : '',
    standout.length ? 'Big Five: stands out for ' + listOf(standout) + '.' : '',
    wellbeing ? 'Wellbeing: ' + wellbeing : '',
  ]);

  const motives = (r.topMotivators || []).map(k => (S.motivators && S.motivators[k] && S.motivators[k].label) || k).slice(0, 3);
  const values = (r.values || []).map(v => v && v.value).filter(Boolean).slice(0, 3);
  const interests = (r.interests || []).map(i => i && i.name).filter(Boolean).slice(0, 3);
  add('What drives you', [
    motives.length ? 'Motivated most by: ' + listOf(motives) + '.' : '',
    values.length ? 'Values: ' + values.join('; ') + '.' : '',
    interests.length ? 'Interests: ' + interests.join('; ') + '.' : '',
  ]);

  const love = (r.relationship && r.relationship.loveLanguages) || {};
  const primary = side => ((love[side] || []).find(l => l && l.strength === 'primary') || (love[side] || [])[0] || {}).language;
  const giving = primary('giving') === 'Receiving gifts' ? 'Giving gifts' : primary('giving');
  const attachment = r.attachment && r.attachment.style;
  const partner = r.idealPartner && r.idealPartner.summary ? firstSentence(r.idealPartner.summary) : '';
  add('How you connect', [
    primary('receiving') ? 'Love language: you feel cared for through ' + primary('receiving').toLowerCase() + (giving ? ' and show care through ' + giving.toLowerCase() : '') + '.' : '',
    attachment ? 'Attachment: ' + String(attachment).replace(/[.]?$/, '.') : '',
    partner ? 'Best partner: ' + partner : '',
  ]);

  const career = r.careerAssessment || {};
  const suits = ((career.fit && career.fit.suits) || []).map(label).filter(x => x && !PLACEHOLDER.test(x)).slice(0, 2);
  add('How you work', [
    career.edge && career.edge.headline ? 'Your edge: ' + String(career.edge.headline).replace(/[.]?$/, '.') : '',
    suits.length ? 'Suits you: ' + suits.join('; ') + '.' : '',
  ]);

  const dev = r.development || {};
  const build = ((dev.buildOn || [])[0] || {}).title;
  const grow = ((dev.develop || [])[0] || {}).title;
  const week = ((career.actions || []).find(a => a && /week/i.test(a.horizon || '')) || {}).title;
  add('Putting it together', [
    build ? 'Build on: ' + build + '.' : '', grow ? 'Work on: ' + grow + '.' : '', week ? 'This week: ' + String(week).replace(/[.]?$/, '.') : '',
  ]);

  if (r.bonus && r.bonus.harsh) add('Appendix', ['A deliberately harsh roast, then what an honest friend would tell you.']);
  return out;
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

module.exports = { build, fileName, summary, buildSync, syncFileName };
