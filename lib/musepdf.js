// A Muse report's PDF, made here when the plugin saves the report, so Muse
// can hand it over in the chat (README "Reads from Muse": "The PDF in the
// chat"). It is the same document the page downloads: the page's own PDF
// maker (docs/pdf.js) and vocabulary (docs/copy.js), fed the report the way
// the page adopts it (docs/reportshape.js, museProfile), run here in a sandbox
// of their own. The PDF is locked with the read's key like the read itself
// (lib/museimport.js sealPdf) and kept no longer than the read.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DOCS = path.join(__dirname, '..', 'docs');
let sandbox = null;

function load() {
  if (sandbox) return sandbox;
  const context = vm.createContext({ Blob, TextEncoder, TextDecoder, console, Math, Date, JSON, Intl });
  for (const file of ['copy.js', 'card.js', 'reportshape.js', 'pdf.js']) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, file), 'utf8'), context, { filename: file });
  }
  sandbox = context;
  return context;
}

/** "Psyche Report - Jared Sia - 29102026.pdf", as the page names it. */
function fileName(name, now = new Date()) {
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const who = String(name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim() || 'You';
  return `Psyche Report - ${who} - ${dd}${mm}${now.getUTCFullYear()}.pdf`;
}

/**
 * The PDF of a Muse report (the import bundle's data) as a Buffer.
 * Resolves to null if it can't be made; the read itself is unaffected.
 */
async function build(data, name, now = new Date()) {
  try {
    const ctx = load();
    const profile = ctx.PsycheReportShape.museProfile(data, name, ctx.PsycheCopy, ctx.PsycheCard);
    const date = now.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const blob = ctx.PsychePDF.build(profile.report, profile.card, {
      date, model: 'Muse', premiumModel: profile.premiumAnalysis ? 'Muse' : '', premiumDate: profile.premiumAnalysis ? date : '',
      history: [], asked: [], unlocked: ctx.PsycheReportShape.unlockedSections(profile), build: '',
      sources: [ctx.PsycheCopy.TEXT.sourceInstagram], counted: null,
    });
    return Buffer.from(await blob.arrayBuffer());
  } catch (error) {
    console.error('[musepdf] could not build the PDF:', error && error.message);
    return null;
  }
}

module.exports = { build, fileName };
