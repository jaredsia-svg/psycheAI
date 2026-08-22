// Browser client for the two server endpoints that call the model provider.
//
// The server does the model call because an API key cannot ship in a static
// page. What crosses this boundary is the evidence digest (bounded, sampled)
// and the shareable cards — never the archive itself.
(function (root) {
  'use strict';

  // A long report with thinking enabled is a slow call by design, on either
  // provider; the UI shows elapsed time rather than pretending otherwise.
  const TIMEOUT_MS = 10 * 60 * 1000;

  async function post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error && error.name === 'AbortError') throw new Error('The analysis took too long and was cancelled.');
      throw new Error('Could not reach the PsycheAI server. Is it running?');
    }
    clearTimeout(timer);

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('The server sent back something that was not JSON (HTTP ' + response.status + ').');
    }
    if (!response.ok) {
      throw new Error((payload && payload.error) || 'Server error (HTTP ' + response.status + ').');
    }
    return payload;
  }

  /** Whether the server has credentials, and which model it will use. */
  async function status() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) return { ready: false, mock: false, model: null };
      return await response.json();
    } catch (error) {
      return { ready: false, mock: false, model: null, unreachable: true };
    }
  }

  // `auth` is optional and takes the same shape as analysePremium's below —
  // `{ paymentIntentId }` or `{ promoCode }`. Absent, this is the free run
  // every reader gets; present, it is a purchased re-run that the server
  // verifies and that does not draw on the daily free ceiling.
  const analyseProfile = (digest, images, auth) =>
    post('/api/analyse', Object.assign({ digest, images: images || [] }, auth || {}));
  const analyseCompatibility = (a, b, mode, stance) => post('/api/compatibility', { a, b, mode, stance });
  // digest is resent rather than referenced — the server keeps no copy of it
  // between calls, so this is the same digest the browser already holds
  // (from psycheai_digest) travelling again, not a second upload of anything
  // new. `auth` is one of `{ paymentIntentId }` or `{ promoCode }` — the two
  // ways server.js's handlePremiumAnalysis will accept unlocking this call.
  const analysePremium = (digest, auth) => post('/api/premium-analysis', Object.assign({ digest }, auth));

  root.PsycheLLM = { status, analyseProfile, analyseCompatibility, analysePremium };
})(typeof window !== 'undefined' ? window : globalThis);
