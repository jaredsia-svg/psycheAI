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
  const analyseCompatibility = (a, b, mode, stance) => post('/api/compatibility', { a, b, mode, stance });

  /**
   * The paid pass, which arrives as a stream rather than one response: the
   * server runs its three section groups concurrently and writes each one out
   * as it lands (newline-delimited JSON — see streamPremiumGroups in
   * server.js). `onSection(key, data, model)` fires per group, so the page can
   * show the wellness read while the roast is still being written.
   *
   * digest is resent rather than referenced — the server keeps no copy of it
   * between calls, so this is the same digest the browser already holds (from
   * psycheai_digest) travelling again, not a second upload of anything new.
   * `auth` is one of `{ paymentIntentId }` or `{ promoCode }`.
   *
   * Resolves with everything that arrived, merged, plus whichever groups
   * failed. A partly-failed pass still resolves rather than rejecting: three
   * sections and a named gap is worth more to somebody who has already paid
   * than an exception that discards the three. Only a pass that delivered
   * *nothing* rejects.
   */
  async function analysePremium(digest, auth, onSection) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch('/api/premium-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ digest }, auth)),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error && error.name === 'AbortError') throw new Error('The analysis took too long and was cancelled.');
      throw new Error('Could not reach the PsycheAI server. Is it running?');
    }

    // Every refusal the server can still make — a bad promo code, an unverified
    // payment, a spent ledger — arrives as an ordinary JSON error response,
    // because it happens before the stream starts. Only a 200 is a stream.
    if (!response.ok) {
      clearTimeout(timer);
      const payload = await response.json().catch(() => null);
      throw new Error((payload && payload.error) || 'Server error (HTTP ' + response.status + ').');
    }

    const data = {};
    const failures = [];
    let model = '';
    try {
      await readNdjson(response, event => {
        if (event.type === 'section') {
          Object.assign(data, event.data);
          model = event.model || model;
          if (onSection) onSection(event.key, event.data, event.model);
        } else if (event.type === 'error') {
          failures.push(event);
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if (!Object.keys(data).length) {
      throw new Error(failures.length
        ? failures[0].message
        : 'The analysis came back empty. Nothing was generated.');
    }
    return { data, model, failures };
  }

  /**
   * Reads a newline-delimited JSON body, calling `onEvent` per complete line.
   *
   * Buffered rather than parsed per chunk because a chunk boundary lands
   * wherever the network puts it, routinely mid-object — a naive
   * `chunk.split('\n')` works locally, where responses arrive whole, and
   * corrupts under exactly the slow real-world conditions this stream exists
   * for.
   */
  async function readNdjson(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n');
      while (cut >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line) onEvent(JSON.parse(line));
        cut = buffer.indexOf('\n');
      }
    }
    const last = buffer.trim();
    if (last) onEvent(JSON.parse(last));
  }

  root.PsycheLLM = { status, analyseProfile, analyseCompatibility, analysePremium };
})(typeof window !== 'undefined' ? window : globalThis);
