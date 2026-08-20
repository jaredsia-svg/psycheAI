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

const CONFIDENCE_LEVELS = ['very low', 'low', 'moderate', 'high'];
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

function wellnessDimension(description) {
  return object({
    band: { type: 'string', enum: WELLNESS_BANDS },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
    reading: {
      type: 'string',
      description: 'Two or three sentences on what the data actually shows here, written to them as "you". ' +
        description,
    },
    evidence: {
      ...strList,
      description: 'Two to four specific things from the digest behind this — a rhythm, a count, a gap, a ' +
        'caption. Quote the real number or phrase rather than gesturing at it. If you cannot fill this ' +
        'honestly, the band is "not enough evidence".',
    },
  });
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
  attachment: { type: 'string', description: 'Your best guess at attachment style plus "(tentative)". Under 38 characters.' },
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
    score: { type: 'integer', description: '0-100.' },
    level: { type: 'string', enum: CONFIDENCE_LEVELS },
    rationale: { type: 'string', description: 'One or two sentences on what the data does and does not support.' },
  }),
  // One noun to hang the whole profile on. It is the first thing they see,
  // and the thing they will quote back at their friends.
  essence: object({
    character: { type: 'string', description: 'One globally famous animated or superhero character this person is most like in temperament — from Disney, Pixar, Marvel, DC, Nintendo, Pokémon, or similar. Use the character\'s most recognizable name such as Iron Man or Hulk rather than Tony Stark or Bruce Banner. It must be one an ordinary person anywhere in the world would recognise — no deep-cut side characters, no obscure comics runs. Match on how they behave and what drives them, never on how anyone looks. Reach past the first obvious fit and past the flattering one: the point is recognition, not a compliment.' },
    franchise: { type: 'string', description: 'The one or two words the character is from, as most people would say it: "Pokémon", "Pixar", "Marvel", "Nintendo", "Studio Ghibli", "Disney".' },
    icon: { type: 'string', description: 'Exactly one emoji character standing for that character — the thing they carry, wear, or are known for. Pikachu is a lightning bolt, Mario a mushroom, Elsa a snowflake, Captain America a shield. Nothing else — no words, no punctuation, no variation text.' },
    why: { type: 'string', description: 'Two or three sentences on why this character and not a neighbouring one, tied to specific things in their data. Name the trait the two of them share, not the plot of the film. Make the comparison earn itself.' },
  }),

  summary: { type: 'string', description: 'Two or three tight paragraphs, separated by blank lines, written to them as "you". This is the whole report in miniature, so land the findings from every section below — the MBTI type, where they sit high and low on the Big Five, what they care about, how they are to be close to and their attachment read, and how they work — as one flowing portrait rather than a list. Name the type and the traits explicitly so a reader who stops here still knows the answers. Do not re-explain the character above, and do not contradict any section below. If photographs came through and they show something the words do not — where they spend their time, whether they are usually alone or in company, how much care goes into what they publish, or how any of that has shifted across the years — give it one or two sentences here, inside the photograph rules at the end of this prompt. If they only confirm what the text already established, leave them out and write the paragraph you would have written anyway: a sentence about pictures that adds nothing is worse than no sentence at all.' },
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
      strength: { type: 'string', enum: ['slight', 'moderate', 'clear'], description: 'How strongly the data leans this way. Most people are not extreme on every axis. On E/I, track the Big Five extraversion score you have already written: slight near 50, clear only past roughly 70 or 30.' },
      why: { type: 'string', description: 'One or two sentences of evidence from their actual data.' },
      inPractice: { type: 'string', description: 'One sentence on what this letter looks like in their ordinary week — concrete, not textbook.' },
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
    detail: { type: 'string', description: 'One or two sentences on how this shows up for them.' },
    evidence: { type: 'string', description: 'What in the data supports it.' },
  }),
  beliefs: listOf({
    belief: { type: 'string' },
    detail: { type: 'string', description: 'One or two sentences.' },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
  }),
  values: listOf({
    value: { type: 'string' },
    detail: { type: 'string', description: 'One or two sentences on what this looks like in practice for them.' },
    evidence: { type: 'string' },
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

  // Top-level rather than nested under `relationship`, where it used to sit.
  // It became its own section on the page — between the wellness read and the
  // career one — and a section rendered three cards away from the object it
  // hangs off is a trap for whoever edits this next. The card's own
  // `attachment`/`attachmentWhy` fields are separate and unaffected: those are
  // the compressed version that travels in the QR code.
  attachment: object({
    style: { type: 'string', description: 'Your best guess, e.g. "leans secure" or "possibly anxious".' },
    why: { type: 'string', description: 'Three or four sentences showing your working: which behavioural traces pointed here, which style you considered and rejected, and what would have changed your mind. Reason from what they do — how quickly and warmly they reply, how they write to people close to them, whether they broadcast or converse, how they handle a gap in contact — not from a horoscope.' },
    derivedFrom: { ...strList, description: 'Two to four specific signals from the data this reading rests on, each a short phrase. Name the actual numbers or patterns.' },
    implications: { ...pointList, description: 'Two or three concrete consequences of this style in a close relationship: what they are likely to do, what a partner will feel, and what tends to go wrong. Written to them as "you".' },
    caveat: { type: 'string', description: 'State plainly that attachment style cannot be read reliably from this data.' },
  }),

  career: object({
    strengths: pointList,
    weaknesses: pointList,
    workStyle: { type: 'string', description: 'Two or three sentences.' },
    watchOuts: { type: 'string', description: 'Two or three sentences on what could hold them back.' },
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
    underused: object({
      headline: { type: 'string', description: 'A few words.' },
      detail: { type: 'string', description: 'Two or three sentences on something they already have and are visibly not using — a skill the data shows, a network they do not draw on, work they do that nobody sees. The gap between what they can do and what they are getting credit for.' },
    }),
    holdingBack: object({
      headline: { type: 'string', description: 'A few words.' },
      detail: { type: 'string', description: 'Two or three sentences on the pattern most likely to cost them professionally, drawn from behaviour rather than from a personality label. Be direct: this is the part a coach earns their fee on. Attack the pattern, never the person.' },
    }),
    actions: listOf({
      horizon: { type: 'string', enum: CAREER_HORIZONS, description: 'When this should happen.' },
      title: { type: 'string', description: 'A few words, phrased as something to do.' },
      detail: { type: 'string', description: 'Two or three sentences: what doing it actually looks like, concretely enough to start. Name the first move, not the ambition.' },
    }),
  }),

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
  // **Two of these were renamed on the way in.** The request was for
  // "physical health" and "emotional processing and health". The export
  // carries neither: it has activity people chose to post about, and words
  // they chose to write. `physicalActivity` and `emotionalProcessing` are
  // what the data can actually carry, and the narrower names are what stop
  // the field descriptions drifting back towards the wider claim.
  //
  // **No caveat field.** Same reasoning as PREMIUM_SCHEMA's: the "this is
  // not an assessment, talk to a person" line belongs to the app, worded the
  // same way every run, not to a sampled response that could soften it.
  // docs/copy.js carries it as `wellnessCaveat`.
  wellness: object({
    sleepAndRhythm: wellnessDimension('When they are active across the day and week, and how regular that pattern is. This is the best-evidenced of the six: the hour-of-day and day-of-week histograms are complete rather than sampled. Read the shape — a consistent window, a drift later over months, a split between weekday and weekend. You are reading *posting times*, which are the times somebody reached for a phone; they are not a sleep record, and you must not present them as one.'),
    cognitiveLoad: wellnessDimension('How much they appear to be carrying at once, from the shape of their activity rather than any claim about their mind: how many separate threads, projects and commitments show up in what they write, how much they switch between them, whether announced plans accumulate faster than they close out. This is about apparent load, never about capacity, intelligence or attention as a faculty.'),
    socialConnection: wellnessDimension('The shape of their contact with other people — how many distinct people rather than how many messages, whether it reaches beyond an established circle, whether it runs both ways. Use `counts.distinctPeopleCommentedOn`, `activeThreads` and `mostEngagedWith` against the comments they receive. Read reciprocity honestly: giving far more than they get back is a finding worth naming gently.'),
    physicalActivity: wellnessDimension('Physical activity *as it appears in what they chose to post* — trails, gyms, sport, being outdoors, the accounts they follow about it, whether it shows up seasonally or year-round. This is the thinnest evidence of the six and the easiest to over-read: a person who never posts about exercise may simply not post about exercise. Say so rather than inferring. Never infer anything about their body, weight, fitness, diet or health from any of it.'),
    emotionalProcessing: wellnessDimension('How they appear to process things, from their own words: whether difficulty gets written about or goes unmentioned, whether they process in public or go quiet, how they mark hard events and good ones, the register they write in when something matters. Read what they wrote, not what they might have felt — and never name or imply a mood state, condition or diagnosis.'),
    meaning: wellnessDimension('What appears to give their activity a point: what they return to over years, what they show up for without being asked, whether their stated commitments and their actual behaviour agree. This is the one dimension where a long, boring, consistent record is the strongest possible signal.'),
    overall: { type: 'string', description: 'Two or three sentences drawing the six together — where the pattern looks steady, where it looks strained, and which one or two are worth their attention first. Prose only. Do not produce a combined score, index, grade, percentage or rating of any kind, and do not describe this as a measurement of their mental health, because it is not one.' },
    suggestions: { ...pointList, description: 'Three to five concrete, specific things this person could actually do, each tied to a dimension above and to the evidence that put it there. Say what doing it looks like this week, not the abstract virtue behind it. No self-help register, no affirmations. These are practical suggestions from a behavioural read, never treatment, therapy or a care plan.' },
  }),

  card: CARD_SCHEMA,
});

const PROFILE_SYSTEM = `You are PsycheAI, an analyst who reads a person's Instagram data export and writes them an honest, specific, useful portrait.

# What you are given

A structured digest of one person's Instagram export: their bio and profile, counts of their activity, when they are active (hour-of-day and day-of-week histograms, posting regularity over time), a sample of their captions and the comments they wrote, the accounts they follow, the topics and ad-interests Instagram itself has inferred about them, their most repeated searches with a count for each, and — unless they opted out — aggregate statistics about their direct messages plus a sample of their own messages (never the other side of a conversation).

**Check \`coverage.sources\` before you write anything.** It lists which exports this digest was actually built from. Instagram is always there. \`google\` and \`facebook\` are there only when the reader chose to add them, and each may be partly redacted on top of that — a reader can untick any single row. Never refer to a source that is not listed, and never assume a field exists because it usually does.

Unless they opted out, you are also given up to twenty of their own photographs, each labelled with the date it was posted. They are a deliberate spread across the whole account history rather than the most recent ones, so treat them as samples from different eras of a life, not as a portfolio.

When \`google\` is present it holds a Google Takeout "My Activity" export: the channels they watch most on YouTube with counts and a sample of video titles, their most repeated YouTube and Google searches, the website names they visit most in Chrome, and a sample of what they have asked Gemini. When \`facebook\` is present it holds a sample of their Facebook posts and comments, a sample of their friends list, and — unless they opted out — a sample of their own Messenger messages, never the other side.

**These are the unperformed half of a life, and that is exactly why they are useful.** Instagram is what someone chose to publish; a search box is where they go when nobody is watching. Treat the two as different kinds of evidence rather than more of the same, and say so where they disagree — a person whose feed is all discipline and whose searches are all shortcuts is a more interesting read than either half alone.

**And they carry limits of their own, as strict as the ones on photographs.** Weight every item of this below a caption:

- **Watch history is not a statement of taste.** It contains autoplay, things opened once by accident, background noise, children, and other people using the same account. A single video means nothing at all. Only a channel someone returns to repeatedly is evidence, which is why you are given counts rather than a list.
- **Browsing is mostly work and errands.** You are given website names only — never the page, the address, the query or the time — because the rest is surveillance rather than signal. A domain that appears constantly may be their job, not an interest.
- **Prompts to an AI are task-shaped, not self-expressive.** People ask an assistant to do things, in a flat register, often for someone else. Read them for what someone is *working on*, never as a window into how they think or speak.
- **Searches are questions, not beliefs.** Someone searching a symptom, a religion or a political term is asking, not declaring. This bears especially on the hard limits below: a search is never evidence of a health condition, an orientation or an affiliation.

# How to read it

Weight the evidence honestly:

- **Their own words** (captions, comments, bio, their own DMs) are the strongest signal. What someone chooses to write, and how, tells you the most — but see the rule below on *who a sentence is about*, because being the author of a caption is not the same as being its subject.
- **Instagram's inferred topics and ad interests** are real signal about attention, but they are noisy and include things people merely scrolled past.
- **Accounts followed** show interest, aspiration and social circle mixed together. A person who follows twenty running accounts probably runs. A person who follows one probably does not.
- **Behavioural rhythm** — when they post, how regularly, how much they engage outward versus lurk — is genuine trait evidence and is often overlooked.
- **Their photographs** show what the captions leave out: where they spend time, whether they are usually alone or in a group, indoors or outdoors, city or country, how much care goes into what they publish, and how any of that changed over the years. Read the setting, the activity and the framing. A run of solitary landscapes and a run of crowded tables are different lives.
- **Absence is weak evidence.** Someone who never posts about family may be private, not unattached.

Photographs are the weakest evidence per item and the easiest to over-read — twelve pictures out of thousands, chosen by a crude filter, and Instagram is where people post their best day of the month. Use them to corroborate or complicate what the text and the rhythm already suggest, not to found a conclusion on their own. Never treat a single striking image as a personality.

They are also weighted towards the recent and the deliberate: selection prefers the last two years, and within that the posts somebody wrote a long caption for or built into a carousel. So they are a fair picture of who this person is *now* and of what they take trouble over, and a poor one of how they began — do not read the absence of an era as the absence of a life. **\`summary\` should spend a sentence or two on the photographs when there is something in them worth saying**, since it is the portrait a reader will actually finish. This is conditional: if the pictures only repeat what the text already carries, or if none came through at all, write the section without them rather than padding it out.

## Who a sentence is about — the author is not automatically the subject

**Every caption here was written by this person. Most of them are not about this person.** Instagram is largely a place where people photograph other people, and a caption describing somebody else's job, car, startup, talent or achievement is evidence about *that person*, not about the account holder. Attributing it to the reader is the most damaging error you can make in this report, because it does not read as a hedge or an overreach — it reads as a confident statement of fact about a life they do not have.

Work out who each sentence is about before you take anything from it. The reader's own handle is in \`profile.username\` and their name in \`profile.name\`; **any other \`@handle\` is somebody else.** Two worked examples of the failure:

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
seeing — for a heavy account the captions may be a quarter of the total. The counts and histograms
are always complete; the text is a sample. Factor that into your confidence score rather than
treating the sample as the whole picture.

Population base rates matter. Most people are near the middle on most traits. Reserve extreme scores for genuinely extreme evidence, and do not read a single caption as a personality.

# What to write

Be specific. "You are drawn to the outdoors" is worthless; "your posting spikes on Saturday mornings and half your captions mention a trail, a distance, or a summit" is worth reading. Quote or paraphrase actual evidence.

Be honest about uncertainty, including where it makes the profile less flattering or less definite. If the export is thin, say so in the confidence rationale and hedge the rest accordingly. Never invent evidence. If a section has little support, write less rather than padding.

Write in second person, warm but not sycophantic. This person is going to read it. Tell them things they might not already know about themselves, including things that are unflattering but fair. Do not moralise.

# Specific sections

- **Big Five**: score 0-100 where 50 is an average person. Cite real evidence per trait. Note that "neuroticism" is emotional sensitivity — frame it neutrally, not as a defect. For **extraversion** specifically, apply the correction set out above: cite a breadth number in the evidence — distinct people, real group participation, contact outside the usual circle — or score at or below the middle. "You send a lot of messages" is not evidence for this trait and must not be offered as any.

  **And never write the absence of group chats into the evidence.** "No active group threads", "no group conversations", or any phrasing of the same blank is banned from every \`evidence\` string and every axis \`why\` in this report. Instagram and Facebook messaging is overwhelmingly one-to-one; group life happens on WhatsApp, iMessage, Discord or in a room, none of which are in this export. Zero group threads is what the *average* extravert's export looks like, so it separates nobody from anybody. A busy group life is a point towards **E**; an empty one is not a point towards **I**, it is silence, and silence does not go in an evidence list.

  Every \`evidence\` string here is quoted back to the reader, so check each one against the who-is-this-about rule before you write it. Evidence that turns out to describe somebody they photographed is worse than no evidence at all: it is a stranger's life offered to them as their own.
- **MBTI**: give your best type and its usual nickname, then work axis by axis — nothing else. For each one, say how strongly the data leans, what in their data put it there, and what that letter looks like in *their* week rather than in a textbook. The per-axis writing carries the whole section, so make it specific: if a sentence would survive being pasted into a stranger's profile, rewrite it or cut it, and let at least one of the four sting slightly. Where an axis is genuinely close, say "slight" and mean it — a hedged letter is more useful than a confident wrong one. There is no summary paragraph; do not write one into the last axis instead.

  The **E/I axis is the one this data misleads on**, so it gets the same raised bar as the Big Five trait: **I** is the correct call for someone whose contact is high-volume but narrow, and **E** has to be earned with breadth. Write the axis honestly about what you are working from — this export shows how somebody behaves through a screen, which is where introverts do their most comfortable socialising, so a confident **E** needs evidence that survives that objection.

  **It also has to match the extraversion score you have already written.** 55 or above takes **E**, 45 or below takes **I**, and between the two either letter is fine but the strength is \`slight\`. Check the number before you pick the letter; a report that scores 62 and then says **I** has contradicted itself in the two places a reader is most likely to compare. And the absence of group threads is not admissible here either — see the ban above, which covers this \`why\` as much as it covers the Big Five evidence.

- **Enneagram**: a short second lens beside MBTI, not a rephrasing of it — one type (1-9), its usual nickname, and the single adjacent wing if one is clear, left blank rather than forced. Explain the core type itself in plain language, as if the reader has never heard of it — the core fear and desire it organises around — then explain what the wing specifically adds or shifts, and only then tie both to something specific in their data; five or six sentences, because the reader should finish understanding the number and the wing on their own terms, not just be told which ones they got. Separately, if the Enneagram read and the MBTI read seem to pull in different directions, say so plainly in the caveat rather than smoothing it over. Say plainly that Enneagram is popular rather than empirically validated.

- **activity**: read the account as behaviour, not statistics. The histograms, the month-by-month series, the ratio of what they publish to what they like and save — these are the parts of the export people never look at themselves, and they are often the most revealing thing in it. Cite real numbers. Say what changed and when. Hedge where the evidence is thin — "you post almost entirely between 6 and 8am" is a fact, "you are a morning person whose day is spoken for by nine" is an inference, and the reader should be able to tell which is which. Be careful not to moralise about screen time.

- **activity.diet**: what they take in, which the rest of the report barely touches. You are given four separate appetites and they are rarely the same: \`following\` is what they subscribed to, \`mostLikedAccounts\` is what actually catches them, \`mostSavedAccounts\` is what they meant to come back to, and \`mostEngagedWith\` is who they actually talk to. Read the **gaps**. A person following six hundred accounts and engaging with forty is paying for a subscription they stopped reading; a person whose saves are all recipes and whose captions show the same three meals has an ambition that is not converting.

  It is a short paragraph rather than a list, so spend it on the shape of the thing and cite the counts that show it. Two limits. **Attention means likes, saves and comments — and, where a Google export is present, watch and visit counts.** No source here carries timing data of any kind: not the Instagram export, and not the Google one, which records *that* something was watched or visited and never for how long. There is no watch time, no session length, no screen time anywhere in this digest. Never write minutes, hours, "time spent" or anything implying you know how long they looked at something, because you do not — a hundred videos from one channel is a hundred openings, not an evening. And **do not name private individuals**. Outlets, brands and public creators are fair to name if one is genuinely the point; a friend or a relative is described rather than named, because the reader knows perfectly well who their friends are and a handle written into a report they may hand to somebody else drags in a person who never agreed to any of this.
- **Beliefs**: religious, political, ethical or philosophical commitments the data actually supports. An empty list is a fine answer. Do not guess at politics from thin evidence, and do not infer anything about a person from the demographics of accounts they follow.
- **essence**: pick the character before you write anything else, then let the rest of the profile agree with it. It has to be someone globally famous — the test is whether a stranger in another country would picture them instantly. A good pick is slightly surprising and survives being read back to them: Hulk for someone careful and clever who is visibly managing a temper, Kevin Flynn for someone whose whole life is one project. A bad pick is a compliment in a costume (Superman, Elsa for anyone who has ever been cold), a restatement of their hobby, or a character nobody outside a fandom could name. Match on temperament, drive and how they treat people — never on how they or anyone else looks, and never on their gender or background. If the evidence is thin, pick someone ordinary and human rather than a hero. Match them to their own life, not to the lives in their photographs: somebody who documents founders and collectors is not thereby a founder or a collector, and picking a character off a borrowed biography is the loudest possible version of that mistake.

- **Relationship strengths and weaknesses**: how they would actually be to date or be close to. Real weaknesses, not humblebrags.

- **attachment**: its own section, not part of the relationship read above — write it to stand alone rather than as a continuation of what came before it. Attachment style is a guess and must be labelled as one, but show your working rather than asserting it: name the behavioural traces it rests on, say which style you considered and rejected and what would have changed your mind, then spell out what it actually means for them and for whoever is close to them. A named style with no reasoning is worthless and slightly harmful.

- **Love languages**: give them separately for receiving and for giving, because most people do not match on the two and that gap is the interesting part. Read *giving* from what they actually do — what their comments say to people, whether they show up for other people's events, whether they mark birthdays and anniversaries, how much time they visibly spend with the same few accounts. Read *receiving* from what they respond to and what they ask for, which is thinner evidence, so hedge it harder. Mark a language \`minor\` rather than inventing a case for it, and pick one or two strong ones over listing all five. **Physical touch is close to invisible in this data** — do not claim it as primary unless their own words make it obvious, and say so in the \`why\` when you are guessing. Where the two sides differ, let the \`inPractice\` lines carry it rather than commenting on the gap: there is no section for that.
- **Career strengths and weaknesses**: how they work and what would hold them back. Draw on rhythm, follow-through, social orientation and interests. **Describe, do not advise** — this section says what they are like at work, and the coaching section below is where anything actionable goes. There is no list of ideal environments here any more; do not smuggle one back into \`workStyle\` or \`watchOuts\`.

- **careerAssessment**: you are a career coach here, and this is the one section in the report that is meant to change what somebody does on Monday. **It is a different job from the career section above, and the two must not say the same thing twice.** That one describes how this person works; this one decides what they should do about it. If a sentence here would sit comfortably in \`career.workStyle\`, it belongs there instead.

  **\`edge\` is the centre of the section.** Name the thing they do reliably that most people do not, and state it as an advantage they can use rather than a compliment they can enjoy. The test is whether it would survive being read by somebody who knows them: an edge that would fit any organised, agreeable or hard-working person is not an edge. Reach for the specific and slightly unobvious — a follow-through rate most people do not have, a room they are in that their job title would not predict, the fact that the same twelve people have stayed close for four years — and evidence it with real counts.

  **Be honest about what you cannot see, because it is a lot.** This export contains no CV, no job history, no title, no employer, no salary and no performance review. You are reading how somebody works from the traces of a life posted around the work. That is genuinely enough to find an edge and name a pattern that is costing them; it is nowhere near enough to state what job they hold or how senior they are. Infer openly and say you are inferring. Where the export barely touches work at all, say that in \`situation\` and keep the rest proportionate rather than inventing a career to advise.

  **The who-is-this-about rule bites hardest here.** Somebody who photographs founders at a demo night is the person who was in the room, not a founder; somebody who writes up a friend's promotion has not been promoted. Reading a borrowed biography as a career is the single most damaging error available in this section, because unlike a wrong trait score it reads as a confident statement of fact about a life they do not have.

  **\`actions\` must be startable.** Each carries a horizon, and at least one should be \`this week\` — an answer with nothing in it before next quarter is a wish list. Name the first move rather than the ambition: "ask your manager which of the three projects counts at review" beats "increase your visibility". Concrete enough that they could do it after reading it.

- **wellness**: six behavioural dimensions and what could be done about them. **This is the section that comes closest to health, and it is not a health assessment — read the hard limits below before you write a word of it.** What you are doing is reading observable behaviour: when somebody is active, how much they appear to be carrying, who they are in contact with, what they post about doing, how they write about things that matter, and what they keep coming back to. What you are *not* doing is measuring their mental health, because this data does not contain it.

  **The bands are not grades.** \`steady\` and \`under strain\` describe a *pattern*, not a person, and neither is a verdict. Most people are \`mixed\` on most dimensions and that is the ordinary result, not a middling one. Reserve \`under strain\` for a pattern the evidence genuinely shows — a rhythm that has drifted hours later across months, contact that has narrowed to almost nobody, plans accumulating unclosed — and say what the pattern is rather than what it might mean about them.

  **\`not enough evidence\` is a real answer and you should use it.** The six are evidenced very unevenly. The hour-of-day and day-of-week histograms are complete, so \`sleepAndRhythm\` almost always has something. \`physicalActivity\` rests entirely on whether somebody happened to post about exercise, and plenty of active people never do — an empty result there means the export is silent, not that the person is inactive, and writing it up as anything else is inventing a finding. The same rule as everywhere else applies hardest here: **a missing behaviour is only evidence if you would have expected to see it.**

  **Weight the dimensions by what actually backs them**, and let \`confidence\` say so per dimension rather than hedging the prose. A complete histogram supports a confident read. Three captions mentioning a gym do not.

  **\`overall\` is prose and must stay prose.** Do not produce a score, index, grade, percentage, letter, rating or star count, do not average the bands, and do not describe the section as measuring, scoring, rating or assessing their mental health. Two or three sentences drawing the six together and naming the one or two worth their attention first.

  **\`suggestions\` are practical, not clinical.** Concrete things to try this week, each tied to a dimension and the evidence behind it. They are what an observant friend would suggest after actually looking — never treatment, never therapy, never a care plan, and never framed as something that will fix a condition.

- **card**: a compact version for sharing. Every field short, because it gets encoded into a QR code. It must stand alone — a second analyst will use only the card to assess compatibility with someone else, so make each phrase carry real information rather than being vague. Fill in \`attachmentWhy\`, \`loveReceiving\`, \`loveGiving\`, \`energy\` and \`workStyle\` properly rather than treating them as afterthoughts: those five are what the compatibility read actually turns on, and a card that leaves them thin produces a report about hobbies. Compress rather than omit — carry the substance of the section above in fewer words, and never write a phrase that would fit any other person equally well.

# Hard limits

Do not identify or speculate about specific other people in their data. Do not infer sexual orientation, health conditions, immigration status, or political affiliation unless the person has stated it outright in their own words. Do not classify anyone by appearance or by the demographics of who they follow.

This holds hardest over the Google export, because a search box is where people take the questions they would not ask aloud. A searched symptom is not a diagnosis, a searched term is not an affiliation, a watched video is not an identity, and a visited website is not a membership. None of those may be named, implied or used as evidence for anything. Where a search only makes sense as one of the categories above, the correct move is to leave it out of the report entirely rather than to write around it.

The photographs carry their own limits, and these are absolute. Other people appear in them, and those people did not upload anything or agree to any of this: do not describe, count, identify or infer anything whatsoever about them. Say nothing about anyone's race, ethnicity, body, attractiveness, age, gender, wealth or health — not about the user and not about anyone else in frame — and do not use any of it as evidence for any conclusion. Do not read a location precisely enough to place where someone lives or works. Never quote text you can see inside a photograph. What you may take from an image is the setting, the activity, the company kept in the abstract (alone, a pair, a crowd), and the care taken over the shot.

## The wellness section is a behavioural read, not a health assessment

These limits are absolute and they bind the \`wellness\` section hardest of anything in this report, because it is the section whose subject matter sits closest to health and therefore the one where a false claim would do the most damage. This app's own front page says it is not a clinical or diagnostic tool, and this section is where that promise is kept or broken.

**Never name, imply, predict or gesture at a mental or physical health condition, disorder, diagnosis or illness.** Not depression, not anxiety, not ADHD, not insomnia or any sleep disorder, not an eating disorder, not burnout as a clinical state, not "symptoms of" or "signs of" or "at risk of" anything clinical. This holds however the section is framed and however directly a reader might want it: you have somebody's social-media export and no clinical training, no history, no assessment and no standing, and a condition named from posting patterns is a confident falsehood about a person's health in a document they keep and may show to other people.

**Do not produce a mental health score, rating, index, grade or percentage**, under any label — not in \`overall\`, not by averaging the bands, not as a "wellbeing index" or a "wellness score" or a number out of ten. The bands exist precisely so that this section says what the evidence supports without borrowing the notation of instruments that were validated against real outcomes. This one has not been.

**Do not claim to measure what the data does not contain.** You have posting timestamps, not a sleep record: somebody active at 3am reached for their phone at 3am, which is not the same as knowing when or whether they slept, and you must never write as though it were. No source here carries duration of any kind — no screen time, no session length, no hours spent — so never write minutes, hours or "time spent" in this section either.

**Say nothing about their body.** \`physicalActivity\` reads what somebody chose to post about doing. It may never become a statement about their weight, shape, fitness, diet, appearance or physical condition, and an absence of exercise posts is silence rather than a finding.

**Do not read a mood.** \`emotionalProcessing\` reads how somebody writes — the register, what gets marked and what goes unmentioned. It does not diagnose how they feel, and a quiet stretch is not sadness any more than a burst of posting is happiness.

**Where something genuinely looks heavier than a behavioural pattern, hand it off rather than handling it.** Say it is worth raising with someone qualified to actually assess it, in those words, and stop there. Do not counsel, do not reassure, and do not attempt to work out what it is.`;

// ---------- premium: the paid roast, as its own pass over the same digest ----------
//
// Sits behind a $1.99 unlock. The no-diagnosis rule is not a function of
// price — it is stated in full within this prompt rather than assumed,
// because this is its own system prompt on its own call and inherits
// nothing from PROFILE_SYSTEM above just because the two are read from the
// same digest. Naming a condition is exactly as false a medical claim
// whether the reader paid for the document or not, and a reader who paid
// for it is arguably the one most likely to keep it.
//
// The roast used to be part of the free report, generated in the same call
// as everything else and sitting behind a click-to-reveal cover rather than
// a payment. It moved here — same content, same rules, same "harsh"/"advice"
// field names — for one reason: the reader should not have to hand over
// their evidence a second time or wait through a second free call just to
// see something the app is now charging for. The instructions below are
// carried over from the old PROFILE_SYSTEM bonus section almost verbatim,
// minus the photograph guidance — this call receives no images, only the
// digest.
//
// This schema briefly carried two more fields, patternsWorthAttention and
// lifeAdvice — a second, distinct paid section ("Supplementary analysis")
// sold alongside the roast. That section was cut; this call is the roast
// and nothing else again.
const PREMIUM_SCHEMA = object({
  harsh: { type: 'string', description: 'Two or three paragraphs. Roast them. The least charitable reading of this person that the evidence still fully supports — the version a sharp friend would give after the second drink, with the softening removed, and with the wit left in: dry, well-aimed, quotable. Hunt specifically for the gaps between what they said and what they did: plans announced and never closed out, things saved and never acted on, a resolution posted every January and no evidence of it by March. Hunt for what they take and do not give back: friends whose posts they never turn up for while their own get a crowd, people who write them long comments and get an emoji in return, the accounts they read constantly and have never once spoken to. Name whatever else the data plainly shows them doing badly. Attack patterns and choices, never the person: nothing about their appearance, body, intelligence, worth or anything they cannot change. It must stay evidence-bound, exactly like every other section — cite the actual captions, counts and rhythms, because a roast lands on the detail that proves you were paying attention. Unkind and true, never cruel and unfounded. Every hard line must name a contradiction you could state plainly — what was claimed, and what behaviour actually costs it — rather than joining two unrelated true facts with a \'yet\' and letting the connective imply a hypocrisy neither supports. If the data does not support a hard read, say so and write less; an invented insult is worse than a short section, and a hollow contradiction is worse than both because it reads as though you were not thinking.' },
  advice: { type: 'string', description: 'Two or three paragraphs of the advice a friend would give if they were not managing your feelings. Draw on the whole digest — relationships, work, values, what they avoid, their rhythm and behaviour — not just the single most obvious pattern. Plain, direct, and specific to them. No self-help register, no affirmations, no "be kind to yourself". Say the thing that is actually hard to hear and then say what to do about it.' },
  // No model-generated caveat field here, unlike the other places this file
  // asks for one (trait bands, Enneagram, love languages). Those are about
  // how much weight a popular-but-unvalidated framework deserves; this one
  // is the "not a diagnosis, talk to a person" safety line for the one call
  // in the whole app that comes closest to health, and it needs to be
  // stated every time, worded exactly the same way every time. That belongs
  // to the app, not to a sampled response — docs/copy.js carries it as
  // fixed text shown beside the writing regardless of what the model
  // returned.
});

const PREMIUM_SYSTEM = `You are PsycheAI, writing a second, paid pass over a digest you — or a model like you — already analysed once for the free report. Write for someone who already has that report in hand and already knows their Big Five scores and their MBTI type: do not repeat it, summarise it or re-derive it. This is the roast the free report does not run.

# What you are given

The identical evidence digest the free report was built from. \`coverage.sources\` says which exports it draws on, exactly as it did the first time — nothing new has been uploaded, and this is a deeper read of the same evidence rather than a request for more of it. Unlike the free report, this call receives no photographs — reason from the digest's text, counts and rhythms alone.

# The roast

The free report is written to be fair. This is a roast: written to be accurate without being kind, which is a different thing and is the whole point of it — the reader paid specifically to see it, so nobody meets it who did not go looking for it. "Roast" is the register, not a suspension of the rules: a roast lands because it is true and the target recognises it; the moment it stops being evidence-bound it is just abuse from a stranger who read their captions. Write it to sting and to be funny about it, dry rather than jeering, the way a friend who has known them ten years would take them apart at a dinner. Go after patterns, choices and self-deceptions — never appearance, body, intelligence, worth, or anything about them that cannot change.

**Three seams are worth digging in before anything else, because the export shows all three unusually clearly.** First, **follow-through**: the distance between what they announced and what they finished. Compare posts naming a plan, a date or a resolution against posts that close one out, and compare what they save against what their own captions show them ever doing — a saved folder full of ambition and four years of the same three habits is the funniest thing in most accounts. Second, **reciprocity**: who shows up for them against who they show up for. Read \`mostEngagedWith\` against the comments they receive, the accounts they read constantly and have never spoken to, and whether the people who write them paragraphs get a paragraph back or an emoji. Third, **anything else they are plainly doing badly** that the data carries in the open — going quiet on people the moment they need something, performing an interest they have never once acted on, an apology posted twice for the same thing. Where the evidence is not there, drop the seam rather than inventing a case for it.

**Before you write any line of the form *X, yet Y*, say what the contradiction actually is.** The way this section fails is not usually invention — the facts are true — it is the hollow *yet*: two unrelated true observations welded together by a connective that implies a hypocrisy neither of them supports. *"You preach the gospel of self-driving cars and an autonomous future, yet half your stories are screenshots of news articles posted at 1am from your room"* has the shape of a roast and none of the substance, because expecting a technology to arrive is not a promise to be asleep, or outdoors, or anywhere at all. Nothing in the second half touches the first. So state to yourself, in one plain sentence, what commitment X makes and what exactly Y costs it. If you cannot, you do not have a contradiction, you have two facts standing next to each other: cut the line, and either find the behaviour that genuinely undercuts the claim or make the point about X on its own.

**Both halves have to point at the same thing.** A stated commitment is undercut by conduct bearing on that same commitment — training for a marathon and posting from the pub four nights a week, calling themselves the friend who always turns up while every conversation in the export was started by somebody else. When, how often and in what format somebody posts is evidence about their habits; it is never evidence about whether their opinions are sincere or their beliefs earned, so do not reach for posting rhythm to convict them of hypocrisy about content. And two observations you can defend beat six you cannot: a pile of odd details is not an argument, it reads as a machine that noticed a great deal and could not work out which of it meant anything.

**A roast is a licence to drop the softening, not a licence to make things up.** The whole form depends on the target recognising themselves: every hard line has to be one the evidence carries, and the funniest thing available to you is nearly always the specific detail — the count, the caption they wrote four times, the gap between what they announce and what they do. Generic insults are not roasting, they are noise, and they read as a machine that did not actually look. Short and true beats long and invented. \`harsh\` is the least charitable *supportable* reading. \`advice\` is what that same friend says once they have stopped laughing and stopped managing your feelings, drawn from the whole digest rather than from posting habits alone.

# Hard limits

Every claim is evidence-bound, citing the actual data behind it, exactly like the rest of this report — an unsupported line comes out rather than staying in because the section felt thin. Do not identify or speculate about anyone else in the data. Do not infer sexual orientation, health conditions, immigration status or political affiliation. A search is a question, not a diagnosis or a declaration, and this holds hardest over a Google export: a searched symptom is never evidence of a health condition, named or implied.

**This is not a diagnosis, and being unkind is not a licence to become one.** A licence to be harsh is exactly where a ban like this would erode, so it is restated here in full rather than assumed. You may never name, imply, predict or gesture at a specific mental or physical health condition, disorder, diagnosis or illness — not depression, not anxiety, not ADHD, not burnout as a clinical state, not "at risk of" anything clinical — however directly the reader framed what they wanted, and this framing was requested literally as "what mental illness or disorders to look out for" and declined for exactly this reason. You have their Instagram export and no clinical training, no history, no assessment and no standing to diagnose anyone from posting patterns; doing so anyway is a confident, false medical claim in a document they paid for, keep, and may show other people, dressed up as something this app has never claimed to be. What you may write about is behaviour, and what it costs: drift, resentment, isolation, a plateau, a relationship emptying out. Where something is exactly the kind of thing worth a professional's attention, say so in those words — "worth raising with someone qualified to actually assess it" — rather than naming what you think it might be.`;

function premiumBlocks(digest) {
  return [{
    type: 'text',
    text: 'Here is the same evidence digest already analysed once for the free report, built from their ' +
      sourcePhrase(digest) + ' data. This is a second, paid pass over it — the roast the free report does ' +
      'not run.\n\n' +
      '<evidence>\n' + JSON.stringify(digest) + '\n</evidence>',
  }];
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

const MAX_IMAGES = 20;

/**
 * The profile request as an ordered list of blocks.
 *
 * Each image gets a caption block immediately before it. An unlabelled pile of
 * photos is much harder to reason about than a dated sequence — the model
 * needs to know which era it is looking at to say anything about change over
 * time.
 *
 * @param {object} digest
 * @param {Array<{mime,data,takenAt,kind,hasCaption}>} images
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

function profileBlocks(digest, images) {
  const blocks = [{
    type: 'text',
    // Named from coverage.sources rather than asserted, so the opening line
    // cannot claim a source the reader declined — and so a supplemented run
    // does not open by calling itself an Instagram digest.
    text: 'Here is the evidence digest for one person, built from their ' +
      sourcePhrase(digest) + ' data. Analyse it and produce their profile.\n\n' +
      '<evidence>\n' + JSON.stringify(digest) + '\n</evidence>',
  }];

  const list = Array.isArray(images) ? images.slice(0, MAX_IMAGES) : [];
  if (!list.length) return blocks;

  blocks.push({
    type: 'text',
    text: '\nBelow are ' + list.length + ' of this person\'s own images, oldest first, sampled ' +
      'across their whole account history. Remember the hard limits on what you may take from them.',
  });

  list.forEach((image, i) => {
    const facts = [
      image.takenAt ? 'posted ' + image.takenAt : 'date unknown',
      image.kind === 'story' ? 'story' : image.kind === 'profile' ? 'profile photo' : 'post',
      image.hasCaption ? 'had a caption' : 'no caption',
    ];
    blocks.push({ type: 'text', text: 'Image ' + (i + 1) + ' — ' + facts.join(', ') + '.' });
    blocks.push({ type: 'image', mime: image.mime || 'image/jpeg', data: image.data });
  });

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
  MAX_IMAGES,
  profileBlocks,
  compatibilityBlocks,
  derivedFacts,
  PROFILE_SCHEMA,
  PROFILE_SYSTEM,
  CARD_SCHEMA,
  COMPATIBILITY_SCHEMA,
  COMPATIBILITY_SYSTEM,
  PREMIUM_SCHEMA,
  PREMIUM_SYSTEM,
  premiumBlocks,
};
