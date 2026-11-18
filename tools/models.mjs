// Lists the Gemini models your key can actually use.
//
// Model IDs change often enough that a hard-coded default goes stale; this is
// how you find a current one to put in GEMINI_MODEL.
//
//   GEMINI_API_KEY=... node tools/models.mjs
const gemini = await import('../lib/gemini.js').then(m => m.default);

if (!gemini.hasKey()) {
  console.error('Set GEMINI_API_KEY (or GOOGLE_API_KEY) first.');
  process.exit(1);
}

try {
  const models = await gemini.listModels();
  if (!models.length) {
    console.log('No models returned for this key.');
  } else {
    console.log('\nModels available to this key (usable as GEMINI_MODEL):\n');
    for (const model of models) {
      console.log('  ' + model.id.padEnd(38) + (model.label || ''));
    }
    console.log('\nCurrently configured: ' + gemini.MODEL + '\n');
  }
} catch (error) {
  console.error('Could not list models: ' + gemini.describeError(error).message);
  process.exit(1);
}
