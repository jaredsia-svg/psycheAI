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
//
// The "combined" rows (October 2026) ask whether the card call and the
// report call could ever be one call: the structured full schema with the
// card's own fields (the free card schema's `card`) and the roast added —
// everything both calls write today, in one answer. Then the same with its
// enums made plain strings (option 1: the allowed values move into each
// field's description, and the server would check them), and the same again
// with the values dropped altogether, as the floor. "structured full, enums
// as strings" says whether enums alone are what tips today's refused schema.
//
// Run only some rows by naming a word in their labels:
//
//   GEMINI_API_KEY=... node tools/probe-schema.mjs combined
//   node tools/probe-schema.mjs --dry          (sizes only: no key, no calls)
//
// Production sends these to Vertex AI first, so test there too: with the
// server's variables set (GOOGLE_APPLICATION_CREDENTIALS or
// GOOGLE_APPLICATION_CREDENTIALS_JSON, GOOGLE_CLOUD_PROJECT, and
// GOOGLE_CLOUD_LOCATION if not global),
//
//   node tools/probe-schema.mjs --vertex combined
//
// `--key` forces the API key even where GOOGLE_GENAI_USE_VERTEXAI is set.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { GoogleGenAI } = require('@google/genai');
const prompts = require('../lib/prompts.js');

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

// Every enum made a plain string. With `list`, its allowed values go into the
// field's description, as option 1 would send them; without, they are gone.
function enumsAsStrings(schema, list) {
  const out = clone(schema);
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum)) {
      const values = node.enum;
      delete node.enum;
      if (list) {
        node.description = ((node.description || '').trim() + ' One of: ' +
          values.map(v => JSON.stringify(v)).join(', ') + '.').trim();
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(out);
  return out;
}

// Every enum a string except the character catalogue, the largest single
// list and the one the card most depends on getting exactly right.
function enumsAsStringsButCharacter(schema) {
  const out = enumsAsStrings(schema, true);
  out.properties.essence.properties.character = clone(schema.properties.essence.properties.character);
  return out;
}

// One call writing what the two write today: the full report, the card's
// own fields and the roast after them.
function combined() {
  const out = clone(prompts.STRUCTURED_FULL_SCHEMA);
  out.properties.card = clone(prompts.STRUCTURED_FREE_SCHEMA.properties.card);
  out.properties.bonus = clone(prompts.STRUCTURED_FREE_SCHEMA.properties.bonus);
  out.required = Object.keys(out.properties);
  return out;
}

// How much of a schema is constraint: enums, their values, and properties.
function weight(schema) {
  let enums = 0, values = 0, props = 0;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum)) { enums++; values += node.enum.length; }
    if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) props += Object.keys(node.properties).length;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(schema);
  return enums + ' enums, ' + values + ' values, ' + props + ' properties';
}

const S = prompts.STRUCTURED_FULL_SCHEMA;
const C = combined();
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
  ['  structured full, enums as strings, values listed', enumsAsStrings(S, true)],
  ['combined: card + report + roast in one call', C],
  ['  combined, enums as strings, values listed (option 1)', enumsAsStrings(C, true)],
  ['  combined, enums as strings except the character', enumsAsStringsButCharacter(C)],
  ['  combined, enums dropped, no values (the floor)', enumsAsStrings(C, false)],
  ['  combined, option 1 and nested arrays flattened', flattenNested(enumsAsStrings(C, true))],
];
// `node tools/probe-schema.mjs combined` runs only the rows whose label has that word.
// `--dry` prints each row's size and weight without calling Gemini or needing a key.
const dry = process.argv.includes('--dry');
const only = process.argv.slice(2).filter(word => !word.startsWith('--')).map(word => word.toLowerCase());
const chosen = only.length ? variants.filter(([label]) => only.some(word => label.toLowerCase().includes(word))) : variants;
if (dry) {
  for (const [label, schema] of chosen) console.log(label + '  (' + JSON.stringify(schema).length + ' chars, ' + weight(schema) + ')');
  process.exit(0);
}

// Which Gemini to ask. Production goes to Vertex AI first, and a schema
// Vertex refuses is not sent again with the API key (lib/gemini.js,
// isBackendFailure), so Vertex's verdict is the one that counts. `--vertex`
// (or GOOGLE_GENAI_USE_VERTEXAI=true, as on the server) reads the same
// service-account variables the server does; otherwise the API key (AI Studio).
const truthy = value => /^(1|true|yes|on)$/i.test(String(value || '').trim());
const useVertex = process.argv.includes('--vertex') ||
  (!process.argv.includes('--key') && truthy(process.env.GOOGLE_GENAI_USE_VERTEXAI || process.env.PSYCHEAI_GEMINI_VERTEX));
let client;
let backend;
// The model the server uses (lib/gemini.js, DEFAULT_MODEL) unless GEMINI_MODEL says otherwise.
let model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
if (useVertex) {
  const { readFileSync } = await import('node:fs');
  const inline = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '').trim();
  const file = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  let credentials = null;
  try {
    credentials = inline ? JSON.parse(inline) : file ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch (error) {
    console.error('The service-account key could not be read: ' + error.message);
    process.exit(1);
  }
  if (!credentials || !credentials.client_email || !credentials.private_key) {
    console.error('For Vertex, set GOOGLE_APPLICATION_CREDENTIALS (a key file path) or GOOGLE_APPLICATION_CREDENTIALS_JSON.');
    process.exit(1);
  }
  const project = String(process.env.GOOGLE_CLOUD_PROJECT || credentials.project_id || '').trim();
  const location = String(process.env.GOOGLE_CLOUD_LOCATION || 'global').trim();
  if (String(process.env.GEMINI_VERTEX_MODEL || '').trim()) model = String(process.env.GEMINI_VERTEX_MODEL).trim();
  client = new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
  backend = 'Vertex AI (' + project + ', ' + location + ')';
} else {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    console.error('Set GEMINI_API_KEY, or the Vertex variables with --vertex (or pass --dry to see the rows without calling Gemini).');
    process.exit(1);
  }
  client = new GoogleGenAI({ vertexai: false, apiKey: key });
  backend = 'API key (AI Studio)';
}

console.log('Backend: ' + backend + '\nModel: ' + model + '\n');
for (const [label, schema] of chosen) {
  const size = JSON.stringify(schema).length + ' chars, ' + weight(schema);
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
    console.log('ACCEPTED  ' + label + '  (' + size + ')');
  } catch (error) {
    const message = String((error && error.message) || error).replace(/\s+/g, ' ');
    // A bad key is also a 400 INVALID_ARGUMENT, and would read as every
    // schema refused.
    if (/API_KEY_INVALID|API key not valid/.test(message)) {
      console.error('That GEMINI_API_KEY was rejected — nothing about the schemas can be read from this run.');
      process.exit(1);
    }
    // Vertex's own access problems are not a verdict on the schema either.
    if (/PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant|SERVICE_DISABLED|has not been used in project/.test(message)) {
      console.error('Vertex AI refused the service account (' + message.slice(0, 200) + ') — nothing about the schemas can be read from this run.');
      process.exit(1);
    }
    // Only a 400 is a verdict on the schema; anything else is the probe failing.
    const verdict = /INVALID_ARGUMENT|\b400\b/.test(message) ? 'REFUSED ' : 'ERROR   ';
    console.log(verdict + '  ' + label + '  (' + size + ')  ' + message.slice(0, 220));
  }
}
