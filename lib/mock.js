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

function analyseProfile(digest, anchor) {
  const name = (digest.profile && (digest.profile.name || digest.profile.username)) || 'Sam';
  const captions = (digest.samples && digest.samples.captions) || [];
  const topics = (digest.instagramTopics || []).slice(0, 6);
  const interestNames = topics.length ? topics : ['Running', 'Cooking', 'Photography'];

  const data = {
    confidence: {
      score: Math.min(95, 30 + captions.length * 2),
      level: captions.length > 20 ? 'moderate' : 'low',
      rationale: 'Mock rationale based on ' + captions.length + ' sampled captions.',
      basedOn: [captions.length + ' of ' + captions.length + ' captions',
        'complete hour-of-day histogram'],
    },
    // The structured layout chooses from a fixed catalogue; Bruce Banner is
    // not in it, so the mock answers as the real model would there.
    essence: {
      character: structuredLayout() ? 'Hulk' : 'Bruce Banner',
      franchise: 'Marvel',
      icon: structuredLayout() ? '' : '🧪',
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
    // Four sentences: the first condenses `essence.why`, then two for
    // `summary`'s first paragraph and one for its second — a real condensation,
    // not the first sentences repeated. Distinct wording from both source
    // fields so a check comparing them catches a version that regressed back to
    // quoting either verbatim.
    cardHighlights: 'Mock card summary, sentence one — the condensed reason that character fits, ' +
      'the shared trait rather than the name. Mock card summary, sentence two — a condensed take ' +
      'on the ENFJ read and the standout traits. Mock card summary, sentence three — the ' +
      'organising-without-being-asked pattern, condensed. Mock card summary, sentence four — a ' +
      'condensed take on the giving-more and closing-what-you-open patterns.',
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
      // One passage per axis carrying both the case for the letter and the
      // behaviour tempering it — the shape `why` asks for now, at roughly the
      // length a real one runs to, so anything measuring the axis block is
      // measuring a realistic amount of text rather than the mock's brevity.
      letters: [
        { axis: 'E/I', choice: 'E', strength: 'moderate', why: 'Mock reasoning for the letter, first behaviour with its count. Mock second behaviour from a different part of the digest. Mock third behaviour, counted. Mock tempering clause naming the behaviour that runs the other way, with its own count, and what it does not overturn.', inPractice: 'Mock practice note.' },
        { axis: 'N/S', choice: 'N', strength: 'slight', why: 'Mock reasoning for the letter, first behaviour with its count. Mock second behaviour from a different part of the digest. Mock third behaviour, counted. Mock tempering clause close enough to leave this axis slight.', inPractice: 'Mock practice note.' },
        { axis: 'T/F', choice: 'F', strength: 'clear', why: 'Mock reasoning for the letter, first behaviour with its count. Mock second behaviour from a different part of the digest. Mock third behaviour, counted. Mock sentence saying the evidence here runs one way rather than manufacturing a doubt.', inPractice: 'Mock practice note.' },
        { axis: 'J/P', choice: 'J', strength: 'moderate', why: 'Mock reasoning for the letter, first behaviour with its count. Mock second behaviour from a different part of the digest. Mock third behaviour, counted. Mock tempering clause on rhythm, and why the steadier reading still won.', inPractice: 'Mock practice note.' },
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
    // Trajectories cycle rather than repeating one value, so a UI check can
    // see a dormant chip and a structural one in the same render — the two are
    // styled differently and a mock that only ever produced one would leave
    // half the rendering untested.
    interests: interestNames.map((interest, index) => ({
      name: interest,
      intensity: index === 0 ? 'core' : index < 3 ? 'strong' : 'casual',
      trajectory: ['structural', 'dormant', 'rising', 'phasic'][index % 4],
      lastSeen: String(2025 - (index % 4) * 3),
      detail: 'Mock detail about ' + interest + '.',
      evidence: 'Mock evidence for ' + interest + ', eleven captions across three years.',
    })),
    beliefs: [
      { belief: 'Mock belief', detail: 'Mock detail.', evidence: 'Mock evidence.', confidence: 'low' },
    ],
    values: [
      { value: 'Family and close ties', trajectory: 'structural', lastSeen: '2025',
        detail: 'Mock detail.', evidence: 'Mock evidence, forty-odd captions.' },
      { value: 'Health and discipline', trajectory: 'declining', lastSeen: '2022',
        detail: 'Mock detail.', evidence: 'Mock evidence, nine captions between 2019 and 2022.' },
    ],
    relationship: {
      strengths: [point('Shows up consistently'), point('Warm in writing')],
      weaknesses: [point('Slow to raise problems'), point('Guards recovery time')],
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
      watchOuts: 'Mock watch-outs.',
    },
    // The roast, free and behind a click-to-reveal cover — see bonusCoverTitle,
    // bonusReveal in docs/copy.js. Never a condition name here: the mock
    // content is what a fixture-writer would put in the field, and this
    // field's whole point is that nothing clinical belongs in it.
    bonus: {
      harsh: 'Mock uncharitable reading, first paragraph.\n\nMock uncharitable reading, second paragraph, going after a pattern rather than the person.',
      advice: 'Mock unsoftened advice, first paragraph.\n\nMock unsoftened advice, second paragraph, drawn from the digest rather than the posting habits alone.',
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

  // Honoured the way the real prompt asks the model to honour it, so the UI
  // suite can tell an anchored report from one that re-derived its card: a
  // mock that ignored the anchor would pass every "the card did not change"
  // check by coincidence, since its card never changes anyway.
  if (anchor) applyAnchor(data, anchor);
  return Promise.resolve({ data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' });
}

function applyAnchor(data, anchor) {
  if (anchor.character) data.essence.character = anchor.character;
  if (anchor.franchise) data.essence.franchise = anchor.franchise;
  if (anchor.mbtiType) { data.mbti.type = anchor.mbtiType; data.card.mbti = anchor.mbtiType; }
  for (const letter of anchor.mbtiLetters || []) {
    const row = data.mbti.letters.find(l => l.axis === letter.axis);
    if (row) { row.choice = letter.choice; row.strength = letter.strength; }
  }
  for (const [trait, value] of Object.entries(anchor.bigFive || {})) {
    if (data.bigFive[trait]) { data.bigFive[trait].score = value.score; data.bigFive[trait].band = value.band; }
    data.card.bigFive[trait] = value.score;
  }
  if (anchor.cardHighlights) data.cardHighlights = anchor.cardHighlights;
}

/**
 * The free card: the same conclusions analyseProfile reaches, projected onto
 * FREE_SCHEMA — no readings, no evidence, no `why`, no roast. Derived from the
 * full mock rather than written separately so the two can never disagree, which
 * is what the real anchored call is built to guarantee.
 */
async function analyseCard(digest) {
  const full = (await analyseProfile(digest)).data;
  const data = {
    confidence: { score: full.confidence.score, level: full.confidence.level, basedOn: full.confidence.basedOn },
    essence: { character: full.essence.character, franchise: full.essence.franchise, icon: full.essence.icon },
    cardHighlights: full.cardHighlights,
    bigFive: Object.fromEntries(Object.entries(full.bigFive)
      .map(([trait, row]) => [trait, { score: row.score, band: row.band }])),
    mbti: {
      type: full.mbti.type, confidence: full.mbti.confidence, nickname: full.mbti.nickname,
      letters: full.mbti.letters.map(l => ({ axis: l.axis, choice: l.choice, strength: l.strength })),
    },
    enneagram: {
      type: full.enneagram.type, wing: full.enneagram.wing,
      nickname: full.enneagram.nickname, confidence: full.enneagram.confidence,
    },
    interests: full.interests.map(i => ({ name: i.name, intensity: i.intensity })),
    values: full.values.map(v => ({ value: v.value })),
    beliefs: full.beliefs.map(b => ({ belief: b.belief })),
    relationship: { loveLanguages: {
      receiving: full.relationship.loveLanguages.receiving.map(l => ({ language: l.language, strength: l.strength })),
      giving: full.relationship.loveLanguages.giving.map(l => ({ language: l.language, strength: l.strength })),
    } },
    // The structured layout's free card names the patterns and drops the
    // Enneagram, as the real free call does in that layout.
    ...(structuredLayout() ? {
      enneagram: undefined,
      patterns: structuredFields().patterns.map(p => ({ id: p.id, name: p.name, line: p.line })),
    } : {}),
    // Only the fields the real model writes; withCard fills the rest, exactly
    // as it does for a real call.
    card: Object.fromEntries(Object.entries(full.card)
      .filter(([key]) => !require('./prompts').CARD_DERIVED_KEYS.includes(key))),
  };
  if (data.enneagram === undefined) delete data.enneagram;
  return require('./prompts').withCard({ data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' });
}

function structuredLayout() {
  return require('./prompts').REPORT_LAYOUT === 'structured';
}

/**
 * The unlock's one call: the written report, anchored, with the four premium
 * sections in the same response — exactly the two mocks above merged, so the
 * shape is FULL_SCHEMA's.
 */
async function analyseFull(digest, anchor) {
  const report = (await analyseProfile(digest, anchor)).data;
  const premium = (await analysePremium(digest)).data;
  // The structured layout's four extra fields, only when that layout is the
  // one the real call would ask for — so a classic server's mock returns
  // exactly what it always did.
  const structured = structuredLayout() ? structuredFields() : {};
  const data = Object.assign({}, report, premium, structured);
  if (structuredLayout()) {
    // No Enneagram in this layout, on the report or on its card.
    delete data.enneagram;
    data.card = Object.assign({}, data.card, { enneagram: '' });
    // Keep the card's patterns, as the real prompt tells the model to.
    for (const pinned of (anchor && anchor.patterns) || []) {
      const row = data.patterns.find(p => p.id === pinned.id);
      if (row) { row.name = pinned.name; if (pinned.line) row.line = pinned.line; }
    }
    // Anchored, the real call is sent the pinned schema and writes none of
    // what the card fixed — so neither does this, and the browser has to
    // pin the card back over it exactly as it does for a real report.
    if (anchor) stripPinned(data);
  }
  return { data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' };
}

// What prompts.STRUCTURED_PINNED_FULL_SCHEMA leaves out, taken out of a
// mock report the same way.
function stripPinned(data) {
  delete data.card;
  if (data.essence) { delete data.essence.character; delete data.essence.franchise; delete data.essence.icon; }
  if (data.confidence) { delete data.confidence.score; delete data.confidence.level; }
  for (const row of Object.values(data.bigFive || {})) { delete row.score; delete row.band; }
  if (data.mbti) {
    delete data.mbti.type;
    for (const letter of data.mbti.letters || []) { delete letter.choice; delete letter.strength; }
  }
  for (const item of data.interests || []) delete item.intensity;
  const love = (data.relationship && data.relationship.loveLanguages) || {};
  for (const row of (love.receiving || []).concat(love.giving || [])) delete row.strength;
}

// Every enum used at least once: all three pattern ids, all three pressure
// levels, all three horizons, all ten motivators, and an item with no
// pattern, so the UI suite exercises every branch the renderer has.
function structuredFields() {
  const motivatorScores = [72, 48, 35, 66, 22, 58, 41, 30, 81, 54];
  return {
    patterns: [
      { id: 'p1', name: 'Mock pattern one', line: 'Mock line naming the behaviour and both of its sides.',
        evidence: ['mock count behind pattern one', 'mock rhythm behind pattern one'],
        showsUpIn: ['bigFive', 'relationships', 'work', 'wellness'] },
      { id: 'p2', name: 'Mock pattern two', line: 'Mock line for the second pattern.',
        evidence: ['mock evidence for pattern two'], showsUpIn: ['mbti', 'attachment', 'idealPartner'] },
      { id: 'p3', name: 'Mock pattern three', line: 'Mock line for the third pattern.',
        evidence: ['mock evidence for pattern three'], showsUpIn: ['interests', 'motivators', 'wellness'] },
    ],
    motivators: {
      scores: require('./prompts').MOTIVATORS.map((value, index) => ({
        value, score: motivatorScores[index], line: 'Mock evidence line for ' + value + '.',
      })),
      reading: 'Mock reading of the shape of their motivators, naming the tension between the top two.',
    },
    development: {
      buildOn: [
        { title: 'Mock strength to build on', detail: 'Mock detail on using it deliberately.', pattern: 'p1', raisedBy: ['bigFive', 'work'] },
        { title: 'Mock second strength', detail: 'Mock detail.', pattern: 'none', raisedBy: ['values'] },
      ],
      develop: [
        { title: 'Mock area to develop', detail: 'Mock detail on what the pattern costs them.', pattern: 'p2',
          raisedBy: ['attachment', 'relationships'],
          actions: [
            { horizon: 'this week', step: 'Mock first move for this week.' },
            { horizon: 'this quarter', step: 'Mock habit for this quarter.' },
            { horizon: 'this year', step: 'Mock change for this year.' },
          ],
          reflect: 'Mock reflection question for the reader?' },
      ],
    },
    pressurePoints: [
      { strength: 'Mock strength', overused: 'Mock overuse', level: 'marked', pattern: 'p1',
        detail: 'Mock detail on how the strength tips over.', earlySigns: ['Mock early sign one', 'Mock early sign two'],
        mitigation: 'Mock counter-move.', question: 'Mock pressure question?' },
      { strength: 'Mock second strength', overused: 'Mock second overuse', level: 'moderate', pattern: 'p2',
        detail: 'Mock detail.', earlySigns: ['Mock early sign'], mitigation: 'Mock counter-move.', question: 'Mock question?' },
      { strength: 'Mock third strength', overused: 'Mock third overuse', level: 'mild', pattern: 'none',
        detail: 'Mock detail.', earlySigns: ['Mock early sign'], mitigation: 'Mock counter-move.', question: 'Mock question?' },
    ],
  };
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

// The paid wellness/attachment/idealPartner/careerAssessment call. Shaped
// exactly like the real PREMIUM_SCHEMA output so the mock flow exercises
// the same rendering path a real call does. The wellness safety caveat
// itself is static copy shown by the client regardless of what this
// returns, not part of this schema at all. Never a condition name in
// `wellness` either: the mock content is what a fixture-writer would put in
// the field, and that field's whole point is that nothing clinical belongs
// in it.
function analysePremium(digest) {
  const data = {
    // Every band value used at least once across the six, including "not
    // enough evidence" on physical activity — which is the realistic result
    // for most exports and the one the UI most needs to render correctly,
    // since it must read as neutral rather than as a low score.
    wellness: {
      lifeTrajectory: wellnessFacet('mixed', 'moderate'),
      outlook: wellnessFacet('steady', 'low'),
      socialConnection: wellnessFacet('steady', 'moderate'),
      cognitiveLoad: wellnessFacet('under strain', 'moderate'),
      meaning: wellnessFacet('steady', 'moderate'),
      rhythmAndActivity: wellnessFacet('not enough evidence', 'very low'),
      overall: 'Mock overall wellness read, first sentence drawing the six together. Mock second ' +
        'sentence naming which one or two are worth attention first. No score anywhere in here.',
      suggestions: [
        point('Close one open loop this week'),
        point('Say the thing to the person rather than posting around it'),
        point('Keep one evening with no phone in the room'),
      ],
    },
    // Top-level now rather than nested under `relationship`, matching the
    // schema and the page.
    attachment: {
      style: 'Leans secure, slow to escalate',
      styleTone: 'Mock strengths line: what this style is genuinely good at, before any caveat.',
      why: 'Mock reasoning showing the working, including the style considered and rejected.',
      derivedFrom: ['Mock signal one, with a number', 'Mock signal two', 'Mock signal three'],
      implications: [point('Steady under a silence'), point('Slow to escalate')],
      caveat: 'Attachment style cannot be read reliably from an Instagram export; treat this as a guess.',
    },
    // Argues off the attachment section directly above, both here and in
    // the real prompt.
    idealPartner: {
      needs: [point('Steady, low-drama check-ins'), point('Room to process before a big conversation')],
      carefulOf: [point('A partner who escalates the moment things go quiet')],
      summary: 'Mock honest verdict on what kind of partner truly suits them, drawing the needs and ' +
        'cautions above together in two or three sentences.',
    },
    // One action per horizon, so the grouped rendering and all three pill
    // styles are exercised on every mock run.
    careerAssessment: {
      situation: 'Mock read of where they appear to be professionally, stated as an inference rather ' +
        'than as a job title the export does not contain.',
      edge: {
        headline: 'Mock edge headline',
        detail: 'Mock detail on what genuinely differentiates them. The real model writes three or ' +
          'four sentences here, specific enough that it would not fit anybody else.',
        evidence: ['mock count behind the edge', 'mock rhythm behind the edge'],
      },
      underused: {
        headline: 'Mock underused asset',
        detail: 'Mock detail on something they have and are visibly not using.',
      },
      holdingBack: {
        headline: 'Mock pattern costing them',
        detail: 'Mock detail on the behaviour most likely to cost them professionally.',
      },
      actions: [
        { horizon: 'this week', title: 'Mock action for this week', detail: 'Mock first move, concrete enough to start.' },
        { horizon: 'this quarter', title: 'Mock action for this quarter', detail: 'Mock detail.' },
        { horizon: 'this year', title: 'Mock action for this year', detail: 'Mock detail.' },
      ],
    },
  };
  return Promise.resolve({ data, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' });
}

module.exports = {
  name: 'mock',
  analyseProfile,
  analyseCard,
  analyseFull,
  analyseCompatibility,
  analysePremium,
  describeError: error => ({ status: 500, message: (error && error.message) || 'Mock error.' }),
  hasKey: () => true,
  MODEL: 'mock',
};
