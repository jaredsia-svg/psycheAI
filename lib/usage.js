// What each model call actually cost, recorded from what the provider reported.
//
// Every engine already returns `usage` — gemini.js reads `promptTokenCount`,
// `candidatesTokenCount`, `thoughtsTokenCount` and `cachedContentTokenCount`
// off the response and hands them back — and until this file existed the
// server threw all of it away. The effect was that nobody could answer the
// only two questions that matter about spend: what a run really costs, and
// whether the context cache is being hit at all.
//
// The second is the one that hides. gemini.js says it plainly beside the
// numbers it returns: a cache that has silently stopped being hit looks
// exactly like one that works, because both produce correct reports at the
// same speed. The bill is the only place the difference shows, and the bill
// arrives a month late with no per-call breakdown in it.
//
// So this records the facts and derives the money, rather than the other way
// round. Token counts come from the provider and are ground truth; the dollar
// figure is arithmetic over a rate table that can go stale, which is why both
// are written to every line.
'use strict';

const fs = require('fs');
const path = require('path');

const STORE = process.env.PSYCHEAI_USAGE_STORE ||
  path.join(__dirname, '..', 'data', 'usage.jsonl');

// Dollars per token. The input and output rates are the same numbers
// docs/digest.js carries in MODEL_RATES, and a check in tools/selftest.mjs
// fails when the two copies disagree — the browser cannot require() this file
// and this file must not import a browser bundle, so the duplication is
// deliberate and the check is what keeps it honest.
//
// `cachedInput` is the reduced rate a token served from context cache is
// billed at, and it is the one number here that nothing else in the codebase
// knows. Gemini prices cache hits at a quarter of the ordinary input rate; if
// that changes, this is the line to change, and the `costEstimated` flag on
// every row is there so a reader knows the money was derived rather than
// reported.
const RATES = {
  'gemini-3.8-flash': { input: 0.75 / 1e6, cachedInput: 0.1875 / 1e6, output: 3.75 / 1e6 },
  'gemini-3.7-flash': { input: 0.75 / 1e6, cachedInput: 0.1875 / 1e6, output: 3.75 / 1e6 },
};

// A model with no rates is logged with its tokens and no dollar figure, rather
// than silently priced as free or refused. Losing the cost estimate on an
// unfamiliar model is a much smaller failure than losing the record of the
// call, and switching model is exactly when the record matters most.
function priceOf(model, input, output, cached) {
  const rates = RATES[model];
  if (!rates) return null;
  const uncached = Math.max(0, input - cached);
  return uncached * rates.input + cached * rates.cachedInput + output * rates.output;
}

/**
 * Records one model call.
 *
 * Never throws. A disk that is full or read-only must not turn a report the
 * reader is waiting for into an error — this is observability, and
 * observability that can break the product is worth less than no
 * observability at all. The same reasoning lib/gemini.js applies to the cache
 * it may fail to create.
 *
 * @param {string} kind     'analyse' | 'premium' | 'compatibility'
 * @param {object} result   an engine result: { usage, model }
 * @param {boolean} paid    whether a reader paid for this one
 */
function record(kind, result, paid) {
  const usage = (result && result.usage) || {};
  const model = String((result && result.model) || 'unknown');
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const cached = Number(usage.cachedTokens) || 0;
  // Part of `output`, not additional to it — thinking is billed at the output
  // rate and counted in the same total. Recorded separately because the two
  // halves answer to different knobs: `thinkingLevel` in lib/gemini.js sets
  // one, the schema's length instructions set the other, and a single figure
  // cannot say which is worth touching.
  const thinking = Math.min(output, Number(usage.thinkingTokens) || 0);
  const cost = priceOf(model, input, output, cached);
  const row = {
    at: new Date().toISOString(),
    day: new Date().toISOString().slice(0, 10),
    kind: String(kind || 'analyse'),
    paid: Boolean(paid),
    model,
    input,
    output,
    thinking,
    // Written even when zero, because zero is the finding. A run of rows with
    // `cached: 0` against a system prompt well over the cache floor is what a
    // broken or cold cache looks like, and it is invisible unless the field is
    // always present to be counted.
    cached,
    costUsd: cost === null ? null : Number(cost.toFixed(6)),
    costEstimated: true,
  };
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.appendFileSync(STORE, JSON.stringify(row) + '\n');
  } catch (error) {
    // Deliberately swallowed — see above.
  }
  return row;
}

/**
 * What the ledger says, over the last `days` days.
 *
 * Reads the whole file each time rather than keeping a running total: this is
 * called by hand, not per request, and a total held in memory would be wrong
 * after every restart in a way nobody would notice.
 */
function summary(days) {
  const window = Number.isFinite(days) && days > 0 ? days : 30;
  const since = new Date(Date.now() - window * 86400000).toISOString().slice(0, 10);
  let text = '';
  try {
    text = fs.readFileSync(STORE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const totals = {
    days: window, calls: 0, input: 0, output: 0, thinking: 0, cached: 0, costUsd: 0,
    byKind: {}, models: [],
  };
  const models = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // One malformed line must not throw away the rest of the ledger — the same
    // rule lib/budget.js applies to its own log.
    let row;
    try { row = JSON.parse(line); } catch (error) { continue; }
    if (!row || typeof row.day !== 'string' || row.day < since) continue;
    totals.calls += 1;
    totals.input += Number(row.input) || 0;
    totals.output += Number(row.output) || 0;
    totals.thinking += Number(row.thinking) || 0;
    totals.cached += Number(row.cached) || 0;
    totals.costUsd += Number(row.costUsd) || 0;
    if (row.model) models.add(row.model);
    const kind = String(row.kind || 'analyse');
    totals.byKind[kind] = (totals.byKind[kind] || 0) + 1;
  }
  totals.costUsd = Number(totals.costUsd.toFixed(4));
  totals.models = [...models].sort();
  // The two numbers this file exists to surface. Both are averages over the
  // window rather than totals, because the question is always "what does a run
  // cost" and "is the cache working", not "what did we spend".
  totals.costPerCallUsd = totals.calls
    ? Number((totals.costUsd / totals.calls).toFixed(4)) : 0;
  totals.cachedShare = totals.input
    ? Number((totals.cached / totals.input).toFixed(3)) : 0;
  // What share of the most expensive tokens in the bill went on reasoning
  // nobody reads. Output bills at five times input, so this is usually the
  // largest single number in a run's cost and the least visible.
  totals.thinkingShare = totals.output
    ? Number((totals.thinking / totals.output).toFixed(3)) : 0;
  return totals;
}

module.exports = { record, summary, priceOf, RATES, STORE };
