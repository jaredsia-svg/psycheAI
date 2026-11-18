// Lists the Grok (xAI) models your key can actually use.
//
// Model IDs change often enough that a hard-coded default goes stale; this is
// how you find a current one to put in XAI_MODEL.
//
//   XAI_API_KEY=... node tools/models-grok.mjs
const grok = await import('../lib/grok.js').then(m => m.default);

if (!grok.hasKey()) {
  console.error('Set XAI_API_KEY first.');
  process.exit(1);
}

try {
  const models = await grok.listModels();
  if (!models.length) {
    console.log('No models returned for this key.');
  } else {
    console.log('\nModels available to this key (usable as XAI_MODEL):\n');
    for (const model of models) {
      console.log('  ' + model.id);
    }
    console.log('\nCurrently configured: ' + grok.MODEL + '\n');
  }
} catch (error) {
  console.error('Could not list models: ' + grok.describeError(error).message);
  process.exit(1);
}
