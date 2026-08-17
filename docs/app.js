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

  const $ = sel => document.querySelector(sel);
  const KEYS = {
    profile: 'psycheai_profile',
    digest: 'psycheai_digest',
    history: 'psycheai_history',
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

  const state = {
    profile: store.read(KEYS.profile, null),
    digest: store.read(KEYS.digest, null),
    // In memory only, and only for as long as this page lives — see handleFiles.
    images: [],
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

  // The strongest and weakest of the five, named. Ties break on the fixed key
  // order, which is arbitrary but stable — the alternative is a card whose
  // "highest" trait changes between renders of the same report.
  function bigFiveEnds(bigFive) {
    const rows = Object.keys(TRAIT_LABELS)
      .map(key => ({ key, label: TRAIT_LABELS[key], score: (bigFive && bigFive[key] && bigFive[key].score) || 0 }))
      .filter(row => row.score > 0);
    if (!rows.length) return null;
    let high = rows[0];
    let low = rows[0];
    for (const row of rows) {
      if (row.score > high.score) high = row;
      if (row.score < low.score) low = row;
    }
    return high === low ? null : { high, low };
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
    esc(label) + '</p>';

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

  const CARD_BLURB_SENTENCES = 5;

  // The card's paragraph is a condensed version of one thing — the "Who you
  // are" section's own narrative (`report.summary`) — rather than a splice of
  // findings pulled from several sections. It stays positive-to-neutral by
  // construction rather than by scanning for negative words after the fact:
  // `report.summary` is written as the report's own affirming portrait (type,
  // traits, values, how they are to be close to and how they work), and this
  // never reaches into `relationship.weaknesses`, `career.weaknesses` or the
  // roast, which is where the report's critical material actually lives.
  function cardBlurb(report) {
    const summary = String((report && report.summary) || '').replace(/\s*\n+\s*/g, ' ').trim();
    const sentences = splitSentences(summary).slice(0, CARD_BLURB_SENTENCES);
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
    const ends = bigFiveEnds(report.bigFive);
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const confidence = Number(card.confidence);
    const hasConfidence = Number.isFinite(confidence) && confidence > 0;

    const letters = (mbti.letters || []).map(letter =>
      '<span class="pc-letter"><b>' + esc(letter.choice || '') + '</b>' +
      '<i>' + esc(letter.strength || '') + '</i></span>').join('');

    const enneagramLabel = enneagram.type
      ? esc(enneagram.type) + (enneagram.wing ? 'w' + esc(enneagram.wing) : '')
      : '';

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
          // The name under the letters rather than the four-letter code above
          // them: "The Protagonist" is the part a reader repeats, and the row
          // already spells the code out.
          (mbti.nickname ? '<p class="pc-sub pc-mbti-name">' + esc(mbti.nickname) + '</p>' : '') +
          '</div>' +
        (enneagramLabel ? '<div class="pc-stat">' + cardLab(CARD_ICONS.enneagram, TEXT.cardEnneagram) +
          '<p class="pc-big">' + enneagramLabel + '</p>' +
          (enneagram.nickname ? '<p class="pc-sub">' + esc(enneagram.nickname) + '</p>' : '') +
          '</div>' : '') +
        (ends ? '<div class="pc-stat">' + cardLab(CARD_ICONS.bigFive, TEXT.cardBigFive) +
          '<p class="pc-trait pc-hi">' + esc(ends.high.label) + ' <b>' + ends.high.score + '</b></p>' +
          '<p class="pc-trait pc-lo">' + esc(ends.low.label) + ' <b>' + ends.low.score + '</b></p>' +
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
  function sectionHead(icon, title, sub) {
    return '<div class="card-head"><span class="card-icon">' + icon + '</span>' +
      '<div><h2>' + title + '</h2>' +
      (sub ? '<p class="card-sub">' + sub + '</p>' : '') + '</div></div>';
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

  // The unsparing section, behind a cover the reader has to open.
  //
  // The text is NOT written into the markup here. Blurring it with CSS would
  // look the same and protect nothing: select-all copies it, a screen reader
  // reads it out, and view-source hands it over. Somebody who has decided not
  // to read this should not have it on their page at all, so the cover ships
  // alone and `revealBonus` injects the writing on the click.
  function bonusBlock(bonus) {
    if (!bonus) return '';
    // The badge is unescaped HTML spliced onto an already-escaped title —
    // sectionHead just concatenates whatever it is handed into the <h2>, so
    // this is the one call site that hands it a title with markup in it
    // rather than plain text, same trick .mode-title uses beside "Coming
    // soon" on the depth picker.
    const title = esc(TEXT.bonus) + ' <span class="mode-badge">' + esc(TEXT.bonusBadge) + '</span>';
    return '<div class="card section-card bonus-card">' +
      sectionHead('🕳️', title, esc(TEXT.bonusSub)) +
      '<div class="bonus-cover">' +
      '<h3>' + esc(TEXT.bonusCoverTitle) + '</h3>' +
      '<p class="fineprint">' + esc(TEXT.bonusCaveat) + '</p>' +
      '<button class="btn bonus-reveal" type="button" aria-expanded="false">' +
      esc(TEXT.bonusReveal) + '</button></div>' +
      '<div class="bonus-body" hidden></div></div>';
  }

  /** Fills a cover's sibling body with the writing it was hiding. */
  function revealBonus(cover, bonus) {
    const card = cover.closest('.bonus-card');
    const body = card.querySelector('.bonus-body');
    body.innerHTML =
      '<p class="fineprint bonus-caveat">' + esc(TEXT.bonusCaveat) + '</p>' +
      '<h3>' + esc(TEXT.bonusHarsh) + '</h3>' + paragraphs(bonus.harsh) +
      '<h3>' + esc(TEXT.bonusAdvice) + '</h3>' + paragraphs(bonus.advice) +
      '<button class="btn btn-ghost bonus-hide" type="button">' + esc(TEXT.bonusHide) + '</button>';
    body.hidden = false;
    cover.hidden = true;
  }

  /** Puts the cover back, and takes the writing out of the page with it. */
  function hideBonus(button) {
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
    for (const name of VIEWS) $('#view-' + name).hidden = name !== view;
    syncNav();
    // The psyche card is scaled from the width of the column it sits in, and a
    // hidden view measures zero — so a card rendered before its view was shown
    // would be scaled to nothing. Re-fit here, where the width is real.
    if (view === 'profile') layoutPsycheCard();
    window.scrollTo(0, 0);
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
      $('#sample-body').innerHTML = reportSectionsHtml(report, { bonus: false });
      $('#sample-body').scrollTop = 0;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
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
    $('#sample-body').innerHTML = '';
  });

  window.addEventListener('popstate', () => {
    if (!sampleDialog().open && !sampleDialog().hasAttribute('open')) return;
    closingFromHistory = true;
    sampleHistoryEntry = false;
    closeSample();
    closingFromHistory = false;
  });

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

  // Delegated, because the covers are written by innerHTML in two places — the
  // real report — the sample never renders this section at all, so a
  // `.bonus-reveal` can only belong to the reader's own report. The writing is
  // looked up from state rather than read out of the page, since the whole
  // point is that it was never put in the page.
  document.addEventListener('click', event => {
    const reveal = event.target.closest('.bonus-reveal');
    if (reveal) {
      const source = state.profile && state.profile.report;
      if (!source || !source.bonus) return;
      reveal.setAttribute('aria-expanded', 'true');
      revealBonus(reveal.closest('.bonus-cover'), source.bonus);
      return;
    }
    const hide = event.target.closest('.bonus-hide');
    if (hide) hideBonus(hide);
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
  function askSupplement(existing) {
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
    const showActions = () => {
      const has = Object.keys(added).length > 0;
      $('#supplement-continue').hidden = !has;
      $('#supplement-skip').hidden = has || busy;
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

      for (const button of buttons) button.addEventListener('click', choose);
      input.addEventListener('change', read);
      $('#supplement-skip').addEventListener('click', done);
      $('#supplement-continue').addEventListener('click', done);
      $('#supplement-back').addEventListener('click', goBack);

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
        resolve(cancelled ? null : added);
      }, { once: true });

      // Reset the dialog's own state, because it is reused markup and a second
      // upload in the same session would otherwise open on the last run's
      // error line, its instructions still unfolded, or Skip still hidden from
      // the run before.
      say('');
      cancelled = false;
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

  // Every run is Standard. The depth picker that used to sit here asked a
  // question with one available answer — Comprehensive has never been on sale
  // — so it cost a click and a decision to arrive back where the reader
  // started. The comprehensive *machinery* is untouched in digest.js and still
  // covered by the unit suite; only the UI that offered it is gone, and
  // Digest.build still records which depth built a digest.
  const DEPTH = 'standard';

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
  function askReview(digest, imageCount, getImages) {
    const dialog = $('#review-dialog');
    const list = $('#review-list');

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
          'No photos were selected from this export.'],
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
        chosenImages = Images.select(signals, { count: Digest.DEPTHS[DEPTH].images });

        setProgress(80, 'Building your evidence summary…');
        await new Promise(resolve => setTimeout(resolve, 30));
        digest = Digest.build(signals, {
          includeMessages: true, includeImages: true,
          imageCount: chosenImages.length, depth: DEPTH,
        });

        // Decode once at most, whoever asks first. The review's download
        // button may want the photographs before Send does; if it took them,
        // the extraction below reuses that result rather than putting the
        // reader through the slowest step in the app a second time. Reset on
        // each pass of the loop, because going Back can change the selection.
        extractedImages = null;
        decision = await askReview(digest, chosenImages.length, onProgress =>
          getExtractedImages(signals, chosenImages, onProgress));
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
    // The images are deliberately not persisted: a dozen JPEGs would blow the
    // localStorage quota, and keeping the user's photographs on disk is not
    // something to do as a side effect. A retry after a reload runs on the
    // digest alone.
    state.images = images;
    store.write(KEYS.digest, digest);
    await runAnalysis(digest, images);
  }

  // The waiting screen speaks as the product, not as whichever model the
  // server happens to be configured with. The provenance line at the foot of
  // the finished report still names the actual model that wrote it.
  function modelName() {
    return 'PsycheAI';
  }

  async function runAnalysis(digest, images) {
    const sent = (images || []).length;
    $('#working-title').textContent = modelName() + ' is reading your profile';
    $('#working-note').textContent =
      'A ' + Math.round((digest.coverage.digestChars || 0) / 1000) + 'KB summary' +
      (sent ? ' and ' + sent + ' of your photos were' : ' was') + ' sent for analysis. ' +
      'It usually takes up to three minutes for the personality analysis to be completed. ' +
      'Please be patient.';
    startElapsed('Analysing');
    show('working');

    try {
      const result = await LLM.analyseProfile(digest, images);
      const payload = await Card.encodeCard(result.data.card);
      state.profile = {
        report: result.data,
        card: Card.shape(result.data.card),
        payload,
        model: result.model,
        createdAt: new Date().toISOString(),
      };
      if (!store.write(KEYS.profile, state.profile)) {
        flash('#upload-error', 'Your profile was generated but is too large for this browser\'s storage, so it will not survive a reload.');
      }
      stopElapsed();

      const pending = sessionStorage.getItem('psycheai_pending');
      if (pending) {
        sessionStorage.removeItem('psycheai_pending');
        if (await runMatch(pending)) return;
      }
      renderProfile();
      show('profile');
    } catch (error) {
      stopElapsed();
      showUploadError((error && error.message) || 'The analysis failed.');
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
   * The roast is the one exception, since it is part of #profile-body rather
   * than sitting outside it: `{ bonus: false }` leaves it out of the string
   * entirely, the same "excluded by construction" reasoning as the controls
   * above, rather than a real report's writing merely being hidden from view.
   */
  function reportSectionsHtml(report, options) {
    const includeBonus = !options || options.bonus !== false;
    const head = sectionHead;

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

    // Relationships.
    const relationship = report.relationship;
    html += '<div class="card section-card">' + head('💞', esc(TEXT.relationships)) +
      '<div class="split"><div><h3 class="h-good">' + esc(TEXT.strengths) + '</h3>' + points(relationship.strengths) + '</div>' +
      '<div><h3 class="h-warn">' + esc(TEXT.weaknesses) + '</h3>' + points(relationship.weaknesses) + '</div></div>' +
      '<div class="callout"><h3>' + esc(TEXT.attachmentPrefix) + esc(relationship.attachment.style) + '</h3>' +
      '<p>' + esc(relationship.attachment.why) + '</p>' +
      ((relationship.attachment.derivedFrom || []).length
        ? '<p class="essence-label">' + esc(TEXT.readFrom) + '</p>' +
          '<p class="trait-evidence">' + relationship.attachment.derivedFrom
            .map(item => '<span class="ev">' + esc(item) + '</span>').join('') + '</p>'
        : '') +
      ((relationship.attachment.implications || []).length
        ? '<p class="essence-label">' + esc(TEXT.attachmentPractice) + '</p>' + points(relationship.attachment.implications)
        : '') +
      '<p class="fineprint">' + esc(relationship.attachment.caveat) + '</p></div>' +
      loveLanguageBlock(relationship.loveLanguages) + '</div>';

    // Career.
    const career = report.career;
    html += '<div class="card section-card">' + head('💼', esc(TEXT.work)) +
      '<div class="split"><div><h3 class="h-good">' + esc(TEXT.strengths) + '</h3>' + points(career.strengths) + '</div>' +
      '<div><h3 class="h-warn">' + esc(TEXT.weaknesses) + '</h3>' + points(career.weaknesses) + '</div></div>' +
      '<h3>' + esc(TEXT.howYouWork) + '</h3><p>' + esc(career.workStyle) + '</p>' +
      '<h3>' + esc(TEXT.thrive) + '</h3>' + list(career.environments, 'ticks') +
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

    // Below the behaviour section and above confidence, so the reader meets
    // every fair reading before the unkind one, and the confidence caveat
    // still gets the last word over all of it. Written about a made-up
    // account for a stranger who has not asked to see it, a roast reads as
    // just an insult rather than the thing it is on a real report, so the
    // sample leaves it out rather than showing it dressed as an example.
    if (includeBonus) html += bonusBlock(report.bonus);

    // Confidence closes the report rather than opening it: read after the
    // whole thing, it says how much of what you just read to believe.
    html += '<div class="card section-card confidence-card">' +
      head('🎯', esc(TEXT.trust), esc(TEXT.trustSub)) +
      '<div class="confidence-meter"><div class="confidence-fill" style="width:' + Math.round(report.confidence.score) + '%"></div></div>' +
      '<p><strong>' + esc(TEXT.trustScore) + Math.round(report.confidence.score) + '/100 (' + esc(report.confidence.level) + ').</strong> ' +
      esc(report.confidence.rationale) + '</p></div>';

    return html;
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

    const size = profile.payload.length;
    $('#payload-size').textContent = 'Shareable card: ' + size + ' characters' +
      (size > Card.COMFORTABLE_PAYLOAD ? ' — dense, so use the link if scanning is unreliable.' : '.') +
      ' Your full report is not included.';

    const cardHtml = psycheCardHtml(report);
    $('#psyche-card').innerHTML = cardHtml;
    $('#psyche-card-full').innerHTML = cardHtml;
    // Hidden rather than left empty on a report too old or too thin to fill it,
    // so the page never opens on a blank frame with a "tap to expand" label
    // under it.
    $('#psyche-card-section').hidden = !cardHtml;
    $('#psyche-card-title').textContent = TEXT.cardSection;
    $('#psyche-card-hint').textContent = TEXT.cardHint;
    $('#card-download').textContent = TEXT.cardDownload;
    layoutPsycheCard();

    $('#profile-body').innerHTML = reportSectionsHtml(report);

    // Sits after the action buttons rather than inside the report: it is a
    // record of the run, not a finding, and closing the page with it means
    // it stays true no matter what gets added between the report and the
    // buttons above it.
    $('#analysed-by').textContent = 'Analysed by ' + (profile.model || 'the model') + ' on ' +
      new Date(profile.createdAt).toLocaleString() + '.';
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
    return window.PsychePDF.build(profile.report, profile.card, {
      date: stamp.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      model: profile.model || '',
      // The page shows a matches section when this device has any, so the
      // report does too.
      history: store.read(KEYS.history, []),
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

  async function downloadCardImage(event) {
    const button = event.currentTarget;
    const label = button.textContent;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const blob = await cardImageBlob();
      if (!blob) throw new Error('empty');
      const name = 'psycheai-card-' +
        String((state.profile && state.profile.card && state.profile.card.name) || 'me')
          .toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '');
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = name + '.png';
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      button.textContent = 'Could not build the image';
      setTimeout(() => { button.textContent = label; }, 3000);
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
  $('#card-dialog-close').addEventListener('click', () => $('#card-dialog').close());
  // Clicking the backdrop closes it: the dialog element itself fills the screen,
  // so a click that lands on it rather than on the card is a click outside.
  $('#card-dialog').addEventListener('click', event => {
    if (event.target === $('#card-dialog')) $('#card-dialog').close();
  });
  window.addEventListener('resize', layoutPsycheCard);

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
    if (!window.confirm('Delete your profile, your evidence summary and all saved match reports from this browser?')) return;
    store.clearAll();
    state.profile = null;
    state.digest = null;
    state.images = [];
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

    try {
      const result = await LLM.analyseCompatibility(state.profile.card, other, mode, stance);
      stopElapsed();
      const report = { ...result.data, mode: result.data.mode || mode, stance };
      const history = store.read(KEYS.history, []);
      history.unshift({ when: new Date().toISOString(), withName: other.name, mode: report.mode, stance, report });
      store.write(KEYS.history, history.slice(0, 25));
      renderReport(report, other.name);
      show('report');
    } catch (error) {
      stopElapsed();
      renderScan();
      show('scan');
      flash('#scan-alert', (error && error.message) || 'The comparison failed.');
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
    renderServerStatus();

    if (await consumeIncomingLink()) return;
    if (state.profile) { renderProfile(); show('profile'); return; }
    show('welcome');
  }

  boot();
})();
