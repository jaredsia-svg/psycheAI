// How stable the free card is, what it costs, and what a different model or
// thinking level would do to it — measured on a real digest rather than argued.
//
//   GEMINI_API_KEY=... npm run compare -- <digest> [--runs 3] [--configs a,b,...]
//
// <digest> is any of:
//   - the "Download what's being sent" HTML file from the review screen
//     (psycheai-digest-preview.html), which is the digest exactly as sent;
//   - a digest saved as JSON;
//   - an Instagram export .zip, built into a digest the way the app builds it.
//
// --configs takes `model:thinking` pairs. The first is the baseline every
// other is compared against; it defaults to the production setting alone, which
// measures how stable the card is from one run to the next — the number every
// other comparison has to be read against, since a model that disagrees with
// itself a third of the time cannot be expected to agree with anything else
// more often than that.
//
//   npm run compare -- digest.html --runs 3 \
//     --configs gemini-3.8-flash:HIGH,gemini-3.8-flash:LOW
//
// Every run is a real model call and costs real money: about five cents each
// at the production setting. The total is printed before anything is sent.
// `--mock` runs the whole thing against lib/mock.js for free, which is what the
// test suite does.
import { readFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInThisContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let browserLoaded = false;
function loadBrowserModules() {
  if (browserLoaded) return;
  for (const file of ['zip.js', 'instagram.js', 'supplement.js', 'digest.js']) {
    runInThisContext(readFileSync(join(root, 'docs', file), 'utf8'), { filename: file });
  }
  browserLoaded = true;
}

/** The digest object out of the review screen's download, which escapes it into a <pre>. */
export function digestFromHtml(html) {
  const match = /<pre>([\s\S]*?)<\/pre>/.exec(String(html));
  if (!match) throw new Error('No digest found in that HTML file — is it the review screen\'s download?');
  const text = match[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(text);
}

async function digestFrom(path) {
  loadBrowserModules();
  const Digest = globalThis.PsycheDigest;
  const ext = extname(path).toLowerCase();
  let digest;
  if (ext === '.zip') {
    const file = new File([readFileSync(path)], 'export.zip', { type: 'application/zip' });
    const signals = await globalThis.PsycheInstagram.readExports([file], { includeMessages: true });
    digest = Digest.build(signals, { includeMessages: true });
  } else if (ext === '.html' || ext === '.htm') {
    digest = digestFromHtml(readFileSync(path, 'utf8'));
  } else {
    digest = JSON.parse(readFileSync(path, 'utf8'));
  }
  // Exactly what the server would send the model, whatever the file held.
  return Digest.forModel(digest);
}

/** `model:thinking` pairs, comma separated. A bare thinking level keeps the default model. */
export function parseConfigs(text, defaultModel) {
  const items = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return [{ model: defaultModel, thinkingLevel: 'HIGH' }];
  return items.map(item => {
    const at = item.lastIndexOf(':');
    if (at < 0) {
      return /^[A-Z]+$/.test(item)
        ? { model: defaultModel, thinkingLevel: item }
        : { model: item, thinkingLevel: 'HIGH' };
    }
    return { model: item.slice(0, at) || defaultModel, thinkingLevel: item.slice(at + 1).toUpperCase() || 'HIGH' };
  });
}

/** The parts of a card a reader would notice changing. */
export function conclusions(data) {
  const d = data || {};
  const letters = {};
  for (const letter of (d.mbti && d.mbti.letters) || []) {
    if (letter && letter.axis) letters[letter.axis] = { choice: letter.choice, strength: letter.strength };
  }
  const bands = {};
  const scores = {};
  for (const [trait, row] of Object.entries(d.bigFive || {})) {
    bands[trait] = row && row.band;
    scores[trait] = Number(row && row.score);
  }
  return {
    type: d.mbti && d.mbti.type,
    letters,
    enneagram: d.enneagram ? String(d.enneagram.type || '') + (d.enneagram.wing ? 'w' + d.enneagram.wing : '') : '',
    bands,
    scores,
    character: d.essence && d.essence.character,
  };
}

/**
 * How far a set of runs agrees with a baseline, as shares from 0 to 1, and how
 * far the Big Five scores move on average. One baseline, many runs, so the
 * same function measures a configuration's stability against its own first run
 * and an alternative's agreement with the production one.
 */
export function agreement(baseline, runs) {
  const n = runs.length;
  if (!n) return null;
  const axes = Object.keys(baseline.letters);
  const traits = Object.keys(baseline.bands);
  let type = 0; let letterHits = 0; let strengthHits = 0; let ennea = 0; let bandHits = 0; let character = 0;
  let scoreDiff = 0; let scoreCount = 0;
  for (const run of runs) {
    if (run.type === baseline.type) type += 1;
    if (run.enneagram === baseline.enneagram) ennea += 1;
    if (run.character === baseline.character) character += 1;
    for (const axis of axes) {
      const a = baseline.letters[axis];
      const b = run.letters[axis];
      if (b && b.choice === a.choice) letterHits += 1;
      if (b && b.choice === a.choice && b.strength === a.strength) strengthHits += 1;
    }
    for (const trait of traits) {
      if (run.bands[trait] === baseline.bands[trait]) bandHits += 1;
      if (Number.isFinite(run.scores[trait]) && Number.isFinite(baseline.scores[trait])) {
        scoreDiff += Math.abs(run.scores[trait] - baseline.scores[trait]);
        scoreCount += 1;
      }
    }
  }
  return {
    runs: n,
    type: type / n,
    letters: axes.length ? letterHits / (n * axes.length) : 1,
    lettersWithStrength: axes.length ? strengthHits / (n * axes.length) : 1,
    enneagram: ennea / n,
    bigFiveBands: traits.length ? bandHits / (n * traits.length) : 1,
    bigFiveMeanScoreDiff: scoreCount ? scoreDiff / scoreCount : 0,
    character: character / n,
  };
}

/**
 * One row per configuration. The first is the baseline, compared with its own
 * first run — how often the production card agrees with itself — so its first
 * run is left out of its own comparison; counting it would score every
 * baseline at least one run's worth of agreement it never earned.
 */
export function summarise(results) {
  if (!results.length) return [];
  // The baseline's first card that came back. If every baseline run failed
  // there is nothing to compare against, which the table says rather than
  // inventing a number.
  const baseline = results[0].cards[0];
  return results.map((r, index) => {
    const priced = r.costs.filter(c => c !== null && c !== undefined);
    return {
      label: r.config.model + ':' + r.config.thinkingLevel + (index === 0 ? ' (baseline, vs itself)' : ''),
      failed: r.failed || 0,
      runs: (r.cards.length || 0) + (r.failed || 0),
      against: !baseline ? null
        : index === 0 ? agreement(baseline, r.cards.slice(1)) : agreement(baseline, r.cards),
      cost: priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null,
      thinking: r.thinking.length ? r.thinking.reduce((a, b) => a + b, 0) / r.thinking.length : 0,
    };
  });
}

function flag(name) {
  return process.argv.includes('--' + name);
}

function option(name, fallback) {
  const at = process.argv.indexOf('--' + name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
  const path = process.argv.slice(2).find(arg => !arg.startsWith('--') &&
    process.argv[process.argv.indexOf(arg) - 1] !== '--runs' &&
    process.argv[process.argv.indexOf(arg) - 1] !== '--configs');
  if (!path) {
    console.log('\n  Usage: npm run compare -- <digest.html | digest.json | export.zip> ' +
      '[--runs 3] [--configs model:THINKING,...] [--mock]\n');
    process.exit(1);
  }
  const mock = flag('mock');
  const usage = await import(join(root, 'lib', 'usage.js')).then(m => m.default || m);
  const engine = mock
    ? await import(join(root, 'lib', 'mock.js')).then(m => m.default || m)
    : await import(join(root, 'lib', 'gemini.js')).then(m => m.default || m);
  if (!mock && !engine.hasKey()) {
    console.log('\n  compare skipped — set GEMINI_API_KEY to run real calls, or pass --mock.\n');
    process.exit(0);
  }

  const runs = Math.max(1, Math.min(10, Number(option('runs', 3)) || 3));
  const configs = parseConfigs(option('configs', ''), engine.MODEL);
  const digest = await digestFrom(path);
  const calls = runs * configs.length;
  console.log('\n  PsycheAI card comparison');
  console.log('  digest       ' + JSON.stringify(digest).length.toLocaleString() + ' characters');
  console.log('  configs      ' + configs.map(c => c.model + ':' + c.thinkingLevel).join(', '));
  console.log('  calls        ' + calls + (mock ? ' (mock, free)' : ' — roughly $' + (calls * 0.05).toFixed(2) +
    ' at the production setting'));

  const results = [];
  for (const config of configs) {
    const cards = [];
    const costs = [];
    const thinking = [];
    let failed = 0;
    for (let i = 0; i < runs; i++) {
      const started = Date.now();
      // A run that is cut off (MAX_TOKENS) or refused is counted, not fatal:
      // how often a setting fails is one of the things being measured, and a
      // cut-off call is billed like any other, so its cost still counts.
      let result = null;
      let failure = null;
      try {
        result = await engine.analyseCard(digest, mock ? undefined : config);
      } catch (error) {
        failure = error;
      }
      const u = (result ? result.usage : failure && failure.usage) || {};
      const model = (result ? result.model : failure && failure.model) || config.model;
      const cost = usage.priceOf(model, Number(u.inputTokens) || 0, Number(u.outputTokens) || 0,
        Number(u.cachedTokens) || 0);
      costs.push(cost);
      thinking.push(Number(u.thinkingTokens) || 0);
      let what;
      if (result) {
        const c = conclusions(result.data);
        cards.push(c);
        what = String(c.type).padEnd(5) + ' ' + String(c.enneagram).padEnd(4);
      } else {
        failed += 1;
        what = ('FAILED ' + ((failure && failure.finishReason) || 'error')).padEnd(10);
      }
      console.log('  ' + (config.model + ':' + config.thinkingLevel).padEnd(28) + ' run ' + (i + 1) + '  ' +
        what + '  ' + (u.inputTokens || 0) + ' in / ' + (u.outputTokens || 0) + ' out (' +
        (u.thinkingTokens || 0) + ' thinking)  ' + (cost === null ? 'unpriced' : '$' + cost.toFixed(4)) + '  ' +
        Math.round((Date.now() - started) / 1000) + 's' +
        (failure && !failure.usage ? '  ' + String(failure.message || failure).slice(0, 80) : ''));
    }
    results.push({ config, cards, costs, thinking, failed });
  }

  const pct = x => (x === null || x === undefined ? '—' : Math.round(x * 100) + '%');
  const rows = summarise(results);
  console.log('\n  ' + 'config'.padEnd(46) + 'type  letters  +strength  ennea  bands  Δscore  char   $/card  thinking  failed');
  for (const row of rows) {
    const a = row.against;
    console.log('  ' + row.label.padEnd(46) + (a ? [
      pct(a.type).padEnd(6), pct(a.letters).padEnd(9), pct(a.lettersWithStrength).padEnd(11),
      pct(a.enneagram).padEnd(7), pct(a.bigFiveBands).padEnd(7), a.bigFiveMeanScoreDiff.toFixed(1).padEnd(8),
      pct(a.character).padEnd(7),
    ].join('') : '(one run: nothing to compare)'.padEnd(63)) +
      (row.cost === null ? 'unpriced' : '$' + row.cost.toFixed(4)).padEnd(9) +
      String(Math.round(row.thinking)).padEnd(10) + row.failed + ' of ' + row.runs);
  }
  console.log('\n  A setting that fails any of its runs is not usable as it stands, however well the rest agree.');
  console.log('  Read the baseline row first: it is how often the production card agrees with itself.');
  console.log('  An alternative is as good as the baseline when its row is about as high as that one.\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error('\n  compare failed: ' + ((error && error.message) || error) + '\n');
    process.exit(1);
  });
}
