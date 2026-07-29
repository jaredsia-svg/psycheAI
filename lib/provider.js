// Picks which model provider runs the two analyses.
//
// Both providers implement the same interface — analyseProfile,
// analyseCompatibility, describeError, hasKey, MODEL — and share the prompts
// and schemas in prompts.js, so nothing downstream knows or cares which one
// is in use.
//
// Selection, in order:
//   KINDRED_MOCK=1        → canned analyses, no API calls
//   KINDRED_PROVIDER=…    → force "gemini" or "anthropic"
//   GEMINI_API_KEY set    → Gemini
//   ANTHROPIC_API_KEY set → Claude
//   neither               → unconfigured; the server says so instead of failing later
'use strict';

const mock = require('./mock');

// Providers are required lazily so a missing optional SDK never breaks startup
// for someone using the other one.
function load(name) {
  try {
    return require(name === 'gemini' ? './gemini' : './claude');
  } catch (error) {
    return null;
  }
}

function resolve() {
  if (process.env.KINDRED_MOCK === '1') return mock;

  const forced = (process.env.KINDRED_PROVIDER || '').toLowerCase();
  if (forced === 'mock') return mock;
  if (forced === 'gemini' || forced === 'google') return load('gemini');
  if (forced === 'anthropic' || forced === 'claude') return load('anthropic');

  const gemini = load('gemini');
  if (gemini && gemini.hasKey()) return gemini;

  const anthropic = load('anthropic');
  if (anthropic && anthropic.hasKey()) return anthropic;

  return null;
}

const active = resolve();

/** What the server reports at /api/status and prints on boot. */
function describe() {
  if (!active) {
    return {
      ready: false,
      provider: null,
      model: null,
      mock: false,
      hint: 'Set GEMINI_API_KEY (or ANTHROPIC_API_KEY), or run with KINDRED_MOCK=1.',
    };
  }
  const ready = active.hasKey();
  return {
    ready,
    provider: active.name,
    model: active.MODEL,
    mock: active.name === 'mock',
    hint: ready ? '' : 'The ' + active.name + ' provider was selected but its API key is missing.',
  };
}

module.exports = { active, describe };
