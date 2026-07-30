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

// ---------- the shareable card ----------
//
// This is the part that gets compressed into the QR code, so every field is
// deliberately short. It has to carry enough for a second model call to reason
// about compatibility without the original export.

const CARD_SCHEMA = object({
  name: { type: 'string', description: 'Their first name or handle. Under 24 characters.' },
  headline: { type: 'string', description: 'One short phrase capturing who they are. Under 80 characters.' },
  summary: { type: 'string', description: 'Two sentences. Under 320 characters.' },
  mbti: { type: 'string', enum: MBTI_TYPES },
  bigFive: object({
    openness: { type: 'integer' },
    conscientiousness: { type: 'integer' },
    extraversion: { type: 'integer' },
    agreeableness: { type: 'integer' },
    neuroticism: { type: 'integer' },
  }),
  interests: { ...strList, description: 'Up to 8 short interest labels, two or three words each.' },
  values: { ...strList, description: 'Up to 5 short value labels.' },
  beliefs: { ...strList, description: 'Up to 3 short belief labels. Empty array if the data does not support any.' },
  relationshipStrengths: { ...strList, description: 'Up to 3 short phrases.' },
  relationshipWeaknesses: { ...strList, description: 'Up to 3 short phrases.' },
  careerStrengths: { ...strList, description: 'Up to 3 short phrases.' },
  careerWeaknesses: { ...strList, description: 'Up to 3 short phrases.' },
  attachment: { type: 'string', description: 'Your best guess at attachment style plus "(tentative)". Under 40 characters.' },
  rhythm: { type: 'string', description: 'Their daily and social rhythm in a few words. Under 60 characters.' },
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
    character: { type: 'string', description: 'One globally famous animated or comic-book character this person is most like in temperament — from Disney, Pixar, Marvel, DC, Nintendo, Pokémon, Studio Ghibli, Looney Tunes, Peanuts, The Simpsons or similar. Just the name: "Pikachu", "Mario", "Elsa", "Woody", "Bruce Banner", "Totoro". It must be one an ordinary person anywhere in the world would recognise — no deep-cut side characters, no obscure comics runs. Match on how they behave and what drives them, never on how anyone looks. Reach past the first obvious fit and past the flattering one: the point is recognition, not a compliment.' },
    franchise: { type: 'string', description: 'The one or two words the character is from, as most people would say it: "Pokémon", "Pixar", "Marvel", "Nintendo", "Studio Ghibli", "Disney".' },
    icon: { type: 'string', description: 'Exactly one emoji character standing for that character — the thing they carry, wear, or are known for. Pikachu is a lightning bolt, Mario a mushroom, Elsa a snowflake, Captain America a shield. Nothing else — no words, no punctuation, no variation text.' },
    why: { type: 'string', description: 'Two or three sentences on why this character and not a neighbouring one, tied to specific things in their data. Name the trait the two of them share, not the plot of the film. Make the comparison earn itself.' },
  }),

  summary: { type: 'string', description: 'Two or three tight paragraphs, separated by blank lines, written to them as "you". This is the whole report in miniature, so land the findings from every section below — the MBTI type, where they sit high and low on the Big Five, what they care about, how they are to be close to and their attachment read, and how they work — as one flowing portrait rather than a list. Name the type and the traits explicitly so a reader who stops here still knows the answers. Do not re-explain the character above, and do not contradict any section below.' },
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
      choice: { type: 'string', description: 'The single letter you picked.' },
      strength: { type: 'string', enum: ['slight', 'moderate', 'clear'], description: 'How strongly the data leans this way. Most people are not extreme on every axis.' },
      why: { type: 'string', description: 'One or two sentences of evidence from their actual data.' },
      inPractice: { type: 'string', description: 'One sentence on what this letter looks like in their ordinary week — concrete, not textbook.' },
    }),
    caveat: { type: 'string', description: 'One or two sentences on how much weight to put on this, including that MBTI is popular rather than validated.' },
  }),

  // Behavioural read of the account itself: the rhythm, the trajectory, and
  // how outward- or inward-facing it is.
  activity: object({
    summary: { type: 'string', description: 'Two or three sentences describing how this person uses Instagram, as a behaviour rather than a statistic.' },
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
    engagement: object({
      headline: { type: 'string', description: 'A few words on how outward-facing they are.' },
      detail: { type: 'string', description: 'Two or three sentences comparing what they publish against what they like, save and comment on — broadcaster, participant or lurker, and how widely they spread their attention.' },
    }),
    blindSpots: { type: 'string', description: 'One or two sentences on what this behavioural read cannot see, given what is and is not in the export.' },
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
    attachment: object({
      style: { type: 'string', description: 'Your best guess, e.g. "leans secure" or "possibly anxious".' },
      why: { type: 'string', description: 'Three or four sentences showing your working: which behavioural traces pointed here, which style you considered and rejected, and what would have changed your mind. Reason from what they do — how quickly and warmly they reply, how they write to people close to them, whether they broadcast or converse, how they handle a gap in contact — not from a horoscope.' },
      derivedFrom: { ...strList, description: 'Two to four specific signals from the data this reading rests on, each a short phrase. Name the actual numbers or patterns.' },
      implications: { ...pointList, description: 'Two or three concrete consequences of this style in a close relationship: what they are likely to do, what a partner will feel, and what tends to go wrong. Written to them as "you".' },
      caveat: { type: 'string', description: 'State plainly that attachment style cannot be read reliably from this data.' },
    }),
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
    environments: { ...strList, description: 'Three to five specific kinds of role, team or setting where they would do well.' },
    watchOuts: { type: 'string', description: 'Two or three sentences on what could hold them back.' },
  }),
  card: CARD_SCHEMA,
});

const PROFILE_SYSTEM = `You are PsycheAI, an analyst who reads a person's Instagram data export and writes them an honest, specific, useful portrait.

# What you are given

A structured digest of one person's Instagram export: their bio and profile, counts of their activity, when they are active (hour-of-day and day-of-week histograms, posting regularity over time), a sample of their captions and the comments they wrote, the accounts they follow, the topics and ad-interests Instagram itself has inferred about them, their searches, and — unless they opted out — aggregate statistics about their direct messages plus a sample of their own messages (never the other side of a conversation).

Unless they opted out, you are also given up to twenty of their own photographs, each labelled with the date it was posted. They are a deliberate spread across the whole account history rather than the most recent ones, so treat them as samples from different eras of a life, not as a portfolio.

# How to read it

Weight the evidence honestly:

- **Their own words** (captions, comments, bio, their own DMs) are the strongest signal. What someone chooses to write, and how, tells you the most.
- **Instagram's inferred topics and ad interests** are real signal about attention, but they are noisy and include things people merely scrolled past.
- **Accounts followed** show interest, aspiration and social circle mixed together. A person who follows twenty running accounts probably runs. A person who follows one probably does not.
- **Behavioural rhythm** — when they post, how regularly, how much they engage outward versus lurk — is genuine trait evidence and is often overlooked.
- **Their photographs** show what the captions leave out: where they spend time, whether they are usually alone or in a group, indoors or outdoors, city or country, how much care goes into what they publish, and how any of that changed over the years. Read the setting, the activity and the framing. A run of solitary landscapes and a run of crowded tables are different lives.
- **Absence is weak evidence.** Someone who never posts about family may be private, not unattached.

Photographs are the weakest evidence per item and the easiest to over-read — twelve pictures out of thousands, chosen by a crude filter, and Instagram is where people post their best day of the month. Use them to corroborate or complicate what the text and the rhythm already suggest, not to found a conclusion on their own. Never treat a single striking image as a personality.

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

- **Big Five**: score 0-100 where 50 is an average person. Cite real evidence per trait. Note that "neuroticism" is emotional sensitivity — frame it neutrally, not as a defect.
- **MBTI**: give your best type and its usual nickname, then work axis by axis — nothing else. For each one, say how strongly the data leans, what in their data put it there, and what that letter looks like in *their* week rather than in a textbook. The per-axis writing carries the whole section, so make it specific: if a sentence would survive being pasted into a stranger's profile, rewrite it or cut it, and let at least one of the four sting slightly. Where an axis is genuinely close, say "slight" and mean it — a hedged letter is more useful than a confident wrong one. There is no summary paragraph; do not write one into the last axis instead.

- **activity**: read the account as behaviour, not statistics. The histograms, the month-by-month series, the ratio of what they publish to what they like and save — these are the parts of the export people never look at themselves, and they are often the most revealing thing in it. Cite real numbers. Say what changed and when. Hedge where the evidence is thin — "you post almost entirely between 6 and 8am" is a fact, "you are a morning person whose day is spoken for by nine" is an inference, and the reader should be able to tell which is which. Be careful not to moralise about screen time.
- **Beliefs**: religious, political, ethical or philosophical commitments the data actually supports. An empty list is a fine answer. Do not guess at politics from thin evidence, and do not infer anything about a person from the demographics of accounts they follow.
- **essence**: pick the character before you write anything else, then let the rest of the profile agree with it. It has to be someone globally famous — the test is whether a stranger in another country would picture them instantly. A good pick is slightly surprising and survives being read back to them: Bruce Banner for someone careful and clever who is visibly managing a temper, Kevin Flynn for someone whose whole life is one project. A bad pick is a compliment in a costume (Superman, Elsa for anyone who has ever been cold), a restatement of their hobby, or a character nobody outside a fandom could name. Match on temperament, drive and how they treat people — never on how they or anyone else looks, and never on their gender or background. If the evidence is thin, pick someone ordinary and human rather than a hero.

- **Relationship strengths and weaknesses**: how they would actually be to date or be close to. Real weaknesses, not humblebrags. Attachment style is a guess and must be labelled as one — but show your working rather than asserting it: name the behavioural traces it rests on, say which style you rejected and why, and then spell out what it actually means for them and for whoever is close to them. A named style with no reasoning is worthless and slightly harmful.

- **Love languages**: give them separately for receiving and for giving, because most people do not match on the two and that gap is the interesting part. Read *giving* from what they actually do — what their comments say to people, whether they show up for other people's events, whether they mark birthdays and anniversaries, how much time they visibly spend with the same few accounts. Read *receiving* from what they respond to and what they ask for, which is thinner evidence, so hedge it harder. Mark a language \`minor\` rather than inventing a case for it, and pick one or two strong ones over listing all five. **Physical touch is close to invisible in this data** — do not claim it as primary unless their own words make it obvious, and say so in the \`why\` when you are guessing. Where the two sides differ, let the \`inPractice\` lines carry it rather than commenting on the gap: there is no section for that.
- **Career strengths and weaknesses**: how they work, where they would thrive, and what would hold them back. Draw on rhythm, follow-through, social orientation and interests.
- **card**: a compact version for sharing. Every field short, because it gets encoded into a QR code. It must stand alone — a second analyst will use only the card to assess compatibility with someone else, so make each phrase carry real information rather than being vague.

# Hard limits

Do not identify or speculate about specific other people in their data. Do not infer sexual orientation, health conditions, immigration status, or political affiliation unless the person has stated it outright in their own words. Do not classify anyone by appearance or by the demographics of who they follow.

The photographs carry their own limits, and these are absolute. Other people appear in them, and those people did not upload anything or agree to any of this: do not describe, count, identify or infer anything whatsoever about them. Say nothing about anyone's race, ethnicity, body, attractiveness, age, gender, wealth or health — not about the user and not about anyone else in frame — and do not use any of it as evidence for any conclusion. Do not read a location precisely enough to place where someone lives or works. Never quote text you can see inside a photograph. What you may take from an image is the setting, the activity, the company kept in the abstract (alone, a pair, a crowd), and the care taken over the shot.`;

// ---------- compatibility ----------

// The user picks one basis before the call runs, so the report answers one
// question properly rather than three at once.
const COMPATIBILITY_MODES = {
  romantic: {
    label: 'Romantic',
    heading: 'How to partner each other',
    brief: 'Romance turns on life direction, values, emotional safety, how each person gives and receives care, and whether their day-to-day rhythms can actually coexist. Shared hobbies matter less than people think. Attachment styles and love languages matter more.',
  },
  platonic: {
    label: 'Platonic',
    heading: 'How to befriend each other',
    brief: 'Friendship turns on shared interests and activities, compatible energy levels, a similar appetite for contact, and low friction. Life direction and attachment matter much less; whether they would actually enjoy a Saturday together matters much more.',
  },
  professional: {
    label: 'Professional / work',
    heading: 'How to work with each other',
    brief: 'Working together turns on complementary strengths, compatible working rhythms and standards, how each handles disagreement and deadlines, and whether one will quietly carry the other. Warmth is not the point — reliability, candour and dividing the work well are. Say plainly if one of them is the type to over-commit or to go quiet under pressure.',
  },
};

const COMPATIBILITY_SCHEMA = object({
  mode: { type: 'string', enum: Object.keys(COMPATIBILITY_MODES), description: 'Echo back the basis you were asked to assess.' },
  score: { type: 'integer', description: '0-100.' },
  band: { type: 'string', description: 'Two or three words, e.g. "Strong fit" or "Hard going".' },
  verdict: { type: 'string', description: 'Three to five sentences giving the honest overall read on the basis you were asked about.' },
  strengths: pointList,
  frictions: pointList,
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

The user chooses the basis before you run — romantic, platonic, or professional — and the user turn names it. Assess **only** that basis. Do not score the others, do not compare against them, and do not hedge by covering all three. A reader who picked "professional" does not want to be told about their romantic prospects.

Weight the evidence for the basis you were given:

- **Romantic** turns on life direction, values, emotional safety, how each person gives and receives care, and whether their day-to-day rhythms can actually coexist. Shared hobbies matter less than people think; attachment and love languages matter more.
- **Platonic** turns on shared interests and activities, compatible energy levels, a similar appetite for contact, and low friction. Life direction and attachment matter much less.
- **Professional / work** turns on complementary strengths, compatible working rhythms and standards, how each handles disagreement and deadlines, and whether one will quietly end up carrying the other. Warmth is not the point — reliability, candour and dividing work well are.

Two people can be a fine friendship and a poor working pair, or the reverse. Judge the basis in front of you on its own terms rather than importing a verdict from another one.

# How to score

0-100, where 50 is two random people. Above 80 is genuinely rare. Do not inflate — a diplomatic 75 for a pair that would struggle is worse than useless, because someone may act on it. Equally, do not manufacture problems for a pair that fits well.

# What to write

Be concrete and name both people. "You are both curious" is filler; "you both keep late hours and neither of you plans ahead, which is fun until someone has to book something" is useful.

The **howToPartner** section is the point of the whole report. Write specific, actionable things — what each person should actually do differently, given who the other one is. Address each list to that person as "you". Not generic relationship advice: advice that would only make sense for these two.

Frictions should be real. Every pair has them. Name them plainly without catastrophising.

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
function profileBlocks(digest, images) {
  const blocks = [{
    type: 'text',
    text: 'Here is the Instagram evidence digest for one person. Analyse it and produce their profile.\n\n' +
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

function compatibilityBlocks(a, b, mode) {
  const key = resolveMode(mode);
  const chosen = COMPATIBILITY_MODES[key];
  return [{
    type: 'text',
    text: 'Assess how these two people would work together on a **' + chosen.label +
      '** basis, and on that basis only.\n\n' + chosen.brief + '\n\n' +
      'Set the "mode" field of your answer to "' + key + '".\n\n' +
      '<person_a>\n' + JSON.stringify(a) + '\n</person_a>\n\n' +
      '<person_b>\n' + JSON.stringify(b) + '\n</person_b>',
  }];
}

module.exports = {
  MBTI_TYPES,
  LOVE_LANGUAGES,
  COMPATIBILITY_MODES,
  resolveMode,
  MAX_IMAGES,
  profileBlocks,
  compatibilityBlocks,
  PROFILE_SCHEMA,
  PROFILE_SYSTEM,
  CARD_SCHEMA,
  COMPATIBILITY_SCHEMA,
  COMPATIBILITY_SYSTEM,
};
