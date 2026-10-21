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

  // One glyph per block on the psyche card. Emoji rather than artwork for the
  // same reason the essence icon is: the card has to survive being a PDF, a
  // screenshot and a print, and an emoji needs no asset pipeline to do it.
  const CARD_ICONS = {
    type: '🧭',
    bigFive: '📊',
    values: '⚖️',
    beliefs: '💡',
    interests: '✨',
    loveIn: '💝',
    loveOut: '🎁',
    syncs: '🤝',
    confidence: '🎯',
    patterns: '🧵',
    motivators: '🧲',
  };

  // Fixed vocabulary, so the glyphs are mapped here rather than asked of the
  // model — same reasoning as the MBTI poles.
  const LOVE_LANGUAGE_ICONS = {
    'Words of affirmation': '💬',
    'Acts of service': '🛠️',
    'Quality time': '⏳',
    'Receiving gifts': '🎁',
    'Giving gifts': '🎁',
    'Physical touch': '🫂',
  };
  // The model has one name for gifts, "Receiving gifts", on both sides. On
  // the giving side ("Shows care as") it is giving them, so it is shown that
  // way wherever that side is drawn: the card, the report and the PDF.
  const givingLove = list => (Array.isArray(list) ? list : []).map(item =>
    item && item.language === 'Receiving gifts' ? Object.assign({}, item, { language: 'Giving gifts' }) : item);

  // A paragraph's first sentence and the rest, for a lead set in bold: split
  // at the first full stop, ! or ? followed by a capital, so "e.g. a" stays whole.
  /**
   * The plan's steps, at most `max`, chosen across its sources (the
   * development areas', the work coaching's, the wellbeing suggestions'):
   * each list is strongest first, so they are taken in turns, first of each,
   * then second of each. One step per horizon is taken first where there is
   * one, so the plan still runs from this week to this year. A step that
   * repeats another's words is left out. Kept in that turn order.
   */
  function planPick(lists, horizons, max) {
    const queue = [];
    const seen = new Set();
    const longest = Math.max(0, ...lists.map(list => list.length));
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const item = list[i];
        const key = item && String(item.step || item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        queue.push(item);
      }
    }
    const chosen = new Set();
    for (const horizon of horizons) {
      const first = queue.find(item => !chosen.has(item) && item.horizon === horizon);
      if (first && chosen.size < max) chosen.add(first);
    }
    for (const item of queue) {
      if (chosen.size >= max) break;
      chosen.add(item);
    }
    return queue.filter(item => chosen.has(item));
  }
  const PLAN_STEPS = 5;

  const leadSentence = text => {
    const value = String(text || '').trim();
    const match = value.match(/^([\s\S]+?[.!?]["\u201d\u2019)]?)\s+(?=["\u201c\u2018(]?[A-Z])([\s\S]+)$/);
    return match ? [match[1], match[2]] : [value, ''];
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
  // Labels are deliberately narrower than the thing a reader might hope the
  // section measures. The export carries activity somebody chose to post
  // about and words they chose to write, and carries no health data at all —
  // a heading promising otherwise is a claim the section below it cannot
  // keep. "Outlook" is the clearest case: it heads a reading of how somebody
  // writes about their own life, not of how they feel, and a label like
  // "Hope" or "Mood" would promise the second. The schema field names in
  // lib/prompts.js match these narrower labels for the same reason.
  //
  // Order is the report's own, not an evidence ranking: life trajectory opens
  // because it is the widest lens and sets up everything under it, and rhythm
  // and activity closes because it is the most granular. Sleep and physical
  // activity used to be two of the six and are one card now — two readings of
  // when somebody is up and about, which never earned separate headings.
  const WELLNESS_FACETS = [
    ['Life trajectory', 'lifeTrajectory'],
    ['Outlook', 'outlook'],
    ['Social connection', 'socialConnection'],
    ['Cognitive load', 'cognitiveLoad'],
    ['Meaning', 'meaning'],
    ['Rhythm and activity', 'rhythmAndActivity'],
  ];

  // The orbit mark, exactly as the nav and the printed letterhead draw it. The
  // PDF strokes these same paths and the share images' canvas parses them with
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

  // The basis of a Psyche Sync, as the history names it. Friends is the only
  // one run now; the other two still label reports saved before.
  const MODE_LABELS = {
    romantic: 'Romantic',
    platonic: 'Friends',
    professional: 'Professional / work',
  };

  // Reports saved before Psyche Sync was friends-only may be professional
  // runs, and still show who reported to whom. A professional run asked
  // who reports to whom, because two peers, a
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

  // "Ava's", "James'" — the shared card belongs to a name the app did not choose.
  const possessive = name => String(name) + (/s$/i.test(String(name)) ? '’' : '’s');

  const TEXT = {
    whoYouAre: 'Who you are',
    essenceLabel: 'You are most like',

    // The at-a-glance card above the report. Its labels live here for the same
    // reason the section titles do — they are the same words in a second place,
    // and a check in the UI suite fails if app.js types any of them itself.
    cardSection: 'Psyche Card',
    // What goes with the card image when it is shared, where the app shared to
    // takes text too: the character, then where to get your own.
    // The welcome page's banner for a compare link opened before the reader
    // has a card of their own.
    // With their card beside it: the hook is the character, and what the
    // reader's own card would say.
    // By first name only: "Jared", not "Jared Tan".
    inviteTitle: (name) => '⭐ This is ' + possessive(name || 'your connection') + ' Psyche Card',
    inviteText: (name) => 'PsycheAI reads your personality from your own Instagram data. No questionnaire, ' +
      'no sign-up. Get your free Psyche Card, and see how in sync you are with ' + (name || 'them') + '.',
    inviteStart: 'Get my free Psyche Card',
    // The guessing game on the waiting screen, while a first free read is
    // written (app.js, openGuessGame). The prize is a credit on the
    // reader's link, on either first-run path.
    guessGameTitle: 'While you wait: guess which character you are',
    guessGameNote: 'Tap the character you think your card will name, then lock it in. A right guess wins a free credit.',
    // A run that cannot win (a paid card, a re-run, a device past its free card).
    guessGameNoteForFun: 'Tap the character you think your card will name, then lock it in. Just for fun this time: credits come with a first free card.',
    guessLockPick: 'Pick a character',
    guessLock: (name) => 'Lock in ' + name,
    guessLocked: (name) => 'Locked in: ' + name + '. Your card will tell you if you\u2019re right.',
    guessTooLate: 'Your card was finished before the guess arrived, so this one can\u2019t count.',
    guessLockFailed: 'The guess didn\u2019t go through. Try again.',
    // On the reader's card, once it is made.
    guessWonTitle: 'You guessed right!',
    guessWonText: (name) => 'You said ' + name + ', and your Psyche Card agrees. Your Psyche Report is free.',
    guessWonUse: 'Unlock it free',
    guessWonCredit: (name) => 'You said ' + name + ', and your Psyche Card agrees. 1 credit is on your link: use it for a question to PsycheAI or a Psyche Report to gift.',
    guessWonCreditLimited: (name) => 'You guessed right: ' + name + '! Today\u2019s free credits have all been given out, so this one could not be added.',
    // The waiting screen when the first free read writes the report too.
    workingFirstFull: 'Your Psyche Card and Psyche Report are being written together. It usually takes two to three minutes. Please be patient.',
    guessWonLimited: (name) => 'You guessed right: ' + name + '! Today\u2019s free Psyche Reports have all been given out, so this one could not be added.',
    guessMissed: (guess, name) => 'You guessed ' + guess + ', and your card says ' + name + '. Nice try!',
    guessMissedTitle: 'Not this time',
    guessNotCountedTitle: 'Your guess wasn\u2019t counted',
    guessNotCounted: {
      guessed: 'Each Instagram account gets one guess, and this one has already had it.',
      account: 'Your Instagram data has no username in it, so the guess could not be tied to an account.',
      firstCard: 'Guesses count only on an Instagram account\u2019s first free Psyche Card, and this account has had one before.',
    },
    // A guess that could not win, told how it went anyway: the line under it says why no credit.
    guessRightForFun: (name) => 'You said ' + name + ', and your Psyche Card agrees.',
    guessNoCredit: {
      guessed: 'This Instagram account has had its one guess for a credit, so this one was just for fun.',
      account: 'Your data has no username in it, so this guess couldn\u2019t earn a credit.',
      forFun: 'Credits come with a first free card, so this one was just for fun.',
    },
    guessYours: 'Your guess',
    guessCard: 'Your card',
    guessLater: 'Later',
    guessOk: 'OK',
    // A ✕ that puts a note away, read out by screen readers.
    close: 'Close',
    // In an app's own browser, above that: the first step, before any of the
    // request steps.
    inviteInAppTitle: (ios) => 'Step 1: open this page in ' + (ios ? 'Safari' : 'Chrome'),
    inviteInAppText: (app, name, ios) => possessive(name || 'Your connection') + ' invite is saved only in ' + app +
      '\u2019s browser, which can clear it before your data arrives. ' +
      (ios ? 'Tap \u22EF, then Open in Safari.' : 'Tap \u22EE, then Open in Chrome.'),
    inviteCardHint: 'Tap to explore',
    // On the reader's own report, once their card is made, while a friend's
    // link is waiting.
    syncInviteTitle: () => 'You have a connection waiting to sync with you',
    // The slim bar under the navigation once a free card exists.
    reportPromo: '✨ See the full story behind your card',
    reportPromoCta: 'Unlock your Psyche Report →',
    // The bar in its place once the report is in hand and signal strength is
    // under 80 (app.js, refreshSignalBar).
    // The score is in the ring beside it, so the line is only the ask.
    signalBarCta: (price) => 'Add more data to improve your signal strength – ' + price + ' →',
    // On a phone, short enough for one line.
    signalBarShort: (price) => 'Add data for a stronger signal – ' + price + ' →',
    // Opening a friend's link that was already synced on this device.
    // The reader's own link, opened or pasted by them.
    syncOwnLink: 'This is your own link. Send it to friends to sync with them.',
    syncAlreadyDone: (name) => 'Already synced with ' + (name || 'this connection') + ' – see your list below.',
    syncInviteGo: (name) => 'Sync with ' + (name || 'them'),
    // The bar on My Psyche has one button, to My Syncs, where the reader
    // picks who to sync with.
    syncInviteOpen: 'Sync',
    // A waiting row's button in the Sync list: not synced yet.
    syncWaitingGo: 'Sync?',
    syncWaitingMeta: 'Waiting to sync with you · free',
    // Before a sync with someone's personal link, and from the row's Share
    // button later (app.js, askShareSync).
    syncShareTitle: (name) => 'Share the results with ' + name + '?',
    syncShareText: (name) => name + ' will see the results and your Psyche Card in their Sync list. They are locked on the way, so PsycheAI cannot read them. You can also decide after seeing the results: there is a Share button in your Sync list.',
    syncShareTextLater: (name) => name + ' will see the results and your Psyche Card in their Sync list. They are locked on the way, so PsycheAI cannot read them.',
    syncShareYes: (name) => 'Yes, share with ' + name,
    syncShareNo: 'Sync without sharing',
    syncShareNotNow: 'Not now',
    syncSentBack: (name) => 'Shared with ' + name + ', with your Psyche Card.',
    syncShareFailed: (name) => 'Couldn\u2019t share with ' + name + ' just now. Try again from your Sync list.',
    // Several friends' links waiting at once: one bar, a button for each.
    syncInviteTitleMany: () => 'You have connections waiting to sync with you',
    inviteAlso: (names) => (names.length === 1 ? names[0] + ' also sent you their card'
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' also sent you their cards') +
      ' – you can sync with everyone once your card is ready.',
    inviteCardOpen: (name) => 'See ' + possessive(name || 'your connection') + ' Psyche Card full screen',
    // The one share message, everywhere: Share Card, Copy link, a sync's
    // result, the roast. It carries the reader's one link (myLinkUrl in
    // app.js): the same link for a bio, an invite and a comparison.
    cardShareText: (character, url) => (character ? 'I got ' + character + ' for my Psyche Card. ' : 'My Psyche Card. ') +
      'Get yours now for free: ' + (url || 'https://psycheai.io'),
    // The hub's Psyche Sync Share: the same, asking them to sync.
    syncInviteText: (character, url) => (character ? 'I got ' + character + ' for my Psyche Card. ' : 'My Psyche Card. ') +
      'Get yours now for free and sync with me: ' + (url || 'https://psycheai.io'),
    cardHint: 'Tap to open full screen',
    // The QR code in the foot of the reader's own card: their one link.
    cardQrCall: 'Scan to see how in sync we are',
    cardQrLabel: 'QR code: this card’s link, to see how in sync you are',
    // Download sits on the left, share on the right — the order a reader
    // meets them reading left to right. Each carries a small visible label
    // beside its icon (`cardDownloadLabel`/`cardShareLabel`) plus a fuller
    // aria-label (`cardDownload`/`cardShare`) for a screen reader — the two
    // do not have to say the same thing, and the aria-label is the one that
    // still spells out what the download actually produces.
    cardDownload: 'Download as image',
    cardDownloadLabel: 'Download',
    cardShare: 'Share Card',
    cardShareLabel: 'Share Card',
    // One shared status line under both buttons rather than each swallowing
    // its own label on failure, since the visible label is a fixed word
    // ("Download"/"Share") rather than a place an error could borrow.
    cardImageError: 'Could not build the image',

    cardType: 'MBTI',
    cardPatterns: 'Your patterns',
    cardBigFive: 'Big Five',
    cardValues: 'Values',
    cardBeliefs: 'Beliefs',
    cardInterests: 'Interests',
    // How they like care shown, and show it: love languages, worded for
    // friends as much as anyone, since the card travels to anyone.
    cardLoveIn: 'Receives care as',
    cardLoveOut: 'Shows care as',
    cardSyncs: 'Most in sync with',
    cardConfidence: 'Confidence',

    bigFive: 'Big Five',
    bigFiveSub: '0–100, where 50 is an average person. Each score lists the evidence behind it.',

    // PDF-only: the cover's contents list, built from the sections that
    // actually printed rather than from a fixed table of them.
    pdfContents: 'Inside this report',
    mbtiPrefix: 'MBTI: ',
    mbtiConfidence: 'Confidence: ',
    mbtiOver: 'over ',

    interests: 'Interests',
    interestsEmpty: 'Nothing stood out strongly.',

    valuesBeliefs: 'Values & Beliefs',
    valuesBeliefsSub: 'What you appear to hold to, and how firmly the data actually says so.',
    values: 'Values',
    valuesEmpty: 'Your data did not support any confident read here.',
    beliefs: 'Beliefs',
    beliefsEmpty: 'Nothing in your data supported a confident read on beliefs – which is a ' +
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
    attachmentSub: 'How you are likely to behave when you are close to someone – a guess from ' +
      'behaviour, shown with the working.',
    attachmentPrefix: 'Attachment: ',
    readFrom: 'Read from',
    attachmentPractice: 'What it means in practice',
    // How they handle disagreement, inside the attachment read — the line the
    // card shows as its conflict style, explained.
    attachmentConflict: 'How you deal with conflict',
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
    //
    // It also sets the expectation that this one is blunt. The section is
    // written to be direct about difficult periods rather than to euphemise
    // them (see PREMIUM_SYSTEM), and a reader who is told that up front can
    // decide when to read it — which is a kinder thing to offer than a
    // softened section they were not warned about.
    wellness: 'Mental wellness',
    wellnessSub: 'Six dimensions read from how you actually use these accounts. This is a behavioural ' +
      'read, not a health assessment – there is no score here, and there is not meant to be. It is ' +
      'written to be honest rather than gentle, including about the harder stretches.',
    wellnessOverall: 'Taken together',
    wellnessSuggestions: 'What might actually help',
    wellnessConfidence: 'Confidence: ',
    // Static rather than part of what the model returns — the same choice, for
    // the same reason, as bonusCaveat above. This is the "not an assessment,
    // talk to a person" line for the section that sits closest to health in
    // the whole app, so it is worded identically on every run rather than
    // being left to a field the model could soften, shorten or forget. See
    // the comment on the wellness schema in lib/prompts.js.
    wellnessCaveat: 'A read of patterns in how you use social media, not of your mental health – it is not a diagnosis and cannot see your circumstances. If anything here weighs on you, talk to a GP or a qualified professional.',

    linkContents: 'What your link contains',
    linkContentsFields: ['First name', 'Who you are most like', 'Tagline', 'MBTI', 'Big Five', 'Top motivators',
      'Patterns', 'Values & beliefs', 'Interests', 'How you show care', 'With connections & at work', 'Rhythm & energy'],

    // Under a sync's results: first, whether the other person can see them
    // (app.js, refreshCompatReturn). 'share': not yet, and it can be shared;
    // 'shared'; 'received': they sent it; 'link': a long link, not shareable.
    compatReturnTitle: (name, state) => state === 'shared' ? 'Shared with ' + name
      : state === 'received' ? name + ' shared these results with you'
      : state === 'share' ? 'Share the results with ' + name + '?' : name + ' cannot see these results yet',
    compatReturnText: (name, state) => state === 'shared'
      ? name + ' can see these results and your Psyche Card in their Sync list.'
      : state === 'received' ? 'They synced with your link and chose to share the results with you.'
      : state === 'share'
        ? name + ' cannot see these results yet. If you share them, ' + name + ' will see the results and your Psyche Card in their Sync list. They are locked on the way, so PsycheAI cannot read them.'
        : 'The sync runs on the side of whoever opens the link, so ' + name +
          ' does not have this report. Send them your link and they get their own, free.',
    linkMessageCopied: 'Message and link copied. Paste it to them in WhatsApp, Telegram or a DM.',
    // Copy link copies the link alone (October 2026); Share still sends the message.
    linkCopied: 'Link copied. Paste it to them in WhatsApp, Telegram or a DM.',
    linkMessageCopiedShort: 'Copied ✓',
    shortLinkUnreadable: 'That link couldn\u2019t be opened. It may have expired or been cut short – ask for it again.',
    linkCopyPrompt: 'Copy this and send it to them:',

    matches: 'Your matches',
    // My Syncs: each past sync's two buttons.
    matchSyncLabel: 'Results',
    // Under a past sync's name, before its date.
    matchSyncedMeta: 'Synced',
    // A sync someone ran with this reader's link, sent back to them.
    matchReceivedMeta: 'Synced with you',
    matchNew: 'New',
    // The popout when syncs someone ran with this reader's link arrive.
    syncedTitle: (name) => name + ' synced with you',
    syncedTitleMany: (count) => count + ' connections synced with you',
    syncedText: (name) => name + ' ran a Psyche Sync with your card and shared the results with you. They are in your Sync list.',
    syncedTextMany: (names) => names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] +
      ' ran a Psyche Sync with your card and shared the results with you. They are in your Sync list.',
    syncedOpen: 'See the results',
    syncedOpenMany: 'See them in My Syncs',
    syncedLater: 'Later',
    // A sync this reader can still share with the person whose link it was.
    matchShareLabel: 'Share',
    matchShareAria: (name) => 'Share the results with ' + (name || 'them'),
    matchSharedMeta: 'Shared',
    matchOpenCard: (name) => name ? 'Open ' + possessive(name) + ' Psyche Card' : 'Open their Psyche Card',
    matchOpenSync: (name) => 'Open your Psyche Sync with ' + (name || 'them'),

    // Cover copy for the three sections behind the paywall. Each says
    // specifically what is behind it rather than gesturing at "more
    // analysis": a reader deciding whether to pay is owed the same honesty
    // as a reader deciding whether to look at the roast below, and a vague
    // cover is the version that sells worst *and* informs least.
    wellnessCoverTitle: 'Six dimensions, read from your behaviour',
    wellnessCoverBlurb: 'Sleep and rhythm, cognitive load, social connection, physical activity, ' +
      'emotional processing and meaning – each with the evidence behind it, an honest confidence ' +
      'level, and concrete suggestions. A behavioural read, never a health assessment.',
    attachmentCoverTitle: 'How you are to be close to',
    attachmentCoverBlurb: 'Your likely attachment style with the working shown – which traces point ' +
      'there, which style was considered and rejected, and what it means in practice for you and for ' +
      'whoever is close to you.',

    // Sits between the attachment read and the career assessment, in the
    // report and in PAID_SECTIONS — it argues directly off the attachment
    // section immediately above it, so the two have to stay adjacent.
    idealPartner: 'Ideal partner traits',
    idealPartnerSub: 'What you actually need in a partner, argued from your attachment style rather ' +
      'than guessed at – and what to be careful of.',
    idealPartnerCoverTitle: 'What kind of partner truly suits you',
    idealPartnerCoverBlurb: 'What you actually need in a partner to be well, argued from your ' +
      'attachment style rather than a wishlist of adjectives – what to be careful of, and an honest ' +
      'verdict on what suits you.',
    idealPartnerNeeds: 'What you actually need',
    idealPartnerCarefulOf: 'What to be careful of',
    idealPartnerSummary: 'The honest verdict',

    careerCoverTitle: 'A career coach on your edge',
    careerCoverBlurb: 'Where you appear to be, the thing you do reliably that most people do not, ' +
      'what you are visibly not using, the pattern most likely to cost you – and actions to take ' +
      'this week, this quarter and this year.',
    // The title of the free click-to-reveal section now, not a paid one —
    // see `bonusCoverTitle` above and `roastBlock()` in docs/app.js. No
    // longer part of `PAID_SECTIONS`.
    bonus: 'Let us roast you',
    // Sits beside the title as a small badge, the same way "Coming soon"
    // does on the comprehensive depth option — a label for what the section
    // is, not a second title competing with the one it sits next to. Shared
    // by all four paid sections: see `PAID_SECTIONS` in docs/app.js, which
    // applies it uniformly.
    // Labels the coverage line under the confidence score. "Read from" rather
    // than "based on": the point is what the model actually had in front of
    // it, which is the distinction the score itself was getting wrong.
    confidenceBasedOn: 'Read from',
    premiumBadge: 'Premium',
    // The welcome hero's video: its accessible name, and the one button on it,
    // which says what tapping it will do.
    heroVideoLabel: 'PsycheAI in 45 seconds: what it reads, your Psyche Card and the Psyche Report',
    heroVideoSound: 'Tap for sound',
    heroVideoMute: 'Mute',
    heroVideoPlay: 'Play with sound',
    // The player's own controls, each named for what pressing it does.
    heroVideoPlayShort: 'Play',
    heroVideoPause: 'Pause',
    heroVideoUnmute: 'Turn sound on',
    heroVideoFull: 'Full screen',
    heroVideoExitFull: 'Exit full screen',
    heroVideoSeek: 'Position in the video',
    // The roast's counterpart to that badge. It marks the section the same way
    // — a word in the heading saying what kind of thing this is — but says
    // "included" rather than "paid for", which is the distinction a reader
    // scanning the page is actually making. Without it the roast is the one
    // section on the page whose heading carries no marker at all, and it sits
    // among four that do.
    bonusBadge: 'Bonus',
    // My Psyche's roast, under the card: a free secret bonus that comes with
    // every Psyche Card. See secretRoastHtml() in docs/app.js.
    secretRoast: {
      badge: 'Secret bonus unlocked',
      lede: 'Your card is the nice version. This is the other one: what your data says when nobody is being polite.',
      warn: 'Deliberately unkind, and just for you. It is not on your card and is never in your link.',
      reveal: 'Reveal my roast',
    },

    // Shown under a free card, in place of the written report — see
    // fullReportLockedHtml in docs/app.js.
    fullReportSample: 'See sample report',
    fullReportTitle: 'Unlock your Psyche Report',
    // One list, one offer: the explanations behind the card and the four
    // sections it does not touch, read as the single report they are bought as.
    // Each line says what that part of the report actually contains, at the
    // length the four premium covers already run to, so the reader is deciding
    // on specifics rather than on section names.
    fullReportBlurb: 'Your card shows the conclusions. The Psyche Report explains each one with the evidence from your own data, adds what the card leaves out, and ends with a plan for your personal growth.',
    explainWho: 'Why that character fits you and not a neighbouring one, then the long read on who you ' +
      'are – the patterns that run through years of your posts and messages, drawn together into a ' +
      'portrait specific enough that it could not be anyone else\'s.',
    explainBigFive: 'Each of your five scores taken apart – what pushed it up, what held it down, and the ' +
      'evidence behind it, counted, from your captions, messages and rhythm. Including where the case is ' +
      'thinner than the number suggests.',
    explainTypesTitle: 'MBTI',
    explainTypes: 'Letter by letter – the behaviours that put each one there, the evidence that pulls the ' +
      'other way, how firmly it holds, and what each letter looks like in your ordinary week.',
    explainListsTitle: 'Interests, values & beliefs',
    explainLists: 'What you actually care about, with the evidence for each – where it shows up, how ' +
      'often and since when. Each is marked as lasting, rising, fading or dormant, so you can see which ' +
      'passions are current and which are history.',
    explainPeopleTitle: 'In relationships & at work',
    explainPeople: 'How you are to date, be close to and work with – your real strengths and the blind ' +
      'spots that cost you, each with its evidence. Plus how you show love and how you want to receive ' +
      'it, and where those two do not match.',
    explainActivity: 'What your posting rhythm, timing and feed say about you – when you are active, how ' +
      'that has changed over the years, what you consume against what you publish, and what your habits ' +
      'show that you would not have said yourself.',
    // The sample report's paid sections show their real covers now — same
    // title, same blurb, same price mentioned in the blurb — but the button
    // underneath is inert (see paidCard's `sample` option) and disabled, so it
    // reads as "here is what this looks like" rather than as a working
    // control on a report that is not the reader's own.
    premiumSampleUnlockLabel: 'Unlock',
    bonusSub: 'Everything else in this report is trying to be fair. This part is not trying.',
    // Free again, behind a click-to-reveal cover rather than a payment — the
    // cover is a consent gate, not a paywall, so what it says is what is
    // behind it and why somebody might want to skip it, not what it costs.
    bonusCoverTitle: 'This roast is deliberately unkind',
    bonusCoverBlurb: 'The least charitable, most honest-friend version of everything above – ' +
      'deliberately unkind, not a diagnosis, and part of your Psyche Report. Read it if you ' +
      'want the truth without the softening; skip it if you do not.',
    // The button that opens the cover, and the one that puts it back. Unlike
    // the paid sections' `.premium-unlock`, clicking this never reaches a
    // payment dialog — see bonusReveal()/hideRoast() in app.js — so the
    // labels say "read"/"hide" rather than anything about a charge.
    bonusReveal: 'Read it anyway',
    bonusHide: 'Hide this again',
    bonusHarsh: 'The least charitable assessment of you',
    bonusAdvice: 'What an honest friend would tell you',
    // Stays on screen beside the writing rather than only appearing on the
    // cover: this is the part a reader most needs while they are reading it,
    // and the part they are least likely to scroll back up for.
    bonusCaveat: 'An AI being deliberately harsh about your data – not an assessment and not a diagnosis. Argue with it, and if any of it lands heavier than that, talk to someone you trust or a professional.',
    // The section's own button is drawn before anything has been fetched
    // from the server, so it carries this static label; the dialog it opens
    // fetches a real PaymentIntent and shows *that* amount once it has one,
    // which is the one actually charged. Two numbers agreeing is a sign they
    // have not drifted, not a coincidence to engineer away.
    premiumPriceLabel: 'US$5',
    // In the data popout, once a fresh export is loaded over an existing card.
    cardChangeNote: 'Updating your data sources may change your Psyche Card.',
    premiumSourcesTitle: 'Your data for the Psyche Report',
    // Before that page, when the card's confidence is under 80: more sources
    // make a better report.
    // Before the review on a first upload with almost no writing in it.
    thinDataTitle: 'Your data is on the thin side',
    thinDataText: 'There is not much in your data to read, so your card would be partly a guess, and your free Psyche ' +
      'Card is once per Instagram account. Adding WhatsApp chats with close friends, your Google data or your Facebook ' +
      'data will make it much more accurate.',
    thinDataAdd: 'Add more data',
    // Under the floor of their own writing (October 2026): no run at all.
    tooThinTitle: 'Not enough of your own writing to read',
    tooThinText: (k) => 'Your card is read mostly from what you write yourself: captions, comments and messages. ' +
      'Your data has less than ' + k + ',000 characters of it, too little for a reading worth having. Add WhatsApp chats ' +
      'with close friends, your Google data or your Facebook data, then try again.',
    tooThinBack: 'Back',
    thinDataContinue: 'Continue anyway',
    moreDataTitle: 'Make your report more accurate',
    moreDataText: (score) => 'Your Psyche Card was read with ' + score + '% confidence. Adding more data – WhatsApp chats ' +
      'with up to 3 close connections, your Google data or your Facebook data – gives the Psyche Report more to go on, ' +
      'and you can add it on the next page.',
    moreDataContinue: 'Continue',
    moreDataBack: 'Back',
    // The review's downloadable copy only, at the unlock: what this file is.
    deepReviewNote: 'This is what the Psyche Report is written from: everything your card was read from, with the data you just added on top.',
    // The premium read rebuilt from the export still open in the tab: the
    // same sources, more of each.
    deepRebuiltNote: 'This is what the Psyche Report is written from: the data your card was read from, with anything you just added.',
    premiumSourcesBlurb: 'More data, a fuller report: add or replace a source, or carry on. You review what is sent first.',
    premiumUnlockPrefix: 'Unlock your Psyche Report – ',
    // The free card's unlock offer leads with sharing: one connection making
    // their card from the reader's link unlocks their first Psyche Report free
    // (lib/referral.js, claimFirst; an open of the link did until October
    // 2026). Paying is the quiet second way in.
    unlockShare: {
      title: 'Unlock by sharing your link with 1 connection',
      sub: 'Your Psyche Report unlocks free as soon as 1 connection makes their Psyche Card from your link.',
      subReady: 'A connection made their Psyche Card from your link – your Psyche Report is free.',
      share: 'Share my link',
      copied: 'Link copied – send it to a connection',
      claim: 'Unlock my Psyche Report free',
      pay: 'or pay US$5',
      // On the payment sheet, above the ways to pay.
      sheetTitle: 'Free when you share your link',
      payHead: 'Or pay US$5',
    },
    // Shown while the paid model call is in flight, after payment has already
    // cleared — this can take as long as the free report did, for the same
    // reason: a long structured response with thinking enabled. The dialog
    // also shows a live seconds count beside it (see #premium-progress) for
    // the same reason app.js shows elapsed time on the free analysis: a
    // still sentence next to a spinning bar reads as stalled.
    // Shown while the paid model call is in flight, after payment has already
    // cleared — this can take as long as the free report did, for the same
    // reason: a long structured response with thinking enabled. The dialog
    // also shows a live seconds count beside it (see #premium-progress) for
    // the same reason app.js shows elapsed time on the free analysis: a
    // still sentence next to a spinning bar reads as stalled.
    // The unlock is one call: the written report behind the card, the roast and
    // the four premium sections, in one response.
    premiumGenerating: 'Writing your Psyche Report… this may take a few minutes.',
    // The three states of coming back to an unlock that never arrived. Not one
    // string, because "you already paid" is the part that has to land first
    // and a reader skimming a dialog reads the title.
    // Shown at startup when a purchase was made but its result never arrived.
    // Deliberately says the payment is fine and names no price: somebody who
    // has already paid and is being asked to press a button again needs to
    // know they are collecting, not buying.
    pendingAnalysisText: 'Your payment went through but the analysis didn’t arrive. Fetching it again is free.',
    pendingAnalysisLabel: 'Get the analysis you paid for',
    pendingCompatText: 'Your payment went through but the report didn’t arrive. Fetching it again is free – no need to scan again.',
    pendingCompatLabel: 'Get the report you paid for',
    pendingNeedsInstagram: 'Your payment is still good. Load your Instagram data again and the analysis will run at no charge.',
    // Shown to somebody who put their phone down mid-analysis and came back.
    // It says the two things they need: nothing was lost, and there is nothing
    // for them to do — because the instinct on returning to a waiting screen
    // is to assume it has been stuck there the whole time and to start again.
    resumingJob: 'Your analysis kept running while you were away – it does not need this page to ' +
      'be open. Picking it back up now; it will appear as soon as it is finished.',
    premiumResumeLabel: 'Get the Psyche Report you paid for',
    premiumResumeTitle: 'You have already paid',
    premiumResumeBlurb: 'Your payment went through but the report didn’t arrive. Fetching it again is free.',
    premiumResumeAction: 'Fetch my Psyche Report',
    // The second thing this app sells, and the reason its copy is separate
    // from the unlock's: they buy different things, and a dialog that says
    // "unlock premium sections" while charging US$2 for a re-run would be
    // describing the wrong purchase.
    analysisDialogTitle: 'Run your Psyche Card again',
    // The card-payment button on that sheet, before its price.
    analysisPayPrefix: 'Run your Psyche Card again – ',
    analysisDialogBlurb: 'Your first Psyche Card is free; each one after that is US$2.',
    // Shown on the upload page and beside the re-run button once the free run
    // is spent, so the price is never a surprise sprung at the last moment.
    analysisPriceNote: 'Your next Psyche Card costs US$2.',
    // Shown instead of the above once premium is unlocked — re-running then
    // bundles the four paid sections back in, at the unlock's own US$5
    // rather than the plain re-run's US$2, whether or not a free run is
    // still available. See rerunWithAdditionalData's alreadyUnlocked branch.
    analysisPriceNoteUnlocked: 'Adding or changing data and re-running the Psyche Card and Psyche Report costs US$5.',
    analysisDeclined: 'No charge was made. Your existing report is untouched.',
    // The daily server-wide ceiling, which is nobody's fault and not something
    // paying can always fix — so it says what it is rather than blaming them.
    premiumDialogTitle: 'Unlock your Psyche Report',
    // Shown instead of the unlock copy above when the reader already has
    // premium and is re-running with added or changed data — "unlock" would
    // be the wrong verb for sections they already have. Same US$5, same
    // product, just a different reason to be paying it — see
    // rerunWithAdditionalData's alreadyUnlocked branch.
    // The payment sheet when it sells Ask PsycheAI questions.
    askDialogTitle: 'Get 5 questions for Ask PsycheAI',
    askDialogBlurb: 'Five questions about your Psyche Report, each answered from it with steps to take this week. Questions you do not use stay for later.',
    askPayPrefix: 'Pay ',
    premiumRerunDialogTitle: 'Re-run your Psyche Card and Report',
    premiumRerunDialogBlurb: 'One charge regenerates everything against your new data – your card and the Psyche Report together.',
    premiumMockPay: 'Simulate payment (mock mode)',
    premiumNotConfigured: 'Payments are not set up on this server yet.',
    // Followed immediately by the card fallback mounting itself (see
    // mountCardFallback in docs/app.js), so this now describes what changed
    // rather than leaving a reader stuck with only a promo code they do not
    // have.
    premiumNoWallet: 'This browser does not have Apple Pay or Google Pay available to it. Pay by ' +
      'card below instead.',
    // The card form's own label, shown above it once it mounts — "Or" reads
    // correctly whether it follows the wallet message just above (most of
    // the time) or stands alone as the only option this dialog ever offered
    // this browser.
    premiumCardLabel: 'Or pay by card',
    premiumFailed: 'The payment did not go through. Nothing was charged.',
    // The payment can succeed and the analysis call can still fail on its own
    // — a slow model, a dropped connection — so this says plainly that the
    // charge itself is not in question, only the writing. A promo code that
    // authorised the call but hit the same failure reads the same way, since
    // "went through" is true of either kind of authorisation.
    premiumGenerationFailed: 'That went through, but the analysis could not be generated. Try again – ' +
      'the same payment can be used a few more times before it needs a new one.',
    // Shown between the two calls an unlock-with-added-data makes. Says
    // plainly that the second one is not another charge, because a second
    // progress bar after a payment otherwise reads like one.
    premiumRefreshingFree: 'Writing your Psyche Report from the new data – this takes a few minutes. Your card is redrawn with it at no extra charge…',
    premiumCancel: 'Back',
    premiumRetry: 'Try again',
    premiumPromoLabel: 'Have a promo code?',
    // The account's free card is spent (one per Instagram account): said on
    // the US$2 sheet that follows.
    // The review sheet's forward button. Where something is still to be paid
    // it opens the payment sheet, which is where any charge is made, so it
    // says Proceed rather than "Make payment": on the free unlock there is
    // nothing to pay at all.
    reviewProceed: 'Proceed',
    reviewSend: 'Send this',
    freeUsedBlurb: 'This Instagram account has already had its free Psyche Card. Unlock your Psyche Card and Psyche Report for US$5.',
    // The server makes no free read from data it cannot tie to an Instagram
    // account (server.js, noAccount; October 2026): no username in it, and no
    // dates on any message or post.
    freeNoAccount: 'This data could not be matched to its Instagram account, so a free read cannot be made from it. Download your Instagram data again, in JSON, and load the whole file.',
    // The sheet for a paid run past the free card: never a card alone since
    // late October 2026, always the card and its report (authoriseAnalysis).
    bundleDialogTitle: 'Your Psyche Card and Psyche Report',
    bundleDialogBlurb: 'Your first Psyche Card is free. After that, a new card comes with your full Psyche Report: US$5 for both.',
    // The same sheet when a first run brings the report too (firstRun 'merged').
    bundleDialogBlurbFirst: 'Your first Psyche Card and Psyche Report are free. After that, a re-run brings a new card and its full Psyche Report: US$5 for both.',
    // Your link's numbers and credits (lib/referral.js): every connection's
    // card earns a credit, for a question or a gift.
    referral: {
      title: 'Your Referral',
      blurb: 'Every connection who makes their card from your link earns you 1 credit. Redeem a credit for 5 questions to PsycheAI, or for a Psyche Report to gift.',
      shareHint: 'Share your card or link to start.',
      // The small button at the head's right: the same share message and
      // link as the card's own Copy link.
      copyLink: 'Copy link',
      copyLinkTip: 'Copy your share message and link',
      // Opens of the link by others, once a day per browser (never the reader's own).
      opens: 'opened your link',
      cards: 'made a card',
      syncs: 'synced with you',
      credits: 'credits',
      ready: n => n === 1 ? '🎉 You have 1 credit' : '🎉 You have ' + n + ' credits',
      copyShort: 'Copy',
      gift: 'Gift a Psyche Report (1 credit)',
      useFree: 'Unlock free – a connection made their card from your link',
      useGift: 'Use your gifted free Psyche Report',
      claimFailed: 'You have no credits to spend yet.',
      firstFailed: 'Your free Psyche Report unlocks once 1 connection makes their Psyche Card from your link.',
      // When this account has had a Psyche Report already (lib/referral.js, FIRST_USED).
      firstUsedPay: 'Your free Psyche Report from your link was for your first one. You can unlock this one below.',
      giftShareText: 'A free Psyche Report, from me 🎁 Make your free Psyche Card, then unlock the Psyche Report with this link:',
      giftCopied: 'Gift link copied. It unlocks one Psyche Report, once, within 60 days.',
      giftsHead: 'Gift links you have made (each works once, for 60 days)',
      giftArrivedTitle: 'You’ve been gifted a free Psyche Report',
      giftArrivedNew: 'Make your free Psyche Card first, then unlock the Psyche Report with it – no payment needed.',
      giftArrivedHave: 'Unlock your Psyche Report with it – no payment needed.',
      giftUse: 'Unlock with my gift',
    },
    premiumPromoPlaceholder: 'Promo code',
    premiumPromoApply: 'Apply',
    // A discount code, accepted: what it took off and what is left to pay.
    premiumPromoDiscount: (code, percent) => 'Promo code ' + code + ' applied: ' + percent + '% off.',
    // A code that came in the reader's link (?promo=), on the unlock box and
    // the payment sheet.
    linkPromoNote: (code) => 'Promo code ' + code + ' from your link is applied at checkout.',
    linkPromoFree: (code) => 'Promo code ' + code + ' unlocks the Psyche Report free. Tap Apply to start it.',
    linkPromoFreeCard: (code) => 'Promo code ' + code + ' runs your card again free. Tap Apply to start it.',
    // A code the server could not check just now: never assumed free.
    promoCheckFailed: (code, reason) => 'Couldn\u2019t check ' + code + ' just now' +
      (reason ? ' (' + String(reason).replace(/\.$/, '') + ')' : '') + '. Tap Apply to try again.',
    linkPromoRefused: (code, reason) => 'The promo code in your link (' + code + ') could not be used: ' + String(reason || '').replace(/\.$/, '').replace(/^That code/, 'it') + '.',
    // The price on the payment sheet: the full price, and with a discount
    // code the discount and what is left to pay.
    premiumPriceFull: 'Price',
    premiumPriceDiscount: (code, percent) => 'Promo ' + code + ' (' + percent + '% off)',
    premiumPriceNet: 'You pay',

    trust: 'How much to trust this',
    trustScore: 'Signal strength: ',
    // The six trajectory labels, keyed by the enum in lib/prompts.js. Written
    // for a reader rather than for a schema: "structural" is accurate and
    // means nothing to anybody, where "throughout" says the same thing in a
    // word they already know. Kept as a map so a renamed enum value fails
    // visibly here rather than silently rendering a raw token.
    //
    // Each is a bare word so the three that carry a year read correctly after
    // the separator — "Dormant · 2019", not "Dormant since · 2019". The
    // separator is doing the work "since" would; see trajectoryPill.
    // trajectoryNote is the tooltip that spells that out, because a middot
    // between a word and a year is compact rather than self-explanatory.
    trajectoryLabels: {
      structural: 'Throughout',
      stable: 'Ongoing',
      rising: 'Growing',
      declining: 'Fading',
      dormant: 'Dormant',
      phasic: 'A phase',
    },
    trajectoryNote: 'The most recent year this shows up in your data',
    // Shown in Evidence and method's sources when the digest itself has gone
    // — the report survives in its own localStorage entry, the evidence behind
    // it does not. Says what re-running will ask for rather than leaving a
    // reader to discover it by pressing the button.
    sourcesInstagramLost: 'Your browser has cleared the data this report was read from. The report is safe; ' +
      'to run it again, load your Instagram data below.',
    sourceInstagram: 'Instagram',
    sourceGoogle: 'Google Takeout',
    sourceFacebook: 'Facebook',
    sourceWhatsApp: 'WhatsApp chats',
    // The WhatsApp row: up to three chats, each exported on its own.
    // `max` is 3 from the report page, 1 on a first upload.
    whatsappRowEmpty: (max = 3) => max === 1 ? 'One chat from WhatsApp (.zip or .txt)'
      : 'Up to ' + max + ' close-friend chats (.zip or .txt)',
    whatsappRowSome: (n, max = 3) => max === 1 ? 'Chat loaded – tap to load a different one'
      : n + ' of ' + max + ' chats loaded – tap to ' + (n >= max ? 'start over' : 'add another'),
    // The first upload's WhatsApp row and the tag on its two optional rows.
    whatsappFirstTitle: 'WhatsApp chats',
    sourceOptional: '(Optional)',
    // Instagram's tag on a first upload, set as a pill.
    sourceRequired: 'Required',
    whatsappWhoAreYou: 'Which of these is you? Your own messages are the ones read.',
    // A WhatsApp chat already loaded (same file or same person), not taken twice.
    whatsappRepeat: (names) => (names.length === 1 && names[0]
      ? 'Your chat with ' + names[0] + ' is already loaded'
      : 'That chat is already loaded') + ' – choose a chat with someone else.',
    whatsappFull: (max = 3) => max === 1 ? 'One chat is the most here – this one replaces the last.'
      : 'Three chats is the most – these start a fresh set.',
    // Flashed on the report when Continue is pressed with no Instagram export
    // loaded and none stored. Names the one thing that would make the re-run
    // possible, rather than reporting a failure the reader cannot act on.
    // The welcome page's "Start here" button and the line under it. The label
    // changes once anything is loaded, because at that point the button is no
    // longer asking for a file — it is the way back into a run that failed,
    // and "Load your data" would read as "do it all again".
    startLoad: 'Load your data',
    startContinue: 'Continue with your data',
    startLoadedSuffix: ' already loaded – nothing to upload again.',
    startNeedsInstagram: 'Load your Instagram data to get started.',
    rerunNeedsInstagram: 'Your Instagram data is no longer on this device. Load it again to rewrite your report.',
    // The digest failed to save — almost always a full localStorage. Said at
    // the moment it happens rather than left for the reader to discover when
    // a re-run has nothing to work from. The report itself is stored
    // separately and is usually fine, so this does not claim otherwise.
    digestTooLarge: 'Your report is saved, but its evidence was too big for this browser. A re-run will ask for your Instagram data again.',

    // The popout adding or changing data opens, ahead of the review — see
    // askDataSources() in app.js. Every source already loaded is ticked but
    // stays clickable, so a reader can replace any one of them, Instagram
    // included, without starting the whole report over.
    dataSourcesTitle: 'Add or change your data',
    dataSourcesBlurb: 'Add or replace a source. Before anything is sent, you review exactly what it contains and can untick anything.',
    // The same popout reached to re-run a card and report already made (October 2026).
    rerunSourcesBlurb: (price) => 'Add more data to improve your signal strength. A re-run costs ' + price + ', and you review what is sent first.',
    // The same popout opened from the welcome page, where there is nothing to
    // change yet — "Add or change" describes a report that does not exist and
    // offers to replace data nobody has loaded.
    dataSourcesFirstTitle: 'Add your data',
    // This is the welcome card's old sub-line, moved. It was making its promise
    // one screen too early — above a button, about a review step two screens
    // away — where here it sits immediately before the thing it describes, at
    // the moment somebody is deciding whether to hand over their history.
    //
    // It opened "Load your data below." and no longer does. The rows are
    // directly beneath it and each says what it wants, and one of them now
    // says whether it is required — an instruction to do the obvious thing
    // was spending the reader's first line of attention on the one part of
    // this screen that needs no explaining. What is left is the part they
    // could not have guessed.
    dataSourcesFirstBlurb: 'Before anything is sent, you review exactly what it contains and can untick anything.',
    // The Instagram row's own line on that same popout. The markup's version
    // ends "to replace it", which is right on the report page and describes
    // replacing something that does not exist yet here.
    //
    // The parts sentence is here because Instagram splits a large export into
    // numbered .zip files and hands over several at once — on exactly the
    // accounts this app most wants, since the split happens when there is a
    // lot of history. Selecting them together works and always has: readExports
    // merges every archive it is given. Selecting them one after another does
    // not, because the second read replaces the first, and it does so silently
    // — the tick looks identical either way, and a half-loaded export usually
    // still clears the recognition check and produces a confident report from
    // half the evidence. Saying it here is the cheap half of the fix.
    // The "several files" note is gone from the wording; picking several at
    // once still works (the picker allows it, and readExports merges them).
    dataSourcesFirstInstagram: 'Load your Instagram data .zip file here.',

    // The Psyche Sync report. It is two renderings of one document for the
    // same reason the profile is — the page and the downloadable PDF — so its
    // headings live here too rather than being typed once in each.
    // The sync's sections, in order: the summary leads, then these.
    compatAlign: 'Where you align',
    compatDiffer: 'Where you differ',
    compatRelate: 'How to relate better',
    compatBoth: 'Both of you',
    compatFor: 'For ',
    syncName: 'Psyche Sync',

    // The scan page, which is where a comparison starts and where past ones
    // are listed.
    // Inside an app's own browser (Instagram, Facebook, TikTok…).
    inAppWarn: (app, ios) => app + '\u2019s browser can erase your Psyche Card. ' +
      (ios ? 'Tap \u22EF, then Open in Safari.' : 'Tap \u22EE, then Open in Chrome.'),
    inAppData: (app) => app + '\u2019s browser can erase what you make here. Open psycheai.io in Safari or Chrome first.',
    // A private window, by the best guess a page can make (app.js, warnPrivate):
    // said as a guess, since browsers hide it on purpose.
    privateWarn: 'This looks like a private window, which forgets your Psyche Card when closed. Use a normal window to keep it.',
    inAppChrome: 'Open in Chrome',
    inAppCopy: 'Copy link',
    inAppCopied: 'Link copied',
    scanHistory: 'Psyche Sync',
    // My Syncs: one list, friends waiting to sync at the top, then past syncs.
    syncsList: 'Sync list',
  };

  // ---------- the structured report layout ----------
  //
  // The report's own words, in one object the page and the PDF both read
  // from. Some strings above it were the retired classic layout's and are
  // still shared.
  //
  // The section definitions are this app's own wording. Professional
  // assessments open each section with a line saying what it measures; that
  // structure is borrowed, the words are not.
  const STRUCTURED = {
    // The five parts, plus the overview before them and the appendix after.
    // How you connect and How you work were one part; they are two, so a
    // reader looking for the career read finds it in the menu.
    parts: {
      overview: { label: 'Overview', title: 'Overview',
        intro: 'The short version of everything below, and the patterns that run through it.' },
      who: { label: 'Part 1', title: 'Who you are',
        intro: 'Your temperament – your type and the five broad traits underneath it – and how you are doing.' },
      drives: { label: 'Part 2', title: 'What drives you',
        intro: 'What you are working towards, what you keep coming back to, and what you hold to.' },
      connect: { label: 'Part 3', title: 'How you connect',
        intro: 'How you are with the people close to you.' },
      career: { label: 'Part 4', title: 'How you work',
        intro: 'Your edge, what holds you back, and the work that suits you.' },
      together: { label: 'Part 5', title: 'Putting it together',
        intro: 'What to build on, what to work on, how your strengths behave under pressure, and how this report was made.' },
      // Part 06: how the report was made, and the roast.
      appendix: { label: 'Part 6', title: 'Appendix',
        intro: 'How this report was made, and the roast.' },
    },

    // One line per section: what it measures, before anything about you.
    definitions: {
      // One short line where a section needs saying what it is; none where
      // the title already does.
      summary: '',
      patterns: 'The behaviours that explain the most about you.',
      bigFive: 'Five research-backed traits. The shaded band is where most people land.',
      mbti: 'A popular type system – descriptive, not clinically validated.',
      motivators: 'Schwartz\'s ten basic values, ranked by how much each shows in what you do.',
      interests: '',
      values: '',
      relationships: '',
      attachment: 'A guess from behaviour, and the most changeable read here.',
      idealPartner: '',
      work: '',
      wellness: 'A read of online behaviour, not a health assessment.',
      development: '',
      pressurePoints: 'Strengths that turn costly when overused. The level is how clearly your data shows the cost.',
      activity: 'The behaviour underneath every finding above: when you are active, what you post, and what you take in.',
      method: '',
    },


    // The structured layout's own section titles, where they differ.
    titles: {
      summary: 'Executive summary',
      patterns: 'Your signature patterns',
      motivators: 'What motivates you',
      work: 'How you work',
      wellness: 'Wellbeing',
      development: 'Development plan',
      buildOn: 'Build on',
      develop: 'Develop',
      pressurePoints: 'Under pressure',
      method: 'Evidence and method',
      plan: 'Your plan',
      about: 'About this report',
      footprint: 'Your digital footprint',
    },

    // Shown under each section in the structured layout: which patterns it
    // shows, as chips that jump to the pattern.
    raisedBy: 'Raised by',
    showsUpIn: 'Shows up in',
    earlySigns: 'Early signs',
    counterMove: 'Counter-move',
    reflect: 'Worth asking yourself',
    levelLabels: { mild: 'Mild', moderate: 'Moderate', marked: 'Marked' },
    // Section keys as a reader would name them, for the "raised by" and
    // "shows up in" chips. Keys match SECTION_KEYS in lib/prompts.js.
    sectionNames: {
      bigFive: 'Big Five', mbti: 'MBTI', motivators: 'Motivators',
      interests: 'Interests', values: 'Values & beliefs', beliefs: 'Values & beliefs', relationships: 'Relationships',
      attachment: 'Attachment', idealPartner: 'Ideal partner', work: 'How you work',
      wellness: 'Wellbeing',
    },

    // Both ends of each Big Five spectrum, so neither reads as the bad one.
    poles: {
      openness: ['Prefers the familiar and proven', 'Seeks out new ideas and experiences'],
      conscientiousness: ['Flexible, keeps options open', 'Organised, plans and follows through'],
      extraversion: ['Recharges alone, a few close ties', 'Energised by people, a wide circle'],
      agreeableness: ['Direct, will challenge people', 'Accommodating, keeps the peace'],
      neuroticism: ['Even-keeled under stress', 'Feels things strongly and quickly'],
    },
    // The shaded band on every bar. Labelled as an estimate: this app has no
    // reference population, and the band is a reading aid, not a norm.
    typicalBand: [35, 65],
    typicalLabel: 'Typical range (estimated)',

    // Schwartz's ten, in his circle's order, with the four higher-order groups
    // he places them in. Labels and one-line meanings are this app's wording.
    motivators: {
      'self-direction': { label: 'Self-direction', group: 'openness', meaning: 'Thinking and choosing for yourself', short: 'Self-direction' },
      stimulation: { label: 'Stimulation', group: 'openness', meaning: 'Novelty, challenge and excitement', short: 'Stimulation' },
      hedonism: { label: 'Enjoyment', group: 'openness', meaning: 'Pleasure and enjoying life', short: 'Enjoyment' },
      achievement: { label: 'Achievement', group: 'enhancement', meaning: 'Succeeding and being seen to', short: 'Achievement' },
      power: { label: 'Influence', group: 'enhancement', meaning: 'Status, resources and control', short: 'Influence' },
      security: { label: 'Security', group: 'conservation', meaning: 'Safety and stability', short: 'Security' },
      conformity: { label: 'Conformity', group: 'conservation', meaning: 'Not upsetting people or norms', short: 'Conformity' },
      tradition: { label: 'Tradition', group: 'conservation', meaning: 'Respect for custom and heritage', short: 'Tradition' },
      benevolence: { label: 'Care for your people', group: 'transcendence', meaning: 'The welfare of those close to you', short: 'Your people' },
      universalism: { label: 'Care for the wider world', group: 'transcendence', meaning: 'Fairness, tolerance and the planet', short: 'The world' },
    },
    motivatorGroups: {
      openness: 'Openness to change',
      enhancement: 'Self-enhancement',
      conservation: 'Conservation',
      transcendence: 'Self-transcendence',
    },

    // The "About this report" card that opens the overview, and the page that
    // follows the PDF cover. Fixed copy: it describes the method, never the
    // person, so it is the same for everyone and costs nothing to generate.
    about: [
      ['What this is',
        'A behavioural portrait written from your own data. It reads what you posted, wrote, ' +
        'searched and kept coming back to, rather than answers to a questionnaire, and every finding ' +
        'cites the evidence behind it.'],
      ['How it is organised',
        'An overview with your signature patterns, then five parts: who you are, what drives you, how ' +
        'you connect, how you work, and putting it together. Each section opens with what it measures. The ' +
        'patterns run through all of them, and the development plan at the end resolves each one.'],
      ['How to read the scales',
        'Scores run from 0 to 100, where 50 is typical. Each trait is a spectrum with both ends ' +
        'described and neither end better. The shaded band is where most people land, and it is an ' +
        'estimate, not a comparison with a measured group. Confidence labels say how firmly the evidence supports each read.'],
      ['What it cannot see',
        'Anything that happens away from these platforms: your conversations in person, your work, ' +
        'your history before your data begins. It is generated automatically, it is not a clinical or ' +
        'diagnostic tool, and the person best placed to judge it is you. Treat each finding as a ' +
        'hypothesis to test against your own experience.'],
    ],

    // The web page's furniture for the structured layout.
    yourScore: 'Your score',
    flags: { high: 'Highest', low: 'Lowest' },
    // One marker per interest for where it is heading, keyed by trajectory.
    trendIcons: { structural: '◆', stable: '●', rising: '↗', declining: '↘', dormant: '⏸', phasic: '◐' },
    attachMapLabel: 'Attachment leaning on the anxiety and avoidance dimensions',
    // The corner where high anxiety meets high avoidance is a mix of the two,
    // and is labelled so: the app never names a reader fearful-avoidant.
    attachQuadrants: { secure: 'Secure', anxious: 'Anxious', avoidant: 'Avoidant', fearful: 'Mixed' },
    attachAxes: { anxiety: 'Anxiety', avoidance: 'Avoidance' },
    attachMapNote: 'Approximate: a leaning, not a measurement.',
    touchNote: 'Physical touch cannot be verified from online data, so PsycheAI never ranks it unless your own words make it clear.',
    notYetUsing: 'Not yet using: ',
    // The structured wellbeing section's one line of context, in place of the
    // classic report's paragraph. Still says what this is not, and who to ask.
    wellnessNote: 'If anything here weighs on you, a GP or qualified professional can help.',
    // The welcome page's "What insights will I get?": the free card, then the
    // full report by its five parts. Section names are taken from the report's
    // own labels in app.js, so these hold only what the page says around them.
    insights: {
      freeBadge: 'Free',
      freeTitle: 'Your Psyche Card',
      freeBlurb: 'One card that sums you up, ready to share – read from your own data in a few minutes.',
      cardItems: [
        ['🦸', 'Your character / superhero'],
        ['🧵', 'Your signature patterns'],
        ['🧲', 'What motivates you'],
        ['🧭', 'MBTI'],
        ['📊', 'Big Five'],
        ['⚖️', 'Values & Beliefs'],
        ['✨', 'Interests'],
        ['💝', 'Love languages'],
      ],
      previewOpen: 'Open the sample Psyche Card full screen',
      // The gallery of sample cards beside it, and the arrows that step
      // through them on the page and full screen.
      previewOpenNamed: 'Open {name}\'s sample Psyche Card full screen',
      galleryLabel: 'Sample Psyche Cards',
      galleryPrev: 'Previous card',
      galleryNext: 'Next card',
      sampleButton: 'See sample',
      premiumTitle: 'Your Psyche Report',
      premiumBlurb: 'Every part of your card explained with the evidence behind it, in five parts.',
      // Beside the price in the head: the first one free with the first card
      // (PSYCHEAI_FIRST_RUN merged), then the price for a re-run.
      premiumFree: 'Your first one is free!',
      premiumThen: 'then',
      partBlurbs: {
        who: 'Your character and signature patterns, your MBTI letter by letter, your Big Five trait by trait, and a wellbeing read across six dimensions.',
        drives: 'What motivates you on Schwartz\'s circle of ten values, your interests and where each is heading, and what you stand for.',
        connect: 'Your love languages, attachment style, how you handle disagreement and who suits you.',
        career: 'Your edge, your other strengths, what holds you back, and the careers that suit you and the ones that would drain you.',
        together: 'A development plan built from everything above.',
      },
      // Part 1's first section tag, for the character comparison.
      characterChip: 'Your character',
      extras: [['📄', 'A PDF to keep'], ['🔍', 'Evidence behind every finding']],
      compatTitle: 'Psyche Sync',
      compatFree: 'Free',
      // Under Psyche Sync: Ask PsycheAI, the coach, with its price for five questions.
      askTitle: 'Ask PsycheAI',
      askBlurb: 'Your personal coach that already knows you from your results. Ask it anything about yourself.',
      askPrice: price => '1 question free, then ' + price + ' for 5',
      compatBlurb: 'Send a connection your link and see how in sync you are – what clicks between you and how to relate better to each other.',
    },
    partNavLabel: 'Parts of this report',
    // The card's own labels in the structured layout.
    // The PDF's overview page: the four facts set as tiles under the character.
    pdfGlance: {
      type: 'Type',
      drive: 'Strongest drive',
      trait: 'Strongest trait',
      confidence: 'Confidence',
    },
    pdfCardFoot: 'psycheai.io · your personality, read from your own data',
    deleteText: 'This removes your Psyche Card, your Psyche Report, your evidence summary and every saved ' +
      'Psyche Sync from this browser. It cannot be undone.',
    deleteNote: 'Your count of analyses already run is kept, so this does not restore a free analysis.',
    // The backup file: the card, the report, every Psyche Sync and the
    // personal link, to bring them back in another browser. See backupFile()
    // in app.js. It goes straight to the reader's disk, never to PsycheAI.
    backup: {
      label: 'Save a backup',
      restore: 'Restore from a backup',
      restoring: 'Restoring your Psyche…',
      bad: 'That file is not a PsycheAI backup, or it is damaged. Choose the .json file saved from “Save a backup”.',
      full: 'Your backup could not be restored: this browser has no room to store it.',
      deleteHint: 'Save a backup first to keep a copy you can restore in any browser.',
    },
    // Ask PsycheAI: questions about the reader's own Psyche Report, answered
    // from it (lib/prompts.js, ASK_SYSTEM), one credit each. See openAsk in
    // app.js.
    ask: {
      title: 'Ask PsycheAI',
      sub: 'Your personal coach.',
      placeholder: 'Ask anything about yourself…',
      send: 'Ask',
      thinking: 'PsycheAI is thinking…',
      steps: 'Your next steps',
      follow: 'Ask next',
      left: n => n === 1 ? '1 question left' : n + ' questions left',
      none: 'No questions left',
      buy: price => 'Get 5 questions – ' + price,
      // Said only when some of the questions left are the link's credits.
      fromReferral: n => 'Includes ' + n + (n === 1 ? ' question' : ' questions') + ' from your Referral credits.',
      bought: 'Added 5 questions. Ask away.',
      privacy: 'Your question goes to Gemini for this one answer; PsycheAI keeps no copy. Answers are saved only in this browser.',
      tooShort: 'Ask a little more – a few words at least.',
      failed: 'PsycheAI could not answer that just now. Your question was not used – try again.',
      noCredits: 'You have no questions left.',
      // At the end of each part of My Report, the question started for them.
      partLink: 'Ask PsycheAI about this',
      partPrefill: title => 'About "' + title + '": ',
      // Questions to start from, from the most universal to the most
      // specific (career last): deep ones the report does not already
      // answer, there to spark the reader's own. Tucked behind "Ideas" so
      // they never crowd the conversation.
      suggestions: [
        'Who am I when I\u2019m not being useful, impressive or needed?',
        'What do I keep trying to prove, and to whom?',
        'What would make my life worthwhile, even if nobody ever knew what I achieved?',
        'What would I regret most about my life when I\u2019m old?',
        'What do I already know needs attention in my life, but keep putting off because it means a hard choice?',
        'Which commitments deserve my loyalty, and which need rethinking?',
        'How can I show up better for my partner, my family and the people closest to me?',
        'Should I move abroad and start again? If you picked one country for me, which would it be, and why?',
        'How can I become a better leader, at work and with the people around me?',
        'I\u2019m thinking about a big change in my career. Is it right for me, given everything else in my life?',
      ],
      ideas: 'Ideas',
      ideasTitle: 'Questions to start from – tap one, then make it yours',
      emptyHint: 'Ask PsycheAI anything about yourself.',
      ideasClose: 'Hide ideas',
      minimise: 'Minimise',
      // The report's appendix: every question and its answer, folded.
      // Appendix 1 is the roast, Appendix 2 these questions; a report with
      // no roast has one unnumbered appendix.
      appendixPrefix: n => n ? 'Appendix ' + n + ': ' : 'Appendix: ',
      appendixTitle: n => (n ? 'Appendix ' + n + ': ' : 'Appendix: ') + 'Ask PsycheAI',
      appendixCount: n => n === 1 ? '1 question' : n + ' questions',
      // Under each answer: what it was written from.
      fromData: 'Drawn from your results and the data they were read from.',
      fromReport: 'Drawn from your results alone: the data they were read from is not in this browser.',
      fab: 'Ask',
      fabLabel: 'Ask PsycheAI',
      fabReady: 'Answer ready',
    },
    // The page's actions: in full on My Psyche, one word each under My
    // Report's part nav, where the row is narrow (each still has its full
    // name read out).
    actions: {
      back: 'Back to card', backShort: 'Back',
      download: 'Download Report', downloadShort: 'Report',
      backup: 'Save a backup', backupShort: 'Backup',
    },
    // Beside a free report's Psyche Card: what each part means, popped out
    // when the reader points at it. Each has one short paragraph on what it is and why
    // it is worth knowing (`about`), then the reader's own reading (`yours`);
    // `when` skips a part the card does not have.
    // My Psyche's hub (October 2026): four tiles, the reader's data and what
    // to keep, under the card once the report is unlocked and at the foot of
    // the page before. It replaced the referral card and Evidence and method,
    // which now open from it.
    hub: {
      title: 'Psyche Hub',
      card: 'Psyche Card',
      ready: 'Ready',
      report: 'Psyche Report',
      unlocked: 'Unlocked',
      locked: 'Locked',
      read: 'Read',
      download: 'Download',
      unlockFree: 'Unlock free',
      unlock: 'Unlock',
      ask: 'Ask PsycheAI',
      questionsLeft: n => n + (n === 1 ? ' question left' : ' questions left'),
      questionsOf: (asked, of) => asked + ' of ' + of + (of === 1 ? ' question asked' : ' questions asked'),
      freeQuestion: n => n + (n === 1 ? ' free question' : ' free questions'),
      askGo: 'Ask',
      askHistory: 'History',
      syncs: 'Psyche Sync',
      syncsCount: n => n + (n === 1 ? ' sync' : ' syncs'),
      newCount: n => n + ' new',
      sync: 'See list',
      share: 'Share',
      link: 'Share Your Link',
      linkMore: 'Credits and gifts',
      data: 'Your data',
      // The source chips' own short names.
      sourceNames: { instagram: 'Instagram', whatsapp: 'WhatsApp', google: 'Google', facebook: 'Facebook' },
      signal: 'Your Data',
      // The green ticks: the date under each, and what a tap on one says.
      madeCard: 'Psyche Card generated by',
      madeReport: 'Psyche Report written by',
      // Under Your Data while the score is below 80, until tapped or closed.
      nudge: names => 'Add ' + names + ' to sharpen your read.',
      nudgeOr: 'or',
      nudgeClose: 'Hide this tip',
      signalOf: score => 'Signal strength: ' + score + ' out of 100',
      sourceLoaded: name => name + ', loaded',
      sourceAdd: name => 'Add ' + name,
      keep: 'Save Your Profile',
      backup: 'Save Backup',
      neverSaved: 'never saved',
      savedAgo: when => 'saved ' + when,
      aiProfile: 'AI Personal Context',
      aiLocked: 'AI Personal Context',
      aiTip: 'A short file about who you are and how to talk to you, to paste into ChatGPT, Claude or Gemini.',
      deleteAll: 'Delete everything',
      linkDialogTitle: 'Your link: credits and gifts',
      methodDialogTitle: 'Signal strength',
      changeData: 'Add / change data',
      notAdded: 'Not added',
      close: 'Close',
      copyLink: 'Copy your link',
      statOpened: 'opened',
      statCards: 'cards',
      linkNote: '1 card made = 1 credit = 5 questions or report to gift',
      linkRule: 'Every connection who makes their card from your link earns you 1 credit. Redeem a credit for 5 questions to PsycheAI, or for a Psyche Report to gift.',
      statCredits: 'credits',
      // One or two plain lines for each part of the hub, behind its "i".
      tips: {
        report: 'Your full Psyche Report: every result explained, with the evidence behind it. Read it here or download the PDF.',
        reportLocked: 'Your full Psyche Report: every result explained, with the evidence. It unlocks free when 1 person makes their card from your link.',
        reportBuy: 'Your full Psyche Report: every result explained, with the evidence behind it.',
        link: 'Your personal link to share. Every connection who makes a card from it earns you 1 credit, for 5 questions or a report to gift.',
        data: 'How well your data supports your reading. Tap the score for what was read; Add / change data to add a source and re-run.',
        keep: 'Your profile lives only in this browser. Save a backup to bring it back, take your AI Personal Context, or delete it all.',
        card: 'Your Psyche Card: who you are at a glance. Read it full size or download it to share.',
        syncs: 'Compare your card with a friend\'s to see what clicks between you. The number is how many syncs you have.',
        ask: 'Ask PsycheAI anything about your report. 2/5 means you have asked 2 of your 5 questions; History shows past answers.',
      },
      // The two popouts that come before a download.
      confirm: {
        backup: {
          title: 'Save Backup',
          lede: 'Your card and report are saved only in this browser. If it ever clears its data, this file brings your profile back.',
          points: [
            'One small file, made on this device. Nothing is uploaded.',
            'It holds your card, your report and the data summary behind it, your syncs, Ask PsycheAI answers and your link.',
            'To bring them back: Load my data, then Restore from a backup.',
            'Keep it private: anyone with the file can read your report.',
          ],
          back: 'Back',
          go: 'Download backup',
        },
        ai: {
          title: 'AI Personal Context',
          lede: 'A short text file about you, written from your Psyche Report. Paste it into ChatGPT, Claude or Gemini so they know you from the first message.',
          points: [
            'Who you are, what drives you, your patterns and interests.',
            'How you connect with people, how you work, and how to talk to you.',
            'Never the roast, your attachment style or anything about partners.',
            'Made on this device as a .md file. Nothing is uploaded.',
          ],
          back: 'Back',
          go: 'Download',
          locked: 'Available once your Psyche Report is unlocked.',
        },
      },
    },
    // My Psyche, once the full report is unlocked: the way into My Report.
    reportPage: {
      pageTitle: 'Psyche Report',
      // The header's pill: the parts, and the PDF's pages once counted.
      pill: (parts, pages) => parts + ' parts' + (pages ? ' · ' + pages + ' pages' : ''),
      // After the pill, as plain text (October 2026; it was a button beside it).
      signalRow: (score) => score + '% signal strength',
      lede: 'The working behind your Psyche Card: what each result means, the evidence for it in your own data, and what to do with it.',
      open: 'See Psyche Report',
      // Until the reader has saved the PDF once: where the report lives, and
      // the one way to keep it.
      keep: 'Your Psyche Report is ready! It is saved only in this browser, and PsycheAI keeps no copy. Download the PDF to keep it.',
      keepButton: 'Download PDF',
    },
    cardGuide: {
      title: 'How to read your Psyche Card',
      // What the panel says before any part of the card is pointed at.
      home: {
        title: 'Psyche Card',
        // One paragraph naming the five features; each {name} is a small
        // button (the names in introLinks). On a phone each clause ends its
        // own line, so the buttons line up down the right.
        // {br}: a line break on a phone only, so the report's sentence starts a line.
        introPaid: 'This is your {card} – your personality on one card, read from your own data. {br}Go deeper in your {report}, ' +
          'compare with friends in {sync}, get advice from {ask}, and track your progress in {hub}.',
        introFree: 'This is your {card} – your personality on one card, read from your own data. {br}Unlock the reasoning in your {report}, ' +
          'compare with friends in {sync}, get advice from {ask}, and track your progress in {hub}.',
        introLinks: { card: 'Psyche Card', report: 'Psyche Report', sync: 'Psyche Sync', ask: 'Ask PsycheAI', hub: 'Psyche Hub' },
        hover: 'Hover over any part of your card to learn more about your personality.',
        tap: 'Tap any part of your card to learn more about your personality.',
      },
      // Under the card full screen on a phone, in place of download and share.
      fullTip: 'Tap any part to learn more',
      tools: { download: 'Download', share: 'Share Card', copy: 'Copy link' },
      toolTips: { download: 'Save your card as an image', share: 'Share your card and your link', copy: 'Copy your share message and link' },
      labels: { yours: 'Yours', sample: 'On this card' },
      // Under the sample's card, full screen.
      sampleTip: { hover: 'Hover over any part of the card to learn more', tap: 'Tap any part to learn more' },
      items: [
        { key: 'character', icon: '🦸', title: 'Who you are most like', when: f => f.character,
          about: 'Your behaviour – what you post, how you talk, what you return to – is matched to the well-known character who moves through the world most like you. A quick way to hold your whole profile in mind, and to explain yourself to others.',
          yours: f => f.character + (f.franchise ? ' (' + f.franchise + ')' : '') + '. The two lines under the name say why.' },
        { key: 'confidence', icon: '🎯', title: 'Signal strength', when: f => f.score,
          about: 'How much evidence stands behind the card: which sources you added, how much of it is in your own words, and how consistently it agreed. High is a confident reading, low a first draft – adding Google, Facebook or a WhatsApp chat usually raises it.',
          yours: f => f.score + ' out of 100' + (f.level ? ' – ' + f.level + '.' : '.') },
        { key: 'patterns', icon: '🧵', title: 'Your patterns', when: f => f.pattern,
          about: 'The three behaviours that repeat across years of what you post and say. Your strengths and blind spots both come from them – naming them helps you catch them in the moment.',
          yours: f => 'Number 1, "' + f.pattern + '", explains the most about you.' },
        { key: 'motives', icon: '🧲', title: 'What motivates you', when: f => f.motive,
          about: 'Based on Shalom Schwartz\'s ten basic human values, studied in more than 80 countries – everyone holds all ten, in a different order. Your top values explain what feels worth your effort, and why some choices drain you.',
          // Each with what it means in brackets — fixed wording from
          // STRUCTURED.motivators, never the model's.
          yours: f => 'Your top three, strongest first: ' + f.motives.map((label, i) =>
            label + (f.motiveMeanings && f.motiveMeanings[i] ? ' (' + f.motiveMeanings[i].charAt(0).toLowerCase() +
              f.motiveMeanings[i].slice(1) + ')' : '')).join(', ') + '.' },
        { key: 'type', icon: '🧭', title: 'MBTI', when: f => f.type,
          about: 'The Myers–Briggs type sorts four everyday preferences into four letters. Popular rather than clinically validated, it helps explain what energises you, what tires you, and why others see things differently.',
          letters: [
            ['E', 'I', 'Energy', 'from people and activity (E), or from time alone (I).'],
            ['N', 'S', 'Attention', 'to patterns and possibilities (N), or to facts and detail (S).'],
            ['T', 'F', 'Decisions', 'by logic and consistency (T), or by values and the people affected (F).'],
            ['J', 'P', 'Lifestyle', 'planned and settled (J), or flexible and open (P).'],
          ],
          yours: f => f.type + (f.letters.length ? ': ' + f.letters.join(', ') + '.' : '.') +
            ' A slight letter sits near the middle – you can go either way.' },
        { key: 'bigFive', icon: '📊', title: 'Big Five', when: f => f.trait,
          about: 'The most researched model of personality. The four traits on your card:',
          // The traits the card shows, each in a line.
          terms: [
            ['Openness', 'how curious you are about new ideas and experiences.'],
            ['Conscientiousness', 'how organised and reliable you are.'],
            ['Agreeableness', 'how readily you accommodate others rather than challenge them.'],
            ['Sensitivity', 'how strongly and quickly you feel stress.'],
          ],
          yours: f => 'Your ' + f.trait.toLowerCase() + ' at ' + f.traitScore + ' is the one furthest from the middle.' },
        { key: 'standFor', icon: '⚖️', title: 'Values, beliefs and interests', when: f => f.value || f.interest,
          about: 'Values and beliefs are the principles your posts and messages keep returning to; interests are what lasts beyond a passing phase. When what you do matches what you value, life feels meaningful.',
          yours: f => (f.value && f.interest ? f.value + ' and ' + f.interest + ' come first.' : (f.value || f.interest) + ' comes first.') },
        // The QR code in the foot of the reader's own card (only theirs has one).
        { key: 'qr', icon: '🔗', title: 'Your QR code', when: () => true,
          about: 'Share this QR code, or your link, with friends. When they open it and make their free Psyche Card, you see how well you sync.',
          yours: () => 'It opens your own link: the same one Share Card and Copy link send.' },
        { key: 'love', icon: '💝', title: 'Love languages', when: f => f.loveIn || f.loveOut,
          about: 'Gary Chapman\'s five ways people give and receive care. Many show care one way and want it another – knowing yours, and theirs, keeps it from going unnoticed.',
          yours: f => (f.loveIn ? 'You feel cared for through ' + f.loveIn.toLowerCase() : '') +
            (f.loveIn && f.loveOut ? ', and ' : '') + (f.loveOut ? 'you show it through ' + f.loveOut.toLowerCase() : '') + '.' },
        { key: 'syncs', icon: '🤝', title: 'Most in sync with', when: f => f.syncs && f.syncs.length,
          about: 'The three characters whose temperaments fit most easily with yours. Know a friend who is one of them? Send them your link: Psyche Sync shows how the two of you really fit.',
          yours: f => 'As ' + f.character + ', you click most easily with ' + f.syncs.slice(0, -1).join(', ') + ' and ' + f.syncs[f.syncs.length - 1] + '.' },
      ],
    },
    cardStandFor: 'Values & Beliefs',
    cardInto: 'Interests',
    // Every card that is shared says where to get one: the address, not just the name.
    cardFooter: 'psycheai.io · your personality, read from your own data',
    cardTraitShort: { openness: 'Openness', conscientiousness: 'Conscientious', extraversion: 'Extraversion',
      agreeableness: 'Agreeable', neuroticism: 'Sensitivity' },
    nothingYet: 'Nothing here yet.',
    // The merged sections' own headings.
    howYouAttach: 'Attachment style',
    // A pill on the reads that rest on the least direct evidence (October
    // 2026): attachment style and how they deal with conflict.
    tentative: 'Tentative',
    tentativeTip: 'A careful guess from behaviour, and the most likely read here to change with more data.',
    // How they handle disagreement: the card's conflict style, which the
    // attachment read explains (attachment.conflict). A chip and an unlock row.
    conflictStyle: 'Conflict style',
    strengthsFriction: 'Strengths and friction',
    // Part 02's one box: the motivators, then these two short lists.
    drivesValues: 'Values & beliefs',
    drivesInterests: 'Interests',
    whatYouBring: 'What you bring',
    whereItGetsHard: 'Where it gets hard',
    whoSuitsYou: 'Who suits you',
    inPractice: 'In practice',
    otherStrengths: 'Your other strengths',
    whatHoldsYouBack: 'What holds you back',
    // Under How you work: the kinds of work that suit them and that drain
    // them (careerAssessment.fit).
    careerFitTitle: 'Careers that suit you',
    careerFitSuits: 'Suits you best',
    careerFitDraining: 'Likely to drain you',
    // Where an action on the plan came from, when it is not a develop area.
    fromWork: 'How you work',
    fromWellbeing: 'Wellbeing',
    atBest: 'At its best',
    overusedPrefix: 'Overused: ',
    // Everything the digest carries complete, beside the text it samples —
    // so "180 of 9,741 messages" is not read as all the analysis saw.
    // Evidence and method's sources: one row per source, what was read from
    // it beneath, and the row itself opens the data popout.
    // The popout after Save a backup: what the file is for.
    backupSaved: {
      title: 'Your backup is saved',
      points: [
        'It is one file on this device, with your Psyche Card, Psyche Report, Psyche Syncs and the questions you asked PsycheAI.',
        'If this browser ever loses them (cleared browsing data, a new phone, a different browser), open PsycheAI there, tap Load your data, then Restore from a backup, and choose this file.',
        'Keep it private: it holds your report. PsycheAI never receives it.',
      ],
      ok: 'Got it',
    },
    sourcesReadTitle: 'Your data',
    sourceChange: 'Change',
    sourceAdd: 'Add',
    // Read out for the green ticks on the right of an added source.
    sourceAdded: 'Added',
    sourceChats: n => n + ' of 3 recommended chats added',
    // Under the WhatsApp row of Your data.
    sourceWhatsAppHint: 'Up to 3 chats with close connections are recommended.',
    sourceLoaded: 'Loaded',
    sourcesFreeNote: 'Adding or changing data comes with the Psyche Report (US$5).',
    // "Read from": what the model actually read of each source, beside what
    // it only counted — "180 of 9,741 of your messages read", "623 stories
    // counted" — so the sample is never mistaken for the whole archive.
    readFrom: {
      messages: (shown, of, threads) => shown + ' of your ' + of + ' messages read' + (threads ? ', from ' + threads + ' conversations' : ''),
      messagesCounted: (n, threads) => n + ' messages counted' + (threads ? ', across ' + threads + ' conversations' : ''),
      captions: (shown, of) => shown + ' of ' + of + ' captions read',
      comments: (shown, of) => shown + ' of ' + of + ' comments read',
      liked: (n, shown) => n + ' liked posts counted' + (shown ? ', ' + shown + ' of their captions read' : ''),
      stories: n => n + ' stories counted',
      saved: n => n + ' saved posts counted',
      following: n => n + ' accounts followed counted',
      timing: span => 'Activity timing across ' + span + ', in full',
      videos: (shown, of) => shown + ' of ' + of + ' YouTube video titles read',
      googleSearches: (shown, of, total) => 'Top ' + shown + ' of ' + of + ' distinct Google searches read' + (total ? ' (' + total + ' in all)' : ''),
      youtubeSearches: (shown, of) => 'Top ' + shown + ' of ' + of + ' distinct YouTube searches read',
      facebookPosts: (shown, of) => shown + ' of ' + of + ' Facebook posts read',
      whatsapp: (chats, shown, of) => chats + (chats === 1 ? ' chat' : ' chats') + ' · ' + shown + ' of your ' + of + ' messages read',
      years: n => n + ' years', months: n => n + ' months',
    },

    // The extra lines in the unlock list under a free card, for what this
    // layout adds. Same length and register as the explain* lines in TEXT.
    // The types row of the unlock list.
    explainTypeTitle: 'MBTI',
    explainListsTitle: 'Interests, Values & Beliefs',
    explainType: 'Letter by letter – the behaviours that put each one there, the evidence that pulls the ' +
      'other way, how firmly it holds, and what each letter looks like in your ordinary week.',
    explainPatterns: 'The two or three patterns that explain the most about you, named, evidenced, and ' +
      'traced through every section – so the report reads as one argument about you rather than a ' +
      'stack of separate verdicts.',
    explainMotivators: 'What you are actually working towards, on a published map of ten human values – ' +
      'ranked against each other from what you do, not what you say, with the tension between your top two.',
    explainDevelopment: 'A development plan built from your own findings – what to lean into, what to work ' +
      'on, with first steps for this week, and the strengths most likely to turn costly under pressure.',
    // MBTI and the Big Five as one row of the unlock offer.
    // The unlock offer's Parts 3 and 4, two rows each.
    offerConnect: [
      ['💞', 'In relationships & ideal partner traits', 'How you are to be close to – your real strengths and the ' +
        'blind spots that cost you, how you show love and want to receive it, and what you actually need in a partner.'],
      ['🔗', 'Attachment style & conflict style', 'Your likely attachment style with the working shown, and how you ' +
        'handle disagreement with the people close to you – whether you raise it, smooth it over, go quiet or come in hot.'],
    ],
    offerCareer: [
      ['💼', 'How you are at work', 'How you work, the strengths you bring and what holds you back, each with the ' +
        'evidence behind it.'],
      ['🪜', 'Career assessment', 'Your edge, what you are not yet using, the careers that suit you and the ones that ' +
        'would drain you – and actions for this week, this quarter and this year.'],
    ],
    explainTypeTraitsTitle: 'MBTI & Big Five',
    explainTypeTraits: 'Your four letters and your five traits taken apart – the behaviours behind each, the ' +
      'evidence that pulls the other way, how firmly each one holds, and what it looks like in your ordinary week.',
  };

  // ---------- character emblems (the structured layout's catalogue) ----------
  //
  // One original line emblem per catalogue character (lib/prompts.js,
  // CHARACTER_CATALOGUE): a generic object or symbol the character is known
  // for, drawn for this app on a 48-unit grid. Never the studio's character
  // art, costume or logo — those belong to their owners. A character outside
  // the catalogue, from a report written before it existed, keeps its emoji.
  const EMBLEM_PATHS = {
    sword: '<path d="M37 6h5v5L24 29l-5-5z" fill="currentColor" fill-opacity=".18"/><path d="M40 8L23 25"/><path d="M13 20c3 5 10 12 15 15"/><path d="M18 30l-7 7"/><path d="M15.5 30.5l2 2M13 33l2 2"/><circle cx="8.5" cy="39.5" r="3" fill="currentColor" fill-opacity=".18"/><path d="M36 18v5M33.5 20.5h5"/>',
    snowflake: '<path d="M24 19L24 4 M24 13L20.5 9.5 M24 13L27.5 9.5 M24 8L21.2 5.2 M24 8L26.8 5.2 M28.3 21.5L41.3 14 M33.5 18.5L34.8 13.7 M33.5 18.5L38.4 19.8 M37.9 16L38.9 12.1 M37.9 16L41.7 17 M28.3 26.5L41.3 34 M33.5 29.5L38.4 28.2 M33.5 29.5L34.8 34.3 M37.9 32L41.7 31 M37.9 32L38.9 35.9 M24 29L24 44 M24 35L27.5 38.5 M24 35L20.5 38.5 M24 40L26.8 42.8 M24 40L21.2 42.8 M19.7 26.5L6.7 34 M14.5 29.5L13.2 34.3 M14.5 29.5L9.6 28.2 M10.1 32L9.1 35.9 M10.1 32L6.3 31 M19.7 21.5L6.7 14 M14.5 18.5L9.6 19.8 M14.5 18.5L13.2 13.7 M10.1 16L6.3 17 M10.1 16L9.1 12.1"/><path d="M24 19 L28.3 21.5 L28.3 26.5 L24 29 L19.7 26.5 L19.7 21.5Z" fill="currentColor" fill-opacity=".18"/>',
    wave: '<path d="M4 34c4-14 14-24 26-24 6 0 10 4 10 9 0 4-3 7-7 7-3 0-5-2-5-5 0-2 2-4 4-4" fill="currentColor" fill-opacity=".18"/><path d="M4 34c4-14 14-24 26-24 6 0 10 4 10 9 0 4-3 7-7 7-3 0-5-2-5-5 0-2 2-4 4-4"/><path d="M4 40c4 0 6-3 10-3s6 3 10 3 6-3 10-3 6 3 10 3"/><path d="M4 45c4 0 6-2 10-2s6 2 10 2 6-2 10-2 6 2 10 2"/><circle cx="42" cy="28" r="1.5"/><circle cx="38" cy="32" r="1"/>',
    crown: '<path d="M8 34L5 14l10 8 9-13 9 13 10-8-3 20z" fill="currentColor" fill-opacity=".18"/><path d="M8 34L5 14l10 8 9-13 9 13 10-8-3 20z"/><path d="M8 40h32"/><path d="M8 34h32"/><circle cx="5" cy="13" r="2" fill="currentColor" stroke="none"/><circle cx="24" cy="8" r="2.2" fill="currentColor" stroke="none"/><circle cx="43" cy="13" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="29" r="1.6"/><circle cx="24" cy="28" r="2"/><circle cx="32" cy="29" r="1.6"/>',
    lantern: '<path d="M24 3v4M19 7h10"/><path d="M16 12h16M18 7l-2 5M30 7l2 5"/><path d="M15 12h18l2 18c0 4-5 6-11 6s-11-2-11-6z" fill="currentColor" fill-opacity=".18"/><path d="M15 12h18l2 18c0 4-5 6-11 6s-11-2-11-6z"/><path d="M24 19c3 3 3 7 0 9-3-2-3-6 0-9z" fill="currentColor" stroke="none"/><path d="M20 40h8M24 36v4"/><path d="M8 18l-3-1M8 26H4M40 18l3-1M40 26h4"/>',
    rabbit: '<path d="M16 44c-6 0-9-4-9-9 0-6 5-11 12-12l-1-3c-2-6-2-14 0-18 3 0 5 6 6 12 1-6 4-12 7-12 2 4 1 12-2 18l-1 3c7 1 12 6 12 12 0 5-3 9-9 9z" fill="currentColor" fill-opacity=".18"/><path d="M16 44c-6 0-9-4-9-9 0-6 5-11 12-12l-1-3c-2-6-2-14 0-18 3 0 5 6 6 12 1-6 4-12 7-12 2 4 1 12-2 18l-1 3c7 1 12 6 12 12 0 5-3 9-9 9z"/><circle cx="19" cy="31" r="1.6" fill="currentColor" stroke="none"/><circle cx="29" cy="31" r="1.6" fill="currentColor" stroke="none"/><path d="M22 36l2 2 2-2"/><path d="M41 40a3 3 0 1 1 0.1 0"/>',
    fox: '<path d="M7 6l11 12h12L41 6c1 14-2 26-9 32l-8 6-8-6C9 32 6 20 7 6z" fill="currentColor" fill-opacity=".18"/><path d="M7 6l11 12h12L41 6c1 14-2 26-9 32l-8 6-8-6C9 32 6 20 7 6z"/><path d="M10 11l6 8M38 11l-6 8"/><path d="M14 28c3 0 5 2 6 4M34 28c-3 0-5 2-6 4"/><circle cx="18" cy="25" r="1.8" fill="currentColor" stroke="none"/><circle cx="30" cy="25" r="1.8" fill="currentColor" stroke="none"/><path d="M21 36l3 3 3-3z"/>',
    heart: '<path d="M24 41S5 30 5 17a9.5 9.5 0 0 1 19-3 9.5 9.5 0 0 1 19 3c0 13-19 24-19 24z" fill="currentColor" fill-opacity=".18"/><path d="M24 41S5 30 5 17a9.5 9.5 0 0 1 19-3 9.5 9.5 0 0 1 19 3c0 13-19 24-19 24z"/><path d="M24 19v12M18 25h12"/><path d="M10 14c1-3 3-4 6-4"/>',
    star: '<path d="M24 6 L28.8 16.8 L40.5 15.5 L33.5 25 L40.5 34.5 L28.8 33.2 L24 44 L19.2 33.2 L7.5 34.5 L14.5 25 L7.5 15.5 L19.2 16.8Z" fill="currentColor" fill-opacity=".18"/><path d="M24 6 L28.8 16.8 L40.5 15.5 L33.5 25 L40.5 34.5 L28.8 33.2 L24 44 L19.2 33.2 L7.5 34.5 L14.5 25 L7.5 15.5 L19.2 16.8Z"/><circle cx="24" cy="25" r="5"/><circle cx="24" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="40.5" cy="15.5" r="2" fill="currentColor" stroke="none"/><circle cx="40.5" cy="34.5" r="2" fill="currentColor" stroke="none"/><circle cx="24" cy="44" r="2" fill="currentColor" stroke="none"/><circle cx="7.5" cy="34.5" r="2" fill="currentColor" stroke="none"/><circle cx="7.5" cy="15.5" r="2" fill="currentColor" stroke="none"/>',
    rocket: '<path d="M24 3c8 6 10 16 8 26H16c-2-10 0-20 8-26z" fill="currentColor" fill-opacity=".18"/><path d="M24 3c8 6 10 16 8 26H16c-2-10 0-20 8-26z"/><circle cx="24" cy="16" r="4"/><path d="M16 22l-7 7v6l7-4M32 22l7 7v6l-7-4"/><path d="M19 33c0 5 2 9 5 12 3-3 5-7 5-12z" fill="currentColor" stroke="none" fill-opacity=".35"/><path d="M19 33c0 5 2 9 5 12 3-3 5-7 5-12"/><path d="M6 10v4M4 12h4M41 6v3M39.5 7.5h3"/>',
    seedling: '<path d="M24 38V20"/><path d="M24 26c0-8-6-12-15-12 0 8 6 12 15 12z" fill="currentColor" fill-opacity=".18"/><path d="M24 26c0-8-6-12-15-12 0 8 6 12 15 12z"/><path d="M24 21c0-8 6-12 15-12 0 8-6 12-15 12z" fill="currentColor" fill-opacity=".18"/><path d="M24 21c0-8 6-12 15-12 0 8-6 12-15 12z"/><path d="M15 20l4 3M33 15l-4 3"/><path d="M12 38h24l-3 7H15z" fill="currentColor" fill-opacity=".18"/><path d="M12 38h24l-3 7H15z"/><circle cx="40" cy="30" r="1.5"/>',
    whisk: '<path d="M14 22a7 7 0 0 1 2-13 8 8 0 0 1 16 0 7 7 0 0 1 2 13v6H14z" fill="currentColor" fill-opacity=".18"/><path d="M14 22a7 7 0 0 1 2-13 8 8 0 0 1 16 0 7 7 0 0 1 2 13v6H14z"/><path d="M14 28h20v5H14z"/><path d="M20 22v6M28 22v6M24 21v7"/><path d="M24 33v12M20 45h8"/>',
    arcade: '<rect x="6" y="3" width="36" height="42" rx="5" fill="currentColor" fill-opacity=".18"/><rect x="6" y="3" width="36" height="42" rx="5"/><circle cx="15" cy="12" r="3.6"/><circle cx="24" cy="12" r="3.6"/><circle cx="33" cy="12" r="3.6"/><circle cx="19.5" cy="19.5" r="3.6"/><circle cx="28.5" cy="19.5" r="3.6"/><circle cx="24" cy="31" r="3.6" fill="currentColor" stroke="none"/><path d="M18 40a6 6 0 0 1 12 0"/><path d="M24 39l-2-6"/>',
    wrench: '<path d="M31 5a10 10 0 0 0-9 13L6 34a4.2 4.2 0 0 0 6 6l16-16a10 10 0 0 0 13-9l-6 6-7-2-2-7z" fill="currentColor" fill-opacity=".18"/><path d="M31 5a10 10 0 0 0-9 13L6 34a4.2 4.2 0 0 0 6 6l16-16a10 10 0 0 0 13-9l-6 6-7-2-2-7z"/><circle cx="9" cy="37" r="1.4"/><path d="M38 34l4 2.3v4.6L38 43.2l-4-2.3v-4.6z"/>',
    shield: '<path d="M8 8h32v14c0 11-8 18-16 22C16 40 8 33 8 22z" fill="currentColor" fill-opacity=".18"/><path d="M8 8h32v14c0 11-8 18-16 22C16 40 8 33 8 22z"/><path d="M24 8v36M8 22h32"/><circle cx="12" cy="12" r="1"/><circle cx="36" cy="12" r="1"/><path d="M24 14l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" fill="currentColor" stroke="none"/>',
    web: '<path d="M24 22L24 2 M24 22L38.1 7.9 M24 22L44 22 M24 22L38.1 36.1 M24 22L24 42 M24 22L9.9 36.1 M24 22L4 22 M24 22L9.9 7.9"/><path d="M24 16 Q25.9 17.5 28.2 17.8 Q28.5 20.1 30 22 Q28.5 23.9 28.2 26.2 Q25.9 26.5 24 28 Q22.1 26.5 19.8 26.2 Q19.5 23.9 18 22 Q19.5 20.1 19.8 17.8 Q22.1 17.5 24 16 M24 11 Q27.5 13.7 31.8 14.2 Q32.3 18.5 35 22 Q32.3 25.5 31.8 29.8 Q27.5 30.3 24 33 Q20.5 30.3 16.2 29.8 Q15.7 25.5 13 22 Q15.7 18.5 16.2 14.2 Q20.5 13.7 24 11 M24 6 Q29 9.9 35.3 10.7 Q36.1 17 40 22 Q36.1 27 35.3 33.3 Q29 34.1 24 38 Q19 34.1 12.7 33.3 Q11.9 27 8 22 Q11.9 17 12.7 10.7 Q19 9.9 24 6"/><path d="M38 30v8"/><circle cx="38" cy="40.5" r="2.5" fill="currentColor" stroke="none"/><path d="M35 39l-2-1M35 42l-2 1M41 39l2-1M41 42l2 1"/>',
    mountain: '<path d="M3 42l14-26 7 11 6-9 15 24z" fill="currentColor" fill-opacity=".18"/><path d="M3 42l14-26 7 11 6-9 15 24z"/><path d="M12 25l5 3 4-3M27 24l3 2 3-2"/><path d="M17 42l4-8 4 4 3-6"/><path d="M36 6l-3 6h4l-3 6"/>',
    claw: '<path d="M24 25c-7 0-13 6-13 12 0 4 3 6 6 6 3 0 4-2 7-2s4 2 7 2c3 0 6-2 6-6 0-6-6-12-13-12z" fill="currentColor" fill-opacity=".18"/><path d="M24 25c-7 0-13 6-13 12 0 4 3 6 6 6 3 0 4-2 7-2s4 2 7 2c3 0 6-2 6-6 0-6-6-12-13-12z"/><ellipse cx="9" cy="21" rx="3.6" ry="4.6" fill="currentColor" fill-opacity=".18"/><ellipse cx="9" cy="21" rx="3.6" ry="4.6"/><ellipse cx="18" cy="13" rx="3.8" ry="5" fill="currentColor" fill-opacity=".18"/><ellipse cx="18" cy="13" rx="3.8" ry="5"/><ellipse cx="30" cy="13" rx="3.8" ry="5" fill="currentColor" fill-opacity=".18"/><ellipse cx="30" cy="13" rx="3.8" ry="5"/><ellipse cx="39" cy="21" rx="3.6" ry="4.6" fill="currentColor" fill-opacity=".18"/><ellipse cx="39" cy="21" rx="3.6" ry="4.6"/><path d="M7 15l-1-4M17 7l-1-4M31 7l1-4M41 15l1-4"/>',
    eye: '<circle cx="24" cy="24" r="17"/><path d="M43 24L46 24 M40.5 33.5L43.1 35 M33.5 40.5L35 43.1 M24 43L24 46 M14.5 40.5L13 43.1 M7.5 33.5L4.9 35 M5 24L2 24 M7.5 14.5L4.9 13 M14.5 7.5L13 4.9 M24 5L24 2 M33.5 7.5L35 4.9 M40.5 14.5L43.1 13"/><path d="M8 24c5-7 10-10 16-10s11 3 16 10c-5 7-10 10-16 10S13 31 8 24z" fill="currentColor" fill-opacity=".18"/><path d="M8 24c5-7 10-10 16-10s11 3 16 10c-5 7-10 10-16 10S13 31 8 24z"/><circle cx="24" cy="24" r="5"/><circle cx="24" cy="24" r="2" fill="currentColor" stroke="none"/>',
    lasso: '<ellipse cx="24" cy="16" rx="17" ry="9" fill="currentColor" fill-opacity=".18"/><ellipse cx="24" cy="16" rx="17" ry="9"/><ellipse cx="24" cy="17" rx="12" ry="6"/><path d="M12 22c-3 6-1 12 5 16 4 3 9 3 12 0"/><path d="M29 38l3 3M27 40l3 3"/><path d="M40 30l2-2M43 33l2-1M38 34l1 3"/>',
    moon: '<path d="M28 4a17 17 0 1 0 14 26A14 14 0 0 1 28 4z" fill="currentColor" fill-opacity=".18"/><path d="M28 4a17 17 0 1 0 14 26A14 14 0 0 1 28 4z"/><path d="M38 8v4M36 10h4M44 18v3M42.5 19.5h3"/><path d="M4 44h40M8 44v-6h4v-4h5v10M30 44v-8h5v4h4v4"/>',
    bolt: '<path d="M28 3L9 28h12l-4 17 21-27H26z" fill="currentColor" fill-opacity=".18"/><path d="M28 3L9 28h12l-4 17 21-27H26z"/><path d="M6 14l4 2M38 34l4 2M40 8l3-2M6 38l3-2"/>',
    mushroom: '<path d="M5 24C5 13 13 6 24 6s19 7 19 18z" fill="currentColor" fill-opacity=".18"/><path d="M5 24C5 13 13 6 24 6s19 7 19 18z"/><path d="M17 24v13c0 4 3 6 7 6s7-2 7-6V24"/><path d="M5 24h38"/><circle cx="15" cy="15" r="3.2" fill="currentColor" stroke="none" fill-opacity=".5"/><circle cx="31" cy="13" r="3.6" fill="currentColor" stroke="none" fill-opacity=".5"/><circle cx="24" cy="19" r="2" fill="currentColor" stroke="none" fill-opacity=".5"/><circle cx="21" cy="31" r="1.2" fill="currentColor" stroke="none"/><circle cx="27" cy="31" r="1.2" fill="currentColor" stroke="none"/><path d="M3 45h42"/>',
    compass: '<circle cx="24" cy="24" r="20"/><path d="M39.5 24L42 24 M35 35L36.7 36.7 M24 39.5L24 42 M13 35L11.3 36.7 M8.5 24L6 24 M13 13L11.3 11.3 M24 8.5L24 6 M35 13L36.7 11.3"/><path d="M24 8l4 16-4 16-4-16z" fill="currentColor" fill-opacity=".18"/><path d="M24 8l4 16-4 16-4-16z"/><path d="M8 24l16-4 16 4-16 4z"/><path d="M24 8l4 16h-8z" fill="currentColor" stroke="none"/><circle cx="24" cy="24" r="2"/>',
    leaf: '<path d="M6 42C6 20 20 6 42 6c0 22-14 36-36 36z" fill="currentColor" fill-opacity=".18"/><path d="M6 42C6 20 20 6 42 6c0 22-14 36-36 36z"/><path d="M6 42L32 16"/><path d="M14 34l-1-8M20 28l-1-9M26 22v-8M14 34l8 1M20 28l9 1M26 22l8 1"/>',
    treehouse: '<path d="M20 46c1-6 2-12 2-18-3-4-7-6-12-6M28 46c-1-6-2-12-2-18 3-4 7-6 12-6"/><path d="M8 18c0-8 7-13 16-13s16 5 16 13c0 5-6 8-16 8S8 23 8 18z" fill="currentColor" fill-opacity=".18"/><path d="M8 18c0-8 7-13 16-13s16 5 16 13c0 5-6 8-16 8S8 23 8 18z"/><path d="M15 34h18v-8H15z" fill="currentColor" fill-opacity=".3"/><path d="M15 34h18v-8H15z"/><path d="M13 26l11-6 11 6"/><path d="M20 30h3"/><path d="M33 34v10M36 36v10M33 38h3M33 42h3"/><path d="M4 46h40"/>',
    bowl: '<path d="M5 24h38c0 11-9 18-19 18S5 35 5 24z" fill="currentColor" fill-opacity=".18"/><path d="M5 24h38c0 11-9 18-19 18S5 35 5 24z"/><path d="M17 42h14"/><path d="M12 24c3-4 6-4 9 0s6 4 9 0 6-4 9 0"/><path d="M30 4l-8 22M36 6l-10 20"/><path d="M12 18c0-3 3-3 3-6M18 18c0-3 3-3 3-6"/>',
    book: '<path d="M24 13C19 9 11 8 4 10v28c7-2 15-1 20 3 5-4 13-5 20-3V10c-7-2-15-1-20 3z" fill="currentColor" fill-opacity=".18"/><path d="M24 13C19 9 11 8 4 10v28c7-2 15-1 20 3 5-4 13-5 20-3V10c-7-2-15-1-20 3z"/><path d="M24 13v28"/><path d="M9 17c4-1 8 0 11 2M9 23c4-1 8 0 11 2M9 29c4-1 8 0 11 2M28 19c3-2 7-3 11-2M28 25c3-2 7-3 11-2"/><path d="M38 1l1.3 3.2 3.2 1.3-3.2 1.3L38 10l-1.3-3.2-3.2-1.3 3.2-1.3z" fill="currentColor" stroke="none"/>',
    nightcat: '<path d="M30 4a17 17 0 1 0 14 26A14 14 0 0 1 30 4z" fill="currentColor" fill-opacity=".18"/><path d="M30 4a17 17 0 1 0 14 26A14 14 0 0 1 30 4z"/><path d="M14 44c-3-8-2-14 2-17-1-3-1-6 0-8l3 3c2-1 3-1 5 0l3-3c1 2 1 5 0 8 4 3 5 9 2 17z" fill="currentColor" stroke="none"/><path d="M6 10c2-2 5-2 6 0 1-2 4-2 6 0-2 1-3 3-3 5-1-1-2-2-3-1-1-1-2 0-3 1 0-2-1-4-3-5z" fill="currentColor" stroke="none"/>',
    crescent: '<path d="M28 4a18 18 0 1 0 15 27A15 15 0 0 1 28 4z" fill="currentColor" fill-opacity=".18"/><path d="M28 4a18 18 0 1 0 15 27A15 15 0 0 1 28 4z"/><path d="M38 6l1.6 3.8 4 .4-3 2.7.9 4-3.5-2-3.5 2 .9-4-3-2.7 4-.4z" fill="currentColor" stroke="none"/><path d="M6 38l10-4"/>',
    peach: '<path d="M24 15c-9-5-20 1-20 13 0 9 8 16 20 16s20-7 20-16c0-12-11-18-20-13z" fill="currentColor" fill-opacity=".18"/><path d="M24 15c-9-5-20 1-20 13 0 9 8 16 20 16s20-7 20-16c0-12-11-18-20-13z"/><path d="M24 15c-3 8-3 19 0 29"/><path d="M24 15c0-4 2-8 5-10"/><path d="M28 9c4-6 11-6 14-3-4 5-10 6-14 3z" fill="currentColor" fill-opacity=".18"/><path d="M28 9c4-6 11-6 14-3-4 5-10 6-14 3z"/>',
    teacup: '<path d="M8 18h28c0 12-6 20-14 20S8 30 8 18z" fill="currentColor" fill-opacity=".18"/><path d="M8 18h28c0 12-6 20-14 20S8 30 8 18z"/><path d="M36 22c6 0 6 9-1 9"/><path d="M6 42h32"/><path d="M16 12c0-3 3-3 3-6M24 12c0-3 3-3 3-6"/><circle cx="22" cy="27" r="3" fill="currentColor" stroke="none"/>',
    magnifier: '<circle cx="19" cy="19" r="13" fill="currentColor" fill-opacity=".18"/><circle cx="19" cy="19" r="13"/><path d="M28.5 28.5L43 43"/><path d="M31 34l3-3M37 40l3-3"/><path d="M12 15a8 8 0 0 1 6-6"/><ellipse cx="17" cy="21" rx="2.6" ry="4" fill="currentColor" stroke="none"/><ellipse cx="17" cy="27" rx="1.8" ry="2" fill="currentColor" stroke="none"/>',
    bag: '<path d="M6 18h36l3 20c0 3-2 5-5 5H8c-3 0-5-2-5-5z" fill="currentColor" fill-opacity=".18"/><path d="M6 18h36l3 20c0 3-2 5-5 5H8c-3 0-5-2-5-5z"/><path d="M16 18v-5c0-4 3-6 8-6s8 2 8 6v5"/><path d="M4 18c6-4 34-4 40 0"/><path d="M24 25v12M18 31h12"/>',
    horse: '<path d="M10 20c0-3 2-5 5-5h14l5-10h5l3 2-3 5-5 2-2 14H10z" fill="currentColor" fill-opacity=".18"/><path d="M10 20c0-3 2-5 5-5h14l5-10h5l3 2-3 5-5 2-2 14H10z"/><path d="M12 28v8M18 28v8M27 28v8M32 28v8"/><path d="M8 36h28"/><circle cx="12" cy="41" r="3"/><circle cx="32" cy="41" r="3"/><path d="M8 20l-3 8"/><path d="M18 19h8v6h-8z"/>',
    tower: '<path d="M14 18h14v26H14z" fill="currentColor" fill-opacity=".18"/><path d="M14 18h14v26H14z"/><path d="M11 18L21 3l10 15z" fill="currentColor" fill-opacity=".18"/><path d="M11 18L21 3l10 15z"/><path d="M18 27v-3a3 3 0 0 1 6 0v3z"/><path d="M24 27c6 3 2 8 8 11s4 6 10 6"/><path d="M14 33h14M14 39h14"/><path d="M40 8l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" stroke="none"/>',
    tinheart: '<path d="M24 40C12 32 6 25 6 17c0-6 4-10 9-10 4 0 7 3 9 6 2-3 5-6 9-6 5 0 9 4 9 10 0 8-6 15-18 23z" fill="currentColor" fill-opacity=".18"/><path d="M24 40C12 32 6 25 6 17c0-6 4-10 9-10 4 0 7 3 9 6 2-3 5-6 9-6 5 0 9 4 9 10 0 8-6 15-18 23z"/><path d="M24 2v5"/><path d="M36 30l8 14"/><path d="M38 33c3-3 7-3 8 0-3 1-5 3-6 5z" fill="currentColor" fill-opacity=".45"/>',
    flame: '<path d="M24 45c-10 0-15-6-15-14 0-10 9-13 9-24 6 4 11 10 11 16 2-2 3-5 3-8 5 4 7 10 7 16 0 8-5 14-15 14z" fill="currentColor" fill-opacity=".18"/><path d="M24 45c-10 0-15-6-15-14 0-10 9-13 9-24 6 4 11 10 11 16 2-2 3-5 3-8 5 4 7 10 7 16 0 8-5 14-15 14z"/><path d="M24 45c-5 0-7-3-7-7 0-5 4-7 5-12 3 3 6 6 6 10 1-1 2-2 2-4 2 2 3 4 3 6 0 4-3 7-9 7z" fill="currentColor" stroke="none" fill-opacity=".45"/>',
  };
  const CHARACTER_EMBLEMS = {
    'Mulan': 'sword', 'Elsa': 'snowflake', 'Moana': 'wave', 'Simba': 'crown', 'Rapunzel': 'tower',
    'Sherlock Holmes': 'magnifier', 'Dr Watson': 'bag', 'Odysseus': 'horse',
    'Judy Hopps': 'rabbit', 'Nick Wilde': 'fox', 'Baymax': 'heart',
    'Buzz Lightyear': 'rocket', 'The Tin Man': 'tinheart', 'Remy': 'whisk', 'Joy': 'arcade',
    'Captain America': 'shield', 'Spider-Man': 'web', 'Hulk': 'mountain',
    'Wonder Woman': 'lasso',
    'Pikachu': 'bolt', 'Totoro': 'leaf',
    'Shrek': 'treehouse', 'Po': 'bowl', 'Hiccup': 'flame',
    'Hermione Granger': 'book', 'Kuromi': 'nightcat', 'Sailor Moon': 'crescent', 'Princess Peach': 'peach', 'Hello Kitty': 'teacup',
    // Retired from the catalogue (lib/prompts.js, RETIRED_CHARACTERS), kept so
    // a card written before they were retired still draws its emblem.
    'Black Panther': 'claw', 'Doctor Strange': 'eye', 'Mario': 'mushroom', 'Link': 'compass',
    'Woody': 'star', 'Iron Man': 'wrench', 'Batman': 'moon', 'WALL-E': 'seedling',
  };

  // A full scene for the card's purple box, for every catalogue character:
  // drawn from the symbols of the story (Mulan: the moon, a jian with its red
  // tassel, plum blossom, mountains and a pagoda) rather than the character's
  // likeness, which belongs to the studio. The drawings live in
  // character-art.js, generated by tools/character-art.mjs, and are read when
  // a card is drawn rather than when this file loads, so the order the two
  // scripts load in does not matter. Each bleeds off the right of the box and
  // fades in from the left so the name stays clear. {id} is replaced per
  // drawing, because the card is on the page more than once and a gradient
  // looked up by id inside a hidden copy draws nothing.
  let artDrawn = 0;

  /** The scene for a character, as SVG markup, or '' for any other name. */
  // A round tile's square, where a scene's subject sits lower than the usual
  // upper right: Woody's boot stands on the ground, and the usual square
  // showed only its shaft; Dr Watson's bag sits under the window, and
  // Odysseus's horse rears its head to the top of the scene.
  const ART_CROPS = { Mulan: '320 90 200 200', Woody: '200 94 336 336', 'Dr Watson': '300 110 220 220', Odysseus: '300 0 220 220', 'Sherlock Holmes': '310 50 210 210', Rapunzel: '330 110 190 190', 'The Tin Man': '320 60 190 190' };
  function characterArt(character, className, crop) {
    // Own properties only: a name such as "toString" from someone else's card
    // must find nothing, not a function.
    const table = root.PsycheCharacterArt || {};
    const name = String(character || '').trim();
    const art = Object.prototype.hasOwnProperty.call(table, name) ? table[name] : '';
    if (typeof art !== 'string' || !art) return '';
    const id = 'pc-art-' + (++artDrawn);
    // A crop is the subject alone, for a small round tile: the right of the
    // scene, where each drawing puts it, away from the fade on the left.
    const box = crop ? (ART_CROPS[name] || '220 20 300 300') + '" preserveAspectRatio="xMidYMid slice' : '0 0 520 440" preserveAspectRatio="xMaxYMax slice';
    return '<svg class="' + (className || 'pc-art') + '" viewBox="' + box + '" ' +
      'aria-hidden="true" focusable="false">' + art.replace(/\{id\}/g, id) + '</svg>';
  }

  // The three characters each catalogue character is most in sync with,
  // printed on the card and on the character pages (tools/seo-pages.mjs).
  // Balanced: every character is named exactly three times, so none is left
  // out, and every woman and man is paired with at least one of the other
  // and at least one of their own (the four drawn as neither are exempt).
  // Every pairing is mutual (October 2026: with Totoro retired the catalogue
  // is an even 28, and the one loop of three it forced is gone).
  // Retired characters have none, and their cards show the old layout.
  // Woody, Iron Man, Batman and WALL-E's public-domain heirs (Dr Watson,
  // Odysseus, Sherlock Holmes, The Tin Man) take over their pairings as they
  // were, since each was chosen for the same temperament (21 October 2026).
  const CHARACTER_SYNCS = {
    'Mulan': ['Baymax', 'Po', 'Hermione Granger'],
    'Elsa': ['Rapunzel', 'Moana', 'Odysseus'],
    'Moana': ['Hiccup', 'Elsa', 'Joy'],
    'Simba': ['Po', 'Judy Hopps', 'Princess Peach'],
    'Rapunzel': ['Elsa', 'Remy', 'Hulk'],
    'Judy Hopps': ['Nick Wilde', 'Simba', 'Wonder Woman'],
    'Nick Wilde': ['Judy Hopps', 'Shrek', 'Kuromi'],
    'Baymax': ['Mulan', 'The Tin Man', 'Hiccup'],
    'Dr Watson': ['Buzz Lightyear', 'Joy', 'The Tin Man'],
    'Buzz Lightyear': ['Dr Watson', 'Wonder Woman', 'Captain America'],
    'The Tin Man': ['Baymax', 'Remy', 'Dr Watson'],
    'Remy': ['Rapunzel', 'The Tin Man', 'Sherlock Holmes'],
    'Joy': ['Dr Watson', 'Pikachu', 'Moana'],
    'Odysseus': ['Captain America', 'Spider-Man', 'Elsa'],
    'Captain America': ['Odysseus', 'Wonder Woman', 'Buzz Lightyear'],
    'Spider-Man': ['Odysseus', 'Hermione Granger', 'Sailor Moon'],
    'Hulk': ['Sherlock Holmes', 'Hiccup', 'Rapunzel'],
    'Wonder Woman': ['Captain America', 'Buzz Lightyear', 'Judy Hopps'],
    'Sherlock Holmes': ['Hermione Granger', 'Hulk', 'Remy'],
    'Pikachu': ['Joy', 'Sailor Moon', 'Shrek'],
    'Princess Peach': ['Hello Kitty', 'Sailor Moon', 'Simba'],
    'Shrek': ['Nick Wilde', 'Kuromi', 'Pikachu'],
    'Po': ['Mulan', 'Simba', 'Hello Kitty'],
    'Hiccup': ['Moana', 'Hulk', 'Baymax'],
    'Hermione Granger': ['Spider-Man', 'Sherlock Holmes', 'Mulan'],
    'Sailor Moon': ['Pikachu', 'Princess Peach', 'Spider-Man'],
    'Hello Kitty': ['Kuromi', 'Princess Peach', 'Po'],
    'Kuromi': ['Hello Kitty', 'Shrek', 'Nick Wilde'],
  };

  // The sample cards' own pairings: the five the marketing shows (the sample
  // card, the gallery, the link preview, the search pages) name only each
  // other. A real card always uses CHARACTER_SYNCS above; a sample carries its
  // three as `sampleSyncs`, read by cardSyncs() below.
  const MARKETING_SYNCS = {
    'Mulan': ['Rapunzel', 'Odysseus', 'The Tin Man'],
    'Odysseus': ['Sherlock Holmes', 'Mulan', 'The Tin Man'],
    'Rapunzel': ['Mulan', 'Sherlock Holmes', 'The Tin Man'],
    'Sherlock Holmes': ['Odysseus', 'Rapunzel', 'Mulan'],
    'The Tin Man': ['Mulan', 'Rapunzel', 'Odysseus'],
  };





  /** The three characters a catalogue character is most in sync with, or none. */
  function syncsOf(character) {
    const name = String(character || '').trim();
    return Object.prototype.hasOwnProperty.call(CHARACTER_SYNCS, name) ? CHARACTER_SYNCS[name].slice() : [];
  }

  /**
   * The three a card shows: a sample's own `sampleSyncs` (catalogue names
   * only), else the character's real three.
   */
  function cardSyncs(report, character) {
    const own = report && report.sampleSyncs;
    if (Array.isArray(own) && own.length === 3 && own.every(n => typeof n === 'string' && Object.prototype.hasOwnProperty.call(CHARACTER_SYNCS, n))) return own.slice();
    return syncsOf(character);
  }

  // One line-icon set for the app's own interface, in place of the emoji
  // that used to stand in for icons (📷 💬 🧲 🌱…), which read as generic
  // beside the line icons used elsewhere. Keyed by the emoji each replaces, so
  // the places that name an icon keep naming it the same way. Drawn on a 24px
  // grid with a round 1.8 stroke in currentColor, so each takes the colour of
  // the text around it. The Psyche Card keeps its emoji (they are part of the
  // shared image), and so do the card guide and the love languages, which
  // mirror what the card prints.
  const LINE_ICONS = {
    '👤': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    '📊': '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
    '🧭': '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    '✨': '<path d="M12 3l1.8 4.6L18.5 9.4l-4.7 1.8L12 16l-1.8-4.8L5.5 9.4l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    '💞': '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    '📱': '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
    '🧵': '<path d="M3 8c3-3 6-3 9 0s6 3 9 0M3 16c3-3 6-3 9 0s6 3 9 0"/>',
    '🧲': '<path d="M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0zM5 7.5h4M15 7.5h4"/>',
    '🌱': '<path d="M12 21v-8M12 13C12 9 9 6 4 6c0 4 3 7 8 7zM12 11c0-3 2-6 7-6 0 3-2 6-7 6z"/>',
    '🔗': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    '🪜': '<path d="M7 3v18M17 3v18M7 7.5h10M7 12h10M7 16.5h10"/>',
    '💼': '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
    '🎯': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    '🧿': '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    '⚖️': '<path d="M12 3v18M8 21h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    '🤝': '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2.4.7 4 2.5 4 5.2"/>',
    '☀️': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    '🔥': '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z"/>',
    '🕳️': '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z"/>',
    '💬': '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    '🧂': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    '🎁': '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C10 4 6 4 6 6.5S10 8 12 8zM12 8c2-4 6-4 6-1.5S14 8 12 8z"/>',
    '📷': '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>',
    '🔍': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
    '📘': '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
    '📖': '<path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/>',
    '🔒': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    '📄': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
    '🛡️': '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    '📈': '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    '💘': '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M9.5 11.5l2 2 3.5-4"/>',
    '🔇': '<path d="M11 5L6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>',
  };

  /** The line icon standing in for an emoji, as SVG markup, or '' for one with none. */
  function lineIcon(glyph, className) {
    const key = String(glyph || '').trim();
    const body = Object.prototype.hasOwnProperty.call(LINE_ICONS, key) ? LINE_ICONS[key] : '';
    if (!body) return '';
    return '<svg class="line-icon' + (className ? ' ' + className : '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /** An icon for the interface: the line icon for an emoji where there is one, the emoji itself otherwise. */
  function iconHtml(glyph) {
    return lineIcon(glyph) || String(glyph || '');
  }

  /** The emblem for a catalogue character, as SVG markup, or '' for any other name. */
  function emblemSvg(character, className) {
    const name = String(character || '').trim();
    const key = Object.prototype.hasOwnProperty.call(CHARACTER_EMBLEMS, name) ? CHARACTER_EMBLEMS[name] : '';
    if (!key || !Object.prototype.hasOwnProperty.call(EMBLEM_PATHS, key)) return '';
    return '<svg class="' + (className || 'emblem') + '" viewBox="0 0 48 48" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      EMBLEM_PATHS[key] + '</svg>';
  }

  // The app never calls a reader fearful-avoidant (or disorganised): the
  // names land as a verdict, and an export cannot support one. The prompts
  // ask for secure, anxious or avoidant, and a mix as two leanings; this
  // softens the label wherever a report — an old one included — still has it.
  function gentleAttachment(text) {
    return String(text == null ? '' : text)
      .replace(/\b(fearful[\s-]*avoidant|disorgani[sz]ed)([\s-]*(leaning|attachment|style))?/gi, (match, name) =>
        (/^[A-Z]/.test(match) ? 'A' : 'a') + 'nxious and avoidant mix')
      .replace(/\ban anxious and avoidant mix\b/g, 'an anxious and avoidant mix');
  }

  root.PsycheCopy = {
    TRAIT_LABELS, MBTI_POLES, axisLabel, LOVE_LANGUAGE_ICONS, givingLove, leadSentence, planPick, PLAN_STEPS, CARD_ICONS,
    ACTIVITY_FACETS, WELLNESS_FACETS, MODE_LABELS, WORK_STANCES, stanceText, BRAND_MARK, TEXT, STRUCTURED,
    CHARACTER_EMBLEMS, EMBLEM_PATHS, emblemSvg, characterArt, CHARACTER_SYNCS, MARKETING_SYNCS, syncsOf, cardSyncs, LINE_ICONS, lineIcon, iconHtml, gentleAttachment,
  };
})(typeof window !== 'undefined' ? window : globalThis);
