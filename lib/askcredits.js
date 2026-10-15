// Ask Psyche's questions: one credit each.
//
// A reader buys them five at a time (US$5, the `ask` product in
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

/** Questions left: bought and unspent, plus the link's credits. Null for a bad secret. */
async function balance(secret) {
  const status = await referral.status(secret);
  if (!status) return null;
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

module.exports = { balance, addPack, spend, PER_PACK };
