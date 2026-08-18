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
const MAX_USES = 5;

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

/** How many times this PaymentIntent has already generated an analysis. */
function usageCount(paymentIntentId) {
  const id = String(paymentIntentId || '');
  if (!id) return 0;
  return readAll().filter(row => row.paymentIntentId === id).length;
}

/** Whether this PaymentIntent still has generations left under the cap. */
function canUse(paymentIntentId) {
  return usageCount(paymentIntentId) < MAX_USES;
}

/** Records one use, append-only. */
function recordUse(paymentIntentId) {
  const id = String(paymentIntentId || '');
  if (!id) return false;
  ensureDir();
  fs.appendFileSync(STORE, JSON.stringify({ paymentIntentId: id, at: new Date().toISOString() }) + '\n');
  return true;
}

module.exports = { usageCount, canUse, recordUse, MAX_USES, STORE };
