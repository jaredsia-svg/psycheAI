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

  // How long to wait before retrying a connection that died. Long enough for a
  // network handover or a woken radio to settle, short enough that a reader
  // watching an elapsed timer does not notice it happened.
  const RETRY_PAUSE_MS = 1200;

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
   * Whether a failed `fetch` is worth one silent second attempt.
   *
   * A dropped connection is the commonest failure this client sees and, until
   * this existed, the only one with no retry behind it: a refused ticket got
   * one, a cut stream got one, and the case that actually happens — a phone
   * backgrounded, a wifi-to-cellular handover, a proxy closing a socket that
   * looks idle — put the whole thing in front of the reader and asked them to
   * press a button. The advice was sound, which is the tell: anything whose
   * remedy is "do exactly that again" belongs in the code rather than in a
   * message.
   *
   * Two failures are excluded because retrying them is not free. A timeout has
   * already spent ten minutes, and a second one would spend ten more before
   * saying the same thing. Being offline is a fact about the device, not about
   * the connection, and the reader needs to hear it rather than watch another
   * attempt fail.
   */
  function worthRetrying(error) {
    if (error && error.name === 'AbortError') return false;
    return !(typeof navigator !== 'undefined' && navigator.onLine === false);
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
   *
   * `opts.retryOnDrop` extends the same treatment to a connection that died
   * outright, which is safe for a different reason: those routes are keyed on
   * the digest, so lib/results.js hands the retry either the finished report
   * or the generation still running for it. It is off by default and stays off
   * for /api/create-payment-intent, which is the one route here that is not
   * idempotent — a retry there could leave a second PaymentIntent behind.
   */
  async function post(path, body, opts) {
    const retryOnDrop = Boolean(opts && opts.retryOnDrop);
    // `dropped` is only ever reported when this call asked for it; otherwise
    // postOnce throws on a dead connection exactly as it always did.
    const again = outcome => outcome.nonceRefused || outcome.truncated || outcome.dropped;
    const first = await postOnce(path, body, retryOnDrop);
    if (!again(first)) return first.payload;
    // A pause before the second attempt, but only after a dropped connection.
    // The other two failures leave the transport working — the server refused
    // a ticket, or cut a body — and waiting would only add delay. A drop is
    // the transport itself going away, and retrying in the same instant asks
    // the same dead radio, mid-handover, to do the thing it just failed at.
    if (first.dropped) await new Promise(resolve => setTimeout(resolve, RETRY_PAUSE_MS));
    const second = await postOnce(path, body, retryOnDrop);
    if (!again(second)) return second.payload;
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

  async function postOnce(path, body, retryOnDrop) {
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
      if (retryOnDrop && worthRetrying(error)) return { dropped: true, payload: null };
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
      if (retryOnDrop && worthRetrying(error)) return { dropped: true, payload: null };
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
    if (truncated) return { truncated: true, dropped: false, payload: null };
    if (!response.ok) {
      // Reported rather than thrown, so post() above can decide whether this
      // is the one refusal worth a second attempt. Every other status still
      // throws from here.
      if (response.status === 400 && payload && payload.nonceRequired) {
        return { nonceRefused: true, truncated: false, dropped: false, payload: null };
      }
      throw new Error((payload && payload.error) || 'Server error (HTTP ' + response.status + ').');
    }
    // An `error` field on an otherwise-fine response is a real failure. A
    // generating request commits its 200 before the work starts — it has to,
    // because it is writing keep-alive whitespace down the socket while the
    // model runs — so a failure part-way through can only be reported in the
    // body. See sendJsonWhileWorking in server.js.
    if (payload && payload.error) throw new Error(payload.error);
    return { nonceRefused: false, truncated: false, dropped: false, payload };
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
  // ---------- background jobs ----------
  //
  // An analysis takes minutes, and until this existed the browser had to hold
  // one connection open for all of them. Every recovery mechanism in this file
  // — the drop retry, the cut-stream retry, the result cache behind them —
  // exists to survive that connection dying, which is to say: to recover from
  // a design where a phone being a phone was a failure.
  //
  // So the connection stops being load-bearing. The POST starts the work and
  // comes back at once with a key; the report is collected by asking for it.
  // A poll that fails is just a poll that fails — the next one is a few
  // seconds away, the work is still running on the server whether or not
  // anybody is watching, and a screen that went dark for ten minutes rejoins
  // exactly where it left off instead of arriving to an error.
  //
  // The server still answers the old way when asked to, and this still reads
  // that answer, because during a rollout an already-loaded page and a
  // freshly-deployed server are the same reader mid-analysis.

  // Fast enough that a report which lands early is not left sitting, slow
  // enough that a three-minute job is tens of requests rather than hundreds.
  // Widened after the first half-minute because that is when the odds of it
  // being finished stop being negligible and the cost of asking starts to
  // accumulate.
  const POLL_FAST_MS = 2500;
  const POLL_SLOW_MS = 6000;
  const POLL_WIDENS_AFTER_MS = 30 * 1000;

  // A poll that cannot reach the server is not a failure — it is the exact
  // condition this whole design exists to sit through. Only a run of them
  // long enough to mean something other than "the phone is asleep" gives up,
  // and while asleep no polls happen at all, so this counts real attempts
  // against a real network rather than elapsed time.
  const POLL_FAILURES_TOLERATED = 8;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ask what has become of a job. Returns the server's state object, or null
   * when the question could not be put at all.
   *
   * Null rather than a throw, because "could not ask" and "asked, and the news
   * is bad" need different handling here and a throw would flatten them.
   */
  async function pollOnce(job) {
    try {
      const response = await fetch('/api/result?job=' + encodeURIComponent(job), { cache: 'no-store' });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Wait for a job, however long the reader takes to come back to it.
   *
   * `restart` is called if the server turns out never to have heard of the
   * job — it restarted, or the result aged out of its cache. That is not an
   * error the reader can act on, so the work is simply started again rather
   * than reported.
   */
  async function collect(job, restart) {
    const startedAt = Date.now();
    const deadline = startedAt + TIMEOUT_MS;
    let failures = 0;
    let restarted = false;

    for (;;) {
      await sleep(Date.now() - startedAt < POLL_WIDENS_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS);
      const state = await pollOnce(job);

      if (!state) {
        failures += 1;
        if (failures > POLL_FAILURES_TOLERATED) {
          throw new Error('The connection dropped before the analysis came back. ' +
            'Try again — if it had already finished, you will get it straight away.');
        }
        continue;
      }
      // One reachable answer resets the count: the run that matters is a
      // consecutive one, and a single dropped poll in the middle of a healthy
      // sequence says nothing.
      failures = 0;

      if (state.status === 'done') return state;
      if (state.status === 'failed') throw new Error(state.error || 'The analysis failed.');
      if (state.status === 'unknown') {
        // Once only. A second disappearance is a server that cannot hold a
        // job long enough to finish it, and starting a third would spend the
        // reader's money on a loop.
        if (restarted || !restart) throw new Error('The analysis did not survive on the server. Try again.');
        restarted = true;
        const revived = await restart();
        if (revived && revived.status !== 'running') return revived;
        job = (revived && revived.job) || job;
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error('The analysis took too long and was cancelled.');
      }
    }
  }

  /**
   * Start one of the long calls and see it through, whatever the connection
   * does in between.
   *
   * The POST is where `retryOnDrop` still earns its place: it is the one
   * request in this sequence that must actually arrive, since nothing has
   * been started until it does.
   */
  async function run(path, body, opts) {
    const start = () => post(path, Object.assign({ background: true }, body), { retryOnDrop: true });
    const started = await start();
    // A server that predates background jobs, or one answering from its cache,
    // returns the finished report rather than a job key. Both are already the
    // thing being waited for.
    if (!started || !started.job) return started;
    // Handed up before the wait, not after it, so a caller can write the key
    // down while the job is still running — which is the only time writing it
    // down is any use.
    if (opts && typeof opts.onJob === 'function') opts.onJob(started.job);
    return collect(started.job, start);
  }

  const analyseProfile = (digest, auth, opts) =>
    run('/api/analyse', Object.assign({ digest }, auth || {}), opts);
  // `auth` takes the same shape as the other two paid calls — `{ paymentIntentId }`
  // or `{ promoCode }`. A compatibility read is a purchase now rather than a
  // free draw on the daily ceiling, so the server refuses this without one.
  const analyseCompatibility = (a, b, mode, stance, auth) =>
    run('/api/compatibility', Object.assign({ a, b, mode, stance }, auth || {}));
  // digest is resent rather than referenced — the server keeps no copy of it
  // between calls, so this is the same digest the browser already holds
  // (from psycheai_digest) travelling again, not a second upload of anything
  // new. `auth` is one of `{ paymentIntentId }` or `{ promoCode }` — the two
  // ways server.js's handlePremiumAnalysis will accept unlocking this call.
  const analysePremium = (digest, auth) =>
    run('/api/premium-analysis', Object.assign({ digest }, auth));

  /**
   * Rejoin a job this page did not start — one begun by a previous life of
   * this tab, before it was closed or reloaded.
   *
   * No `restart` behind it, deliberately. A page that has just opened cannot
   * know whether the reader still wants the thing, and quietly spending a
   * model call on that assumption is worse than saying the job is gone and
   * offering the button.
   */
  const resumeJob = job => collect(job, null);

  root.PsycheLLM = {
    status, ticket, analyseProfile, analyseCompatibility, analysePremium, resumeJob,
    // Exported so the payment-intent call in app.js goes through the same
    // ticket handling as everything else. It was fetching a ticket by hand and
    // posting it directly, which meant it was the one protected route with no
    // retry behind it — so a ticket the server did not recognise surfaced as
    // "reload the page" instead of being quietly asked for again.
    postWithTicket: post,
  };
})(typeof window !== 'undefined' ? window : globalThis);
