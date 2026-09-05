// A global daily ceiling on free model calls.
//
// This is the only thing in this app that actually bounds the API bill, and
// it is deliberately the one that identifies nobody. The per-device allowance
// in docs/app.js is a fair-use nudge a reader can clear their browser to
// escape; this is a hard stop that no client can talk its way past, because
// the server does not ask the client anything to apply it.
//
// What is recorded is a date and a kind — never an address, a device, a
// digest, or anything derived from one. That matters beyond good manners:
// docs/index.html promises "no analytics, no trackers, no cookies… no visitor
// count", and a counter keyed to *anything* about the caller would make that
// false. A tally of "how many free analyses happened today" is not a visitor
// count; it cannot be read back to say who, or even how many people.
//
// A flat JSONL file rather than a database, same reasoning as
// lib/premiumLedger.js and lib/recipients.js: append-only, greppable,
// survives a restart, adds no dependency to a project that already has four.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE = process.env.PSYCHEAI_BUDGET_FILE ||
  path.join(__dirname, '..', 'data', 'budget.jsonl');

// Sized against a price, not picked. docs/digest.js caps one free analysis at
// COST_CAP — $0.25 worst case, and well under that in practice — so 200 is a
// hard ceiling of about US$50 a day if every single run were pathological.
// Raise it when the traffic justifies the bill, not the other way round.
const DAILY_LIMIT = Number(process.env.PSYCHEAI_DAILY_FREE_LIMIT || 200);
if (!Number.isInteger(DAILY_LIMIT) || DAILY_LIMIT < 1) {
  throw new Error('PSYCHEAI_DAILY_FREE_LIMIT must be a positive whole number — got ' +
    JSON.stringify(process.env.PSYCHEAI_DAILY_FREE_LIMIT));
}

/** UTC, so the ceiling resets at a fixed instant rather than one that moves with the host. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

// Counting by re-reading the file would be O(file) on every request, and this
// file only grows. It is append-only and this process is its only writer, so
// today's tally can be held in memory and the file read once — on boot, or the
// first call after midnight. The file remains the durable record; the cache is
// only an index into it.
//
// The caveat worth naming: with more than one server process the caches drift
// and the real ceiling becomes DAILY_LIMIT per process. That is a safe
// direction to be wrong in for a spend cap only if you know it — one instance
// is the deployment this is written for.
let cachedDay = null;
let cachedCount = 0;

function countToday() {
  const day = today();
  if (cachedDay === day) return cachedCount;
  let text = '';
  try {
    text = fs.readFileSync(STORE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let count = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // One malformed line must not throw away the day's real count.
    try {
      if (JSON.parse(line).day === day) count += 1;
    } catch (error) { continue; }
  }
  cachedDay = day;
  cachedCount = count;
  return count;
}

/** Whether another free call fits under today's ceiling. */
function canSpend() {
  return countToday() < DAILY_LIMIT;
}

/**
 * Records one free call against today.
 *
 * Called *after* a successful model call, so a provider outage does not spend
 * the day's budget on responses nobody received. The cost of that ordering is
 * that concurrent requests can overshoot the ceiling by however many are in
 * flight at once — bounded, small, and much better than the alternative of
 * charging readers' budget for calls that failed.
 */
function record(kind) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.appendFileSync(STORE, JSON.stringify({
    day: today(), kind: String(kind || 'analyse'), at: new Date().toISOString(),
  }) + '\n');
  if (cachedDay === today()) cachedCount += 1;
  return true;
}

function describe() {
  return { used: countToday(), limit: DAILY_LIMIT, exhausted: !canSpend() };
}

module.exports = {
  canSpend, record, countToday, describe, DAILY_LIMIT, STORE,
  __testing: { resetCache() { cachedDay = null; cachedCount = 0; } },
};
