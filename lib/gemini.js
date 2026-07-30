// The Gemini implementation of PsycheAI's two analyses.
//
// Mirrors lib/claude.js exactly — same two functions, same return shape — so
// the server can swap providers without knowing which one it has.
//
// Gemini's `responseJsonSchema` takes real JSON Schema, so the schemas in
// prompts.js are shared verbatim between the two providers rather than being
// translated. Both calls stream, because a long report plus thinking tokens
// takes long enough that a single buffered request risks a timeout.
'use strict';

const { GoogleGenAI } = require('@google/genai');
const prompts = require('./prompts');

// Model IDs move faster than this file does; `npm run models` lists what your
// key can actually reach, and GEMINI_MODEL overrides the default.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_OUTPUT_TOKENS = 32768;

let client = null;

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: apiKey() });
  return client;
}

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

// Gemini can stop for reasons that are not "it finished". Each one needs its
// own message, because "analysis failed" tells the user nothing actionable.
function checkFinish(response) {
  const blockReason = response.promptFeedback && response.promptFeedback.blockReason;
  if (blockReason) {
    throw new GeminiError(
      'Gemini blocked the request before answering (' + blockReason + '). This can happen to benign ' +
      'content — if you think it is a false positive, try again.', 422);
  }

  const candidate = (response.candidates || [])[0];
  const finish = candidate && candidate.finishReason;
  if (!finish || finish === 'STOP') return;

  if (finish === 'MAX_TOKENS') {
    throw new GeminiError(
      'The analysis ran past its length limit and came back incomplete. Try again, or set a ' +
      'GEMINI_MODEL with more output headroom.', 502);
  }
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
    throw new GeminiError(
      'Gemini stopped the response on a safety filter (' + finish + '). This can happen to benign ' +
      'content — if you think it is a false positive, try again.', 422);
  }
  if (finish === 'RECITATION') {
    throw new GeminiError('Gemini stopped the response over a recitation check. Try again.', 502);
  }
  throw new GeminiError('Gemini stopped unexpectedly (' + finish + ').', 502);
}

// Gemini takes images as inline base64 parts in the same `parts` array as the
// text, which is exactly the order prompts.js produces.
function toParts(blocks) {
  return blocks.map(block => (block.type === 'image'
    ? { inlineData: { mimeType: block.mime, data: block.data } }
    : { text: block.text }));
}

async function attemptCompletion(params) {
  if (!apiKey()) {
    throw new GeminiError('No GEMINI_API_KEY is set on the server.', 500);
  }

  let stream;
  try {
    stream = await getClient().models.generateContentStream({
      model: MODEL,
      contents: [{ role: 'user', parts: toParts(params.blocks) }],
      config: {
        systemInstruction: params.system,
        responseMimeType: 'application/json',
        responseJsonSchema: params.schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: 'HIGH' },
      },
    });
  } catch (error) {
    throw asHttpError(error);
  }

  let text = '';
  let last = null;
  try {
    for await (const chunk of stream) {
      last = chunk;
      if (chunk.text) text += chunk.text;
    }
  } catch (error) {
    throw asHttpError(error);
  }

  if (last) checkFinish(last);
  if (!text.trim()) throw new GeminiError('Gemini returned an empty response.', 502);

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new GeminiError('Gemini returned a response that could not be read as JSON.', 502);
  }

  const usage = (last && last.usageMetadata) || {};
  return {
    data,
    usage: {
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
    },
    model: MODEL,
  };
}

// The SDK surfaces API failures as plain errors carrying the HTTP status in
// the message, so map the common ones onto something a user can act on.
function asHttpError(error) {
  if (error instanceof GeminiError) return error;
  const message = (error && error.message) || String(error);

  if (/API[_ ]?key not valid|API_KEY_INVALID|\b401\b/i.test(message)) {
    return new GeminiError('That GEMINI_API_KEY was rejected. Check it at aistudio.google.com/apikey.', 500);
  }
  if (/not found|NOT_FOUND|\b404\b/i.test(message)) {
    return new GeminiError(
      'Gemini has no model called "' + MODEL + '" for this key. Run "npm run models" to list the ' +
      'ones you can use, then set GEMINI_MODEL to one of them.', 500);
  }
  if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(message)) {
    return new GeminiError('Gemini rate-limited or quota-exhausted this key. Wait a moment and try again.', 429);
  }
  if (/PERMISSION_DENIED|\b403\b/i.test(message)) {
    return new GeminiError('This key does not have permission to use ' + MODEL + '.', 500);
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return new GeminiError('Could not reach the Gemini API.', 503);
  }
  // UNAVAILABLE/503 is Gemini's transient "too much load right now" response,
  // not a problem with the key or the request, so it is worth a few automatic
  // retries rather than surfacing on the first hit. `retryable` is read by
  // `complete()`'s retry loop; the message below is only ever shown if every
  // retry also lands on this branch.
  if ((error && error.status === 503) || /UNAVAILABLE|overloaded|high demand|\b503\b/i.test(message)) {
    const wrapped = new GeminiError(
      'Gemini is overloaded right now and stayed unavailable after retrying automatically. ' +
      'Wait a minute and try again, or set GEMINI_MODEL to a less busy model.', 503);
    wrapped.retryable = true;
    return wrapped;
  }
  return new GeminiError('Gemini API error: ' + message, 502);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Riding out a load spike, not a real outage: three quick retries with
// growing gaps, capped well under the client's ten-minute request timeout
// (docs/llm.js) even added on top of an already-slow analysis.
const OVERLOAD_RETRY_DELAYS_MS = [2000, 5000, 12000];

async function complete(params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptCompletion(params);
    } catch (error) {
      if (!error.retryable || attempt >= OVERLOAD_RETRY_DELAYS_MS.length) throw error;
      await sleep(OVERLOAD_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Full personality profile from an evidence digest and a few of their photos. */
function analyseProfile(digest, images) {
  return complete({
    system: prompts.PROFILE_SYSTEM,
    schema: prompts.PROFILE_SCHEMA,
    blocks: prompts.profileBlocks(digest, images),
  });
}

/** Compatibility from two shareable cards, on one chosen basis. */
function analyseCompatibility(a, b, mode) {
  return complete({
    system: prompts.COMPATIBILITY_SYSTEM,
    schema: prompts.COMPATIBILITY_SCHEMA,
    blocks: prompts.compatibilityBlocks(a, b, mode),
  });
}

function describeError(error) {
  const mapped = asHttpError(error);
  return { status: mapped.status, message: mapped.message };
}

/** Lists the models this key can reach — model IDs change often. */
async function listModels() {
  const pager = await getClient().models.list();
  const out = [];
  for await (const model of pager) {
    const actions = model.supportedActions || model.supportedGenerationMethods || [];
    if (!actions.length || actions.includes('generateContent')) {
      out.push({ id: String(model.name || '').replace(/^models\//, ''), label: model.displayName || '' });
    }
  }
  return out;
}

module.exports = {
  name: 'gemini',
  analyseProfile,
  analyseCompatibility,
  describeError,
  listModels,
  hasKey: () => Boolean(apiKey()),
  MODEL,
};
