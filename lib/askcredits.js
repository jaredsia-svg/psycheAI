// Ask PsycheAI's questions: one credit each.
//
// A reader's Psyche Card brings one free (gift), however their report
// comes; they buy them five at a time (US$5, the `ask` product in
// docs/prices.js), and every credit their link earns (lib/referral.js: three
// friends' cards each) is one more. Both are kept under the reader's referral
// code, which only the holder of its secret can spend from — the same secret
// that is in their backup file, so questions bought survive a new browser.
//
// What is stored: per code, how many were bought and how many of those were
// spent; per PaymentIntent, that it has been credited (so one payment is five
// questions, once). Never a question or an answer: those stay in the browser.
'use strict';

const store = require('./store');
const referral = require('./referral');

const PER_PACK = 5;
const PI_DAYS = 400;
// Free questions (October 2026): one with a reader's Psyche Card, once per
// referral code, added to the same count a bought pack is. The Psyche Report
// no longer brings a second (18 Oct 2026): one free question in all.
const GIFTS = { card: 1 };
const CODE = /^[0-9a-f]{12}$/;

/** Questions left: bought and unspent, plus the link's credits. Null for a bad secret. */
async function balance(secret) {
  const status = await referral.status(secret);
  if (!status) return null;
  // A link whose card was made before free questions existed, or on a card
  // that was not the account's first: its one question with the card, the
  // first time its balance is read. gift() is once per code, so this is too.
  const owned = await store.run([['GET', 'ref:' + status.code + ':owner'], ['GET', 'ask:' + status.code + ':gift:card']]);
  if (owned && owned[0] && !owned[1]) await gift(status.code, 'card');
  const rows = await store.run([['GET', 'ask:' + status.code + ':bought'], ['GET', 'ask:' + status.code + ':spent']]);
  if (!rows) return null;
  const bought = Number.parseInt(rows[0], 10) || 0;
  const spent = Number.parseInt(rows[1], 10) || 0;
  const paid = Math.max(0, bought - spent);
  return { code: status.code, paid, referral: status.available, total: paid + status.available, perPack: PER_PACK };
}

/**
 * Five questions for a verified payment, once per PaymentIntent. Resolves to
 * true when they were added now, false when this payment was credited before.
 */
async function addPack(secret, paymentIntentId) {
  const now = await balance(secret);
  if (!now) return null;
  const id = String(paymentIntentId || '');
  if (!id) return null;
  const rows = await store.run([['SET', 'ask:pi:' + id, now.code, 'NX', 'EX', PI_DAYS * 86400]]);
  if (!rows || rows[0] !== 'OK') return false;
  await store.run([['INCRBY', 'ask:' + now.code + ':bought', PER_PACK]]);
  return true;
}

/**
 * A free question, once per code: `card` when the reader's card is written
 * (free, a paid re-run, or with its report). The code
 * is the reader's own (myRef), which names no one. Resolves to true when
 * they were added now.
 */
async function gift(code, kind) {
  const c = String(code || '');
  if (!CODE.test(c) || !GIFTS[kind]) return false;
  const rows = await store.run([['SET', 'ask:' + c + ':gift:' + kind, '1', 'NX', 'EX', PI_DAYS * 86400]]);
  if (!rows || rows[0] !== 'OK') return false;
  await store.run([['INCRBY', 'ask:' + c + ':bought', GIFTS[kind]]]);
  return true;
}

/**
 * Takes one question's credit before the model is asked: a bought one first,
 * then one of the link's. Resolves to a refund (call it if the answer failed),
 * or null when there is none left.
 */
async function spend(secret) {
  const now = await balance(secret);
  if (!now) return null;
  if (now.paid > 0) {
    const key = 'ask:' + now.code + ':spent';
    const rows = await store.run([['INCRBY', key, 1], ['GET', 'ask:' + now.code + ':bought']]);
    if (rows && Number(rows[0]) <= (Number.parseInt(rows[1], 10) || 0)) return () => store.send([['DECRBY', key, 1]]);
    // Raced for the last bought one: give it back and try the link's.
    if (rows) store.send([['DECRBY', key, 1]]);
  }
  const code = await referral.spendCredit(secret);
  return code ? () => referral.refundCredit(code) : null;
}

module.exports = { balance, addPack, gift, spend, PER_PACK, GIFTS };
