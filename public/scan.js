// Camera-based QR scanning using jsQR. On a successful decode we drop the
// code into the manual form and submit it, so both paths share one flow.
(function () {
  const video = document.getElementById('scan-video');
  const canvas = document.getElementById('scan-canvas');
  const startBtn = document.getElementById('start-scan');
  const status = document.getElementById('scan-status');
  const form = document.getElementById('scan-form');
  const input = document.getElementById('code-input');
  if (!video || !startBtn) return;

  let stream = null;
  let scanning = false;

  startBtn.addEventListener('click', async () => {
    if (scanning) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      status.textContent = 'Camera unavailable (' + err.name + '). Use the code entry instead.';
      return;
    }
    video.srcObject = stream;
    await video.play();
    scanning = true;
    startBtn.textContent = 'Scanning…';
    startBtn.disabled = true;
    status.textContent = 'Looking for a QR code…';
    requestAnimationFrame(tick);
  });

  function stop() {
    scanning = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
  }

  function tick() {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (result && result.data) {
        // Accept either the raw KIN- code or the full profile URL.
        const m = result.data.match(/[?&]code=([^&\s]+)/);
        input.value = m ? decodeURIComponent(m[1]) : result.data;
        status.textContent = 'Code found! Testing compatibility…';
        stop();
        form.submit();
        return;
      }
    }
    requestAnimationFrame(tick);
  }

  window.addEventListener('pagehide', stop);
})();
