// Exercises the automatic-retry-on-overload logic in lib/gemini.js and
// lib/claude.js against fake SDKs, in its own process so the fakes can sit in
// the require cache before those files ever import the real packages.
//
// Runs standalone (`node tools/fixtures/retry-behaviour.cjs`) and prints one
// JSON line per check to stdout; tools/selftest.mjs spawns it and folds each
// line into its own tally, so a break here shows up in `npm test` rather than
// needing a separate command anyone has to remember to run.
'use strict';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok), detail });
}

// Every retry delay resolves on the next microtask turn instead of really
// waiting — this process exists only to drive the retry loop through its
// paces, and an exhausted-retry scenario would otherwise burn the full
// 2s + 5s + 12s for real, four times over.
global.setTimeout = fn => { queueMicrotask(fn); return 0; };
global.clearTimeout = () => {};

// ---------- fake @google/genai ----------

class FakeGeminiApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * `behaviours`: a queue consumed one per call to generateContentStream.
 * `counter` is mutated on every call, so a test can see how many times the
 * retry loop actually reached the network rather than inferring it from
 * timing.
 */
function makeFakeGoogleGenAI(behaviours, counter) {
  const queue = behaviours.slice();
  class GoogleGenAI {
    constructor() {}
    get models() {
      return {
        generateContentStream: async () => {
          counter.calls++;
          const next = queue.shift();
          if (!next) throw new Error('fake ran out of scripted behaviour');
          if (next.throw) throw next.throw;
          return (async function* () { yield { text: JSON.stringify(next.data || {}) }; })();
        },
        list: async () => (async function* () {})(),
      };
    }
  }
  return { GoogleGenAI };
}

// ---------- fake @anthropic-ai/sdk ----------

class FakeAnthropicApiError extends Error {
  constructor(message, status, type) {
    super(message);
    this.status = status;
    this.type = type || null;
  }
}
class FakeBadRequestError extends FakeAnthropicApiError {}
class FakeAuthenticationError extends FakeAnthropicApiError {}
class FakePermissionDeniedError extends FakeAnthropicApiError {}
class FakeRateLimitError extends FakeAnthropicApiError {}
class FakeAPIConnectionError extends FakeAnthropicApiError {}
class FakeAPIError extends FakeAnthropicApiError {}
class FakeInternalServerError extends FakeAnthropicApiError {}

/** `behaviours`: a queue consumed one per call to messages.stream(...).finalMessage(). */
function makeFakeAnthropic(behaviours, counter) {
  const queue = behaviours.slice();
  function Anthropic() {}
  const respond = () => ({
    finalMessage: async () => {
      counter.calls++;
      const next = queue.shift();
      if (!next) throw new Error('fake ran out of scripted behaviour');
      if (next.throw) throw next.throw;
      return next.message || {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(next.data || {}) }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'fake-model',
      };
    },
  });
  Anthropic.prototype.beta = { messages: { stream: () => respond() } };
  Object.defineProperty(Anthropic.prototype, 'messages', { get: () => ({ stream: () => respond() }) });
  Anthropic.BadRequestError = FakeBadRequestError;
  Anthropic.AuthenticationError = FakeAuthenticationError;
  Anthropic.PermissionDeniedError = FakePermissionDeniedError;
  Anthropic.RateLimitError = FakeRateLimitError;
  Anthropic.APIConnectionError = FakeAPIConnectionError;
  Anthropic.APIError = FakeAPIError;
  Anthropic.InternalServerError = FakeInternalServerError;
  return Anthropic;
}

/** Installs a fake in the require cache so lib/*.js resolve it, not the real package. */
function stub(specifier, fakeExports) {
  const resolved = require.resolve(specifier);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fakeExports };
}

function loadGemini(behaviours) {
  const counter = { calls: 0 };
  delete require.cache[require.resolve('../../lib/gemini.js')];
  stub('@google/genai', makeFakeGoogleGenAI(behaviours, counter));
  process.env.GEMINI_API_KEY = 'fake-key-for-testing';
  return { engine: require('../../lib/gemini.js'), counter };
}

function loadClaude(behaviours) {
  const counter = { calls: 0 };
  delete require.cache[require.resolve('../../lib/claude.js')];
  stub('@anthropic-ai/sdk', makeFakeAnthropic(behaviours, counter));
  process.env.ANTHROPIC_API_KEY = 'fake-key-for-testing';
  return { engine: require('../../lib/claude.js'), counter };
}

/** Runs one analyseProfile() call to completion, never letting it reject unseen. */
async function attempt(engine) {
  try {
    return { data: (await engine.analyseProfile({ coverage: {} }, [])).data };
  } catch (error) {
    return { error };
  }
}

async function main() {
  // ---------- Gemini ----------

  {
    const { engine, counter } = loadGemini([
      { throw: new FakeGeminiApiError('got status: UNAVAILABLE. The model is overloaded. Please try again later.', 503) },
      { throw: new FakeGeminiApiError('got status: UNAVAILABLE. The model is overloaded. Please try again later.', 503) },
      { data: { ok: true } },
    ]);
    const outcome = await attempt(engine);
    check('Gemini: recovers after two overloaded responses',
      Boolean(outcome.data && outcome.data.ok === true), JSON.stringify(outcome));
    check('Gemini: recovering took exactly three attempts', counter.calls === 3, counter.calls + ' calls');
  }

  {
    const { engine, counter } = loadGemini(Array.from({ length: 10 }, () =>
      ({ throw: new FakeGeminiApiError('got status: UNAVAILABLE. overloaded', 503) })));
    const outcome = await attempt(engine);
    check('Gemini: gives up after exactly 4 attempts (1 try + 3 retries)', counter.calls === 4, counter.calls + ' calls');
    const described = outcome.error ? engine.describeError(outcome.error) : null;
    check('Gemini: the final error names automatic retrying',
      Boolean(described) && /retrying automatically/i.test(described.message), described && described.message);
    check('Gemini: the final error is a 503', Boolean(described) && described.status === 503,
      described && String(described.status));
  }

  {
    const { engine, counter } = loadGemini([{ throw: new FakeGeminiApiError('API key not valid', 401) }]);
    const outcome = await attempt(engine);
    check('Gemini: does not retry a bad key', counter.calls === 1, counter.calls + ' attempts');
    const described = outcome.error ? engine.describeError(outcome.error) : null;
    check('Gemini: a bad key is still reported as one',
      Boolean(described) && /rejected/i.test(described.message), described && described.message);
  }

  // ---------- Claude ----------

  {
    const { engine, counter } = loadClaude([
      { throw: new FakeInternalServerError('Overloaded', 529, 'overloaded_error') },
      { data: { ok: true } },
    ]);
    const outcome = await attempt(engine);
    check('Claude: recovers after one overloaded response',
      Boolean(outcome.data && outcome.data.ok === true), JSON.stringify(outcome));
    check('Claude: recovering took exactly two attempts', counter.calls === 2, counter.calls + ' calls');
  }

  {
    const { engine, counter } = loadClaude(Array.from({ length: 10 }, () =>
      ({ throw: new FakeInternalServerError('Overloaded', 529, 'overloaded_error') })));
    const outcome = await attempt(engine);
    check('Claude: gives up after exactly 4 attempts (1 try + 3 retries)', counter.calls === 4, counter.calls + ' calls');
    const described = outcome.error ? engine.describeError(outcome.error) : null;
    check('Claude: the final error names automatic retrying',
      Boolean(described) && /retrying automatically/i.test(described.message), described && described.message);
    check('Claude: the final error is a 503', Boolean(described) && described.status === 503,
      described && String(described.status));
  }

  {
    const { engine, counter } = loadClaude([{ throw: new FakeAuthenticationError('invalid x-api-key', 401) }]);
    const outcome = await attempt(engine);
    check('Claude: does not retry an auth failure', counter.calls === 1, counter.calls + ' attempts');
    const described = outcome.error ? engine.describeError(outcome.error) : null;
    check('Claude: an auth failure is still reported as one',
      Boolean(described) && /no valid Anthropic API key/i.test(described.message), described && described.message);
  }

  // The bug this session found while wiring the retry up: `Anthropic.APIStatusError`
  // does not exist on this SDK, so `error instanceof Anthropic.APIStatusError`
  // threw a TypeError instead of returning a message — for any Anthropic error
  // not already special-cased, i.e. exactly the catch-all this branch exists for.
  {
    const { engine } = loadClaude([{ throw: new FakeAPIError('teapot', 418, 'weird_error') }]);
    const outcome = await attempt(engine);
    let described;
    let threw = null;
    try {
      described = outcome.error ? engine.describeError(outcome.error) : null;
    } catch (describeErrorThrew) {
      threw = describeErrorThrew;
    }
    check('Claude: an unclassified API error does not crash describeError (regression)',
      !threw, threw && threw.message);
    check('Claude: an unclassified API error is still reported, not swallowed',
      Boolean(described) && described.status === 502 && /418/.test(described.message),
      described && JSON.stringify(described));
  }

  for (const result of results) console.log(JSON.stringify(result));
  process.exitCode = results.every(r => r.ok) ? 0 : 1;
}

main().catch(error => {
  console.log(JSON.stringify({ label: 'retry-behaviour.cjs ran to completion', ok: false, detail: error.stack }));
  process.exitCode = 1;
});
