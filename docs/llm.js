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
      // This branch used to say "Could not reach the PsycheAI server. Is it
      // running?" for every failure that reached it, which sent readers — and
      // whoever they reported it to — looking at a server that was almost
      // always up and mid-sentence. `fetch` rejects here for the connection
      // dying just as much as for nobody answering: a backgrounded phone
      // discarding the page, a wifi-to-cellular handover, a proxy cutting a
      // connection it thought was idle, a deploy restarting the process.
      //
      // The distinction a reader can act on is whether *they* are offline, so
      // that is the one drawn. Everything else says the connection dropped,
      // which is both true and the thing that suggests trying again — and adds
      // that the work may already be done, because a retry inside the result
      // cache's window returns the finished report for free.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Your device is offline. Reconnect and try again — your data is still loaded.');
      }
      throw new Error('The connection dropped before the analysis came back. ' +
        'Try again — if it had already finished, you will get it straight away.');
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
    // An `error` field on an otherwise-fine response is a real failure. A
    // generating request commits its 200 before the work starts — it has to,
    // because it is writing keep-alive whitespace down the socket while the
    // model runs — so a failure part-way through can only be reported in the
    // body. See sendJsonWhileWorking in server.js.
    if (payload && payload.error) throw new Error(payload.error);
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
  const analyseProfile = (digest, auth) =>
    post('/api/analyse', Object.assign({ digest }, auth || {}));
  const analyseCompatibility = (a, b, mode, stance) => post('/api/compatibility', { a, b, mode, stance });
  // digest is resent rather than referenced — the server keeps no copy of it
  // between calls, so this is the same digest the browser already holds
  // (from psycheai_digest) travelling again, not a second upload of anything
  // new. `auth` is one of `{ paymentIntentId }` or `{ promoCode }` — the two
  // ways server.js's handlePremiumAnalysis will accept unlocking this call.
  const analysePremium = (digest, auth) => post('/api/premium-analysis', Object.assign({ digest }, auth));

  root.PsycheLLM = { status, analyseProfile, analyseCompatibility, analysePremium };
})(typeof window !== 'undefined' ? window : globalThis);
