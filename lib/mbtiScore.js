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
    'convenes-known-circle': { to: ['E'], weight: 'weak', text: 'Initiating gatherings — dinners, sport, trips — for a familiar circle: a very slight lean to E, once however often.' },
  },
  'N/S': {
    'own-words': { to: ['N', 'S'], weight: 'strong', text: 'Their own words about how they think: a big-picture person (N) / a details, facts person (S).' },
    'theorises': { to: ['N'], weight: 'medium', text: 'Their own writing speculates, theorises, links unrelated fields, asks what something means.' },
    'captions-meaning': { to: ['N'], weight: 'medium', text: 'Captions that go past the record to meaning, analogy or pattern — a clear share of them.' },
    'compares-tracks': { to: ['S'], weight: 'weak', text: 'Compares specs and options before deciding; tracks exact figures, keeps records — outside their job: the numbers their work runs on are a topic, not a thinking style.' },
    'practical-craft': { to: ['S'], weight: 'weak', text: 'Practical skills built step by step and kept up; sensory craft (food, tools, materials) for its own sake. A sport\'s technique does not count: every sport has one.' },
    'watches': { to: ['N', 'S'], weight: 'weak', text: 'Watches long explanation — essays, analysis (N) / how-to, repair, recipes (S).' },
    'shared-words': { to: ['N', 'S'], weight: 'weak', text: 'Words they choose to pass on — quotes, book passages, titles they name or search for: symbol, meaning, what lies under the surface, a fable like The Little Prince (N) / practical, factual, step by step (S). Once for all of it; their own writing outranks it.' },
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
    'shared-words': { to: ['T', 'F'], weight: 'weak', text: 'Words they choose to pass on — quotes, book passages, titles: argument, systems, how things work (T) / feeling, worth, how people are treated (F). Once for all of it; their own writing outranks it.' },
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
  return 'Counted from this digest by the code, for your MBTI ledgers (do not enter these rows yourself; ' +
    'weigh them with the rest of the evidence, at about the weight shown):\n' + lines.join('\n');
}

// J/P is read by area (October 2026): one person often plans hard in one
// part of life and loosely in another, and a ledger of rows alone let each
// run pick a different part, so the letter swung between runs. Each J/P note
// opens with its area, and a row may repeat across areas but not inside one.
const JP_AREAS = ['work and money', 'travel', 'plans with friends', 'day to day'];

/** The J/P area a note opens with ("travel: …"), or '' for none. */
function areaOf(note) {
  const head = String(note || '').split(':')[0].trim().toLowerCase();
  return JP_AREAS.includes(head) ? head : '';
}

// A note with no count and no quote ("occasionally books…") is an impression,
// and impressions come and go between runs: it counts as weak whatever its row.
function counted(note) {
  return /\d|["“”]/.test(String(note || ''));
}

/** A model's ledger for one axis, held to the rubric: known rows, allowed letters, each row once per letter (on J/P, once per letter and area); an uncounted, unquoted note is weak. */
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
    const note = String(item.note || '').slice(0, 160);
    const key = row + ':' + to + (axis === 'J/P' ? ':' + areaOf(note) : '');
    if (seen.has(key)) continue;
    seen.add(key);
    const weight = rule.weight === 'none' || counted(note) ? rule.weight : 'weak';
    out.push({ row, to, weight, note });
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
 * Checks one answer's MBTI against its own ledgers, without changing it
 * (October 2026: the model decides the letters, their strength and the
 * extraversion score; the rubric is its guide, not a rule the code enforces.
 * When the code set the letter, a close E/I flipped under a paragraph the
 * model had written for the other letter: "extraversion holds a narrow lead"
 * above a slight I). Each ledger is cleaned to the rubric. Where the ledger's
 * own tally would pick the other letter, or the extraversion score sits on
 * the other side of 50 from the E/I letter, a line is pushed onto `notes`,
 * when given, for the server to log and count. Returns the data.
 */
function scoreMbti(data, digest, notes) {
  if (!data || typeof data !== 'object' || !data.mbti || !Array.isArray(data.mbti.letters)) return data;
  const letters = data.mbti.letters;
  const computed = computedPieces(digest);
  const say = line => { if (Array.isArray(notes)) notes.push(line); };
  for (const letter of letters) {
    const axis = AXES.find(x => x === String(letter && letter.axis || '').toUpperCase().replace(/\s/g, ''));
    if (!axis || !Array.isArray(letter.ledger)) continue;
    const pieces = cleanLedger(axis, letter.ledger);
    const own = String(letter.choice || '').toUpperCase();
    const tally = scoreAxis(axis, pieces.concat(computed[axis] || []), own);
    if (POLES[axis].includes(own) && own !== tally.choice && tally.total > 0) say(axis + ' ' + own + ' (ledger ' + tally.choice + ')');
    letter.ledger = pieces.map(p => ({ row: p.row, pointsTo: p.to, note: p.note }));
  }
  const ei = letters.find(l => l && String(l.axis || '').toUpperCase().replace(/\s/g, '') === 'E/I');
  const score = data.bigFive && data.bigFive.extraversion && Number(data.bigFive.extraversion.score);
  if (ei && Number.isFinite(score) && ((ei.choice === 'E' && score < 50) || (ei.choice === 'I' && score > 50))) {
    say('E/I ' + ei.choice + ' (extraversion ' + score + ')');
  }
  return data;
}

/** The rubric as the prompt prints it: one table per axis. */
function rubricText() {
  return AXES.map(axis => {
    const rows = Object.entries(RUBRIC[axis]).map(([id, r]) =>
      '| `' + id + '` | ' + r.text + ' | ' + r.to.join(' or ') + ' | ' + (r.weight === 'none' ? 'neither way' : r.weight) + ' |');
    return '**' + axis + '**\n\n| row | evidence | points to | weight |\n|---|---|---|---|\n' + rows.join('\n');
  }).join('\n\n');
}

module.exports = { RUBRIC, AXES, JP_AREAS, areaOf, counted, POLES, COMPUTED, NICKNAMES, WEIGHT, computedPieces, computedText, cleanLedger, scoreAxis, extraversionFrom, bandFor, scoreMbti, rubricText };
