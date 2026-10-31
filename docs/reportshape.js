// How a written report becomes what the page and the PDF show: the card's
// conclusions laid over the full report, the paid sections filed apart, and
// the reader's name put back. Shared by the page (app.js) and the server,
// which builds a Muse report's PDF from the same code (lib/musepdf.js), so the
// PDF in the chat and the one downloaded here are one document.
(function (root) {
  'use strict';

  // The four premium sections arrive with the written report and are filed
  // apart from it, under `premiumAnalysis`.
  const PREMIUM_KEYS = ['wellness', 'attachment', 'idealPartner', 'careerAssessment'];

  function unlockedSections(profile) {
    const paid = profile && profile.premiumAnalysis;
    if (!paid) return {};
    const unlocked = {};
    if (paid.wellness) unlocked.wellness = paid.wellness;
    if (paid.attachment) unlocked.attachment = paid.attachment;
    if (paid.idealPartner) unlocked.idealPartner = paid.idealPartner;
    if (paid.careerAssessment) unlocked.careerAssessment = paid.careerAssessment;
    return unlocked;
  }

  // The reader's own name where the model wrote the placeholder.
  const OWN_PLACEHOLDER = /\bPsycheUser\b/g;
  const isPlaceholder = name => /^\s*PsycheUser\s*$/i.test(String(name || ''));
  function withOwnName(value, real) {
    if (!real) return value;
    if (typeof value === 'string') return value.replace(OWN_PLACEHOLDER, real);
    if (Array.isArray(value)) return value.map(item => withOwnName(item, real));
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) out[key] = withOwnName(value[key], real);
      return out;
    }
    return value;
  }

  /**
   * The full report, with the card's conclusions laid back over it: the
   * type, the letters, the scores, the character and the order of the lists
   * on the card. The writing underneath is the full report's own.
   */
function overlayCard(full, card) {
  if (!card) return full;
  const out = JSON.parse(JSON.stringify(full));
  out.essence = Object.assign({}, out.essence, {
    character: (card.essence || {}).character || (out.essence || {}).character,
    franchise: (card.essence || {}).franchise || (out.essence || {}).franchise,
    icon: (card.essence || {}).icon || (out.essence || {}).icon,
    // The character line, when the card wrote it: the first of the three
    // the card settles (with the summary and the write-up).
    why: (card.essence || {}).why || (out.essence || {}).why,
  });
  if (card.cardHighlights) out.cardHighlights = card.cardHighlights;
  // The Overview the reader read free under their card: kept whole.
  if (typeof card.summary === 'string' && card.summary.trim()) out.summary = card.summary;
  if ((card.topMotivators || []).length) out.topMotivators = card.topMotivators;
  // The roast is the free call's, read on My Psyche before paying: the one
  // the reader has already seen stays.
  if (card.bonus && card.bonus.harsh) out.bonus = card.bonus;
  // The structured paid call no longer writes the shareable card at all —
  // it is the free one's, whole.
  if (card.card && !out.card) out.card = card.card;
  if (card.confidence) {
    out.confidence = Object.assign({}, out.confidence,
      { score: card.confidence.score, level: card.confidence.level });
  }
  for (const trait of Object.keys(card.bigFive || {})) {
    const pinned = card.bigFive[trait] || {};
    out.bigFive = out.bigFive || {};
    out.bigFive[trait] = Object.assign({}, out.bigFive[trait], { score: pinned.score, band: pinned.band });
  }
  if (card.mbti) {
    out.mbti = Object.assign({}, out.mbti,
      { type: card.mbti.type, nickname: card.mbti.nickname || (out.mbti || {}).nickname });
    if ((card.mbti.letters || []).length) out.mbti.letters = card.mbti.letters.map(letter => {
      const written = ((full.mbti || {}).letters || []).find(l => l && l.axis === letter.axis) || {};
      return Object.assign({}, written, { axis: letter.axis, choice: letter.choice, strength: letter.strength });
    });
  }
  // Lists keep the card's entries in the card's order, each carrying the full
  // report's writing about it where there is any, and then whatever further
  // entries the full report added.
  const pinList = (pinned, written, key) => {
    const rows = written || [];
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const kept = (pinned || []).map(item =>
      Object.assign({}, rows.find(row => row && same(row[key], item[key])) || {}, item));
    const extra = rows.filter(row => row && !(pinned || []).some(item => same(item[key], row[key])));
    return kept.concat(extra);
  };
  // The structured layout's free card names the signature patterns; the
  // full report explains them. Pinned by id, so a name the reader has seen
  // on their card is the name the report uses.
  if ((card.patterns || []).length) {
    out.patterns = card.patterns.map(pinned => {
      const written = (full.patterns || []).find(row => row && row.id === pinned.id) || {};
      // A card with its Overview carries the evidence and where each shows
      // up as well, and those stand too.
      const own = (pinned.evidence || []).length
        ? { line: pinned.line, evidence: pinned.evidence, showsUpIn: pinned.showsUpIn || written.showsUpIn || [] } : {};
      return Object.assign({ line: pinned.line }, written, own, { id: pinned.id, name: pinned.name });
    });
  }
  if (card.interests) out.interests = pinList(card.interests, full.interests, 'name');
  if (card.values) out.values = pinList(card.values, full.values, 'value');
  if (card.beliefs) out.beliefs = pinList(card.beliefs, full.beliefs, 'belief');
  const love = (card.relationship && card.relationship.loveLanguages) || null;
  if (love) {
    const written = ((full.relationship || {}).loveLanguages) || {};
    out.relationship = Object.assign({}, out.relationship);
    out.relationship.loveLanguages = Object.assign({}, written, {
      receiving: pinList(love.receiving, written.receiving, 'language'),
      giving: pinList(love.giving, written.giving, 'language'),
    });
  }
  return out;
}

  /** The card's motivators, from the report when the card call left them out. */
  function cardMotivators(report, Copy) {
    const known = Copy.STRUCTURED.motivators;
    const named = (report.topMotivators || []).filter(key => known[key]);
    if (named.length) return named.slice(0, 3);
    return ((report.motivators && report.motivators.scores) || []).filter(row => row && known[row.value])
      .slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(row => row.value);
  }

  /**
   * The card's fields for its link, with what the card itself shows filled
   * in where the call that wrote them left a gap: the motivators and how they
   * show care.
   */
  function cardFieldsFrom(fields, report, Copy) {
    const out = Object.assign({}, fields || {});
    if (!report) return out;
    if (!(Array.isArray(out.motivators) && out.motivators.length)) out.motivators = cardMotivators(report, Copy);
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    for (const [key, side] of [['loveReceiving', 'receiving'], ['loveGiving', 'giving']]) {
      const shown = (love[side] || []).slice(0, 2).filter(l => l && l.language)
        .map(l => l.language + (l.strength ? ' (' + l.strength + ')' : ''));
      if (shown.length > (Array.isArray(out[key]) ? out[key].length : 0)) out[key] = shown;
    }
    return out;
  }

  /**
   * A report Muse wrote (the import bundle's data), as the page keeps it once
   * adopted: the card from its freeCard, the paid sections apart, and the
   * full report under the card. The same steps as app.js adoptMuseRead.
   */
  function museProfile(data, name, Copy, Card) {
    const real = String(name || '').trim();
    const freeData = withOwnName(data.freeCard, real);
    const cardFields = cardFieldsFrom(freeData.card, freeData, Copy);
    if (real && isPlaceholder(cardFields.name)) cardFields.name = real;
    const written = withOwnName(Object.assign({}, data), real);
    const premium = {};
    for (const key of PREMIUM_KEYS) {
      if (written[key]) premium[key] = written[key];
      delete written[key];
    }
    delete written.freeCard;
    return {
      report: overlayCard(written, freeData),
      freeReport: freeData,
      card: Card.shape(cardFields),
      premiumAnalysis: Object.keys(premium).length ? premium : undefined,
      source: 'muse',
      explained: true,
    };
  }

  root.PsycheReportShape = { PREMIUM_KEYS, unlockedSections, withOwnName, isPlaceholder, overlayCard, cardMotivators, cardFieldsFrom, museProfile };
})(typeof window !== 'undefined' ? window : globalThis);
