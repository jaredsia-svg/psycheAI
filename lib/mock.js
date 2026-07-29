// Deterministic stand-ins for the two Claude calls, used by the test suites
// and by anyone who wants to click through the app without an API key.
//
// These are shaped exactly like the real structured outputs — the point is to
// exercise every other part of the pipeline (digest → transport → render → QR
// → scan → report) without spending tokens or needing credentials. Enable with
// KINDRED_MOCK=1. The content is obviously synthetic on purpose; nothing here
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

function analyseProfile(digest) {
  const name = (digest.profile && (digest.profile.name || digest.profile.username)) || 'Sam';
  const captions = (digest.samples && digest.samples.captions) || [];
  const topics = (digest.instagramTopics || []).slice(0, 6);
  const interestNames = topics.length ? topics : ['Running', 'Cooking', 'Photography'];

  const data = {
    confidence: {
      score: Math.min(95, 30 + captions.length * 2),
      level: captions.length > 20 ? 'moderate' : 'low',
      rationale: 'Mock rationale based on ' + captions.length + ' sampled captions.',
    },
    headline: 'Mock headline for ' + name + '.',
    summary: 'Mock summary paragraph one.\n\nMock summary paragraph two.\n\nMock summary paragraph three.',
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
      letters: [
        { axis: 'E/I', choice: 'E', why: 'Mock reasoning.' },
        { axis: 'N/S', choice: 'N', why: 'Mock reasoning.' },
        { axis: 'T/F', choice: 'F', why: 'Mock reasoning.' },
        { axis: 'J/P', choice: 'J', why: 'Mock reasoning.' },
      ],
      caveat: 'MBTI is popular rather than validated, and this one is inferred indirectly.',
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
        why: 'Mock reasoning.',
        caveat: 'Attachment style cannot be read reliably from an Instagram export; treat this as a guess.',
      },
      howToLoveThem: ['Mock action one.', 'Mock action two.', 'Mock action three.'],
      idealPartner: 'Mock description of who fits and who does not.',
    },
    career: {
      strengths: [point('Follows through'), point('Builds trust quickly')],
      weaknesses: [point('Under-advocates for own work'), point('Avoids visible conflict')],
      workStyle: 'Mock work style, two or three sentences.',
      environments: ['Small mission-driven teams', 'Roles with clear ownership', 'Work with a physical or outdoor element'],
      watchOuts: 'Mock watch-outs.',
    },
    card: {
      name: String(name).slice(0, 24),
      headline: 'Mock card headline',
      summary: 'Mock two-sentence card summary. It stands alone for the compatibility call.',
      mbti: 'ENFJ',
      bigFive: { openness: 62, conscientiousness: 71, extraversion: 48, agreeableness: 77, neuroticism: 35 },
      interests: interestNames.slice(0, 8),
      values: ['Family and close ties', 'Health and discipline'],
      beliefs: ['Mock belief'],
      relationshipStrengths: ['Shows up consistently', 'Warm in writing'],
      relationshipWeaknesses: ['Slow to raise problems', 'Guards recovery time'],
      careerStrengths: ['Follows through', 'Builds trust quickly'],
      careerWeaknesses: ['Under-advocates for own work'],
      attachment: 'leans secure (tentative)',
      rhythm: 'early riser, steady weekly cadence',
      confidence: Math.min(95, 30 + captions.length * 2),
    },
  };

  return Promise.resolve({ data, usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' });
}

function mode(label, score, a, b) {
  return {
    score,
    band: score >= 75 ? 'Strong fit' : score >= 55 ? 'Workable' : 'Hard going',
    verdict: 'Mock ' + label + ' verdict for ' + a.name + ' and ' + b.name + '.',
    strengths: [point('Shared rhythm'), point('Complementary energy')],
    frictions: [point('Different planning styles')],
    howToPartner: {
      forA: ['Mock advice for ' + a.name + ' one.', 'Mock advice for ' + a.name + ' two.'],
      forB: ['Mock advice for ' + b.name + ' one.', 'Mock advice for ' + b.name + ' two.'],
      together: ['Mock joint action one.', 'Mock joint action two.'],
    },
  };
}

function analyseCompatibility(a, b) {
  const shared = (a.interests || []).filter(x => (b.interests || []).includes(x));
  const data = {
    romantic: mode('romantic', 58, a, b),
    platonic: mode('platonic', 74, a, b),
    sharedGround: shared.length ? shared : ['Mock shared ground'],
    biggestUpside: 'Mock biggest upside.',
    biggestRisk: 'Mock biggest risk.',
    conversationStarters: ['Mock starter one.', 'Mock starter two.', 'Mock starter three.'],
    caveats: 'Both profiles are inferences from social-media behaviour, not measurements.',
  };
  return Promise.resolve({ data, usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' });
}

module.exports = { analyseProfile, analyseCompatibility };
