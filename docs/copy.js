// The report's vocabulary: every section title, sub-line, column heading, label
// and empty-state message the reader sees.
//
// It lives here because the profile page and the downloadable PDF are two
// renderings of one document, and they have to say the same things in the same
// order. When these strings were written twice the two drifted immediately —
// the page grouped values with beliefs while the PDF split them, the page's
// trait labels read "Emotional sensitivity" where the PDF said "Neuroticism",
// and the sections came in a different order in each. Anything the reader can
// see in both places is written once, here.
(function (root) {
  'use strict';

  // Screen labels for the five traits. Not the schema keys: "neuroticism" is
  // the literature's word, not one to hand somebody about themselves.
  const TRAIT_LABELS = {
    openness: 'Openness to experience',
    conscientiousness: 'Conscientiousness',
    extraversion: 'Extraversion',
    agreeableness: 'Agreeableness',
    neuroticism: 'Emotional sensitivity',
  };

  // The four axes spelled out. A letter on its own means nothing to anyone who
  // has not read the MBTI literature, and the pairing is fixed vocabulary, so
  // it is resolved here rather than asked of the model — which could get it
  // wrong, and would cost tokens to get right.
  const MBTI_POLES = {
    E: { name: 'Extraversion', opposite: 'I' },
    I: { name: 'Introversion', opposite: 'E' },
    N: { name: 'Intuition', opposite: 'S' },
    S: { name: 'Sensing', opposite: 'N' },
    T: { name: 'Thinking', opposite: 'F' },
    F: { name: 'Feeling', opposite: 'T' },
    J: { name: 'Judging', opposite: 'P' },
    P: { name: 'Perceiving', opposite: 'J' },
  };

  /** "E" → "Extraversion over Introversion", falling back to the raw axis. */
  function axisLabel(letter, axis) {
    const key = String(letter || '').toUpperCase().replace(/[^EINSTFJP]/g, '').charAt(0);
    const pole = MBTI_POLES[key];
    if (!pole) return { name: String(axis || ''), against: '' };
    return { name: pole.name, against: MBTI_POLES[pole.opposite].name };
  }

  // Fixed vocabulary, so the glyphs are mapped here rather than asked of the
  // model — same reasoning as the MBTI poles.
  const LOVE_LANGUAGE_ICONS = {
    'Words of affirmation': '💬',
    'Acts of service': '🛠️',
    'Quality time': '⏳',
    'Receiving gifts': '🎁',
    'Physical touch': '🫂',
  };

  // Label, then the key it reads from the activity object. The order is the
  // order the reader meets them in.
  const ACTIVITY_FACETS = [
    ['What you post', 'posting'],
    ['When you are here', 'rhythm'],
    ['How it changed', 'trajectory'],
    ['Publishing vs reading', 'engagement'],
    ['Where your attention goes', 'attention'],
  ];

  // The brain mark, exactly as the nav and the printed letterhead draw it. The
  // PDF strokes these same paths, so the logo is one shape in three places
  // rather than a drawing that has to be kept in step with a picture. A UI check
  // compares this against the `d` attributes in index.html.
  const BRAND_MARK = {
    viewBox: 24,
    strokeWidth: 1.5,
    paths: [
      'M12 4.3a3.1 3.1 0 0 0-5.4 1.9 2.7 2.7 0 0 0-2.1 3.4A2.9 2.9 0 0 0 3.6 13a2.8 2.8 0 0 0 2.3 3.2A3 3 0 0 0 12 18.4z',
      'M12 4.3a3.1 3.1 0 0 1 5.4 1.9 2.7 2.7 0 0 1 2.1 3.4A2.9 2.9 0 0 1 20.4 13a2.8 2.8 0 0 1-2.3 3.2A3 3 0 0 1 12 18.4z',
      'M12 4.3v16.4',
      'M6.6 6.2c1.9.3 2.9 1.4 3 3.3M4.5 9.6c1.6.2 2.5 1 2.7 2.4M5.9 16.2c1.6-.5 2.4-1.6 2.5-3.2',
      'M17.4 6.2c-1.9.3-2.9 1.4-3 3.3M19.5 9.6c-1.6.2-2.5 1-2.7 2.4M18.1 16.2c-1.6-.5-2.4-1.6-2.5-3.2',
    ],
  };

  // Compatibility bases, as the match history names them.
  const MODE_LABELS = {
    romantic: 'Romantic',
    platonic: 'Platonic',
    professional: 'Professional / work',
  };

  const TEXT = {
    whoYouAre: 'Who you are',
    essenceLabel: 'You are most like',

    bigFive: 'Big Five',
    bigFiveSub: '0–100, where 50 is an average person. Each score lists the evidence behind it.',

    mbtiPrefix: 'MBTI: ',
    mbtiConfidence: 'Confidence: ',
    mbtiOver: 'over ',

    interests: 'Interests',
    interestsEmpty: 'Nothing stood out strongly.',

    valuesBeliefs: 'Values & Beliefs',
    valuesBeliefsSub: 'What you appear to hold to, and how firmly the data actually says so.',
    values: 'Values',
    valuesEmpty: 'The export did not support any confident read here.',
    beliefs: 'Beliefs',
    beliefsEmpty: 'Nothing in the export supported a confident read on beliefs — which is a ' +
      'perfectly ordinary result.',
    confidenceSuffix: ' confidence',

    relationships: 'In relationships',
    strengths: 'Strengths',
    weaknesses: 'Weaknesses',
    pointsEmpty: 'None identified.',
    attachmentPrefix: 'Attachment: ',
    readFrom: 'Read from',
    attachmentPractice: 'What it means in practice',
    loveHead: 'Your love languages',
    loveReceiving: 'How you want to be loved',
    loveReceivingBlurb: 'What lands, when it is aimed at you.',
    loveGiving: 'How you show love',
    loveGivingBlurb: 'What you reach for when you care about someone.',

    work: 'At work',
    howYouWork: 'How you work',
    thrive: 'Where you would thrive',
    holdBack: 'What could hold you back',

    activity: 'Your Instagram behaviour',
    activitySuggests: 'What it suggests',

    qr: 'What your QR code contains',
    qrSub: 'Only this — the compact card the other person’s report is built from.',
    qrFineprint: 'Plus your Big Five scores, MBTI, values, beliefs, relationship and career ' +
      'strengths and weaknesses, attachment guess and rhythm — all as short phrases.',

    matches: 'Your matches',
    matchWith: 'With',
    matchBasis: 'Basis',
    matchScore: 'Score',
    matchWhen: 'When',

    trust: 'How much to trust this',
    trustSub: 'Everything above is inferred from behavioural traces, and the model says how far ' +
      'it would stand behind them.',
    trustScore: 'Confidence: ',

    glanceType: 'Type',
    glanceHighest: 'Highest',
    glanceLowest: 'Lowest',
    glanceAttachment: 'Attachment',
    glanceGuess: 'a guess',
  };

  /**
   * The headline findings, pulled straight out of the sections below rather
   * than asked of the model a second time — restating them in a second field
   * is tokens spent on something that can then disagree with itself.
   */
  function glanceItems(report) {
    const items = [];
    const source = report || {};

    if (source.mbti && source.mbti.type) {
      items.push({ label: TEXT.glanceType, value: source.mbti.type, note: source.mbti.nickname || '' });
    }

    const traits = Object.keys(TRAIT_LABELS)
      .map(key => ({ key, item: source.bigFive && source.bigFive[key] }))
      .filter(entry => entry.item && Number.isFinite(Number(entry.item.score)))
      .sort((a, b) => b.item.score - a.item.score);
    if (traits.length >= 2) {
      const top = traits[0];
      const bottom = traits[traits.length - 1];
      items.push({ label: TEXT.glanceHighest, value: TRAIT_LABELS[top.key], note: top.item.score + '/100' });
      items.push({ label: TEXT.glanceLowest, value: TRAIT_LABELS[bottom.key], note: bottom.item.score + '/100' });
    }

    const attachment = source.relationship && source.relationship.attachment;
    if (attachment && attachment.style) {
      items.push({ label: TEXT.glanceAttachment, value: attachment.style, note: TEXT.glanceGuess });
    }

    return items;
  }

  root.PsycheCopy = {
    TRAIT_LABELS, MBTI_POLES, axisLabel, LOVE_LANGUAGE_ICONS, ACTIVITY_FACETS, MODE_LABELS,
    BRAND_MARK, TEXT, glanceItems,
  };
})(typeof window !== 'undefined' ? window : globalThis);
