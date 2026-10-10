// PsycheAI SPA: upload → digest → model → profile → link → compatibility.
// All state lives in localStorage; the server holds nothing.
(function () {
  'use strict';

  const IG = window.PsycheInstagram;
  const Supplement = window.PsycheSupplement;
  const Digest = window.PsycheDigest;
  const Card = window.PsycheCard;
  const LLM = window.PsycheLLM;
  // The profile page and the PDF are two renderings of one document, so every
  // string and label they share comes from here rather than being written twice.
  const Copy = window.PsycheCopy;
  const TEXT = Copy.TEXT;
  // "Jared", from "Jared Tan": a friend is named by first name on their link.
  const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';
  // The friend's link a sync was started from, until it lands (adoptComparison).
  let syncingInvite = null;
  // Which page of the reader's own report is on screen once it is unlocked:
  // 'hub' (My Psyche: the card and what to do next) or 'report' (My Report:
  // Parts 00-04 and the roast). Structured layout only; see renderProfile.
  let profilePage = 'hub';
  const TRAIT_LABELS = Copy.TRAIT_LABELS;
  const LOVE_LANGUAGE_ICONS = Copy.LOVE_LANGUAGE_ICONS;
  const CARD_ICONS = Copy.CARD_ICONS;
  const axisLabel = Copy.axisLabel;
  // Prices in the reader's own currency where docs/prices.js has one — a
  // rounded local price in the major markets, USD everywhere else. The copy is
  // written in USD; each "US$5" and "US$2" in it becomes the local price once,
  // here, before anything is drawn, and the payment is taken in the same
  // currency (the server charges only the table's amount for it).
  const Prices = window.PsychePrices;
  const CURRENCY = Prices.currencyFor(Prices.guessCountry());
  (function localisePrices() {
    if (CURRENCY === Prices.DEFAULT_CURRENCY) return;
    const unlock = Prices.label(CURRENCY, 'unlock');
    const analysis = Prices.label(CURRENCY, 'analysis');
    const swap = text => text.replace(/US\$5\b/g, unlock).replace(/US\$2\b/g, analysis);
    const walk = node => {
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === 'string') node[key] = swap(value);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(Copy.TEXT);
    walk(Copy.STRUCTURED);
    document.querySelectorAll('[data-price]').forEach(node => {
      node.textContent = Prices.label(CURRENCY, node.getAttribute('data-price'));
    });
  })();

  const $ = sel => document.querySelector(sel);
  const KEYS = {
    profile: 'psycheai_profile',
    digest: 'psycheai_digest',
    // A second, wider digest that uploads used to build and keep beside the
    // standard one. Nothing writes it now — the premium read starts from the
    // standard digest (see premiumDigestFrom) — and one left over from an
    // older visit is removed at start-up. Listed so Delete everything does too.
    deepDigest: 'psycheai_digest_deep',
    history: 'psycheai_history',
    // Written the moment a payment clears and before the analysis is asked
    // for, so a reader who closes the tab, loses signal or runs out of battery
    // mid-generation comes back to "fetch what you paid for" rather than to a
    // price. It holds the authorisation, never the report: see the note on
    // `unlockReceipt` below. Listed here so `clearAll()` covers it — Delete
    // everything has to take the receipt with the report.
    unlock: 'psycheai_unlock',
    // The same idea as `unlock` above, for the two purchases it does not
    // cover. `unlock` works because premium sections are *detectably* missing:
    // a receipt with no paid sections beside it means the reader paid and
    // never collected. Neither of the other two products can be spotted that
    // way. A paid re-run that never landed leaves the previous report sitting
    // there looking complete, and a compatibility report that never landed
    // leaves nothing at all — so the fact that one was paid for has to be
    // written down before the call and cleared when it arrives.
    //
    // It holds the authorisation and the few things needed to ask again. Never
    // a report: this is the record of an unfinished purchase, not a cache.
    pending: 'psycheai_pending',
    // An analysis running on the server right now, by the key the server
    // handed back when it started.
    //
    // This is what turns "I closed the app" from a loss into a pause. The work
    // does not live in this tab any more — it lives on the server, which was
    // always true and used to be useless, because the only thing that knew how
    // to collect it was a closure inside a page that had just been discarded.
    // Written down, the next page to open picks the job back up and waits for
    // it, whether that is thirty seconds later or two hours.
    //
    // A key and a timestamp, and for a paid run the authorisation needed to
    // ask again if the server has forgotten. Never a report.
    job: 'psycheai_job',
    // Which actions in the structured report's development plan the reader has
    // ticked off, by a hash of the action's wording. Nothing but those hashes,
    // and it goes with Delete everything like the rest.
    plan: 'psycheai_plan',
    // Someone else's card, from a compatibility link opened before this reader had
    // one of their own. A friend who taps the link usually has no Instagram
    // export yet, and Instagram takes hours to email one, so the invite has to
    // outlive the tab: kept here for INVITE_DAYS and spent on the first
    // profile this device makes. It was in sessionStorage, which a closed tab
    // empties, and so lost almost every time.
    invite: 'psycheai_invite',
    // The campaign code in the address this reader arrived on (?via=ava), if
    // any, kept for VIA_DAYS so it survives the wait for an export. Sent with
    // the analysis and counted by the server as a daily total, never stored
    // there with anything else. See lib/stats.js.
    via: 'psycheai_via',
    // A promo code that came in the address (?promo=AVA), kept for
    // LINK_PROMO_DAYS so it survives the wait for an export, and applied when
    // the reader opens the full report's payment sheet. See linkPromo().
    linkPromo: 'psycheai_link_promo',
    // The invite-friends code: a random secret, and the public code in the
    // reader's links (the first 12 hex of the secret's SHA-256). See
    // lib/referral.js.
    referral: 'psycheai_referral',
    // The friend's code this browser arrived on (?ref=), for 60 days.
    referredBy: 'psycheai_referred_by',
    // A one-way code of this reader's Instagram username (SHA-256), so the
    // server can keep the free card to one per account without ever seeing
    // the username. Kept so a re-run after a reload still carries it.
    account: 'psycheai_account',
    // Which journey steps this browser has already reported today.
    steps: 'psycheai_steps',
    // The short personal link (lib/links.js): its lock key — which travels
    // only in the link, after the # — the id the server answered with, and
    // which card it was last saved for.
    link: 'psycheai_link',
    // A free full report someone gifted this reader (?gift=), and the gift
    // links this reader has made for others.
    gift: 'psycheai_gift',
    // Friends' links opened before the latest one, still waiting to sync.
    invitesMore: 'psycheai_invites_more',
    // The sync bar's ✕: the friends' links waiting when it was closed.
    syncBarClosed: 'psycheai_sync_bar_closed',
    gifts: 'psycheai_gifts_made',
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
    remove(key) { try { localStorage.removeItem(key); } catch (error) { /* nothing to drop */ } },
    clearAll() { for (const key of Object.values(KEYS)) localStorage.removeItem(key); },
  };
  store.remove(KEYS.deepDigest);

  // ---------- how many analyses this browser has already had ----------
  //
  // Deliberately NOT in KEYS, which is the whole point of it: `clearAll()`
  // iterates KEYS, so anything listed there is wiped by "Delete everything" —
  // and "delete everything, then upload again" was exactly the free way round
  // the allowance. Kept apart, with this comment, so nobody tidies it into
  // KEYS later and quietly reopens that door.
  //
  // What it is not: enforcement on its own. Clearing site data, a private
  // window or a different browser all reset it; what the server holds is one
  // free card per Instagram account (lib/referral.js), by a one-way code of
  // the username. The
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
    // The parsed Instagram export itself, in memory only and only for as long
    // as this page lives. It is what "Add / change data & re-run analysis"
    // needs to add a Google or Facebook export without asking for the
    // Instagram one again, and it is exactly the raw material this app's
    // privacy story says never touches a disk. A reload loses it, and the
    // re-run then asks for the archive back — see rerunWithAdditionalData.
    signals: null,
    server: { ready: false, mock: false, model: null },
  };

  // ---------- html helpers ----------

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Applies the styles that cannot be written as markup.
   *
   * Three things in this app are positioned from data rather than from CSS: a
   * trait bar's width, the confidence meter's width, and the compatibility
   * ring's --pct. All three used to travel as style="" attributes inside
   * generated HTML, and all three stopped working the moment the CSP dropped
   * 'unsafe-inline' from style-src — silently, because a refused inline style
   * is not an error. Removing this function and watching what happens is worth
   * doing once: the bars do not vanish, they all render *full*. Width falls
   * back to the fill's natural size inside its track, so every trait reads 100
   * next to a number saying 44, while the ring falls the other way — --pct
   * defaults to 0 and it draws empty next to a score of 66. Wrong in two
   * directions at once, and neither looks broken enough to notice.
   *
   * CSSOM writes are not governed by style-src, so the value rides over as a
   * data attribute and is applied here once the markup is in the document.
   * Anything that writes innerHTML which might contain one of these has to
   * call this afterwards, which is why the assignments go through setHtml
   * below rather than being written out individually.
   */
  function applyDataStyles(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-fill]').forEach(node => {
      node.style.width = Number(node.getAttribute('data-fill') || 0) + '%';
    });
    // The structured layout's bipolar bars place a band and a marker along the
    // track, which is a position rather than a width.
    scope.querySelectorAll('[data-left]').forEach(node => {
      node.style.left = Number(node.getAttribute('data-left') || 0) + '%';
    });
    scope.querySelectorAll('[data-pct]').forEach(node => {
      node.style.setProperty('--pct', String(Number(node.getAttribute('data-pct') || 0)));
    });
  }

  /** innerHTML, plus the styles that had to be left out of it. */
  function setHtml(element, html) {
    element.innerHTML = html;
    applyDataStyles(element);
    return element;
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
  function psycheCardHtml(report, options) {
    if (!report) return '';
    const own = Boolean(options && options.own);
    if (reportLayout() === 'structured') return psycheStoryHtml(report, own);
    const card = report.card || {};
    const cardName = card.name || '';
    const essence = report.essence || {};
    const name = essenceName(essence);
    const mbti = report.mbti || {};
    const bigFiveRows = bigFiveCardRows(report.bigFive);
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const confidence = Number(card.confidence);
    const hasConfidence = Number.isFinite(confidence) && confidence > 0;

    const letters = (mbti.letters || []).map(letter =>
      '<span class="pc-letter"><b>' + esc(letter.choice || '') + '</b>' +
      '<i>' + esc(letter.strength || '') + '</i></span>').join('');


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
        (name ? '<p class="pc-kicker">' + esc(TEXT.essenceLabel) + '</p>' +
        '<div class="pc-name"><span class="pc-icon" aria-hidden="true">' +
          esc(safeIcon(essence.icon)) + '</span><h2>' + esc(name) + '</h2></div>' : '') +
        (blurb ? '<p class="pc-blurb">' + esc(blurb) + '</p>' : '') +
      '</div>' +

      '<div class="pc-stats">' +
        // The type letters carry their own strengths, so the four-letter code
        // above them was the same information twice — the row below says ENFJ
        // and says how firmly each letter was picked.
        '<div class="pc-stat">' + cardLab(CARD_ICONS.type, TEXT.cardType) +
          (letters ? '<div class="pc-letters">' + letters + '</div>' : '') +
          '</div>' +
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
      // The reader's own card only: the QR code for their link (fillCardQr).
      (own ? '<div class="pc-qr-slot"></div>' : '') +
      '';
  }

  // ---------- the structured layout's card: one portrait canvas ----------
  //
  // 1080 x 1920, the size of a phone story, on screen and in the export alike,
  // so there is one card and one image rather than a layout that changes
  // shape with the screen. Read top to bottom the way a phone is held: who
  // you are most like, your three patterns, your type and your traits side by
  // side, what you stand for and what you are into, then how you give and
  // want care. Bars and rings are inline SVG with their sizes as attributes,
  // so the exported image draws them without the page's script.
  // The height, 1920, is fixed in the stylesheet (.psyche-card.pc-story).
  const STORY_W = 1080;

  function storyBar(value) {
    const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    return '<svg class="pc-sbar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect class="pc-sbar-track" width="100" height="10" rx="5"/>' +
      (v ? '<rect class="pc-sbar-fill" width="' + Math.max(6, v) + '" height="10" rx="5"/>' : '') + '</svg>';
  }

  function storyRing(value) {
    const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const c = 2 * Math.PI * 26;
    return '<svg class="pc-ring" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle class="pc-ring-track" cx="32" cy="32" r="26"/>' +
      '<circle class="pc-ring-fill" cx="32" cy="32" r="26" stroke-dasharray="' + (c * v / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 32 32)"/>' +
      '<text class="pc-ring-text" x="32" y="38" text-anchor="middle">' + v + '</text></svg>';
  }

  /**
   * The three motivators the summary card shows: the ones the free call
   * named, or for a report written before it named any, the three highest
   * of the paid report's ten.
   */
  function cardMotivators(report) {
    const known = Copy.STRUCTURED.motivators;
    const named = (report.topMotivators || []).filter(key => known[key]);
    if (named.length) return named.slice(0, 3);
    return ((report.motivators && report.motivators.scores) || []).filter(row => row && known[row.value])
      .slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(row => row.value);
  }

  function psycheStoryHtml(report, own) {
    const S = Copy.STRUCTURED;
    const card = report.card || {};
    const essence = report.essence || {};
    const name = essenceName(essence);
    const mbti = report.mbti || {};
    const five = report.bigFive || {};
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const patterns = signaturePatterns(report);
    const confidence = Number(card.confidence) || Number(report.confidence && report.confidence.score) || 0;
    const headline = String(card.headline || '').trim();
    // Two sentences on why they are like the character — what the structured
    // card call writes. A report from before that, with the four-sentence
    // portrait, shows its first two, which open on the same comparison.
    const blurb = splitSentences(cardBlurb(report)).slice(0, 2).join(' ');
    const emblem = Copy.emblemSvg(name, 'pc-emblem');
    // A full scene in place of the medallion, where the character has one.
    const art = Copy.characterArt(name, 'pc-art');
    // How firmly each letter was picked, in words: slight, moderate, clear.
    const strengthWord = strength => (strength
      ? '<span class="pc-sstrength pc-sstrength-' + esc(strength) + '">' + esc(strength) + '</span>' : '');
    const standFor = titlesOf(report.values, 3).concat(titlesOf(report.beliefs, 1)).slice(0, 4);
    const into = titlesOf(report.interests, 3);
    const motives = cardMotivators(report);
    const chips = list => '<div class="pc-schips">' + list.map(item => '<span>' + esc(item) + '</span>').join('') + '</div>';
    const loveList = side => (side || []).slice(0, 2).filter(l => l && l.language).map(l =>
      '<li><span aria-hidden="true">' + esc(LOVE_LANGUAGE_ICONS[l.language] || '💗') + '</span>' + esc(l.language) + '</li>').join('');
    const label = (icon, text) => '<p class="pc-slab"><span aria-hidden="true">' + esc(icon) + '</span>' + esc(text) + '</p>';

    return '<div class="pc-story-in">' +
      '<div class="pc-stop">' +
        '<span class="pc-brand">' + brandMarkSvg('pc-brand-mark') + '<span>PsycheAI</span></span>' +
        (card.name ? '<span class="pc-sowner">' + esc(card.name) + '</span>' : '<span></span>') +
        (confidence ? '<span class="pc-sconf" title="' + esc(TEXT.cardConfidence) + '">' + storyRing(confidence) + '</span>' : '<span></span>') +
      '</div>' +
      '<div class="pc-shero' + (art ? ' pc-has-art' : '') + '">' + art +
        // A card shared by a long link carries no character (see cardFace).
        (name ? '<p class="pc-skicker">' + esc(TEXT.essenceLabel) + '</p>' +
        '<div class="pc-sname">' + (art ? '' : '<span class="pc-smedal" aria-hidden="true">' + (emblem || esc(safeIcon(essence.icon))) + '</span>') +
          '<div><h2>' + esc(name) + '</h2>' + (essence.franchise ? '<p class="pc-sfranchise">' + esc(essence.franchise) + '</p>' : '') +
          '</div></div>' : '') +
        (headline ? '<p class="pc-sheadline">' + esc(headline) + '</p>' : '') +
        (blurb ? '<p class="pc-sblurb">' + esc(blurb) + '</p>' : '') +
      '</div>' +
      // The patterns by name on the left, what motivates them on the right.
      ((patterns.length || motives.length) ? '<div class="pc-sgrid">' +
        (patterns.length ? '<div class="pc-spanel">' + label(CARD_ICONS.patterns, TEXT.cardPatterns) +
          '<ol class="pc-spatterns">' + patterns.map(p =>
            '<li class="pc-pat-' + esc(p.id) + '"><span class="pc-snum">' + esc(patternNumber(p.id)) + '</span>' +
            '<b>' + esc(p.name) + '</b></li>').join('') + '</ol></div>' : '') +
        (motives.length ? '<div class="pc-spanel">' + label(CARD_ICONS.motivators, S.titles.motivators) +
          '<ol class="pc-smotives">' + motives.map(key =>
            '<li><span class="pc-snum">' + (motives.indexOf(key) + 1) + '</span><b>' + esc(S.motivators[key].label) + '</b></li>').join('') +
          '</ol></div>' : '') +
      '</div>' : '') +
      '<div class="pc-sgrid">' +
        '<div class="pc-spanel">' + label(CARD_ICONS.type, TEXT.cardType) +
          '<ul class="pc-sletters">' + (mbti.letters || []).map(l => {
            const pole = axisLabel(l.choice, l.axis);
            return '<li><b>' + esc(l.choice || '') + '</b><span>' + esc(pole.name) + '</span>' + strengthWord(l.strength) + '</li>';
          }).join('') + '</ul></div>' +
        '<div class="pc-spanel">' + label(CARD_ICONS.bigFive, TEXT.cardBigFive) +
          // Four traits: extraversion is the E/I letter beside it.
          '<ul class="pc-straits">' + Object.keys(TRAIT_LABELS).filter(t => five[t] && t !== 'extraversion').map(t =>
            '<li><span class="pc-strait">' + esc(S.cardTraitShort[t] || TRAIT_LABELS[t]) + '</span>' +
            storyBar(five[t].score) + '<b>' + Math.round(Number(five[t].score) || 0) + '</b></li>').join('') + '</ul></div>' +
      '</div>' +
      '<div class="pc-sgrid">' +
        (standFor.length ? '<div class="pc-spanel">' + label(CARD_ICONS.values, S.cardStandFor) + chips(standFor) + '</div>' : '') +
        (into.length ? '<div class="pc-spanel">' + label(CARD_ICONS.interests, S.cardInto) + chips(into) + '</div>' : '') +
      '</div>' +
      // Receiving and giving in one panel, read across: the comparison is
      // the point, and two boxes for four short lines looked empty.
      '<div class="pc-spanel pc-slove-panel">' +
        '<div>' + label(CARD_ICONS.loveIn, TEXT.cardLoveIn) + '<ul class="pc-slove">' + loveList(love.receiving) + '</ul></div>' +
        '<div>' + label(CARD_ICONS.loveOut, TEXT.cardLoveOut) + '<ul class="pc-slove">' + loveList(love.giving) + '</ul></div>' +
      '</div>' +
      // On the reader's own card the foot carries the QR code for their link
      // once it is saved (fillCardQr), and the line moves in beside it.
      (own ? '<div class="pc-qr-slot"></div>' : '') +
      '<p class="pc-sfoot">' + esc(S.cardFooter) + '</p>' +
      '</div>';
  }

  // ---------- the QR code on the reader's own card ----------
  //
  // The reader's one link, so any copy of their card — the image posted to a
  // story, a screenshot of a screenshot — leads back to it: scanning it opens
  // what tapping the link does, and counts as their invite. The short link
  // only. A long one is ~800 characters, far too dense to scan, so without
  // a short link there is no code. Drawn as SVG squares, so the exported
  // image carries it crisp at any size.
  function cardQrSvg(url) {
    try {
      const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      const cells = qr.modules.data;
      let d = '';
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) if (cells[y * size + x]) d += 'M' + x + ' ' + y + 'h1v1h-1z';
      }
      const box = size + 4;
      return '<svg class="pc-qr" viewBox="-2 -2 ' + box + ' ' + box + '" shape-rendering="crispEdges" ' +
        'role="img" aria-label="' + esc(TEXT.cardQrLabel) + '">' +
        '<rect x="-2" y="-2" width="' + box + '" height="' + box + '" fill="#ffffff"/>' +
        '<path fill="#241a2e" d="' + d + '"/></svg>';
    } catch (error) {
      return '';
    }
  }
  const SHORT_LINK = /^https?:\/\/[^/]+\/c\/[A-Za-z0-9_-]{10}#[A-Za-z0-9_-]{16}$/;
  /** Puts the reader's QR code in their card's foot, or takes it out when there is no short link. */
  function fillCardQr() {
    const url = SHORT_LINK.test(shortLink) ? shortLink : '';
    const svg = url ? cardQrSvg(url) : '';
    for (const card of [$('#psyche-card'), $('#psyche-card-full')]) {
      const slot = card && card.querySelector('.pc-qr-slot');
      if (!slot) continue;
      slot.innerHTML = svg ? svg + '<div class="pc-qr-text"><p class="pc-qr-call">' + esc(TEXT.cardQrCall) + '</p>' +
        '<p class="pc-qr-site">' + esc(Copy.STRUCTURED.cardFooter) + '</p></div>' : '';
      card.classList.toggle('pc-has-qr', Boolean(svg));
    }
  }

  // Scale-to-fit, measured rather than assumed: the card is laid out at
  // CARD_W x CARD_H and shrunk by whichever axis runs out first, so it lands
  // whole on a phone and on a laptop without a scrollbar on either.
  /**
   * The story is a fixed 1080 x 1920, and a report with long pattern names or
   * many chips can run past it. Rather than clip, the contents are scaled down
   * just enough to fit — on screen and, since the clone carries the inline
   * style, in the exported image too.
   */
  // The same card markup goes into more than one place (the page and its full
  // screen copy), and a character's scene finds its gradients by id. Two
  // copies would share them, and a browser that resolves the id to the copy
  // in a closed dialog draws the art with nothing. Each inserted copy gets
  // ids of its own.
  let artCopies = 0;
  function freshArtIds(root) {
    if (!root) return;
    for (const svg of root.querySelectorAll('svg.pc-art')) {
      svg.innerHTML = svg.innerHTML.replace(/pc-art-[a-z0-9]+(?=-)/g, 'pc-art-c' + (++artCopies));
    }
  }

  function fitStoryContent(el) {
    const inner = el.querySelector('.pc-story-in');
    if (!inner) return;
    inner.style.transform = '';
    inner.style.width = '';
    inner.style.height = '';
    // A card stretched taller than the story (full screen on a tall phone,
    // fitGuidedCard) may draw its contents larger, up to this, rather than
    // leave the extra height empty.
    const grow = Number(el.dataset.grow) || 1;
    if (!inner.clientHeight || (grow <= 1 && inner.scrollHeight <= inner.clientHeight + 1)) return;
    // A search rather than one division: scaling widens the box the text
    // wraps in, so the content gets shorter as it gets smaller, and a single
    // ratio over-shrinks it and leaves the foot of the story empty. Eight
    // halvings land within a fraction of a percent of the largest scale that
    // still fits.
    const apply = r => {
      inner.style.transformOrigin = 'top left';
      inner.style.transform = 'scale(' + r.toFixed(4) + ')';
      inner.style.width = (100 / r).toFixed(3) + '%';
      inner.style.height = (100 / r).toFixed(3) + '%';
      return inner.scrollHeight <= inner.clientHeight + 1;
    };
    let lo = 0.5;
    let hi = 1;
    if (grow > 1 && apply(1)) { lo = 1; hi = grow; }
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (apply(mid)) lo = mid; else hi = mid;
    }
    apply(lo);
  }

  function fitCard(el, availableWidth, availableHeight, options) {
    if (!el) return;
    // `narrow` is about the shape of the *screen*, not of the box the card is
    // being fitted into, so the height-capped inline preview must not trip it.
    // The structured layout's card is one fixed portrait canvas, the same on
    // every screen and in the export, so it never switches to the narrow form.
    const story = reportLayout() === 'structured';
    el.classList.toggle('pc-story', story);
    const narrow = !story && options === 'screen' &&
      availableWidth / availableHeight < NARROW_ASPECT;
    el.classList.toggle('pc-narrow', narrow);
    const width = story ? STORY_W : narrow ? CARD_W_NARROW : CARD_W;
    el.style.width = width + 'px';
    if (story) fitStoryContent(el);
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
    // The structured layout draws the catalogue character's emblem; anything
    // else keeps its emoji.
    const emblem = reportLayout() === 'structured' ? Copy.emblemSvg(name, 'essence-emblem') : '';
    return '<div class="essence">' +
      '<span class="essence-icon' + (emblem ? ' has-emblem' : '') + '" role="img" aria-label="' + esc(name) + '">' +
      (emblem || esc(safeIcon(essence.icon))) + '</span>' +
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
    return '<div><h3>' + title + '</h3>' + (blurb ? '<p class="muted love-blurb">' + blurb + '</p>' : '') +
      rows.map(item =>
        '<div class="love-row love-' + esc(item.strength || 'secondary') + '">' +
        '<span class="love-icon">' + (LOVE_LANGUAGE_ICONS[item.language] || '💗') + '</span>' +
        '<div><h4>' + esc(item.language) +
        '<span class="pill pill-' + esc(item.strength || 'secondary') + '">' + esc(item.strength || '') + '</span></h4>' +
        '<p>' + esc(item.inPractice) + '</p>' +
        '<p class="love-why">' + esc(item.why) + '</p></div></div>').join('') + '</div>';
  }

  function loveLanguageBlock(languages, options) {
    if (!languages) return '';
    const withCaveat = !options || options.caveat !== false;
    // The structured layout's boxes need no line under each heading saying what it means.
    const blurbs = !options || options.blurbs !== false;
    const columns =
      loveLanguageColumn(TEXT.loveReceiving, blurbs ? TEXT.loveReceivingBlurb : '', languages.receiving) +
      loveLanguageColumn(TEXT.loveGiving, blurbs ? TEXT.loveGivingBlurb : '', languages.giving);
    if (!columns) return '';
    return '<h3 class="love-head">' + esc(TEXT.loveHead) + '</h3><div class="split love-split">' + columns + '</div>' +
      (withCaveat && languages.caveat ? '<p class="fineprint">' + esc(languages.caveat) + '</p>' : '');
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
  // `result` is the structured layout's one-line takeaway, shown in the head
  // so a shut section still says what it found. The classic layout never
  // passes one, so its heads are unchanged.
  function sectionHead(icon, title, sub, collapsible, result) {
    const chevron = '<span class="card-chevron" aria-hidden="true"></span>';
    return '<div class="card-head' + (collapsible ? ' card-head-toggle' : '') + '">' +
      '<span class="card-icon">' + icon + '</span>' +
      '<div><h2>' +
      (collapsible
        ? '<button class="card-toggle" type="button" aria-expanded="true">' +
          '<span class="card-toggle-text">' + title + '</span>' + chevron + '</button>'
        : title) +
      '</h2>' +
      (sub ? '<p class="card-sub">' + sub + '</p>' : '') +
      (result ? '<p class="card-result">' + result + '</p>' : '') + '</div></div>';
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
      if (card) setSectionOpen(card, card.hasAttribute('data-start-open'));
    }
  }

  function setSectionOpen(card, open) {
    card.classList.toggle('is-collapsed', !open);
    const toggle = card.querySelector('.card-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  // What the compatibility link actually carries — the compact card, not the
  // full report. Lives on the compatibility page rather than the profile
  // page: it is about the link someone is about to send or has just sent,
  // which is the context that page is for.
  function linkContentsBlock(card) {
    if (!card) return '';
    // The fields, named; not this reader's own values.
    return '<div class="link-contents-card"><p class="link-fields-label">' + esc(TEXT.linkContents) + '</p>' +
      '<ul class="link-fields">' + TEXT.linkContentsFields.map(field => '<li>' + esc(field) + '</li>').join('') + '</ul></div>';
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
  function attachmentBodyHtml(source) {
    const attachment = gentleAttachmentOf(source);
    return '<div class="callout"><h3>' + esc(TEXT.attachmentPrefix) + esc(attachment.style) + '</h3>' +
      // What the style is good at, directly under the name of it. Deliberately
      // first: the four names carry a lot of received meaning, and a reader who
      // has just been told they are anxious or fearful-avoidant reads the next
      // paragraph through whatever they already believe that means. One warm,
      // specific sentence in that position does more for how the section lands
      // than any amount of care further down. Optional, so a report generated
      // before this field existed still renders.
      (attachment.styleTone ? '<p class="attachment-tone">' + esc(attachment.styleTone) + '</p>' : '') +
      '<p>' + esc(attachment.why) + '</p>' +
      (attachment.conflict ? '<p class="essence-label">' + esc(TEXT.attachmentConflict) + '</p><p>' + esc(attachment.conflict) + '</p>' : '') +
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

  // ---------- the paywall: four sections behind one US$5 unlock ----------
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
  /** The sample's own premium sections (sample.json), shown as a paid report shows them. */
  function sampleUnlocked(report) {
    return unlockedSections({ premiumAnalysis: report && report.premiumAnalysis });
  }

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

  // ---------- the card is free; the explanation of it is paid for ----------
  //
  // A free run returns the summary card and nothing else: the type, the
  // scores, the character, the lists — the conclusions — with none of the
  // writing that explains them. Every explanation is part of the US$5 unlock,
  // written by a second call that is handed the card and told to explain it
  // rather than to decide it again (server.js's handleAnalyse, `anchor`).
  //
  // The same rule as PAID_SECTIONS above applies, and for the same reason:
  // the explanations are not in the page before they are bought because the
  // server never wrote them. There is nothing behind the locked block to
  // view-source.

  /**
   * Whether this profile carries the written report, not just its card.
   *
   * `explained` is set when a bought full report is adopted. The second test is
   * for a profile saved before the card was split from its explanation, when
   * every free run returned the whole report: that reader has the writing
   * already, and taking it away from them on a reload would be a strange way
   * to introduce a paywall.
   */
  function hasExplanations(profile) {
    if (!profile || !profile.report) return false;
    if (profile.explained) return true;
    return typeof profile.report.summary === 'string' && profile.report.summary.trim().length > 0;
  }

  /**
   * The full report, with the card's conclusions laid back over it.
   *
   * The second call is told to keep every one of them, and nearly always does.
   * This is what makes "nearly" into "always" for the parts the reader has
   * already seen and may already have shared: the type, the letters, the
   * scores, the character and the order of the lists on the card. The writing
   * underneath is the full report's own — only the labels are pinned.
   */
  function overlayCard(full, card) {
    if (!card) return full;
    const out = JSON.parse(JSON.stringify(full));
    out.essence = Object.assign({}, out.essence, {
      character: (card.essence || {}).character || (out.essence || {}).character,
      franchise: (card.essence || {}).franchise || (out.essence || {}).franchise,
      icon: (card.essence || {}).icon || (out.essence || {}).icon,
    });
    if (card.cardHighlights) out.cardHighlights = card.cardHighlights;
    if ((card.topMotivators || []).length) out.topMotivators = card.topMotivators;
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
        return Object.assign({ line: pinned.line }, written, { id: pinned.id, name: pinned.name });
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

  /**
   * Take delivery of a bought full report.
   *
   * `replaceCard` is for the one case where the card should move: the reader
   * added a source on the way to paying, so the full report was written from
   * more evidence than the card was, without an anchor, and its own
   * conclusions are the better ones. Otherwise the card stays exactly as it
   * was — its QR payload included — and the writing is laid under it.
   */
  // The four premium sections arrive in the same response as the written
  // report, and are filed apart from it — under `premiumAnalysis`, where
  // PAID_SECTIONS, unlockedSections and the PDF have always looked for them.
  const PREMIUM_KEYS = ['wellness', 'attachment', 'idealPartner', 'careerAssessment'];

  async function adoptFullReport(result, replaceCard, savedName, readFrom) {
    if (!state.profile) return;
    // How much of each source the full report actually read: the premium read
    // when data was added at the unlock (WhatsApp at its full share, where the
    // standard digest beside it holds only a few lines), or nothing to say
    // when it read the standard digest itself. See readView.
    if (readFrom !== undefined) {
      if (readFrom) state.profile.readFrom = readFrom;
      else delete state.profile.readFrom;
    }
    const written = withOwnName(Object.assign({}, result.data), ownNameFrom(savedName));
    const premium = {};
    for (const key of PREMIUM_KEYS) {
      if (written[key]) premium[key] = written[key];
      delete written[key];
    }
    if (Object.keys(premium).length) {
      state.profile.premiumAnalysis = premium;
      state.profile.premiumModel = result.model || '';
      state.profile.premiumAt = new Date().toISOString();
    }
    // A structured report written without a card to anchor it decides the
    // card first and sends it back beside the report, which then leaves out
    // everything the card pins — so the card is laid over it here, the same
    // as on the ordinary path. See cardThenFull in server.js.
    const freshCard = written.freeCard || null;
    delete written.freeCard;
    result = Object.assign({}, result, { data: written });
    if (replaceCard) {
      let cardFields = Object.assign({}, (freshCard || result.data).card);
      if (isPlaceholder(cardFields.name) && ownNameFrom(savedName)) cardFields.name = ownNameFrom(savedName);
      state.profile.report = freshCard ? overlayCard(result.data, freshCard) : result.data;
      cardFields = cardFieldsFrom(cardFields, state.profile.report);
      if (freshCard) state.profile.freeReport = freshCard;
      state.profile.card = Card.shape(cardFields);
      state.profile.payload = await Card.encodeCard(cardFields);
      state.profile.model = result.model;
      state.profile.createdAt = new Date().toISOString();
    } else {
      const card = state.profile.freeReport || state.profile.report;
      state.profile.freeReport = card;
      state.profile.report = overlayCard(result.data, card);
    }
    state.profile.explained = true;
    store.write(KEYS.profile, state.profile);
  }

  /**
   * The reader's proof that they already paid, kept on their device.
   *
   * The paid call takes minutes, and until now everything about it lived in
   * one page's memory: close the tab while it ran and the payment was real,
   * the analysis was gone, and the cover was back to asking for US$5. The
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

  /**
   * Record a purchase whose result has not arrived yet.
   *
   * Written *before* the call and cleared when the result is in hand, which is
   * the only ordering that survives the case it exists for: a phone closed,
   * backgrounded or out of battery during the minutes a generation takes. A
   * record written on success would be written exactly when nobody needs one.
   *
   * `kind` is 'analysis' or 'compatibility'. `context` carries whatever asking
   * again requires — for a comparison, the other person's card and the basis
   * chosen, since neither is stored anywhere else.
   */
  function rememberPending(kind, auth, context) {
    store.write(KEYS.pending, { kind, auth, at: Date.now(), ...(context || {}) });
  }

  function clearPending() {
    store.remove(KEYS.pending);
  }

  /**
   * Write down a generation that is running on the server right now.
   *
   * `kind` says what the result is, because collecting one is not the same as
   * collecting another: a free report replaces the profile wholesale, paid
   * sections attach to the profile already on screen, and a compatibility read
   * renders a comparison and belongs to no profile at all. A single resume
   * path that guessed would eventually put one in the place of another.
   *
   * `context` carries whatever the collecting step needs and cannot rebuild —
   * for a comparison, the other person's card and the basis it was run on,
   * which exist nowhere else once the tab is gone.
   *
   * Only ever keys, kinds and small context: never a report, and never a
   * digest, which is already stored under its own key and is far too big to
   * want a second copy of in a quota this app has already run up against.
   */
  /**
   * The reader's real Instagram handle, while the archive that carries it is
   * still in memory.
   *
   * Read from `state.signals` rather than from the stored digest, because the
   * digest no longer has it — Digest.build replaces it with a placeholder
   * before anything is sent. This is only ever used to scrub it out of a
   * supplement being merged in; it never travels anywhere itself.
   */
  function ownHandle() {
    return (state.signals && state.signals.profile && state.signals.profile.username) || '';
  }

  /** What to call the reader on their own card, from the archive rather than the digest. */
  function ownDisplayName() {
    const profile = (state.signals && state.signals.profile) || {};
    return String(profile.name || profile.username || '').trim();
  }

  // The reader's name and handle reach the model as this placeholder and never
  // as themselves (docs/digest.js). Whatever comes back carrying it is given the
  // real name here, on the device, before it is stored, shown, put in a QR code
  // or printed: the card's name, the page's "…'s psyche", the PDF's header, and
  // any stray mention in the writing.
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
  // The real name from wherever it can still be had: the archive in memory, the
  // job record written when the work started (for a page that rejoined it), or
  // the card the reader already has, if that one was named properly.
  function ownNameFrom(saved) {
    const card = state.profile && state.profile.card;
    return ownDisplayName() || String(saved || '').trim() || (card && !isPlaceholder(card.name) ? String(card.name || '').trim() : '');
  }

  /**
   * Puts the real name back on a profile stored before this was fixed: a card
   * replaced by a paid report said "PsycheUser", and so did the page and PDF
   * headers. The name is gone from what was stored, so this waits for the
   * archive to be read again on this device, then mends the card, its QR code
   * and the writing in place, without running anything again.
   */
  async function repairOwnName(signals) {
    const own = (signals && signals.profile) || {};
    const real = String(own.name || own.username || '').trim() || ownDisplayName();
    const profile = state.profile;
    if (!real || !profile || !/PsycheUser/.test(JSON.stringify(profile))) return;
    for (const key of ['report', 'freeReport', 'premiumAnalysis']) {
      if (profile[key]) profile[key] = withOwnName(profile[key], real);
    }
    const cardFields = cardFieldsFrom(withOwnName(Object.assign({}, (profile.report && profile.report.card) || profile.card), real), profile.report);
    if (isPlaceholder(cardFields.name)) cardFields.name = real;
    profile.card = Card.shape(cardFields);
    profile.payload = await Card.encodeCard(cardFields);
    store.write(KEYS.profile, profile);
    if (!$('#view-profile').hidden) renderProfile();
  }

  function rememberJob(key, kind, auth, context) {
    const ownName = ownNameFrom();
    store.write(KEYS.job, {
      key,
      kind: kind || 'analysis',
      auth: auth || null,
      at: Date.now(),
      // So a page that rejoins this job, with the archive no longer in memory,
      // can still give the card its real name (see withOwnName).
      ...(ownName ? { ownName } : {}),
      ...(context || {}),
    });
  }

  function clearJob() {
    store.remove(KEYS.job);
  }

  /**
   * The job still worth rejoining, if there is one.
   *
   * Bounded by the server's own result window rather than by a guess: past it
   * the server has forgotten the job, and an offer to rejoin one would sit
   * there polling for something that no longer exists. Kept a little under
   * four hours so the browser gives up slightly before the server does, which
   * is the right way round — a page that stops looking is a page that offers
   * the reader a button, and a page that keeps looking at nothing is a
   * spinner that never ends.
   */
  const JOB_WINDOW_MS = 3.5 * 60 * 60 * 1000;
  function runningJob() {
    const saved = store.read(KEYS.job, null);
    if (!saved || typeof saved !== 'object' || typeof saved.key !== 'string' || !saved.key) return null;
    if (!(Date.now() - Number(saved.at || 0) < JOB_WINDOW_MS)) {
      clearJob();
      return null;
    }
    return saved;
  }

  /**
   * The unfinished purchase, if there is one and it is still redeemable.
   *
   * Bounded by the payment's own life rather than by a guess: verifyPaid stops
   * honouring an intent thirty days after it was created, so an offer to
   * collect something older than that would fail at the server having promised
   * at the browser. A promo run carries no payment and no such limit, but the
   * same window is applied — an offer to finish something from six weeks ago
   * is confusing whether or not it would work.
   */
  const PENDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  function pendingWork() {
    const saved = store.read(KEYS.pending, null);
    if (!saved || typeof saved !== 'object' || !saved.kind || !saved.auth) return null;
    if (!(Date.now() - Number(saved.at || 0) < PENDING_WINDOW_MS)) {
      clearPending();
      return null;
    }
    return saved;
  }

  /** True once there is something to fetch but nothing fetched yet. */
  function hasUnfetchedUnlock() {
    // Either half of the purchase still owed: the written report behind the
    // card, or the four sections after it.
    return Boolean(unlockReceipt()) &&
      (!Object.keys(paidAnalysis()).length || !hasExplanations(state.profile));
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
  // "buy this" and "collect what you bought", and showing US$5 to somebody
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
    // `flat` is the structured layout's: a section inside a part, so no
    // toggle of its own and no Premium badge on its heading.
    const flat = Boolean(options && options.flat);
    const badge = flat ? '' : ' <span class="mode-badge">' + esc(TEXT.premiumBadge) + '</span>';
    return '<div class="card section-card paid-card ' + section.cardClass +
      '" data-paid="' + esc(section.key) + '">' +
      sectionHead(section.icon, esc(options && options.title ? options.title : section.title()) + badge,
        esc(options && options.sub ? options.sub : section.sub()), !flat,
        !flat && data && options && options.result ? options.result(data) : '') +
      '<div class="premium-cover"' + (data ? ' hidden' : '') + '>' +
      '<h3>' + esc(section.coverTitle()) + '</h3>' +
      '<p>' + esc(section.coverBlurb()) + '</p>' +
      '<button class="btn premium-unlock" type="button" aria-expanded="' + Boolean(data) + '"' +
      (sample ? ' disabled' : '') + '>' + premiumUnlockLabel(sample) + '</button></div>' +
      '<div class="premium-body"' + (data ? '' : ' hidden') + '>' +
      (data ? ((options && options.body) || section.body)(data) + ((options && options.extra) || '') : '') + '</div></div>';
  }

  /**
   * Shown instead of the four individual `paidCard()` covers while nothing
   * is unlocked yet — one block naming and explaining all four sections,
   * with exactly one "Unlock — US$5" button at the bottom, rather than
   * four separate price tags for what is in fact one purchase. Reuses the
   * `.premium-tier` look the welcome page's insightsHtml() uses on the
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
      (sample ? '' : linkPromoNoteHtml()) +
      '</div>';
  }

  /** Under the unlock button: the promo code from the reader's link, if one came with it. */
  function linkPromoNoteHtml() {
    const code = linkPromo();
    return code && !hasUnfetchedUnlock() ? '<p class="premium-link-promo">' + esc(TEXT.linkPromoNote(code)) + '</p>' : '';
  }

  /**
   * What the unlock explains, in the order the written report runs. The
   * other half of the offer to PAID_SECTIONS: those are four sections the
   * card does not touch, these are the writing behind what the card shows.
   * Titles come from the same TEXT keys the report's own section heads use,
   * so the offer and the thing bought cannot name a section differently.
   */
  const EXPLAINED_SECTIONS = [
    { icon: '👤', title: () => TEXT.whoYouAre, blurb: () => TEXT.explainWho },
    { icon: '📊', title: () => TEXT.bigFive, blurb: () => TEXT.explainBigFive },
    { icon: '🧭', title: () => TEXT.explainTypesTitle, blurb: () => TEXT.explainTypes },
    { icon: '✨', title: () => TEXT.explainListsTitle, blurb: () => TEXT.explainLists },
    { icon: '💞', title: () => TEXT.explainPeopleTitle, blurb: () => TEXT.explainPeople },
    { icon: '📱', title: () => TEXT.activity, blurb: () => TEXT.explainActivity },
    { icon: '🕳️', title: () => TEXT.bonus, blurb: () => TEXT.explainRoast },
  ];

  /**
   * What the unlock explains and adds, in the order the report runs. The
   * structured layout's list is its own: the overview, then each part's
   * sections with the paid ones where they sit in the report (wellbeing ends
   * Part 1, attachment, partner and the coach's read join Part 3), then the
   * plan and the roast — and no digital footprint, which that report has not
   * got. Each row carries its own blurb, so the paid ones need no second list.
   */
  function explainedSections() {
    if (reportLayout() !== 'structured') return EXPLAINED_SECTIONS;
    const S = Copy.STRUCTURED;
    const paidRow = key => {
      const section = PAID_SECTIONS.find(row => row.key === key);
      return { icon: section.icon, title: key === 'wellness' ? () => S.titles.wellness : section.title,
        blurb: section.coverBlurb };
    };
    const own = title => EXPLAINED_SECTIONS.find(row => row.title() === title);
    return [
      own(TEXT.whoYouAre),
      { icon: '🧵', title: () => S.titles.patterns, blurb: () => S.explainPatterns },
      { icon: '🧭', title: () => S.explainTypeTitle, blurb: () => S.explainType },
      own(TEXT.bigFive),
      paidRow('wellness'),
      { icon: '🧲', title: () => S.titles.motivators, blurb: () => S.explainMotivators },
      { icon: '✨', title: () => S.explainListsTitle, blurb: () => TEXT.explainLists },
      own(TEXT.explainPeopleTitle),
      paidRow('attachment'),
      paidRow('idealPartner'),
      paidRow('careerAssessment'),
      { icon: '🌱', title: () => S.titles.development, blurb: () => S.explainDevelopment },
      own(TEXT.bonus),
    ];
  }

  /**
   * The same offer, by the report's five parts: what each part holds, then its
   * sections. The overview's summary and patterns open Part 1, the part they
   * lead into, so the offer has the report's five numbered parts and no more.
   */
  function explainedParts() {
    const S = Copy.STRUCTURED;
    const rows = explainedSections();
    const by = title => rows.find(row => row.title() === title);
    const paidTitle = key => PAID_SECTIONS.find(row => row.key === key).title();
    return [
      // MBTI and the Big Five as one row: both are the reading of the scores
      // on the card, and four rows read better than five.
      { key: 'who', rows: [by(TEXT.whoYouAre), by(S.titles.patterns),
        { icon: '🧭', title: () => S.explainTypeTraitsTitle, blurb: () => S.explainTypeTraits }, by(S.titles.wellness)] },
      { key: 'drives', rows: [by(S.titles.motivators), by(S.explainListsTitle)] },
      { key: 'connect', rows: [by(TEXT.explainPeopleTitle), by(paidTitle('attachment')), by(paidTitle('idealPartner')), by(paidTitle('careerAssessment'))] },
      // The plan on the left, and on the right a section the offer does not
      // name — the roast, kept a surprise until it is unlocked.
      { key: 'together', rows: [by(S.titles.development)], secret: true },
    ].map((part, i) => Object.assign(part, { number: String(i + 1).padStart(2, '0'), rows: part.rows.filter(Boolean) }));
  }

  function unlockPartsHtml() {
    const S = Copy.STRUCTURED;
    // The part with a secret beside it takes half the width, and the secret
    // the other half as a panel of its own.
    return '<ol class="unlock-parts">' + explainedParts().map(part =>
      '<li class="unlock-part' + (part.secret ? ' unlock-part-half' : '') + '">' +
        '<div class="unlock-part-head"><span class="unlock-part-num" aria-hidden="true">' + part.number + '</span>' +
        '<h4>' + esc(S.parts[part.key].title) + '</h4></div>' +
        '<ul class="premium-tier-list">' + tierItemsHtml(part.rows, row => row.blurb()) + '</ul>' +
      '</li>' +
      (part.secret ? '<li class="unlock-secret"><span class="unlock-secret-icon" aria-hidden="true">🎁</span>' +
        '<strong>' + esc(S.unlockSecretTitle) + '</strong><span>' + esc(S.unlockSecretText) + '</span></li>' : '')).join('') + '</ol>';
  }

  function tierItemsHtml(rows, blurbOf) {
    return rows.map(row =>
      '<li class="premium-tier-item">' +
      '<span class="premium-tier-icon" aria-hidden="true">' + row.icon + '</span>' +
      '<span class="premium-tier-text"><strong>' + esc(row.title()) + '</strong>' +
      '<span>' + esc(blurbOf(row)) + '</span>' +
      '</span></li>').join('');
  }

  /**
   * Everything under a free card: one block, one button, naming every
   * explanation and every premium section the unlock opens. Built on the same
   * `.premium-tier` look as the four-section block, and the button is the same
   * `.premium-unlock`, so the purchase it starts is the one purchase there is.
   */
  /**
   * Invite three friends, get the full report free. Filled in by
   * refreshReferral once the server says where this reader's code stands.
   */
  /**
   * "Your link": how many opened it, made a card and bought the full report,
   * and the free full reports that earns — three friends' cards or two paid
   * reports each, adding up. On a free report under the unlock offer, on a
   * full one at its end. A free report earned can be used or given away.
   */
  function referralCardHtml(paid) {
    const R = TEXT.referral;
    // Three purple boxes: friends who made a card, bought the full report,
    // and synced with the reader. No buttons of its own: the card's Share
    // Card and Copy link above carry the same link. "Use it" and "Gift it"
    // appear only once a free report is earned.
    const stat = (key, icon, label) => '<li class="referral-stat"><span aria-hidden="true">' + icon + '</span>' +
      '<b class="referral-n" data-stat="' + key + '">0</b><span>' + esc(label) + '</span></li>';
    return '<section class="card section-card referral-card screen-only" data-paid="' + (paid ? '1' : '0') + '">' +
      '<div class="referral-head"><span class="referral-icon" aria-hidden="true">🔗</span><div>' +
        '<h3 class="referral-title">' + esc(R.title) + '</h3>' +
        '<p class="referral-blurb">' + esc(paid ? R.blurbPaid : R.blurb) + ' ' + esc(R.shareHint) + '</p></div></div>' +
      '<ul class="referral-stats">' + stat('friends', '🪪', R.cards) + stat('paid', '💳', R.paid) + stat('syncs', '🔄', R.syncs) + '</ul>' +
      '<div class="referral-ready-row" hidden><span class="referral-ready"></span>' +
        '<button class="btn btn-sm referral-claim" type="button">' + esc(paid ? R.claimPaid : R.claim) + '</button>' +
        '<button class="btn btn-sm btn-outline referral-gift" type="button">' + esc(R.gift) + '</button></div>' +
      '<p class="referral-status" role="status" hidden></p>' +
      '<div class="referral-gifts"></div>' +
    '</section>';
  }

  // Where this reader's link stands, from the server; null when it cannot be
  // reached. Cached for the payment sheet's offer, and asked at most once a
  // minute: the report page redraws often.
  let referralStatus = null;
  let referralAskedAt = 0;
  async function fetchReferralStatus(fresh) {
    if (!fresh && referralStatus && Date.now() - referralAskedAt < 60000) return referralStatus;
    const mine = await ensureReferral();
    if (!mine) return null;
    referralAskedAt = Date.now();
    try {
      const response = await fetch('api/referral', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: mine.secret }),
      });
      referralStatus = response.ok ? await response.json() : referralStatus;
    } catch (error) { /* keep what we had */ }
    return referralStatus;
  }
  /** The gift links this reader has made, newest first, while they can still be used. */
  function giftsMade() {
    const list = store.read(KEYS.gifts, []);
    const fresh = (Array.isArray(list) ? list : []).filter(g => g && /^[0-9a-f]{48}$/.test(g.token || '') &&
      Date.now() - Number(g.at) < GIFT_DAYS * 86400000);
    return fresh;
  }
  const GIFT_DAYS = 60;
  const giftUrl = token => location.origin + '/?gift=' + token;
  function giftsHtml() {
    const gifts = giftsMade();
    if (!gifts.length) return '';
    const R = TEXT.referral;
    return '<p class="referral-gifts-head">' + esc(R.giftsHead) + '</p><ul class="referral-gift-list">' +
      gifts.map(g => '<li><code>' + esc(giftUrl(g.token).replace(/^https?:\/\//, '')) + '</code>' +
        '<button class="btn btn-ghost referral-gift-copy" type="button" data-token="' + esc(g.token) + '">' + esc(R.copyShort) + '</button></li>').join('') +
      '</ul>';
  }
  async function refreshReferral() {
    const cards = document.querySelectorAll('.referral-card');
    if (!cards.length) return;
    for (const card of cards) card.querySelector('.referral-gifts').innerHTML = giftsHtml();
    const status = await fetchReferralStatus();
    if (!status) return;
    const R = TEXT.referral;
    for (const card of cards) {
      for (const key of ['friends', 'paid', 'syncs']) {
        const n = card.querySelector('.referral-n[data-stat="' + key + '"]');
        if (n) n.textContent = String(Number(status[key]) || 0);
      }
      const row = card.querySelector('.referral-ready-row');
      row.hidden = !(status.available > 0);
      card.querySelector('.referral-ready').textContent = status.available > 0 ? R.ready(status.available) : '';
    }
  }
  function referralSay(card, message) {
    const line = card && card.querySelector('.referral-status');
    if (!line) return;
    line.textContent = message;
    line.hidden = !message;
  }
  async function shareOrCopy(card, text, url, copied) {
    if (navigator.share) {
      try { await navigator.share({ title: 'PsycheAI', text, url }); return; }
      catch (error) { if (error && error.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); referralSay(card, copied); }
    catch (error) { referralSay(card, url); }
  }
  document.addEventListener('click', async event => {
    const card = event.target.closest && event.target.closest('.referral-card');
    if (!card) return;
    const R = TEXT.referral;
    const mine = await ensureReferral();
    if (event.target.closest('.referral-gift-copy')) {
      const link = giftUrl(event.target.closest('.referral-gift-copy').dataset.token);
      try { await navigator.clipboard.writeText(link); referralSay(card, R.giftCopied); }
      catch (error) { referralSay(card, link); }
    } else if (event.target.closest('.referral-gift')) {
      // Spent now, as a grant someone else can use: the link is the gift.
      if (!mine) return;
      const button = event.target.closest('.referral-gift');
      button.disabled = true;
      try {
        const answer = await LLM.postWithTicket('api/referral/claim', { secret: mine.secret, gift: true });
        referralStatus = answer && answer.status ? answer.status : referralStatus;
        if (!answer || !/^[0-9a-f]{48}$/.test(answer.grant || '')) throw new Error(R.claimFailed);
        store.write(KEYS.gifts, [{ token: answer.grant, at: Date.now() }].concat(giftsMade()).slice(0, 20));
        await refreshReferral();
        await shareOrCopy(card, R.giftShareText, giftUrl(answer.grant), R.giftCopied);
      } catch (error) {
        referralSay(card, (error && error.message) || R.claimFailed);
      } finally {
        button.disabled = false;
      }
    } else if (event.target.closest('.referral-claim')) {
      // The unlock (or, with the report already unlocked, the re-run with new
      // data); the payment sheet then offers the free report.
      const target = card.dataset.paid === '1' ? $('#rerun-with-data') : document.querySelector('.premium-unlock');
      if (target) target.click();
    }
  });

  // ---------- a gifted free full report ----------
  //
  // ?gift=<grant> on arrival: kept on this device and taken out of the
  // address. The unlock's sheet then offers it; it is cleared once a full
  // report has been written with it.
  function giftWaiting() {
    const gift = store.read(KEYS.gift, null);
    if (!gift || !/^[0-9a-f]{48}$/.test(gift.token || '')) return null;
    if (!(Date.now() - Number(gift.at) < GIFT_DAYS * 86400000)) { store.remove(KEYS.gift); return null; }
    return gift;
  }
  (function captureGift() {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has('gift')) return;
      const token = String(params.get('gift') || '').trim().toLowerCase();
      if (/^[0-9a-f]{48}$/.test(token)) store.write(KEYS.gift, { token, at: Date.now() });
      params.delete('gift');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    } catch (error) { /* no storage: the gift link can be opened again */ }
  })();
  // Shown on the welcome page (make your card first) and on the report
  // (unlock it now), by the same banner in each.
  function refreshGiftBanner() {
    const gift = giftWaiting();
    for (const banner of document.querySelectorAll('.gift-banner')) {
      banner.hidden = !gift;
      if (!gift) continue;
      const own = banner.closest('#view-profile');
      banner.querySelector('.gift-banner-title').textContent = TEXT.referral.giftArrivedTitle;
      banner.querySelector('.gift-banner-text').textContent = own ? TEXT.referral.giftArrivedHave : TEXT.referral.giftArrivedNew;
      banner.querySelector('.gift-banner-go').textContent = own ? TEXT.referral.giftUse : TEXT.inviteStart;
    }
  }
  document.addEventListener('click', event => {
    const go = event.target.closest && event.target.closest('.gift-banner-go');
    if (!go) return;
    if (!go.closest('#view-profile')) {
      $('.help-card').scrollIntoView({ behavior: scrollBehaviour(), block: 'start' });
      return;
    }
    const target = document.querySelector('#profile-body .premium-unlock') || $('#rerun-with-data');
    if (target) target.click();
  });

  /** On the unlock's sheet: the free report from inviting friends, when one is ready. */
  function showReferralOffer(kind) {
    const button = $('#premium-referral');
    if (!button) return;
    button.hidden = true;
    delete button.dataset.gift;
    if (kind !== 'unlock') return;
    // A gifted one first: it is someone else's present and expires.
    const gift = giftWaiting();
    if (gift) {
      button.textContent = TEXT.referral.useGift;
      button.dataset.gift = gift.token;
      button.hidden = false;
      return;
    }
    const show = status => {
      if (!status || !(status.available > 0) || premiumKind !== 'unlock' || button.dataset.gift) return;
      button.textContent = TEXT.referral.useFree;
      button.hidden = false;
    };
    show(referralStatus);
    fetchReferralStatus(true).then(show).catch(() => {});
  }
  if ($('#premium-referral')) {
    $('#premium-referral').addEventListener('click', async () => {
      const button = $('#premium-referral');
      if (button.dataset.gift) {
        button.hidden = true;
        onPaymentAuthorised({ referralGrant: button.dataset.gift }, $('#premium-dialog'));
        return;
      }
      const mine = await ensureReferral();
      if (!mine) return;
      button.disabled = true;
      try {
        const answer = await LLM.postWithTicket('api/referral/claim', { secret: mine.secret });
        referralStatus = answer && answer.status ? answer.status : referralStatus;
        if (!answer || !answer.grant) throw new Error(TEXT.referral.claimFailed);
        button.hidden = true;
        onPaymentAuthorised({ referralGrant: answer.grant }, $('#premium-dialog'));
      } catch (error) {
        premiumStatus((error && error.message) || TEXT.referral.claimFailed, 'bad');
      } finally {
        button.disabled = false;
      }
    });
  }

  /**
   * My Psyche once the full report is unlocked: their link under the card,
   * what the card carries, the way into My Report, and how it was all read
   * (with the re-run that adds data).
   */
  function hubSectionsHtml(report) {
    // The way into My Report is a button under the card's tools (cardGuideHtml).
    return beyondCardHtml(state.profile && state.profile.card) + methodCardHtml(report, false) + referralCardHtml(true);
  }

  function fullReportLockedHtml() {
    return '<div class="premium-tier paid-consolidated full-report-locked">' +
      '<div class="premium-tier-head">' +
      '<span class="mode-badge">' + esc(TEXT.premiumBadge) + '</span>' +
      '<h3>' + esc(TEXT.fullReportTitle) + '</h3>' +
      // The sample report, at the head's far end: what the unlock buys, to
      // look at before paying for it.
      '<button class="btn btn-outline tier-sample" type="button">' + esc(TEXT.fullReportSample) + '</button>' +
      '</div>' +
      '<p class="premium-tier-blurb">' + esc(TEXT.fullReportBlurb) + '</p>' +
      // One list: the explanations and the four premium sections are one
      // purchase, and splitting them made the four read as an afterthought.
      (reportLayout() === 'structured' ? unlockPartsHtml()
        : '<ul class="premium-tier-list">' + tierItemsHtml(explainedSections(), row => row.blurb()) +
          tierItemsHtml(PAID_SECTIONS, section => section.coverBlurb()) + '</ul>') +
      '<button class="btn premium-unlock" type="button" aria-expanded="false">' +
      premiumUnlockLabel(false) +
      // The other way in, under the price: three friends' cards from their link.
      (hasUnfetchedUnlock() ? '' : '<span class="premium-unlock-alt">' + esc(TEXT.premiumUnlockFriends) + '</span>') +
      '</button>' +
      // A code from the link this reader came in on, said before they tap.
      linkPromoNoteHtml() +
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
  function roastBlock(bonus, options) {
    if (!bonus) return '';
    // The structured layout's appendix: the roast already waits behind its
    // own reveal, so it is not a disclosure as well.
    const flat = Boolean(options && options.flat);
    return '<div class="card section-card bonus-card">' +
      // Same splice paidCard uses for its "Premium" badge: sectionHead
      // concatenates whatever it is handed into the <h2>, so a title with
      // markup in it is the one thing it is handed that is not plain text.
      // A different class, because this badge is saying the opposite thing —
      // see .bonus-badge in styles.css.
      sectionHead('🕳️', esc(TEXT.bonus) +
        ' <span class="mode-badge bonus-badge">' + esc(TEXT.bonusBadge) + '</span>',
      esc(TEXT.bonusSub), !flat) +
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
    // Sharing is offered on the reader's own roast only, never the sample's.
    const own = !card.closest('#sample-body');
    setHtml(body, bonusBodyHtml(bonus) +
      '<div class="btn-row bonus-actions">' +
      (own ? '<button class="btn bonus-share" type="button"><svg class="cta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg><span class="cta-label">' +
        esc(TEXT.roastShare) + '</span></button>' : '') +
      '<button class="btn btn-ghost bonus-hide" type="button">' + esc(TEXT.bonusHide) + '</button></div>' +
      (own ? '<p class="fineprint link-status bonus-share-status" role="status"></p>' : ''));
    body.hidden = false;
    cover.hidden = true;
    // Read in the page's own colours once opened; grey only while covered.
    card.classList.add('is-revealed');
  }

  /** Puts the cover back, and takes the writing out of the page with it. */
  function hideRoast(button) {
    const card = button.closest('.bonus-card');
    const body = card.querySelector('.bonus-body');
    const cover = card.querySelector('.bonus-cover');
    body.innerHTML = '';
    body.hidden = true;
    cover.hidden = false;
    card.classList.remove('is-revealed');
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
  /**
   * The welcome page's "What insights will I get?": the summary card first —
   * what is on it, beside a real one drawn from the sample — then the full
   * premium report, by the four parts it is written in, and its price. The
   * part and section names are the report's own, so a rename there is a
   * rename here.
   */
  const EXPAND_ICON = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
  const CHEVRON = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  /** One card in the welcome page's gallery: a button, a small card, an expand mark. */
  function insightSlot(index, buttonId, cardId, label) {
    return '<button type="button" class="insight-preview" data-card="' + index + '"' + (buttonId ? ' id="' + buttonId + '"' : '') +
      ' aria-label="' + esc(label) + '">' +
      '<span class="insight-preview-frame"><span class="psyche-card"' + (cardId ? ' id="' + cardId + '"' : '') + '></span></span>' +
      '<span class="insight-preview-expand" aria-hidden="true">' + EXPAND_ICON + '</span></button>';
  }
  function galleryArrow(step, label) {
    return '<button type="button" class="insight-deck-step" data-deck-step="' + step + '" aria-label="' + esc(label) + '">' +
      CHEVRON(step < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '</button>';
  }

  function insightsHtml() {
    const S = Copy.STRUCTURED;
    const I = S.insights;
    const parts = ['who', 'drives', 'connect', 'together'];
    const sectionsOf = {
      who: [I.characterChip, S.titles.patterns, 'MBTI', TEXT.bigFive, S.titles.wellness],
      drives: [S.titles.motivators, TEXT.interests, TEXT.valuesBeliefs],
      connect: [TEXT.loveHead, S.howYouAttach, S.whoSuitsYou, S.titles.work],
      together: [S.titles.development, S.titles.plan],
    };
    return '<div class="insight-tier insight-free">' +
      '<div class="insight-free-copy">' +
        '<p class="tier-badges"><span class="tier-badge tier-badge-free">' + esc(I.freeBadge) + '</span></p>' +
        '<h3 class="tier-title">' + esc(I.freeTitle) + '</h3>' +
        '<p class="tier-blurb">' + esc(I.freeBlurb) + '</p>' +
        // The name of each part of the card, and nothing under it.
        '<ul class="card-features">' + I.cardItems.map(([icon, title]) =>
          '<li><span class="card-feature-icon" aria-hidden="true">' + esc(icon) + '</span>' +
          '<span><strong>' + esc(title) + '</strong></span></li>').join('') + '</ul>' +
      '</div>' +
      // A deck of sample cards: one at the front, a tap away from full
      // screen, the next two stacked and fading behind it, and arrows and
      // dots under it to bring the others forward. The first is the full
      // sample's; the rest are added once sample-cards.json has loaded.
      '<div class="insight-deck-wrap">' +
        '<div class="insight-deck" id="insight-deck" role="group" aria-roledescription="carousel" aria-label="' + esc(I.galleryLabel) + '">' +
          insightSlot(0, 'insight-card-open', 'insight-card-preview', I.previewOpen) +
        '</div>' +
        '<div class="insight-deck-nav">' + galleryArrow(-1, I.galleryPrev) +
          '<span class="insight-deck-dots" id="insight-deck-dots" aria-hidden="true"></span>' +
          galleryArrow(1, I.galleryNext) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="insight-tier insight-premium premium-tier">' +
      '<div class="premium-tier-head">' +
        '<span class="mode-badge">' + esc(TEXT.premiumBadge) + '</span>' +
        '<h3 class="tier-title">' + esc(I.premiumTitle) + '</h3>' +
        '<span class="premium-tier-price">' + esc(TEXT.premiumPriceLabel) + '</span>' +
      '</div>' +
      '<p class="tier-blurb">' + esc(I.premiumBlurb) + '</p>' +
      '<ol class="insight-parts">' + parts.map((key, i) =>
        '<li class="insight-part">' +
          '<span class="insight-part-num" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<div><h4>' + esc(S.parts[key].title) + '</h4>' +
          '<p>' + esc(I.partBlurbs[key]) + '</p>' +
          '<p class="insight-part-chips">' + sectionsOf[key].map(name => '<span>' + esc(name) + '</span>').join('') + '</p>' +
        '</div></li>').join('') + '</ol>' +
      '<div class="insight-premium-foot">' +
        '<ul class="insight-extras">' + I.extras.map(([icon, text]) =>
          '<li><span aria-hidden="true">' + esc(icon) + '</span>' + esc(text) + '</li>').join('') + '</ul>' +
        '<button class="btn btn-outline" id="insight-sample" type="button">' + esc(I.sampleButton) + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="insight-compat">' +
      '<span class="insight-compat-icon" aria-hidden="true">🤝</span>' +
      '<div><h3>' + esc(I.compatTitle) + '</h3><p>' + esc(I.compatBlurb) + '</p></div>' +
    '</div>';
  }

  /**
   * Mounted synchronously at start-up rather than inside `boot()`, which
   * awaits the server status call — the welcome page is the first thing a
   * reader sees and should not have a block of it arrive after a round trip.
   * The sample card beside it is drawn once the sample has loaded.
   */
  // The full sample first, then the other sample cards, in gallery order.
  let insightCards = [];
  let insightIndex = 0;
  function mountInsights() {
    for (const slot of document.querySelectorAll('[data-insights]')) setHtml(slot, insightsHtml());
    drawInsightPreview();
  }

  /** One of the welcome page's sample cards, full screen, in the sample's own card dialog. */
  function openInsightCard(index = 0) {
    const dialog = $('#sample-card-dialog');
    if (!dialog || dialog.open || !insightCards[index]) return;
    dialog.classList.toggle('is-gallery', insightCards.length > 1);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    showInsightCard(index);
  }

  /**
   * Puts card `index` in the full-screen view, sliding it in from the side
   * it was stepped towards. The ends wrap round, so stepping never stops.
   */
  function showInsightCard(index, step = 0) {
    const count = insightCards.length;
    if (!count) return;
    insightIndex = ((index % count) + count) % count;
    const full = $('#sample-psyche-card-full');
    full.innerHTML = psycheCardHtml(insightCards[insightIndex]);
    freshArtIds(full);
    guideSampleCard(insightCards[insightIndex]);
    const counter = $('#sample-card-count');
    if (counter) counter.textContent = (insightIndex + 1) + ' / ' + count;
    layoutPsycheCard();
    const frame = full.closest('.card-dialog-frame');
    if (frame && step) {
      frame.classList.remove('is-slide-next', 'is-slide-prev');
      void frame.offsetWidth;
      frame.classList.add(step > 0 ? 'is-slide-next' : 'is-slide-prev');
    }
  }

  function stepInsightCard(step) {
    const dialog = $('#sample-card-dialog');
    if (!dialog || !dialog.open || !dialog.classList.contains('is-gallery')) return;
    showInsightCard(insightIndex + step, step);
  }

  // sample.json, fetched once per page: the front page draws its preview
  // several times as boot proceeds, and each draw used to start its own
  // download of it. Parsed afresh for every caller, so none can change what
  // another sees; a failed fetch is forgotten, so the next call tries again.
  let sampleText = null;
  let insightCardsLoad = null;
  function loadSample() {
    if (!sampleText) {
      sampleText = fetch('sample.json').then(response => {
        if (!response.ok) throw new Error('The sample could not be loaded.');
        return response.text();
      });
      sampleText.catch(() => { sampleText = null; });
    }
    return sampleText.then(text => JSON.parse(text));
  }

  async function drawInsightPreview() {
    const gallery = document.getElementById('insight-deck');
    if (!gallery) return;
    try {
      if (!insightCards.length) {
        // One load shared by every draw that starts before it lands.
        insightCardsLoad = insightCardsLoad || Promise.all([
          loadSample().catch(() => null),
          fetch('sample-cards.json').then(response => (response.ok ? response.json() : null)).catch(() => null),
        ]);
        const [sample, more] = await insightCardsLoad;
        if (!sample) { insightCardsLoad = null; return; }
        if (!insightCards.length) insightCards = [sample].concat((more && Array.isArray(more.cards)) ? more.cards : []);
      }
      const target = document.getElementById('insight-deck');
      if (!target) return;
      const I = Copy.STRUCTURED.insights;
      // The other cards' slots, once there is something to put in them.
      target.querySelectorAll('.insight-preview:not(#insight-card-open)').forEach(node => node.remove());
      target.insertAdjacentHTML('beforeend', insightCards.slice(1).map((report, i) =>
        insightSlot(i + 1, '', '', I.previewOpenNamed.replace('{name}', (report.card && report.card.name) || ''))).join(''));
      const cards = [...target.querySelectorAll('.insight-preview .psyche-card')];
      cards.forEach((el, i) => { el.innerHTML = psycheCardHtml(insightCards[i]); });
      // Fitted as soon as they are drawn, so the page never lays out a
      // full-size card: 230px wide, or less where a phone leaves less room
      // beside the stack. The stylesheet holds their space until then.
      const wrap = target.closest('.insight-deck-wrap');
      const room = wrap && wrap.clientWidth ? wrap.clientWidth : 300;
      // As wide as the column allows, up to 320px: the cards either side
      // peek out into the gap beside the column and the tier's padding,
      // rather than taking width from the card in front.
      const peek = room < 340 ? 18 : 24;
      const width = Math.max(150, Math.min(320, room - 2 * peek + 28));
      cards.forEach(el => fitCard(el, width, width * 1920 / 1080));
      target.style.setProperty('--peek', peek + 'px');
      target.style.setProperty('--deck-w', Math.round(width) + 'px');
      target.style.setProperty('--deck-h', Math.round(width * 1920 / 1080) + 'px');
      $('#insight-deck-dots').innerHTML = insightCards.map(() => '<i></i>').join('');
      arrangeDeck();
    } catch (error) {
      // A card that will not draw leaves the list beside it to say what is on one.
    }
  }

  /**
   * Puts the deck's cards in their places around `deckIndex`: the front one
   * centred, the next peeking out behind it on the right and the previous on
   * the left, and the rest out of sight behind. Only the front one can be
   * pressed or reached by Tab.
   */
  let deckIndex = 0;
  function arrangeDeck() {
    const deck = document.getElementById('insight-deck');
    if (!deck) return;
    const slots = [...deck.querySelectorAll('.insight-preview')];
    const count = slots.length;
    slots.forEach((slot, i) => {
      const pos = ((i - deckIndex) % count + count) % count;
      slot.setAttribute('data-pos', pos === 0 ? '0' : pos === 1 ? '1' : pos === count - 1 ? 'prev' : 'rest');
      slot.classList.toggle('is-front', pos === 0);
      slot.tabIndex = pos === 0 ? 0 : -1;
      slot.setAttribute('aria-hidden', pos === 0 ? 'false' : 'true');
    });
    const dots = document.querySelectorAll('#insight-deck-dots i');
    dots.forEach((dot, i) => dot.classList.toggle('is-on', i === deckIndex));
  }

  function stepDeck(step) {
    const count = document.querySelectorAll('#insight-deck .insight-preview').length;
    if (count < 2) return;
    deckIndex = ((deckIndex + step) % count + count) % count;
    arrangeDeck();
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
        setHtml(body, section.body(data));
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
      '<div class="bar"><div class="bar-fill" data-fill="' + width + '"></div></div>' +
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
    // My Report, once there is a full report to read on its own page.
    $('#nav-full').hidden = !(ready && fullReportPage());
    // The page the reader is on, marked the same way on every link.
    const current = !$('#view-profile').hidden;
    $('#nav-profile').classList.toggle('is-current', current && !reportPageOn());
    $('#nav-full').classList.toggle('is-current', current && reportPageOn());
    $('#nav-scan').classList.toggle('is-current', !$('#view-scan').hidden);
    $('#nav-about').classList.toggle('is-current', !$('#view-about').hidden);
    for (const link of document.querySelectorAll('.nav-links a')) {
      if (link.classList.contains('is-current')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  /** Whether this reader's full report lives on a page of its own (My Report). */
  function fullReportPage() {
    return Boolean(state.profile) && reportLayout() === 'structured' && hasExplanations(state.profile);
  }
  /** Whether My Report, rather than My Psyche, is the page drawn. */
  function reportPageOn() {
    return profilePage === 'report' && fullReportPage();
  }

  function show(view) {
    // A sync's result is a popout over My Syncs, not a page of its own.
    if (view === 'report') { openSyncDialog(); return; }
    if (syncDialog().open) syncDialog().close();
    // Arriving at a home view gives back the entry pushed for whichever
    // secondary view preceded it — a nav link, a fresh scan's result, anything
    // other than the Back press the entry exists for. Left in place, a later
    // Back from wherever this navigation actually lands would pop a phantom
    // state and jump to a home view unannounced. See navHistoryEntry's own
    // declaration for why the entry exists at all, and the popstate listener
    // below for the other half of this same guard.
    // The main page is a home view for someone starting out, and an excursion
    // like the FAQ for a reader who already has a card: they reached it from
    // the logo, and Back should take them to their card rather than off the
    // site.
    // My Report is an excursion from My Psyche, so Back returns to the card.
    const secondary = SECONDARY_VIEWS.includes(view) || (view === 'welcome' && Boolean(state.profile)) ||
      (view === 'profile' && reportPageOn());
    if (navHistoryEntry && HOME_VIEWS.includes(view) && !secondary && !closingNavFromHistory) {
      navHistoryEntry = false;
      history.back();
    }
    for (const name of VIEWS) $('#view-' + name).hidden = name !== view;
    syncNav();
    // The psyche card is scaled from the width of the column it sits in, and a
    // hidden view measures zero — so a card rendered before its view was shown
    // would be scaled to nothing. Re-fit here, where the width is real.
    if (view === 'profile') { layoutPsycheCard(); layoutSideActions(); }
    // The Start here card claims what is loaded, and what is loaded changes
    // underneath it — a failed run, a deleted profile, a fresh session. Kept
    // truthful on arrival rather than only at boot, since arriving is when it
    // is read.
    const guides = $('.footer-guides');
    if (guides) guides.hidden = !(view === 'welcome' && !state.profile);
    if (view === 'welcome') {
      refreshStartHere();
      $('#view-welcome').classList.toggle('is-returning', Boolean(state.profile));
      // The sample card is fitted to the width of its tier, and a reader who
      // landed on their own card had this page hidden when it was first drawn —
      // it measured nothing and was left at full size. Fitted again now that
      // the page is on screen.
      drawInsightPreview();
    }
    window.scrollTo(0, 0);
    // One entry covers a whole excursion into any of the secondary views, not
    // one per view — moving between them (about → scan, or scan → its own
    // report) never stacks a second pushState behind the first. Guarded on
    // navHistoryEntry already being false, which is also what stops this from
    // re-firing on every one of the several show() calls a single scan →
    // working → report sequence makes.
    if (secondary && !navHistoryEntry) {
      history.pushState({ psycheaiNav: true }, '');
      navHistoryEntry = true;
    }
  }

  // ---- a sync's result, as a popout over My Syncs ----
  //
  // Opened from the Syncs list or when a sync lands; closed by its ✕, Close,
  // Esc, a click outside it, or Back (it pushes an entry of its own, as the
  // sample does).
  let syncHistoryEntry = false;
  let closingSyncFromHistory = false;
  const syncDialog = () => $('#sync-dialog');
  function openSyncDialog() {
    const dialog = syncDialog();
    if ($('#view-scan').hidden) { renderScan(); show('scan'); } else renderScan();
    $('#view-report').hidden = false;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      history.pushState({ psycheaiSync: true }, '');
      syncHistoryEntry = true;
    }
    dialog.scrollTop = 0;
  }
  syncDialog().addEventListener('close', () => {
    $('#view-report').hidden = true;
    if (syncHistoryEntry && !closingSyncFromHistory) popOwnEntry();
    syncHistoryEntry = false;
  });
  // A click on the backdrop lands on the dialog itself; one inside it does not.
  syncDialog().addEventListener('click', event => { if (event.target === syncDialog()) syncDialog().close(); });
  $('#sync-dialog-close').addEventListener('click', () => syncDialog().close());
  $('#compat-back').addEventListener('click', () => syncDialog().close());

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
      const report = await loadSample();
      // Kept so the roast can be revealed on demand inside the sample too.
      // Its text is deliberately not written into the markup until the
      // reader asks for it — see roastBlock()/revealRoast().
      sampleReport = report;
      // No Psyche Card here: the sample opens straight on 00 and the part
      // nav, since the front page already shows sample cards of its own. The
      // card is still built for the full-screen copy, which other entry
      // points open, but its section in the sample stays hidden.
      const cardHtml = psycheCardHtml(report);
      $('#sample-psyche-card').innerHTML = cardHtml;
      freshArtIds($('#sample-psyche-card'));
      // The same markup again for the full-screen copy, rather than moving the
      // one node between two parents: fitCard scales by writing a transform on
      // the element, and the preview and the full-screen view are scaled to
      // different boxes at the same time.
      $('#sample-psyche-card-full').innerHTML = cardHtml;
      freshArtIds($('#sample-psyche-card-full'));
      $('#sample-card-section').hidden = true;
      $('#sample-card-title').textContent = TEXT.cardSection;
      $('#sample-card-hint').textContent = TEXT.cardHint;
      setHtml($('#sample-sections'), reportSectionsHtml(report, { sample: true }));
      collapseSections($('#sample-body'));
      markStructured($('#sample-sections'));
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // Both of these run after showModal, not before, and for the same
      // reason: a closed <dialog> is display:none and has no layout at all.
      //
      // fitCard measures offsetHeight — called any earlier it reads a natural
      // height of 0, bails out, and leaves the card unscaled and overflowing
      // its frame. The scroll reset has exactly the same problem and was
      // exactly the same bug: assigning scrollTop to an element that is not
      // being rendered does nothing, so the reset was silently dropped and the
      // sample reopened wherever the reader had left it — halfway down
      // somebody else's report rather than at the summary card it is supposed
      // to open on.
      layoutSampleCard();
      $('#sample-body').scrollTop = 0;
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
    if (sampleHistoryEntry && !closingFromHistory) popOwnEntry();
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
    // Closed with it, or a Back press that shuts the sample from underneath
    // would leave the full-screen card stranded over the page with nothing
    // behind it.
    const full = $('#sample-card-dialog');
    if (full && full.open) full.close();
    $('#sample-sections').innerHTML = '';
    $('#sample-psyche-card').innerHTML = '';
    $('#sample-psyche-card-full').innerHTML = '';
    $('#sample-card-section').hidden = true;
    sampleReport = null;
  });

  // ---- the illustrated Instagram guide ----
  //
  // The same shape as the sample dialog above and for the same reasons, so the
  // two share their markup classes and their history handling. Its content is
  // static markup in index.html rather than built here: nothing in it depends
  // on the reader's own data, so there is nothing to render and nothing to
  // clear on close.
  let guideHistoryEntry = false;
  const guideDialog = () => $('#guide-dialog');

  function showGuide() {
    const dialog = guideDialog();
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // After showModal, never before. A closed <dialog> is display:none, and
    // scrollTop on an element that is not being rendered is a no-op — so this
    // reset used to be dropped on the floor and the guide reopened wherever
    // the reader had left it, which for anyone who had read to the end meant
    // opening on step 4 rather than on "Open Download your information".
    dialog.querySelector('.guide-body').scrollTop = 0;
    history.pushState({ psycheaiGuide: true }, '');
    guideHistoryEntry = true;
  }

  function closeGuide() {
    const dialog = guideDialog();
    if (dialog.open) dialog.close();
    else if (dialog.hasAttribute('open')) dialog.removeAttribute('open');
  }

  guideDialog().addEventListener('close', () => {
    // Same bookkeeping the sample dialog does: give back the entry that was
    // pushed for it, unless this close *came* from a Back press, in which case
    // the entry is already gone and popping again would take the reader off a
    // page they were not trying to leave.
    if (guideHistoryEntry && !closingGuideFromHistory) popOwnEntry();
    guideHistoryEntry = false;
  });

  $('#guide-open').addEventListener('click', showGuide);
  $('#guide-close').addEventListener('click', closeGuide);
  // The guide's own call to action, and the welcome card's, are now the same
  // action rather than one leading to the other. It used to scroll to the
  // upload card, which left a reader who had just finished the walkthrough
  // looking at a button they still had to find and press; it opens the popout
  // directly instead.
  //
  // The frame juggling below is inherited from that scroll and still earns its
  // place: closeGuide() pops the guide's history entry, and opening a second
  // dialog before that has settled races the popstate handler — which would
  // close the popout again as it unwinds the entry the guide left behind.
  $('#guide-start').addEventListener('click', () => {
    if (guideHistoryEntry) {
      window.addEventListener('popstate',
        () => requestAnimationFrame(() => requestAnimationFrame(startFromSources)), { once: true });
      closeGuide();
    } else {
      closeGuide();
      startFromSources();
    }
  });

  let closingGuideFromHistory = false;

  // A dialog closed by Esc or its cross gives back the history entry it
  // pushed, and that history.back() arrives here as a popstate like any Back
  // press. It is not one: the dialog is already shut, so the handler below
  // would fall through and treat it as leaving whatever page sits underneath —
  // closing the guide on the FAQ, or on the main page reached from the logo,
  // sent the reader to their card. Counted, so each of those pops is passed
  // over exactly once.
  let ownPops = 0;
  function popOwnEntry() {
    ownPops += 1;
    history.back();
  }

  window.addEventListener('popstate', () => {
    if (ownPops > 0) { ownPops -= 1; return; }
    // The hero video, expanded over the page on a phone, is the topmost thing
    // there can be: Back closes it first, as it would any phone video player.
    if (collapseHeroVideo && collapseHeroVideo(true)) return;
    // The guide is checked before the sample because it is the one that can be
    // open on top: it is reachable from the welcome page, where the sample is
    // reachable too, and whichever was opened last is the one a Back press is
    // aimed at. Both are guarded on being open at all, so the order only
    // decides which closes first when — impossibly, today — both are.
    if (syncDialog().open) {
      closingSyncFromHistory = true;
      syncHistoryEntry = false;
      syncDialog().close();
      closingSyncFromHistory = false;
      return;
    }
    if (guideDialog().open || guideDialog().hasAttribute('open')) {
      closingGuideFromHistory = true;
      guideHistoryEntry = false;
      closeGuide();
      closingGuideFromHistory = false;
      return;
    }
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
    // The logo: the main page, whether or not this reader has a card yet.
    // 'home' cannot do this — it is also where Back lands, which for a reader
    // with a card has to be their card.
    if (target === 'main') return show('welcome');
    if (target === 'profile') {
      if (!state.profile) return show('welcome');
      profilePage = 'hub';
      renderProfile(); show('profile'); return;
    }
    // My Report: the full report on its own page, once it is unlocked.
    if (target === 'full') {
      if (!fullReportPage()) return go('profile');
      profilePage = 'report';
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
    // "Got their link?" lives inside #compat-dialog now — without
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

  // The card itself, not a box inside it — see the markup. Kept under the old
  // name because everything below still talks about a dropzone, and it still
  // is one; only its bounds changed.
  const dropzone = $('.upload-card');
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

  // ---------- holding a card still while the layout moves under it ----------
  //
  // The report scrolls in two different containers depending on where it is
  // being read: the profile page scrolls the window, and the sample dialog
  // scrolls its own body (`.sample-dialog-body` is `overflow-y: auto`). Any
  // correction that assumed the window would silently do nothing inside the
  // dialog, which is the kind of half-working that never gets reported.
  function scrollHostOf(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        return el;
      }
    }
    return null;
  }

  /** How far down the visible area an element currently sits, in pixels. */
  function viewportTopOf(node, host) {
    const top = node.getBoundingClientRect().top;
    return host ? top - host.getBoundingClientRect().top : top;
  }

  function scrollHostBy(host, delta) {
    if (!delta) return;
    if (host) host.scrollTop += delta;
    else window.scrollBy(0, delta);
  }

  function visibleHeightOf(host) {
    return host ? host.clientHeight : window.innerHeight;
  }

  // Below this much of the visible height, a heading that stayed exactly where
  // it was would have opened its section almost entirely off-screen — so that
  // one case gets a scroll and every other click gets none. Deliberately low:
  // the point of anchoring is that most clicks move nothing at all, and a
  // threshold generous enough to fire on a mid-screen heading would put the
  // page back to sliding on nearly every toggle.
  const REVEAL_BELOW = 0.62;

  // Every place that lands back on the welcome page with something to say —
  // a bad archive, a bad photo, a failed analysis, a stale share link — used
  // to call show('welcome') and flash the message in the same breath. show()
  // always scrolls to the very top of the page, so the message landed below
  // the fold behind the hero, the how-it-works row and the instructions card,
  // and a reader who had scrolled down to drop a file saw nothing happen.
  // This is the one path back that keeps the reason on screen: it scrolls to
  // the message itself once show() and flash() have both run, rather than to
  // wherever show() happens to leave the page.
  /**
   * Back out of an upload and land where the reader was standing.
   *
   * Both abandon paths — Back at the supplement offer, Escape at the review —
   * go through here rather than calling show() directly, so the two cannot
   * drift apart on the one thing that makes them feel different from a
   * failure. show() scrolls every view change to the top, which is right for
   * arriving somewhere and wrong for backing out: the dropzone sits near the
   * foot of a long page, and a reader who abandons an upload was standing
   * there a second ago.
   *
   * The restore overrides show()'s scroll rather than suppressing it. Both run
   * in the same synchronous task, so nothing is painted in between and there
   * is no visible jump — and an option threaded through show() to skip its
   * scroll would be an option no test could ever catch failing, since this
   * line would put the reader in the right place either way.
   *
   * Guarded on the page still being long enough to hold that position: a
   * shorter page would otherwise get an out-of-range scroll the browser clamps
   * somewhere arbitrary.
   */
  function abandonUpload(scrollY) {
    show('welcome');
    const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(scrollY, limit));
  }

  // The last analysis that was actually attempted, kept so that "Try again"
  // can repeat it exactly rather than reassemble something equivalent.
  //
  // Byte-identity is the whole point. The server keys its result cache on the
  // digest, so resending this object returns the report that finished after
  // the reader's connection died, or attaches to the one still being
  // generated. Rebuilding the digest from the archive instead — which is what
  // the "Continue with your data" route does — produces a digest that differs
  // and would pay for the same analysis a second time.
  //
  // In memory only. A reload has the stored digest and the welcome card's own
  // route back, and a paid run that never landed is offered by the pending
  // banner, which is a durable record because that one is owed money.
  let lastAttempt = null;

  function showUploadError(message, opts) {
    show('welcome');
    // The message lives in the Start here card, which a reader who already has
    // a card does not otherwise see on this page (.is-returning). Something
    // they loaded has just failed, so the card comes back with it.
    $('#view-welcome').classList.remove('is-returning');
    // Before the message, so the card behind it already reads "your data is
    // still here" by the time the reader looks up from the error. A failed
    // analysis loses nothing — the digest was written to storage before the
    // model was called — and the whole point of the line is to say so at the
    // moment somebody is deciding whether they have to start over.
    refreshStartHere();
    flash('#upload-error', message);
    // Offered only for a failed analysis, and only while the attempt it would
    // repeat is still in hand. Every other caller of this function — an
    // unreadable export, a digest that would not build — has nothing to retry
    // and gets no button, because a button that reruns the thing that just
    // failed for a reason retrying cannot fix is worse than no button.
    const retry = $('#upload-retry');
    if (retry) retry.hidden = !(opts && opts.retry && lastAttempt);
    $('#upload-error').scrollIntoView({ behavior: scrollBehaviour(), block: 'center' });
  }

  /**
   * What the "Start here" card says about data already in hand.
   *
   * Read from the same two places the popout seeds its ticks from, so the card
   * and the popout cannot disagree: `state.signals` is the archive parsed this
   * session, `state.digest` the evidence summary that survives a reload. Either
   * one means the reader has something to analyse and nothing to re-upload.
   */
  function refreshStartHere() {
    const note = $('#upload-loaded');
    const button = $('#open-sources');
    if (!note || !button) return;
    const digest = state.digest;
    const supplements = (state.signals && state.signals.supplements) || {};
    const loaded = [];
    if (state.signals || digest) loaded.push('Instagram');
    if ((digest && digest.google) || supplements.google) loaded.push('Google');
    if ((digest && digest.facebook) || supplements.facebook) loaded.push('Facebook');
    if ((digest && digest.whatsapp) || supplements.whatsapp) loaded.push('WhatsApp');
    note.hidden = loaded.length === 0;
    note.textContent = loaded.length
      ? loaded.join(' and ') + TEXT.startLoadedSuffix
      : '';
    button.textContent = loaded.length ? TEXT.startContinue : TEXT.startLoad;
  }

  /**
   * The welcome page's own way in: the same popout the report page uses to add
   * or change a source, followed by the same review, payment and analysis a
   * dropped file went through.
   *
   * Sharing the popout is what makes a failed analysis cheap. Everything a run
   * needs is already on the device by the time it fails — `writeDigest` puts
   * the digest in storage before the model is called — so reopening this shows
   * Instagram and Google ticked and the reader presses Continue. Nothing is
   * read again, and the server's result cache means a retry inside its window
   * does not pay for the analysis twice either.
   *
   * Deliberately not routed through `rerunWithAdditionalData`, which does the
   * same three steps on the report page: that one also has to decide whether a
   * US$5 unlock is regenerating four paid sections alongside the free ones,
   * and there is no report here for any of that to be true of. The shared
   * thing is the popout and the review, not the pricing.
   */
  async function startFromSources() {
    const scrollBefore = window.scrollY;
    for (;;) {
      let collected;
      try {
        collected = await askDataSources({
          title: TEXT.dataSourcesFirstTitle,
          blurb: TEXT.dataSourcesFirstBlurb,
          // Instagram and Google only. A first upload is not the moment to
          // open a third door, and the how-to card directly above this
          // recommends exactly these two; Facebook stays available from the
          // report page afterwards, which is where somebody who wants it will
          // already be.
          sources: ['instagram', 'google'],
          sublines: { instagram: TEXT.dataSourcesFirstInstagram },
        });
      } catch (error) {
        showUploadError((error && error.message) || 'Could not read that export.');
        return;
      }
      // Back or Escape at the popout: nothing touched, and the reader is put
      // back where they were standing rather than at the top of the page.
      if (!collected) { abandonUpload(scrollBefore); return; }

      // The same merge order addDataAndRerun uses, and for the same reason:
      // a fresh Instagram read replaces `state.signals` wholesale and carries
      // no `.supplements` of its own, so anything loaded earlier this session
      // has to be read off the old object before it is replaced.
      const priorSupplements = state.signals && state.signals.supplements;
      if (typeof collected.instagram === 'object') state.signals = collected.instagram;
      repairOwnName().catch(() => {});
      if (state.signals) {
        state.signals.supplements = Object.assign({}, priorSupplements,
          typeof collected.google === 'object' ? { google: collected.google } : null,
          typeof collected.facebook === 'object' ? { facebook: collected.facebook } : null,
          typeof collected.whatsapp === 'object' ? { whatsapp: collected.whatsapp } : null);
      }

      let digest;
      if (state.signals) {
        digest = Digest.build(state.signals, { includeMessages: true });
      } else if (state.digest) {
        // The retry path after a reload: the archive is gone but the digest
        // it produced is not, and the digest is the only thing the server was
        // ever going to be sent. Copied rather than mutated so a declined
        // review leaves the stored one exactly as it was.
        digest = JSON.parse(JSON.stringify(state.digest));
        const extra = {};
        if (typeof collected.google === 'object') extra.google = collected.google;
        if (typeof collected.facebook === 'object') extra.facebook = collected.facebook;
        if (typeof collected.whatsapp === 'object') extra.whatsapp = collected.whatsapp;
        // The handle so the supplement's own text can be scrubbed too — see
        // redactOwnHandle. Undefined when the archive is gone, which is the
        // gap that function documents rather than one worth reopening the
        // Instagram picker for.
        if (Object.keys(extra).length) digest = Digest.addSupplements(digest, extra, { ownHandle: ownHandle(), ownName: ownDisplayName() });
      } else {
        // Google or Facebook loaded with no Instagram behind them. The popout
        // is reopened rather than the run abandoned, because the reader is one
        // row away from being able to continue.
        flash('#upload-error', TEXT.startNeedsInstagram);
        continue;
      }

      let decision;
      try {
        decision = await askReview(digest, { paymentDue: mustPayForAnalysis() });
      } catch (error) {
        showUploadError((error && error.message) || 'Could not build your evidence summary.');
        return;
      }
      // Back steps upstream to the popout with everything still loaded, which
      // is the whole reason this is a loop; Escape abandons the attempt.
      if (decision === REVIEW_BACK) continue;
      if (!decision) { abandonUpload(scrollBefore); return; }

      const auth = await authoriseAnalysis();
      if (auth === false) { showUploadError(TEXT.analysisDeclined); return; }

      applyReviewDecision(digest, decision);
      state.digest = digest;
      pendingDataSourceReads = {};
      writeDigest(digest);
      await runAnalysis(digest, auth);
      return;
    }
  }

  // "Request data": to the steps for getting the export. A reader who already
  // has a card has no steps card on this page (see .is-returning), so for them
  // it opens the illustrated guide instead.
  $('#hero-start').addEventListener('click', () => {
    if (state.profile) { showGuide(); return; }
    show('welcome');
    $('.help-card').scrollIntoView({ behavior: scrollBehaviour(), block: 'start' });
  });
  $('#hero-sample').addEventListener('click', event => showSample(event.currentTarget));
  // Set by initHeroVideo: closes the video if it is expanded over the page and
  // says whether it was, so Back can close it (see the popstate listener).
  let collapseHeroVideo = null;
  initHeroVideo();

  /**
   * The welcome hero's video, with a player of its own: a timing bar to drag,
   * play/pause, the time, mute, and full screen / back.
   *
   * It loops silently while it is on screen and pauses when it is not, unless
   * the reader paused it themselves, which it then respects. "Tap for sound"
   * (or a tap on the picture while it is silent) turns the sound on and starts
   * it again from the top so the voice is heard from its first line, plays it
   * once through, and at the end falls back to silent looping. For a reader who
   * asked for less motion it never starts on its own.
   *
   * Full screen takes the whole player, so the controls come with it, and
   * shows the 9:16 frame whole rather than cropped. Going full screen from the
   * silent loop turns the sound on and starts from the top.
   *
   * On a phone it does not use the browser's full screen at all: Android lays
   * its own "drag from top and touch back to exit" notice over any page that
   * does, and iPhone Safari would swap in its own player. Instead the player
   * expands to cover the window (.is-expanded), with a history entry so the
   * phone's Back closes it like any video player, as Esc does. The video also
   * opts out of casting (disableremoteplayback), which is what put a "cast to
   * screen" button in its corner on Android.
   */
  function initHeroVideo() {
    const video = $('#hero-video');
    const frame = video && video.closest('.hero-video');
    if (!video || !frame) return;
    const sound = $('#hero-video-sound');
    const play = $('#hero-video-play');
    const mute = $('#hero-video-mute');
    const full = $('#hero-video-full');
    const seek = $('#hero-video-seek');
    const time = $('#hero-video-time');
    const ICONS = {
      play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
      pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
      muted: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
      sound: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
      expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
      shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    };
    const icon = (button, name, label) => {
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    const still = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const clock = seconds => {
      const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };
    const fullElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    // A phone, or anything without real full screen for an element, expands the player over the page instead.
    const expandsInstead = () => (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      !(frame.requestFullscreen || frame.webkitRequestFullscreen);
    const expanded = () => frame.classList.contains('is-expanded');
    let expandedEntry = false;
    const setExpanded = on => {
      frame.classList.toggle('is-expanded', on);
      document.documentElement.classList.toggle('hero-video-open', on);
      paint();
    };
    collapseHeroVideo = fromHistory => {
      if (!expanded()) return false;
      setExpanded(false);
      if (expandedEntry && !fromHistory) popOwnEntry();
      expandedEntry = false;
      return true;
    };
    let onScreen = false;
    let heldByReader = false;
    video.setAttribute('aria-label', TEXT.heroVideoLabel);
    seek.setAttribute('aria-label', TEXT.heroVideoSeek);

    const paint = () => {
      icon(play, video.paused ? 'play' : 'pause', video.paused ? TEXT.heroVideoPlayShort : TEXT.heroVideoPause);
      icon(mute, video.muted ? 'muted' : 'sound', video.muted ? TEXT.heroVideoUnmute : TEXT.heroVideoMute);
      const isFull = fullElement() === frame || expanded();
      icon(full, isFull ? 'shrink' : 'expand', isFull ? TEXT.heroVideoExitFull : TEXT.heroVideoFull);
      // The big invitation only while it is silent.
      sound.hidden = !video.muted;
      sound.querySelector('.hero-video-text').textContent = still() && video.paused ? TEXT.heroVideoPlay : TEXT.heroVideoSound;
      sound.querySelector('.hero-video-icon').textContent = still() && video.paused ? '▶' : '🔇';
    };
    const tick = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0 && document.activeElement !== seek) seek.value = String(Math.round(video.currentTime / d * 1000));
      time.textContent = clock(video.currentTime) + ' / ' + (Number.isFinite(d) ? clock(d) : '–:––');
    };
    const frameLoop = () => { tick(); if (!video.paused) requestAnimationFrame(frameLoop); };
    const go = () => video.play().catch(() => {});
    // From the top, with sound, once through.
    const withSound = () => {
      heldByReader = false;
      video.muted = false;
      video.loop = false;
      video.currentTime = 0;
      go();
      paint();
    };
    // Back to the silent loop.
    const silent = () => {
      video.muted = true;
      video.loop = true;
      if (onScreen && !still() && !heldByReader) go();
      else video.pause();
      paint();
    };

    sound.addEventListener('click', withSound);
    video.addEventListener('click', () => {
      if (video.muted) withSound();
      else if (video.paused) { heldByReader = false; go(); }
      else { heldByReader = true; video.pause(); }
    });
    play.addEventListener('click', () => {
      if (video.paused) { heldByReader = false; go(); } else { heldByReader = true; video.pause(); }
    });
    mute.addEventListener('click', () => { if (video.muted) withSound(); else { video.muted = true; paint(); } });
    seek.addEventListener('input', () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) video.currentTime = Number(seek.value) / 1000 * d;
      tick();
    });
    full.addEventListener('click', () => {
      if (expanded()) { collapseHeroVideo(false); return; }
      if (fullElement()) {
        const leaving = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        if (leaving && leaving.catch) leaving.catch(() => {});
        return;
      }
      if (video.muted) withSound();
      if (expandsInstead()) {
        history.pushState({ psycheaiVideo: true }, '');
        expandedEntry = true;
        setExpanded(true);
        return;
      }
      try {
        const entering = frame.requestFullscreen ? frame.requestFullscreen() : frame.webkitRequestFullscreen();
        if (entering && entering.catch) entering.catch(() => {});
      } catch (error) { setExpanded(true); }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && expanded()) collapseHeroVideo(false); });
    document.addEventListener('fullscreenchange', paint);
    document.addEventListener('webkitfullscreenchange', paint);
    ['play', 'pause', 'volumechange'].forEach(name => video.addEventListener(name, paint));
    video.addEventListener('play', () => requestAnimationFrame(frameLoop));
    ['timeupdate', 'loadedmetadata', 'seeked'].forEach(name => video.addEventListener(name, tick));
    video.addEventListener('ended', () => {
      if (fullElement() === frame) {
        const leaving = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        if (leaving && leaving.catch) leaving.catch(() => {});
      }
      collapseHeroVideo(false);
      video.currentTime = 0;
      silent();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (fullElement() === frame || expanded()) return;
        if (!onScreen) video.pause();
        else if (video.muted && !still() && !heldByReader) go();
      }, { threshold: 0.4 }).observe(video);
    }
    paint();
    tick();
  }
  // Drawn with the insights block, after this runs, so the clicks are delegated.
  document.addEventListener('click', event => {
    const sample = event.target.closest('#insight-sample, .tier-sample');
    if (sample) { showSample(sample); return; }
    const card = event.target.closest('#insight-deck .insight-preview.is-front');
    if (card) { openInsightCard(Number(card.getAttribute('data-card')) || 0); return; }
    // The deck's arrows bring the next or the previous card to the front.
    const arrow = event.target.closest('.insight-deck-step');
    if (arrow) { stepDeck(Number(arrow.getAttribute('data-deck-step'))); return; }
    // Full screen, the arrows either side step through the cards.
    const step = event.target.closest('.sample-card-nav');
    if (step) stepInsightCard(Number(step.getAttribute('data-step')));
  });
  // A swipe across the deck brings the next card forward, or the last one back.
  {
    let start = null;
    document.addEventListener('touchstart', event => {
      const t = event.touches[0];
      start = event.touches.length === 1 && event.target.closest && event.target.closest('#insight-deck')
        ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    document.addEventListener('touchend', event => {
      if (!start) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) stepDeck(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  // Full screen, the cards step left and right by keyboard, by a swipe, and
  // by a sideways scroll on a trackpad or mouse; on the page, the arrow keys
  // step the deck while it has focus.
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const dialog = $('#sample-card-dialog');
    if (dialog && dialog.open) { stepInsightCard(step); return; }
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.insight-deck-wrap')) {
      stepDeck(step);
      const front = document.querySelector('#insight-deck .insight-preview.is-front');
      if (front && document.activeElement.closest('#insight-deck')) front.focus();
    }
  });
  {
    const dialog = $('#sample-card-dialog');
    let start = null;
    dialog.addEventListener('touchstart', event => {
      const t = event.touches[0];
      start = event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    dialog.addEventListener('touchend', event => {
      if (!start || !dialog.classList.contains('is-gallery')) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) stepInsightCard(dx < 0 ? 1 : -1);
    }, { passive: true });
    let swept = 0;
    let rested = 0;
    dialog.addEventListener('wheel', event => {
      if (!dialog.classList.contains('is-gallery') || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = Date.now();
      // One step per gesture: a trackpad's sideways flick sends dozens of events.
      if (now - rested < 450) return;
      swept += event.deltaX;
      if (Math.abs(swept) > 60) {
        stepInsightCard(swept > 0 ? 1 : -1);
        swept = 0;
        rested = now;
      }
    }, { passive: false });
    dialog.addEventListener('close', () => {
      // The deck is left with the card last looked at at its front.
      if (dialog.classList.contains('is-gallery')) { deckIndex = insightIndex; arrangeDeck(); }
      dialog.classList.remove('is-gallery');
    });
  }
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
    // A source row under Evidence and method: the same popout, by the flow
    // this report is on — the unlock on a free one, the re-run on a paid one.
    const source = event.target.closest('.source-read');
    if (source && source.dataset.flow === 'unlock') openPremiumDialog(source, 'unlock');
    else if (source) startRerun();
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
    const share = event.target.closest('.bonus-share');
    if (share && state.profile && state.profile.report && state.profile.report.bonus) {
      shareStoryImage(roastImageCanvas(state.profile.report.bonus), 'PsycheAI roast.png',
        shareMessage(), share.closest('.bonus-card').querySelector('.bonus-share-status'));
    }
  });

  // The part nav: jump to a part — opening it if the reader had shut it — in
  // whichever report (the reader's own or the sample) the nav belongs to.
  document.addEventListener('click', event => {
    const item = event.target.closest('.part-nav-item');
    if (!item) return;
    const scope = item.closest('.part-nav').parentElement;
    const target = scope && scope.querySelector('[data-part="' + item.getAttribute('data-part-target') + '"]');
    if (!target) return;
    const card = target.closest('.part-card');
    if (card) setSectionOpen(card, true);
    // On a phone, one part open at a time, as when its heading is tapped.
    if (card && window.matchMedia && window.matchMedia(PHONE_REPORT).matches) {
      for (const other of scope.querySelectorAll('.part-card')) if (other !== card) setSectionOpen(other, false);
    }
    // Part 00 starts with the Psyche Card at the top of the page.
    if (item.getAttribute('data-part-target') === 'overview' && item.closest('#profile-body')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Lands with the part's whole heading clear of whatever is pinned over
    // the top of the page: the site's header and, where it sticks rather than
    // sitting in the left column, this nav itself.
    const landing = card || target;
    landing.style.scrollMarginTop = pinnedHeight(item.closest('.part-nav')) + 'px';
    landing.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /** How much of the top of the scroller is covered by pinned bars, plus a little air. */
  function pinnedHeight(nav) {
    let height = 14;
    if (!nav.closest('dialog')) {
      const bar = document.querySelector('.nav');
      const position = bar && getComputedStyle(bar).position;
      if (position === 'sticky' || position === 'fixed') height += bar.getBoundingClientRect().bottom;
    }
    // Only a nav pinned across the top covers the part; one standing down the
    // side (the sample on a laptop) covers nothing.
    const navStyle = getComputedStyle(nav);
    if (navStyle.display !== 'none' && navStyle.position === 'sticky' && navStyle.flexDirection !== 'column') height += nav.getBoundingClientRect().height + 8;
    return Math.round(height);
  }

  // Ticking an action off the plan. Kept on this device only, by a hash of
  // the action's wording, under KEYS.plan — so Delete everything clears it.
  document.addEventListener('change', event => {
    const box = event.target.closest && event.target.closest('.plan-check');
    if (!box || box.disabled) return;
    const done = store.read(KEYS.plan, {}) || {};
    const key = box.getAttribute('data-plan-key');
    if (box.checked) done[key] = true; else delete done[key];
    store.write(KEYS.plan, done);
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
    // The heading, not the card around it, and measured before anything is
    // toggled — both halves matter and both were wrong first time.
    //
    // The position worth preserving is the one the reader's finger was on,
    // which is the heading. The card is not a stand-in for it: a shut card
    // carries reduced padding, so opening one pushes its own heading a few
    // pixels further down inside it. Anchor the card and the heading creeps
    // downward on every single toggle, by an amount too small to name and
    // large enough to feel over a session of opening sections.
    const host = opening ? scrollHostOf(card) : null;
    const touchedAt = opening ? viewportTopOf(head, host) : 0;
    setSectionOpen(card, opening);
    // Accordion, not a pile of open sections: opening one shuts every other
    // one already open in the same report, so the page stays as compact as
    // collapsing it in the first place was for — an index a reader picks one
    // thing from at a time, not a list that just regrows as they explore it.
    // Scoped to whichever report this card actually belongs to (the real one
    // or the sample dialog's), so opening a section in one never reaches
    // across and shuts a section in the other.
    // The structured report's parts all start open and open and shut on their
    // own: a reader moving between parts with the nav should not find the
    // one they left closed behind them.
    // On a phone the parts are an accordion too: opening one shuts the
    // others, and the opened part is brought to the top of the screen.
    const partOnPhone = card.classList.contains('part-card') && window.matchMedia &&
      window.matchMedia(PHONE_REPORT).matches;
    if (opening && (partOnPhone || !card.classList.contains('part-card'))) {
      const scope = card.closest('#profile-body, #sample-body') || document;
      for (const head2 of scope.querySelectorAll('.card-head-toggle')) {
        const other = head2.closest('.section-card');
        if (!other || other === card || other.contains(card)) continue;
        // A part shuts only other parts; a section inside one, its siblings.
        if (other.classList.contains('part-card') !== card.classList.contains('part-card')) continue;
        setSectionOpen(other, false);
      }

      // Put it back exactly where it was.
      //
      // Shutting a section that sat *above* the clicked one removes its whole
      // height from the flow, and everything below leaps up by however tall
      // that section happened to be — often most of a screen. This used to be
      // answered by scrolling the opened card to the top of the viewport
      // afterwards, which fixed where the reader ended up and not what they
      // saw on the way: an instant, uncontrolled jump followed by an animated
      // glide, from a position the jump had already invalidated. Two movements
      // where the reader asked for none, and on a heading clicked below the
      // previously-open section the glide ran *backwards*, so the page
      // appeared to overshoot and bounce.
      //
      // Correcting the scroll by exactly the distance the layout moved cancels
      // the jump instead of chasing it. The heading stays under the reader's
      // finger, the section above vanishes, the sections below slide up around
      // it, and the thing they are looking at does not move at all. Instantly
      // and unconditionally, because this is not an animation — it is the
      // absence of one.
      //
      // Measured after the loop rather than in a frame callback: those
      // `display: none` switches are synchronous and getBoundingClientRect
      // forces layout, so this reads the settled position rather than the
      // pre-collapse one.
      // Corrected, then checked and corrected again.
      //
      // One pass leaves a few pixels behind: scrolling and laying out settle
      // against each other, so the position measured immediately after the
      // collapse is not quite the position the browser ends up at once the
      // scroll has been applied. Two passes converge; a third has nothing left
      // to do. Cheap, and the alternative is a heading that creeps by a few
      // pixels on every toggle, which over a session of opening sections is
      // exactly the drift this is here to remove.
      for (let pass = 0; pass < 2; pass++) {
        const drift = viewportTopOf(head, host) - touchedAt;
        if (Math.abs(drift) < 1) break;
        scrollHostBy(host, drift);
      }

      // The one case anchoring alone handles badly: a heading near the bottom
      // of the screen, whose section now opens almost entirely below the fold.
      // Here a scroll is what the reader wants rather than something happening
      // to them — and it starts from a settled position instead of mid-leap,
      // so it reads as one deliberate movement.
      //
      // The offset that keeps the heading clear of the sticky nav lives in CSS
      // as .section-card's `scroll-margin-top`, so the two cannot drift the way
      // a hardcoded pixel figure here would the next time the nav changes
      // height. Inside the sample dialog that margin is smaller, because the
      // dialog's own head does not overlap its scrolling body.
      if (partOnPhone || viewportTopOf(card, host) > visibleHeightOf(host) * REVEAL_BELOW) {
        // A part lands clear of the pinned bars over it, the part nav among them.
        const partNav = partOnPhone && card.parentElement && card.parentElement.querySelector('.part-nav');
        if (partNav) card.style.scrollMarginTop = pinnedHeight(partNav) + 'px';
        card.scrollIntoView({ behavior: scrollBehaviour(), block: 'start' });
      }
    }
  });

  // Same reason: sourcesUsedHtml() writes this into #profile-body's innerHTML
  // on every render, so a listener bound once to the element itself would be
  // orphaned the next time the report redraws.
  document.addEventListener('click', event => {
    if (event.target.closest('#rerun-with-data')) startRerun();
  });

  // The button is the discoverable path and opens the popout. Drag-and-drop
  // survives on the card itself rather than in a box of its own: an Instagram
  // export arrives as several .zip parts, and dropping them together stays
  // faster than any picker. Nothing advertises it any more, which is the
  // trade — an accelerator for the people who already reach for it.
  // The download steps, written once in index.html (#howto-instagram and the
  // rest), copied into every list that shows them.
  for (const list of document.querySelectorAll('ol[data-howto]')) {
    const steps = document.getElementById('howto-' + list.dataset.howto);
    if (steps) list.replaceChildren(steps.content.cloneNode(true));
  }

  $('#open-sources').addEventListener('click', startFromSources);
  // Opens the walkthrough over the popout rather than instead of it: the
  // reader came here to load a file and is stepping aside to see how, so the
  // popout is left open underneath and is still there when the guide closes.
  $('#datasources-guide-open').addEventListener('click', event => {
    event.preventDefault();
    showGuide();
  });
  // The FAQ's "what file do I need" answer ends with the same offer, for the
  // reader who came here to find out rather than to load anything yet.
  $('#faq-guide-open').addEventListener('click', event => {
    event.preventDefault();
    showGuide();
  });
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('is-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
    handleFiles(event.dataTransfer.files);
  });
  // The value is cleared on every pick, and that is what keeps the box
  // working the second time.
  //
  // A file input only fires `change` when its value actually changes, so
  // choosing the *same* archive twice in a row fires nothing at all: the
  // reader clicks the box, the OS chooser opens, they pick the file they
  // picked a minute ago, and the page sits there. Which is exactly what
  // happens after abandoning an upload at the supplement offer — the most
  // likely next action is to pick that same file again, and it was the one
  // action that silently did nothing.
  //
  // handleFiles copies the list into an array on its first line, so clearing
  // here is safe even though `files` empties with the value. Both of the other
  // file inputs in this app already do this (see askSupplement and
  // askDataSources); the main dropzone was the one that never did.
  fileInput.addEventListener('change', () => {
    const picked = Array.from(fileInput.files || []);
    fileInput.value = '';
    handleFiles(picked);
  });

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
  // still had to reason about. Photographs followed them both — see the note
  // above COST_CAP in digest.js for why, and for what the freed budget bought.

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
  // actually goes out once they press Send.
  function applyReviewDecision(target, decision) {
    if (!decision.includeCaptions) Digest.omitCaptionsAndComments(target);
    if (!decision.includeLikedCaptions) Digest.omitLikedCaptions(target);
    if (!decision.includeActivity) Digest.omitActivity(target);
    if (!decision.includeAccounts) Digest.omitAccounts(target);
    if (!decision.includeTopics) Digest.omitTopics(target);
    if (!decision.includeMessages) Digest.omitMessages(target);
    // Each is a no-op when its block is absent, so a reader who added only
    // Google is unaffected by the Facebook keys being false.
    if (!decision.includeYouTube) Digest.omitYouTube(target);
    if (!decision.includeYouTubeSearches) Digest.omitYouTubeSearches(target);
    if (!decision.includeGoogleSearches) Digest.omitGoogleSearches(target);
    if (!decision.includeChrome) Digest.omitChrome(target);
    if (!decision.includeFacebookPosts) Digest.omitFacebookPosts(target);
    if (!decision.includeFacebookConnections) Digest.omitFacebookConnections(target);
    if (!decision.includeFacebookMessages) Digest.omitFacebookMessages(target);
    if (!decision.includeWhatsApp) Digest.omitWhatsApp(target);
    return target;
  }

  // A self-contained HTML page rather than a raw .json file — opens with a
  // double-click in whatever browser is already installed, no app that
  // understands JSON required. Inline CSS only, no external requests, so it
  // renders identically read offline a year from now. `rows` is askReview's
  // own row list, reused here so the category names and detail lines in this
  // table are read from the same place the checklist itself was, not typed
  // out a second time where they could drift.
  function buildDigestPreviewHtml(rows, decision, preview, deepRead) {
    // One digest serves both calls, and the file says so: a reader comparing
    // the free card with the premium report should know both read this.
    // The text the model is actually sent, the same measure the budget counts.
    const sentKb = Math.max(1, Math.round(Digest.evidenceChars(preview) / 1000));
    const sizeNote = 'About ' + sentKb + ' KB. ' + (deepRead ? TEXT.deepReviewNote
      : 'This same digest is what both your free summary card and the full premium report are read from.');
    const rowsHtml = rows.map(r => {
      const included = decision[r[1]];
      return '<tr><td>' + esc(r[3]) + '</td>' +
        '<td class="' + (included ? 'yes' : 'no') + '">' + (included ? 'Included' : 'Excluded') + '</td>' +
        '<td>' + esc(r[5]) + '</td></tr>';
    }).join('');

    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>What was sent to the AI model</title><style>' +
      'body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;' +
      'max-width:840px;margin:2rem auto;padding:0 1.5rem;color:#241a2e;background:#faf7fb}' +
      'h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}' +
      'table{border-collapse:collapse;width:100%;margin:1rem 0}' +
      'th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #e7dfec;font-size:.92rem}' +
      'td.yes{color:#2f7d5b;font-weight:600}td.no{color:#6b6076}' +
      'pre{background:#fff;border:1px solid #e7dfec;border-radius:10px;padding:1rem;' +
      'overflow-x:auto;font-size:.82rem;white-space:pre-wrap;word-break:break-word}' +
      '.muted{color:#6b6076;font-size:.9rem}' +
      '</style></head><body>' +
      '<h1>What was sent to the AI model</h1>' +
      '<p class="muted">Generated by PsycheAI on ' + esc(new Date().toLocaleString()) +
      '. This file was written directly to your device and was never uploaded anywhere.</p>' +
      '<table><thead><tr><th>Category</th><th>Status</th><th>Detail</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>' +
      '<h2>Full digest</h2>' +
      '<p class="muted">The exact object that is sent. Nothing accompanies it — no photographs, no ' +
      'files, nothing from your archive that is not written out below.</p>' +
      '<p class="muted digest-size">' + esc(sizeNote) + '</p>' +
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

  // This used to take a `getImages` lazy extractor alongside the digest, and a
  // count, and a "your photos could not be carried over" flag — three
  // parameters and a whole row of the checklist, all for a payload nothing
  // sends any more. Decoding and re-encoding a dozen photographs was also the
  // slowest thing this app did, which is why it was deferred to whichever of
  // Send or the download button asked first. All of that is gone with them.
  function askReview(digest, options) {
    const dialog = $('#review-dialog');
    const list = $('#review-list');
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
    const topicsCount = (digest.instagramTopics || []).length;
    const likedCaptionsCount = (digest.samples.likedPostCaptions || []).length;
    const likedTagsCount = (digest.samples.likedPostHashtags || []).length;

    // One row per checkbox — id, how many there are to send, the on/off
    // label, and the detail line. The single source both the checklist below
    // and the downloadable summary read their copy from, so the two
    // descriptions of the same seven things cannot quietly drift apart.
    // decisionKey lines up with currentDecision()'s shape by position.
    // "1 comment", "2 comments": a count with its noun in the right number.
    const n = (count, one, many) => count + ' ' + (count === 1 ? one : many);
    const rows = [
      ['review-captions', 'includeCaptions', captionsCount + commentsCount,
        'Your captions & comments', 'Your captions & comments — none found',
        n(captionsCount, 'caption', 'captions') + ', ' + n(commentsCount, 'comment', 'comments') +
        ' — a sample of your own words. Needed for any read at all.'],
      ['review-activity', 'includeActivity', 1,
        'Activity & timing', 'Activity & timing',
        'Post counts, likes, saves and when you tend to be active. Numbers only, no text.'],
      // The raw follow list is no longer sent — hundreds of opaque handles
      // that said almost nothing — so this row no longer offers it. How many
      // accounts they follow is still sent, as a number, under Activity &
      // timing where the other counts live. Naming follows here would be
      // promising to send something the digest does not contain, which is the
      // one thing a review screen must never do.
      // Its own row, and it has to be. Every other Instagram row offers the
      // reader's own words or their own numbers; this one offers text somebody
      // else wrote, on posts they liked. Folding it under "Accounts you engage
      // with" would send text under a heading that promises names — the
      // mirror image of the mistake the note below warns about, and the worse
      // direction to make it in.
      ['review-liked-captions', 'includeLikedCaptions', likedCaptionsCount + likedTagsCount,
        'Posts you liked', 'Posts you liked — none found',
        likedCaptionsCount + likedTagsCount ? n(likedCaptionsCount, 'caption', 'captions') + ' from posts you liked in ' +
          'the last year' + (likedTagsCount ? ', and the ' + n(likedTagsCount, 'hashtag', 'hashtags') +
          ' that came up most across all of them' : '') + ' — ' +
          'written by other people, kept because what you reach for says something about you.' :
          'This export did not include captions on the posts you liked.'],
      ['review-accounts', 'includeAccounts', engagedCount,
        'Accounts you engage with', 'Accounts you engage with — none found',
        n(engagedCount, 'name', 'names') + ' among who you like, save and comment on most.'],
      ['review-topics', 'includeTopics', topicsCount,
        'Instagram’s own inferred topics', 'Instagram’s own inferred topics — none found',
        n(topicsCount, 'topic', 'topics') + ' Instagram has already guessed you are interested in.'],
      ['review-dms', 'includeMessages', dmCount,
        'Direct messages', 'Direct messages — none found',
        dmCount ? dmCount + ' of your own ' + (dmCount === 1 ? 'message' : 'messages') + ' sampled out of ' + dmTotal + ' total. Some show a short, ' +
          'anonymised line of the message they answered; nothing else from the other side is included.' :
          'This export did not include any direct messages to sample.'],
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
      const visits = g.counts.visits || 0;
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
        // The list of site names is gone — on a real export it was
        // "google.com" 18,255 times and almost nothing else — so what this row
        // now offers is two numbers. Still its own switch, because a count of
        // how much somebody browses is still something to be asked about.
        ['review-chrome', 'includeChrome', visits,
          'Chrome browsing history', 'Chrome browsing history — none found',
          visits ? visits + ' visits across ' + (g.counts.distinctDomains || 0) +
            ' different sites, as two numbers. No site name, page, address or time.' :
            'No browsing history was found in this export.'],
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
          fbWriting ? n(fb.postSample.length, 'post', 'posts') + ' and ' + n(fb.commentSample.length, 'comment', 'comments') +
            ' — a sample of your own words on Facebook.' :
            'No Facebook posts or comments were found in this export.'],
        ['review-fb-connections', 'includeFacebookConnections', fbFriends,
          'Facebook friends & follows', 'Facebook friends & follows — none found',
          fbFriends ? fbFriends + ' names, sampled evenly across the list.' :
            'No Facebook connections were found in this export.'],
        ['review-fb-messages', 'includeFacebookMessages', fbMessages,
          'Facebook Messenger', 'Facebook Messenger — none found',
          fbMessages ? fbMessages + ' of your own messages sampled out of ' + fb.counts.messages +
            ' total. Some show a short, anonymised line of the message they answered; nothing else from the other side is included.' :
            'No Messenger history was found in this export.'],
      );
    }

    // WhatsApp: one switch for the lot — every number in it is about the
    // reader's private chats, so it goes whole or not at all.
    const wa = digest.whatsapp;
    if (wa) {
      const chats = (wa.chats || []).length;
      const waOwn = (wa.ownMessageSample || []).length;
      rows.push(['review-whatsapp', 'includeWhatsApp', chats,
        'WhatsApp chats', 'WhatsApp chats — none found',
        chats + (chats === 1 ? ' chat' : ' chats') + ': ' + waOwn + ' of your own messages, plus counts and timings. ' +
          'Some show a short, anonymised line of the message they answered; otherwise other people\u2019s messages ' +
          'were only counted, and nobody is named.']);
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
      // Synchronous now. It used to await a photo pass that took seconds, with
      // a re-entrancy guard and a progress label on the button, so a reader
      // could see the resized images that were about to be sent rather than
      // the originals on their disk. Nothing sends images any more, so what
      // this writes is the digest and nothing else.
      const download = () => {
        const decision = currentDecision();
        // Exactly what a model call is sent: the free card and the full premium
        // report both read this same object.
        const deepRead = Boolean(options && options.deep);
        const preview = Digest.forModel(applyReviewDecision(JSON.parse(JSON.stringify(digest)), decision), { deep: deepRead });

        const html = buildDigestPreviewHtml(rows, decision, preview, deepRead);
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
    // Where the reader was standing before the working screen covered the
    // page — almost always the dropzone, near the foot of a long welcome page.
    // Read before show('working'), which scrolls to the top itself, so this is
    // the position they actually chose rather than the one show() just imposed.
    const scrollBeforeUpload = window.scrollY;
    show('working');

    let digest;
    let decision = null;
    let signals;
    let uploadAuth = null;
    try {
      // Read everything the export has, unconditionally. The choice of what
      // to send used to gate this step, before the reader had seen any of
      // it; it now gates nothing here, because the choice moved to the
      // review dialog below, where it can be made against real content
      // rather than in advance of it.
      signals = await IG.readExports(chosen, {
        includeMessages: true,
        onProgress: p => setProgress(Math.round((p.total ? p.done / p.total : 0) * 70), p.label),
      });
      // The archive names the reader, so a stored card that lost their name
      // gets it back now, whatever they go on to do with this upload.
      repairOwnName(signals).catch(() => {});
      trackStep('export_loaded');

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
          // Back at the offer abandons the upload, and puts them back exactly
          // where they were rather than at the top of a page they never left.
          abandonUpload(scrollBeforeUpload);
          return;
        }
        signals.supplements = supplements;

        setProgress(80, 'Building your evidence summary…');
        await new Promise(resolve => setTimeout(resolve, 30));
        digest = Digest.build(signals, { includeMessages: true });

        decision = await askReview(digest, { paymentDue: mustPayForAnalysis() });
        if (decision !== REVIEW_BACK) break;
      }
    } catch (error) {
      showUploadError((error && error.message) || 'Could not read that archive.');
      return;
    }

    if (!decision) {
      // Escape at the review means the same thing Back at the offer does.
      abandonUpload(scrollBeforeUpload);
      return;
    }

    // Money last, and only once the reader has seen what they are buying.
    //
    // Two things had to be true before this line could be reached at all, and
    // both are reasons it is not one line earlier: the archive has parsed, so
    // nobody is charged for a file that turns out to be unusable; and the
    // review has been agreed, so nobody is charged before seeing exactly what
    // will be sent.
    //
    // Nothing is persisted above this point, so declining leaves the browser
    // exactly as it was.
    uploadAuth = await authoriseAnalysis();
    if (uploadAuth === false) {
      showUploadError(TEXT.analysisDeclined);
      return;
    }

    applyReviewDecision(digest, decision);

    state.digest = digest;
    // A Google or Facebook read stashed by an earlier report's own rerun
    // popout belongs to that report, not this fresh upload — see
    // pendingDataSourceReads' own declaration.
    pendingDataSourceReads = {};
    // Kept in memory only, and only for as long as this page lives — see
    // state.signals — so "Add / change data & re-run analysis" on the report
    // page can add a Google or Facebook export to this one later in the
    // session without asking for the Instagram export again.
    state.signals = signals;
    writeDigest(digest);
    await runAnalysis(digest, uploadAuth);
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
  // An export read inside askDataSources() but never carried through to a
  // completed run — Back was pressed, or the popout was otherwise closed
  // before Continue. Reading an archive is real work a reader already did;
  // losing the tick the moment they step back from *continuing* would make
  // Back read as "throw away what I just read" rather than its actual
  // meaning, "not right now". Keyed by source, holding the same value `read()`
  // produced so a later Continue can still send it. Cleared only when a
  // genuinely new report replaces this one (handleFiles) or once a run
  // actually commits the value into state.digest — at that point state.digest
  // and state.signals already carry it permanently, so holding a second copy
  // here would only be dead weight.
  //
  // Instagram was left out of this for a long time, on the grounds that
  // re-reading it is cheap and that every call already reflects state.digest.
  // Both are true of a reader who has a report and false of the person this
  // hurt: a first-timer has no digest at all, and `state.signals` is not set
  // until *after* the popout resolves, so pressing Back on the popout they
  // just loaded their export into threw the whole archive away and asked them
  // to find the file again. "Cheap" was measured in machine time. The reader
  // pays for it in going back to their downloads folder.
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
   * caller tells the two apart with `typeof value === 'object'`. A row read
   * successfully in an earlier call to this same function — even one that
   * ended in Back — still resolves as that same value here, via
   * pendingDataSourceReads, for all three sources.
   *
   * An uncommitted read outranks an already-committed one in that seed, and
   * the order is load-bearing. Seeded the other way round, a reader who
   * replaced an export, pressed Back and came again got `true` for that row —
   * "you already have this one" — and their replacement was dropped on
   * Continue without a word. The value in hand is always the newer answer.
   *
   * Nothing here touches state.digest, localStorage, or authoriseAnalysis —
   * reading an export is free, and Continue only hands the results back to
   * addDataAndRerun, which builds the digest the review dialog shows next.
   */
  function askDataSources(options) {
    const settings = options || {};
    const dialog = $('#datasources-dialog');
    const status = $('#datasources-status');
    const input = $('#datasources-input');
    // Which rows this entry point offers. The welcome page shows Instagram and
    // Google only — a first upload is not the moment to open a third door, and
    // the how-to card beside it recommends exactly those two — while the report
    // page still offers all three, so Facebook stays reachable for anybody who
    // wants it, one screen later. Hidden rather than removed from the markup:
    // one dialog, two audiences.
    const offered = settings.sources || ['instagram', 'google', 'facebook', 'whatsapp'];
    // The download instructions follow the rows. A reader on the welcome page
    // is offered Instagram and Google, so being walked through a Facebook
    // export they cannot load from here is noise; a reader on the report page
    // is offered Facebook and would otherwise get a row with no instructions
    // behind it. Hidden rather than deleted, for the same reason the row is:
    // one dialog, two audiences.
    for (const help of dialog.querySelectorAll('[data-help]')) {
      help.hidden = !offered.includes(help.dataset.help);
    }
    // A row's own sub-line has the same problem the title does: "Load a new
    // Instagram export .zip file here to replace it" describes replacing
    // something, and on a first upload there is nothing to replace. Overridden
    // per entry point, with the markup's own wording remembered the first time
    // so the report page — which really is offering a replacement — gets it
    // back. Restoring matters: the override works by overwriting the text, so
    // without it the welcome page's wording would stick for the rest of the
    // page's life.
    const sublines = settings.sublines || {};
    for (const row of dialog.querySelectorAll('.mode-option')) {
      const source = row.dataset.datasource;
      row.hidden = !offered.includes(source);
      const line = row.querySelector('.mode-body > .muted');
      if (!line) continue;
      if (line.dataset.defaultText === undefined) line.dataset.defaultText = line.textContent;
      line.textContent = sublines[source] || line.dataset.defaultText;
    }
    // Every list below is built from the visible rows, so a hidden source can
    // neither be ticked, read, nor resolved.
    const buttons = dialog.querySelectorAll('.mode-option:not([hidden])');
    $('#datasources-confirm-text').textContent = TEXT.cardChangeNote;
    $('#datasources-confirm').hidden = true;
    // Asked once per opening, at the unlock, before the first file picker.
    let warned = !settings.cardNote;
    $('#datasources-dialog-title').textContent = settings.title || TEXT.dataSourcesTitle;
    $('#datasources-dialog-blurb').textContent = settings.blurb || TEXT.dataSourcesBlurb;
    const digest = state.digest;
    const added = {
      // Seeded from the digest *and* from the archive held in memory. The
      // digest alone was wrong on the welcome page: a first upload has no
      // digest until the review has been agreed and paid for, so a reader who
      // loaded Instagram, pressed Continue, then pressed Back at the review
      // found the row unticked and was being told to load it again — the one
      // thing this popout exists to stop, at the moment it is most likely.
      // `state.signals` is set the moment an archive is read, which is exactly
      // the memory Instagram was missing.
      //
      // The digest can also go missing on its own while the report survives,
      // and a tick would then promise an archive the popout does not have;
      // with neither, the row is left unticked and reads as the one thing
      // still to do, which is what it is.
      instagram: pendingDataSourceReads.instagram || Boolean(digest || state.signals) || undefined,
      google: pendingDataSourceReads.google || Boolean(digest && digest.google) || undefined,
      facebook: pendingDataSourceReads.facebook || Boolean(digest && digest.facebook) || undefined,
      whatsapp: pendingDataSourceReads.whatsapp || Boolean(digest && digest.whatsapp) || undefined,
    };
    // The WhatsApp row says how many of its three chats are loaded.
    const waCount = () => (pendingDataSourceReads.whatsappChats || []).length ||
      (digest && digest.whatsapp && (digest.whatsapp.chats || []).length) || 0;
    const showWhatsAppCount = () => {
      const line = rowOf('whatsapp') && rowOf('whatsapp').querySelector('.mode-body > .muted');
      if (line) line.textContent = waCount() ? TEXT.whatsappRowSome(waCount()) : TEXT.whatsappRowEmpty;
    };
    // Asked only when the chats do not say which sender is the reader:
    // resolves the name picked, or null if the popout closes first.
    const askWho = candidates => new Promise(done => {
      const box = $('#datasources-who');
      const list = $('#datasources-who-list');
      $('#datasources-who-q').textContent = TEXT.whatsappWhoAreYou;
      list.replaceChildren(...candidates.map(name => {
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'btn btn-ghost wa-who-pick';
        pick.textContent = name;
        pick.addEventListener('click', () => { box.hidden = true; done(name); });
        return pick;
      }));
      box.hidden = false;
      dialog.addEventListener('close', () => { box.hidden = true; done(null); }, { once: true });
    });
    let pending = '';
    let busy = false;
    let cancelled = false;
    // Declared here and given its real value in the reset block below, with
    // the rest of the per-opening state. Initialising it at the declaration
    // instead looks right and does nothing: that block runs afterwards and
    // overwrites it.
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

    /**
     * Which sources are ticked, and whether the "reload them" note is showing.
     *
     * These two used to be worked out separately and could therefore disagree
     * — and did. A row's value is either the seeded `true`, meaning "this was
     * in the digest when the popout opened", or an object, meaning "read just
     * now". Replacing Instagram invalidates every seeded `true`: the old
     * Google fragment belongs to the archive that was just swapped out and
     * cannot be carried onto the new one. The note said exactly that, while
     * the tick — which only asked whether the value was truthy — went on
     * saying Google was loaded. A reader saw "your Google data starts afresh,
     * load it again" directly above a green tick claiming it was already
     * there.
     *
     * So both now read one predicate — and it is not the obvious one. "Was
     * this tick seeded rather than freshly read" is the wrong question, and
     * getting it wrong is easy: what actually decides whether Google survives
     * an Instagram replacement is whether an *in-memory* copy of it exists for
     * the caller to merge forward. addDataAndRerun reads
     * `state.signals.supplements` before reassigning `state.signals` to the
     * fresh Instagram read, so a source held there rides across the
     * replacement untouched; one that exists only in the stored digest does
     * not, because a fresh export carries no supplements of its own.
     *
     * The two cases look identical at the seed — `Boolean(digest.google)`
     * short-circuits to `true` before it ever looks at the in-memory read — so
     * both had to be asked about separately. `state.signals` is null on a page
     * that has just loaded and is only ever set by reading an archive, which
     * is exactly the difference:
     *
     *   · Google loaded earlier *this session* → in memory → survives → stays
     *     ticked, no note.
     *   · Google only in the stored digest, page freshly loaded → nothing in
     *     memory → genuinely dropped → tick goes, note appears.
     *
     * The second is what a reader who comes back to the site and replaces
     * their export hits, and it is the case that produced the complaint.
     */
    const carriedInMemory = source =>
      Boolean(state.signals && state.signals.supplements && state.signals.supplements[source]) ||
      Boolean(pendingDataSourceReads[source]) ||
      typeof added[source] === 'object';

    const isStale = source =>
      replacedInstagram && Boolean(added[source]) && !carriedInMemory(source);

    const markAdded = () => {
      for (const button of buttons) {
        const source = button.dataset.datasource;
        const isAdded = Boolean(added[source]) && !isStale(source);
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
      // The same predicate the ticks use, so the two can never again say
      // different things about the same row. An object there — whether just
      // read, or carried forward from an earlier attempt via
      // pendingDataSourceReads — is exactly the "reload it here" the note
      // asks for, already done, so warning about it would be noise.
      // Recomputed on every call rather than fixed the moment Instagram is
      // replaced, so reading Google or Facebook afterwards can still resolve
      // the very risk this note exists to name.
      $('#datasources-instagram-note').hidden = !(isStale('google') || isStale('facebook') || isStale('whatsapp'));
      showWhatsAppCount();
    };

    return new Promise(resolve => {
      const pick = source => {
        pending = source;
        input.value = '';
        input.click();
      };
      // Over an existing card, the first tap says the card may change, and
      // "Choose file" opens the picker from its own click.
      const confirmFirst = source => {
        const box = $('#datasources-confirm');
        const close = () => {
          box.hidden = true;
          dialog.removeEventListener('cancel', onEscape);
          dialog.removeEventListener('close', close);
        };
        const onEscape = event => { event.preventDefault(); close(); };
        $('#datasources-confirm-go').onclick = () => { warned = true; close(); pick(source); };
        $('#datasources-confirm-cancel').onclick = close;
        box.onclick = event => { if (event.target === box) close(); };
        dialog.addEventListener('cancel', onEscape);
        dialog.addEventListener('close', close);
        box.hidden = false;
        $('#datasources-confirm-go').focus();
      };
      const choose = event => {
        const source = event.currentTarget.dataset.datasource;
        if (busy) return;
        if (!warned) { confirmFirst(source); return; }
        pick(source);
      };

      const read = async () => {
        // A WhatsApp chat may arrive as the .txt on its own; everything else is a .zip.
        const files = Array.from(input.files || []).filter(f =>
          (pending === 'whatsapp' ? /\.(zip|txt)$/i : /\.zip$/i).test(f.name));
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
              includeMessages: true,
              onProgress: p => setSourceProgress(source,
                Math.round((p.total ? p.done / p.total : 0) * 100), p.label),
            });
            replacedInstagram = true;
            trackStep('export_loaded');
            // Kept even if this call ends in Back, the same as the two below.
            // The archive is minutes of the reader's phone doing real work and
            // a trip to wherever they saved the file; a Back press means "not
            // right now", not "discard that".
            pendingDataSourceReads.instagram = added.instagram;
          } else if (source === 'whatsapp') {
            const fresh = await window.PsycheWhatsApp.readChats(files, {
              onProgress: p => setSourceProgress(source, p.phase === 'done' ? 100
                : Math.round(10 + (p.total ? p.done / p.total : 0) * 85), p.label),
            });
            // Up to three chats, added to what is loaded; a fourth starts a fresh set.
            const held = pendingDataSourceReads.whatsappChats || [];
            const startOver = held.length + fresh.length > 3 && held.length >= 3;
            const chats = (startOver ? fresh : held.concat(fresh)).slice(0, 3);
            const hints = [ownDisplayName(), state.profile && state.profile.card && state.profile.card.name].filter(Boolean);
            let owner = window.PsycheWhatsApp.resolveOwner(chats, hints).owner;
            if (!owner) {
              setSourceProgress(source, null, '');
              owner = await askWho(window.PsycheWhatsApp.resolveOwner(chats, hints).candidates);
              if (!owner) { setBusy(false); return; }
            }
            added.whatsapp = window.PsycheWhatsApp.summarise(chats, owner);
            pendingDataSourceReads.whatsapp = added.whatsapp;
            pendingDataSourceReads.whatsappChats = chats;
            if (startOver) {
              setBusy(false);
              setSourceProgress(source, null, '');
              say(TEXT.whatsappFull, '');
              markAdded();
              return;
            }
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

      say(settings.notice || '', settings.notice ? 'bad' : '');
      cancelled = false;
      // True from the outset when an uncommitted Instagram read is being
      // carried in, because from the stored digest's point of view the
      // replacement is still pending — Back did not undo it, it deferred it.
      // Flat `false` here dropped the note warning that a replaced Instagram
      // takes Google with it, and put the Google tick back, on exactly the
      // second visit where the reader has already been told once that it is
      // fine.
      replacedInstagram = Boolean(pendingDataSourceReads.instagram);
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
        collected = await askDataSources({ cardNote: true });
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
      repairOwnName().catch(() => {});

      if (state.signals) {
        state.signals.supplements = Object.assign({}, priorSupplements,
          typeof collected.google === 'object' ? { google: collected.google } : null,
          typeof collected.facebook === 'object' ? { facebook: collected.facebook } : null,
          typeof collected.whatsapp === 'object' ? { whatsapp: collected.whatsapp } : null);
      }

      const outcome = await rerunWithAdditionalData({
        google: typeof collected.google === 'object' ? collected.google : undefined,
        facebook: typeof collected.facebook === 'object' ? collected.facebook : undefined,
        whatsapp: typeof collected.whatsapp === 'object' ? collected.whatsapp : undefined,
      }, typeof collected.instagram === 'object' ? priorSupplements || {} : null);
      // Anything other than Back is terminal: the run happened, the payment
      // was declined, the reader pressed Escape, or something failed and has
      // already written its own message to #profile-alert.
      if (outcome !== REVIEW_BACK) return;
    }
  }

  // `freshInstagram` is set — to the supplements the replaced export had —
  // only when an Instagram export was loaded again on the way here.
  async function rerunWithAdditionalData(extraSupplements, freshInstagram) {
    // Once premium is unlocked, "Add / change data & re-run" stops being the
    // US$2 free-only re-run: the four paid sections are sitting on evidence
    // this new data is about to make stale, so the US$5 unlock price now
    // buys a regeneration of everything together — see the branch below.
    const alreadyUnlocked = Object.keys(paidAnalysis()).length > 0;

    // Present only in the same session as the upload — either the original
    // one, or a fresh Instagram export just read by askDataSources above.
    // With it the digest is rebuilt from the archive; without it, the stored
    // digest is reviewed as a copy, merged with whatever Google or Facebook
    // data this call was handed.
    //
    // The two used to differ in more than that: a rebuild carried photographs
    // and a merge could not, which is why the review had a row explaining
    // that photos "cannot be included when adding data to a saved report".
    // Nothing sends photographs now, so the two paths produce the same kind
    // of digest and that row is gone with them.
    const signals = state.signals;
    let digest;

    if (signals) {
      digest = Digest.build(signals, { includeMessages: true });
    } else if (state.digest) {
      digest = JSON.parse(JSON.stringify(state.digest));
      if (extraSupplements) digest = Digest.addSupplements(digest, extraSupplements, { ownHandle: ownHandle(), ownName: ownDisplayName() });
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

    // Once premium is unlocked the run this pays for writes the full report
    // too, so what is reviewed and sent is the premium read: the card's own
    // digest with the sources added here on top (premiumDigestFrom), or the
    // standard digest of an Instagram export loaded again with them. The
    // standard digest beside it takes the same decisions.
    let premium = null;
    if (alreadyUnlocked) {
      const adding = Object.values(extraSupplements || {}).some(Boolean);
      let base = state.digest || digest;
      if (freshInstagram && signals) {
        base = adding ? Digest.build(Object.assign({}, signals, { supplements: Object.assign({}, freshInstagram) }), { includeMessages: true }) : digest;
      }
      premium = premiumDigestFrom(base, extraSupplements);
      if (!premium || !premium.__deep) premium = null;
    }

    let decision;
    try {
      decision = await askReview(premium || digest,
        { paymentDue: alreadyUnlocked || mustPayForAnalysis(), deep: Boolean(premium) });
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
      // One US$5 charge regenerates everything together — the free report
      // and all four premium sections — against this reviewed digest.
      // Reuses runPremiumAnalysis's own bundled-refresh mechanism (built for
      // adding data on the way to a first unlock) via pendingPremiumDigest,
      // rather than a second copy of it. runAnalysis is deliberately never
      // called on this branch: it replaces state.profile wholesale, which is
      // what would wipe the premiumAnalysis this same charge is about to
      // write — see the comment that used to sit where this branch is now.
      applyReviewDecision(digest, decision);
      if (premium) {
        applyReviewDecision(premium, decision);
        premium.__standard = digest;
        premium.__fresh = true;
      }
      // Kept until the charge has bought something: a reader who cancels the
      // payment sheet and comes back finds Google and Facebook still loaded.
      // Cleared in runPremiumAnalysis once the run succeeds.
      await openPremiumDialog($('#rerun-with-data'), 'rerunAll', premium || digest);
      return;
    }

    // Money last, in the same place the first upload asks: after the review.
    // Declining costs nothing — the report and digest the reader arrived with
    // are untouched.
    const auth = await authoriseAnalysis();
    if (auth === false) { flash('#profile-alert', TEXT.analysisDeclined); return; }

    applyReviewDecision(digest, decision);

    state.digest = digest;
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
    await runAnalysis(digest, auth);
  }

  // The waiting screen speaks as the product, not as whichever model the
  // server happens to be configured with. The provenance line at the foot of
  // the finished report still names the actual model that wrote it.
  function modelName() {
    return 'PsycheAI';
  }

  async function runAnalysis(digest, auth) {
    // The same digest the unlock will send, so the card and the full premium
    // report read identical evidence. The server bounds it again either way.
    const sent = Digest.forModel(digest);
    $('#working-title').textContent = modelName() + ' is reading your profile';
    $('#working-note').textContent =
      'A ' + Math.round((sent.coverage.digestChars || 0) / 1000) + 'KB summary was sent for ' +
      'analysis. It usually takes up to a minute for the personality analysis to be ' +
      'completed. Please be patient.';
    startElapsed('Analysing');
    show('working');

    // This call runs for minutes, and a reader reaching for the back button —
    // on a phone, the most natural gesture for "get me off this screen" —
    // would otherwise navigate away with nothing pushed here to stop it,
    // aborting the fetch and losing the analysis with no warning at all. The
    // same guard runPremiumAnalysis already carries for the same reason.
    guardUnload(true);
    // Before the call, for the same reason rememberUnlock is: this exists to
    // survive the tab dying *during* the call. Only for a paid run — a free
    // one costs nothing to repeat and needs no record that it was owed.
    if (auth) rememberPending('analysis', auth);
    // Held before the call rather than in the catch, and holding the digest
    // object itself rather than a copy, so that a retry sends the same bytes
    // the server already has an answer to.
    lastAttempt = { digest, auth };
    try {
      const result = await LLM.analyseProfile(sent, await withAttribution(auth),
        { onJob: key => rememberJob(key, 'analysis', auth) });
      await adoptProfile(result);
    } catch (error) {
      // Terminal: whatever the job was, it is not coming. Cleared so a later
      // visit does not sit polling for something the server has already given
      // up on — the reader is being offered a retry instead, which is a better
      // answer than a spinner.
      clearJob();
      // The server knows this Instagram account has had its free card: the
      // run is offered at the re-run price instead, over the same digest.
      if (error && error.freeUsed && !auth) {
        if (runCount() < freeAnalyses) store.write(RUNS_KEY, freeAnalyses);
        stopElapsed();
        guardUnload(false);
        analysisNote = TEXT.freeUsedBlurb;
        const paid = await authoriseAnalysis();
        analysisNote = '';
        if (paid) return runAnalysis(digest, paid);
        offerRetry(error.message);
        return;
      }
      offerRetry((error && error.message) || 'The analysis failed.');
    } finally {
      stopElapsed();
      guardUnload(false);
    }
  }
  // Said on the US$2 sheet when it opens because the account's free card is spent.
  let analysisNote = '';

  /**
   * Take delivery of a finished report, from wherever it arrived.
   *
   * Extracted from runAnalysis because there are two ways in now: the call
   * that started the work, and a page that rejoined it after the tab that
   * started it was closed. Both have to store, count and render identically —
   * two copies of this would be two chances for a resumed report to be worth
   * slightly less than a waited-for one.
   */
  async function adoptProfile(result, savedName) {
    // In hand. Nothing is owed any more, so the offers to collect it go away
    // before anything else can fail below and leave them standing.
    clearPending();
    clearJob();
    // The name on the shareable card, put back where the redaction took it.
    //
    // Most accounts have a display name, which is what `profile.name` carries
    // and what the model names the card after. An account without one falls
    // back to its handle — and the handle is now a placeholder, so the model
    // has nothing to work from and calls them "user". Stitching the real one
    // in here is the fix, and it is a better arrangement than sending it: the
    // name reaches the QR code the reader chooses to share, and never reaches
    // the model at all.
    //
    // Only where the model actually returned the placeholder, so a real name
    // it was given is never overwritten. The name comes from the archive in
    // memory or, on a page that rejoined the job after the first was closed,
    // from the job record written when it started (see ownNameFrom).
    const realName = ownNameFrom(savedName);
    if (realName) result = Object.assign({}, result, { data: withOwnName(result.data, realName) });
    const freeFields = cardFieldsFrom(result.data.card, result.data);
    const payload = await Card.encodeCard(freeFields);
    state.profile = {
      report: result.data,
      card: Card.shape(freeFields),
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

    // A friend's link waiting is not run here: the reader sees their own
    // card first, and the sync is a tap away on it (refreshSyncInvite).
    renderProfile();
    show('profile');
  }

  /**
   * Rejoin an analysis this page did not start.
   *
   * The whole point of the job record. A reader who runs an analysis and then
   * closes everything is not losing anything any more — the work carries on
   * where it always did, on the server, and the next page to open goes back to
   * the waiting screen and picks it up. Thirty seconds later or two hours
   * later makes no difference to it.
   *
   * Nothing is offered and nothing is asked: this is not a purchase awaiting
   * collection, it is a report already being written, so the honest thing to
   * show is the same waiting screen they left.
   */
  // One at a time. resumeRunningJob() is reached from boot and from every
  // return to visibility, and a phone that is put down and picked up three
  // times would otherwise have three loops polling the same job and three
  // reports racing to be adopted.
  let resuming = false;

  async function resumeRunningJob() {
    const job = runningJob();
    if (!job || resuming) return false;
    // A comparison needs the other person's card to render at all, and a paid
    // section needs a profile to attach to. Neither survives without them, so
    // a record missing what its kind requires is dropped rather than resumed
    // into a half-rendered screen.
    if (job.kind === 'compatibility' && !(job.other && state.profile)) { clearJob(); return false; }
    if ((job.kind === 'premium' || job.kind === 'full' || job.kind === 'explain') && !state.profile) {
      clearJob();
      return false;
    }

    resuming = true;
    const comparing = job.kind === 'compatibility';
    $('#working-title').textContent = comparing
      ? modelName() + ' is comparing you'
      : modelName() + ' is reading your profile';
    $('#working-note').textContent = TEXT.resumingJob;
    startElapsed(comparing ? 'Assessing ' + state.profile.card.name + ' and ' + job.other.name
      : 'Analysing');
    show('working');
    // So the retry offer has something to repeat if this job turns out to be
    // gone. Only for the free report: the other two have offers of their own
    // — an unlock receipt and a pending-purchase record — which know how to
    // ask for the right thing, and a "Try again" that re-ran the free report
    // in place of paid sections would be worse than no button.
    if (job.kind === 'analysis' && state.digest) {
      lastAttempt = { digest: state.digest, auth: job.auth || null };
    }
    try {
      const result = await LLM.resumeJob(job.key);
      clearJob();
      if (job.kind === 'premium') adoptPremium(result);
      else if (job.kind === 'full' || job.kind === 'explain') {
        // The unlock's one call: the written report and the four premium
        // sections, laid under the card the reader has. ('explain' is the
        // record a page from the previous deploy wrote for the same thing.)
        await adoptFullReport(result, Boolean(job.replaceCard), job.ownName);
        renderProfile();
        show('profile');
        openPaidSections();
      } else if (comparing) adoptComparison(result, job.other, job.mode, job.stance);
      else await adoptProfile(result, job.ownName);
      return true;
    } catch (error) {
      clearJob();
      // Only the free report has a retry to offer. For the other two the
      // honest move is to put the reader back where they were and let the
      // offer that already exists for an uncollected purchase do its job —
      // it is the one that knows a payment is involved.
      if (job.kind === 'analysis') {
        offerRetry((error && error.message) || 'The analysis failed.');
      } else if (state.profile) {
        renderProfile();
        show('profile');
        flash('#profile-alert', (error && error.message) || 'That did not come through.');
        offerPendingWork();
      } else {
        offerRetry((error && error.message) || 'The analysis failed.');
      }
      return false;
    } finally {
      resuming = false;
      stopElapsed();
    }
  }

  /**
   * Put the failure and its remedy in the same place, on top of wherever the
   * reader already is.
   *
   * The welcome page's own error line is still written underneath, so closing
   * this leaves a page that explains itself rather than one that looks as
   * though nothing happened. But the dialog is what a reader on a phone
   * actually meets: the alternative was an error somewhere down a long page,
   * found by scrolling, acted on by scrolling back.
   */
  function offerRetry(message) {
    showUploadError(message, { retry: true });
    const dialog = $('#analysis-error-dialog');
    if (!dialog || !lastAttempt) return;
    $('#analysis-error-message').textContent = message;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeRetryDialog() {
    const dialog = $('#analysis-error-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  // Both buttons and the retry on the page below run the same two lines, so
  // there is one definition of what trying again means.
  async function retryLastAttempt() {
    if (!lastAttempt) return;
    closeRetryDialog();
    flash('#upload-error', '');
    $('#upload-retry').hidden = true;
    await runAnalysis(lastAttempt.digest, lastAttempt.auth);
  }

  $('#analysis-error-retry').addEventListener('click', retryLastAttempt);
  $('#analysis-error-close').addEventListener('click', closeRetryDialog);

  // One press, straight back into the same call. Deliberately not routed
  // through startFromSources: that reopens the popout and the review to
  // rebuild a digest this already holds, which is three steps for a reader who
  // asked for none of them and a different cache key at the end of it.
  $('#upload-retry').addEventListener('click', retryLastAttempt);

  // ══════════════ 2. profile report ══════════════



  // The long form of the reader's one link, for a server that cannot keep
  // short ones: the card after the #, and the invite code with it, so it
  // does everything the short link does.
  function profileUrl(payload) {
    return location.origin + location.pathname + (referralCode ? '?ref=' + referralCode : '') + '#p=' + payload;
  }

  // ---------- the short personal link ----------
  //
  // psycheai.io/c/<id>#<key>, one per reader, doing what the long compatibility
  // link and the ?ref= invite link did between them (lib/links.js). The card
  // is locked here (AES-GCM) before it is saved; the key is the part after
  // the #, which browsers never send to a server, so what PsycheAI keeps it
  // cannot read. Saved once per card, in the background after the report
  // renders, so a share button can hand it over at once; until then — or on
  // a server without a store that survives a deploy — the long link is used.
  const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0));
  async function linkCipherKey(material) {
    const raw = await crypto.subtle.digest('SHA-256', fromB64url(material));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function lockCard(payload, material) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv },
      await linkCipherKey(material), new TextEncoder().encode(payload)));
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv);
    out.set(sealed, iv.length);
    return b64url(out);
  }
  async function unlockCard(blob, material) {
    const bytes = fromB64url(blob);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await linkCipherKey(material), bytes.slice(12));
    return new TextDecoder().decode(plain);
  }

  // What the card looks like, beside what it says: the character, the two
  // lines on why, and how firmly each type letter was picked. The
  // compatibility read never needs these, so they are not in the card payload
  // (docs/card.js) and the long link is no longer for them. They travel only
  // inside the locked short link, so a friend who opens it sees the card the
  // way its owner does — the same card the owner posts as an image.
  function cardFace(report) {
    const r = report || {};
    const essence = r.essence || {};
    return {
      c: String(essenceName(essence)).slice(0, 40),
      fr: String(essence.franchise || '').slice(0, 30),
      i: String(essence.icon || '').slice(0, 8),
      w: splitSentences(cardBlurb(r)).slice(0, 2).join(' ').slice(0, 420),
      s: ((r.mbti || {}).letters || []).slice(0, 4).map(l => String((l && l.strength) || '').slice(0, 10)),
      // The patterns' names in full; the payload cuts them for the comparison.
      p: signaturePatterns(r).map(p => String(p.name).slice(0, 80)),
      // The card's lists exactly as its owner sees them, so a friend's view
      // has no gaps where the payload is shorter or was written without them:
      // motivators, values & beliefs, interests, and how they receive and
      // show care.
      m: cardMotivators(r).slice(0, 3),
      v: faceTitles(r.values, 3).concat(faceTitles(r.beliefs, 1)).slice(0, 4),
      n: faceTitles(r.interests, 3),
      lr: faceLove(r, 'receiving'),
      lg: faceLove(r, 'giving'),
    };
  }
  const faceTitles = (rows, limit) => titlesOf(rows, limit).map(t => String(t).slice(0, 40));
  function faceLove(report, side) {
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    return (love[side] || []).slice(0, 2).filter(l => l && l.language).map(l => String(l.language).slice(0, 30));
  }
  /** A short link's contents: the card payload, and its face where the link carries one. */
  function openedCard(text) {
    const raw = String(text || '');
    if (raw.charAt(0) !== '{') return { payload: raw, face: null };
    try {
      const sealed = JSON.parse(raw);
      return { payload: String(sealed.p || ''), face: sealed.f && typeof sealed.f === 'object' ? sealed.f : null };
    } catch (error) {
      return { payload: '', face: null };
    }
  }

  // The reader's short link once it is saved for the card on screen.
  let shortLink = '';
  let publishing = null;
  /**
   * The card's fields for its link, with what the card itself shows filled
   * in where the call that wrote them left a gap: the motivators (a paid
   * re-run's card can come without them) and how they show care.
   */
  function cardFieldsFrom(fields, report) {
    const out = Object.assign({}, fields || {});
    if (!report) return out;
    if (!(Array.isArray(out.motivators) && out.motivators.length)) out.motivators = cardMotivators(report);
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    for (const [key, side] of [['loveReceiving', 'receiving'], ['loveGiving', 'giving']]) {
      const shown = (love[side] || []).slice(0, 2).filter(l => l && l.language)
        .map(l => l.language + (l.strength ? ' (' + l.strength + ')' : ''));
      if (shown.length > (Array.isArray(out[key]) ? out[key].length : 0)) out[key] = shown;
    }
    return out;
  }
  /** A card saved with those gaps is mended in place before its link is published. */
  async function mendCardPayload() {
    const profile = state.profile;
    if (!profile || !profile.card || !profile.report) return;
    const mended = cardFieldsFrom(profile.card, profile.report);
    const before = Card.shape(profile.card);
    const after = Card.shape(mended);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    profile.card = after;
    profile.payload = await Card.encodeCard(mended);
    store.write(KEYS.profile, profile);
  }

  async function publishShortLink() {
    if (!state.profile || !state.profile.payload || !(state.server && state.server.shortLinks)) return '';
    if (publishing) return publishing;
    publishing = (async () => {
      try {
        await mendCardPayload();
        const mine = await ensureReferral();
        if (!mine) return '';
        let link = store.read(KEYS.link, null) || {};
        if (!/^[A-Za-z0-9_-]{16}$/.test(link.key || '')) {
          link = { key: b64url(crypto.getRandomValues(new Uint8Array(12))) };
        }
        const sealed = JSON.stringify({ p: state.profile.payload, f: cardFace(state.profile.report) });
        const card = (await sha256Hex(sealed)).slice(0, 16);
        if (link.id && link.card === card && link.secret === mine.code) {
          shortLink = location.origin + '/c/' + link.id + '#' + link.key;
          return shortLink;
        }
        let blob = await lockCard(sealed, link.key);
        // Past what the server keeps (lib/links.js), the card goes without its face.
        if (blob.length > 4096) blob = await lockCard(state.profile.payload, link.key);
        const answer = await LLM.postWithTicket('api/link/save', { secret: mine.secret, blob });
        if (!answer || !/^[A-Za-z0-9_-]{10}$/.test(answer.id || '')) return '';
        store.write(KEYS.link, { key: link.key, id: answer.id, card, secret: mine.code });
        shortLink = location.origin + '/c/' + answer.id + '#' + link.key;
        return shortLink;
      } catch (error) {
        return '';
      } finally {
        publishing = null;
      }
    })();
    return publishing;
  }
  /** The link a reader shares: the short one when it is ready, the long one until then. */
  function myLinkUrl() {
    if (shortLink) return shortLink;
    return state.profile && state.profile.payload ? profileUrl(state.profile.payload) : inviteUrl();
  }
  /** The one share message, everywhere: "I got <character> on my Psyche Card…" and the reader's link. */
  function shareMessage() {
    const report = state.profile && state.profile.report;
    return TEXT.cardShareText(report && report.essence && report.essence.character, myLinkUrl());
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
  /** The sources rows on their own: a tick for each one this report's digest carries. */
  function sourceRowsHtml() {
    const digest = state.digest;
    return [
      { icon: '📷', label: TEXT.sourceInstagram, loaded: Boolean(digest) },
      { icon: '🔍', label: TEXT.sourceGoogle, loaded: Boolean(digest && digest.google) },
      { icon: '📘', label: TEXT.sourceFacebook, loaded: Boolean(digest && digest.facebook) },
      { icon: '💬', label: TEXT.sourceWhatsApp, loaded: Boolean(digest && digest.whatsapp) },
    ].map(row =>
      '<li class="source-row"><span class="source-name">' + esc(row.icon) + ' ' + esc(row.label) + '</span>' +
      (row.loaded
        ? '<span class="source-tick" role="img" aria-label="' + esc(TEXT.sourceLoaded) + '">✓</span>'
        : '<span class="source-cross" role="img" aria-label="' + esc(TEXT.sourceMissing) + '">✕</span>') +
      '</li>').join('');
  }

  function sourcesUsedHtml(brief) {
    const digest = state.digest;
    const rows = [
      // Not hardcoded true, which it was: the digest is a separate store from
      // the profile and can go missing on its own, so missing means missing.
      { loaded: Boolean(digest) },
      { loaded: Boolean(digest && digest.google) },
      { loaded: Boolean(digest && digest.facebook) },
      { loaded: Boolean(digest && digest.whatsapp) },
    ];
    const rowsHtml = sourceRowsHtml();
    const anyMissing = rows.some(row => !row.loaded);

    return '<div class="trust-sources">' +
      '<h3>' + esc(TEXT.sourcesUsed) + '</h3>' +
      // A missing Instagram export is a different message from a missing
      // supplement: the ordinary hint invites a reader to *raise* their
      // confidence by adding Google or Facebook, which is beside the point
      // when the evidence the report was written from is the thing that has
      // gone. This one says what happened and what re-running will ask for.
      (!digest ? '<p class="muted">' + esc(TEXT.sourcesInstagramLost) + '</p>'
        : anyMissing ? '<p class="muted">' + esc(brief ? Copy.STRUCTURED.sourcesHint : TEXT.sourcesUsedHint) + '</p>' : '') +
      '<ul class="source-list">' + rowsHtml + '</ul>' +
      '<div class="btn-row">' +
      '<button class="btn" id="rerun-with-data" type="button">' + esc(TEXT.rerunAnalysis) + '</button>' +
      '</div>' +
      // Unconditional once premium is unlocked — that US$5 is not tied to
      // the free-run allowance mustPayForAnalysis() tracks, so the note has
      // to say so even for a reader with free runs left. See
      // rerunWithAdditionalData's own alreadyUnlocked branch.
      (Object.keys(paidAnalysis()).length
        ? '<p class="fineprint" id="rerun-price-note">' + esc(TEXT.analysisPriceNoteUnlocked) + '</p>'
        : mustPayForAnalysis()
          ? '<p class="fineprint" id="rerun-price-note">' + esc(TEXT.analysisPriceNote) + '</p>' : '') +
      '</div>';
  }

  // The trajectory chip beside an interest or a value: how the thing has moved
  // across the span of the data, not whether it is there. Rendered as its own
  // pill rather than folded into the intensity one — they answer different
  // questions ("how much" against "still?") and a reader scanning for the
  // second should not have to parse the first. Dormant and declining get their
  // own colour, because those are the two the reader is most likely to want to
  // argue with, and burying them would be the whole point missed.
  //
  // Silent when the model returns nothing, which is what an old report saved
  // before these fields existed looks like — see TRAJECTORIES in prompts.js.
  function trajectoryPill(item) {
    const trajectory = String((item && item.trajectory) || '').trim();
    if (!trajectory) return '';
    const year = String((item && item.lastSeen) || '').trim();
    const label = TEXT.trajectoryLabels[trajectory] || trajectory;
    // The year is only worth showing where it adds something the word does
    // not. "Structural, last seen 2025" is noise; "Dormant since 2019" is the
    // finding.
    const stale = trajectory === 'dormant' || trajectory === 'declining' || trajectory === 'phasic';
    const dated = stale && /^\d{4}$/.test(year);
    const text = dated ? label + ' · ' + year : label;
    // The tooltip only where there is a year to explain — a bare "Throughout"
    // needs no gloss, and a title on every chip would be noise on hover.
    return '<span class="pill pill-traj pill-traj-' + esc(trajectory) + '"' +
      (dated ? ' title="' + esc(TEXT.trajectoryNote) + '"' : '') + '>' + esc(text) + '</span>';
  }

  // ---------- section bodies shared by both report layouts ----------
  //
  // Lifted out of reportSectionsHtml so the classic and the structured layout
  // draw these blocks with the same markup. Output is unchanged from when
  // they were inline.

  function mbtiAxesHtml(mbti) {
    return '<div class="axes">' + (mbti.letters || []).map(letter => {
      const pole = axisLabel(letter.choice, letter.axis);
      return '<div class="axis"><span class="axis-letter">' + esc(letter.choice) + '</span>' +
        '<div><span class="axis-name">' + esc(pole.name) + '</span>' +
        (pole.against ? '<span class="axis-against">' + esc(TEXT.mbtiOver) + esc(pole.against) + '</span>' : '') +
        '<span class="pill pill-' + esc(letter.strength || 'moderate') + '">' + esc(letter.strength || '') + '</span>' +
        // One passage carrying both the case for the letter and the behaviour
        // that tempers it. This was briefly two blocks — an argument and a
        // labelled "case against" beneath it — which made every axis read as a
        // debate transcript rather than as an analysis, and gave the contrary
        // evidence the same visual weight as the finding whatever its actual
        // weight. The tempering is a clause in the same paragraph now, the way
        // a Big Five trait's reading carries its own qualifications.
        '<p>' + esc(letter.why) + '</p>' +
        // A report written before that merge still has the separate field;
        // append it rather than dropping a paragraph of real analysis on the
        // floor. New reports never take this branch.
        (letter.counterEvidence ? '<p>' + esc(letter.counterEvidence) + '</p>' : '') +
        (letter.inPractice ? '<p class="muted">' + esc(letter.inPractice) + '</p>' : '') +
        '</div></div>';
    }).join('') + '</div>';
  }

  function interestsHtml(interests) {
    if (!(interests || []).length) return '<p class="muted">' + esc(TEXT.interestsEmpty) + '</p>';
    return '<div class="tile-grid">' + interests.map(item =>
      '<div class="tile tile-' + esc(item.intensity) + '">' +
      '<h4>' + esc(item.name) + '<span class="pill pill-' + esc(item.intensity) + '">' + esc(item.intensity) + '</span>' +
      trajectoryPill(item) + '</h4>' +
      '<p>' + esc(item.detail) + '</p>' +
      '<p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>';
  }

  function valuesBeliefsHtml(report) {
    let html = '<h3>' + esc(TEXT.values) + '</h3>';
    html += (report.values || []).length
      ? '<div class="tile-grid">' + report.values.map(item =>
        '<div class="tile"><h4>' + esc(item.value) + trajectoryPill(item) + '</h4>' +
        '<p>' + esc(item.detail) + '</p>' +
        '<p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>'
      : '<p class="muted">' + esc(TEXT.valuesEmpty) + '</p>';
    html += '<h3>' + esc(TEXT.beliefs) + '</h3>';
    html += (report.beliefs || []).length
      ? '<div class="tile-grid">' + report.beliefs.map(item =>
        '<div class="tile"><h4>' + esc(item.belief) +
        '<span class="pill">' + esc(item.confidence) + esc(TEXT.confidenceSuffix) + '</span></h4>' +
        '<p>' + esc(item.detail) + '</p><p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>'
      : '<p class="muted">' + esc(TEXT.beliefsEmpty) + '</p>';
    return html;
  }

  function careerDescriptionHtml(career) {
    return '<div class="split"><div><h3 class="h-good">' + esc(TEXT.strengths) + '</h3>' + points(career.strengths) + '</div>' +
      '<div><h3 class="h-warn">' + esc(TEXT.weaknesses) + '</h3>' + points(career.weaknesses) + '</div></div>' +
      '<h3>' + esc(TEXT.howYouWork) + '</h3><p>' + esc(career.workStyle) + '</p>' +
      '<h3>' + esc(TEXT.holdBack) + '</h3><p>' + esc(career.watchOuts) + '</p>';
  }

  function activityFacetsHtml(activity) {
    let html = '<div class="facet-grid">';
    for (const [label, key] of Copy.ACTIVITY_FACETS) {
      const facet = activity[key];
      if (!facet) continue;
      html += '<div class="facet"><span class="facet-label">' + label + '</span>' +
        '<h4>' + esc(facet.headline) + '</h4><p>' + esc(facet.detail) + '</p></div>';
    }
    return html + '</div>';
  }

  // ---------- the structured layout ----------
  //
  // Four parts with one thread through them, set by the server's
  // PSYCHEAI_REPORT_LAYOUT (see lib/prompts.js) and readable on any page with
  // ?layout=classic or ?layout=structured, so the two can be compared side by
  // side on the same report. The classic layout is reportSectionsHtml below,
  // untouched; nothing here runs unless this layout is chosen.
  //
  // Every section here follows one template: what it measures (a fixed
  // definition line, shown while the section is open), what it found (a
  // one-line result, shown even when it is shut, so the closed report reads
  // as a summary), the read, the chart, and the patterns it connects to. Each
  // pattern has its own colour, carried by every chip, card and plan item
  // that comes from it, so the thread is visible as well as written. Reports
  // written before the structured fields existed still render: each block is
  // drawn only when its field is there.

  function reportLayout() {
    let forced = '';
    try { forced = new URLSearchParams(window.location.search).get('layout') || ''; } catch (error) { /* none */ }
    if (forced === 'classic' || forced === 'structured') return forced;
    return state.server && state.server.reportLayout === 'structured' ? 'structured' : 'classic';
  }

  /** The patterns worth drawing: known ids, named, one each, in id order. */
  function signaturePatterns(report) {
    const seen = new Set();
    return (Array.isArray(report && report.patterns) ? report.patterns : [])
      .filter(p => p && /^p[1-3]$/.test(p.id) && String(p.name || '').trim() && !seen.has(p.id) && seen.add(p.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function patternNumber(id) {
    return String(id || '').replace(/^p/, '');
  }

  /** The class that gives an element its pattern's colour, or none. */
  function patternClass(id) {
    return /^p[1-3]$/.test(String(id || '')) ? ' pat-' + id : '';
  }

  function sectionNameChips(keys) {
    const names = Copy.STRUCTURED.sectionNames;
    // Values and beliefs are one section on the page, so they are one chip.
    const list = (keys || []).filter(key => names[key]).map(key => names[key])
      .filter((name, i, all) => all.indexOf(name) === i);
    if (!list.length) return '';
    return list.map(name => '<span class="section-chip">' + esc(name) + '</span>').join('');
  }

  const PART_ORDER = ['overview', 'who', 'drives', 'connect', 'together', 'appendix'];
  // Below this width a full report opens with its parts shut (renderProfile).
  const PHONE_REPORT = '(max-width: 759px)';

  /**
   * One part of the structured report as a single box that opens and shuts:
   * its numbered heading is the toggle, and every section inside stays open.
   * Numeral and title only: the sections inside say what they are.
   */
  function partCardHtml(key, inner) {
    const part = Copy.STRUCTURED.parts[key];
    const numeral = String(Math.max(0, PART_ORDER.indexOf(key))).padStart(2, '0');
    return '<section class="card section-card part-card" data-part-card="' + esc(key) + '" data-start-open>' +
      '<div class="card-head card-head-toggle part-card-head"><div class="report-part" data-part="' + esc(key) + '">' +
      '<span class="part-num" aria-hidden="true">' + numeral + '</span>' +
      '<h2 class="part-title"><button class="card-toggle" type="button" aria-expanded="true">' +
      '<span class="card-toggle-text">' + esc(part.title) + '</span><span class="card-chevron" aria-hidden="true"></span>' +
      '</button></h2></div></div>' +
      '<div class="part-body">' + inner + '</div></section>';
  }

  /**
   * The row of parts under the summary card, each named as its heading is,
   * and sticky so a reader can move between them from anywhere in the
   * report. markStructured lights the one they are in.
   */
  /**
   * My Report's header: the eyebrow pill (parts and the PDF's pages, filled
   * in once counted), the title, a line on what the report is, and the
   * reader's character's emblem where My Syncs has its pair.
   */
  function reportHeroHtml(report) {
    const R = Copy.STRUCTURED.reportPage;
    const name = essenceName(report.essence || {});
    const emblem = name ? Copy.emblemSvg(name, 'report-hero-emblem') : '';
    const parts = PART_ORDER.filter(key => key !== 'appendix').length;
    return '<header class="scan-hero report-hero">' +
      (emblem ? '<span class="report-hero-mark" aria-hidden="true">' + emblem + '</span>' : '') +
      '<p class="scan-eyebrow" id="report-hero-pill">' + esc(R.pill(parts, reportPdfPages())) + '</p>' +
      '<h2 class="report-hero-title">' + esc(R.pageTitle) + '</h2>' +
      '<p class="scan-lede">' + esc(R.lede) + '</p></header>';
  }
  // The PDF's page count, for the pill: built once per report when the page
  // is idle, and kept for as long as the report is the same one.
  let reportPagesFor = '';
  let reportPages = 0;
  function reportPdfPages() {
    const profile = state.profile;
    const key = profile ? String(profile.createdAt) + '|' + String(profile.premiumAt || '') : '';
    if (key && key === reportPagesFor) return reportPages;
    if (key) {
      reportPagesFor = key;
      reportPages = 0;
      const count = () => {
        try {
          buildReportPdf(state.profile).text().then(text => {
            if (reportPagesFor !== key) return;
            reportPages = (text.match(/\/Type \/Page[^s]/g) || []).length;
            const pill = $('#report-hero-pill');
            if (pill && reportPages) {
              pill.textContent = Copy.STRUCTURED.reportPage.pill(PART_ORDER.filter(k => k !== 'appendix').length, reportPages);
            }
          }).catch(() => {});
        } catch (error) { /* the pill keeps the parts alone */ }
      };
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(count, { timeout: 2000 });
      else setTimeout(count, 300);
    }
    return 0;
  }

  function partNavHtml(hasRoast, ownPage) {
    const S = Copy.STRUCTURED;
    // Evidence and method and the roast sit inside part 05, the appendix.
    const items = PART_ORDER.map(key => [key, String(PART_ORDER.indexOf(key)).padStart(2, '0'), S.parts[key].title]);
    // On a phone it is one thin row under the site's header: the name of the
    // part being read, then the numerals 00 … 05.
    return '<nav class="part-nav' + (ownPage ? ' is-report' : '') + '" aria-label="' + esc(S.partNavLabel) + '">' +
      '<span class="part-nav-lead" aria-hidden="true">' + esc(items[0][2]) + '</span>' + items.map(([key, num, title]) =>
      '<button type="button" class="part-nav-item" data-part-target="' + esc(key) + '" title="' + esc(title) + '">' +
      (num ? '<span class="part-nav-num">' + num + '</span>' : '') + '<span class="part-nav-label">' + esc(title) + '</span></button>').join('') + '</nav>';
  }

  function patternsCardHtml(patterns) {
    const S = Copy.STRUCTURED;
    return '<div class="card section-card patterns-card">' +
      sectionHead('🧵', esc(S.titles.patterns), esc(S.definitions.patterns), false, '') +
      '<div class="pattern-list">' + patterns.map(p =>
        '<div class="pattern' + patternClass(p.id) + '" data-pattern-card="' + esc(p.id) + '">' +
        '<span class="pattern-badge" aria-hidden="true">' + esc(patternNumber(p.id)) + '</span>' +
        '<div><h3>' + esc(p.name) + '</h3><p>' + esc(p.line) + '</p>' + evidence(p.evidence) +
        ((p.showsUpIn || []).length
          ? '<p class="pattern-where"><span class="connects-label">' + esc(S.showsUpIn) + '</span>' +
            sectionNameChips(p.showsUpIn) + '</p>' : '') +
        '</div></div>').join('') + '</div></div>';
  }

  /**
   * A reading in full, with its evidence under it. Nothing behind a "More":
   * a report with a disclosure in every block read as a page of buttons.
   */
  function readingFull(text, evidenceItems) {
    return (text ? '<p class="trait-reading">' + esc(text) + '</p>' : '') + evidence(evidenceItems);
  }

  /** One Big Five trait on a spectrum: both poles named, the typical band shaded. */
  function bipolarBarHtml(trait, item, mark) {
    const S = Copy.STRUCTURED;
    const score = Math.min(100, Math.max(0, Math.round(Number(item.score) || 0)));
    const poles = S.poles[trait] || ['', ''];
    const band = S.typicalBand;
    return '<div class="trait-block bipolar reading-row' + (mark ? ' is-' + mark : '') + '">' +
      '<div class="trait-viz"><div class="bipolar-head"><span class="trait-label">' + esc(TRAIT_LABELS[trait]) +
      (item.band ? ' · ' + esc(item.band) : '') +
      (mark ? ' <span class="trait-flag">' + esc(S.flags[mark]) + '</span>' : '') + '</span>' +
      '<span class="trait-num">' + score + '</span></div>' +
      '<div class="bipolar-track" role="img" aria-label="' + esc(TRAIT_LABELS[trait] + ': ' + score +
        ' of 100, between ' + poles[0].toLowerCase() + ' and ' + poles[1].toLowerCase()) + '">' +
      '<span class="bipolar-band" data-left="' + band[0] + '" data-fill="' + (band[1] - band[0]) + '"></span>' +
      '<span class="bipolar-mid"></span>' +
      '<span class="bipolar-marker" data-left="' + score + '"></span></div>' +
      '<div class="bipolar-poles"><span>' + esc(poles[0]) + '</span><span>' + esc(poles[1]) + '</span></div></div>' +
      '<div class="trait-text">' + readingFull(item.reading, item.evidence) + '</div></div>';
  }

  /** The highest and lowest of the five, by score. */
  function bigFiveExtremes(bigFive) {
    const rows = Object.keys(TRAIT_LABELS).filter(t => bigFive && bigFive[t])
      .map(t => ({ trait: t, score: Math.round(Number(bigFive[t].score) || 0) }));
    if (rows.length < 2) return {};
    const sorted = rows.slice().sort((a, b) => b.score - a.score);
    return { high: sorted[0], low: sorted[sorted.length - 1] };
  }

  function bigFiveStructuredHtml(bigFive) {
    const S = Copy.STRUCTURED;
    const ends = bigFiveExtremes(bigFive);
    let html = '<p class="scale-legend"><span class="legend-band" aria-hidden="true"></span>' +
      esc(S.typicalLabel) + '<span class="legend-marker" aria-hidden="true"></span>' + esc(S.yourScore) + '</p>';
    for (const trait of Object.keys(TRAIT_LABELS)) {
      if (!bigFive || !bigFive[trait]) continue;
      const mark = ends.high && ends.high.trait === trait ? 'high' : ends.low && ends.low.trait === trait ? 'low' : '';
      html += bipolarBarHtml(trait, bigFive[trait], mark);
    }
    return html;
  }

  /**
   * MBTI as four sliders, one per axis: the two poles at the ends and a marker
   * pushed towards the chosen one by how firmly it was chosen, the pole not
   * chosen faint. The slider sits on the left and the case for the letter on
   * the right, all of it in view — the same row the Big Five uses.
   */
  const AXIS_POLES = { 'E/I': ['E', 'I'], 'N/S': ['N', 'S'], 'T/F': ['T', 'F'], 'J/P': ['J', 'P'] };
  const STRENGTH_REACH = { slight: 16, moderate: 30, clear: 44 };

  function mbtiSlidersHtml(mbti) {
    const S = Copy.STRUCTURED;
    return '<div class="mbti-sliders">' + (mbti.letters || []).map(letter => {
      const axis = String(letter.axis || '').toUpperCase().replace(/\s/g, '');
      const pair = AXIS_POLES[axis] || AXIS_POLES[Object.keys(AXIS_POLES).find(k => k.includes(letter.choice))] || ['', ''];
      const toRight = letter.choice === pair[1];
      const reach = STRENGTH_REACH[letter.strength] || STRENGTH_REACH.moderate;
      const position = 50 + (toRight ? reach : -reach);
      const left = Copy.MBTI_POLES[pair[0]] || { name: pair[0] };
      const right = Copy.MBTI_POLES[pair[1]] || { name: pair[1] };
      return '<div class="mbti-slider reading-row">' +
        '<div class="trait-viz"><div class="slider-ends">' +
          '<span class="' + (!toRight ? 'is-chosen' : 'is-faint') + '"><b>' + esc(pair[0]) + '</b> ' + esc(left.name) + '</span>' +
          '<span class="' + (toRight ? 'is-chosen' : 'is-faint') + '">' + esc(right.name) + ' <b>' + esc(pair[1]) + '</b></span>' +
        '</div>' +
        '<div class="slider-track" role="img" aria-label="' + esc((toRight ? right.name : left.name) + ', ' + (letter.strength || '')) + '">' +
          '<span class="slider-mid"></span><span class="slider-marker" data-left="' + position + '">' + esc(letter.choice || '') + '</span>' +
        '</div>' +
        (letter.strength ? '<p class="slider-strength"><span class="pill pill-' + esc(letter.strength) + '">' +
          esc(letter.strength) + '</span></p>' : '') + '</div>' +
        '<div class="trait-text">' +
        (letter.why ? '<p class="trait-reading">' + esc(letter.why) + '</p>' : '') +
        (letter.inPractice ? '<p class="slider-practice">' + esc(letter.inPractice) + '</p>' : '') +
        '</div></div>';
    }).join('') + '</div>';
  }

  /**
   * Schwartz's circle: ten wedges in his order, each as long as its score and
   * coloured by its higher-order group, so neighbours that rise together and
   * opposites that trade off are visible at a glance. The bars below it carry
   * the same numbers for anyone who cannot use the picture.
   */
  function motivatorCircleSvg(scores) {
    const S = Copy.STRUCTURED;
    const keys = Object.keys(S.motivators);
    const cx = 170;
    const cy = 150;
    const inner = 16;
    const outer = 108;
    const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const f = n => Math.round(n * 10) / 10;
    let rings = '';
    for (const level of [25, 50, 75, 100]) {
      rings += '<circle class="rose-ring" cx="' + cx + '" cy="' + cy + '" r="' + f(inner + (outer - inner) * level / 100) + '"/>';
    }
    let wedges = '';
    let labels = '';
    keys.forEach((key, i) => {
      const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / keys.length + 0.025;
      const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / keys.length - 0.025;
      const row = scores[key];
      const value = row ? Math.min(100, Math.max(0, Number(row.score) || 0)) : 0;
      const r = inner + (outer - inner) * value / 100;
      const [x0, y0] = pt(r, a0);
      const [x1, y1] = pt(r, a1);
      const [i0x, i0y] = pt(inner, a0);
      const [i1x, i1y] = pt(inner, a1);
      wedges += '<path class="rose-wedge rose-' + esc(S.motivators[key].group) + '" d="M' + f(i0x) + ' ' + f(i0y) +
        ' L' + f(x0) + ' ' + f(y0) + ' A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x1) + ' ' + f(y1) +
        ' L' + f(i1x) + ' ' + f(i1y) + ' A' + inner + ' ' + inner + ' 0 0 0 ' + f(i0x) + ' ' + f(i0y) + ' Z">' +
        '<title>' + esc(S.motivators[key].label + ': ' + Math.round(value)) + '</title></path>';
      const mid = (a0 + a1) / 2;
      const [lx, ly] = pt(outer + 12, mid);
      const anchor = Math.abs(Math.cos(mid)) < 0.2 ? 'middle' : Math.cos(mid) > 0 ? 'start' : 'end';
      labels += '<text class="rose-label" x="' + f(lx) + '" y="' + f(ly + 4) + '" text-anchor="' + anchor + '">' +
        esc(S.motivators[key].short) + '</text>';
    });
    const top = keys.filter(k => scores[k]).sort((a, b) => scores[b].score - scores[a].score).slice(0, 3)
      .map(k => S.motivators[k].label).join(', ');
    return '<svg class="motive-rose" viewBox="-16 0 372 300" role="img" aria-label="' +
      esc(S.titles.motivators + ': strongest ' + top) + '">' + rings + wedges + labels + '</svg>';
  }

  /** The circle, the three strongest, the reading, and all ten as bars behind "More". */
  function motivatorsHtml(motivators) {
    const S = Copy.STRUCTURED;
    const scores = {};
    for (const row of (motivators && motivators.scores) || []) {
      if (row && S.motivators[row.value]) scores[row.value] = row;
    }
    if (!Object.keys(scores).length) return '';
    let bars = '<div class="motive-chart">';
    for (const group of Object.keys(S.motivatorGroups)) {
      const rows = Object.keys(S.motivators).filter(key => S.motivators[key].group === group && scores[key]);
      if (!rows.length) continue;
      bars += '<div class="motive-group motive-' + esc(group) + '"><p class="motive-group-name">' +
        esc(S.motivatorGroups[group]) + '</p>';
      for (const key of rows) {
        const row = scores[key];
        const value = Math.min(100, Math.max(0, Math.round(Number(row.score) || 0)));
        bars += '<div class="motive-row">' +
          '<span class="motive-label">' + esc(S.motivators[key].label) +
          '<small>' + esc(S.motivators[key].meaning) + '</small></span>' +
          '<div class="bar motive-bar"><div class="bar-fill" data-fill="' + value + '"></div></div>' +
          '<span class="trait-num">' + value + '</span>' +
          (row.line ? '<p class="motive-line">' + esc(row.line) + '</p>' : '') + '</div>';
      }
      bars += '</div>';
    }
    bars += '</div>';
    const legend = '<p class="rose-legend">' + Object.keys(S.motivatorGroups).map(group =>
      '<span class="rose-key rose-key-' + esc(group) + '">' + esc(S.motivatorGroups[group]) + '</span>').join('') + '</p>';
    return '<div class="motive-top-grid">' + motivatorCircleSvg(scores) +
      '<div>' + legend + (motivators.reading ? '<div class="callout">' + paragraphs(motivators.reading) + '</div>' : '') +
      '</div></div>' + bars;
  }

  /** Interests with one marker for where each is heading, instead of two pills. */
  function interestsStructuredHtml(interests) {
    const S = Copy.STRUCTURED;
    if (!(interests || []).length) return '<p class="muted">' + esc(TEXT.interestsEmpty) + '</p>';
    return '<div class="tile-grid">' + interests.map(item => {
      const trajectory = String(item.trajectory || '').trim();
      const label = TEXT.trajectoryLabels[trajectory] || '';
      const year = String(item.lastSeen || '').trim();
      const stale = /^(dormant|declining|phasic)$/.test(trajectory) && /^\d{4}$/.test(year);
      return '<div class="tile tile-' + esc(item.intensity) + '">' +
        '<h4>' + esc(item.name) + '</h4>' +
        (label ? '<p class="trend trend-' + esc(trajectory) + '"><span aria-hidden="true">' +
          esc(S.trendIcons[trajectory] || '') + '</span> ' + esc(label + (stale ? ' · ' + year : '')) +
          (item.intensity ? ' · ' + esc(item.intensity) : '') + '</p>' : '') +
        '<p>' + esc(item.detail) + '</p>' +
        '<p class="tile-ev">' + esc(item.evidence) + '</p></div>';
    }).join('') + '</div>';
  }

  /**
   * Values and beliefs as one list of what they stand for: every entry drawn
   * the same way, with no tag saying which list the model filed it under —
   * the line between the two was the model's, not the reader's. A belief that
   * only restates a value already listed is left out.
   */
  function standForHtml(report) {
    const values = (report.values || []).filter(item => item && item.value);
    const words = text => String(text || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
    const valueWords = new Set(values.flatMap(item => words(item.value)));
    const beliefs = (report.beliefs || []).filter(item => item && item.belief &&
      !(words(item.belief).length && words(item.belief).every(w => valueWords.has(w))));
    // Four at most — three values and one belief — whatever an older report holds.
    const items = values.slice(0, 3).map(item => ({ title: item.value, pill: trajectoryPill(item), detail: item.detail, evidence: item.evidence }))
      .concat(beliefs.slice(0, 1).map(item => ({ title: item.belief, pill: '', detail: item.detail, evidence: item.evidence })))
      .slice(0, 4);
    if (!items.length) return '<p class="muted">' + esc(TEXT.valuesEmpty) + '</p>';
    return '<div class="tile-grid">' + items.map(item =>
      '<div class="tile"><h4>' + esc(item.title) + item.pill + '</h4>' +
      (item.detail ? '<p>' + esc(item.detail) + '</p>' : '') +
      (item.evidence ? '<p class="tile-ev">' + esc(item.evidence) + '</p>' : '') + '</div>').join('') + '</div>';
  }

  /**
   * Where an attachment leaning sits on the two dimensions the research uses —
   * anxiety and avoidance — as a soft area rather than a point, because the
   * read is a leaning from behaviour, not a measurement. Placed from the
   * words of the style itself: the first style named is the base, any other
   * named pulls it part of the way over.
   */
  function attachmentPlace(style) {
    const text = String(style || '').toLowerCase().replace(/fearful[\s-]*avoidant/g, 'fearful')
      // A mix of the two sits in their shared corner.
      .replace(/anxious and avoidant mix/g, 'fearful');
    const centres = { secure: [28, 28], anxious: [28, 72], avoidant: [72, 28], fearful: [72, 72] };
    const found = Object.keys(centres).map(key => ({ key, at: text.indexOf(key) }))
      .filter(row => row.at >= 0).sort((a, b) => a.at - b.at);
    if (!found.length) return null;
    const base = centres[found[0].key].slice();
    for (const other of found.slice(1)) {
      base[0] += (centres[other.key][0] - centres[found[0].key][0]) * 0.35;
      base[1] += (centres[other.key][1] - centres[found[0].key][1]) * 0.35;
    }
    return { x: base[0], y: base[1], style: found[0].key };
  }

  function attachmentMapSvg(style) {
    const S = Copy.STRUCTURED;
    const place = attachmentPlace(style);
    if (!place) return '';
    const px = v => 30 + v * 1.8;
    const py = v => 210 - v * 1.8;
    return '<figure class="attach-map"><svg viewBox="0 0 220 240" role="img" aria-label="' +
      esc(S.attachMapLabel + ': ' + style) + '">' +
      '<rect class="attach-q" x="30" y="30" width="180" height="180"/>' +
      '<line class="attach-axis" x1="120" y1="30" x2="120" y2="210"/><line class="attach-axis" x1="30" y1="120" x2="210" y2="120"/>' +
      '<text class="attach-q-label" x="75" y="196" text-anchor="middle">' + esc(S.attachQuadrants.secure) + '</text>' +
      '<text class="attach-q-label" x="75" y="48" text-anchor="middle">' + esc(S.attachQuadrants.anxious) + '</text>' +
      '<text class="attach-q-label" x="165" y="196" text-anchor="middle">' + esc(S.attachQuadrants.avoidant) + '</text>' +
      '<text class="attach-q-label" x="165" y="48" text-anchor="middle">' + esc(S.attachQuadrants.fearful) + '</text>' +
      '<circle class="attach-blob" cx="' + px(place.x) + '" cy="' + py(place.y) + '" r="30"/>' +
      '<circle class="attach-dot" cx="' + px(place.x) + '" cy="' + py(place.y) + '" r="5"/>' +
      '<text class="attach-axis-label" x="120" y="228" text-anchor="middle">' + esc(S.attachAxes.avoidance) + ' →</text>' +
      '<text class="attach-axis-label" x="12" y="120" text-anchor="middle" transform="rotate(-90 12 120)">' +
      esc(S.attachAxes.anxiety) + ' →</text></svg>' +
      '<figcaption>' + esc(S.attachMapNote) + '</figcaption></figure>';
  }

  /**
   * Two matched lists side by side, each a numbered run of a title and a line
   * under a heading with a badge: the good side ticked in green, the costly
   * side marked in amber. Who suits you, what you bring and where it gets
   * hard, and your strengths beside what holds you back all read this way.
   */
  function pairedListsHtml(good, warn) {
    const col = (side, kind) => {
      const rows = ((side && side.items) || []).filter(item => item && item.title);
      if (!rows.length) return '';
      return '<div class="partner-col partner-' + kind + '">' +
        '<h4 class="partner-col-head"><span class="partner-badge" aria-hidden="true">' + (kind === 'need' ? '✓' : '!') + '</span>' +
        esc(side.title) + '</h4><ol class="partner-items">' + rows.map(item =>
          '<li><strong>' + esc(item.title) + '</strong>' + (item.detail ? '<span>' + esc(item.detail) + '</span>' : '') + '</li>').join('') +
        '</ol></div>';
    };
    const cols = col(good, 'need') + col(warn, 'careful');
    return cols ? '<div class="partner-grid">' + cols + '</div>' : '';
  }

  /** Who suits them: the one-line verdict as a banner, then the two lists. */
  function idealPartnerStructuredBody(idealPartner) {
    return '<div class="partner">' +
      (idealPartner.summary ? '<div class="partner-summary"><span class="partner-summary-icon" aria-hidden="true">💞</span>' +
        '<p>' + esc(idealPartner.summary) + '</p></div>' : '') +
      pairedListsHtml({ title: TEXT.idealPartnerNeeds, items: idealPartner.needs },
        { title: TEXT.idealPartnerCarefulOf, items: idealPartner.carefulOf }) + '</div>';
  }

  /**
   * Actions on a three-step timeline, one row per step: this week, this
   * quarter, this year. Used
   * by the development plan and by How you work, so every action in the
   * report reads the same way. Each can be ticked off on this device.
   */
  function planKey(text) {
    let hash = 0;
    for (const ch of String(text || '')) hash = (hash * 31 + ch.codePointAt(0)) | 0;
    return 'a' + (hash >>> 0).toString(36);
  }

  function timelineHtml(actions, sample) {
    const S = Copy.STRUCTURED;
    const done = sample ? {} : store.read(KEYS.plan, {}) || {};
    const horizons = Object.keys(TEXT.careerHorizons);
    const items = (actions || []).filter(a => a && (a.step || a.title));
    if (!items.length) return '';
    // A column per horizon that has steps, as the PDF does: an empty one said
    // "Nothing here yet", which read as a gap in the report.
    const groups = horizons.map((horizon, i) => ({ horizon,
      here: items.filter(a => a.horizon === horizon || (i === 0 && !horizons.includes(a.horizon))) })).filter(g => g.here.length);
    return '<div class="timeline timeline-' + groups.length + '">' + groups.map(({ horizon, here }) => {
      return '<div class="timeline-col"><p class="timeline-head"><span class="timeline-dot" aria-hidden="true"></span>' +
        esc(TEXT.careerHorizons[horizon]) + '</p><div class="timeline-steps">' +
        (here.length ? here.map(a => {
          const text = a.step || a.title;
          const key = planKey(text);
          return '<label class="plan-step' + patternClass(a.pattern) + '">' +
            '<input type="checkbox" class="plan-check" data-plan-key="' + key + '"' + (done[key] ? ' checked' : '') +
            (sample ? ' disabled' : '') + '>' +
            '<span><b>' + esc(text) + '</b>' + (a.detail ? '<small>' + esc(a.detail) + '</small>' : '') +
            (a.from ? '<span class="plan-from">' + esc(a.from) + '</span>' : '') + '</span></label>';
        }).join('') : '<p class="muted timeline-empty">' + esc(S.nothingYet) + '</p>') + '</div></div>';
    }).join('') + '</div>';
  }

  /**
   * How you work as one section: how they work, the edge and their other
   * strengths, everything holding them back as one list, and what they are not
   * using. The description and the coach's read used to sit side by side and
   * say the same things twice; the actions are on the development plan.
   */
  function workStructuredBody(career, coaching) {
    const S = Copy.STRUCTURED;
    let html = '';
    const lead = [career.workStyle, coaching && coaching.situation].filter(Boolean);
    if (lead.length) html += '<div class="work-lead">' + lead.map(text => '<p>' + esc(text) + '</p>').join('') + '</div>';
    if (coaching && coaching.edge) {
      html += '<div class="callout career-edge edge-hero"><span class="career-label">' + esc(TEXT.careerEdge) + '</span>' +
        '<h3>' + esc(coaching.edge.headline) + '</h3><p>' + esc(coaching.edge.detail) + '</p>' +
        evidence(coaching.edge.evidence) + '</div>';
    }
    const holding = [].concat(
      coaching && coaching.holdingBack ? [{ title: coaching.holdingBack.headline, detail: coaching.holdingBack.detail }] : [],
      career.weaknesses || []).slice(0, 2);
    // Two at most, and no separate "where it goes wrong": a report written
    // before the prompt said so could otherwise repeat one cost three ways.
    // Two columns: what sets them apart, and what holds them back. What they
    // are not using is an untapped strength, not a cost, so it closes the
    // strengths side rather than joining the list of costs.
    const strengths = (career.strengths || []).concat(coaching && coaching.underused
      ? [{ title: S.notYetUsing + coaching.underused.headline, detail: coaching.underused.detail }] : []);
    html += '<div class="paired-lists work-pair">' + pairedListsHtml(
      { title: coaching && coaching.edge ? S.otherStrengths : TEXT.strengths, items: strengths },
      { title: S.whatHoldsYouBack, items: holding }) + '</div>';
    return html;
  }

  /**
   * In relationships as one section: how they attach, what they bring and
   * where it gets hard, how they give and want care, and who suits them —
   * three sections, a page apart, that kept restating each other.
   */
  function relationshipsStructuredBody(relationship, source, idealPartner) {
    const S = Copy.STRUCTURED;
    const attachment = source ? gentleAttachmentOf(source) : source;
    // Love languages first: the most concrete thing here, and the one a reader
    // is most likely to act on tomorrow.
    let html = loveLanguageBlock(relationship.loveLanguages, { caveat: false, blurbs: false });
    if (relationship.loveLanguages) html += '<p class="fineprint touch-note">' + esc(S.touchNote) + '</p>';
    if (attachment) {
      // The model's own caveat is left out: the map is labelled a leaning,
      // and the about card already says none of this is a clinical read.
      html += '<h3>' + esc(S.howYouAttach) + '</h3><div class="attach-top">' + attachmentMapSvg(attachment.style) +
        '<div><p class="attach-style"><strong>' + esc(attachment.style) + '</strong></p>' +
        (attachment.styleTone ? '<p class="attachment-tone">' + esc(attachment.styleTone) + '</p>' : '') +
        readingFull(attachment.why, attachment.derivedFrom) +
        // How they handle disagreement: the card's conflict style, explained.
        (attachment.conflict ? '<p class="attach-conflict"><strong>' + esc(TEXT.attachmentConflict) + '.</strong> ' +
          esc(attachment.conflict) + '</p>' : '') + '</div></div>';
      // No "In practice": what the style gives and costs is under what they
      // bring and where it gets hard, just below.
    }
    html += '<div class="paired-lists bring-pair">' + pairedListsHtml(
      { title: S.whatYouBring, items: relationship.strengths },
      { title: S.whereItGetsHard, items: relationship.weaknesses }) + '</div>';
    if (idealPartner) html += '<h3>' + esc(S.whoSuitsYou) + '</h3>' + idealPartnerStructuredBody(idealPartner);
    return html;
  }

  /** Six tiles, coloured by band: steady, mixed, under strain, not enough evidence. Still no scores. */
  function wellnessStructuredBody(wellness) {
    let html = '<div class="wellness-tiles">';
    for (const [label, key] of Copy.WELLNESS_FACETS) {
      const facet = wellness[key];
      if (!facet) continue;
      const band = String(facet.band || '').replace(/\s+/g, '-').toLowerCase();
      html += '<div class="wellness-tile wellness-tile-' + esc(band) + '">' +
        '<div class="wellness-head"><span class="wellness-label">' + label + '</span>' + wellnessBand(facet.band) + '</div>' +
        readingFull(facet.reading, facet.evidence) +
        '<p class="wellness-confidence">' + esc(TEXT.wellnessConfidence) + esc(facet.confidence) + '</p></div>';
    }
    html += '</div>';
    if (wellness.overall) html += '<div class="callout"><h3>' + esc(TEXT.wellnessOverall) + '</h3>' + paragraphs(wellness.overall) + '</div>';
    // The suggestions are on the development plan's timeline, with every
    // other action in the report.
    html += '<p class="fineprint">' + esc(Copy.STRUCTURED.wellnessNote) + '</p>';
    return html;
  }

  function horizonPill(horizon) {
    const label = TEXT.careerHorizons[horizon];
    if (!label) return '';
    return '<span class="pill horizon-pill horizon-' + esc(String(horizon).replace(/\s+/g, '-')) + '">' + esc(label) + '</span>';
  }

  /**
   * Build on, then the areas to develop, then every action from those areas
   * on one timeline. The actions used to sit inside each area; gathered, they
   * read as a plan rather than as a list of lists.
   */
  function developmentHtml(development, sample, extraActions) {
    const S = Copy.STRUCTURED;
    const buildOn = ((development && development.buildOn) || []).filter(item => item && item.title);
    const develop = ((development && development.develop) || []).filter(item => item && item.title);
    let html = '';
    if (buildOn.length) {
      html += '<h3 class="h-good">' + esc(S.titles.buildOn) + '</h3><div class="dev-list dev-grid">' +
        buildOn.map(item => '<div class="dev-item dev-build' + patternClass(item.pattern) + '"><h4>' + esc(item.title) + '</h4>' +
          '<p>' + esc(item.detail) + '</p></div>').join('') + '</div>';
    }
    if (develop.length) {
      html += '<h3 class="h-warn">' + esc(S.titles.develop) + '</h3><div class="dev-list dev-grid">' +
        develop.map(item => '<div class="dev-item dev-develop' + patternClass(item.pattern) + '"><h4>' + esc(item.title) + '</h4>' +
          '<p>' + esc(item.detail) + '</p>' +
          // What used to be "Under pressure": the early signs and the move
          // for that moment, on the area they belong to.
          ((item.earlySigns || []).length
            ? '<p class="connects-label">' + esc(S.earlySigns) + '</p>' + list(item.earlySigns, 'ticks') : '') +
          (item.counterMove ? '<p><span class="connects-label">' + esc(S.counterMove) + '</span>' + esc(item.counterMove) + '</p>' : '') +
          (item.reflect ? '<p class="reflect"><span class="connects-label">' + esc(S.reflect) + '</span>' +
            esc(item.reflect) + '</p>' : '') + '</div>').join('') + '</div>';
    }
    // Every action in the report, on one timeline: the develop areas', the
    // work coaching's and the wellbeing suggestions'.
    const actions = develop.flatMap(item => (item.actions || []).filter(a => a && a.step)
      .map(a => ({ horizon: a.horizon, step: a.step, pattern: item.pattern, from: item.title })))
      .concat(extraActions || []);
    const timeline = timelineHtml(actions, sample);
    if (timeline) html += '<h3>' + esc(S.titles.plan) + '</h3>' + timeline;
    return html;
  }

  function pressureLevelHtml(level) {
    const S = Copy.STRUCTURED;
    const levels = ['mild', 'moderate', 'marked'];
    const at = levels.indexOf(level);
    if (at < 0) return '';
    return '<span class="pressure-level pressure-' + esc(level) + '" role="img" aria-label="' +
      esc('Level: ' + S.levelLabels[level]) + '">' +
      levels.map((_, i) => '<span class="pressure-step' + (i <= at ? ' is-on' : '') + '"></span>').join('') +
      '<span class="pressure-word">' + esc(S.levelLabels[level]) + '</span></span>';
  }

  const PRESSURE_REACH = { mild: 30, moderate: 58, marked: 86 };

  function pressurePointsHtml(points) {
    const S = Copy.STRUCTURED;
    const rows = (points || []).filter(item => item && item.strength);
    return '<div class="pressure-list">' + rows.map(item =>
      '<div class="pressure-item' + patternClass(item.pattern) + '">' +
      '<div class="pressure-head"><h4>' + esc(item.strength) + '</h4>' + pressureLevelHtml(item.level) + '</div>' +
      // From the strength at its best to what it turns into, with the marker
      // at how far their data shows it has already tipped.
      '<div class="gauge"><div class="gauge-track"><span class="gauge-marker" data-left="' +
        (PRESSURE_REACH[item.level] || 50) + '"></span></div>' +
      '<div class="gauge-ends"><span>' + esc(S.atBest) + '</span><span>' + esc(S.overusedPrefix) + esc(item.overused) + '</span></div></div>' +
      (item.detail ? '<p>' + esc(item.detail) + '</p>' : '') +
      ((item.earlySigns || []).length
        ? '<p class="connects-label">' + esc(S.earlySigns) + '</p>' + list(item.earlySigns, 'ticks') : '') +
      (item.mitigation ? '<p><span class="connects-label">' + esc(S.counterMove) + '</span>' + esc(item.mitigation) + '</p>' : '') +
      (item.question ? '<p class="reflect"><span class="connects-label">' + esc(S.reflect) + '</span>' + esc(item.question) + '</p>' : '') +

      '</div>').join('') + '</div>';
  }

  /**
   * What the digest carries complete — counts and timing over the whole
   * archive — as chips, so a sample of 180 messages is not read as all the
   * analysis saw when every message was counted.
   */
  function countedInFull(digest) {
    const by = countedBySource(digest);
    return by.instagram.concat(by.google, by.facebook, by.whatsapp);
  }

  /**
   * The digest as the report on screen was read from it: the stored one, with
   * the counts of what the full report actually read laid over it when that
   * was the premium read (state.profile.readFrom). Without this a WhatsApp
   * chat added at the unlock showed "10 of your 37.8k messages read" — the
   * standard digest's share, trimmed to its floor beside a full Instagram —
   * under a report written from hundreds of them.
   */
  function readView(digest) {
    const read = state.profile && state.profile.readFrom;
    if (!digest || !read || !read.sampling) return digest;
    const coverage = Object.assign({}, digest.coverage, {
      sampling: Object.assign({}, (digest.coverage && digest.coverage.sampling) || {}, read.sampling),
    });
    return Object.assign({}, digest, { coverage });
  }

  /** The same lines, kept apart by the source they were read from. */
  function countedBySource(source) {
    const digest = readView(source);
    const R = Copy.STRUCTURED.readFrom;
    const items = [];
    const google = [];
    const facebook = [];
    const whatsapp = [];
    if (!digest) return { instagram: items, google, facebook, whatsapp };
    // Totals are rounded to read at a glance — 9,741 is "9.7k", 637 is "~600"
    // — while what was actually read stays exact.
    const num = value => roughCount(value);
    const exact = value => (Number(value) > 0 ? Number(value).toLocaleString() : '');
    const sampling = (digest.coverage && digest.coverage.sampling) || {};
    const read = key => {
      const entry = sampling[key];
      return entry && Number(entry.available) > 0 ? { shown: exact(entry.shown) || '0', of: num(entry.available) } : null;
    };
    const dm = digest.directMessages;
    const own = read('ownMessages');
    if (own) items.push(R.messages(own.shown, own.of, num(dm && dm.activeThreads)));
    else if (dm && num(dm.totalMessages)) items.push(R.messagesCounted(num(dm.totalMessages), num(dm.activeThreads)));
    const captions = read('captions');
    if (captions) items.push(R.captions(captions.shown, captions.of));
    const comments = read('comments');
    if (comments) items.push(R.comments(comments.shown, comments.of));
    const c = digest.counts || {};
    const liked = read('likedCaptions');
    if (num(c.postsLiked)) items.push(R.liked(num(c.postsLiked), liked && liked.shown !== '0' ? liked.shown : ''));
    if (num(c.stories)) items.push(R.stories(num(c.stories)));
    if (num(c.postsSaved)) items.push(R.saved(num(c.postsSaved)));
    if (num(c.following)) items.push(R.following(num(c.following)));
    const days = Number(digest.rhythm && digest.rhythm.spanDays);
    if (days >= 60) {
      const years = Math.round(days / 365.25);
      items.push(R.timing(years >= 2 ? R.years(years) : R.months(Math.round(days / 30.44))));
    }
    const g = digest.google && digest.google.counts;
    if (g) {
      const videos = read('youtubeTitles');
      if (videos) google.push(R.videos(videos.shown, videos.of));
      const searches = read('googleSearchTerms');
      if (searches) google.push(R.googleSearches(searches.shown, searches.of, num(g.googleSearches)));
      const ytSearches = read('youtubeSearchTerms');
      if (ytSearches) google.push(R.youtubeSearches(ytSearches.shown, ytSearches.of));
    }
    const fbPosts = read('facebookPosts');
    if (fbPosts) facebook.push(R.facebookPosts(fbPosts.shown, fbPosts.of));
    const wa = read('whatsappMessages');
    if (digest.whatsapp) whatsapp.push(R.whatsapp((digest.whatsapp.chats || []).length, wa ? wa.shown : '0', wa ? wa.of : '0'));
    return { instagram: items, google, facebook, whatsapp };
  }

  /** A total to the nearest hundred: under 100 as it is, then "~600", then "9.7k". */
  function roughCount(value) {
    const n = Number(value);
    if (!(n > 0)) return '';
    if (n < 100) return String(Math.round(n));
    if (n < 950) {
      const hundred = Math.round(n / 100) * 100;
      return (hundred === n ? '' : '~') + hundred;
    }
    if (n < 999500) return String(Math.round(n / 100) / 10).replace(/\.0$/, '') + 'k';
    return String(Math.round(n / 100000) / 10).replace(/\.0$/, '') + 'M';
  }

  /**
   * The confidence score and what it rests on. On the reader's own report,
   * one row per source with what was read from it beneath (sourcesReadHtml);
   * the model's own two-to-four line summary only where there is no digest to
   * count from — the sample, or a report whose digest is gone.
   */
  function methodEvidenceHtml(report, sample) {
    if (sample) return confidenceBodyHtml(report);
    const withoutSummary = Object.assign({}, report,
      { confidence: Object.assign({}, report.confidence, { basedOn: [] }) });
    return confidenceBodyHtml(state.digest ? withoutSummary : report) + sourcesReadHtml();
  }

  /**
   * The reader's data under Evidence and method: one quiet row per source —
   * its name, what was read or counted from it, and on the right "Change" or
   * "Add". The whole row opens the data popout: on a free report the US$5
   * unlock, data first (openPremiumDialog); on a paid one the re-run
   * (startRerun). See the delegated `.source-read` listener.
   */
  function sourcesReadHtml() {
    const S = Copy.STRUCTURED;
    const digest = state.digest;
    const paid = Object.keys(paidAnalysis()).length > 0;
    const by = countedBySource(digest);
    const rows = [
      { key: 'instagram', icon: '📷', label: TEXT.sourceInstagram, loaded: Boolean(digest) },
      { key: 'google', icon: '🔍', label: TEXT.sourceGoogle, loaded: Boolean(digest && digest.google) },
      { key: 'facebook', icon: '📘', label: TEXT.sourceFacebook, loaded: Boolean(digest && digest.facebook) },
      { key: 'whatsapp', icon: '💬', label: TEXT.sourceWhatsApp, loaded: Boolean(digest && digest.whatsapp) },
    ];
    const note = !paid ? S.sourcesFreeNote
      : TEXT.analysisPriceNoteUnlocked;
    return '<div class="sources-read">' +
      '<p class="sources-read-title">' + esc(S.sourcesReadTitle) + '</p>' +
      (!digest ? '<p class="sources-read-lost">' + esc(TEXT.sourcesInstagramLost) + '</p>' : '') +
      '<ul class="sources-read-list">' + rows.map(row => {
        const lines = by[row.key];
        const what = !row.loaded ? S.sourceNotAdded : lines.length ? lines.join(' · ') : S.sourceLoaded;
        return '<li><button type="button" class="source-read' + (row.loaded ? ' is-loaded' : ' is-missing') + '"' +
            ' data-source="' + row.key + '" data-flow="' + (paid ? 'rerun' : 'unlock') + '">' +
          '<span class="source-read-icon" aria-hidden="true">' + row.icon + '</span>' +
          '<span class="source-read-body"><span class="source-read-name">' + esc(row.label) + '</span>' +
            '<span class="source-read-what">' + esc(what) + '</span></span>' +
          '<span class="source-read-action">' + esc(row.loaded ? S.sourceChange : '+ ' + S.sourceAdd) + '</span>' +
        '</button></li>';
      }).join('') + '</ul>' +
      '<p class="sources-read-note">' + esc(note) + '</p></div>';
  }

  /** What was read, by whom, from which build — the closing section of Part 4. */
  /**
   * How far to trust the report, after the four parts and apart from them:
   * the score, why, what was counted, and the sources with the button that
   * adds one. What model and build wrote it is in the footer and the PDF.
   */
  function methodCardHtml(report, sample) {
    const S = Copy.STRUCTURED;
    return '<div class="card section-card confidence-card method-card" data-part="method">' +
      sectionHead('🎯', esc(S.titles.method), '') +
      methodEvidenceHtml(report, sample) + '</div>';
  }

  function structuredSectionsHtml(report, options) {
    const S = Copy.STRUCTURED;
    const sample = Boolean(options && options.sample);
    // The reader's own My Report, as opposed to the sample or an older page.
    const ownPage = Boolean(options && options.page) && !sample;
    const patterns = signaturePatterns(report);
    // Sections inside a part do not open and shut on their own: the part does.
    const head = (icon, title, defKey) =>
      sectionHead(icon, title, defKey ? esc(S.definitions[defKey]) : '', false, '');
    // The sample shows the full premium report — its own premium sections,
    // never the reader's — and no roast: that stays the secret bonus.
    const unlocked = sample ? sampleUnlocked(report) : paidAnalysis();
    const paid = key => PAID_SECTIONS.find(section => section.key === key);
    const roast = sample ? null : report.bonus;
    // My Report opens with its own header, as My Syncs does; the part nav
    // under it (or down the left) carries no title of its own.
    let html = (ownPage ? reportHeroHtml(report) : '') + partNavHtml(Boolean(roast), ownPage);

    // Overview, part 00: the summary and the signature patterns, open from
    // the start. Each part is one box, and the sections inside it are always
    // open — four disclosures in the whole report rather than one per section.
    const headline = String((report.card && report.card.headline) || '').trim();
    let part = '<div class="card section-card summary-card">' +
      head('👤', esc(S.titles.summary), 'summary') +
      (headline ? '<p class="pull-quote">' + esc(headline) + '</p>' : '') +
      essenceBlock(report.essence) + paragraphs(report.summary) + '</div>';
    if (patterns.length) part += patternsCardHtml(patterns);
    html += partCardHtml('overview', part);

    // Part 1: who you are. MBTI first: the type is what most readers know and
    // look for. The model still writes the Big Five first (the E/I letter is
    // checked against the extraversion score); only the page order changed.
    // Wellbeing closes it: it is a read of the person, not of how they relate.
    const mbti = report.mbti || {};
    // No type nickname ("The Protagonist"): the reader already has one
    // character to identify with, and a second label competes with it.
    part = '<div class="card section-card mbti-card">' +
      head('🧭', 'MBTI', 'mbti') +
      '<div class="type-hero"><span class="type-code">' + esc(mbti.type) + '</span></div>' +
      mbtiSlidersHtml(mbti) + '</div>';
    part += '<div class="card section-card">' + head('📊', esc(TEXT.bigFive), 'bigFive') +
      bigFiveStructuredHtml(report.bigFive) + '</div>';
    part += paidCard(paid('wellness'), unlocked, { sample, flat: true, title: S.titles.wellness, sub: S.definitions.wellness,
      body: wellnessStructuredBody });
    html += partCardHtml('who', part);

    // Part 2: what drives you.
    part = '';
    const motivators = motivatorsHtml(report.motivators);
    if (motivators) {
      part += '<div class="card section-card motivators-card">' +
        head('🧲', esc(S.titles.motivators), 'motivators') + motivators + '</div>';
    }
    part += '<div class="card section-card">' + head('✨', esc(TEXT.interests), 'interests') +
      interestsStructuredHtml(report.interests) + '</div>';
    part += '<div class="card section-card">' + head('🧿', esc(TEXT.valuesBeliefs), 'values') +
      standForHtml(report) + '</div>';
    html += partCardHtml('drives', part);

    // Part 3: how you connect and work.
    const relationship = report.relationship || {};
    const attachment = unlocked.attachment;
    const idealPartner = unlocked.idealPartner;
    const closeness = attachment || idealPartner;
    part = '<div class="card section-card relationships-card' +
      (closeness ? ' paid-card attachment-card" data-paid="attachment' : '') + '">' +
      head('💞', esc(TEXT.relationships), 'relationships') +
      relationshipsStructuredBody(relationship, attachment, idealPartner) + '</div>';
    // Locked (the sample), the two premium halves keep their own covers.
    if (!attachment) part += paidCard(paid('attachment'), unlocked, { sample, flat: true });
    if (!idealPartner) part += paidCard(paid('idealPartner'), unlocked, { sample, flat: true });
    // How you work: the description and the coach's read as one section.
    // Locked, the coach's read keeps its own cover below.
    const career = report.career || {};
    const coaching = unlocked.careerAssessment;
    part += '<div class="card section-card work-card' + (coaching ? ' paid-card career-card" data-paid="careerAssessment' : '') + '">' +
      head('💼', esc(S.titles.work), 'work') + workStructuredBody(career, coaching) + '</div>';
    if (!coaching) part += paidCard(paid('careerAssessment'), unlocked, { sample, flat: true });
    html += partCardHtml('connect', part);

    // Part 4: putting it together.
    part = '';
    const workActions = ((coaching && coaching.actions) || []).filter(a => a && a.title)
      .map(a => ({ horizon: a.horizon, step: a.title, detail: a.detail, from: S.fromWork }));
    const wellnessActions = ((unlocked.wellness && unlocked.wellness.suggestions) || []).filter(a => a && a.title)
      .map(a => ({ horizon: 'this week', step: a.title, detail: a.detail, from: S.fromWellbeing }));
    const development = developmentHtml(report.development, sample, workActions.concat(wellnessActions));
    if (development) {
      part += '<div class="card section-card development-card">' + head('🌱', esc(S.titles.development), 'development') +
        development + '</div>';
    }
    if ((report.pressurePoints || []).some(item => item && item.strength)) {
      part += '<div class="card section-card pressure-card">' + head('⚖️', esc(S.titles.pressurePoints), 'pressurePoints') +
        pressurePointsHtml(report.pressurePoints) + '</div>';
    }
    html += partCardHtml('together', part);

    // Part 05, the appendix: how the report was made, then the roast — after
    // the method rather than in the middle of the report, so the professional
    // read is whole before the unkind one starts.
    // A part like the others, that opens and shuts.
    html += partCardHtml('appendix',
      // Evidence and method lives on My Psyche now, beside the card it rates;
      // the sample, which has no My Psyche, keeps it here.
      (ownPage ? '' : methodCardHtml(report, sample)) +
      (roast ? roastBlock(roast, { flat: true }).replace('class="card section-card bonus-card"', 'class="card section-card bonus-card" data-part="roast"') : ''));
    return html;
  }

  /**
   * Marks a report root as structured, for the styles that only that layout
   * uses, and lights the part the reader is in on the part nav.
   */
  let partObserver = null;
  function markStructured(root) {
    if (!root) return;
    root.classList.toggle('layout-structured', Boolean(root.querySelector('.part-card')));
    const nav = root.querySelector('.part-nav');
    if (!nav || typeof IntersectionObserver !== 'function') return;
    if (partObserver) partObserver.disconnect();
    // On a phone the nav's lead names the part the reader is in.
    const lead = nav.querySelector('.part-nav-lead');
    const light = key => nav.querySelectorAll('.part-nav-item').forEach(button => {
      const on = button.getAttribute('data-part-target') === key;
      button.classList.toggle('is-current', on);
      if (on && lead) lead.textContent = button.querySelector('.part-nav-label').textContent;
    });
    // Whole parts are watched, not their headings, so a jump into the middle
    // of a long part (the plan, deep in part 04) still lights that part. The
    // part crossing a thin band near the top of the screen is the current one.
    const inBand = new Set();
    const keyOf = node => node.getAttribute('data-part') || node.getAttribute('data-part-card');
    partObserver = new IntersectionObserver(entries => {
      entries.forEach(e => (e.isIntersecting ? inBand.add(e.target) : inBand.delete(e.target)));
      const current = [...inBand].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (current) light(keyOf(current));
    }, { rootMargin: '-20% 0px -70% 0px' });
    root.querySelectorAll('.part-card[data-part-card]').forEach(node => partObserver.observe(node));
    light('overview');
  }

  /**
   * "Beyond your card": the card's lines the card itself has no room for —
   * attachment, conflict, rhythm, social energy, work style, and the
   * strengths and costs in relationships and at work. They travel in the
   * compatibility link, so the reader sees what is in it; each is one the full
   * report explains, so the panel leads into the unlock box under it. A
   * "(tentative)" the model wrote becomes a tag rather than words in the line.
   */
  function beyondCardHtml(card) {
    if (!card || typeof card !== 'object') return '';
    const B = Copy.STRUCTURED.beyond;
    const line = (label, value) => {
      const raw = Copy.gentleAttachment(String(value || '').trim());
      if (!raw) return '';
      const tentative = /\(tentative\)\s*$/i.test(raw);
      const text = raw.replace(/\s*\(tentative\)\s*$/i, '');
      return '<div class="beyond-line"><p class="beyond-label">' + esc(label) +
        (tentative ? ' <span class="beyond-tag">' + esc(B.tentative) + '</span>' : '') + '</p>' +
        '<p class="beyond-value">' + esc(text.charAt(0).toUpperCase() + text.slice(1)) + '</p></div>';
    };
    const list = (label, items, kind) => {
      const rows = (Array.isArray(items) ? items : []).filter(Boolean);
      if (!rows.length) return '';
      return '<div class="beyond-line"><p class="beyond-label">' + esc(label) + '</p><ul class="beyond-list beyond-' + kind + '">' +
        rows.map(item => '<li><span class="beyond-mark" aria-hidden="true">' + (kind === 'good' ? '✓' : '!') + '</span><b>' + esc(item) + '</b></li>').join('') + '</ul></div>';
    };
    const columns = [
      // With friends, not in love: no attachment style here (the card travels
      // to anyone its link reaches); the full report keeps it.
      ['🤝', B.relationships, line(B.conflict, card.conflictStyle) +
        list(B.strengths, card.relationshipStrengths, 'good') + list(B.watchOuts, card.relationshipWeaknesses, 'warn')],
      ['☀️', B.dayToDay, line(B.rhythm, card.rhythm) + line(B.energy, card.energy)],
      ['💼', B.work, line(B.workStyle, card.workStyle) + list(B.strengths, card.careerStrengths, 'good') +
        list(B.holdsBack, card.careerWeaknesses, 'warn')],
    ].filter(([, , body]) => body);
    if (!columns.length) return '';
    return '<section class="card section-card beyond-card screen-only" aria-labelledby="beyond-title">' +
      '<h2 id="beyond-title">' + esc(B.title) + '</h2><p class="beyond-sub">' + esc(B.sub) + '</p>' +
      '<div class="beyond-grid">' + columns.map(([icon, title, body]) =>
        '<div class="beyond-col"><h3><span class="beyond-icon" aria-hidden="true">' + icon + '</span>' + esc(title) + '</h3>' + body + '</div>').join('') +
      '</div><p class="beyond-foot">' + esc(B.foot) + ' <span aria-hidden="true">↓</span></p></section>';
  }

  /** The attachment read with the app's gentler names put in, field by field. */
  function gentleAttachmentOf(attachment) {
    const out = Object.assign({}, attachment);
    for (const key of ['style', 'styleTone', 'why', 'conflict', 'caveat']) {
      if (typeof out[key] === 'string') out[key] = Copy.gentleAttachment(out[key]);
    }
    return out;
  }

  function reportSectionsHtml(report, options) {
    const sample = Boolean(options && options.sample);
    // The free report is the card above this and nothing else. What sits
    // under it is the offer of everything that explains it, and the
    // confidence card, which holds the page's own controls.
    if (!sample && options && options.explained === false) {
      const unlocked = paidAnalysis();
      // Structured: Evidence and method under the offer (freeMethodCardHtml),
      // and no re-run here — more data comes with the full report, whose
      // unlock asks for it before the run.
      // Their link right under their card, while the card is all they have.
      // Their link last, after Evidence and method.
      return beyondCardHtml(state.profile && state.profile.card) + fullReportLockedHtml() +
        (Object.keys(unlocked).length
          ? PAID_SECTIONS.map(section => paidCard(section, unlocked, {})).join('') : '') +
        (reportLayout() === 'structured' ? freeMethodCardHtml(report) : confidenceCardHtml(report, false)) +
        referralCardHtml(false);
    }
    if (reportLayout() === 'structured') return structuredSectionsHtml(report, options);
    // Every section of the report body is a disclosure; sectionHead's other
    // caller — the scan page's QR-contents block — is not, so the default
    // stays off there and this local alias turns it on for the report only.
    // The confidence card at the bottom deliberately calls sectionHead
    // directly instead, and stays open: see its own comment.
    const head = (icon, title, sub) => sectionHead(icon, title, sub, true);

    let html = '';

    // No glance row here any more: the psyche card above the report already
    // shows the type and the highest and lowest traits, and
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

    html += mbtiAxesHtml(mbti);
    html += '<p class="fineprint">' + esc(mbti.caveat) + '</p></div>';

    // Interests.
    html += '<div class="card section-card">' + head('✨', esc(TEXT.interests)) +
      interestsHtml(report.interests) + '</div>';

    // Values and beliefs, together — they answer the same question from two
    // directions, and splitting them left two thin cards.
    html += '<div class="card section-card">' +
      head('🧿', esc(TEXT.valuesBeliefs), esc(TEXT.valuesBeliefsSub)) +
      valuesBeliefsHtml(report) + '</div>';

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
      careerDescriptionHtml(career) + '</div>';

    // Instagram behaviour: the part of the export nobody reads themselves.
    // It sits after the personality sections because it is the evidence
    // underneath them rather than another verdict.
    const activity = report.activity;
    if (activity) {
      // No sub-line and no closing caveat: the summary said in prose what the
      // four facets say with evidence attached, and the blind-spots note
      // duplicated the confidence section that closes the whole report.
      html += '<div class="card section-card">' + head('📱', esc(TEXT.activity)) +
        activityFacetsHtml(activity) + '</div>';
    }

    // The roast. Free, behind a click-to-reveal cover rather than a payment,
    // and placed right after the digital footprint it draws its evidence
    // from — this used to sit after all four paid sections, back when it
    // was one of them; now that it is not, it belongs with the free report
    // it is actually part of, not stranded after the paywall.
    // The sample keeps it back: the roast is the full report's secret bonus.
    if (!sample) html += roastBlock(report.bonus);

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
    const unlocked = sample ? sampleUnlocked(report) : paidAnalysis();
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
    html += confidenceCardHtml(report, sample);

    return html;
  }

  /**
   * A free report's Evidence and method, under the unlock offer: the score,
   * why, and what was read. No sources list and no re-run — more data comes
   * with the full report, whose unlock asks for it before the run.
   */
  function freeMethodCardHtml(report) {
    return '<div class="card section-card confidence-card method-card free-method-card">' +
      sectionHead('🎯', esc(Copy.STRUCTURED.titles.method), '') + methodEvidenceHtml(report, false) + '</div>';
  }

  /**
   * Beside a free report's card: empty until the reader points at a part of
   * the card, when that part's meaning pops out level with it — what it is,
   * the reader's own reading, and why it is worth knowing. Above it, the
   * card's three actions: download, share, compatibility. Enlarging is the
   * card's own: a click on it anywhere a part is not explained, or on a
   * phone the "Tap to open full screen" button under it.
   */
  function cardGuideHtml(report, paid) {
    const G = Copy.STRUCTURED.cardGuide;
    cardGuideState = cardGuideFor(report);
    const tool = (act, svg) => '<button type="button" class="cx-tool" data-act="' + act + '" title="' + esc(G.toolTips[act]) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      svg + '</svg><span>' + esc(G.tools[act]) + '</span></button>';
    return '<div class="cx" aria-label="' + esc(G.title) + '">' +
      '<div class="cx-home">' +
        '<h2 class="cx-home-title">' + esc(G.home.title) + '</h2>' +
        '<div class="cx-tools">' +
          tool('download', '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>') +
          tool('share', '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>') +
          tool('copy', '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>') +
          // Once the report is unlocked: the way into it, across all three.
          (fullReportPage() ? '<button class="btn cx-open-report" type="button" data-nav="full" id="open-report">' +
            '<span>' + esc(Copy.STRUCTURED.reportPage.open) + '</span>' +
            '<svg class="cx-open-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></button>' : '') +
        '</div>' +
        '<p class="cx-status" role="status" hidden></p>' +
        // What the card is, then where its reasoning is: below, or behind the unlock.
        '<p class="cx-home-intro">' + esc(G.home.intro) + ' ' + esc(paid ? G.home.introPaid : G.home.introFree) + '</p>' +
        '<p class="cx-home-hint"><span aria-hidden="true">✨</span><span><span class="cx-hint-hover">' + esc(G.home.hover) +
          '</span><span class="cx-hint-tap">' + esc(G.home.tap) + '</span></span></p>' +
      '</div>' +
      '<div class="cx-stage">' +
        '<div class="cx-pop" role="status" aria-live="polite" hidden>' +
          '<span class="cx-arrow" aria-hidden="true"></span>' +
          '<button type="button" class="cx-close" aria-label="Close">✕</button>' +
          '<div class="cx-pop-head"><span class="cx-pop-icon" aria-hidden="true"></span><strong class="cx-pop-title"></strong></div>' +
          '<div class="cx-pop-body"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  let cardGuideState = null;
  // The same explanations for the sample's card, full screen.
  let sampleGuideState = null;

  /** What each part of a card means, and what it says on this one. */
  function cardGuideFor(report, yoursLabel) {
    const facts = cardGuideFacts(report);
    return { facts, yoursLabel, items: Copy.STRUCTURED.cardGuide.items.filter(item => item.when(facts)) };
  }

  /** The facts the guide's lines are written from, read off the card's report. */
  function cardGuideFacts(report) {
    const S = Copy.STRUCTURED;
    const essence = report.essence || {};
    const five = report.bigFive || {};
    const traits = Object.keys(TRAIT_LABELS).filter(key => five[key]);
    const standout = traits.slice().sort((a, b) =>
      Math.abs((Number(five[b].score) || 50) - 50) - Math.abs((Number(five[a].score) || 50) - 50))[0];
    const love = (report.relationship && report.relationship.loveLanguages) || {};
    const first = list => ((list || []).find(entry => entry && entry.language) || {}).language || '';
    const patterns = signaturePatterns(report);
    const motives = cardMotivators(report);
    return {
      character: essenceName(essence), franchise: essence.franchise || '',
      score: Math.round(Number((report.card || {}).confidence) || Number((report.confidence || {}).score) || 0),
      level: (report.confidence || {}).level || '',
      pattern: patterns[0] ? patterns[0].name : '',
      motive: motives[0] ? S.motivators[motives[0]].label : '',
      motives: motives.map(key => S.motivators[key].label),
      // What each one means, from the app's own copy rather than the model.
      motiveMeanings: motives.map(key => S.motivators[key].meaning),
      chosen: ((report.mbti || {}).letters || []).map(l => l && l.choice).filter(Boolean),
      type: (report.mbti || {}).type || '',
      letters: ((report.mbti || {}).letters || []).filter(l => l && l.choice && l.strength)
        .map(l => l.choice + ' ' + l.strength),
      trait: standout ? TRAIT_LABELS[standout] : '', traitScore: standout ? Math.round(Number(five[standout].score) || 0) : 0,
      value: titlesOf(report.values, 1)[0] || titlesOf(report.beliefs, 1)[0] || '',
      interest: titlesOf(report.interests, 1)[0] || '',
      loveIn: first(love.receiving), loveOut: first(love.giving),
    };
  }

  // The parts of the card each explanation belongs to.
  const GUIDE_TARGETS = {
    character: ['.pc-shero'],
    confidence: ['.pc-sconf'],
    patterns: ['.pc-spatterns'],
    motives: ['.pc-smotives'],
    type: ['.pc-sletters'],
    bigFive: ['.pc-straits'],
    standFor: ['.pc-schips'],
    love: ['.pc-slove-panel'],
    qr: ['.pc-qr-slot'],
  };

  /** Marks each explained part of the reader's card with the key of its explanation. */
  function markCardParts(cards = [$('#psyche-card'), $('#psyche-card-full')]) {
    // The page's card and its full-screen copy, which is where a phone explains it.
    for (const card of cards) {
      if (!card) continue;
      for (const [key, selectors] of Object.entries(GUIDE_TARGETS)) {
        for (const selector of selectors) {
          card.querySelectorAll(selector).forEach(node => {
            (node.closest('.pc-spanel, .pc-shero, .pc-sconf') || node).setAttribute('data-cx', key);
          });
        }
      }
    }
  }

  function lightCardPart(key, card = $('#psyche-card')) {
    if (!card) return;
    card.querySelectorAll('.pc-glow').forEach(node => node.classList.remove('pc-glow'));
    card.classList.toggle('pc-guiding', Boolean(key));
    if (key) card.querySelectorAll('[data-cx="' + key + '"]').forEach(node => node.classList.add('pc-glow'));
  }

  // On a phone the card is too small to explain in place: tapping it opens it
  // full screen, and the parts are explained there.
  const explainsFullScreen = () => window.matchMedia('(max-width: 719px)').matches &&
    $('#view-profile').classList.contains('profile-structured') && Boolean(cardGuideState);

  /** Fills an explanation box with what one part of the card means. */
  function fillCardPop(pop, item, state = cardGuideState) {
    const G = Copy.STRUCTURED.cardGuide;
    const facts = state.facts;
    pop.querySelector('.cx-pop-icon').textContent = item.icon;
    pop.querySelector('.cx-pop-title').textContent = item.title;
    pop.querySelector('.cx-pop-body').innerHTML =
      '<p class="cx-about">' + esc(item.about) + '</p>' +
      // MBTI's four letters in plain words, the reader's own letter of each pair marked.
      (item.letters ? '<ul class="cx-letters">' + item.letters.map(([a, b, what, line]) =>
        '<li><span class="cx-pair"><b class="' + (facts.chosen.includes(a) ? 'is-yours' : '') + '">' + esc(a) + '</b>' +
        '<b class="' + (facts.chosen.includes(b) ? 'is-yours' : '') + '">' + esc(b) + '</b></span>' +
        '<span><strong>' + esc(what) + '</strong> ' + esc(line) + '</span></li>').join('') + '</ul>' : '') +
      // The Big Five's traits, one line each.
      (item.terms ? '<ul class="cx-letters cx-terms">' + item.terms.map(([term, line]) =>
        '<li><span><strong>' + esc(term) + '</strong> – ' + esc(line) + '</span></li>').join('') + '</ul>' : '') +
      '<div class="cx-yours"><span class="cx-label">' + esc(state.yoursLabel || G.labels.yours) + '</span>' + esc(item.yours(facts)) + '</div>';
    pop.scrollTop = 0;
    pop.hidden = false;
  }

  /** Pops the explanation of one part of the card out beside it, level with it. */
  function explainCardPart(key) {
    const panel = $('#profile-side .cx');
    const pop = panel && panel.querySelector('.cx-pop');
    const item = cardGuideState && cardGuideState.items.find(entry => entry.key === key);
    if (!pop) return;
    $('#psyche-card') && $('#psyche-card').classList.remove('pc-hint');
    if (!item) {
      pop.hidden = true;
      panel.classList.remove('is-explaining');
      lightCardPart(null);
      return;
    }
    fillCardPop(pop, item);
    panel.classList.add('is-explaining');
    lightCardPart(key);
    // Level with the part it explains, kept inside the panel; the arrow
    // still points at the part's middle when the box has to stop short.
    const part = document.querySelector('#psyche-card [data-cx="' + key + '"]');
    if (!part || !window.matchMedia('(min-width: 720px)').matches) { pop.style.transform = ''; return; }
    const area = panel.getBoundingClientRect();
    const r = part.getBoundingClientRect();
    const middle = r.top + r.height / 2 - area.top;
    const top = Math.max(0, Math.min(area.height - pop.offsetHeight, middle - pop.offsetHeight / 2));
    pop.style.transform = 'translateY(' + Math.round(top) + 'px)';
    pop.querySelector('.cx-arrow').style.top = Math.round(Math.max(14, Math.min(pop.offsetHeight - 14, middle - top))) + 'px';
  }

  /**
   * Full screen on a phone: the tapped part's explanation opens right beside
   * it, on whichever side has more room — under "Who you are most like", over
   * the love languages — so the sheet reads as the part's own note and does
   * not cover what it explains.
   */
  function explainFullCardPart(key) {
    const card = $('#psyche-card-full');
    const pop = $('#card-dialog .cx-pop');
    const item = cardGuideState && cardGuideState.items.find(entry => entry.key === key);
    if (!pop || !card) return;
    card.classList.remove('pc-hint');
    if (!item) { pop.hidden = true; lightCardPart(null, card); return; }
    fillCardPop(pop, item);
    lightCardPart(key, card);
    placeCardPop(pop, card.querySelector('[data-cx="' + key + '"]'), card);
  }

  /**
   * Puts a full-screen explanation right against the part it explains.
   *
   * Beside the card, level with the part and pointing at it, where the screen
   * leaves room for that — a laptop. Otherwise just under the part, or just
   * over it when there is more room above, and kept on screen; never shorter
   * than a third of the screen, scrolling past that and overlapping the part
   * only if it must.
   */
  function placeCardPop(pop, part, card) {
    const r = part && part.getBoundingClientRect();
    if (!r) return;
    const W = window.innerWidth, H = window.innerHeight, gap = 8, edge = 12;
    const frame = card.getBoundingClientRect();
    const room = W - frame.right - 2 * edge;
    const side = room >= 300;
    pop.classList.toggle('at-side', side);
    pop.style.maxHeight = pop.style.top = pop.style.bottom = pop.style.left = pop.style.right = pop.style.width = pop.style.overflowY = '';
    if (side) {
      pop.classList.remove('at-top');
      pop.style.left = Math.round(frame.right + 2 * edge) + 'px';
      pop.style.right = 'auto';
      pop.style.width = Math.round(Math.min(380, room - 2 * edge)) + 'px';
      pop.style.bottom = 'auto';
      pop.style.maxHeight = (H - 2 * edge) + 'px';
      // Scrolling only when it must: a scrolling box clips the arrow.
      pop.style.overflowY = 'visible';
      if (pop.scrollHeight > pop.clientHeight + 1) pop.style.overflowY = 'auto';
      const middle = r.top + r.height / 2;
      const top = Math.max(edge, Math.min(H - edge - pop.offsetHeight, middle - pop.offsetHeight / 2));
      pop.style.top = Math.round(top) + 'px';
      const arrow = pop.querySelector('.cx-arrow');
      if (arrow) arrow.style.top = Math.round(Math.max(14, Math.min(pop.offsetHeight - 14, middle - top))) + 'px';
      return;
    }
    // Narrower than the card, inset from both its edges, so the note reads as
    // laid over the card rather than as one more of its rows.
    const inset = Math.max(14, Math.round(frame.width * 0.05));
    pop.style.left = Math.round(Math.max(edge, frame.left + inset)) + 'px';
    pop.style.right = Math.round(Math.max(edge, W - frame.right + inset)) + 'px';
    const least = Math.round(H * 0.34);
    const under = r.bottom < H - r.top;
    pop.classList.toggle('at-top', !under);
    if (under) {
      const top = Math.min(r.bottom + gap, H - edge - least);
      pop.style.top = Math.round(Math.max(edge, top)) + 'px';
      pop.style.bottom = 'auto';
      pop.style.maxHeight = Math.round(H - edge - Math.max(edge, top)) + 'px';
    } else {
      const bottom = Math.max(r.top - gap, edge + least);
      pop.style.bottom = Math.round(H - Math.min(H - edge, bottom)) + 'px';
      pop.style.top = 'auto';
      pop.style.maxHeight = Math.round(Math.min(H - edge, bottom) - edge) + 'px';
    }
  }

  /** The sample's card, full screen: the same explanations, for its parts. */
  function explainSampleCardPart(key) {
    const card = $('#sample-psyche-card-full');
    const pop = $('#sample-card-dialog .cx-pop');
    const item = sampleGuideState && sampleGuideState.items.find(entry => entry.key === key);
    if (!pop || !card) return;
    card.classList.remove('pc-hint');
    if (!item) { pop.hidden = true; lightCardPart(null, card); return; }
    fillCardPop(pop, item, sampleGuideState);
    lightCardPart(key, card);
    placeCardPop(pop, card.querySelector('[data-cx="' + key + '"]'), card);
  }

  /** Readies the sample's full-screen card to be explained, from the report it was drawn from. */
  function guideSampleCard(report) {
    const card = $('#sample-psyche-card-full');
    const dialog = $('#sample-card-dialog');
    sampleGuideState = report && reportLayout() === 'structured'
      ? cardGuideFor(report, Copy.STRUCTURED.cardGuide.labels.sample) : null;
    dialog.classList.toggle('is-explained', Boolean(sampleGuideState));
    const G = Copy.STRUCTURED.cardGuide;
    $('#sample-card-tip').textContent = sampleGuideState ? (canHover() ? G.sampleTip.hover : G.sampleTip.tap) : '';
    explainSampleCardPart(null);
    if (!sampleGuideState) return;
    markCardParts([card]);
    card.classList.add('pc-hint');
  }

  const canHover = () => Boolean(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  // Pointing at a part of the card explains it; leaving the card puts the
  // panel back to where to start.
  // The sample's card full screen: pointing at a part explains it, beside the
  // card; leaving the card for anywhere but the explanation puts it away.
  document.addEventListener('mouseover', event => {
    if (!canHover() || !event.target.closest || !sampleGuideState) return;
    const part = event.target.closest('#sample-psyche-card-full [data-cx]');
    if (part) explainSampleCardPart(part.getAttribute('data-cx'));
  });
  document.addEventListener('mouseout', event => {
    if (!canHover() || !event.target.closest || !sampleGuideState) return;
    const inside = node => node && node.closest && node.closest('#sample-card-dialog .card-dialog-frame, #sample-card-dialog .cx-pop');
    if (inside(event.target) && !inside(event.relatedTarget)) explainSampleCardPart(null);
  });
  document.addEventListener('mouseover', event => {
    if (!canHover() || !event.target.closest || explainsFullScreen()) return;
    const part = event.target.closest('#psyche-card [data-cx]');
    if (part && $('#view-profile').classList.contains('profile-structured')) explainCardPart(part.getAttribute('data-cx'));
  });
  document.addEventListener('mouseout', event => {
    const slot = event.target.closest && event.target.closest('#psyche-card-open');
    if (!slot || !canHover() || (event.relatedTarget && slot.contains(event.relatedTarget))) return;
    if ($('#view-profile').classList.contains('profile-structured')) explainCardPart(null);
  });
  // A tap on a part of the card, where there is no pointer to hover with,
  // explains it instead of opening the card full screen — except on a phone,
  // where tapping the card opens it full screen and the parts are explained
  // there. Captured, so the card's own click never sees it.
  document.addEventListener('click', event => {
    if (!event.target.closest) return;
    const dialog = $('#card-dialog');
    if (dialog && dialog.open && dialog.classList.contains('is-guided') && event.target.closest('#card-dialog')) {
      const full = dialog.querySelector('.cx-pop');
      const part = event.target.closest('#psyche-card-full [data-cx]');
      // With an explanation showing, a tap anywhere outside it — another part
      // of the card too — only puts it away, back to the card; with none
      // showing, a part explains itself and anywhere else closes the card.
      if (!full.hidden && !event.target.closest('.cx-pop') && !event.target.closest('#card-dialog-close')) explainFullCardPart(null);
      else if (part) explainFullCardPart(part.getAttribute('data-cx'));
      else if (event.target.closest('.cx-close')) explainFullCardPart(null);
      else return;
      event.stopPropagation();
      return;
    }
    // The same for the sample's card, full screen.
    const sample = $('#sample-card-dialog');
    if (sample && sample.open && sampleGuideState && event.target.closest('#sample-card-dialog') &&
        !event.target.closest('.sample-card-nav')) {
      const pop = sample.querySelector('.cx-pop');
      const part = event.target.closest('#sample-psyche-card-full [data-cx]');
      if (!pop.hidden && !event.target.closest('.cx-pop') && !event.target.closest('#sample-card-dialog-close')) explainSampleCardPart(null);
      else if (part) explainSampleCardPart(part.getAttribute('data-cx'));
      else if (event.target.closest('.cx-close')) explainSampleCardPart(null);
      else return;
      event.stopPropagation();
      return;
    }
    // A tap anywhere but the explanation itself puts it away. On a touch
    // screen that includes another part of the card: the tap goes back to
    // the card rather than straight on to the next explanation. (With a
    // pointer, hovering has already moved it to the part under it.)
    const openPop = document.querySelector('#profile-side .cx-pop:not([hidden])');
    if (openPop && !event.target.closest('.cx-pop')) {
      const onPart = event.target.closest('#psyche-card [data-cx]');
      if (!onPart || !canHover()) explainCardPart(null);
      if (onPart && !canHover()) { event.preventDefault(); event.stopPropagation(); return; }
    }
    const tool = event.target.closest('.cx-tool');
    if (tool) {
      const act = tool.getAttribute('data-act');
      if (act === 'copy') copyShareMessage(tool);
      else if (act === 'download') downloadCardImage({ currentTarget: tool });
      else if (act === 'share') shareCardImage({ currentTarget: tool });
      return;
    }
    if (event.target.closest('.cx-close')) { explainCardPart(null); return; }
    // A click or tap on one of the card's parts explains that part; anywhere
    // else on the card (the zoom-in cursor) opens it full screen.
    if (!event.target.closest('#psyche-card-open') || !$('#view-profile').classList.contains('profile-structured')) return;
    const part = event.target.closest('#psyche-card [data-cx]');
    event.preventDefault();
    event.stopPropagation();
    if (explainsFullScreen() || !part) openPsycheCard();
    else explainCardPart(part.getAttribute('data-cx'));
  }, true);

  // Confidence closes the report rather than opening it: read after the
  // whole thing, it says how much of what you just read to believe. Shared by
  // the full report and the card-only one, which both end on it.
  function confidenceCardHtml(report, sample) {
    return '<div class="card section-card confidence-card">' +
      sectionHead('🎯', esc(TEXT.trust), esc(TEXT.trustSub)) +
      (reportLayout() === 'structured' ? methodEvidenceHtml(report, sample)
        : confidenceBodyHtml(report) + (sample ? '' : sourcesUsedHtml(false))) +
      '</div>';
  }

  // The score, its rationale and what it was read off. Shared by the classic
  // confidence card and the structured layout's method section.
  function confidenceBodyHtml(report) {
    return '<div class="confidence-meter"><div class="confidence-fill" data-fill="' + Math.round(report.confidence.score) + '"></div></div>' +
      '<p><strong>' + esc(TEXT.trustScore) + Math.round(report.confidence.score) + '/100 (' + esc(report.confidence.level) + ').</strong> ' +
      // The card carries no rationale — that is part of the written report.
      (report.confidence.rationale ? esc(report.confidence.rationale) : '') + '</p>' +
      // What the score was read off, beside the score. This is what makes the
      // number checkable rather than asserted: a reader who is told "88/100,
      // comprehensive fourteen-year archive" has no way to know the model saw
      // 3% of the messages, and "300 of 9,741 own messages" says it plainly.
      // Optional, so a report generated before this field existed still
      // renders — the same reason attachment.styleTone is.
      ((report.confidence.basedOn || []).length
        ? '<p class="essence-label">' + esc(TEXT.confidenceBasedOn) + '</p>' +
          '<p class="trait-evidence">' + report.confidence.basedOn
            .map(item => '<span class="ev">' + esc(item) + '</span>').join('') + '</p>'
        : '');
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
    // A quiet pill per line, the model in the ink colour and the date short.
    const when = at => new Date(at).toLocaleString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    // One quiet box, a line per thing that was written.
    const line = (icon, lead, model, at) => '<span class="provenance-item"><span class="provenance-icon" aria-hidden="true">' +
      icon + '</span><span>' + esc(lead) + ' <b>' + esc(model) + '</b> on ' + esc(when(at)) + '.</span></span>';
    const lines = [line('✦', 'Psyche Card generated by', profile.model || 'the model', profile.createdAt)];
    if (profile.premiumAnalysis && profile.premiumModel && profile.premiumAt) {
      lines.push(line('★', 'Full premium report written by', profile.premiumModel, profile.premiumAt));
    }
    $('#analysed-by').innerHTML = '<div class="provenance-box">' + lines.join('') + '</div>';
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
      ' · ' + Math.round(report.confidence.score) + '/100 confidence';

    const cardHtml = psycheCardHtml(report, { own: true });
    $('#psyche-card').innerHTML = cardHtml;
    freshArtIds($('#psyche-card'));
    $('#psyche-card-full').innerHTML = cardHtml;
    freshArtIds($('#psyche-card-full'));
    fillCardQr();
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
    // Structured, a free report sets its card beside what it was read from
    // and has no nav; a full one moves the card above the nav on a wide screen.
    const structured = reportLayout() === 'structured';
    const explained = hasExplanations(profile);
    // Unlocked, the report is two pages: My Psyche (the hub: the card, the
    // link, what it carries, how it was read, and the way to the report) and
    // My Report (Parts 00-04 and the roast, the part nav down the left).
    const reportPage = structured && explained && profilePage === 'report';
    const hub = structured && explained && !reportPage;
    const view = $('#view-profile');
    view.classList.toggle('profile-structured', structured);
    view.classList.toggle('profile-free', structured && !reportPage);
    view.classList.toggle('profile-paid', reportPage);
    view.classList.toggle('profile-hub', hub);
    // My Report starts at Part 00: the card is on My Psyche, one tap back.
    $('#profile-top').hidden = reportPage;
    $('#report-back').hidden = !reportPage;
    // Both open on the card with what it means beside it.
    const side = $('#profile-side');
    side.hidden = !structured || reportPage;
    setHtml(side, side.hidden ? '' : cardGuideHtml(report, explained));
    if (!side.hidden) {
      markCardParts();
      // Where to start: the ring pulses gently until the reader points at anything.
      $('#psyche-card').classList.add('pc-hint');
    }
    // My Psyche has only the card, which has its own download: the full
    // report's is on My Report.
    $('#export-pdf-bottom').hidden = structured && !reportPage;
    // Either way its compatibility test is one of the card's tools.
    $('#test-compat-open').hidden = structured;
    layoutPsycheCard();
    setHtml($('#profile-body'), hub ? hubSectionsHtml(report) : reportSectionsHtml(report, { explained, page: reportPage }));
    syncNav();
    refreshReferral().catch(() => {});
    // The card's QR code waits for the short link, then fits the card again.
    publishShortLink().then(link => {
      if (!link || !state.profile) return;
      fillCardQr();
      layoutPsycheCard();
    }).catch(() => {});
    layoutSideActions();
    collapseSections($('#profile-body'));
    // A full report on a phone opens on Part 00 with the other parts shut, so
    // the reader starts reading at once and sees the rest at a glance below
    // it; on a wider screen they all start open.
    if (reportPage && window.matchMedia && window.matchMedia(PHONE_REPORT).matches) {
      for (const card of $('#profile-body').querySelectorAll('.part-card')) {
        setSectionOpen(card, card.getAttribute('data-part-card') === 'overview');
      }
    }
    markStructured($('#profile-body'));

    // Sits after the action buttons rather than inside the report: it is a
    // record of the run, not a finding, and closing the page with it means
    // it stays true no matter what gets added between the report and the
    // buttons above it.
    renderAnalysedBy(profile);
    refreshSyncInvite();
    refreshGiftBanner();
  }

  // Past results as a list rather than a table: a row each, the whole row the
  // link. A five-column table scrolled sideways on a phone and cut the date
  // off; this keeps who, on what basis, when and the score on one line at any
  // width, with the score drawn as the same ring the report opens on.
  function historyList(history) {
    const when = value => {
      const date = new Date(value);
      return isNaN(date) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    };
    return '<ul class="match-list">' +
      history.map((entry, index) => {
        const mode = entry.mode || (entry.report && entry.report.mode) || 'platonic';
        const name = String(entry.withName || '?');
        const score = Math.max(0, Math.min(100, Math.round(Number(entry.report && entry.report.score) || 0)));
        return '<li><a href="#" class="match-row" data-report="' + index + '">' +
          '<span class="match-face m-' + esc(mode) + '" aria-hidden="true">' + esc(name.trim().charAt(0).toUpperCase() || '?') + '</span>' +
          '<span class="match-who"><strong>' + esc(name) + '</strong>' +
          '<span class="match-meta">' + esc(MODE_LABELS[mode] || mode) + ' · ' + esc(when(entry.when)) + '</span></span>' +
          '<span class="match-score" data-pct="' + score + '"><span>' + score + '</span></span>' +
          '<span class="visually-hidden">' + 'Open report' + '</span>' +
          '<svg class="match-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>' +
          '</a></li>';
      }).join('') +
      '</ul>';
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

  // Compatibility travels as a link and nothing else. The compact card rides
  // in the fragment (#p=…), which a browser never sends to a server, so the
  // link is the data rather than a pointer to it. It used to be a QR code as
  // well, but a code that dense needed a camera at close range, was unreadable
  // off a screenshot in a Story, and only ever opened this same link.
  //
  // "Send my link" hands the share sheet a ready-written message, so what
  // arrives in WhatsApp or a DM says what it is rather than being a bare,
  // very long address. Without a share sheet (most desktops) the same message
  // goes to the clipboard.
  function compatMessage() {
    return shareMessage();
  }

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('no clipboard'));
  }

  function linkStatus(target, message) {
    const status = typeof target === 'string' ? $(target) : target;
    if (!status) return;
    status.textContent = message;
    clearTimeout(status._clear);
    status._clear = setTimeout(() => { status.textContent = ''; }, 6000);
  }

  async function sendMyLink(statusSelector) {
    if (!state.profile) return;
    const text = compatMessage();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        // Backed out of the sheet themselves: nothing to fall back from.
        if (error && error.name === 'AbortError') return;
      }
    }
    writeClipboard(text).then(
      () => linkStatus(statusSelector, TEXT.linkMessageCopied),
      () => window.prompt(TEXT.linkCopyPrompt, text));
  }

  // Copy link: the same message Share Card sends, link and all.
  function copyMyLink(button, statusSelector) {
    const url = shareMessage();
    writeClipboard(url).then(() => {
      const label = button.textContent;
      button.textContent = 'Copied ✓';
      setTimeout(() => { button.textContent = label; }, 2000);
      linkStatus(statusSelector, TEXT.linkMessageCopied);
    }, () => window.prompt(TEXT.linkCopyPrompt, url));
  }
  $('#share-link').addEventListener('click', () => sendMyLink('#share-link-status'));
  $('#share-link-report').addEventListener('click', () => sendMyLink('#share-link-report-status'));
  // Share PDF: the same PDF Download PDF saves, to the share sheet with the
  // one share message; where files cannot be shared, it is downloaded.
  $('#share-compat-image').addEventListener('click', async () => {
    const last = state.lastReport;
    if (!last) return;
    let pdf;
    try { pdf = compatPdf(last); } catch (error) { linkStatus('#compat-share-status', 'Could not build the PDF.'); return; }
    const file = new File([pdf.blob], pdf.name, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareMessage() }); return; }
      catch (error) { if (error && error.name === 'AbortError') return; }
    }
    exportCompatPdf();
  });
  $('#copy-link').addEventListener('click', () => copyMyLink($('#copy-link'), '#share-link-status'));
  $('#copy-link-scan').addEventListener('click', () => copyMyLink($('#copy-link-scan'), '#share-link-scan-status'));

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
      // A free profile prints its card and the offer, not empty sections.
      cardOnly: !hasExplanations(profile),
      // The structured layout's PDF, its method page and its running head.
      // Ignored by the classic build.
      layout: reportLayout(),
      build: (() => {
        const b = state.server && state.server.build;
        return b && b.version ? 'v' + b.version : '';
      })(),
      sources: [TEXT.sourceInstagram]
        .concat(state.digest && state.digest.google ? [TEXT.sourceGoogle] : [])
        .concat(state.digest && state.digest.facebook ? [TEXT.sourceFacebook] : [])
        .concat(state.digest && state.digest.whatsapp ? [TEXT.sourceWhatsApp] : []),
      // What the evidence page's "Read from" lists, the same as the page's.
      counted: countedInFull(state.digest),
    });
  }

  // ---------- where the report goes ----------
  //
  // Straight to the reader's own disk, and nowhere else. The PDF is typeset in
  // the browser by pdf.js and handed to a temporary object URL, so the file
  // never touches the network and the server is never given anything
  // report-shaped to store even by accident.
  //
  // Nothing is asked for first. The download used to be gated behind an email
  // address, which bought the operator a mailing list at the cost of putting a
  // form in front of the one thing the reader had already paid for; the gate is
  // gone and the button now does what it says.
  /** "Psyche Report - Jared Sia - 05102026.pdf": whose, and the day it was written. */
  function reportFileName(profile) {
    const when = new Date(profile.createdAt || Date.now());
    const day = Number.isNaN(when.getTime()) ? new Date() : when;
    const ddmmyyyy = String(day.getDate()).padStart(2, '0') + String(day.getMonth() + 1).padStart(2, '0') + day.getFullYear();
    // Plain letters only: a browser can drop a name it cannot encode and save
    // the file as "download", so accents fold (Aleç → Alec) and anything still
    // outside ASCII, or unsafe in a file name, goes.
    const who = String((profile.card && profile.card.name) || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]+/g, ' ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'You';
    return 'Psyche Report - ' + who + ' - ' + ddmmyyyy + '.pdf';
  }

  function exportPdf() {
    const profile = state.profile;
    if (!profile) return;
    const href = URL.createObjectURL(buildReportPdf(profile));
    const link = document.createElement('a');
    link.download = reportFileName(profile);
    link.href = href;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Long enough for every browser to have started reading the blob, after
    // which holding it open only costs memory.
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  // ---------- psyche card: inline preview and full screen ----------
  //
  // Both copies are scaled here rather than in CSS, because the fit depends on
  // the viewport and on the column the preview happens to be sitting in, and
  // neither is knowable from a stylesheet.
  // A full report on a wide, tall screen has its nav down the left column,
  // with the page's actions under it (styles.css, .profile-paid).
  function sideCardMode() {
    const view = $('#view-profile');
    return Boolean(view && view.classList.contains('profile-paid') &&
      window.matchMedia && window.matchMedia('(min-width: 1000px) and (min-height: 520px)').matches);
  }

  function layoutSideActions() {
    const nav = document.querySelector('#profile-body .part-nav');
    if (!nav || !sideCardMode()) return;
    const view = $('#view-profile');
    // The left column's top level with the report's first part, as the page
    // first lays out; then the actions under it.
    const first = document.querySelector('#profile-body .report-hero') || document.querySelector('#profile-body .part-card');
    if (first && first.offsetParent) {
      const header = document.querySelector('.nav');
      const floor = (header ? header.getBoundingClientRect().height : 56) + 12;
      view.style.setProperty('--side-nav-top', Math.round(Math.max(floor, first.getBoundingClientRect().top + window.scrollY)) + 'px');
    }
    requestAnimationFrame(() => view.style.setProperty('--side-nav-bottom',
      Math.round(nav.getBoundingClientRect().bottom + 10) + 'px'));
  }

  /**
   * Full screen on a phone. Phones run from about 1:1.6 to 1:2.3 once the
   * browser's own bars are taken off, and a fixed 9:16 card fitted into that
   * leaves a band of empty screen at the sides or the foot. Here the card
   * takes the screen's own shape instead, within reason: as wide as the
   * screen less a slim margin, and as tall as the room above the line under
   * it. A taller card draws its content larger, and a shorter one a little
   * smaller (fitStoryContent); whatever height is left over is shared out
   * between the sections (.is-guided .pc-story-in). Only
   * this copy changes shape — the card on the page and the image saved from it
   * stay 1080 x 1920.
   */
  function fitGuidedCard(dialog, card) {
    if (!card) return;
    const css = getComputedStyle(dialog);
    const bar = dialog.querySelector('.card-dialog-bar');
    const width = dialog.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const height = dialog.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - (bar ? bar.offsetHeight : 0);
    if (width <= 0 || height <= 0) return;
    const tall = Math.min(GUIDED_CARD_MAX_H, Math.max(GUIDED_CARD_MIN_H, STORY_W * height / width));
    card.style.height = Math.round(tall) + 'px';
    card.dataset.grow = String(GUIDED_CARD_GROW);
    fitCard(card, width, height, 'screen');
  }
  const GUIDED_CARD_MIN_H = 1400;
  const GUIDED_CARD_MAX_H = 2800;
  // How much larger than the story's own type a tall phone may draw it.
  const GUIDED_CARD_GROW = 1.3;

  function layoutPsycheCard() {
    const slot = $('#psyche-card-open');
    if (slot && !$('#psyche-card-section').hidden) {
      // Capped in height as well as width. Left width-led it filled the column
      // and pushed "Who you are" a screen and a half down the page — the
      // opposite of what a summary above the report is for. It is a thumbnail
      // to be tapped, so it is sized like one.
      const width = slot.clientWidth || CARD_W;
      // Beside what it means, the card fills its box's width, however tall
      // that makes it.
      const fill = $('#view-profile').classList.contains('profile-structured');
      fitCard($('#psyche-card'), width, fill ? CARD_W * 4 : PREVIEW_MAX_H);
      layoutSideActions();
      // The card's scale as drawn, for "Beyond your card" under it, which sets
      // its type and panels in the card's own sizes times this — so the two
      // read as one object at whatever size the card lands.
      const drawn = $('#psyche-card').getBoundingClientRect().width;
      if (drawn) $('#view-profile').style.setProperty('--pcs', (drawn / CARD_W).toFixed(4));
    }
    const dialog = $('#card-dialog');
    if (dialog && dialog.open && dialog.classList.contains('is-guided')) fitGuidedCard(dialog, $('#psyche-card-full'));
    else if (dialog && dialog.open) {
      $('#psyche-card-full').style.height = '';
      delete $('#psyche-card-full').dataset.grow;
      // Full screen is the case the whole fixed-size approach exists for: fit
      // both axes, with a small margin so it never touches the edges.
      // The download bar is pinned to the bottom of the viewport, so the card is
      // fitted into what is left above it rather than into the whole screen —
      // otherwise the button lands on top of the card's last row.
      fitCard($('#psyche-card-full'),
        window.innerWidth * 0.94, window.innerHeight * 0.96 - CARD_BAR_SPACE, 'screen');
    }
    layoutSampleCard();
    // The sample's own full-screen view. No bar under it, unlike the reader's,
    // so it gets the height the download row would otherwise take.
    const sampleFull = $('#sample-card-dialog');
    if (sampleFull && sampleFull.open) {
      // Above the line saying how to learn more, when it shows.
      const tip = $('#sample-card-tip');
      const tipSpace = tip && tip.offsetHeight ? tip.offsetHeight + 16 : 0;
      // And clear of the gallery's count at the top, top and bottom alike,
      // since the card is centred; and of its arrows at the sides.
      const gallery = sampleFull.classList.contains('is-gallery');
      fitCard($('#sample-psyche-card-full'),
        window.innerWidth * 0.94 - (gallery && window.innerWidth >= 720 ? 140 : 0),
        window.innerHeight * 0.96 - tipSpace - (gallery ? 104 : 0), 'screen');
      if (sampleGuideState) explainSampleCardPart(null);
    }
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
    // The full screen copy when it is open; otherwise the card on the page —
    // the copy in a closed dialog has no size to draw from, which is how
    // Download and Share beside the card used to fail without a word.
    const full = $('#psyche-card-full');
    const source = full && full.offsetWidth ? full : $('#psyche-card');
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
    // The story card exports at its own size and no larger: one standard
    // 1080 x 1920 image, whatever screen it was made on. Square-cornered,
    // so its tinted wash runs to every edge: rounded corners left white
    // patches there, and a story takes its background from the edges.
    const story = source.classList.contains('pc-story');
    if (story) clone.style.borderRadius = '0';
    const scale = story ? 1 : CARD_IMAGE_SCALE;
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
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    // The card's own background is painted by its stylesheet, but a PNG with an
    // alpha channel behind it would go transparent wherever the radius rounds
    // the corners, which reads as a hole in every viewer that shows a dark page.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
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

  // ---------- story images: the roast and the compatibility result ----------
  //
  // Drawn straight onto a canvas at 1080 x 1920, the size of a phone story,
  // rather than captured from the page: each is a poster, not a copy of a
  // section. Every one carries the address, because an image is the one
  // thing shared that cannot carry a link.
  const STORY_IMAGE_W = 1080;
  const STORY_IMAGE_H = 1920;
  const STORY_INK = '#2a1238';
  const STORY_PURPLE = '#7b3fa0';

  function storyFont(weight, size, italic) {
    const family = getComputedStyle(document.body).fontFamily || LABEL_FONT_STACK;
    return (italic ? 'italic ' : '') + weight + ' ' + size + 'px ' + family;
  }

  // Greedy word wrap; a single word wider than the line is left to overflow
  // rather than broken mid-word.
  function wrapCanvasText(context, text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text).split(/\n+/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = line ? line + ' ' + word : word;
        if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  // The largest size, stepping down from `from`, at which `text` fits the box.
  function fitCanvasText(context, text, box, from, to, weight, italic) {
    for (let size = from; size >= to; size -= 2) {
      context.font = storyFont(weight, size, italic);
      const lines = wrapCanvasText(context, text, box.width);
      if (lines.length * size * 1.3 <= box.height) return { size, lines };
    }
    context.font = storyFont(weight, to, italic);
    return { size: to, lines: wrapCanvasText(context, text, box.width) };
  }

  function drawCanvasLines(context, fit, x, y, align) {
    context.textAlign = align || 'left';
    context.textBaseline = 'top';
    fit.lines.forEach((line, index) => context.fillText(line, x, y + index * fit.size * 1.3));
    return y + fit.lines.length * fit.size * 1.3;
  }

  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  // The page's light gradient, the mark and the wordmark at the top, and the
  // address in a pill at the foot.
  function storyCanvas(footer) {
    const canvas = document.createElement('canvas');
    canvas.width = STORY_IMAGE_W;
    canvas.height = STORY_IMAGE_H;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fdf7fc';
    context.fillRect(0, 0, STORY_IMAGE_W, STORY_IMAGE_H);
    for (const [x, y, r, colour] of [[160, 220, 900, 'rgba(232, 196, 255, .55)'], [960, 1700, 900, 'rgba(255, 200, 222, .55)']]) {
      const glow = context.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, colour);
      glow.addColorStop(1, 'rgba(253, 247, 252, 0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, STORY_IMAGE_W, STORY_IMAGE_H);
    }
    context.font = storyFont(800, 46);
    const word = 'PsycheAI';
    const markSize = 72;
    const rowWidth = markSize + 18 + context.measureText(word).width;
    const left = (STORY_IMAGE_W - rowWidth) / 2;
    drawBrandMark(context, left, 120, markSize);
    context.fillStyle = STORY_PURPLE;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(word, left + markSize + 18, 120 + markSize / 2);

    context.font = storyFont(800, 40);
    const pillWidth = context.measureText(footer).width + 96;
    const pillLeft = (STORY_IMAGE_W - pillWidth) / 2;
    const pill = context.createLinearGradient(pillLeft, 0, pillLeft + pillWidth, 0);
    pill.addColorStop(0, '#ff7eb3');
    pill.addColorStop(1, '#8a3fd0');
    context.fillStyle = pill;
    roundedRect(context, pillLeft, 1700, pillWidth, 104, 52);
    context.fill();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.fillText(footer, STORY_IMAGE_W / 2, 1752);
    return { canvas, context };
  }

  // The opening of the roast, a sentence or two: what would be quoted, not
  // the whole of it, which runs to paragraphs and turns personal further in.
  function roastExcerpt(text) {
    const sentences = String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(\s|$)/g) || [String(text || '')];
    let out = '';
    for (const sentence of sentences) {
      if (out && (out + sentence).length > 260) break;
      out += sentence;
      if (out.length > 120 && /[.!?]\s*$/.test(out) && sentences.indexOf(sentence) >= 1) break;
    }
    return out.trim().length > 320 ? out.trim().slice(0, 317).replace(/\s+\S*$/, '') + '…' : out.trim();
  }

  function roastImageCanvas(bonus) {
    const { canvas, context } = storyCanvas(TEXT.roastImageFooter);
    context.fillStyle = STORY_INK;
    const lead = fitCanvasText(context, TEXT.roastImageLead, { width: 900, height: 230 }, 76, 56, 850);
    let y = drawCanvasLines(context, lead, STORY_IMAGE_W / 2, 330, 'center');
    // The quote in a white panel, so it reads as something said.
    const quote = fitCanvasText(context, '“' + roastExcerpt(bonus.harsh) + '”', { width: 820, height: 900 }, 64, 40, 650, true);
    const panelHeight = quote.lines.length * quote.size * 1.3 + 140;
    const panelTop = Math.max(y + 60, 560 + (900 - panelHeight) / 3);
    context.fillStyle = 'rgba(255, 255, 255, .92)';
    context.shadowColor = 'rgba(90, 40, 120, .18)';
    context.shadowBlur = 50;
    context.shadowOffsetY = 18;
    roundedRect(context, 80, panelTop, 920, panelHeight, 44);
    context.fill();
    context.shadowColor = 'transparent';
    context.fillStyle = STORY_INK;
    context.font = storyFont(650, quote.size, true);
    drawCanvasLines(context, quote, 130, panelTop + 70, 'left');
    context.fillStyle = STORY_PURPLE;
    context.font = storyFont(700, 36);
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(TEXT.roastImageCredit, STORY_IMAGE_W / 2, panelTop + panelHeight + 48);
    return canvas;
  }

  // Share sheet with the image where the browser can take a file; a download
  // everywhere else.
  async function shareStoryImage(canvas, fileName, text, statusSelector) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { linkStatus(statusSelector, TEXT.cardImageError); return; }
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    triggerDownload(blob, fileName);
    linkStatus(statusSelector, TEXT.storyImageSaved);
  }

  // Shared by both icon buttons: neither carries visible text of its own any
  // more for a failure to borrow, so an error from either one shows up here
  // instead of inside the button.
  // The card's Copy link: the share message, link and all, on the clipboard.
  function copyShareMessage(button) {
    const text = shareMessage();
    writeClipboard(text).then(() => {
      const label = button.querySelector('span');
      const was = label.textContent;
      label.textContent = TEXT.linkMessageCopiedShort;
      setTimeout(() => { label.textContent = was; }, 2000);
      flashCardStatus(TEXT.linkMessageCopied);
    }, () => window.prompt(TEXT.linkCopyPrompt, text));
  }

  function flashCardStatus(message) {
    const dialog = $('#card-dialog');
    const status = dialog && dialog.open ? $('#card-dialog-status') : ($('#profile-side .cx-status') || $('#card-dialog-status'));
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
          await navigator.share({ files: [file], title: TEXT.cardSection, text: shareMessage() });
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
    // On a phone, full screen is where the card is explained: no download or
    // share, a line saying to tap, and the ring pulsing until a part is tapped.
    const guided = explainsFullScreen();
    dialog.classList.toggle('is-guided', guided);
    // Download and share sit beside the card on the page, so full screen is
    // the card alone, on a laptop as well as a phone.
    dialog.classList.toggle('no-tools', $('#view-profile').classList.contains('profile-structured'));
    $('#card-dialog-tip').textContent = guided ? Copy.STRUCTURED.cardGuide.fullTip : '';
    explainFullCardPart(null);
    $('#psyche-card-full').classList.toggle('pc-hint', guided);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    layoutPsycheCard();
  }

  // The sample's card, full screen. Opened over the sample dialog and closed
  // back to it, so a reader who wanted a proper look at the card returns to
  // the report they were reading rather than to the page behind it.
  $('#sample-card-open').addEventListener('click', () => {
    const dialog = $('#sample-card-dialog');
    if (!dialog || dialog.open) return;
    dialog.classList.remove('is-gallery');
    guideSampleCard(sampleReport);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // After it is shown, never before: fitCard measures the element, and a
    // closed <dialog> is display:none with nothing to measure.
    layoutPsycheCard();
  });
  // Any click that lands on the dialog itself rather than on the card is a
  // click outside the image — the dialog fills the screen. Escape closes it
  // natively, and either way the sample dialog is still open underneath.
  $('#sample-card-dialog').addEventListener('click', event => {
    if (event.target === $('#sample-card-dialog') || event.target.closest('#sample-card-dialog-close')) {
      $('#sample-card-dialog').close();
    }
  });

  $('#psyche-card-open').addEventListener('click', openPsycheCard);
  $('#card-download').addEventListener('click', downloadCardImage);
  $('#card-share').addEventListener('click', shareCardImage);
  $('#card-dialog-close').addEventListener('click', () => $('#card-dialog').close());
  $('#card-dialog').addEventListener('close', () => explainFullCardPart(null));
  $('#sample-card-dialog').addEventListener('close', () => explainSampleCardPart(null));
  // Clicking the backdrop closes it: the dialog element itself fills the screen,
  // so a click that lands on it rather than on the card is a click outside.
  $('#card-dialog').addEventListener('click', event => {
    if (event.target === $('#card-dialog')) $('#card-dialog').close();
  });
  window.addEventListener('resize', layoutPsycheCard);
  window.addEventListener('resize', layoutSideActions);
  // How tall the site's header is, for whatever sticks just under it.
  const measureHeader = () => {
    const bar = document.querySelector('.nav');
    if (bar) document.documentElement.style.setProperty('--header-h', bar.offsetHeight + 'px');
  };
  measureHeader();
  window.addEventListener('resize', measureHeader);

  // Sending this person's compatibility link is a popout, opened on demand
  // from beside the download button.
  $('#test-compat-open').addEventListener('click', () => {
    const dialog = $('#compat-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  $('#compat-dialog-close').addEventListener('click', () => $('#compat-dialog').close());
  // "Got their link?" opens a box for it in the popout itself, rather than
  // sending the reader to another page to find one.
  $('#compat-paste-toggle').addEventListener('click', () => {
    const form = $('#compat-paste');
    form.hidden = false;
    $('#compat-paste-toggle').setAttribute('aria-expanded', 'true');
    $('#compat-paste-input').focus();
  });
  $('#compat-paste').addEventListener('submit', async event => {
    event.preventDefault();
    const value = $('#compat-paste-input').value;
    // Read here first, so a link that is not one is said so in the popout
    // the reader is looking at, not on a page behind it.
    if (!(await Card.decodeCard(Card.extractPayload(value)))) {
      linkStatus('#compat-paste-status', 'That is not a PsycheAI link. Copy the whole link they sent you.');
      return;
    }
    $('#compat-dialog').close();
    $('#compat-paste-input').value = '';
    // Kept in My Syncs' own box too, so a sync that fails can be tried
    // again without pasting again.
    $('#paste-input').value = value;
    await runMatch(value);
  });
  $('#compat-dialog').addEventListener('close', () => {
    $('#compat-paste').hidden = true;
    $('#compat-paste-toggle').setAttribute('aria-expanded', 'false');
  });
  $('#compat-dialog').addEventListener('click', event => {
    if (event.target === $('#compat-dialog')) $('#compat-dialog').close();
  });

  // ---------- premium unlock: Stripe's Payment Request Button ----------
  //
  // Apple Pay and Google Pay both come from the one integration point —
  // Stripe decides at mount time which wallet, if either, this browser and
  // device actually offer, rather than the app choosing between two buttons
  // of its own. Stripe.js is the one third-party script in this app, and it is
  // not vendored: Stripe does not support a pinned local copy, since the file
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

  // Which product the open payment sheet is selling, for the promo field.
  let premiumKind = 'unlock';

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
  /**
   * The data step of the US$5 unlock: the same "Add or change your data"
   * popout the report page uses, listing every source with a tick for what is
   * already loaded, so a reader can add Facebook (or any source added later)
   * before paying. It hands back the premium read (premiumDigestFrom): with
   * nothing changed, the standard digest the card was read from, and the
   * payment sheet follows directly; with something added or replaced, that
   * digest with the new sources on top, reviewed first,
   * and the run it pays for rewrites the card as well. Back abandons the
   * unlock (null).
   */
  async function collectDataForPremium() {
    for (;;) {
      let collected;
      try {
        collected = await askDataSources({ title: TEXT.premiumSourcesTitle, blurb: TEXT.premiumSourcesBlurb, cardNote: true });
      } catch (error) {
        flash('#profile-alert', (error && error.message) || 'Could not read that export.');
        return null;
      }
      if (!collected) return null;
      const fresh = key => typeof collected[key] === 'object';
      const anyFresh = ['instagram', 'google', 'facebook', 'whatsapp'].some(fresh);
      if (!anyFresh && !state.digest) {
        // Nothing to write the full report from: the Instagram export has
        // gone from this device and was not loaded again.
        flash('#profile-alert', TEXT.rerunNeedsInstagram);
        return null;
      }
      // The same merge addDataAndRerun makes: a fresh Instagram read replaces
      // the signals wholesale, so supplements from this session are read off
      // the old object first.
      const priorSupplements = state.signals && state.signals.supplements;
      if (fresh('instagram')) state.signals = collected.instagram;
      repairOwnName().catch(() => {});
      const extra = {
        google: fresh('google') ? collected.google : undefined,
        facebook: fresh('facebook') ? collected.facebook : undefined,
        whatsapp: fresh('whatsapp') ? collected.whatsapp : undefined,
      };
      // Two digests come out of this. The standard one — what every later
      // free run reads — takes any source added here; the premium read is
      // what the full report is written from: the standard digest the card
      // was read from, untouched, with the added sources on top (see "the
      // premium read" in docs/digest.js).
      const adding = Object.keys(extra).filter(key => extra[key]);
      let digest = state.digest;
      let premium = null;
      try {
        if (anyFresh) {
          if (state.signals) {
            state.signals.supplements = Object.assign({}, priorSupplements,
              extra.google ? { google: extra.google } : null, extra.facebook ? { facebook: extra.facebook } : null,
              extra.whatsapp ? { whatsapp: extra.whatsapp } : null);
            digest = Digest.build(state.signals, { includeMessages: true });
          } else if (state.digest) {
            digest = Digest.addSupplements(JSON.parse(JSON.stringify(state.digest)), extra, { ownHandle: ownHandle(), ownName: ownDisplayName() });
          } else {
            flash('#profile-alert', TEXT.rerunNeedsInstagram);
            return null;
          }
        }
        // The base: the card's own digest — or, for an Instagram export loaded
        // again here, the standard digest of that export with the sources it
        // already had, before anything added here.
        let base = state.digest;
        if (fresh('instagram')) {
          base = adding.length ? Digest.build(Object.assign({}, state.signals, { supplements: Object.assign({}, priorSupplements) }),
            { includeMessages: true }) : digest;
        }
        premium = premiumDigestFrom(base, extra);
      } catch (error) {
        flash('#profile-alert', (error && error.message) || 'Could not rebuild your evidence summary.');
        return null;
      }
      if (!premium) { flash('#profile-alert', TEXT.rerunNeedsInstagram); return null; }
      // Nothing new: the payment sheet follows directly, and the full report
      // is written from exactly the digest the card was read from.
      if (!anyFresh) return premium;
      // Something added or replaced: reviewed as what will be sent. Payment is
      // the next step whatever happens here: this review sits inside the
      // unlock itself.
      const decision = await askReview(premium, { paymentDue: true, deep: Boolean(premium.__deep) });
      if (decision === REVIEW_BACK) continue;
      if (!decision) return null;
      if (digest !== state.digest && digest !== premium) applyReviewDecision(digest, decision);
      applyReviewDecision(premium, decision);
      // Carried with it, so a successful unlock keeps the standard digest
      // up to date with any source added here. Not cleared here: the payment
      // sheet comes next, and a reader who cancels it and comes back must
      // find what they loaded still loaded; runPremiumAnalysis clears it once
      // the unlock is through. (An Instagram export loaded again with nothing
      // else is simply the new standard digest, and goes as one.)
      if (premium.__deep) {
        premium.__standard = digest;
        premium.__fresh = true;
      }
      return premium;
    }
  }

  /**
   * The digest the full premium report reads: `base` — the standard digest,
   * up to 80,000 characters — with any source in `extra` merged on top, to a
   * line of 160,000 (docs/digest.js, "the premium read").
   *
   * Nothing in the base is trimmed: Instagram and every source it already
   * carried are marked protected, and only the sources added here share the
   * room above it. A source loaded again replaces its older copy and counts
   * as added. With nothing to add, `base` itself comes back, unchanged.
   */
  function premiumDigestFrom(base, extra) {
    if (!base) return null;
    const adding = {};
    for (const [key, value] of Object.entries(extra || {})) if (value) adding[key] = value;
    if (!Object.keys(adding).length) return base;
    const copy = JSON.parse(JSON.stringify(base));
    for (const key of Object.keys(adding)) {
      delete copy[key];
      if (copy.coverage && Array.isArray(copy.coverage.sources)) copy.coverage.sources = copy.coverage.sources.filter(s => s !== key);
    }
    const protect = ['instagram'].concat(['google', 'facebook', 'whatsapp'].filter(key => copy[key]));
    const out = Digest.addSupplements(copy, adding, { ownHandle: ownHandle(), ownName: ownDisplayName(), deep: true, protect });
    out.__deep = true;
    return out;
  }

  /** What a digest says about the data it was built from, to tell whether it changed. */
  function digestFingerprint(digest) {
    if (!digest) return '';
    return JSON.stringify([digest.coverage || null, digest.counts || null,
      digest.google ? digest.google.counts || true : null, digest.facebook ? digest.facebook.counts || true : null,
      digest.whatsapp ? (digest.whatsapp.chats || []).map(c => c.counts) : null]);
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
  // shared between the US$5 premium unlock and the US$2 extra analysis;
  // the only thing that differs is what happens once the money clears, so that
  // is the only thing held in a variable rather than duplicated.
  let onPaymentAuthorised = runPremiumAnalysis;

  /**
   * The same authorisation, aimed at /api/analyse instead of
   * /api/premium-analysis. `product: 'unlock'` is what tells the server this
   * US$5 PaymentIntent is paying for a free report as well — it verifies
   * the intent against the unlock price and ledgers the use under its own
   * kind, so spending it here cannot eat the premium retries it also covers.
   *
   * A promo code needs none of that: it is not a product, and the analyse
   * route already accepts one on its own terms.
   */
  function bundledAuth(auth) {
    // `product` travels with a promo code too: the server reads it to decide
    // between the card and the full report, and a code without it would buy a
    // second copy of the card the reader already has.
    if (auth.promoCode) return { promoCode: auth.promoCode, product: 'unlock' };
    if (auth.referralGrant) return { referralGrant: auth.referralGrant, product: 'unlock' };
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
    // Data was added on the way to this unlock, so the card is about to be
    // describing less evidence than the report written under it. This US$5
    // redraws the card from the new data as well rather than leaving that gap
    // and charging US$2 to close it.
    // The premium read (every unlock now) says itself whether data was added
    // on the way: only then is the card redrawn from it. A standard digest —
    // a resumed run, an older path — has changed when it is not the stored one.
    const deepRead = Boolean(paidDigest.__deep);
    const dataChanged = deepRead ? Boolean(paidDigest.__fresh)
      : Boolean(pendingPremiumDigest && pendingPremiumDigest !== state.digest);

    startProgress();
    guardUnload(true);
    try {
      // One call for everything this purchase buys: the written report behind
      // the card, the roast, and the four premium sections, in one response.
      premiumStatus(dataChanged ? TEXT.premiumRefreshingFree : TEXT.premiumGenerating);
      // The card the reader already has, for the server to sanitise and the
      // model to explain. None when the data changed: a card read from less
      // evidence is not one to hold a fuller report to.
      const anchor = dataChanged ? null : (state.profile && (state.profile.freeReport || state.profile.report));
      const request = Object.assign({}, bundledAuth(auth), anchor ? { anchor } : {}, deepRead ? { deep: true } : {});
      // Recorded under its own kind, because collecting it is not the same as
      // collecting a free card: it attaches to the profile on screen rather
      // than replacing it.
      //
      // What a resumed one does *not* restore is promoting paidDigest into
      // state.digest — paidDigest lives in this closure and is far too big to
      // write into the job record beside a key. So a reader who closes the app
      // during an unlock that added data gets their report and a stored digest
      // that still lacks the source they just added; the popout shows it
      // unticked and asks for it again. That is worse than the unbroken path
      // and better than losing the report.
      const full = await LLM.analyseProfile(Digest.forModel(paidDigest, { deep: deepRead }), await withAttribution(request),
        { onJob: key => rememberJob(key, 'full', auth, { replaceCard: dataChanged }) });
      // A gifted report, now used.
      const gift = giftWaiting();
      if (gift && auth.referralGrant === gift.token) { store.remove(KEYS.gift); refreshGiftBanner(); }

      // The extra data is kept only now, because only now has it bought
      // anything. Abandoning the payment sheet leaves the stored digest — and
      // the re-run button that reads it — exactly as they were.
      //
      // Reads paidDigest, the snapshot taken before the await, rather than the
      // shared pendingPremiumDigest variable again: a reopened dialog resets
      // that, and reading it here would be one stray caller away from a null.
      if (deepRead) {
        // The premium read is not kept: every later free run reads the
        // standard digest, which takes the sources added here, and the next
        // unlock starts from it again.
        const standard = paidDigest.__standard;
        delete paidDigest.__standard;
        delete paidDigest.__fresh;
        if (dataChanged && standard && standard !== state.digest) {
          state.digest = standard;
          writeDigest(standard);
        }
        pendingPremiumDigest = null;
        // A new card was drawn only when data was added.
        if (dataChanged) recordRun();
      } else if (dataChanged) {
        const added = paidDigest.__addedSupplements;
        delete paidDigest.__addedSupplements;
        if (added && state.signals) state.signals.supplements = added;
        state.digest = paidDigest;
        writeDigest(paidDigest);
        pendingPremiumDigest = null;
        // A new card really was drawn, so it counts like any other run — see
        // RUNS_KEY. It costs this reader nothing either way: they cannot reach
        // an unlock without having run one already.
        recordRun();
      }
      clearJob();
      // What was loaded for this unlock is now part of it.
      pendingDataSourceReads = {};
      await adoptFullReport(full, dataChanged, undefined,
        deepRead && paidDigest.coverage ? { sampling: paidDigest.coverage.sampling || {} } : null);
      // Every section changed, so the whole report is redrawn rather than
      // having bodies spliced into a page still showing the locked block.
      // renderProfile calls renderAnalysedBy and redraws the re-run price
      // note, which says US$5 from this point on. Where the report has a page
      // of its own, that page is where the reader lands, with a line saying so.
      if (fullReportPage()) {
        go('full');
        const note = document.createElement('p');
        note.className = 'report-ready-note';
        note.setAttribute('role', 'status');
        note.textContent = Copy.STRUCTURED.reportPage.ready;
        $('#profile-body').prepend(note);
      } else {
        renderProfile();
      }
      // renderProfile shuts every section, and this is the one moment that is
      // wrong: the reader has just paid for the four premium ones.
      openPaidSections();
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
      total: { label: 'PsycheAI full premium report', amount: intent.amount },
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
    payButton.textContent = TEXT.premiumUnlockPrefix +
      (intent.discount ? Prices.label(intent.currency, 'unlock', intent.amount) : TEXT.premiumPriceLabel);
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
    // Three products share this dialog now. `kind` is what the server is told
    // and what verifyPaid checks the payment against, so a wrong value here
    // sends a reader's US$5 to the wrong ledger — hence a lookup with an
    // explicit default rather than a chain of ternaries that grows a bug each
    // time a product is added.
    const kind = product === 'analysis' ? 'analysis'
      : product === 'compatibility' ? 'compatibility' : 'unlock';
    // The re-run button's own route to this same US$5 product, used only
    // when premium is already unlocked and the reader is adding/changing
    // data — see rerunWithAdditionalData. Ledgers and prices exactly like a
    // fresh unlock (server.js only ever sees `product: 'unlock'`); the only
    // difference is the title/blurb, since "unlock" is the wrong verb for a
    // reader who already has these sections.
    const rerunAll = product === 'rerunAll';
    const dialog = $('#premium-dialog');
    if (dialog.open) return;
    premiumKind = kind;

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
      const collected = await collectDataForPremium();
      // Back at the supplement offer abandons the unlock. Nothing has been
      // charged and no dialog has been opened, so this simply returns.
      if (!collected) return;
      pendingPremiumDigest = collected;
    }
    if (kind === 'unlock') trackStep('unlock_open');
    $('#premium-dialog-title').textContent =
      kind === 'analysis' ? TEXT.analysisDialogTitle
        : rerunAll ? TEXT.premiumRerunDialogTitle
        : TEXT.premiumDialogTitle;
    // The unlock's sheet is its title and the ways to pay: what it opens was
    // set out in the offer, and that new data redraws the card was said in
    // the data popout before the first file was picked (#datasources-confirm).
    const blurb = kind === 'analysis' ? (analysisNote || TEXT.analysisDialogBlurb)
      : rerunAll ? TEXT.premiumRerunDialogBlurb : '';
    $('#premium-dialog-blurb').textContent = blurb;
    $('#premium-dialog-blurb').hidden = !blurb;
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
    renderPremiumPrice(kind, CURRENCY, null);
    showReferralOffer(kind);
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
    if (receipt && hasUnfetchedUnlock()) {
      $('#premium-dialog-title').textContent = TEXT.premiumResumeTitle;
      // Already paid: there is no price to state.
      $('#premium-price').hidden = true;
      $('#premium-dialog-blurb').textContent = TEXT.premiumResumeBlurb;
      $('#premium-dialog-blurb').hidden = false;
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
      // Through the same helper the model routes use, rather than fetching a
      // ticket and posting it by hand. This route creates a real object in the
      // Stripe account so it must carry a ticket — but it was the only
      // protected route doing that without the retry behind it, which made it
      // the one place a ticket the server did not recognise still reached the
      // reader as "reload the page and try again". A rate limit or a real
      // failure still arrives here as itself; the catch below shows it.
      const intent = await LLM.postWithTicket('api/create-payment-intent', { product: kind, currency: CURRENCY });
      if (!intent) throw new Error(TEXT.premiumNotConfigured);
      await mountIntent(intent, dialog);
      // The code from the reader's link, filled in and applied for them.
      if (kind === 'unlock' && linkPromo()) {
        $('#premium-promo-input').value = linkPromo();
        await applyPromoCode({ fromLink: true });
      }
    } catch (error) {
      premiumStatus((error && error.message) || TEXT.premiumFailed, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /**
   * The price at the top of the payment sheet. Without a discount, the one
   * line: the product's price. With a discount code, the full price struck
   * through, the discount the code takes off, and the price left to pay — the
   * amount of the cheaper PaymentIntent, which is what is actually charged.
   * Not shown for compatibility, which is free.
   */
  function renderPremiumPrice(product, currency, discount) {
    const box = $('#premium-price');
    if (product !== 'unlock' && product !== 'analysis') { box.hidden = true; box.innerHTML = ''; return; }
    const row = (term, value, cls) => '<div class="premium-price-row' + (cls ? ' ' + cls : '') + '"><dt>' + esc(term) +
      '</dt><dd>' + value + '</dd></div>';
    const full = Prices.label(currency, product);
    if (!discount) {
      box.innerHTML = row(TEXT.premiumPriceFull, esc(full), 'is-total');
    } else {
      const fullMinor = Prices.amount(currency, product);
      const off = Math.max(0, fullMinor - discount.amount);
      box.innerHTML = row(TEXT.premiumPriceFull, '<s>' + esc(full) + '</s>') +
        row(TEXT.premiumPriceDiscount(discount.code, discount.percent), '−' + esc(Prices.label(currency, product, off)), 'is-discount') +
        row(TEXT.premiumPriceNet, esc(Prices.label(currency, product, discount.amount)), 'is-total');
    }
    box.hidden = false;
  }

  /**
   * Puts the ways to pay a PaymentIntent on the sheet: the mock stand-in, or
   * the wallet button with the card form behind it. Called again with a
   * cheaper intent when a discount code is applied, so whatever the first one
   * mounted is cleared first.
   */
  async function mountIntent(intent, dialog) {
    $('#premium-payment-request-button').innerHTML = '';
    $('#premium-card-fallback').hidden = true;
    $('#premium-card-element').innerHTML = '';
    $('#premium-mock-pay').hidden = true;
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
   * getting that restore wrong would send a reader's US$5 down the analysis
   * path, so it is done in the `close` handler where every exit passes.
   */
  function askAnalysisPayment() {
    return askPaymentFor('analysis', $('#rerun-with-data'));
  }

  // Both of the above, and the shape is worth having once rather than twice:
  // `onPaymentAuthorised` is global mutable state, and the one thing that must
  // never go wrong is putting it back — a dialog that resolved a compatibility
  // payment and left the callback pointing at the compatibility flow would
  // send the next reader's premium unlock down it. The restore therefore lives
  // in the `close` handler, which every exit passes through, cancelled or not.
  function askPaymentFor(product, button) {
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
      openPremiumDialog(button, product);
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

  // A code typed into the full report's sheet is asked about first: a code
  // worth 100% goes straight to the same paid route a real payment reaches,
  // with the code instead of a paymentIntentId, so it works even mid-dialog
  // while a wallet button is already mounted, and even on a server with no
  // Stripe key set. A discount code comes back as a cheaper PaymentIntent,
  // and the sheet is re-mounted to pay that instead. A code the server
  // refuses says why, here, before any report is asked for. The extra
  // analysis's sheet keeps the old path: discounts are for the full report.
  // `fromLink`: the code came in the reader's link and is applied as the
  // sheet opens. A discount is shown at once; a code that opens the report
  // free waits for the reader's tap rather than starting it unasked; and a
  // code the server refuses is forgotten, so it is not offered again.
  async function applyPromoCode(options) {
    const fromLink = Boolean(options && options.fromLink);
    const input = $('#premium-promo-input');
    const code = input.value.trim();
    if (!code) return;
    const dialog = $('#premium-dialog');
    if (premiumKind !== 'unlock') {
      onPaymentAuthorised({ promoCode: code }, dialog);
      return;
    }
    const apply = $('#premium-promo-apply');
    apply.disabled = true;
    let answer = null;
    try {
      answer = await LLM.postWithTicket('api/create-payment-intent',
        { product: 'unlock', currency: CURRENCY, promoCode: code });
    } catch (error) {
      if (error && error.status === 402) {
        premiumStatus(fromLink ? TEXT.linkPromoRefused(code, error.message) : error.message, 'bad');
        if (fromLink) { store.remove(KEYS.linkPromo); input.value = ''; }
        return;
      }
      // A server that could not price it (no Stripe keys, an older server):
      // the analyse route judges the code itself, as it always did.
      answer = null;
    } finally {
      apply.disabled = false;
    }
    if (answer && answer.discount) {
      renderPremiumPrice('unlock', answer.currency, { code: answer.discount.code, percent: answer.discount.percent, amount: answer.amount });
      premiumStatus(TEXT.premiumPromoDiscount(answer.discount.code, answer.discount.percent), 'good');
      await mountIntent(answer, dialog);
      return;
    }
    if (fromLink) {
      premiumStatus(TEXT.linkPromoFree(code), 'good');
      return;
    }
    onPaymentAuthorised({ promoCode: code }, dialog);
  }
  $('#premium-promo-apply').addEventListener('click', () => applyPromoCode());
  // Promo codes are capitals, digits and hyphens only: a lower-case letter is
  // made a capital as it is typed or pasted, and anything else is dropped.
  $('#premium-promo-input').addEventListener('input', event => {
    const input = event.target;
    const clean = input.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (clean !== input.value) {
      const at = input.selectionStart;
      input.value = clean;
      if (typeof at === 'number') input.setSelectionRange(Math.min(at, clean.length), Math.min(at, clean.length));
    }
  });
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
  /** The sync's PDF and its file name: what Download PDF saves and Share PDF shares. */
  function compatPdf(last) {
    const when = last.when ? new Date(last.when) : new Date();
    const blob = window.PsychePDF.buildCompatibility(last.report, {
      a: last.myName,
      b: last.otherName,
      modeLabel: last.mode === 'platonic' ? TEXT.syncName : MODE_LABELS[last.mode] || '',
      stanceLabel: last.mode === 'professional' && Copy.WORK_STANCES[last.stance]
        ? Copy.stanceText(Copy.WORK_STANCES[last.stance].option, last.otherName) : '',
      heading: playbookHeading(last.mode, last.stance, last.otherName),
      date: when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      model: (state.profile && state.profile.model) || '',
    });
    const slug = value => String(value || 'me').toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '');
    return { blob, name: 'psycheai-sync-' + slug(last.myName) + '-' + slug(last.otherName) + '.pdf' };
  }

  function exportCompatPdf() {
    const last = state.lastReport;
    if (!last) return;
    try {
      const { blob, name } = compatPdf(last);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = name;
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      // In the line under the buttons, which carry an icon a new label would wipe.
      linkStatus('#compat-share-status', 'Could not build the PDF.');
    }
  }

  $('#export-compat-bottom').addEventListener('click', exportCompatPdf);

  // "Delete everything" asks first, in its own sheet. The note names the one
  // thing this deliberately does not delete — the count of runs already had
  // (see RUNS_KEY) — which is both honest and the better deterrent.
  $('#delete-profile').addEventListener('click', () => {
    const dialog = $('#delete-dialog');
    $('#delete-dialog-text').textContent = Copy.STRUCTURED.deleteText;
    $('#delete-dialog-note').textContent = Copy.STRUCTURED.deleteNote;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    $('#delete-cancel').focus();
  });
  $('#delete-cancel').addEventListener('click', () => $('#delete-dialog').close());
  $('#delete-dialog').addEventListener('click', event => {
    if (event.target === $('#delete-dialog')) $('#delete-dialog').close();
  });
  $('#delete-confirm').addEventListener('click', () => {
    $('#delete-dialog').close();
    store.clearAll();
    state.profile = null;
    state.digest = null;
    state.signals = null;
    // Back to the page a new reader starts on, from its top.
    show('welcome');
    window.scrollTo(0, 0);
  });

  // ══════════════ 3. compatibility links ══════════════
  //
  // Someone's link normally arrives by being tapped, and consumeIncomingLink
  // takes it from there. The compatibility page is for everything else: past
  // results, a link that arrived some other way to paste, and this person's
  // own link to send.

  function renderScan() {
    flash('#scan-alert', '');
    $('#scan-alert').classList.remove('is-note');
    // Named for whoever this device belongs to, the way the profile page is.
    // There may be no profile yet on a device that was sent a link, so the
    // generic title in the markup stays the fallback.
    const who = state.profile && state.profile.card && state.profile.card.name;
    $('#scan-title').textContent = TEXT.scanHistory;
    $('#scan-initial').textContent = who ? String(who).trim().charAt(0).toUpperCase() : 'Y';
    $('#paste-input').value = '';
    // One list, Psyche Sync: friends waiting to sync at the top, each with a
    // Sync button, then past syncs. A sync that lands moves its friend from
    // one to the other (adoptComparison spends the link).
    const history = store.read(KEYS.history, []);
    const waiting = state.profile ? allInvites().length : 0;
    setHtml($('#scan-history'), history.length || waiting
      ? '<div class="card scan-results"><div class="scan-results-head"><h2>' + esc(TEXT.syncsList) + '</h2>' +
        '<span class="scan-count">' + (history.length + waiting) + '</span></div>' + syncWaitingHtml() +
        (history.length ? historyList(history) : '') + '</div>' : '');
    $('#link-contents').innerHTML = linkContentsBlock(state.profile && state.profile.card);
  }

  $('#paste-go').addEventListener('click', async () => {
    // A link already synced with is not run again: its result is in the list.
    const pasted = state.profile ? await Card.decodeCard(Card.extractPayload($('#paste-input').value)) : null;
    if (pasted && alreadySynced(pasted)) {
      renderScan();
      flash('#scan-alert', TEXT.syncAlreadyDone(firstName(pasted.name) || pasted.name));
      $('#scan-alert').classList.add('is-note');
      return;
    }
    if (!(await runMatch($('#paste-input').value))) {
      flash('#scan-alert', 'That is not a PsycheAI link. Copy the whole link they sent you.');
    }
  });

  const MODE_LABELS = Copy.MODE_LABELS;
  const MODE_HEADINGS = {
    romantic: 'How to partner each other',
    platonic: 'How to relate to each other',
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

  // One sync at a time. A second tap on Sync (a double tap on a phone, before
  // the working screen appears) used to start a second, identical sync, and
  // both landed in the list. Cleared when the first one finishes either way.
  let syncInFlight = false;
  async function runMatch(rawText) {
    if (!state.profile) return false;
    if (syncInFlight) return true;
    const other = await Card.decodeCard(Card.extractPayload(rawText));
    if (!other) return false;

    // Psyche Sync is between friends, and only that: no basis to pick, so it
    // starts at once. Free, so there is no payment to ask for either.
    const mode = 'platonic';
    const stance = null;
    const auth = {};

    $('#working-title').textContent = modelName() + ' is syncing you';
    $('#working-note').textContent = 'Psyche Sync. Two profile cards were sent — nothing else.';
    startElapsed('Assessing ' + state.profile.card.name + ' and ' + other.name);
    show('working');

    syncInFlight = true;
    try {
      await runComparison(other, mode, stance, auth);
    } finally {
      syncInFlight = false;
    }
    return true;
  }

  /**
   * The paid model call behind a comparison, and everything that happens to
   * the result.
   *
   * Its own function so that resuming one can reach it. A reader whose phone
   * died mid-comparison has already scanned the code and answered both
   * questions; making them do that again to collect something they paid for
   * would be the same unfairness the unlock receipt exists to remove.
   */
  async function runComparison(other, mode, stance, auth) {
    // Same reasoning as runAnalysis's own guard: this call runs for real time
    // with nothing else standing between a reader's back button and losing it.
    guardUnload(true);
    // The comparison needs more than the payment to be asked for again: the
    // other person's card came off a QR code that may be long gone, and the
    // basis was chosen in two dialogs the reader would have to answer twice.
    // All of it rides along, so resuming asks nothing of them.
    // A paid comparison from before they were free is still collected; a free
    // one has nothing owed to remember, only a job to rejoin.
    if (auth && Object.keys(auth).length) rememberPending('compatibility', auth, { other, mode, stance });
    try {
      // Re-shaped on the way out, so a card saved before the link format last
      // changed is sent in today's shape, with nothing the comparison no
      // longer reads.
      const result = await LLM.analyseCompatibility(Card.shape(state.profile.card), other, mode, stance, auth,
        { onJob: key => rememberJob(key, 'compatibility', auth, { other, mode, stance }) });
      adoptComparison(result, other, mode, stance);
    } catch (error) {
      renderScan();
      show('scan');
      flash('#scan-alert', (error && error.message) || 'The comparison failed.');
    } finally {
      stopElapsed();
      guardUnload(false);
    }
  }

  /**
   * Take delivery of the paid sections, from the call that asked for them or
   * from a page that rejoined it afterwards.
   *
   * Attaches to the profile already on screen rather than replacing it, which
   * is the whole difference between this and adoptProfile: the free report is
   * the thing these sections are being added to.
   */
  function adoptPremium(result) {
    clearJob();
    if (!state.profile) return;
    state.profile.premiumAnalysis = result.data;
    // The provider and moment that wrote the paid sections, kept apart from
    // the free report's own `model`/`createdAt` because a different call, on a
    // different provider, wrote them — see renderAnalysedBy.
    state.profile.premiumModel = result.model || '';
    state.profile.premiumAt = new Date().toISOString();
    // Best-effort: a browser too full to hold this still leaves the reader
    // able to read what they paid for, on screen, for the rest of this visit —
    // it just will not survive a reload.
    store.write(KEYS.profile, state.profile);
  }

  /**
   * Take delivery of a finished comparison, from the call that asked for it or
   * from a page that rejoined it afterwards.
   *
   * `mode` and `stance` are optional because a resumed job carries its own,
   * off the record rather than out of the arguments the caller no longer has.
   * The report's own `mode` still wins where the model set one, exactly as it
   * did inline.
   */
  /** A short fingerprint of a friend's card, so the same link is recognised once synced. */
  function syncCardKey(card) {
    const text = JSON.stringify(Card.shape(card || {}));
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16) + '.' + text.length.toString(16);
  }
  /**
   * Whether this card has been synced with on this device already. A sync
   * saved before fingerprints were kept is matched by the friend's name.
   */
  function alreadySynced(card) {
    const key = syncCardKey(card);
    return (store.read(KEYS.history, []) || []).some(entry => entry &&
      (entry.with ? entry.with === key : entry.withName === card.name));
  }

  /**
   * One row per card in the saved list. Lists saved before the fix above can
   * hold the same sync twice (a double tap, or a pasted link run again): the
   * newest row is kept. Rows from before cards were fingerprinted are matched
   * by name and identical result instead, so two different syncs with one
   * friend are never merged.
   */
  function dedupeHistory() {
    const history = store.read(KEYS.history, []);
    if (!Array.isArray(history) || history.length < 2) return;
    const seen = new Set();
    const kept = history.filter(entry => {
      if (!entry) return false;
      const id = entry.with ? 'card:' + entry.with
        : 'legacy:' + entry.withName + ':' + JSON.stringify(entry.report || null);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (kept.length !== history.length) store.write(KEYS.history, kept);
  }
  dedupeHistory();

  function adoptComparison(result, other, mode, stance) {
    // The friend's link that brought this sync, now used.
    if (syncingInvite) {
      // A sync with a friend's link counts on that friend's "Your link".
      const synced = allInvites().find(i => i.payload === syncingInvite);
      const mine = store.read(KEYS.referral, null);
      if (synced && synced.ref && !(mine && mine.code === synced.ref)) trackStep('sync_done', synced.ref);
      spendInvite(syncingInvite);
      syncingInvite = null;
      refreshSyncInvite();
    }
    clearPending();
    clearJob();
    const basis = mode || result.data.mode;
    const report = { ...result.data, mode: result.data.mode || basis, stance };
    // A sync with a card already in the list replaces it, at the top, rather
    // than adding a second row for the same person.
    const key = syncCardKey(other);
    const history = (store.read(KEYS.history, []) || []).filter(entry => !(entry && entry.with === key));
    history.unshift({
      when: new Date().toISOString(), withName: other.name, with: key, mode: report.mode, stance, report,
    });
    store.write(KEYS.history, history.slice(0, 25));
    renderReport(report, other.name);
    show('report');
  }

  // ══════════════ 4. compatibility report ══════════════

  function renderReport(report, otherName, when) {
    const myName = state.profile ? state.profile.card.name : 'You';
    // Friends unless the report says otherwise: one saved before Psyche Sync
    // was friends-only keeps the basis it was run on.
    const mode = MODE_LABELS[report.mode] ? report.mode : 'platonic';
    const stance = report.stance;
    // The pill says which question was answered, and for a work run the basis
    // alone does not: "Professional / work" reads the same whether the reader
    // manages this person or reports to them.
    const stanceLabel = mode === 'professional' && Copy.WORK_STANCES[stance]
      ? Copy.stanceText(Copy.WORK_STANCES[stance].option, otherName) : '';

    // The title and the basis pills live in the static header rather than in
    // the rendered body.
    // First names, as everywhere a friend is named.
    $('#report-title').textContent = (firstName(myName) || myName) + ' & ' + (firstName(otherName) || otherName);
    $('#report-sub').innerHTML =
      '<span class="pill pill-clear">' + esc(mode === 'platonic' ? TEXT.syncName : MODE_LABELS[mode]) + '</span>' +
      (stanceLabel ? ' <span class="pill pill-clear">' + esc(stanceLabel) + '</span>' : '');
    // Kept for the PDF, which is built from whatever was last rendered.
    state.lastReport = { report, otherName, myName, mode, stance, when };
    $('#compat-return').hidden = !state.profile;
    $('#compat-return-title').textContent = TEXT.compatReturnTitle(otherName);
    $('#compat-return-text').textContent = TEXT.compatReturnText(otherName);

    // Three blocks, the same order as the PDF: the answer (score, verdict and
    // what they share), what it looks like day to day, and what each of them
    // should do about it.
    const [labelA, labelB] = window.PsychePDF ? window.PsychePDF.pairLabels(myName, otherName) : [myName, otherName];
    let html = scoreCard(report);

    // What works and what will rub, side by side in the profile's own two
    // columns, each point with its evidence on one small line.
    const plays = (items, kind, title) => {
      const rows = (items || []).filter(item => item && item.title);
      if (!rows.length) return '';
      return '<div class="partner-col partner-' + kind + '"><h4 class="partner-col-head"><span class="partner-badge" aria-hidden="true">' +
        (kind === 'need' ? '✓' : '!') + '</span>' + esc(title) + '</h4><ol class="partner-items">' + rows.map(item =>
        '<li><strong>' + esc(item.title) + '</strong>' + (item.detail ? '<span>' + esc(item.detail) + '</span>' : '') +
          evidenceLine(item.evidence) + '</li>').join('') + '</ol></div>';
    };
    const playsHtml = plays(report.strengths, 'need', TEXT.compatWorks) + plays(report.frictions, 'careful', TEXT.compatRubs);
    if (playsHtml) {
      html += '<div class="card section-card compat-plays"><h2>' + esc(TEXT.compatHowItPlays) + '</h2>' +
        '<div class="partner-grid">' + playsHtml + '</div></div>';
    }

    const play = report.howToPartner || {};
    html += '<div class="card section-card compat-playbook"><h2>' + esc(playbookHeading(mode, stance, otherName)) + '</h2>' +
      '<div class="playbook">' +
      '<div class="play-col play-a"><h3>' + esc(TEXT.compatFor + labelA) + '</h3>' + list(play.forA, 'ticks') + '</div>' +
      '<div class="play-col play-b"><h3>' + esc(TEXT.compatFor + labelB) + '</h3>' + list(play.forB, 'ticks') + '</div>' +
      '</div>' +
      ((play.together || []).length ? '<div class="play-both"><h3>' + esc(TEXT.compatBoth) + '</h3>' + list(play.together, 'ticks') + '</div>' : '') +
      '</div>';

    if (report.caveats) html += '<p class="fineprint">' + esc(report.caveats) + '</p>';

    setHtml($('#report-body'), html);
  }

  // The score, the band in words, the verdict, and what the two share: the
  // answer, before anything else. The basis is the header's pill, so it is
  // not said again here.
  function scoreCard(report) {
    const value = Math.round(Number(report.score) || 0);
    const tier = value >= 80 ? 'a' : value >= 65 ? 'b' : value >= 50 ? 'c' : 'd';
    const shared = (report.sharedGround || []).filter(Boolean);
    return '<div class="card score-card score-single compat-lead tier-' + tier + '">' +
      '<div class="ring" data-pct="' + value + '"><span>' + value + '</span></div>' +
      // "78% in sync", the way people say it, then the band in words.
      '<div><p class="band compat-band">' + esc(TEXT.syncPercent(value) + (report.band ? ' · ' + report.band : '')) + '</p>' +
      '<p class="compat-verdict">' + esc(report.verdict) + '</p>' +
      (shared.length ? '<div class="compat-common"><h3>' + esc(TEXT.compatCommon) + '</h3>' + tags(shared) + '</div>' : '') +
      '</div></div>';
  }

  // Evidence as one small line under what it supports, rather than a row of
  // chips: it backs the claim up without competing with it.
  function evidenceLine(items, className) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return '';
    return '<p class="ev-line' + (className ? ' ' + className : '') + '">' + values.map(esc).join(' · ') + '</p>';
  }

  // ══════════════ 5. server status & boot ══════════════

  function renderAbout() {
    $('#about-status').textContent = state.server.unreachable
      ? 'This page cannot reach the PsycheAI server right now.'
      : state.server.mock
        ? 'This server is running in mock mode — analyses are canned, and no API calls are made.'
        : state.server.ready
          ? ''
          : 'Analyses are unavailable right now. Please try again later.';
  }

  function renderServerStatus() {
    if (state.server.mock) {
      flash('#server-status', 'Mock mode: this server returns canned analyses so you can click through the app. Nothing is sent to any model provider.');
    } else if (state.server.unreachable) {
      flash('#server-status', 'Cannot reach the PsycheAI server. Start it with "npm start".');
    } else if (!state.server.ready) {
      flash('#server-status', 'Analyses are unavailable right now, so a run would fail. Please try again later.');
    } else {
      flash('#server-status', '');
    }
  }

  // A shared link may arrive as a fresh page load or as a hash change in a tab
  // that already has PsycheAI open. Both have to work.
  async function consumeIncomingLink() {
    let incoming = '';
    let face = null;
    let fromRef = '';
    const params = new URLSearchParams(location.search);
    if (params.has('c')) {
      // A short personal link, /c/<id>#<key>, arrives here as ?c=<id>#<key>.
      const id = String(params.get('c') || '');
      const key = location.hash.replace(/^#/, '');
      params.delete('c');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
      let found = null;
      try {
        const response = await fetch('api/link?id=' + encodeURIComponent(id));
        found = response.ok ? await response.json() : null;
      } catch (error) { found = null; }
      if (found && /^[0-9a-f]{12}$/.test(found.ref || '')) {
        fromRef = found.ref;
        const mine = store.read(KEYS.referral, null);
        if (!(mine && mine.code === found.ref)) {
          store.write(KEYS.referredBy, { code: found.ref, at: Date.now() });
          trackStep('referral_open', found.ref);
        }
      }
      try {
        if (found && key) ({ payload: incoming, face } = openedCard(await unlockCard(found.blob, key)));
      } catch (error) { incoming = ''; }
      if (!incoming) {
        showUploadError(TEXT.shortLinkUnreadable);
        return true;
      }
    } else {
      if (!/^#p=/.test(location.hash)) return false;
      incoming = Card.extractPayload(location.hash);
      if (!incoming) return false;
      history.replaceState(null, '', location.pathname + location.search);
    }
    const card = await Card.decodeCard(incoming);
    if (!card) {
      showUploadError('That PsycheAI link could not be read. Ask for it to be sent again.');
      return true;
    }
    // A link already synced with is not a friend waiting again: it opens the
    // list, where that sync is.
    if (state.profile && alreadySynced(card)) {
      renderScan();
      show('scan');
      flash('#scan-alert', TEXT.syncAlreadyDone(firstName(card.name) || card.name));
      $('#scan-alert').classList.add('is-note');
      return true;
    }
    // The link's own code too, so a sync with this friend counts for them.
    addInvite(Object.assign({ payload: incoming, name: card.name, at: Date.now() }, face ? { face } : null,
      fromRef ? { ref: fromRef } : null));
    // A reader who already has a card lands on it, with the sync one tap
    // away; one who does not sees the friend's card and how to make theirs.
    if (state.profile) {
      renderProfile();
      show('profile');
      return true;
    }
    show('welcome');
    await refreshInvite();
    return true;
  }

  // How long a compatibility link waits for this reader's own card. Long enough to
  // cover Instagram's slowest export and a weekend; short enough that a link
  // nobody acted on does not greet them a season later.
  const INVITE_DAYS = 14;

  function pendingInvite() {
    const invite = store.read(KEYS.invite, null);
    if (!invite || typeof invite.payload !== 'string') return null;
    if (!(Date.now() - Number(invite.at) < INVITE_DAYS * 86400000)) {
      store.remove(KEYS.invite);
      return null;
    }
    return invite;
  }

  // More than one friend's link: the latest is the invite (its card is the one
  // the welcome page shows); the ones before it wait here, newest first, each
  // for its own fourteen days. Nobody is dropped for having sent theirs first.
  const MORE_INVITES = 5;
  function moreInvites() {
    const list = store.read(KEYS.invitesMore, []);
    return (Array.isArray(list) ? list : []).filter(i => i && typeof i.payload === 'string' &&
      Date.now() - Number(i.at) < INVITE_DAYS * 86400000);
  }
  /** Every friend whose link is waiting, latest first. */
  function allInvites() {
    const first = pendingInvite();
    return (first ? [first] : []).concat(moreInvites().filter(i => !first || i.payload !== first.payload));
  }
  function addInvite(invite) {
    const before = pendingInvite();
    // One entry per friend: a newer link from the same person replaces theirs.
    const others = [before].concat(moreInvites())
      .filter(i => i && i.payload !== invite.payload && i.name !== invite.name);
    store.write(KEYS.invite, invite);
    store.write(KEYS.invitesMore, others.slice(0, MORE_INVITES));
  }
  /** One friend's link, synced with: gone, and the next one waiting moves up. */
  function spendInvite(payload) {
    const first = pendingInvite();
    const rest = moreInvites().filter(i => i.payload !== payload);
    if (first && first.payload === payload) {
      if (rest.length) store.write(KEYS.invite, rest.shift());
      else store.remove(KEYS.invite);
    }
    store.write(KEYS.invitesMore, rest);
  }

  /**
   * A shared card as a report, so it is drawn by the same psycheCardHtml as
   * everyone's own: the payload's fields, and the face — character, scene and
   * why — where a short link brought one. A long link has no face, and its
   * card is drawn without the character.
   */
  const MBTI_AXES = [['E/I', /[EI]/], ['N/S', /[NS]/], ['T/F', /[TF]/], ['J/P', /[JP]/]];
  /** A list from a card's face, as plain strings, or null when it has none. */
  const faceList = list => (Array.isArray(list) && list.length ? list.slice(0, 4).map(String) : null);
  function reportFromCard(card, face) {
    const c = card || {};
    const f = face || {};
    const type = String(c.mbti || '').toUpperCase();
    const letters = MBTI_AXES.map(([axis, pole], i) => ({
      axis, choice: pole.test(type.charAt(i)) ? type.charAt(i) : '', strength: String((f.s || [])[i] || ''),
    }));
    const bigFive = {};
    for (const [key, score] of Object.entries(c.bigFive || {})) bigFive[key] = { score };
    const titled = list => (list || []).map(title => ({ title }));
    // The card labels each one, "Quality time (primary)"; the face shows the name.
    const languages = list => (list || []).map(item => ({ language: String(item).replace(/\s*\([^)]*\)\s*$/, '') }));
    return {
      card: { name: c.name || '', headline: c.headline || '', confidence: c.confidence || 0 },
      confidence: { score: c.confidence || 0 },
      essence: { character: String(f.c || ''), franchise: String(f.fr || ''), icon: String(f.i || '') },
      cardHighlights: String(f.w || ''),
      patterns: ((Array.isArray(f.p) && f.p.length ? f.p : c.patterns) || []).slice(0, 3)
        .map((name, i) => ({ id: 'p' + (i + 1), name: String(name) })),
      // The face's own lists where the link has them (see cardFace), else the payload's.
      topMotivators: faceList(f.m) || c.motivators || [],
      mbti: { type, letters: letters.every(l => l.choice) ? letters : [] },
      bigFive,
      // Values & beliefs travel as one list; the card shows three and a belief.
      values: titled((faceList(f.v) || c.values || []).slice(0, 3)),
      beliefs: titled((faceList(f.v) || []).slice(3, 4)),
      interests: titled(faceList(f.n) || c.interests),
      relationship: { loveLanguages: {
        receiving: languages(faceList(f.lr) || c.loveReceiving), giving: languages(faceList(f.lg) || c.loveGiving) } },
    };
  }

  // The welcome page for a friend's link: their card itself, drawn the way it
  // is on their own screen, beside why to make one — the comparison with them
  // waits on it. Tapping the card opens it full screen, part by part.
  let inviteDrawn = '';
  let inviteReport = null;
  async function refreshInvite() {
    const banner = $('#invite-banner');
    if (!banner) return;
    const invite = state.profile ? null : pendingInvite();
    if (!invite) {
      banner.hidden = true;
      inviteDrawn = '';
      inviteReport = null;
      return;
    }
    const drawn = invite.payload + JSON.stringify(invite.face || null);
    if (inviteDrawn !== drawn) {
      inviteDrawn = drawn;
      const card = await Card.decodeCard(invite.payload);
      // Their first name on the card too, as everywhere on this page.
      inviteReport = card ? reportFromCard(Object.assign({}, card, { name: firstName(card.name) }), invite.face) : null;
      const el = $('#invite-card');
      el.innerHTML = inviteReport ? psycheCardHtml(inviteReport) : '';
      freshArtIds(el);
    }
    const name = firstName(invite.name);
    $('#invite-title').textContent = TEXT.inviteTitle(name);
    $('#invite-text').textContent = TEXT.inviteText(name);
    // Other friends' links waiting too: named, so nobody is lost.
    const others = moreInvites().map(i => firstName(i.name) || i.name).filter(Boolean);
    $('#invite-also').textContent = others.length ? TEXT.inviteAlso(others) : '';
    $('#invite-also').hidden = !others.length;
    $('#invite-guide').textContent = TEXT.inviteStart;
    $('#invite-card-hint').textContent = TEXT.inviteCardHint;
    const open = $('#invite-card-open');
    open.hidden = !inviteReport;
    open.setAttribute('aria-label', TEXT.inviteCardOpen(name));
    banner.classList.toggle('has-card', Boolean(inviteReport));
    banner.hidden = false;
    layoutInviteCard();
  }

  function layoutInviteCard() {
    const banner = $('#invite-banner');
    const el = $('#invite-card');
    if (!banner || banner.hidden || !inviteReport || !el.innerHTML) return;
    const width = Math.max(200, Math.min(270, banner.clientWidth - 48));
    fitCard(el, width, width * 1920 / 1080);
  }
  window.addEventListener('resize', layoutInviteCard);

  /** The friend's card full screen, explained part by part, in the sample cards' dialog. */
  function openInviteCard() {
    const dialog = $('#sample-card-dialog');
    if (!dialog || dialog.open || !inviteReport) return;
    dialog.classList.remove('is-gallery');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    const full = $('#sample-psyche-card-full');
    full.innerHTML = psycheCardHtml(inviteReport);
    freshArtIds(full);
    guideSampleCard(inviteReport);
    $('#sample-card-count').textContent = '';
    layoutPsycheCard();
  }

  // To the steps for requesting the export, on this same page.
  // At the top of My Psyche, once the reader has a card and a friend's link
  // is waiting: "You have friends waiting to sync with you", naming them, with
  // one button, to My Syncs. The sync itself runs from there, only when they
  // pick a friend. Not on My Report.
  function refreshSyncInvite() {
    const box = $('#sync-invite');
    if (!box) return;
    const invites = state.profile ? allInvites() : [];
    // Closed with its ✕, it stays closed until a friend's link arrives that
    // was not waiting then. The friends still wait on My Syncs.
    const closed = store.read(KEYS.syncBarClosed, []) || [];
    const fresh = invites.some(invite => !closed.includes(invite.payload));
    box.hidden = !invites.length || !fresh || reportPageOn();
    if (!invites.length) return;
    const names = invites.map(i => firstName(i.name) || i.name);
    $('#sync-invite-title').textContent = invites.length === 1 ? TEXT.syncInviteTitle(names[0]) : TEXT.syncInviteTitleMany(names);
    $('#sync-invite-open').textContent = TEXT.syncInviteOpen;
    // How many are waiting, in the ring.
    $('#sync-invite-count').textContent = String(invites.length);
  }
  /** Syncs list: each friend whose link is waiting, with a Sync button of their own. */
  function syncWaitingHtml() {
    const invites = state.profile ? allInvites() : [];
    if (!invites.length) return '';
    return '<ul class="match-list match-waiting">' + invites.map((invite, i) => {
      const name = firstName(invite.name) || invite.name || '?';
      return '<li><div class="match-row is-waiting">' +
        '<span class="match-face m-platonic" aria-hidden="true">' + esc(String(name).trim().charAt(0).toUpperCase()) + '</span>' +
        '<span class="match-who"><strong>' + esc(name) + '</strong><span class="match-meta">' + esc(TEXT.syncWaitingMeta) + '</span></span>' +
        '<button class="btn btn-sm sync-invite-go" type="button" data-i="' + i + '" aria-label="' + esc(TEXT.syncInviteGo(name)) + '">' +
          esc(TEXT.syncInviteOpen) + '</button></div></li>';
    }).join('') + '</ul>';
  }
  $('#sync-invite-close').addEventListener('click', () => {
    store.write(KEYS.syncBarClosed, allInvites().map(invite => invite.payload));
    refreshSyncInvite();
  });
  // The invite is spent only once the sync has landed (adoptComparison): a
  // sync that fails leaves it, on My Syncs, for another try.
  document.addEventListener('click', async event => {
    const button = event.target.closest && event.target.closest('.sync-invite-go');
    if (!button) return;
    const invite = allInvites()[Number(button.dataset.i) || 0];
    if (!invite || !state.profile) { renderScan(); return; }
    if (syncInFlight) return;
    button.disabled = true;
    syncingInvite = invite.payload;
    try {
      if (!(await runMatch(invite.payload))) syncingInvite = null;
    } finally {
      button.disabled = false;
    }
  });

  $('#invite-guide').addEventListener('click', () => {
    $('.help-card').scrollIntoView({ behavior: scrollBehaviour(), block: 'start' });
  });
  $('#invite-card-open').addEventListener('click', openInviteCard);

  // A creator's or campaign's link carries ?via=<code>. Read once on arrival,
  // kept on this device for VIA_DAYS (the export takes hours, and the card is
  // made on a later visit), and taken out of the address so it is not passed
  // on when this page is shared. The server counts it as a daily total and
  // nothing more; the FAQ says so.
  const VIA_DAYS = 14;
  const VIA_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;
  (function captureVia() {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has('via')) return;
      const via = String(params.get('via') || '').trim().toLowerCase();
      if (VIA_PATTERN.test(via)) {
        store.write(KEYS.via, { code: via, at: Date.now() });
        trackStep('open');
      }
      params.delete('via');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    } catch (error) { /* no storage or no history: nothing is counted */ }
  })();

  // A promo code in the address: psycheai.io/?promo=AVA, or on a personal
  // link, /c/<id>?promo=AVA#<key>. Kept, taken out of the address, and filled
  // in on the full report's payment sheet. The server still judges it there,
  // so a made-up or expired code in a link opens nothing.
  const LINK_PROMO_DAYS = 30;
  const LINK_PROMO_PATTERN = /^[A-Z0-9-]{3,32}$/;
  (function captureLinkPromo() {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has('promo')) return;
      const code = String(params.get('promo') || '').trim().toUpperCase();
      if (LINK_PROMO_PATTERN.test(code)) store.write(KEYS.linkPromo, { code, at: Date.now() });
      params.delete('promo');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    } catch (error) { /* no storage: the code can still be typed in */ }
  })();
  /** The promo code this browser arrived with, if it is still fresh; '' otherwise. */
  function linkPromo() {
    const saved = store.read(KEYS.linkPromo, null);
    if (!saved || typeof saved.code !== 'string' || !LINK_PROMO_PATTERN.test(saved.code)) return '';
    if (!(Date.now() - Number(saved.at) < LINK_PROMO_DAYS * 86400000)) { store.remove(KEYS.linkPromo); return ''; }
    return saved.code;
  }

  // ---------- the journey, the account and the invite-friends code ----------
  //
  // A step the server cannot see for itself, for the day's totals overall and
  // per campaign link: arriving on one, an export read, the unlock opened.
  // Once per step per day from this browser, so a reload does not count twice.
  // Nothing identifies the browser: the request carries the step and the
  // campaign code, and nothing else.
  function trackStep(step, ref) {
    try {
      const seen = store.read(KEYS.steps, {}) || {};
      const day = new Date().toISOString().slice(0, 10);
      const id = step + ':' + (viaCode() || '') + (ref ? ':' + ref : '');
      if (seen[id] === day) return;
      seen[id] = day;
      store.write(KEYS.steps, seen);
    } catch (error) { /* counted anyway */ }
    try {
      const via = viaCode();
      fetch('api/event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        // The link's own code on an open of someone's link, so its owner sees
        // how many opened it: a plain count, nothing about who.
        body: JSON.stringify(Object.assign({ event: step }, via ? { via } : null, ref ? { ref } : null)),
      }).catch(() => {});
    } catch (error) { /* no network: nothing counted */ }
  }

  const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return toHex(new Uint8Array(digest));
  }

  /** A one-way code of this reader's Instagram username, or '' when there is none to make it from. */
  async function accountKey() {
    try {
      const handle = String(ownHandle() || '').trim().replace(/^@+/, '').toLowerCase();
      if (handle) {
        const key = await sha256Hex('psycheai:' + handle);
        store.write(KEYS.account, key);
        return key;
      }
    } catch (error) { /* no crypto: the server simply cannot limit this run */ }
    const saved = store.read(KEYS.account, null);
    return typeof saved === 'string' && /^[0-9a-f]{64}$/.test(saved) ? saved : '';
  }

  // The reader's own invite-friends code, made once on this device.
  let referralCode = '';
  async function ensureReferral() {
    try {
      let mine = store.read(KEYS.referral, null);
      if (!mine || !/^[0-9a-f]{64}$/.test(mine.secret || '')) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        mine = { secret: toHex(bytes) };
      }
      if (!/^[0-9a-f]{12}$/.test(mine.code || '')) {
        mine.code = (await sha256Hex(mine.secret)).slice(0, 12);
        store.write(KEYS.referral, mine);
      }
      referralCode = mine.code;
      return mine;
    } catch (error) { return null; }
  }
  /** The link a reader shares to invite friends: the site, carrying their code. */
  function inviteUrl() {
    return location.origin + '/' + (referralCode ? '?ref=' + referralCode : '');
  }
  /** The friend's code this browser arrived on, while it is fresh. */
  function referredBy() {
    const by = store.read(KEYS.referredBy, null);
    if (!by || !/^[0-9a-f]{12}$/.test(by.code || '')) return '';
    if (!(Date.now() - Number(by.at) < 60 * 86400000)) { store.remove(KEYS.referredBy); return ''; }
    return by.code === referralCode ? '' : by.code;
  }
  // A friend's link carries ?ref=<code>: kept for 60 days (the export takes
  // hours) and taken out of the address.
  (function captureRef() {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has('ref')) return;
      const code = String(params.get('ref') || '').trim().toLowerCase();
      const mine = store.read(KEYS.referral, null);
      if (/^[0-9a-f]{12}$/.test(code) && !(mine && mine.code === code)) {
        store.write(KEYS.referredBy, { code, at: Date.now() });
        trackStep('referral_open', code);
      }
      params.delete('ref');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    } catch (error) { /* no storage: nothing is credited */ }
  })();
  ensureReferral();

  function viaCode() {
    const via = store.read(KEYS.via, null);
    if (!via || typeof via.code !== 'string' || !VIA_PATTERN.test(via.code)) return '';
    if (!(Date.now() - Number(via.at) < VIA_DAYS * 86400000)) {
      store.remove(KEYS.via);
      return '';
    }
    return via.code;
  }

  // What goes beside the digest for the day's totals: the campaign code, and
  // whether a friend's compatibility link is waiting for this card. Neither
  // is part of the cache key, which is the digest alone.
  //
  // And, for the server's one-free-card-per-account rule and the
  // invite-friends count: the one-way code of the username, this reader's own
  // invite code, and the friend's code they arrived on.
  async function withAttribution(auth) {
    const out = Object.assign({}, auth || {});
    const via = viaCode();
    if (via) out.via = via;
    if (pendingInvite()) out.invite = true;
    const account = await accountKey();
    if (account) out.account = account;
    const mine = await ensureReferral();
    if (mine && mine.code) out.myRef = mine.code;
    const by = referredBy();
    if (by) out.ref = by;
    return out;
  }

  // The guides' "See a sample report" link (/#sample): open the sample over
  // whatever page this visitor would otherwise land on. On arrival, and when
  // the hash changes on a page already open, which does not reload it.
  function openSampleFromHash() {
    if (location.hash !== '#sample') return;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => showSample(), 0);
  }

  window.addEventListener('hashchange', () => {
    consumeIncomingLink();
    openSampleFromHash();
  });

  /**
   * Offers to collect a purchase whose result never arrived.
   *
   * Shown at startup rather than waited for, because the case it covers is one
   * where the reader is no longer watching: the tab was closed, the phone died,
   * the app was swapped away and discarded. They come back to what looks like
   * an ordinary page, and without this there is nothing anywhere telling them
   * a report they paid for is still owed to them.
   *
   * Collecting is usually instant and always free. The server keeps finished
   * results for thirty minutes keyed on the same digest, so a reader back
   * within the window gets the report that was already written without a
   * second model call; past it, the payment still has generations left on it
   * and the ledger allows the re-run.
   */
  function offerPendingWork() {
    const banner = $('#pending-work');
    const pending = pendingWork();
    if (!banner) return;
    if (!pending) { banner.hidden = true; return; }

    const needsDigest = pending.kind === 'analysis' && !state.digest;
    $('#pending-work-text').textContent = needsDigest ? TEXT.pendingNeedsInstagram
      : pending.kind === 'compatibility' ? TEXT.pendingCompatText : TEXT.pendingAnalysisText;
    const go = $('#pending-work-go');
    // Nothing to press when the export is gone: the message names the one
    // thing that would fix it, and a button that could only fail is worse
    // than no button.
    go.hidden = needsDigest;
    go.textContent = pending.kind === 'compatibility'
      ? TEXT.pendingCompatLabel : TEXT.pendingAnalysisLabel;
    go.onclick = () => {
      banner.hidden = true;
      if (pending.kind === 'compatibility') {
        if (!pending.other || !state.profile) { clearPending(); return; }
        $('#working-title').textContent = modelName() + ' is comparing you';
        startElapsed('Assessing ' + state.profile.card.name + ' and ' + pending.other.name);
        show('working');
        runComparison(pending.other, pending.mode, pending.stance, pending.auth);
        return;
      }
      runAnalysis(state.digest, pending.auth);
    };
    // Dismissing hides the offer for now and keeps the record: the payment is
    // good for thirty days and the reader may simply not want the report this
    // minute. Clearing it here would throw away the only evidence that
    // anything is owed.
    $('#pending-work-dismiss').onclick = () => { banner.hidden = true; };
    banner.hidden = false;
  }

  /**
   * The release this page is running, in the footer: the package version and
   * nothing finer. The server no longer says which commit or branch it runs
   * (see handleStatus), so neither does the page.
   * Hidden when the server did not say, rather than showing a blank version.
   */
  function renderBuild(build) {
    const slot = $('#footer-version');
    if (!slot) return;
    const version = build && typeof build === 'object' && /^[\w.+-]{1,40}$/.test(build.version || '') ? build.version : '';
    slot.textContent = version ? 'v' + version : '';
    slot.hidden = !version;
  }

  async function boot() {
    state.server = await LLM.status();
    // The server owns this number; the constant above is only what applies
    // before status lands. Guarded rather than assigned blindly so an older
    // server that does not report it leaves the default in place instead of
    // setting the allowance to undefined and making every run look free.
    if (Number.isFinite(state.server.freeAnalyses)) freeAnalyses = state.server.freeAnalyses;
    renderServerStatus();
    renderBuild(state.server.build);
    // The welcome page's sample card was drawn before the server said which
    // layout it writes; redrawn once it has, so it is the card readers get.
    drawInsightPreview();

    if (await consumeIncomingLink()) return;
    openSampleFromHash();
    // Before the report below, because a job still running is newer than
    // whatever is stored: a reader who re-ran their analysis and closed the
    // app would otherwise be shown the previous report and left to work out
    // for themselves that the new one was still coming.
    if (runningJob()) {
      resumeRunningJob();
      return;
    }
    if (state.profile) {
      renderProfile();
      show('profile');
      offerPendingWork();
      return;
    }
    show('welcome');
    refreshInvite();
    refreshGiftBanner();
  }

  // Coming back to the page is not always a page load.
  //
  // boot() runs once. A phone that suspends a tab and later restores it from
  // memory resumes the same JavaScript context — no reload, no boot, and so no
  // offer, even with a purchase sitting unclaimed in localStorage. That is
  // exactly the path this whole feature exists for: the reader who closed
  // everything mid-generation is the reader most likely to come back to a
  // restored tab rather than a fresh one.
  //
  // Checked on every return to visibility rather than only at startup.
  // offerPendingWork() is cheap and idempotent — it reads one localStorage key
  // and either shows the banner or hides it — so running it more often costs
  // nothing and closes the gap.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Only where the offer has somewhere to appear. Its banner lives inside
    // #view-profile, so showing it while the reader is on the welcome or scan
    // page would set `hidden = false` on something nobody can see, and it
    // would then be sitting open the next time they did land on the report.
    if (state.profile && !$('#view-profile').hidden) offerPendingWork();
    // A suspended tab restored from memory resumes its JavaScript context but
    // not necessarily its timers, and a poll loop that stopped ticking while
    // the phone slept is indistinguishable from one that never existed. This
    // is idempotent — `resuming` guards it — so calling it on every return is
    // free, and it is what makes putting the phone down for an hour and
    // picking it up again land on the report rather than on a dead spinner.
    if (runningJob()) resumeRunningJob();
  });

  mountInsights();
  boot();
})();
