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

const { createHash } = require('node:crypto');

const { GoogleGenAI } = require('@google/genai');
const prompts = require('./prompts');

// ---------- which model ----------
//
// This one line is the switch. 3.8 is the default; to go back to 3.7, change
// it to 'gemini-3.7-flash' and change the matching line in docs/digest.js —
// MODEL_RATES there already carries both models' rates, so nothing has to be
// looked up, and a check in tools/selftest.mjs fails if only one of the two
// moves. Nothing else in the codebase names a model.
//
// To revert without a deploy at all, set GEMINI_MODEL=gemini-3.7-flash in the
// environment: it overrides this and takes effect on the next request. 3.8 was
// made the default once before and backed out the same day because Google
// returned "overloaded" under launch load, so this is the lever to reach for if
// that happens again. The digest budget stays priced for the model named here,
// which is safe either way because the two carry identical rates.
//
// Model IDs move faster than this file does; `npm run models` lists what your
// key can actually reach.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
// docs/digest.js budgets the evidence digest around this exact number, so the
// two must move together — see MAX_OUTPUT_TOKENS there for why. A typical
// call only spends about 8,000 tokens on report plus thinking combined, so
// 16,000 is double the ordinary case and this cap should bind only on the
// rare over-long response, not on the normal report.
const MAX_OUTPUT_TOKENS = 18000;
// The free call's cap, and the larger half of its five-cent ceiling: 8,000
// tokens at $3.75/M is three cents of the five. docs/digest.js reserves
// exactly this as FREE_MAX_OUTPUT_TOKENS and a check holds the two together.
// The card is about 600 tokens; the rest is HIGH thinking, the same level the
// full report thinks at. If `npm run usage` shows card calls failing on
// MAX_TOKENS, raise both — the digest budget shrinks by 3,500 characters per
// 1,000 tokens added, and the ceiling holds either way.
const CARD_MAX_OUTPUT_TOKENS = 8000;
// The unlock's one call — the written report and the four premium sections in
// a single response. docs/digest.js reserves exactly this as MAX_OUTPUT_TOKENS
// when it sizes the full digest, and a check holds the two together.
const FULL_MAX_OUTPUT_TOKENS = 28000;

// ---------- context caching ----------
//
// The system prompt is byte-identical on every call of a given kind and is
// re-billed as input each time: about 9,100 tokens for the profile analysis,
// which is more than the digest and the photographs put together. An explicit
// cache parks it on Google's side and bills those tokens at a discount.
//
// Explicit rather than implicit, because of the traffic shape. Implicit caching
// is automatic but best-effort, with a short eviction window that suits steady
// high-rate traffic; this app goes minutes or hours between analyses, which is
// exactly when an implicit entry has already been evicted. An explicit entry
// with its own TTL survives those gaps.
//
// It is not free, and the arithmetic decides whether to do it at all. Cached
// tokens carry a storage charge per hour, so an entry no second call ever
// reaches costs more than it saved.
//
// **Off by default, because at this app's traffic caching loses money.** The
// break-even is worth writing down, because prompt size cancels out of both
// sides of it and what is left is a rate against a rate:
//
//   caching pays when  calls per hour  >  storage rate / (input rate - cached rate)
//
// At Gemini's flash pricing that is 1.00 / (1.50 - 0.375) — about **0.9 calls
// an hour, sustained**. Ten analyses a day is 0.4, less than half of it. The
// previous default of 900 seconds was the worst of both worlds at that rate:
// gaps between calls average a couple of hours, so nearly every call missed
// and still paid to create an entry that expired unread. Lengthening the TTL
// makes it worse rather than better — a day of storage on a 15,000-token
// prompt costs more than the handful of hits it would earn.
//
// So: set PSYCHEAI_GEMINI_CACHE_TTL to a number of seconds once `npm run
// usage` shows sustained traffic above roughly one call an hour, and pick a
// TTL longer than the typical gap between calls. Until then the default of 0
// sends the system instruction inline and pays no storage.
const CACHE_TTL_SECONDS = (() => {
  const raw = process.env.PSYCHEAI_GEMINI_CACHE_TTL;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
})();

// Gemini refuses to cache content below a minimum size, and the floor differs
// by model. Estimated with the same chars-per-token ratio the digest budget
// uses. The profile prompt clears this comfortably; the compatibility prompt
// (~1,900 tokens) does not, so it is never offered — which is correct rather
// than unfortunate, since that call is small at both ends anyway.
const CACHE_MIN_TOKENS = 4096;
const CHARS_PER_TOKEN = 3.5;

// A create that fails is usually structural — the model does not support
// caching, the content is under the floor, the key lacks permission — so it
// would fail again on the next call too. Back off rather than paying a failed
// round trip per analysis.
const CACHE_COOLDOWN_MS = 10 * 60 * 1000;

// Renew slightly early. A cache that expires between the lookup and the call
// is handled by the retry in `complete()`, but not paying for that round trip
// is better than recovering from it.
const CACHE_REFRESH_MARGIN_MS = 60 * 1000;

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

// ---------- the cache registry ----------
//
// Keyed on model plus a hash of the system prompt, so editing a prompt cannot
// serve the previous one out of a cache that is still inside its TTL — the key
// changes with the text. Entries hold the in-flight promise rather than the
// resolved name, so two analyses starting together create one cache between
// them instead of one each.
const cacheEntries = new Map();
let cacheCooldownUntil = 0;

function cacheKeyFor(system) {
  return MODEL + '' + createHash('sha256').update(system).digest('hex');
}

function cacheable(system) {
  if (!CACHE_TTL_SECONDS) return false;
  return system.length / CHARS_PER_TOKEN >= CACHE_MIN_TOKENS;
}

async function createCache(system) {
  const created = await getClient().caches.create({
    model: MODEL,
    config: { systemInstruction: system, ttl: CACHE_TTL_SECONDS + 's' },
  });
  const name = created && created.name;
  if (!name) throw new Error('cache create returned no name');
  return { name, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 };
}

/**
 * The cached-content handle for a system prompt, or null to send it inline.
 *
 * Never throws and never blocks the analysis: every failure path returns null,
 * because a cache is an optimisation and an optimisation that can break the
 * product is not worth having.
 */
async function cachedContentFor(system) {
  if (!cacheable(system)) return null;
  if (Date.now() < cacheCooldownUntil) return null;

  const key = cacheKeyFor(system);
  const pending = cacheEntries.get(key);
  if (pending) {
    const settled = await pending.catch(() => null);
    if (settled && settled.expiresAt > Date.now() + CACHE_REFRESH_MARGIN_MS) return settled.name;
    // Expired, or the create behind it failed. Drop it and fall through to a
    // fresh attempt rather than serving a name the API has already forgotten.
    if (cacheEntries.get(key) === pending) cacheEntries.delete(key);
  }

  const attempt = createCache(system);
  cacheEntries.set(key, attempt);
  try {
    return (await attempt).name;
  } catch (error) {
    if (cacheEntries.get(key) === attempt) cacheEntries.delete(key);
    cacheCooldownUntil = Date.now() + CACHE_COOLDOWN_MS;
    return null;
  }
}

// Dropped when the API says it no longer knows the handle, so the next call
// makes a new one instead of reusing a name that is guaranteed to fail.
function forgetCache(system) {
  cacheEntries.delete(cacheKeyFor(system));
}

function isCacheError(error) {
  const message = (error && error.message) || String(error || '');
  return /cachedcontent|cached_content|cache/i.test(message) &&
    /not found|NOT_FOUND|invalid|INVALID_ARGUMENT|expire|PERMISSION_DENIED|\b40[34]\b/i.test(message);
}

// Gemini takes images as inline base64 parts in the same `parts` array as the
// text, which is exactly the order prompts.js produces.
function toParts(blocks) {
  return blocks.map(block => (block.type === 'image'
    ? { inlineData: { mimeType: block.mime, data: block.data } }
    : { text: block.text }));
}

async function attemptCompletion(params, allowCache) {
  if (!apiKey()) {
    throw new GeminiError('No GEMINI_API_KEY is set on the server.', 500);
  }

  // `model` and `thinkingLevel` are overrides for tools/compare.mjs, which
  // measures what a different model or thinking level would do to the card.
  // Production never passes either. A cache entry belongs to the model it was
  // made for, so a different model never uses one.
  const model = params.model || MODEL;
  const cacheName = allowCache === false || model !== MODEL ? null : await cachedContentFor(params.system);

  const config = {
    responseMimeType: 'application/json',
    responseJsonSchema: params.schema,
    maxOutputTokens: params.maxOutputTokens || MAX_OUTPUT_TOKENS,
    thinkingConfig: { thinkingLevel: params.thinkingLevel || 'HIGH' },
  };
  // One or the other, never both: the cached entry already carries the system
  // instruction, and sending it twice is rejected. The schema stays inline
  // either way — it is generation config rather than content, so it cannot be
  // cached and is still billed in full on every call.
  if (cacheName) config.cachedContent = cacheName;
  else config.systemInstruction = params.system;

  let stream;
  try {
    stream = await getClient().models.generateContentStream({
      model,
      contents: [{ role: 'user', parts: toParts(params.blocks) }],
      config,
    });
  } catch (error) {
    if (cacheName && isCacheError(error)) {
      forgetCache(params.system);
      const retried = new GeminiError('cached content was rejected', 502);
      retried.retryWithoutCache = true;
      throw retried;
    }
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
    // The rejection can arrive mid-stream rather than at request time, so the
    // same recovery lives on both paths.
    if (cacheName && isCacheError(error)) {
      forgetCache(params.system);
      const retried = new GeminiError('cached content was rejected', 502);
      retried.retryWithoutCache = true;
      throw retried;
    }
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

  // `cachedTokens` is the part of the input that was served from the cache and
  // billed at the reduced rate. It is reported rather than inferred because a
  // cache that silently stops being hit looks exactly like one that works, and
  // the only way to tell is to read this number back from real calls.
  const usage = (last && last.usageMetadata) || {};
  return {
    data,
    usage: {
      inputTokens: usage.promptTokenCount || 0,
      // Billed together at the output rate, reported apart because they are
      // two different decisions. `thinkingLevel` sets one and the schema's
      // length instructions set the other, and summing them hides which of
      // the two an output bill is actually made of — on this app it is mostly
      // thinking, and that is not visible from a single total.
      outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
      thinkingTokens: usage.thoughtsTokenCount || 0,
      cachedTokens: usage.cachedContentTokenCount || 0,
    },
    model,
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
  let allowCache = true;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptCompletion(params, allowCache);
    } catch (error) {
      // A rejected cache handle costs one round trip and is then never tried
      // again for this call. It does not consume an overload retry, because it
      // is not a load problem and waiting would not help.
      if (error.retryWithoutCache && allowCache) {
        allowCache = false;
        attempt--;
        continue;
      }
      if (!error.retryable || attempt >= OVERLOAD_RETRY_DELAYS_MS.length) throw error;
      await sleep(OVERLOAD_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * The full report — every explanation — from an evidence digest.
 *
 * `anchor` is the free card's conclusions, sanitised by prompts.anchorFrom.
 * With it, the report is written to explain the card the reader already has
 * rather than to reach its own conclusions afresh; without it (a reader whose
 * evidence changed since the card) it decides everything.
 */
function analyseProfile(digest, anchor) {
  return complete({
    system: prompts.PROFILE_SYSTEM,
    schema: prompts.PROFILE_SCHEMA,
    blocks: prompts.profileBlocks(digest, anchor),
  });
}

/**
 * The whole premium report in one call: every explanation behind the card,
 * the roast, and the four premium sections. What the S$1.99 unlock buys.
 */
function analyseFull(digest, anchor) {
  return complete({
    system: prompts.FULL_SYSTEM,
    schema: prompts.FULL_SCHEMA,
    blocks: prompts.profileBlocks(digest, anchor),
    maxOutputTokens: FULL_MAX_OUTPUT_TOKENS,
  });
}

/**
 * The free summary card, from the same digest the full report reads.
 * Conclusions only. `options` is for tools/compare.mjs alone: `{ model,
 * thinkingLevel }` to measure an alternative; production passes nothing.
 */
function analyseCard(digest, options) {
  const opts = options || {};
  // The card's repeated fields are filled from the answer, not written twice.
  return complete({
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
    system: prompts.FREE_SYSTEM,
    schema: prompts.FREE_SCHEMA,
    blocks: prompts.freeBlocks(digest),
    maxOutputTokens: CARD_MAX_OUTPUT_TOKENS,
  }).then(prompts.withCard);
}

/** Compatibility from two shareable cards, on one chosen basis. */
function analyseCompatibility(a, b, mode, stance) {
  return complete({
    system: prompts.COMPATIBILITY_SYSTEM,
    schema: prompts.COMPATIBILITY_SCHEMA,
    blocks: prompts.compatibilityBlocks(a, b, mode, stance),
  });
}

/** The paid second pass — same digest, a different system prompt and schema. */
function analysePremium(digest) {
  return complete({
    system: prompts.PREMIUM_SYSTEM,
    schema: prompts.PREMIUM_SCHEMA,
    blocks: prompts.premiumBlocks(digest),
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

// Seams for tools/selftest.mjs. Caching is the one part of this file whose
// behaviour is invisible from the outside — a working cache and a silently
// broken one produce identical reports — so the tests drive it against a stub
// client rather than trusting it to be right.
const __testing = {
  setClient(stub) { client = stub; },
  reset() { client = null; cacheEntries.clear(); cacheCooldownUntil = 0; },
  cacheable,
  cachedContentFor,
  isCacheError,
  attemptCompletion,
  complete,
  entryCount: () => cacheEntries.size,
  onCooldown: () => Date.now() < cacheCooldownUntil,
  CACHE_TTL_SECONDS,
  CACHE_MIN_TOKENS,
};

module.exports = {
  name: 'gemini',
  analyseProfile,
  analyseCard,
  analyseFull,
  analyseCompatibility,
  analysePremium,
  describeError,
  listModels,
  hasKey: () => Boolean(apiKey()),
  MODEL,
  MAX_OUTPUT_TOKENS,
  CARD_MAX_OUTPUT_TOKENS,
  FULL_MAX_OUTPUT_TOKENS,
  __testing,
};
