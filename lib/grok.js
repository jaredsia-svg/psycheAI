// The Grok (xAI) implementation of PsycheAI's two analyses.
//
// Mirrors lib/claude.js and lib/gemini.js exactly — same two functions, same
// return shape — so the server can swap providers without knowing which one
// it has. xAI's API is OpenAI-compatible, so this talks to it through the
// `openai` SDK pointed at a different base URL rather than through a
// dedicated xAI client.
//
// No explicit prompt-cache handling here, unlike lib/gemini.js. xAI caches
// repeated prompt prefixes automatically on their side; there is no create/
// attach step on this end to get it, so the extra machinery gemini.js needs
// for that has nothing to mirror.
'use strict';

const OpenAI = require('openai');
const prompts = require('./prompts');

// Model IDs move faster than this file does; `npm run models:grok` lists
// what your key can actually reach, and XAI_MODEL overrides the default.
const MODEL = process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-4.6';
const MAX_TOKENS = 32000;
const BASE_URL = process.env.PSYCHEAI_XAI_BASE_URL || 'https://api.x.ai/v1';

function apiKey() {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
}

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: apiKey(), baseURL: BASE_URL });
  return client;
}

class GrokError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

// Images as data-URI `image_url` parts and everything else as `text` parts,
// in the same order prompts.js produces — the OpenAI-style content array a
// vision-capable chat completion expects.
function toContent(blocks) {
  return blocks.map(block => (block.type === 'image'
    ? { type: 'image_url', image_url: { url: 'data:' + block.mime + ';base64,' + block.data } }
    : { type: 'text', text: block.text }));
}

async function runOnce(params) {
  if (!apiKey()) throw new GrokError('No XAI_API_KEY is set on the server.', 500);

  const stream = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'psycheai_response', strict: true, schema: params.schema },
    },
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: toContent(params.blocks) },
    ],
  });

  let text = '';
  let finishReason = null;
  let refusal = '';
  let usage = null;
  let model = MODEL;
  for await (const chunk of stream) {
    const choice = chunk.choices && chunk.choices[0];
    if (choice) {
      if (choice.delta && choice.delta.content) text += choice.delta.content;
      if (choice.delta && choice.delta.refusal) refusal += choice.delta.refusal;
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (chunk.usage) usage = chunk.usage;
    if (chunk.model) model = chunk.model;
  }

  if (refusal) {
    throw new GrokError(
      'Grok declined to analyse this export. This can happen to benign content — if you think it is ' +
      'a false positive, try again.', 422);
  }
  if (finishReason === 'length') {
    throw new GrokError('The analysis ran past its length limit and came back incomplete. Please try again.', 502);
  }
  if (finishReason === 'content_filter') {
    throw new GrokError(
      'Grok stopped the response on a content filter. This can happen to benign content — if you think ' +
      'it is a false positive, try again.', 422);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new GrokError('Grok returned a response that could not be read as JSON.', 502);
  }

  return {
    data,
    usage: {
      inputTokens: (usage && usage.prompt_tokens) || 0,
      outputTokens: (usage && usage.completion_tokens) || 0,
      cachedTokens: (usage && usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0,
    },
    model,
  };
}

// xAI does not document a distinct "overloaded" error the way Gemini's 503 or
// Claude's 529 do, so any 5xx from the SDK's InternalServerError is treated
// as the same kind of transient capacity blip and retried the same way.
function isOverloaded(error) {
  return error instanceof OpenAI.InternalServerError;
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
      return await runOnce(params);
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
  });
}

/** Maps SDK errors onto something the browser can show a user. */
function describeError(error) {
  if (error instanceof GrokError) return { status: error.status, message: error.message };
  if (error instanceof OpenAI.AuthenticationError) {
    return { status: 500, message: 'The server has no valid xAI API key configured.' };
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return { status: 500, message: 'This API key does not have access to ' + MODEL + '.' };
  }
  if (error instanceof OpenAI.NotFoundError) {
    return {
      status: 500,
      message: 'xAI has no model called "' + MODEL + '" for this key. Run "npm run models:grok" to list ' +
        'the ones you can use, then set XAI_MODEL to one of them.',
    };
  }
  if (error instanceof OpenAI.RateLimitError) {
    return { status: 429, message: 'Rate limited by the xAI API. Wait a moment and try again.' };
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { status: 503, message: 'Could not reach the xAI API.' };
  }
  // Only reached once every automatic retry has also hit "overloaded" — see
  // isOverloaded() and the retry loop in complete().
  if (isOverloaded(error)) {
    return {
      status: 503,
      message: 'Grok is overloaded right now and stayed unavailable after retrying automatically. ' +
        'Wait a minute and try again, or set XAI_MODEL to a less busy model.',
    };
  }
  if (error instanceof OpenAI.BadRequestError) {
    return { status: 502, message: 'xAI rejected the request (' + error.status + '): ' + error.message };
  }
  if (error instanceof OpenAI.APIError) {
    return { status: 502, message: 'xAI API error (' + error.status + '): ' + error.message };
  }
  return { status: 500, message: error && error.message ? error.message : 'Unknown server error.' };
}

/** Lists the models this key can reach — mirrors lib/gemini.js's listModels(). */
async function listModels() {
  const page = await getClient().models.list();
  const out = [];
  for await (const model of page) out.push({ id: model.id, label: '' });
  return out;
}

module.exports = {
  name: 'grok',
  analyseProfile,
  analyseCompatibility,
  analysePremium,
  describeError,
  listModels,
  hasKey: () => Boolean(apiKey()),
  GrokError,
  MODEL,
};
