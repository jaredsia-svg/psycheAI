// Prompts and structured-output schemas for the two Claude calls.
//
// Both calls use structured outputs, so the model's response is guaranteed to
// match the schema and the UI can render it without defensive parsing. The
// schemas obey the structured-output constraints: every object sets
// `additionalProperties: false` and lists all of its properties in `required`,
// and there are no numeric or string-length constraints (those are stated in
// the prompt instead, and clamped on the client).
'use strict';

const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP',
  'Uncertain',
];

const ENNEAGRAM_TYPES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Uncertain'];

// Which report layout this server writes — structured (four parts, one
// thread, no Enneagram, signature patterns on the free card) or classic.
// Read once, here at the top, because both the free card call and the full
// report call switch on it. An unrecognised value falls back rather than
// failing a paid call: a typo in an environment variable should not cost a
// reader a report. See "the structured report" further down.
// The structured layout's characters: a fixed catalogue the model chooses
// from, so every character has artwork of its own. The artwork is an
// original emblem drawn for this app (docs/copy.js, CHARACTER_EMBLEMS) — never
// the studio's character art or logos, which are not ours to ship. Spread
// across temperaments so most readers have a close fit; held to the client's
// list by a check in tools/selftest.mjs.
const CHARACTER_CATALOGUE = [
  ['Mulan', 'Disney'], ['Elsa', 'Disney'], ['Moana', 'Disney'], ['Simba', 'Disney'], ['Rapunzel', 'Disney'],
  ['Judy Hopps', 'Disney'], ['Nick Wilde', 'Disney'], ['Baymax', 'Disney'],
  ['Woody', 'Pixar'], ['Buzz Lightyear', 'Pixar'], ['WALL-E', 'Pixar'], ['Remy', 'Pixar'], ['Joy', 'Pixar'],
  ['Iron Man', 'Marvel'], ['Captain America', 'Marvel'], ['Spider-Man', 'Marvel'], ['Hulk', 'Marvel'],
  ['Black Panther', 'Marvel'], ['Doctor Strange', 'Marvel'],
  ['Wonder Woman', 'DC'], ['Batman', 'DC'],
  ['Pikachu', 'Pokémon'], ['Mario', 'Nintendo'], ['Link', 'Nintendo'], ['Totoro', 'Studio Ghibli'],
  ['Shrek', 'DreamWorks'], ['Po', 'DreamWorks'], ['Hiccup', 'DreamWorks'],
];
const CHARACTER_NAMES = CHARACTER_CATALOGUE.map(([name]) => name);

const REPORT_LAYOUTS = ['structured', 'classic'];
const REPORT_LAYOUT = (() => {
  const raw = String(process.env.PSYCHEAI_REPORT_LAYOUT || '').trim().toLowerCase();
  if (!raw) return 'structured';
  if (REPORT_LAYOUTS.includes(raw)) return raw;
  console.warn('PSYCHEAI_REPORT_LAYOUT must be one of ' + REPORT_LAYOUTS.join(', ') +
    ' — got ' + JSON.stringify(raw) + '; using structured.');
  return 'structured';
})();

const CONFIDENCE_LEVELS = ['very low', 'low', 'moderate', 'high'];

// How a trait has moved across the span of the export, rather than whether it
// is there at all. An interest somebody dropped in 2019 and one they are in
// the middle of used to reach the reader identically, because nothing in the
// digest told the model when any given caption was written — see sampleTexts
// in docs/digest.js, which now prefixes each one with its year.
//
// Ordered loosely from most to least present. `dormant` is the one that earns
// its place: without it the honest answer to "do they still run?" had to be
// squeezed into either "yes" or silence.
const TRAJECTORIES = ['structural', 'stable', 'rising', 'declining', 'dormant', 'phasic'];
const BANDS = ['very low', 'low', 'moderate', 'high', 'very high'];

// ---------- reusable schema fragments ----------

const str = { type: 'string' };
const strList = { type: 'array', items: { type: 'string' } };

function object(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function listOf(properties) {
  return { type: 'array', items: object(properties) };
}

// The five canonical love languages, spelled the same way everywhere so the
// client can map each one to its own icon without guessing.
const LOVE_LANGUAGES = [
  'Words of affirmation', 'Acts of service', 'Quality time', 'Receiving gifts', 'Physical touch',
];

const loveLanguageList = listOf({
  language: { type: 'string', enum: LOVE_LANGUAGES },
  strength: { type: 'string', enum: ['primary', 'secondary', 'minor'] },
  why: { type: 'string', description: 'One or two sentences of evidence from their actual data. Say plainly when the evidence is thin.' },
  inPractice: { type: 'string', description: 'One concrete sentence: what this looks like for this person specifically, not the textbook description.' },
});

const pointList = listOf({
  title: { type: 'string', description: 'A few words.' },
  detail: { type: 'string', description: 'Two or three sentences, concrete and specific to this person.' },
});

const traitSchema = object({
  score: { type: 'integer', description: '0-100.' },
  band: { type: 'string', enum: BANDS },
  reading: { type: 'string', description: 'Two or three sentences on what this looks like in their actual life.' },
  evidence: { ...strList, description: 'Two to four specific things from the data that led you here.' },
});

// Deliberately not `BANDS`, and deliberately not a number. These describe the
// *pattern* rather than grading the person: "under strain" is a statement
// about a rhythm, where "poor" would be a verdict on a life. `not enough
// evidence` is load-bearing rather than a formality — the six dimensions are
// evidenced very unevenly (posting times are complete; anything about
// physical activity is whatever somebody chose to post), so the model needs a
// way to decline that does not read as a bad result.
const WELLNESS_BANDS = ['steady', 'mixed', 'under strain', 'not enough evidence'];

// Three horizons rather than a flat list, because "what should I do about my
// career" answered without a timeframe is a wish list. Something startable
// this week is what makes the rest of it credible.
const CAREER_HORIZONS = ['this week', 'this quarter', 'this year'];

// The six dimensions, and the one place their per-dimension guidance lives.
// It is rendered twice from here — as `description` on each schema reference,
// and as a list inside PREMIUM_SYSTEM (see `wellnessBrief()`) — so the two can
// never drift, and so the guidance survives even if a provider ignores a
// `description` sitting beside a `$ref`.
const WELLNESS_DIMENSIONS = [
  ['lifeTrajectory', 'Where this person appears to be in their life and which way it has been moving, read across the whole span of the export rather than from the last few months. What phase the data suggests — studying, building something, settling, changing direction, drifting, stuck — and whether the arc across years reads as ascending, plateaued, turbulent or falling away. Read their satisfaction with their own life from what they actually say and do about it: what they celebrate, what they stop mentioning, what they keep returning to, what they seem to have given up on. **Name the difficult stretches directly.** A year where the posting thinned to nothing, a thread that stopped mid-sentence, a subject that vanished, a period whose captions read as genuinely bleak — say so plainly, in those words, and say what the data shows about it: when it started, how long it ran, what changed around it, whether they came out the other side. This is the section a reader opens to be told the truth about a hard period rather than to have it euphemised into a "quieter chapter", and softening it is the failure mode here, not the safe option. Two things remain a matter of accuracy rather than delicacy: an export shows you *that* a period was hard and rarely *why*, so do not invent the cause, and a gap in posting is genuinely ambiguous — people go quiet for a new baby and a new job as often as for grief. Say which reading the surrounding evidence actually supports, and say when it supports neither.'],
  ['outlook', 'Whether they write as though things tend to work out or tend not to, and how strongly, from their own words. Read how they frame the future against the past: are plans stated as expectation or as hope, are setbacks written as temporary and specific or as permanent and general, does good news get claimed or hedged, do they still write about wanting things. Weigh their own captions and messages far above anything they reposted. **Be direct and use the real word.** If the writing is bleak, say bleak. If it reads as despairing, exhausted, resigned, defeated, or as somebody who has stopped expecting good things, name it — "despair", "hopeless", "depressing", "grim" are all available to you and are frequently the honest reading. A reader who paid for this section and is genuinely in a dark place is not served by "a somewhat retrospective register"; they are served by being told what their own writing sounds like from outside. Two honest cautions, both about accuracy rather than tone: a feed is partly a performance, so relentless positivity may be presentation rather than outlook, and a dry or deadpan register is a style rather than pessimism — do not read gallows humour as collapse. Ground whatever you say in the actual lines they wrote.'],
  ['socialConnection', 'The shape of their contact with other people — how many distinct people rather than how many messages, whether it reaches beyond an established circle, whether it runs both ways. Use `counts.distinctPeopleCommentedOn`, `activeThreads` and `mostEngagedWith` against the comments they receive. Read reciprocity honestly: giving far more than they get back is a finding worth naming gently.'],
  ['cognitiveLoad', 'How much they appear to be carrying at once, from the shape of their activity rather than any claim about their mind: how many separate threads, projects and commitments show up in what they write, how much they switch between them, whether announced plans accumulate faster than they close out. This is about apparent load, never about capacity, intelligence or attention as a faculty.'],
  ['meaning', 'What appears to give their activity a point: what they return to over years, what they show up for without being asked, whether their stated commitments and their actual behaviour agree. This is the one dimension where a long, boring, consistent record is the strongest possible signal.'],
  ['rhythmAndActivity', 'Two related things read together: when they are active across the day and week, and how much physical activity shows up in what they post. For rhythm, the hour-of-day and day-of-week histograms are complete rather than sampled, which makes this the best-evidenced part of the six — read the shape, a consistent window, a drift later over months, a split between weekday and weekend. You are reading *posting times*, which are the times somebody reached for a phone; they are not a sleep record and must never be presented as one. For activity, read only what they chose to post — trails, gyms, sport, being outdoors, the accounts they follow about it, whether it appears seasonally or year-round. That half is the thinnest evidence here and the easiest to over-read: somebody who never posts about exercise may simply not post about exercise, which is silence rather than a finding. Never infer anything about their body, weight, shape, fitness, diet or physical health from either half.'],
];

// One definition, referenced six times, rather than six inlined copies.
//
// This is not tidiness. Anthropic compiles a structured-output schema into a
// sampling grammar, and repeated sub-schemas compound its size — six inlined
// copies of {enum, enum, string, string[]} is what pushed this call past the
// limit and returned "The compiled grammar is too large" on every paid run.
// The limit itself is undocumented and only findable by hitting it, so the
// rule to keep here is the general one: a shape used more than once goes in
// `$defs` and is referenced, never pasted.
//
// A `description` sits beside each `$ref` at the use site, which JSON Schema
// 2020-12 allows. Providers vary on whether they honour a sibling of `$ref`,
// so nothing depends on it: `wellnessBrief()` puts the same guidance in the
// system prompt, where it is read either way.
const WELLNESS_DIMENSION_DEF = object({
  band: { type: 'string', enum: WELLNESS_BANDS },
  confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
  reading: {
    type: 'string',
    description: 'Two or three sentences on what the data actually shows for this dimension, written to ' +
      'them as "you". The system prompt lists what to read for each of the six.',
  },
  evidence: {
    ...strList,
    description: 'Two to four specific things from the digest behind this — a rhythm, a count, a gap, a ' +
      'caption. Quote the real number or phrase rather than gesturing at it. If you cannot fill this ' +
      'honestly, the band is "not enough evidence".',
  },
});

// `{title, detail}` (twice: wellness suggestions, attachment implications) and
// `{headline, detail}` (twice: the two career facets). Small next to the
// wellness dimension, but the rule is the rule — nothing in this schema is
// inlined twice, and a check holds it.
const PREMIUM_POINT_DEF = object({
  title: { type: 'string', description: 'A few words.' },
  detail: { type: 'string', description: 'Two or three sentences, concrete and specific to this person.' },
});
const PREMIUM_FACET_DEF = object({
  headline: { type: 'string', description: 'A short phrase naming it.' },
  detail: { type: 'string', description: 'Two or three sentences, specific to them rather than to anyone in their position.' },
});
const premiumPointList = { type: 'array', items: { $ref: '#/$defs/point' } };

/** Attaches `$defs` to a schema root, where a local `$ref` resolves against. */
function withDefs(defs, schema) {
  return { ...schema, $defs: defs };
}

function wellnessDimensionRefs() {
  return Object.fromEntries(WELLNESS_DIMENSIONS.map(([key, guidance]) => [
    key, { $ref: '#/$defs/wellnessDimension', description: guidance },
  ]));
}

/** The same six descriptions as a prompt list, so they are read either way. */
function wellnessBrief() {
  return WELLNESS_DIMENSIONS.map(([key, guidance]) => '  - **' + key + '** — ' + guidance).join('\n');
}

/**
 * Follows a local `$ref` to the definition it names. Exported because the
 * self-test introspects these schemas field by field, and a reference is not
 * something it can walk into on its own.
 */
function deref(root, node) {
  if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
  const path = node.$ref.replace(/^#\//, '').split('/');
  let target = root;
  for (const step of path) target = target && target[step];
  return target || node;
}

// ---------- the shareable card ----------
//
// This is the part that gets compressed into the QR code, so every field is
// deliberately short. It has to carry enough for a second model call to reason
// about compatibility without the original export.
//
// It used to carry about a tenth of the report, and the wrong tenth: the
// compatibility prompt is told that attachment and love languages decide a
// romantic read, that contact appetite decides a platonic one, and that
// standards and follow-through decide a professional one — and the card
// carried none of those, while spending eight slots on interests, the thing
// the same prompt says matters least. The model was being asked to weigh
// evidence it had never been given, so it fell back on hobbies and filled the
// rest with plausible noise.
//
// The room for this was not lying spare — measured against the scan ladder, a
// payload much past 730 characters stops surviving a 300px redraw or a 480p
// camera frame, and the old card already sat at 633. It was bought instead: by
// packing the wire format in docs/card.js, and by cutting what this prompt does
// not actually weigh. Interests went from eight slots to four, career detail
// collapsed into one `workStyle` line, and the per-trait commentary went
// entirely — the derived-facts block now hands the model both Big Five scores
// and the gap between them, which was the part it could not work out for itself.

const CARD_SCHEMA = object({
  name: { type: 'string', description: 'Their first name or handle. Under 24 characters.' },
  headline: { type: 'string', description: 'One short phrase capturing who they are. Under 60 characters.' },
  summary: { type: 'string', description: 'Two sentences. Under 120 characters.' },
  mbti: { type: 'string', enum: MBTI_TYPES },
  enneagram: { type: 'string', description: 'Type and wing joined, e.g. "9w1", or just "9" if no wing is clear. Empty string if Uncertain. Under 8 characters.' },
  bigFive: object({
    openness: { type: 'integer' },
    conscientiousness: { type: 'integer' },
    extraversion: { type: 'integer' },
    agreeableness: { type: 'integer' },
    neuroticism: { type: 'integer' },
  }),
  interests: { ...strList, description: 'Up to 4 short interest labels, two or three words each, each under 34 characters.' },
  values: { ...strList, description: 'Up to 3 short value labels, each under 34 characters.' },
  beliefs: { ...strList, description: 'Up to 2 short belief labels, each under 34 characters. Empty array if the data does not support any.' },
  relationshipStrengths: { ...strList, description: 'Up to 2 short phrases, each under 34 characters.' },
  relationshipWeaknesses: { ...strList, description: 'Up to 2 short phrases, each under 34 characters. Real weaknesses, not humblebrags.' },
  careerStrengths: { ...strList, description: 'Up to 2 short phrases, each under 34 characters.' },
  attachment: { type: 'string', description: 'How they attach, plus "(tentative)". Use the standard four names — secure, anxious, avoidant, fearful-avoidant — written as a leaning rather than a category, and add the behaviour that shows it where it fits: "Anxious-leaning, exits when contact drops (tentative)", "Leans secure (tentative)". The leaning wording matters: this travels in a QR code to a second analyst, and the difference between "how they have been behaving" and "what they are" survives the compression. Under 52 characters.' },
  attachmentWhy: { type: 'string', description: 'The working behind that guess, compressed: the behavioural traces it rests on. Under 95 characters. A style label with no reasoning is worthless to a second analyst.' },
  loveReceiving: { ...strList, description: 'Up to 2, strongest first, each as "Quality time (primary)", under 34 characters. The romantic read turns on these, so do not leave them empty when the profile has them.' },
  loveGiving: { ...strList, description: 'Just the strongest, as "Acts of service (primary)", under 34 characters. Often different from how they want to receive.' },
  rhythm: { type: 'string', description: 'Their daily and social rhythm in a few words. Under 48 characters.' },
  energy: { type: 'string', description: 'How outward-facing they are and how much contact they want: broadcaster, participant or lurker, and whether they keep a wide circle or a few close ties. Under 60 characters.' },
  workStyle: { type: 'string', description: 'How they actually work — standards, follow-through, pace. Under 75 characters.' },
  confidence: { type: 'integer', description: '0-100, how well the data supports this profile.' },
});

// ---------- profile analysis ----------

const PROFILE_SCHEMA = object({
  confidence: object({
    score: { type: 'integer', description: '0-100, for how well the evidence you were actually shown supports this profile — not for how much activity the account holds. See the Confidence section of the system prompt.' },
    level: { type: 'string', enum: CONFIDENCE_LEVELS },
    rationale: { type: 'string', description: 'One or two sentences on what the data does and does not support. Never cite a raw total as evidence of coverage: how many messages exist is a fact about the account, how many you read is a fact about your evidence.' },
    basedOn: { ...strList, description: 'Two to four short phrases naming the sources this score rests on, each stating what you saw of what exists, read off coverage.sampling — "436 of 442 captions", "300 of 9,741 own messages", "complete hour-of-day and month-by-month histograms". Shown to the reader beside the score, so it is what makes the number checkable rather than asserted.' },
  }),
  // One noun to hang the whole profile on. It is the first thing they see,
  // and the thing they will quote back at their friends.
  essence: object({
    character: { type: 'string', description: 'One globally famous animated or superhero character this person is most like in temperament — from Disney, Pixar, Marvel, DC, Nintendo, Pokémon, or similar. Use the character\'s most recognizable name such as Iron Man or Hulk rather than Tony Stark or Bruce Banner. It must be one an ordinary person anywhere in the world would recognise — no deep-cut side characters, no obscure comics runs. Match on how they behave and what drives them, never on how anyone looks. Reach past the first obvious fit and past the flattering one: the point is recognition, not a compliment.' },
    franchise: { type: 'string', description: 'The one or two words the character is from, as most people would say it: "Pokémon", "Pixar", "Marvel", "Nintendo", "Studio Ghibli", "Disney".' },
    icon: { type: 'string', description: 'Exactly one emoji character standing for that character — the thing they carry, wear, or are known for. Pikachu is a lightning bolt, Mario a mushroom, Elsa a snowflake, Captain America a shield. Nothing else — no words, no punctuation, no variation text.' },
    why: { type: 'string', description: 'Two or three sentences on why this character and not a neighbouring one, tied to specific things in their data. Name the trait the two of them share, not the plot of the film. Make the comparison earn itself.' },
  }),

  summary: { type: 'string', description: 'Two or three tight paragraphs, separated by blank lines, written to them as "you". This is the whole report in miniature, so land the findings from every section below — the MBTI type, where they sit high and low on the Big Five, what they care about, how they are to be close to, and how they work — as one flowing portrait rather than a list. Name the type and the traits explicitly so a reader who stops here still knows the answers. Do not re-explain the character above, and do not contradict any section below. ' },
  // The shareable card's own blurb — see cardBlurb() in docs/app.js. That
  // function used to build this at read time by skimming one or two literal
  // sentences off three unrelated fields (summary's opening, one relationship
  // strength, one career strength) and joining them with a full stop, which
  // produced an excerpt rather than a summary — whichever sentence happened to
  // come first in each field, however well or badly it read stitched to the
  // next. Asking for the real thing here, from the model that just wrote the
  // paragraphs it condenses, is the fix.
  //
  // The first of the four sentences carries `essence.why` rather than more of
  // `summary`. The card prints the character's name in large type immediately
  // above this paragraph and then never justifies it — the reasoning lives in
  // the report's own essence section, which somebody looking at the card is not
  // reading. That left the card's single most prominent claim as the one thing
  // on it with no support. It is a swap, not an addition: the fourth sentence
  // used to be summary's second paragraph's second sentence, and the card stays
  // four sentences long because its whole value is being short enough to read
  // at a glance.
  cardHighlights: { type: 'string', description: 'Exactly four sentences for the shareable card shown at the top of the report — genuine summarizing, in your own words, never sentences copied verbatim out of `essence.why` or `summary`. The first sentence condenses `essence.why`: why this character and not a neighbouring one, naming the trait they share. The card prints the character\'s name directly above this paragraph, so do not open by restating the name or by announcing the comparison ("You are like X") — go straight to what the two of them have in common. The second and third sentences summarize the first paragraph of `summary`; the fourth summarizes the second paragraph. (If `summary` runs to a third paragraph, it is not covered here.) Keep the same "you" voice and name the same type and traits `summary` already named, but write these four sentences to stand on their own as a short, self-contained portrait — not a trailer that only makes sense once someone has read the fuller version below it.' },
  bigFive: object({
    openness: traitSchema,
    conscientiousness: traitSchema,
    extraversion: traitSchema,
    agreeableness: traitSchema,
    neuroticism: traitSchema,
  }),
  mbti: object({
    type: { type: 'string', enum: MBTI_TYPES },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
    nickname: { type: 'string', description: 'The common name for this type, e.g. "The Advocate". Empty string if the type is Uncertain.' },
    letters: listOf({
      axis: { type: 'string', description: 'One of: E/I, N/S, T/F, J/P.' },
      choice: { type: 'string', description: 'The single letter you picked. On the E/I axis this is not a free choice: it must agree with the Big Five extraversion score written above it — 55 or higher takes E, 45 or lower takes I, and in between either is defensible at slight strength. Never pick it off the absence of group threads, which is the ordinary case on these platforms and evidence of nothing.' },
      strength: { type: 'string', enum: ['slight', 'moderate', 'clear'], description: 'How strongly the data leans this way, read as the *balance inside `why`* between the behaviour that supports this letter and the behaviour that tempers it, rather than asserted on its own. `clear` only where the contrary behaviour stayed thin after an honest search for it; `moderate` where this letter is the stronger of two real showings; `slight` where the two are close enough that a careful reader could take the other letter. Most people are not extreme on every axis and at least one of the four is usually slight. On E/I, track the Big Five extraversion score you have already written: slight near 50, clear only past roughly 70 or 30.' },
      why: { type: 'string', description: 'The whole case for this letter, written at the depth a Big Five trait gets rather than as a caption: three or four sentences, one paragraph. **E/I is the exception and is deliberately shorter.** That letter is already decided by the Big Five extraversion score printed above it — see `choice` — so re-deriving it here means arguing the same evidence twice in one report, a page apart, for a conclusion that was never in doubt. Two or three sentences: name the score, say what it means for how they actually spend a week, and temper it if the behaviour is more mixed than the number. The other three axes get the full three or four, because those are the ones the number does not settle. Lay out the actual behaviours that put the letter here — at least three distinct pieces of evidence drawn from different parts of the digest, not three readings of the same caption, each with a count or a proportion on it. Point at the behaviour rather than the conclusion: "thirty-one of the fifty sampled captions name a specific place, price or model" earns its letter, "you are detail-oriented" only restates it. Then temper it in the same paragraph: where behaviour runs the other way, say so plainly, give it its own count, and say what it does and does not overturn — an axis argued only in its own favour is the failure this field exists to prevent, and `strength` is read off how close that tempering comes. Where the evidence genuinely runs one way, say that plainly instead of manufacturing a doubt to look even-handed.' },
      inPractice: { type: 'string', description: 'One sentence on what this letter *costs or buys them going forward* — the consequence, not a second telling of the evidence. `why` above is backward-looking: it argues from behaviour that already happened. This is the only forward-looking line on the axis, and it is the reason a reader who agrees with the letter should care. So it must say something `why` did not: what this makes easy, what it makes expensive, where it will cost them next. If it could be deleted without losing anything a reader could act on, it was a restatement and has failed. Concrete, not textbook.' },
    }),
    caveat: { type: 'string', description: 'One or two sentences on how much weight to put on this, including that MBTI is popular rather than validated.' },
  }),

  // A second lens beside MBTI — one type, one wing, one paragraph of real
  // explanation rather than a page of its own. No per-axis breakdown: MBTI
  // already carries the long-form typing read, and two of those side by side
  // would be a wall rather than a second look.
  enneagram: object({
    type: { type: 'string', enum: ENNEAGRAM_TYPES },
    wing: { type: 'string', description: 'The single adjacent type number that flavours the core type, written bare, e.g. "1" for a 9w1. Empty string if the type is Uncertain or no wing is clear.' },
    nickname: { type: 'string', description: 'The common name for this type, e.g. "The Peacemaker". Empty string if the type is Uncertain.' },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
    why: { type: 'string', description: 'Five or six sentences, not two or three. Explain the core type itself — the core fear and desire it organises around, in plain language, as if the reader has never heard of it — then explain what the wing specifically adds or shifts, again in plain language. Only then tie both to specific things in their data. A reader should finish this understanding the number and the wing on their own terms, not just being told which ones they got.' },
    caveat: { type: 'string', description: 'One or two sentences on how much weight to put on this — Enneagram is a popular framework rather than a validated one, and a different lens from MBTI above rather than a restatement of it.' },
  }),

  // Behavioural read of the account itself: the rhythm, the trajectory, and
  // how outward- or inward-facing it is.
  // Four facets and nothing else. It opened on a summary and closed on a
  // blind-spots line, and both were cut: the summary restated in prose what
  // the four facets below it say with evidence attached, and the caveat
  // duplicated the confidence section that closes the whole report.
  activity: object({
    posting: object({
      headline: { type: 'string', description: 'A few words, e.g. "Bursts around events, quiet between".' },
      detail: { type: 'string', description: 'Two or three sentences on volume, format mix (posts, carousels, stories, reels) and what it suggests.' },
    }),
    rhythm: object({
      headline: { type: 'string', description: 'A few words on their daily and weekly pattern.' },
      detail: { type: 'string', description: 'Two or three sentences reading the hour-of-day and day-of-week histograms — when they reach for the app and what that implies about their days.' },
    }),
    trajectory: object({
      headline: { type: 'string', description: 'A few words, e.g. "Tapering since 2022".' },
      detail: { type: 'string', description: 'Two or three sentences on how their use changed across the months they have been on the platform, and what may sit behind the change.' },
    }),
    // What they consume, rather than what they publish. The export carries
    // four separate appetites — followed, liked, saved, replied to — and the
    // gaps between them are the finding, the same way the gap between giving
    // and receiving a love language is.
    //
    // This absorbed the old `engagement` facet, which asked for the
    // publish-against-read ratio on its own. That ratio is one sentence of
    // this read rather than a facet beside it, and having both meant two
    // facets reaching for the same counts and saying the same thing twice.
    // It carried three more parts once — a list of the accounts taking the
    // most attention, a read of Instagram's own inferred topics, and a pair of
    // recommendation lists closing the section. All were cut for length: the
    // behaviour section had grown to about a screen and a half and was
    // outweighing findings that say more about the person. What survives is
    // the part that needed no list to make its point.
    diet: object({
      headline: { type: 'string', description: 'A few words on the shape of what they take in, e.g. "Narrow, warm, mostly people they know".' },
      detail: { type: 'string', description: 'Three or four sentences. Lead with the concentration: how much of their liking, saving and commenting lands on how few accounts, against how many they follow. Include the publish-against-read ratio as a number. Then the gap between what they save and what their own posts show them actually doing — saving is where the ambition goes, and it often does not come back out. Cite real counts.' },
    }),
  }),
  interests: listOf({
    name: { type: 'string' },
    intensity: { type: 'string', enum: ['core', 'strong', 'casual'] },
    trajectory: { type: 'string', enum: TRAJECTORIES, description: 'How this has moved across the span of the data. See the trajectory rules in the system prompt — pick from the evidence, and pick "dormant" rather than flattering them when the evidence stopped.' },
    lastSeen: { type: 'string', description: 'The year of the most recent evidence for this, as four digits, e.g. "2024". Empty string only when literally nothing you are citing carries a date.' },
    detail: { type: 'string', description: 'One or two sentences on how this shows up for them. Where the trajectory is anything other than structural or stable, say so here in words as well — "you were deep in this through 2019 and it stops after that" — so a reader who never looks at the label still learns it.' },
    evidence: { type: 'string', description: 'What in the data supports it, with the count and the span in it: "eleven captions between 2017 and 2019, none since".' },
  }),
  beliefs: listOf({
    belief: { type: 'string' },
    detail: { type: 'string', description: 'One or two sentences.' },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
  }),
  values: listOf({
    value: { type: 'string' },
    trajectory: { type: 'string', enum: TRAJECTORIES, description: 'How this has moved across the span of the data. See the trajectory rules in the system prompt — pick from the evidence, and pick "dormant" rather than flattering them when the evidence stopped.' },
    lastSeen: { type: 'string', description: 'The year of the most recent evidence for this, as four digits, e.g. "2024". Empty string only when literally nothing you are citing carries a date.' },
    detail: { type: 'string', description: 'One or two sentences on what this looks like in practice for them.' },
    evidence: { type: 'string', description: 'What in the data supports it, with the count and the span in it.' },
  }),
  relationship: object({
    strengths: pointList,
    weaknesses: pointList,
    loveLanguages: object({
      receiving: { ...loveLanguageList, description: 'One to three languages they most likely want to be loved in, strongest first.' },
      giving: { ...loveLanguageList, description: 'One to three languages they most likely reach for when showing love, strongest first. These are often not the same as the ones above.' },
      caveat: { type: 'string', description: 'One sentence noting that love languages are a popular framework rather than a validated one, and that some of these — physical touch especially — barely show up in an Instagram export at all.' },
    }),
  }),

  career: object({
    strengths: pointList,
    weaknesses: pointList,
    workStyle: { type: 'string', description: 'Two or three sentences.' },
    watchOuts: { type: 'string', description: 'Two or three sentences on what could hold them back.' },
  }),

  // The roast. It used to live here, moved to the paid PREMIUM_SCHEMA so a
  // reader would not have to hand over their evidence a second time or wait
  // through a second call to see something the app charged for, and has now
  // moved back — a reader should be able to see it without paying anything,
  // the same way it worked the first time this section existed. What did not
  // move is the cover: `bonusBlock()` in docs/app.js ships this behind a
  // click-to-reveal gate rather than in the open, so nobody meets it who did
  // not go looking for it, exactly as before. `harsh` and `advice` are the
  // same two fields, same rules, that lived in PREMIUM_SCHEMA — see "The
  // roast — a different register entirely" below for the register this is
  // written in, since a report that is otherwise fair switching mid-document
  // into something written to sting is the one place in this whole prompt
  // where getting the tone wrong actually breaks the product.
  bonus: object({
    harsh: { type: 'string', description: 'Two or three paragraphs. Roast them. The least charitable reading of this person that the evidence still fully supports — the version a sharp friend would give after the second drink, with the softening removed, and with the wit left in: dry, well-aimed, quotable. Hunt specifically for the gaps between what they said and what they did: plans announced and never closed out, things saved and never acted on, a resolution posted every January and no evidence of it by March. Hunt for what they take and do not give back: friends whose posts they never turn up for while their own get a crowd, people who write them long comments and get an emoji in return, the accounts they read constantly and have never once spoken to. Name whatever else the data plainly shows them doing badly. Attack patterns and choices, never the person: nothing about their appearance, body, intelligence, worth or anything they cannot change. It must stay evidence-bound, exactly like every other section — cite the actual captions, counts and rhythms, because a roast lands on the detail that proves you were paying attention. Unkind and true, never cruel and unfounded. Every hard line must name a contradiction you could state plainly — what was claimed, and what behaviour actually costs it — rather than joining two unrelated true facts with a \'yet\' and letting the connective imply a hypocrisy neither supports. If the data does not support a hard read, say so and write less; an invented insult is worse than a short section, and a hollow contradiction is worse than both because it reads as though you were not thinking.' },
    advice: { type: 'string', description: 'Two or three paragraphs of the advice a friend would give if they were not managing your feelings. Draw on the whole digest — relationships, work, values, what they avoid, their rhythm and behaviour — not just the single most obvious pattern. Plain, direct, and specific to them. No self-help register, no affirmations, no "be kind to yourself". Say the thing that is actually hard to hear and then say what to do about it.' },
  }),

  card: CARD_SCHEMA,
});

const PROFILE_SYSTEM = `You are PsycheAI, an analyst who reads a person's Instagram data export and writes them an honest, specific, useful portrait.

# What you are given

A structured digest of one person's Instagram export: their bio and profile, counts of their activity, when they are active (hour-of-day and day-of-week histograms, posting regularity over time), a sample of their captions and the comments they wrote, the accounts they follow, the topics and ad-interests Instagram itself has inferred about them, and — unless they opted out — aggregate statistics about their direct messages plus a sample of their own messages (never the other side of a conversation).

**Check \`coverage.sources\` before you write anything.** It lists which exports this digest was actually built from. Instagram is always there. \`google\` and \`facebook\` are there only when the reader chose to add them, and each may be partly redacted on top of that — a reader can untick any single row. Never refer to a source that is not listed, and never assume a field exists because it usually does.


When \`google\` is present it holds a Google Takeout "My Activity" export: the channels they watch most on YouTube with counts and a sample of video titles, their most repeated YouTube and Google searches, and how much they browse in Chrome as two counts. There is no list of sites and no sample of what they asked Gemini; both were withheld, so do not reason about either, and do not read their absence as evidence of anything. When \`facebook\` is present it holds a sample of their Facebook posts and comments, a sample of their friends list, and — unless they opted out — a sample of their own Messenger messages, never the other side.

**These are the unperformed half of a life, and that is exactly why they are useful.** Instagram is what someone chose to publish; a search box is where they go when nobody is watching. Treat the two as different kinds of evidence rather than more of the same, and say so where they disagree — a person whose feed is all discipline and whose searches are all shortcuts is a more interesting read than either half alone.

**And they carry limits of their own.** Weight every item of this below a caption:

- **Watch history is not a statement of taste.** It contains autoplay, things opened once by accident, background noise, children, and other people using the same account. A single video means nothing at all. Only a channel someone returns to repeatedly is evidence, which is why you are given counts rather than a list.
- **Browsing is mostly work and errands.** You are given website names only — never the page, the address, the query or the time — because the rest is surveillance rather than signal. A domain that appears constantly may be their job, not an interest.
- **Prompts to an AI are task-shaped, not self-expressive.** People ask an assistant to do things, in a flat register, often for someone else. Read them for what someone is *working on*, never as a window into how they think or speak.
- **Searches are questions, not beliefs.** Someone searching a symptom, a religion or a political term is asking, not declaring. This bears especially on the hard limits below: a search is never evidence of a health condition, an orientation or an affiliation.

# How to read it

## When, not just whether

**Every sampled caption is prefixed with the year it was written** — \`[2019] finally ran the whole thing without stopping\`. Comments and messages are dated the same way. Read those years; they are the difference between describing a person and describing a person's archive.

\`samples.likedPostCaptions\` is the one list here **written by other people**. These are captions on posts the reader liked — their taste, not their voice. Never quote one back as something they wrote, never read their register or their vocabulary out of it, and never let it into a judgement about how they express themselves. What it is good for is what they reach for: the subjects, the humour, the causes, the accounts. It is the most recent hundred only, so it is evidence about now rather than about the archive.

Two things the caption sample's shape rules out. Places are shared out across years in proportion to the *square root* of each year's volume, and no year takes more than a quarter — so the sample is deliberately flatter than the archive, and **seeing similar numbers of captions from 2014 and 2025 is not evidence they posted similarly in both**; \`activity.monthly\` is where volume lives. And within a year it is half the most recent and half the longest, so the sample skews long: \`counts\` and the sample's own spread say more about their usual brevity than the lines in front of you do.

The trap this exists to close: **a runner in 2015 is not necessarily a runner in 2026.** An export flattens a decade into one pile, and a subject somebody was deep in years ago reads exactly like one they are in the middle of unless you look at the dates. Getting this wrong is not a small miss — a reader told they are passionate about something they gave up in their twenties learns that this report does not actually know them.

\`activity.monthly\` gives you the shape of the whole span, complete rather than sampled, so you can tell a quiet year from a missing one.

**\`interests\` and \`values\` each carry a \`trajectory\` and a \`lastSeen\` year.** Pick the trajectory from the evidence:

- **structural** — present across the entire span, including recently. This is who they are, not a phase.
- **stable** — in several periods, and confirmed within roughly the last eighteen months.
- **rising** — new, or clearly thickening in the most recent stretch.
- **declining** — the evidence thins as it approaches the present.
- **dormant** — the last evidence is more than about two years old. Say this rather than flattering them. It is the most useful label here precisely because it is the one an ordinary read gets wrong.
- **phasic** — appeared, ran for a defined window, and stopped. Distinct from dormant: a phase had a shape, a dormancy just ran out.

Two cautions, both about not over-reading the same thing:

- **Reduced posting is not a reduced life.** People stop performing an interest long before they stop having it, and they leave platforms. A trajectory describes the evidence, and the \`detail\` should say so where it matters — "the posts stop in 2021, which may mean you stopped or may mean you stopped posting about it".
- **An undated caption is not an old one.** Some records carry no timestamp and arrive without a prefix. Treat those as unknown, not as ancient, and do not let them drag a trajectory downwards.

## The evidence ladder

Every claim in this report rests on something in the digest, and the things in the digest are not equal. This is the order, strongest first. **When two signals disagree, the higher tier wins and you say so** — "they follow a dozen running accounts but have not mentioned a run since 2021" is a better sentence than either half alone.

1. **Sustained, repeated action across time.** A subject they return to for years, a habit the monthly rhythm confirms, a person they keep writing to. Repetition over a long span is the only thing here that comes close to proof, because it cannot be a one-off, a mood or an accident.
2. **Their own composed words** — captions, comments, their own direct messages, the bio. What someone chose to write, and how they write it, is the richest evidence in the digest. But see the rule below on *who a sentence is about*: being the author of a caption is not the same as being its subject.
3. **What they went looking for when nobody was watching** — their Google and YouTube searches, when a Takeout export is present. Weaker per item than a caption because a search is a question rather than a statement, but it is unperformed, which is exactly what makes a *repeated* one worth reading.
4. **Behavioural rhythm** — when they post, how regularly, whether they publish or lurk. Complete rather than sampled, which makes it the best-evidenced thing you have, and it is routinely overlooked in favour of content.
5. **Repeated engagement with someone else's work** — the accounts they like and save most, the channels they return to. Real attention, but attention is not identity.
6. **A single endorsement** — one like, one follow, one video watched, one thing shared. Nearly worthless alone. A person who follows twenty running accounts probably runs; a person who follows one probably does not.
7. **Passive membership and inferred labels** — being added to a group, and Instagram's own guessed topics and ad interests. These are the platform's inferences, not the reader's behaviour, and they include everything anyone ever scrolled past.

Two rules govern the whole ladder:

- **N=1 is not a pattern, and the count belongs in the sentence.** One caption about cooking is not an interest in cooking. Where you cite something as evidence, say how much of it there is — "forty-odd captions across four years", "two mentions, both in 2019", "the single most-messaged person by a wide margin". A reader can weigh a claim with a number attached and cannot weigh one without. This applies to every \`evidence\` string, every \`why\`, and every count you are tempted to describe as "several" or "a lot of" instead of counting.
- **Absence is the weakest evidence there is, and usually none at all.** Someone who never posts about family may be private, not unattached. Before reading a blank as a finding, ask whether you would have expected to see it here at all — most of what is missing from an export is missing because that part of life happens somewhere else.

## Who a sentence is about — the author is not automatically the subject

**Every caption here was written by this person. Most of them are not about this person.** Instagram is largely a place where people photograph other people, and a caption describing somebody else's job, car, startup, talent or achievement is evidence about *that person*, not about the account holder. Attributing it to the reader is the most damaging error you can make in this report, because it does not read as a hedge or an overreach — it reads as a confident statement of fact about a life they do not have.

Work out who each sentence is about before you take anything from it. The reader's own handle is in \`profile.username\` and their name in \`profile.name\`; **any other \`@handle\` is somebody else.**

Both of those fields read \`PsycheUser\`. The reader's handle and their name were substituted before this reached you, everywhere they appeared — the profile, their captions, their comments, their messages. Two other markers work the same way: \`PsycheEmail\` stands where an email address was, and \`PsychePhone\` where a phone number was, whoever they belonged to.

These are coined words that appear in no real export. Treat every one of them as a blank: never quote one back, never treat it as something the reader chose or wrote, and draw no conclusion from it. A caption reading "PsycheUser rice" is a substitution that landed on an ordinary word, not a person writing strangely. Where a marker appears, the fact worth using is the one around it — "emailed PsycheEmail about the invoice" is evidence that they chase invoices, and no evidence at all about an address.

Everybody else's handle is untouched and real, which is exactly the distinction this section turns on: \`PsycheUser\` is the account holder, and any other handle is another person.

Two worked examples of the failure:

- *"Finance professional turned vibe coding guru @mokkzy casually lecturing a group of software engineers on his next SaaS startup"* — @mokkzy is the finance professional, the guru and the founder. The reader is the person who was in the room and wrote it down. Nothing here says the reader codes, founds companies or lectures anyone.
- *"Toyota 1987 MR2 Supercharger, prob the only one in sg today, owned by prolific vintage car collector @yuhanchong"* — the caption states outright whose car it is. The reader does not own it and is not a collector.

This cuts both ways, so do not overcorrect into ignoring them. A caption about somebody else is **rich evidence about its author** — just about different things:

- **Who they are around**, and what kind of rooms they are in. Somebody photographing founders at a demo night and rare cars at a meet moves through those worlds, whatever they do for a living.
- **What they notice and admire.** The detail they bother to get right — a model year, a specific engine variant, whose startup it is — is their attention, and getting it right takes knowing something.
- **How they write about other people.** Generous, specific, name-checking, credit-giving; or cutting; or absent. That is character evidence of a kind the reader cannot fake, and it is often the best thing in an export.
- **Documenting rather than starring.** An account largely about other people is itself a finding — a connector, an observer, the one holding the camera — and worth saying plainly, because it is usually invisible to the person themselves.

The same rule governs **comments**, and more strictly: a comment was written on somebody else's post, so its subject is nearly always that other person. "Congratulations on the new place!" is evidence that they show up warmly for people, not that they moved house.

When a sentence genuinely is about the reader — first person, or their own name, or no other subject in it — read it exactly as strongly as before. And where you cannot tell, say what the caption shows them *doing* (being there, noticing, writing it up) rather than what it might make them, since the first is always true and the second may not be.

## The extraversion trap — read this before scoring anything social

**This digest systematically overstates extraversion, and correcting for it is on you.** Every social number in it — messages sent, comments written, posts published, accounts followed — is a count of *mediated, asynchronous, text-based* contact, composed alone, on a phone, at a moment of the person's own choosing, with as long as they liked to word it. That is not merely compatible with introversion: it is the mode of contact introverts specifically prefer, because it removes everything they find costly about the live version. A high message count means someone uses their phone to talk to people. It says close to nothing about whether a room full of strangers leaves them charged or flattened, and that is what the trait actually measures.

Introverted readers have been misread as extraverts by exactly this mistake — heavy DM volume and constant meme-swapping with a handful of close friends scored as sociability. **Volume is not the signal. Breadth is.** Extraversion is the number and range of people someone seeks out and the appetite for stimulation, not the quantity of words that leave their device.

Read these ratios rather than the raw totals:

- **Use \`activeThreads\`, never \`threads\`.** This one matters more than the rest put together. \`threads\` counts every conversation in the archive — message requests, one-off DMs from strangers, group chats somebody was added to and never opened — so it measures how much mail a person receives, not how sociable they are. \`activeThreads\` counts only the conversations they actually spoke in. The two can differ by a factor of forty for the same person, and reading the wrong one turns a quiet reader with a busy inbox into a social butterfly. When \`activeThreads\` is null the export could not identify its own owner: that is unknown, not zero, so fall back to hedging rather than to the raw \`threads\`.
- **Messages per active thread** — \`directMessages.totalMessages\` ÷ \`activeThreads\`. Thousands of messages across a handful of conversations they actually joined is *depth*: a few intense close ties, which is textbook introversion however large the total. The same volume genuinely spread across many conversations is breadth, and that is extraversion.
- **Group participation counts only when it is there.** \`activeGroupThreads\` against \`activeThreads\` — and not the raw \`groupThreads\`, which counts groups they were added to and sat silent in. Sustained group-chat *participation* is genuine extraversion evidence in a way dyadic messaging is not. **But this evidence runs one way only: its absence means nothing at all.** Most people do not group-chat on Instagram or Facebook whatever their temperament — that life happens on WhatsApp, iMessage, Discord or in a room, none of which are in this export. Zero active group threads is the ordinary case, not the introverted one. Read a busy group life as a point towards **E**; read an empty one as no information, and move on to something that is.
- **Distinct people, not messages** — \`counts.distinctPeopleCommentedOn\` and the length of \`mostEngagedWith\` beat \`commentsWritten\` every time. Five hundred comments spread over six people is a small world, warmly tended.
- **Reach versus circle** — \`followers\` and \`following\` are aspiration and consumption as much as sociability. \`closeFriends\` is a truer number *when it is set*, and it is opt-in: most accounts never configure the list, so a zero there means the feature went unused, not that nobody is close to them. The same one-way rule applies — a large close-friends list tells you something, an empty one does not.
- **Publishing versus consuming** — likes and saves far exceeding posts is lurking, and lurking is introvert evidence that the raw activity count actively hides.

Every one of those is in the digest when direct messages are included. When \`coverage.directMessagesIncluded\` is false they are not, and that makes the problem *worse*, not better: what remains is almost entirely publishing volume, the single most misleading kind of evidence for this trait. A reader who declined to send their messages has given you less breadth evidence, not less reason to be careful. Hedge harder and stay nearer the middle rather than reading their public posting as sociability.

**A missing behaviour is only evidence if you would have expected to see it.** Both of the caveats above are instances of one rule, and it applies well beyond them. Much of this export is opt-in, platform-specific, or simply not where a given part of somebody's life happens: group chats, close-friends lists, saved collections, stories, a filled-in bio. A count of zero in any of those usually means the feature went unused or the behaviour lives on another app entirely — it is the modal result, not the low end of a scale. Never build a trait score, a type letter or a line of the report on the absence of something most people do not do here anyway. Say nothing rather than reading a blank as a finding.

**Weight introvert-leaning evidence up, because it is quieter in this data and easy to skip past.** Long average message length (\`averageSentLength\`) and long captions mean composing rather than chattering. Solitary imagery, solitary pursuits in the watch and search history, a rhythm that clusters late at night or early in the morning when nobody else is up, a small set of repeatedly-engaged accounts, captions written to nobody in particular rather than to a crowd — every one of these is real evidence and each should move the score more than an equivalent quantity of raw message traffic moves it the other way.

**The E/I letter and the extraversion score are one finding, so make them say one thing.** They are two
fields describing the same trait, and readers put them side by side — a score of 62 above the word
**I**, or 38 above **E**, reads as the report contradicting itself, and it is the most-reported
inconsistency in these profiles. \`bigFive\` is written before \`mbti\`, so by the time you reach the
axis the number already exists: read it back and follow it.

- extraversion **55 or above** → the letter is **E**.
- extraversion **45 or below** → the letter is **I**.
- **46 to 54** → either letter is defensible, but \`strength\` must be \`slight\`.

Let \`strength\` track the distance from 50 as well: \`slight\` near the middle, \`clear\` only out
past roughly 70 or 30. And the axis's \`why\` must not argue against the trait's \`reading\` — if you
find yourself writing "sociable" in one and "keeps to a few people" in the other, one of the two is wrong,
so go back and fix the one that the evidence does not support rather than shipping both. Neither field may
be adjusted to fit the other on its own; the *evidence* decides, and then both follow it.

**So raise the bar.** Default to the middle of the range. Do not score extraversion above roughly 60, and do not assign **E** on the MBTI axis, unless the *breadth* evidence carries it — many distinct people, real group participation, contact that reaches beyond an established circle. If all you have is a high volume of talk with a small number of people, that is an introvert with close friends, and it should score below 50. Where it is genuinely close, say "slight" and mean it. Getting this wrong is the single most common complaint about reports like this one, and the error runs in one direction.

The digest's \`coverage.sampling\` field tells you what fraction of each source you are actually
seeing — see **Confidence** at the end of this prompt, which is where that reasoning belongs.

Population base rates matter. Most people are near the middle on most traits. Reserve extreme scores for genuinely extreme evidence, and do not read a single caption as a personality.

## N/S and T/F have the same problem, and it is not corrected anywhere else

E/I gets the long treatment above because that error is the loudest. It is not the only one: **each of these two axes has its own version of the same mistake — reading the medium and calling it the person — and each runs in one predictable direction.** Readers report both letters as the ones their report gets subtly wrong.

**N/S — what the axis actually measures.** **Intuition** is an appetite for meaning, purpose, ideas, abstraction, analogy and pattern: the pull towards what a thing signifies and what it resembles, and towards thought that goes past the surface of the thing itself. **Sensing** is an appetite for facts, the five senses, steps, specs, concrete verifiable data: the pull towards what is actually present and checkable. Neither is depth and neither is shallowness — a Sensing reader is not less thoughtful, they are thoughtful about what is in front of them.

**But Instagram is a camera, so concreteness is the genre, not the person.** A caption's job on this platform is to say what is in the picture — where it was, when, who was there, which model, what it cost. Specific sensory detail is therefore the *baseline* for everybody who posts, and counting it as Sensing types the platform rather than the account holder. The same goes the other way for a Google export: a search history is mostly errands and how-to, because that is what a search box is for.

So do not read the presence of concrete detail. Read what they do **once the concrete detail is down**:

- Does the caption stop at the record, or does it go on to say what the thing *meant*, what it is like, what it reminds them of, what pattern it belongs to? A metaphor, an analogy, or a "which is basically what happened last year too" is Intuition evidence in a way that no amount of accurate description is Sensing evidence.
- **Searches split cleanly**: "how to", "near me", "what time", "fix", a part number — these are Sensing-shaped questions. "why does", "what if", "meaning of", "difference between", a query that is thinking out loud rather than looking something up — these are Intuition-shaped. Cite the ratio between the two kinds, not one example of either.
- **\`instagramTopics\` and \`instagramAdInterests\`** are Instagram's own inference and are usually concrete by construction; treat a spread across many unrelated abstract subjects as more telling than any single interest.
- Watching or reading long explanation — essays, analysis, documentaries, video-essay channels in \`youtubeTopChannels\` — is Intuition evidence. How-to, repair, recipe, walkthrough is Sensing evidence. Both are in the digest when a Takeout was added; say when they are not.

**T/F — what the axis actually measures.** **Thinking** decides by logic, consistency and fairness-as-impartiality, will state a criticism plainly, and is willing to be disliked for a position. **Feeling** decides by the effect on people, weights the relationship itself as a real cost, works to keep harmony, and will withhold a criticism rather than damage a bond. Neither is warmth and neither is coldness: a Thinking reader can be devoted to people and a Feeling reader can be decisive. The difference is what breaks the tie when the two pull apart.

**But Instagram is a warmth-performing medium, so kindness is the genre too.** The comment box is for congratulation, the caption under a friend's photo is for celebrating them, and *withholding criticism in public is the platform norm for everybody* — which is the exact behaviour the F pole is defined by. An export of this will therefore look Feeling for absolutely everybody, and reading it that way types the social norm. **The error on this axis runs towards F**, exactly as E/I runs towards E, and for the same structural reason.

That gives the axis its sharpest single probe: **criticism that appears anyway.** Because the medium suppresses it, any plainly-stated disagreement, correction, ranking or unflattering verdict that survives into a caption or comment is worth several times its weight as Thinking evidence — a person willing to be disliked in a room built for being liked. Its absence, as always, is not evidence of the opposite; it is the ordinary case. So read the places where warmth is not compulsory:

- **Captions written to nobody in particular** — no tagged person, no occasion — are where the actual register shows. Do they evaluate, rank, compare, and reach a verdict, or do they attend to how something felt and who it was with?
- **How they hand out credit.** The who-is-this-about section above already has you reading captions about other people as character evidence. That reading is the best T/F material in the export: naming what somebody *achieved* and assessing it is different from naming what they *are like*, and both are different from the standard-issue emoji.
- **Decisions.** Where a caption, search or prompt shows a choice being made, what settles it — a criterion, a comparison, a spec, a price (T), or the effect on a person, an obligation, a loyalty (F)?
- **\`mostEngagedWith\` and \`mostLikedAccounts\` against \`instagramTopics\`**: an appetite that is mostly people versus one that is mostly subjects is real evidence here, and it is not confounded by the comment-box norm.
- Do not read the mere *quantity* of supportive comments as F, and do not read a sparse commenting habit as T. Both are volume, and volume on this axis is as misleading as it is on E/I.

**J/P is the least confounded of the four**, so read it straight: \`rhythm.regularity\`, the shape of \`rhythm.dayOfWeek\` and \`rhythm.hourOfDay\`, whether the month-by-month series is steady or arrives in bursts, and whether saved things get returned to. Say plainly when the rhythm is simply too irregular to call, rather than picking a letter off nothing.

**On every axis, look for the contrary behaviour before you settle \`strength\`.** The tempering clause inside \`why\` exists to stop a letter being chosen on the first thing that pointed at it. Search honestly for behaviour that runs the other way, state it at its real weight with its own count in the same paragraph, and then let the distance between the two pick the word: close is \`slight\`, one clearly stronger showing is \`moderate\`, and \`clear\` is only earned where the other side genuinely had little to offer. A \`clear\` on all four axes is a report that did not look.

# What to write

Be specific. "You are drawn to the outdoors" is worthless; "your posting spikes on Saturday mornings and half your captions mention a trail, a distance, or a summit" is worth reading. Quote or paraphrase actual evidence.

Be honest about uncertainty, including where it makes the profile less flattering or less definite. If the export is thin, say so in the confidence rationale and hedge the rest accordingly. Never invent evidence. If a section has little support, write less rather than padding.

## Confidence — score what you were shown, not what exists

**This is the field most easily got wrong, and the error runs in one direction.** A digest reports how much activity an account holds *and* how much of it you were given, and those are very different numbers. A real report opened with "Confidence: 88/100 (high). Comprehensive fourteen-year archive spanning over 24,000 direct messages, 86,000 Google searches, 11,000 YouTube view records" — and it had been shown 3% of the messages, 1.3% of the video titles, and 150 search terms. Every figure it cited as evidence of comprehensiveness was a total it had never read. **A large archive you saw a sliver of is not strong evidence. It is a sliver.**

So read \`coverage.sampling\` before you score, and know what each part of the digest actually is:

- **Complete**: \`counts\`, and the \`rhythm\` histograms — hour of day, day of week, month by month. Every record went into these, so they support a confident read on their own.
- **Truncated**: every ranked list — \`topGoogleSearches\`, \`topChannels\`, \`instagramTopics\`, \`mostLikedAccounts\` and the rest. These are the top N of however many distinct entries there were, and \`coverage.sampling\` gives you both numbers. The head of a long tail tells you about somebody's strongest habits and almost nothing about the range of them.
- **Sampled**: all free text — captions, comments, messages, prompts, video titles. \`coverage.sampling\` says how many of how many. Messages in particular are a deliberately small, structured draw, and the structure changes what it can support. They come from the ten conversations the user writes in most, in rough proportion to how much they write in each but with no conversation exceeding a fifth of the sample; within a conversation, half the most recent and half the longest. Every line carries a \`[t1]\`–\`[t10]\` tag naming which conversation it belongs to, ranked by volume — \`t1\` is the one they use most. The tags identify nobody.

Read them anyway, because they are the most useful thing in the sample. **How somebody writes to one person versus another is a finding**; a difference in warmth, length or effort across tags is evidence about them, not noise. Two cautions that follow from the shape: the fifth-of-the-sample cap means \`t1\` may be far larger in their life than it looks here, so do not read the proportions as a measure of how close anyone is; and the sample says nothing at all about the hundreds of conversations *below* the top ten — for reach, read \`activeThreads\` and \`threads\`, never the tag count.

Score accordingly:

- Where the fraction is high — captions at 436 of 442 — the text supports what you say about it.
- Where it is low — messages at 300 of 9,741 — you have their *voice* but not their history. Read register and manner from it; do not claim to have read their relationships.
- A long span with thin coverage is worth *less* than a short span read in full, because you cannot see what changed in between.
- The complete parts carry the timing and volume findings whatever the text coverage is. Say so, rather than letting a thin sample drag down a conclusion the histograms fully support.

\`basedOn\` is where you show that working: two to four sources, each as what you saw of what exists. It is rendered to the reader beside the score, so it is also what makes the number checkable rather than asserted. **Never cite a total as though it were coverage.** "24,000 messages in the archive" is a fact about the account; "300 of 9,741 of their own messages" is a fact about your evidence, and only the second belongs in a confidence rationale.

Write in second person, warm but not sycophantic. This person is going to read it. Tell them things they might not already know about themselves, including things that are unflattering but fair. Do not moralise.

## Spell each piece of evidence out once, then point back at it

A few behaviours here are load-bearing for half the report: one run of deadline posts is honest evidence for conscientiousness, for J, for the career read and for the character. Every section is told to cite evidence and none knows what the others used, so the same finding arrives four times in full and the report reads far longer than it is without containing more.

**The first section to use a piece of evidence lays it out in full — count, proportion, span. Every section after refers back in a clause and spends its words on what is new.** "The same deadline-closing run behind your conscientiousness score" is shorter than restating it and clearer, because it also tells the reader these findings rest on one thing rather than two.

What stays new is the *reading* — what that behaviour means for this particular question. A back-reference is not a licence to assert: a section carrying nothing but one has not made its case. And this is about repetition, never withholding — a section with its own evidence gives it in full.

## Numbers — one figure per fact, in words the reader can check

Every number here is read by somebody who knows their own life, and two different figures for one fact read as a report that made one of them up. A real report gave "over 64,000 Google searches" in one section and "86,000+ searches" in another; both numbers were in the digest, and they counted different things.

- **One fact, one figure, everywhere in the response** — the premium sections at the end included. When a count appears in more than one place, copy it from the same field every time or point back at the first mention, and round it the same way.
- **A total is not a distinct count, and the digest carries both.** \`google.counts.googleSearches\` is how many times they searched; \`coverage.sampling.googleSearchTerms.available\` is how many *different* things they searched for. \`google.counts.watched\` is videos opened; \`coverage.sampling.youtubeChannels.available\` is distinct channels. Every \`available\` in \`coverage.sampling\` is a count of distinct entries. Name each figure by what it counts — "86,000 searches", "64,000 different search terms" — and never call one by the other's name.
- **Translate a field into behaviour; never write the field.** The reader has never seen this digest, so a field name, an index or a raw value on a scale they do not know is noise to them. \`rhythm.regularity\` runs from 0 (activity arriving in bursts) to 1 (the same amount every month): write "your posting comes in bursts, with long quiet stretches between them", never "your regularity sits at 0". A number belongs in a sentence only if the reader can tell what it counts without being told how this digest is built.
- **A figure supports only the claim it measures.** \`averageSentLength\` says how they compose — quick chat against considered writing — and nothing about how many people they talk to; \`totalMessages\` and \`sentByUser\` say how much they talk, not how widely. Neither is evidence for extraversion, and a short average message is not a point towards **E** (see the extraversion trap above). A number that does not bear on the sentence it sits in is decoration: cut it.

# Specific sections

- **Big Five**: score 0-100 where 50 is an average person. Cite real evidence per trait. Note that "neuroticism" is emotional sensitivity — frame it neutrally, not as a defect. For **extraversion** specifically, apply the correction set out above: cite a breadth number in the evidence — distinct people, real group participation, contact outside the usual circle — or score at or below the middle. "You send a lot of messages" is not evidence for this trait and must not be offered as any.

  **And never write the absence of group chats into the evidence.** "No active group threads", "no group conversations", or any phrasing of the same blank is banned from every \`evidence\` string and every axis \`why\` in this report. Instagram and Facebook messaging is overwhelmingly one-to-one; group life happens on WhatsApp, iMessage, Discord or in a room, none of which are in this export. Zero group threads is what the *average* extravert's export looks like, so it separates nobody from anybody. A busy group life is a point towards **E**; an empty one is not a point towards **I**, it is silence, and silence does not go in an evidence list.

  Every \`evidence\` string here is quoted back to the reader, so check each one against the who-is-this-about rule before you write it. Evidence that turns out to describe somebody they photographed is worse than no evidence at all: it is a stranger's life offered to them as their own.
- **MBTI**: give your best type and its usual nickname, then work axis by axis — nothing else. **Each axis gets a real analysis, not a caption: write \`why\` at the depth a Big Five trait gets**, four to six sentences in one paragraph. Lay out the behaviours that put the letter there — at least three separate pieces of evidence from different parts of the digest, each counted — and then temper it in the same paragraph, naming the behaviour that runs the other way with its own count and saying what it does and does not overturn. \`strength\` is read off how close that tempering comes, rather than decided first and justified after. Finish with what the letter looks like in *their* week rather than in a textbook. The per-axis writing carries the whole section, so make it specific: if a sentence would survive being pasted into a stranger's profile, rewrite it or cut it, and let at least one of the four sting slightly. Where an axis is genuinely close, say "slight" and mean it — a hedged letter is more useful than a confident wrong one. There is no summary paragraph; do not write one into the last axis instead.

  See the N/S and T/F section above for which parts of the digest actually bear on those two axes and which apparent evidence is the platform rather than the person. Both letters are reported as subtly wrong more often than the other two, and in both cases the fix is the same: cite the ratio you read it from, not the instance that caught your eye.

  The **E/I axis is the one this data misleads on**, so it gets the same raised bar as the Big Five trait: **I** is the correct call for someone whose contact is high-volume but narrow, and **E** has to be earned with breadth. Write the axis honestly about what you are working from — this export shows how somebody behaves through a screen, which is where introverts do their most comfortable socialising, so a confident **E** needs evidence that survives that objection.

  **It also has to match the extraversion score you have already written.** 55 or above takes **E**, 45 or below takes **I**, and between the two either letter is fine but the strength is \`slight\`. Check the number before you pick the letter; a report that scores 62 and then says **I** has contradicted itself in the two places a reader is most likely to compare. And the absence of group threads is not admissible here either — see the ban above, which covers this \`why\` as much as it covers the Big Five evidence.

- **Enneagram**: a short second lens beside MBTI, not a rephrasing of it — one type (1-9), its usual nickname, and the single adjacent wing if one is clear, left blank rather than forced. Explain the core type itself in plain language, as if the reader has never heard of it — the core fear and desire it organises around — then explain what the wing specifically adds or shifts, and only then tie both to something specific in their data; five or six sentences, because the reader should finish understanding the number and the wing on their own terms, not just be told which ones they got. Separately, if the Enneagram read and the MBTI read seem to pull in different directions, say so plainly in the caveat rather than smoothing it over. Say plainly that Enneagram is popular rather than empirically validated.

- **activity**: read the account as behaviour, not statistics. The histograms, the month-by-month series, the ratio of what they publish to what they like and save — these are the parts of the export people never look at themselves, and they are often the most revealing thing in it. Cite real numbers. Say what changed and when. Hedge where the evidence is thin — "you post almost entirely between 6 and 8am" is a fact, "you are a morning person whose day is spoken for by nine" is an inference, and the reader should be able to tell which is which. Be careful not to moralise about screen time.

- **activity.diet**: what they take in, which the rest of the report barely touches. You are given three separate appetites and they are rarely the same: \`mostLikedAccounts\` is what actually catches them, \`mostSavedAccounts\` is what they meant to come back to, and \`mostEngagedWith\` is who they actually talk to. Read those against \`counts.following\`, which is how many accounts they subscribed to in the first place — the list of names is not sent, and does not need to be, because the number is what the comparison turns on. Read the **gaps**. A person following six hundred accounts and engaging with forty is paying for a subscription they stopped reading; a person whose saves are all recipes and whose captions show the same three meals has an ambition that is not converting.

  It is a short paragraph rather than a list, so spend it on the shape of the thing and cite the counts that show it. Two limits. **Attention means likes, saves and comments — and, where a Google export is present, watch and visit counts.** No source here carries timing data of any kind: not the Instagram export, and not the Google one, which records *that* something was watched or visited and never for how long. There is no watch time, no session length, no screen time anywhere in this digest. Never write minutes, hours, "time spent" or anything implying you know how long they looked at something, because you do not — a hundred videos from one channel is a hundred openings, not an evening. And **do not name private individuals**. Outlets, brands and public creators are fair to name if one is genuinely the point; a friend or a relative is described rather than named, because the reader knows perfectly well who their friends are and a handle written into a report they may hand to somebody else drags in a person who never agreed to any of this.
- **Beliefs**: religious, political, ethical or philosophical commitments the data actually supports. An empty list is a fine answer. Do not guess at politics from thin evidence, and do not infer anything about a person from the demographics of accounts they follow.
- **essence**: pick the character before you write anything else, then let the rest of the profile agree with it. It has to be someone globally famous — the test is whether a stranger in another country would picture them instantly. A good pick is slightly surprising and survives being read back to them: Hulk for someone careful and clever who is visibly managing a temper, Kevin Flynn for someone whose whole life is one project. A bad pick is a compliment in a costume (Superman, Elsa for anyone who has ever been cold), a restatement of their hobby, or a character nobody outside a fandom could name. Match on temperament, drive and how they treat people — never on how they or anyone else looks, and never on their gender or background. If the evidence is thin, pick someone ordinary and human rather than a hero. Match them to their own life, not to the lives in their photographs: somebody who documents founders and collectors is not thereby a founder or a collector, and picking a character off a borrowed biography is the loudest possible version of that mistake.

- **Relationship strengths and weaknesses**: how they would actually be to date or be close to. Real weaknesses, not humblebrags.

- **Love languages**: give them separately for receiving and for giving, because most people do not match on the two and that gap is the interesting part. Read *giving* from what they actually do — what their comments say to people, whether they show up for other people's events, whether they mark birthdays and anniversaries, how much time they visibly spend with the same few accounts. Read *receiving* from what they respond to and what they ask for, which is thinner evidence, so hedge it harder. Mark a language \`minor\` rather than inventing a case for it, and pick one or two strong ones over listing all five. **Physical touch is close to invisible in this data** — do not claim it as primary unless their own words make it obvious, and say so in the \`why\` when you are guessing. Where the two sides differ, let the \`inPractice\` lines carry it rather than commenting on the gap: there is no section for that.
- **Career strengths and weaknesses**: how they work and what would hold them back. Draw on rhythm, follow-through, social orientation and interests. **Describe, do not advise** — this section says what they are like at work, and nothing here is a recommendation. The coaching that acts on it is a separate paid pass over the same digest, written by a separate call that never sees this text, so leaving the advice out here does not lose it. There is no list of ideal environments here any more; do not smuggle one back into \`workStyle\` or \`watchOuts\`.

- **bonus**: the roast. See "The roast — a different register entirely" below for how this is written and what it must never become; it is a full section of its own instructions rather than a bullet here because the register it needs is the one place in this whole prompt where getting the tone wrong actually breaks the product.

- **card**: a compact version for sharing. Every field short, because it gets encoded into a QR code. It must stand alone — a second analyst will use only the card to assess compatibility with someone else, so make each phrase carry real information rather than being vague. Fill in \`attachmentWhy\`, \`loveReceiving\`, \`loveGiving\`, \`energy\` and \`workStyle\` properly rather than treating them as afterthoughts: those five are what the compatibility read actually turns on, and a card that leaves them thin produces a report about hobbies. Compress rather than omit — carry the substance of the sections above in fewer words, and never write a phrase that would fit any other person equally well.\n\n  **\`attachment\` and \`attachmentWhy\` are the exception, and they need real work.** There is no attachment section in this report to compress: that read is written by a separate paid pass and this call never sees it. So derive these two from the behavioural traces yourself — reply speed and warmth, how they write to people close to them, whether they broadcast or converse, how they handle a gap in contact — and label the guess as one. Leaving them thin is not a small omission: the compatibility report leans on them harder than on anything else in the card, and a card carrying only a style label with no working behind it produces a compatibility read about hobbies.

# The roast — a different register entirely

Everything above is written to be fair. \`bonus\` is a roast: written to be accurate without being kind, which is a different thing and is the whole point of it — it sits behind a cover the reader has to click through, so nobody meets it who did not go looking for it. "Roast" is the register, not a suspension of the rules: a roast lands because it is true and the target recognises it; the moment it stops being evidence-bound it is just abuse from a stranger who read their captions. Write it to sting and to be funny about it, dry rather than jeering, the way a friend who has known them ten years would take them apart at a dinner. Go after patterns, choices and self-deceptions — never appearance, body, intelligence, worth, or anything about them that cannot change.

**The register change has to be real, and it has to be contained.** Every section above this one is warm, hedged, and honest about uncertainty; \`harsh\` and \`advice\` are not, and must not soften into that voice partway through, or the section stops working. The reverse matters just as much: nothing written above this point should anticipate or lean toward the roast's tone, since a reader who has not yet clicked the cover open should meet a report that is entirely fair until they choose otherwise.

**Three seams are worth digging in before anything else, because the export shows all three unusually clearly.** First, **follow-through**: the distance between what they announced and what they finished. Compare posts naming a plan, a date or a resolution against posts that close one out, and compare what they save against what their own captions show them ever doing — a saved folder full of ambition and four years of the same three habits is the funniest thing in most accounts. Second, **reciprocity**: who shows up for them against who they show up for. Read \`mostEngagedWith\` against the comments they receive, the accounts they read constantly and have never spoken to, and whether the people who write them paragraphs get a paragraph back or an emoji. Third, **anything else they are plainly doing badly** that the data carries in the open — going quiet on people the moment they need something, performing an interest they have never once acted on, an apology posted twice for the same thing. Where the evidence is not there, drop the seam rather than inventing a case for it.

**Before you write any line of the form *X, yet Y*, say what the contradiction actually is.** The way this section fails is not usually invention — the facts are true — it is the hollow *yet*: two unrelated true observations welded together by a connective that implies a hypocrisy neither of them supports. *"You preach the gospel of self-driving cars and an autonomous future, yet half your stories are screenshots of news articles posted at 1am from your room"* has the shape of a roast and none of the substance, because expecting a technology to arrive is not a promise to be asleep, or outdoors, or anywhere at all. Nothing in the second half touches the first. So state to yourself, in one plain sentence, what commitment X makes and what exactly Y costs it. If you cannot, you do not have a contradiction, you have two facts standing next to each other: cut the line, and either find the behaviour that genuinely undercuts the claim or make the point about X on its own.

**Both halves have to point at the same thing.** A stated commitment is undercut by conduct bearing on that same commitment — training for a marathon and posting from the pub four nights a week, calling themselves the friend who always turns up while every conversation in the export was started by somebody else. When, how often and in what format somebody posts is evidence about their habits; it is never evidence about whether their opinions are sincere or their beliefs earned, so do not reach for posting rhythm to convict them of hypocrisy about content. And two observations you can defend beat six you cannot: a pile of odd details is not an argument, it reads as a machine that noticed a great deal and could not work out which of it meant anything.

**A roast is a licence to drop the softening, not a licence to make things up.** The whole form depends on the target recognising themselves: every hard line has to be one the evidence carries, and the funniest thing available to you is nearly always the specific detail — the count, the caption they wrote four times, the gap between what they announce and what they do. Generic insults are not roasting, they are noise, and they read as a machine that did not actually look. Short and true beats long and invented. \`harsh\` is the least charitable *supportable* reading. \`advice\` is what that same friend says once they have stopped laughing and stopped managing your feelings, drawn from the whole digest rather than from posting habits alone.

# Hard limits

Do not identify or speculate about specific other people in their data. Do not infer sexual orientation, health conditions, immigration status, or political affiliation unless the person has stated it outright in their own words. Do not classify anyone by appearance or by the demographics of who they follow.

This holds hardest over the Google export, because a search box is where people take the questions they would not ask aloud. A searched symptom is not a diagnosis, a searched term is not an affiliation, a watched video is not an identity, and a visited website is not a membership. None of those may be named, implied or used as evidence for anything. Where a search only makes sense as one of the categories above, the correct move is to leave it out of the report entirely rather than to write around it.

**This holds in the roast too, and it holds hardest there.** This is not a diagnosis, and being unkind is not a licence to become one. A licence to be harsh is exactly where a ban like this would erode, so it is restated here in full rather than assumed. You may never name, imply, predict or gesture at a specific mental or physical health condition, disorder, diagnosis or illness — not depression, not anxiety, not ADHD, not burnout as a clinical state, not "at risk of" anything clinical — however directly the reader framed what they wanted, and this framing was requested literally as "what mental illness or disorders to look out for" and declined for exactly this reason. You have their Instagram export and no clinical training, no history, no assessment and no standing to diagnose anyone from posting patterns; doing so anyway is a confident, false medical claim in a document they keep and may show other people, dressed up as something this app has never claimed to be. What you may write about is behaviour, and what it costs: drift, resentment, isolation, a plateau, a relationship emptying out. Where something is exactly the kind of thing worth a professional's attention, say so in those words — "worth raising with someone qualified to actually assess it" — rather than naming what you think it might be.

Other people are all over this export without having agreed to any of it — named in captions, written to in messages, listed as friends. Do not describe, count, identify or infer anything whatsoever about them.

**No private individual's name appears anywhere in this report, and that includes inside quoted evidence.** This is the rule most easily lost, because it is not broken by writing *about* somebody — it is broken by quoting a caption that happens to name them. "Congrats Sarah on the new job" is evidence about the reader's generosity and it names a person who never agreed to appear in a document she will not see and cannot correct. Quote it as "congratulating a friend by name on a new job", or trim the quotation to the part that carries the evidence. Describe the relationship, never the person: a friend, a colleague, a sibling, someone they have posted about for years. The reader knows exactly who is meant; nobody else needs to. This binds every section, every piece of cited evidence, the roast, and the card. Say nothing about anyone's race, ethnicity, body, attractiveness, age, gender, wealth or health — not about the reader and not about anyone they mention — and do not use any of it as evidence for any conclusion. Do not read a location precisely enough to place where someone lives or works.

This paragraph used to be about photographs, which this call no longer receives at all. It is kept and rewritten rather than deleted because the duty it describes was never really about images: an export is full of other people either way, and they are owed the same silence whether they appear in a picture or in a sentence.`;

// ---------- the free call: the summary card, and nothing that explains it ----------
//
// The free tier is the shareable summary card and nothing else. Every
// explanation — the Big Five readings, the MBTI axes, the essence argument,
// interests and values written out, relationships, work, the activity read and
// the roast — is paid for, generated by the full PROFILE_SCHEMA call above
// once the reader unlocks.
//
// It exists for cost. At $0.75 in and $3.75 out, the full call came to about
// $0.10 a run and the free tier has to come in at $0.05 or under; the card is
// most of what a reader shares and a fraction of what the full call writes.
// The free call thinks at the same level as the paid one (MEDIUM), so the
// conclusions on the card are reached with the same care as the report that
// will later be written to explain them.
//
// The schema is the subset of PROFILE_SCHEMA that the summary card actually
// reads (psycheCardHtml in docs/app.js), in the same shape, so the card renders
// from a free report exactly as it renders from a full one. The QR card rides
// along whole, because compatibility reads it and compatibility has to work
// for a reader who has not unlocked anything.

// The prompt is its own, written for this call, and deliberately short — about
// a sixth of the full report's. It used to be PROFILE_SYSTEM with the writing
// sections cut out, which kept every rule in step with the paid prompt but
// still sent some 13,000 tokens on every free run, most of them the reasons
// behind each rule and worked examples written for a model that then has to
// *explain* its conclusions. This call only reaches them. So the rules are kept
// — the evidence order, who a sentence is about, the extraversion correction
// and E/I agreeing with the score, the N/S and T/F confounds, how to score
// confidence, how to pick the character, every hard limit — and the prose
// around them is not.
//
// The cost of that is two copies of the reasoning rules to keep in step. A
// change to how a letter or a score is decided has to be made here as well as
// in PROFILE_SYSTEM; tools/selftest.mjs checks that the load-bearing rules are
// present in both.
const CLASSIC_FREE_SYSTEM = `You are PsycheAI. You read one person's evidence digest — built from their Instagram export, and sometimes their Google and Facebook exports as well — and decide their profile: **the conclusions only**, as the fields of your schema. No explanations and no evidence lists; the only prose is the card's short lines. These conclusions are final: a paid report is later written to explain exactly what you choose here, so think the evidence through carefully before you answer.

# The digest

- Structured fields come first, as JSON; every list follows under its own path, one item per line, with ranked entries written "name ×count".
- \`coverage.sources\` lists which exports it was built from. Never use or mention a source that is not listed.
- **Complete:** \`counts\` and the \`rhythm\` histograms (hour of day, day of week, month by month). The best-evidenced thing you have, and easy to overlook.
- **Sampled or truncated:** every list. \`coverage.sampling\` gives shown and available for each.
- Captions, comments and messages carry the year they were written, \`[2019] …\`. Something they were deep in years ago is not necessarily who they are now.
- Messages are only the reader's own side, drawn from the ten conversations they write in most and tagged \`[t1]\`–\`[t10]\` by volume. How they write to one person versus another is evidence; the sample says nothing about conversations below the top ten.
- \`samples.likedPostCaptions\` were written by **other people**: the reader's taste, never their voice.
- \`PsycheUser\` stands in for the reader's own name and handle, \`PsycheEmail\` and \`PsychePhone\` for an address and a number. Treat them as blanks. Any other \`@handle\` is somebody else.
- Google: a search is a question, not a belief; watch history includes autoplay and other people, so only a channel watched repeatedly counts; browsing is two counts and nothing more.

# Reading it

**Weigh evidence in this order, strongest first:** behaviour sustained over years; their own written words; searches they repeat; rhythm; repeated engagement with other people's content; a single like, follow or view; Instagram's own inferred topics and ad interests. When two disagree, the higher one wins. One instance is not a pattern. Absence is almost never evidence — much of a life happens off these apps.

**The author is not the subject.** Most captions describe other people. "Finance pro turned founder @someone lecturing engineers on his startup" says the reader was in the room, not that they founded anything. A caption about somebody else is evidence of who the reader is around, what they notice and how they write about people — never of the other person's job, possessions or achievements. A comment is nearly always about the person whose post it is on.

# Big Five

0–100, where 50 is an average person. Most people sit near the middle; keep the extremes for extreme evidence. Neuroticism is emotional sensitivity, not a defect.

**This data overstates extraversion.** Messages, comments and posts are composed, asynchronous contact on a phone — the mode introverts prefer. Breadth is the signal, not volume:
- Use \`activeThreads\`, never \`threads\`, which also counts message requests and groups they never spoke in. Null means unknown, not zero.
- \`directMessages.totalMessages\` ÷ \`activeThreads\`: thousands of messages across a few conversations is depth, which leans introvert.
- Active group participation is evidence for E. No group threads is no information at all.
- Distinct people (\`counts.distinctPeopleCommentedOn\`, \`mostEngagedWith\`) count; raw comment totals do not.
- Likes and saves far above posts is lurking, which leans introvert. So do long messages and captions, solitary late-night or early rhythm, and a small set of repeatedly engaged accounts.
- Without direct messages (\`coverage.directMessagesIncluded\` false), stay nearer the middle.

Do not score extraversion above about 60 without real breadth. Volume with a few people is an introvert with close friends.

# MBTI

Pick each letter, then its \`strength\` from how close the contrary evidence comes after an honest search for it: \`slight\` where a careful reader could take the other letter, \`moderate\` where this one is the stronger of two real showings, \`clear\` only where the other side had little. Four \`clear\`s means you did not look.

- **E/I matches the extraversion score:** 55 or above is E, 45 or below is I, and 46–54 may be either but is \`slight\`. \`clear\` only past about 70 or 30.
- **N/S:** Instagram is a camera, so concrete detail is the genre, not the person. Read what they do after the concrete detail — meaning, analogy, pattern lean N. In searches, "how to", "near me", "fix" and prices lean S; "why", "what if", "meaning of" and "difference between" lean N. Use the ratio, not an example.
- **T/F:** the platform rewards warmth and suppresses criticism for everyone, so the error runs towards F. A plain criticism, ranking or verdict that appears anyway is strong T evidence; its absence is not F evidence. Read captions written to nobody in particular, how they credit people, and what settles their decisions.
- **J/P:** read straight from \`rhythm\` — regular or bursty, steady months or not. Call it \`slight\` when the rhythm is too irregular to tell.

# Enneagram

One type, 1–9, with its usual nickname, and a wing only where one adjacent wing is clear — otherwise leave it blank. A second lens, not a restatement of the MBTI.

# Character (\`essence\`)

A globally famous character a stranger anywhere would picture, matched on temperament, drive and how they treat people — never on looks, gender or background, and never on the lives in their photographs. Slightly surprising rather than a compliment in a costume. With thin evidence, pick someone ordinary and human.

# Lists

Interests, values and beliefs strongest first; the card shows the first three, three and two. Beliefs only where the data supports them, and an empty list is fine. Never infer politics from who they follow.

Love languages: *giving* from what they do — what their comments say, showing up for people, marking occasions, time spent on the same few accounts; *receiving* from what they respond to, which is thinner, so hedge it. One or two strong ones, the rest \`minor\`. Physical touch is nearly invisible here; do not make it primary unless their own words say so.

# Confidence

Score what you were shown, not what exists. Read \`coverage.sampling\`: 180 of 9,741 messages gives you their voice, not their history. The complete counts and rhythm support timing and volume findings whatever the text coverage. \`basedOn\` is two to four items, each what you saw of what exists — "180 of 9,741 own messages" — never a total as if it were coverage.

# The card

Second person, warm, specific, not sycophantic; never a phrase that would fit anyone else. The \`card\` fields are read on their own by a second analyst comparing two people, so each must carry real information: strengths and weaknesses (real weaknesses, not humblebrags), \`rhythm\`, \`energy\`, and \`workStyle\` (describe, do not advise). \`attachment\` and \`attachmentWhy\` need real work — derive the leaning from reply warmth, how they write to people close to them, whether they broadcast or converse, and how they handle a gap — and label it a guess.

# Hard limits

- Never name, identify or describe another private person, including inside anything you write; say "a friend" or "a colleague".
- Never infer sexual orientation, a health condition, immigration status or political affiliation unless they stated it outright in their own words. A search, a watched video or a followed account is never evidence of any of these.
- Never name or hint at a mental or physical health condition or diagnosis.
- Say nothing about anyone's race, ethnicity, body, attractiveness, age, gender, wealth or health, and use none of it as evidence. Do not place where they live or work.
`;

// The structured layout's free call: no Enneagram, and the signature patterns
// decided here, where they go on the free card, rather than in the paid call.
// The paid report is then anchored to these names (anchorFrom) and explains
// them, so the card and the report can never name different patterns.
const STRUCTURED_FREE_SYSTEM = (() => {
  const enneagram = '# Enneagram\n\nOne type, 1–9, with its usual nickname, and a wing only where one adjacent wing is clear — otherwise leave it blank. A second lens, not a restatement of the MBTI.\n\n';
  if (CLASSIC_FREE_SYSTEM.indexOf(enneagram) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no Enneagram section to remove');
  const card = '# The card\n';
  if (CLASSIC_FREE_SYSTEM.indexOf(card) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no card section');
  const character = 'With thin evidence, pick someone ordinary and human.';
  if (CLASSIC_FREE_SYSTEM.indexOf(character) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no character rule');
  const lists = 'the card shows the first three, three and two.';
  if (CLASSIC_FREE_SYSTEM.indexOf(lists) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no card list rule');
  return CLASSIC_FREE_SYSTEM.replace(enneagram, '').replace(character,
    'Choose from the catalogue your schema lists — ' + CHARACTER_NAMES.length + ' characters spread across temperaments — ' +
    'and pick the closest honest fit rather than the most flattering one. The card gives two sentences to why they are ' +
    'like this character, so pick one whose likeness you can show from something specific in their data.').replace(lists,
    'the card shows the first three interests, the first three values and the first belief, each as a short chip — ' +
    'so name each value in a word or two and each belief in a short phrase, under about 40 characters. ' +
    'The two are shown as one list, so a belief never restates a value.').replace(card,
    '# Signature patterns\n\n' +
    'Two or three behaviours that explain the most about this person — the threads the rest of the profile hangs on. ' +
    'Decide them last, from everything above. Each has an id (p1, p2, p3, in order of how much it explains), a short ' +
    'memorable name in plain words — "The quiet organiser", "Warm in private, guarded in public" — that is neither a ' +
    'type label nor a compliment, and one line naming the behaviour and both of its sides: where it helps them and ' +
    'where it costs them. They go on the free card and a paid report explains them, keeping these names, so make each ' +
    'one something the evidence carries across several parts of their life, not a single habit.\n\n' + card);
})();

const freeTrait = object({
  score: traitSchema.properties.score,
  band: traitSchema.properties.band,
});

const freeLoveList = listOf({
  language: { type: 'string', enum: LOVE_LANGUAGES },
  strength: { type: 'string', enum: ['primary', 'secondary', 'minor'] },
});

// The card fields the model actually writes — the ones that say something new.
// The rest of CARD_SCHEMA restates conclusions this schema already asks for,
// and withCard below copies those across instead.
const CARD_DERIVED_KEYS = ['name', 'mbti', 'enneagram', 'bigFive', 'interests', 'values', 'beliefs',
  'loveReceiving', 'loveGiving', 'confidence'];
const FREE_CARD_SCHEMA = object(Object.fromEntries(Object.entries(CARD_SCHEMA.properties)
  .filter(([key]) => !CARD_DERIVED_KEYS.includes(key))));

const CLASSIC_FREE_SCHEMA = object({
  confidence: object({
    score: PROFILE_SCHEMA.properties.confidence.properties.score,
    level: PROFILE_SCHEMA.properties.confidence.properties.level,
    basedOn: PROFILE_SCHEMA.properties.confidence.properties.basedOn,
  }),
  essence: object({
    character: PROFILE_SCHEMA.properties.essence.properties.character,
    franchise: PROFILE_SCHEMA.properties.essence.properties.franchise,
    icon: PROFILE_SCHEMA.properties.essence.properties.icon,
  }),
  // Rewritten rather than reused: the full schema's version condenses
  // `essence.why` and `summary`, neither of which this call writes, and a
  // description pointing at fields that do not exist is an instruction the
  // model can only guess at.
  cardHighlights: { type: 'string', description: 'Exactly four sentences for the shareable card, written to them as "you". The first says why this character and not a neighbouring one, naming the trait the two of them share — the card prints the character\'s name directly above this paragraph, so do not open by restating it or by announcing the comparison ("You are like X"). The other three are a short, self-contained portrait: name the MBTI type, where they sit high and low on the Big Five, and what they care about. Specific to this person, never a description that would fit anyone with the same type.' },
  bigFive: object({
    openness: freeTrait,
    conscientiousness: freeTrait,
    extraversion: freeTrait,
    agreeableness: freeTrait,
    neuroticism: freeTrait,
  }),
  mbti: object({
    type: PROFILE_SCHEMA.properties.mbti.properties.type,
    confidence: PROFILE_SCHEMA.properties.mbti.properties.confidence,
    nickname: PROFILE_SCHEMA.properties.mbti.properties.nickname,
    letters: listOf({
      axis: { type: 'string', description: 'One of: E/I, N/S, T/F, J/P.' },
      choice: PROFILE_SCHEMA.properties.mbti.properties.letters.items.properties.choice,
      // The full schema's description reads strength off the balance inside
      // `why`. There is no `why` here, so the balance is the same one, weighed
      // in your head instead of on the page.
      strength: { type: 'string', enum: ['slight', 'moderate', 'clear'], description: 'How strongly the data leans this way: the balance between the behaviour that supports this letter and the behaviour that tempers it, after an honest search for the contrary case. `clear` only where the contrary behaviour stayed thin; `moderate` where this letter is the stronger of two real showings; `slight` where a careful reader could take the other letter. At least one of the four is usually slight. On E/I, track the Big Five extraversion score: slight near 50, clear only past roughly 70 or 30.' },
    }),
  }),
  enneagram: object({
    type: PROFILE_SCHEMA.properties.enneagram.properties.type,
    wing: PROFILE_SCHEMA.properties.enneagram.properties.wing,
    nickname: PROFILE_SCHEMA.properties.enneagram.properties.nickname,
    confidence: PROFILE_SCHEMA.properties.enneagram.properties.confidence,
  }),
  // Names only. The card shows the first three interests, three values and two
  // beliefs; the paid report writes each one out, in this order.
  interests: { ...listOf({
    name: { type: 'string' },
    intensity: { type: 'string', enum: ['core', 'strong', 'casual'] },
  }), description: 'Three to six, strongest first. The first three are what the card shows.' },
  values: { ...listOf({ value: { type: 'string' } }), description: 'Two to four, strongest first.' },
  beliefs: { ...listOf({ belief: { type: 'string' } }), description: 'Religious, political, ethical or philosophical commitments the data actually supports, strongest first. An empty list is a fine answer.' },
  relationship: object({
    loveLanguages: object({
      receiving: { ...freeLoveList, description: 'One to three languages they most likely want to be loved in, strongest first.' },
      giving: { ...freeLoveList, description: 'One to three languages they most likely reach for when showing love, strongest first. Often not the same as the ones above.' },
    }),
  }),
  card: FREE_CARD_SCHEMA,
});

// Signature patterns as the free card carries them: named, not yet evidenced.
// The paid report adds the evidence and where each shows up.
const FREE_PATTERNS = { ...listOf({
  id: { type: 'string', enum: ['p1', 'p2', 'p3'], description: 'p1, p2, p3 in order of how much of the profile each explains.' },
  name: { type: 'string', description: 'A short, memorable name in plain words. Not a type label, not jargon, not a compliment. Under 40 characters.' },
  line: { type: 'string', description: 'One sentence: the behaviour, where it helps them and where it costs them. Under 160 characters.' },
}), description: 'Two or three signature patterns.' };

// The structured layout's character, chosen from the catalogue. The franchise
// is the catalogue's and the emblem is the app's, so neither is the model's
// to invent; `icon` stays in the schema, always empty, so a stored report
// keeps one shape.
const CATALOGUE_CHARACTER = {
  type: 'string', enum: CHARACTER_NAMES,
  description: 'The one character from this catalogue this person is most like in temperament — how they behave, what drives them, how they treat people; never how anyone looks. Reach past the obvious fit and past the flattering one: the point is recognition, not a compliment.',
};
const CATALOGUE_FRANCHISE = { type: 'string', description: 'The franchise the catalogue gives this character: ' +
  Array.from(new Set(CHARACTER_CATALOGUE.map(([, f]) => f))).join(', ') + '.' };
const CATALOGUE_ICON = { type: 'string', description: 'Always an empty string: the app draws this character\'s emblem.' };
// The structured card's write-up: two sentences on why this person is like
// the character, and nothing else. The four-sentence portrait the classic card
// carries repeated what the card's own panels already show.
const STRUCTURED_CARD_HIGHLIGHTS = { type: 'string', description: 'Exactly two sentences for the shareable card, written to them as "you", on why they are like this character: the trait, drive or way of treating people the two of them share, shown through something specific in their own data. The card prints the character\'s name directly above this, so do not open by restating it or by announcing the comparison ("You are like X") — go straight to what they have in common. No type, no scores, no list of interests: the card shows those already. The signature patterns are printed directly below, so do not restate a pattern\'s line — show the likeness through different evidence. Specific to this person; never a sentence that would fit anyone else this character could be given to.' };

const STRUCTURED_FREE_ESSENCE = object({
  character: CATALOGUE_CHARACTER, franchise: CATALOGUE_FRANCHISE, icon: CATALOGUE_ICON,
});

// The write-up comes after the patterns, so it is written knowing what the
// card already prints beneath it and can say something else.
const STRUCTURED_FREE_SCHEMA = object(Object.assign(
  Object.fromEntries(Object.entries(CLASSIC_FREE_SCHEMA.properties)
    .filter(([key]) => !['enneagram', 'card', 'cardHighlights'].includes(key))),
  { essence: STRUCTURED_FREE_ESSENCE, patterns: FREE_PATTERNS, cardHighlights: STRUCTURED_CARD_HIGHLIGHTS, card: FREE_CARD_SCHEMA }));

const FREE_SYSTEM = REPORT_LAYOUT === 'classic' ? CLASSIC_FREE_SYSTEM : STRUCTURED_FREE_SYSTEM;
const FREE_SCHEMA = REPORT_LAYOUT === 'classic' ? CLASSIC_FREE_SCHEMA : STRUCTURED_FREE_SCHEMA;

// The shareable card, completed from the conclusions above. The model writes
// only what is new on the card; everything the card merely repeats — the type,
// the scores, the lists, the love languages, the confidence — is copied from
// the answer it already gave, so it cannot disagree with it and is not paid for
// twice at the output rate. The name is the placeholder the digest carries;
// docs/app.js puts the reader's real name in its place on their own device.
function withCard(result) {
  if (!result || !result.data || typeof result.data !== 'object') return result;
  const d = result.data;
  const love = (d.relationship && d.relationship.loveLanguages) || {};
  const labelled = (list, n) => (Array.isArray(list) ? list : []).slice(0, n)
    .filter(item => item && item.language)
    .map(item => item.language + (item.strength ? ' (' + item.strength + ')' : ''));
  const names = (list, key, n) => (Array.isArray(list) ? list : []).slice(0, n)
    .map(item => item && item[key]).filter(Boolean).map(String);
  const mbti = (d.mbti && d.mbti.type) || 'Uncertain';
  const ennea = d.enneagram || {};
  const bigFive = {};
  for (const trait of TRAIT_KEYS) {
    const row = d.bigFive && d.bigFive[trait];
    bigFive[trait] = Math.max(0, Math.min(100, Math.round(Number(row && row.score) || 0)));
  }
  const card = Object.assign({}, d.card, {
    name: 'PsycheUser',
    mbti,
    enneagram: mbti === 'Uncertain' || !ennea.type ? '' : String(ennea.type) + (ennea.wing ? 'w' + ennea.wing : ''),
    bigFive,
    interests: names(d.interests, 'name', 4),
    values: names(d.values, 'value', 3),
    beliefs: names(d.beliefs, 'belief', 2),
    loveReceiving: labelled(love.receiving, 2),
    loveGiving: labelled(love.giving, 1),
    confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence && d.confidence.score) || 0))),
  });
  return Object.assign({}, result, { data: Object.assign({}, d, { card }) });
}

// ---------- how the evidence is written into a prompt ----------
//
// The digest is the same object for both calls. How it is *written* is a
// separate question, and raw JSON answered it expensively: every sampled line
// paid for its quotes and comma, every ranked entry for `{"name":…,"count":…}`,
// and those are tokens billed on every call without telling the model
// anything. So the small structured fields — profile, counts, rhythm,
// coverage, the message statistics — stay JSON, where their field names are
// what the prompts refer to, and every list is written out after them under
// its own dotted path, one item per line. The paths are the ones the prompts
// already name (`samples.likedPostCaptions`, `directMessages.ownMessageSample`),
// so nothing a prompt says about the digest stops being true.
//
// A line cannot start a section of its own: every item has its whitespace
// collapsed first, so no caption can smuggle in a newline and a `## ` header.
const EVIDENCE_LISTS = [
  'samples.captions', 'samples.comments', 'samples.likedPostCaptions',
  'directMessages.ownMessageSample',
  'instagramTopics', 'instagramAdInterests',
  'mostLikedAccounts', 'mostSavedAccounts', 'mostEngagedWith',
  'google.topChannels', 'google.videoTitleSample', 'google.topYoutubeSearches', 'google.topGoogleSearches',
  'facebook.postSample', 'facebook.commentSample', 'facebook.friends', 'facebook.topSearches',
  'facebook.ownMessageSample',
];

function evidenceLine(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    if ('name' in item && 'count' in item && Object.keys(item).length === 2) {
      return String(item.name).replace(/\s+/g, ' ').trim() + ' ×' + item.count;
    }
    return JSON.stringify(item);
  }
  return String(item == null ? '' : item).replace(/\s+/g, ' ').trim();
}

function renderEvidence(digest) {
  const skeleton = JSON.parse(JSON.stringify(digest && typeof digest === 'object' ? digest : {}));
  const sections = [];
  for (const path of EVIDENCE_LISTS) {
    const keys = path.split('.');
    let parent = skeleton;
    for (const key of keys.slice(0, -1)) parent = parent && typeof parent === 'object' ? parent[key] : undefined;
    const last = keys[keys.length - 1];
    if (!parent || typeof parent !== 'object' || !Array.isArray(parent[last])) continue;
    const list = parent[last];
    delete parent[last];
    // Empty is written rather than skipped: a list the reader unticked is a
    // fact the model is told about, not a field that silently went missing.
    sections.push(list.length
      ? '## ' + path + ' — ' + list.length + (list.length === 1 ? ' item' : ' items') + '\n' +
        list.map(evidenceLine).join('\n')
      : '## ' + path + ' — empty');
  }
  return 'Structured fields first, as JSON. Every list follows under its own path, one item per line; ' +
    'a ranked entry is written "name ×count".\n' + JSON.stringify(skeleton) +
    (sections.length ? '\n\n' + sections.join('\n\n') : '');
}

function freeBlocks(digest) {
  return [{
    type: 'text',
    text: 'Here is the evidence digest for one person, built from their ' +
      sourcePhrase(digest) + ' data. Reach your conclusions about them and produce their summary card.' +
      '\n\n<evidence>\n' + renderEvidence(digest) + '\n</evidence>',
  }];
}

// ---------- anchoring the paid report to the card ----------
//
// The reader has already seen — and may already have shared — the card the
// free call made. The paid report is written to explain *that* card. Left to
// re-derive everything from scratch it could land on a different type, and a
// reader who paid would open a report arguing they are an INTJ under a card
// that says INFJ. So the paid call is told the conclusions and asked to explain
// them, honestly, including where the evidence for one is thin.
//
// The anchor is rebuilt here from known fields only, never passed through as
// the client sent it. It arrives in a request body and goes into a prompt, so
// it is coerced, capped and stripped of anything the card does not carry;
// whatever else a client puts in it never reaches the model.
const ANCHOR_TEXT_MAX = 600;

function anchorFrom(report) {
  if (!report || typeof report !== 'object') return null;
  // Client-supplied, so cleaned before it reaches a prompt: no angle brackets
  // to close the <card> tag early, no control characters, and every field
  // bounded. The reader can only steer their own report with it, but a
  // bounded field is one nobody has to reason about.
  const text = (value, max) => String(value == null ? '' : value)
    .replace(/[<>\u0000-\u001f\u007f]/g, ' ').slice(0, max || 80);
  const pick = (list, key, limit) => (Array.isArray(list) ? list : [])
    .slice(0, limit).map(item => text(item && item[key])).filter(Boolean);
  const bigFive = {};
  for (const trait of TRAIT_KEYS) {
    const row = report.bigFive && report.bigFive[trait];
    const score = Number(row && row.score);
    if (Number.isFinite(score)) bigFive[trait] = { score: Math.max(0, Math.min(100, Math.round(score))), band: text(row.band, 16) };
  }
  const mbti = report.mbti || {};
  const enneagram = report.enneagram || {};
  const essence = report.essence || {};
  const love = (report.relationship && report.relationship.loveLanguages) || {};
  const anchor = {
    character: text(essence.character),
    franchise: text(essence.franchise, 40),
    mbtiType: text(mbti.type, 12),
    mbtiLetters: (Array.isArray(mbti.letters) ? mbti.letters : []).slice(0, 4).map(letter => ({
      axis: text(letter && letter.axis, 4),
      choice: text(letter && letter.choice, 1),
      strength: text(letter && letter.strength, 10),
    })),
    enneagram: text(enneagram.type, 12) + (enneagram.wing ? 'w' + text(enneagram.wing, 2) : ''),
    bigFive,
    interests: pick(report.interests, 'name', 8),
    values: pick(report.values, 'value', 6),
    beliefs: pick(report.beliefs, 'belief', 4),
    loveReceiving: pick(love.receiving, 'language', 3),
    loveGiving: pick(love.giving, 'language', 3),
    cardHighlights: text(report.cardHighlights, ANCHOR_TEXT_MAX),
  };
  // The structured layout's free card names its signature patterns; the paid
  // report keeps them. Absent on a classic card, so a classic anchor is the
  // same object it always was.
  const patterns = (Array.isArray(report.patterns) ? report.patterns : [])
    .filter(p => p && /^p[1-3]$/.test(p.id) && p.name).slice(0, 3)
    .map(p => ({ id: p.id, name: text(p.name, 60), line: text(p.line, 200) }));
  if (patterns.length) anchor.patterns = patterns;
  // Nothing worth anchoring to means no anchor at all, so the paid call falls
  // back to deriving everything itself rather than being told to explain an
  // empty card.
  if (!anchor.mbtiType && !Object.keys(bigFive).length) return null;
  return anchor;
}

function anchorBlock(anchor) {
  return {
    type: 'text',
    text: 'These conclusions were reached on an earlier pass and are already on the summary card the reader ' +
      'has seen. **Treat every one of them as settled.** Write the full report to explain them: keep this ' +
      'MBTI type with these letters and strengths, these Big Five scores and bands, ' +
      (anchor.enneagram ? 'this enneagram, ' : '') + 'this ' +
      'character, and these interests, values, beliefs and love languages in this order — you may add ' +
      'further interests, values or beliefs after these, but do not drop, rename or reorder them. Explain ' +
      'each honestly from the evidence, including where the case for one is thinner than its label ' +
      'suggests — say so in its reading or `why` rather than changing the conclusion. Copy the type, ' +
      'letters, scores and character into your own fields exactly as given.' +
      ((anchor.patterns || []).length
        ? ' The card also names the signature patterns: keep their ids, names and order exactly, and write ' +
          'each one\'s evidence and where it shows up. Sharpen a line if the evidence calls for it; do not ' +
          'replace the pattern.'
        : '') + '\n\n' +
      '<card>\n' + JSON.stringify(anchor) + '\n</card>',
  };
}

// ---------- premium: wellness, attachment, ideal partner and career, as their own pass over the same digest ----------
//
// Sits behind a $1.99 unlock. The no-diagnosis rule for `wellness` is not a
// function of price — it is stated in full within this prompt rather than
// assumed, because this is its own system prompt on its own call and
// inherits nothing from PROFILE_SYSTEM above just because the two are read
// from the same digest. Naming a condition is exactly as false a medical
// claim whether the reader paid for the document or not, and a reader who
// paid for it is arguably the one most likely to keep it.
//
// The roast used to live here too — moved out to the free report and back
// again once already — and has moved back to the free PROFILE_SCHEMA for
// good this time, alongside everything else in it, so a reader meets it
// without paying anything. `idealPartner` took its place in the order below,
// between `attachment` and `careerAssessment`: it leans on the same
// attachment read directly above it, the same way `careerAssessment` leans
// on the free report's `career` section.
//
// This schema briefly carried two more fields, patternsWorthAttention and
// lifeAdvice — a second, distinct paid section ("Supplementary analysis")
// sold alongside the roast. That section was cut.
const PREMIUM_SCHEMA = withDefs({
  wellnessDimension: WELLNESS_DIMENSION_DEF,
  point: PREMIUM_POINT_DEF,
  facet: PREMIUM_FACET_DEF,
}, object({
  // Six behavioural dimensions and what could be done about them. This is the
  // section that comes closest to health in the whole app, and the design
  // decisions that keep it on the right side of that line are deliberate
  // rather than incidental:
  //
  // **No scores.** Every other scored thing here — the Big Five, the
  // compatibility dimensions — carries a 0-100. This one does not, and that
  // is the point. A number reads as a measurement: "Emotional processing:
  // 41/100" is a health score in all but name, and the reader will screenshot
  // the number long after the caveat has scrolled away. A validated
  // instrument earns its number by being tested against outcomes with known
  // error rates; nothing derived from posting timestamps has that, so it does
  // not get the notation that implies it. A descriptive band and a confidence
  // level say what the evidence actually supports.
  //
  // **No composite.** `overall` is prose, not an index. Averaging six bands
  // into one "wellbeing score" rebuilds exactly the health rating this
  // section refuses to be, through the back door and with a veneer of
  // arithmetic.
  //
  // **The six have been reshaped once since.** `sleepAndRhythm` and
  // `physicalActivity` merged into `rhythmAndActivity` — they were always two
  // readings of the same thing, when a person is up and about, split across
  // two cards; and the weaker half now sits beside the strongest evidence in
  // the section rather than standing alone as a dimension that is silent for
  // most people. `emotionalProcessing` became `outlook`, and
  // `lifeTrajectory` is new.
  //
  // **This section is deliberately blunt, and that is a considered position
  // rather than an oversight.** It was asked for as a place for vulnerability
  // and reflection, and the instruction that goes with that is to name a hard
  // stretch as hard — "difficult", "bleak", "despair", "depressing" are words
  // the prompt explicitly makes available, because a reader in a dark place
  // who paid for this and got four paragraphs of euphemism has been failed
  // twice over.
  //
  // The line that does not move is **diagnosis**, and the hard limits below
  // draw it precisely rather than by banning a vocabulary: describing a life
  // and the writing that records it, however bleakly, is what this section is
  // for; telling somebody they have a condition, from posting timestamps,
  // with no clinical training, in a document they keep and may show other
  // people, is not. The field names hold the same line — `outlook` names the
  // writing, where `mood` would name an inner state the data cannot reach.
  //
  // **No caveat field.** Same reasoning as PREMIUM_SCHEMA's: the "this is
  // not an assessment, talk to a person" line belongs to the app, worded the
  // same way every run, not to a sampled response that could soften it.
  // docs/copy.js carries it as `wellnessCaveat`.
  wellness: object({
    ...wellnessDimensionRefs(),
    overall: { type: 'string', description: 'Two or three sentences drawing the six together — where the pattern looks steady, where it looks strained, and which one or two are worth their attention first. Prose only. Do not produce a combined score, index, grade, percentage or rating of any kind, and do not describe this as a measurement of their mental health, because it is not one.' },
    suggestions: { ...premiumPointList, description: 'Three to five concrete, specific things this person could actually do, each tied to a dimension above and to the evidence that put it there. Say what doing it looks like this week, not the abstract virtue behind it. No self-help register, no affirmations. These are practical suggestions from a behavioural read, never treatment, therapy or a care plan.' },
  }),

  // Top-level rather than nested under `relationship`, where it used to sit.
  // It became its own section on the page — between the wellness read and the
  // career one — and a section rendered three cards away from the object it
  // hangs off is a trap for whoever edits this next. The card's own
  // `attachment`/`attachmentWhy` fields are separate and unaffected: those are
  // the compressed version that travels in the QR code.
  attachment: object({
    style: { type: 'string', description: 'Name the style, using the standard four: secure, anxious, avoidant, or fearful-avoidant. Readers know these names, look them up, and compare notes with a partner, and a made-up phrase in their place leaves them with nothing to search for. Write it as a leaning rather than a category — "leans secure", "anxious-leaning", "avoidant-leaning", "fearful-avoidant leaning" — and add the behaviour that earns it, e.g. "Anxious-leaning: quick to reach out, quicker to read silence as distance". The leaning wording is not decoration: it is the difference between a description of how somebody has been behaving lately and a claim about who they are. Under 90 characters.' },
    styleTone: { type: 'string', description: 'One warm, plain sentence saying what this style is good at — every one of the four comes with real strengths, and the reader should meet theirs before they meet the caveats. Anxious attachment reads people accurately and invests early. Avoidant attachment stays steady under pressure and does not lose itself in someone else. Fearful-avoidant attachment usually means somebody who wants closeness and has learned to be careful with it, which is a survivable position and a common one, not a broken one. Secure attachment is not a prize the others failed to win. Say the specific version of this that fits the evidence, not the generic one.' },
    why: { type: 'string', description: 'Three or four sentences showing your working: which behavioural traces pointed here, which style you considered and rejected, and what would have changed your mind. Reason from what they do — how quickly and warmly they reply, how they write to people close to them, whether they broadcast or converse, how they handle a gap in contact — not from a horoscope, and not from what they watch or read about relationships, which shows an interest rather than a style. Write it as reasoning offered to them, not a finding delivered about them.' },
    derivedFrom: { ...strList, description: 'Two to four specific signals from the data this reading rests on, each a short phrase. Name the actual numbers or patterns.' },
    implications: { ...premiumPointList, description: 'Two or three concrete things this style means in a close relationship, written to them as "you": what they are likely to do, and what a partner will feel. Balance them — at least one should be something this style gives them or a partner, not only what to watch for. Where you name a pattern that costs them something, say it as a tendency they can work with rather than a rule about them: what it looks like, what usually helps, and that it moves. Attachment style is the most changeable thing in this whole report and a reader should finish this section believing that, because it is true and because a reader who thinks they have been handed a life sentence stops reading.' },
    caveat: { type: 'string', description: 'State plainly that attachment style cannot be read reliably from this data.' },
  }),

  // What kind of partner actually suits them, read directly off the
  // attachment section above rather than off a fresh pass over the digest —
  // a report that already spent a section explaining how they attach and
  // then answered "who suits them" from scratch would be arguing with
  // itself. Two lists rather than one: a partner who is right for someone is
  // not simply the absence of the partner who is wrong for them, and
  // collapsing "what you need" and "what to avoid" into a single list of
  // traits tends to produce a wishlist rather than a working diagnosis of
  // compatibility. The closing `summary` exists because a reader who has
  // just read two lists of traits still has to be told, in plain language,
  // what kind of person that adds up to.
  idealPartner: object({
    needs: { ...premiumPointList, description: 'Three to five concrete things this person actually needs in a partner to be well in the relationship — not a list of pleasant adjectives, but requirements that follow from the attachment style above, their love languages, their rhythm and their relationship strengths and weaknesses. Each one should say what they need and, briefly, why it matters for someone with this attachment style and this life, citing the real evidence rather than restating the attachment read in different words.' },
    carefulOf: { ...premiumPointList, description: 'Two to four honest warnings about partner types, dynamics or their own patterns worth being careful of — the kind of partner or relationship shape that would predictably go wrong for this specific person, given their attachment style, their relationship weaknesses and how they actually behave when close to someone. Not generic relationship advice or a list of universal red flags: each one should be a mismatch this person in particular is at real risk of walking into, and say what that would look like for them.' },
    summary: { type: 'string', description: 'Two or three sentences drawing the needs and the cautions together into one honest, specific verdict on what kind of partner truly suits this person — direct enough to be useful on its own if a reader skips straight to it, and not a restatement of the two lists above.' },
  }),

  // The career coach's read, as its own section after the descriptive "At
  // work" one above. The two are deliberately different jobs and the prompt
  // says so at length: `career` describes how this person works, and this
  // decides what they should do about it. Keeping them apart is what stops
  // the second becoming a restatement of the first in the imperative mood.
  //
  // The evidence here is thinner than anywhere else in the report and the
  // prompt is blunt about it: an Instagram export contains no CV, no job
  // history, no title, no salary and no performance review. What it contains
  // is how somebody works, what they are drawn to, who they are around and
  // what they finish — which is enough for a real read on their edge, and not
  // enough to tell them what job they have.
  careerAssessment: object({
    situation: { type: 'string', description: 'Two or three sentences on where they appear to be right now professionally, read strictly from what the data shows — the work they reference, the rooms they are in, the rhythm they keep, what they are visibly building. Say what you are inferring rather than asserting a job title, a seniority or an employer you cannot see. Where the export is genuinely thin on work, say so plainly here rather than inventing a career for them.' },
    edge: object({
      headline: { type: 'string', description: 'A few words naming the edge itself, e.g. "You finish what other people announce".' },
      detail: { type: 'string', description: 'Three or four sentences on what genuinely differentiates them — the thing they do reliably that most people do not, stated as an advantage they can actually use. This is the centre of the section, so make it specific and make it earned: an edge that would fit any conscientious person is not an edge, it is a compliment.' },
      evidence: { ...strList, description: 'Two to four specific things from the digest that make this an edge rather than a flattering guess. Quote the real counts, rhythms or phrases.' },
    }),
    underused: { $ref: '#/$defs/facet', description: 'Something they already have and are visibly not using — a skill the data shows, a network they do not draw on, work they do that nobody sees. The gap between what they can do and what they are getting credit for.' },
    holdingBack: { $ref: '#/$defs/facet', description: 'The pattern most likely to cost them professionally, drawn from behaviour rather than from a personality label. Be direct: this is the part a coach earns their fee on. Attack the pattern, never the person.' },
    actions: listOf({
      horizon: { type: 'string', enum: CAREER_HORIZONS, description: 'When this should happen.' },
      title: { type: 'string', description: 'A few words, phrased as something to do.' },
      detail: { type: 'string', description: 'Two or three sentences: what doing it actually looks like, concretely enough to start. Name the first move, not the ambition.' },
    }),
  }),
  // No model-generated caveat field on `wellness` above, unlike the other
  // places this file asks for one (trait bands, Enneagram, love languages).
  // Those are about how much weight a popular-but-unvalidated framework
  // deserves; this one is the "not a diagnosis, talk to a person" safety
  // line for the one section in the whole app that comes closest to health,
  // and it needs to be stated every time, worded exactly the same way every
  // time. That belongs to the app, not to a sampled response — docs/copy.js
  // carries it as fixed text shown beside the writing regardless of what
  // the model returned.
}));

const PREMIUM_SYSTEM = `You are PsycheAI, writing the paid half of a report whose free half is already written. Write for someone who has that free report in hand and already knows their character, their Big Five scores, their MBTI type and how they are described at work — and now their roast, which the free report also carries — so do not repeat, summarise or re-derive any of it.\n\nYou write four sections, in this order, and they are four different jobs rather than four angles on one. **wellness** is a careful behavioural read of six dimensions with suggestions attached. **attachment** is a single guess about closeness, shown working. **idealPartner** answers, directly off that same attachment read, what kind of partner actually suits them and what to be careful of. **careerAssessment** is a coach deciding what this person should do next. All four are written in the same voice as the free report — second person, warm but not sycophantic, specific, honest about uncertainty. They are behind a paywall because they are the deepest part of the report, not because any of them is harsh.

# What you are given

The identical evidence digest the free report was built from. \`coverage.sources\` says which exports it draws on, exactly as it did the first time — nothing new has been uploaded, and this is a deeper read of the same evidence rather than a request for more of it. Reason from the digest's text, counts and rhythms; there is nothing else, for this call or for the free one.

# The four sections

All four are written in the free report's voice — second person, warm but not sycophantic, specific, honest about uncertainty. They are behind a paywall because they are the deepest part of the report, not because any of them is unkind; nothing about being paid for changes how carefully they are written.

- **wellness**: six behavioural dimensions and what could be done about them. **This is the section that comes closest to health, and it is not a health assessment — read the hard limits below before you write a word of it.** What you are doing is reading observable behaviour: when somebody is active, how much they appear to be carrying, who they are in contact with, what they post about doing, how they write about things that matter, and what they keep coming back to. What you are *not* doing is measuring their mental health, because this data does not contain it.

  **What to read for each of the six**, since the schema shares one definition across them and cannot say this per field:

${wellnessBrief()}

  **The bands are not grades.** \`steady\` and \`under strain\` describe a *pattern*, not a person, and neither is a verdict. Most people are \`mixed\` on most dimensions and that is the ordinary result, not a middling one. Reserve \`under strain\` for a pattern the evidence genuinely shows — a rhythm that has drifted hours later across months, contact that has narrowed to almost nobody, plans accumulating unclosed — and say what the pattern is rather than what it might mean about them.

  **\`not enough evidence\` is a real answer and you should use it.** The six are evidenced very unevenly. The hour-of-day and day-of-week histograms are complete, so the rhythm half of \`rhythmAndActivity\` almost always has something; the activity half of the same dimension rests entirely on whether somebody happened to post about exercise, and plenty of active people never do, so the two halves can honestly carry different weight within one reading. \`lifeTrajectory\` needs years to say anything — on a thin or recent export it is often genuinely unreadable, and saying so beats narrating an arc out of a handful of months. \`outlook\` depends on there being enough of their own writing to read a register from; a feed of reposts with no captions cannot support it. An empty result anywhere here means the export is silent, not that the person is inactive, aimless or without hope, and writing it up as anything else is inventing a finding. The same rule as everywhere else applies hardest here: **a missing behaviour is only evidence if you would have expected to see it.**

  **Weight the dimensions by what actually backs them**, and let \`confidence\` say so per dimension rather than hedging the prose. A complete histogram supports a confident read. Three captions mentioning a gym do not.

  **\`overall\` is prose and must stay prose.** Do not produce a score, index, grade, percentage, letter, rating or star count, do not average the bands, and do not describe the section as measuring, scoring, rating or assessing their mental health. Two or three sentences drawing the six together and naming the one or two worth their attention first.

  **\`suggestions\` are practical, not clinical.** Concrete things to try this week, each tied to a dimension and the evidence behind it. They are what an observant friend would suggest after actually looking — never treatment, never therapy, never a care plan, and never framed as something that will fix a condition.

- **attachment**: its own section, not part of the relationship read above — write it to stand alone rather than as a continuation of what came before it. Attachment style is a guess and must be labelled as one, but show your working rather than asserting it: name the behavioural traces it rests on, say which style you considered and rejected and what would have changed your mind, then spell out what it actually means for them and for whoever is close to them. A named style with no reasoning is worthless and slightly harmful.

  **Read the style from how they behave with people, never from what they read about it.** The evidence for an attachment leaning is conduct in their own relationships: who starts the conversations, how quickly and how warmly they reply, how they write to the people closest to them, what happens around a gap in contact, how large a circle they keep and for how long. What they watch, search for or save about relationships is a different kind of evidence. Repeated views of attachment-coaching channels, searches about avoidance, saved posts about anxious partners show an *interest*, and an interest fits many explanations equally well — curiosity, a partner's or an ex's pattern they were trying to understand, a break-up they were making sense of, a friend's situation, or work they are already doing to feel more secure. Consumption may appear in \`why\` as one supporting line, at its real weight. It is never the trace the style rests on: a read whose strongest evidence is a reading list is a read of the reading list.

  **When the behavioural evidence is thin or mixed, take the more cautious read.** Roughly half of adults lean secure, so a non-secure leaning has to be shown in their own conduct. Fearful-avoidant claims two things at once — a pull towards closeness and a retreat from it — so it needs both halves visible in what they do, not one observed and the other inferred. Where the behaviour shows a mostly steady core with a defensive pattern under pressure, say exactly that: "leans secure, with avoidant defences under stress" is a legitimate read and often the most honest one, and escalating it to a stronger category is the overreach. Either way, name the stronger style you considered in \`why\` and the behaviour that would have moved you to it.

  Use the standard names — secure, anxious, avoidant, fearful-avoidant — because a reader who is told they lean one of these can look it up, recognise themselves or not, and talk to a partner about it, and an invented phrase in their place leaves them with nothing to hold. Write each as a *leaning* rather than a category, which is both more honest about what an Instagram export can show and the difference between describing how somebody has been behaving and declaring what they are.

  **Tone is a correctness requirement in this section, not a nicety.** These four words arrive loaded: a reader who sees "anxious" or "fearful-avoidant" is reading whatever they already believe that means, usually something worse than what you intend. So lead with what the style is genuinely good at — every one of them comes with real strengths, and none of them is a defect — and only then get to what it costs. Fearful-avoidant in particular usually describes someone who wants closeness and has learned to be careful with it, which is a common and survivable position, not a broken one; secure is not a prize the other three failed to win. Where a pattern does cost them something, write it as a tendency they can work with — what it looks like, what tends to help, and that it moves. Attachment is the most changeable thing in this entire report, and the reader should finish this section believing that, because it is true. Prescribing what they must do, or writing as though the label settles their future, is the failure mode here.

- **idealPartner**: what kind of partner actually suits them, argued directly from the attachment section immediately above rather than from a fresh read of the digest — you have already established how they attach, so use it. \`needs\` says what they actually require to be well in a relationship: not adjectives a magazine quiz would produce, but requirements that follow from their attachment style, their love languages and their own relationship strengths and weaknesses, each one earning its place with real evidence. \`carefulOf\` is the honest counterpart: partner types or dynamics that would predictably go wrong for *this* person specifically, given how they attach and how they behave once close to someone — not a list of universal red flags, which would fit anybody and help nobody.

  **This is the most concrete test of whether you actually used the attachment read or just re-described it.** If a need or a caution here would make just as much sense bolted onto a stranger with a different attachment style, it has not done its job — go back to \`attachment.why\` and \`attachment.implications\` and pull the specific thread through. \`summary\` closes the section in two or three sentences: the honest verdict a reader gets even if they read nothing else here, not a recap of the two lists above it.

- **careerAssessment**: you are a career coach here, and this is the one section in the report that is meant to change what somebody does on Monday. **It is a different job from the career section above, and the two must not say the same thing twice.** That one describes how this person works; this one decides what they should do about it. If a sentence here would sit comfortably in \`career.workStyle\`, it belongs there instead.

  **\`edge\` is the centre of the section.** Name the thing they do reliably that most people do not, and state it as an advantage they can use rather than a compliment they can enjoy. The test is whether it would survive being read by somebody who knows them: an edge that would fit any organised, agreeable or hard-working person is not an edge. Reach for the specific and slightly unobvious — a follow-through rate most people do not have, a room they are in that their job title would not predict, the fact that the same twelve people have stayed close for four years — and evidence it with real counts.

  **Be honest about what you cannot see, because it is a lot.** This export contains no CV, no job history, no title, no employer, no salary and no performance review. You are reading how somebody works from the traces of a life posted around the work. That is genuinely enough to find an edge and name a pattern that is costing them; it is nowhere near enough to state what job they hold or how senior they are. Infer openly and say you are inferring. Where the export barely touches work at all, say that in \`situation\` and keep the rest proportionate rather than inventing a career to advise.

  **The who-is-this-about rule bites hardest here.** Somebody who photographs founders at a demo night is the person who was in the room, not a founder; somebody who writes up a friend's promotion has not been promoted. Reading a borrowed biography as a career is the single most damaging error available in this section, because unlike a wrong trait score it reads as a confident statement of fact about a life they do not have.

  **\`actions\` must be startable.** Each carries a horizon, and at least one should be \`this week\` — an answer with nothing in it before next quarter is a wish list. Name the first move rather than the ambition: "ask your manager which of the three projects counts at review" beats "increase your visibility". Concrete enough that they could do it after reading it.

# Hard limits

Every claim is evidence-bound, citing the actual data behind it, exactly like the rest of this report — an unsupported line comes out rather than staying in because the section felt thin. Do not identify or speculate about anyone else in the data.

**No private individual's name appears anywhere in these four sections, quoted evidence included.** These sections are about closeness, so the temptation is sharper here than in the free half: the evidence for how somebody attaches is often a caption addressed to one particular person by name. Quote around the name — "a message to a close friend", "the person they write to most" — or trim the quote to the part doing the work. Describe the relationship, never the person. Do not infer sexual orientation, health conditions, immigration status or political affiliation. A search is a question, not a diagnosis or a declaration, and this holds hardest over a Google export: a searched symptom is never evidence of a health condition, named or implied.

## The wellness section is a behavioural read, not a health assessment

These limits are absolute and they bind the \`wellness\` section hardest of anything in this report, because it is the section whose subject matter sits closest to health and therefore the one where a false claim would do the most damage. This app's own front page says it is not a clinical or diagnostic tool, and this section is where that promise is kept or broken.

**Never name, imply, predict or gesture at a mental or physical health condition, disorder, diagnosis or illness.** Not depression, not anxiety, not ADHD, not insomnia or any sleep disorder, not an eating disorder, not burnout as a clinical state, not "symptoms of" or "signs of" or "at risk of" anything clinical. This holds however the section is framed and however directly a reader might want it: you have somebody's social-media export and no clinical training, no history, no assessment and no standing, and a condition named from posting patterns is a confident falsehood about a person's health in a document they keep and may show to other people.

**Do not produce a mental health score, rating, index, grade or percentage**, under any label — not in \`overall\`, not by averaging the bands, not as a "wellbeing index" or a "wellness score" or a number out of ten. The bands exist precisely so that this section says what the evidence supports without borrowing the notation of instruments that were validated against real outcomes. This one has not been.

**Do not claim to measure what the data does not contain.** You have posting timestamps, not a sleep record: somebody active at 3am reached for their phone at 3am, which is not the same as knowing when or whether they slept, and you must never write as though it were. No source here carries duration of any kind — no screen time, no session length, no hours spent — so never write minutes, hours or "time spent" in this section either.

**Say nothing about their body.** The activity half of \`rhythmAndActivity\` reads what somebody chose to post about doing. It may never become a statement about their weight, shape, fitness, diet, appearance or physical condition, and an absence of exercise posts is silence rather than a finding.

**Say the hard thing plainly. Hedging is the failure mode in this section, not the safe option.** This is the part of the report a reader opens in a reflective, often vulnerable frame of mind, and they paid for it. If the evidence points somewhere bleak — a year that reads as genuinely difficult, writing that sounds despairing, a life that appears to have narrowed — name it in ordinary human words. **"Difficult", "depressing", "bleak", "despair", "grim", "lonely", "stuck", "exhausted" are all available to you and are often the honest reading.** Somebody who is in a dark place and reads four paragraphs of careful euphemism about their "quieter chapter" has been failed twice: once by the softening, and once by paying for it. Warmth here means telling the truth and then staying with them in it — not looking away.

**The one line that does not move is diagnosis.** Everything above is about describing a life and the writing that records it. None of it licenses naming, implying or predicting a clinical condition — not depression, not anxiety, not burnout as a clinical state, not "at risk of" anything, and not a period relabelled as a depressive episode, a breakdown, a relapse or a crisis. The distinction is real and worth holding precisely: *"this reads as a genuinely depressing stretch and you sound worn down by it"* is an honest description of evidence and is exactly what this section is for; *"you appear to have been depressed"* is a medical claim about a person, made from posting timestamps, by something with no clinical training, in a document they keep and may show other people. Describe the life as fully and as bluntly as the evidence supports. Do not hand anybody a diagnosis they did not get from someone qualified to give one — and where something genuinely looks like it warrants that, say so directly: that it is worth taking to somebody who can actually assess it.

**Where something genuinely looks heavier than a behavioural pattern, hand it off rather than handling it.** Say it is worth raising with someone qualified to actually assess it, in those words, and stop there. Do not counsel, do not reassure, and do not attempt to work out what it is.`;

function premiumBlocks(digest) {
  return [{
    type: 'text',
    text: 'Here is the same evidence digest already analysed once for the free report, built from their ' +
      sourcePhrase(digest) + ' data. This is the paid pass over it: the wellness read, the attachment ' +
      'read, the ideal-partner read and the career coaching — the four sections the free report does ' +
      'not carry.\n\n<evidence>\n' + renderEvidence(digest) + '\n</evidence>',
  }];
}

// ---------- the full premium report: one call for everything the unlock buys ----------
//
// The unlock used to be two calls — the written report, then the four premium
// sections as a second pass that never saw the first. It is one now: the
// profile prompt and the premium prompt joined, the two schemas merged, one
// response. Built from the two prompts rather than written a third time, so
// an edit to either reaches this call too, and each splice is made on marker
// text that throws if it goes missing — the same rule FREE_SYSTEM's cuts
// follow.
function replaceOnce(text, from, to) {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error('FULL_SYSTEM: expected exactly one "' + from.slice(0, 60) + '"');
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}

const FULL_SYSTEM_BASE = (() => {
  // The profile half, with its two notes about "a separate paid pass" turned
  // into pointers to the sections further down the same response.
  let profile = PROFILE_SYSTEM;
  profile = replaceOnce(profile,
    'The coaching that acts on it is a separate paid pass over the same digest, written by a separate call that never sees this text, so leaving the advice out here does not lose it.',
    'The coaching that acts on it is `careerAssessment`, further down this same response, so leaving the advice out here does not lose it.');
  profile = replaceOnce(profile,
    'There is no attachment section in this report to compress: that read is written by a separate paid pass and this call never sees it. So derive these two from the behavioural traces yourself',
    'They are the compressed form of the `attachment` section further down this same response, and must agree with it — the same leaning, in fewer words. Derive both from the behavioural traces');

  // The premium half, from its section list onward. Its opening paragraph and
  // "What you are given" describe a second call over an already-written free
  // report, which this is not.
  const premiumStart = PREMIUM_SYSTEM.indexOf('# The four sections');
  if (premiumStart < 0) throw new Error('FULL_SYSTEM: PREMIUM_SYSTEM has no "# The four sections"');
  let premium = PREMIUM_SYSTEM.slice(premiumStart);
  premium = replaceOnce(premium, '# The four sections', '# The four premium sections');
  premium = replaceOnce(premium, '# Hard limits', '# Hard limits for the four premium sections');
  premium = premium.split("the free report's voice").join('the voice of the rest of this report');
  premium = premium.split('than in the free half').join('than in the sections above');

  return profile + '\n\n' +
    '# After the report: four premium sections, in the same response\n\n' +
    'The same response carries four more sections after everything above — **wellness**, **attachment**, ' +
    '**idealPartner** and **careerAssessment** — written from the same digest in the same pass. They ' +
    'build on what you have already concluded: do not re-derive the character, the Big Five or the MBTI ' +
    'in them, and do not repeat what the sections above already said — point back at it in a clause. ' +
    'They are four different jobs rather than four angles on one. **wellness** is a careful behavioural ' +
    'read of six dimensions with suggestions attached. **attachment** is a single guess about closeness, ' +
    'shown working. **idealPartner** answers, directly off that same attachment read, what kind of partner ' +
    'actually suits them and what to be careful of. **careerAssessment** is a coach deciding what this ' +
    'person should do next, acting on the description in the career section above rather than repeating ' +
    'it.\n\n' + premium;
})();

const CLASSIC_FULL_SYSTEM = FULL_SYSTEM_BASE;
const CLASSIC_FULL_SCHEMA = Object.assign(
  object(Object.assign({}, PROFILE_SCHEMA.properties, PREMIUM_SCHEMA.properties)),
  { $defs: PREMIUM_SCHEMA.$defs });

// The keys the unlock's response carries for the four premium sections — what
// the browser files under `premiumAnalysis` rather than under the report.
const PREMIUM_KEYS = Object.keys(PREMIUM_SCHEMA.properties);

// ---------- the structured report: one thread through four parts ----------
//
// The classic report is a run of sections that never refer to each other.
// The structured one adds four fields that tie them together, modelled on how
// professional assessments are built (definition, overview, chart, detail,
// and development drawn from the findings) but using only public frameworks
// and this app's own wording:
//
// - `patterns`: two or three signature patterns, decided first, which every
//   section then points back at. They are what make the report one argument.
// - `motivators`: Schwartz's ten basic human values (a published academic
//   model, not anybody's proprietary "drivers"), scored relative to each other.
// - `development`: what to build on and what to work on, each naming the
//   pattern it resolves and the sections that raised it.
// - `pressurePoints`: strengths that turn costly when overused — the public
//   "overused strengths" idea — each with early signs, one counter-move and a
//   reflection question.
//
// Purely additive: every classic field is still written, so a report made in
// this layout renders in the classic one too, and switching back is one
// environment variable (PSYCHEAI_REPORT_LAYOUT=classic) with no data change.

// The sections a pattern can show up in, or a development item can be raised
// by. Rendered as links on the page, so they are keys rather than titles.
// The sections a pattern can show up in, or a plan item be raised by. Not the
// digital footprint: the web report no longer has that section to point at.
const SECTION_KEYS = ['bigFive', 'mbti', 'motivators', 'interests', 'values', 'beliefs',
  'relationships', 'attachment', 'idealPartner', 'work', 'wellness'];
const PATTERN_IDS = ['p1', 'p2', 'p3'];
// Schwartz's ten, in their order around his circle, which is the order the
// chart draws them in: neighbours are compatible, opposites trade off.
const MOTIVATORS = ['self-direction', 'stimulation', 'hedonism', 'achievement', 'power',
  'security', 'conformity', 'tradition', 'benevolence', 'universalism'];
// How clearly *their* data shows the overused version — never a comparison
// with other people, which this app has no population to make.
const PRESSURE_LEVELS = ['mild', 'moderate', 'marked'];

// "none" rather than an empty string: Gemini rejects a schema whose enum holds
// an empty string with a bare 400 INVALID_ARGUMENT, and the reader treats any
// value that is not a pattern id as no pattern.
const patternRef = {
  type: 'string', enum: PATTERN_IDS.concat(['none']),
  description: 'The id of the signature pattern this comes from, or "none" if it does not come from one.',
};
const sectionRefs = (what) => ({
  type: 'array', items: { type: 'string', enum: SECTION_KEYS }, description: what,
});

const STRUCTURED_PROPERTIES = {
  patterns: listOf({
    id: { type: 'string', enum: PATTERN_IDS, description: 'p1, p2, p3 in order of how much of the report each explains.' },
    name: { type: 'string', description: 'A short, memorable name in plain words, e.g. "The quiet organiser" or "Warm in private, guarded in public". Not a type label, not jargon, not a compliment. Under 40 characters.' },
    line: { type: 'string', description: 'One sentence saying what the pattern is: the behaviour, and the two sides of it — where it helps them and where it costs them.' },
    evidence: { ...strList, description: 'Two to four specific things from the digest that show it, each with a count or a proportion. Follow the rules on numbers.' },
    showsUpIn: sectionRefs('The sections where this pattern visibly operates — at least three, or it is a finding rather than a pattern.'),
  }),
  motivators: object({
    scores: listOf({
      value: { type: 'string', enum: MOTIVATORS },
      score: { type: 'integer', description: '0-100: how strongly this value shows up in what they actually do, relative to their other nine values.' },
      line: { type: 'string', description: 'One sentence of evidence for the score. For a low score, what shows it is low, or "little in the data either way". Under 160 characters.' },
    }),
    reading: { type: 'string', description: 'Two or three sentences on the shape: what they are moving towards, and the tension between their top values if there is one.' },
  }),
  development: object({
    buildOn: listOf({
      title: { type: 'string', description: 'A few words: the strength to lean into.' },
      detail: { type: 'string', description: 'Two sentences: what it is, and how to use it more deliberately.' },
      pattern: patternRef,
      raisedBy: sectionRefs('The sections whose findings raised this, so the reader can see why it is here.'),
    }),
    develop: listOf({
      title: { type: 'string', description: 'A few words: the area worth working on.' },
      detail: { type: 'string', description: 'Two or three sentences: what the pattern costs them, from the evidence, without moralising.' },
      pattern: patternRef,
      raisedBy: sectionRefs('The sections whose findings raised this.'),
      actions: listOf({
        horizon: { type: 'string', enum: CAREER_HORIZONS },
        step: { type: 'string', description: 'One concrete first move, startable as written. One sentence.' },
      }),
      reflect: { type: 'string', description: 'One open question worth sitting with, specific to them. Not rhetorical.' },
    }),
  }),
  pressurePoints: listOf({
    strength: { type: 'string', description: 'The strength, in a few plain words, e.g. "Independence".' },
    overused: { type: 'string', description: 'What it turns into when overused, in a few plain words, e.g. "Going it alone".' },
    level: { type: 'string', enum: PRESSURE_LEVELS, description: 'How clearly their data already shows the overused version: mild (strength clear, cost only hinted), moderate (some evidence of the cost), marked (the cost is visible repeatedly). Never a comparison with other people.' },
    pattern: patternRef,
    detail: { type: 'string', description: 'Two sentences: how the strength tips over, for them specifically, from the evidence.' },
    earlySigns: { ...strList, description: 'Two or three observable behaviours they, or someone close to them, could notice early. Behaviours, not feelings.' },
    mitigation: { type: 'string', description: 'One concrete counter-move. One or two sentences.' },
    question: { type: 'string', description: 'One reflection question.' },
  }),
};

// What the structured layout leaves out of the classic report. The QR card
// keeps its `enneagram` field — cards already shared carry one and the wire
// format is fixed — but in this layout it is always empty.
const STRUCTURED_DROPS = ['enneagram'];
// The full report's character: the catalogue's, with the written `why`.
const STRUCTURED_ESSENCE = object({
  character: CATALOGUE_CHARACTER, franchise: CATALOGUE_FRANCHISE, icon: CATALOGUE_ICON,
  why: PROFILE_SCHEMA.properties.essence.properties.why,
});
const STRUCTURED_CARD_SCHEMA = object(Object.assign({}, CARD_SCHEMA.properties, {
  enneagram: { type: 'string', description: 'Always an empty string. This report does not use the Enneagram.' },
}));

// The order the model writes in. `patterns` straight after the summary, so it
// is decided before any section that is meant to point back at it;
// `motivators` beside the values it places on a common map; the closing two
// last, because they resolve everything above them.
function structuredSchema() {
  const p = PROFILE_SCHEMA.properties;
  const q = PREMIUM_SCHEMA.properties;
  const s = STRUCTURED_PROPERTIES;
  const ordered = {
    confidence: p.confidence, essence: STRUCTURED_ESSENCE, summary: p.summary, patterns: s.patterns,
    cardHighlights: STRUCTURED_CARD_HIGHLIGHTS, bigFive: p.bigFive, mbti: p.mbti,
    activity: p.activity, interests: p.interests, beliefs: p.beliefs, values: p.values,
    motivators: s.motivators, relationship: p.relationship, career: p.career, bonus: p.bonus, card: STRUCTURED_CARD_SCHEMA,
    wellness: q.wellness, attachment: q.attachment, idealPartner: q.idealPartner,
    careerAssessment: q.careerAssessment, development: s.development, pressurePoints: s.pressurePoints,
  };
  // Every classic field is still here except the Enneagram, which this
  // layout drops — the structured layout otherwise only adds.
  for (const key of Object.keys(p).concat(Object.keys(q))) {
    if (!(key in ordered) && !STRUCTURED_DROPS.includes(key)) {
      throw new Error('structuredSchema: ' + key + ' is missing from the order');
    }
  }
  return Object.assign(object(ordered), { $defs: PREMIUM_SCHEMA.$defs });
}

const STRUCTURED_KEYS = Object.keys(STRUCTURED_PROPERTIES);

const STRUCTURED_ADDON = `# The thread that ties this report together

This report is read as one document, not as a run of separate verdicts, and it is laid out in four parts: who you are, what drives you, how you connect and work, and putting it together. Four more fields carry the thread through it.

- **patterns** — two or three signature patterns: the few behaviours that explain the most of everything else in this report. **Decide them before you write any section**, then let every section after draw on them. Each has an id (p1, p2, p3, in order of how much it explains), a short memorable name in plain words — "The quiet organiser", "Warm in private, guarded in public" — that is neither a type label nor a compliment, one line naming the behaviour and both of its sides, two to four pieces of counted evidence, and \`showsUpIn\`: the sections where it visibly operates. A pattern visible in fewer than three sections is a finding, not a pattern. Patterns are behaviours with two sides, never virtues: each helps them somewhere and costs them somewhere else.

  Inside the sections, when a finding is one of these patterns at work, say so once in a clause by its name — "the same quiet-organiser pattern behind your conscientiousness" — rather than explaining it again. That back-reference is what makes the report read as one argument, and it obeys the rule above about spelling evidence out once.

- **motivators** — where their motivation sits on Schwartz's ten basic human values, a published academic model: self-direction, stimulation, hedonism, achievement, power, security, conformity, tradition, benevolence, universalism. Give all ten, each exactly once. \`score\` is 0–100 for how strongly the value shows up in what they actually do — choices, attention, what they return to — **relative to their other nine**, so the ten must spread out: a profile with everything between 55 and 70 has not decided anything. Read behaviour first and stated opinion second; a value they post about and never act on scores below one they act on without mentioning. Neighbours on Schwartz's circle (self-direction and stimulation; achievement and power; security, conformity and tradition; benevolence and universalism) usually rise and fall together and opposites trade off — where theirs do not, that is worth a sentence in \`reading\`. This is not the \`values\` list above, which names their values in their own terms; this places them on a common map.

- **development** — closes the report by resolving the patterns. \`buildOn\` is two or three strengths to lean into deliberately; \`develop\` is two or three areas worth working on. Each names the pattern it resolves and \`raisedBy\`, the sections whose findings raised it, so a reader can trace why it is there. Every \`develop\` item carries two or three actions, at least one for \`this week\`, each a first move rather than an ambition, and \`reflect\`, one open question specific to them. This is about the whole of their life; \`careerAssessment\` is about work. Do not repeat its actions — where a work action is the right one, point at it in a clause instead.

- **pressurePoints** — two to four strengths that turn costly when overused, under pressure or when tired: the independence that becomes going it alone, the reliability that becomes absorbing everyone else's overflow. Most are the cost side of a pattern, so name it. \`level\` says how clearly *their* data already shows the overused version, and is never a comparison with other people. \`earlySigns\` are behaviours someone could notice early, not feelings. \`mitigation\` is one concrete counter-move and \`question\` one reflection question. This is behaviour under pressure, never a condition: the hard limits on clinical language apply here exactly as they do in the wellness section.

**Fields that share a section on the page must not repeat each other.** How you work shows \`career\` and \`careerAssessment\` as one section: \`careerAssessment.edge\` leads it, so \`career.strengths\` are strengths other than the edge, and \`careerAssessment.holdingBack\`, \`career.weaknesses\` and \`career.watchOuts\` appear as one list of what holds them back — three different costs, not one cost said three ways. In relationships shows \`relationship\`, \`attachment\` and \`idealPartner\` as one section, so \`attachment.implications\` and \`idealPartner.carefulOf\` must not restate \`relationship.weaknesses\`. What you stand for shows \`values\` and \`beliefs\` as one list with no label saying which is which, so a belief is a commitment no value already names — never a value restated as a sentence. Every action in the report — \`development.develop\` actions, \`careerAssessment.actions\` and \`wellness.suggestions\`, which go on it as this-week moves — sits on one plan, so no two of them may be the same step.

**On the page, MBTI now comes before the Big Five**, though you still write the Big Five first. In the E/I \`why\`, name "your extraversion score of N" rather than "the score above", which would point the wrong way.

The four must agree with the sections: a pattern, a development area or a pressure point that introduces a claim no section made is a new claim without its evidence. Keep them proportionate — together roughly the length of two ordinary sections. Where a section would repeat what a pattern already says, shorten the section, not this.`;

// The classic prompt's Enneagram section, cut from the structured one along
// with the field. Cut on its text, which throws if it ever goes missing, the
// same rule FULL_SYSTEM_BASE's splices follow.
const STRUCTURED_FULL_SYSTEM = (() => {
  const start = FULL_SYSTEM_BASE.indexOf('- **Enneagram**: ');
  const end = FULL_SYSTEM_BASE.indexOf('\n\n- **activity**: ', start);
  if (start < 0 || end < 0) throw new Error('STRUCTURED_FULL_SYSTEM: no Enneagram section to remove');
  return FULL_SYSTEM_BASE.slice(0, start) + FULL_SYSTEM_BASE.slice(end + 2) + '\n\n' + STRUCTURED_ADDON;
})();
const STRUCTURED_FULL_SCHEMA = structuredSchema();

// ---------- the full schema when a card is pinned ----------
//
// Gemini refuses a response schema past a complexity limit it neither names
// nor reports — a bare 400 "Request contains an invalid argument." — and the
// structured full schema is past it. tools/probe-schema.mjs measured where:
// the classic full schema and the structured one without its four added
// sections are served; the structured one with all four, or missing any one
// of them, is refused. No single part is at fault — it is the total, and
// mostly the enums and fields rather than the description text.
//
// So the paid call stops asking for what it is not going to decide. With a
// free card to anchor to, every conclusion that card holds is pinned over
// the paid report on the reader's device (overlayCard in docs/app.js):
// the character, the confidence score, every Big Five score and band, the
// MBTI type and each letter's choice and strength, each interest's intensity,
// each love language's strength, and the shareable card itself. Asking the
// model for them again bought nothing but schema, and enums are the
// expensive part of it. What stays is everything the report writes about
// them — and well under the classic schema's size on every count.
//
// The language name stays on each love-language row, unconstrained, because
// overlayCard matches the report's writing to the card's rows by it.
function pinnedFullSchema(schema) {
  const out = JSON.parse(JSON.stringify(schema));
  const drop = (node, keys) => {
    for (const key of keys) delete node.properties[key];
    node.required = (node.required || []).filter(key => !keys.includes(key));
  };
  const P = out.properties;
  drop(out, ['card']);
  drop(P.essence, ['character', 'franchise', 'icon']);
  drop(P.confidence, ['score', 'level']);
  for (const trait of Object.keys(P.bigFive.properties)) drop(P.bigFive.properties[trait], ['score', 'band']);
  drop(P.mbti, ['type']);
  drop(P.mbti.properties.letters.items, ['choice', 'strength']);
  drop(P.interests.items, ['intensity']);
  const love = P.relationship.properties.loveLanguages.properties;
  for (const side of ['receiving', 'giving']) {
    const row = love[side].items;
    row.properties.language = { type: 'string', description: 'The love language, exactly as the card names it.' };
    drop(row, ['strength']);
  }
  return out;
}
const STRUCTURED_PINNED_FULL_SCHEMA = pinnedFullSchema(STRUCTURED_FULL_SCHEMA);

// Which of the two the unlock's call sends — see REPORT_LAYOUT at the top.
const FULL_SYSTEM = REPORT_LAYOUT === 'classic' ? CLASSIC_FULL_SYSTEM : STRUCTURED_FULL_SYSTEM;
const FULL_SCHEMA = REPORT_LAYOUT === 'classic' ? CLASSIC_FULL_SCHEMA : STRUCTURED_FULL_SCHEMA;
// The classic schema is served whole, so it is its own pinned version.
const FULL_PINNED_SCHEMA = REPORT_LAYOUT === 'classic' ? CLASSIC_FULL_SCHEMA : STRUCTURED_PINNED_FULL_SCHEMA;

/**
 * The schema the unlock's call sends. With an anchor, the pinned one. In the
 * structured layout the server never makes this call without one (see
 * cardThenFull in server.js), because the unpinned schema is the one Gemini
 * refuses; it is kept for the classic layout and for providers that serve it.
 */
function fullSchemaFor(anchor) {
  return anchor ? FULL_PINNED_SCHEMA : FULL_SCHEMA;
}

// ---------- compatibility ----------

// The user picks one basis before the call runs, so the report answers one
// question properly rather than three at once.
const COMPATIBILITY_MODES = {
  romantic: {
    label: 'Romantic',
    heading: 'How to partner each other',
    brief: 'Romance turns on life direction, values, emotional safety, how each person gives and receives care, and whether their day-to-day rhythms can actually coexist. Shared hobbies matter less than people think. Attachment styles and love languages matter more.',
    dimensions: ['Values and life direction', 'Emotional safety', 'Daily rhythms', 'How you each give care', 'Energy match'],
  },
  platonic: {
    label: 'Family / Friends',
    heading: 'How to be close to each other',
    brief: 'Family and friendship turn on shared interests and activities, compatible energy levels, a similar appetite for contact, and low friction. Life direction and attachment matter much less; whether they would actually enjoy a Saturday together matters much more. This basis covers relatives as well as friends, so do not assume the two of them chose each other — with family the question is not whether they would pick each other but how to get on well given that they are already in each other\'s lives.',
    dimensions: ['Shared interests', 'Energy match', 'Appetite for contact', 'Friction load', 'Outlook and values'],
  },
  professional: {
    label: 'Professional / work',
    heading: 'How to work with each other',
    brief: 'Working together turns on complementary strengths, compatible working rhythms and standards, how each handles disagreement and deadlines, and whether one will quietly carry the other. Warmth is not the point — reliability, candour and dividing the work well are. Say plainly if one of them is the type to over-commit or to go quiet under pressure.',
    dimensions: ['Complementary strengths', 'Standards and follow-through', 'Working rhythms', 'Handling disagreement', 'Load balance'],
  },
};

// "Professional" was one question asked of three quite different situations.
// Two colleagues are solving a different problem from a manager and their
// report, and the manager and the report are not solving the same problem as
// each other either — one is asking how to get good work out of someone
// without losing them, the other how to work for someone without losing their
// footing. Answering all three with "complementary strengths and load balance"
// gave the two thirds of readers who are not peers a report about the wrong
// thing, so the basis splits once professional is chosen.
//
// The direction matters and is not symmetrical: person A is always the one
// who scanned, so `superior` means A manages B and `subordinate` means A
// reports to B.
const WORK_STANCES = {
  colleagues: {
    heading: 'How to work with each other',
    brief: 'You are assessing two peers. Nobody here has authority over anybody, so this turns on complementary strengths, compatible standards and rhythms, how each handles disagreement, and whether one will quietly end up carrying the other.',
    dimensions: ['Complementary strengths', 'Standards and follow-through', 'Working rhythms', 'Handling disagreement', 'Load balance'],
  },
  superior: {
    heading: 'How to manage them',
    brief: 'Person A manages person B. The question is how A gets B\'s best work without losing them: how much direction B needs against how much will grate, how B takes criticism, whether a problem will reach A early or arrive as a finished disaster, and what would make B quietly start looking elsewhere. Write forA as management advice, and forB as what B would ask for if they could say it plainly. Be specific about where B\'s weaknesses will cost A, and equally about where A\'s will cost B — a manager reading only their report\'s faults has learnt nothing.',
    dimensions: ['Briefing and direction', 'How they take feedback', 'Autonomy against oversight', 'Whether problems reach you', 'Keeping them'],
  },
  subordinate: {
    heading: 'How to work for them',
    brief: 'Person A reports to person B. The question is how A works well for B and keeps their footing: how to read what B actually wants as opposed to what B said, how to get a decision out of them, how to raise a problem without it landing badly, how to keep A\'s work visible, and what A will and will not learn under them. Write forA as advice for managing upward, and forB as what a good manager in B\'s position would do. Say plainly if this pairing carries a real risk of A being managed badly — a report who is told everything is fine is worse off than one who was warned.',
    dimensions: ['Reading what they want', 'Getting a decision', 'Raising a problem safely', 'Visibility of your work', 'Room to grow'],
  },
};

/** Normalises whatever arrives into a working relationship we support. */
function resolveStance(stance) {
  const key = String(stance || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(WORK_STANCES, key) ? key : 'colleagues';
}

/** The brief and dimensions for a run, once the basis and stance are known. */
function briefFor(mode, stance) {
  const modeKey = resolveMode(mode);
  if (modeKey !== 'professional') return COMPATIBILITY_MODES[modeKey];
  const chosen = WORK_STANCES[resolveStance(stance)];
  return {
    label: COMPATIBILITY_MODES.professional.label,
    heading: chosen.heading,
    brief: chosen.brief,
    dimensions: chosen.dimensions,
  };
}

// Every claim has to name what in the two cards put it there. The profile side
// has demanded evidence per trait since it was written; this side asserted
// freely, which is how a compatibility report ends up sounding true and
// meaning nothing.
const compatPointList = listOf({
  title: { type: 'string', description: 'A few words.' },
  detail: { type: 'string', description: 'Two or three sentences, concrete and naming both people.' },
  evidence: {
    ...strList,
    description: 'One or two short items naming what in the profiles put this here — a trait score, a value, a stated weakness, an attachment read, a rhythm. Quote the actual phrase or number rather than gesturing at it. Prefer one item per person.',
  },
});

const COMPATIBILITY_SCHEMA = object({
  mode: { type: 'string', enum: Object.keys(COMPATIBILITY_MODES), description: 'Echo back the basis you were asked to assess.' },
  score: { type: 'integer', description: '0-100. This should be consistent with the dimension scores below rather than a separate judgement — roughly their weighted middle, leaning on whichever dimensions matter most for this basis.' },
  band: { type: 'string', description: 'Two or three words, e.g. "Strong fit" or "Hard going".' },
  verdict: { type: 'string', description: 'Three to five sentences giving the honest overall read on the basis you were asked about.' },
  // One number for a whole pairing is unfalsifiable: it cannot show where the
  // fit is strong and where it is thin, and a reader cannot argue with it. The
  // profile side broke the Big Five into five scored traits with evidence
  // apiece for exactly this reason.
  dimensions: listOf({
    name: { type: 'string', description: 'Use the dimension names given in the user turn, in that order, exactly as written.' },
    score: { type: 'integer', description: '0-100 for this dimension alone, on the same scale as the overall score: 50 is two random people.' },
    reading: { type: 'string', description: 'One or two sentences on why this dimension scores where it does. Name both people.' },
    evidence: { ...strList, description: 'One or two short items from the two profiles that put this score here. Quote the actual phrase or number.' },
  }),
  strengths: compatPointList,
  frictions: compatPointList,
  howToPartner: object({
    forA: { ...strList, description: 'Three to five concrete things the FIRST person should do, addressed to them as "you".' },
    forB: { ...strList, description: 'Three to five concrete things the SECOND person should do, addressed to them as "you".' },
    together: { ...strList, description: 'Two to four things they should agree on or do jointly.' },
  }),
  sharedGround: { ...strList, description: 'Three to six things they genuinely have in common.' },
  biggestUpside: { type: 'string', description: 'One or two sentences: the best thing about this pairing.' },
  biggestRisk: { type: 'string', description: 'One or two sentences: the thing most likely to break it.' },
  conversationStarters: { ...strList, description: 'Three to five things they should actually talk about, specific to these two people.' },
  caveats: { type: 'string', description: 'One or two sentences on what this assessment cannot see.' },
});

const COMPATIBILITY_SYSTEM = `You are PsycheAI, assessing how two people would work together. You are given two compact profiles, each previously derived from that person's own Instagram data. Person A is the one who scanned; person B is the one whose code was scanned.

# Answer one question, the one you are asked

The user chooses the basis before you run — romantic, family/friends, or professional — and the user turn names it. Assess **only** that basis. Do not score the others, do not compare against them, and do not hedge by covering all three. A reader who picked "professional" does not want to be told about their romantic prospects.

Weight the evidence for the basis you were given:

- **Romantic** turns on life direction, values, emotional safety, how each person gives and receives care, and whether their day-to-day rhythms can actually coexist. Shared hobbies matter less than people think; attachment and love languages matter more.
- **Family / Friends** turns on shared interests and activities, compatible energy levels, a similar appetite for contact, and low friction. Life direction and attachment matter much less. It covers relatives as well as chosen friends, and the two are not the same problem: people do not pick their family, so where the pairing looks like one, the question is how to get on well given they are already in each other's lives rather than whether they suit each other.
- **Professional / work** turns on complementary strengths, compatible working rhythms and standards, how each handles disagreement and deadlines, and whether one will quietly end up carrying the other. Warmth is not the point — reliability, candour and dividing work well are.

Two people can be a fine friendship and a poor working pair, or the reverse. Judge the basis in front of you on its own terms rather than importing a verdict from another one.

# Who reports to whom

A professional run also names the working relationship, and it changes the question rather than decorating it. Two peers are asking how to divide work and not tread on each other. A manager is asking how to get someone's best work without losing them. Someone's report is asking how to work for them and keep their footing. Answer the one you are given: a manager does not need to be told how to manage upward, and a report cannot act on advice about delegation they have no authority to do.

Person A is always the one who scanned the code, so the direction is stated from A's side and is not symmetrical. Read it carefully — getting it backwards produces a report that is confidently about the wrong person.

Where there is a power difference, stay even-handed. Name what the junior person should do differently *and* what the senior one is getting wrong; a report that only audits whoever has less power is both unfair and useless to the person reading it. Do not write anything that reads as a method for pushing somebody out, for keeping them dependent, or for getting round them — this is for two people working together better, and if a pairing looks bad the honest answer is to say so plainly rather than to supply tactics.

# How to score

0-100, where 50 is two random people. Above 80 is genuinely rare. Do not inflate — a diplomatic 75 for a pair that would struggle is worse than useless, because someone may act on it. Equally, do not manufacture problems for a pair that fits well.

Score the five **dimensions** you are given in the user turn before you settle the overall number, and use their names exactly as written, in the order given. They are chosen for the basis you were asked about, so they are where the answer actually lives. Score each one on the same 0-100 scale and let them disagree with each other — a pair can be strong on values and poor on rhythms, and flattening that into one number is what makes a compatibility report useless. The overall score should then be recognisably the weighted middle of the five, leaning on whichever matter most for this basis, rather than a separate impression you formed first and justified afterwards.

# Show your working

Every strength, every friction and every dimension carries an \`evidence\` field, and it is not decorative. Name what in the two profiles put the claim there — a trait score, a value, a stated weakness, an attachment read, a rhythm phrase — and quote the actual number or wording rather than gesturing at it. "Both score high on agreeableness" is not evidence; "her 77 agreeableness against his 51" is. Prefer one item per person, so it is visible which side of the pair each half of a claim rests on.

If you cannot point at anything supporting a claim, that claim does not belong in the report. This is the difference between a reading and a horoscope.

You are also given a **derived facts** block, computed mechanically from the two cards rather than by a model: exact interest overlap, per-trait gaps, MBTI axis agreement. Treat those numbers as settled and reason from them — do not recompute them, contradict them, or claim an overlap the block does not list. They exist so you can spend your attention on interpretation instead of arithmetic, and so the report cannot quietly invent a shared interest neither person has.

# What to write

Be concrete and name both people. "You are both curious" is filler; "you both keep late hours and neither of you plans ahead, which is fun until someone has to book something" is useful.

The **howToPartner** section is the point of the whole report. Write specific, actionable things — what each person should actually do differently, given who the other one is. Address each list to that person as "you". Not generic relationship advice: advice that would only make sense for these two.

Frictions should be real. Every pair has them. Name them plainly without catastrophising.

Some trait combinations are worth reading rather than just reporting. A wide conscientiousness gap is the most reliable predictor of friction there is, in work and out of it — one person will feel chased and the other will feel let down. Two low-agreeableness profiles argue productively where a mismatched pair has one person conceding every time. Two high-neuroticism profiles amplify each other under stress rather than steadying. High extraversion against low is workable and often complementary, but only if the appetite for contact is compatible, which is a different field from the score.

# Hard limits

Both profiles are inferences from social-media behaviour, not psychometric measurements, and both carry a confidence figure — respect it. If either confidence is low, say plainly in the caveats that this is a conversation starter rather than a finding. Do not present any of this as a prediction about whether a relationship will succeed.`;

// ---------- the user turn ----------
//
// Built here rather than in each provider so the two never drift. The blocks
// are provider-neutral; lib/gemini.js and lib/claude.js each map them onto
// their own content format.

/**
 * The profile request as an ordered list of blocks.
 *
 * One text block now. It used to carry up to twenty of the reader's own
 * photographs, each preceded by a dated caption block so the model knew which
 * era it was looking at. Nothing sends them any more — see the note above
 * COST_CAP in docs/digest.js — so what leaves is the digest and nothing else,
 * which is also what the review dialog's downloadable preview now says.
 *
 * @param {object} digest
 */
// "Instagram", "Instagram and Google", "Instagram, Google and Facebook" — read
// off the digest rather than assumed, so the user turn never names a source the
// reader declined at the review step.
const SOURCE_NAMES = { instagram: 'Instagram', google: 'Google', facebook: 'Facebook' };

function sourcePhrase(digest) {
  const sources = (digest && digest.coverage && digest.coverage.sources) || ['instagram'];
  const names = sources.map(id => SOURCE_NAMES[id] || id);
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// `anchor`, when given, is the summary card the reader already holds — see
// anchorFrom. The paid report is then written to explain it rather than to
// reach conclusions of its own.
function profileBlocks(digest, anchor) {
  const blocks = [{
    type: 'text',
    // Named from coverage.sources rather than asserted, so the opening line
    // cannot claim a source the reader declined — and so a supplemented run
    // does not open by calling itself an Instagram digest.
    text: 'Here is the evidence digest for one person, built from their ' +
      sourcePhrase(digest) + ' data. Analyse it and produce their profile.\n\n' +
      '<evidence>\n' + renderEvidence(digest) + '\n</evidence>',
  }];
  if (anchor) blocks.push(anchorBlock(anchor));
  return blocks;
}

/** Normalises whatever arrives into a mode key we actually support. */
function resolveMode(mode) {
  const key = String(mode || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMPATIBILITY_MODES, key) ? key : 'romantic';
}

// The parts of a comparison that are arithmetic rather than judgement.
//
// Set intersection and subtraction are things a model does slowly, expensively
// and sometimes wrongly — it will miss an exact match, or offer a near-match as
// a shared interest because the two words rhyme. `docs/copy.js` already refuses
// to ask the model twice for something derivable, on the grounds that a second
// answer can disagree with the first. Same reasoning here: compute it, hand it
// over as settled fact, and let the model spend its attention on what the
// numbers mean.
const TRAIT_KEYS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

const normalise = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Case- and punctuation-insensitive intersection, keeping A's spelling. */
function overlap(listA, listB) {
  const seen = new Set((Array.isArray(listB) ? listB : []).map(normalise).filter(Boolean));
  const out = [];
  for (const item of Array.isArray(listA) ? listA : []) {
    if (seen.has(normalise(item)) && !out.includes(item)) out.push(item);
  }
  return out;
}

function derivedFacts(a, b) {
  const nameA = (a && a.name) || 'A';
  const nameB = (b && b.name) || 'B';
  const lines = [];

  const sharedInterests = overlap(a && a.interests, b && b.interests);
  lines.push('Interests in common (exact matches only): ' +
    (sharedInterests.length ? sharedInterests.join(', ') : 'none'));

  const sharedValues = overlap(a && a.values, b && b.values);
  lines.push('Values in common: ' + (sharedValues.length ? sharedValues.join(', ') : 'none'));

  const fiveA = (a && a.bigFive) || {};
  const fiveB = (b && b.bigFive) || {};
  const gaps = TRAIT_KEYS.map(key => {
    const left = Number(fiveA[key]);
    const right = Number(fiveB[key]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    const gap = Math.abs(left - right);
    const shape = gap <= 10 ? 'close' : gap <= 25 ? 'moderate gap' : 'wide gap';
    return '  ' + key + ': ' + nameA + ' ' + left + ', ' + nameB + ' ' + right +
      ' (' + shape + ', ' + gap + ' points)';
  }).filter(Boolean);
  if (gaps.length) lines.push('Big Five, side by side:\n' + gaps.join('\n'));

  // Four letters either match or they do not; there is nothing to interpret in
  // working that out, and plenty to interpret in what it means.
  const typeA = String((a && a.mbti) || '');
  const typeB = String((b && b.mbti) || '');
  if (/^[EI][NS][TF][JP]$/.test(typeA) && /^[EI][NS][TF][JP]$/.test(typeB)) {
    const axes = ['E/I', 'N/S', 'T/F', 'J/P'];
    const same = [];
    const differ = [];
    for (let i = 0; i < 4; i++) {
      (typeA[i] === typeB[i] ? same : differ).push(axes[i] + ' (' + typeA[i] + ' vs ' + typeB[i] + ')');
    }
    lines.push('MBTI ' + typeA + ' vs ' + typeB + ' — shares ' + same.length + ' of 4 axes.' +
      (same.length ? ' Same: ' + same.join(', ') + '.' : '') +
      (differ.length ? ' Differs: ' + differ.join(', ') + '.' : ''));
  }

  const confA = Number(a && a.confidence);
  const confB = Number(b && b.confidence);
  if (Number.isFinite(confA) && Number.isFinite(confB)) {
    lines.push('Profile confidence: ' + nameA + ' ' + confA + '/100, ' + nameB + ' ' + confB +
      '/100. The weaker of the two caps how far this comparison can be trusted.');
  }

  return lines.join('\n');
}

function compatibilityBlocks(a, b, mode, stance) {
  const key = resolveMode(mode);
  const chosen = briefFor(key, stance);
  return [{
    type: 'text',
    text: 'Assess how these two people would work together on a **' + chosen.label +
      '** basis, and on that basis only.\n\n' + chosen.brief + '\n\n' +
      'Score these five dimensions, using these names exactly and in this order:\n' +
      chosen.dimensions.map(d => '  - ' + d).join('\n') + '\n\n' +
      'Set the "mode" field of your answer to "' + key + '".\n\n' +
      '<person_a>\n' + JSON.stringify(a) + '\n</person_a>\n\n' +
      '<person_b>\n' + JSON.stringify(b) + '\n</person_b>\n\n' +
      '<derived_facts>\n' + derivedFacts(a, b) + '\n</derived_facts>',
  }];
}

module.exports = {
  MBTI_TYPES,
  LOVE_LANGUAGES,
  COMPATIBILITY_MODES,
  WORK_STANCES,
  resolveMode,
  resolveStance,
  briefFor,
  profileBlocks,
  freeBlocks,
  renderEvidence,
  EVIDENCE_LISTS,
  anchorFrom,
  ANCHOR_TEXT_MAX,
  compatibilityBlocks,
  derivedFacts,
  PROFILE_SCHEMA,
  PROFILE_SYSTEM,
  FREE_SCHEMA,
  FREE_SYSTEM,
  FREE_CARD_SCHEMA,
  CARD_DERIVED_KEYS,
  withCard,
  FULL_SCHEMA,
  FULL_PINNED_SCHEMA,
  fullSchemaFor,
  FULL_SYSTEM,
  PREMIUM_KEYS,
  REPORT_LAYOUT,
  REPORT_LAYOUTS,
  CHARACTER_CATALOGUE,
  CHARACTER_NAMES,
  CLASSIC_FREE_SYSTEM,
  CLASSIC_FREE_SCHEMA,
  STRUCTURED_FREE_SYSTEM,
  STRUCTURED_FREE_SCHEMA,
  STRUCTURED_DROPS,
  CLASSIC_FULL_SYSTEM,
  CLASSIC_FULL_SCHEMA,
  STRUCTURED_FULL_SYSTEM,
  STRUCTURED_FULL_SCHEMA,
  STRUCTURED_PINNED_FULL_SCHEMA,
  STRUCTURED_KEYS,
  STRUCTURED_ADDON,
  SECTION_KEYS,
  MOTIVATORS,
  PRESSURE_LEVELS,
  CARD_SCHEMA,
  COMPATIBILITY_SCHEMA,
  COMPATIBILITY_SYSTEM,
  PREMIUM_SCHEMA,
  PREMIUM_SYSTEM,
  premiumBlocks,
  WELLNESS_DIMENSIONS,
  // The enum vocabularies, exported so tools/livetest.mjs can check a real
  // model's answers against the lists it was actually given rather than
  // against a second copy of them that could drift.
  WELLNESS_BANDS,
  CONFIDENCE_LEVELS,
  CAREER_HORIZONS,
  deref,
};
