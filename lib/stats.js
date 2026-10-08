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
// Held in memory for the last KEEP_DAYS days. A day's totals are written to
// the log as one line when the day turns over and when the process is asked
// to stop (a deploy), so they outlive a restart in the host's logs:
//
//   stats 2026-10-08 {"card":41,"compatibility":12,"via:ava":9}
//
// GET /api/stats returns the same totals to whoever holds
// PSYCHEAI_STATS_TOKEN; without one set, the route does not exist.
'use strict';

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
  totals[name] = (totals[name] || 0) + (Number.isFinite(by) ? by : 1);
  days.set(current, totals);
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
  count, cleanVia, snapshot, flush, KEEP_DAYS,
  // Tests only.
  _setClock(fn) { clock = fn || (() => new Date()); },
  _reset() { days.clear(); current = null; },
};
