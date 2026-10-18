// The MBTI letters, scored from a ledger rather than an impression (October
// 2026).
//
// The model used to read everything, form one view and write a letter with a
// paragraph defending it; on an axis where the evidence runs both ways that
// view flipped between runs (one reader: ENTJ, ENTJ, ENTP in a day, J/P at
// "moderate" each time). Now, for each axis, the model writes a ledger — every
// piece of evidence it found for either letter, each tagged with a row of the
// rubric below — and this file does the adding up. The model judges each
// piece; the code decides the letter, its strength and the extraversion score,
// so the same ledger always gives the same answer.
//
// Rows whose answer is arithmetic on the digest (how many conversations carry
// real exchange, and what share of all of them) are computed here from the
// digest and never taken from the model: the model once read 378 conversations
// "ever spoken in" as breadth, and a number cannot be misread if nobody reads
// it.
'use strict';

const WEIGHT = { strong: 3, medium: 2, weak: 1, none: 0 };

// Each row: the axis, the letters it may point to, and how much it counts.
// A row a model may use. Computed rows are listed in COMPUTED and never
// accepted from a ledger.
const RUBRIC = {
  'E/I': {
    'own-words': { to: ['E', 'I'], weight: 'strong', text: 'Their own words about their energy: introvert or extravert; crowds drain them, or they come alive in one. Calling themselves mixed, both or an ambivert: enter it under both letters, and the axis stays slight.' },
    'setting': { to: ['E', 'I'], weight: 'strong', text: 'The setting they choose: strangers and big events — parties, mixers, conferences, meeting new people (E) / small familiar groups, avoiding mixers and strangers, tiring in unfamiliar settings (I). Seeing several groups of friends they already have is not this row.' },
    'reach-out': { to: ['E', 'I'], weight: 'medium', text: 'Starts plans and conversations with people beyond their usual circle (E) / declines invitations, leaves early (I). Plans for the same friends are `convenes-known-circle`.' },
    'pursuits': { to: ['E', 'I'], weight: 'weak', text: 'Chooses group pursuits (E) / chooses solitary pursuits over group ones (I). A sport or hobby with friends is common to everyone.' },
    'many-people': { to: ['E'], weight: 'weak', text: 'Many distinct people engaged with (comments, the most-engaged list).' },
    'initiates': { to: ['E', 'I'], weight: 'weak', text: 'Who starts the conversations, across their chats: they open most of them (E) / the other side usually does (I). Once for all their chats, not per chat.' },
    'convenes-known-circle': { to: ['neutral'], weight: 'none', text: 'Organising dinners, sport, trips for a familiar circle: neither way on its own, however often.' },
  },
  'N/S': {
    'own-words': { to: ['N', 'S'], weight: 'strong', text: 'Their own words about how they think: a big-picture person (N) / a details, facts person (S).' },
    'theorises': { to: ['N'], weight: 'medium', text: 'Their own writing speculates, theorises, links unrelated fields, asks what something means.' },
    'captions-meaning': { to: ['N'], weight: 'medium', text: 'Captions that go past the record to meaning, analogy or pattern — a clear share of them.' },
    'compares-tracks': { to: ['S'], weight: 'weak', text: 'Compares specs and options before deciding; tracks exact figures, keeps records — outside their job: the numbers their work runs on are a topic, not a thinking style.' },
    'practical-craft': { to: ['S'], weight: 'weak', text: 'Practical skills built step by step and kept up; sensory craft (food, tools, materials) for its own sake. A sport\'s technique does not count: every sport has one.' },
    'watches': { to: ['N', 'S'], weight: 'weak', text: 'Watches long explanation — essays, analysis (N) / how-to, repair, recipes (S).' },
    'abstract-topics': { to: ['N'], weight: 'weak', text: 'Instagram\'s topics spread across many unrelated abstract subjects.' },
  },
  'T/F': {
    'own-words': { to: ['T', 'F'], weight: 'strong', text: 'Their own words about how they decide: logic (T) / how people feel (F).' },
    'tie-break': { to: ['T', 'F'], weight: 'strong', text: 'A decision where the tie-break shows: a criterion, price or spec (T) / the effect on a person, a loyalty (F).' },
    'public-verdict': { to: ['T'], weight: 'medium', text: 'A criticism, ranking or verdict made in public anyway, where the platform discourages it.' },
    'private-softening': { to: ['F'], weight: 'medium', text: 'In private, holding back a criticism to protect a relationship; smoothing conflict.' },
    'credit': { to: ['T', 'F'], weight: 'weak', text: 'Crediting others for what they achieved (T) / for what they are like (F).' },
    'captions-to-nobody': { to: ['T', 'F'], weight: 'weak', text: 'Captions written to nobody in particular: verdicts (T) / feeling and who was there (F).' },
    'attention': { to: ['T', 'F'], weight: 'weak', text: 'Attention mostly on subjects (T) / mostly on people (F).' },
  },
  'J/P': {
    'own-words': { to: ['J', 'P'], weight: 'strong', text: 'Their own words about planning: "I need a plan", "lock it in" (J) / "let\'s see", "I hate fixed plans" (P).' },
    'plans-ahead': { to: ['J'], weight: 'medium', text: 'Bookings and itineraries made well ahead; deadlines named and met; lists, trackers, spreadsheets.' },
    'last-minute': { to: ['P'], weight: 'medium', text: 'Same-day plans, short-notice trips; cancellable bookings chosen to keep options open; changing course.' },
    'decisions': { to: ['J', 'P'], weight: 'medium', text: 'Decisions closed quickly and kept (J) / left open (P).' },
    'parallel-projects': { to: ['P'], weight: 'weak', text: 'Several projects started in parallel and left open.' },
    'search-horizon': { to: ['J', 'P'], weight: 'weak', text: 'Searches that plan ahead, "flights in March" (J) / for now, "open now", "tonight" (P).' },
    'saved-returned': { to: ['J'], weight: 'weak', text: 'Saved posts returned to.' },
  },
};

const AXES = ['E/I', 'N/S', 'T/F', 'J/P'];
const POLES = { 'E/I': ['E', 'I'], 'N/S': ['N', 'S'], 'T/F': ['T', 'F'], 'J/P': ['J', 'P'] };
// The rows the code works out from the digest; a ledger may not claim them.
// `group-chats` is no row at all, and a ledger that names it is dropped like
// any unknown row.
const COMPUTED = ['sustained', 'share'];

const NICKNAMES = {
  INTJ: 'The Architect', INTP: 'The Logician', ENTJ: 'The Commander', ENTP: 'The Debater',
  INFJ: 'The Advocate', INFP: 'The Mediator', ENFJ: 'The Protagonist', ENFP: 'The Campaigner',
  ISTJ: 'The Logistician', ISFJ: 'The Defender', ESTJ: 'The Executive', ESFJ: 'The Consul',
  ISTP: 'The Virtuoso', ISFP: 'The Adventurer', ESTP: 'The Entrepreneur', ESFP: 'The Entertainer',
};

const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/**
 * The rows the digest settles by arithmetic, as ledger pieces.
 *
 * Conversations count only where direct messages are a channel the reader
 * uses (1,000 of their own messages, or 50 conversations spoken in), and only
 * over the last five years of each source's data (`engagedThreads.last5Years`):
 * Instagram's and Messenger's added together. A source without five-year
 * counts adds nothing (October 2026: a Messenger history from 2007 counted
 * school chats as today's breadth). The bands halve for under three years of
 * data. A count weighs less than a reader's own words: medium at most.
 *
 * Group chats count for neither letter, busy or empty: whether someone
 * group-chats on these apps is a habit of the app, not of the person.
 */
function computedPieces(digest) {
  const out = { 'E/I': [], 'N/S': [] };
  const d = digest && typeof digest === 'object' ? digest : {};
  const dm = d.directMessages || {};
  const fb = (d.facebook && d.facebook.counts) || {};
  const active = num(dm.activeThreads);
  const sent = num(dm.sentByUser) || 0;
  if (active === null || !(sent >= 1000 || active >= 50)) return out;
  const recentOf = engaged => (engaged && typeof engaged === 'object' && engaged.last5Years && typeof engaged.last5Years === 'object')
    ? engaged.last5Years : null;
  const sources = [['Instagram', recentOf(dm.engagedThreads)], ['Messenger', recentOf(fb.engagedThreads)]].filter(([, r]) => r);
  if (!sources.length) return out;
  const sustained = sources.reduce((sum, [, r]) => sum + (num(r.atLeast50) || 0), 0);
  const wroteIn = sources.reduce((sum, [, r]) => sum + (num(r.active) || 0), 0);
  const span = num(d.rhythm && d.rhythm.spanDays) || 0;
  const scale = span && span < 3 * 365 ? 0.5 : 1;
  const band = n => n * scale;
  const where = sources.map(([name]) => name).join(' and ');
  const note = sustained + ' ' + where + ' conversations with 50 or more of their own messages in the last five years, of ' +
    wroteIn + ' they wrote in';
  if (sustained > band(100)) out['E/I'].push({ row: 'sustained', to: 'E', weight: 'medium', note });
  else if (sustained >= band(50)) out['E/I'].push({ row: 'sustained', to: 'E', weight: 'weak', note });
  else if (sustained < band(20)) out['E/I'].push({ row: 'sustained', to: 'I', weight: 'weak', note });
  else out['E/I'].push({ row: 'sustained', to: 'neutral', weight: 'none', note });
  // A high share counts only above a floor of sustained conversations: a
  // handful kept up out of a handful is a small circle, not reach.
  const share = wroteIn ? sustained / wroteIn : null;
  if (share !== null && share > 0.6 && sustained >= band(30)) {
    out['E/I'].push({ row: 'share', to: 'E', weight: 'weak', note: Math.round(share * 100) + '% of the conversations they wrote in over the last five years sustained, with a wide count' });
  } else if (share !== null && share < 0.1 && sustained < band(50)) {
    out['E/I'].push({ row: 'share', to: 'I', weight: 'weak', note: Math.round(share * 100) + '% of the conversations they wrote in over the last five years sustained, around a modest core' });
  }
  return out;
}

/**
 * The computed rows as a note the model reads after the evidence, so the sum
 * it makes before writing `why` is the sum the code will make (October 2026:
 * without it, a close E/I could flip under a paragraph arguing the other
 * letter). Empty when the digest settles none.
 */
function computedText(digest) {
  const pieces = computedPieces(digest);
  const lines = [];
  for (const axis of AXES) {
    for (const p of pieces[axis] || []) {
      const lean = p.to === 'neutral' ? 'neither way' : p.to + ' (' + p.weight + ', ' + WEIGHT[p.weight] + ')';
      lines.push('- ' + axis + ', `' + p.row + '`: ' + p.note + ' → ' + lean);
    }
  }
  if (!lines.length) return '';
  return 'Already in your MBTI ledgers, counted by the code from this digest. Do not enter these rows ' +
    'yourself, but add their points into each sum before you write `why`, `choice` and `strength`:\n' + lines.join('\n');
}

/** A model's ledger for one axis, held to the rubric: known rows, allowed letters, each row once per letter. */
function cleanLedger(axis, ledger) {
  const rows = RUBRIC[axis] || {};
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(ledger) ? ledger : []) {
    if (!item || typeof item !== 'object') continue;
    const row = String(item.row || '').trim();
    const to = String(item.pointsTo || '').trim().toUpperCase() === 'NEUTRAL' ? 'neutral' : String(item.pointsTo || '').trim().toUpperCase();
    const rule = rows[row];
    if (!rule || COMPUTED.includes(row) || !rule.to.includes(to)) continue;
    const key = row + ':' + to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ row, to, weight: rule.weight, note: String(item.note || '').slice(0, 160) });
  }
  return out;
}

/**
 * One axis's result from its pieces: the letter with more points, and the
 * strength from the margin (net ÷ points in play): moderate from a third with
 * at least 10 points in play, clear from two-thirds with at least 14; slight
 * whatever the margin when their own words sit on both sides. Ties go to the side with
 * the strongest single piece, then to the model's own pick, at slight.
 */
// The margins (net points ÷ points in play) a strength needs: a third for
// moderate, two-thirds for clear (from a quarter and three-fifths, October
// 2026, after a slight extravert read as moderate).
const MODERATE = 1 / 3;
const CLEAR = 2 / 3;

function scoreAxis(axis, pieces, fallback) {
  const [a, b] = POLES[axis];
  const points = { [a]: 0, [b]: 0 };
  const best = { [a]: 0, [b]: 0 };
  for (const p of pieces) {
    if (p.to !== a && p.to !== b) continue;
    const w = WEIGHT[p.weight] || 0;
    points[p.to] += w;
    best[p.to] = Math.max(best[p.to], w);
  }
  const total = points[a] + points[b];
  let choice;
  if (points[a] !== points[b]) choice = points[a] > points[b] ? a : b;
  else if (best[a] !== best[b]) choice = best[a] > best[b] ? a : b;
  else choice = [a, b].includes(fallback) ? fallback : a;
  const margin = total ? Math.abs(points[a] - points[b]) / total : 0;
  let strength = 'slight';
  if (total >= 14 && margin >= CLEAR) strength = 'clear';
  else if (total >= 10 && margin >= MODERATE) strength = 'moderate';
  // Their own words put them on both sides (mixed, an ambivert): what they
  // say of themselves outweighs any lead the rest of the ledger builds.
  if (pieces.some(p => p.row === 'own-words' && p.to === a) && pieces.some(p => p.row === 'own-words' && p.to === b)) strength = 'slight';
  return { choice, strength, margin, points, total };
}

/** The extraversion score from the E/I result: slight 51–59, moderate 60–69, clear 70–85, mirrored for I. */
function extraversionFrom(result) {
  const m = result.margin;
  let lift;
  if (result.strength === 'clear') lift = 20 + Math.round(Math.min(1, (m - CLEAR) / (1 - CLEAR)) * 15);
  else if (result.strength === 'moderate') lift = 10 + Math.round(Math.min(1, (m - MODERATE) / (CLEAR - MODERATE)) * 9);
  // Slight: the margin, and how much was in play, so one piece on its own
  // is never as far from the middle as a slight lead over a full ledger.
  else lift = 1 + Math.round(Math.min(1, m / MODERATE) * Math.min(1, result.total / 10) * 8);
  return result.choice === 'E' ? 50 + lift : 50 - lift;
}

function bandFor(score) {
  if (score < 20) return 'very low';
  if (score < 40) return 'low';
  if (score <= 60) return 'moderate';
  if (score <= 80) return 'high';
  return 'very high';
}

/**
 * Scores the MBTI letters of one answer in place, from each letter's ledger
 * and the digest's computed rows. Leaves an answer with no ledgers alone (a
 * report written before ledgers, or one pinned to its card). Keeps the type,
 * its nickname, the extraversion score and the card's copies in step.
 * Each axis where the sum overturned the model's own letter is pushed onto
 * `flips`, when given, so the server can count them. Returns the data.
 */
function scoreMbti(data, digest, flips) {
  if (!data || typeof data !== 'object' || !data.mbti || !Array.isArray(data.mbti.letters)) return data;
  const letters = data.mbti.letters;
  if (!letters.some(l => l && Array.isArray(l.ledger))) return data;
  const computed = computedPieces(digest);
  let eiResult = null;
  for (const letter of letters) {
    const axis = AXES.find(x => x === String(letter && letter.axis || '').toUpperCase().replace(/\s/g, ''));
    if (!axis || !Array.isArray(letter.ledger)) continue;
    const pieces = cleanLedger(axis, letter.ledger).concat(computed[axis] || []);
    const own = String(letter.choice || '').toUpperCase();
    const result = scoreAxis(axis, pieces, own);
    if (Array.isArray(flips) && POLES[axis].includes(own) && own !== result.choice) flips.push(axis + ' ' + own + '→' + result.choice);
    letter.choice = result.choice;
    letter.strength = result.strength;
    letter.ledger = pieces.map(p => ({ row: p.row, pointsTo: p.to, weight: p.weight, note: p.note }));
    if (axis === 'E/I') eiResult = result;
  }
  const byAxis = Object.fromEntries(letters.filter(l => l && l.axis).map(l => [String(l.axis).toUpperCase().replace(/\s/g, ''), l.choice]));
  if (AXES.every(axis => POLES[axis].includes(byAxis[axis]))) {
    const type = AXES.map(axis => byAxis[axis]).join('');
    const was = data.mbti.type;
    // A report split from its card carries no type of its own; it is not given one.
    if ('type' in data.mbti && type !== was) {
      const oldName = data.mbti.nickname;
      data.mbti.type = type;
      data.mbti.nickname = NICKNAMES[type] || oldName;
      // The model named the type it expected in the lines it wrote around
      // it (the card's write-up, the summary); where the sum came out
      // otherwise, those lines say the type that is printed.
      if (NICKNAMES[was]) renameType(data, was, type, NICKNAMES[was], data.mbti.nickname);
    }
    if (data.card && typeof data.card === 'object' && 'mbti' in data.card) data.card.mbti = type;
  }
  if (eiResult && data.bigFive && data.bigFive.extraversion) {
    const score = extraversionFrom(eiResult);
    data.bigFive.extraversion.score = score;
    if ('band' in data.bigFive.extraversion) data.bigFive.extraversion.band = bandFor(score);
    if (data.card && data.card.bigFive && typeof data.card.bigFive === 'object') data.card.bigFive.extraversion = score;
  }
  return data;
}

/** Every string in an answer with the old type and nickname replaced by the new, the ledgers aside. */
function renameType(value, from, to, fromName, toName) {
  const type = new RegExp('\\b' + from + '(s?)\\b', 'g');
  const fix = text => {
    let out = text.replace(type, to + '$1');
    if (fromName && toName && fromName !== toName) out = out.split(fromName).join(toName);
    return out;
  };
  const walk = node => {
    if (Array.isArray(node)) node.forEach((item, i) => { if (typeof item === 'string') node[i] = fix(item); else walk(item); });
    else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (key === 'ledger') continue;
        if (typeof node[key] === 'string') node[key] = fix(node[key]);
        else walk(node[key]);
      }
    }
  };
  walk(value);
}

/** The rubric as the prompt prints it: one table per axis. */
function rubricText() {
  return AXES.map(axis => {
    const rows = Object.entries(RUBRIC[axis]).map(([id, r]) =>
      '| `' + id + '` | ' + r.text + ' | ' + r.to.join(' or ') + ' | ' + (r.weight === 'none' ? 'neither way' : r.weight) + ' |');
    return '**' + axis + '**\n\n| row | evidence | points to | weight |\n|---|---|---|---|\n' + rows.join('\n');
  }).join('\n\n');
}

module.exports = { RUBRIC, AXES, POLES, COMPUTED, NICKNAMES, WEIGHT, computedPieces, computedText, cleanLedger, scoreAxis, extraversionFrom, bandFor, scoreMbti, rubricText };
