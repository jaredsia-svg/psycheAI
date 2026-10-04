// Which part of a response schema does Gemini refuse?
//
// Gemini answers a schema it will not serve with a bare 400 "Request contains
// an invalid argument." and nothing about which part. This sends each schema,
// and the structured full schema with one piece removed or simplified at a
// time, against a one-line prompt, and prints which are accepted. A refusal
// is decided before the model runs and costs nothing; an accepted probe is
// one short answer, about a cent in total across the run.
//
//   GEMINI_API_KEY=... node tools/probe-schema.mjs
//
// Read it as: the controls should be accepted, "structured full" refused, and
// the variant that turns accepted names the part to change.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { GoogleGenAI } = require('@google/genai');
const prompts = require('../lib/prompts.js');

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!key) {
  console.error('Set GEMINI_API_KEY first.');
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const client = new GoogleGenAI({ apiKey: key });
const clone = value => JSON.parse(JSON.stringify(value));

function without(schema, name) {
  const out = clone(schema);
  delete out.properties[name];
  out.required = (out.required || []).filter(k => k !== name);
  return out;
}

// Every array inside an array's items becomes a plain string.
function flattenNested(schema) {
  const out = clone(schema);
  const walk = (node, inArray) => {
    if (!node || typeof node !== 'object') return;
    if (node.properties) {
      for (const [k, v] of Object.entries(node.properties)) {
        if (inArray && v.type === 'array') node.properties[k] = { type: 'string', description: v.description || '' };
        else walk(v, inArray);
      }
    }
    if (node.items) walk(node.items, true);
  };
  walk(out, false);
  return out;
}

// Every enum list held inside an array becomes a free string.
function noEnumArrays(schema) {
  const out = clone(schema);
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'array' && node.items && node.items.enum) delete node.items.enum;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(out);
  return out;
}

// The property named `pattern`, which shares its name with a JSON Schema keyword.
function renamePattern(schema) {
  return JSON.parse(JSON.stringify(schema)
    .replace(/"pattern":\{/g, '"patternId":{')
    .replace(/"pattern"(?=[,\]])/g, '"patternId"'));
}

const S = prompts.STRUCTURED_FULL_SCHEMA;
const variants = [
  ['control: classic full', prompts.CLASSIC_FULL_SCHEMA],
  ['control: structured free', prompts.STRUCTURED_FREE_SCHEMA],
  ['FIX: structured pinned (what the unlock sends)', prompts.STRUCTURED_PINNED_FULL_SCHEMA],
  ['structured full', S],
  ['  without patterns', without(S, 'patterns')],
  ['  without motivators', without(S, 'motivators')],
  ['  without development', without(S, 'development')],
  ['  without pressurePoints', without(S, 'pressurePoints')],
  ['  without all four', ['patterns', 'motivators', 'development', 'pressurePoints'].reduce(without, S)],
  ['  nested arrays flattened', flattenNested(S)],
  ['  no enum lists in arrays', noEnumArrays(S)],
  ['  `pattern` renamed', renamePattern(S)],
];

console.log('Model: ' + model + '\n');
for (const [label, schema] of variants) {
  const size = JSON.stringify(schema).length;
  try {
    await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'Fill the schema with placeholder values. Keep every string under five words.' }] }],
      config: {
        systemInstruction: 'You are a schema test. Answer briefly.',
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    });
    console.log('ACCEPTED  ' + label + '  (' + size + ' chars)');
  } catch (error) {
    const message = String((error && error.message) || error).replace(/\s+/g, ' ');
    // A bad key is also a 400 INVALID_ARGUMENT, and would read as every
    // schema refused.
    if (/API_KEY_INVALID|API key not valid/.test(message)) {
      console.error('That GEMINI_API_KEY was rejected — nothing about the schemas can be read from this run.');
      process.exit(1);
    }
    // Only a 400 is a verdict on the schema; anything else is the probe failing.
    const verdict = /INVALID_ARGUMENT|\b400\b/.test(message) ? 'REFUSED ' : 'ERROR   ';
    console.log(verdict + '  ' + label + '  (' + size + ' chars)  ' + message.slice(0, 220));
  }
}
