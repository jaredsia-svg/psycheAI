// PsycheAI SPA: upload → digest → model → profile → QR → scan → compatibility.
// All state lives in localStorage; the server holds nothing.
(function () {
  'use strict';

  const IG = window.PsycheInstagram;
  const Supplement = window.PsycheSupplement;
  const Images = window.PsycheImages;
  const Digest = window.PsycheDigest;
  const Card = window.PsycheCard;
  const LLM = window.PsycheLLM;
  // The profile page and the PDF are two renderings of one document, so every
  // string and label they share comes from here rather than being written twice.
  const Copy = window.PsycheCopy;
  const TEXT = Copy.TEXT;
  const TRAIT_LABELS = Copy.TRAIT_LABELS;
  const LOVE_LANGUAGE_ICONS = Copy.LOVE_LANGUAGE_ICONS;
  const CARD_ICONS = Copy.CARD_ICONS;
  const axisLabel = Copy.axisLabel;
  const ENNEAGRAM_DESCRIPTIONS = Copy.ENNEAGRAM_DESCRIPTIONS;

  const $ = sel => document.querySelector(sel);
  const KEYS = {
    profile: 'psycheai_profile',
    digest: 'psycheai_digest',
    history: 'psycheai_history',
    // Written the moment a payment clears and before the analysis is asked
    // for, so a reader who closes the tab, loses signal or runs out of battery
    // mid-generation comes back to "fetch what you paid for" rather than to a
    // price. It holds the authorisation, never the report: see the note on
    // `unlockReceipt` below. Listed here so `clearAll()` covers it — Delete
    // everything has to take the receipt with the report.
    unlock: 'psycheai_unlock',
  };

  // The app stored under kindred3_* before the rename. Carry anything left
  // behind over on first load, so an existing profile survives — there is no
  // server copy to fall back on.
  try {
    for (const [name, key] of Object.entries(KEYS)) {
      const old = localStorage.getItem('kindred3_' + name);
      if (old !== null && localStorage.getItem(key) === null) localStorage.setItem(key, old);
      if (old !== null) localStorage.removeItem('kindred3_' + name);
    }
  } catch (error) { /* storage disabled — nothing to migrate */ }

  const store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (error) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { return false; }
    },
    clearAll() { for (const key of Object.values(KEYS)) localStorage.removeItem(key); },
  };

  // ---------- how many analyses this browser has already had ----------
  //
  // Deliberately NOT in KEYS, which is the whole point of it: `clearAll()`
  // iterates KEYS, so anything listed there is wiped by "Delete everything" —
  // and "delete everything, then upload again" was exactly the free way round
  // the allowance. Kept apart, with this comment, so nobody tidies it into
  // KEYS later and quietly reopens that door.
  //
  // What it is not: enforcement. Clearing site data, a private window or a
  // different browser all reset it, and nothing on the server can tell. The
  // real ceiling on spend is server-side and global — lib/budget.js — and this
  // is a fair-use allowance that keeps honest readers honest and tells them
  // plainly what the next run costs. The README says so in the same words.
  const RUNS_KEY = 'psycheai_runs';
  // Overridden by /api/status so the number here and the number the server
  // reasons about cannot drift; this is only the value used before status
  // lands, and on a server too old to report one.
  let freeAnalyses = 1;

  function runCount() {
    const raw = store.read(RUNS_KEY, 0);
    const count = typeof raw === 'number' ? raw : Number(raw && raw.count);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  function recordRun() {
    store.write(RUNS_KEY, runCount() + 1);
  }

  /**
   * Persist the digest, and say so when it does not fit.
   *
   * `store.write` swallows a quota failure and returns false. The profile's
   * own write has always checked that and warned; the digest's four did not,
   * which is the one way a browser ends up holding a report whose evidence is
   * gone — the two are separate localStorage entries, and the report is
   * written first. What the reader saw afterwards was a confidence card
   * claiming Instagram was loaded and a re-run button that threw when pressed.
   *
   * Both halves of that are fixed elsewhere (sourcesUsedHtml reads the digest
   * for the Instagram row now; rerunWithAdditionalData asks for the export
   * back instead of dereferencing null). This is the half that says it at the
   * moment it happens, rather than leaving the reader to find out later.
   *
   * #profile-alert rather than a per-caller slot: all four callers land on the
   * report a moment later — two through runAnalysis, two as the premium dialog
   * closes — and renderProfile does not clear that element, so a message
   * written here survives the navigation and is read where it makes sense.
   */
  function writeDigest(digest) {
    if (store.write(KEYS.digest, digest)) return true;
    flash('#profile-alert', TEXT.digestTooLarge);
    return false;
  }

  /** True when the next analysis is past this browser's free allowance. */
  function mustPayForAnalysis() {
    return runCount() >= freeAnalyses;
  }

  const state = {
    profile: store.read(KEYS.profile, null),
    digest: store.read(KEYS.digest, null),
    // In memory only, and only for as long as this page lives — see handleFiles.
    images: [],
    // The parsed Instagram export itself, kept for the same reason and on the
    // same terms as `images`: it is what "Re-run analysis with additional
    // data" needs to add a Google or Facebook export without asking for the
    // Instagram one again, and it is exactly the raw material this app's
    // privacy story says never touches a disk. A reload loses it, same as the
    // photographs — the button that needs it simply does not appear after
    // one; see renderProfile and rerunWithAdditionalData.
    signals: null,
    server: { ready: false, mock: false, model: null },
  };

  // ---------- html helpers ----------

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
      .map(p => '<p>' + esc(p) + '</p>').join('');
  }

  function list(items, className) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return '';
    return '<ul class="' + (className || '') + '">' + values.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
  }

  // The chips under a Big Five bar, reused wherever a claim has to show what
  // put it there. Compatibility claims carry these; profile points do not, so
  // this returns nothing rather than an empty row when there is no evidence.
  function evidence(items) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return '';
    return '<p class="trait-evidence">' +
      values.map(e => '<span class="ev">' + esc(e) + '</span>').join('') + '</p>';
  }

  function points(items) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return '<p class="muted">' + esc(TEXT.pointsEmpty) + '</p>';
    return '<dl class="points">' + values.map(item =>
      '<dt>' + esc(item.title) + '</dt><dd>' + esc(item.detail) +
      evidence(item.evidence) + '</dd>').join('') + '</dl>';
  }

  function tags(items) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return '';
    return '<p class="tag-row">' + values.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>';
  }

  // The model is asked for exactly one emoji, but a model asked for one emoji
  // will occasionally send a word, a sentence, or three. Keep it only if it is
  // plausibly a pictograph: no ASCII, and short once ZWJ sequences and skin
  // tone modifiers are accounted for.
  function safeIcon(value) {
    const glyphs = Array.from(String(value || '').trim());
    if (!glyphs.length || glyphs.length > 8) return '✳️';
    if (glyphs.some(g => g.codePointAt(0) < 0x2000)) return '✳️';
    return glyphs.join('');
  }

  // `noun` is what this field was called when it held an abstract noun rather
  // than a character, so a profile saved before that change still renders.
  const essenceName = essence => (essence && (essence.character || essence.noun)) || '';

  // ---------- the psyche card ----------
  //
  // The report at a glance, above the writing. Everything on it is read off the
  // same `report` the sections below render, so the two cannot disagree — there
  // is no second copy of any of this to keep in sync.
  //
  // It is laid out at one fixed size and then scaled to fit, rather than reflowed
  // responsively. A card that reflows fits every screen and looks composed on
  // none of them, and the requirement here is the opposite: one screen, no
  // scrolling, on a phone and on a laptop alike. Fixed geometry plus a scale
  // factor gives that on both, and keeps a single layout to reason about.
  // Width is fixed so the design is stable — the same three columns, the same
  // type sizes, on every screen. Height is *measured* rather than fixed, because
  // a real report's titles run longer than any number typed here would allow
  // for, and a card with a hardcoded height silently clips the last row when
  // they do. That is exactly what the first version of this did.
  const CARD_W = 1000;

  // A phone screen is much taller relative to its width than this card is, so a
  // single layout scaled to fit leaves a third of the screen empty and shrinks
  // the type for nothing. On a narrow viewport the paired rows stack, which
  // makes the card taller and narrower — closer to the shape of the screen it
  // has to land on, so the same content is drawn larger.
  const CARD_W_NARROW = 700;
  // How much vertical room the inline preview may take on the page.
  const PREVIEW_MAX_H = 460;
  // Height set aside at the foot of the full-screen view for the download bar.
  const CARD_BAR_SPACE = 84;
  const NARROW_ASPECT = 0.62;

  // Four of the five traits, in a fixed order rather than picked out by
  // score — extraversion is left off deliberately, since the MBTI block
  // above already carries the E/I letter and showing it a second time here
  // would be the same finding stated twice on one card.
  const BIG_FIVE_CARD_KEYS = ['openness', 'conscientiousness', 'agreeableness', 'neuroticism'];
  // "Conscientiousness" is one solid word with no space for the browser to
  // wrap at, so at this column's width it ran past the card edge rather than
  // dropping to a second line the way "Openness to experience" does. The card
  // is a compact summary rather than the full report, so it trims the trait
  // to "Conscientious" here instead. TRAIT_LABELS itself is left alone, since
  // the full written report has room for the whole word.
  const CARD_LABEL_OVERRIDES = { conscientiousness: 'Conscientious' };
  function bigFiveCardRows(bigFive) {
    return BIG_FIVE_CARD_KEYS
      .map(key => ({
        key,
        label: CARD_LABEL_OVERRIDES[key] || TRAIT_LABELS[key],
        score: (bigFive && bigFive[key] && bigFive[key].score) || 0,
      }))
      .filter(row => row.score > 0);
  }

  // The mark as inline SVG, from the same path data the nav, the PDF and the QR
  // label draw. `currentColor` so the one markup works on the card's light
  // header without a second copy in a different colour.
  function brandMarkSvg(className) {
    const mark = Copy.BRAND_MARK;
    return '<svg class="' + className + '" viewBox="0 0 ' + mark.viewBox + ' ' + mark.viewBox + '" ' +
      'fill="none" stroke="currentColor" stroke-width="' + mark.strokeWidth + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      mark.paths.map(d => '<path d="' + d + '"/>').join('') +
      (mark.dot ? '<circle cx="' + mark.dot.cx + '" cy="' + mark.dot.cy + '" r="' + mark.dot.r +
        '" fill="currentColor" stroke="none"/>' : '') +
      '</svg>';
  }

  const cardLab = (icon, label) =>
    '<p class="pc-lab"><span class="pc-lab-icon" aria-hidden="true">' + esc(icon) + '</span>' +
    '<span class="pc-lab-text">' + esc(label) + '</span></p>';

  function cardChipRow(icon, label, items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    return '<div class="pc-col">' + cardLab(icon, label) + '<div class="pc-chips">' +
      list.map(item => '<span class="pc-chip">' + esc(item) + '</span>').join('') + '</div></div>';
  }

  // Love languages are fixed vocabulary with a glyph each already mapped in
  // copy.js, so the icon comes from the language rather than being chosen here.
  function cardLoveBlock(icon, label, languages) {
    const list = (languages || []).filter(Boolean);
    if (!list.length) return '';
    return '<div class="pc-half">' + cardLab(icon, label) + '<ul class="pc-list pc-love">' +
      list.map(language => '<li><span class="pc-love-icon" aria-hidden="true">' +
        esc(LOVE_LANGUAGE_ICONS[language] || '💗') + '</span>' + esc(language) + '</li>').join('') +
      '</ul></div>';
  }

  // Split on a sentence-ending mark followed by whitespace, keeping the mark
  // with the sentence it closes.
  function splitSentences(text) {
    return String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  }
  const firstSentence = text => splitSentences(text)[0] || '';

  // One sentence off the strongest thing the report found. The `detail` runs
  // two or three sentences and the first carries the finding; the `title` is
  // a headline rather than a sentence, so it is only a fallback and gets a
  // full stop put on it.
  function strengthSentence(rows) {
    const top = (rows || []).find(row => row && (row.detail || row.title));
    if (!top) return '';
    const detail = String(top.detail || '').trim();
    if (detail) return firstSentence(detail);
    const title = String(top.title || '').trim();
    return title ? title.replace(/[.!?]*$/, '') + '.' : '';
  }

  // Four sentences written by the model as their own field — see
  // cardHighlights in lib/prompts.js — condensing the two paragraphs of
  // report.summary specifically for the card: the first two sentences summarize
  // the first paragraph, the next two summarize the second. Genuine
  // summarizing, from the model that wrote those paragraphs, rather than an
  // excerpt assembled at read time.
  //
  // Two fallbacks exist only for a report saved before this field existed,
  // oldest first: the previous approach — the opening two sentences of
  // report.summary itself, plus one dedicated relationship strength and one
  // dedicated career strength, read straight off relationship.strengths and
  // career.strengths — and finally report.card.summary, the QR-coded card's
  // own two-sentence line, if even that stitching finds nothing.
  function cardBlurb(report) {
    const highlights = String((report && report.cardHighlights) || '').trim();
    if (highlights) return highlights;
    const summary = String((report && report.summary) || '').replace(/\s*\n+\s*/g, ' ').trim();
    const opening = splitSentences(summary).slice(0, 2);
    const relationship = strengthSentence(report && report.relationship && report.relationship.strengths);
    const career = strengthSentence(report && report.career && report.career.strengths);
    const sentences = [...opening, relationship, career].filter(Boolean);
    if (sentences.length) return sentences.join(' ');
    return String((report && report.card && report.card.summary) || '').trim();
  }

  const titlesOf = (rows, limit) => (rows || []).slice(0, limit)
    .map(row => (row && (row.title || row.name || row.value || row.belief)) || '')
    .filter(Boolean);

  /**
   * The card's markup, from a full report.
   *
   * Deliberately omits three things the written report carries. The franchise
   * ("Marvel", "Pixar") is dropped because the comparison is to the character's
   * temperament and naming the studio invites the reader to check the costume
   * instead. Attachment style is dropped because this is the surface most likely
   * to be shown to somebody else, and it is the most intimate line in the
   * report. The QR code is dropped because this is the reader's own page, where
   * they already have one.
   */
  function psycheCardHtml(report) {
    if (!report) return '';
    const card = report.card || {};
    const cardName = card.name || '';
    const essence = report.essence || {};
    const name = essenceName(essence);
    const mbti = report.mbti || {};
    const enneagram = report.enneagram || {};
    const bigFiveRows = bigFiveCardRows(report.bigFive);
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const confidence = Number(card.confidence);
    const hasConfidence = Number.isFinite(confidence) && confidence > 0;

    const letters = (mbti.letters || []).map(letter =>
      '<span class="pc-letter"><b>' + esc(letter.choice || '') + '</b>' +
      '<i>' + esc(letter.strength || '') + '</i></span>').join('');

    const enneagramLabel = enneagram.type
      ? esc(enneagram.type) + (enneagram.wing ? 'w' + esc(enneagram.wing) : '')
      : '';
    // The type's own textbook definition, not this person's — see
    // ENNEAGRAM_DESCRIPTIONS for why that split matters.
    const enneagramDesc = ENNEAGRAM_DESCRIPTIONS[enneagram.type] || '';

    const blurb = cardBlurb(report);

    return '' +
      // Masthead. Three slots on fixed grid columns rather than DOM order, so
      // each one is pinned to its own column and stays put whether or not the
      // other two are present — the brand mark leads, the reader's own name
      // sits centred under it, and the confidence score closes the row.
      '<div class="pc-top">' +
        '<span class="pc-brand">' + brandMarkSvg('pc-brand-mark') + '<span>PsycheAI</span></span>' +
        (cardName ? '<span class="pc-owner">' + esc(cardName) + '</span>' : '') +
        (hasConfidence ? '<span class="pc-confidence" title="' + esc(TEXT.cardConfidence) + '">' +
          '<span class="pc-confidence-icon" aria-hidden="true">' + esc(CARD_ICONS.confidence) + '</span>' +
          '<b>' + Math.round(confidence) + '</b><span class="pc-confidence-max">/100</span>' +
          '</span>' : '') +
      '</div>' +
      '<div class="pc-hero">' +
        '<p class="pc-kicker">' + esc(TEXT.essenceLabel) + '</p>' +
        '<div class="pc-name"><span class="pc-icon" aria-hidden="true">' +
          esc(safeIcon(essence.icon)) + '</span><h2>' + esc(name) + '</h2></div>' +
        (blurb ? '<p class="pc-blurb">' + esc(blurb) + '</p>' : '') +
      '</div>' +

      '<div class="pc-stats">' +
        // The type letters carry their own strengths, so the four-letter code
        // above them was the same information twice — the row below says ENFJ
        // and says how firmly each letter was picked.
        '<div class="pc-stat">' + cardLab(CARD_ICONS.type, TEXT.cardType) +
          (letters ? '<div class="pc-letters">' + letters + '</div>' : '') +
          '</div>' +
        (enneagramLabel ? '<div class="pc-stat">' + cardLab(CARD_ICONS.enneagram, TEXT.cardEnneagram) +
          '<p class="pc-big">' + enneagramLabel + '</p>' +
          (enneagram.nickname ? '<p class="pc-sub">' + esc(enneagram.nickname) + '</p>' : '') +
          (enneagramDesc ? '<p class="pc-desc">' + esc(enneagramDesc) + '</p>' : '') +
          '</div>' : '') +
        (bigFiveRows.length ? '<div class="pc-stat pc-stat-bigfive">' + cardLab(CARD_ICONS.bigFive, TEXT.cardBigFive) +
          '<div class="pc-trait-list">' +
          bigFiveRows.map(row => '<p class="pc-trait"><span class="pc-trait-label">' + esc(row.label) +
            '</span><b>' + row.score + '</b></p>').join('') +
          '</div>' +
          '</div>' : '') +
      '</div>' +

      // Values, beliefs and interests share one row: they are the same kind of
      // claim about a person and read as a set rather than as three sections.
      '<div class="pc-row">' +
        cardChipRow(CARD_ICONS.values, TEXT.cardValues, titlesOf(report.values, 3)) +
        cardChipRow(CARD_ICONS.beliefs, TEXT.cardBeliefs, titlesOf(report.beliefs, 2)) +
        cardChipRow(CARD_ICONS.interests, TEXT.cardInterests, titlesOf(report.interests, 3)) +
      '</div>' +

      // Side by side on every screen, including a phone: giving and receiving
      // are read against each other, and stacking them loses the comparison
      // that makes the pair worth showing at all.
      '<div class="pc-row pc-row-2 pc-love-row">' +
        cardLoveBlock(CARD_ICONS.loveIn, TEXT.cardLoveIn,
          (love.receiving || []).slice(0, 2).map(l => l && l.language)) +
        cardLoveBlock(CARD_ICONS.loveOut, TEXT.cardLoveOut,
          (love.giving || []).slice(0, 2).map(l => l && l.language)) +
      '</div>' +

      '';
  }

  // Scale-to-fit, measured rather than assumed: the card is laid out at
  // CARD_W x CARD_H and shrunk by whichever axis runs out first, so it lands
  // whole on a phone and on a laptop without a scrollbar on either.
  function fitCard(el, availableWidth, availableHeight, options) {
    if (!el) return;
    // `narrow` is about the shape of the *screen*, not of the box the card is
    // being fitted into, so the height-capped inline preview must not trip it.
    const narrow = options === 'screen' &&
      availableWidth / availableHeight < NARROW_ASPECT;
    el.classList.toggle('pc-narrow', narrow);
    const width = narrow ? CARD_W_NARROW : CARD_W;
    el.style.width = width + 'px';
    // offsetHeight is a layout value and ignores the transform already on the
    // element, so this is the card's natural height at CARD_W whatever scale it
    // is currently drawn at — no need to reset the transform to measure.
    const naturalHeight = el.offsetHeight;
    if (!naturalHeight) return;
    const scale = Math.min(availableWidth / width, availableHeight / naturalHeight);
    el.style.transform = 'scale(' + scale + ')';
    const frame = el.parentElement;
    if (frame) {
      frame.style.width = width * scale + 'px';
      frame.style.height = naturalHeight * scale + 'px';
    }
  }

  function essenceBlock(essence) {
    const name = essenceName(essence);
    if (!name) return '';
    // The emoji stands in for the character rather than depicting them: the
    // actual artwork is somebody else's, and not ours to ship.
    return '<div class="essence">' +
      '<span class="essence-icon" role="img" aria-label="' + esc(name) + '">' +
      esc(safeIcon(essence.icon)) + '</span>' +
      '<div><p class="essence-label">' + esc(TEXT.essenceLabel) + '</p>' +
      // Siblings rather than one nested in the other: the gradient clip on the
      // name would swallow the franchise, and the print suite only measures
      // elements that have no element children.
      '<div class="essence-name"><p class="essence-noun">' + esc(name) + '</p>' +
      (essence.franchise ? '<span class="essence-franchise">' + esc(essence.franchise) + '</span>' : '') +
      '</div>' +
      '<p class="essence-why">' + esc(essence.why) + '</p></div></div>';
  }

  function loveLanguageColumn(title, blurb, items) {
    const rows = (items || []).filter(item => item && item.language);
    if (!rows.length) return '';
    return '<div><h3>' + title + '</h3><p class="muted love-blurb">' + blurb + '</p>' +
      rows.map(item =>
        '<div class="love-row love-' + esc(item.strength || 'secondary') + '">' +
        '<span class="love-icon">' + (LOVE_LANGUAGE_ICONS[item.language] || '💗') + '</span>' +
        '<div><h4>' + esc(item.language) +
        '<span class="pill pill-' + esc(item.strength || 'secondary') + '">' + esc(item.strength || '') + '</span></h4>' +
        '<p>' + esc(item.inPractice) + '</p>' +
        '<p class="love-why">' + esc(item.why) + '</p></div></div>').join('') + '</div>';
  }

  function loveLanguageBlock(languages) {
    if (!languages) return '';
    const columns =
      loveLanguageColumn(TEXT.loveReceiving, TEXT.loveReceivingBlurb, languages.receiving) +
      loveLanguageColumn(TEXT.loveGiving, TEXT.loveGivingBlurb, languages.giving);
    if (!columns) return '';
    return '<h3 class="love-head">' + esc(TEXT.loveHead) + '</h3><div class="split love-split">' + columns + '</div>' +
      (languages.caveat ? '<p class="fineprint">' + esc(languages.caveat) + '</p>' : '');
  }

  // Every section opens the same way: a glyph, a title and a line saying what
  // the section is for. It gives a long page a rhythm to scroll through
  // instead of a wall of identical cards. Module-level because both the
  // profile page and the scan page's QR-contents block use it.
  // `collapsible` turns the heading into a disclosure control for the card
  // below it — see collapseSections(). The button lives *inside* the `<h2>`
  // rather than replacing it or wrapping the whole row: that is the canonical
  // disclosure pattern, it gives the control its accessible name from the
  // section title for free, and it leaves the document outline intact, which
  // wrapping the row in a button would not (a heading is not valid button
  // content). The whole row stays clickable anyway — the delegated handler
  // listens on `.card-head-toggle`, so a click on the button bubbles to the
  // same place a click on the title does, and toggles once either way.
  function sectionHead(icon, title, sub, collapsible) {
    const chevron = '<span class="card-chevron" aria-hidden="true"></span>';
    return '<div class="card-head' + (collapsible ? ' card-head-toggle' : '') + '">' +
      '<span class="card-icon">' + icon + '</span>' +
      '<div><h2>' +
      (collapsible
        ? '<button class="card-toggle" type="button" aria-expanded="true">' +
          '<span class="card-toggle-text">' + title + '</span>' + chevron + '</button>'
        : title) +
      '</h2>' +
      (sub ? '<p class="card-sub">' + sub + '</p>' : '') + '</div></div>';
  }

  /**
   * Shuts every collapsible section in `root`, and is what actually makes the
   * report open compact rather than as one long scroll.
   *
   * Done here, right after the markup is written, rather than baked into the
   * markup itself: `is-collapsed` is a *state*, and the same section HTML is
   * also what the sample dialog renders and what a freshly-paid unlock splices
   * back in — one function that closes whatever is currently there beats
   * threading a "start closed" flag through every builder. It runs in the same
   * synchronous task as the `innerHTML` that precedes it, so nothing is ever
   * painted expanded first.
   *
   * `aria-expanded` starts `true` in the markup and is corrected here, so the
   * one place that decides the state is the one place that announces it.
   */
  function collapseSections(root) {
    // Found through the heads rather than with `.section-card:has(...)`: the
    // set is identical, and this asks nothing of the browser that the rest of
    // this file does not already assume.
    for (const head of root.querySelectorAll('.card-head-toggle')) {
      const card = head.closest('.section-card');
      if (card) setSectionOpen(card, false);
    }
  }

  function setSectionOpen(card, open) {
    card.classList.toggle('is-collapsed', !open);
    const toggle = card.querySelector('.card-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  // What the QR code actually carries — the compact card, not the full
  // report. Lives on the scan page rather than the profile page: it is about
  // the code someone is about to share or has just shared, which is the
  // context the scan page is for.
  function qrContentsBlock(card) {
    if (!card) return '';
    return '<div class="card section-card">' +
      sectionHead('🔗', esc(TEXT.qr), esc(TEXT.qrSub)) +
      '<p><strong>' + esc(card.headline) + '</strong></p><p>' + esc(card.summary) + '</p>' +
      tags(card.interests) +
      '<p class="fineprint">' + esc(TEXT.qrFineprint) + '</p></div>';
  }

  // ---------- mental wellness ----------
  //
  // Free, in the main report, rendered from `report.wellness`. Six
  // behavioural dimensions, a prose overall read and some suggestions.
  //
  // What this deliberately does not draw: a number. Every other scored thing
  // in this report gets `bar()` and a 0-100, and this one gets a word from a
  // four-value band instead — because a progress bar under "Emotional
  // processing" would read as a measurement of something that was never
  // measured, and the notation is most of what makes a claim look
  // authoritative. There is no composite either: `overall` is a paragraph,
  // not an average. See the comment on the wellness schema in
  // lib/prompts.js.
  //
  // `not enough evidence` is styled as a neutral state rather than a low one
  // for the same reason it exists in the enum at all: on a dimension like
  // physical activity it is the honest and frequent answer, and a reader
  // should not read "we could not tell" as "you scored badly".
  function wellnessBand(band) {
    const value = String(band || '');
    return '<span class="pill wellness-pill wellness-' +
      esc(value.replace(/\s+/g, '-').toLowerCase()) + '">' + esc(value) + '</span>';
  }

  function wellnessBodyHtml(wellness) {
    let html = '<div class="wellness-grid">';
    for (const [label, key] of Copy.WELLNESS_FACETS) {
      const facet = wellness[key];
      if (!facet) continue;
      // `.wellness-label` rather than reusing `.facet-label`: that class
      // belongs to the behaviour grid above, and a check counts it across the
      // whole of #profile-body to assert that section is exactly four facets.
      // Sharing the class made this section silently break that check.
      html += '<div class="wellness-facet">' +
        '<div class="wellness-head"><span class="wellness-label">' + label + '</span>' +
        wellnessBand(facet.band) + '</div>' +
        '<p>' + esc(facet.reading) + '</p>' +
        evidence(facet.evidence) +
        '<p class="wellness-confidence">' + esc(TEXT.wellnessConfidence) + esc(facet.confidence) + '</p>' +
        '</div>';
    }
    html += '</div>';

    if (wellness.overall) {
      html += '<div class="callout"><h3>' + esc(TEXT.wellnessOverall) + '</h3>' +
        paragraphs(wellness.overall) + '</div>';
    }
    html += '<h3>' + esc(TEXT.wellnessSuggestions) + '</h3>' + points(wellness.suggestions);
    // Fixed app copy, never read from the model — same rule as the roast's
    // caveat, and the section with the most reason to carry it.
    html += '<p class="fineprint wellness-caveat">' + esc(TEXT.wellnessCaveat) + '</p>';
    return html;
  }

  // ---------- attachment style ----------
  //
  // Its own section now, below the wellness read. It spent most of this app's
  // life as a callout inside "In relationships", competing with the love
  // languages for attention in a card that already carried strengths and
  // weaknesses — and it is the single most-quoted finding in the report, so
  // it was the wrong thing to bury. The markup is the same callout it always
  // was, lifted into a card of its own; the style itself still leads the
  // heading, since that is the part a reader is looking for.
  function attachmentBodyHtml(attachment) {
    return '<div class="callout"><h3>' + esc(TEXT.attachmentPrefix) + esc(attachment.style) + '</h3>' +
      '<p>' + esc(attachment.why) + '</p>' +
      ((attachment.derivedFrom || []).length
        ? '<p class="essence-label">' + esc(TEXT.readFrom) + '</p>' +
          '<p class="trait-evidence">' + attachment.derivedFrom
            .map(item => '<span class="ev">' + esc(item) + '</span>').join('') + '</p>'
        : '') +
      ((attachment.implications || []).length
        ? '<p class="essence-label">' + esc(TEXT.attachmentPractice) + '</p>' + points(attachment.implications)
        : '') +
      '<p class="fineprint">' + esc(attachment.caveat) + '</p></div>';
  }

  // ---------- ideal partner traits ----------
  //
  // Sits between the attachment read and the career assessment, both in
  // PAID_SECTIONS and in the schema this reads from — it argues directly off
  // the attachment section immediately above it rather than off a fresh
  // pass over the digest, so the two have to stay adjacent on the page too.
  function idealPartnerBodyHtml(idealPartner) {
    return '<h3>' + esc(TEXT.idealPartnerNeeds) + '</h3>' + points(idealPartner.needs) +
      '<h3>' + esc(TEXT.idealPartnerCarefulOf) + '</h3>' + points(idealPartner.carefulOf) +
      '<h3>' + esc(TEXT.idealPartnerSummary) + '</h3>' + paragraphs(idealPartner.summary);
  }

  // ---------- career assessment ----------
  //
  // The coach's read, distinct from "At work" higher up: that section
  // describes how somebody works, this one says what to do about it. Two
  // career headings in one report only earns its place if the second is
  // actionable, so the actions carry a horizon and the edge carries evidence
  // — without those this is just the first section again in the imperative.
  function careerActions(actions) {
    const values = (actions || []).filter(Boolean);
    if (!values.length) return '<p class="muted">' + esc(TEXT.pointsEmpty) + '</p>';
    // Grouped by horizon rather than shown in whatever order they arrived, so
    // "this week" is read first — the model is told at least one action must
    // be startable now, and burying it under a yearly ambition wastes that.
    const labels = TEXT.careerHorizons;
    let html = '<dl class="points career-actions">';
    for (const horizon of Object.keys(labels)) {
      for (const item of values.filter(a => a.horizon === horizon)) {
        html += '<dt><span class="pill horizon-pill horizon-' +
          esc(horizon.replace(/\s+/g, '-')) + '">' + esc(labels[horizon]) + '</span>' +
          esc(item.title) + '</dt><dd>' + esc(item.detail) + '</dd>';
      }
    }
    // Anything with an unrecognised horizon still gets shown rather than
    // silently dropped: a missing action is worse than an unlabelled one.
    for (const item of values.filter(a => !Object.prototype.hasOwnProperty.call(labels, a.horizon))) {
      html += '<dt>' + esc(item.title) + '</dt><dd>' + esc(item.detail) + '</dd>';
    }
    return html + '</dl>';
  }

  function careerFacet(label, facet) {
    if (!facet) return '';
    return '<div class="career-facet"><span class="career-label">' + esc(label) + '</span>' +
      '<h4>' + esc(facet.headline) + '</h4><p>' + esc(facet.detail) + '</p>' +
      evidence(facet.evidence) + '</div>';
  }

  function careerAssessmentBodyHtml(assessment) {
    let html = '';
    if (assessment.situation) {
      html += '<h3>' + esc(TEXT.careerSituation) + '</h3>' + paragraphs(assessment.situation);
    }
    // The edge is the finding the section exists for, so it gets the callout
    // treatment rather than sitting level with the two beside it.
    if (assessment.edge) {
      html += '<div class="callout career-edge"><span class="career-label">' + esc(TEXT.careerEdge) + '</span>' +
        '<h3>' + esc(assessment.edge.headline) + '</h3><p>' + esc(assessment.edge.detail) + '</p>' +
        evidence(assessment.edge.evidence) + '</div>';
    }
    html += '<div class="career-grid">' +
      careerFacet(TEXT.careerUnderused, assessment.underused) +
      careerFacet(TEXT.careerHoldingBack, assessment.holdingBack) + '</div>';
    html += '<h3>' + esc(TEXT.careerActions) + '</h3>' + careerActions(assessment.actions);
    return html;
  }

  // ---------- the paywall: four sections behind one S$1.99 unlock ----------
  //
  // The wellness read, the attachment read, the career coaching and the roast
  // are all generated by a single paid call (lib/prompts.js's PREMIUM_SCHEMA)
  // and unlocked together. `state.profile.premiumAnalysis` holds that call's
  // result once there is one — its mere presence *is* "unlocked"; there is no
  // separate boolean that could drift out of sync with whether real content
  // actually exists.
  //
  // The writing is NOT in the markup before it is paid for. Blurring it with
  // CSS would look the same and protect nothing: select-all copies it, a
  // screen reader reads it out, and view-source hands it over. The server does
  // not even run the paid model call until it has independently verified a
  // real payment (lib/stripe.js's verifyPaid) or a valid promo code, so there
  // is nothing for a page saved or view-sourced before that point to give
  // away — the covers ship alone, and `revealPaid` injects the writing once a
  // real result has actually arrived.

  /**
   * The paid sections, in the order they appear in the report. This table is
   * the whole rule: `reportSectionsHtml` walks it, `revealPaid` walks it, and
   * `unlockedSections` keys off it, so adding a paywalled section later means
   * adding one entry here (plus its twin in docs/pdf.js's PAID_SECTIONS) and
   * nothing else.
   *
   * `body` is deliberately the *inner* HTML only — the card shell, the section
   * head and the cover are `paidCard`'s job. That split is what stops a new
   * paid section quietly rendering itself without a cover, which is the one
   * mistake in this area that would look fine and charge nobody.
   */
  const PAID_SECTIONS = [
    {
      key: 'wellness', icon: '🌱', cardClass: 'wellness-card',
      title: () => TEXT.wellness, sub: () => TEXT.wellnessSub,
      coverTitle: () => TEXT.wellnessCoverTitle, coverBlurb: () => TEXT.wellnessCoverBlurb,
      body: wellnessBodyHtml,
    },
    {
      key: 'attachment', icon: '🔗', cardClass: 'attachment-card',
      title: () => TEXT.attachment, sub: () => TEXT.attachmentSub,
      coverTitle: () => TEXT.attachmentCoverTitle, coverBlurb: () => TEXT.attachmentCoverBlurb,
      body: attachmentBodyHtml,
    },
    {
      key: 'idealPartner', icon: '💘', cardClass: 'ideal-partner-card',
      title: () => TEXT.idealPartner, sub: () => TEXT.idealPartnerSub,
      coverTitle: () => TEXT.idealPartnerCoverTitle, coverBlurb: () => TEXT.idealPartnerCoverBlurb,
      body: idealPartnerBodyHtml,
    },
    {
      // Not 🎯: the confidence card at the foot of every report already uses
      // that one, and two sections wearing the same icon reads as a rendering
      // mistake rather than as two different things. 🪜 is the one image in
      // reach that says "career" without colliding with 💼 ("How you work",
      // the free section) or 🧭 (the MBTI block) either.
      key: 'careerAssessment', icon: '🪜', cardClass: 'career-card',
      title: () => TEXT.careerAssessment, sub: () => TEXT.careerAssessmentSub,
      coverTitle: () => TEXT.careerCoverTitle, coverBlurb: () => TEXT.careerCoverBlurb,
      body: careerAssessmentBodyHtml,
    },
  ];

  /**
   * What this profile has actually paid for, keyed by `PAID_SECTIONS` keys —
   * the same names docs/pdf.js uses. One paid call fills all four, so this is
   * really asking "did that call come back", but it is written per-section so
   * a partial response degrades to missing sections rather than to a card
   * whose cover is gone and whose body is blank.
   *
   */
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

  /**
   * The reader's proof that they already paid, kept on their device.
   *
   * The paid call takes minutes, and until now everything about it lived in
   * one page's memory: close the tab while it ran and the payment was real,
   * the analysis was gone, and the cover was back to asking for S$1.99. The
   * server has always allowed a handful of generations per PaymentIntent
   * (lib/premiumLedger.js) for exactly this, but the browser had no way to
   * know it was entitled to one.
   *
   * What is stored is the authorisation and nothing else — a PaymentIntent id
   * or a promo code, both of which the server re-verifies on every use. Not
   * the report: the report belongs in `psycheai_profile` with the rest of it,
   * and duplicating it here would be a second copy of somebody's roast on
   * their disk for no reason.
   *
   * Deliberately *not* a server-side cache of the finished analysis, which
   * would be the faster answer. This app's whole shape is that the server
   * keeps no reader's data; holding generated reports there to survive a
   * closed tab would trade that promise for a convenience the ledger already
   * covers. The cost is that resuming re-runs the model call. That cost falls
   * on whoever runs the server, which is the right person to carry it.
   */
  function unlockReceipt() {
    const saved = store.read(KEYS.unlock, null);
    if (!saved || typeof saved !== 'object') return null;
    if (typeof saved.paymentIntentId === 'string' && saved.paymentIntentId) {
      return { paymentIntentId: saved.paymentIntentId };
    }
    if (typeof saved.promoCode === 'string' && saved.promoCode) return { promoCode: saved.promoCode };
    return null;
  }

  function rememberUnlock(auth) {
    store.write(KEYS.unlock, { ...auth, at: Date.now() });
  }

  /** True once there is something to fetch but nothing fetched yet. */
  function hasUnfetchedUnlock() {
    return Boolean(unlockReceipt()) && !Object.keys(paidAnalysis()).length;
  }

  function paidAnalysis() {
    return unlockedSections(state.profile);
  }

  // Every paid section carries the same "Premium" badge — it is what marks a
  // section as behind the paywall, not a label specific to any one of them.
  // The badge is unescaped HTML spliced onto an already-escaped title —
  // sectionHead just concatenates whatever it is handed into the <h2>, so
  // this is the one call site that hands it a title with markup in it rather
  // than plain text, same trick .mode-title uses beside "Coming soon".
  //
  // `options.sample` renders the same cover a real report shows — same title,
  // same blurb — but with a plain "Unlock" button that is `disabled` rather
  // than priced or wired to anything. A disabled button never dispatches a
  // click event at all, in any browser, so the delegated `.premium-unlock`
  // listener never sees it fire; that is what actually keeps a demo report
  // from opening a real payment dialog, not a scope check on the listener.
  // Shared by paidCard and paidSectionsLockedHtml, so the two never say
  // different things about the same button. A reader who already paid is
  // never shown the price again — the receipt is the difference between
  // "buy this" and "collect what you bought", and showing S$1.99 to somebody
  // mid-resume reads as being charged twice, the single worst thing this
  // button could imply.
  function premiumUnlockLabel(sample) {
    return sample
      ? esc(TEXT.premiumSampleUnlockLabel)
      : (hasUnfetchedUnlock()
        ? esc(TEXT.premiumResumeLabel)
        : esc(TEXT.premiumUnlockPrefix) + esc(TEXT.premiumPriceLabel));
  }

  function paidCard(section, unlocked, options) {
    const sample = Boolean(options && options.sample);
    const data = unlocked[section.key];
    const badge = ' <span class="mode-badge">' + esc(TEXT.premiumBadge) + '</span>';
    return '<div class="card section-card paid-card ' + section.cardClass +
      '" data-paid="' + esc(section.key) + '">' +
      sectionHead(section.icon, esc(section.title()) + badge, esc(section.sub()), true) +
      '<div class="premium-cover"' + (data ? ' hidden' : '') + '>' +
      '<h3>' + esc(section.coverTitle()) + '</h3>' +
      '<p>' + esc(section.coverBlurb()) + '</p>' +
      '<button class="btn premium-unlock" type="button" aria-expanded="' + Boolean(data) + '"' +
      (sample ? ' disabled' : '') + '>' + premiumUnlockLabel(sample) + '</button></div>' +
      '<div class="premium-body"' + (data ? '' : ' hidden') + '>' +
      (data ? section.body(data) : '') + '</div></div>';
  }

  /**
   * Shown instead of the four individual `paidCard()` covers while nothing
   * is unlocked yet — one block naming and explaining all four sections,
   * with exactly one "Unlock — S$1.99" button at the bottom, rather than
   * four separate price tags for what is in fact one purchase. Reuses the
   * `.premium-tier` look premiumTierHtml() already established on the
   * welcome page for the same offer, so the two read as one system; this is
   * the one place among that family with a real, wired-up `.premium-unlock`
   * button rather than a marketing preview.
   *
   * Only reached from reportSectionsHtml when `Object.keys(unlocked).length
   * === 0` — the moment anything at all comes back from the paid call, the
   * four sections switch to their own full cards (see paidCard) and this
   * block does not render again, sample included.
   */
  function paidSectionsLockedHtml(options) {
    const sample = Boolean(options && options.sample);
    const items = PAID_SECTIONS.map(section =>
      '<li class="premium-tier-item">' +
      '<span class="premium-tier-icon" aria-hidden="true">' + section.icon + '</span>' +
      '<span class="premium-tier-text"><strong>' + esc(section.title()) + '</strong>' +
      '<span>' + esc(section.coverBlurb()) + '</span>' +
      '</span></li>').join('');
    return '<div class="premium-tier paid-consolidated">' +
      '<div class="premium-tier-head">' +
      '<span class="mode-badge">' + esc(TEXT.premiumBadge) + '</span>' +
      '<h3>' + esc(TEXT.premiumTierTitle) + '</h3>' +
      '</div>' +
      '<p class="premium-tier-blurb">' + esc(TEXT.premiumTierBlurb) + '</p>' +
      '<ul class="premium-tier-list">' + items + '</ul>' +
      '<button class="btn premium-unlock" type="button" aria-expanded="false"' +
      (sample ? ' disabled' : '') + '>' + premiumUnlockLabel(sample) + '</button>' +
      '</div>';
  }

  function bonusBodyHtml(analysis) {
    return '<p class="fineprint bonus-caveat">' + esc(TEXT.bonusCaveat) + '</p>' +
      '<h3>' + esc(TEXT.bonusHarsh) + '</h3>' + paragraphs(analysis.harsh) +
      '<h3>' + esc(TEXT.bonusAdvice) + '</h3>' + paragraphs(analysis.advice);
  }

  // Free, behind a cover the reader has to click through — not a paid
  // section, so it is not in PAID_SECTIONS and shares nothing with
  // paidCard()/paidSectionsLockedHtml() beyond a similar look.
  //
  // The writing is NOT written into the markup here. Blurring it with CSS
  // would look the same and protect nothing: select-all copies it, a screen
  // reader reads it out, and view-source hands it over. Somebody who has
  // decided not to read this should not have it on their page at all, so
  // the cover ships alone and revealRoast() injects the writing on the
  // click, reading it from the report object rather than out of the page.
  function roastBlock(bonus) {
    if (!bonus) return '';
    return '<div class="card section-card bonus-card">' +
      sectionHead('🕳️', esc(TEXT.bonus), esc(TEXT.bonusSub), true) +
      '<div class="bonus-cover">' +
      '<h3>' + esc(TEXT.bonusCoverTitle) + '</h3>' +
      '<p>' + esc(TEXT.bonusCoverBlurb) + '</p>' +
      '<button class="btn btn-ghost bonus-reveal" type="button" aria-expanded="false">' +
      esc(TEXT.bonusReveal) + '</button></div>' +
      '<div class="bonus-body" hidden></div></div>';
  }

  /** Fills a cover's sibling body with the writing it was hiding. */
  function revealRoast(cover, bonus) {
    const card = cover.closest('.bonus-card');
    const body = card.querySelector('.bonus-body');
    body.innerHTML = bonusBodyHtml(bonus) +
      '<button class="btn btn-ghost bonus-hide" type="button">' + esc(TEXT.bonusHide) + '</button>';
    body.hidden = false;
    cover.hidden = true;
  }

  /** Puts the cover back, and takes the writing out of the page with it. */
  function hideRoast(button) {
    const card = button.closest('.bonus-card');
    const body = card.querySelector('.bonus-body');
    const cover = card.querySelector('.bonus-cover');
    body.innerHTML = '';
    body.hidden = true;
    cover.hidden = false;
    const reveal = cover.querySelector('.bonus-reveal');
    reveal.setAttribute('aria-expanded', 'false');
    reveal.focus();
  }

  /**
   * The premium tier block the welcome page and the sample dialog show, built
   * from `PAID_SECTIONS` rather than written out in index.html three times.
   *
   * That matters more than it looks: this is marketing copy naming four
   * sections by title and price, and marketing copy that has drifted from the
   * product is the kind of wrong nobody notices for months. Reading the same
   * table the report renders from means a rename in copy.js moves the landing
   * page with it, and `coverTitle` doubles as the one-line hook here because
   * that is exactly the job it already does on the cover itself.
   *
   * The sample dialog used to get its own compact variant of this block,
   * pinned as a footer below a report with the four paid sections stripped
   * out of it. The sections are rendered inline in the sample body now (see
   * `paidCard`'s `sample` option), so the footer — and the compact mode that
   * existed only for it — is gone rather than kept beside a cover that
   * already says the same thing.
   */
  function premiumTierHtml() {
    const items = PAID_SECTIONS.map(section =>
      '<li class="premium-tier-item">' +
      '<span class="premium-tier-icon" aria-hidden="true">' + section.icon + '</span>' +
      '<span class="premium-tier-text"><strong>' + esc(section.title()) + '</strong>' +
      '<span>' + esc(section.coverTitle()) + '</span>' +
      '</span></li>').join('');
    return '<div class="premium-tier">' +
      '<div class="premium-tier-head">' +
      '<span class="mode-badge">' + esc(TEXT.premiumBadge) + '</span>' +
      '<h3>' + esc(TEXT.premiumTierTitle) + '</h3>' +
      '<span class="premium-tier-price">' + esc(TEXT.premiumPriceLabel) + '</span></div>' +
      '<p class="premium-tier-blurb">' + esc(TEXT.premiumTierBlurb) + '</p>' +
      '<ul class="premium-tier-list">' + items + '</ul>' +
      '</div>';
  }

  /**
   * Mounted synchronously at start-up rather than inside `boot()`, which
   * awaits the server status call — the welcome page is the first thing a
   * reader sees and should not have a block of it arrive after a round trip.
   */
  function mountPremiumTiers() {
    for (const slot of document.querySelectorAll('[data-premium-tier]')) {
      slot.innerHTML = premiumTierHtml();
    }
  }

  /**
   * The free half's own label, shown once above the four free branches — the
   * parallel statement to the premium tier block below it, reusing the same
   * badge shape (`.mode-badge`) in a different colour (`.is-free`) so the two
   * read as one system rather than two different UI languages for "what does
   * this cost and who writes it".
   */
  function freeTierNoteHtml() {
    return '<span class="mode-badge is-free">' + esc(TEXT.insightFreeBadge) + '</span> ' +
      esc(TEXT.insightFreeNote);
  }

  function mountFreeTierNotes() {
    for (const slot of document.querySelectorAll('[data-free-tier-note]')) {
      slot.innerHTML = freeTierNoteHtml();
    }
  }

  /**
   * Fills every paid card's body once a real result has arrived, in place
   * rather than by re-rendering the report — a reader who has just paid is
   * looking at one of these cards, and rebuilding #profile-body would throw
   * their scroll position away at exactly that moment.
   */
  function revealPaid(analysis) {
    const unlocked = unlockedSections({ premiumAnalysis: analysis });
    // Until now the reader was looking at the single consolidated block —
    // see paidSectionsLockedHtml — which has no per-section cover or body to
    // fill in place. Replace it outright with the four real cards, fully
    // unlocked, rather than trying to reveal elements that never existed
    // inside it.
    const consolidated = document.querySelector('#profile-body .paid-consolidated');
    if (consolidated) {
      consolidated.outerHTML = PAID_SECTIONS.map(section => paidCard(section, unlocked, {})).join('');
    } else {
      // Defensive fallback for the one case where individual cards could
      // already be on screen — a stale unlock receipt from before this block
      // existed, still holding a partial `premiumAnalysis` client-side.
      for (const section of PAID_SECTIONS) {
        const data = unlocked[section.key];
        const card = document.querySelector('#profile-body .paid-card[data-paid="' + section.key + '"]');
        if (!card || !data) continue;
        const cover = card.querySelector('.premium-cover');
        const body = card.querySelector('.premium-body');
        body.innerHTML = section.body(data);
        body.hidden = false;
        cover.hidden = true;
        cover.querySelector('.premium-unlock').setAttribute('aria-expanded', 'true');
      }
    }
    // One call for both routes, and only one of them strictly needs it: cards
    // built fresh above are born open, since nothing has run collapseSections
    // over them, while the ones the fallback finds already on screen were shut
    // by the render that put them there. Stating it once for both is what
    // makes "what you just paid for is open" a property of this function
    // rather than of whichever branch happened to run.
    openPaidSections();
  }

  /**
   * The one exception to sections arriving shut — see collapseSections. A
   * reader who has just paid should be looking at what they bought, not at
   * four more shut headings to click through to find it.
   */
  function openPaidSections() {
    for (const card of document.querySelectorAll('#profile-body .paid-card')) {
      setSectionOpen(card, true);
    }
  }

  // The wrapper exists for print: a trait's bar, its reading and its evidence
  // are one thought, and a page break between them looks like a mistake.
  function bar(label, value, extra) {
    const width = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    return '<div class="trait-block">' +
      '<div class="trait-row"><span class="trait-label">' + esc(label) + '</span>' +
      '<div class="bar"><div class="bar-fill" style="width:' + width + '%"></div></div>' +
      '<span class="trait-num">' + width + '</span></div>' + (extra || '') + '</div>';
  }

  // ---------- routing ----------

  const VIEWS = ['welcome', 'working', 'profile', 'scan', 'report', 'about'];

  // Views a reader reaches by navigating away from wherever they actually
  // live — the nav bar's "My Compatibility" and "FAQ", a fresh scan's result,
  // a past comparison opened from the history table. On a phone, Back is how
  // people leave any of these the way they would close something covering the
  // page — see navHistoryEntry's own declaration below for the fix. 'working'
  // is deliberately not here: it is a transient step inside reaching 'report'
  // (scan → working → report), never a place someone arrives at directly or
  // means to leave from, so it must not trigger a push or a pop on its own.
  const SECONDARY_VIEWS = ['scan', 'report', 'about'];
  // Where Back actually belongs once a secondary view's entry is popped —
  // whichever of these is real right now. Reached through go('home'), which
  // already knows to fall back to 'welcome' for a reader who opened the FAQ
  // before ever having a profile at all.
  const HOME_VIEWS = ['welcome', 'profile'];

  // Both links lead somewhere that redirects straight back to the upload page
  // until a profile exists, so until then they are noise. They start hidden in
  // the markup and appear the moment there is something to point at.
  function syncNav() {
    const ready = Boolean(state.profile);
    $('#nav-profile').hidden = !ready;
    $('#nav-scan').hidden = !ready;
  }

  function show(view) {
    if (view !== 'scan') stopCamera();
    // Arriving at a home view gives back the entry pushed for whichever
    // secondary view preceded it — a nav link, a fresh scan's result, anything
    // other than the Back press the entry exists for. Left in place, a later
    // Back from wherever this navigation actually lands would pop a phantom
    // state and jump to a home view unannounced. See navHistoryEntry's own
    // declaration for why the entry exists at all, and the popstate listener
    // below for the other half of this same guard.
    if (navHistoryEntry && HOME_VIEWS.includes(view) && !closingNavFromHistory) {
      navHistoryEntry = false;
      history.back();
    }
    for (const name of VIEWS) $('#view-' + name).hidden = name !== view;
    syncNav();
    // The psyche card is scaled from the width of the column it sits in, and a
    // hidden view measures zero — so a card rendered before its view was shown
    // would be scaled to nothing. Re-fit here, where the width is real.
    if (view === 'profile') layoutPsycheCard();
    window.scrollTo(0, 0);
    // One entry covers a whole excursion into any of the secondary views, not
    // one per view — moving between them (about → scan, or scan → its own
    // report) never stacks a second pushState behind the first. Guarded on
    // navHistoryEntry already being false, which is also what stops this from
    // re-firing on every one of the several show() calls a single scan →
    // working → report sequence makes.
    if (SECONDARY_VIEWS.includes(view) && !navHistoryEntry) {
      history.pushState({ psycheaiNav: true }, '');
      navHistoryEntry = true;
    }
  }

  // ---- the sample report ----
  //
  // A dialog over the page rather than a view of its own. It renders the same
  // section HTML a real report renders, because anything less than the real
  // layout is a mockup and a mockup is what people discount — but it is
  // something to look into and step back out of, so nothing here touches
  // state.profile or storage, and the nav does not change underneath it.
  //
  // Back closes it. On a phone, back is what people reach for to dismiss
  // something covering the page, and without an entry to pop they leave the
  // site instead. The entry is pushed on open and popped on close; the flag
  // stops the two paths chasing each other — a close triggered by popstate
  // must not call history.back() a second time.
  let sampleHistoryEntry = false;
  let closingFromHistory = false;
  let sampleReport = null;
  const sampleDialog = () => $('#sample-dialog');

  async function showSample(button) {
    const dialog = sampleDialog();
    if (dialog.open) return;
    const label = button && button.textContent;
    if (button) { button.disabled = true; button.textContent = 'Loading…'; }
    try {
      const report = await fetch('sample.json').then(response => {
        if (!response.ok) throw new Error('The sample could not be loaded.');
        return response.json();
      });
      // Kept so the roast can be revealed on demand inside the sample too.
      // Its text is deliberately not written into the markup until the
      // reader asks for it — see roastBlock()/revealRoast().
      sampleReport = report;
      // The summary card first, exactly as a real report opens — a reader
      // being shown what this app produces should meet the same thing its
      // readers meet, and the card is the one part of the report that reads
      // at a glance. Same psycheCardHtml() the reader's own report uses, from
      // the same sample.json the sections below it come from.
      //
      // Its head carries no .card-head-toggle, which is what keeps it open:
      // collapseSections only shuts cards whose head has one, the same
      // mechanism that leaves the confidence card alone.
      const cardHtml = psycheCardHtml(report);
      $('#sample-psyche-card').innerHTML = cardHtml;
      $('#sample-card-section').hidden = !cardHtml;
      $('#sample-card-title').textContent = TEXT.cardSection;
      $('#sample-sections').innerHTML = reportSectionsHtml(report, { sample: true });
      collapseSections($('#sample-body'));
      $('#sample-body').scrollTop = 0;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // After showModal, not before: fitCard measures offsetHeight, and a
      // closed <dialog> has no layout at all — called any earlier it reads a
      // natural height of 0, bails out, and leaves the card unscaled and
      // overflowing its frame.
      layoutSampleCard();
      history.pushState({ psycheaiSample: true }, '');
      sampleHistoryEntry = true;
    } catch (error) {
      flash('#upload-error', (error && error.message) || 'The sample could not be loaded.');
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  function closeSample() {
    const dialog = sampleDialog();
    if (dialog.open) dialog.close();
    else if (dialog.hasAttribute('open')) dialog.removeAttribute('open');
  }

  sampleDialog().addEventListener('close', () => {
    // Esc and the cross both land here. Drop the entry we pushed so the
    // reader's next Back goes where it would have gone before they looked.
    if (sampleHistoryEntry && !closingFromHistory) history.back();
    sampleHistoryEntry = false;
    // Emptied rather than left in place. A closed dialog is still in the
    // document, so a whole second report's worth of markup would sit there
    // shadowing the real one's selectors — and the sections it builds are the
    // same ones the reader's own report uses.
    //
    // The two slots are emptied, not #sample-body itself: the card section's
    // own frame is markup in index.html now rather than something showSample
    // builds, and wiping the container would take it away for good, leaving
    // every later open with no card at all.
    $('#sample-sections').innerHTML = '';
    $('#sample-psyche-card').innerHTML = '';
    $('#sample-card-section').hidden = true;
    sampleReport = null;
  });

  window.addEventListener('popstate', () => {
    if (sampleDialog().open || sampleDialog().hasAttribute('open')) {
      closingFromHistory = true;
      sampleHistoryEntry = false;
      closeSample();
      closingFromHistory = false;
      return;
    }
    // Falls through here only once the sample dialog (if it was even open)
    // is out of the way — a Back press pops one history entry, and if that
    // entry was the sample's own, whatever secondary view sits underneath it
    // is not what this press was aimed at. A second Back, with nothing left
    // to close, reaches this branch on its own next time. See
    // navHistoryEntry's own declaration for why leaving a secondary view any
    // other way must also consume this entry.
    if (navHistoryEntry) {
      closingNavFromHistory = true;
      navHistoryEntry = false;
      go('home');
      closingNavFromHistory = false;
    }
  });

  // ---- getting back to a home view ----
  //
  // My Compatibility, the FAQ, a fresh scan's result, a past comparison
  // opened from the history table — every one of these is a page the reader
  // arrived at by navigating away from their own psyche page, and on a
  // phone, Back is how people leave any of them the way they would close
  // something covering what they were looking at. Nothing pushed a history
  // entry for any of them before, so Back had nowhere to go but out of the
  // site entirely. One entry per excursion fixes that, the same way
  // showSample() already does for its own dialog — see SECONDARY_VIEWS and
  // show()'s own push/pop for where this actually happens; the flags live
  // here only because show() and the popstate listener above both need them,
  // and neither is defined yet at this point in the file.
  let navHistoryEntry = false;
  let closingNavFromHistory = false;

  function go(target) {
    closeSample();
    if (target === 'home') { return state.profile ? go('profile') : show('welcome'); }
    if (target === 'profile') {
      if (!state.profile) return show('welcome');
      renderProfile(); show('profile'); return;
    }
    if (target === 'scan') {
      if (!state.profile) return showUploadError('Build your own profile first — a report needs two people.');
      renderScan(); show('scan'); return;
    }
    if (target === 'about') { renderAbout(); show('about'); return; }
    show(target);
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (!nav) return;
    event.preventDefault();
    // "Scan your partner or friend" lives inside #compat-dialog now — without
    // this, navigating away leaves the dialog (and its backdrop) open on top
    // of the view it just switched to.
    const openDialog = nav.closest('dialog[open]');
    if (openDialog) openDialog.close();
    go(nav.dataset.nav);
  });

  function flash(selector, message) {
    const node = $(selector);
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  // ══════════════ 1. upload and analysis ══════════════

  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');

  // The hero's primary action. It scrolls rather than jumping straight into
  // the file picker: an OS dialog opening on a page the reader has not seen
  // the bottom of yet is startling, and the switches above the dropzone are
  // choices they should get to look at first.
  // The hero's primary action lands on the how-to rather than the dropzone.
  // Somebody pressing it on a first visit has no export yet — the file they
  // would need is an email from Instagram that takes hours to arrive — so the
  // useful next step is the instructions for requesting one. The upload box is
  // directly beneath them when they come back.
  // The stylesheet's reduced-motion block only reaches `transition` and
  // `animation`; scrollIntoView is a JS API and sails straight past it, so a
  // reader who asked for less motion would still get a full-page glide. Read at
  // click time rather than at load, so changing the OS setting takes effect
  // without a reload.
  const scrollBehaviour = () =>
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto' : 'smooth');

  // Every place that lands back on the welcome page with something to say —
  // a bad archive, a bad photo, a failed analysis, a stale share link — used
  // to call show('welcome') and flash the message in the same breath. show()
  // always scrolls to the very top of the page, so the message landed below
  // the fold behind the hero, the how-it-works row and the instructions card,
  // and a reader who had scrolled down to drop a file saw nothing happen.
  // This is the one path back that keeps the reason on screen: it scrolls to
  // the message itself once show() and flash() have both run, rather than to
  // wherever show() happens to leave the page.
  function showUploadError(message) {
    show('welcome');
    flash('#upload-error', message);
    $('#upload-error').scrollIntoView({ behavior: scrollBehaviour(), block: 'center' });
  }

  $('#hero-start').addEventListener('click', () => {
    show('welcome');
    $('.help-card').scrollIntoView({ behavior: scrollBehaviour(), block: 'start' });
  });
  $('#hero-sample').addEventListener('click', event => showSample(event.currentTarget));
  $('#insight-sample').addEventListener('click', event => showSample(event.currentTarget));
  $('#sample-close').addEventListener('click', closeSample);

  // Delegated, because the cover is written by innerHTML. The sample renders
  // its own `.premium-unlock` buttons now, same as a real report — what keeps
  // one of them from ever reaching here is the `disabled` attribute paidCard
  // sets in sample mode: a disabled button dispatches no click event in any
  // browser, so this listener simply never fires for it, with no scope check
  // needed against #sample-body.
  document.addEventListener('click', event => {
    const unlock = event.target.closest('.premium-unlock');
    if (unlock) openPremiumDialog(unlock, 'unlock');
  });

  // Delegated for the same reason — the covers are written by innerHTML in
  // two places, the real report and the sample dialog, and both need the
  // same behaviour. Unlike `.premium-unlock` above, neither of these ever
  // opens a payment dialog: the roast is free, so this only ever toggles
  // between a cover and the writing it was hiding. The writing itself is
  // looked up from whichever report the clicked cover belongs to rather
  // than read out of the page, since the whole point is that it was never
  // put in the page.
  document.addEventListener('click', event => {
    const reveal = event.target.closest('.bonus-reveal');
    if (reveal) {
      const source = event.target.closest('#sample-body')
        ? sampleReport
        : state.profile && state.profile.report;
      if (!source || !source.bonus) return;
      reveal.setAttribute('aria-expanded', 'true');
      revealRoast(reveal.closest('.bonus-cover'), source.bonus);
      return;
    }
    const hide = event.target.closest('.bonus-hide');
    if (hide) hideRoast(hide);
  });

  // Opening and shutting a section. Delegated for the same reason as the two
  // above: these heads are written by innerHTML in both the real report and
  // the sample dialog, and a listener bound to the elements themselves would
  // be orphaned by the next render.
  //
  // Bound to the whole head rather than to `.card-toggle` alone, so the title
  // and the sub-line are as clickable as the chevron is — a disclosure whose
  // hit area is a 2rem glyph at the end of the row is a worse one. The button
  // inside bubbles up to this same handler, so a click on it toggles once,
  // not twice.
  document.addEventListener('click', event => {
    const head = event.target.closest('.card-head-toggle');
    if (!head) return;
    const card = head.closest('.section-card');
    if (!card) return;
    const opening = card.classList.contains('is-collapsed');
    setSectionOpen(card, opening);
    // Accordion, not a pile of open sections: opening one shuts every other
    // one already open in the same report, so the page stays as compact as
    // collapsing it in the first place was for — an index a reader picks one
    // thing from at a time, not a list that just regrows as they explore it.
    // Scoped to whichever report this card actually belongs to (the real one
    // or the sample dialog's), so opening a section in one never reaches
    // across and shuts a section in the other.
    if (opening) {
      const scope = card.closest('#profile-body, #sample-body') || document;
      for (const head2 of scope.querySelectorAll('.card-head-toggle')) {
        const other = head2.closest('.section-card');
        if (other && other !== card) setSectionOpen(other, false);
      }
    }
  });

  // Same reason: sourcesUsedHtml() writes this into #profile-body's innerHTML
  // on every render, so a listener bound once to the element itself would be
  // orphaned the next time the report redraws.
  document.addEventListener('click', event => {
    if (event.target.closest('#rerun-with-data')) startRerun();
  });

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('is-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
    handleFiles(event.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  function setProgress(percent, label) {
    $('#progress-bar').style.width = percent + '%';
    if (label) $('#progress-label').textContent = label;
  }

  // The model call has no progress to report, so show elapsed time instead of
  // a bar that lies.
  let elapsedTimer = null;
  function startElapsed(label) {
    const started = Date.now();
    $('#progress-bar').classList.add('indeterminate');
    stopElapsed();
    elapsedTimer = setInterval(() => {
      const seconds = Math.round((Date.now() - started) / 1000);
      $('#progress-label').textContent = label + ' — ' + seconds + 's';
    }, 1000);
    $('#progress-label').textContent = label + ' — 0s';
  }
  function stopElapsed() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    $('#progress-bar').classList.remove('indeterminate');
  }

  // Offered once the Instagram archive has parsed, and again whenever the
  // reader presses Back on the review.
  //
  // Unlike every other dialog here, this one does not resolve-then-act: it
  // stays open while a second archive is read, and only Skip or Continue
  // close it. That is forced by the file picker. `input.click()` opens the OS
  // dialog only inside a user-gesture task, and a promise that resolves and
  // *then* opens a picker has lost that gesture — Safari and Firefox block it.
  // So the picker is opened synchronously from the source button's own click
  // handler. Staying open is also the better flow: a reader can add Google and
  // Facebook without the dialog closing and reopening between them.
  //
  // Resolves an object of what was added — Skip and Continue are the same
  // resolution, the only difference being what is in it, and Escape behaves as
  // Skip. Back is the one exception: it resolves null, and handleFiles drops
  // back to the welcome page on it. That is why the return is not
  // unconditionally an object.
  //
  // `existing` seeds it on re-entry. Coming back from the review has to find
  // the archives still added: re-reading a Takeout is slow, and silently
  // discarding one because the reader wanted to change a checkbox upstream
  // would be the dialog undoing their work.
  //
  // `opts.requireAtLeastOne` is what "Re-run analysis with additional data"
  // needs and the first-upload path does not: Skip stays hidden regardless of
  // whether anything has been added yet (rather than only once something
  // has), and Escape is refused while `added` is still empty, so the one
  // dialog that exists specifically because the reader chose to add a source
  // cannot be dismissed without one. Back is untouched by this — it still
  // always resolves null — because "I changed my mind" has to stay available
  // even in this mode; only "leave with nothing, some other way" is blocked.
  function askSupplement(existing, opts) {
    const requireAtLeastOne = Boolean(opts && opts.requireAtLeastOne);
    const dialog = $('#supplement-dialog');
    const status = $('#supplement-status');
    const input = $('#supplement-input');
    const buttons = dialog.querySelectorAll('.mode-option');
    const added = Object.assign({}, existing || {});
    let pending = '';
    let busy = false;
    let cancelled = false;

    const LABELS = { google: 'Google Takeout', facebook: 'Facebook' };

    const say = (message, tone) => {
      status.textContent = message || '';
      status.hidden = !message;
      status.className = 'supplement-status' + (tone ? ' is-' + tone : '');
    };

    // Skip is only truthful while nothing has been contributed. The moment an
    // archive is in — or is being read — the right-hand slot belongs to
    // Continue, so the two swap rather than sitting side by side. Back is
    // untouched by this and stays available throughout, including mid-read.
    // In requireAtLeastOne mode Skip never gets its turn at all: there is
    // nothing truthful it could say, since this dialog only opens because the
    // reader chose to add a source.
    const showActions = () => {
      const has = Object.keys(added).length > 0;
      $('#supplement-continue').hidden = !has;
      $('#supplement-skip').hidden = requireAtLeastOne || has || busy;
    };

    const setBusy = state => {
      busy = state;
      for (const button of buttons) button.disabled = state || Boolean(added[button.dataset.supplement]);
      showActions();
    };

    // Drives the bar on one row. `percent` of null puts the row back to rest:
    // the bar is hidden and the width reset, so the next read starts from empty
    // rather than animating down from wherever the last one stopped.
    const rowOf = source => dialog.querySelector('.mode-option[data-supplement="' + source + '"]');
    const setSourceProgress = (source, percent, label) => {
      const row = rowOf(source);
      if (!row) return;
      const wrap = row.querySelector('.mode-progress');
      const bar = row.querySelector('.progress-bar');
      const text = row.querySelector('.mode-progress-label');
      row.classList.toggle('is-loading', percent !== null);
      wrap.hidden = percent === null;
      bar.style.width = (percent === null ? 0 : percent) + '%';
      if (label !== undefined) text.textContent = label || '';
    };

    // The row itself carries "added" now, rather than a separate green line
    // restating it underneath. Two reasons it belongs on the row: it is the
    // thing the reader is looking at when they wonder whether it worked, and a
    // per-source state read better per source than as one sentence that had to
    // join names with "and" as the list grew.
    //
    // Still `disabled` — adding the same export twice makes no sense — but the
    // greying that goes with `disabled` says "you cannot use this" where the
    // truth is "you already did", so `.is-added` overrides it in the stylesheet.
    const markAdded = () => {
      for (const button of buttons) {
        const isAdded = Boolean(added[button.dataset.supplement]);
        button.classList.toggle('is-added', isAdded);
        const tick = button.querySelector('.mode-added');
        if (isAdded && !tick) {
          const mark = document.createElement('span');
          mark.className = 'mode-added';
          // A bare glyph announces as nothing useful, so the tick carries the
          // word for anyone not looking at it.
          mark.setAttribute('role', 'img');
          mark.setAttribute('aria-label', 'Added');
          mark.textContent = '✓';
          button.appendChild(mark);
        } else if (!isAdded && tick) {
          tick.remove();
        }
      }
    };

    const summarise = () => {
      markAdded();
      showActions();
    };

    return new Promise(resolve => {
      const choose = event => {
        const source = event.currentTarget.dataset.supplement;
        if (busy || added[source]) return;
        pending = source;
        // Reset first: the change event does not fire when the same file is
        // picked twice, so without this a reader who re-picks after an error
        // gets silence. Nothing else in this app resets a file input, which is
        // a live bug there and not one to inherit.
        input.value = '';
        input.click();
      };

      const read = async () => {
        const files = Array.from(input.files || []).filter(f => /\.zip$/i.test(f.name));
        input.value = '';
        if (!pending || !files.length) return;
        const source = pending;
        pending = '';
        setBusy(true);
        // The row's own bar reports this now, so the shared status line below
        // stays empty and is left to do the one job the bar cannot: errors.
        say('');
        setSourceProgress(source, 0, 'Opening the archive…');
        try {
          const reader = source === 'google' ? Supplement.readGoogle : Supplement.readFacebook;
          added[source] = await reader(files, {
            // The readers report {phase, done, total}, so this is a real
            // fraction rather than a sweep. 'open' holds a visible sliver so
            // the bar reads as started, and the parse phase — the long one —
            // gets the rest of the track.
            onProgress: p => {
              const share = p.total ? Math.min(1, p.done / p.total) : 0;
              const percent = p.phase === 'open' ? 6
                : p.phase === 'done' ? 100
                : 10 + Math.round(share * 85);
              setSourceProgress(source, percent, p.label);
            },
          });
          setBusy(false);
          setSourceProgress(source, null, '');
          say('');
          summarise();
        } catch (error) {
          setBusy(false);
          setSourceProgress(source, null, '');
          // Deliberately the opposite of handleFiles's catch, which drops back
          // to the welcome page. A failed *supplement* must never cost the
          // reader the Instagram export they already gave: the dialog stays
          // open, says what went wrong, and they can try another file or skip.
          //
          // summarise() no longer writes to the status, which incidentally
          // fixes a real bug: it used to re-assert "✓ Added …" straight over
          // the error whenever anything had already been added, so a second
          // archive failing after a first succeeded reported success.
          say((error && error.message) || 'That archive could not be read.', 'bad');
          summarise();
        }
      };

      const done = () => dialog.close();
      const goBack = () => { cancelled = true; dialog.close(); };
      // The native Escape path: a <dialog> fires a cancelable 'cancel' event
      // just before it closes itself. Refusing it while nothing has been
      // added yet is what actually makes requireAtLeastOne a requirement
      // rather than a suggestion — otherwise Escape would still let a reader
      // leave with nothing, same as Skip would have. Once something is in,
      // Escape is allowed again and resolves the same way Continue does,
      // exactly as it already does outside this mode.
      //
      // Scoped to the dialog's own cancel for the same reason askDataSources
      // scopes its own: the file input inside this dialog fires a bubbling
      // `cancel` of its own when the OS picker is dismissed, and calling
      // preventDefault() on that one refuses a dismissal the reader has every
      // right to make.
      const blockEscape = event => {
        if (event.target !== dialog) return;
        if (requireAtLeastOne && Object.keys(added).length === 0) event.preventDefault();
      };

      for (const button of buttons) button.addEventListener('click', choose);
      input.addEventListener('change', read);
      $('#supplement-skip').addEventListener('click', done);
      $('#supplement-continue').addEventListener('click', done);
      $('#supplement-back').addEventListener('click', goBack);
      dialog.addEventListener('cancel', blockEscape);

      dialog.addEventListener('close', () => {
        for (const button of buttons) {
          button.removeEventListener('click', choose);
          button.disabled = false;
          // The green row has to come off with the disabled state, or a later
          // upload in the same session opens on the previous run's ticks. The
          // reset on open re-applies them from `added` when this was a Back.
          button.classList.remove('is-added');
          const tick = button.querySelector('.mode-added');
          if (tick) tick.remove();
        }
        input.removeEventListener('change', read);
        $('#supplement-skip').removeEventListener('click', done);
        $('#supplement-continue').removeEventListener('click', done);
        $('#supplement-back').removeEventListener('click', goBack);
        dialog.removeEventListener('cancel', blockEscape);
        resolve(cancelled ? null : added);
      }, { once: true });

      // Reset the dialog's own state, because it is reused markup and a second
      // upload in the same session would otherwise open on the last run's
      // error line, its instructions still unfolded, or Skip still hidden from
      // the run before.
      say('');
      cancelled = false;
      // "…or skip straight to it" is true of the first-upload offer and false
      // here, where Skip is not shown at all. Set on every open rather than
      // once, because the same markup serves both callers.
      $('#supplement-dialog-blurb').textContent = requireAtLeastOne
        ? 'Add a Google or Facebook export and PsycheAI will write your report again, using it '
          + 'alongside the Instagram data it already has.'
        : 'You can add a Google or Facebook export to deepen the analysis, or skip straight to it.';
      dialog.querySelector('.supplement-help').open = false;
      // Back stays live mid-read, so a reader can leave with a bar still
      // running and a read still resolving into a dialog nobody is looking at.
      // Both rows go back to rest here rather than on close, so that reopening
      // never shows the last run's bar frozen part-way across.
      for (const button of buttons) setSourceProgress(button.dataset.supplement, null, '');
      setBusy(false);
      // Re-ticks the rows and re-reveals Continue when this is a return trip
      // from the review. No-op on a first open, where `added` is empty.
      summarise();

      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open', ''); buttons[0].focus(); }
    });
  }

  // There is one kind of run. A depth picker used to sit here offering
  // Standard and Comprehensive, which was a question with one available
  // answer since Comprehensive never went on sale — so it cost a click and a
  // decision to arrive back where the reader started. The picker went first;
  // the second set of caps and the second budget followed it out of
  // digest.js once it was clear an unreachable budget was a number everyone
  // still had to reason about. `Digest.IMAGES` is the one image count.

  /** One togglable row: checked and enabled when there is something to send, disabled when there is not. */
  function reviewSwitch(id, count, onLabel, offLabel, detail) {
    const has = count > 0;
    return '<label class="switch-row"><input type="checkbox" id="' + id + '"' +
      (has ? ' checked' : ' disabled') + '>' +
      '<span><strong>' + esc(has ? onLabel : offLabel) + '</strong>' +
      '<span class="muted">' + esc(detail) + '</span></span></label>';
  }

  // Shared by handleFiles (on the real digest, once the dialog has resolved)
  // and askReview's own downloadable preview (on a throwaway clone, while the
  // dialog is still open) — the same six fields, redacted the same way,
  // so the file a reader downloads mid-review cannot drift from what
  // actually goes out once they press Send. Images are not included here:
  // handleFiles's photo handling has a real async side effect (extraction)
  // that a preview must not trigger, so each caller patches
  // coverage.images itself.
  function applyReviewDecision(target, decision) {
    if (!decision.includeCaptions) Digest.omitCaptionsAndComments(target);
    if (!decision.includeActivity) Digest.omitActivity(target);
    if (!decision.includeAccounts) Digest.omitAccounts(target);
    if (!decision.includeTopics) Digest.omitTopics(target);
    if (!decision.includeSearches) Digest.omitSearches(target);
    if (!decision.includeMessages) Digest.omitMessages(target);
    // Each is a no-op when its block is absent, so a reader who added only
    // Google is unaffected by the Facebook keys being false.
    if (!decision.includeYouTube) Digest.omitYouTube(target);
    if (!decision.includeYouTubeSearches) Digest.omitYouTubeSearches(target);
    if (!decision.includeGoogleSearches) Digest.omitGoogleSearches(target);
    if (!decision.includeChrome) Digest.omitChrome(target);
    if (!decision.includeGeminiPrompts) Digest.omitGeminiPrompts(target);
    if (!decision.includeFacebookPosts) Digest.omitFacebookPosts(target);
    if (!decision.includeFacebookConnections) Digest.omitFacebookConnections(target);
    if (!decision.includeFacebookMessages) Digest.omitFacebookMessages(target);
    return target;
  }

  // A self-contained HTML page rather than a raw .json file — opens with a
  // double-click in whatever browser is already installed, no app that
  // understands JSON required. Inline CSS only, no external requests, so it
  // renders identically read offline a year from now. `rows` is askReview's
  // own row list, reused here so the category names and detail lines in this
  // table are read from the same place the checklist itself was, not typed
  // out a second time where they could drift.
  function buildDigestPreviewHtml(rows, decision, preview, photos) {
    const rowsHtml = rows.map(r => {
      const included = decision[r[1]];
      return '<tr><td>' + esc(r[3]) + '</td>' +
        '<td class="' + (included ? 'yes' : 'no') + '">' + (included ? 'Included' : 'Excluded') + '</td>' +
        '<td>' + esc(r[5]) + '</td></tr>';
    }).join('');

    // Embedded as data URIs rather than linked, so the file is one thing the
    // reader can keep, move or open offline — a preview that broke as soon as
    // it left the Downloads folder would be worth little. These are the
    // resized, re-encoded copies that actually go in the request, not the
    // originals from the archive, so the file cannot flatter what is sent.
    const list = Array.isArray(photos) ? photos : [];
    const photosHtml = !list.length ? '' :
      '<h2>Photographs</h2>' +
      // Read off Images.LIMITS rather than written out, because this sentence
      // shipped claiming 1024px against a real edge of 768. A file whose whole
      // job is to state what leaves the device cannot carry a number that has
      // to be kept in sync with the code by hand.
      '<p class="muted">All ' + list.length + ' of them, exactly as they will be sent: resized to ' +
      'fit a ' + Images.LIMITS.edge + 'px edge and re-encoded, which is smaller and softer than ' +
      'the originals still sitting in your export. Nothing else from any photo is included — ' +
      'no location, no filename.</p>' +
      '<div class="shots">' + list.map((p, i) =>
        '<figure><img alt="Photograph ' + (i + 1) + '" src="data:' +
        esc(p.mime || 'image/jpeg') + ';base64,' + esc(p.data) + '">' +
        '<figcaption>' + (i + 1) + '. ' + esc(p.takenAt || 'date unknown') +
        (p.kind && p.kind !== 'post' ? ' · ' + esc(p.kind) : '') +
        (p.hasCaption ? ' · had a caption' : '') + '</figcaption></figure>').join('') +
      '</div>';
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>What was sent to the AI model</title><style>' +
      'body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;' +
      'max-width:840px;margin:2rem auto;padding:0 1.5rem;color:#241a2e;background:#faf7fb}' +
      'h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}' +
      'table{border-collapse:collapse;width:100%;margin:1rem 0}' +
      'th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #e7dfec;font-size:.92rem}' +
      'td.yes{color:#2f7d5b;font-weight:600}td.no{color:#6b6076}' +
      '.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.8rem;' +
      'margin:1rem 0}' +
      '.shots figure{margin:0}' +
      '.shots img{width:100%;height:auto;display:block;border-radius:8px;border:1px solid #e7dfec}' +
      '.shots figcaption{font-size:.78rem;color:#6b6076;margin-top:.3rem}' +
      'pre{background:#fff;border:1px solid #e7dfec;border-radius:10px;padding:1rem;' +
      'overflow-x:auto;font-size:.82rem;white-space:pre-wrap;word-break:break-word}' +
      '.muted{color:#6b6076;font-size:.9rem}' +
      '</style></head><body>' +
      '<h1>What was sent to the AI model</h1>' +
      '<p class="muted">Generated by PsycheAI on ' + esc(new Date().toLocaleString()) +
      '. This file was written directly to your device and was never uploaded anywhere.</p>' +
      '<table><thead><tr><th>Category</th><th>Status</th><th>Detail</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>' +
      photosHtml +
      '<h2>Full digest</h2>' +
      '<p class="muted">The exact object sent alongside your photos, if any were included above.</p>' +
      '<pre>' + esc(JSON.stringify(preview, null, 2)) + '</pre>' +
      '</body></html>';
  }

  // The last stop before anything leaves the device, and the one dialog here
  // that is rebuilt from scratch on every run rather than reused static
  // markup — everything in it is a real count read off the digest that was
  // just built, not a description of what the app generally does. Cancelling
  // discards the digest along with the archive; there is nowhere it is held
  // that a second attempt could reuse, by design — see handleFiles.
  //
  // What askReview resolves, and what each means to handleFiles:
  //   an object    — Send. The decision about what to include.
  //   REVIEW_BACK  — Back. Reopen the supplement offer, keeping what was added.
  //   null         — Escape, or the dialog closed some other way. Abandon.
  const REVIEW_BACK = 'review:back';

  // `getImages` is a lazy extractor, not the images themselves. Decoding and
  // re-encoding a dozen photographs is the slowest thing this app does, and it
  // is deliberately not done before the review — a reader who unticks photos or
  // presses Back must not have paid for them. So the download button is what
  // triggers it, on the one path where the reader has actually asked to see
  // them, and the result is cached so the real send does not decode twice.
  function askReview(digest, imageCount, getImages, options) {
    const dialog = $('#review-dialog');
    const list = $('#review-list');
    // Set when adding a source to a saved report in a tab that no longer holds
    // the Instagram archive: there are no photographs to offer, and the row
    // should say why rather than looking like an export that never had any.
    const photosUnavailable = Boolean(options && options.photosUnavailable);
    // Set by the caller, not derived here — each of the three callers already
    // knows whether the step right after this one is a charge (its own call
    // to mustPayForAnalysis(), or the premium unlock this review sits inside
    // of) before it ever opens this dialog. Send this button is only ever
    // "send it to the model", never "and also pay for it" — a reader should
    // not discover a charge was coming after they already agreed to send.
    const paymentDue = Boolean(options && options.paymentDue);

    const dmCount = digest.directMessages ? digest.directMessages.ownMessageSample.length : 0;
    const dmTotal = digest.directMessages ? digest.directMessages.totalMessages : 0;
    const captionsCount = digest.samples.captions.length;
    const commentsCount = digest.samples.comments.length;
    const engagedCount = digest.mostLikedAccounts.length + digest.mostSavedAccounts.length +
      digest.mostEngagedWith.length;
    const followingCount = digest.following.length;
    const topicsCount = digest.instagramTopics.length + digest.instagramAdInterests.length;
    const searchesCount = digest.samples.searches.length;

    // One row per checkbox — id, how many there are to send, the on/off
    // label, and the detail line. The single source both the checklist below
    // and the downloadable summary read their copy from, so the two
    // descriptions of the same seven things cannot quietly drift apart.
    // decisionKey lines up with currentDecision()'s shape by position.
    const rows = [
      ['review-captions', 'includeCaptions', captionsCount + commentsCount,
        'Your captions & comments', 'Your captions & comments — none found',
        captionsCount + ' captions, ' + commentsCount +
        ' comments — a sample of your own words. Needed for any read at all.'],
      ['review-activity', 'includeActivity', 1,
        'Activity & timing', 'Activity & timing',
        'Post counts, likes, saves and when you tend to be active. Numbers only, no text.'],
      ['review-accounts', 'includeAccounts', followingCount + engagedCount,
        'Accounts you follow and engage with', 'Accounts you follow and engage with — none found',
        followingCount + ' followed accounts, plus ' + engagedCount +
        ' names among who you like, save and comment on most.'],
      ['review-topics', 'includeTopics', topicsCount,
        'Instagram’s own inferred topics', 'Instagram’s own inferred topics — none found',
        digest.instagramTopics.length + ' topics and ' + digest.instagramAdInterests.length +
        ' ad interests Instagram has already guessed about you.'],
      ['review-searches', 'includeSearches', searchesCount,
        'Searches', 'Searches — none found',
        searchesCount + ' search terms, with how often you repeated each.'],
      ['review-dms', 'includeMessages', dmCount,
        'Direct messages', 'Direct messages — none found',
        dmCount ? dmCount + ' of your own messages sampled out of ' + dmTotal + ' total. Only ' +
          'your side of any conversation is ever included.' :
          'This export did not include any direct messages to sample.'],
      ['review-images', 'includeImages', imageCount,
        'Photos', 'Photos — none selected',
        imageCount ? imageCount + ' of your own photos, resized. Videos are never included.' :
          photosUnavailable
            ? 'Your photos stay on your device and were never saved, so they cannot be included ' +
              'when adding data to a saved report. Upload your Instagram export again to include them.'
            : 'No photos were selected from this export.'],
    ];

    // Supplementary rows are appended only when that source was actually
    // added, rather than rendered greyed out for everybody. A reader who
    // skipped the offer sees the same seven rows they always saw — which is
    // also what keeps the "exactly seven checkboxes" check honest instead of
    // making it a count of whatever happens to be there.
    const g = digest.google;
    if (g) {
      const watched = g.counts.watched;
      const ytSearches = g.topYoutubeSearches.length;
      const gSearches = g.counts.googleSearches;
      const domains = g.topDomains.length;
      const prompts = g.geminiPromptSample.length;
      rows.push(
        ['review-yt-watched', 'includeYouTube', watched,
          'YouTube watch history', 'YouTube watch history — none found',
          watched ? g.topChannels.length + ' channels you watch most, from ' + watched +
            ' videos, plus a sample of titles. Not the full history.' :
            'No watch history was found in this export.'],
        ['review-yt-searches', 'includeYouTubeSearches', ytSearches,
          'YouTube searches', 'YouTube searches — none found',
          ytSearches ? ytSearches + ' of your most repeated YouTube searches.' :
            'No YouTube searches were found in this export.'],
        ['review-google-searches', 'includeGoogleSearches', gSearches,
          'Google searches', 'Google searches — none found',
          gSearches ? g.topGoogleSearches.length + ' of your most repeated searches out of ' +
            gSearches + ', plus a sample of others.' :
            'No Google searches were found in this export.'],
        ['review-chrome', 'includeChrome', domains,
          'Chrome browsing history', 'Chrome browsing history — none found',
          domains ? domains + ' website names you visit most, out of ' + g.counts.visits +
            ' visits. Only the site name — never the page, the address or when.' :
            'No browsing history was found in this export.'],
        ['review-gemini', 'includeGeminiPrompts', prompts,
          'Gemini Apps prompts', 'Gemini Apps prompts — none found',
          prompts ? prompts + ' of the things you have asked Gemini, in your own words.' :
            'No Gemini Apps activity was found in this export.'],
      );
    }

    const fb = digest.facebook;
    if (fb) {
      const fbWriting = fb.postSample.length + fb.commentSample.length;
      const fbFriends = fb.friends.length;
      const fbMessages = fb.ownMessageSample.length;
      rows.push(
        ['review-fb-posts', 'includeFacebookPosts', fbWriting,
          'Facebook posts & comments', 'Facebook posts & comments — none found',
          fbWriting ? fb.postSample.length + ' posts and ' + fb.commentSample.length +
            ' comments — a sample of your own words on Facebook.' :
            'No Facebook posts or comments were found in this export.'],
        ['review-fb-connections', 'includeFacebookConnections', fbFriends,
          'Facebook friends & follows', 'Facebook friends & follows — none found',
          fbFriends ? fbFriends + ' names, sampled evenly across the list.' :
            'No Facebook connections were found in this export.'],
        ['review-fb-messages', 'includeFacebookMessages', fbMessages,
          'Facebook Messenger', 'Facebook Messenger — none found',
          fbMessages ? fbMessages + ' of your own messages sampled out of ' + fb.counts.messages +
            ' total. Only your side of any conversation is ever included.' :
            'No Messenger history was found in this export.'],
      );
    }

    // Every row is a real checkbox now — nothing here is "review only". Each
    // is checked and enabled by default, and each disables itself when there
    // is genuinely nothing of that kind to send rather than offering a
    // toggle with no effect. The download link is written in as the list's
    // own last child — below Photos, inside the same scroll region as the
    // seven rows above it — rather than as static markup outside the list.
    list.innerHTML = rows.map(r => reviewSwitch(r[0], r[2], r[3], r[4], r[5])).join('') +
      '<div class="review-download-row"><button class="link-btn" id="review-download" type="button">' +
      'Download what’s being sent, as an HTML file</button></div>';

    // Read fresh on every call rather than once, so a click on Download
    // after toggling a box reflects the box as it stands right now, and the
    // one place this shape is written also backs Send — see
    // applyReviewDecision above for why that matters.
    // Derived from `rows` rather than written out a second time. Each row
    // already carries its own count in r[2], which is the same guard the
    // seven hand-written keys used to apply one at a time, so this is exactly
    // equivalent for them — and it means a row that was never rendered yields
    // `false` rather than `undefined`. That distinction matters: `undefined`
    // is falsy, so it would strip correctly today, but the moment anything
    // reads a decision key positively an absent source would read as "keep".
    const currentDecision = () => Object.fromEntries(rows.map(row => {
      const box = $('#' + row[0]);
      return [row[1], Boolean(row[2] > 0 && box && box.checked)];
    }));

    return new Promise(resolve => {
      let answer = null;
      const send = () => {
        answer = currentDecision();
        dialog.close();
      };
      // Back, not Cancel: it steps one dialog upstream to the supplement offer
      // rather than throwing the upload away. Distinguished from Escape by a
      // sentinel, because `null` already means "abandoned" to handleFiles and
      // the two need different answers — one reopens a dialog, the other goes
      // to the welcome page.
      const back = () => { answer = REVIEW_BACK; dialog.close(); };
      // A clone, not the digest itself — this dialog is not done with it yet,
      // and applyReviewDecision mutates in place. Nothing here ever leaves
      // the device; it is the same object Send would build, written to a
      // file instead of a request body.
      let downloading = false;
      const download = async event => {
        // Guarded because the photo pass takes seconds and the button stays
        // live throughout: a second click would decode the same archive again
        // and hand the reader two copies of the file.
        if (downloading) return;
        const button = event.currentTarget;
        const label = button.textContent;
        const decision = currentDecision();
        const preview = applyReviewDecision(JSON.parse(JSON.stringify(digest)), decision);
        if (!decision.includeImages) {
          preview.coverage.images.included = false;
          preview.coverage.images.attached = 0;
        }

        // The photographs, but only when they are actually going to be sent —
        // a file describing what leaves the device should not contain pictures
        // that do not. Read through the same extractor the request itself
        // uses, so what the reader opens is the resized, re-encoded image that
        // will reach the model rather than the untouched original.
        let photos = [];
        if (decision.includeImages && imageCount && typeof getImages === 'function') {
          downloading = true;
          try {
            photos = await getImages((done, total) =>
              { button.textContent = 'Preparing photo ' + done + ' of ' + total + '…'; });
          } catch (error) {
            photos = [];
          }
          downloading = false;
          button.textContent = label;
        }

        const html = buildDigestPreviewHtml(rows, decision, preview, photos);
        const blob = new Blob([html], { type: 'text/html' });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'psycheai-digest-preview.html';
        link.href = href;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
      };
      $('#review-send').addEventListener('click', send);
      $('#review-cancel').addEventListener('click', back);
      $('#review-download').addEventListener('click', download);

      dialog.addEventListener('close', () => {
        $('#review-send').removeEventListener('click', send);
        $('#review-cancel').removeEventListener('click', back);
        $('#review-download').removeEventListener('click', download);
        resolve(answer);
      }, { once: true });

      $('#review-send').textContent = paymentDue ? 'Make payment' : 'Send this';

      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  async function handleFiles(files) {
    const chosen = Array.from(files || []).filter(f => /\.zip$/i.test(f.name));
    flash('#upload-error', '');
    if (!chosen.length) {
      flash('#upload-error', 'That does not look like a .zip file. Instagram sends your export as one or more .zip archives.');
      return;
    }
    if (!state.server.ready) {
      flash('#upload-error', 'The server is not ready to analyse yet — see the note above.');
      return;
    }

    $('#working-title').textContent = 'Loading';
    // No fineprint row for this phase — the "nothing sent" claim now lives in
    // the progress label itself, reported from instagram.js as each batch of
    // files is parsed. Cleared explicitly rather than left alone, so a second
    // upload in the same session cannot show a stale line runAnalysis wrote
    // for the previous one while this phase is only reading, not sending.
    $('#working-note').textContent = '';
    setProgress(0, 'Opening the archive…');
    show('working');

    let digest;
    let decision = null;
    let signals;
    let uploadAuth = null;
    let chosenImages = [];
    // Set by whichever caller decodes the photographs first — the review's
    // download button, or the send itself. See getExtractedImages.
    let extractedImages = null;
    const getExtractedImages = async (forSignals, forChosen, onProgress) => {
      if (extractedImages) return extractedImages;
      extractedImages = await Images.extract(forSignals, forChosen, onProgress || function () {});
      return extractedImages;
    };
    try {
      // Read everything the export has, unconditionally. The choice of what
      // to send used to gate this step, before the reader had seen any of
      // it; it now gates nothing here, because the choice moved to the
      // review dialog below, where it can be made against real content
      // rather than in advance of it.
      signals = await IG.readExports(chosen, {
        includeMessages: true,
        includeImages: true,
        onProgress: p => setProgress(Math.round((p.total ? p.done / p.total : 0) * 70), p.label),
      });

      // The supplement offer and the review are one loop, because Back on the
      // review steps upstream to the offer rather than abandoning the upload.
      // The digest is rebuilt on each pass rather than reused: going back is
      // how a reader adds a source they had skipped, so the thing they are
      // then reviewing has to include it.
      for (;;) {
        // Skipping resolves an empty object; Back resolves null and abandons
        // the run. Seeded with whatever a previous pass added, so returning
        // here does not throw away an archive already read.
        const supplements = await askSupplement(signals.supplements);
        if (!supplements) {
          show('welcome');
          return;
        }
        signals.supplements = supplements;

        // Only the selection, not the extraction: picking which stills to use
        // is cheap, and the reader has not yet said photos may be sent at all.
        // The slow part — decoding and downscaling — waits for that answer,
        // below, so declining costs nothing beyond this pick.
        chosenImages = Images.select(signals, { count: Digest.IMAGES });

        setProgress(80, 'Building your evidence summary…');
        await new Promise(resolve => setTimeout(resolve, 30));
        digest = Digest.build(signals, {
          includeMessages: true, includeImages: true,
          imageCount: chosenImages.length,
        });

        // Decode once at most, whoever asks first. The review's download
        // button may want the photographs before Send does; if it took them,
        // the extraction below reuses that result rather than putting the
        // reader through the slowest step in the app a second time. Reset on
        // each pass of the loop, because going Back can change the selection.
        extractedImages = null;
        decision = await askReview(digest, chosenImages.length, onProgress =>
          getExtractedImages(signals, chosenImages, onProgress),
          { paymentDue: mustPayForAnalysis() });
        if (decision !== REVIEW_BACK) break;
      }
    } catch (error) {
      showUploadError((error && error.message) || 'Could not read that archive.');
      return;
    }

    if (!decision) {
      show('welcome');
      return;
    }

    // Money last, and only once the reader has seen what they are buying.
    //
    // Two things had to be true before this line could be reached at all, and
    // both are reasons it is not one line earlier: the archive has parsed, so
    // nobody is charged for a file that turns out to be unusable; and the
    // review has been agreed, so nobody is charged before seeing exactly what
    // will be sent. It also sits ahead of the photo decode below — the
    // slowest thing this app does — so declining costs no wasted work.
    //
    // Nothing is persisted above this point, so declining leaves the browser
    // exactly as it was.
    uploadAuth = await authoriseAnalysis();
    if (uploadAuth === false) {
      showUploadError(TEXT.analysisDeclined);
      return;
    }

    applyReviewDecision(digest, decision);

    let images = [];
    if (decision.includeImages && chosenImages.length) {
      try {
        // Decoding and re-encoding is the slowest client-side step by a wide
        // margin, so it gets its own slice of the bar rather than appearing
        // as a stall at the end. Only reached once the reader has agreed to
        // send photos at all, so declining them upstream skips this outright
        // rather than doing the work and then discarding it.
        images = await getExtractedImages(signals, chosenImages, (done, total) => {
          setProgress(80 + Math.round((done / Math.max(1, total)) * 15),
            'Preparing image ' + done + ' of ' + total + '…');
        });
        // extract() can return fewer than it was given — a candidate that
        // fails to decode is skipped, not substituted. digest.coverage.images
        // was written from the pre-extraction count because the review had
        // to show a number before extraction had run; correct it now to the
        // count that is actually about to be sent, or the digest overstates
        // its own attachment to the model.
        digest.coverage.images.attached = images.length;
      } catch (error) {
        showUploadError((error && error.message) || 'Could not prepare your photos.');
        return;
      }
    } else {
      digest.coverage.images.included = false;
      digest.coverage.images.attached = 0;
    }

    state.digest = digest;
    // A Google or Facebook read stashed by an earlier report's own rerun
    // popout belongs to that report, not this fresh upload — see
    // pendingDataSourceReads' own declaration.
    pendingDataSourceReads = {};
    // The images are deliberately not persisted: a dozen JPEGs would blow the
    // localStorage quota, and keeping the user's photographs on disk is not
    // something to do as a side effect. A retry after a reload runs on the
    // digest alone.
    state.images = images;
    // Kept for the same reason and on the same terms — see state.signals —
    // so "Re-run analysis with additional data" on the report page can add a
    // Google or Facebook export to this one later in the session without
    // asking for the Instagram export again.
    state.signals = signals;
    writeDigest(digest);
    await runAnalysis(digest, images, uploadAuth);
  }

  // The per-row "Load data" button in the confidence card's sources
  // subsection — see sourcesUsedHtml(). Free and immediate: it only reads and
  // merges the archive, the same as the offer a first upload shows, and never
  // touches authoriseAnalysis(). Loading a source and paying to have it
  // analysed are now two separate actions; this is the first of them.
  //
  // Not scoped to the source whose button was actually pressed — the dialog
  // this opens has always offered both Google and Facebook together (see
  // askSupplement), and a reader who came here for one may as well add the
  // other while the picker is up rather than opening this twice.
  // A Google or Facebook export read inside askDataSources() but never
  // carried through to a completed rerun — Back was pressed, or the popout
  // was otherwise closed before Continue. Reading an archive is real work a
  // reader already did; losing the tick the moment they step back from
  // *continuing* the rerun would make Back read as "throw away what I just
  // read" rather than its actual meaning, "not right now". Keyed by source,
  // holding the same fragment `read()` produced so a later Continue can still
  // send it. Cleared only when a genuinely new report replaces this one
  // (handleFiles) or once a rerun actually commits the fragment into
  // state.digest (rerunWithAdditionalData) — at that point state.digest
  // already carries it permanently, so holding onto a second copy here would
  // only be dead weight.
  let pendingDataSourceReads = {};

  /**
   * Driven by the "Add / change data & re-run analysis" button — see
   * sourcesUsedHtml() and startRerun below. Shows Instagram, Google Takeout
   * and Facebook together; unlike askSupplement, a row already ticked stays
   * clickable, so any of the three — Instagram included — can be replaced
   * with a fresh export rather than only ever being added once.
   *
   * Resolves `null` on Back (nothing sent onward). Otherwise resolves an
   * object keyed by source: `true` for a row that was already loaded and left
   * alone, or the freshly read result (Instagram's full `signals`, or a
   * Google/Facebook supplement fragment) for one that was just picked. The
   * caller tells the two apart with `typeof value === 'object'`. A Google or
   * Facebook row read successfully in an earlier call to this same function —
   * even one that ended in Back — still resolves as that same fragment here,
   * via pendingDataSourceReads; Instagram carries no such memory, since
   * re-reading it is cheap and every call already reflects state.digest.
   *
   * Nothing here touches state.digest, localStorage, or authoriseAnalysis —
   * reading an export is free, and Continue only hands the results back to
   * addDataAndRerun, which builds the digest the review dialog shows next.
   */
  function askDataSources() {
    const dialog = $('#datasources-dialog');
    const status = $('#datasources-status');
    const input = $('#datasources-input');
    const buttons = dialog.querySelectorAll('.mode-option');
    const digest = state.digest;
    const added = {
      // Seeded from the digest, not assumed. Instagram is always already
      // loaded *when there is a digest* — it is the one source a report
      // cannot exist without — but the digest can go missing on its own while
      // the report survives, and a tick here would then promise the popout
      // was holding an archive it does not have. Left unticked, the row reads
      // as the one thing still to do, which is exactly what it is.
      instagram: Boolean(digest) || undefined,
      google: Boolean(digest && digest.google) || pendingDataSourceReads.google || undefined,
      facebook: Boolean(digest && digest.facebook) || pendingDataSourceReads.facebook || undefined,
    };
    let pending = '';
    let busy = false;
    let cancelled = false;
    let replacedInstagram = false;

    const say = (message, tone) => {
      status.textContent = message || '';
      status.hidden = !message;
      status.className = 'supplement-status' + (tone ? ' is-' + tone : '');
    };

    const setBusy = state => {
      busy = state;
      for (const button of buttons) button.disabled = state;
    };

    const rowOf = source => dialog.querySelector('.mode-option[data-datasource="' + source + '"]');
    const setSourceProgress = (source, percent, label) => {
      const row = rowOf(source);
      if (!row) return;
      const wrap = row.querySelector('.mode-progress');
      const bar = row.querySelector('.progress-bar');
      const text = row.querySelector('.mode-progress-label');
      row.classList.toggle('is-loading', percent !== null);
      wrap.hidden = percent === null;
      bar.style.width = (percent === null ? 0 : percent) + '%';
      if (label !== undefined) text.textContent = label || '';
    };

    // Ticked whenever a row has anything at all — the seeded `true` for an
    // already-loaded source, or a freshly read result. Never disabled once
    // ticked: that is the whole difference from askSupplement's markAdded.
    const markAdded = () => {
      for (const button of buttons) {
        const isAdded = Boolean(added[button.dataset.datasource]);
        button.classList.toggle('is-added', isAdded);
        const tick = button.querySelector('.mode-added');
        if (isAdded && !tick) {
          const mark = document.createElement('span');
          mark.className = 'mode-added';
          mark.setAttribute('role', 'img');
          mark.setAttribute('aria-label', 'Loaded');
          mark.textContent = '✓';
          button.appendChild(mark);
        } else if (!isAdded && tick) {
          tick.remove();
        }
      }
      // The warning only means something when a row is ticked *without* a
      // real fragment behind it — `added[source] === true`, the seeded
      // "already in state.digest" mark, rather than an object. An object
      // there — whether just read, or carried forward from an earlier
      // attempt via pendingDataSourceReads — is exactly the "reload it here"
      // the note asks for, already done, so warning about it would be noise.
      // Recomputed on every call rather than fixed the moment Instagram is
      // replaced, so reading Google or Facebook afterwards can still resolve
      // the very risk this note exists to name.
      $('#datasources-instagram-note').hidden = !(replacedInstagram &&
        (added.google === true || added.facebook === true));
    };

    return new Promise(resolve => {
      const choose = event => {
        const source = event.currentTarget.dataset.datasource;
        if (busy) return;
        pending = source;
        input.value = '';
        input.click();
      };

      const read = async () => {
        const files = Array.from(input.files || []).filter(f => /\.zip$/i.test(f.name));
        input.value = '';
        if (!pending || !files.length) return;
        const source = pending;
        pending = '';
        setBusy(true);
        say('');
        setSourceProgress(source, 0, 'Opening the archive…');
        try {
          if (source === 'instagram') {
            added.instagram = await IG.readExports(files, {
              includeMessages: true, includeImages: true,
              onProgress: p => setSourceProgress(source,
                Math.round((p.total ? p.done / p.total : 0) * 100), p.label),
            });
            replacedInstagram = true;
          } else {
            const reader = source === 'google' ? Supplement.readGoogle : Supplement.readFacebook;
            added[source] = await reader(files, {
              onProgress: p => {
                const share = p.total ? Math.min(1, p.done / p.total) : 0;
                const percent = p.phase === 'open' ? 6
                  : p.phase === 'done' ? 100
                  : 10 + Math.round(share * 85);
                setSourceProgress(source, percent, p.label);
              },
            });
            // Kept even if this call ends in Back — see
            // pendingDataSourceReads' own declaration.
            pendingDataSourceReads[source] = added[source];
          }
          setBusy(false);
          setSourceProgress(source, null, '');
          say('');
          markAdded();
        } catch (error) {
          setBusy(false);
          setSourceProgress(source, null, '');
          // A failed replacement must not cost the reader the source they
          // already had — the dialog stays open, on the tick it started
          // with, and they can try another file or move on.
          say((error && error.message) || 'That archive could not be read.', 'bad');
          markAdded();
        }
      };

      const done = () => dialog.close();
      const goBack = () => { cancelled = true; dialog.close(); };
      // Escape has no button of its own to route through goBack, but it must
      // still mean the same thing Back does — "not right now", never a silent
      // Continue. Without this, a <dialog>'s native Escape fires no listener
      // here at all, cancelled stays false, and the close handler below would
      // resolve `added` exactly as if Continue had been pressed.
      //
      // Scoped to the dialog's *own* cancel. `<input type="file">` fires its
      // own `cancel` event — bubbling — when the reader dismisses the OS file
      // picker without choosing anything, and #datasources-input sits inside
      // this dialog. Unscoped, that bubbled event set `cancelled = true` from
      // a gesture that means nothing more than "not that file after all", and
      // the reader's next press of Continue then resolved null and abandoned
      // the whole re-run with no message and no dialog — exactly as if they
      // had pressed Back.
      const onNativeCancel = event => { if (event.target === dialog) cancelled = true; };

      for (const button of buttons) button.addEventListener('click', choose);
      input.addEventListener('change', read);
      $('#datasources-continue').addEventListener('click', done);
      $('#datasources-back').addEventListener('click', goBack);
      dialog.addEventListener('cancel', onNativeCancel);

      dialog.addEventListener('close', () => {
        for (const button of buttons) {
          button.removeEventListener('click', choose);
          button.disabled = false;
          button.classList.remove('is-added');
          const tick = button.querySelector('.mode-added');
          if (tick) tick.remove();
        }
        input.removeEventListener('change', read);
        $('#datasources-continue').removeEventListener('click', done);
        $('#datasources-back').removeEventListener('click', goBack);
        dialog.removeEventListener('cancel', onNativeCancel);
        resolve(cancelled ? null : added);
      }, { once: true });

      say('');
      cancelled = false;
      replacedInstagram = false;
      $('#datasources-instagram-note').hidden = true;
      dialog.querySelector('.supplement-help').open = false;
      for (const button of buttons) setSourceProgress(button.dataset.datasource, null, '');
      setBusy(false);
      markAdded();

      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  // The bottom of the confidence card's sources subsection — see
  // sourcesUsedHtml(). Opens the data-sources popout first, then goes to the
  // review of whatever comes out of it, then payment, then analysis.
  function startRerun() {
    flash('#profile-alert', '');
    addDataAndRerun();
  }

  async function addDataAndRerun() {
    // The popout and the review are one loop, for the same reason the first
    // upload's supplement offer and review are (see handleFiles): Back on the
    // review means "let me change what I am sending", and the only screen
    // that can answer that is the one behind it. Returning to the report
    // instead — which is what this did — threw away a source the reader had
    // just spent a minute loading, and read as the button having failed.
    for (;;) {
      let collected;
      try {
        collected = await askDataSources();
      } catch (error) {
        flash('#profile-alert', (error && error.message) || 'Could not read that export.');
        return;
      }
      if (!collected) return; // Back at the popout — nothing touched.

      // A freshly read Instagram export replaces the in-memory signals
      // outright — typeof 'object' is how askDataSources marks a real
      // replacement rather than the seeded `true` for "already had it,
      // unchanged". Google or Facebook data still held in this same session
      // (state.signals.supplements) rides along with it automatically; data
      // loaded only in an earlier session does not, because Digest.build needs
      // the raw fragment Supplement.js produced and a stored digest no longer
      // carries one — only the sampled, capped view that came out of it. The
      // popout's own copy says so before this ever runs.
      //
      // Read before the reassignment below, not after: state.signals is about
      // to be replaced wholesale by the fresh Instagram read, and a fresh
      // export never carries a .supplements property of its own. Reading
      // afterwards would find it always undefined, silently dropping any
      // Google/Facebook data from this same session the moment Instagram is
      // replaced — exactly the bug this ordering exists to avoid.
      //
      // Re-applied on every pass of the loop rather than once: a reader who
      // goes Back and returns keeps whatever they had loaded (pendingDataSourceReads
      // re-seeds the popout's ticks, and a replaced Instagram is already in
      // state.signals), so a second pass is idempotent rather than additive.
      const priorSupplements = state.signals && state.signals.supplements;
      if (typeof collected.instagram === 'object') state.signals = collected.instagram;

      if (state.signals) {
        state.signals.supplements = Object.assign({}, priorSupplements,
          typeof collected.google === 'object' ? { google: collected.google } : null,
          typeof collected.facebook === 'object' ? { facebook: collected.facebook } : null);
      }

      const outcome = await rerunWithAdditionalData({
        google: typeof collected.google === 'object' ? collected.google : undefined,
        facebook: typeof collected.facebook === 'object' ? collected.facebook : undefined,
      });
      // Anything other than Back is terminal: the run happened, the payment
      // was declined, the reader pressed Escape, or something failed and has
      // already written its own message to #profile-alert.
      if (outcome !== REVIEW_BACK) return;
    }
  }

  async function rerunWithAdditionalData(extraSupplements) {
    // Once premium is unlocked, "Add / change data & re-run" stops being the
    // S$0.99 free-only re-run: the four paid sections are sitting on evidence
    // this new data is about to make stale, so the S$1.99 unlock price now
    // buys a regeneration of everything together — see the branch below.
    const alreadyUnlocked = Object.keys(paidAnalysis()).length > 0;

    // Present only in the same session as the upload — either the original
    // one, or a fresh Instagram export just read by askDataSources above.
    // With it, the digest is rebuilt from the archive and can carry
    // photographs; without it, the stored digest is reviewed as a copy,
    // merged with whatever Google or Facebook data this call was handed.
    const signals = state.signals;
    let digest;
    let chosenImages = [];
    let extractedImages = null;
    const getExtractedImages = async (forSignals, forChosen, onProgress) => {
      if (extractedImages) return extractedImages;
      extractedImages = await Images.extract(forSignals, forChosen, onProgress || function () {});
      return extractedImages;
    };

    if (signals && !alreadyUnlocked) {
      chosenImages = Images.select(signals, { count: Digest.IMAGES });
      digest = Digest.build(signals, {
        includeMessages: true, includeImages: true, imageCount: chosenImages.length,
      });
    } else if (signals) {
      // alreadyUnlocked: this rerun is about to bundle into the paid call
      // below (see the branch after the review), and no premium-adjacent
      // call anywhere in this app ever carries photographs — see
      // collectExtraDataForPremium. Built without images from the start
      // rather than offered in the review and silently dropped after.
      digest = Digest.build(signals, { includeMessages: true, includeImages: false, imageCount: 0 });
    } else if (state.digest) {
      digest = JSON.parse(JSON.stringify(state.digest));
      if (extraSupplements) digest = Digest.addSupplements(digest, extraSupplements);
      digest.coverage.images.included = false;
      digest.coverage.images.attached = 0;
    } else {
      // No archive in memory and no stored digest to merge into — there is
      // nothing to send. Reached when the digest went missing on its own
      // while the report survived (see sourcesUsedHtml's Instagram row), and
      // the reader pressed Continue without loading Instagram again.
      //
      // This used to fall into the branch above and dereference
      // `null.coverage`, which threw where nothing catches: the popout shut,
      // no review opened, no message appeared, and the button read as simply
      // broken. Saying what is needed is the whole fix — askDataSources
      // already treats Instagram as replaceable, so the reader's next attempt
      // has somewhere to go.
      flash('#profile-alert', TEXT.rerunNeedsInstagram);
      return;
    }

    let decision;
    try {
      decision = await askReview(digest, chosenImages.length, onProgress =>
        getExtractedImages(signals, chosenImages, onProgress),
        { photosUnavailable: !signals || alreadyUnlocked, paymentDue: alreadyUnlocked || mustPayForAnalysis() });
    } catch (error) {
      // Stays on the report rather than calling showUploadError(): a failed
      // attempt to re-run must never read as having lost the report.
      flash('#profile-alert', (error && error.message) || 'Could not rebuild your evidence summary.');
      return;
    }

    // Back and Escape mean different things, and did not used to. Back steps
    // one dialog upstream — addDataAndRerun's loop reopens "Add or change
    // your data" on this return value, keeping everything already loaded —
    // while Escape still abandons the whole attempt and leaves the report on
    // screen untouched. Collapsing the two sent a reader who only wanted to
    // add another source back to the report with their work discarded.
    if (decision === REVIEW_BACK) return REVIEW_BACK;
    if (!decision) return;

    if (alreadyUnlocked) {
      // One S$1.99 charge regenerates everything together — the free report
      // and all four premium sections — against this reviewed digest.
      // Reuses runPremiumAnalysis's own bundled-refresh mechanism (built for
      // adding data on the way to a first unlock) via pendingPremiumDigest,
      // rather than a second copy of it. runAnalysis is deliberately never
      // called on this branch: it replaces state.profile wholesale, which is
      // what would wipe the premiumAnalysis this same charge is about to
      // write — see the comment that used to sit where this branch is now.
      applyReviewDecision(digest, decision);
      pendingDataSourceReads = {};
      await openPremiumDialog($('#rerun-with-data'), 'rerunAll', digest);
      return;
    }

    // Money last, in the same place the first upload asks: after the review,
    // before the photo decode. Declining costs nothing — the report and
    // digest the reader arrived with are untouched.
    const auth = await authoriseAnalysis();
    if (auth === false) { flash('#profile-alert', TEXT.analysisDeclined); return; }

    applyReviewDecision(digest, decision);

    let images = [];
    if (decision.includeImages && chosenImages.length) {
      try {
        images = await getExtractedImages(signals, chosenImages, (done, total) => {
          setProgress(80 + Math.round((done / Math.max(1, total)) * 15),
            'Preparing image ' + done + ' of ' + total + '…');
        });
        digest.coverage.images.attached = images.length;
      } catch (error) {
        flash('#profile-alert', (error && error.message) || 'Could not prepare your photos.');
        return;
      }
    } else {
      digest.coverage.images.included = false;
      digest.coverage.images.attached = 0;
    }

    state.digest = digest;
    state.images = images;
    writeDigest(digest);
    // Whatever was pending is now either committed into digest above or
    // superseded by it — see pendingDataSourceReads' own declaration.
    pendingDataSourceReads = {};
    // Only reachable here when premium has nothing unlocked yet — see
    // alreadyUnlocked above — so runAnalysis's wholesale replacement of
    // state.profile has no premiumAnalysis to lose. The one case still worth
    // naming: a receipt paid for but never fetched (hasUnfetchedUnlock()).
    // That receipt in psycheai_unlock is untouched by this call, so the paid
    // cards still offer "Get the sections you paid for" afterwards, now
    // against this rerun's digest, rather than losing the payment.
    await runAnalysis(digest, images, auth);
  }

  // The waiting screen speaks as the product, not as whichever model the
  // server happens to be configured with. The provenance line at the foot of
  // the finished report still names the actual model that wrote it.
  function modelName() {
    return 'PsycheAI';
  }

  async function runAnalysis(digest, images, auth) {
    const sent = (images || []).length;
    $('#working-title').textContent = modelName() + ' is reading your profile';
    $('#working-note').textContent =
      'A ' + Math.round((digest.coverage.digestChars || 0) / 1000) + 'KB summary' +
      (sent ? ' and ' + sent + ' of your photos were' : ' was') + ' sent for analysis. ' +
      'It usually takes up to three minutes for the personality analysis to be completed. ' +
      'Please be patient.';
    startElapsed('Analysing');
    show('working');

    // This call runs for minutes, and a reader reaching for the back button —
    // on a phone, the most natural gesture for "get me off this screen" —
    // would otherwise navigate away with nothing pushed here to stop it,
    // aborting the fetch and losing the analysis with no warning at all. The
    // same guard runPremiumAnalysis already carries for the same reason.
    guardUnload(true);
    try {
      const result = await LLM.analyseProfile(digest, images, auth || undefined);
      const payload = await Card.encodeCard(result.data.card);
      state.profile = {
        report: result.data,
        card: Card.shape(result.data.card),
        payload,
        model: result.model,
        createdAt: new Date().toISOString(),
      };
      // Counted only once the report is really in hand, so a provider outage
      // never spends somebody's free run. Kept outside KEYS on purpose — see
      // RUNS_KEY — so "Delete everything" cannot roll it back to zero.
      recordRun();
      if (!store.write(KEYS.profile, state.profile)) {
        flash('#upload-error', 'Your profile was generated but is too large for this browser\'s storage, so it will not survive a reload.');
      }

      const pending = sessionStorage.getItem('psycheai_pending');
      if (pending) {
        sessionStorage.removeItem('psycheai_pending');
        if (await runMatch(pending)) return;
      }
      renderProfile();
      show('profile');
    } catch (error) {
      showUploadError((error && error.message) || 'The analysis failed.');
    } finally {
      stopElapsed();
      guardUnload(false);
    }
  }

  // ══════════════ 2. profile report ══════════════



  function profileUrl(payload) {
    return location.origin + location.pathname + '#p=' + payload;
  }

  // Version 23 is a landmine. jsQR's own version table has the wrong alignment
  // centre for it (see the note in vendor/jsqr.js), so a version 23 code is
  // unreadable by every scanner carrying that upstream bug — which, until this
  // repo patched its copy, included us. Our decoder is fixed, but codes get
  // scanned by whatever app the other person happens to have, so it is worth
  // four extra modules to step over the version entirely.
  function qrOptions(url, width, margin) {
    const options = {
      width, margin, errorCorrectionLevel: 'L',
      color: { dark: '#000000', light: '#ffffff' },
    };
    try {
      if (window.QRCode.create(url, { errorCorrectionLevel: 'L' }).version === 23) options.version = 24;
    } catch (error) { /* fall back to whatever the encoder picks */ }
    return options;
  }

  // Both the profile page and the scan page show this person's own QR code, so
  // painting it is one function rather than two copies of the same try/catch.
  // The card is ~680 characters, so this lands around 89 modules across.
  // Backing the canvas at 3x its display size keeps module edges crisp on a
  // high-DPI phone, which is the difference between a camera resolving them
  // and seeing grey mush. A wider quiet zone helps the locator too.
  function paintQrCanvas(selector) {
    const profile = state.profile;
    const canvas = $(selector);
    if (!profile || !canvas) return;
    try {
      const url = profileUrl(profile.payload);
      window.QRCode.toCanvas(canvas, url, qrOptions(url, 900, 3));
      // qrcode.js writes its width as an inline style; drop it so the
      // stylesheet decides the display size, print rules included.
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    } catch (error) { /* canvas unavailable — the link still works */ }
  }

  /**
   * The report's sections as HTML, from the report alone.
   *
   * Split out of renderProfile so the sample can render the same sections
   * into a dialog. Everything the sample must not offer — the download
   * buttons, delete, the QR panel — lives outside #profile-body in
   * index.html, so building only this excludes them by construction rather
   * than by a list of things to hide that someone has to remember to update.
   *
   * The four paid sections render in the sample too, as covers — `{ sample:
   * true }` forces every one of them locked regardless of what the reader's
   * own profile has actually unlocked, and swaps the button for an inert,
   * disabled "Unlock" (see `paidCard`). A sample that read the reader's real
   * unlock state would show their own paid roast inside a stranger's fake
   * report the moment they had ever unlocked one.
   */
  // The "Sources used" subsection of the confidence card: one row per
  // possible source, a tick if this report's digest already carries it, a
  // red cross if not. Reads state.digest directly rather than taking it as a
  // parameter — reportSectionsHtml only ever calls this for the real report,
  // and the digest is the one true record of what has actually been loaded,
  // on a reload as much as in the session that uploaded it. Adding or
  // replacing a source is not done from here any more — see
  // askDataSources() — so a row is purely a status line, no button.
  function sourcesUsedHtml() {
    const digest = state.digest;
    const rows = [
      // Not hardcoded true, which it was. Instagram is required to produce a
      // report at all, so a report on screen used to be taken as proof its
      // export was still loaded — but the digest is a separate localStorage
      // entry from the profile and can go missing on its own (a browser too
      // full to take it, eviction, a hand-edited store). The row then said
      // "loaded" about evidence this device no longer holds, and the re-run
      // behind it had nothing to rebuild from. It reads the digest like the
      // other two now, so missing means missing whichever source it is.
      { icon: '📷', label: TEXT.sourceInstagram, loaded: Boolean(digest) },
      { icon: '🔍', label: TEXT.sourceGoogle, loaded: Boolean(digest && digest.google) },
      { icon: '📘', label: TEXT.sourceFacebook, loaded: Boolean(digest && digest.facebook) },
    ];
    // A status line each, not an action: adding or replacing a source now
    // happens entirely behind the button below, in askDataSources(), so a
    // row here only ever says what is true of the report, never invites a
    // click of its own.
    const rowsHtml = rows.map(row =>
      '<li class="source-row"><span class="source-name">' + esc(row.icon) + ' ' + esc(row.label) + '</span>' +
      (row.loaded
        ? '<span class="source-tick" role="img" aria-label="' + esc(TEXT.sourceLoaded) + '">✓</span>'
        : '<span class="source-cross" role="img" aria-label="' + esc(TEXT.sourceMissing) + '">✕</span>') +
      '</li>').join('');
    const anyMissing = rows.some(row => !row.loaded);

    return '<div class="trust-sources">' +
      '<h3>' + esc(TEXT.sourcesUsed) + '</h3>' +
      // A missing Instagram export is a different message from a missing
      // supplement: the ordinary hint invites a reader to *raise* their
      // confidence by adding Google or Facebook, which is beside the point
      // when the evidence the report was written from is the thing that has
      // gone. This one says what happened and what re-running will ask for.
      (!digest ? '<p class="muted">' + esc(TEXT.sourcesInstagramLost) + '</p>'
        : anyMissing ? '<p class="muted">' + esc(TEXT.sourcesUsedHint) + '</p>' : '') +
      '<ul class="source-list">' + rowsHtml + '</ul>' +
      '<div class="btn-row">' +
      '<button class="btn" id="rerun-with-data" type="button">' + esc(TEXT.rerunAnalysis) + '</button>' +
      '</div>' +
      // Unconditional once premium is unlocked — that S$1.99 is not tied to
      // the free-run allowance mustPayForAnalysis() tracks, so the note has
      // to say so even for a reader with free runs left. See
      // rerunWithAdditionalData's own alreadyUnlocked branch.
      (Object.keys(paidAnalysis()).length
        ? '<p class="fineprint" id="rerun-price-note">' + esc(TEXT.analysisPriceNoteUnlocked) + '</p>'
        : mustPayForAnalysis()
          ? '<p class="fineprint" id="rerun-price-note">' + esc(TEXT.analysisPriceNote) + '</p>' : '') +
      '</div>';
  }

  function reportSectionsHtml(report, options) {
    const sample = Boolean(options && options.sample);
    // Every section of the report body is a disclosure; sectionHead's other
    // caller — the scan page's QR-contents block — is not, so the default
    // stays off there and this local alias turns it on for the report only.
    // The confidence card at the bottom deliberately calls sectionHead
    // directly instead, and stays open: see its own comment.
    const head = (icon, title, sub) => sectionHead(icon, title, sub, true);

    let html = '';

    // No glance row here any more: the psyche card above the report already
    // shows the type, the enneagram and the highest and lowest traits, and
    // saying them again three centimetres lower is just the same four facts
    // twice. The PDF keeps its own — it has no card in front of it.
    html += '<div class="card section-card">' + head('👤', esc(TEXT.whoYouAre)) +
      essenceBlock(report.essence) + paragraphs(report.summary) + '</div>';

    // Big Five.
    html += '<div class="card section-card">' +
      head('📊', esc(TEXT.bigFive), esc(TEXT.bigFiveSub));
    for (const trait of Object.keys(TRAIT_LABELS)) {
      const item = report.bigFive[trait];
      if (!item) continue;
      const evidence = (item.evidence || []).map(e => '<span class="ev">' + esc(e) + '</span>').join('');
      html += bar(TRAIT_LABELS[trait] + ' · ' + item.band, item.score,
        '<p class="trait-reading">' + esc(item.reading) + '</p>' +
        (evidence ? '<p class="trait-evidence">' + evidence + '</p>' : ''));
    }
    html += '</div>';

    // MBTI.
    const mbti = report.mbti;
    html += '<div class="card section-card">' +
      head('🧭', esc(TEXT.mbtiPrefix) + esc(mbti.type) +
        (mbti.nickname ? ' <span class="type-nickname">' + esc(mbti.nickname) + '</span>' : ''),
        esc(TEXT.mbtiConfidence) + esc(mbti.confidence));

    html += '<div class="axes">' + (mbti.letters || []).map(letter => {
      const pole = axisLabel(letter.choice, letter.axis);
      return '<div class="axis"><span class="axis-letter">' + esc(letter.choice) + '</span>' +
        '<div><span class="axis-name">' + esc(pole.name) + '</span>' +
        (pole.against ? '<span class="axis-against">' + esc(TEXT.mbtiOver) + esc(pole.against) + '</span>' : '') +
        '<span class="pill pill-' + esc(letter.strength || 'moderate') + '">' + esc(letter.strength || '') + '</span>' +
        '<p>' + esc(letter.why) + '</p>' +
        (letter.inPractice ? '<p class="muted">' + esc(letter.inPractice) + '</p>' : '') +
        '</div></div>';
    }).join('') + '</div>';

    html += '<p class="fineprint">' + esc(mbti.caveat) + '</p></div>';

    // Enneagram: a short second lens right beside MBTI, not a wall of its own
    // — one type, one wing, one paragraph, no per-facet breakdown.
    const enneagram = report.enneagram;
    if (enneagram) {
      const badge = esc(enneagram.type) + (enneagram.wing ? 'w' + esc(enneagram.wing) : '');
      html += '<div class="card section-card">' +
        head('🔢', esc(TEXT.enneagramPrefix) + badge +
          (enneagram.nickname ? ' <span class="type-nickname">' + esc(enneagram.nickname) + '</span>' : ''),
          esc(TEXT.mbtiConfidence) + esc(enneagram.confidence)) +
        '<p>' + esc(enneagram.why) + '</p>' +
        '<p class="fineprint">' + esc(enneagram.caveat) + '</p></div>';
    }

    // Interests.
    html += '<div class="card section-card">' + head('✨', esc(TEXT.interests));
    if ((report.interests || []).length) {
      html += '<div class="tile-grid">' + report.interests.map(item =>
        '<div class="tile tile-' + esc(item.intensity) + '">' +
        '<h4>' + esc(item.name) + '<span class="pill pill-' + esc(item.intensity) + '">' + esc(item.intensity) + '</span></h4>' +
        '<p>' + esc(item.detail) + '</p>' +
        '<p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>';
    } else {
      html += '<p class="muted">' + esc(TEXT.interestsEmpty) + '</p>';
    }
    html += '</div>';

    // Values and beliefs, together — they answer the same question from two
    // directions, and splitting them left two thin cards.
    html += '<div class="card section-card">' +
      head('🧿', esc(TEXT.valuesBeliefs), esc(TEXT.valuesBeliefsSub)) +
      '<h3>' + esc(TEXT.values) + '</h3>';
    html += (report.values || []).length
      ? '<div class="tile-grid">' + report.values.map(item =>
        '<div class="tile"><h4>' + esc(item.value) + '</h4><p>' + esc(item.detail) + '</p>' +
        '<p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>'
      : '<p class="muted">' + esc(TEXT.valuesEmpty) + '</p>';

    html += '<h3>' + esc(TEXT.beliefs) + '</h3>';
    html += (report.beliefs || []).length
      ? '<div class="tile-grid">' + report.beliefs.map(item =>
        '<div class="tile"><h4>' + esc(item.belief) +
        '<span class="pill">' + esc(item.confidence) + esc(TEXT.confidenceSuffix) + '</span></h4>' +
        '<p>' + esc(item.detail) + '</p><p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>'
      : '<p class="muted">' + esc(TEXT.beliefsEmpty) + '</p>';
    html += '</div>';

    // Relationships. The attachment read used to sit here as a callout and is
    // its own section further down now, below the wellness read.
    const relationship = report.relationship;
    html += '<div class="card section-card">' + head('💞', esc(TEXT.relationships)) +
      '<div class="split"><div><h3 class="h-good">' + esc(TEXT.strengths) + '</h3>' + points(relationship.strengths) + '</div>' +
      '<div><h3 class="h-warn">' + esc(TEXT.weaknesses) + '</h3>' + points(relationship.weaknesses) + '</div></div>' +
      loveLanguageBlock(relationship.loveLanguages) + '</div>';

    // Career, describing rather than advising — the coach's read is its own
    // section below. "Where you would thrive" was cut from here: it was a list
    // of ideal environments inferred from an export that contains no job
    // history, and it read as advice in a section that is meant to describe.
    const career = report.career;
    html += '<div class="card section-card">' + head('💼', esc(TEXT.work)) +
      '<div class="split"><div><h3 class="h-good">' + esc(TEXT.strengths) + '</h3>' + points(career.strengths) + '</div>' +
      '<div><h3 class="h-warn">' + esc(TEXT.weaknesses) + '</h3>' + points(career.weaknesses) + '</div></div>' +
      '<h3>' + esc(TEXT.howYouWork) + '</h3><p>' + esc(career.workStyle) + '</p>' +
      '<h3>' + esc(TEXT.holdBack) + '</h3><p>' + esc(career.watchOuts) + '</p></div>';

    // Instagram behaviour: the part of the export nobody reads themselves.
    // It sits after the personality sections because it is the evidence
    // underneath them rather than another verdict.
    const activity = report.activity;
    if (activity) {
      // No sub-line and no closing caveat: the summary said in prose what the
      // four facets say with evidence attached, and the blind-spots note
      // duplicated the confidence section that closes the whole report.
      html += '<div class="card section-card">' + head('📱', esc(TEXT.activity));
      html += '<div class="facet-grid">';
      for (const [label, key] of Copy.ACTIVITY_FACETS) {
        const facet = activity[key];
        if (!facet) continue;
        html += '<div class="facet"><span class="facet-label">' + label + '</span>' +
          '<h4>' + esc(facet.headline) + '</h4><p>' + esc(facet.detail) + '</p></div>';
      }
      html += '</div></div>';
    }

    // The roast. Free, behind a click-to-reveal cover rather than a payment,
    // and placed right after the digital footprint it draws its evidence
    // from — this used to sit after all four paid sections, back when it
    // was one of them; now that it is not, it belongs with the free report
    // it is actually part of, not stranded after the paywall.
    html += roastBlock(report.bonus);

    // Everything from here to the confidence close is paid for. The four
    // sections are rendered from `PAID_SECTIONS` rather than one `if` each,
    // so a reader sees the same four sections in the same order whether or
    // not they have bought anything.
    //
    // The sample forces every section locked (`unlocked = {}`) rather than
    // reading the reader's own `paidAnalysis()` — this report belongs to
    // nobody, so it must never show *their* unlock state, paid or not.
    //
    // While nothing at all has come back yet, one consolidated block explains
    // all four sections with a single "Unlock" button — not four separate
    // price tags for what is one purchase. The instant anything is unlocked
    // (a full response, or a partial one from a call that only returned some
    // fields), each section gets its own full card instead, so a reader who
    // already paid is never shown the consolidated pitch again for the
    // section still filling in behind it.
    const unlocked = sample ? {} : paidAnalysis();
    if (Object.keys(unlocked).length === 0) {
      html += paidSectionsLockedHtml({ sample });
    } else {
      for (const section of PAID_SECTIONS) html += paidCard(section, unlocked, { sample });
    }


    // Confidence closes the report rather than opening it: read after the
    // whole thing, it says how much of what you just read to believe. The
    // sources subsection and the re-run button that used to sit in the
    // page's own action row now live here too — this is the one place a
    // reader is already thinking about how much evidence stands behind the
    // report, which is exactly what adding a source or running again changes.
    // Neither belongs on the sample: it is nobody's report, has no digest of
    // its own, and must never show a real reader's re-run price or upload
    // state as if it were the sample's.
    // `sectionHead` rather than `head`: this one card does not collapse. It is
    // the only section that is not a piece of the reading — it holds the
    // confidence score, the Data sources rows and the button that adds a
    // source or runs again, which are the things a reader comes back to the
    // bottom of the report to *do*. Shutting those behind a disclosure would
    // hide the page's own controls, not tidy its prose.
    html += '<div class="card section-card confidence-card">' +
      sectionHead('🎯', esc(TEXT.trust), esc(TEXT.trustSub)) +
      '<div class="confidence-meter"><div class="confidence-fill" style="width:' + Math.round(report.confidence.score) + '%"></div></div>' +
      '<p><strong>' + esc(TEXT.trustScore) + Math.round(report.confidence.score) + '/100 (' + esc(report.confidence.level) + ').</strong> ' +
      esc(report.confidence.rationale) + '</p>' +
      (sample ? '' : sourcesUsedHtml()) +
      '</div>';

    return html;
  }

  /**
   * The "Analysed by" line at the foot of the report. Two lines once a paid
   * unlock exists, since two different providers wrote different parts of the
   * document a reader is about to save or forward — printing only the free
   * report's model would misdescribe who wrote the roast they are reading.
   *
   * Called both from `renderProfile` (the report as first loaded) and from the
   * premium success handler (the moment a payment turns one provider's
   * document into two providers' document) — one function, so the two call
   * sites cannot say different things about the same profile.
   *
   * Guarded on `premiumModel`/`premiumAt` existing, not just on
   * `premiumAnalysis`: a profile unlocked before this pair existed still has
   * the writing but not the record of who wrote it or when, and falls back to
   * the one-line form rather than printing "undefined".
   */
  function renderAnalysedBy(profile) {
    const lines = ['Analysed by ' + esc(profile.model || 'the model') + ' on ' +
      esc(new Date(profile.createdAt).toLocaleString()) + '.'];
    if (profile.premiumAnalysis && profile.premiumModel && profile.premiumAt) {
      lines.push('Premium sections analysed by ' + esc(profile.premiumModel) + ' on ' +
        esc(new Date(profile.premiumAt).toLocaleString()) + '.');
    }
    $('#analysed-by').innerHTML = lines.join('<br>');
  }

  function renderProfile() {
    const profile = state.profile;
    if (!profile) return;
    const report = profile.report;

    const who = profile.card.name || 'Your';
    $('#profile-title').textContent = who + '’s psyche';

    // The PDF letterhead. Only ever visible in print, but filled here so the
    // export never depends on anything happening at print time.
    $('#letterhead-name').textContent = who;
    $('#letterhead-meta').textContent =
      'Generated ' + new Date(profile.createdAt).toLocaleDateString(undefined,
        { year: 'numeric', month: 'long', day: 'numeric' }) +
      ' · from an Instagram data export · ' + Math.round(report.confidence.score) + '/100 confidence';

    paintQrCanvas('#qr-canvas');

    const cardHtml = psycheCardHtml(report);
    $('#psyche-card').innerHTML = cardHtml;
    $('#psyche-card-full').innerHTML = cardHtml;
    // Hidden rather than left empty on a report too old or too thin to fill it,
    // so the page never opens on a blank frame with a "tap to expand" label
    // under it.
    $('#psyche-card-section').hidden = !cardHtml;
    $('#psyche-card-title').textContent = TEXT.cardSection;
    $('#psyche-card-hint').textContent = TEXT.cardHint;
    // Visible label plus a fuller aria-label — both set from copy.js rather
    // than hardcoded in index.html like the icon glyphs themselves.
    $('#card-download').setAttribute('aria-label', TEXT.cardDownload);
    $('#card-download-label').textContent = TEXT.cardDownloadLabel;
    $('#card-share').setAttribute('aria-label', TEXT.cardShare);
    $('#card-share-label').textContent = TEXT.cardShareLabel;
    layoutPsycheCard();

    // The sources subsection and the re-run button are built into this HTML
    // by sourcesUsedHtml() — see reportSectionsHtml. #rerun-with-data is
    // handled by a delegated listener (see the document click handler
    // below) rather than bound here, because this element is replaced every
    // time the report renders.
    $('#profile-body').innerHTML = reportSectionsHtml(report);
    collapseSections($('#profile-body'));

    // Sits after the action buttons rather than inside the report: it is a
    // record of the run, not a finding, and closing the page with it means
    // it stays true no matter what gets added between the report and the
    // buttons above it.
    renderAnalysedBy(profile);
  }

  function historyTable(history) {
    return '<div class="table-scroll"><table class="match-table"><thead><tr>' +
      '<th>' + esc(TEXT.matchWith) + '</th><th>' + esc(TEXT.matchBasis) + '</th><th>' + esc(TEXT.matchScore) + '</th><th>' + esc(TEXT.matchWhen) + '</th><th></th></tr></thead><tbody>' +
      history.map((entry, index) => {
        const mode = entry.mode || (entry.report && entry.report.mode) || 'romantic';
        return '<tr><td>' + esc(entry.withName) + '</td>' +
          '<td class="muted">' + esc(MODE_LABELS[mode] || mode) + '</td>' +
          '<td>' + scorePill(entry.report.score) + '</td>' +
          '<td class="muted">' + esc(new Date(entry.when).toLocaleDateString()) + '</td>' +
          '<td><a href="#" data-report="' + index + '">Open →</a></td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function scorePill(score) {
    const value = Math.round(Number(score) || 0);
    const tier = value >= 80 ? 'a' : value >= 65 ? 'b' : value >= 50 ? 'c' : 'd';
    return '<span class="score-pill s-' + tier + '">' + value + '</span>';
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-report]');
    if (!link) return;
    event.preventDefault();
    const entry = store.read(KEYS.history, [])[Number(link.dataset.report)];
    if (entry) { renderReport(entry.report, entry.withName, entry.when); show('report'); }
  });

  // The profile page and the scan page both offer this person's own link, so
  // one handler serves both buttons.
  function copyMyLink(button) {
    const url = profileUrl(state.profile.payload);
    const label = button.textContent;
    const done = () => { button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = label; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
    else window.prompt('Copy this link:', url);
  }
  $('#copy-link').addEventListener('click', () => copyMyLink($('#copy-link')));
  $('#copy-link-scan').addEventListener('click', () => copyMyLink($('#copy-link-scan')));

  // A file someone else will scan needs more room than the on-screen code: it
  // gets viewed at whatever size a photo app picks, and if that is 300px wide
  // the modules are back down to three pixels and nothing reads it. So the
  // export is rendered fresh at 1600px with the full four-module quiet zone
  // rather than reusing the display canvas.
  const EXPORT_PX = 1600;

  function renderExportCanvas(url) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      window.QRCode.toCanvas(canvas, url, qrOptions(url, EXPORT_PX, 4),
        error => (error ? reject(error) : resolve(canvas)));
    });
  }

  // The mark, stroked from the same SVG path data the nav and the PDF use —
  // Path2D parses the arcs itself, so unlike the PDF writer this needs no
  // bezier conversion of its own.
  function drawBrandMark(context, left, top, size) {
    const mark = Copy.BRAND_MARK;
    context.save();
    context.translate(left, top);
    context.scale(size / mark.viewBox, size / mark.viewBox);
    // In the scaled space a stroke of `strokeWidth` units comes out at
    // strokeWidth * (size / viewBox) pixels — exactly the SVG's own ratio.
    context.lineWidth = mark.strokeWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#7b3fa0';
    for (const d of mark.paths) context.stroke(new Path2D(d));
    // Filled, so it is drawn here rather than living in `paths` with the
    // stroked orbits.
    if (mark.dot) {
      context.fillStyle = '#7b3fa0';
      context.beginPath();
      context.arc(mark.dot.cx, mark.dot.cy, mark.dot.r, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  const LABEL_FONT_STACK = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  // Room for the mark, the wordmark and the name below the code. Appended
  // below the code rather than drawn over any part of it, so the module grid
  // the decoder depends on is untouched by any of this.
  const LABEL_HEIGHT = 240;

  /** The exported QR, with a caption strip added underneath: the brand and
   * the person's name, so a file someone saved or forwarded still says whose
   * it is once it is a few shares removed from this page. */
  function renderLabelledExport(url, name) {
    return renderExportCanvas(url).then(qr => {
      const canvas = document.createElement('canvas');
      canvas.width = qr.width;
      canvas.height = qr.height + LABEL_HEIGHT;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(qr, 0, 0);

      context.strokeStyle = '#e7dfec';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(120, qr.height + 26);
      context.lineTo(canvas.width - 120, qr.height + 26);
      context.stroke();

      const markSize = 50;
      const wordmark = 'PSYCHEAI';
      context.textBaseline = 'middle';
      context.font = '700 28px ' + LABEL_FONT_STACK;
      const wordWidth = context.measureText(wordmark).width;
      const gap = 14;
      const rowY = qr.height + 96;
      const rowLeft = (canvas.width - (markSize + gap + wordWidth)) / 2;
      drawBrandMark(context, rowLeft, rowY - markSize / 2, markSize);
      context.fillStyle = '#7b3fa0';
      context.textAlign = 'left';
      context.fillText(wordmark, rowLeft + markSize + gap, rowY);

      // A long name shrinks to fit rather than running off the strip — the
      // card caps a name at 24 characters, but this also protects against
      // whatever the model actually returned.
      const maxNameWidth = canvas.width - 160;
      let nameSize = 58;
      context.textAlign = 'center';
      while (nameSize > 30) {
        context.font = '700 ' + nameSize + 'px ' + LABEL_FONT_STACK;
        if (context.measureText(name).width <= maxNameWidth) break;
        nameSize -= 2;
      }
      context.fillStyle = '#241a2e';
      context.fillText(name, canvas.width / 2, qr.height + 190);

      return canvas;
    });
  }

  // The profile page and the scan page both offer this person's own download,
  // so one handler serves both buttons.
  async function downloadMyQr(button) {
    const label = button.textContent;
    const profile = state.profile;
    const displayName = profile.card.name || 'PsycheAI user';
    const fileName = 'psycheai-' + (profile.card.name || 'me').toLowerCase().replace(/\W+/g, '-');
    try {
      const canvas = await renderLabelledExport(profileUrl(profile.payload), displayName);
      // 0.95 is well clear of the point where JPEG ringing touches a module —
      // at 1600px each one is about 17 pixels across.
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) throw new Error('Could not encode the image.');

      // A Blob URL rather than a data URL, and the anchor in the document:
      // Firefox ignores a click on a detached anchor, and Safari will not
      // honour "download" on a large data: URL.
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = fileName + '.jpg';
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      button.textContent = 'Could not save — use the link';
      setTimeout(() => { button.textContent = label; }, 3000);
    }
  }
  $('#download-qr').addEventListener('click', () => downloadMyQr($('#download-qr')));
  $('#download-qr-scan').addEventListener('click', () => downloadMyQr($('#download-qr-scan')));

  // The report is typeset into a PDF here rather than handed to the browser's
  // print dialog. Print-to-PDF gave the user no say over page size, margins or
  // whether backgrounds were included, put the browser's own header on every
  // page, and on mobile often offered no PDF destination at all. pdf.js writes
  // the file directly, so the download is one click and looks the same
  // everywhere.
  function buildReportPdf(profile) {
    const stamp = profile.createdAt ? new Date(profile.createdAt) : new Date();
    // Same date-only granularity the free line already used — kept rather
    // than upgraded to match the page's full date-and-time, so the two
    // "Analysed by" lines in one PDF read as one convention rather than two.
    const premiumStamp = profile.premiumAt ? new Date(profile.premiumAt) : null;
    return window.PsychePDF.build(profile.report, profile.card, {
      date: stamp.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      model: profile.model || '',
      // The provider and date that wrote the paid sections, when there are
      // any — see renderAnalysedBy on the page for why this is a separate
      // pair rather than overwriting model/date above.
      premiumModel: profile.premiumModel || '',
      premiumDate: premiumStamp
        ? premiumStamp.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '',
      // The page shows a matches section when this device has any, so the
      // report does too.
      history: store.read(KEYS.history, []),
      // The roast prints only for the reader who bought it. Unpaid, the key is
      // absent and the section does not exist in the file at all.
      unlocked: unlockedSections(profile),
    });
  }

  // ---------- where the report goes ----------
  //
  // The report itself never leaves the device — it is typeset in the browser
  // and downloaded straight to disk, exactly as it always was. What is new is
  // that the reader is asked for an address first, which is posted to the
  // server and recorded there, and only there: `recipients.record` on the
  // server side has no parameter an attachment could go in, so there is no
  // code path that could send the report anywhere. This deliberately does not
  // save the address anywhere on the device, and does not let the download
  // through if recording the address fails — a silent download on failure
  // would make it impossible to tell whether recording is working at all.
  function askEmailAndDownload(event) {
    const button = event.currentTarget;
    const profile = state.profile;
    if (!profile) return;

    const dialog = $('#mail-dialog');
    const input = $('#mail-address');
    const status = $('#mail-status');
    const sendButton = $('#mail-send');
    const label = sendButton.textContent;

    const say = (message, tone) => {
      status.textContent = message || '';
      status.hidden = !message;
      status.className = 'mail-status' + (tone ? ' is-' + tone : '');
    };

    const close = () => dialog.close();

    const downloadReport = () => {
      const href = URL.createObjectURL(buildReportPdf(profile));
      const link = document.createElement('a');
      link.download = 'psycheai-report.pdf';
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    };

    const send = async () => {
      const address = input.value.trim();
      // The same shape the server insists on, checked here first so an obvious
      // typo costs a moment rather than a round trip.
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(address)) {
        say('That does not look like an email address.', 'bad');
        input.focus();
        return;
      }
      sendButton.disabled = true;
      say(TEXT.mailSending);
      try {
        const response = await fetch('api/record-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: address }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'That address could not be recorded.');
        downloadReport();
        say(TEXT.mailSent, 'good');
        sendButton.disabled = false;
        sendButton.textContent = label;
        setTimeout(() => { if (dialog.open) close(); }, 1400);
        return;
      } catch (error) {
        say((error && error.message) || 'That address could not be recorded.', 'bad');
      }
      sendButton.disabled = false;
      sendButton.textContent = label;
    };

    const onKey = keyEvent => { if (keyEvent.key === 'Enter') { keyEvent.preventDefault(); send(); } };

    sendButton.addEventListener('click', send);
    $('#mail-cancel').addEventListener('click', close);
    input.addEventListener('keydown', onKey);
    dialog.addEventListener('close', () => {
      sendButton.removeEventListener('click', send);
      $('#mail-cancel').removeEventListener('click', close);
      input.removeEventListener('keydown', onKey);
      sendButton.disabled = false;
      sendButton.textContent = label;
      button.focus();
    }, { once: true });

    $('#mail-dialog-blurb').textContent = TEXT.mailBlurb;
    $('#mail-fineprint').textContent = TEXT.mailFine;
    say('');
    input.value = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    input.focus();
  }

  const exportPdf = askEmailAndDownload;

  // ---------- psyche card: inline preview and full screen ----------
  //
  // Both copies are scaled here rather than in CSS, because the fit depends on
  // the viewport and on the column the preview happens to be sitting in, and
  // neither is knowable from a stylesheet.
  function layoutPsycheCard() {
    const slot = $('#psyche-card-open');
    if (slot && !$('#psyche-card-section').hidden) {
      // Capped in height as well as width. Left width-led it filled the column
      // and pushed "Who you are" a screen and a half down the page — the
      // opposite of what a summary above the report is for. It is a thumbnail
      // to be tapped, so it is sized like one.
      const width = slot.clientWidth || CARD_W;
      fitCard($('#psyche-card'), width, PREVIEW_MAX_H);
    }
    const dialog = $('#card-dialog');
    if (dialog && dialog.open) {
      // Full screen is the case the whole fixed-size approach exists for: fit
      // both axes, with a small margin so it never touches the edges.
      // The download bar is pinned to the bottom of the viewport, so the card is
      // fitted into what is left above it rather than into the whole screen —
      // otherwise the button lands on top of the card's last row.
      fitCard($('#psyche-card-full'),
        window.innerWidth * 0.94, window.innerHeight * 0.96 - CARD_BAR_SPACE, 'screen');
    }
    layoutSampleCard();
  }

  /**
   * The same fit for the sample dialog's copy of the card.
   *
   * Kept separate from the branch above rather than folded into it because the
   * two are measured against different boxes: the report's preview is fitted to
   * the column it sits in, and this one to the dialog's own scrolling body,
   * which is a different width on the same screen. Width-led with the same
   * PREVIEW_MAX_H ceiling, so the sample opens on a card the same size the
   * reader's own report will show them.
   */
  function layoutSampleCard() {
    const section = $('#sample-card-section');
    if (!section || section.hidden) return;
    const frame = section.querySelector('.psyche-card-frame');
    if (!frame) return;
    // The frame is what fitCard resizes, so its own width is not the space
    // available — that is the section it sits in, minus the padding.
    const style = getComputedStyle(section);
    const width = section.clientWidth -
      parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    if (width > 0) fitCard($('#sample-psyche-card'), width, PREVIEW_MAX_H);
  }

  // ---------- the card as an image ----------
  //
  // The card is DOM, and the reader wants a PNG. Rasterising it means putting
  // the markup inside an SVG <foreignObject>, loading that as an image and
  // painting it to a canvas — the one route a browser offers without shipping a
  // rendering library.
  //
  // Two things make or break it. The SVG carries no reference to the page it
  // came from, so the whole stylesheet is inlined; it is fetched once and kept,
  // rather than reconstructed from cssRules, because the variables the card's
  // colours resolve through live on :root and are easy to miss when picking
  // rules out by selector. And every node has to be XHTML — serialised through
  // XMLSerializer, with the namespace declared on the wrapper — since an SVG
  // document rejects the HTML parser's unclosed tags.
  // Only the rules the card actually uses, read out of the live CSSOM.
  //
  // Fetching styles.css and inlining the text was the obvious first attempt, and
  // it fails outright — the SVG never loads and the download silently produces
  // nothing. The reason is worth writing down because it is not the one you
  // would guess: the file's *comments* mention `<linearGradient>` and
  // `<dialog>`, and dropping raw CSS into an XML `<style>` element hands those
  // to the XML parser as unclosed tags. Reading `cssText` off the CSSOM avoids
  // it for free, since the parser has already stripped every comment.
  //
  // Selecting by prefix is then about size and relevance rather than
  // correctness: the card's own rules plus the custom properties its colours
  // resolve through, and none of the rest of the app.
  const CARD_RULE = /^(:root|\.psyche-card|\.pc-)/;
  let styleSheetText = null;
  function cardStyles() {
    if (styleSheetText !== null) return styleSheetText;
    const parts = [
      // The page's own reset is not in the extracted set, and the card's
      // geometry assumes it.
      '*{box-sizing:border-box}',
      'div,p,h2,ul,li,span{margin:0;padding:0}',
      'ul{list-style-position:inside}',
      '.psyche-card{font-family:' +
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif}',
    ];
    for (const sheet of document.styleSheets) {
      let rules;
      // A stylesheet from another origin throws on access rather than
      // returning nothing, and there is no reason to fail the export over one.
      try { rules = sheet.cssRules; } catch (error) { continue; }
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        const matches = rule.selectorText.split(',')
          .some(selector => CARD_RULE.test(selector.trim()));
        if (matches) parts.push(rule.cssText);
      }
    }
    styleSheetText = parts.join('\n');
    return styleSheetText;
  }

  const CARD_IMAGE_SCALE = 2;

  async function cardImageBlob() {
    const source = $('#psyche-card-full');
    if (!source) return null;
    const width = source.offsetWidth;
    const height = source.offsetHeight;
    if (!width || !height) return null;

    // A clone at scale 1: the live node is under a transform that fits it to the
    // screen, and the image should be the card at full size rather than at
    // whatever this viewport happened to shrink it to.
    const clone = source.cloneNode(true);
    clone.style.transform = 'none';
    clone.style.margin = '0';
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

    const markup = new XMLSerializer().serializeToString(clone);
    const css = cardStyles();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">' +
      '<style>' + css + '</style>' + markup +
      '</foreignObject></svg>';

    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const image = new Image();
    image.decoding = 'sync';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('the card could not be drawn'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width * CARD_IMAGE_SCALE;
    canvas.height = height * CARD_IMAGE_SCALE;
    const context = canvas.getContext('2d');
    // The card's own background is painted by its stylesheet, but a PNG with an
    // alpha channel behind it would go transparent wherever the radius rounds
    // the corners, which reads as a hole in every viewer that shows a dark page.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(CARD_IMAGE_SCALE, CARD_IMAGE_SCALE);
    context.drawImage(image, 0, 0);

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  function cardImageName() {
    return 'psycheai-card-' +
      String((state.profile && state.profile.card && state.profile.card.name) || 'me')
        .toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '');
  }

  function triggerDownload(blob, name) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = name;
    link.href = href;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  // Shared by both icon buttons: neither carries visible text of its own any
  // more for a failure to borrow, so an error from either one shows up here
  // instead of inside the button.
  function flashCardStatus(message) {
    const status = $('#card-dialog-status');
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
    if (message) setTimeout(() => { status.hidden = true; status.textContent = ''; }, 3000);
  }

  async function downloadCardImage(event) {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const blob = await cardImageBlob();
      if (!blob) throw new Error('empty');
      triggerDownload(blob, cardImageName() + '.png');
    } catch (error) {
      flashCardStatus(TEXT.cardImageError);
    } finally {
      button.disabled = false;
    }
  }

  // The Web Share API can share a file only on the browsers that actually
  // support it — Safari and Chrome on a phone, not desktop Chrome or
  // Firefox — and canShare() is how a browser says so up front rather than
  // share() throwing after the fact. Where it is missing, or present but
  // unable to share an image specifically, this falls back to the same
  // download the other button offers: a share button that silently does
  // nothing would be worse than one that hands over the file another way.
  async function shareCardImage(event) {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const blob = await cardImageBlob();
      if (!blob) throw new Error('empty');
      const name = cardImageName() + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: TEXT.cardSection });
          return;
        } catch (error) {
          // The reader opened the share sheet and backed out themselves —
          // not a failure, and not something to fall back from.
          if (error && error.name === 'AbortError') return;
        }
      }
      triggerDownload(blob, name);
    } catch (error) {
      flashCardStatus(TEXT.cardImageError);
    } finally {
      button.disabled = false;
    }
  }

  function openPsycheCard() {
    const dialog = $('#card-dialog');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    layoutPsycheCard();
  }

  $('#psyche-card-open').addEventListener('click', openPsycheCard);
  $('#card-download').addEventListener('click', downloadCardImage);
  $('#card-share').addEventListener('click', shareCardImage);
  $('#card-dialog-close').addEventListener('click', () => $('#card-dialog').close());
  // Clicking the backdrop closes it: the dialog element itself fills the screen,
  // so a click that lands on it rather than on the card is a click outside.
  $('#card-dialog').addEventListener('click', event => {
    if (event.target === $('#card-dialog')) $('#card-dialog').close();
  });
  window.addEventListener('resize', layoutPsycheCard);

  // The QR code and its actions were an always-visible panel on the profile
  // page; they are a popout now, opened on demand from beside the download
  // button. paintQrCanvas is still filled by renderProfile regardless of
  // whether the dialog is open — drawing to a canvas does not need the
  // element to be visible — so the dialog always opens with a code that is
  // already current.
  $('#test-compat-open').addEventListener('click', () => {
    const dialog = $('#compat-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  $('#compat-dialog-close').addEventListener('click', () => $('#compat-dialog').close());
  $('#compat-dialog').addEventListener('click', event => {
    if (event.target === $('#compat-dialog')) $('#compat-dialog').close();
  });

  // ---------- premium unlock: Stripe's Payment Request Button ----------
  //
  // Apple Pay and Google Pay both come from the one integration point —
  // Stripe decides at mount time which wallet, if either, this browser and
  // device actually offer, rather than the app choosing between two buttons
  // of its own. Stripe.js is the one script in this app not vendored under
  // docs/vendor/: Stripe does not support a pinned local copy, since the file
  // at this URL carries its own fraud-detection updates. Loaded lazily, on
  // the first real (non-mock) Unlock press, rather than paid for by every
  // visitor whether or not they ever reach this section.
  let stripeJsLoad = null;
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (!stripeJsLoad) {
      stripeJsLoad = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.onload = () => resolve(window.Stripe);
        script.onerror = () => reject(new Error('Stripe could not be loaded.'));
        document.head.appendChild(script);
      });
    }
    return stripeJsLoad;
  }

  function premiumStatus(message, tone) {
    const status = $('#premium-status');
    status.textContent = message || '';
    status.hidden = !message;
    status.className = 'premium-status' + (tone ? ' is-' + tone : '');
  }

  // A live seconds counter beside the (indeterminate — there is no real
  // percentage to report for a single request/response call) progress bar,
  // so a reader watching a long structured call is looking at a number that
  // moves rather than a bar that never fills and a sentence that never
  // changes.
  let progressTimer = null;
  function startProgress() {
    const bar = $('#premium-progress');
    const time = $('#premium-progress-time');
    bar.hidden = false;
    const start = Date.now();
    const tick = () => { time.textContent = Math.floor((Date.now() - start) / 1000) + 's'; };
    tick();
    progressTimer = setInterval(tick, 1000);
  }
  /**
   * Warns before the tab closes while a paid call is in flight. The browser
   * shows its own generic wording — a custom message has been ignored since
   * about 2016 — so this only decides *whether* to ask, not what it says.
   *
   * Worth the interruption precisely because this call is slow: closing at
   * minute four is the difference between reading what you bought and coming
   * back to fetch it again. The receipt makes that recoverable rather than
   * lost, so this is a nudge, not the safety net.
   */
  let unloadGuard = null;
  function guardUnload(on) {
    if (on && !unloadGuard) {
      unloadGuard = event => { event.preventDefault(); event.returnValue = ''; };
      window.addEventListener('beforeunload', unloadGuard);
    } else if (!on && unloadGuard) {
      window.removeEventListener('beforeunload', unloadGuard);
      unloadGuard = null;
    }
  }

  function stopProgress() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    $('#premium-progress').hidden = true;
  }

  /**
   * Offered once a paid unlock is authorised, before the paid sections are
   * written: a chance to add Google or Facebook data so the four sections are
   * read from more than Instagram alone.
   *
   * Skipped silently when this reader has already added a source — the offer
   * only makes sense while there is something left to add.
   *
   * Two things about the ordering matter more than they look:
   *
   * 1. The receipt is written by the caller *before* this runs. This dialog
   *    sits between a cleared payment and the generation it paid for, so a
   *    reader who opens it and then closes the tab has been charged for
   *    something that never ran. The receipt is what makes that recoverable
   *    ("Get the sections you paid for"), and it has to exist before anything
   *    here can be walked away from.
   * 2. The premium dialog is closed first and reopened after. Stacking a
   *    second modal on top of it would leave the payment sheet visible
   *    underneath, still showing a wallet button for a charge that has
   *    already gone through.
   *
   * Adding data goes through the review dialog, exactly as the first upload
   * does. Skipping does not — that path sends the same digest it always
   * would, so there is nothing new to review. This is deliberate rather than
   * belt-and-braces: Chrome history and Gemini prompts are the most sensitive
   * things this app can carry, and sending them unreviewed because the reader
   * happened to be inside a payment flow would break the one promise the
   * review dialog exists to keep.
   *
   * Returns the digest the paid call should use — the enriched one when
   * something was added, the existing one otherwise.
   */
  // Holds the enriched digest between "the reader added data and reviewed it"
  // and "the payment for it actually cleared". Deliberately not persisted
  // until the paid call succeeds: a reader who adds a Takeout and then
  // abandons the payment sheet has bought nothing, and should not find their
  // stored digest quietly changed — nor the re-run button gone, which is what
  // persisting early would do.
  let pendingPremiumDigest = null;
  // True for the whole span between a payment/promo clearing and the paid
  // sections either landing or failing. A second runPremiumAnalysis call
  // cannot start while one is already spending this reader's retry budget —
  // see the guard at its own top. The dialog itself can still be closed via
  // Cancel during that span (see the #premium-cancel listener), which is why
  // runPremiumAnalysis reads its own paidDigest snapshot rather than
  // the live pendingPremiumDigest after an await: a reopened dialog resets
  // that shared variable, and reading it again here used to crash the
  // original call once its network response finally arrived.
  let premiumRunInFlight = false;

  /**
   * Offered when the unlock button is pressed and this reader has only ever
   * given Instagram: a chance to add Google or Facebook so the four paid
   * sections are read from more than one source.
   *
   * Runs BEFORE any payment UI is mounted, which is the whole point of its
   * placement — the reader loads their data and sees exactly what will be
   * sent, and only then is asked for money. That ordering also removes a
   * hazard the earlier arrangement had: with payment first, this dialog sat
   * between a cleared charge and the generation it bought, so closing the tab
   * here meant paying for nothing.
   *
   * Adding data goes through the review; skipping does not, because skipping
   * sends nothing new. Chrome history and Gemini prompts must not reach a
   * model unreviewed just because the reader is inside an unlock flow.
   *
   * Returns the digest the paid call should use, or null to abandon the
   * unlock entirely (Back at the supplement offer).
   */
  async function collectExtraDataForPremium() {
    const current = state.digest;
    if (!current || current.google || current.facebook) return current;

    let supplements = null;
    try {
      supplements = await askSupplement(state.signals && state.signals.supplements);
    } catch (error) {
      return current;
    }
    // Back resolves null and means "I have changed my mind about all of this",
    // which is worth honouring now that nothing has been charged yet. Skip
    // resolves an empty object and means "get on with the unlock".
    if (!supplements) return null;
    if (!supplements.google && !supplements.facebook) return current;

    // Merged rather than rebuilt from the archive: the paid call takes no
    // photographs, so nothing here needs the Instagram export still to be in
    // memory — see Digest.addSupplements.
    let enriched;
    try {
      enriched = Digest.addSupplements(JSON.parse(JSON.stringify(current)), supplements);
    } catch (error) {
      return current;
    }

    // Payment is unconditionally the next step here — this review sits inside
    // the S$1.99 unlock itself, never reached without one due.
    const decision = await askReview(enriched, 0, null, { photosUnavailable: true, paymentDue: true });
    // Escape or Back at the review drops the addition rather than the unlock:
    // they have seen what the extra data contains and declined to send it, so
    // the paid call proceeds on the digest it would have used anyway.
    if (!decision || decision === REVIEW_BACK) return current;

    applyReviewDecision(enriched, decision);
    enriched.coverage.images.included = false;
    enriched.coverage.images.attached = 0;
    enriched.__addedSupplements = supplements;
    return enriched;
  }

  /**
   * Runs once a payment has actually cleared, or a valid promo code has been
   * entered — calls the paid route with the same digest the free report
   * used, and only reveals or persists anything once that call really
   * succeeds. `auth` is `{ paymentIntentId }` or `{ promoCode }`; either way
   * the server treats authorisation and generation as separate steps (see
   * server.js's handlePremiumAnalysis), so a generation that fails after a
   * real charge or a valid code is a "try again" here — re-sending the same
   * auth spends one more of the handful of uses the server allows per
   * payment (promo codes carry no such cap) — never a "pay again".
   */
  // Which purchase the payment dialog is currently collecting for. The dialog
  // markup, the wallet button, the promo field and the mock-pay button are all
  // shared between the S$1.99 premium unlock and the S$0.99 extra analysis;
  // the only thing that differs is what happens once the money clears, so that
  // is the only thing held in a variable rather than duplicated.
  let onPaymentAuthorised = runPremiumAnalysis;

  /**
   * The same authorisation, aimed at /api/analyse instead of
   * /api/premium-analysis. `product: 'unlock'` is what tells the server this
   * S$1.99 PaymentIntent is paying for a free report as well — it verifies
   * the intent against the unlock price and ledgers the use under its own
   * kind, so spending it here cannot eat the premium retries it also covers.
   *
   * A promo code needs none of that: it is not a product, and the analyse
   * route already accepts one on its own terms.
   */
  function bundledAuth(auth) {
    if (auth.promoCode) return { promoCode: auth.promoCode };
    return { paymentIntentId: auth.paymentIntentId, product: 'unlock' };
  }

  async function runPremiumAnalysis(auth, dialog, options) {
    // A second invocation while one is already running would race the first
    // for pendingPremiumDigest/state.digest and spend an extra retry for
    // nothing — see the comment on premiumRunInFlight's declaration.
    if (premiumRunInFlight) return;
    premiumRunInFlight = true;
    // Only clear the payment controls for an actual payment attempt. A promo
    // attempt is a wholly separate authorisation path — hiding the wallet or
    // mock-pay button while it runs would strand a reader whose code turns
    // out to be wrong with no visible way to just pay instead, short of
    // closing and reopening the dialog.
    if (auth.paymentIntentId) {
      $('#premium-payment-request-button').innerHTML = '';
      $('#premium-card-fallback').hidden = true;
      $('#premium-mock-pay').hidden = true;
    }
    $('#premium-retry').hidden = true;
    $('#premium-promo-input').disabled = true;
    $('#premium-promo-apply').disabled = true;
    // Cancel goes with them. Reaching this line means a charge has cleared or
    // a code has been accepted, and from here on the only thing Cancel can do
    // is walk away from work already paid for: the generation keeps running
    // either way (the fetch is not tied to the dialog — see "A closed dialog
    // does not stop the fetch behind it"), so closing here just hides the
    // progress and the retry button belonging to it. Re-enabled in the catch
    // below, because a *failed* generation is exactly when a reader must be
    // able to leave — including one whose promo code turns out to be wrong,
    // for whom nothing was ever charged in the first place.
    $('#premium-cancel').disabled = true;
    // Before the call, not after it. The whole point is to survive the tab
    // closing *during* the minutes this takes, so a receipt written on success
    // would be written exactly when it is no longer needed. It also has to be
    // written before offerDataBeforePremium below, which puts a dialog — and
    // therefore a chance to close the tab — between the cleared payment and
    // the generation it bought.
    rememberUnlock(auth);

    // Whatever openPremiumDialog collected before the payment sheet went up.
    // By the time a charge clears, the reader has already loaded their extra
    // data and reviewed it, so there is nothing left to ask here.
    const paidDigest = pendingPremiumDigest || state.digest;
    // Data was added on the way to this unlock, so the free sections above
    // are about to be describing less evidence than the paid ones below
    // them. This S$1.99 refreshes both rather than leaving that gap and
    // charging S$0.99 to close it.
    const needsFreeRefresh = Boolean(pendingPremiumDigest && pendingPremiumDigest !== state.digest);
    let refreshedFree = false;

    startProgress();
    guardUnload(true);
    try {
      // The free report goes first, deliberately. Whichever call runs second
      // can fail with the first already delivered and nothing owed; if this
      // order were reversed, a failure here would leave a paid-for free
      // report undelivered and no honest way to retry it — the re-run button
      // charges, and charging to recover something already paid for is the
      // exact unfairness this whole branch exists to remove. Failing here
      // instead delivers nothing yet and the retry below covers both.
      if (needsFreeRefresh) {
        premiumStatus(TEXT.premiumRefreshingFree);
        // No images: the unlock path never holds the archive open, which is
        // why collectExtraDataForPremium marks photographs unavailable.
        const refreshed = await LLM.analyseProfile(paidDigest, [], bundledAuth(auth));

        // Committed the moment the call comes back, before the paid sections
        // are even asked for. The extra data has bought something now — this
        // report — so both it and the digest behind it are kept whatever
        // happens next, and a retry sees the work already done rather than
        // paying for it twice.
        //
        // Reads paidDigest, the snapshot taken before this await, rather than
        // the shared pendingPremiumDigest variable again: premiumRunInFlight
        // stops another call from touching it now, but reading the mutable
        // variable here anyway would still be one stray future caller away
        // from crashing on a null it was reset to while this await was
        // pending.
        const added = paidDigest.__addedSupplements;
        delete paidDigest.__addedSupplements;
        if (added && state.signals) state.signals.supplements = added;
        state.digest = paidDigest;
        writeDigest(paidDigest);
        pendingPremiumDigest = null;

        if (state.profile) {
          state.profile.report = refreshed.data;
          state.profile.card = Card.shape(refreshed.data.card);
          state.profile.payload = await Card.encodeCard(refreshed.data.card);
          state.profile.model = refreshed.model;
          state.profile.createdAt = new Date().toISOString();
          store.write(KEYS.profile, state.profile);
        }
        // A free report really was generated, so it counts like any other —
        // see RUNS_KEY. It costs this reader nothing either way: they cannot
        // reach an unlock without having run one already.
        recordRun();
        refreshedFree = true;
      }

      premiumStatus(TEXT.premiumGenerating);
      // paidDigest, not state.digest directly: the refresh branch above sets
      // state.digest to paidDigest the moment it promotes it, so the two
      // already agree whenever that branch ran, and paidDigest is what to
      // send when it did not — reading state.digest here would be wrong the
      // moment this call reached here with an unpromoted digest still
      // pending.
      const result = await LLM.analysePremium(paidDigest, auth);
      if (state.profile) {
        state.profile.premiumAnalysis = result.data;
        // The provider and moment that wrote the paid sections, kept apart
        // from the free report's own `model`/`createdAt` because a different
        // call, on a different provider, wrote them — see renderAnalysedBy.
        state.profile.premiumModel = result.model || '';
        state.profile.premiumAt = new Date().toISOString();
        // Best-effort: a browser too full to hold this still leaves the
        // reader able to read what they paid for, on screen, for the rest of
        // this visit — it just will not survive a reload.
        store.write(KEYS.profile, state.profile);
      }
      // The extra data is kept only now, because only now has it bought
      // anything. Abandoning the payment sheet leaves the stored digest — and
      // the re-run button that reads it — exactly as they were. False already
      // whenever the refresh above ran, since that branch just set
      // state.digest to this same paidDigest.
      if (paidDigest !== state.digest) {
        const added = paidDigest.__addedSupplements;
        delete paidDigest.__addedSupplements;
        if (added && state.signals) state.signals.supplements = added;
        state.digest = paidDigest;
        writeDigest(paidDigest);
      }
      if (refreshedFree) {
        // Every section changed, not just the paid ones, so the whole report
        // is redrawn rather than having the paid bodies spliced into a page
        // still showing the pre-refresh free sections. renderProfile renders
        // the paid cards from state.profile.premiumAnalysis, which is set
        // above, and calls renderAnalysedBy itself.
        renderProfile();
        // renderProfile shuts every section, this one included — and this is
        // the one moment that is wrong, for the same reason revealPaid opens
        // what it injects: the reader has just paid for these four.
        openPaidSections();
      } else {
        revealPaid(result.data);
        // After revealPaid, not before: if injecting the sections themselves
        // ever threw, the footer would otherwise have already started claiming
        // Claude wrote sections the page does not show.
        if (state.profile) renderAnalysedBy(state.profile);
        // The confidence card's own re-run price note was written before this
        // unlock — paidAnalysis() now returns four sections where it returned
        // none, and the note has to say S$1.99 from this point on, not the
        // S$0.99 it showed a moment ago. renderProfile (the refreshedFree
        // branch above) already redraws this along with everything else, so
        // this only has to happen on the path that skips it.
        const sources = document.querySelector('.trust-sources');
        if (sources) sources.outerHTML = sourcesUsedHtml();
      }
      dialog.close();
    } catch (error) {
      premiumStatus((error && error.message) || TEXT.premiumGenerationFailed, 'bad');
      $('#premium-promo-input').disabled = false;
      $('#premium-promo-apply').disabled = false;
      // Nothing is generating any more, so there is nothing left to walk out
      // on — and a reader who has just been told their code was rejected, or
      // that the writing failed, must not be held in a dialog whose only
      // other exit is to try again.
      $('#premium-cancel').disabled = false;
      const retry = $('#premium-retry');
      retry.textContent = TEXT.premiumRetry;
      retry.hidden = false;
      retry.onclick = () => runPremiumAnalysis(auth, dialog, options);
    } finally {
      // In `finally` rather than once per branch: a throw inside revealPaid
      // would otherwise leave the ticking counter running and the page
      // refusing to close, which is a worse failure than the one that caused
      // it. Teardown belongs on every exit, including the ones not written
      // down yet.
      stopProgress();
      guardUnload(false);
      premiumRunInFlight = false;
    }
  }

  /**
   * Wires the real (non-mock) path: creates the PaymentRequest, mounts the
   * button only if this browser can actually satisfy it, and confirms
   * against the PaymentIntent lib/stripe.js already created server-side.
   *
   * `handleActions: false` on the first confirm, then a second unqualified
   * confirm if Stripe comes back asking for one, is the two-step Stripe
   * itself documents for this exact button — most cards clear on the first
   * pass, and the second only ever runs for the ones that come back
   * `requires_action`.
   *
   * `canMakePayment()` resolving falsy is not rare and not necessarily wrong:
   * it means this device has no wallet-eligible card, not that anything is
   * broken (a domain Stripe has not been told to trust for Apple Pay reads
   * the same way to this call as a phone with nothing in its Wallet app).
   * Either way a reader here still wants to pay, so `mountCardFallback` is
   * the other half of this function's job, not a separate feature bolted on.
   */
  async function mountPaymentRequestButton(intent, dialog) {
    const Stripe = await loadStripeJs();
    const stripe = Stripe(intent.publishableKey);
    const elements = stripe.elements();
    const paymentRequest = stripe.paymentRequest({
      country: intent.country,
      currency: intent.currency,
      total: { label: 'PsycheAI roast unlock', amount: intent.amount },
      requestPayerName: false,
      requestPayerEmail: false,
    });

    const canPay = await paymentRequest.canMakePayment();
    if (!canPay) {
      premiumStatus(TEXT.premiumNoWallet, 'bad');
      mountCardFallback(stripe, elements, intent, dialog);
      return;
    }

    const prButton = elements.create('paymentRequestButton', { paymentRequest });
    prButton.mount('#premium-payment-request-button');

    paymentRequest.on('paymentmethod', async event => {
      const confirmation = await stripe.confirmCardPayment(
        intent.clientSecret, { payment_method: event.paymentMethod.id }, { handleActions: false });
      if (confirmation.error) {
        event.complete('fail');
        premiumStatus(confirmation.error.message || TEXT.premiumFailed, 'bad');
        return;
      }
      event.complete('success');
      if (confirmation.paymentIntent.status === 'requires_action') {
        const followUp = await stripe.confirmCardPayment(intent.clientSecret);
        if (followUp.error) {
          premiumStatus(followUp.error.message || TEXT.premiumFailed, 'bad');
          return;
        }
      }
      onPaymentAuthorised({ paymentIntentId: intent.id }, dialog);
    });
  }

  /**
   * The fallback for a browser `canMakePayment()` says cannot use a wallet:
   * a plain Stripe Card Element, so the promo code field below it is never
   * the only way left to pay. Mounted immediately rather than behind a
   * second click — Unlock already failed once for this reader, and asking
   * them to press something else to be offered another way to pay would
   * read as the dialog not knowing what it just told them.
   *
   * `confirmCardPayment` alone (no `handleActions: false`) is enough here,
   * unlike the wallet path above: it already walks a card through 3D Secure
   * itself when a card asks for it, since there is no separate "payment
   * method" event to complete first the way the wallet flow has.
   */
  function mountCardFallback(stripe, elements, intent, dialog) {
    const wrap = $('#premium-card-fallback');
    const errorEl = $('#premium-card-error');
    const payButton = $('#premium-card-pay');
    $('#premium-card-label').textContent = TEXT.premiumCardLabel;
    payButton.textContent = esc(TEXT.premiumUnlockPrefix) + esc(TEXT.premiumPriceLabel);
    errorEl.hidden = true;
    errorEl.textContent = '';
    wrap.hidden = false;

    const card = elements.create('card');
    card.mount('#premium-card-element');
    // Stripe's own inline validation (a card number that fails Luhn, an
    // expiry already past) rather than waiting for a submit that was always
    // going to fail — the same reason the promo input does not wait for
    // Apply to tell a reader their code was empty.
    card.on('change', event => {
      errorEl.textContent = event.error ? event.error.message : '';
      errorEl.hidden = !event.error;
    });

    payButton.onclick = async () => {
      payButton.disabled = true;
      errorEl.hidden = true;
      try {
        const confirmation = await stripe.confirmCardPayment(intent.clientSecret, { payment_method: { card } });
        if (confirmation.error) {
          errorEl.textContent = confirmation.error.message || TEXT.premiumFailed;
          errorEl.hidden = false;
          return;
        }
        onPaymentAuthorised({ paymentIntentId: intent.id }, dialog);
      } finally {
        payButton.disabled = false;
      }
    };
  }

  /**
   * Opens the dialog, then asks the server for a PaymentIntent. The button
   * that triggered this is disabled for the round trip so a second click
   * cannot open a second one, and re-enabled in `finally` regardless of how
   * the attempt ends — cancelled, failed or unlocked all leave a clean cover
   * behind, in case the reader closes the dialog and tries again.
   */
  async function openPremiumDialog(button, product, preparedDigest) {
    const kind = product === 'analysis' ? 'analysis' : 'unlock';
    // The re-run button's own route to this same S$1.99 product, used only
    // when premium is already unlocked and the reader is adding/changing
    // data — see rerunWithAdditionalData. Ledgers and prices exactly like a
    // fresh unlock (server.js only ever sees `product: 'unlock'`); the only
    // difference is the title/blurb, since "unlock" is the wrong verb for a
    // reader who already has these sections.
    const rerunAll = product === 'rerunAll';
    const dialog = $('#premium-dialog');
    if (dialog.open) return;

    // Data first, review second, money last.
    //
    // preparedDigest is handed in already reviewed — see
    // rerunWithAdditionalData — so it is used as-is. Otherwise, only for a
    // fresh unlock: the resume path already has a receipt and is here to
    // collect sections that were paid for on an earlier visit, so it is
    // neither charged nor asked for anything.
    pendingPremiumDigest = null;
    if (preparedDigest) {
      pendingPremiumDigest = preparedDigest;
    } else if (kind === 'unlock' && !unlockReceipt()) {
      const collected = await collectExtraDataForPremium();
      // Back at the supplement offer abandons the unlock. Nothing has been
      // charged and no dialog has been opened, so this simply returns.
      if (!collected) return;
      pendingPremiumDigest = collected;
    }
    $('#premium-dialog-title').textContent =
      kind === 'analysis' ? TEXT.analysisDialogTitle
        : rerunAll ? TEXT.premiumRerunDialogTitle
        : TEXT.premiumDialogTitle;
    // By the time this sheet opens, the data offer has already been through,
    // so the dialog knows whether this S$1.99 is about to buy a rewrite of
    // the free sections as well — and says so. A reader agreeing to a price
    // should be told everything it covers at the moment they agree to it,
    // not discover the extra afterwards.
    const buysFreeRefresh = kind === 'unlock' &&
      Boolean(pendingPremiumDigest && pendingPremiumDigest !== state.digest);
    $('#premium-dialog-blurb').textContent =
      kind === 'analysis' ? TEXT.analysisDialogBlurb
        : rerunAll ? TEXT.premiumRerunDialogBlurb
        : buysFreeRefresh ? TEXT.premiumDialogBlurbWithData
        : TEXT.premiumDialogBlurb;
    $('#premium-cancel').textContent = TEXT.premiumCancel;
    // Reset with the rest of the dialog's state: runPremiumAnalysis greys it
    // out once a charge or code is accepted, and this markup is reused across
    // every purchase, so a dialog opened after a completed unlock would
    // otherwise open with no way out at all.
    $('#premium-cancel').disabled = false;
    $('#premium-payment-request-button').innerHTML = '';
    $('#premium-card-fallback').hidden = true;
    $('#premium-card-element').innerHTML = '';
    $('#premium-card-error').hidden = true;
    $('#premium-card-error').textContent = '';
    $('#premium-mock-pay').hidden = true;
    $('#premium-retry').hidden = true;
    $('#premium-promo-label').textContent = TEXT.premiumPromoLabel;
    $('#premium-promo-input').placeholder = TEXT.premiumPromoPlaceholder;
    $('#premium-promo-input').value = '';
    $('#premium-promo-input').disabled = false;
    $('#premium-promo-apply').textContent = TEXT.premiumPromoApply;
    $('#premium-promo-apply').disabled = false;
    premiumStatus('');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // showModal() focuses the first focusable descendant when nothing carries
    // `autofocus` — which, at this point, is the promo code input, since the
    // wallet button and the mock/retry buttons are all still empty or hidden.
    // On a phone that pulls the keyboard up over a dialog whose entire point
    // is to offer Apple Pay / Google Pay first, before anyone has touched the
    // promo field at all. `tabindex="-1"` on the dialog plus this explicit
    // focus() overrides that: the dialog itself takes focus, and the keyboard
    // only appears once the reader actually taps the promo input.
    dialog.focus();

    // Already paid, and the analysis never arrived — because the tab closed
    // mid-generation, the device slept, or the call failed. Fetching is all
    // that is left to do, so this returns before `create-payment-intent` is
    // ever reached: asking Stripe for a second PaymentIntent here is how a
    // reader ends up charged twice for one unlock.
    const receipt = kind === 'unlock' ? unlockReceipt() : null;
    if (receipt && !Object.keys(paidAnalysis()).length) {
      $('#premium-dialog-title').textContent = TEXT.premiumResumeTitle;
      $('#premium-dialog-blurb').textContent = TEXT.premiumResumeBlurb;
      const resume = $('#premium-retry');
      resume.textContent = TEXT.premiumResumeAction;
      resume.hidden = false;
      resume.onclick = () => runPremiumAnalysis(receipt, dialog, { offerData: false });
      return;
    }

    // Guarded rather than assumed present: askAnalysisPayment passes
    // #rerun-with-data, which — since it now lives inside the report's own
    // markup — does not exist yet the first time a reader is charged, before
    // any report has ever rendered. Disabling it is a nicety for whichever
    // button actually triggered this dialog, not a requirement of the flow.
    if (button) button.disabled = true;
    try {
      const response = await fetch('api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: kind }),
      });
      const intent = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((intent && intent.error) || TEXT.premiumNotConfigured);

      if (intent.mock) {
        // The whole Stripe round trip stands in for a click here — mock mode
        // never loads Stripe.js or touches the network again, the same way
        // PSYCHEAI_MOCK=1 never calls a real model.
        const mockButton = $('#premium-mock-pay');
        mockButton.textContent = TEXT.premiumMockPay;
        mockButton.hidden = false;
        mockButton.onclick = () => onPaymentAuthorised({ paymentIntentId: intent.id }, dialog);
        return;
      }

      await mountPaymentRequestButton(intent, dialog);
    } catch (error) {
      premiumStatus((error && error.message) || TEXT.premiumFailed, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /**
   * Collects payment for one extra analysis, resolving the authorisation to
   * pass to the model call — or null if the reader closed the dialog.
   *
   * Reuses the premium dialog wholesale rather than building a second one:
   * the wallet button, the card fallback, the promo field and the mock-pay
   * button are the same machinery whichever of the two products is being
   * bought. `onPaymentAuthorised` is the only thing swapped, and it is put
   * back on close so a later premium unlock still finishes as an unlock —
   * getting that restore wrong would send a reader's S$1.99 down the analysis
   * path, so it is done in the `close` handler where every exit passes.
   */
  function askAnalysisPayment() {
    return new Promise(resolve => {
      const dialog = $('#premium-dialog');
      if (dialog.open) { resolve(null); return; }
      let settled = false;
      onPaymentAuthorised = (auth, dlg) => {
        settled = true;
        dlg.close();
        resolve(auth);
      };
      dialog.addEventListener('close', () => {
        onPaymentAuthorised = runPremiumAnalysis;
        if (!settled) resolve(null);
      }, { once: true });
      openPremiumDialog($('#rerun-with-data'), 'analysis');
    });
  }

  /**
   * The gate every analysis passes through, free or paid.
   *
   * Resolves the `auth` to hand to the model call: `null` for a free run, an
   * object for a paid one, and `false` when the reader declined to pay — which
   * the callers treat as "stop", not as "run it free anyway".
   */
  async function authoriseAnalysis() {
    if (!mustPayForAnalysis()) return null;
    const auth = await askAnalysisPayment();
    // Deliberately says nothing itself. The two callers are on different
    // screens — the upload page and the report — and each has its own place
    // to put the message. Flashing #profile-alert from here left the upload
    // path writing into an element nobody could see yet, which then appeared
    // on the report page later as a message about something long finished.
    return auth || false;
  }

  // The promo path never touches Stripe or create-payment-intent at all — it
  // goes straight to the same paid route a real payment reaches, with a code
  // instead of a paymentIntentId, so it works even mid-dialog while a wallet
  // button is already mounted, and even on a server with no Stripe key set.
  function applyPromoCode() {
    const input = $('#premium-promo-input');
    const code = input.value.trim();
    if (!code) return;
    onPaymentAuthorised({ promoCode: code }, $('#premium-dialog'));
  }
  $('#premium-promo-apply').addEventListener('click', applyPromoCode);
  $('#premium-promo-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); applyPromoCode(); }
  });

  // This sheet is either entering or authorising a real charge, so it must
  // never close by accident: only the reader's own explicit Cancel, or a
  // successful run finishing (dialog.close() at the end of
  // runPremiumAnalysis), are allowed to close it. A stray click landing on
  // the dialog's own padding — which reads as "clicking the box" as much as
  // clicking outside it does, since a native <dialog>'s backdrop click also
  // targets the dialog element itself — used to close it just the same as
  // clicking genuinely outside, and Escape closed it too. Both are refused
  // unconditionally now, not only while a run is in flight: reopening this
  // same dialog after an accidental close is also what used to reset
  // pendingPremiumDigest out from under a run still awaiting its response
  // (see premiumRunInFlight's declaration) — refusing the close in the first
  // place removes that trigger entirely, rather than only guarding against it
  // once payment has cleared.
  $('#premium-cancel').addEventListener('click', () => $('#premium-dialog').close());
  // Deliberately no backdrop-click-to-close listener at all — the dialog's own
  // clicks are otherwise left alone rather than closing it.
  $('#premium-dialog').addEventListener('cancel', event => {
    event.preventDefault();
  });

  $('#export-pdf-bottom').addEventListener('click', exportPdf);

  /**
   * The same download for a comparison. Built from `state.lastReport`, which
   * renderReport fills — the report on screen is the one that gets written,
   * whether it arrived from a fresh scan or from the history table.
   */
  function exportCompatPdf(event) {
    const button = event.currentTarget;
    const label = button.textContent;
    const last = state.lastReport;
    if (!last) return;
    try {
      const when = last.when ? new Date(last.when) : new Date();
      const blob = window.PsychePDF.buildCompatibility(last.report, {
        a: last.myName,
        b: last.otherName,
        modeLabel: MODE_LABELS[last.mode] || '',
        stanceLabel: last.mode === 'professional' && Copy.WORK_STANCES[last.stance]
          ? Copy.stanceText(Copy.WORK_STANCES[last.stance].option, last.otherName) : '',
        heading: playbookHeading(last.mode, last.stance, last.otherName),
        date: when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
        model: (state.profile && state.profile.model) || '',
      });
      const slug = value => String(value || 'me').toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '');
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'psycheai-compatibility-' + slug(last.myName) + '-' + slug(last.otherName) + '.pdf';
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      button.textContent = 'Could not build the PDF';
      setTimeout(() => { button.textContent = label; }, 3000);
    }
  }

  $('#export-compat-top').addEventListener('click', exportCompatPdf);
  $('#export-compat-bottom').addEventListener('click', exportCompatPdf);

  $('#delete-profile').addEventListener('click', () => {
    // Names the one thing this deliberately does not delete. Saying so is
    // both honest — the button says "everything" — and the better deterrent:
    // it tells a reader the trick does not work rather than letting them
    // discover it by trying. See RUNS_KEY for why the count is kept apart.
    if (!window.confirm('Delete your profile, your evidence summary and all saved match reports from ' +
      'this browser?\n\nYour count of analyses already run is kept, so this does not restore a ' +
      'free analysis.')) return;
    store.clearAll();
    state.profile = null;
    state.digest = null;
    state.images = [];
    state.signals = null;
    show('welcome');
  });

  // ══════════════ 3. scanning ══════════════
  //
  // The card is dense — roughly 87 modules across — so the whole game is
  // pixels per module. At the display size that is about three, and jsQR wants
  // more than that once a lens and a screen's own pixel grid are in the way.
  // Hence: ask the camera for real resolution, and never give up after a
  // single decode attempt.

  let cameraStream = null;
  let scanTimer = null;

  const scratch = document.createElement('canvas');

  /** Draws a source into the scratch canvas and hands back its pixels. */
  function rasterise(source, width, height, crop) {
    if (!width || !height) return null;
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (crop) context.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
    else context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }

  // Some browsers cap how much canvas backing store a page may hold and, past
  // that, silently hand back a blank one instead of failing. Telling that apart
  // from "no code here" makes the difference between a useful error and a
  // baffling one.
  //
  // This is a heuristic, so it may only ever *label* a failure — never decide
  // whether to attempt one. An earlier version returned before calling jsQR
  // when it thought a draw was blank, and a false positive then skipped the
  // only renderings that could have read the code.
  //
  // Sampling is spread over many more pixels than before, on a stride coprime
  // with the row width so it cannot line up with the module grid, and it
  // compares a luminance range rather than exact equality.
  function looksBlank(pixels) {
    const data = pixels.data;
    const total = data.length / 4;
    if (!total) return true;
    const wanted = Math.min(total, 4000);
    let stride = Math.max(1, Math.floor(total / wanted));
    // Nudge to an odd stride that shares no factor with the row width, so the
    // samples walk across columns instead of marching down one.
    while (stride > 1 && gcd(stride, pixels.width) !== 1) stride++;

    let low = 255;
    let high = 0;
    for (let p = 0; p < total; p += stride) {
      const i = p * 4;
      const luma = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
      if (luma < low) low = luma;
      if (luma > high) high = luma;
      if (high - low > 12) return false;
    }
    return true;
  }

  function gcd(a, b) {
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  // jsQR does its own binarisation, but a global threshold rescues images it
  // gives up on: JPEG-softened edges, a grey screenshot background, a photo
  // taken under warm light.
  function threshold(pixels) {
    const data = pixels.data;
    let total = 0;
    let count = 0;
    const step = Math.max(4, Math.floor(data.length / 4 / 5000) * 4);
    for (let i = 0; i < data.length; i += step) {
      total += (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
      count++;
    }
    const cut = count ? total / count : 128;
    const copy = new Uint8ClampedArray(data);
    for (let i = 0; i < copy.length; i += 4) {
      const value = (copy[i] * 3 + copy[i + 1] * 6 + copy[i + 2]) / 10 > cut ? 255 : 0;
      copy[i] = copy[i + 1] = copy[i + 2] = value;
      copy[i + 3] = 255;
    }
    return { data: copy, width: pixels.width, height: pixels.height };
  }

  function readPixels(pixels) {
    for (const candidate of [pixels, threshold(pixels)]) {
      const found = window.jsQR(candidate.data, candidate.width, candidate.height,
        { inversionAttempts: 'attemptBoth' });
      if (found && found.data) return found.data;
    }
    return null;
  }

  /** One decode attempt: draw at a size, then read it two ways. */
  function decodeAt(source, width, height, crop) {
    const pixels = rasterise(source, width, height, crop);
    if (!pixels) return null;
    // Always attempt the read. The blank check only annotates a failure.
    const found = readPixels(pixels);
    if (!found && looksBlank(pixels)) decodeStill.blankDraws++;
    return found;
  }

  /**
   * Reads a still image every way worth trying, cheapest first.
   *
   * Whole-image renderings at a few sizes catch the ordinary case — jsQR
   * locates a code best when the modules are a few pixels across, so a
   * 12-megapixel photo often fails at native size and reads instantly at
   * 1600px. If none of those land, the code is probably a small part of a
   * bigger picture: a screenshot of a chat, a photo of a laptop screen across
   * the room. So the image is then walked as a grid of overlapping tiles, each
   * rendered large, which is the same thing as zooming in on each region.
   */
  function decodeStill(source, naturalWidth, naturalHeight, onProgress) {
    const report = onProgress || function () {};
    const longest = Math.max(naturalWidth, naturalHeight);
    decodeStill.attempts = 0;
    decodeStill.blankDraws = 0;

    const attempt = (width, height, crop) => {
      decodeStill.attempts++;
      report(decodeStill.attempts);
      return decodeAt(source, width, height, crop);
    };

    const tried = new Set();
    for (const target of [1600, 1100, 2400, 800, 600, longest]) {
      const scale = Math.min(1, target / longest);
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const key = width + 'x' + height;
      if (tried.has(key)) continue;
      tried.add(key);
      const found = attempt(width, height);
      if (found) return found;
    }

    // Overlapping thirds, each blown up to 1200px. Overlap matters: a code
    // straddling a tile boundary would be cut in half by a clean grid.
    const tileW = Math.round(naturalWidth / 2);
    const tileH = Math.round(naturalHeight / 2);
    const stepX = Math.round(naturalWidth / 4);
    const stepY = Math.round(naturalHeight / 4);
    for (let row = 0; row <= 2; row++) {
      for (let column = 0; column <= 2; column++) {
        const x = Math.min(column * stepX, Math.max(0, naturalWidth - tileW));
        const y = Math.min(row * stepY, Math.max(0, naturalHeight - tileH));
        const scale = Math.min(2, 1200 / Math.max(tileW, tileH));
        const found = attempt(Math.round(tileW * scale), Math.round(tileH * scale),
          { x, y, w: tileW, h: tileH });
        if (found) return found;
      }
    }
    return null;
  }

  function renderScan() {
    flash('#scan-alert', '');
    // Named for whoever this device belongs to, the way the profile page is.
    // There may be no profile yet on a device that was sent a link, so the
    // generic title in the markup stays the fallback.
    const who = state.profile && state.profile.card && state.profile.card.name;
    $('#scan-title').textContent = who ? who + '\u2019s Compatibility' : 'Your compatibility';
    $('#paste-input').value = '';
    $('#scan-status').textContent = '';
    $('#camera-holder').hidden = true;
    const history = store.read(KEYS.history, []);
    $('#scan-history').innerHTML = history.length
      ? '<div class="card"><h2>' + esc(TEXT.scanHistory) + '</h2>' + historyTable(history) + '</div>' : '';
    paintQrCanvas('#qr-canvas-scan');
    $('#qr-contents').innerHTML = qrContentsBlock(state.profile && state.profile.card);
  }

  function stopCamera() {
    if (scanTimer) { cancelAnimationFrame(scanTimer); scanTimer = null; }
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    const holder = $('#camera-holder');
    if (holder) holder.hidden = true;
  }

  $('#start-camera').addEventListener('click', async () => {
    flash('#scan-alert', '');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      flash('#scan-alert', 'This browser will not give the page a camera. Paste their link instead.');
      return;
    }
    // The default stream is often 640x480, which puts this code at about one
    // and a half pixels per module — unreadable. Ask for real resolution and
    // fall back only if the device refuses.
    const wanted = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(wanted);
    } catch (error) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (fallbackError) {
        flash('#scan-alert', 'Camera access was refused. Camera scanning also needs HTTPS or localhost. You can paste their link instead.');
        return;
      }
    }
    const video = $('#scan-video');
    video.srcObject = cameraStream;
    video.setAttribute('playsinline', 'true');
    await video.play();
    $('#camera-holder').hidden = false;
    $('#scan-status').textContent =
      'Looking for a code — fill as much of the frame with it as you can, and hold steady.';
    tick();
  });

  let zoomPass = false;

  function tick() {
    const video = $('#scan-video');
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
      const width = video.videoWidth;
      const height = video.videoHeight;

      // Full frame every tick; a zoomed middle every other tick, which is what
      // finds a code held too far away. Alternating keeps the frame rate up.
      let found = decodeAt(video, width, height);
      if (!found && (zoomPass = !zoomPass)) {
        const cropW = Math.round(width * 0.55);
        const cropH = Math.round(height * 0.55);
        found = decodeAt(video, cropW, cropH, {
          x: Math.round((width - cropW) / 2),
          y: Math.round((height - cropH) / 2),
          w: cropW,
          h: cropH,
        });
      }

      if (found) {
        stopCamera();
        runMatch(found).then(ok => {
          if (!ok) {
            flash('#scan-alert', 'That QR code is not a PsycheAI profile.');
            $('#scan-status').textContent = '';
          }
        });
        return;
      }
    }
    scanTimer = requestAnimationFrame(tick);
  }

  $('#upload-qr').addEventListener('click', () => $('#qr-file').click());
  $('#qr-file').addEventListener('change', async () => {
    const file = $('#qr-file').files[0];
    if (!file) return;
    flash('#scan-alert', '');
    $('#scan-status').textContent = 'Reading that image…';

    let source = null;
    try {
      // from-image honours EXIF rotation, so a portrait photo is not decoded
      // sideways. Not every browser supports the option, hence the retry.
      source = await createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(() => createImageBitmap(file));
    } catch (error) {
      $('#scan-status').textContent = '';
      const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
      flash('#scan-alert', heic
        ? 'That is an Apple HEIC image, which this browser cannot open. Share it as a JPEG, take a ' +
          'screenshot of it, or paste their link below.'
        : 'Could not open that image (' + (file.type || 'unknown type') + '). A JPEG or PNG works ' +
          'best — or paste their link below.');
      return;
    }

    const dimensions = source.width + '×' + source.height;
    // The tiling pass can take a second or two on a big photo, so say so.
    let found = null;
    try {
      found = decodeStill(source, source.width, source.height, attempts => {
        $('#scan-status').textContent = 'Reading that image… (' + attempts + ')';
      });
    } finally {
      source.close();
      $('#scan-status').textContent = '';
    }

    if (!found) {
      // The counts are here on purpose: they are the only thing that makes a
      // report of this actionable, and blank draws mean the browser refused to
      // rasterise rather than the code being absent.
      const detail = dimensions + ', ' + decodeStill.attempts + ' attempts' +
        (decodeStill.blankDraws ? ', ' + decodeStill.blankDraws + ' blank' : '');
      flash('#scan-alert', decodeStill.blankDraws >= decodeStill.attempts
        ? 'This browser would not open an image that big (' + detail + '). Try a smaller copy, or ' +
          'paste their link below.'
        : 'No QR code found in that image (' + detail + '). The surest fix is to paste their link ' +
          'instead — the box below takes it. If you would rather use the picture, crop it so the ' +
          'code fills most of the frame and include the white border around it.');
      return;
    }
    if (!(await runMatch(found))) {
      flash('#scan-alert', 'That is a QR code, but not a PsycheAI profile.');
    }
  });

  $('#paste-go').addEventListener('click', async () => {
    if (!(await runMatch($('#paste-input').value))) {
      flash('#scan-alert', 'That is not a PsycheAI profile code. Copy the whole link they sent you.');
    }
  });

  const MODE_LABELS = Copy.MODE_LABELS;
  const MODE_HEADINGS = {
    romantic: 'How to partner each other',
    platonic: 'How to be close to each other',
    professional: 'How to work with each other',
  };

  // A professional run carries a stance as well as a basis, and the stance
  // owns the heading — "How to work with each other" is wrong for someone who
  // manages the other person. Reports saved before stances existed have no
  // stance, so the mode heading stays the fallback.
  function playbookHeading(mode, stance, otherName) {
    const chosen = mode === 'professional' && Copy.WORK_STANCES[stance];
    return chosen ? Copy.stanceText(chosen.heading, otherName) : MODE_HEADINGS[mode];
  }

  // Ask which question to answer before spending a model call on it. Resolves
  // to a mode key, or null if they backed out.
  function askMode(otherName) {
    const dialog = $('#mode-dialog');
    $('#mode-dialog-sub').textContent =
      'You and ' + otherName + ' can be compared on any of these. Pick one.';

    return new Promise(resolve => {
      let answer = null;
      const choose = event => {
        answer = event.currentTarget.dataset.mode;
        dialog.close();
      };
      const buttons = dialog.querySelectorAll('.mode-option');
      for (const button of buttons) button.addEventListener('click', choose);

      const cancel = () => dialog.close();
      $('#mode-cancel').addEventListener('click', cancel);

      dialog.addEventListener('close', () => {
        for (const button of buttons) button.removeEventListener('click', choose);
        $('#mode-cancel').removeEventListener('click', cancel);
        resolve(answer);
      }, { once: true });

      // showModal traps focus and handles Escape; the fallback keeps the flow
      // alive on anything that does not support <dialog>.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open', ''); buttons[0].focus(); }
    });
  }

  // The second question, asked only when the first answer was "professional".
  // Managing someone, reporting to them and sitting beside them are three
  // different questions, and the model cannot infer which one from two cards.
  function askWorkStance(otherName) {
    const dialog = $('#stance-dialog');
    $('#stance-dialog-sub').textContent =
      'You picked work. How do you and ' + otherName + ' actually sit?';

    for (const button of dialog.querySelectorAll('.mode-option')) {
      const stance = Copy.WORK_STANCES[button.dataset.stance];
      if (!stance) continue;
      button.querySelector('.stance-option').textContent = Copy.stanceText(stance.option, otherName);
      button.querySelector('.stance-blurb').textContent = stance.blurb;
    }

    return new Promise(resolve => {
      let answer = null;
      const choose = event => {
        answer = event.currentTarget.dataset.stance;
        dialog.close();
      };
      const buttons = dialog.querySelectorAll('.mode-option');
      for (const button of buttons) button.addEventListener('click', choose);

      const cancel = () => dialog.close();
      $('#stance-cancel').addEventListener('click', cancel);

      dialog.addEventListener('close', () => {
        for (const button of buttons) button.removeEventListener('click', choose);
        $('#stance-cancel').removeEventListener('click', cancel);
        resolve(answer);
      }, { once: true });

      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open', ''); buttons[0].focus(); }
    });
  }

  async function runMatch(rawText) {
    if (!state.profile) return false;
    const other = await Card.decodeCard(Card.extractPayload(rawText));
    if (!other) return false;

    const mode = await askMode(other.name);
    // Backing out is not a failure to read the code — the caller must not fall
    // through to "no code found", so this still returns true. And the scan view
    // is shown as it stands rather than re-rendered: re-rendering clears the
    // paste box, so cancelling would throw away the link they just pasted and
    // make them find it again to pick a different basis.
    if (!mode) { show('scan'); return true; }

    // Backing out of the second question returns to the scan page the same way
    // backing out of the first does, rather than quietly assuming "colleagues"
    // — a wrong guess here produces a report aimed at the wrong person.
    let stance = null;
    if (mode === 'professional') {
      stance = await askWorkStance(other.name);
      if (!stance) { show('scan'); return true; }
    }

    $('#working-title').textContent = modelName() + ' is comparing you';
    $('#working-note').textContent =
      MODE_LABELS[mode] + ' compatibility. Two profile cards were sent — nothing else.';
    startElapsed('Assessing ' + state.profile.card.name + ' and ' + other.name);
    show('working');

    // Same reasoning as runAnalysis's own guard: this call runs for real time
    // with nothing else standing between a reader's back button and losing it.
    guardUnload(true);
    try {
      const result = await LLM.analyseCompatibility(state.profile.card, other, mode, stance);
      const report = { ...result.data, mode: result.data.mode || mode, stance };
      const history = store.read(KEYS.history, []);
      history.unshift({ when: new Date().toISOString(), withName: other.name, mode: report.mode, stance, report });
      store.write(KEYS.history, history.slice(0, 25));
      renderReport(report, other.name);
      show('report');
    } catch (error) {
      renderScan();
      show('scan');
      flash('#scan-alert', (error && error.message) || 'The comparison failed.');
    } finally {
      stopElapsed();
      guardUnload(false);
    }
    return true;
  }

  // ══════════════ 4. compatibility report ══════════════

  function renderReport(report, otherName, when) {
    const myName = state.profile ? state.profile.card.name : 'You';
    const mode = MODE_LABELS[report.mode] ? report.mode : 'romantic';
    const stance = report.stance;
    // The pill says which question was answered, and for a work run the basis
    // alone does not: "Professional / work" reads the same whether the reader
    // manages this person or reports to them.
    const stanceLabel = mode === 'professional' && Copy.WORK_STANCES[stance]
      ? Copy.stanceText(Copy.WORK_STANCES[stance].option, otherName) : '';

    // The title and the basis pills live in the static header rather than in
    // the rendered body, so the Download button can sit beside them the way it
    // does on the profile page.
    $('#report-title').textContent = myName + ' & ' + otherName;
    $('#report-sub').innerHTML =
      '<span class="pill pill-clear">' + esc(MODE_LABELS[mode]) + '</span> ' +
      (stanceLabel ? '<span class="pill pill-clear">' + esc(stanceLabel) + '</span> ' : '') +
      esc(TEXT.compatOneQuestion);
    // Kept for the PDF, which is built from whatever was last rendered.
    state.lastReport = { report, otherName, myName, mode, stance, when };

    let html = scoreCard(MODE_LABELS[mode], report);
    html += dimensionsCard(report);

    html += '<div class="card"><h2>' + esc(TEXT.compatShort) + '</h2>' +
      '<h3>' + esc(TEXT.compatUpside) + '</h3><p>' + esc(report.biggestUpside) + '</p>' +
      '<h3>' + esc(TEXT.compatRisk) + '</h3><p>' + esc(report.biggestRisk) + '</p>' +
      (report.sharedGround && report.sharedGround.length
        ? '<h3>' + esc(TEXT.compatCommon) + '</h3>' + tags(report.sharedGround) : '') +
      '</div>';

    html += '<div class="card good"><h2>' + esc(TEXT.compatWorks) + '</h2>' + points(report.strengths) + '</div>' +
      '<div class="card warn"><h2>' + esc(TEXT.compatRubs) + '</h2>' + points(report.frictions) + '</div>' +
      '<div class="card"><h2>' + esc(playbookHeading(mode, stance, otherName)) + '</h2><div class="playbook">' +
      '<div><h3>' + esc(TEXT.compatFor + myName) + '</h3>' + list(report.howToPartner.forA, 'ticks') + '</div>' +
      '<div><h3>' + esc(TEXT.compatFor + otherName) + '</h3>' + list(report.howToPartner.forB, 'ticks') + '</div>' +
      '</div><h3>' + esc(TEXT.compatBoth) + '</h3>' + list(report.howToPartner.together, 'ticks') + '</div>';

    if ((report.conversationStarters || []).length) {
      html += '<div class="card"><h2>' + esc(TEXT.compatTalk) + '</h2>' + list(report.conversationStarters) + '</div>';
    }

    html += '<p class="fineprint">' + esc(report.caveats) + '</p>';

    $('#report-body').innerHTML = html;
  }

  // One number for a whole pairing hides where the fit actually is, and a
  // reader cannot argue with it. These are the same bars the Big Five uses,
  // for the same reason: a score with its reasoning attached is checkable, and
  // a pair that is strong on values and poor on rhythms should look like it.
  function dimensionsCard(report) {
    const items = (report.dimensions || []).filter(d => d && d.name);
    if (!items.length) return '';
    return '<div class="card section-card"><h2>' + esc(TEXT.compatDimensions) + '</h2>' +
      '<p class="card-sub">' + esc(TEXT.compatDimensionsSub) + '</p>' +
      items.map(item => bar(item.name, item.score,
        (item.reading ? '<p class="trait-reading">' + esc(item.reading) + '</p>' : '') +
        evidence(item.evidence))).join('') +
      '</div>';
  }

  function scoreCard(label, report) {
    const value = Math.round(Number(report.score) || 0);
    const tier = value >= 80 ? 'a' : value >= 65 ? 'b' : value >= 50 ? 'c' : 'd';
    return '<div class="card score-card score-single tier-' + tier + '">' +
      '<div class="ring" style="--pct:' + value + '"><span>' + value + '</span></div>' +
      '<div><h2>' + esc(label + TEXT.compatSuffix) + '</h2>' +
      '<p class="band">' + esc(report.band) + '</p>' +
      '<p>' + esc(report.verdict) + '</p></div></div>';
  }

  // ══════════════ 5. server status & boot ══════════════

  function renderAbout() {
    $('#about-status').textContent = state.server.unreachable
      ? 'This page cannot reach the PsycheAI server right now.'
      : state.server.mock
        ? 'This server is running in mock mode — analyses are canned, and no API calls are made.'
        : state.server.ready
          ? 'This server is using ' + state.server.provider + ' · ' + state.server.model + '.'
          : 'This server has no model provider configured. ' + (state.server.hint || '');
  }

  function renderServerStatus() {
    if (state.server.mock) {
      flash('#server-status', 'Mock mode: this server returns canned analyses so you can click through the app. Nothing is sent to any model provider.');
    } else if (state.server.unreachable) {
      flash('#server-status', 'Cannot reach the PsycheAI server. Start it with "npm start".');
    } else if (!state.server.ready) {
      flash('#server-status', 'No model provider is configured, so the analysis will fail. ' +
        (state.server.hint || 'Set GEMINI_API_KEY or ANTHROPIC_API_KEY and restart.'));
    } else {
      flash('#server-status', '');
    }
  }

  // A shared link may arrive as a fresh page load or as a hash change in a tab
  // that already has PsycheAI open. Both have to work.
  async function consumeIncomingLink() {
    if (!/^#p=/.test(location.hash)) return false;
    const incoming = Card.extractPayload(location.hash);
    if (!incoming) return false;

    history.replaceState(null, '', location.pathname + location.search);
    if (state.profile && await runMatch(incoming)) return true;

    sessionStorage.setItem('psycheai_pending', incoming);
    showUploadError('Someone shared their PsycheAI code with you. Build your own profile and the comparison runs automatically.');
    return true;
  }

  window.addEventListener('hashchange', () => { consumeIncomingLink(); });

  async function boot() {
    state.server = await LLM.status();
    // The server owns this number; the constant above is only what applies
    // before status lands. Guarded rather than assigned blindly so an older
    // server that does not report it leaves the default in place instead of
    // setting the allowance to undefined and making every run look free.
    if (Number.isFinite(state.server.freeAnalyses)) freeAnalyses = state.server.freeAnalyses;
    renderServerStatus();

    if (await consumeIncomingLink()) return;
    if (state.profile) { renderProfile(); show('profile'); return; }
    show('welcome');
  }

  mountPremiumTiers();
  mountFreeTierNotes();
  boot();
})();
