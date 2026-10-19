// One free Psyche Card per Instagram account; a reader's first Psyche Report
// free once one connection makes their card from their link; and credits.
//
// **The account.** The browser sends `account`: a SHA-256 of the Instagram
// username it read from the export *and* the time of the reader's earliest
// sent message (or, with none, their earliest post or caption), which only
// the export's owner has (docs/app.js, accountKey; October 2026). Before
// that it was the username alone, which anyone could compute for anyone: it
// told whether a named person had used PsycheAI, and spent their free read.
// This server never sees the username. It scrambles that hash once more with
// its own secret (store.keyed) and keeps only the result, in one set:
// accounts that have had their free card. A second free card for the same
// account is refused with `freeUsed`, and the page offers the paid re-run
// instead. A free read with no account is refused in server.js.
//
// Until LEGACY_ACCOUNT_UNTIL the page also sends the old username-only code
// as `legacyAccount`. An account counts as used when either code is in a
// set, but only the new one is ever written, and nothing is reported back
// about the old one alone (server.js, /api/referral).
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
// Every open of the link, and every friend's sync with the card it carries
// (once a day per browser), is counted as a plain number.
//
// **The first report.** One friend making their card from the reader's link
// unlocks the reader's *first* Psyche Report free (claimFirst). For a few
// weeks of October 2026 one *open* of the link did, but an open is a plain
// unauthenticated count anyone can send with a fresh code each time, which
// made it a free report on demand; opens are a statistic only now. A card
// is bounded by the friend rules in afterFreeCard (one per friend account,
// never the link owner's own, a few an hour from one connection). Once per
// code, and only for an account that has never had a full report
// (`full:accounts`, written for every full report, paid or not). Re-runs, of
// the card or the report, are always paid.
//
// **Credits.** Every friend's card earns one credit (CARDS_PER_CREDIT; three until late October 2026).
// A credit buys a gift (claim: a grant someone else redeems) or one Ask
// Psyche question (spendCredit, from lib/askcredits.js). The friend who unlocked the first report counts
// toward credits too. Until October 2026 two cards, or one friend's paid
// report, earned a free report for the reader's own use; that is gone, and
// paid reports are no longer counted.
//
// A grant token unlocks the full report exactly as a 100% promo code does,
// once — the same report may be fetched again with it, a different one may
// not. What it was made for is stored with it: `first:<code>` (only while the
// account has had no full report), `gift:<code>` (never by the code that gave
// it), or older plain values (a code, or 'guess'), which carry no condition.
//
// What is stored: scrambled account codes, random referral codes and counts.
// Never a username, a name or an address.
'use strict';

const crypto = require('node:crypto');
const store = require('./store');

const CARDS_PER_CREDIT = 1;
const CARDS_FOR_FIRST = 1;
// The last day the old username-only account code is checked (UTC, inclusive).
const LEGACY_ACCOUNT_UNTIL = '2026-11-18';
const GRANT_DAYS = 60;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[0-9a-f]{12}$/;

function cleanAccount(value) {
  const v = String(value || '').trim().toLowerCase();
  return HEX64.test(v) ? v : '';
}
/** The old username-only code, while it is still checked; '' after LEGACY_ACCOUNT_UNTIL. */
function cleanLegacy(value, now) {
  const day = new Date(now === undefined ? Date.now() : now).toISOString().slice(0, 10);
  return day <= LEGACY_ACCOUNT_UNTIL ? cleanAccount(value) : '';
}
/** Whether this account, or its old code, is in one of the sets. False when unknown. */
async function inSet(set, account, legacy) {
  const ids = [cleanAccount(account), cleanLegacy(legacy)].filter(Boolean).map(accountId);
  if (!ids.length) return false;
  const rows = await store.run(ids.map(id => ['SISMEMBER', set, id]));
  return Boolean(rows && rows.some(row => Number(row) === 1));
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

/** Whether this account (or its old code) has already had its free card. False when unknown. */
async function freeCardUsed(account, legacy) {
  return inSet('free:accounts', account, legacy);
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

async function afterFreeCard({ account, legacy, ref, myRef, client, guessed }) {
  const a = cleanAccount(account);
  if (!a) return { recorded: false };
  const id = accountId(a);
  // A reader whose old code had its card already is not a new friend.
  const before = cleanLegacy(legacy) ? await inSet('free:accounts', '', legacy) : false;
  // A card made without a guess spends the account's one guess too: once a
  // card has been seen, a guess at it would be a guess at a known answer.
  // (A card made with a guess is marked by judgeGuess itself.)
  if (!guessed) store.send([['SET', 'guess:' + id, '1', 'NX', 'EX', 400 * 86400]]);
  const rows = await store.run([['SADD', 'free:accounts', id]]);
  const first = Boolean(rows && Number(rows[0]) === 1) && !before;
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

/** A full report was written for this account, paid or not: it has had its first. */
function afterFullReport(account) {
  const a = cleanAccount(account);
  if (a) store.send([['SADD', 'full:accounts', accountId(a)]]);
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
 * Where a referral code stands: opens, friends' cards and friends' syncs so
 * far; the credits earned, spent and left; and the free first report —
 * whether a friend's card has unlocked it, and whether it was claimed. Opens
 * are counted and shown, and unlock nothing.
 */
async function status(secret) {
  const s = cleanSecret(secret);
  if (!s) return null;
  const code = codeOf(s);
  const rows = await store.run([['SCARD', 'ref:' + code + ':friends'], ['GET', 'ref:' + code + ':spent'],
    ['GET', 'ref:' + code + ':opens'], ['GET', 'ref:' + code + ':syncs'], ['GET', 'ref:' + code + ':first'],
    ['GET', 'ref:' + code + ':bonus']]);
  if (!rows) return null;
  const friends = Number(rows[0]) || 0;
  const spent = Number.parseInt(rows[1], 10) || 0;
  const opens = Number.parseInt(rows[2], 10) || 0;
  const syncs = Number.parseInt(rows[3], 10) || 0;
  // Credits won rather than earned: a right guess at the character with a
  // free first read that already carries the report (judgeGuess, creditTo).
  const bonus = Number.parseInt(rows[5], 10) || 0;
  const credits = Math.floor(friends / CARDS_PER_CREDIT) + bonus;
  return {
    code, opens, friends, syncs, credits, spent, available: Math.max(0, credits - spent),
    perCredit: CARDS_PER_CREDIT, toward: friends % CARDS_PER_CREDIT,
    first: { needed: CARDS_FOR_FIRST, unlocked: friends >= CARDS_FOR_FIRST, claimed: Boolean(rows[4]) },
  };
}

/**
 * Spends one credit, for a gift (claim) or an Ask PsycheAI question
 * (lib/askcredits.js). Resolves to the code it was spent from, or null when
 * none is left. `refundCredit` gives it back when what it paid for failed.
 */
async function spendCredit(secret) {
  const now = await status(secret);
  if (!now || now.available < 1) return null;
  const rows = await store.run([['INCRBY', 'ref:' + now.code + ':spent', 1]]);
  if (!rows) return null;
  if (Number(rows[0]) > now.credits) {
    // Two spends raced for the last one: give it back.
    store.send([['DECRBY', 'ref:' + now.code + ':spent', 1]]);
    return null;
  }
  return now.code;
}
function refundCredit(code) {
  const c = cleanCode(code);
  if (c) store.send([['DECRBY', 'ref:' + c + ':spent', 1]]);
}

/** Spends one credit on a gift; resolves to a grant token, or null when none is left. */
async function claim(secret) {
  const code = await spendCredit(secret);
  if (!code) return null;
  const now = { code };
  const token = crypto.randomBytes(24).toString('hex');
  await store.run([['SET', 'grant:' + token, 'gift:' + now.code, 'EX', GRANT_DAYS * 86400]]);
  return token;
}

/**
 * The free first report, once a friend's card has unlocked it: a grant token,
 * the same one every time it is asked for (so a report that failed can be
 * asked for again), or null when it is not unlocked, or already claimed and
 * spent or expired.
 */
async function claimFirst(secret) {
  const now = await status(secret);
  if (!now || !now.first.unlocked) return null;
  const fresh = crypto.randomBytes(24).toString('hex');
  const rows = await store.run([['SET', 'ref:' + now.code + ':first', fresh, 'NX'], ['GET', 'ref:' + now.code + ':first']]);
  if (!rows || !/^[0-9a-f]{48}$/.test(rows[1] || '')) return null;
  const token = rows[1];
  if (rows[0] === 'OK') {
    await store.run([['SET', 'grant:' + token, 'first:' + now.code, 'EX', GRANT_DAYS * 86400]]);
    return token;
  }
  // Asked before: the same grant, while it is still there to use.
  const left = await store.run([['GET', 'grant:' + token]]);
  return left && left[0] ? token : null;
}

// Said when an account that has had a full report asks for the free first
// one. server.js marks it (firstUsed) so the page drops the free unlock and
// offers paying instead.
const FIRST_USED = 'The free Psyche Report from your link is for your first Psyche Report only. This one is paid.';

/**
 * Whether this account (or, while it is checked, its old code) has had a
 * full report already, paid or not, and so can no longer use the free first
 * one. False when unknown.
 */
async function firstUsedBy(account, legacy) {
  return inSet('full:accounts', account, legacy);
}

/**
 * Whether a grant may unlock this report: it exists, and it is either unused
 * or was used for this same report (a retry). Resolves to null when fine, or
 * the reason it is not.
 */
async function grantRefusal(token, digest, who) {
  const t = String(token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(t)) return 'That free report could not be found.';
  const rows = await store.run([['GET', 'grant:' + t], ['GET', 'grant:' + t + ':used']]);
  if (!rows) return 'Free reports cannot be checked right now. Try again in a minute.';
  if (!rows[0]) return 'That free Psyche Report could not be found, or has expired.';
  // `digest` is the whole of what the report is written from — the digest as
  // the model reads it, and the card it explains (server.js, the result
  // cache's key) — so a different card or a deeper read is a different report.
  if (rows[1] && rows[1] !== digestHash(digest)) return 'That free Psyche Report has already been used.';
  // Fetching the same report again is always fine; the conditions are for
  // its first use.
  if (rows[1]) return null;
  const made = String(rows[0]);
  const ids = [cleanAccount(who && who.account), cleanLegacy(who && who.legacy)].filter(Boolean).map(accountId);
  if (made.startsWith('first:') && ids.length) {
    const had = await store.run(ids.map(id => ['SISMEMBER', 'full:accounts', id]));
    if (!had) return 'Free reports cannot be checked right now. Try again in a minute.';
    if (had.some(row => Number(row) === 1)) return FIRST_USED;
  }
  if (made.startsWith('gift:') && made.slice(5) === cleanCode(who && who.myRef)) {
    return 'A gifted Psyche Report is for someone else. Send them the link.';
  }
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
 * no guess (none made, or not a catalogue character); { guess, counted: false,
 * reason } when it cannot count ('account': the export carries no username;
 * 'guessed': this account has guessed before); else { guess, character, won,
 * token }, with a token only for a win the day's limits allow (and `limited`
 * when they did not). Every guess made hears back.
 */
async function judgeGuess({ guess, character, account, legacy, client, names, creditTo }) {
  const g = String(guess || '').trim();
  const c = String(character || '').trim();
  const a = cleanAccount(account);
  if (!g || !Array.isArray(names) || !names.includes(g)) return null;
  if (!a) return { guess: g, counted: false, reason: 'account' };
  // An account that guessed under its old code has had its guess.
  const old = cleanLegacy(legacy);
  if (old) {
    const had = await store.run([['GET', 'guess:' + accountId(old)]]);
    if (had && had[0]) return { guess: g, counted: false, reason: 'guessed' };
  }
  const first = await store.run([['SET', 'guess:' + accountId(a), '1', 'NX', 'EX', 400 * 86400]]);
  if (!first) return null;
  if (first[0] !== 'OK') return { guess: g, counted: false, reason: 'guessed' };
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
  // A first read that came with its report (FIRST_RUN merged in server.js):
  // a free report would be a second copy, so the prize is one credit on the
  // reader's link instead, for a question or a report to gift.
  if (creditTo !== undefined) {
    const code = cleanCode(creditTo);
    const added = code ? await store.run([['INCR', 'ref:' + code + ':bonus']]) : null;
    return { guess: g, character: c, won: true, token: null, credit: Boolean(added), limited: !added };
  }
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
  freeCardUsed, afterFreeCard, afterFullReport, countOpen, countSync, status, claim, claimFirst, spendCredit, refundCredit,
  grantRefusal, reserveGrant, spendGrant, codeOf,
  judgeGuess, GUESS_WINS_PER_CONNECTION, GUESS_WINS_PER_DAY,
  FRIEND_CREDITS_PER_CONNECTION, FRIEND_CREDITS_PER_DAY,
  cleanAccount, cleanLegacy, cleanCode, CARDS_PER_CREDIT, CARDS_FOR_FIRST, FIRST_USED, firstUsedBy, LEGACY_ACCOUNT_UNTIL,
};
