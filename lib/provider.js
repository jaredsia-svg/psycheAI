// Picks which model provider runs the two analyses.
//
// All three providers implement the same interface — analyseProfile,
// analyseCompatibility, describeError, hasKey, MODEL — and share the prompts
// and schemas in prompts.js, so nothing downstream knows or cares which one
// is in use.
//
// Selection, in order:
//   PSYCHEAI_MOCK=1        → canned analyses, no API calls
//   PSYCHEAI_PROVIDER=…    → force "grok", "gemini" or "anthropic"
//   XAI_API_KEY set        → Grok
//   GEMINI_API_KEY set    → Gemini
//   ANTHROPIC_API_KEY set → Claude
//   none of the above     → unconfigured; the server says so instead of failing later
//
// Grok is checked first when nothing is forced, so setting XAI_API_KEY alone
// is enough to switch a deployment to it without also having to unset or
// override whichever of the other two keys might already be sitting in the
// environment.
'use strict';

const mock = require('./mock');

// The app was called Kindred before it was called PsycheAI. Anyone who already
// has KINDRED_* set in a deployment should not have their server silently
// change behaviour on the rename, so the old spellings still work.
const env = name => process.env['PSYCHEAI_' + name] || process.env['KINDRED_' + name] || '';

const MODULE_FOR = { grok: './grok', gemini: './gemini', anthropic: './claude' };

// Providers are required lazily so a missing optional SDK never breaks startup
// for someone using one of the others.
function load(name) {
  try {
    return require(MODULE_FOR[name]);
  } catch (error) {
    return null;
  }
}

function resolve() {
  if (env('MOCK') === '1') return mock;

  const forced = env('PROVIDER').toLowerCase();
  if (forced === 'mock') return mock;
  if (forced === 'grok' || forced === 'xai') return load('grok');
  if (forced === 'gemini' || forced === 'google') return load('gemini');
  if (forced === 'anthropic' || forced === 'claude') return load('anthropic');

  const grok = load('grok');
  if (grok && grok.hasKey()) return grok;

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
      hint: 'Set XAI_API_KEY (or GEMINI_API_KEY, or ANTHROPIC_API_KEY), or run with PSYCHEAI_MOCK=1.',
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
