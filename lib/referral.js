// One free Psyche Card per Instagram account, and "invite three friends, get
// a full report free".
//
// **The account.** The browser sends `account`: a SHA-256 of the Instagram
// username it read from the export (docs/app.js, accountKey). This server
// never sees the username. It scrambles that hash once more with its own
// secret (store.keyed) and keeps only the result, in one set: accounts that
// have had their free card. A second free card for the same account is
// refused with `freeUsed`, and the page offers the paid re-run instead. A
// request with no account (an export without a username) is not limited
// here; the daily budget still bounds it.
//
// **The referral.** Every browser holds a random secret; its public code is
// the first 12 hex characters of the secret's SHA-256, which is what goes in
// the reader's links (?ref=…). Knowing the code proves nothing; claiming needs
// the secret. A friend arriving on such a link and finishing their *first*
// free card adds their account to that code's set of friends:
//
//   · once per friend account, ever, and for one referrer only (the first)
//   · never the referrer's own account (recorded when they make their card)
//
// A friend who arrives on the link and then *buys* the full report counts
// too: once per buyer account, never the referrer's own. Every open of the
// link, and every friend's sync with the card it carries (once a day per
// browser), is counted as a plain number.
//
// Credits: every three friends' cards earn one full premium report, and so
// does every two friends' paid reports — the two add up. Claiming spends one
// and returns a grant token, which unlocks the full report exactly as a 100%
// promo code does, once — the same report may be fetched again with it, a
// different one may not. The token is a bearer secret, so a reader can use it
// themselves or send it to someone as a gift (docs/app.js, ?gift=).
//
// What is stored: scrambled account codes, random referral codes and counts.
// Never a username, a name or an address.
'use strict';

const crypto = require('node:crypto');
const store = require('./store');

const FRIENDS_PER_REPORT = 3;
const PAID_PER_REPORT = 2;
const GRANT_DAYS = 60;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[0-9a-f]{12}$/;

function cleanAccount(value) {
  const v = String(value || '').trim().toLowerCase();
  return HEX64.test(v) ? v : '';
}
function cleanCode(value) {
  const v = String(value || '').trim().toLowerCase();
  return CODE.test(v) ? v : '';
}
function cleanSecret(value) {
  const v = String(value || '').trim().toLowerCase();
  return HEX64.test(v) ? v : '';
}
/** The public code a secret stands behind. */
function codeOf(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12);
}
const accountId = account => store.keyed('acct', account);
function digestHash(digest) {
  return crypto.createHash('sha256').update(JSON.stringify(digest == null ? null : digest)).digest('hex');
}

/** Whether this account has already had its free card. False when unknown. */
async function freeCardUsed(account) {
  const a = cleanAccount(account);
  if (!a) return false;
  const rows = await store.run([['SISMEMBER', 'free:accounts', accountId(a)]]);
  return Boolean(rows && Number(rows[0]) === 1);
}

/**
 * After a free card was written: the account is marked as having had it, the
 * reader's own referral code is tied to their account (so they cannot refer
 * themselves), and — the first time this account makes a card — the friend
 * who invited them is credited. Resolves to what happened, for the totals.
 */
// How many friends' cards may count toward someone's free report: at most
// FRIEND_CREDITS_PER_CONNECTION an hour from one connection (any referrer),
// and FRIEND_CREDITS_PER_DAY a day for one referrer. A card is free to make
// and an account is only what the page says it is, so without these three
// made-up accounts from one phone were a free US$5 report.
const FRIEND_CREDITS_PER_CONNECTION = 2;
const FRIEND_CREDITS_PER_DAY = 6;

async function afterFreeCard({ account, ref, myRef, client }) {
  const a = cleanAccount(account);
  if (!a) return { recorded: false };
  const id = accountId(a);
  const rows = await store.run([['SADD', 'free:accounts', id]]);
  const first = Boolean(rows && Number(rows[0]) === 1);
  const mine = cleanCode(myRef);
  if (mine) store.send([['SET', 'ref:' + mine + ':owner', id, 'NX']]);
  const from = cleanCode(ref);
  if (!first || !from || from === mine) return { recorded: true, first, credited: false };
  const check = await store.run([['GET', 'ref:' + from + ':owner'], ['SET', 'ref:by:' + id, from, 'NX']]);
  if (!check) return { recorded: true, first, credited: false };
  const [owner, claimedReferrer] = check;
  // The referrer has to have made a card of their own; nobody is credited
  // for a code that names no one.
  if (!owner || owner === id || claimedReferrer === null) return { recorded: true, first, credited: false };
  const day = new Date().toISOString().slice(0, 10);
  const who = crypto.createHash('sha256').update('psycheai-refip:' + String(client || 'unknown')).digest('hex').slice(0, 16);
  const fromHere = await store.run([['INCR', 'refip:' + who], ['EXPIRE', 'refip:' + who, 3600]]);
  if (!fromHere || Number(fromHere[0]) > FRIEND_CREDITS_PER_CONNECTION) return { recorded: true, first, credited: false };
  const today = await store.run([['INCR', 'ref:' + from + ':day:' + day], ['EXPIRE', 'ref:' + from + ':day:' + day, 2 * 86400]]);
  if (!today || Number(today[0]) > FRIEND_CREDITS_PER_DAY) return { recorded: true, first, credited: false };
  const added = await store.run([['SADD', 'ref:' + from + ':friends', id]]);
  return { recorded: true, first, credited: Boolean(added && Number(added[0]) === 1) };
}

/**
 * After a full report was paid for (a real Stripe payment, not a promo code or
 * a grant): the friend whose link brought this buyer is credited — once per
 * buyer account (or, with no account, per payment), and never the referrer's
 * own account. Resolves to whether anyone was credited.
 */
async function afterPaid({ account, ref, myRef, payment }) {
  const from = cleanCode(ref);
  if (!from || from === cleanCode(myRef)) return false;
  const a = cleanAccount(account);
  const member = a ? accountId(a) : 'pi:' + store.keyed('pi', String(payment || ''));
  if (!a && !payment) return false;
  const owner = await store.run([['GET', 'ref:' + from + ':owner']]);
  // Only a code someone actually holds (tied to its owner's first card).
  if (!owner || !owner[0] || (a && owner[0] === member)) return false;
  const added = await store.run([['SADD', 'ref:' + from + ':paid', member]]);
  return Boolean(added && Number(added[0]) === 1);
}

/** One more friend synced from a reader's link: a plain count, nothing about who. */
function countSync(ref) {
  const code = cleanCode(ref);
  if (code) store.send([['INCR', 'ref:' + code + ':syncs']]);
}

/** One more open of a reader's link: a plain count, nothing about who. */
function countOpen(ref) {
  const code = cleanCode(ref);
  if (code) store.send([['INCR', 'ref:' + code + ':opens']]);
}

/**
 * Where a referral code stands: opens, friends' cards, friends' paid
 * reports and friends' syncs so far, and the free reports earned, claimed and left.
 */
async function status(secret) {
  const s = cleanSecret(secret);
  if (!s) return null;
  const code = codeOf(s);
  const rows = await store.run([['SCARD', 'ref:' + code + ':friends'], ['GET', 'ref:' + code + ':claimed'],
    ['SCARD', 'ref:' + code + ':paid'], ['GET', 'ref:' + code + ':opens'], ['GET', 'ref:' + code + ':syncs']]);
  if (!rows) return null;
  const friends = Number(rows[0]) || 0;
  const claimed = Number.parseInt(rows[1], 10) || 0;
  const paid = Number(rows[2]) || 0;
  const opens = Number.parseInt(rows[3], 10) || 0;
  const syncs = Number.parseInt(rows[4], 10) || 0;
  const earned = Math.floor(friends / FRIENDS_PER_REPORT) + Math.floor(paid / PAID_PER_REPORT);
  return {
    code, opens, friends, paid, syncs, earned, claimed, available: Math.max(0, earned - claimed),
    perCards: FRIENDS_PER_REPORT, perPaid: PAID_PER_REPORT,
    towardCards: friends % FRIENDS_PER_REPORT, towardPaid: paid % PAID_PER_REPORT,
  };
}

/** Spends one earned report; resolves to a grant token, or null when none is left. */
async function claim(secret) {
  const now = await status(secret);
  if (!now || now.available < 1) return null;
  const rows = await store.run([['INCRBY', 'ref:' + now.code + ':claimed', 1]]);
  if (!rows) return null;
  if (Number(rows[0]) > now.earned) {
    // Two claims raced for the last one: give it back.
    store.send([['DECRBY', 'ref:' + now.code + ':claimed', 1]]);
    return null;
  }
  const token = crypto.randomBytes(24).toString('hex');
  await store.run([['SET', 'grant:' + token, now.code, 'EX', GRANT_DAYS * 86400]]);
  return token;
}

/**
 * Whether a grant may unlock this report: it exists, and it is either unused
 * or was used for this same report (a retry). Resolves to null when fine, or
 * the reason it is not.
 */
async function grantRefusal(token, digest) {
  const t = String(token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(t)) return 'That free report could not be found.';
  const rows = await store.run([['GET', 'grant:' + t], ['GET', 'grant:' + t + ':used']]);
  if (!rows) return 'Free reports cannot be checked right now. Try again in a minute.';
  if (!rows[0]) return 'That free Psyche Report could not be found, or has expired.';
  if (rows[1] && rows[1] !== digestHash(digest)) return 'That free Psyche Report has already been used.';
  return null;
}

/**
 * Ties a grant to this report before it is written, atomically, so two
 * requests at once with different digests cannot both spend it. Resolves to
 * a release (call it with false if the report failed, to free the grant), or
 * null when the grant is already tied to another report.
 */
async function reserveGrant(token, digest) {
  const t = String(token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(t)) return null;
  const key = 'grant:' + t + ':used';
  const hash = digestHash(digest);
  const rows = await store.run([['SET', key, hash, 'NX', 'EX', GRANT_DAYS * 86400], ['GET', key]]);
  if (!rows || rows[1] !== hash) return null;
  const fresh = rows[0] === 'OK';
  return ok => { if (!ok && fresh) store.send([['DEL', key]]); };
}

// ---------- guess your character ----------
//
// A reader may guess, before their first card is made, which character it
// will name (docs/app.js, mountCast). The guess travels with the free card's
// own request, beside the digest and never inside it, so the model never
// sees it, and it is checked here against the card the model wrote. Right,
// and it wins a grant exactly like a friend-earned one: one Psyche Report,
// once, within GRANT_DAYS.
//
// One guess per Instagram account, ever: the scrambled account code is
// marked when the first free card is written, guess or no guess, so a second
// card cannot try again. An account is only what the page says it is, so a
// win is also held to GUESS_WINS_PER_CONNECTION a day from one connection,
// and the whole site to GUESS_WINS_PER_DAY (PSYCHEAI_GUESS_WINS_PER_DAY).
const GUESS_WINS_PER_CONNECTION = 1;
const GUESS_WINS_PER_DAY = Math.max(0, Number.parseInt(process.env.PSYCHEAI_GUESS_WINS_PER_DAY || '25', 10) || 0);

/**
 * The outcome of a guess, once the free card is written: null when there was
 * no guess to judge (none made, not a catalogue character, no account, or this
 * account has guessed before), else { guess, character, won, token }, with a
 * token only for a win the day's limits allow (and `limited` when they did not).
 */
async function judgeGuess({ guess, character, account, client, names }) {
  const g = String(guess || '').trim();
  const c = String(character || '').trim();
  const a = cleanAccount(account);
  if (!g || !a || !Array.isArray(names) || !names.includes(g)) return null;
  const first = await store.run([['SET', 'guess:' + accountId(a), '1', 'NX', 'EX', 400 * 86400]]);
  if (!first || first[0] !== 'OK') return null;
  const won = g === c;
  if (!won) return { guess: g, character: c, won: false, token: null };
  const day = new Date().toISOString().slice(0, 10);
  const who = crypto.createHash('sha256').update('psycheai-guessip:' + String(client || 'unknown')).digest('hex').slice(0, 16);
  const counts = await store.run([
    ['INCR', 'guess:wins:' + day], ['EXPIRE', 'guess:wins:' + day, 2 * 86400],
    ['INCR', 'guess:ip:' + who + ':' + day], ['EXPIRE', 'guess:ip:' + who + ':' + day, 2 * 86400],
  ]);
  const limited = !counts || Number(counts[0]) > GUESS_WINS_PER_DAY || Number(counts[2]) > GUESS_WINS_PER_CONNECTION;
  if (limited) return { guess: g, character: c, won: true, token: null, limited: true };
  const token = crypto.randomBytes(24).toString('hex');
  const set = await store.run([['SET', 'grant:' + token, 'guess', 'EX', GRANT_DAYS * 86400]]);
  if (!set) return { guess: g, character: c, won: true, token: null, limited: true };
  return { guess: g, character: c, won: true, token };
}

/** Ties a grant to the report it unlocked, once the report is written. */
function spendGrant(token, digest) {
  const t = String(token || '').trim().toLowerCase();
  store.send([['SET', 'grant:' + t + ':used', digestHash(digest), 'NX', 'EX', GRANT_DAYS * 86400]]);
}

module.exports = {
  freeCardUsed, afterFreeCard, afterPaid, countOpen, countSync, status, claim, grantRefusal, reserveGrant, spendGrant, codeOf,
  judgeGuess, GUESS_WINS_PER_CONNECTION, GUESS_WINS_PER_DAY,
  FRIEND_CREDITS_PER_CONNECTION, FRIEND_CREDITS_PER_DAY,
  cleanAccount, cleanCode, FRIENDS_PER_REPORT, PAID_PER_REPORT,
};
