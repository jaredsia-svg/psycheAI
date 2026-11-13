// How many of each thing the server made today, and nothing else.
//
// PsycheAI promises no analytics, no trackers and no cookies, and that no one
// can see that you visited. That rules out the usual way of knowing whether
// anything is working. What it does not rule out is counting the work the
// server already does, as totals: how many Psyche Cards, full reports and
// compatibility reports were written today, how many cards came from a
// friend's compatibility link, how many from a campaign link (?via=…), and
// how many times each creator code was redeemed.
//
// No identifier of any kind is involved: no IP, no device, no digest, no
// time finer than the day. A visit is not counted at all, only finished work.
// The FAQ says exactly this.
//
// Held in memory for the last KEEP_DAYS days, and kept for good in the store
// (lib/store.js — Upstash when configured) as one hash per day, so a deploy
// no longer wipes them: the last KEEP_DAYS days are read back at boot
// (hydrate), and /api/stats can read further back than memory holds
// (history). A day's totals are also written to the log as one line when the
// day turns over and when the process is asked to stop:
//
//   stats 2026-10-08 {"card":41,"compatibility":12,"via:ava":9}
//
// GET /api/stats returns the same totals to whoever holds
// PSYCHEAI_STATS_TOKEN; without one set, the route does not exist.
'use strict';

const store = require('./store');
const KEEP_DAYS = 31;

// A campaign code as it can appear in ?via=: short, lower case, letters,
// digits and dashes. Anything else is dropped rather than counted, so the
// totals cannot be filled with arbitrary text.
const VIA = /^[a-z0-9][a-z0-9-]{0,23}$/;

let clock = () => new Date();
const days = new Map();
let current = null;

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

function log(day) {
  const totals = days.get(day);
  if (totals && Object.keys(totals).length) console.log('stats ' + day + ' ' + JSON.stringify(totals));
}

// Turns the day over when the date has changed since the last count.
function roll() {
  const today = dayOf(clock());
  if (current === today) return;
  if (current) log(current);
  current = today;
  const oldest = [...days.keys()].sort().slice(0, Math.max(0, days.size - KEEP_DAYS + 1));
  for (const day of oldest) days.delete(day);
}

function count(name, by) {
  if (typeof name !== 'string' || !name) return;
  roll();
  const totals = days.get(current) || {};
  const amount = Number.isFinite(by) ? by : 1;
  totals[name] = (totals[name] || 0) + amount;
  days.set(current, totals);
  store.send([['HINCRBY', 'stats:' + current, name, amount]]);
}

function dayList(back) {
  const out = [];
  const now = clock();
  for (let i = 0; i < back; i++) out.push(dayOf(new Date(now.getTime() - i * 86400000)));
  return out;
}

/** The last KEEP_DAYS days back from the store, at boot. Counts already made in memory are kept on top. */
async function hydrate() {
  roll();
  const list = dayList(KEEP_DAYS);
  const rows = await store.run(list.map(day => ['HGETALL', 'stats:' + day]));
  if (!rows) return false;
  list.forEach((day, i) => {
    const stored = store.numbers(rows[i]);
    if (!Object.keys(stored).length) return;
    const live = days.get(day) || {};
    for (const [name, value] of Object.entries(stored)) live[name] = Math.max(live[name] || 0, value);
    days.set(day, live);
  });
  return true;
}

/** Up to `back` days of totals, from the store (memory when it cannot be reached). */
async function history(back) {
  const span = Math.max(1, Math.min(400, Number(back) || KEEP_DAYS));
  const list = dayList(span);
  const rows = await store.run(list.map(day => ['HGETALL', 'stats:' + day]));
  if (!rows) return snapshot();
  const out = {};
  list.slice().reverse().forEach(day => {
    const stored = store.numbers(rows[list.indexOf(day)]);
    const live = (days.get(day)) || {};
    const merged = Object.assign({}, stored);
    for (const [name, value] of Object.entries(live)) merged[name] = Math.max(merged[name] || 0, value);
    if (Object.keys(merged).length) out[day] = merged;
  });
  return out;
}

function cleanVia(value) {
  const via = String(value == null ? '' : value).trim().toLowerCase();
  return VIA.test(via) ? via : '';
}

function snapshot() {
  roll();
  const out = {};
  for (const day of [...days.keys()].sort()) out[day] = Object.assign({}, days.get(day));
  return out;
}

// Today's totals to the log, for a process about to stop.
function flush() {
  if (current) log(current);
}

module.exports = {
  count, cleanVia, snapshot, flush, hydrate, history, KEEP_DAYS,
  // Tests only.
  _setClock(fn) { clock = fn || (() => new Date()); },
  _reset() { days.clear(); current = null; },
};
