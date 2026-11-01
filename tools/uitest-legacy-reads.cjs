// Loaded with -r into the server the UI suite starts for Muse reads (tools/uitest.mjs).
// A Muse read is no longer kept (README "Muse reads: nothing kept"), but reads saved
// before 1 Nov 2026 still open from their links until they expire, so the suite seals
// a few the old way, in the server's own in-memory store, and writes their links to
// UITEST_LEGACY_READS for the page tests to open. Nothing here runs in production.
const fs = require('node:fs');
const museImport = require('../lib/museimport.js');
const mock = require('../lib/mock.js');

(async () => {
  const answer = (await mock.analyseMerged({})).data;
  const checked = museImport.bundleFrom(answer);
  if (!checked.ok) throw new Error('the mock read fails the checks: ' + checked.problems.join('; '));
  const links = [];
  for (let i = 0; i < 6; i++) {
    const sealed = await museImport.seal(checked.bundle, 'Mei Tan');
    links.push('https://psycheai.io/?m=' + sealed.id + '#' + sealed.key);
  }
  fs.writeFileSync(process.env.UITEST_LEGACY_READS, JSON.stringify(links));
})().catch(error => { console.error('[uitest] could not seal the older reads:', error.message); process.exit(1); });
