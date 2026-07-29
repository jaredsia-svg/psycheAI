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

  const analyseProfile = (digest, images) => post('/api/analyse', { digest, images: images || [] });
  const analyseCompatibility = (a, b) => post('/api/compatibility', { a, b });

  root.PsycheLLM = { status, analyseProfile, analyseCompatibility };
})(typeof window !== 'undefined' ? window : globalThis);
