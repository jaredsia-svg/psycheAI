// PsycheAI SPA: upload → digest → model → profile → QR → scan → compatibility.
// All state lives in localStorage; the server holds nothing.
(function () {
  'use strict';

  const IG = window.PsycheInstagram;
  const Images = window.PsycheImages;
  const Digest = window.PsycheDigest;
  const Card = window.PsycheCard;
  const LLM = window.PsycheLLM;

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

  function points(items) {
    const values = (items || []).filter(Boolean);
    if (!values.length) return '<p class="muted">None identified.</p>';
    return '<dl class="points">' + values.map(item =>
      '<dt>' + esc(item.title) + '</dt><dd>' + esc(item.detail) + '</dd>').join('') + '</dl>';
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

  function essenceBlock(essence) {
    if (!essence || !essence.noun) return '';
    return '<div class="essence"><span class="essence-icon">' + esc(safeIcon(essence.icon)) + '</span>' +
      '<div><p class="essence-label">In one word, you are</p>' +
      '<p class="essence-noun">' + esc(essence.noun) + '</p>' +
      '<p class="essence-why">' + esc(essence.why) + '</p></div></div>';
  }

  // The headline findings, pulled straight out of the sections below rather
  // than asked of the model a second time — restating them in a second field
  // is tokens spent on something that can then disagree with itself.
  function glanceBlock(report) {
    const items = [];

    if (report.mbti && report.mbti.type) {
      items.push({ label: 'Type', value: report.mbti.type, note: report.mbti.nickname || '' });
    }

    const traits = Object.keys(TRAIT_LABELS)
      .map(key => ({ key, item: report.bigFive && report.bigFive[key] }))
      .filter(t => t.item && Number.isFinite(Number(t.item.score)))
      .sort((a, b) => b.item.score - a.item.score);
    if (traits.length >= 2) {
      const top = traits[0];
      const bottom = traits[traits.length - 1];
      items.push({ label: 'Highest', value: TRAIT_LABELS[top.key], note: top.item.score + '/100' });
      items.push({ label: 'Lowest', value: TRAIT_LABELS[bottom.key], note: bottom.item.score + '/100' });
    }

    const attachment = report.relationship && report.relationship.attachment;
    if (attachment && attachment.style) {
      items.push({ label: 'Attachment', value: attachment.style, note: 'a guess' });
    }

    if (!items.length) return '';
    return '<div class="glance">' + items.map(item =>
      '<div class="glance-item"><span class="glance-label">' + esc(item.label) + '</span>' +
      '<span class="glance-value">' + esc(item.value) + '</span>' +
      (item.note ? '<span class="glance-note">' + esc(item.note) + '</span>' : '') +
      '</div>').join('') + '</div>';
  }

  // Fixed vocabulary, so the glyphs are mapped here rather than asked of the
  // model — same reasoning as the MBTI poles.
  const LOVE_LANGUAGE_ICONS = {
    'Words of affirmation': '💬',
    'Acts of service': '🛠️',
    'Quality time': '⏳',
    'Receiving gifts': '🎁',
    'Physical touch': '🫂',
  };

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
      loveLanguageColumn('How you want to be loved', 'What lands, when it is aimed at you.', languages.receiving) +
      loveLanguageColumn('How you show love', 'What you reach for when you care about someone.', languages.giving);
    if (!columns) return '';
    return '<h3 class="love-head">Your love languages</h3><div class="split love-split">' + columns + '</div>' +
      (languages.caveat ? '<p class="fineprint">' + esc(languages.caveat) + '</p>' : '');
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
    window.scrollTo(0, 0);
  }

  function go(target) {
    if (target === 'home') { return state.profile ? go('profile') : show('welcome'); }
    if (target === 'profile') {
      if (!state.profile) return show('welcome');
      renderProfile(); show('profile'); return;
    }
    if (target === 'scan') {
      if (!state.profile) { flash('#upload-error', 'Build your own profile first — a report needs two people.'); return show('welcome'); }
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

    const includeMessages = $('#include-dms').checked;
    const includeImages = $('#include-images').checked;

    $('#working-title').textContent = 'Reading your export';
    $('#working-note').textContent = 'The archive is being unpacked on this device.';
    setProgress(0, 'Opening the archive…');
    show('working');

    let digest;
    let images = [];
    try {
      const signals = await IG.readExports(chosen, {
        includeMessages,
        includeImages,
        onProgress: p => setProgress(Math.round((p.total ? p.done / p.total : 0) * 80), p.label),
      });

      if (includeImages) {
        const chosenImages = Images.select(signals);
        // Decoding and re-encoding is the slowest client-side step by a wide
        // margin, so it gets its own slice of the bar rather than appearing
        // as a stall at the end.
        images = await Images.extract(signals, chosenImages, (done, total) => {
          setProgress(80 + Math.round((done / Math.max(1, total)) * 14),
            'Preparing image ' + done + ' of ' + total + '…');
        });
      }

      setProgress(95, 'Building your evidence summary…');
      await new Promise(resolve => setTimeout(resolve, 30));
      digest = Digest.build(signals, { includeMessages, includeImages, imageCount: images.length });
    } catch (error) {
      show('welcome');
      flash('#upload-error', (error && error.message) || 'Could not read that archive.');
      return;
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
      'This usually takes a minute or two — a long report is being written.';
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
      show('welcome');
      flash('#upload-error', (error && error.message) || 'The analysis failed.');
    }
  }

  // ══════════════ 2. profile report ══════════════

  const TRAIT_LABELS = {
    openness: 'Openness to experience',
    conscientiousness: 'Conscientiousness',
    extraversion: 'Extraversion',
    agreeableness: 'Agreeableness',
    neuroticism: 'Emotional sensitivity',
  };

  // The four axes spelled out. A letter on its own means nothing to anyone who
  // has not read the MBTI literature, and the pairing is fixed vocabulary, so
  // it is resolved here rather than asked of the model — which could get it
  // wrong, and would cost tokens to get right.
  const MBTI_POLES = {
    E: { name: 'Extraversion', opposite: 'I' },
    I: { name: 'Introversion', opposite: 'E' },
    N: { name: 'Intuition', opposite: 'S' },
    S: { name: 'Sensing', opposite: 'N' },
    T: { name: 'Thinking', opposite: 'F' },
    F: { name: 'Feeling', opposite: 'T' },
    J: { name: 'Judging', opposite: 'P' },
    P: { name: 'Perceiving', opposite: 'J' },
  };

  /** "E" → "Extraversion over Introversion", falling back to the raw axis. */
  function axisLabel(letter, axis) {
    const key = String(letter || '').toUpperCase().replace(/[^EINSTFJP]/g, '').charAt(0);
    const pole = MBTI_POLES[key];
    if (!pole) return { name: String(axis || ''), against: '' };
    return { name: pole.name, against: MBTI_POLES[pole.opposite].name };
  }

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

  function renderProfile() {
    const profile = state.profile;
    if (!profile) return;
    const report = profile.report;

    const who = profile.card.name || 'Your';
    $('#profile-title').textContent = who + '’s personality analysis';

    // The PDF letterhead. Only ever visible in print, but filled here so the
    // export never depends on anything happening at print time.
    $('#letterhead-name').textContent = who;
    $('#letterhead-meta').textContent =
      'Generated ' + new Date(profile.createdAt).toLocaleDateString(undefined,
        { year: 'numeric', month: 'long', day: 'numeric' }) +
      ' · from an Instagram data export · ' + Math.round(report.confidence.score) + '/100 confidence';

    // The card is ~630 characters, so this lands around 87 modules across.
    // Backing the canvas at 3x its display size keeps module edges crisp on a
    // high-DPI phone, which is the difference between a camera resolving them
    // and seeing grey mush. A wider quiet zone helps the locator too.
    try {
      const canvas = $('#qr-canvas');
      window.QRCode.toCanvas(canvas, profileUrl(profile.payload), qrOptions(profileUrl(profile.payload), 900, 3));
      // qrcode.js writes its width as an inline style; drop it so the
      // stylesheet decides the display size, print rules included.
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    } catch (error) { /* canvas unavailable — the link still works */ }

    const size = profile.payload.length;
    $('#payload-size').textContent = 'Shareable card: ' + size + ' characters' +
      (size > Card.COMFORTABLE_PAYLOAD ? ' — dense, so use the link if scanning is unreliable.' : '.') +
      ' Your full report is not included.';

    // Every section opens the same way: a glyph, a title and a line saying
    // what the section is for. It gives the long report a rhythm to scroll
    // through instead of a wall of identical cards.
    const head = (icon, title, sub) =>
      '<div class="card-head"><span class="card-icon">' + icon + '</span>' +
      '<div><h2>' + title + '</h2>' +
      (sub ? '<p class="card-sub">' + sub + '</p>' : '') + '</div></div>';

    let html = '';

    html += '<div class="card section-card">' + head('👤', 'Who you are') +
      essenceBlock(report.essence) + glanceBlock(report) + paragraphs(report.summary) + '</div>';

    // Big Five.
    html += '<div class="card section-card">' +
      head('📊', 'Big Five', '0–100, where 50 is an average person. Each score lists the evidence behind it.');
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
      head('🧭', 'MBTI: ' + esc(mbti.type) +
        (mbti.nickname ? ' <span class="type-nickname">' + esc(mbti.nickname) + '</span>' : ''),
        'Confidence: ' + esc(mbti.confidence));

    html += '<div class="axes">' + (mbti.letters || []).map(letter => {
      const pole = axisLabel(letter.choice, letter.axis);
      return '<div class="axis"><span class="axis-letter">' + esc(letter.choice) + '</span>' +
        '<div><span class="axis-name">' + esc(pole.name) + '</span>' +
        (pole.against ? '<span class="axis-against">over ' + esc(pole.against) + '</span>' : '') +
        '<span class="pill pill-' + esc(letter.strength || 'moderate') + '">' + esc(letter.strength || '') + '</span>' +
        '<p>' + esc(letter.why) + '</p>' +
        (letter.inPractice ? '<p class="muted">' + esc(letter.inPractice) + '</p>' : '') +
        '</div></div>';
    }).join('') + '</div>';

    html += '<p class="fineprint">' + esc(mbti.caveat) + '</p></div>';

    // Interests.
    html += '<div class="card section-card">' + head('✨', 'Interests');
    if ((report.interests || []).length) {
      html += '<div class="tile-grid">' + report.interests.map(item =>
        '<div class="tile tile-' + esc(item.intensity) + '">' +
        '<h4>' + esc(item.name) + '<span class="pill pill-' + esc(item.intensity) + '">' + esc(item.intensity) + '</span></h4>' +
        '<p>' + esc(item.detail) + '</p>' +
        '<p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>';
    } else {
      html += '<p class="muted">Nothing stood out strongly.</p>';
    }
    html += '</div>';

    // Values and beliefs, together — they answer the same question from two
    // directions, and splitting them left two thin cards.
    html += '<div class="card section-card">' +
      head('🧿', 'Values &amp; Beliefs', 'What you appear to hold to, and how firmly the data actually says so.') +
      '<h3>Values</h3>';
    html += (report.values || []).length
      ? '<div class="tile-grid">' + report.values.map(item =>
        '<div class="tile"><h4>' + esc(item.value) + '</h4><p>' + esc(item.detail) + '</p>' +
        '<p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>'
      : '<p class="muted">The export did not support any confident read here.</p>';

    html += '<h3>Beliefs</h3>';
    html += (report.beliefs || []).length
      ? '<div class="tile-grid">' + report.beliefs.map(item =>
        '<div class="tile"><h4>' + esc(item.belief) +
        '<span class="pill">' + esc(item.confidence) + ' confidence</span></h4>' +
        '<p>' + esc(item.detail) + '</p><p class="tile-ev">' + esc(item.evidence) + '</p></div>').join('') + '</div>'
      : '<p class="muted">Nothing in the export supported a confident read on beliefs — which is a perfectly ordinary result.</p>';
    html += '</div>';

    // Relationships.
    const relationship = report.relationship;
    html += '<div class="card section-card">' + head('💞', 'In relationships') +
      '<div class="split"><div><h3 class="h-good">Strengths</h3>' + points(relationship.strengths) + '</div>' +
      '<div><h3 class="h-warn">Weaknesses</h3>' + points(relationship.weaknesses) + '</div></div>' +
      '<div class="callout"><h3>Attachment: ' + esc(relationship.attachment.style) + '</h3>' +
      '<p>' + esc(relationship.attachment.why) + '</p>' +
      ((relationship.attachment.derivedFrom || []).length
        ? '<p class="essence-label">Read from</p>' +
          '<p class="trait-evidence">' + relationship.attachment.derivedFrom
            .map(item => '<span class="ev">' + esc(item) + '</span>').join('') + '</p>'
        : '') +
      ((relationship.attachment.implications || []).length
        ? '<p class="essence-label">What it means in practice</p>' + points(relationship.attachment.implications)
        : '') +
      '<p class="fineprint">' + esc(relationship.attachment.caveat) + '</p></div>' +
      loveLanguageBlock(relationship.loveLanguages) + '</div>';

    // Career.
    const career = report.career;
    html += '<div class="card section-card">' + head('💼', 'At work') +
      '<div class="split"><div><h3 class="h-good">Strengths</h3>' + points(career.strengths) + '</div>' +
      '<div><h3 class="h-warn">Weaknesses</h3>' + points(career.weaknesses) + '</div></div>' +
      '<h3>How you work</h3><p>' + esc(career.workStyle) + '</p>' +
      '<h3>Where you would thrive</h3>' + list(career.environments, 'ticks') +
      '<h3>What could hold you back</h3><p>' + esc(career.watchOuts) + '</p></div>';

    // Instagram behaviour: the part of the export nobody reads themselves.
    // It sits after the personality sections because it is the evidence
    // underneath them rather than another verdict.
    const activity = report.activity;
    if (activity) {
      html += '<div class="card section-card">' +
        head('📱', 'Your Instagram behaviour', esc(activity.summary));
      html += '<div class="facet-grid">';
      for (const [label, key] of [
        ['What you post', 'posting'],
        ['When you are here', 'rhythm'],
        ['How it changed', 'trajectory'],
        ['Publishing vs reading', 'engagement'],
        ['Where your attention goes', 'attention'],
      ]) {
        const facet = activity[key];
        if (!facet) continue;
        html += '<div class="facet"><span class="facet-label">' + label + '</span>' +
          '<h4>' + esc(facet.headline) + '</h4><p>' + esc(facet.detail) + '</p></div>';
      }
      html += '</div>';
      if ((activity.implications || []).length) {
        html += '<h3>What it suggests</h3><dl class="points implications">' +
          activity.implications.map(item =>
            '<dt>' + esc(item.observation) + '</dt><dd>' + esc(item.implication) + '</dd>').join('') + '</dl>';
      }
      html += '<p class="fineprint">' + esc(activity.blindSpots) + '</p></div>';
    }

    // What gets shared.
    html += '<div class="card section-card">' +
      head('🔗', 'What your QR code contains',
        'Only this — the compact card the other person\'s report is built from.') +
      '<p><strong>' + esc(profile.card.headline) + '</strong></p><p>' + esc(profile.card.summary) + '</p>' +
      tags(profile.card.interests) +
      '<p class="fineprint">Plus your Big Five scores, MBTI, values, beliefs, relationship and career ' +
      'strengths and weaknesses, attachment guess and rhythm — all as short phrases.</p></div>';

    const history = store.read(KEYS.history, []);
    if (history.length) {
      html += '<div class="card section-card">' + head('🤝', 'Your matches') +
        historyTable(history) + '</div>';
    }

    // Confidence closes the report rather than opening it: read after the
    // whole thing, it says how much of what you just read to believe.
    html += '<div class="card section-card confidence-card">' +
      head('🎯', 'How much to trust this',
        'Everything above is inferred from behavioural traces, and the model says how far it would stand behind them.') +
      '<div class="confidence-meter"><div class="confidence-fill" style="width:' + Math.round(report.confidence.score) + '%"></div></div>' +
      '<p><strong>Confidence: ' + Math.round(report.confidence.score) + '/100 (' + esc(report.confidence.level) + ').</strong> ' +
      esc(report.confidence.rationale) + '</p></div>';

    html += '<p class="fineprint">Analysed by ' + esc(profile.model || 'the model') + ' on ' +
      esc(new Date(profile.createdAt).toLocaleString()) + '.</p>';

    $('#profile-body').innerHTML = html;
  }

  function historyTable(history) {
    return '<div class="table-scroll"><table class="match-table"><thead><tr>' +
      '<th>With</th><th>Basis</th><th>Score</th><th>When</th><th></th></tr></thead><tbody>' +
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
    if (entry) { renderReport(entry.report, entry.withName); show('report'); }
  });

  $('#copy-link').addEventListener('click', () => {
    const url = profileUrl(state.profile.payload);
    const button = $('#copy-link');
    const done = () => { button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = 'Copy my link'; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
    else window.prompt('Copy this link:', url);
  });

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

  $('#download-qr').addEventListener('click', async () => {
    const button = $('#download-qr');
    const name = 'psycheai-' + (state.profile.card.name || 'me').toLowerCase().replace(/\W+/g, '-');
    try {
      const canvas = await renderExportCanvas(profileUrl(state.profile.payload));
      // 0.95 is well clear of the point where JPEG ringing touches a module —
      // at 1600px each one is about 17 pixels across.
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!blob) throw new Error('Could not encode the image.');

      // A Blob URL rather than a data URL, and the anchor in the document:
      // Firefox ignores a click on a detached anchor, and Safari will not
      // honour "download" on a large data: URL.
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = name + '.jpg';
      link.href = href;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      button.textContent = 'Could not save — use the link';
      setTimeout(() => { button.textContent = 'Download QR Code'; }, 3000);
    }
  });

  // Export goes through the browser's own print-to-PDF rather than a bundled
  // PDF library. A twelve-page text report is exactly what print CSS is for:
  // the text stays selectable and searchable, pagination and page size are the
  // browser's problem, and it costs nothing to ship. A canvas-rasterising
  // library would produce a fuzzy image of the same thing and add 200KB.
  //
  // The temporary title is what most browsers offer as the default filename.
  function exportPdf() {
    const name = (state.profile && state.profile.card.name) || 'me';
    const original = document.title;
    document.title = 'PsycheAI — ' + name;
    const restore = () => { document.title = original; };
    window.addEventListener('afterprint', restore, { once: true });
    // Safari does not always fire afterprint, so restore on a timer too.
    setTimeout(restore, 60000);
    window.print();
  }

  $('#export-pdf-top').addEventListener('click', exportPdf);
  $('#export-pdf-bottom').addEventListener('click', exportPdf);

  $('#reanalyse').addEventListener('click', async () => {
    if (!state.digest) {
      flash('#upload-error', 'The evidence summary is gone from this browser — upload your export again.');
      return show('welcome');
    }
    const warning = state.digest.coverage.images && state.digest.coverage.images.attached && !state.images.length
      ? 'Run the analysis again on the same export? This makes a fresh model call. Your photos are not ' +
        'kept between page loads, so this run will use the written evidence only — re-upload the .zip to ' +
        'include them again.'
      : 'Run the analysis again on the same export? This makes a fresh model call.';
    if (!window.confirm(warning)) return;
    await runAnalysis(state.digest, state.images);
  });

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
    $('#paste-input').value = '';
    $('#scan-status').textContent = '';
    $('#camera-holder').hidden = true;
    const history = store.read(KEYS.history, []);
    $('#scan-history').innerHTML = history.length
      ? '<div class="card"><h2>Previous reports</h2>' + historyTable(history) + '</div>' : '';
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

  const MODE_LABELS = {
    romantic: 'Romantic',
    platonic: 'Platonic',
    professional: 'Professional / work',
  };
  const MODE_HEADINGS = {
    romantic: 'How to partner each other',
    platonic: 'How to befriend each other',
    professional: 'How to work with each other',
  };

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

    $('#working-title').textContent = modelName() + ' is comparing you';
    $('#working-note').textContent =
      MODE_LABELS[mode] + ' compatibility. Two profile cards were sent — nothing else.';
    startElapsed('Assessing ' + state.profile.card.name + ' and ' + other.name);
    show('working');

    try {
      const result = await LLM.analyseCompatibility(state.profile.card, other, mode);
      stopElapsed();
      const report = { ...result.data, mode: result.data.mode || mode };
      const history = store.read(KEYS.history, []);
      history.unshift({ when: new Date().toISOString(), withName: other.name, mode: report.mode, report });
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

  function renderReport(report, otherName) {
    const myName = state.profile ? state.profile.card.name : 'You';
    const mode = MODE_LABELS[report.mode] ? report.mode : 'romantic';

    let html = '<header class="page-head"><h1>' + esc(myName) + ' &amp; ' + esc(otherName) + '</h1>' +
      '<p class="muted"><span class="pill pill-clear">' + esc(MODE_LABELS[mode]) + '</span> ' +
      'This report answers one question. Scan again to compare on a different basis.</p></header>';

    html += scoreCard(MODE_LABELS[mode], report);

    html += '<div class="card"><h2>The short version</h2>' +
      '<h3>Biggest upside</h3><p>' + esc(report.biggestUpside) + '</p>' +
      '<h3>Biggest risk</h3><p>' + esc(report.biggestRisk) + '</p>' +
      (report.sharedGround && report.sharedGround.length
        ? '<h3>Common ground</h3>' + tags(report.sharedGround) : '') +
      '</div>';

    html += '<div class="card good"><h2>What works</h2>' + points(report.strengths) + '</div>' +
      '<div class="card warn"><h2>What will rub</h2>' + points(report.frictions) + '</div>' +
      '<div class="card"><h2>' + esc(MODE_HEADINGS[mode]) + '</h2><div class="playbook">' +
      '<div><h3>For ' + esc(myName) + '</h3>' + list(report.howToPartner.forA, 'ticks') + '</div>' +
      '<div><h3>For ' + esc(otherName) + '</h3>' + list(report.howToPartner.forB, 'ticks') + '</div>' +
      '</div><h3>Both of you</h3>' + list(report.howToPartner.together, 'ticks') + '</div>';

    if ((report.conversationStarters || []).length) {
      html += '<div class="card"><h2>Things to actually talk about</h2>' + list(report.conversationStarters) + '</div>';
    }

    html += '<p class="fineprint">' + esc(report.caveats) + '</p>';

    $('#report-body').innerHTML = html;
  }

  function scoreCard(label, report) {
    const value = Math.round(Number(report.score) || 0);
    const tier = value >= 80 ? 'a' : value >= 65 ? 'b' : value >= 50 ? 'c' : 'd';
    return '<div class="card score-card score-single tier-' + tier + '">' +
      '<div class="ring" style="--pct:' + value + '"><span>' + value + '</span></div>' +
      '<div><h2>' + esc(label) + ' compatibility</h2>' +
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
    show('welcome');
    flash('#upload-error', 'Someone shared their PsycheAI code with you. Build your own profile and the comparison runs automatically.');
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
