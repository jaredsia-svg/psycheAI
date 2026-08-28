// Tracks which PaymentIntents have actually been used to generate a premium
// analysis, and how many times.
//
// This is the one piece of server-side state this app keeps about a payment.
// Everything else PsycheAI does is designed around having no database at all
// — the report itself never touches this server — but "no database" was also
// exactly how a reader could unlock the premium section for free: nothing
// server-side ever checked whether a charge had really gone through before
// this file existed. lib/stripe.js's verifyPaid() answers "did this payment
// happen"; this file answers the question verifyPaid alone cannot — "has it
// already been spent" — since a successful PaymentIntent, re-presented,
// verifies as successful every time.
//
// A flat JSONL file rather than an actual database, same reasoning as
// lib/recipients.js: append-only, greppable, survives a restart, adds no
// dependency to a project that already has four.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE = process.env.PSYCHEAI_PAYMENTS_FILE ||
  path.join(__dirname, '..', 'data', 'payments.jsonl');

// How many times one successful payment may generate an analysis, not one:
// a network error after a real model call should not strand a reader who
// paid with nothing to show for it, so a small allowance covers retries
// without becoming an unlimited free-regeneration hole for the one payment
// that did clear.
//
// It was 5, set when a retry after a *successful* generation cost a use like
// any other. The 30-minute result cache changed that: server.js serves a
// repeat of a finished analysis from the cache before it touches this ledger,
// so the common retry — a reader whose connection died while the report was
// coming back — is now free. What is left for this number to cover is
// generations that genuinely failed, and three of those in a row is a broken
// provider rather than a reader who needs a fourth.
const MAX_USES = 3;

// A payment buys one *kind* of thing, and the ledger has to say which — the
// same S$0.99 that bought an extra analysis must not also be spendable on the
// premium sections. Rows written before this existed carry no kind at all and
// are read as 'premium', which is what every one of them was.
//
// 'analysis' gets its own allowance because it buys less: one report
// generation, with a couple of retries in hand for a call that failed after
// the charge cleared.
//
// 'bundled' is the free report an unlock pays for when the reader added a
// Google or Facebook export on the way to it — see handleAnalyse. It is the
// same S$1.99 PaymentIntent as 'premium', counted separately so that using
// one cannot eat into the other: the reader bought both, and a retry of one
// must never cost them a retry of the other. Its allowance matches
// 'analysis' because it buys exactly what 'analysis' does — which is now the
// same number 'premium' gets, though for its own reason rather than by
// accident.
//
// 'compatibility' is the paid two-card read. Its own kind for the same reason
// every other one is: the S$1.99 that bought it is indistinguishable at this
// layer from the S$1.99 that bought premium sections, and only the kind keeps
// one from being spent as the other.
const MAX_USES_BY_KIND = { premium: MAX_USES, analysis: 3, bundled: 3, compatibility: 3 };
const DEFAULT_KIND = 'premium';

function usesAllowed(kind) {
  return MAX_USES_BY_KIND[String(kind || DEFAULT_KIND)] || MAX_USES;
}

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
}

function readAll() {
  let text = '';
  try {
    text = fs.readFileSync(STORE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // One malformed line should not cost every other payment its record.
    try { rows.push(JSON.parse(line)); } catch (error) { continue; }
  }
  return rows;
}

/** How many times this PaymentIntent has already been spent on `kind`. */
function usageCount(paymentIntentId, kind) {
  const id = String(paymentIntentId || '');
  if (!id) return 0;
  const want = String(kind || DEFAULT_KIND);
  return readAll().filter(row =>
    row.paymentIntentId === id && String(row.kind || DEFAULT_KIND) === want).length;
}

/** Whether this PaymentIntent still has generations of `kind` left under its cap. */
function canUse(paymentIntentId, kind) {
  return usageCount(paymentIntentId, kind) < usesAllowed(kind);
}

/** Records one use, append-only. */
function recordUse(paymentIntentId, kind) {
  const id = String(paymentIntentId || '');
  if (!id) return false;
  ensureDir();
  fs.appendFileSync(STORE, JSON.stringify({
    paymentIntentId: id, kind: String(kind || DEFAULT_KIND), at: new Date().toISOString(),
  }) + '\n');
  return true;
}

module.exports = {
  usageCount, canUse, recordUse, usesAllowed,
  MAX_USES, MAX_USES_BY_KIND, DEFAULT_KIND, STORE,
};
