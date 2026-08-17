// The list of email addresses that asked for a report.
//
// This is the one thing in PsycheAI that is deliberately written down, and the
// split it draws is the whole point of the feature: **the administrator gets
// the addresses and never gets the reports.** Both halves are structural rather
// than promised.
//
// The address is kept because it is what an operator legitimately needs — who
// asked, how many, when — and because bounce and complaint handling is not
// optional once you send mail. The report is not kept because nothing here is
// ever given it: `lib/mail.js` relays the PDF straight to SES, and this module
// is called with an address and a timestamp and is not passed the attachment at
// all. There is no code path that could write one, which is a stronger property
// than a rule saying it must not.
//
// What that does *not* claim: an administrator with access to the running
// server could add logging to the relay, or read process memory while a request
// is in flight. "Not retained, not available afterwards" is real and worth
// having; "impossible for an operator to observe in transit" is not something
// any server-side attachment relay can offer, and this file will not pretend
// otherwise. The reader's own mail provider, meanwhile, keeps the report
// permanently — which the message itself says out loud.
//
// A file of JSON lines rather than a database: it is append-only, it survives a
// restart, it is trivially greppable by the person who owns the box, and it
// adds no dependency to a project that has three.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE = process.env.PSYCHEAI_RECIPIENTS_FILE ||
  path.join(__dirname, '..', 'data', 'recipients.jsonl');

// Set to require a token on the admin route. Unset, the route is refused
// outright rather than served openly — an address list that answers to anyone
// who finds the URL is worse than no route at all.
const ADMIN_TOKEN = process.env.PSYCHEAI_ADMIN_TOKEN || '';

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
}

/**
 * Records that an address asked for a report.
 *
 * Takes an address and nothing else by design. There is no parameter for the
 * report, so no future edit can casually start storing one alongside the
 * address without changing this signature and reading the file header.
 */
function record(address) {
  const clean = String(address || '').trim().toLowerCase();
  if (!clean) return false;
  ensureDir();
  fs.appendFileSync(STORE, JSON.stringify({ email: clean, at: new Date().toISOString() }) + '\n');
  return true;
}

/** Every address recorded, newest first, with a count of requests each. */
function list() {
  let text = '';
  try {
    text = fs.readFileSync(STORE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const byAddress = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    // One malformed line should not cost the operator the whole list.
    try { row = JSON.parse(line); } catch (error) { continue; }
    if (!row || !row.email) continue;
    const seen = byAddress.get(row.email);
    if (seen) {
      seen.requests += 1;
      if (row.at > seen.last) seen.last = row.at;
      if (row.at < seen.first) seen.first = row.at;
    } else {
      byAddress.set(row.email, { email: row.email, requests: 1, first: row.at, last: row.at });
    }
  }
  return [...byAddress.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
}

/**
 * Whether a request may read the list.
 *
 * Compared in constant time so the endpoint does not leak the token one byte at
 * a time to somebody willing to time it.
 */
function authorised(token) {
  if (!ADMIN_TOKEN) return false;
  const given = Buffer.from(String(token || ''), 'utf8');
  const want = Buffer.from(ADMIN_TOKEN, 'utf8');
  if (given.length !== want.length) return false;
  return require('node:crypto').timingSafeEqual(given, want);
}

const configured = () => Boolean(ADMIN_TOKEN);

module.exports = { record, list, authorised, configured, STORE };
