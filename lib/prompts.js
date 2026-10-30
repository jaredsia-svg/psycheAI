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

// The structured layout's characters: a fixed catalogue the model chooses
// from, so every character has artwork of its own. The artwork is an
// original emblem drawn for this app (docs/copy.js, CHARACTER_EMBLEMS) — never
// the studio's character art or logos, which are not ours to ship. Spread
// across temperaments so most readers have a close fit; held to the client's
// list by a check in tools/selftest.mjs.
//
// Balanced between women and men — twelve each, with four who are neither
// (Baymax, The Tin Man, Remy, Pikachu) — so that a temperament has a close
// fit on both sides. The third field is the side: w, m or n. The model judges,
// privately, which side the reader most likely belongs to from how they
// present themselves, chooses from that side or the characters who are
// neither, and from the characters who are neither alone when it cannot tell — so nobody is handed a
// character of the other sex. It never writes that judgement down: see
// CHARACTER_SIDE_RULE below, and the privacy rules, which keep gender out of
// every word of the report.
// Each character holds a temperament no other one does; where two overlapped
// (Doctor Strange and Iron Man, Black Panther and Captain America, Mario and
// Po, Link and Moana, Totoro and Baymax), one was retired. Totoro (October
// 2026) also made the catalogue an even 28, so every sync pairs off.
// Three studio characters gave way to public-domain ones in the same slots
// (21 October 2026): Woody to Dr Watson, Iron Man to Odysseus, Batman to
// Sherlock Holmes. WALL-E gave way to The Tin Man (Baum, 1900) the same day.
// The marketing shows Mulan, Odysseus, Rapunzel, Sherlock Holmes and The Tin
// Man, so no studio's character is in the samples.
const CHARACTER_CATALOGUE = [
  ['Mulan', 'Disney', 'w'], ['Elsa', 'Disney', 'w'], ['Moana', 'Disney', 'w'], ['Simba', 'Disney', 'm'],
  ['Rapunzel', 'Disney', 'w'], ['Judy Hopps', 'Disney', 'w'], ['Nick Wilde', 'Disney', 'm'], ['Baymax', 'Disney', 'n'],
  ['Dr Watson', 'Arthur Conan Doyle', 'm'], ['Buzz Lightyear', 'Pixar', 'm'], ['The Tin Man', 'L. Frank Baum', 'n'], ['Remy', 'Pixar', 'n'],
  ['Joy', 'Pixar', 'w'],
  ['Odysseus', 'Homer', 'm'], ['Captain America', 'Marvel', 'm'], ['Spider-Man', 'Marvel', 'm'], ['Hulk', 'Marvel', 'm'],
  ['Wonder Woman', 'DC', 'w'], ['Sherlock Holmes', 'Arthur Conan Doyle', 'm'],
  ['Pikachu', 'Pokémon', 'n'], ['Princess Peach', 'Nintendo', 'w'],
  ['Shrek', 'DreamWorks', 'm'], ['Po', 'DreamWorks', 'm'], ['Hiccup', 'DreamWorks', 'm'],
  ['Hermione Granger', 'Harry Potter', 'w'], ['Sailor Moon', 'Sailor Moon', 'w'], ['Hello Kitty', 'Sanrio', 'w'],
  ['Kuromi', 'Sanrio', 'w'],
];
const CHARACTER_NAMES = CHARACTER_CATALOGUE.map(([name]) => name);
const CHARACTER_SIDES = {
  women: CHARACTER_CATALOGUE.filter(([, , side]) => side === 'w').map(([name]) => name),
  men: CHARACTER_CATALOGUE.filter(([, , side]) => side === 'm').map(([name]) => name),
  neither: CHARACTER_CATALOGUE.filter(([, , side]) => side === 'n').map(([name]) => name),
};

// Which side of the catalogue a character comes from. The judgement is the
// model's, made privately from how the reader presents themselves, and used
// for this one choice only; nothing it writes may state or hint at it.
// How confidence is scored, one rule for the card and the report (October
// 2026). It was two: a short rule on the card and a strict one in the report
// ("score what you were shown"), so the one call that writes both scored a
// reader 68 where the card alone gave 84. The strict one also scored the
// sample, which is PsycheAI's choice and the same for every reader, rather
// than what the reader brought: Instagram, Google and three WhatsApp chats
// came out under 70. The score now starts from the sources loaded and moves
// with what they show.
const CONFIDENCE_SCORING = '**The score is how well the data the reader gave supports this reading — not how ' +
  'much of it was read.** The digest is a sample drawn the same way for every reader, to be representative: never ' +
  'lower a score because only a fraction of the messages, searches or video titles is in it. What moves the score ' +
  'is what the reader brought and what it shows.\n\n' +
  '- **Start from the sources loaded** (`coverage.sources`; count WhatsApp chats in `whatsapp.chats`). Instagram, ' +
  'Facebook and WhatsApp chats are strong sources, Google a light one, and **above 80 needs at least two strong ' +
  'sources**. Instagram alone, 65–79; with Google, 68–80; with Facebook or WhatsApp chats, 72–86, or 74–88 with ' +
  'Google too; with both Facebook and WhatsApp chats, 76–90. WhatsApp chats with no Instagram: two chats, 58–72; ' +
  'three, 62–78; with Google, 60–74 for two and 64–80 for three; with Facebook, 65–82 for two and 68–86 for three.\n' +
  '- **Within that range**, go higher when the sources agree with one another and the reader writes in their own ' +
  'words across years — captions, comments, messages; lower when most of it is passive (likes, follows, views ' +
  'rather than their own words), when the span is short, or when the sources pull in different directions.\n' +
  '- **Below the range** only for a genuinely thin export: a handful of posts, almost no messages of their own, ' +
  'under a year of activity.\n' +
  '- **Never above 90**: this is a reading of online behaviour, not an assessment.\n' +
  '- **`level`**: high from 75, moderate 60–74, low 40–59, very low under 40.\n\n' +
  'The sample still limits what you may *say*, though not the score: from a sample of messages you have their ' +
  'voice, not every relationship, so do not claim to have read their relationships; and the complete counts and ' +
  'rhythm carry the timing and volume findings whatever the text coverage. `basedOn` is two to four items, each ' +
  'what you saw of what exists — "300 of 9,741 own messages" — so the reader can see what the reading rests on. ' +
  '**Never cite a total as though it were coverage.**';

// Gender is never written (the hard limits), and the one place it slipped
// through was a partner: "she must possess her own passions", "the smartest
// guy in the room". So how to write about a partner, or anyone, is said
// outright, with the words to use instead (October 2026).
const NEUTRAL_PEOPLE_RULE = 'Write about a partner, a date or anyone else without gendered words: "a partner", ' +
  '"the right person", "someone", "they" — never he or she, him or her, himself or herself, guy, girl, man or woman — ' +
  'and address the reader only as "you". This holds in every section, the ones about a partner included.';

const CHARACTER_SIDE_RULE = 'Not every character is open to everyone. First judge, privately, whether this person ' +
  'is most likely a woman or a man, from how they present themselves in their own data — their name, pronouns in a ' +
  'bio, how they write about themselves, how friends address them. A woman gets one of: ' + CHARACTER_SIDES.women.join(', ') +
  '. A man gets one of: ' + CHARACTER_SIDES.men.join(', ') + '. Either may also get one of the characters who are ' +
  'neither: ' + CHARACTER_SIDES.neither.join(', ') + '. If you cannot tell with reasonable confidence, or they present ' +
  'as neither, choose only from those four. Then find the closest temperament among the ones open to them. This judgement chooses the character and nothing else: never state, hint at or explain it anywhere you ' +
  'write — not on the card, not in why they are like the character, not in any section or piece of evidence. ' +
  // 26 October 2026: a character is named alone, never with the studio that owns them.
  'Name the character by name alone, never with the studio, company or franchise behind them (Marvel, Disney, Pixar ' +
  'and the like), in anything you write.';
// The same rule for a character named freely rather than from the catalogue.
const CHARACTER_GENDER_RULE = 'Choose a character of the sex this person most likely is, or a non-human one, judged ' +
  'privately from how they present themselves (name, pronouns, how they and their friends write); if unsure, only ' +
  'a non-human one. Never write or hint at this judgement.';
// No longer offered to the model, but still drawn — scene and emblem — on a
// card written while they were.
const RETIRED_CHARACTERS = [
  ['Black Panther', 'Marvel'], ['Doctor Strange', 'Marvel'], ['Mario', 'Nintendo'], ['Link', 'Nintendo'],
  ['Totoro', 'Studio Ghibli'], ['Woody', 'Pixar'], ['Iron Man', 'Marvel'], ['Batman', 'DC'],
  ['WALL-E', 'Pixar'],
];

// Schwartz's ten basic values, in their order around his circle, which is the
// order the chart draws them in: neighbours are compatible, opposites trade
// off. Up here because the free card names its top three as well.
const MOTIVATORS = ['self-direction', 'stimulation', 'hedonism', 'achievement', 'power',
  'security', 'conformity', 'tradition', 'benevolence', 'universalism'];

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
// This is the part that gets compressed into the share link, so every field is
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
  headline: { type: 'string', description: 'One short phrase capturing who they are at their best, drawn from the character line and the executive summary. It heads the card they share, so positive, with no negative connotation and nothing about romance or dating. Under 60 characters.' },
  mbti: { type: 'string', enum: MBTI_TYPES },
  bigFive: object({
    openness: { type: 'integer' },
    conscientiousness: { type: 'integer' },
    extraversion: { type: 'integer' },
    agreeableness: { type: 'integer' },
    neuroticism: { type: 'integer' },
  }),
  interests: { ...strList, description: 'Up to 4 short interest labels, two or three words each, each under 34 characters.' },
  values: { ...strList, description: 'Up to 3 short labels, values and any belief together as one Values & Beliefs list, each under 34 characters.' },
  relationshipStrengths: { ...strList, description: 'Up to 2 short phrases on what they bring to friends and the people close to them, each under 34 characters. Nothing about romance or dating.' },
  relationshipWeaknesses: { ...strList, description: 'Up to 2 short phrases on where it gets hard with friends and the people close to them, each under 34 characters. Real weaknesses, not humblebrags. Nothing about romance or dating.' },
  careerStrengths: { ...strList, description: 'Up to 2 short phrases, each under 34 characters.' },
  careerWeaknesses: { ...strList, description: 'Up to 2 short phrases on what holds them back at work, each under 34 characters. Real costs, not humblebrags — the same costs the full report names under what holds you back.' },
  // No attachment style on the card: it is the most intimate line in the
  // profile, the card travels to anyone who opens its owner's link, and the
  // friendship read does not turn on it. The paid report keeps its own.
  conflictStyle: { type: 'string', description: 'How they handle disagreement, as a leaning plus "(tentative)": whether they raise it, smooth it over, go quiet or come in hot, and in what form — "Raises it calmly, in writing (tentative)", "Goes quiet, then circles back (tentative)". Read it from how they respond when a thread or a comment turns tense, how they disagree in public, and how they handle a gap after one. Under 48 characters.' },
  loveReceiving: { ...strList, description: 'Up to 2, strongest first, each as "Quality time (primary)", under 34 characters. How they like care shown, by friends as much as anyone; do not leave them empty when the profile has them.' },
  loveGiving: { ...strList, description: 'Just the strongest, as "Acts of service (primary)", under 34 characters. Often different from how they want to receive.' },
  rhythm: { type: 'string', description: 'Their daily and social rhythm in a few words. Under 48 characters.' },
  energy: { type: 'string', description: 'How outward-facing they are and how they keep in touch: broadcaster, participant or lurker; a wide circle or a few close ties; and their contact style — who starts the conversations, how quickly and how long they reply. "Participant; a few close ties; starts most chats". Under 70 characters.' },
  workStyle: { type: 'string', description: 'How they actually work — standards, follow-through, pace. Under 75 characters.' },
  confidence: { type: 'integer', description: '0-100, how well the data supports this profile.' },
});

// ---------- profile analysis ----------

// The roast: written by the free call only (FREE_SCHEMA's last field), for
// My Psyche, where secretRoastHtml() in docs/app.js keeps it behind a
// click-to-reveal cover. The paid call no longer writes one; the browser
// carries the free roast into the full report (overlayCard), and the PDF
// prints it from there.
const ROAST_SCHEMA = object({
    harsh: { type: 'string', description: 'Two or three paragraphs. Roast them — unless the evidence clearly shows them struggling (recurring sadness or low mood, grief, withdrawal, sleeplessness, being hard on themselves, dread or panic): then one short paragraph of gentle, affectionate teasing about small, harmless habits, never the struggle itself. The least charitable reading of this person that the evidence still fully supports — the version a sharp friend would give after the second drink, with the softening removed, and with the wit left in: dry, well-aimed, quotable. Hunt specifically for the gaps between what they said and what they did: plans announced and never closed out, things saved and never acted on, a resolution posted every January and no evidence of it by March. Hunt for what they take and do not give back: friends whose posts they never turn up for while their own get a crowd, people who write them long comments and get an emoji in return, the accounts they read constantly and have never once spoken to. Name whatever else the data plainly shows them doing badly. Attack patterns and choices, never the person: nothing about their appearance, body, intelligence, worth or anything they cannot change. It must stay evidence-bound, exactly like every other section — cite the actual captions, counts and rhythms, because a roast lands on the detail that proves you were paying attention. Unkind and true, never cruel and unfounded. Every hard line must name a contradiction you could state plainly — what was claimed, and what behaviour actually costs it — rather than joining two unrelated true facts with a \'yet\' and letting the connective imply a hypocrisy neither supports. If the data does not support a hard read, say so and write less; an invented insult is worse than a short section, and a hollow contradiction is worse than both because it reads as though you were not thinking.' },
    advice: { type: 'string', description: 'Two or three paragraphs of the advice a friend would give if they were not managing your feelings. Draw on the whole digest — relationships, work, values, what they avoid, their rhythm and behaviour — not just the single most obvious pattern. Plain, direct, and specific to them. No self-help register, no affirmations, no "be kind to yourself". Say the thing that is actually hard to hear and then say what to do about it.' },
});

// The ledger each letter is scored from (lib/mbtiScore.js): every piece of
// evidence for either letter, tagged with a rubric row. Written first and
// never printed; the model weighs it into the letter and its strength, and
// lib/mbtiScore.js checks the answer against it.
const LEDGER = { ...listOf({
  row: { type: 'string', description: 'The id of the rubric row this evidence fits, exactly as the rubric for this axis spells it.' },
  pointsTo: { type: 'string', description: 'The letter this piece points to (one of this axis\'s two letters), or "neutral" for a row that counts neither way.' },
  note: { type: 'string', description: 'The evidence itself, in a short clause under about 15 words, with its count or their quoted words; with neither it counts as weak. On J/P, open it with its area: `work and money: `, `travel: `, `plans with friends: ` or `day to day: `.' },
}), description: 'Every piece of evidence you found for EITHER letter on this axis, each tagged with its rubric row — the ones against the letter you expect as carefully as the ones for it. One entry per row and letter (on J/P, per row, letter and area). Never a row the code computes (sustained conversations and their share).' };

const PROFILE_SCHEMA = object({
  confidence: object({
    score: { type: 'integer', description: '0-100, for how well the data the reader gave supports this profile, starting from the sources they loaded — not lowered for how much of it was sampled. See the Confidence section of the system prompt.' },
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
  // Written in this order (October 2026): each letter's case before the letter,
  // and the type after the four letters that spell it, so the type follows the
  // evidence rather than the evidence following a type chosen first. And MBTI
  // before the Big Five: the letters carry the paragraphs of evidence, so the
  // scores that share an axis are read off those cases, E/I's above all.
  mbti: object({
    letters: listOf({
      axis: { type: 'string', description: 'One of: E/I, N/S, T/F, J/P.' },
      ledger: LEDGER,
      why: { type: 'string', description: 'Two or three sentences, one paragraph, written together with the `evidence` list that follows and printed above it, never repeating it. The case the ledger makes for this letter in plain words, then the pieces on the other side, at their real weight and with their counts, and what they do and do not overturn. Where the ledger runs one way, say so plainly instead of manufacturing a doubt. It argues the letter in `choice` and nothing else: never says the lean goes the other way. Never argues from anything the prompt\'s never-counted list keeps out of a ledger.' },
      evidence: { ...strList, description: 'Three or four of the ledger\'s strongest pieces for this letter, printed as a list under the paragraph. Each a short clause, under about 15 words, from a different part of the digest and none used for another letter; point at the behaviour, not the conclusion ("31 of 50 captions name a place, price or model", not "detail-oriented"). Fewer only when the data is genuinely thin: then say so in `why`. The pieces on the other side go in `why`, not here. On E/I this is the breadth: the sustained count (with the total spoken in beside it), plans proposed and people gathered, circles they move between, their own words about their energy.' },
      choice: { type: 'string', description: 'The letter you conclude, weighing the ledger (the rubric\'s weights are a guide; you decide). The `why` above must argue this same letter.' },
      strength: { type: 'string', enum: ['slight', 'moderate', 'clear'], description: 'How far the weighed evidence leans: `clear` where the other side has little to offer, `moderate` where this side is clearly ahead on several solid pieces, otherwise `slight`; `slight` when their own words put them on both sides. Your judgement, guided by the rubric.' },
      inPractice: { type: 'string', description: 'One sentence on what this letter *costs or buys them going forward* — the consequence, not a second telling of the evidence. `why` above is backward-looking: it argues from behaviour that already happened. This is the only forward-looking line on the axis, and it is the reason a reader who agrees with the letter should care. So it must say something `why` did not: what this makes easy, what it makes expensive, where it will cost them next. If it could be deleted without losing anything a reader could act on, it was a restatement and has failed. Concrete, not textbook.' },
    }),
    type: { type: 'string', enum: MBTI_TYPES, description: 'The type the four letters above spell, or Uncertain.' },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
    nickname: { type: 'string', description: 'The common name for this type, e.g. "The Advocate". Empty string if the type is Uncertain.' },
    caveat: { type: 'string', description: 'One or two sentences on how much weight to put on this, including that MBTI is popular rather than validated.' },
  }),
  bigFive: object({
    openness: traitSchema,
    conscientiousness: traitSchema,
    extraversion: traitSchema,
    agreeableness: traitSchema,
    neuroticism: traitSchema,
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

  card: CARD_SCHEMA,
});

// What the reader's data is called in anything they read. "The export
// reveals you are a …" read as a file talking about them; the prompts call it
// an export because that is what it is to the model, and the model repeated
// it. readerText in server.js is the backstop.
const DATA_WORDS = 'In anything the reader reads, never call their data "the export", "your export", "the archive" or "the download": say "your data", or name the source ("your Instagram data", "your WhatsApp chats", "your searches").';

// Conduct the data may show — infidelity, sexual interest, harm to others —
// that no card, roast or report is the place to expose, judge or joke about.
// A like is not an affair, a message is not a conviction, and a reader's
// screen or PDF can be seen by the very partner it would be about.
// The card's version, with the roast; the paid prompts never mention one.
const CONDUCT_RULE = 'Nothing sexual and nothing about infidelity, roast included: not what posts or people they look at, flirting, affairs or a partner who may not know. Never accuse: no "cheater", "abuser", "predator", "harasser" or word for a crime. Never quote a message that threatens or pressures someone. Harm to others is never a joke: where their messages show controlling, threatening or pressuring behaviour, the roast leaves it alone, and the advice may say, without labels, that how they treat people when angry or turned down is worth taking seriously, and that someone qualified could help. Where posts and private activity pull apart, note it once, neutrally, as one possible reading, never a verdict: "Your posts put family first; your searches and messages show privacy questions and contact outside that circle." No spy, double-life or cover-story words. Advice on it invites self-reflection, never orders or warns. Never on the card.';
const CONDUCT_RULE_REPORT = 'Nothing sexual and nothing about infidelity: not what posts or people they look at, flirting, affairs or a partner who may not know; at most neutral words such as "a lot of late-night scrolling". Never accuse: no "cheater", "abuser", "predator", "harasser" or word for a crime, and never suggest one. Never quote a message that threatens or pressures someone. Where their own messages show controlling, threatening or pressuring behaviour toward someone, never make light of it: say plainly, without labels, that how they treat people when angry or turned down is worth taking seriously, and that talking to someone qualified would help. Where posts and private activity pull apart, note it once, neutrally, as one possible reading, never a verdict: "Your posts put family first; your searches and messages show privacy questions and contact outside that circle." No spy, double-life or cover-story words. Advice on it invites self-reflection, never orders or warns.';

// Who a caption was written for (late October 2026). \`profile.account\` is
// read from the export's "Private Account" field and is absent when it does
// not say. A private account under 1,000 followers writes for a circle, so
// its captions sit close to messages; a public account's posts are curated
// for an audience. Shared by the card's prompt and the report's.
const ACCOUNT_AUDIENCE_RULE = '**Who the captions were written for.** \`profile.account\` says whether the account is \`private\` or \`public\`, ' +
  'and \`counts.followers\` how many can see it. **A private account with fewer than 1,000 followers** writes for a circle of people ' +
  'the reader let in: read its captions as close to their messages in candour, unguarded and written to people who know them, and ' +
  'well above a public post in what they reveal. **A public account, or a private one with 1,000 followers or more,** writes for an ' +
  'audience: its captions are curated and partly performative, how the reader wants to be seen, so weigh them as self-presentation ' +
  'and lean on messages, searches and rhythm for what lies under it. Where \`profile.account\` is absent, the export did not say: ' +
  'assume nothing either way.';

const mbtiScore = require('./mbtiScore');

// How many people someone keeps up with, as one rule for every field —
// signature patterns, sections and the card as much as the MBTI ledger (a
// pattern called "The generous networker" once cited "378 active direct
// message conversations over the lifetime of your account", October 2026).
// A reader may start from WhatsApp chats alone (October 2026): three they
// picked, and nothing public. Said wherever the prompts otherwise assume an
// Instagram account behind the digest.
const CHATS_ONLY_RULE = '**When `coverage.sources` has no `instagram`**, the reader loaded WhatsApp chats instead ' +
  '(sometimes with Google or Facebook beside them). There are no captions, posts, likes, follows, Instagram DMs or ' +
  'activity histograms: never mention them, never read their absence as evidence, and never describe how the reader ' +
  'posts or their public life. Read everything from how they write to these few people — care, humour, plans, how ' +
  'they handle a tense moment, what they keep coming back to — and keep interests and values to what the chats ' +
  'actually show. The chats are a handful the reader chose, usually their closest ties, so they show how deep those ' +
  'ties run and never how many people the reader seeks out: keep extraversion near the middle and the E/I letter ' +
  'slight unless their own words say otherwise. How many chats there are is what PsycheAI asked for, not a choice ' +
  'that says anything: never say the reader keeps to a few circles, groups or people, or does not broaden their ' +
  'network, and never cite the number of chats as evidence of anything.';

// TikTok and a journal, optional sources since 27 October 2026.
const EXTRA_SOURCES_RULE = "**\`tiktok\` and \`journal\`**, when listed, were added by the reader. TikTok\'s watched, " +
  "liked and shared counts are links only: say how much they watch, never what. A journal is private writing for " +
  "themselves: read how they think, quote it gently, never read a hard entry as a diagnosis. Either, with the " +
  "reader\'s own words in it, scores as a strong source, as Facebook does; TikTok with only counts and searches is light.";

const CONVERSATIONS_RULE = '**Breadth is sustained conversations, wherever you cite it.** How many conversations they ever wrote in (\`activeThreads\`, or any lifetime total of conversations, contacts, friends or followers) is never evidence of how many people they keep up with, connect or network with — not in a pattern, a section, the card or a ledger. One reply counts the same as years of talk there. The number that measures it is the conversations with 50 or more of their own messages over the last five years (\`engagedThreads.last5Years.atLeast50\`, Instagram and Messenger together); cite that, with how many they wrote in over the same years beside it if it helps. And never say they take part in group chats unless the counts show one: \`activeGroupThreads\` above 0, or a WhatsApp chat whose \`kind\` is a group. **In a group chat, who starts a conversation is shared among its \`members\`:** the reader\'s fair share is about one in \`members\`, so judge \`conversationsStartedByUser\` against that, and never read "others open most exchanges" in a group as a trait. Only a one-to-one chat shows who reaches out first.';


// The MBTI method (October 2026), shared word for word by the report prompt
// and the card prompt: the model writes a ledger per axis against the rubric
// in lib/mbtiScore.js, and that file adds it up. The prose it replaces (some
// 9,000 characters of E/I, N/S and T/F corrections) is kept as the rubric's
// rows and the never-counted list below.
const MBTI_LEDGER_RULES = `The four letters, their strength and the extraversion score are not picked by impression: on an axis where the evidence runs both ways, an impression flips between two readings of the same data. So for each axis you write a \`ledger\` first — every piece of evidence you found for **either** letter, each tagged with a row of the rubric below, the letter it points to, and a short note of what shows it, counted and quoted where the data allows. **The rubric is a guide, not a rule: you decide.** Its weights (strong about 3, medium about 2, weak about 1) say how much a typical piece of that kind is worth; weigh each piece on its own merits — a vivid, repeated or recent showing counts for more than its row suggests, a faint or one-off one for less — and settle the letter, its \`strength\` and the extraversion score from the whole picture. As a rough guide, \`moderate\` is one side clearly ahead on several solid pieces, \`clear\` is the other side having little to offer, and an axis where their own words put them on both sides (mixed, an ambivert) is \`slight\`. Then **every line you write about the axis argues the letter you chose**: never call the lean the other way in \`why\`, the evidence, a trait reading or the summary. Your work is finding the evidence and weighing it honestly, not arguing for a letter decided first:

- **Search for the other letter as hard as for the one you expect.** A ledger with one side, where the digest holds the other, is the error this exists to prevent.
- **One entry per row and letter**: the strongest instance, with its count ("plans proposed in 14 conversations"). Repeating a row adds nothing, and one behaviour goes under one row only. J/P is the exception: one entry per row, letter and area (below).
- **Counted or quoted, or weak.** Every note gives a count from the digest ("bookings made weeks ahead in 6 chats", "4 of 20 searches") or quotes their own words. A note with neither ("often", "occasionally", "tracks…") is an impression, and impressions come and go between readings: it counts as weak whatever its row, and impressions alone never make a letter more than \`slight\`.
- **Only what the digest shows.** Where you are unsure whether a piece fits a row, leave it out.
- **Never the computed rows.** How many conversations carry real exchange over the last five years (\`engagedThreads.last5Years\`, Instagram and Messenger together) and what share of the conversations they wrote in that is are counted by the code from the digest; do not enter them. Where they count, a note after the evidence lists them with a suggested weight: weigh them with the rest. You may cite them in what you write.

${mbtiScore.rubricText()}

**Never in a ledger, on any axis:**
- **Volume.** Messages sent, comments written, posts published, accounts followed. Extraverts and introverts both compose a great deal of contact on a phone; how much says nothing about whether company charges or drains them.
- **Totals that include what they never took part in.** \`threads\` (it counts message requests and groups they never spoke in), Messenger's thread count, friends and followers. \`activeThreads\` counts every conversation they ever wrote in, one reply included: reach over years, never the people they keep up with. Null means unknown, not zero.
- **What happens inside one chat**: how fast they reply, how many messages. That is about the tie, not breadth. Who starts the conversations is the one exception, and only as the weak \`initiates\` row. WhatsApp chats are the up to three the reader hand-picked, their closest: their volume is never evidence on E/I, and never set against \`activeThreads\`.
- **How and when they write**: message or caption length, a late-night rhythm, liking far more than posting, posting in bursts (almost everyone posts when something happens, so bursts are not P and steady posting is not J).
- **The platform's genre.** Instagram is a camera, so concrete detail in a caption is everyone's, not S. A search box is for errands, so a search history that is mostly practical (Google's \`searchShapes\`) is everyone's too, not S. The platform rewards warmth and suppresses criticism, so kind comments are everyone's, not F — which is why a verdict made in public anyway counts towards T. A topic is not a thinking style: what they follow says nothing on N/S; how they engage with it decides.
- **Group chats**, busy or empty. Whether someone group-chats on these apps is a habit of the app, not of the person.
- **A blank.** No close-friends list, no saved collections, no criticism in public, no bio. Most people never use these here, so a zero is the ordinary case, not the low end of a scale. A missing behaviour is evidence only where you would have expected to see it.

Where \`coverage.directMessagesIncluded\` is false, or they barely use direct messages, messaging is not where their social life happens: the code counts no conversation rows, breadth rests on what else the digest shows, and E/I usually lands near the middle. **J/P is read by area.** Planning hard in one part of life and loosely in another is common, so look at four areas: **work and money**, **travel**, **plans with friends** and **day to day**. For each area the digest shows, enter its strongest piece for each letter, opening the note with the area (\`travel: flights booked 6 weeks ahead in 3 chats\`); a row may repeat across areas, never inside one. An area the digest is silent on is left out, not counted for either side. Then read the areas: where every area shown leans the same way, the letter can be \`moderate\` or \`clear\`; where they split (planning hard in some and loose in others), the axis is \`slight\`, towards the side of the areas that carry most of their time, money and effort in the digest. Own words about planning outweigh any one area.

**The Big Five traits that share an axis follow it.** The extraversion score goes with the E/I letter and its strength — **E** about 51 to 59 at \`slight\`, 60 to 69 at \`moderate\`, 70 to 85 at \`clear\`, mirrored below 50 for **I** — so an **I** never scores above 50 and an **E** never below, and the trait's reading agrees with the letter. Openness reads off N/S, agreeableness off T/F and conscientiousness off J/P the same way, without a threshold. Most people sit near the middle on most traits; keep the extremes for extreme evidence.`;

const PROFILE_SYSTEM = `You are PsycheAI, an analyst who reads a person's Instagram data export and writes them an honest, specific, useful portrait.

# What you are given

A structured digest of one person's Instagram export: their bio and profile, counts of their activity, when they are active (hour-of-day and day-of-week histograms, posting regularity over time), a sample of their captions and the comments they wrote, the accounts they follow, the topics and ad-interests Instagram itself has inferred about them, and — unless they opted out — aggregate statistics about their direct messages plus a sample of their own messages — some opening with «them: …», the message they were answering, shortened and anonymised, which is context and never their words.

**Check \`coverage.sources\` before you write anything.** It lists which exports this digest was actually built from. Instagram is there unless the reader loaded WhatsApp chats instead. ${CHATS_ONLY_RULE} \`google\`, \`facebook\`, \`tiktok\`, \`journal\` and \`whatsapp\` are there only when the reader chose to add them, and each may be partly redacted on top of that — a reader can untick any single row. ${EXTRA_SOURCES_RULE} Never refer to a source that is not listed, and never assume a field exists because it usually does.


When \`google\` is present it holds a Google Takeout "My Activity" export: the channels they watch most on YouTube with counts and a sample of video titles, their most repeated YouTube and Google searches, and how much they browse in Chrome as two counts. There is no list of sites and no sample of what they asked Gemini; both were withheld, so do not reason about either, and do not read their absence as evidence of anything. When \`facebook\` is present it holds a sample of their Facebook posts and comments, a sample of their friends list, and — unless they opted out — a sample of their own Messenger messages, tagged \`[m1]\`… by conversation. When \`whatsapp\` is present it holds counts and timings for up to three WhatsApp chats and a sample of the user's own messages in them, tagged \`[c1]\`–\`[c3]\` by chat.

**These are the unperformed half of a life, and that is exactly why they are useful.** Instagram is what someone chose to publish; a search box is where they go when nobody is watching. Treat the two as different kinds of evidence rather than more of the same, and say so where they disagree — a person whose feed is all discipline and whose searches are all shortcuts is a more interesting read than either half alone.

**And they carry limits of their own.** Weight every item of this below a caption:

- **Watch history is not a statement of taste.** It contains autoplay, things opened once by accident, background noise, children, and other people using the same account. A single video means nothing at all. Only a channel someone returns to repeatedly is evidence, which is why you are given counts rather than a list.
- **Browsing is mostly work and errands.** You are given website names only — never the page, the address, the query or the time — because the rest is surveillance rather than signal. A domain that appears constantly may be their job, not an interest.
- **Searches are questions, not beliefs.** Someone searching a symptom, a religion or a political term is asking, not declaring. This bears especially on the hard limits below: a search is never evidence of a health condition, an orientation or an affiliation.

# How to read it

## When, not just whether

**Every sampled caption is prefixed with the year it was written** — \`[2019] finally ran the whole thing without stopping\`. Comments and messages are dated the same way. Read those years; they are the difference between describing a person and describing a person's archive.

\`samples.likedPostCaptions\` is the one list here **written by other people**. These are captions on posts the reader liked — their taste, not their voice. Never quote one back as something they wrote, never read their register or their vocabulary out of it, and never let it into a judgement about how they express themselves. What it is good for is what they reach for: the subjects, the humour, the causes, the accounts. It is a handful from the last twelve months, so it is evidence about now rather than about the archive; \`samples.likedPostHashtags\` is the breadth of the same year — the hashtags on every post they liked, ranked by how many posts carried each.

\`instagramSearches\` (what they searched for on Instagram, by how often; searches for people are left out) and \`storyLikedAccounts\` (whose stories they like most) are attention and taste too, not their voice: read interests and curiosity from them, never how they think or talk.

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

${ACCOUNT_AUDIENCE_RULE}

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

Both of those fields read \`PsycheUser\`. The reader's handle and their name were substituted before this reached you, everywhere they appeared — the profile, their captions, their comments, their messages. Five other markers work the same way: \`PsycheEmail\` stands where an email address was, \`PsychePhone\` where a phone number was, \`PsycheNumber\` where an identity, card, bank or postal number was, \`PsycheSecret\` where a password, login code, key or username was, and \`PsycheAddress\` where a street address was, whoever they belonged to. Dates are given to the month, not the day.

These are coined words that appear in no real export. Treat every one of them as a blank: never quote one back, never treat it as something the reader chose or wrote, and draw no conclusion from it. A caption reading "PsycheUser rice" is a substitution that landed on an ordinary word, not a person writing strangely. Where a marker appears, the fact worth using is the one around it — "emailed PsycheEmail about the invoice" is evidence that they chase invoices, and no evidence at all about an address.

Everybody else's @handle has been replaced by a numbered marker — \`[P1]\`, \`[P2]\` — the same number for the same person throughout, which keeps exactly the distinction this section turns on: \`PsycheUser\` is the account holder, and every \`[P…]\` or \`[N…]\` (a name) is another person. The ranked account lists keep real account names.

Two worked examples of the failure:

- *"Ex-banker turned startup coach [P1] walking a room of engineers through his next app"* — [P1] is the ex-banker, the coach and the founder. The reader is the person who was in the room and wrote it down. Nothing here says the reader codes, founds companies or coaches anyone.
- *"A 1987 roadster, maybe the last one left in the city, from the collection of [P2]"* — the caption states outright whose car it is. The reader does not own it and is not a collector.

This cuts both ways, so do not overcorrect into ignoring them. A caption about somebody else is **rich evidence about its author** — just about different things:

- **Who they are around**, and what kind of rooms they are in. Somebody photographing founders at a demo night and rare cars at a meet moves through those worlds, whatever they do for a living.
- **What they notice and admire.** The detail they bother to get right — a model year, a specific engine variant, whose startup it is — is their attention, and getting it right takes knowing something.
- **How they write about other people.** Generous, specific, name-checking, credit-giving; or cutting; or absent. That is character evidence of a kind the reader cannot fake, and it is often the best thing in an export.
- **Documenting rather than starring.** An account largely about other people is itself a finding — a connector, an observer, the one holding the camera — and worth saying plainly, because it is usually invisible to the person themselves.

The same rule governs **comments**, and more strictly: a comment was written on somebody else's post, so its subject is nearly always that other person. "Congratulations on the new place!" is evidence that they show up warmly for people, not that they moved house.

When a sentence genuinely is about the reader — first person, or their own name, or no other subject in it — read it exactly as strongly as before. And where you cannot tell, say what the caption shows them *doing* (being there, noticing, writing it up) rather than what it might make them, since the first is always true and the second may not be.

## MBTI: a ledger, added up by the code

${MBTI_LEDGER_RULES}

The digest's \`coverage.sampling\` field tells you what fraction of each source you are actually seeing — see **Confidence** at the end of this prompt, which is where that reasoning belongs.

# What to write

Be specific. "You are drawn to the outdoors" is worthless; "your posting spikes on Saturday mornings and half your captions mention a trail, a distance, or a summit" is worth reading. Quote or paraphrase actual evidence.

Be honest about uncertainty, including where it makes the profile less flattering or less definite. If the export is thin, say so in the confidence rationale and hedge the rest accordingly. Never invent evidence. If a section has little support, write less rather than padding.

## Confidence — how well what they gave supports the reading

${CONFIDENCE_SCORING}

To read the evidence well, know what each part of the digest actually is:

- **Complete**: \`counts\`, and the \`rhythm\` histograms — hour of day, day of week, month by month. Every record went into these, so they support a confident read on their own.
- **Truncated**: every ranked list — \`topGoogleSearches\`, \`topChannels\`, \`instagramTopics\`, \`mostLikedAccounts\` and the rest. These are the top N of however many distinct entries there were, and \`coverage.sampling\` gives you both numbers. The head of a long tail tells you about somebody's strongest habits and almost nothing about the range of them.
- **Sampled**: all free text — captions, comments, messages, video titles. \`coverage.sampling\` says how many of how many. Messages in particular are a deliberately small, structured draw, and the structure changes what it can support. They come from the conversations the user writes in most, each given a small share and the rest in proportion to volume, none over a fifth of the sample (WhatsApp: each of up to three chats between a quarter and two fifths), and no conversation past a fixed length in characters, so no one relationship dominates; within a conversation they are spread across its whole span and across lengths — about half substantial, two fifths ordinary, a tenth short and revealing — with openers, apologies, feelings and questions preferred. Pasted and forwarded text is left out; a long message shows its opening and its end with " … " between. Every line sits under a tag naming which conversation it belongs to — \`[t1]\`… for Instagram, \`[m1]\`… for Messenger, \`[c1]\`–\`[c3]\` for WhatsApp — ranked by volume, \`t1\` the one they use most. The tags identify nobody. " / " joins lines sent in one quick burst. A line that opens «them: …» quotes, shortened and anonymised, the message it was answering: read the reply against it — whether they reassure, deflect, joke, apologise, match the other's warmth — but never attribute the quoted words to the user, never quote them back in the report, and never describe the other person from them.

Read them anyway, because they are the most useful thing in the sample. **How somebody writes to one person versus another is a finding**; a difference in warmth, length or effort across tags is evidence about them, not noise. Two cautions that follow from the shape: the fifth-of-the-sample cap means \`t1\` may be far larger in their life than it looks here, so do not read the proportions as a measure of how close anyone is; and the sample says nothing at all about the hundreds of conversations *below* the top ten — for reach, read \`activeThreads\` and \`threads\`, never the tag count.

Write in second person, warm but not sycophantic. This person is going to read it. Tell them things they might not already know about themselves, including things that are unflattering but fair. Do not moralise.

## Plain words, short sentences

Write the way a perceptive friend talks, not the way a brochure does. Short sentences — most under twenty-five words. Ordinary words over impressive ones: "you like to decide for yourself", not "your motivational architecture is anchored in intellectual sovereignty". **Do not use these words at all:** profound, remarkable, extraordinary, exceptional, formidable, unshakeable, relentless, voracious, insatiable, architecture, ecosystem, synergy, tapestry, journey, testament, navigate, leverage, curate, harness, unwavering, deeply rooted, truly. An adjective has to carry information the noun does not; if it only adds volume, cut it.

**British spelling throughout** — behaviour, analyse, organise, recognise, colour, favour, centre, programme — matching the rest of the app. **Sentence case for every name and title you write** — pattern names, interest names, values, headlines: "The quiet organiser", never "The Quiet Organiser". A value or a belief is a short phrase with no full stop.

## What never appears in the report

The reader has never seen the digest, so nothing from its plumbing belongs in what they read:

- **Conversation tags.** Messages arrive tagged \`[t1]\`–\`[t10]\`, \`[m1]\`… or \`[c1]\`–\`[c3]\`. Never write a tag, a thread number or "thread t1" anywhere — say "the conversation you write in most", "a close friend", "one of your closest conversations".
- **Field names and digest measures.** No "regularity score", "activeThreads", "coverage", "digest" or "sample". Translate every measure into behaviour (see Numbers below).
- **How much was sampled**, outside the confidence fields. "180 sampled messages" belongs in \`confidence\` and nowhere else; elsewhere, just say what the messages show.
- **"Neuroticism".** In prose it is always "emotional sensitivity".
- **"We".** The report speaks to the reader as "you" and never about itself as "we" — "an anxious leaning was considered and set aside", not "we considered".

## Each piece of evidence: once in a section, twice at most in the report

A few behaviours here are load-bearing for half the report: one run of deadline posts is honest evidence for conscientiousness, for J, for the career read and for the character. Every section is told to cite evidence and none knows what the others used, so the same finding arrives four times in full and the report reads far longer than it is without containing more. A real report cited the same count of conversations under the E letter, under extraversion and under social connection, and the same late-night hours under two wellbeing dimensions side by side.

A piece of evidence is one fact from the digest — a count, a proportion, a habit, a run of posts — however it is worded. Two hard limits, and the evidence lists count towards both, as does every \`why\`, \`line\` and \`detail\`:

- **Once inside a section.** A section is everything under one heading: the four MBTI letters together, the five Big Five traits together, the ten motivators, the interests, the wellbeing dimensions, relationships with attachment and the partner read, How you work, the plan. A fact used for one letter is not used for another; a behaviour cited for one trait does not appear in a sibling trait's \`why\` or evidence list. Where one behaviour genuinely bears on two of them, give it to the one it bears on most and find different evidence for the other — and if there is none, that thinness is the honest finding: hedge that result rather than borrowing.
- **Twice at most in the whole report**, the premium sections at the end included: once in full, where it matters most — count, proportion, span — and at most once more, as a short back-reference in a clause ("the same late-night hours behind your cognitive load") that spends its words on what is new. Never a third time. The signature patterns' evidence counts as the first use, so a section drawing on a pattern names the pattern rather than re-quoting its numbers.

**Where the common evidence belongs**, so two sections do not both reach for it first: breadth of contact (distinct people, conversations they actually joined, who they engage with most) is the extraversion trait's, and social connection points back at it and spends its words on reciprocity and change over time; the hour-of-day and weekday shape is rhythm and activity's, and cognitive load points back at it; how they plan (bookings ahead, lists, deadlines, plans changed) is the J/P letter's, and the month-by-month posting rhythm is rhythm and activity's; who starts conversations and how fast they reply inside close chats is attachment's, while plans proposed and conversations started across many people are the extraversion trait's; searches and watch history are the interests'. A section further down that needs one of these names it in a clause.

What stays new is the *reading* — what that behaviour means for this particular question. A back-reference is not a licence to assert: a section carrying nothing but one has not made its case. And this is about repetition, never withholding — a section with its own evidence gives it in full. Before you finish, check the counts you have quoted: any figure that appears three times, or twice in one section, is one too many.

## Numbers — one figure per fact, in words the reader can check

Every number here is read by somebody who knows their own life, and two different figures for one fact read as a report that made one of them up. A real report gave one figure for their searches in one section and a different one in another; both numbers were in the digest, and they counted different things — every search, and distinct search terms.

- **One fact, one figure, everywhere in the response** — the premium sections at the end included. When a count appears in more than one place, copy it from the same field every time or point back at the first mention, and round it the same way.
- **A total is not a distinct count, and the digest carries both.** \`google.counts.googleSearches\` is how many times they searched; \`coverage.sampling.googleSearchTerms.available\` is how many *different* things they searched for. \`google.counts.watched\` is videos opened; \`coverage.sampling.youtubeChannels.available\` is distinct channels. Every \`available\` in \`coverage.sampling\` is a count of distinct entries. Name each figure by what it counts — "12,000 searches", "9,000 different search terms" — and never call one by the other's name.
- **Translate a field into behaviour; never write the field.** The reader has never seen this digest, so a field name, an index or a raw value on a scale they do not know is noise to them. \`rhythm.regularity\` runs from 0 (activity arriving in bursts) to 1 (the same amount every month): write "your posting comes in bursts, with long quiet stretches between them", never "your regularity sits at 0". A number belongs in a sentence only if the reader can tell what it counts without being told how this digest is built.
- **A figure supports only the claim it measures.** \`averageSentLength\` says how they compose — quick chat against considered writing — and nothing about how many people they talk to; \`totalMessages\` and \`sentByUser\` say how much they talk, not how widely. Neither is evidence for extraversion, and a short average message is not a point towards **E**, nor a long one towards **I** (see the MBTI ledger above). A number that does not bear on the sentence it sits in is decoration: cut it.
- ${CONVERSATIONS_RULE}

# Specific sections

- **Big Five**: score 0-100 where 50 is an average person. Cite real evidence per trait. Note that "neuroticism" is emotional sensitivity — frame it neutrally, not as a defect. For **extraversion**, the score follows the E/I ledger (see the MBTI ledger above): cite a breadth number in the evidence — conversations with real, repeated exchange, distinct people, plans proposed, contact across circles — and, for a low score, the behaviour that shows them seeking quiet. Message volume and group chats, busy or empty, are evidence for it in neither direction, and never appear in an \`evidence\` string or an axis \`why\`.

  Every \`evidence\` string here is quoted back to the reader, so check each one against the who-is-this-about rule before you write it. Evidence that turns out to describe somebody they photographed is worse than no evidence at all: it is a stranger's life offered to them as their own.
- **MBTI**: work axis by axis — the \`ledger\` first (see the MBTI ledger above), then \`why\` and \`evidence\`, which explain what it shows, then the letter and strength you conclude from it — and give the type the four letters spell and its usual nickname, nothing else. \`why\` is two or three sentences in one paragraph: the case for the letter you chose, quoting or counting the specific evidence, then the pieces on the other side, with their counts, and what they do and do not overturn. It never says the lean goes the other way. \`evidence\`, printed under it, is three or four of the ledger's strongest pieces for the letter, each a short clause from a different part of the digest, none used for another letter and none restating the paragraph (fewer only when the data is genuinely thin — then say so). Make each line specific: if it would survive being pasted into a stranger's profile, rewrite it. There is no summary paragraph; do not write one into the last axis instead.

- **activity**: read the account as behaviour, not statistics. The histograms, the month-by-month series, the ratio of what they publish to what they like and save — these are the parts of the export people never look at themselves, and they are often the most revealing thing in it. Cite real numbers. Say what changed and when. Hedge where the evidence is thin — "you post almost entirely between 6 and 8am" is a fact, "you are a morning person whose day is spoken for by nine" is an inference, and the reader should be able to tell which is which. Be careful not to moralise about screen time.

- **activity.diet**: what they take in, which the rest of the report barely touches. You are given three separate appetites and they are rarely the same: \`mostLikedAccounts\` is what actually catches them, \`mostSavedAccounts\` is what they meant to come back to, and \`mostEngagedWith\` is who they actually talk to. Read those against \`counts.following\`, which is how many accounts they subscribed to in the first place — the list of names is not sent, and does not need to be, because the number is what the comparison turns on. Read the **gaps**. A person following six hundred accounts and engaging with forty is paying for a subscription they stopped reading; a person whose saves are all recipes and whose captions show the same three meals has an ambition that is not converting.

  It is a short paragraph rather than a list, so spend it on the shape of the thing and cite the counts that show it. Two limits. **Attention means likes, saves and comments — and, where a Google export is present, watch and visit counts.** No source here carries timing data of any kind: not the Instagram export, and not the Google one, which records *that* something was watched or visited and never for how long. There is no watch time, no session length, no screen time anywhere in this digest. Never write minutes, hours, "time spent" or anything implying you know how long they looked at something, because you do not — a hundred videos from one channel is a hundred openings, not an evening. And **do not name private individuals**. Outlets, brands and public creators are fair to name if one is genuinely the point; a friend or a relative is described rather than named, because the reader knows perfectly well who their friends are and a handle written into a report they may hand to somebody else drags in a person who never agreed to any of this.
- **Beliefs**: religious, political, ethical or philosophical commitments the data actually supports. An empty list is a fine answer. Do not guess at politics from thin evidence, and do not infer anything about a person from the demographics of accounts they follow.
- **essence**: pick the character before you write anything else, then let the rest of the profile agree with it. It has to be someone globally famous — the test is whether a stranger in another country would picture them instantly. A good pick is slightly surprising and survives being read back to them: Hulk for someone careful and clever who is visibly managing a temper, Kevin Flynn for someone whose whole life is one project. A bad pick is a compliment in a costume (Superman, Elsa for anyone who has ever been cold), a restatement of their hobby, or a character nobody outside a fandom could name. Match on temperament, drive and how they treat people — never on how they or anyone else looks, and never on their background. ${CHARACTER_GENDER_RULE} If the evidence is thin, pick someone ordinary and human rather than a hero. Match them to their own life, not to the lives in their photographs: somebody who documents founders and collectors is not thereby a founder or a collector, and picking a character off a borrowed biography is the loudest possible version of that mistake.

- **Relationship strengths and weaknesses**: how they would actually be to date or be close to. Real weaknesses, not humblebrags.

- **Love languages**: give them separately for receiving and for giving, because most people do not match on the two and that gap is the interesting part. Read *giving* from what they actually do — what their comments say to people, whether they show up for other people's events, whether they mark birthdays and anniversaries, how much time they visibly spend with the same few accounts. Read *receiving* from what they respond to and what they ask for, which is thinner evidence, so hedge it harder. Mark a language \`minor\` rather than inventing a case for it, and pick one or two strong ones over listing all five. **Physical touch is close to invisible in this data** — do not claim it as primary unless their own words make it obvious, and say so in the \`why\` when you are guessing. Where the two sides differ, let the \`inPractice\` lines carry it rather than commenting on the gap: there is no section for that.
- **Career strengths and weaknesses**: how they work and what would hold them back. Draw on rhythm, follow-through, social orientation and interests. **Describe, do not advise** — this section says what they are like at work, and nothing here is a recommendation. The coaching that acts on it is a separate paid pass over the same digest, written by a separate call that never sees this text, so leaving the advice out here does not lose it. There is no list of ideal environments here any more; do not smuggle one back into \`workStyle\` or \`watchOuts\`.

- **card**: a compact version for sharing. Every field short, because it gets encoded into a share link. It must stand alone — a second analyst will use only the card to assess how well they would get on with a friend, so make each phrase carry real information rather than being vague. Fill in \`conflictStyle\`, \`loveReceiving\`, \`loveGiving\`, \`energy\` and \`workStyle\` properly rather than treating them as afterthoughts: those are what the friendship read actually turns on, and a card that leaves them thin produces a report about hobbies. Compress rather than omit — carry the substance of the sections above in fewer words, and never write a phrase that would fit any other person equally well.

# Hard limits

${DATA_WORDS}

${CONDUCT_RULE_REPORT}

Do not identify or speculate about specific other people in their data. Do not infer sexual orientation, health conditions, immigration status, or political affiliation unless the person has stated it outright in their own words. Do not classify anyone by appearance or by the demographics of who they follow.

This holds hardest over the Google export, because a search box is where people take the questions they would not ask aloud. A searched symptom is not a diagnosis, a searched term is not an affiliation, a watched video is not an identity, and a visited website is not a membership. None of those may be named, implied or used as evidence for anything. Where a search only makes sense as one of the categories above, the correct move is to leave it out of the report entirely rather than to write around it.

Other people are all over this export without having agreed to any of it — named in captions, written to in messages, listed as friends. Do not describe, count, identify or infer anything whatsoever about them.

**No private individual's name appears anywhere in this report, and that includes inside quoted evidence.** This is the rule most easily lost, because it is not broken by writing *about* somebody — it is broken by quoting a caption that happens to name them. "Congrats Sarah on the new job" is evidence about the reader's generosity and it names a person who never agreed to appear in a document she will not see and cannot correct. Quote it as "congratulating a friend by name on a new job", or trim the quotation to the part that carries the evidence. Describe the relationship, never the person: a friend, a colleague, a sibling, someone they have posted about for years. The reader knows exactly who is meant; nobody else needs to. This binds every section, every piece of cited evidence, and the card. Say nothing about anyone's race, ethnicity, body, attractiveness, age, gender, wealth or health — not about the reader and not about anyone they mention — and do not use any of it as evidence for any conclusion. Gender's one use is privately choosing the character's side (see **essence**), never written. ${NEUTRAL_PEOPLE_RULE} Do not read a location precisely enough to place where someone lives or works.

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
// from a free report exactly as it renders from a full one. The shared card rides
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
// The roast, written by the free call only, for My Psyche, under the card.
// Its own section of the free prompt, before the hard limits — it used to be
// PROFILE_SYSTEM's, and the paid call no longer writes a roast. ROAST_LIMIT
// is the no-diagnosis rule restated for it, joined to the free prompt's hard
// limits.
const FREE_ROAST_SECTION = `# The roast — a different register entirely

Everything above is written to be fair. \`bonus\` is a roast: written to be accurate without being kind, which is a different thing and is the whole point of it — it sits behind a cover the reader has to click through, so nobody meets it who did not go looking for it. "Roast" is the register, not a suspension of the rules: a roast lands because it is true and the target recognises it; the moment it stops being evidence-bound it is just abuse from a stranger who read their captions. Write it to sting and to be funny about it, dry rather than jeering, the way a friend who has known them ten years would take them apart at a dinner. Go after patterns, choices and self-deceptions — never appearance, body, intelligence, worth, or anything about them that cannot change.

**When the evidence shows someone struggling, the roast goes gentle.** Read for it before you write a line: sadness or low mood that comes back again and again, grief, pulling away from people they used to see, nights without sleep, posts or messages that are hard on themselves, dread or panic. Where the digest shows that clearly, do not roast the struggle and do not roast hard at all: tease a few small, harmless habits, affectionately, the way a friend would to make them smile, and keep it short. \`advice\` turns kind and practical, and where it fits it says that talking to someone they trust, or to someone qualified, is worth doing. One sad post in a happy year is not this; a pattern is. Never name or hint at a condition.

**The register change has to be real, and it has to be contained.** Every section above this one is warm, hedged, and honest about uncertainty; \`harsh\` and \`advice\` are not, and must not soften into that voice partway through, or the section stops working. The reverse matters just as much: nothing written above this point should anticipate or lean toward the roast's tone, since a reader who has not yet clicked the cover open should meet a report that is entirely fair until they choose otherwise.

**Three seams are worth digging in before anything else, because the export shows all three unusually clearly.** First, **follow-through**: the distance between what they announced and what they finished. Compare posts naming a plan, a date or a resolution against posts that close one out, and compare what they save against what their own captions show them ever doing — a saved folder full of ambition and four years of the same three habits is the funniest thing in most accounts. Second, **reciprocity**: who shows up for them against who they show up for. Read \`mostEngagedWith\` against the comments they receive, the accounts they read constantly and have never spoken to, and whether the people who write them paragraphs get a paragraph back or an emoji. Third, **anything else they are plainly doing badly** that the data carries in the open — going quiet on people the moment they need something, performing an interest they have never once acted on, an apology posted twice for the same thing. Where the evidence is not there, drop the seam rather than inventing a case for it.

**Before you write any line of the form *X, yet Y*, say what the contradiction actually is.** The way this section fails is not usually invention — the facts are true — it is the hollow *yet*: two unrelated true observations welded together by a connective that implies a hypocrisy neither of them supports. *"You preach the gospel of self-driving cars and an autonomous future, yet half your stories are screenshots of news articles posted at 1am from your room"* has the shape of a roast and none of the substance, because expecting a technology to arrive is not a promise to be asleep, or outdoors, or anywhere at all. Nothing in the second half touches the first. So state to yourself, in one plain sentence, what commitment X makes and what exactly Y costs it. If you cannot, you do not have a contradiction, you have two facts standing next to each other: cut the line, and either find the behaviour that genuinely undercuts the claim or make the point about X on its own.

**Both halves have to point at the same thing.** A stated commitment is undercut by conduct bearing on that same commitment — training for a marathon and posting from the pub four nights a week, calling themselves the friend who always turns up while every conversation in the export was started by somebody else. When, how often and in what format somebody posts is evidence about their habits; it is never evidence about whether their opinions are sincere or their beliefs earned, so do not reach for posting rhythm to convict them of hypocrisy about content. And two observations you can defend beat six you cannot: a pile of odd details is not an argument, it reads as a machine that noticed a great deal and could not work out which of it meant anything.

**A roast is a licence to drop the softening, not a licence to make things up.** The whole form depends on the target recognising themselves: every hard line has to be one the evidence carries, and the funniest thing available to you is nearly always the specific detail — the count, the caption they wrote four times, the gap between what they announce and what they do. Generic insults are not roasting, they are noise, and they read as a machine that did not actually look. Short and true beats long and invented. \`harsh\` is the least charitable *supportable* reading. \`advice\` is what that same friend says once they have stopped laughing and stopped managing your feelings, drawn from the whole digest rather than from posting habits alone.

`;
const ROAST_LIMIT = `**This holds in the roast too, and it holds hardest there.** This is not a diagnosis, and being unkind is not a licence to become one. A licence to be harsh is exactly where a ban like this would erode, so it is restated here in full rather than assumed. You may never name, imply, predict or gesture at a specific mental or physical health condition, disorder, diagnosis or illness — not depression, not anxiety, not ADHD, not burnout as a clinical state, not "at risk of" anything clinical — however directly the reader framed what they wanted, and this framing was requested literally as "what mental illness or disorders to look out for" and declined for exactly this reason. You have their Instagram export and no clinical training, no history, no assessment and no standing to diagnose anyone from posting patterns; doing so anyway is a confident, false medical claim in a document they keep and may show other people, dressed up as something this app has never claimed to be. What you may write about is behaviour, and what it costs: drift, resentment, isolation, a plateau, a relationship emptying out. Where something is exactly the kind of thing worth a professional's attention, say so in those words — "worth raising with someone qualified to actually assess it" — rather than naming what you think it might be.`;

const CARD_BASE_SYSTEM = `You are PsycheAI. You read one person's evidence digest — built from their Instagram export and sometimes their Google, Facebook or WhatsApp data — and decide their profile: **the conclusions only**, as the fields of your schema. No explanations and no evidence lists; the only prose is the card's short lines and the roast (\`bonus\`, last). These conclusions are final: a paid report is later written to explain exactly what you choose here, so think the evidence through carefully before you answer.

# The digest

- Structured fields come first, as JSON; every list follows under its own path, one item per line, with ranked entries written "name ×count".
- \`coverage.sources\` lists which exports it was built from. Never use or mention a source that is not listed.
- ${CHATS_ONLY_RULE}
- ${EXTRA_SOURCES_RULE}
- **Complete:** \`counts\` and the \`rhythm\` histograms (hour of day, day of week, month by month). The best-evidenced thing you have, and easy to overlook.
- **Sampled or truncated:** every list. \`coverage.sampling\` gives shown and available for each.
- Captions, comments and messages carry the year they were written, \`[2019] …\`. Something they were deep in years ago is not necessarily who they are now.
- Messages are the reader's own side, drawn from the conversations they write in most, spread across time and lengths, and tagged by conversation (\`[t1]\`… Instagram, \`[m1]\`… Messenger, \`[c1]\`… WhatsApp). How they write to one person versus another is evidence. «them: …» at the start of a line is the message they were answering — context for the reply, never their words and never to be quoted.
- \`samples.likedPostCaptions\` were written by **other people**: the reader's taste, never their voice. \`samples.likedPostHashtags\` counts the hashtags across every post they liked in the last two years.
- \`instagramSearches\` and \`storyLikedAccounts\` are taste too, not their voice; a card read mostly from them keeps its confidence modest.
- \`PsycheUser\` stands in for the reader's own name and handle, \`PsycheEmail\`, \`PsychePhone\`, \`PsycheNumber\`, \`PsycheSecret\` and \`PsycheAddress\` for removed details. Treat them as blanks. \`[P1]\`… (handles) and \`[N1]\`… (names) are other people, one number each; never quote one as a name.
- Google: a search is a question, not a belief; watch history includes autoplay and other people, so only a channel watched repeatedly counts; browsing is two counts and nothing more.

# Reading it

**Weigh evidence in this order, strongest first:** behaviour sustained over years; their own written words; searches they repeat; rhythm; repeated engagement with other people's content; a single like, follow or view; Instagram's own inferred topics and ad interests. When two disagree, the higher one wins. One instance is not a pattern. Absence is almost never evidence — much of a life happens off these apps.

${ACCOUNT_AUDIENCE_RULE}

**The author is not the subject.** Most captions describe other people. "Finance pro turned founder @someone lecturing engineers on his startup" says the reader was in the room, not that they founded anything. A caption about somebody else is evidence of who the reader is around, what they notice and how they write about people — never of the other person's job, possessions or achievements. A comment is nearly always about the person whose post it is on.

${CONVERSATIONS_RULE}

# MBTI

${MBTI_LEDGER_RULES}

# Big Five

0–100, where 50 is an average person. Most people sit near the middle; keep the extremes for extreme evidence. Neuroticism is emotional sensitivity, not a defect. Extraversion, openness, agreeableness and conscientiousness follow their MBTI axis, as above.

# Character (\`essence\`)

A globally famous character a stranger anywhere would picture, matched on temperament, drive and how they treat people — never on looks or background, and never on the lives in their photographs. Slightly surprising rather than a compliment in a costume. ${CHARACTER_GENDER_RULE} With thin evidence, pick someone ordinary and human.

# Lists

Interests, values and beliefs strongest first; the card shows the first three, three and two. Beliefs only where the data supports them, and an empty list is fine. Never infer politics from who they follow.

Love languages: *giving* from what they do — what their comments say, showing up for people, marking occasions, time spent on the same few accounts; *receiving* from what they respond to, which is thinner, so hedge it. One or two strong ones, the rest \`minor\`. Physical touch is nearly invisible here; do not make it primary unless their own words say so.

# Confidence

${CONFIDENCE_SCORING}

# The card

Second person, warm, specific, not sycophantic; never a phrase that would fit anyone else. The \`card\` fields are read on their own by a second analyst comparing two friends, so each must carry real information: strengths and weaknesses with friends and the people close to them, and at work (real weaknesses, not humblebrags), \`rhythm\`, \`energy\` with how they keep in touch, and \`workStyle\` (describe, do not advise). Nothing on the card is about romance or dating. **What is printed on the card itself is positive and encouraging, with no negative connotation at all** — the headline, the two sentences on the character, and the signature pattern names. They are shared with friends, so show the person at their best: never a fault, a limit, a "but" or a compliment with a sting ("Warm once you earn it"). **In the headline and the write-up, closeness is never framed as a gate**: nothing that casts them as screening, vetting, testing or filtering people, letting only a few in, or others having to earn or pass anything — no "the few who pass your screening", "the select few", "your inner circle is hard to join". Say what they give, to whom: "deep loyalty to the people you are closest to", "you show up fully for your close friends". How selective they are may still be named in the weaknesses below and in the paid report. The costs belong in the weaknesses below and in the paid report. \`conflictStyle\` needs real work — derive it from how they disagree when a thread turns tense and how they handle a gap — and label it a guess. The reader sees these lines under their card, so write them to be read by the person they describe.

${FREE_ROAST_SECTION}# Hard limits

- ${DATA_WORDS}
- ${CONDUCT_RULE}
- Never name, identify or describe another private person, including inside anything you write; say "a friend" or "a colleague".
- Never infer sexual orientation, a health condition, immigration status or political affiliation unless they stated it outright in their own words. A search, a watched video or a followed account is never evidence of any of these.
- Never name or hint at a mental or physical health condition or diagnosis.
- Say nothing about anyone's race, ethnicity, body, attractiveness, age, gender, wealth or health, and use none of it as evidence. Gender only decides which characters to choose among, and is never written. ${NEUTRAL_PEOPLE_RULE} Do not place where they live or work.
- Every one of these holds in the roast too, and hardest there.

${ROAST_LIMIT}
`;

// The structured layout's free call: the signature patterns
// decided here, where they go on the free card, rather than in the paid call.
// The paid report is then anchored to these names (anchorFrom) and explains
// them, so the card and the report can never name different patterns.
const STRUCTURED_FREE_SYSTEM = (() => {
  const card = '# The card\n';
  if (CARD_BASE_SYSTEM.indexOf(card) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no card section');
  const character = 'With thin evidence, pick someone ordinary and human.';
  if (CARD_BASE_SYSTEM.indexOf(character) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no character rule');
  const lists = 'the card shows the first three, three and two.';
  if (CARD_BASE_SYSTEM.indexOf(lists) < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no card list rule');
  if (CARD_BASE_SYSTEM.indexOf(CHARACTER_GENDER_RULE + ' ') < 0) throw new Error('STRUCTURED_FREE_SYSTEM: no gender rule');
  return CARD_BASE_SYSTEM.replace(CHARACTER_GENDER_RULE + ' ', '').replace(character,
    'Choose from the catalogue your schema lists — ' + CHARACTER_NAMES.length + ' characters spread across temperaments — ' +
    'and pick the closest honest fit rather than the most flattering one. ' + CHARACTER_SIDE_RULE + ' The card gives two ' +
    'sentences to why they are like this character, so pick one whose likeness you can show from something specific in ' +
    'their data.').replace(lists,
    'the card shows the first three interests. \`topMotivators\` is the three of Schwartz\'s ten basic values that show ' +
    'most in what they do, strongest first. **Values & Beliefs** is one list of exactly three in all: two values and ' +
    'a belief — religious, political, ethical or philosophical, wherever the data supports one — and, where none ' +
    'does, a third value instead. Fewer only when the export is genuinely thin. Every entry must be a distinct idea: none may restate, narrow or ' +
    'overlap another, **and none may restate a top motivator or a signature pattern**, which the card already shows. ' +
    '"Independent thinking" beside self-direction, or "Self-reliance" beside a self-contained pattern, says one thing ' +
    'twice: name what they hold to that the motivators and patterns do not already say. A value is a word or two; the ' +
    'belief a short phrase under 40 characters with no full stop. Sentence case for every name you write, pattern ' +
    'names included.').replace(card,
    '# Signature patterns\n\n' +
    'Exactly three behaviours that explain the most about this person — the threads the rest of the profile hangs on. ' +
    'Decide them last, from everything above. Each has an id (p1, p2, p3, in order of how much it explains), a short ' +
    'memorable name in plain words — "The quiet organiser", "Warm in small circles", "Plans first, then plays" — that ' +
    'is not a type label, and one line naming the behaviour and both of its sides: where it helps them and where it ' +
    'costs them. The name is printed on the card, so it must sound **flattering** — a phrase they would be glad to ' +
    'have said about them, naming the behaviour at its best ("The quiet organiser", "Warm in small circles") — never ' +
    '"guarded", "avoidant", "needy", "stubborn", "cold", "overthinker" or the like. Its line may name the blind spot ' +
    'plainly; the name never does. The cost goes ' +
    'in the line, which the reader reads privately in their Overview, never on the card. **A pattern is never about ' +
    'romance or dating**: how they are with ' +
    'a partner belongs only to the paid report\'s relationship section. They go on the free card and a paid report ' +
    'explains them, keeping these names, so make each one something the evidence carries across several parts of their ' +
    'life, not a single habit. Each also carries two to four pieces of counted evidence — "41 of 60 messages are ' +
    'replies within the hour" — and `showsUpIn`, the parts of their life where it visibly operates: at least three, ' +
    'or it is a finding rather than a pattern.\n\n' +
    '# Overview\n\n' +
    'Under their card the reader sees an Overview: `summary`, then the signature patterns with their lines and ' +
    'evidence. It is free, read privately, and the paid report opens on the same Overview and explains it, so ' +
    'write the summary as the whole reading in miniature: the type, where they stand out on the Big Five, what ' +
    'drives them, how they are to be close to and how they work. It is not printed on the card, so it may name a ' +
    'cost plainly, kindly. Write it last but one, after everything it sums up.\n\n' + card);
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
const CARD_DERIVED_KEYS = ['name', 'mbti', 'bigFive', 'interests', 'values',
  'loveReceiving', 'loveGiving', 'confidence'];
const FREE_CARD_SCHEMA = object(Object.fromEntries(Object.entries(CARD_SCHEMA.properties)
  .filter(([key]) => !CARD_DERIVED_KEYS.includes(key))));

const CARD_BASE_SCHEMA = object({
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
  mbti: object({
    letters: listOf({
      axis: { type: 'string', description: 'One of: E/I, N/S, T/F, J/P.' },
      ledger: LEDGER,
      choice: PROFILE_SCHEMA.properties.mbti.properties.letters.items.properties.choice,
      strength: PROFILE_SCHEMA.properties.mbti.properties.letters.items.properties.strength,
    }),
    type: { type: 'string', enum: MBTI_TYPES },
    confidence: PROFILE_SCHEMA.properties.mbti.properties.confidence,
    nickname: PROFILE_SCHEMA.properties.mbti.properties.nickname,
  }),
  bigFive: object({
    openness: freeTrait,
    conscientiousness: freeTrait,
    extraversion: freeTrait,
    agreeableness: freeTrait,
    neuroticism: freeTrait,
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
  // Last, so the card is written fair before the register changes.
  bonus: ROAST_SCHEMA,
});

// The executive summary, short: the sections below carry every number. Written
// by the free call since October 2026, for the Overview under the card, and
// pinned from it in the paid report.
const STRUCTURED_SUMMARY = { type: 'string', description: 'About 120 words — never more than 140 — in one or two short paragraphs, written to them as "you". The whole report in miniature: the type, where they stand out on the Big Five said in words (high, low), what drives them, how they are to be close to and how they work, as one flowing portrait rather than a list. **No numbers or scores of any kind** — every section below carries its own. Written second, after the character line printed just above it: build on that line rather than retelling the comparison. The card\'s write-up is condensed from the two of them next.' };

// Where a pattern shows up, by section, and the patterns' own ids.
const SECTION_KEYS = ['bigFive', 'mbti', 'motivators', 'interests', 'values', 'beliefs',
  'relationships', 'attachment', 'idealPartner', 'work', 'wellness'];
const PATTERN_IDS = ['p1', 'p2', 'p3'];

// Signature patterns as the free card carries them: named, not yet evidenced.
// The paid report adds the evidence and where each shows up.
const FREE_PATTERNS = { ...listOf({
  id: { type: 'string', enum: ['p1', 'p2', 'p3'], description: 'p1, p2, p3 in order of how much of the profile each explains.' },
  name: { type: 'string', description: 'A short, memorable name in plain words, in sentence case ("The quiet organiser"). Printed on the card, so flattering: the behaviour at its best, never a fault (the line carries the cost). Not a type label, not jargon, nothing about romance or dating. Under 40 characters.' },
  line: { type: 'string', description: 'One sentence: the behaviour, where it helps them and where it costs them. Shown in their Overview, never on the card. Nothing about romance or dating. Under 160 characters.' },
  evidence: { ...strList, description: 'Two to four things from the digest that show it, each counted. Never a count of conversations they ever wrote in as breadth: sustained conversations over the last five years are the number that measures it.' },
  showsUpIn: { type: 'array', items: { type: 'string', enum: SECTION_KEYS }, description: 'Where it visibly operates: at least three sections.' },
}), description: 'Exactly three signature patterns: p1, p2, p3.' };

// Values and beliefs share one "Values & Beliefs" list of exactly three, on
// the card and in the report, none restating a top motivator or a pattern.
// "At most three" let a report show two (October 2026); fewer only for a
// genuinely thin export.
const STRUCTURED_FREE_VALUES = { ...listOf({ value: { type: 'string' } }), description: 'Two distinct values, strongest first; a third only when no belief is supported. Three entries in all with the belief; fewer only for a thin export. None may repeat another, a top motivator or a pattern.' };
const STRUCTURED_FREE_BELIEFS = { ...listOf({ belief: { type: 'string' } }), description: 'One when values has two, to make up the third: religious, political, ethical or philosophical, as the data supports, and no value, motivator or pattern covers it. A short phrase, no full stop.' };
// The three motivators the card shows. The paid report scores all ten and is
// held to these three as its highest.
const FREE_TOP_MOTIVATORS = {
  type: 'array', items: { type: 'string', enum: MOTIVATORS },
  description: 'Exactly three of Schwartz\'s ten basic values — the three that show most in what they actually do, strongest first. Read behaviour, not aspiration: what they spend time, effort and attention on.',
};

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
// the character, and nothing else. The four-sentence portrait the base card
// schema carries repeated what the card's own panels already show.
const STRUCTURED_CARD_HIGHLIGHTS = { type: 'string', description: 'Exactly two sentences for the shareable card, written to them as "you", condensed from the character line (`essence.why`) and the executive summary (`summary`) written just above: why they are like this character, and the person behind it at their best. The card prints the character\'s name directly above this, so do not open by restating it or by announcing the comparison ("You are like X"). No type, no scores, no list of interests. Printed on the card, so positive (the card rule): what they share with the character at its best, and nothing about romance or dating.' };

// The first of three, in this order (18 Oct 2026): the character line, the
// executive summary, then the card's write-up and headline condensed from
// the two. The card call writes all three, so the report written to a card
// keeps them rather than writing its own.
const ESSENCE_WHY = { type: 'string', description: 'One or two sentences, under 50 words: the trait they share with this character, tied to one specific thing in their data. Name the shared trait, not the plot of the film. Written first of three: the executive summary and then the card\'s write-up draw on it.' };
const STRUCTURED_FREE_ESSENCE = object({
  character: CATALOGUE_CHARACTER, franchise: CATALOGUE_FRANCHISE, icon: CATALOGUE_ICON, why: ESSENCE_WHY,
});

// The write-up comes after the patterns, so it is written knowing what the
// card already prints beneath it and can say something else. Values and
// beliefs come after the patterns and the motivators too, so they are chosen
// knowing what those already say and do not say it again.
// The character too (October 2026): picked from the scores and patterns
// already written, never ahead of them.
const STRUCTURED_FREE_SCHEMA = object(Object.assign(
  Object.fromEntries(Object.entries(CARD_BASE_SCHEMA.properties)
    .filter(([key]) => !['essence', 'card', 'cardHighlights', 'values', 'beliefs', 'bonus'].includes(key))),
  { patterns: FREE_PATTERNS, topMotivators: FREE_TOP_MOTIVATORS,
    values: STRUCTURED_FREE_VALUES, beliefs: STRUCTURED_FREE_BELIEFS, essence: STRUCTURED_FREE_ESSENCE, summary: STRUCTURED_SUMMARY,
    cardHighlights: STRUCTURED_CARD_HIGHLIGHTS, card: FREE_CARD_SCHEMA,
    bonus: CARD_BASE_SCHEMA.properties.bonus }));

const FREE_SYSTEM = STRUCTURED_FREE_SYSTEM;
const FREE_SCHEMA = STRUCTURED_FREE_SCHEMA;

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
  const bigFive = {};
  for (const trait of TRAIT_KEYS) {
    const row = d.bigFive && d.bigFive[trait];
    bigFive[trait] = Math.max(0, Math.min(100, Math.round(Number(row && row.score) || 0)));
  }
  const card = Object.assign({}, d.card, {
    name: 'PsycheUser',
    mbti,
    bigFive,
    interests: names(d.interests, 'name', 4),
    // Values & Beliefs travel as the one list the card shows.
    values: names(d.values, 'value', 3).concat(names(d.beliefs, 'belief', 3)).slice(0, 3),
    loveReceiving: labelled(love.receiving, 2),
    // "Receiving gifts" is the one name the schema has for gifts; given, it
    // is giving them (docs/copy.js, givingLove).
    loveGiving: labelled(love.giving, 2).map(text => text.replace(/^Receiving gifts\b/, 'Giving gifts')),
    confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence && d.confidence.score) || 0))),
    // Already decided in this answer, so copied rather than written twice:
    // what drives them and the patterns' names, which the comparison weighs.
    motivators: (Array.isArray(d.topMotivators) ? d.topMotivators : []).filter(key => MOTIVATORS.includes(key)).slice(0, 3),
    patterns: (Array.isArray(d.patterns) ? d.patterns : []).filter(p => p && p.name).slice(0, 3).map(p => String(p.name)),
  });
  return Object.assign({}, result, { data: Object.assign({}, d, { card }) });
}

// ---------- how the evidence is written into a prompt ----------
//
// The renderer lives in docs/digest.js, beside the budget that measures it, so
// the size the trim loop and the server count is exactly what a prompt holds.
// That file is a browser script that hangs itself off `globalThis`; loaded here
// the same way server.js loads it, once, if nothing has yet.
function digestModule() {
  if (!globalThis.PsycheDigest) {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const file = path.join(__dirname, '..', 'docs', 'digest.js');
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  return globalThis.PsycheDigest;
}

function renderEvidence(digest) {
  return digestModule().renderEvidence(digest);
}

// The MBTI rows the code computes from the digest (lib/mbtiScore.js), after
// the evidence, so the model's own sum matches the code's. Not sent with an
// anchor: a report pinned to its card writes no letters.
function computedNote(digest) {
  const text = mbtiScore.computedText(digest);
  return text ? '\n\n' + text : '';
}

// ---------- the reader's marks on their previous report (October 2026) ----------
//
// On a paid run that replaces a report, the reader's thumbs on its findings
// (and any note of what is closer) come with the digest, held by the server as
// `digest.__readerMarks` (a device key, so renderEvidence never shows it as
// evidence). They are told to the model after the evidence, with how to use
// them, so the new report answers what the reader disputed rather than
// repeating it.
const MARKS_MAX = 20;
const MARK_LABEL_MAX = 120;
const MARK_NOTE_MAX = 200;
function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanReaderMarks(value) {
  return (Array.isArray(value) ? value : []).slice(0, MARKS_MAX).map(m => {
    if (!m || typeof m !== 'object' || typeof m.fits !== 'boolean') return null;
    const finding = cleanText(m.finding, MARK_LABEL_MAX);
    if (!finding) return null;
    const note = m.fits ? '' : cleanText(m.note, MARK_NOTE_MAX);
    return note ? { finding, fits: false, note } : { finding, fits: m.fits };
  }).filter(Boolean);
}
function marksBlock(digest) {
  const marks = digest && Array.isArray(digest.__readerMarks) ? digest.__readerMarks : [];
  if (!marks.length) return '';
  return '\n\n<reader_marks>\nBefore this run the reader read their previous report and marked some of its findings. ' +
    'These are their reactions, not evidence about their behaviour.\n' +
    marks.map(m => '- "' + m.finding + '": ' + (m.fits ? 'fits' : 'not quite' +
      (m.note ? '. What is closer, in their words: "' + m.note + '"' : ''))).join('\n') +
    '\n</reader_marks>\n' +
    'Weigh each "not quite" honestly against the evidence. Where the evidence allows the reader\'s version, write the ' +
    'finding their way. Where it still clearly shows the original, keep it, and in the report (never on the card) say once, ' +
    'plainly and kindly, which evidence still points that way. A "fits" is a light confirmation, never a reason to ' +
    'overstate. Never cite the marks as evidence or quote them on the card, and every card rule still holds.';
}

function freeBlocks(digest) {
  return [{
    type: 'text',
    text: 'Here is the evidence digest for one person, built from their ' +
      sourcePhrase(digest) + ' data. Reach your conclusions about them and produce their summary card.' +
      '\n\n<evidence>\n' + renderEvidence(digest) + '\n</evidence>' + computedNote(digest) + marksBlock(digest),
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
// About 140 words at most, with room to spare.
const ANCHOR_SUMMARY_MAX = 1400;

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
  const essence = report.essence || {};
  const love = (report.relationship && report.relationship.loveLanguages) || {};
  const anchor = {
    character: text(essence.character),
    franchise: text(essence.franchise, 40),
    mbtiType: text(mbti.type, 12),
    mbtiLetters: (Array.isArray(mbti.letters) ? mbti.letters : []).slice(0, 4).map(letter => Object.assign({
      axis: text(letter && letter.axis, 4),
      choice: text(letter && letter.choice, 1),
      strength: text(letter && letter.strength, 10),
    }, Array.isArray(letter && letter.ledger) && letter.ledger.length ? {
      // The card's ledger, so the report explains the evidence the letter was
      // scored from rather than reaching for other evidence.
      ledger: letter.ledger.slice(0, 16).map(item => ({
        row: text(item && item.row, 30), pointsTo: text(item && item.pointsTo, 8), note: text(item && item.note, 160),
      })),
    } : {})),
    bigFive,
    interests: pick(report.interests, 'name', 8),
    values: pick(report.values, 'value', 6),
    beliefs: pick(report.beliefs, 'belief', 4),
    loveReceiving: pick(love.receiving, 'language', 3),
    loveGiving: pick(love.giving, 'language', 3),
    cardHighlights: text(report.cardHighlights, ANCHOR_TEXT_MAX),
  };
  // The structured layout's free card names its signature patterns; the paid
  // report keeps them. Absent on an older card, so its anchor is the same
  // object it always was.
  const patterns = (Array.isArray(report.patterns) ? report.patterns : [])
    .filter(p => p && /^p[1-3]$/.test(p.id) && p.name).slice(0, 3)
    .map(p => ({ id: p.id, name: text(p.name, 60), line: text(p.line, 200) }));
  if (patterns.length) anchor.patterns = patterns;
  // The Overview the free card now carries (October 2026): its executive
  // summary, and patterns that already have their evidence. The reader has
  // read both free, so the paid report keeps them whole and does not write
  // them again (fullSchemaFor). A card from before has neither, and its
  // report writes them as it always did.
  const summary = text(report.summary, ANCHOR_SUMMARY_MAX).trim();
  const evidenced = patterns.length > 0 && report.patterns
    .filter(p => p && /^p[1-3]$/.test(p.id) && p.name).slice(0, 3)
    .every(p => Array.isArray(p.evidence) && p.evidence.length > 0);
  if (summary && evidenced) anchor.summary = summary;
  // Its character line too, the first of the three: settled with the rest.
  if (anchor.summary && text(essence.why, ANCHOR_TEXT_MAX).trim()) anchor.essenceWhy = text(essence.why, ANCHOR_TEXT_MAX).trim();
  // And its three motivators, which the paid report's scores are held to.
  const top = (Array.isArray(report.topMotivators) ? report.topMotivators : [])
    .filter(key => MOTIVATORS.includes(key)).slice(0, 3);
  if (top.length) anchor.topMotivators = top;
  // The lines shown under the card ("Beyond your card") that the full report
  // explains: conflict in the attachment section, social
  // energy and contact in wellbeing's social connection, and what holds them
  // back at work under How you work. Kept, so the report cannot contradict
  // what the reader has already read about themselves.
  const card = report.card && typeof report.card === 'object' ? report.card : {};
  const lines = {
    conflictStyle: text(card.conflictStyle, 60),
    energy: text(card.energy, 80),
    careerWeaknesses: (Array.isArray(card.careerWeaknesses) ? card.careerWeaknesses : []).slice(0, 2).map(v => text(v, 40)).filter(Boolean),
  };
  if (lines.conflictStyle || lines.energy || lines.careerWeaknesses.length) anchor.cardLines = lines;
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
      'MBTI type with these letters and strengths, these Big Five scores and bands, this ' +
      'character, and these interests, values, beliefs and love languages in this order — you may add ' +
      'further interests, values or beliefs after these, but do not drop, rename or reorder them. Explain ' +
      'each honestly from the evidence, including where the case for one is thinner than its label ' +
      'suggests — say so in its reading or `why` rather than changing the conclusion. Copy the type, ' +
      'letters, scores and character into your own fields exactly as given. Wherever the instructions above ' +
      'tell you to pick or decide one of these, this card is that decision.' +
      ((anchor.patterns || []).length
        ? (anchor.summary
          ? ' The reader has also read their Overview: ' + (anchor.essenceWhy ? 'the character line (`essenceWhy` below), ' : '') +
            'the executive summary (`summary` below) and the signature patterns with their evidence, and the card\'s ' +
            'write-up. All are settled and your schema has no field for them: write every section to agree with the ' +
            'summary, and draw on the patterns by id and name as the instructions say.'
          : ' The card also names the signature patterns: keep their ids, names and order exactly, and write ' +
            'each one\'s evidence and where it shows up. Sharpen a line if the evidence calls for it; do not ' +
            'replace the pattern.')
        : '') +
      ((anchor.topMotivators || []).length
        ? ' It names their top motivators too: score those as your highest, in that order.'
        : '') +
      (anchor.cardLines
        ? ' Under the card the reader has also read `cardLines`: explain them, do not contradict them. ' +
          'The conflict style is `attachment.conflict`, which opens with it; the social energy and contact are what ' +
          '`wellness.socialConnection` explains; and each work cost is one of the things that hold them back ' +
          '(`careerAssessment.holdingBack` or `career.weaknesses`).'
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
  // the compressed version that travels in the share link.
  attachment: object({
    style: { type: 'string', description: 'Name the style using one of three: secure, anxious or avoidant. Readers know these names, look them up, and compare notes with a partner, and a made-up phrase in their place leaves them with nothing to search for. Never write fearful-avoidant or disorganised, anywhere in this section: those names land as a verdict, and an export cannot support one. Where their conduct shows both a pull towards closeness and a retreat from it, name the two leanings it shows instead — "anxious-leaning, with avoidant edges", "leans secure, avoidant under stress". Write it as a leaning rather than a category — "leans secure", "anxious-leaning", "avoidant-leaning" — and add the behaviour that earns it, e.g. "Anxious-leaning: quick to reach out, quicker to read silence as distance". The leaning wording is not decoration: it is the difference between a description of how somebody has been behaving lately and a claim about who they are. Under 90 characters.' },
    styleTone: { type: 'string', description: 'One warm, plain sentence saying what this style is good at — every leaning comes with real strengths, and the reader should meet theirs before they meet the caveats. Anxious attachment reads people accurately and invests early. Avoidant attachment stays steady under pressure and does not lose itself in someone else. A mix of the two usually means somebody who wants closeness and has learned to be careful with it, which is a common and survivable position, not a broken one. Secure attachment is not a prize the others failed to win. Say the specific version of this that fits the evidence, not the generic one.' },
    why: { type: 'string', description: 'Three or four sentences showing your working: which behavioural traces pointed here, which style you considered and rejected, and what would have changed your mind. Reason from what they do — how quickly and warmly they reply, how they write to people close to them, whether they broadcast or converse, how they handle a gap in contact — not from a horoscope, and not from what they watch or read about relationships, which shows an interest rather than a style. Write it as reasoning offered to them, not a finding delivered about them.' },
    conflict: { type: 'string', description: 'How they handle disagreement with people close to them, in two or three sentences written to them as "you": whether they raise it, smooth it over, go quiet or come in hot, in what form, and what that does to the other person — from how they respond when a thread or a comment turns tense and how they handle the gap after one. Where the card already names their conflict style, open with it in the same words and explain it. A tendency, not a verdict: say what helps.' },
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
    // "Careers that suit you", under How you work. Two string lists rather
    // than lists of objects: the structured full schema sits near the size
    // Gemini will serve, and this adds no more to it than the roast's two
    // fields took away.
    fit: object({
      suits: { ...strList, description: 'Three kinds of work that would suit them best, strongest first, each written as the kind of work, a colon, then one sentence on why, from something specific in their data (e.g. "Research in a small product team: …"). Kinds of work or roles (e.g. "Operations in a small, fast team"), never one job title they must take, and nothing about pay or status.' },
      draining: { ...strList, description: 'Two or three kinds of work that would drain them, each written as the kind of work, a colon, then one sentence on what it would cost them, from their data. About the fit between the work and how they are, never a fault in them; phrase it so a reader would nod rather than wince.' },
    }),
    actions: listOf({
      horizon: { type: 'string', enum: CAREER_HORIZONS, description: 'When this should happen.' },
      title: { type: 'string', description: 'A few words, phrased as something to do.' },
      detail: { type: 'string', description: 'Two or three sentences: what doing it actually looks like, concretely enough to start. Name the first move, not the ambition.' },
    }),
  }),
  // No model-generated caveat field on `wellness` above, unlike the other
  // places this file asks for one (trait bands, MBTI, love languages).
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

The identical evidence digest the free report was built from. \`coverage.sources\` says which exports it draws on, exactly as it did the first time — nothing new has been uploaded, and this is a deeper read of the same evidence rather than a request for more of it. ${CHATS_ONLY_RULE} ${EXTRA_SOURCES_RULE} Reason from the digest's text, counts and rhythms; there is nothing else, for this call or for the free one.

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

  **When the behavioural evidence is thin or mixed, take the more cautious read.** Roughly half of adults lean secure, so a non-secure leaning has to be shown in their own conduct. A mixed read — a pull towards closeness and a retreat from it — claims two things at once, so it needs both halves visible in what they do, not one observed and the other inferred. Where the behaviour shows a mostly steady core with a defensive pattern under pressure, say exactly that: "leans secure, with avoidant defences under stress" is a legitimate read and often the most honest one, and escalating it to a stronger category is the overreach. Either way, name the stronger style you considered in \`why\` and the behaviour that would have moved you to it.

  Use three names — secure, anxious, avoidant — because a reader who is told they lean one of these can look it up, recognise themselves or not, and talk to a partner about it, and an invented phrase in their place leaves them with nothing to hold. **Never name fearful-avoidant or disorganised**, in the style or anywhere else in this section, including as a style you considered: those names land as a verdict on the person, and an Instagram export cannot carry one. Where conduct shows both a pull towards closeness and a retreat from it, name the two leanings it shows — "anxious-leaning, with avoidant edges". Write each as a *leaning* rather than a category, which is both more honest about what an Instagram export can show and the difference between describing how somebody has been behaving and declaring what they are.

  **Tone is a correctness requirement in this section, not a nicety.** These words arrive loaded: a reader who sees "anxious" or "avoidant" is reading whatever they already believe that means, usually something worse than what you intend. So lead with what the style is genuinely good at — every one of them comes with real strengths, and none of them is a defect — and only then get to what it costs. A mix of anxious and avoidant usually describes someone who wants closeness and has learned to be careful with it, which is a common and survivable position, not a broken one; secure is not a prize the others failed to win. Where a pattern does cost them something, write it as a tendency they can work with — what it looks like, what tends to help, and that it moves. Attachment is the most changeable thing in this entire report, and the reader should finish this section believing that, because it is true. Prescribing what they must do, or writing as though the label settles their future, is the failure mode here.

- **idealPartner**: what kind of partner actually suits them, argued directly from the attachment section immediately above rather than from a fresh read of the digest — you have already established how they attach, so use it. \`needs\` says what they actually require to be well in a relationship: not adjectives a magazine quiz would produce, but requirements that follow from their attachment style, their love languages and their own relationship strengths and weaknesses, each one earning its place with real evidence. \`carefulOf\` is the honest counterpart: partner types or dynamics that would predictably go wrong for *this* person specifically, given how they attach and how they behave once close to someone — not a list of universal red flags, which would fit anybody and help nobody.

  **This is the most concrete test of whether you actually used the attachment read or just re-described it.** If a need or a caution here would make just as much sense bolted onto a stranger with a different attachment style, it has not done its job — go back to \`attachment.why\` and \`attachment.implications\` and pull the specific thread through. \`summary\` closes the section in two or three sentences: the honest verdict a reader gets even if they read nothing else here, not a recap of the two lists above it.

- **careerAssessment**: you are a career coach here, and this is the one section in the report that is meant to change what somebody does on Monday. **It is a different job from the career section above, and the two must not say the same thing twice.** That one describes how this person works; this one decides what they should do about it. If a sentence here would sit comfortably in \`career.workStyle\`, it belongs there instead.

  **\`fit\`** names the kinds of work that suit them best and the kinds that would drain them, each with its reason from their data. Kinds of work, not job titles: the export holds no CV. Draining work is a mismatch with how they are, never a fault.

  **\`edge\` is the centre of the section.** Name the thing they do reliably that most people do not, and state it as an advantage they can use rather than a compliment they can enjoy. The test is whether it would survive being read by somebody who knows them: an edge that would fit any organised, agreeable or hard-working person is not an edge. Reach for the specific and slightly unobvious — a follow-through rate most people do not have, a room they are in that their job title would not predict, the fact that the same twelve people have stayed close for four years — and evidence it with real counts.

  **Be honest about what you cannot see, because it is a lot.** This export contains no CV, no job history, no title, no employer, no salary and no performance review. You are reading how somebody works from the traces of a life posted around the work. That is genuinely enough to find an edge and name a pattern that is costing them; it is nowhere near enough to state what job they hold or how senior they are. Infer openly and say you are inferring. Where the export barely touches work at all, say that in \`situation\` and keep the rest proportionate rather than inventing a career to advise.

  **The who-is-this-about rule bites hardest here.** Somebody who photographs founders at a demo night is the person who was in the room, not a founder; somebody who writes up a friend's promotion has not been promoted. Reading a borrowed biography as a career is the single most damaging error available in this section, because unlike a wrong trait score it reads as a confident statement of fact about a life they do not have.

  **\`actions\` must be startable.** Each carries a horizon, and at least one should be \`this week\` — an answer with nothing in it before next quarter is a wish list. Across the whole plan (these and the development actions), use all three horizons: something this week, something this quarter, and at least one move for \`this year\`. Name the first move rather than the ambition: "ask your manager which of the three projects counts at review" beats "increase your visibility". Concrete enough that they could do it after reading it.

# Hard limits

${DATA_WORDS}

${CONDUCT_RULE_REPORT}

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
      'not carry.\n\n<evidence>\n' + renderEvidence(digest) + '\n</evidence>' + marksBlock(digest),
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

// The base report and the four premium sections as one schema: what the
// retired classic layout sent, kept as the yardstick the report's schema is
// measured against (the size Gemini is known to serve) and built from.
const BASE_FULL_SCHEMA = Object.assign(
  object(Object.assign({}, PROFILE_SCHEMA.properties, PREMIUM_SCHEMA.properties)),
  { $defs: PREMIUM_SCHEMA.$defs });

// The keys the unlock's response carries for the four premium sections — what
// the browser files under `premiumAnalysis` rather than under the report.
const PREMIUM_KEYS = Object.keys(PREMIUM_SCHEMA.properties);

// ---------- the structured report: one thread through five parts ----------
//
// The report is built as one thread, not a run of separate sections. It adds four fields that tie them together, modelled on how
// professional assessments are built (definition, overview, chart, detail,
// and development drawn from the findings) but using only public frameworks
// and this app's own wording:
//
// - `patterns`: exactly three signature patterns, decided first, which every
//   section then points back at. They are what make the report one argument.
// - `motivators`: Schwartz's ten basic human values (a published academic
//   model, not anybody's proprietary "drivers"), scored relative to each other.
// - `development`: what to build on and what to work on, each naming the
//   pattern it resolves and the sections that raised it.
// - `pressurePoints`: strengths that turn costly when overused — the public
//   "overused strengths" idea — each with early signs, one counter-move and a
//   reflection question.
//
// The classic layout it was built on was retired on 18 Oct 2026: its prompt
// and schema survive only as the base this one is spliced from
// (FULL_SYSTEM_BASE, PROFILE_SCHEMA, CARD_BASE_SYSTEM, CARD_BASE_SCHEMA).

// The sections a pattern can show up in, or a development item can be raised
// by. Rendered as links on the page, so they are keys rather than titles.
// The sections a pattern can show up in, or a plan item be raised by. Not the
// digital footprint: the web report no longer has that section to point at.
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
    name: { type: 'string', description: 'A short, memorable name in plain words, e.g. "The quiet organiser" or "Warm in small circles". It is printed on the card they share, so neutral or positive: the behaviour, never a fault. Not a type label, not jargon, nothing about romance or dating. Under 40 characters.' },
    line: { type: 'string', description: 'One sentence saying what the pattern is: the behaviour, and the two sides of it — where it helps them and where it costs them. Nothing about romance or dating.' },
    evidence: { ...strList, description: 'Two to four specific things from the digest that show it, each with a count or a proportion. Follow the rules on numbers: never a count of conversations they ever wrote in as breadth.' },
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
      detail: { type: 'string', description: 'Two or three sentences: what the pattern costs them, from the evidence, without moralising — and the strength it comes from, tipped too far under pressure or when tired.' },
      pattern: patternRef,
      raisedBy: sectionRefs('The sections whose findings raised this.'),
      // What used to be its own "Under pressure" section: the same cost seen
      // as a strength tipping over, so it lives on the area it belongs to.
      earlySigns: { ...strList, description: 'Two observable behaviours that show this starting — things they, or someone close to them, could notice early. Behaviours, not feelings.' },
      counterMove: { type: 'string', description: 'One concrete move for the moment they notice it. One sentence.' },
      actions: { ...listOf({
        horizon: { type: 'string', enum: CAREER_HORIZONS },
        step: { type: 'string', description: 'One concrete first move, startable as written. One sentence.' },
      }), description: 'One or two actions, on different horizons — the whole plan holds about five, and between them they cover this week, this quarter and this year: at least one each.' },
      reflect: { type: 'string', description: 'One open question worth sitting with, specific to them. Not rhetorical.' },
    }),
  }),
};

// What the report leaves out of the base schema: nothing now that the
// Enneagram is gone. Kept as the place a future cut goes.
// `activity` (the digital footprint): the structured report and its PDF have
// no section for it, so writing it cost output and time for nothing.
const STRUCTURED_DROPS = ['activity'];
// The full report's character: the catalogue's, with the written `why`.
const STRUCTURED_ESSENCE = object({
  character: CATALOGUE_CHARACTER, franchise: CATALOGUE_FRANCHISE, icon: CATALOGUE_ICON,
  why: ESSENCE_WHY,
});
const STRUCTURED_CARD_SCHEMA = CARD_SCHEMA;

// The order the model writes in. MBTI and the Big Five first, then `patterns`,
// so it is decided before any other section that is meant to point back at it;
// `motivators` beside the values it places on a common map; the closing two
// last, because they resolve everything above them.

// A copy of a schema node with some properties taken out and others' wording
// replaced — the structured layout's leaner version of a shared section.
function reshaped(node, drop, describe) {
  const out = JSON.parse(JSON.stringify(node));
  for (const key of drop || []) {
    delete out.properties[key];
    out.required = (out.required || []).filter(name => name !== key);
  }
  for (const [key, description] of Object.entries(describe || {})) {
    out.properties[key] = Object.assign({}, out.properties[key], { description });
  }
  return out;
}

// The report cut down (October 2026). The Big Five is five scores and a line
// each: MBTI, printed above it, carries the case for the type, and the E/I
// letter still reads off the extraversion score, which stays. Interests are
// short lines under the motivators, one each, not a section of tiles, so they
// lose their evidence lists.
// The line is written before the score (October 2026), so the score is read
// off a behaviour rather than a behaviour found to fit a score.
const STRUCTURED_TRAIT = object({
  reading: { type: 'string', description: 'One sentence: the specific behaviour from the data that sets this score, as it shows in their week. No list of evidence: the score and this line are all the report prints.' },
  score: traitSchema.properties.score,
  band: traitSchema.properties.band,
});
function structuredMbti(node) {
  const out = JSON.parse(JSON.stringify(node));
  // No `inPractice` line (18 Oct 2026): after the paragraph and its evidence
  // list it was a third telling of the same letter.
  const item = out.properties.letters.items;
  delete item.properties.inPractice;
  item.required = (item.required || []).filter(key => key !== 'inPractice');
  const evidence = item.properties.evidence;
  evidence.description = evidence.description
    .replace('On E/I this is the breadth:', 'On E/I this is the breadth, and the only place the extraversion evidence is laid out (the Big Five gives each trait one line):');
  return out;
}
const STRUCTURED_INTERESTS = (() => {
  const out = JSON.parse(JSON.stringify(PROFILE_SCHEMA.properties.interests));
  delete out.items.properties.evidence;
  out.items.required = out.items.required.filter(key => key !== 'evidence');
  out.items.properties.detail = Object.assign({}, out.items.properties.detail,
    { description: 'One sentence on how this shows up for them, with a count or a span in it; a trajectory other than structural or stable said in words.' });
  out.description = 'Strongest first. The report prints every one, a line each, under what drives them.';
  return out;
})();

function structuredSchema() {
  const p = PROFILE_SCHEMA.properties;
  const q = PREMIUM_SCHEMA.properties;
  const s = STRUCTURED_PROPERTIES;
  const ordered = {
    // The scores first (October 2026): MBTI, whose letters carry the evidence,
    // then the Big Five read off those cases, then the patterns the sections
    // point back at.
    confidence: p.confidence,
    mbti: structuredMbti(p.mbti),
    bigFive: object({ openness: STRUCTURED_TRAIT, conscientiousness: STRUCTURED_TRAIT, extraversion: STRUCTURED_TRAIT,
      agreeableness: STRUCTURED_TRAIT, neuroticism: STRUCTURED_TRAIT }),
    patterns: s.patterns,
    interests: STRUCTURED_INTERESTS,
    // One "Values & Beliefs" list of exactly three, none restating a top
    // motivator or a pattern.
    beliefs: Object.assign({}, p.beliefs, { description: 'Exactly one when values has two, to make up the third entry: religious, political, ethical or philosophical, as the data supports, and not covered by any value, motivator or pattern. Empty only when none is supported; values then has three.' }),
    values: Object.assign({}, p.values, { description: 'Two distinct values, strongest first, and a third only when no belief is supported — exactly three entries in all with the belief; fewer only when the export is genuinely thin — none repeating another or restating a top motivator or a signature pattern.' }),
    motivators: s.motivators, relationship: p.relationship,
    // How you work: the edge leads, so strengths are others; one short list
    // of what holds them back, so no separate "where it goes wrong".
    // No `workStyle` and no `careerAssessment.situation`: the section's two
    // intro paragraphs only said again what the edge and the careers list say.
    career: reshaped(p.career, ['watchOuts', 'workStyle'], {
      strengths: 'One or two work strengths other than `careerAssessment.edge` — never the edge said again in other words.',
      weaknesses: 'At most one: a cost at work that `careerAssessment.holdingBack` does not already name. Empty is fine.',
    }),
    // The character, the summary and the card's write-up once who they are,
    // what drives them and how they connect and work are all written: they
    // sum the report up rather than lead it (18 Oct 2026).
    essence: STRUCTURED_ESSENCE, summary: STRUCTURED_SUMMARY, cardHighlights: STRUCTURED_CARD_HIGHLIGHTS,
    card: STRUCTURED_CARD_SCHEMA,
    wellness: reshaped(q.wellness, [], {
      suggestions: 'One or two concrete things to try this week, each tied to a dimension above and to its evidence — they go on the plan, which holds about five actions in all. Practical, never treatment, therapy or a care plan.',
    }),
    // No "In practice": what the style gives and costs is in relationships'
    // own strengths and weaknesses.
    attachment: reshaped(q.attachment, ['implications']),
    idealPartner: q.idealPartner,
    careerAssessment: (() => {
      const node = reshaped(q.careerAssessment, ['situation']);
      node.properties.actions = Object.assign({}, node.properties.actions,
        { description: 'One or two, on different horizons — the plan holds about five actions in all, and covers this week, this quarter and this year, at least one each.' });
      return node;
    })(),
    development: s.development,
  };
  // Every base field is still here, unless it is listed as dropped.
  for (const key of Object.keys(p).concat(Object.keys(q))) {
    if (!(key in ordered) && !STRUCTURED_DROPS.includes(key)) {
      throw new Error('structuredSchema: ' + key + ' is missing from the order');
    }
  }
  return Object.assign(object(ordered), { $defs: PREMIUM_SCHEMA.$defs });
}

const STRUCTURED_KEYS = Object.keys(STRUCTURED_PROPERTIES);

const STRUCTURED_ADDON = `# The thread that ties this report together

This report is read as one document, not as a run of separate verdicts, and it is laid out in five parts: who you are, what drives you, how you connect, how you work, and putting it together. Three more fields carry the thread through it.

- **patterns** — exactly three signature patterns (p1, p2, p3): the few behaviours that explain the most of everything else in this report. **Decide them straight after MBTI and the Big Five, from the evidence and those scores, and before any other section**, then let every section after draw on them. Each has an id (p1, p2, p3, in order of how much it explains), a short memorable name in plain words — "The quiet organiser", "Warm in small circles" — that is not a type label and is phrased positively and encouragingly with no negative connotation, because it is printed on the card they share (the name never states a fault or a limit; the cost goes in the line), one line naming the behaviour and both of its sides, two to four pieces of counted evidence, and \`showsUpIn\`: the sections where it visibly operates. A pattern visible in fewer than three sections is a finding, not a pattern. Patterns are behaviours with two sides, never virtues: each helps them somewhere and costs them somewhere else. A pattern is never about romance or dating — its line and evidence stay with friends, family, work and how they spend their time; how they are with a partner belongs only in the relationship sections (\`attachment\`, \`idealPartner\`).

  Inside the sections, when a finding is one of these patterns at work, say so once in a clause by its name — "the same quiet-organiser pattern behind your conscientiousness" — rather than explaining it again. That back-reference is what makes the report read as one argument, and it obeys the rule above about spelling evidence out once.

- **motivators** — where their motivation sits on Schwartz's ten basic human values, a published academic model: self-direction, stimulation, hedonism, achievement, power, security, conformity, tradition, benevolence, universalism. Give all ten, each exactly once. \`score\` is 0–100 for how strongly the value shows up in what they actually do — choices, attention, what they return to — **relative to their other nine**, so the ten must spread out: a profile with everything between 55 and 70 has not decided anything. Read behaviour first and stated opinion second; a value they post about and never act on scores below one they act on without mentioning. Neighbours on Schwartz's circle (self-direction and stimulation; achievement and power; security, conformity and tradition; benevolence and universalism) usually rise and fall together and opposites trade off — where theirs do not, that is worth a sentence in \`reading\`. This is not the \`values\` list above, which names their values in their own terms; this places them on a common map.

- **development** — closes the report by resolving the patterns. \`buildOn\` is two strengths to lean into deliberately; \`develop\` is two areas worth working on. Each names the pattern it resolves and \`raisedBy\`, the sections whose findings raised it, so a reader can trace why it is there. A \`develop\` area is also where a strength turns costly under pressure — the independence that becomes going it alone, the reliability that becomes absorbing everyone else's overflow — so it carries \`earlySigns\`, two behaviours someone could notice early (not feelings), and \`counterMove\`, one concrete move for that moment. This is behaviour under pressure, never a condition: the hard limits on clinical language apply here exactly as they do in the wellness section. Each \`develop\` area has one or two actions, on different horizons, each a first move rather than an ambition — and across the plan every horizon (this week, this quarter, this year) has at least one, and \`reflect\`, one open question specific to them. This is about the whole of their life; \`careerAssessment\` is about work.

**Fields that share a section on the page must not repeat each other.** How you work shows \`career\` and \`careerAssessment\` as one section: \`careerAssessment.edge\` leads it, so \`career.strengths\` are strengths other than the edge — never the edge in other words — and \`careerAssessment.holdingBack\` and \`career.weaknesses\` appear as one short list of what holds them back: two different costs at most, not one cost said twice. \`careerAssessment.underused\` is a third thing again, not the cost restated as an opportunity. In relationships shows \`relationship\`, \`attachment\` and \`idealPartner\` as one section, so \`idealPartner.carefulOf\` must not restate \`relationship.weaknesses\`. **Values & Beliefs** is one list of exactly three — two values and a belief, or a third value where no belief is supported; fewer only when the export is genuinely thin — unlabelled, and every entry must be a distinct idea: none may restate, narrow or overlap another, none may restate a top motivator or a pattern, and the belief is never a value said as a sentence.

**The plan holds about five actions, and every one is different.** Every action in the report — \`development.develop\` actions, \`careerAssessment.actions\` and \`wellness.suggestions\`, which go on it as this-week moves — sits on one plan: one or two from each, about five in all. No two may be the same step, and none may be the same step on a different deadline — "say it within 24 hours" and "say it within 48 hours" are one action. Where a work or wellbeing action is the right one for a develop area, give it once, in whichever field fits, and leave the other out.

**MBTI comes before the Big Five**, on the page and in the order you write: each letter's case is made first, and the Big Five scores that share an axis follow those cases. The E/I \`why\` names no score; the extraversion score follows its letter and strength, and its breadth is in that letter's \`evidence\`.

The three must agree with the sections: a pattern or a development area that introduces a claim no section made is a new claim without its evidence. Keep them proportionate — together roughly the length of two ordinary sections. Where a section would repeat what a pattern already says, shorten the section, not this.`;

// The base prompt with the report's thread added. Splices are cut on their
// text, which throws if it ever goes missing, the same rule FULL_SYSTEM_BASE's
// splices follow.
// What the report's prompt changes in the base one, so it never asks for
// a field its schema leaves out or describes a page it does not have. Each
// is cut on its text, which throws if it ever goes missing.
const STRUCTURED_SPLICES = [
  // No "In practice" under the attachment read, and no separate watch-outs under work.
  ['go back to `attachment.why` and `attachment.implications` and pull', 'go back to `attachment.why` and pull'],
  [' do not smuggle one back into `workStyle` or `watchOuts`.', ' do not smuggle one back in.'],
  // Nor the two intro fields: How you work opens on the edge.
  [' If a sentence here would sit comfortably in `career.workStyle`, it belongs there instead.', ''],
  ['Where the export barely touches work at all, say that in `situation` and keep',
    'Where the export barely touches work at all, say that plainly in the edge and keep'],
  // The character (18 Oct 2026): the base prompt's free-form pick ("globally
  // famous", chosen first, the rest made to agree with it) is the catalogue's,
  // chosen after the scores, on the card's side rule; settled when the card
  // named it, and nothing bends to it.
  ['- **essence**: pick the character before you write anything else, then let the rest of the profile agree with it. It has to be someone globally famous — the test is whether a stranger in another country would picture them instantly. A good pick is slightly surprising and survives being read back to them: Hulk for someone careful and clever who is visibly managing a temper, Kevin Flynn for someone whose whole life is one project. A bad pick is a compliment in a costume (Superman, Elsa for anyone who has ever been cold), a restatement of their hobby, or a character nobody outside a fandom could name. Match on temperament, drive and how they treat people — never on how they or anyone else looks, and never on their background. ' + CHARACTER_GENDER_RULE + ' If the evidence is thin, pick someone ordinary and human rather than a hero.',
    '- **essence**: the character comes from the catalogue your schema lists, chosen after the sections on who they are, what drives them and how they connect and work, as the closest honest fit for temperament, drive and how they treat people — never on how they or anyone else looks, and never on their background. Reach past the obvious fit and past the flattering one: the point is recognition. ' + CHARACTER_SIDE_RULE + ' When the card has already named the character, it is settled: `essence.why` explains it, and nothing else in the report bends to it.'],
  // Attachment sits inside How you connect, beside the relationship read.
  ['- **attachment**: its own section, not part of the relationship read above — write it to stand alone rather than as a continuation of what came before it.',
    '- **attachment**: shown inside How you connect, straight after the relationship read — build on that read rather than repeating it.'],
  // The Big Five as five scores and a line each; MBTI carries the evidence,
  // E/I the extraversion breadth number (October 2026).
  ['Cite real evidence per trait. Note that', 'Each trait gets its score, its band and one line, with no evidence list: MBTI carries the case. Note that'],
  ['the score follows the E/I ledger (see the MBTI ledger above): cite a breadth number in the evidence', 'the score follows the E/I ledger (see the MBTI ledger above): cite a breadth number in the E/I axis\'s `evidence`'],
];
// Whole passages the structured call has no field for: the digital footprint
// (`activity`, dropped from its schema) and the shareable card (pinned from
// the free card, so the paid call never writes it). From the first marker up
// to, not including, the second.
const STRUCTURED_CUTS = [
  ['- **activity**: read the account as behaviour', '- **Beliefs**:'],
  ['- **card**: a compact version for sharing.', '# Hard limits'],
];
function cutOnce(text, from, to) {
  const at = text.indexOf(from);
  const end = at < 0 ? -1 : text.indexOf(to, at);
  if (at < 0 || end < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error('STRUCTURED_FULL_SYSTEM: expected exactly one "' + from.slice(0, 60) + '"');
  }
  return text.slice(0, at) + text.slice(end);
}
function structuredFrom(base) {
  let text = base + '\n\n' + STRUCTURED_ADDON;
  for (const [from, to] of STRUCTURED_SPLICES) text = replaceOnce(text, from, to);
  for (const [from, to] of STRUCTURED_CUTS) text = cutOnce(text, from, to);
  return text;
}
const STRUCTURED_FULL_SYSTEM = structuredFrom(FULL_SYSTEM_BASE);
const STRUCTURED_FULL_SCHEMA = structuredSchema();

// ---------- the full schema when a card is pinned ----------
//
// Gemini refuses a response schema past a complexity limit it neither names
// nor reports — a bare 400 "Request contains an invalid argument." — and the
// structured full schema is past it. tools/probe-schema.mjs measured where:
// the (since retired) classic full schema and the structured one without its four added
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
// them — and well under the base schema's size on every count.
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
  drop(P.mbti.properties.letters.items, ['choice', 'strength', 'ledger']);
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
// Pinned to a card that carries its Overview (anchor.summary): the summary,
// the patterns and the card's write-up are the free call's, whole, so the
// paid call writes none of them. docs/app.js (overlayCard) puts them back
// from the card.
function withoutKeys(schema, keys) {
  const out = JSON.parse(JSON.stringify(schema));
  for (const key of keys) delete out.properties[key];
  out.required = (out.required || []).filter(key => !keys.includes(key));
  return out;
}
const STRUCTURED_OVERVIEW_PINNED_SCHEMA = withoutKeys(STRUCTURED_PINNED_FULL_SCHEMA, ['summary', 'patterns', 'cardHighlights']);
// And a card that also wrote its character line (since 18 Oct 2026): the
// whole chain — character line, summary, write-up — is the card's.
const STRUCTURED_LINE_PINNED_SCHEMA = withoutKeys(STRUCTURED_OVERVIEW_PINNED_SCHEMA, ['essence']);

// What the unlock's call sends.
const FULL_SYSTEM = STRUCTURED_FULL_SYSTEM;
const FULL_SCHEMA = STRUCTURED_FULL_SCHEMA;
const FULL_PINNED_SCHEMA = STRUCTURED_PINNED_FULL_SCHEMA;

/**
 * The schema the unlock's call sends. With an anchor, the pinned one. The
 * server never makes this call without one (see cardThenFull in server.js),
 * because the unpinned schema is the one Gemini refuses; it is kept for
 * providers that serve it.
 */
/**
 * The full schema without careerAssessment.fit, for Gemini to fall back on if
 * it refuses the whole one (lib/gemini.js, analyseFull). A copy: the schema
 * itself is shared.
 */
function withoutCareerFit(schema) {
  const out = JSON.parse(JSON.stringify(schema));
  const coach = out.properties && out.properties.careerAssessment;
  if (coach && coach.properties) {
    delete coach.properties.fit;
    if (Array.isArray(coach.required)) coach.required = coach.required.filter(key => key !== 'fit');
  }
  return out;
}

function fullSchemaFor(anchor) {
  if (anchor && anchor.summary && anchor.essenceWhy) return STRUCTURED_LINE_PINNED_SCHEMA;
  if (anchor && anchor.summary) return STRUCTURED_OVERVIEW_PINNED_SCHEMA;
  return anchor ? FULL_PINNED_SCHEMA : FULL_SCHEMA;
}

// ---------- Psyche Sync (the comparison) ----------

// One question only: how two people who know each other get on, whatever
// the relationship (friends, family, anyone close), never named. Romantic and work comparisons
// were removed — a reader's link is often public (an Instagram bio), and a
// stranger running a romantic read against someone's card was the creepy
// version of this feature. Old saved reports on those bases still render on
// the reader's device; nothing here produces a new one.
//
// Still keyed, so the schema, the cache key and the reports already saved
// keep one shape: `platonic` is the only key, and every request resolves to it.
const COMPATIBILITY_MODES = {
  platonic: {
    label: 'Connections',
    heading: 'How to relate to each other',
    brief: 'These two may be friends, family or anyone else close, and you are not told which. How they sync, vibe and relate turns on shared interests and activities, compatible energy, a similar appetite for contact, how each shows care, and how easily things flow between them. Whether they would actually enjoy time together matters more than any label. Nothing here is about romance or dating, and nothing should read that way.',
    dimensions: ['Shared interests', 'Energy match', 'Appetite for contact', 'How easily things flow', 'Outlook and values'],
    lean: ['interests', 'energy (how they keep in touch)', 'extraversion', 'conflictStyle', 'agreeableness', 'values', 'loveReceiving and loveGiving (how each shows care)'],
  },
};

/** The brief and dimensions for a run: always the friendship one. */
function briefFor() {
  return COMPATIBILITY_MODES.platonic;
}

// Every claim has to name what in the two cards put it there. The profile side
// has demanded evidence per trait since it was written; this side asserted
// freely, which is how a compatibility report ends up sounding true and
// meaning nothing.
const compatPointList = listOf({
  title: { type: 'string', description: 'A few words.' },
  detail: { type: 'string', description: 'Two sentences, concrete and naming both people.' },
  evidence: {
    ...strList,
    description: 'One or two short items naming what in the profiles put this here — a trait score, a value, how each handles a disagreement, a rhythm. Quote the actual phrase or number rather than gesturing at it. Prefer one item per person. Never reuse an item already given as evidence for a dimension or another point.',
  },
});

// The four MBTI axes in the order a type spells them, and how much each one
// decides between two people. E/I is how much company and quiet each needs,
// and S/N whether they talk about the same things — concrete and now, or ideas
// and what-ifs; a split on either is felt every week. T/F (how each decides
// and fights) and J/P (plans against open options) matter less, and a
// difference there often divides the work well. Each has the Big Five trait
// that tracks it, which says whether a letter is a clear preference or a lean.
const TYPE_AXES = [
  { axis: 'E/I', weight: 'most', trait: 'extraversion' },
  { axis: 'S/N', weight: 'most', trait: 'openness' },
  { axis: 'T/F', weight: 'less', trait: 'agreeableness' },
  { axis: 'J/P', weight: 'less', trait: 'conscientiousness' },
];

// No score: a percentage between two friends read as a grade, and the
// lowest ones as a verdict on the friendship. The read is a one-line summary,
// where the two align, where they differ, and what each can do.
const COMPATIBILITY_SCHEMA = object({
  mode: { type: 'string', enum: Object.keys(COMPATIBILITY_MODES), description: 'Echo back the basis you were asked to assess.' },
  summary: { type: 'string', description: 'One line, under 25 words: the truest warm thing about these two as connections, the line they would happily quote. No score, no rating, no "but".' },
  align: { ...compatPointList, description: 'Where you align: two or three things the two of them have in common or that suit each other, sharpest first. Title a few words ("Same love of a plan"), detail one or two sentences naming both people.' },
  differ: { ...compatPointList, description: 'Where you differ: two or three real differences, each titled neutrally ("Different paces") and, in the detail, how the difference can work for them (see # Tone).' },
  howToPartner: object({
    forA: { ...strList, description: 'Three concrete things the FIRST person can do to relate better to the other, addressed to them as "you".' },
    forB: { ...strList, description: 'Three concrete things the SECOND person can do to relate better to the other, addressed to them as "you".' },
    together: { ...strList, description: 'Two things they could agree on or do together.' },
  }),
  caveats: { type: 'string', description: 'One or two sentences on what this read cannot see.' },
});

// Trimmed from about 9,800 characters to under 5,000: it is billed in full on
// every compatibility call (it is under Gemini's caching floor, see
// lib/gemini.js), and most of the old length was explanation of a rule rather
// than the rule. Each rule is kept; tools/selftest.mjs holds the load-bearing
// phrases.
const COMPATIBILITY_SYSTEM = `You are PsycheAI, assessing how two people would get on. You get two compact profiles, each derived from that person's own Instagram data. Person A opened the other's link; person B is the one whose link it was.

# Any two connections

The two may be friends, family or anyone else close. You are not told which, so never assume it: write about how the two of them sync, vibe and relate to each other, in words that fit a sister and brother as well as two friends. Never call them friends or what they share a friendship ("a dependable friendship built on…", "as friends"), and never name another relationship either: say "you two", "the two of you" or "your connection". Read shared interests, compatible energy, a similar appetite for contact, how each shows care, and how easily things flow between them. Never write about romance, dating, partners or attraction, and never about attachment style — even if a profile seems to invite it. Do not assess them as colleagues either.

# Types

Weigh the two MBTI types, but do not give them a section of their own: say what they mean for these two in one or two sentences at most, where it lands hardest.

- **E/I matters most**: how much company and quiet each needs. A split means agreeing how much time to spend with other people.
- **S/N matters as much**: the concrete and practical, or ideas and possibilities. A split means finding the topics both enjoy.
- **T/F matters less**: deciding on logic or on what it does to people. Often balancing; worth knowing in a disagreement.
- **J/P matters least**: plans against open options. Divides logistics well; worth agreeing how plans get made.

Read each letter's strength from the Big Five: extraversion for E/I, openness for S/N, agreeableness for T/F, conscientiousness for J/P. A score near 50 is a lean, and two leans either side of the line are closer than their letters suggest. If a type is missing or uncertain, use the Big Five instead.

Worth reading in the traits: a wide conscientiousness gap is worth planning around (one plans ahead, the other goes with the flow); two high-neuroticism profiles do best when they steady each other under stress; two low-agreeableness profiles can disagree productively.

# Evidence

Every point in \`align\` and \`differ\` has an \`evidence\` field: name what in the profiles put it there — a score, a value or motivator, how each handles a disagreement, a rhythm or contact line — and quote the number or wording ("her 77 agreeableness against his 51", not "both are agreeable"), ideally one item per person. No support, no claim. The derived facts block is computed, not guessed: treat its overlaps, gaps and axis matches as settled, and never claim a shared interest it does not list.

# Writing

Short and high-impact, in this order: **summary**, one warm line; **align**, two or three ways they fit; **differ**, two or three ways they differ, each with how it can work; then **howToPartner**, specific things each can do to relate better to the other, addressed to them as "you", that only make sense for these two. Each point something these two will recognise, sharpest first, no warm-up. Call each person exactly by the name their profile gives, unchanged: usually a stand-in, Person A or Person B, that the app turns back into their name.

Say each thing once: align and differ do not restate the summary, howToPartner does not repeat a point, and each piece of evidence is quoted once. Write about the people, never the data — no cards, fields, labels, matches or comparisons, and no score or percentage of any kind. Quote a phrase only whole; paraphrase one that looks cut off.

# Tone

Both people will read this, and may share it, so write it the way the Psyche Card is written: **positive and encouraging throughout**. Be honest about differences, but frame each as a difference with a way to make it work ("Mei likes plans set early; Jun likes to decide on the day — agree a time, leave the rest open"), never as a fault in either person, and never with one of them as the problem. No blame, no labels such as needy, cold, flaky or stubborn, and no prediction that the connection will struggle. **Never use the words tension, conflict, clash, friction, struggle, problem or incompatible**: say "disagreement", "difference" or "a different pace" instead, and paraphrase rather than quote any profile line that uses one.

# Limits

Both profiles are inferences from social media, not measurements, and each carries a confidence figure — respect it. If either is low, say in the caveats that this is a conversation starter rather than a finding. Never present this as a prediction of whether the connection will last.`;

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
const SOURCE_NAMES = { instagram: 'Instagram', google: 'Google', facebook: 'Facebook', whatsapp: 'WhatsApp' };

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
      '<evidence>\n' + renderEvidence(digest) + '\n</evidence>' + (anchor ? '' : computedNote(digest)) + marksBlock(digest),
  }];
  if (anchor) blocks.push(anchorBlock(anchor));
  return blocks;
}

/** Every comparison is between friends now, whatever a request asks for. */
function resolveMode() {
  return 'platonic';
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
  lines.push('Values & beliefs in common: ' + (sharedValues.length ? sharedValues.join(', ') : 'none'));

  const sharedMotivators = overlap(a && a.motivators, b && b.motivators);
  if ((a && a.motivators || []).length && (b && b.motivators || []).length) {
    lines.push('Top motivators in common: ' + (sharedMotivators.length ? sharedMotivators.join(', ') : 'none'));
  }

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
    const same = [];
    const differ = [];
    TYPE_AXES.forEach(({ axis }, i) => {
      (typeA[i] === typeB[i] ? same : differ).push(axis + ' (' + typeA[i] + ' vs ' + typeB[i] + ')');
    });
    lines.push('MBTI ' + typeA + ' vs ' + typeB + ' — shares ' + same.length + ' of 4 axes.' +
      (same.length ? ' Same: ' + same.join(', ') + '.' : '') +
      (differ.length ? ' Differs: ' + differ.join(', ') + '.' : ''));
    // How firmly each letter is held, from the trait that tracks it: a letter
    // on a score near 50 is a lean, and two leans across the line are close.
    const strength = score => (!Number.isFinite(score) ? 'unknown' : Math.abs(score - 50) <= 10 ? 'a lean'
      : Math.abs(score - 50) <= 25 ? 'moderate' : 'clear');
    lines.push('How firmly each letter is held (from the Big Five trait that tracks it):\n' + TYPE_AXES.map(({ axis, trait }, i) =>
      '  ' + axis + ' via ' + trait + ': ' + nameA + ' ' + typeA[i] + ' ' + strength(Number(fiveA[trait])) + ', ' +
      nameB + ' ' + typeB[i] + ' ' + strength(Number(fiveB[trait]))).join('\n'));
  }

  const confA = Number(a && a.confidence);
  const confB = Number(b && b.confidence);
  if (Number.isFinite(confA) && Number.isFinite(confB)) {
    lines.push('Profile confidence: ' + nameA + ' ' + confA + '/100, ' + nameB + ' ' + confB +
      '/100. The weaker of the two caps how far this comparison can be trusted.');
  }

  return lines.join('\n');
}

function compatibilityBlocks(a, b) {
  const key = resolveMode();
  const chosen = briefFor();
  return [{
    type: 'text',
    text: 'Assess how these two people sync, vibe and relate to each other, **whatever their relationship**.\n\n' + chosen.brief + '\n\n' +
      'What matters most, in this order:\n' +
      chosen.dimensions.map(d => '  - ' + d).join('\n') + '\n\n' +
      'The fields that decide those most: ' + chosen.lean.join(', ') + '.\n\n' +
      'Set the "mode" field of your answer to "' + key + '".\n\n' +
      '<person_a>\n' + JSON.stringify(a) + '\n</person_a>\n\n' +
      '<person_b>\n' + JSON.stringify(b) + '\n</person_b>\n\n' +
      '<derived_facts>\n' + derivedFacts(a, b) + '\n</derived_facts>',
  }];
}

// ---------- Ask PsycheAI ----------
//
// A reader with a full Psyche Report asks one question about it at a time
// (docs/app.js, the Ask PsycheAI popout; server.js, handleAsk). The model is
// given the report and the card, and the digest the report was written from
// (October 2026): the report's conclusions to build on, and the evidence to
// draw fresh, concrete examples from. About 4 to 5.5 cents a question at
// Gemini flash prices, against 1.7 for the report alone. The last few
// questions and answers ride along so a follow-up reads as one.
const ASK_QUESTION_MAX = 300;
const ASK_HISTORY_MAX = 3;
const ASK_REPORT_MAX = 150000;

const ASK_SCHEMA = object({
  answer: { type: 'string', description: 'The answer, addressed to the reader as "you": two to four short paragraphs separated by a blank line, 120 to 250 words in all. Specific to this report; quote or name the finding it rests on.' },
  nextSteps: { type: 'array', items: { type: 'string' }, description: 'One to three concrete coaching steps for the coming week, each one sentence, each something the reader can actually do.' },
  followUps: { type: 'array', items: { type: 'string' }, description: 'Two short follow-up questions the reader might ask next, in their own voice ("How do I…?"), each under 80 characters.' },
});

const ASK_SYSTEM = `You are Psyche, the coach inside PsycheAI. The reader has a Psyche Card, and often a Psyche Report: a personality analysis written from their own Instagram and digital data. They ask you one question at a time, and you answer as a warm, direct personal-growth coach who has read the whole report and, when you are given it, the data it was written from.

# What you are given
- <report>: the reader's Psyche Report and Psyche Card, as JSON. PsycheUser is the reader. A reader who has not unlocked the report yet has only the card and its Overview (the summary, the signature patterns and the roast): answer from those and the evidence, and never point them to a section they do not have. [P1], [N1] and the like stand for other people; never guess who they are and never quote one as a name.
- <evidence>, when present: the de-identified summary of their own data that the report was written from. Use it for fresh, concrete examples. The report's conclusions stand: build on them, never overturn them from the evidence. When its \`coverage.sources\` has no \`instagram\`, it is a few WhatsApp chats they picked: never mention their posts, likes or public life.
- <earlier>: up to three of their earlier questions and your answers, for context. Do not repeat them.
- \`readerMarks\` in <report>, when present: findings the reader marked as fitting them (fits: true) or not quite (fits: false), sometimes with a note of what is closer. Take a "not quite" and its note as their word on themselves: build on the note, never argue the finding back at them. If the question touches it, you may say gently what the data showed, once.
- <question>: what they ask now.

# How to answer
- Answer as someone who knows the reader from both: the report's conclusions and, when <evidence> is present, their own data (posts, captions, comments, messages, searches, rhythms). When the evidence has a pattern that fits the question, ground the answer in at least one concrete one ("the late-night messages to your closest friends", "three years of cooking captions") and tie it to the finding it supports.
- Talk about the reader and their life, not about a document: never open with or lean on "your report says", "looking across your report" or "according to your report". Name a finding plainly ("you read as an INFJ who…", "the first step in your development plan…").
- Never invent evidence, posts, messages or scores that neither the report nor the evidence contains; if they cannot answer it, say so in a sentence and answer what they can.
- Be specific and practical: coaching, not a summary of the report. End the answer on something they can use.
- Stay on the reader: their personality, relationships, work, wellbeing and growth. A question about anything else gets one friendly sentence steering back.
- Not therapy and not a diagnosis. Where the question or the report suggests real distress, say kindly that talking to someone qualified would help, and give the gentle, general support you can.
- ${CONDUCT_RULE_REPORT}
- Plain text only: no markdown, no headings, no bullet points inside "answer".`;

function askBlocks(report, question, history, digest) {
  const earlier = (Array.isArray(history) ? history : []).slice(-ASK_HISTORY_MAX)
    .map(h => 'Q: ' + String(h.q || '').slice(0, ASK_QUESTION_MAX) + '\nA: ' + String(h.a || '').slice(0, 2000)).join('\n\n');
  return [{
    type: 'text',
    text: '<report>\n' + JSON.stringify(report) + '\n</report>\n\n' +
      (digest ? '<evidence>\n' + renderEvidence(digest) + '\n</evidence>\n\n' : '') +
      (earlier ? '<earlier>\n' + earlier + '\n</earlier>\n\n' : '') +
      '<question>\n' + String(question || '').slice(0, ASK_QUESTION_MAX) + '\n</question>',
  }];
}

// ---------- one call for the unlock that adds data (October 2026) ----------
//
// When a reader adds a source while unlocking, the card is redrawn from the
// new digest before the report is written to it (cardThenFull in server.js):
// two calls, each reading the whole premium digest. This writes both in one.
//
// Gemini refuses that schema as it stands; tools/probe-schema.mjs showed the
// enums are what tip it, not its size. So every enum but the character
// catalogue is sent as a plain string with its allowed values in the
// description (MERGED_SCHEMA), and checkMerged holds the answer to the
// strict schema (MERGED_STRICT_SCHEMA) before anything is kept.
//
// The card's own rules come along word for word: the free call's prompt
// from its Big Five section on, so the character, the patterns, the card's
// wording and the roast are decided by the same text that decides them on a
// free card. splitMerged then hands back exactly what the two calls return
// today — the card as analyseCard shapes it, the report as the
// Overview-pinned schema shapes it — so nothing downstream can tell.

const MERGED_CARD_RULES = (() => {
  const at = STRUCTURED_FREE_SYSTEM.indexOf('# Big Five');
  if (at < 0) throw new Error('MERGED_SYSTEM: no "# Big Five" in the free prompt');
  // Its confidence section is the report's own word for word
  // (CONFIDENCE_SCORING), already above in the full prompt: said once.
  const section = '# Confidence\n\n' + CONFIDENCE_SCORING + '\n\n';
  const rules = STRUCTURED_FREE_SYSTEM.slice(at);
  if (!rules.includes(section)) throw new Error('MERGED_SYSTEM: the card prompt has no shared confidence section');
  // The card call writes the patterns and the Overview near its end; this
  // response writes them straight after the Big Five and MBTI (structuredSchema),
  // so the two "last" rules say where they fall here instead.
  const order = [
    ['Decide them last, from everything above.', 'Decide them straight after MBTI and the Big Five, from the evidence and those scores.'],
    ['Write it last but one, after everything it sums up.', 'Write it after every section above it in your schema — the type, the scores, the patterns, what drives them, how they connect and how they work — and after the character, from all of those.'],
  ];
  let out = rules.replace(section, '');
  for (const [from, to] of order) {
    if (!out.includes(from)) throw new Error('MERGED_SYSTEM: no "' + from + '" in the card rules');
    out = out.replace(from, to);
  }
  return out;
})();

const MERGED_SYSTEM = STRUCTURED_FULL_SYSTEM + '\n\n' +
  '# Deciding the card, in the same response\n\n' +
  'This response also decides the reader\'s Psyche Card, which a separate call used to settle before this ' +
  'report was written. The rules below were written for that call and are kept word for word. They govern ' +
  'the conclusion fields — the confidence score and level, the character, the Big Five scores and bands, the ' +
  'MBTI type and letters, the lists and their order, `topMotivators`, the signature patterns, `summary`, ' +
  '`cardHighlights`, `card` and the roast (`bonus`) — and where they and the rules above differ about one of ' +
  'those fields, these win. Everything else follows the rules above. Where they speak of "the paid report", ' +
  'that is the report sections of this same response. **Decide the conclusions first and write the report to ' +
  'explain them**, exactly as if the card had been settled before you began: the report never contradicts ' +
  'the card, and `motivators` scores the three `topMotivators` highest, in that order. A field whose ' +
  'description ends "One of: …" takes exactly one of the listed values, spelled exactly as listed. ' +
  'Writing the card as well never shortens the report: `development.develop` has exactly two areas, each in ' +
  'full, and every section is as long as the rules above ask.\n\n' +
  MERGED_CARD_RULES;

// What the merged call must answer: the structured full report, the card's
// own fields (the free schema's `card`, which withCard completes) and its
// three motivators, and the roast last — every enum still in place.
const MERGED_STRICT_SCHEMA = (() => {
  const out = JSON.parse(JSON.stringify(STRUCTURED_FULL_SCHEMA));
  const props = {};
  for (const [key, value] of Object.entries(out.properties)) {
    if (key === 'card') continue;
    if (key === 'motivators') props.topMotivators = JSON.parse(JSON.stringify(FREE_TOP_MOTIVATORS));
    props[key] = value;
  }
  props.card = JSON.parse(JSON.stringify(STRUCTURED_FREE_SCHEMA.properties.card));
  props.bonus = JSON.parse(JSON.stringify(STRUCTURED_FREE_SCHEMA.properties.bonus));
  // Exactly two develop areas, held by the schema itself rather than asked
  // for: the first live merged report wrote one. Only here: a refused schema
  // sends this call back to the two calls, while the ordinary paid call has
  // no such way back, so its schema keeps asking in words.
  const develop = props.development && props.development.properties && props.development.properties.develop;
  if (!develop) throw new Error('MERGED_STRICT_SCHEMA: no development.develop');
  develop.minItems = 2;
  develop.maxItems = 2;
  // Exactly three signature patterns (October 2026), held the same way.
  if (props.patterns) { props.patterns.minItems = 3; props.patterns.maxItems = 3; }
  out.properties = props;
  out.required = Object.keys(props);
  return out;
})();

// Every enum but the character's made a plain string, its values listed.
function enumsAsDescribedStrings(schema, keep) {
  const out = JSON.parse(JSON.stringify(schema));
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum) && !keep.includes(path)) {
      const values = node.enum;
      delete node.enum;
      node.description = ((node.description || '').trim() + ' One of: ' +
        values.map(v => JSON.stringify(v)).join(', ') + '.').trim();
    }
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') walk(value, path ? path + '.' + key : key);
    }
  };
  walk(out, '');
  return out;
}
const MERGED_SCHEMA = enumsAsDescribedStrings(MERGED_STRICT_SCHEMA, ['properties.essence.properties.character']);

function mergedBlocks(digest) {
  return [{
    type: 'text',
    text: 'Here is the evidence digest for one person, built from their ' +
      sourcePhrase(digest) + ' data. Decide their Psyche Card and write their full report.\n\n' +
      '<evidence>\n' + renderEvidence(digest) + '\n</evidence>' + computedNote(digest) + marksBlock(digest),
  }];
}

// A schema node, following a local $ref.
function resolveNode(node, root) {
  if (node && typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
    return (root.$defs || {})[node.$ref.slice('#/$defs/'.length)] || {};
  }
  return node || {};
}
const enumKey = value => String(value == null ? '' : value).toLowerCase().replace(/[\s_\-–—.]+/g, '');

/**
 * The merged answer held to the strict schema. Each enum value is matched to
 * its allowed spelling, ignoring case, spaces and hyphens. One that matches
 * nothing is a problem when it is a field on its own; in a list of values (a
 * pattern's sections, say) it is dropped and noted. Resolves to
 * { ok, data, problems, dropped } — `ok` false sends the unlock back to two calls.
 */
function checkMerged(input) {
  const problems = [];
  const dropped = [];
  if (!input || typeof input !== 'object') return { ok: false, data: input, problems: ['no answer'], dropped };
  const data = JSON.parse(JSON.stringify(input));
  const root = MERGED_STRICT_SCHEMA;
  const fix = (value, allowed) => {
    if (allowed.includes(value)) return value;
    const found = allowed.find(option => enumKey(option) === enumKey(value));
    return found === undefined ? undefined : found;
  };
  const walk = (value, node, path) => {
    node = resolveNode(node, root);
    if (Array.isArray(node.enum)) {
      const fixed = fix(value, node.enum);
      if (fixed === undefined) problems.push(path + '=' + JSON.stringify(value));
      return fixed === undefined ? value : fixed;
    }
    if (node.type === 'array' && Array.isArray(value)) {
      const items = resolveNode(node.items, root);
      if (Array.isArray(items.enum)) {
        const kept = [];
        for (const item of value) {
          const fixed = fix(item, items.enum);
          if (fixed === undefined) dropped.push(path + '[]=' + JSON.stringify(item));
          else if (!kept.includes(fixed)) kept.push(fixed);
        }
        return kept;
      }
      return value.map((item, i) => walk(item, items, path + '[' + i + ']'));
    }
    if (node.properties && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(node.properties)) {
        if (key in value) value[key] = walk(value[key], child, path ? path + '.' + key : key);
      }
    }
    return value;
  };
  walk(data, root, '');
  // What a free card is never without.
  const need = (ok, what) => { if (!ok) problems.push(what); };
  need(Array.isArray(data.patterns) && data.patterns.filter(p => p && p.name).length >= 2, 'patterns: fewer than two');
  need(typeof data.summary === 'string' && data.summary.trim().length > 0, 'summary: empty');
  need(Boolean(data.bonus && typeof data.bonus.harsh === 'string' && data.bonus.harsh.trim()), 'bonus: empty');
  need(Boolean(data.card && typeof data.card === 'object'), 'card: missing');
  need(Array.isArray(data.topMotivators) && data.topMotivators.length === 3, 'topMotivators: not three');
  // The three motivators the card shows are the report's three highest. Where
  // the scores disagree, the card's choice wins and the report's scores are
  // the ones nudged: the card is what friends see.
  const scores = data.motivators && Array.isArray(data.motivators.scores) ? data.motivators.scores : [];
  if (scores.length && Array.isArray(data.topMotivators) && data.topMotivators.length === 3) {
    const rows = data.topMotivators.map(key => scores.find(row => row && row.value === key));
    const others = scores.filter(row => row && !data.topMotivators.includes(row.value));
    const ceiling = Math.max(0, ...others.map(row => Number(row.score) || 0));
    if (rows.every(Boolean)) {
      let floor = ceiling;
      for (let i = rows.length - 1; i >= 0; i--) {
        const want = Math.min(100, floor + 1);
        if ((Number(rows[i].score) || 0) < want) rows[i].score = want;
        floor = Number(rows[i].score);
      }
    }
  }
  return { ok: problems.length === 0, data, problems, dropped };
}

// Only the properties a schema names, all the way down.
function pickBySchema(value, node, root) {
  node = resolveNode(node, root);
  if (Array.isArray(value)) return node.items ? value.map(item => pickBySchema(item, node.items, root)) : value;
  if (value && typeof value === 'object' && node.properties) {
    const out = {};
    for (const key of Object.keys(node.properties)) {
      if (key in value) out[key] = pickBySchema(value[key], node.properties[key], root);
    }
    return out;
  }
  return value;
}

/**
 * The checked merged answer as the two calls would have returned it: `card`
 * exactly analyseCard's data (withCard completing the card), and `full` the
 * report as the Overview-pinned schema shapes it, for overlayCard to lay the
 * card over on the reader's device, as it does after two calls.
 */
function splitMerged(data) {
  const card = withCard({ data: pickBySchema(data, STRUCTURED_FREE_SCHEMA, STRUCTURED_FREE_SCHEMA) }).data;
  const full = pickBySchema(data, STRUCTURED_LINE_PINNED_SCHEMA, STRUCTURED_LINE_PINNED_SCHEMA);
  return { card, full };
}

module.exports = {
  CONFIDENCE_SCORING, NEUTRAL_PEOPLE_RULE, CHATS_ONLY_RULE, EXTRA_SOURCES_RULE,
  cleanReaderMarks, marksBlock,
  MERGED_SYSTEM, MERGED_SCHEMA, MERGED_STRICT_SCHEMA, mergedBlocks, checkMerged, splitMerged, pickBySchema,
  ASK_SCHEMA, ASK_SYSTEM, askBlocks, ASK_QUESTION_MAX, ASK_HISTORY_MAX, ASK_REPORT_MAX,
  MBTI_TYPES,
  LOVE_LANGUAGES,
  COMPATIBILITY_MODES,
  resolveMode,
  briefFor,
  profileBlocks,
  freeBlocks,
  renderEvidence,
  anchorFrom,
  ANCHOR_TEXT_MAX,
  compatibilityBlocks,
  derivedFacts,
  TYPE_AXES,
  PROFILE_SCHEMA,
  PROFILE_SYSTEM,
  ACCOUNT_AUDIENCE_RULE,
  ROAST_LIMIT,
  DATA_WORDS,
  CONDUCT_RULE,
  CONDUCT_RULE_REPORT,
  FREE_SCHEMA,
  FREE_SYSTEM,
  FREE_CARD_SCHEMA,
  CARD_DERIVED_KEYS,
  withCard,
  FULL_SCHEMA,
  withoutCareerFit,
  FULL_PINNED_SCHEMA,
  fullSchemaFor,
  FULL_SYSTEM,
  PREMIUM_KEYS,
  CHARACTER_CATALOGUE,
  CHARACTER_NAMES,
  CHARACTER_SIDES,
  CHARACTER_SIDE_RULE,
  CHARACTER_GENDER_RULE,
  RETIRED_CHARACTERS,
  CARD_BASE_SYSTEM,
  CARD_BASE_SCHEMA,
  STRUCTURED_SPLICES,
  MBTI_LEDGER_RULES,
  CONVERSATIONS_RULE,
  STRUCTURED_CUTS,
  STRUCTURED_FREE_SYSTEM,
  STRUCTURED_FREE_SCHEMA,
  STRUCTURED_DROPS,
  FULL_SYSTEM_BASE,
  BASE_FULL_SCHEMA,
  STRUCTURED_FULL_SYSTEM,
  STRUCTURED_FULL_SCHEMA,
  STRUCTURED_PINNED_FULL_SCHEMA,
  STRUCTURED_OVERVIEW_PINNED_SCHEMA,
  STRUCTURED_LINE_PINNED_SCHEMA,
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
