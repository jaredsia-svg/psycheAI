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

async function runOnce(params, useFallbacks) {
  const anthropic = getClient();
  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: params.schema },
    },
    system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: toContent(params.blocks) }],
  };

  if (useFallbacks) {
    const stream = anthropic.beta.messages.stream({
      ...request,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
    return stream.finalMessage();
  }
  return anthropic.messages.stream(request).finalMessage();
}

async function attemptCompletion(params) {
  let message;
  try {
    message = await runOnce(params, true);
  } catch (error) {
    // A 400 here is almost always the beta not being enabled for this org.
    // Anything else is a real failure and should surface as itself.
    if (error instanceof Anthropic.BadRequestError) {
      message = await runOnce(params, false);
    } else {
      throw error;
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

  const raw = textOf(message);
  try {
    return {
      data: JSON.parse(raw),
      usage: {
        inputTokens: message.usage.input_tokens || 0,
        outputTokens: message.usage.output_tokens || 0,
      },
      model: message.model,
    };
  } catch (error) {
    throw new ClaudeError('Claude returned a response that could not be read as JSON.', 502);
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
function analyseCompatibility(a, b, mode) {
  return complete({
    system: prompts.COMPATIBILITY_SYSTEM,
    schema: prompts.COMPATIBILITY_SCHEMA,
    blocks: prompts.compatibilityBlocks(a, b, mode),
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
  describeError,
  hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  ClaudeError,
  MODEL,
};
