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

  // What a `fetch` rejection means, in words a reader can act on. Shared by
  // the ticket request and the POST it precedes, because a dropped connection
  // is a dropped connection whichever of the two was in flight when it went.
  function networkError(error) {
    if (error && error.name === 'AbortError') return new Error('The analysis took too long and was cancelled.');
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
      return new Error('Your device is offline. Reconnect and try again — your data is still loaded.');
    }
    return new Error('The connection dropped before the analysis came back. ' +
      'Try again — if it had already finished, you will get it straight away.');
  }

  /**
   * A single-use ticket for the next protected POST.
   *
   * One extra round trip per paid call, which is the price of the endpoints no
   * longer answering a blind `curl`. It is fetched immediately before the POST
   * rather than once at startup because it is spent on use and because a page
   * left open for an hour would otherwise hold an expired one — see
   * lib/nonce.js for the TTL and for what a ticket does and does not prove.
   */
  async function ticket() {
    let response;
    try {
      response = await fetch('/api/nonce', { cache: 'no-store' });
    } catch (error) {
      throw networkError(error);
    }
    if (!response.ok) {
      const refusal = await response.json().catch(() => null);
      // A 429 here is the rate limiter, and its message already says how long
      // to wait — passing it through beats replacing it with something vaguer.
      throw new Error((refusal && refusal.error) ||
        'The server would not issue a one-time token (HTTP ' + response.status + ').');
    }
    const payload = await response.json().catch(() => null);
    if (!payload || !payload.nonce) throw new Error('The server issued an unusable one-time token.');
    return payload.nonce;
  }

  /**
   * POST with a ticket, retrying once if the server does not recognise it.
   *
   * A refused ticket almost always means the server restarted: they are held
   * in memory and nothing is written down, so every deploy invalidates every
   * outstanding one. A reader who backgrounds their phone mid-analysis and
   * comes back after a deploy has done nothing wrong and has nothing to fix,
   * but used to be shown an error and asked to try again by hand.
   *
   * The retry is safe in a way most retries are not, and that is the whole
   * reason it is allowed: the ticket is checked in the request dispatcher,
   * *before* the handler runs. A `nonceRequired` refusal therefore proves no
   * work was started, no model was called, no payment use was ledgered and no
   * budget was spent — the request was turned away at the door. Retrying it
   * cannot duplicate anything, because nothing happened.
   *
   * Once only, and only for this one refusal. Anything else — a rate limit, a
   * failed payment, a provider outage — is a real answer and goes to the
   * reader as it is.
   */
  async function post(path, body) {
    const first = await postOnce(path, body);
    if (!first.nonceRefused && !first.truncated) return first.payload;
    const second = await postOnce(path, body);
    if (!second.nonceRefused && !second.truncated) return second.payload;
    // Twice in a row is not a restart and not a coincidence of timing, so this
    // stops rather than looping. Which message depends on which failure came
    // back second, because they need different things from the reader: one is
    // a page to reload, the other is a connection to be on.
    if (second.nonceRefused) {
      throw new Error('This request is missing a valid one-time token. Reload the page and try again.');
    }
    throw new Error('The connection dropped before the analysis came back. ' +
      'Try again — if it had already finished, you will get it straight away.');
  }

  async function postOnce(path, body) {
    // Outside the try below, so that a refusal to issue a ticket — a rate
    // limit, most likely — reaches the reader as itself rather than being
    // rewritten into "the connection dropped".
    const nonce = await ticket();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PsycheAI-Nonce': nonce },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw networkError(error);
    }
    clearTimeout(timer);

    // Read as text and parsed here rather than with response.json(), so that
    // a body which never finished arriving can be told apart from one that
    // arrived and was rubbish. Those are different failures with different
    // advice, and response.json() collapses them into one.
    let raw = '';
    try {
      raw = await response.text();
    } catch (error) {
      // The stream died while being read: same thing as the truncation below.
      throw networkError(error);
    }

    let payload = null;
    let truncated = false;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      // Nothing but whitespace is the signature of a cut stream, not of a
      // broken server.
      //
      // A generating request commits its 200 before the work starts and then
      // writes a space every fifteen seconds to hold the connection open (see
      // sendJsonWhileWorking). A reader whose phone screen turns off, whose
      // radio drops, or whose carrier times out an idle-looking socket is left
      // holding exactly that: a 200 and a run of spaces, with the report that
      // was supposed to follow never sent. Parsing it produced "the server
      // sent back something that was not JSON", which blamed the server for a
      // connection that dropped — and did it at the one moment the reader is
      // most anxious, having just paid.
      //
      // Anything with real content in it is a different animal: an HTML error
      // page from a proxy, a truncated body with half a report in it. That
      // keeps the original message, because it really does mean something
      // served something wrong.
      if (raw.trim() === '') truncated = true;
      else throw new Error('The server sent back something that was not JSON (HTTP ' + response.status + ').');
    }
    // Handed back for post() to retry once, the same way a refused ticket is.
    // The work is very probably finished and sitting in the server's result
    // cache, so the retry usually returns it immediately and costs nothing —
    // and where it does not, it costs exactly what the reader pressing "try
    // again" would have cost anyway.
    if (truncated) return { truncated: true, payload: null };
    if (!response.ok) {
      // Reported rather than thrown, so post() above can decide whether this
      // is the one refusal worth a second attempt. Every other status still
      // throws from here.
      if (response.status === 400 && payload && payload.nonceRequired) {
        return { nonceRefused: true, truncated: false, payload: null };
      }
      throw new Error((payload && payload.error) || 'Server error (HTTP ' + response.status + ').');
    }
    // An `error` field on an otherwise-fine response is a real failure. A
    // generating request commits its 200 before the work starts — it has to,
    // because it is writing keep-alive whitespace down the socket while the
    // model runs — so a failure part-way through can only be reported in the
    // body. See sendJsonWhileWorking in server.js.
    if (payload && payload.error) throw new Error(payload.error);
    return { nonceRefused: false, truncated: false, payload };
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
  // `auth` takes the same shape as the other two paid calls — `{ paymentIntentId }`
  // or `{ promoCode }`. A compatibility read is a purchase now rather than a
  // free draw on the daily ceiling, so the server refuses this without one.
  const analyseCompatibility = (a, b, mode, stance, auth) =>
    post('/api/compatibility', Object.assign({ a, b, mode, stance }, auth || {}));
  // digest is resent rather than referenced — the server keeps no copy of it
  // between calls, so this is the same digest the browser already holds
  // (from psycheai_digest) travelling again, not a second upload of anything
  // new. `auth` is one of `{ paymentIntentId }` or `{ promoCode }` — the two
  // ways server.js's handlePremiumAnalysis will accept unlocking this call.
  const analysePremium = (digest, auth) => post('/api/premium-analysis', Object.assign({ digest }, auth));

  root.PsycheLLM = {
    status, ticket, analyseProfile, analyseCompatibility, analysePremium,
    // Exported so the payment-intent call in app.js goes through the same
    // ticket handling as everything else. It was fetching a ticket by hand and
    // posting it directly, which meant it was the one protected route with no
    // retry behind it — so a ticket the server did not recognise surfaced as
    // "reload the page" instead of being quietly asked for again.
    postWithTicket: post,
  };
})(typeof window !== 'undefined' ? window : globalThis);
