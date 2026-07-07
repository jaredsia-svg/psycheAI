// Kindred SPA logic: view routing, profile form, QR generation, camera
// scanning, and report rendering. All state lives in localStorage.
(function () {
  'use strict';
  const K = window.Kindred;
  const $ = sel => document.querySelector(sel);

  const store = {
    get profile() { try { return JSON.parse(localStorage.getItem('kindred_profile')); } catch (e) { return null; } },
    set profile(p) { localStorage.setItem('kindred_profile', JSON.stringify(p)); },
    get history() { try { return JSON.parse(localStorage.getItem('kindred_history')) || []; } catch (e) { return []; } },
    addReport(report) {
      const h = store.history;
      h.unshift({ when: new Date().toISOString(), report });
      localStorage.setItem('kindred_history', JSON.stringify(h.slice(0, 50)));
    },
  };

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ---------- view routing ----------

  const views = ['welcome', 'pending', 'edit', 'dashboard', 'scan', 'report'];
  function show(view) {
    stopCamera();
    views.forEach(v => { $('#view-' + v).hidden = v !== view; });
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    e.preventDefault();
    const target = nav.dataset.nav;
    if (target === 'home' || target === 'dashboard') {
      if (store.profile) { renderDashboard(); show('dashboard'); } else show('welcome');
    } else if (target === 'edit') { renderForm(); show('edit'); }
    else if (target === 'scan') {
      if (!store.profile) { renderForm(); show('edit'); } else renderScan();
    }
  });

  // ---------- profile form ----------

  function likertFieldset(id, text, checked, lowLabel, highLabel) {
    let opts = '';
    for (const v of K.LIKERT) {
      opts += '<label class="likert-opt"><input type="radio" name="' + id + '" value="' + v + '" required' +
        (String(checked) === String(v) ? ' checked' : '') + '><span>' + v + '</span></label>';
    }
    return '<fieldset class="likert"><legend>' + esc(text) + '</legend>' +
      '<div class="likert-opts">' + opts + '</div>' +
      '<div class="likert-ends"><span>' + lowLabel + '</span><span>' + highLabel + '</span></div></fieldset>';
  }

  function renderForm() {
    const p = store.profile || {};
    const ans = p.answers || {};
    const lls = ans.love_languages || [];
    const interests = p.interests || [];
    $('#edit-title').textContent = store.profile ? 'Edit your profile' : 'Build your compatibility profile';

    let html = '<div class="card"><h2>1 · About you</h2>' +
      '<label>Your first name <input name="name" required maxlength="40" value="' + esc(p.name || '') + '" placeholder="Alex"></label>' +
      '</div>';

    html += '<div class="card"><h2>2 · Your online presence</h2>' +
      '<p class="muted">Paste any public text you\'ve written about yourself — Instagram bio, LinkedIn ' +
      '"about" section, favourite posts. Kindred mines it for interests and personality signals. ' +
      'It never leaves your browser.</p>' +
      '<label>Bios / posts / about sections <textarea name="social_text" rows="6" maxlength="20000">' + esc(p.socialText || '') + '</textarea></label></div>';

    html += '<div class="card"><h2>3 · Personality</h2><p class="muted">How much do you agree with each statement?</p>';
    for (const item of K.BIG_FIVE_ITEMS.concat(K.ATTACHMENT_ITEMS)) {
      html += likertFieldset(item.id, item.text, ans[item.id], 'Strongly disagree', 'Strongly agree');
    }
    html += '</div>';

    html += '<div class="card"><h2>4 · What matters to you</h2><p class="muted">How important is each of these in your life?</p>';
    for (const v of K.VALUES) {
      html += likertFieldset('val_' + v.id, v.label, ans['val_' + v.id], 'Not important', 'Essential');
    }
    html += '</div>';

    html += '<div class="card"><h2>5 · How you feel loved</h2><p class="muted">Pick your top two love languages.</p><div class="check-grid" id="love-langs">';
    for (const l of K.LOVE_LANGUAGES) {
      html += '<label class="check-tag"><input type="checkbox" name="love_languages" value="' + l.id + '"' +
        (lls.includes(l.id) ? ' checked' : '') + '><span>' + l.label + '</span></label>';
    }
    html += '</div></div>';

    html += '<div class="card"><h2>6 · Lifestyle</h2>';
    for (const q of K.LIFESTYLE) {
      html += '<fieldset class="likert"><legend>' + q.text + '</legend><div class="choice-row">';
      for (const opt of q.options) {
        html += '<label class="check-tag"><input type="radio" name="' + q.id + '" value="' + opt.value + '" required' +
          (ans[q.id] === opt.value ? ' checked' : '') + '><span>' + opt.label + '</span></label>';
      }
      html += '</div></fieldset>';
    }
    html += '</div>';

    html += '<div class="card"><h2>7 · Your interests</h2><p class="muted">Pick everything that\'s genuinely you. (We\'ll also add interests detected in your pasted text.)</p><div class="check-grid">';
    for (const t of K.INTEREST_TAGS) {
      html += '<label class="check-tag"><input type="checkbox" name="interests" value="' + t + '"' +
        (interests.includes(t) ? ' checked' : '') + '><span>' + t + '</span></label>';
    }
    html += '</div></div>';

    html += '<button class="btn btn-lg" type="submit">Save my profile</button>';
    $('#profile-form').innerHTML = html;

    const ll = $('#love-langs');
    ll.addEventListener('change', () => {
      const checked = ll.querySelectorAll('input:checked');
      ll.querySelectorAll('input:not(:checked)').forEach(i => { i.disabled = checked.length >= 2; });
    });
    ll.dispatchEvent(new Event('change'));
  }

  $('#profile-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answers = {};
    for (const item of K.BIG_FIVE_ITEMS.concat(K.ATTACHMENT_ITEMS)) answers[item.id] = fd.get(item.id);
    for (const v of K.VALUES) answers['val_' + v.id] = fd.get('val_' + v.id);
    for (const q of K.LIFESTYLE) answers[q.id] = fd.get(q.id);
    answers.love_languages = fd.getAll('love_languages').slice(0, 2);

    const socialText = String(fd.get('social_text') || '');
    const analysis = K.analyzeSocialText(socialText);
    const traits = K.blendTraits(K.scoreAnswers(answers), analysis);
    const chosen = fd.getAll('interests').filter(t => K.INTEREST_TAGS.includes(t));
    const interests = Array.from(new Set(chosen.concat(analysis.interests)));

    store.profile = {
      name: String(fd.get('name') || '').trim().slice(0, 40) || 'Me',
      answers, socialText, traits, interests,
      updated: new Date().toISOString(),
    };

    // If they arrived via someone's QR link, go straight to the report.
    const pending = sessionStorage.getItem('kindred_pending');
    if (pending) {
      sessionStorage.removeItem('kindred_pending');
      if (runMatch(pending)) return;
    }
    renderDashboard();
    show('dashboard');
  });

  // ---------- dashboard ----------

  function profileUrl(payload) {
    return location.origin + location.pathname + '#p=' + payload;
  }

  function renderDashboard() {
    const p = store.profile;
    if (!p) return;
    $('#dash-greeting').textContent = 'Hi, ' + p.name + ' 👋';

    const payload = K.encodeProfile(p);
    QRCode.toCanvas($('#qr-canvas'), profileUrl(payload), {
      width: 260, margin: 2, color: { dark: '#3b2050', light: '#ffffff' },
    });

    const bf = p.traits.bigFive;
    const rows = [['openness', 'Openness'], ['conscientiousness', 'Conscientiousness'],
      ['extraversion', 'Extraversion'], ['agreeableness', 'Agreeableness'], ['neuroticism', 'Emotional sensitivity']];
    let html = '<div class="trait-bars">';
    for (const r of rows) {
      html += '<div class="trait-row"><span class="trait-label">' + r[1] + '</span>' +
        '<div class="bar"><div class="bar-fill" style="width:' + (bf[r[0]] || 0) + '%"></div></div>' +
        '<span class="trait-num">' + (bf[r[0]] || 0) + '</span></div>';
    }
    html += '</div><p><strong>Attachment style:</strong> <span class="pill">' + p.traits.attachment.style + '</span></p>';
    if (p.interests.length) {
      html += '<p class="tag-row">' + p.interests.slice(0, 12).map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>';
    }
    $('#dash-traits').innerHTML = html;

    const h = store.history;
    $('#dash-history').innerHTML = !h.length
      ? '<p class="muted">No matches yet. Scan someone\'s QR code to get your first compatibility report.</p>'
      : '<table class="match-table"><thead><tr><th>With</th><th>Score</th><th>When</th><th></th></tr></thead><tbody>' +
        h.map((m, i) => {
          const other = m.report.attachmentStyles.find(x => x.name !== p.name);
          return '<tr><td>' + esc(other ? other.name : '?') + '</td>' +
            '<td><span class="score-pill s' + Math.floor(m.report.total / 20) + '">' + m.report.total + '</span></td>' +
            '<td class="muted">' + new Date(m.when).toLocaleString() + '</td>' +
            '<td><a href="#" data-report="' + i + '">View report →</a></td></tr>';
        }).join('') + '</tbody></table>';
  }

  $('#dash-history').addEventListener('click', e => {
    const a = e.target.closest('[data-report]');
    if (!a) return;
    e.preventDefault();
    const m = store.history[Number(a.dataset.report)];
    if (m) { renderReport(m.report); show('report'); }
  });

  $('#copy-link').addEventListener('click', () => {
    const url = profileUrl(K.encodeProfile(store.profile));
    navigator.clipboard.writeText(url).then(
      () => { $('#copy-link').textContent = 'Copied! ✓'; setTimeout(() => { $('#copy-link').textContent = 'Copy my profile link'; }, 2000); },
      () => { prompt('Copy this link:', url); }
    );
  });

  // ---------- scanning & matching ----------

  function extractPayload(text) {
    const s = String(text || '').trim();
    const m = s.match(/#p=([A-Za-z0-9_-]+)/);
    return m ? m[1] : s.replace(/\s+/g, '');
  }

  function runMatch(rawTextOrPayload) {
    const me = store.profile;
    const other = K.decodeProfile(extractPayload(rawTextOrPayload));
    if (!other) return false;
    const report = K.buildReport(me.name, other.name, me.traits, other.traits, me.interests, other.interests);
    store.addReport(report);
    renderReport(report);
    show('report');
    return true;
  }

  function renderScan() {
    $('#scan-alert').innerHTML = '';
    $('#paste-input').value = '';
    $('#scan-status').textContent = '';
    const btn = $('#start-scan');
    btn.disabled = false;
    btn.textContent = 'Start camera';
    show('scan');
  }

  $('#paste-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!runMatch($('#paste-input').value)) {
      $('#scan-alert').innerHTML = '<div class="alert">That doesn\'t look like a valid Kindred code or link. Ask them to copy the link from their dashboard.</div>';
    }
  });

  let stream = null, scanning = false;

  function stopCamera() {
    scanning = false;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  $('#start-scan').addEventListener('click', async () => {
    if (scanning) return;
    const status = $('#scan-status');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      status.textContent = 'Camera unavailable (' + err.name + '). Use the paste box instead.';
      return;
    }
    const video = $('#scan-video');
    video.srcObject = stream;
    await video.play();
    scanning = true;
    $('#start-scan').disabled = true;
    $('#start-scan').textContent = 'Scanning…';
    status.textContent = 'Looking for a QR code…';

    const canvas = $('#scan-canvas');
    (function tick() {
      if (!scanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (result && result.data) {
          stopCamera();
          if (!runMatch(result.data)) {
            $('#scan-alert').innerHTML = '<div class="alert">That QR code isn\'t a Kindred profile.</div>';
            $('#start-scan').disabled = false;
            $('#start-scan').textContent = 'Start camera';
          }
          return;
        }
      }
      requestAnimationFrame(tick);
    })();
  });

  // ---------- report rendering ----------

  function renderReport(r) {
    const names = r.attachmentStyles;
    let html = '<div class="match-hero card"><p class="muted">Compatibility report</p>' +
      '<h1>' + esc(names[0].name) + ' <span class="accent">×</span> ' + esc(names[1].name) + '</h1>' +
      '<div class="score-ring" style="--pct:' + r.total + '"><div class="score-inner">' +
      '<span class="score-big">' + r.total + '</span><span class="score-sub">/ 100</span></div></div>' +
      '<p class="band">' + r.band.emoji + ' <strong>' + r.band.label + '</strong></p>' +
      '<p class="summary">' + esc(r.summary) + '</p></div>';

    html += '<div class="card"><h2>Where the score comes from</h2><div class="trait-bars">';
    for (const d of r.dimensions) {
      html += '<div class="trait-row"><span class="trait-label">' + d.label + ' <span class="muted">(' + d.weight + '%)</span></span>' +
        '<div class="bar"><div class="bar-fill" style="width:' + d.score + '%"></div></div>' +
        '<span class="trait-num">' + d.score + '</span></div>';
    }
    html += '</div><p class="muted">Attachment styles: ' +
      names.map(x => '<span class="pill">' + esc(x.name) + ': ' + x.style + '</span>').join(' ') + '</p>';
    if (r.sharedInterests.length) {
      html += '<p class="tag-row">Shared interests: ' + r.sharedInterests.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>';
    }
    html += '</div>';

    html += '<div class="grid-2">';
    if (r.strengths.length) {
      html += '<div class="card good"><h2>💪 Your strengths as a pair</h2><ul class="report-list">' +
        r.strengths.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul></div>';
    }
    if (r.watchouts.length) {
      html += '<div class="card warn"><h2>⚠️ Watch out for</h2><ul class="report-list">' +
        r.watchouts.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>';
    }
    html += '</div>';

    html += '<div class="card advice"><h2>🧭 How to be great together</h2><ul class="report-list">' +
      r.advice.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></div>';

    $('#report-root').innerHTML = html;
  }

  // ---------- boot ----------

  function boot() {
    const m = location.hash.match(/#p=([A-Za-z0-9_-]+)/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      const other = K.decodeProfile(m[1]);
      if (other) {
        if (store.profile) { runMatch(m[1]); return; }
        sessionStorage.setItem('kindred_pending', m[1]);
        $('#pending-name').textContent = other.name;
        show('pending');
        return;
      }
    }
    if (store.profile) { renderDashboard(); show('dashboard'); }
    else show('welcome');
  }

  boot();
})();
