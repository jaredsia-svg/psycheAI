// Deterministic stand-ins for the two model calls, used by the test suites
// and by anyone who wants to click through the app without an API key.
//
// These are shaped exactly like the real structured outputs — the point is to
// exercise every other part of the pipeline (digest → transport → render → QR
// → scan → report) without spending tokens or needing credentials. Enable with
// PSYCHEAI_MOCK=1. The content is obviously synthetic on purpose; nothing here
// is a fallback for a failed real call.
'use strict';

function traitFrom(label, score) {
  return {
    score,
    band: score >= 70 ? 'high' : score >= 55 ? 'moderate' : score >= 40 ? 'moderate' : 'low',
    reading: 'Mock reading for ' + label + '. In a real run this is several sentences grounded in the actual export.',
    evidence: ['mock evidence drawn from captions', 'mock evidence drawn from posting rhythm'],
  };
}

function point(title) {
  return { title, detail: 'Mock detail for "' + title + '". The real model writes two or three specific sentences here.' };
}

// Deliberately carries no number, matching the real wellness schema: this
// section bands rather than scores, so a mock that invented a score would
// exercise a rendering path production never takes.
function wellnessFacet(band, confidence) {
  return {
    band,
    confidence,
    reading: 'Mock reading for a "' + band + '" dimension. The real model writes two or three ' +
      'sentences here about what the data actually shows.',
    evidence: ['mock rhythm or count from the digest', 'mock second signal'],
  };
}

function analyseProfile(digest, images) {
  const name = (digest.profile && (digest.profile.name || digest.profile.username)) || 'Sam';
  const captions = (digest.samples && digest.samples.captions) || [];
  const seen = Array.isArray(images) ? images.length : 0;
  const topics = (digest.instagramTopics || []).slice(0, 6);
  const interestNames = topics.length ? topics : ['Running', 'Cooking', 'Photography'];

  const data = {
    confidence: {
      score: Math.min(95, 30 + captions.length * 2),
      level: captions.length > 20 ? 'moderate' : 'low',
      rationale: 'Mock rationale based on ' + captions.length + ' sampled captions and ' +
        seen + ' images.',
    },
    essence: {
      character: 'Bruce Banner',
      franchise: 'Marvel',
      icon: '🧪',
      why: 'Mock reasoning for why this character and not a neighbouring one.',
    },
    // Written at something like the length a real model returns. It was two
    // short lines, which made every check that measures the summary — the card
    // sizes itself around four to six lines of it — pass or fail on the mock's
    // brevity rather than on the layout being tested.
    summary: 'Mock summary paragraph one, landing the ENFJ type and the standout traits. You ' +
      'organise the people around you without being asked and treat a commitment as binding, ' +
      'which is the clearest single pattern in four years of this account.\n\n' +
      'Mock summary paragraph two, covering the relational and career read. You give far more ' +
      'than you ask for, recover alone after the events you host, and close what you open at a ' +
      'rate most accounts never show.',
    bigFive: {
      openness: traitFrom('openness', 62),
      conscientiousness: traitFrom('conscientiousness', 71),
      extraversion: traitFrom('extraversion', 48),
      agreeableness: traitFrom('agreeableness', 77),
      neuroticism: traitFrom('neuroticism', 35),
    },
    mbti: {
      type: 'ENFJ',
      confidence: 'low',
      nickname: 'The Protagonist',
      letters: [
        { axis: 'E/I', choice: 'E', strength: 'moderate', why: 'Mock reasoning.', inPractice: 'Mock practice note.' },
        { axis: 'N/S', choice: 'N', strength: 'slight', why: 'Mock reasoning.', inPractice: 'Mock practice note.' },
        { axis: 'T/F', choice: 'F', strength: 'clear', why: 'Mock reasoning.', inPractice: 'Mock practice note.' },
        { axis: 'J/P', choice: 'J', strength: 'moderate', why: 'Mock reasoning.', inPractice: 'Mock practice note.' },
      ],
      caveat: 'MBTI is popular rather than validated, and this one is inferred indirectly.',
    },
    enneagram: {
      type: '9',
      wing: '1',
      nickname: 'The Peacemaker',
      confidence: 'moderate',
      why: 'Mock explanation of what type nine centres on in plain language. Mock sentence on the ' +
        'fear it organises around and the desire that sits opposite it. Mock sentence on what a ' +
        'one-wing specifically adds or shifts, distinct from a nine with a different wing. Mock ' +
        'sentence tying the core type to something specific in their data. Mock sentence tying the ' +
        'wing to something specific in their data. Mock closing sentence on how the two show up ' +
        'together in their ordinary week.',
      caveat: 'Enneagram is popular rather than validated, and a different lens from the MBTI above.',
    },
    activity: {
      posting: { headline: 'Steady and low volume', detail: 'Mock detail about posting volume and format mix.' },
      rhythm: { headline: 'Early mornings, weekend-weighted', detail: 'Mock detail reading the hour and weekday histograms.' },
      trajectory: { headline: 'Tapering', detail: 'Mock detail about how usage changed over the months.' },
      diet: {
        headline: 'Narrow, and mostly the same few accounts',
        detail: 'Mock detail on how concentrated their reading is, and on the gap between what they save and what they do.',
      },
    },
    interests: interestNames.map((interest, index) => ({
      name: interest,
      intensity: index === 0 ? 'core' : index < 3 ? 'strong' : 'casual',
      detail: 'Mock detail about ' + interest + '.',
      evidence: 'Mock evidence for ' + interest + '.',
    })),
    beliefs: [
      { belief: 'Mock belief', detail: 'Mock detail.', evidence: 'Mock evidence.', confidence: 'low' },
    ],
    values: [
      { value: 'Family and close ties', detail: 'Mock detail.', evidence: 'Mock evidence.' },
      { value: 'Health and discipline', detail: 'Mock detail.', evidence: 'Mock evidence.' },
    ],
    relationship: {
      strengths: [point('Shows up consistently'), point('Warm in writing')],
      weaknesses: [point('Slow to raise problems'), point('Guards recovery time')],
      attachment: {
        style: 'leans secure',
        why: 'Mock reasoning showing the working, including the style considered and rejected.',
        derivedFrom: ['Mock signal one, with a number', 'Mock signal two', 'Mock signal three'],
        implications: [point('Steady under a silence'), point('Slow to escalate')],
        caveat: 'Attachment style cannot be read reliably from an Instagram export; treat this as a guess.',
      },
      loveLanguages: {
        receiving: [
          { language: 'Words of affirmation', strength: 'primary', why: 'Mock evidence.', inPractice: 'Mock practical note.' },
          { language: 'Quality time', strength: 'secondary', why: 'Mock evidence.', inPractice: 'Mock practical note.' },
        ],
        giving: [
          { language: 'Acts of service', strength: 'primary', why: 'Mock evidence.', inPractice: 'Mock practical note.' },
          { language: 'Quality time', strength: 'minor', why: 'Mock evidence.', inPractice: 'Mock practical note.' },
        ],
        caveat: 'Love languages are a popular framework rather than a validated one, and physical touch barely shows up in an export.',
      },
    },
    career: {
      strengths: [point('Follows through'), point('Builds trust quickly')],
      weaknesses: [point('Under-advocates for own work'), point('Avoids visible conflict')],
      workStyle: 'Mock work style, two or three sentences.',
      environments: ['Small mission-driven teams', 'Roles with clear ownership', 'Work with a physical or outdoor element'],
      watchOuts: 'Mock watch-outs.',
    },
    // Every band value used at least once across the six, including "not
    // enough evidence" on physical activity — which is the realistic result
    // for most exports and the one the UI most needs to render correctly,
    // since it must read as neutral rather than as a low score.
    wellness: {
      sleepAndRhythm: wellnessFacet('steady', 'high'),
      cognitiveLoad: wellnessFacet('mixed', 'moderate'),
      socialConnection: wellnessFacet('steady', 'moderate'),
      physicalActivity: wellnessFacet('not enough evidence', 'very low'),
      emotionalProcessing: wellnessFacet('under strain', 'low'),
      meaning: wellnessFacet('steady', 'moderate'),
      overall: 'Mock overall wellness read, first sentence drawing the six together. Mock second ' +
        'sentence naming which one or two are worth attention first. No score anywhere in here.',
      suggestions: [
        point('Close one open loop this week'),
        point('Say the thing to the person rather than posting around it'),
        point('Keep one evening with no phone in the room'),
      ],
    },
    card: {
      name: String(name).slice(0, 24),
      headline: 'Mock card headline',
      summary: 'Mock two-sentence card summary. It stands alone for the compatibility call.',
      mbti: 'ENFJ',
      enneagram: '9w1',
      bigFive: { openness: 62, conscientiousness: 71, extraversion: 48, agreeableness: 77, neuroticism: 35 },
      interests: interestNames.slice(0, 4),
      values: ['Family and close ties', 'Health and discipline'],
      beliefs: ['Mock belief'],
      relationshipStrengths: ['Shows up consistently', 'Warm in writing'],
      relationshipWeaknesses: ['Slow to raise problems', 'Guards recovery time'],
      careerStrengths: ['Follows through', 'Builds trust quickly'],
      attachment: 'leans secure (tentative)',
      attachmentWhy: 'Steady reply latency, no bursts after silence, warm to a few people.',
      loveReceiving: ['Words of affirmation (primary)', 'Quality time (secondary)'],
      loveGiving: ['Acts of service (primary)'],
      rhythm: 'early riser, steady weekly cadence',
      energy: 'participant not broadcaster; a few close ties, not a wide circle',
      workStyle: 'Plans ahead, holds a standard, dislikes visible conflict.',
      confidence: Math.min(95, 30 + captions.length * 2),
    },
  };

  return Promise.resolve({ data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' });
}

// The dimension names have to match the ones lib/prompts.js hands the real
// model, or the mock renders a report shaped unlike anything production makes.
const MOCK_DIMENSIONS = {
  romantic: ['Values and life direction', 'Emotional safety', 'Daily rhythms', 'How you each give care', 'Energy match'],
  platonic: ['Shared interests', 'Energy match', 'Appetite for contact', 'Friction load', 'Outlook and values'],
  professional: ['Complementary strengths', 'Standards and follow-through', 'Working rhythms', 'Handling disagreement', 'Load balance'],
};

// A professional run splits by who reports to whom, so the mock has to split
// with it — otherwise the UI suite renders peer dimensions for a run the real
// model would have answered as a manager.
const MOCK_STANCE_DIMENSIONS = {
  colleagues: MOCK_DIMENSIONS.professional,
  superior: ['Briefing and direction', 'How they take feedback', 'Autonomy against oversight', 'Whether problems reach you', 'Keeping them'],
  subordinate: ['Reading what they want', 'Getting a decision', 'Raising a problem safely', 'Visibility of your work', 'Room to grow'],
};

function cited(title) {
  return {
    ...point(title),
    evidence: ['mock citation from the first card', 'mock citation from the second card'],
  };
}

function analyseCompatibility(a, b, mode, stance) {
  const key = ['romantic', 'platonic', 'professional'].includes(String(mode)) ? String(mode) : 'romantic';
  const stanceKey = ['colleagues', 'superior', 'subordinate'].includes(String(stance)) ? String(stance) : 'colleagues';
  const names = key === 'professional' ? MOCK_STANCE_DIMENSIONS[stanceKey] : MOCK_DIMENSIONS[key];
  const score = { romantic: 58, platonic: 74, professional: 66 }[key];
  const shared = (a.interests || []).filter(x => (b.interests || []).includes(x));
  const data = {
    mode: key,
    score,
    band: score >= 75 ? 'Strong fit' : score >= 55 ? 'Workable' : 'Hard going',
    verdict: 'Mock ' + key + ' verdict for ' + a.name + ' and ' + b.name + '.',
    dimensions: names.map((name, index) => ({
      name,
      score: [72, 44, 61, 55, 68][index],
      reading: 'Mock reading for "' + name + '", naming ' + a.name + ' and ' + b.name + '.',
      evidence: ['mock evidence for ' + a.name, 'mock evidence for ' + b.name],
    })),
    strengths: [cited('Shared rhythm'), cited('Complementary energy')],
    frictions: [cited('Different planning styles')],
    howToPartner: {
      forA: ['Mock advice for ' + a.name + ' one.', 'Mock advice for ' + a.name + ' two.'],
      forB: ['Mock advice for ' + b.name + ' one.', 'Mock advice for ' + b.name + ' two.'],
      together: ['Mock joint action one.', 'Mock joint action two.'],
    },
    sharedGround: shared.length ? shared : ['Mock shared ground'],
    biggestUpside: 'Mock biggest upside.',
    biggestRisk: 'Mock biggest risk.',
    conversationStarters: ['Mock starter one.', 'Mock starter two.', 'Mock starter three.'],
    caveats: 'Both profiles are inferences from social-media behaviour, not measurements.',
  };
  return Promise.resolve({ data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' });
}

// The paid roast. Shaped exactly like the real PREMIUM_SCHEMA output —
// harsh/advice, no caveat field — so the mock flow exercises the same
// rendering path a real call does. The safety caveat itself is static copy
// shown by the client regardless of what this returns, not part of this
// schema at all. Never a condition name here either: the mock content is
// what a fixture-writer would put in the field, and this field's whole
// point is that nothing clinical belongs in it.
function analysePremium(digest) {
  const data = {
    harsh: 'Mock uncharitable reading, first paragraph.\n\nMock uncharitable reading, second paragraph, going after a pattern rather than the person.',
    advice: 'Mock unsoftened advice, first paragraph.\n\nMock unsoftened advice, second paragraph, drawn from the digest rather than the posting habits alone.',
  };
  return Promise.resolve({ data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' });
}

module.exports = {
  name: 'mock',
  analyseProfile,
  analyseCompatibility,
  analysePremium,
  describeError: error => ({ status: 500, message: (error && error.message) || 'Mock error.' }),
  hasKey: () => true,
  MODEL: 'mock',
};
