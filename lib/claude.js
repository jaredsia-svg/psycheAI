// The Claude calls behind PsycheAI's two analyses.
//
// Both use structured outputs, so the model returns JSON matching the schema
// in prompts.js rather than prose the UI would have to parse defensively.
// Both stream, because adaptive thinking plus a long report shares one
// `max_tokens` budget and a non-streaming request that large risks an HTTP
// timeout.
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const prompts = require('./prompts');

const MODEL = process.env.PSYCHEAI_MODEL || process.env.KINDRED_MODEL || 'claude-opus-5';
const MAX_TOKENS = 32000;

/**
 * How hard the model thinks. `high` is the API's own default and what the free
 * report uses; the paid call runs at `medium` instead, and that is a latency
 * decision rather than a quality one.
 *
 * The paid call writes four sections from a ~45,000-token digest with adaptive
 * thinking on. At `high` that measured past five minutes of wall clock — and
 * unlike the free report, the reader is watching it having *already paid*,
 * which is the worst place in the app to make somebody wait. Thinking tokens
 * are most of that time and most of the output bill, so `medium` cuts both.
 *
 * Set PSYCHEAI_PREMIUM_EFFORT=high to put it back, or `low` to cut further.
 * The free report's own effort is PSYCHEAI_EFFORT.
 */
const EFFORT = process.env.PSYCHEAI_EFFORT || 'high';
const PREMIUM_EFFORT = process.env.PSYCHEAI_PREMIUM_EFFORT || 'medium';
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
for (const [name, value] of [['PSYCHEAI_EFFORT', EFFORT], ['PSYCHEAI_PREMIUM_EFFORT', PREMIUM_EFFORT]]) {
  if (!EFFORT_LEVELS.includes(value)) {
    throw new Error(name + ' must be one of ' + EFFORT_LEVELS.join(', ') + ' — got ' + JSON.stringify(value));
  }
}

// Server-side refusal fallbacks are a beta; if the org is not enrolled the
// request 400s. We try with them, then retry once without, so a missing beta
// degrades to "no fallback" rather than to "feature broken".
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client = null;

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

class ClaudeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

function textOf(message) {
  return (message.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
}

function toContent(blocks) {
  return blocks.map(block => (block.type === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: block.mime, data: block.data } }
    : { type: 'text', text: block.text }));
}

/**
 * Structured outputs compile the schema into a sampling grammar, and a schema
 * that compiles too large is refused with a 400 rather than degraded. The
 * limit is undocumented and only findable by hitting it, so this is matched on
 * the message: there is no error code or type that distinguishes it from any
 * other invalid request.
 */
function isGrammarTooLarge(error) {
  return error instanceof Anthropic.BadRequestError &&
    /compiled grammar is too large/i.test((error && error.message) || '');
}

// Asked for when the grammar is refused and the schema cannot be enforced by
// the API. Appended to the system prompt rather than the user turn so it does
// not sit between the digest and the model, and so the cached prefix — which
// is the system block — is the thing that changes, keeping the two variants
// from sharing a cache entry that no longer describes them.
function jsonOnlyInstruction(schema) {
  return '\n\n# Output format\n\nReturn a single JSON object and nothing else: no preamble, no ' +
    'explanation, no markdown code fence. It must match this JSON Schema exactly — every property ' +
    'present, no properties beyond it, and every enum value drawn from the list given.\n\n' +
    JSON.stringify(schema);
}

async function runOnce(params, options) {
  const anthropic = getClient();
  const constrain = options.constrain !== false;
  const system = constrain ? params.system : params.system + jsonOnlyInstruction(params.schema);
  const effort = params.effort || EFFORT;
  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: constrain
      ? { effort, format: { type: 'json_schema', schema: params.schema } }
      : { effort },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: toContent(params.blocks) }],
  };

  if (options.useFallbacks) {
    const stream = anthropic.beta.messages.stream({
      ...request,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
    return stream.finalMessage();
  }
  return anthropic.messages.stream(request).finalMessage();
}

/**
 * Reads the JSON out of an unconstrained response. Only used on the fallback
 * path: with the grammar in place the body is JSON and nothing else, so this
 * is never reached for a normal run.
 *
 * Tolerant of the two things a model does anyway when asked for bare JSON — a
 * ```json fence, and a sentence before or after the object — because the
 * alternative is failing a reader who has already paid over a stray "Here is
 * the analysis:".
 */
function parseLooseJson(raw) {
  const text = String(raw || '').trim();
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === 'object') return value;
    } catch (error) { /* try the next shape */ }
  }
  return null;
}

/**
 * Three attempts, each earning its place, each only reached for a reason
 * narrow enough to name:
 *
 *  1. betas + grammar — what we actually want.
 *  2. no betas, still grammar — a 400 at step 1 is almost always the
 *     server-side-fallback beta not being enabled for this org.
 *  3. no grammar at all — only when the API says the compiled grammar is too
 *     large, which it does for the *schema*, so retrying it unchanged is
 *     pointless. The schema goes into the prompt instead and the response is
 *     parsed.
 *
 * Step 3 exists because of where this call sits: the paid analysis runs after
 * the reader's money has been taken. Hard-failing there and showing them a raw
 * 400 — which is what happened — is the worst outcome in the app, and worse
 * than a report generated without the API enforcing its own shape.
 */
async function attemptCompletion(params) {
  const stages = [
    { useFallbacks: true, constrain: true, advanceOn: error => error instanceof Anthropic.BadRequestError },
    { useFallbacks: false, constrain: true, advanceOn: isGrammarTooLarge },
    { useFallbacks: false, constrain: false, advanceOn: null },
  ];

  let message;
  let constrained = true;
  for (let i = 0; ; i++) {
    try {
      message = await runOnce(params, stages[i]);
      constrained = stages[i].constrain;
      break;
    } catch (error) {
      if (!stages[i].advanceOn || !stages[i].advanceOn(error)) throw error;
    }
  }

  if (message.stop_reason === 'refusal') {
    const category = (message.stop_details && message.stop_details.category) || 'unspecified';
    throw new ClaudeError(
      'Claude declined to analyse this export (' + category + '). This can happen to benign content — ' +
      'if you think it is a false positive, try again.', 422);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeError('The analysis ran past its length limit and came back incomplete. Please try again.', 502);
  }

  // Strict on the constrained path — the grammar guarantees bare JSON, so
  // anything else there is a real failure worth surfacing rather than papering
  // over. Tolerant only on the fallback path, where nothing enforced the shape.
  const raw = textOf(message);
  const data = constrained ? tryStrictJson(raw) : parseLooseJson(raw);
  if (!data) {
    throw new ClaudeError('Claude returned a response that could not be read as JSON.', 502);
  }
  return {
    data,
    usage: {
      inputTokens: message.usage.input_tokens || 0,
      outputTokens: message.usage.output_tokens || 0,
    },
    model: message.model,
    // True when the API enforced the schema, false when it was asked for in
    // the prompt instead. Reported so a run that quietly lost the guarantee is
    // visible rather than indistinguishable from one that kept it.
    constrained,
  };
}

function tryStrictJson(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

// 529 (the SDK surfaces it as InternalServerError, since it only special-cases
// status codes below 500) is Anthropic's "overloaded_error" — a transient
// capacity blip, not a problem with the key or the request — so it is worth a
// few automatic retries rather than surfacing on the first hit.
function isOverloaded(error) {
  return error instanceof Anthropic.InternalServerError &&
    (error.status === 529 || error.type === 'overloaded_error' || /overloaded/i.test(error.message || ''));
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
      if (!isOverloaded(error) || attempt >= OVERLOAD_RETRY_DELAYS_MS.length) throw error;
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
    effort: PREMIUM_EFFORT,
  });
}

/** Maps SDK errors onto something the browser can show a user. */
function describeError(error) {
  if (error instanceof ClaudeError) return { status: error.status, message: error.message };
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: 'The server has no valid Anthropic API key configured.' };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { status: 500, message: 'This API key does not have access to ' + MODEL + '.' };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Rate limited by the Anthropic API. Wait a moment and try again.' };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 503, message: 'Could not reach the Anthropic API.' };
  }
  // Only reached once every automatic retry has also hit "overloaded" — see
  // isOverloaded() and the retry loop in complete().
  if (isOverloaded(error)) {
    return {
      status: 503,
      message: 'Claude is overloaded right now and stayed unavailable after retrying automatically. ' +
        'Wait a minute and try again, or set PSYCHEAI_MODEL to a less busy model.',
    };
  }
  // The real base class is APIError; `APIStatusError` does not exist on this
  // SDK and `instanceof` an undefined value throws, which would have taken
  // down the whole error response for any Anthropic error not already
  // special-cased above (a 400, a 404, a 409, a fresh status code — anything
  // this file has not seen yet).
  if (error instanceof Anthropic.APIError) {
    return { status: 502, message: 'Anthropic API error (' + error.status + '): ' + error.message };
  }
  return { status: 500, message: error && error.message ? error.message : 'Unknown server error.' };
}

module.exports = {
  name: 'anthropic',
  analyseProfile,
  analyseCompatibility,
  analysePremium,
  describeError,
  hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  ClaudeError,
  MODEL,
  EFFORT,
  PREMIUM_EFFORT,
};
