// The unlock that adds data: two calls (the card, then the report anchored to
// it) against one (lib/prompts.js, MERGED_SYSTEM) — on the same digest, side
// by side, before PSYCHEAI_MERGED_UNLOCK is switched on.
//
//   GEMINI_API_KEY=... npm run compare:unlock -- <digest> [--runs 3] [--out dir]
//
// <digest> is what `npm run compare` takes: the review screen's "Download
// what's being sent" HTML, a digest saved as JSON, or an Instagram export .zip.
//
// What it measures, for each way and run:
//   - the conclusions (type, letters, Big Five bands, character), how often
//     each way agrees with itself and how often the two agree with each other
//     — read against each way's own stability, since the card is never the
//     same twice;
//   - how much each part of the report says (words per section), which is
//     where one call doing two jobs would thin out first;
//   - the card's rules: nothing romantic and no unflattering word on what is
//     printed on it, the roast written, the Overview whole;
//   - the one call's checks: answers sent back to two calls, values dropped;
//   - cost and time.
//
// And it writes every answer to --out (default ./compare-unlock-out), with a
// side-by-side page of the parts a reader reads first — the card's lines, the
// Overview, the roast, the plan — to read for yourself. That folder holds a
// real person's reading: it is in .gitignore, keep it private, and delete it
// when you are done.
//
// Each run of the two ways is about 30 cents of real calls. `--mock` runs it
// all free against lib/mock.js, which is what the test suite does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digestFrom, conclusions, agreement } from './compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const words = text => String(text || '').split(/\s+/).filter(Boolean).length;
/** Every string under a value, as one word count. */
function wordsIn(value) {
  if (typeof value === 'string') return words(value);
  if (Array.isArray(value)) return value.reduce((n, v) => n + wordsIn(v), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((n, v) => n + wordsIn(v), 0);
  return 0;
}

const ROMANCE = /\b(dat(e|es|ing)|romanc\w*|romantic|partner|boyfriend|girlfriend|crush|flirt\w*|lover)\b/i;
// The words the card's rules name as never printed on it, and a few like them.
const UNFLATTERING = /\b(guarded|avoidant|needy|stubborn|cold|overthink\w*|insecure|anxious|lazy|selfish|aloof|controlling|clingy)\b/i;

/** What one way produced, in the terms the comparison reads. */
export function profileOf(card, report) {
  const c = card || {};
  const r = report || {};
  const patterns = Array.isArray(c.patterns) ? c.patterns : [];
  // What is printed on the card: its own lines, the write-up and the pattern names.
  const printed = [c.cardHighlights, ...patterns.map(p => p && p.name),
    ...Object.values(c.card || {}).filter(v => typeof v === 'string'),
    ...Object.values(c.card || {}).filter(Array.isArray).flat().filter(v => typeof v === 'string')].join(' \n ');
  const sections = {};
  for (const key of ['bigFive', 'mbti', 'motivators', 'interests', 'values', 'relationship', 'career', 'wellness',
    'attachment', 'idealPartner', 'careerAssessment', 'development', 'essence']) sections[key] = wordsIn(r[key]);
  const scores = (r.motivators && Array.isArray(r.motivators.scores)) ? r.motivators.scores : [];
  const top = scores.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(row => row.value);
  return {
    conclusions: conclusions(c),
    overview: {
      summaryWords: words(c.summary),
      patterns: patterns.length,
      evidence: patterns.reduce((n, p) => n + ((p && p.evidence) || []).length, 0),
      showsUpIn: patterns.reduce((n, p) => n + ((p && p.showsUpIn) || []).length, 0),
    },
    card: {
      highlightWords: words(c.cardHighlights),
      romance: (printed.match(ROMANCE) || [null])[0],
      unflattering: (printed.match(UNFLATTERING) || [null])[0],
    },
    roastWords: words(c.bonus && c.bonus.harsh) + words(c.bonus && c.bonus.advice),
    reportWords: Object.values(sections).reduce((a, b) => a + b, 0),
    sections,
    // The report holds the card's three motivators as its three highest.
    motivatorsAgree: top.length === 3 && JSON.stringify(top) === JSON.stringify((c.topMotivators || []).slice(0, 3)),
    developItems: ((r.development && r.development.develop) || []).length,
  };
}

const mean = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/** One way's runs, summed up. */
export function summariseWay(runs) {
  const ok = runs.filter(run => run.profile);
  const sectionKeys = ok.length ? Object.keys(ok[0].profile.sections) : [];
  return {
    runs: runs.length,
    failed: runs.length - ok.length,
    fallbacks: runs.filter(run => run.fallback).length,
    dropped: runs.reduce((n, run) => n + ((run.dropped || []).length), 0),
    stability: ok.length > 1 ? agreement(ok[0].profile.conclusions, ok.slice(1).map(run => run.profile.conclusions)) : null,
    cost: mean(runs.map(run => run.cost).filter(c => c !== null && c !== undefined)),
    seconds: mean(runs.map(run => run.seconds)),
    reportWords: mean(ok.map(run => run.profile.reportWords)),
    sections: Object.fromEntries(sectionKeys.map(key => [key, mean(ok.map(run => run.profile.sections[key]))])),
    summaryWords: mean(ok.map(run => run.profile.overview.summaryWords)),
    evidence: mean(ok.map(run => run.profile.overview.evidence)),
    highlightWords: mean(ok.map(run => run.profile.card.highlightWords)),
    roastWords: mean(ok.map(run => run.profile.roastWords)),
    cardFlags: ok.filter(run => run.profile.card.romance || run.profile.card.unflattering)
      .map(run => run.profile.card.romance || run.profile.card.unflattering),
    motivatorsAgree: ok.filter(run => run.profile.motivatorsAgree).length,
    developItems: mean(ok.map(run => run.profile.developItems)),
  };
}

function option(name, fallback) {
  const at = process.argv.indexOf('--' + name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

function sideBySide(two, one) {
  const block = (title, pick) => '## ' + title + '\n\n' +
    '| Two calls (today) | One call |\n|---|---|\n' +
    Array.from({ length: Math.max(two.length, one.length) }, (_, i) => {
      const cell = run => (run && run.card ? String(pick(run) || '—') : (run ? '(failed)' : '')).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
      return '| ' + cell(two[i]) + ' | ' + cell(one[i]) + ' |';
    }).join('\n') + '\n\n';
  const pats = run => (run.card.patterns || []).map(p => '**' + p.name + '**: ' + p.line).join('<br>');
  const plan = run => (((run.report.development || {}).develop) || []).map(d => '**' + d.area + '**: ' +
    ((d.actions || []).map(a => a.step).join(' / '))).join('<br>');
  return '# Two calls against one, side by side\n\nOne row per run. A real person\'s reading: keep this private.\n\n' +
    block('Character and type', run => run.card.essence.character + ' · ' + run.card.mbti.type) +
    block('Card write-up (printed)', run => run.card.cardHighlights) +
    block('Executive summary (Overview)', run => run.card.summary) +
    block('Signature patterns', pats) +
    block('The roast', run => (run.card.bonus || {}).harsh) +
    block('Development plan', plan);
}

async function main() {
  const path = process.argv.slice(2).find((arg, i, all) => !arg.startsWith('--') &&
    !['--runs', '--out'].includes(all[i - 1]));
  if (!path) {
    console.log('\n  Usage: npm run compare:unlock -- <digest.html | digest.json | export.zip> [--runs 3] [--out dir] [--mock]\n');
    process.exit(1);
  }
  const mock = process.argv.includes('--mock');
  const prompts = await import(join(root, 'lib', 'prompts.js')).then(m => m.default || m);
  const usage = await import(join(root, 'lib', 'usage.js')).then(m => m.default || m);
  const engine = mock
    ? await import(join(root, 'lib', 'mock.js')).then(m => m.default || m)
    : await import(join(root, 'lib', 'gemini.js')).then(m => m.default || m);
  if (!mock && !engine.hasKey()) {
    console.log('\n  compare:unlock skipped — set GEMINI_API_KEY to run real calls, or pass --mock.\n');
    process.exit(0);
  }
  const runs = Math.max(1, Math.min(5, Number(option('runs', 3)) || 3));
  const out = option('out', 'compare-unlock-out');
  const digest = await digestFrom(path);
  console.log('\n  PsycheAI unlock comparison: two calls against one');
  console.log('  digest   ' + JSON.stringify(digest).length.toLocaleString() + ' characters');
  console.log('  runs     ' + runs + ' of each' + (mock ? ' (mock, free)' : ' — roughly $' + (runs * 0.3).toFixed(2) + ' in all'));

  const price = (u, model) => usage.priceOf(model || 'mock', Number(u && u.inputTokens) || 0,
    Number(u && u.outputTokens) || 0, Number(u && u.cachedTokens) || 0);
  const ways = { two: [], one: [] };
  for (let i = 0; i < runs; i++) {
    // Today: the card, then the report anchored to it.
    {
      const started = Date.now();
      const run = { seconds: 0, cost: null };
      try {
        const card = await engine.analyseCard(digest);
        const full = await engine.analyseFull(digest, prompts.anchorFrom(card.data));
        run.card = card.data;
        run.report = full.data;
        run.cost = (price(card.usage, card.model) || 0) + (price(full.usage, full.model) || 0);
      } catch (error) {
        run.error = String((error && error.message) || error).slice(0, 120);
      }
      run.seconds = (Date.now() - started) / 1000;
      if (run.card) run.profile = profileOf(run.card, run.report);
      ways.two.push(run);
    }
    // One call, checked and split as the server does it.
    {
      const started = Date.now();
      const run = { seconds: 0, cost: null };
      try {
        const merged = await engine.analyseMerged(digest);
        run.cost = price(merged.usage, merged.model);
        const checked = prompts.checkMerged(merged.data);
        run.dropped = checked.dropped;
        if (!checked.ok) {
          run.fallback = checked.problems.slice(0, 4).join('; ');
        } else {
          const split = prompts.splitMerged(checked.data);
          run.card = split.card;
          run.report = split.full;
        }
      } catch (error) {
        run.error = String((error && error.message) || error).slice(0, 120);
        if (error && error.usage) run.cost = price(error.usage, error.model);
      }
      run.seconds = (Date.now() - started) / 1000;
      if (run.card) run.profile = profileOf(run.card, run.report);
      ways.one.push(run);
    }
    for (const [label, run] of [['two calls', ways.two[i]], ['one call ', ways.one[i]]]) {
      const p = run.profile;
      console.log('  run ' + (i + 1) + '  ' + label + '  ' +
        (p ? (p.conclusions.type + ' · ' + p.conclusions.character).padEnd(26) + String(p.reportWords).padStart(6) + ' words'
          : ('SENT BACK TO TWO CALLS: ' + (run.fallback || run.error || '')).slice(0, 70)) +
        '  ' + (run.cost === null ? '' : '$' + run.cost.toFixed(4)) + '  ' + Math.round(run.seconds) + 's');
    }
  }

  const two = summariseWay(ways.two);
  const one = summariseWay(ways.one);
  const firstTwo = ways.two.find(run => run.profile);
  const across = firstTwo ? agreement(firstTwo.profile.conclusions, ways.one.filter(run => run.profile).map(run => run.profile.conclusions)) : null;
  const pct = x => (x === null || x === undefined ? '—' : Math.round(x * 100) + '%');
  const num = x => (x === null || x === undefined ? '—' : String(Math.round(x)));
  const row = (label, a, b) => console.log('  ' + label.padEnd(40) + String(a).padEnd(16) + String(b));
  console.log('\n  ' + ''.padEnd(40) + 'two calls'.padEnd(16) + 'one call');
  row('answers sent back to two calls', '—', one.fallbacks + ' of ' + one.runs);
  row('failed', two.failed + ' of ' + two.runs, one.failed + ' of ' + one.runs);
  row('values dropped by the checks', '—', one.dropped);
  row('type agrees with its own first run', pct(two.stability && two.stability.type), pct(one.stability && one.stability.type));
  row('character agrees with its own first run', pct(two.stability && two.stability.character), pct(one.stability && one.stability.character));
  row('Big Five bands agree with own first run', pct(two.stability && two.stability.bigFiveBands), pct(one.stability && one.stability.bigFiveBands));
  row('report words', num(two.reportWords), num(one.reportWords));
  for (const key of Object.keys(two.sections)) row('  ' + key, num(two.sections[key]), num(one.sections[key]));
  row('summary words', num(two.summaryWords), num(one.summaryWords));
  row('pattern evidence items', num(two.evidence), num(one.evidence));
  row('card write-up words', num(two.highlightWords), num(one.highlightWords));
  row('roast words', num(two.roastWords), num(one.roastWords));
  row('development areas', num(two.developItems), num(one.developItems));
  row('report\'s top 3 motivators = the card\'s', two.motivatorsAgree + ' of ' + two.runs, one.motivatorsAgree + ' of ' + one.runs);
  row('card words its rules forbid', two.cardFlags.join(', ') || 'none', one.cardFlags.join(', ') || 'none');
  row('cost per unlock', two.cost === null ? '—' : '$' + two.cost.toFixed(4), one.cost === null ? '—' : '$' + one.cost.toFixed(4));
  row('seconds per unlock', num(two.seconds), num(one.seconds));
  if (across) {
    console.log('\n  One call against two (the first two-call run): type ' + pct(across.type) + ', character ' +
      pct(across.character) + ', Big Five bands ' + pct(across.bigFiveBands) + '.');
  }
  console.log('\n  Read it as: the one call is as good when it is never sent back, its agreement with the two calls');
  console.log('  is about as high as the two calls\' agreement with themselves, its sections are about as long, and');
  console.log('  its card has no word the rules forbid. Then read ' + join(out, 'side-by-side.md') + ' yourself.\n');

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'runs.json'), JSON.stringify({ two: ways.two, one: ways.one, summary: { two, one, across } }, null, 2));
  writeFileSync(join(out, 'side-by-side.md'), sideBySide(ways.two, ways.one));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error('\n  compare:unlock failed: ' + ((error && error.message) || error) + '\n');
    process.exit(1);
  });
}
