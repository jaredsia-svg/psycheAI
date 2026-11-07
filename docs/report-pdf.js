// A Muse read's PDF, unlocked in the browser (docs/report-pdf.html). The link
// is /report-pdf?m=<id>#<key>: the key never leaves this page, the server
// sends only the locked copy (/api/import/pdf?raw=1), and AES-GCM opens it
// here, as consumeMuseRead does for the read itself.
(function () {
  'use strict';
  const status = document.getElementById('pdf-status');
  const button = document.getElementById('pdf-open');
  const id = new URLSearchParams(location.search).get('m') || '';
  const key = location.hash.replace(/^#/, '');
  // The key leaves the address bar at once, so it is not in history or a screenshot.
  history.replaceState(null, '', location.pathname + location.search);
  const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
  const fail = text => { status.textContent = text; };
  if (!/^[A-Za-z0-9_-]{16}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    fail('This link is incomplete. Open it again from your Muse chat, the whole link, including the part after the #.');
    return;
  }
  fetch('/api/import/pdf?raw=1&id=' + encodeURIComponent(id), { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then(sealed => crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['decrypt'])
      .then(k => crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(sealed.iv) }, k, bytes(sealed.box))))
    .then(plain => {
      const url = URL.createObjectURL(new Blob([plain], { type: 'application/pdf' }));
      button.href = url;
      button.download = 'Psyche Report.pdf';
      button.hidden = false;
      status.textContent = 'Your report is open. To keep a copy, save it.';
      location.href = url;
    })
    .catch(err => fail(/404/.test(String(err && err.message)) ? 'This report has expired. Ask Muse for a new one.' : 'This report could not be opened. Open the link again from your Muse chat.'));
})();
