// What the model calls have actually cost.
//
//   npm run usage           # the last 30 days
//   npm run usage -- 7      # the last 7
//
// Reads lib/usage.js's ledger, which the server appends to after every model
// call. Deliberately a command rather than a route: spend is not something to
// put behind a URL, and the operator of this server has a shell.
//
// The number to look at is `cache hits`. The system prompt is ~15,000 tokens
// and is offered to Gemini's context cache on every profile run; if that share
// is near zero while calls are being made, the cache is cold or broken, and
// every one of those calls is paying full rate for the same 15,000 tokens.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const usage = await import(join(here, '..', 'lib', 'usage.js')).then(m => m.default || m);

const days = Number(process.argv[2]) || 30;
const t = usage.summary(days);

const money = n => '$' + n.toFixed(4);
const rows = [
  ['window', t.days + ' days'],
  ['calls', String(t.calls)],
  ['by kind', Object.keys(t.byKind).length
    ? Object.entries(t.byKind).map(([k, n]) => k + ' ' + n).join(', ') : '—'],
  ['models', t.models.length ? t.models.join(', ') : '—'],
  ['input tokens', t.input.toLocaleString()],
  ['output tokens', t.output.toLocaleString()],
  ['  of which thinking', t.output
    ? t.thinking.toLocaleString() + '  (' + (t.thinkingShare * 100).toFixed(0) + '%)' : '—'],
  ['cache hits', t.input ? (t.cachedShare * 100).toFixed(1) + '% of input tokens' : '—'],
  ['failed calls', t.failed ? t.failed + ' (' + Object.entries(t.failedBy).map(([k, n]) => k + ' ' + n).join(', ') +
    '), ' + money(t.failedCostUsd) + ' billed for nothing' : '0'],
  ['total', money(t.costUsd) + ' (estimated)'],
  ['per call', money(t.costPerCallUsd)],
];

console.log('\n  PsycheAI usage\n');
const width = Math.max(...rows.map(r => r[0].length)) + 2;
for (const [label, value] of rows) console.log('  ' + label.padEnd(width) + value);

if (!t.calls) {
  console.log('\n  No calls recorded. Either none have been made, or the ledger at');
  console.log('  ' + usage.STORE);
  console.log('  is not where this process is looking — on a host with an ephemeral');
  console.log('  filesystem it is wiped on every deploy. Set PSYCHEAI_USAGE_STORE to a');
  console.log('  path on a persistent disk.');
} else if (t.failedBy.MAX_TOKENS) {
  console.log('\n  Calls are being cut off at their output cap (MAX_TOKENS). At thinking level HIGH,');
  console.log('  Gemini 3 thinks until the cap is nearly spent, so a bigger cap only buys more');
  console.log('  thinking. Set PSYCHEAI_GEMINI_THINKING=MEDIUM (no deploy needed) and compare first:');
  console.log('  npm run compare -- <digest> --configs gemini-3.8-flash:HIGH,gemini-3.8-flash:MEDIUM');
} else if (t.thinkingShare > 0.5) {
  console.log('\n  Most of the output bill is thinking, and output bills at five times');
  console.log('  input. thinkingLevel is set in lib/gemini.js; lowering it is the only');
  console.log('  knob that reduces this without shortening the report itself. Measure a');
  console.log('  few runs at the lower level before keeping it.');
} else if (t.cachedShare < 0.2 && t.cachedShare > 0) {
  console.log('\n  Cache hits are low, and caching is switched on. Either the TTL is');
  console.log('  shorter than the gap between calls, or creates are failing. Caching only');
  console.log('  pays above about one call an hour — see the break-even in lib/gemini.js —');
  console.log('  so below that, PSYCHEAI_GEMINI_CACHE_TTL=0 is cheaper than a short TTL.');
}
console.log('');
