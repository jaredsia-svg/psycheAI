// Kindred SPA: upload → analysis → questionnaire → profile → scan → report.
// All state lives in localStorage; there is no server anywhere in this app.
(function () {
  'use strict';

  const Q = window.KindredQuestions;
  const IG = window.KindredInstagram;
  const Analysis = window.KindredAnalysis;
  const Codec = window.KindredCodec;
  const Compat = window.KindredCompat;

  const $ = sel => document.querySelector(sel);
  const KEYS = { analysis: 'kindred2_analysis', answers: 'kindred2_answers', profile: 'kindred2_profile', history: 'kindred2_history', name: 'kindred2_name' };

  // ---------- storage ----------

  const store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota — the session still works */ }
    },
    clearAll() { for (const key of Object.values(KEYS)) localStorage.removeItem(key); },
  };

  const state = {
    analysis: store.read(KEYS.analysis, null),
    answers: store.read(KEYS.answers, null),
    profile: store.read(KEYS.profile, null),
    name: store.read(KEYS.name, ''),
    stepIndex: 0,
  };

  // ---------- html helpers ----------

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function bar(label, value, extra) {
    return '<div class="trait-row"><span class="trait-label">' + esc(label) + '</span>' +
      '<div class="bar"><div class="bar-fill" style="width:' + Math.round(value) + '%"></div></div>' +
      '<span class="trait-num">' + Math.round(value) + '</span></div>' +
      (extra ? '<p class="trait-evidence">' + extra + '</p>' : '');
  }

  function list(items, className) {
    if (!items || !items.length) return '';
    return '<ul class="' + (className || '') + '">' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
  }

  function tags(items) {
    if (!items || !items.length) return '<p class="muted">None selected.</p>';
    return '<p class="tag-row">' + items.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>';
  }

  // ---------- routing ----------

  const VIEWS = ['welcome', 'analysing', 'analysis', 'questionnaire', 'profile', 'scan', 'report', 'about'];

  function show(view) {
    if (view !== 'scan') stopCamera();
    for (const name of VIEWS) $('#view-' + name).hidden = name !== view;
    window.scrollTo(0, 0);
  }

  function go(target) {
    if (target === 'home') { show(state.profile ? 'profile' : 'welcome'); if (state.profile) renderProfile(); return; }
    if (target === 'profile') {
      if (!state.profile) return go('home');
      renderProfile(); show('profile'); return;
    }
    if (target === 'questionnaire') {
      if (!state.analysis) return go('home');
      state.stepIndex = 0; renderStep(); show('questionnaire'); return;
    }
    if (target === 'scan') {
      if (!state.profile) { flash('#upload-error', 'Build your own profile first — a report needs two people.'); return go('home'); }
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
    node.textContent = message;
    node.hidden = !message;
  }

  // ══════════════ 1. upload ══════════════

  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('is-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  async function handleFiles(files) {
    const list = Array.from(files || []).filter(f => /\.zip$/i.test(f.name));
    flash('#upload-error', '');
    if (!list.length) {
      flash('#upload-error', 'That does not look like a .zip file. Instagram sends your export as one or more .zip archives.');
      return;
    }

    show('analysing');
    setProgress(0, 'Opening the archive…');
    const includeMessages = $('#include-dms').checked;

    try {
      const signals = await IG.readExports(list, {
        includeMessages,
        onProgress: p => {
          const fraction = p.total ? p.done / p.total : 0;
          setProgress(Math.round(fraction * 85), p.label);
        },
      });
      setProgress(90, 'Building your profile…');
      // Let the progress bar paint before the synchronous analysis pass.
      await new Promise(resolve => setTimeout(resolve, 30));

      const analysis = Analysis.analyse(signals, { includeMessages });
      setProgress(100, 'Done');

      state.analysis = analysis;
      state.answers = analysis.prefill;
      state.name = state.name || analysis.profile.name || '';
      store.write(KEYS.analysis, analysis);
      store.write(KEYS.answers, analysis.prefill);
      store.write(KEYS.name, state.name);

      renderAnalysis();
      show('analysis');
    } catch (error) {
      show('welcome');
      flash('#upload-error', error && error.message ? error.message : 'Could not read that archive.');
    }
  }

  function setProgress(percent, label) {
    $('#progress-bar').style.width = percent + '%';
    if (label) $('#progress-label').textContent = label;
  }

  // ══════════════ 2. analysis ══════════════

  const TRAIT_LABELS = {
    openness: 'Openness to experience',
    conscientiousness: 'Conscientiousness',
    extraversion: 'Extraversion',
    agreeableness: 'Agreeableness',
    neuroticism: 'Emotional sensitivity',
  };

  function renderAnalysis() {
    const a = state.analysis;
    const counts = a.counts;

    $('#analysis-sub').textContent =
      'Read from ' + counts.posts.toLocaleString() + ' posts, ' + counts.stories.toLocaleString() + ' stories, ' +
      counts.comments.toLocaleString() + ' comments you wrote and ' + counts.likes.toLocaleString() + ' likes' +
      (a.rhythm.spanDays ? ', spanning ' + Math.round(a.rhythm.spanDays / 30) + ' months' : '') + '.';

    let html = '';

    // Confidence first — it frames everything below it.
    html += '<div class="card confidence-card">' +
      '<div class="confidence-meter"><div class="confidence-fill" style="width:' + a.confidence + '%"></div></div>' +
      '<p><strong>Confidence: ' + a.confidence + '/100 (' + esc(a.confidenceLabel) + ').</strong> ' +
      'This is how much your export actually supports the estimates below — driven by how much you have written, ' +
      'how much activity there is and how long it spans.</p>' +
      (a.caveats.length ? list(a.caveats, 'caveats') : '') +
      '</div>';

    // Narrative.
    html += '<div class="card"><h2>Your profile in words</h2>';
    for (const section of a.narrative) {
      html += '<h3>' + esc(section.title) + '</h3><p>' + esc(section.body) + '</p>';
    }
    html += '</div>';

    // Big Five with evidence.
    html += '<div class="card"><h2>Big Five, estimated</h2>' +
      '<p class="muted">Each bar shows what moved it. You will get to correct all five in the questionnaire.</p>';
    for (const trait of Object.keys(TRAIT_LABELS)) {
      const item = a.bigFive[trait];
      const evidence = item.evidence.map(e =>
        '<span class="ev ev-' + e.direction + '">' + (e.direction === 'up' ? '▲' : '▼') + ' ' + esc(e.label) + '</span>').join('');
      html += bar(TRAIT_LABELS[trait] + ' · confidence ' + a.traitConfidence[trait], item.score, evidence);
    }
    html += '<p class="fineprint">Suggested MBTI shorthand from these traits: <strong>' + esc(a.mbtiSuggestion) +
      '</strong>. The Big Five and MBTI correlate but are not the same thing — treat this as a nickname.</p></div>';

    // Themes.
    const strongThemes = a.themes.filter(t => t.score >= 30).slice(0, 18);
    html += '<div class="card"><h2>What you spend your attention on</h2>';
    if (strongThemes.length) {
      html += '<div class="theme-grid">';
      for (const theme of strongThemes) {
        html += '<div class="theme-chip"><span class="theme-score" style="--v:' + theme.score + '">' + theme.score + '</span>' +
          '<span>' + esc(theme.label) + '</span>' +
          '<span class="theme-src muted">' +
          (theme.hits.topics ? theme.hits.topics + ' Instagram topics · ' : '') +
          (theme.hits.accounts ? theme.hits.accounts + ' accounts · ' : '') +
          theme.hits.text + ' mentions</span></div>';
      }
      html += '</div>';
    } else {
      html += '<p class="muted">Nothing stands out strongly — your export is light on captions and follows.</p>';
    }
    html += '</div>';

    // Rhythm.
    const peak = Math.max(1, ...a.rhythm.hours);
    html += '<div class="card"><h2>When you are active</h2><div class="hours">';
    for (let h = 0; h < 24; h++) {
      html += '<div class="hour"><div class="hour-bar" style="height:' + Math.round((a.rhythm.hours[h] / peak) * 100) + '%"></div>' +
        '<span class="hour-label">' + (h % 6 === 0 ? h : '') + '</span></div>';
    }
    html += '</div><p><strong>' + esc(a.rhythm.chronotype) + '.</strong> ' +
      Math.round(a.rhythm.lateNightShare * 100) + '% of your activity happens between midnight and 5am, and ' +
      Math.round(a.rhythm.weekendShare * 100) + '% at weekends. Cadence steadiness: ' +
      Math.round(a.rhythm.regularity * 100) + '/100.</p></div>';

    // Values and beliefs.
    html += '<div class="card"><h2>Values showing through</h2>';
    const topValues = a.values.filter(v => v.score >= 20).slice(0, 8);
    if (topValues.length) {
      for (const value of topValues) html += bar(value.label, value.score);
    } else {
      html += '<p class="muted">No strong value signals — the questionnaire will carry this.</p>';
    }
    html += '</div>';

    $('#analysis-body').innerHTML = html;
  }

  // ══════════════ 3. questionnaire ══════════════

  function chipInput(type, name, value, checked, badge) {
    return '<label class="chip' + (checked ? ' is-checked' : '') + '">' +
      '<input type="' + type + '" name="' + esc(name) + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + esc(value) + '</span>' + (badge ? '<span class="chip-badge" title="Suggested from your Instagram">IG</span>' : '') +
      '</label>';
  }

  function renderQuestion(question, answers, prefill) {
    const value = answers[question.id];
    const prefilled = prefill ? prefill[question.id] : null;
    let html = '<fieldset class="question" data-qid="' + esc(question.id) + '">';
    html += '<legend>' + esc(question.text) +
      (question.required ? ' <span class="req">required</span>' : '') +
      (question.extra ? ' <span class="extra-badge" title="Not in the source questionnaire — Kindred needs it to score compatibility">added by Kindred</span>' : '') +
      '</legend>';
    if (question.help) html += '<p class="muted help-text">' + esc(question.help) + '</p>';

    if (question.type === 'text') {
      html += '<input type="text" name="' + esc(question.id) + '" value="' + esc(value) + '" maxlength="60" placeholder="' + esc(question.placeholder || '') + '">';

    } else if (question.type === 'textarea') {
      html += '<textarea name="' + esc(question.id) + '" rows="' + (question.rows || 4) + '" maxlength="4000">' + esc(value) + '</textarea>';

    } else if (question.type === 'single') {
      // Long option lists become a select; short ones stay as tappable chips.
      if (question.options.length > 10) {
        html += '<select name="' + esc(question.id) + '"><option value="">—</option>' +
          question.options.map(o => '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
          '</select>';
      } else {
        html += '<div class="chip-grid">' +
          question.options.map(o => chipInput('radio', question.id, o, o === value, false)).join('') + '</div>';
      }

    } else if (question.type === 'multi') {
      const chosen = Array.isArray(value) ? value : [];
      const suggested = Array.isArray(prefilled) ? prefilled : [];
      html += '<div class="chip-grid' + (question.max ? ' limited' : '') + '"' + (question.max ? ' data-max="' + question.max + '"' : '') + '>' +
        question.options.map(o => chipInput('checkbox', question.id, o, chosen.includes(o), suggested.includes(o))).join('') + '</div>';
      if (question.max) html += '<p class="fineprint counter">Pick up to ' + question.max + '.</p>';
      if (question.allowOther) {
        const otherKey = question.id === 'fitness' ? 'other_fitness' : 'other_interests';
        html += '<input type="text" name="' + otherKey + '" class="other-input" maxlength="80" placeholder="Others — anything not listed" value="' + esc(answers[otherKey]) + '">';
      }

    } else if (question.type === 'sliders') {
      html += '<div class="sliders">';
      for (const trait of question.traits) {
        const v = (value && value[trait.id]) !== undefined ? value[trait.id] : 50;
        html += '<div class="slider-row"><label for="sl-' + trait.id + '">' + esc(trait.label) +
          ' <output id="out-' + trait.id + '">' + v + '</output></label>' +
          '<input type="range" min="0" max="100" step="1" id="sl-' + trait.id + '" name="bigfive_' + trait.id + '" value="' + v + '">' +
          '<div class="slider-ends"><span>' + esc(trait.low) + '</span><span>' + esc(trait.high) + '</span></div></div>';
      }
      html += '</div>';

    } else if (question.type === 'grid') {
      html += '<div class="grid-rows">';
      for (const row of question.rows) {
        const rowValue = (value && value[row.id]) || '';
        html += '<div class="grid-row"><span class="grid-label">' + esc(row.label) + '</span><div class="chip-grid tight">' +
          row.options.map(o => chipInput('radio', question.id + '__' + row.id, o, o === rowValue, false)).join('') +
          '</div></div>';
      }
      html += '</div>';
    }

    if (question.note) {
      html += '<label class="field note-field">' + esc(question.note.label) +
        '<textarea name="' + esc(question.note.id) + '" rows="' + (question.note.rows || 2) + '" maxlength="2000">' +
        esc(answers[question.note.id]) + '</textarea></label>';
    }
    html += '</fieldset>';
    return html;
  }

  function renderStep() {
    const step = Q.STEPS[state.stepIndex];
    const answers = state.answers;
    const prefill = state.analysis ? state.analysis.prefill : null;

    $('#step-title').textContent = step.title;
    $('#step-sub').textContent = step.subtitle || '';
    $('#step-progress').style.width = Math.round(((state.stepIndex + 1) / Q.STEPS.length) * 100) + '%';
    flash('#step-alert', '');

    let html = '';
    if (state.stepIndex === 0) {
      html += '<fieldset class="question"><legend>What should people call you? ' +
        '<span class="extra-badge">added by Kindred</span></legend>' +
        '<p class="muted help-text">Shown on the other person\'s report. Kept short so it fits in your QR code.</p>' +
        '<input type="text" name="__name" maxlength="24" value="' + esc(state.name) + '" placeholder="Alex"></fieldset>';
    }
    for (const question of step.questions) html += renderQuestion(question, answers, prefill);

    $('#step-form').innerHTML = html;
    $('#step-back').textContent = state.stepIndex === 0 ? '← Back to my analysis' : '← Back';
    $('#step-next').textContent = state.stepIndex === Q.STEPS.length - 1 ? 'Build my profile →' : 'Next →';
    wireStepForm();
  }

  function wireStepForm() {
    const form = $('#step-form');

    // Keep the visual checked state and any "pick up to N" limit in sync.
    form.addEventListener('change', event => {
      const input = event.target;
      if (input.type === 'checkbox' || input.type === 'radio') {
        const grid = input.closest('.chip-grid');
        if (grid) {
          for (const label of grid.querySelectorAll('.chip')) {
            label.classList.toggle('is-checked', label.querySelector('input').checked);
          }
          applyLimit(grid);
        }
      }
      if (input.type === 'range') {
        const out = document.getElementById('out-' + input.name.replace('bigfive_', ''));
        if (out) out.textContent = input.value;
      }
    });

    for (const grid of form.querySelectorAll('.chip-grid.limited')) applyLimit(grid);
    for (const range of form.querySelectorAll('input[type=range]')) {
      range.addEventListener('input', () => {
        const out = document.getElementById('out-' + range.name.replace('bigfive_', ''));
        if (out) out.textContent = range.value;
      });
    }
  }

  function applyLimit(grid) {
    const max = Number(grid.dataset.max || 0);
    if (!max) return;
    const boxes = Array.from(grid.querySelectorAll('input[type=checkbox]'));
    const checked = boxes.filter(b => b.checked);
    for (const box of boxes) box.disabled = !box.checked && checked.length >= max;
    const counter = grid.parentElement.querySelector('.counter');
    if (counter) counter.textContent = checked.length + ' of ' + max + ' picked.';
  }

  function collectStep() {
    const form = $('#step-form');
    const data = new FormData(form);
    const step = Q.STEPS[state.stepIndex];
    const answers = state.answers;

    if (state.stepIndex === 0) {
      state.name = String(data.get('__name') || '').trim().slice(0, 24);
      store.write(KEYS.name, state.name);
    }

    for (const question of step.questions) {
      if (question.type === 'multi') {
        answers[question.id] = data.getAll(question.id);
        if (question.allowOther) {
          const otherKey = question.id === 'fitness' ? 'other_fitness' : 'other_interests';
          answers[otherKey] = String(data.get(otherKey) || '').trim();
        }
      } else if (question.type === 'sliders') {
        answers[question.id] = {};
        for (const trait of question.traits) {
          answers[question.id][trait.id] = Number(data.get('bigfive_' + trait.id));
        }
      } else if (question.type === 'grid') {
        answers[question.id] = answers[question.id] || {};
        for (const row of question.rows) {
          answers[question.id][row.id] = String(data.get(question.id + '__' + row.id) || '');
        }
      } else {
        answers[question.id] = String(data.get(question.id) || '').trim();
      }
      if (question.note) answers[question.note.id] = String(data.get(question.note.id) || '').trim();
    }
    store.write(KEYS.answers, answers);
  }

  function missingInStep() {
    const step = Q.STEPS[state.stepIndex];
    const missing = [];
    for (const question of step.questions) {
      if (!question.required) continue;
      const value = state.answers[question.id];
      const empty = question.type === 'multi' ? !(value && value.length) : !String(value || '').trim();
      if (empty) missing.push(question.text);
    }
    return missing;
  }

  $('#step-back').addEventListener('click', event => {
    event.preventDefault();
    collectStep();
    if (state.stepIndex === 0) { renderAnalysis(); show('analysis'); return; }
    state.stepIndex--;
    renderStep();
  });

  $('#step-next').addEventListener('click', event => {
    event.preventDefault();
    collectStep();
    const missing = missingInStep();
    if (missing.length) {
      const alert = $('#step-alert');
      alert.innerHTML = '<strong>Still needed:</strong>' + list(missing);
      alert.hidden = false;
      alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (state.stepIndex < Q.STEPS.length - 1) {
      state.stepIndex++;
      renderStep();
      return;
    }
    buildProfile();
  });

  $('#step-form').addEventListener('submit', e => e.preventDefault());

  function buildProfile() {
    state.profile = Analysis.buildProfile(state.analysis, state.answers, state.name);
    store.write(KEYS.profile, state.profile);

    // If they arrived from someone else's link, go straight to the report.
    const pending = sessionStorage.getItem('kindred2_pending');
    if (pending) {
      sessionStorage.removeItem('kindred2_pending');
      if (runMatch(pending)) return;
    }
    renderProfile();
    show('profile');
  }

  // ══════════════ 4. profile ══════════════

  function profileUrl(payload) {
    return location.origin + location.pathname + '#p=' + payload;
  }

  function renderProfile() {
    const p = state.profile;
    const a = state.analysis;
    if (!p) return;

    $('#profile-title').textContent = p.name + '’s profile';
    $('#profile-sub').textContent = [p.background.occupation, p.background.country].filter(Boolean).join(' · ') ||
      'Built from your Instagram export and your questionnaire answers.';

    const payload = Codec.encodeProfile(p);
    try {
      window.QRCode.toCanvas($('#qr-canvas'), profileUrl(payload), {
        width: 280, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#2b1b3d', light: '#ffffff' },
      });
    } catch (e) { /* canvas unavailable — the link still works */ }
    $('#payload-size').textContent = 'Payload: ' + payload.length + ' characters. Free-text answers are not included.';

    let html = '';

    html += '<div class="card"><h2>Personality</h2>';
    for (const trait of Object.keys(TRAIT_LABELS)) {
      html += bar(TRAIT_LABELS[trait], p.bigFive[trait]);
    }
    html += '<div class="pill-row">' +
      (p.mbti ? '<span class="pill">MBTI ' + esc(p.mbti) + '</span>' : '') +
      (p.enneagram ? '<span class="pill">Enneagram ' + esc(p.enneagram) + '</span>' : '') +
      '<span class="pill">' + esc(Compat.ATTACHMENT_LABELS[p.attachment]) + ' attachment</span>' +
      '</div>';
    html += '<h3>How you describe yourself</h3>' + tags(p.descriptors);
    html += '</div>';

    html += '<div class="card"><h2>Background</h2><dl class="facts">' +
      fact('Country', p.background.country) +
      fact('Education', p.background.education) +
      fact('Religion', p.background.religion) +
      fact('Occupation', p.background.occupation) +
      '</dl>' +
      '<h3>Interests</h3>' + tags(p.interests.concat(p.notes.otherInterests ? [p.notes.otherInterests] : [])) +
      '<h3>Fitness</h3>' + tags(p.fitness.concat(p.notes.otherFitness ? [p.notes.otherFitness] : [])) +
      '</div>';

    html += '<div class="card"><h2>Values &amp; relationships</h2>' +
      '<h3>Life priorities</h3>' + tags(p.priorities) + noteBlock(p.notes.priorities) +
      '<h3>What you look for in a partner or friend</h3>' + tags(p.qualities) + noteBlock(p.notes.qualities) +
      '<h3>Ingredients of a good relationship</h3>' + tags(p.ingredients) + noteBlock(p.notes.ingredients) +
      '<h3>You express care through</h3>' + tags(p.loveGive) +
      '<h3>You feel cared for through</h3>' + tags(p.loveReceive) +
      '<h3>Dealbreakers</h3>' + tags(p.dealbreakers) + noteBlock(p.notes.dealbreakers) +
      '</div>';

    if (p.notes.personality || p.notes.relationship || p.notes.bigfive || p.notes.mbti || p.notes.enneagram) {
      html += '<div class="card"><h2>In your own words</h2><p class="fineprint">Stored on this device only — never encoded into your QR code.</p>' +
        noteBlock(p.notes.bigfive) + noteBlock(p.notes.mbti) + noteBlock(p.notes.enneagram) +
        noteBlock(p.notes.personality) + noteBlock(p.notes.relationship) + '</div>';
    }

    if (a) {
      html += '<div class="card"><h2>Your Instagram read</h2>' +
        '<p class="muted">Confidence ' + a.confidence + '/100 (' + esc(a.confidenceLabel) + ').</p>';
      for (const section of a.narrative) {
        html += '<h3>' + esc(section.title) + '</h3><p>' + esc(section.body) + '</p>';
      }
      html += '</div>';
    }

    const history = store.read(KEYS.history, []);
    if (history.length) {
      html += '<div class="card"><h2>Your matches</h2>' + historyTable(history) + '</div>';
    }

    $('#profile-body').innerHTML = html;
  }

  function fact(label, value) {
    if (!value) return '';
    return '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>';
  }

  function noteBlock(text) {
    return text ? '<blockquote class="note">' + esc(text) + '</blockquote>' : '';
  }

  function historyTable(history) {
    return '<div class="table-scroll"><table class="match-table"><thead><tr>' +
      '<th>With</th><th>Romantic</th><th>Platonic</th><th>When</th><th></th></tr></thead><tbody>' +
      history.map((entry, index) =>
        '<tr><td>' + esc(entry.report.b.name) + '</td>' +
        '<td>' + scorePill(entry.report.romantic.total) + '</td>' +
        '<td>' + scorePill(entry.report.platonic.total) + '</td>' +
        '<td class="muted">' + esc(new Date(entry.when).toLocaleDateString()) + '</td>' +
        '<td><a href="#" data-report="' + index + '">Open →</a></td></tr>').join('') +
      '</tbody></table></div>';
  }

  function scorePill(score) {
    const tier = score >= 80 ? 'a' : score >= 65 ? 'b' : score >= 50 ? 'c' : 'd';
    return '<span class="score-pill s-' + tier + '">' + score + '</span>';
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-report]');
    if (!link) return;
    event.preventDefault();
    const entry = store.read(KEYS.history, [])[Number(link.dataset.report)];
    if (entry) { renderReport(entry.report); show('report'); }
  });

  $('#copy-link').addEventListener('click', () => {
    const url = profileUrl(Codec.encodeProfile(state.profile));
    const button = $('#copy-link');
    const done = () => { button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = 'Copy my link'; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
    else window.prompt('Copy this link:', url);
  });

  $('#download-qr').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'kindred-' + (state.profile.name || 'me').toLowerCase().replace(/\W+/g, '-') + '.png';
    link.href = $('#qr-canvas').toDataURL('image/png');
    link.click();
  });

  $('#edit-answers').addEventListener('click', () => {
    state.stepIndex = 0;
    renderStep();
    show('questionnaire');
  });

  $('#delete-profile').addEventListener('click', () => {
    if (!window.confirm('Delete your profile, your Instagram analysis and all saved match reports from this browser?')) return;
    store.clearAll();
    state.analysis = null; state.answers = null; state.profile = null; state.name = '';
    show('welcome');
  });

  // ══════════════ 5. scanning ══════════════

  let cameraStream = null;
  let scanTimer = null;

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
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) {
      flash('#scan-alert', 'Camera access was refused. Camera scanning also needs HTTPS. You can paste their link instead.');
      return;
    }
    const video = $('#scan-video');
    video.srcObject = cameraStream;
    video.setAttribute('playsinline', 'true');
    await video.play();
    $('#camera-holder').hidden = false;
    $('#scan-status').textContent = 'Looking for a QR code…';
    tick();
  });

  function tick() {
    const video = $('#scan-video');
    const canvas = $('#scan-canvas');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (found && found.data) {
        stopCamera();
        if (!runMatch(found.data)) {
          flash('#scan-alert', 'That QR code is not a Kindred profile.');
          $('#scan-status').textContent = '';
        }
        return;
      }
    }
    scanTimer = requestAnimationFrame(tick);
  }

  $('#upload-qr').addEventListener('click', () => $('#qr-file').click());
  $('#qr-file').addEventListener('change', () => {
    const file = $('#qr-file').files[0];
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(data.data, data.width, data.height);
      URL.revokeObjectURL(image.src);
      if (!found || !runMatch(found.data)) flash('#scan-alert', 'No Kindred code found in that image.');
    };
    image.onerror = () => flash('#scan-alert', 'Could not read that image.');
    image.src = URL.createObjectURL(file);
  });

  $('#paste-go').addEventListener('click', () => {
    if (!runMatch($('#paste-input').value)) {
      flash('#scan-alert', 'That is not a Kindred profile code. Copy the whole link they sent you.');
    }
  });

  function runMatch(rawText) {
    const other = Codec.decodeProfile(Codec.extractPayload(rawText));
    if (!other || !state.profile) return false;
    const report = Compat.buildReport(state.profile, other);
    const history = store.read(KEYS.history, []);
    history.unshift({ when: new Date().toISOString(), report });
    store.write(KEYS.history, history.slice(0, 40));
    renderReport(report);
    show('report');
    return true;
  }

  // ══════════════ 6. report ══════════════

  let currentReport = null;

  function renderReport(report) {
    currentReport = report;
    let html = '<header class="page-head"><h1>' + esc(report.a.name) + ' &amp; ' + esc(report.b.name) + '</h1>' +
      '<p class="muted">Two readings of the same pair. They are scored separately because the things that ' +
      'make a good partner are not the things that make a good friend.</p></header>';

    html += '<div class="score-pair">' +
      scoreCard('Romantic', report.romantic) +
      scoreCard('Platonic', report.platonic) +
      '</div>';

    if (report.flags.hard.length) {
      html += '<div class="card alert-card"><h2>⚠️ Dealbreaker triggered</h2>' +
        list(report.flags.hard.map(f => f.holder + ' lists ' + Compat.lower(f.item) +
          ' as a dealbreaker, and ' + f.subject + ' has declared it as "' + Compat.lower(f.value) + '".')) + '</div>';
    }

    html += '<div class="tabs" role="tablist">' +
      '<button class="tab is-active" data-tab="romantic" role="tab">💞 Romantic</button>' +
      '<button class="tab" data-tab="platonic" role="tab">🤝 Platonic</button></div>';

    html += '<div id="tab-romantic" class="tab-panel">' + modeSection(report, report.romantic) + '</div>';
    html += '<div id="tab-platonic" class="tab-panel" hidden>' + modeSection(report, report.platonic) + '</div>';

    if (report.conversationStarters.length) {
      html += '<div class="card"><h2>Things to actually talk about</h2>' + list(report.conversationStarters) + '</div>';
    }

    if (report.flags.toDiscuss.length) {
      html += '<div class="card"><h2>What no profile can tell you</h2>' +
        '<p class="muted">Each of you named dealbreakers that cannot be checked from any data. They are not in either score.</p>' +
        '<dl class="facts">' + report.flags.toDiscuss.map(f =>
          '<dt>' + esc(f.item) + '</dt><dd>' + esc(f.note) + ' <span class="muted">(' + esc(f.holder) + '’s dealbreaker)</span></dd>').join('') +
        '</dl></div>';
    }

    html += '<p class="fineprint">Both profiles were built from Instagram activity plus self-reported answers. ' +
      'The weaker of the two Instagram confidence figures is ' + report.dataConfidence + '/100 — the lower that is, ' +
      'the more of this rests on what you each typed rather than what you each do. Treat every number here as a ' +
      'conversation starter, not a verdict.</p>';

    $('#report-body').innerHTML = html;

    for (const tab of $('#report-body').querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        for (const other of $('#report-body').querySelectorAll('.tab')) other.classList.remove('is-active');
        tab.classList.add('is-active');
        $('#tab-romantic').hidden = tab.dataset.tab !== 'romantic';
        $('#tab-platonic').hidden = tab.dataset.tab !== 'platonic';
      });
    }
  }

  function scoreCard(label, mode) {
    const tier = mode.total >= 80 ? 'a' : mode.total >= 65 ? 'b' : mode.total >= 50 ? 'c' : 'd';
    return '<div class="card score-card tier-' + tier + '">' +
      '<div class="ring" style="--pct:' + mode.total + '"><span>' + mode.total + '</span></div>' +
      '<h2>' + esc(label) + '</h2>' +
      '<p class="band">' + esc(mode.band) + '</p>' +
      '<p>' + esc(mode.verdict) + '</p></div>';
  }

  function modeSection(report, mode) {
    let html = '<div class="card"><h2>Where the score comes from</h2>';
    for (const dimension of mode.dimensions) {
      html += bar(dimension.label + ' · ' + Math.round(dimension.weight * 100) + '% of the score', dimension.score);
    }
    html += '</div>';

    if (mode.strengths.length) {
      html += '<div class="card good"><h2>What works</h2>' + list(mode.strengths) + '</div>';
    }
    if (mode.watchOuts.length) {
      html += '<div class="card warn"><h2>What to watch</h2>' + list(mode.watchOuts) + '</div>';
    }

    html += '<div class="card"><h2>How to ' + (mode.mode === 'romantic' ? 'partner' : 'befriend') + ' each other</h2>' +
      '<div class="playbook">' +
      '<div><h3>For ' + esc(report.a.name) + '</h3>' + list(mode.playbook.forA) + '</div>' +
      '<div><h3>For ' + esc(report.b.name) + '</h3>' + list(mode.playbook.forB) + '</div>' +
      '</div><h3>Both of you</h3>' + list(mode.playbook.shared) + '</div>';

    return html;
  }

  // ══════════════ 7. about ══════════════

  function renderAbout() {
    const meta = Compat.DIMENSION_META;
    $('#weights-body').innerHTML = Object.keys(meta).map(id =>
      '<tr><td>' + esc(meta[id].label) + '</td>' +
      '<td>' + Math.round(meta[id].romantic * 100) + '%</td>' +
      '<td>' + Math.round(meta[id].platonic * 100) + '%</td></tr>').join('');
  }

  // ══════════════ boot ══════════════

  function boot() {
    const incoming = Codec.extractPayload(location.hash);
    const hasIncoming = /^[#]p=/.test(location.hash) && incoming;

    if (hasIncoming) {
      history.replaceState(null, '', location.pathname + location.search);
      if (state.profile && runMatch(incoming)) return;
      // No profile yet — remember their code and pick it up after setup.
      sessionStorage.setItem('kindred2_pending', incoming);
      if (state.analysis) { state.stepIndex = 0; renderStep(); show('questionnaire'); return; }
      show('welcome');
      flash('#upload-error', 'Someone shared their Kindred code with you. Build your own profile and the report opens automatically.');
      return;
    }

    if (state.profile) { renderProfile(); show('profile'); return; }
    if (state.analysis) { renderAnalysis(); show('analysis'); return; }
    show('welcome');
  }

  boot();
})();
