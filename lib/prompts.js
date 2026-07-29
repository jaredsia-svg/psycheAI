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
  headline: { type: 'string', description: 'One sentence that captures this person.' },
  summary: { type: 'string', description: 'Three to five paragraphs, separated by blank lines. Write to them, as "you".' },
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
    letters: listOf({
      axis: { type: 'string', description: 'One of: E/I, N/S, T/F, J/P.' },
      choice: { type: 'string', description: 'The single letter you picked.' },
      why: { type: 'string', description: 'One or two sentences of evidence.' },
    }),
    caveat: { type: 'string', description: 'One sentence on how much weight to put on this.' },
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
      why: { type: 'string' },
      caveat: { type: 'string', description: 'State plainly that attachment style cannot be read reliably from this data.' },
    }),
    howToLoveThem: { ...strList, description: 'Three to five concrete things a partner should actually do.' },
    idealPartner: { type: 'string', description: 'Two or three sentences on who would fit them well, and who would not.' },
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

const PROFILE_SYSTEM = `You are Kindred, an analyst who reads a person's Instagram data export and writes them an honest, specific, useful portrait.

# What you are given

A structured digest of one person's Instagram export: their bio and profile, counts of their activity, when they are active (hour-of-day and day-of-week histograms, posting regularity over time), a sample of their captions and the comments they wrote, the accounts they follow, the topics and ad-interests Instagram itself has inferred about them, their searches, and — only if they opted in — aggregate statistics about their direct messages plus a sample of their own messages.

# How to read it

Weight the evidence honestly:

- **Their own words** (captions, comments, bio, their own DMs) are the strongest signal. What someone chooses to write, and how, tells you the most.
- **Instagram's inferred topics and ad interests** are real signal about attention, but they are noisy and include things people merely scrolled past.
- **Accounts followed** show interest, aspiration and social circle mixed together. A person who follows twenty running accounts probably runs. A person who follows one probably does not.
- **Behavioural rhythm** — when they post, how regularly, how much they engage outward versus lurk — is genuine trait evidence and is often overlooked.
- **Absence is weak evidence.** Someone who never posts about family may be private, not unattached.

Population base rates matter. Most people are near the middle on most traits. Reserve extreme scores for genuinely extreme evidence, and do not read a single caption as a personality.

# What to write

Be specific. "You are drawn to the outdoors" is worthless; "your posting spikes on Saturday mornings and half your captions mention a trail, a distance, or a summit" is worth reading. Quote or paraphrase actual evidence.

Be honest about uncertainty, including where it makes the profile less flattering or less definite. If the export is thin, say so in the confidence rationale and hedge the rest accordingly. Never invent evidence. If a section has little support, write less rather than padding.

Write in second person, warm but not sycophantic. This person is going to read it. Tell them things they might not already know about themselves, including things that are unflattering but fair. Do not moralise.

# Specific sections

- **Big Five**: score 0-100 where 50 is an average person. Cite real evidence per trait. Note that "neuroticism" is emotional sensitivity — frame it neutrally, not as a defect.
- **MBTI**: give your best type, per-letter reasoning, and a caveat noting that MBTI is popular rather than validated and that you are inferring it indirectly.
- **Beliefs**: religious, political, ethical or philosophical commitments the data actually supports. An empty list is a fine answer. Do not guess at politics from thin evidence, and do not infer anything about a person from the demographics of accounts they follow.
- **Relationship strengths and weaknesses**: how they would actually be to date or be close to. Real weaknesses, not humblebrags. Attachment style is a guess and must be labelled as one.
- **Career strengths and weaknesses**: how they work, where they would thrive, and what would hold them back. Draw on rhythm, follow-through, social orientation and interests.
- **card**: a compact version for sharing. Every field short, because it gets encoded into a QR code. It must stand alone — a second analyst will use only the card to assess compatibility with someone else, so make each phrase carry real information rather than being vague.

# Hard limits

Do not identify or speculate about specific other people in their data. Do not infer sexual orientation, health conditions, immigration status, or political affiliation unless the person has stated it outright in their own words. Do not classify anyone by appearance or by the demographics of who they follow.`;

// ---------- compatibility ----------

const MODE_SCHEMA = object({
  score: { type: 'integer', description: '0-100.' },
  band: { type: 'string', description: 'Two or three words, e.g. "Strong fit" or "Hard going".' },
  verdict: { type: 'string', description: 'Two to four sentences giving the honest overall read.' },
  strengths: pointList,
  frictions: pointList,
  howToPartner: object({
    forA: { ...strList, description: 'Three to five concrete things the FIRST person should do, addressed to them as "you".' },
    forB: { ...strList, description: 'Three to five concrete things the SECOND person should do, addressed to them as "you".' },
    together: { ...strList, description: 'Two to four things they should agree on or do jointly.' },
  }),
});

const COMPATIBILITY_SCHEMA = object({
  romantic: MODE_SCHEMA,
  platonic: MODE_SCHEMA,
  sharedGround: { ...strList, description: 'Three to six things they genuinely have in common.' },
  biggestUpside: { type: 'string', description: 'One or two sentences: the best thing about this pairing.' },
  biggestRisk: { type: 'string', description: 'One or two sentences: the thing most likely to break it.' },
  conversationStarters: { ...strList, description: 'Three to five things they should actually talk about, specific to these two people.' },
  caveats: { type: 'string', description: 'One or two sentences on what this assessment cannot see.' },
});

const COMPATIBILITY_SYSTEM = `You are Kindred, assessing how two people would work together. You are given two compact profiles, each previously derived from that person's own Instagram data. Person A is the one who scanned; person B is the one whose code was scanned.

# Score two things separately

**Romantic** and **platonic** compatibility are different questions and usually get different answers. Weight them differently:

- Romance turns on life direction, values, emotional safety, how each person gives and receives care, and whether their day-to-day rhythms can actually coexist. Shared hobbies matter less than people think.
- Friendship turns on shared interests and activities, compatible energy levels, and low friction. Life direction and attachment matter much less.

A pair can be a great friendship and a poor romance, or the reverse. Say so when that is the case, and explain why the two scores differ.

# How to score

0-100, where 50 is two random people. Above 80 is genuinely rare. Do not inflate — a diplomatic 75 for a pair that would struggle is worse than useless, because someone may act on it. Equally, do not manufacture problems for a pair that fits well.

# What to write

Be concrete and name both people. "You are both curious" is filler; "you both keep late hours and neither of you plans ahead, which is fun until someone has to book something" is useful.

The **howToPartner** section is the point of the whole report. Write specific, actionable things — what each person should actually do differently, given who the other one is. Address each list to that person as "you". Not generic relationship advice: advice that would only make sense for these two.

Frictions should be real. Every pair has them. Name them plainly without catastrophising.

# Hard limits

Both profiles are inferences from social-media behaviour, not psychometric measurements, and both carry a confidence figure — respect it. If either confidence is low, say plainly in the caveats that this is a conversation starter rather than a finding. Do not present any of this as a prediction about whether a relationship will succeed.`;

module.exports = {
  MBTI_TYPES,
  PROFILE_SCHEMA,
  PROFILE_SYSTEM,
  CARD_SCHEMA,
  COMPATIBILITY_SCHEMA,
  COMPATIBILITY_SYSTEM,
};
