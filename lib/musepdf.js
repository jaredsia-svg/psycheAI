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

function sections(report, Copy) {
  const r = report || {};
  const S = Copy.STRUCTURED || {};
  const out = [];
  const essence = r.essence || {};
  const mbti = r.mbti || {};
  const patterns = (r.patterns || []).map(p => p && p.name).filter(Boolean).slice(0, 3);
  out.push({ title: 'Overview', finding: [
    [essence.character, mbti.type && (mbti.type + (mbti.nickname ? ' (' + mbti.nickname + ')' : ''))].filter(Boolean).join(' · ') + '.',
    r.card && r.card.headline ? String(r.card.headline).replace(/[.]?$/, '.') : '',
    patterns.length ? 'Your patterns: ' + listOf(patterns) + '.' : '',
  ].filter(Boolean).join(' ') });

  const five = r.bigFive || {};
  const traits = { openness: 'Openness', conscientiousness: 'Conscientiousness', extraversion: 'Extraversion', agreeableness: 'Agreeableness', neuroticism: 'Emotional sensitivity' };
  const standout = Object.keys(traits).filter(k => five[k] && Number.isFinite(Number(five[k].score)))
    .sort((a, b) => Math.abs(five[b].score - 50) - Math.abs(five[a].score - 50)).slice(0, 2)
    .map(k => (five[k].score >= 50 ? 'high ' : 'low ') + traits[k] + ' (' + Math.round(five[k].score) + ')');
  const letters = (mbti.letters || []).filter(l => l && l.choice).map(l => l.choice + (l.strength ? ' ' + l.strength : ''));
  const wellbeing = r.wellness && r.wellness.overall ? firstSentence(r.wellness.overall) : '';
  out.push({ title: 'Who you are', finding: [
    mbti.type ? mbti.type + (letters.length ? ': ' + letters.join(', ') : '') + '.' : '',
    standout.length ? 'Stands out in the Big Five: ' + listOf(standout) + '.' : '',
    wellbeing ? 'Wellbeing: ' + wellbeing : '',
  ].filter(Boolean).join(' ') });

  const motives = (r.topMotivators || []).map(k => (S.motivators && S.motivators[k] && S.motivators[k].label) || k).slice(0, 3);
  const values = (r.values || []).map(v => v && v.value).filter(Boolean).slice(0, 3);
  const interests = (r.interests || []).map(i => i && i.name).filter(Boolean).slice(0, 3);
  out.push({ title: 'What drives you', finding: [
    motives.length ? 'Most: ' + listOf(motives) + '.' : '',
    values.length ? 'Values: ' + values.join('; ') + '.' : '',
    interests.length ? 'Interests: ' + interests.join('; ') + '.' : '',
  ].filter(Boolean).join(' ') });

  const love = (r.relationship && r.relationship.loveLanguages) || {};
  const primary = side => ((love[side] || []).find(l => l && l.strength === 'primary') || (love[side] || [])[0] || {}).language;
  const giving = primary('giving') === 'Receiving gifts' ? 'Giving gifts' : primary('giving');
  const attachment = r.attachment && r.attachment.style;
  const partner = r.idealPartner && r.idealPartner.summary ? firstSentence(r.idealPartner.summary) : '';
  out.push({ title: 'How you connect', finding: [
    primary('receiving') ? 'You feel cared for through ' + primary('receiving').toLowerCase() + (giving ? ' and show care through ' + giving.toLowerCase() : '') + '.' : '',
    attachment ? 'Attachment: ' + String(attachment).replace(/[.]?$/, '.') : '',
    partner,
  ].filter(Boolean).join(' ') });

  const career = r.careerAssessment || {};
  const suits = ((career.fit && career.fit.suits) || []).map(label).filter(Boolean).slice(0, 2);
  out.push({ title: 'How you work', finding: [
    career.edge && career.edge.headline ? 'Your edge: ' + String(career.edge.headline).replace(/[.]?$/, '.') : '',
    suits.length ? 'Suits you: ' + suits.join('; ') + '.' : '',
  ].filter(Boolean).join(' ') });

  const dev = r.development || {};
  const build = ((dev.buildOn || [])[0] || {}).title;
  const grow = ((dev.develop || [])[0] || {}).title;
  const week = ((career.actions || []).find(a => a && /week/i.test(a.horizon || '')) || {}).title;
  out.push({ title: 'Putting it together', finding: [
    build ? 'Build on: ' + build + '.' : '', grow ? 'Work on: ' + grow + '.' : '', week ? 'This week: ' + String(week).replace(/[.]?$/, '.') : '',
  ].filter(Boolean).join(' ') });

  if (r.bonus && r.bonus.harsh) out.push({ title: 'Appendix', finding: 'A deliberately harsh roast, then what an honest friend would tell you.' });
  return out.filter(s => s.finding);
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

module.exports = { build, fileName, summary };
