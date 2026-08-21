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

  // One neutral, textbook sentence per type — fixed vocabulary the same way
  // MBTI_POLES is, and for the same reason: it describes the type itself,
  // not this person, so it is resolved here rather than asked of the model.
  // The card's own `why` field is the personalised version of this and runs
  // five or six sentences, too long for the card; this is the one-line
  // definition that makes the nickname legible on its own.
  const ENNEAGRAM_DESCRIPTIONS = {
    1: 'Principled and improvement-driven, with a strong inner critic and a fear of being wrong.',
    2: 'Warm and generous, driven to be needed and to earn love through giving.',
    3: 'Success-driven and adaptable, oriented around image and getting things done.',
    4: 'Introspective and expressive, drawn to what feels authentic and wary of being ordinary.',
    5: 'Curious and self-contained, gathering knowledge while guarding their time and energy.',
    6: 'Committed and vigilant, scanning for risk and seeking security through trust.',
    7: 'Spontaneous and optimistic, chasing new experiences to outrun discomfort.',
    8: 'Assertive and protective, wanting control and resisting being controlled.',
    9: 'Easygoing and accommodating, seeking harmony and often merging with other people\'s agendas.',
  };

  // One glyph per block on the psyche card. Emoji rather than artwork for the
  // same reason the essence icon is: the card has to survive being a PDF, a
  // screenshot and a print, and an emoji needs no asset pipeline to do it.
  const CARD_ICONS = {
    type: '🧭',
    enneagram: '🔢',
    bigFive: '📊',
    values: '⚖️',
    beliefs: '💡',
    interests: '✨',
    loveIn: '💝',
    loveOut: '🎁',
    confidence: '🎯',
  };

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
  // "Publishing vs reading" used to close this list. It asked the same counts
  // the consumption read now asks, and answered them more thinly, so the two
  // said the same thing twice.
  //
  // "What you take in" ran full width below this grid while it carried a list
  // of accounts and a second reading. Those were cut, which left it the same
  // shape as the other three — one headline, one paragraph — so it is a facet
  // again, and four of them make an even two-by-two on a laptop. It leads the
  // list rather than closing it: the grid is two columns wide, so the first
  // entry is what lands top-left on a laptop and first of all on a phone.
  const ACTIVITY_FACETS = [
    ['What you take in', 'diet'],
    ['What you post', 'posting'],
    ['When you are here', 'rhythm'],
    ['How it changed', 'trajectory'],
  ];

  // The six wellness dimensions, in the order the reader meets them: label,
  // then the key it reads from the wellness object.
  //
  // Two labels are narrower than the dimensions were first described as.
  // "Physical health" became "Physical activity" and "Emotional processing
  // and health" became "Emotional processing", because the export carries
  // activity somebody chose to post about and words they chose to write, and
  // carries no health data at all — a heading promising otherwise is a claim
  // the section below it cannot keep. The schema field names in
  // lib/prompts.js match these narrower labels for the same reason.
  //
  // Sleep and rhythm leads because it is the best-evidenced of the six: the
  // hour-of-day and day-of-week histograms are complete rather than sampled.
  // Physical activity sits late because it is the thinnest.
  const WELLNESS_FACETS = [
    ['Sleep and rhythm', 'sleepAndRhythm'],
    ['Cognitive load', 'cognitiveLoad'],
    ['Social connection', 'socialConnection'],
    ['Emotional processing', 'emotionalProcessing'],
    ['Physical activity', 'physicalActivity'],
    ['Meaning', 'meaning'],
  ];

  // The orbit mark, exactly as the nav and the printed letterhead draw it. The
  // PDF strokes these same paths and the QR label's canvas parses them with
  // Path2D, so the logo is one shape in four places rather than a drawing that
  // has to be kept in step with a picture. A UI check compares this against the
  // `d` attributes in index.html.
  //
  // The supplied artwork is three <ellipse> elements — one of them rotated 60
  // degrees — plus a filled <circle>. Ellipses are written out here as four
  // cubic Beziers apiece, pre-rotated, because every renderer downstream
  // already emits and parses C commands natively; going through arc commands
  // instead would mean trusting three separate arc implementations to agree.
  // The conversion was checked by rendering both versions and diffing the
  // pixels: the only differences are antialiasing along the curve edges.
  //
  // `dot` is separate from `paths` because it is filled rather than stroked,
  // and all three renderers stroke everything in `paths` with one pen.
  const BRAND_MARK = {
    viewBox: 140,
    strokeWidth: 3,
    paths: [
      'M12 70C12 56.745 37.967 46 70 46C102.033 46 128 56.745 128 70C128 83.255 102.033 94 70 94C37.967 94 12 83.255 12 70Z',
      'M46 70C46 37.967 56.745 12 70 12C83.255 12 94 37.967 94 70C94 102.033 83.255 128 70 128C56.745 128 46 102.033 46 70Z',
      'M41 19.771C52.479 13.143 74.768 30.259 90.785 58C106.801 85.741 110.479 113.602 99 120.229C87.521 126.857 65.232 109.741 49.215 82C33.199 54.259 29.521 26.398 41 19.771Z',
    ],
    dot: { cx: 70, cy: 70, r: 11 },
  };

  // Compatibility bases, as the match history names them.
  const MODE_LABELS = {
    romantic: 'Romantic',
    platonic: 'Family / Friends',
    professional: 'Professional / work',
  };

  // A professional run also asks who reports to whom, because two peers, a
  // manager and a report are three different questions rather than one.
  // `{name}` is filled with the other person's name — the direction is stated
  // from the reader's side, since "superior" on its own is ambiguous about
  // which way round it runs. The keys match WORK_STANCES in lib/prompts.js,
  // and a test holds the two lists together.
  const WORK_STANCES = {
    colleagues: {
      option: 'We are colleagues',
      blurb: 'Neither of you answers to the other.',
      heading: 'How to work with each other',
    },
    superior: {
      option: 'I am the superior of {name}',
      blurb: 'You manage them. The report is about getting their best work without losing them.',
      heading: 'How to manage {name}',
    },
    subordinate: {
      option: 'I am a subordinate of {name}',
      blurb: 'You report to them. The report is about working for them and keeping your footing.',
      heading: 'How to work for {name}',
    },
  };

  /** Fills the `{name}` slot in a stance label. */
  function stanceText(template, name) {
    return String(template || '').replace('{name}', String(name || 'them'));
  }

  const TEXT = {
    whoYouAre: 'Who you are',
    essenceLabel: 'You are most like',

    // The at-a-glance card above the report. Its labels live here for the same
    // reason the section titles do — they are the same words in a second place,
    // and a check in the UI suite fails if app.js types any of them itself.
    cardSection: 'Summary card',
    cardHint: 'Tap to open full screen',
    cardDownload: 'Download as image',

    // The report still downloads straight to the reader's device; the dialog
    // just asks for an address first and says what happens to it.
    mailBlurb: 'Tell us your email address before downloading your full report as a PDF.',
    mailFine: 'We keep your email address. We do not keep the report — it is ' +
      'built in your browser and downloaded straight to your device, never stored here.',
    mailSending: 'Recording your address…',
    mailSent: 'Downloading your report…',
    cardType: 'MBTI',
    cardEnneagram: 'Enneagram',
    cardBigFive: 'Big Five',
    cardValues: 'Values',
    cardBeliefs: 'Beliefs',
    cardInterests: 'Interests',
    cardLoveIn: 'Receives love as',
    cardLoveOut: 'Gives love as',
    cardConfidence: 'Confidence',

    bigFive: 'Big Five',
    bigFiveSub: '0–100, where 50 is an average person. Each score lists the evidence behind it.',

    mbtiPrefix: 'MBTI: ',
    mbtiConfidence: 'Confidence: ',
    mbtiOver: 'over ',

    // Reuses mbtiConfidence for its own "Confidence: " line — the same word,
    // not a second one to keep in step.
    enneagramPrefix: 'Enneagram: ',

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
    // The attachment read is its own section now rather than a callout inside
    // "In relationships" — it is the single most-quoted finding in the report
    // and it was competing with the love languages for attention inside a card
    // that already carried two other things. `attachmentPrefix` still leads
    // the heading, so the style itself is what the reader sees first.
    attachment: 'Attachment style',
    attachmentSub: 'How you are likely to behave when you are close to someone — a guess from ' +
      'behaviour, shown with the working.',
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
    holdBack: 'What could hold you back',

    activity: 'Your digital footprint',

    // The career coach's section, distinct from "At work" above: that one
    // describes, this one advises. The sub-line names the difference, because
    // two career headings in one report is otherwise just confusing.
    careerAssessment: 'Career assessment',
    careerAssessmentSub: 'The coach\'s read rather than the description: what actually sets you ' +
      'apart, and what to do about it.',
    careerSituation: 'Where you are',
    careerEdge: 'Your edge',
    careerUnderused: 'What you are not using',
    careerHoldingBack: 'What is costing you',
    careerActions: 'What to do',
    // Horizon labels for the action list. Kept apart from the enum in
    // lib/prompts.js on purpose: the model answers in fixed values, the page
    // decides how to show them, and neither has to move when the other does.
    careerHorizons: {
      'this week': 'This week',
      'this quarter': 'This quarter',
      'this year': 'This year',
    },

    // The wellness section. Every word the reader meets before the writing
    // itself is doing work here, because this is the section most likely to
    // be misread as something it is not: the sub-line says "behaviour" and
    // "not a health assessment" before a single dimension is shown.
    wellness: 'Mental wellness',
    wellnessSub: 'Six dimensions read from how you actually use these accounts. This is a behavioural ' +
      'read, not a health assessment — there is no score here, and there is not meant to be.',
    wellnessOverall: 'Taken together',
    wellnessSuggestions: 'What might actually help',
    wellnessConfidence: 'Confidence: ',
    // Static rather than part of what the model returns — the same choice, for
    // the same reason, as bonusCaveat above. This is the "not an assessment,
    // talk to a person" line for the section that sits closest to health in
    // the whole app, so it is worded identically on every run rather than
    // being left to a field the model could soften, shorten or forget. See
    // the comment on the wellness schema in lib/prompts.js.
    wellnessCaveat: 'This reads patterns in social-media behaviour — when you post, who you talk to, ' +
      'what you write about. It is not a measurement of your mental health, not a screening tool and ' +
      'not a professional opinion, and it cannot see your circumstances, your history or your reasons. ' +
      'Nothing here is a diagnosis of anything. If something above lands heavier than a passing thought, ' +
      'the person to talk to about it is a person — a GP or a qualified professional can actually assess ' +
      'what this cannot.',

    qr: 'What your QR code contains',
    qrSub: 'Only this — the compact card the other person’s report is built from.',
    qrFineprint: 'Plus your Big Five scores and what each one means for you, MBTI and Enneagram, ' +
      'values, beliefs, relationship and career strengths and weaknesses with a line on each, ' +
      'your attachment guess and the reasoning under it, your love languages, and your rhythm and ' +
      'energy — all as short phrases.',

    matches: 'Your matches',
    matchWith: 'With',
    matchBasis: 'Basis',
    matchScore: 'Score',
    matchWhen: 'When',

    // The unsparing section. Everything the reader is told before they open it
    // is here, because a cover that undersells what is behind it is not
    // consent — they should be able to decide not to look. It used to run
    // free, behind a click-to-reveal cover; it now sits behind an S$1.99
    // unlock — shared with the wellness, attachment and career sections —
    // so the cover reads as a paywall rather than a content warning: the
    // price and the register both belong on it.
    // Cover copy for the three sections that moved behind the paywall with
    // the roast. Each says specifically what is behind it rather than
    // gesturing at "more analysis": a reader deciding whether to pay is owed
    // the same honesty as a reader deciding whether to look at the roast, and
    // a vague cover is the version that sells worst *and* informs least.
    wellnessCoverTitle: 'Six dimensions, read from your behaviour',
    wellnessCoverBlurb: 'Sleep and rhythm, cognitive load, social connection, physical activity, ' +
      'emotional processing and meaning — each with the evidence behind it, an honest confidence ' +
      'level, and concrete suggestions. A behavioural read, never a health assessment.',
    attachmentCoverTitle: 'How you are to be close to',
    attachmentCoverBlurb: 'Your likely attachment style with the working shown — which traces point ' +
      'there, which style was considered and rejected, and what it means in practice for you and for ' +
      'whoever is close to you.',
    careerCoverTitle: 'A career coach on your edge',
    careerCoverBlurb: 'Where you appear to be, the thing you do reliably that most people do not, ' +
      'what you are visibly not using, the pattern most likely to cost you — and actions to take ' +
      'this week, this quarter and this year.',
    bonus: 'Let us roast you',
    // Sits beside the title as a small badge, the same way "Coming soon"
    // does on the comprehensive depth option — a label for what the section
    // is, not a second title competing with the one it sits next to. Shared
    // by all four paid sections, not just the roast: see `PAID_SECTIONS` in
    // docs/app.js, which applies it uniformly.
    premiumBadge: 'Premium',

    // The premium tier block, shown twice on the way in — the insight diagram
    // and "What you can expect?" — and built once in docs/app.js from
    // `PAID_SECTIONS` so the section names it advertises are the section
    // names the report actually renders. The price is `premiumPriceLabel` for
    // the same reason: one string, so the landing page cannot drift from the
    // unlock button.
    //
    // Stated as "four more sections" rather than "unlock the full report",
    // because the free report is a whole report and calling it partial to
    // sell the rest would be a lie about what somebody already has.
    premiumTierTitle: 'Four more sections',
    premiumTierBlurb: 'These four sections are a deeper analysis using Claude\'s latest model Opus:',
    premiumTierNote: 'One payment, on the device you read it on. No account, no subscription, and ' +
      'nothing recurring.',
    // The free half's own line, shown once above the four free branches — the
    // parallel statement to premiumTierBlurb above, so a reader sees what each
    // half costs and which model writes it before choosing to upload anything.
    insightFreeBadge: 'Free',
    insightFreeNote: 'These four sections come with every report, analysed by Gemini.',
    // The sample report's paid sections show their real covers now — same
    // title, same blurb, same price mentioned in the blurb — but the button
    // underneath is inert (see paidCard's `sample` option) and disabled, so it
    // reads as "here is what this looks like" rather than as a working
    // control on a report that is not the reader's own.
    premiumSampleUnlockLabel: 'Unlock',
    bonusSub: 'Everything else in this report is trying to be fair. This part is not trying.',
    bonusCoverTitle: 'This roast is deliberately unkind',
    bonusCoverBlurb: 'One S$1.99 unlock opens this and the three sections above it — no account, no ' +
      'subscription, and it stays open on this device for as long as this report does.',
    bonusHarsh: 'The least charitable assessment of you',
    bonusAdvice: 'What an honest friend would tell you',
    // Stays on screen beside the writing rather than only appearing on the
    // cover: this is the part a reader most needs while they are reading it,
    // and the part they are least likely to scroll back up for.
    bonusCaveat: 'This is an AI model being deliberately harsh about behavioural traces from your ' +
      'IG data. It is not an assessment, not a diagnosis and not a professional opinion of any kind. ' +
      'It cannot see your circumstances, your history or your reasons. Treat it as a provocation to ' +
      'argue with, not a verdict — and if any of it lands somewhere heavier than that, the person to ' +
      'talk to about it is a person.',
    // The section's own button is drawn before anything has been fetched
    // from the server, so it carries this static label; the dialog it opens
    // fetches a real PaymentIntent and shows *that* amount once it has one,
    // which is the one actually charged. Two numbers agreeing is a sign they
    // have not drifted, not a coincidence to engineer away.
    premiumPriceLabel: 'S$1.99',
    premiumUnlockPrefix: 'Unlock — ',
    // Shown while the paid model call is in flight, after payment has already
    // cleared — this can take as long as the free report did, for the same
    // reason: a long structured response with thinking enabled. The dialog
    // also shows a live seconds count beside it (see #premium-progress) for
    // the same reason app.js shows elapsed time on the free analysis: a
    // still sentence next to a spinning bar reads as stalled.
    premiumGenerating: 'Writing your four sections… this usually takes a few minutes, and can pass ' +
      'five. Keep this tab open — if you do lose it, you will not be charged again.',
    // The three states of coming back to an unlock that never arrived. Not one
    // string, because "you already paid" is the part that has to land first
    // and a reader skimming a dialog reads the title.
    premiumResumeLabel: 'Get the sections you paid for',
    premiumResumeTitle: 'You have already paid',
    premiumResumeBlurb: 'Your payment went through but the analysis did not reach this device — the ' +
      'tab closed, the connection dropped, or the device slept while it was being written. Fetching ' +
      'it again costs nothing.',
    premiumResumeAction: 'Fetch my analysis',
    premiumDialogTitle: 'Unlock premium sections',
    premiumDialogBlurb: 'One charge opens the mental wellness read, your attachment style, the career ' +
      'assessment and the roast. Taken on this device — Apple Pay or Google Pay, whichever this ' +
      'browser offers.',
    premiumMockPay: 'Simulate payment (mock mode)',
    premiumNotConfigured: 'Payments are not set up on this server yet.',
    premiumNoWallet: 'This browser does not have Apple Pay or Google Pay available to it.',
    premiumFailed: 'The payment did not go through. Nothing was charged.',
    // The payment can succeed and the analysis call can still fail on its own
    // — a slow model, a dropped connection — so this says plainly that the
    // charge itself is not in question, only the writing. A promo code that
    // authorised the call but hit the same failure reads the same way, since
    // "went through" is true of either kind of authorisation.
    premiumGenerationFailed: 'That went through, but the analysis could not be generated. Try again — ' +
      'the same payment can be used a few more times before it needs a new one.',
    premiumCancel: 'Cancel',
    premiumRetry: 'Try again',
    premiumPromoLabel: 'Have a promo code?',
    premiumPromoPlaceholder: 'Promo code',
    premiumPromoApply: 'Apply',

    trust: 'How much to trust this',
    trustSub: 'Everything above is inferred from behavioural traces, and the model says how far ' +
      'it would stand behind them.',
    trustScore: 'Confidence: ',

    glanceType: 'Type',
    glanceHighest: 'Highest',
    glanceLowest: 'Lowest',
    glanceEnneagram: 'Enneagram',

    // The compatibility report. It is two renderings of one document for the
    // same reason the profile is — the page and the downloadable PDF — so its
    // headings live here too rather than being typed once in each.
    compatDimensions: 'Where it holds and where it does not',
    compatDimensionsSub: 'Each scored on its own, on the same scale as the number above: 50 is ' +
      'two people picked at random.',
    compatShort: 'The short version',
    compatUpside: 'Biggest upside',
    compatRisk: 'Biggest risk',
    compatCommon: 'Common ground',
    compatWorks: 'What works',
    compatRubs: 'What will rub',
    compatBoth: 'Both of you',
    compatTalk: 'Things to actually talk about',
    compatFor: 'For ',
    compatSuffix: ' compatibility',
    compatOneQuestion: 'This report answers one question. Scan again to compare on a different basis.',

    // The scan page, which is where a comparison starts and where past ones
    // are listed.
    scanTitle: 'Test your compatibility',
    scanHistory: 'Your compatibility results',
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

    if (source.enneagram && source.enneagram.type) {
      const badge = source.enneagram.type + (source.enneagram.wing ? 'w' + source.enneagram.wing : '');
      items.push({ label: TEXT.glanceEnneagram, value: badge, note: source.enneagram.nickname || '' });
    }

    return items;
  }

  root.PsycheCopy = {
    TRAIT_LABELS, MBTI_POLES, axisLabel, ENNEAGRAM_DESCRIPTIONS, LOVE_LANGUAGE_ICONS, CARD_ICONS,
    ACTIVITY_FACETS, WELLNESS_FACETS, MODE_LABELS, WORK_STANCES, stanceText, BRAND_MARK, TEXT, glanceItems,
  };
})(typeof window !== 'undefined' ? window : globalThis);
