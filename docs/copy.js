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
    inviteTitle: (name) => '⭐ This is ' + possessive(name || 'your friend') + ' Psyche Card',
    inviteText: (name) => 'PsycheAI reads your personality from your own Instagram data. No questionnaire, ' +
      'no sign-up. Get your free Psyche Card, and see how in sync you are with ' + (name || 'them') + '.',
    inviteStart: 'Get my free Psyche Card',
    inviteCardHint: 'Tap to explore',
    // On the reader's own report, once their card is made, while a friend's
    // link is waiting.
    syncInviteTitle: () => 'You have a friend waiting to sync with you',
    // Opening a friend's link that was already synced on this device.
    syncAlreadyDone: (name) => 'You have already synced with ' + (name || 'this friend') + ' — it is in your list below.',
    syncInviteGo: (name) => 'Sync with ' + (name || 'them'),
    // The bar on My Psyche has one button, to My Syncs, where the reader
    // picks who to sync with.
    syncInviteOpen: 'Sync',
    syncWaitingMeta: 'Waiting to sync with you · free, only you see it',
    // Several friends' links waiting at once: one bar, a button for each.
    syncInviteTitleMany: () => 'You have friends waiting to sync with you',
    inviteAlso: (names) => (names.length === 1 ? names[0] + ' also sent you their card'
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' also sent you their cards') +
      ' — you can sync with everyone once your card is ready.',
    inviteCardOpen: (name) => 'See ' + possessive(name || 'your friend') + ' Psyche Card full screen',
    // The one share message, everywhere: Share Card, Copy link, a sync's
    // result, the roast. It carries the reader's one link (myLinkUrl in
    // app.js): the same link for a bio, an invite and a comparison.
    cardShareText: (character, url) => (character ? 'I got ' + character + ' on my Psyche Card. ' : 'My Psyche Card. ') +
      'Get yours free, no questionnaire: ' + (url || 'https://psycheai.io'),
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
    // How they handle disagreement, inside the attachment read — the line the
    // card shows as its conflict style, explained.
    attachmentConflict: 'In conflict',
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
      'read, not a health assessment — there is no score here, and there is not meant to be. It is ' +
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

    compatReturnTitle: (name) => 'Want ' + name + ' to see it too?',
    compatReturnText: (name) => 'The sync runs on the side of whoever opens the link, so ' + name +
      ' does not have this report. Send them your link and they get their own, free.',
    // The roast and compatibility story images, and what goes with them.
    roastShare: 'Share this roast',
    roastImageLead: 'I let AI read my Instagram. It said:',
    roastImageCredit: 'My PsycheAI roast',
    roastImageFooter: 'Get roasted free · psycheai.io',
    storyImageSaved: 'Image saved. Post it to your story.',
    linkMessageCopied: 'Message and link copied. Paste it to them in WhatsApp, Telegram or a DM.',
    linkMessageCopiedShort: 'Copied ✓',
    linkCopied: 'Link copied.',
    shortLinkUnreadable: 'That PsycheAI link could not be opened — it may have expired, or been cut short when it was copied. Ask for it to be sent again.',
    linkCopyPrompt: 'Copy this and send it to them:',

    matches: 'Your matches',
    matchWith: 'With',
    matchBasis: 'Basis',
    matchScore: 'Score',
    matchWhen: 'When',

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
      'than guessed at — and what to be careful of.',
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
    heroVideoLabel: 'PsycheAI in 45 seconds: what it reads, your Psyche Card and the full report',
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

    // The premium tier block, shown twice on the way in — the insight diagram
    // and "What you can expect?" — and built once in docs/app.js from
    // `PAID_SECTIONS` so the section names it advertises are the section
    // names the report actually renders. The price is `premiumPriceLabel` for
    // the same reason: one string, so the landing page cannot drift from the
    // unlock button.
    //
    // The free run is the summary card and nothing else now, so the offer is
    // the writing behind the card plus the four sections — and says that, in
    // that order, rather than pretending the card is a whole report.
    premiumTierTitle: 'The full premium report',
    premiumTierBlurb: 'Your Psyche Card is free. The full premium report explains every part of it, and adds four more sections:',
    // Shown under a free card, in place of the written report — see
    // fullReportLockedHtml in docs/app.js.
    fullReportSample: 'See sample report',
    fullReportTitle: 'Unlock the full premium report',
    // One list, one offer: the explanations behind the card and the four
    // sections it does not touch, read as the single report they are bought as.
    // Each line says what that part of the report actually contains, at the
    // length the four premium covers already run to, so the reader is deciding
    // on specifics rather than on section names.
    fullReportBlurb: 'Your card shows the conclusions. The full report shows the working, and goes further.',
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
    explainRoast: 'The least charitable, most honest-friend read of you – the patterns you would rather not ' +
      'see, said plainly, with the advice nobody softens. Kept behind a cover of its own, so you only read ' +
      'it when you want to.',
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
    bonusCoverBlurb: 'The least charitable, most honest-friend version of everything above — ' +
      'deliberately unkind, not a diagnosis, and part of your full report. Read it if you ' +
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
    premiumSourcesTitle: 'Your data for the full report',
    // The review's downloadable copy only, at the unlock: what this file is.
    deepReviewNote: 'This is what the full premium report is written from: everything your card was read from, with the data you just added on top.',
    premiumSourcesBlurb: 'Add a source or replace one with a fresh export — more data, a fuller report. ' +
      'Or carry on with what is loaded.',
    premiumUnlockPrefix: 'Unlock the full premium report – ',
    // Under the price on the free card's unlock button: the other way in.
    premiumUnlockFriends: 'or get 3 friends to make their Psyche Card from your link',
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
    premiumGenerating: 'Writing your full premium report… this may take a few minutes.',
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
    pendingNeedsInstagram: 'Your payment is still good. Load your Instagram export again and the analysis will run at no charge.',
    // Shown to somebody who put their phone down mid-analysis and came back.
    // It says the two things they need: nothing was lost, and there is nothing
    // for them to do — because the instinct on returning to a waiting screen
    // is to assume it has been stuck there the whole time and to start again.
    resumingJob: 'Your analysis kept running while you were away — it does not need this page to ' +
      'be open. Picking it back up now; it will appear as soon as it is finished.',
    premiumResumeLabel: 'Get the premium report you paid for',
    premiumResumeTitle: 'You have already paid',
    premiumResumeBlurb: 'Your payment went through but the report didn’t arrive. Fetching it again is free.',
    premiumResumeAction: 'Fetch my premium report',
    // The second thing this app sells, and the reason its copy is separate
    // from the unlock's: they buy different things, and a dialog that says
    // "unlock premium sections" while charging US$2 for a re-run would be
    // describing the wrong purchase.
    analysisDialogTitle: 'Run your Psyche Card again',
    analysisDialogBlurb: 'Your first Psyche Card is free; each one after that is US$2.',
    // Shown on the upload page and beside the re-run button once the free run
    // is spent, so the price is never a surprise sprung at the last moment.
    analysisPriceNote: 'Your next Psyche Card costs US$2.',
    // Shown instead of the above once premium is unlocked — re-running then
    // bundles the four paid sections back in, at the unlock's own US$5
    // rather than the plain re-run's US$2, whether or not a free run is
    // still available. See rerunWithAdditionalData's alreadyUnlocked branch.
    analysisPriceNoteUnlocked: 'Your full premium report is unlocked, so re-running costs US$5 and ' +
      'refreshes everything — your card and the full premium report.',
    analysisFreeNote: 'Your first Psyche Card is free.',
    analysisDeclined: 'No charge was made. Your existing report is untouched.',
    // The daily server-wide ceiling, which is nobody's fault and not something
    // paying can always fix — so it says what it is rather than blaming them.
    analysisBudgetExhausted: 'PsycheAI has hit its limit of free analyses for today. Please try ' +
      'again tomorrow.',
    premiumDialogTitle: 'Unlock the full premium report',
    // Shown instead of the unlock copy above when the reader already has
    // premium and is re-running with added or changed data — "unlock" would
    // be the wrong verb for sections they already have. Same US$5, same
    // product, just a different reason to be paying it — see
    // rerunWithAdditionalData's alreadyUnlocked branch.
    premiumRerunDialogTitle: 'Re-run your full premium report',
    premiumRerunDialogBlurb: 'One charge regenerates everything against your new data – your card and the full premium report together.',
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
    premiumGenerationFailed: 'That went through, but the analysis could not be generated. Try again — ' +
      'the same payment can be used a few more times before it needs a new one.',
    // Shown between the two calls an unlock-with-added-data makes. Says
    // plainly that the second one is not another charge, because a second
    // progress bar after a payment otherwise reads like one.
    premiumRefreshingFree: 'Writing your full premium report from the new data — your card is redrawn with it at no extra charge…',
    premiumCancel: 'Cancel',
    premiumRetry: 'Try again',
    premiumPromoLabel: 'Have a promo code?',
    // The account's free card is spent (one per Instagram account): said on
    // the US$2 sheet that follows.
    freeUsedBlurb: 'This Instagram account has already had its free Psyche Card. Run it again for US$2.',
    // Invite three friends, get the full report free (lib/referral.js).
    referral: {
      title: 'Your link',
      blurb: 'Every 3 friends who make their card from your link, or 2 who buy the full report, earn you a free full report — use it yourself or gift it.',
      blurbPaid: 'Every 3 friends who make their card from your link, or 2 who buy the full report, earn you a free full report — gift it, or use it for a re-run with new data.',
      shareHint: 'Share your card or link above to start.',
      cards: 'made a card',
      paid: 'bought the full report',
      syncs: 'synced with you',
      ready: n => n === 1 ? '🎉 1 free full report ready' : '🎉 ' + n + ' free full reports ready',
      copyShort: 'Copy',
      claim: 'Use it',
      claimPaid: 'Use it for a re-run',
      gift: 'Gift it',
      useFree: 'Use your free full report — from your link',
      useGift: 'Use your gifted free full report',
      claimFailed: 'There is no free report to claim yet.',
      giftShareText: 'A free PsycheAI full report, from me 🎁 Make your free Psyche Card, then unlock the full report with this link:',
      giftCopied: 'Gift link copied. It unlocks one full report, once, within 60 days.',
      giftsHead: 'Gift links you have made (each works once, for 60 days)',
      giftArrivedTitle: 'You’ve been gifted a free full report',
      giftArrivedNew: 'Make your free Psyche Card first, then unlock the full report with it — no payment needed.',
      giftArrivedHave: 'Unlock your full report with it — no payment needed.',
      giftUse: 'Unlock with my gift',
    },
    premiumPromoPlaceholder: 'Promo code',
    premiumPromoApply: 'Apply',
    // A discount code, accepted: what it took off and what is left to pay.
    premiumPromoDiscount: (code, percent) => 'Promo code ' + code + ' applied: ' + percent + '% off.',
    // A code that came in the reader's link (?promo=), on the unlock box and
    // the payment sheet.
    linkPromoNote: (code) => 'Promo code ' + code + ' from your link is applied at checkout.',
    linkPromoFree: (code) => 'Promo code ' + code + ' unlocks the full report free. Tap Apply to start it.',
    linkPromoRefused: (code, reason) => 'The promo code in your link (' + code + ') could not be used: ' + String(reason || '').replace(/\.$/, '').replace(/^That code/, 'it') + '.',
    // The price on the payment sheet: the full price, and with a discount
    // code the discount and what is left to pay.
    premiumPriceFull: 'Price',
    premiumPriceDiscount: (code, percent) => 'Promo ' + code + ' (' + percent + '% off)',
    premiumPriceNet: 'You pay',

    trust: 'How much to trust this',
    trustSub: 'Everything above is inferred from behavioural traces, and the model says how far ' +
      'it would stand behind them.',
    trustScore: 'Confidence: ',
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
    sourcesUsed: 'Data sources',
    sourcesUsedHint: 'You can raise this report’s confidence by adding more sources of data. ' +
      'Instagram and Google together are the ideal combination — Instagram reads your outward ' +
      'persona, the self you present; Google reads your inward self, what you search and watch when ' +
      'no one is looking.',
    // Shown in place of the hint above when the digest itself has gone — the
    // report survives in its own localStorage entry, the evidence behind it
    // does not. Says what re-running will ask for rather than leaving a
    // reader to discover it by pressing the button.
    sourcesInstagramLost: 'The evidence this report was written from is no longer on this device — ' +
      'your browser may have cleared it to free space. The report itself is safe. To run the ' +
      'analysis again, load your Instagram export once more below.',
    sourceInstagram: 'Instagram',
    sourceGoogle: 'Google Takeout',
    sourceFacebook: 'Facebook',
    sourceWhatsApp: 'WhatsApp chats',
    // The WhatsApp row: up to three chats, each exported on its own.
    // `max` is 3 from the report page, 1 on a first upload.
    whatsappRowEmpty: (max = 3) => max === 1 ? 'One chat, exported from WhatsApp (.zip or .txt)'
      : 'Up to ' + max + ' exported chats (.zip or .txt)',
    whatsappRowSome: (n, max = 3) => max === 1 ? 'Chat loaded — tap to load a different one'
      : n + ' of ' + max + ' chats loaded — tap to ' + (n >= max ? 'start over' : 'add another'),
    // The first upload's WhatsApp row and the tag on its two optional rows.
    whatsappFirstTitle: 'WhatsApp chat with a close friend',
    sourceOptional: '(optional)',
    whatsappWhoAreYou: 'Which of these is you? Your own messages are the ones read.',
    whatsappFull: (max = 3) => max === 1 ? 'One chat is the most here — this one replaces the last.'
      : 'Three chats is the most — these start a fresh set.',
    sourceLoaded: 'Loaded',
    sourceMissing: 'Not loaded',
    rerunAnalysis: 'Add / change data & re-run analysis',
    // Flashed on the report when Continue is pressed with no Instagram export
    // loaded and none stored. Names the one thing that would make the re-run
    // possible, rather than reporting a failure the reader cannot act on.
    // The welcome page's "Start here" button and the line under it. The label
    // changes once anything is loaded, because at that point the button is no
    // longer asking for a file — it is the way back into a run that failed,
    // and "Load your data" would read as "do it all again".
    startLoad: 'Load your data',
    startContinue: 'Continue with your data',
    startLoadedSuffix: ' already loaded — nothing to upload again.',
    startNeedsInstagram: 'Load your Instagram export to get started.',
    rerunNeedsInstagram: 'Your Instagram export is no longer on this device, so there is nothing to ' +
      're-analyse. Load it again in the popout and your report will be rewritten from it.',
    // The digest failed to save — almost always a full localStorage. Said at
    // the moment it happens rather than left for the reader to discover when
    // a re-run has nothing to work from. The report itself is stored
    // separately and is usually fine, so this does not claim otherwise.
    digestTooLarge: 'Your report is saved, but the evidence summary behind it was too large for this ' +
      'browser’s storage. Re-running the analysis later will ask for your Instagram export again.',

    // The popout #rerun-with-data now opens, ahead of the review — see
    // askDataSources() in app.js. Every source already loaded is ticked but
    // stays clickable, so a reader can replace any one of them, Instagram
    // included, without starting the whole report over.
    dataSourcesTitle: 'Add or change your data',
    dataSourcesBlurb: 'Add a source or replace one with a fresh export. Nothing is sent until you ' +
      'review it on the next screen.',
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
    dataSourcesFirstBlurb: 'Before any data is sent for analysis, you will be able to review ' +
      'exactly what it contains and untick anything you are not comfortable sharing.',
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
    dataSourcesFirstInstagram: 'Load your Instagram export .zip file here. ' +
      'Select multiple files as needed.',
    // Only shown once a fresh Instagram export is actually picked — see the
    // reasoning at the call site in app.js for why this cannot always be
    // carried forward automatically.
    dataSourcesInstagramReplaceNote: 'Replacing Instagram starts your Google, Facebook and WhatsApp data fresh ' +
      'too — reload them here as well if you want them included in this run.',
    dataSourcesContinue: 'Continue',
    dataSourcesBack: 'Back',

    // The Psyche Sync report. It is two renderings of one document for the
    // same reason the profile is — the page and the downloadable PDF — so its
    // headings live here too rather than being typed once in each.
    compatCommon: 'What you share',
    // Over What works and What to look out for, which sit side by side under it.
    compatHowItPlays: 'How it plays out',
    compatWorks: 'What works',
    compatRubs: 'What to look out for',
    compatBoth: 'Both of you',
    compatFor: 'For ',
    compatSuffix: ' sync',
    // The score, said the way people say it: 78% in sync.
    syncName: 'Psyche Sync',
    syncScoreLabel: 'Psyche Sync score',
    syncPercent: (score) => score + '% in sync',
    syncPercentUnit: 'in sync',

    // The scan page, which is where a comparison starts and where past ones
    // are listed.
    scanTitle: 'Psyche Sync',
    scanHistory: 'Your Syncs',
    // My Syncs: one list, friends waiting to sync at the top, then past syncs.
    syncsList: 'Psyche Sync',
  };

  // ---------- the structured report layout ----------
  //
  // Everything the structured layout says that the classic one does not, kept
  // in one object so the classic strings above are untouched and switching
  // back (PSYCHEAI_REPORT_LAYOUT=classic) changes nothing a reader of the
  // classic report sees. The page and the PDF both read from here.
  //
  // The section definitions are this app's own wording. Professional
  // assessments open each section with a line saying what it measures; that
  // structure is borrowed, the words are not.
  const STRUCTURED = {
    // The four parts, plus the overview before them and the appendix after.
    parts: {
      overview: { label: 'Overview', title: 'Overview',
        intro: 'The short version of everything below, and the patterns that run through it.' },
      who: { label: 'Part 1', title: 'Who you are',
        intro: 'Your temperament – your type and the five broad traits underneath it – and how you are doing.' },
      drives: { label: 'Part 2', title: 'What drives you',
        intro: 'What you are working towards, what you keep coming back to, and what you hold to.' },
      connect: { label: 'Part 3', title: 'How you connect & work',
        intro: 'How you are with the people close to you, and how you work.' },
      together: { label: 'Part 4', title: 'Putting it together',
        intro: 'What to build on, what to work on, how your strengths behave under pressure, and how this report was made.' },
      // Part 05: how the report was made, and the roast.
      appendix: { label: 'Part 5', title: 'Appendix',
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
    connectsTo: 'Connects to',
    raisedBy: 'Raised by',
    showsUpIn: 'Shows up in',
    fromPattern: 'From pattern',
    earlySigns: 'Early signs',
    counterMove: 'Counter-move',
    reflect: 'Worth asking yourself',
    whatItTurnsInto: 'turns into',
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
        'A behavioural portrait written from your own data exports. It reads what you posted, wrote, ' +
        'searched and kept coming back to, rather than answers to a questionnaire, and every finding ' +
        'cites the evidence behind it.'],
      ['How it is organised',
        'An overview with your signature patterns, then four parts: who you are, what drives you, how ' +
        'you connect and work, and putting it together. Each section opens with what it measures. The ' +
        'patterns run through all of them, and the development plan at the end resolves each one.'],
      ['How to read the scales',
        'Scores run from 0 to 100, where 50 is typical. Each trait is a spectrum with both ends ' +
        'described and neither end better. The shaded band is where most people land, and it is an ' +
        'estimate, not a comparison with a measured group. Confidence labels say how firmly the evidence supports each read.'],
      ['What it cannot see',
        'Anything that happens away from these platforms: your conversations in person, your work, ' +
        'your history before the export begins. It is generated automatically, it is not a clinical or ' +
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
    // full report by its four parts. Section names are taken from the report's
    // own labels in app.js, so these hold only what the page says around them.
    insights: {
      freeBadge: 'Free',
      freeTitle: 'Your Psyche Card',
      freeBlurb: 'One card that sums you up, ready to share — read from your own data in a few minutes.',
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
      premiumTitle: 'The full premium report',
      premiumBlurb: 'Every part of your card explained with the evidence behind it, in four parts — plus the sections only the full report has.',
      partBlurbs: {
        who: 'Your character and signature patterns, your MBTI letter by letter, your Big Five trait by trait, and a wellbeing read across six dimensions.',
        drives: 'What motivates you on Schwartz\'s circle of ten values, your interests and where each is heading, and what you stand for.',
        connect: 'Your love languages, attachment style and who suits you; how you work, your edge and what holds you back.',
        together: 'A development plan built from everything above, a step-by-step plan you can tick off, and how your strengths behave under pressure.',
      },
      // Part 1's first section tag, for the character comparison.
      characterChip: 'Your character',
      extras: [['📄', 'A PDF to keep'], ['🔍', 'Evidence behind every finding'], ['🎁', 'A secret bonus section']],
      compatTitle: 'Psyche Sync, free',
      compatBlurb: 'Send a friend your link and see how in sync you are — your Psyche Sync score and how to relate better to each other.',
    },
    partNavLabel: 'Parts of this report',
    // The card's own labels in the structured layout.
    // The PDF's overview page: a line over the headline, and the four facts
    // set as tiles under the character.
    pdfGlance: {
      headline: 'In one line',
      type: 'Type',
      drive: 'Strongest drive',
      trait: 'Strongest trait',
      confidence: 'Confidence',
    },
    pdfCardFoot: 'psycheai.io · your personality, read from your own data',
    deleteText: 'This removes your Psyche Card, your full report, your evidence summary and every saved ' +
      'Psyche Sync from this browser. It cannot be undone.',
    deleteNote: 'Your count of analyses already run is kept, so this does not restore a free analysis.',
    // Beside a free report's Psyche Card: what each part means, popped out
    // when the reader points at it. Each has one short paragraph on what it is and why
    // it is worth knowing (`about`), then the reader's own reading (`yours`);
    // `when` skips a part the card does not have.
    // My Psyche, once the full report is unlocked: the way into My Report.
    reportPage: {
      pageTitle: 'Your Psyche Report',
      // The header's pill: the parts, and the PDF's pages once counted.
      pill: (parts, pages) => parts + ' parts' + (pages ? ' · ' + pages + ' pages' : ''),
      lede: 'The working behind your Psyche Card: what each result means, the evidence for it in your own data, and what to do with it.',
      open: 'See Psyche Report',
      ready: 'Your full report is ready.',
    },
    cardGuide: {
      title: 'How to read your Psyche Card',
      // What the panel says before any part of the card is pointed at.
      home: {
        title: 'Your Psyche Card',
        intro: 'Your personality on a single card – who you are most like, what drives you and how you connect, read from your own data.',
        // After the intro: where the reasoning behind the card is, free and paid.
        introFree: 'Unlock the premium report to read the full analysis and reasoning behind your Psyche Card.',
        introPaid: 'See your Psyche Report for the full analysis and reasoning behind your Psyche Card.',
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
        { key: 'confidence', icon: '🎯', title: 'The number in the ring', when: f => f.score,
          about: 'How much evidence stands behind the card: how much data there was, how much was read, and how consistently it agreed. High is a confident reading, low a first draft – adding Google or Facebook usually raises it.',
          yours: f => f.score + ' out of 100' + (f.level ? ' — ' + f.level + '.' : '.') },
        { key: 'patterns', icon: '🧵', title: 'Your patterns', when: f => f.pattern,
          about: 'The two or three behaviours that repeat across years of what you post and say. Your strengths and blind spots both come from them – naming them helps you catch them in the moment.',
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
            ' A slight letter sits near the middle — you can go either way.' },
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
      ],
    },
    cardStandFor: 'Values & Beliefs',
    cardInto: 'Interests',
    // Every card that is shared says where to get one: the address, not just the name.
    cardFooter: 'psycheai.io · your personality, read from your own data',
    cardTraitShort: { openness: 'Openness', conscientiousness: 'Conscientious', extraversion: 'Extraversion',
      agreeableness: 'Agreeable', neuroticism: 'Sensitivity' },
    cardStrength: { slight: 'slight', moderate: 'moderate', clear: 'clear' },
    nothingYet: 'Nothing here yet.',
    // The merged sections' own headings.
    howYouAttach: 'Attachment style',
    // "Beyond your card": the card's other lines, under it on a free report.
    // They are what travels in the compatibility link beside what the card
    // shows, and each is one the full report explains.
    beyond: {
      title: 'Beyond your card',
      sub: 'A few more things your data says. These also go into your link, for Psyche Sync.',
      relationships: 'With connections',
      dayToDay: 'Day to day',
      work: 'At work',
      conflict: 'In conflict',
      rhythm: 'Rhythm',
      energy: 'Social energy & contact',
      workStyle: 'Work style',
      strengths: 'Strengths',
      watchOuts: 'Watch-outs',
      holdsBack: 'What holds you back',
      tentative: 'tentative',
      foot: 'The full report explains each of these with the evidence behind it.',
    },
    whatYouBring: 'What you bring',
    whereItGetsHard: 'Where it gets hard',
    whoSuitsYou: 'Who suits you',
    inPractice: 'In practice',
    otherStrengths: 'Your other strengths',
    whatHoldsYouBack: 'What holds you back',
    whereItGoesWrong: 'Where it goes wrong',
    // Where an action on the plan came from, when it is not a develop area.
    fromWork: 'How you work',
    fromWellbeing: 'Wellbeing',
    atBest: 'At its best',
    overusedPrefix: 'Overused: ',
    // Everything the digest carries complete, beside the text it samples —
    // so "180 of 9,741 messages" is not read as all the analysis saw.
    sourcesHint: 'Adding Google or Facebook raises confidence.',
    // Evidence and method's sources: one row per source, what was read from
    // it beneath, and the row itself opens the data popout.
    sourcesReadTitle: 'Your data',
    sourceChange: 'Change',
    sourceAdd: 'Add',
    sourceNotAdded: 'Not added – adding it raises confidence',
    sourceLoaded: 'Loaded',
    sourcesFreeNote: 'Adding or changing data comes with the full premium report (US$5).',
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

    // The method section after Part 4 (the PDF's method page still uses these rows).
    methodSources: 'Sources read',
    methodCoverage: 'What the evidence covers',
    methodModel: 'Written by',
    methodBuild: 'Build',
    methodFormat: 'Report format',
    methodFormatValue: 'Structured report, v1',

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
    explainTypeTraitsTitle: 'MBTI & Big Five',
    explainTypeTraits: 'Your four letters and your five traits taken apart – the behaviours behind each, the ' +
      'evidence that pulls the other way, how firmly each one holds, and what it looks like in your ordinary week.',
    // Beside the plan in the unlock offer: a section it does not name.
    unlockSecretTitle: 'A secret bonus',
    unlockSecretText: 'One more section, kept under wraps. Unlock the full report to find out what it is.',
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
    badge: '<path d="M24 4l16 6v12c0 10-7 17-16 22-9-5-16-12-16-22V10z" fill="currentColor" fill-opacity=".18"/><path d="M24 4l16 6v12c0 10-7 17-16 22-9-5-16-12-16-22V10z"/><path d="M24 9l11 4v9c0 7-5 12-11 16-6-4-11-9-11-16v-9z"/><path d="M24 15l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>',
    fox: '<path d="M7 6l11 12h12L41 6c1 14-2 26-9 32l-8 6-8-6C9 32 6 20 7 6z" fill="currentColor" fill-opacity=".18"/><path d="M7 6l11 12h12L41 6c1 14-2 26-9 32l-8 6-8-6C9 32 6 20 7 6z"/><path d="M10 11l6 8M38 11l-6 8"/><path d="M14 28c3 0 5 2 6 4M34 28c-3 0-5 2-6 4"/><circle cx="18" cy="25" r="1.8" fill="currentColor" stroke="none"/><circle cx="30" cy="25" r="1.8" fill="currentColor" stroke="none"/><path d="M21 36l3 3 3-3z"/>',
    heart: '<path d="M24 41S5 30 5 17a9.5 9.5 0 0 1 19-3 9.5 9.5 0 0 1 19 3c0 13-19 24-19 24z" fill="currentColor" fill-opacity=".18"/><path d="M24 41S5 30 5 17a9.5 9.5 0 0 1 19-3 9.5 9.5 0 0 1 19 3c0 13-19 24-19 24z"/><path d="M24 19v12M18 25h12"/><path d="M10 14c1-3 3-4 6-4"/>',
    star: '<path d="M24 6 L28.8 16.8 L40.5 15.5 L33.5 25 L40.5 34.5 L28.8 33.2 L24 44 L19.2 33.2 L7.5 34.5 L14.5 25 L7.5 15.5 L19.2 16.8Z" fill="currentColor" fill-opacity=".18"/><path d="M24 6 L28.8 16.8 L40.5 15.5 L33.5 25 L40.5 34.5 L28.8 33.2 L24 44 L19.2 33.2 L7.5 34.5 L14.5 25 L7.5 15.5 L19.2 16.8Z"/><circle cx="24" cy="25" r="5"/><circle cx="24" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="40.5" cy="15.5" r="2" fill="currentColor" stroke="none"/><circle cx="40.5" cy="34.5" r="2" fill="currentColor" stroke="none"/><circle cx="24" cy="44" r="2" fill="currentColor" stroke="none"/><circle cx="7.5" cy="34.5" r="2" fill="currentColor" stroke="none"/><circle cx="7.5" cy="15.5" r="2" fill="currentColor" stroke="none"/>',
    rocket: '<path d="M24 3c8 6 10 16 8 26H16c-2-10 0-20 8-26z" fill="currentColor" fill-opacity=".18"/><path d="M24 3c8 6 10 16 8 26H16c-2-10 0-20 8-26z"/><circle cx="24" cy="16" r="4"/><path d="M16 22l-7 7v6l7-4M32 22l7 7v6l-7-4"/><path d="M19 33c0 5 2 9 5 12 3-3 5-7 5-12z" fill="currentColor" stroke="none" fill-opacity=".35"/><path d="M19 33c0 5 2 9 5 12 3-3 5-7 5-12"/><path d="M6 10v4M4 12h4M41 6v3M39.5 7.5h3"/>',
    seedling: '<path d="M24 38V20"/><path d="M24 26c0-8-6-12-15-12 0 8 6 12 15 12z" fill="currentColor" fill-opacity=".18"/><path d="M24 26c0-8-6-12-15-12 0 8 6 12 15 12z"/><path d="M24 21c0-8 6-12 15-12 0 8-6 12-15 12z" fill="currentColor" fill-opacity=".18"/><path d="M24 21c0-8 6-12 15-12 0 8-6 12-15 12z"/><path d="M15 20l4 3M33 15l-4 3"/><path d="M12 38h24l-3 7H15z" fill="currentColor" fill-opacity=".18"/><path d="M12 38h24l-3 7H15z"/><circle cx="40" cy="30" r="1.5"/>',
    whisk: '<path d="M14 22a7 7 0 0 1 2-13 8 8 0 0 1 16 0 7 7 0 0 1 2 13v6H14z" fill="currentColor" fill-opacity=".18"/><path d="M14 22a7 7 0 0 1 2-13 8 8 0 0 1 16 0 7 7 0 0 1 2 13v6H14z"/><path d="M14 28h20v5H14z"/><path d="M20 22v6M28 22v6M24 21v7"/><path d="M24 33v12M20 45h8"/>',
    sun: '<circle cx="24" cy="24" r="9" fill="currentColor" fill-opacity=".18"/><circle cx="24" cy="24" r="9"/><path d="M36 24L44 24 M34.4 30L38.7 32.5 M30 34.4L34 41.3 M24 36L24 41 M18 34.4L14 41.3 M13.6 30L9.3 32.5 M12 24L4 24 M13.6 18L9.3 15.5 M18 13.6L14 6.7 M24 12L24 7 M30 13.6L34 6.7 M34.4 18L38.7 15.5"/><circle cx="21" cy="22" r="1.2" fill="currentColor" stroke="none"/><circle cx="27" cy="22" r="1.2" fill="currentColor" stroke="none"/><path d="M20.5 26c2 2.5 5 2.5 7 0"/>',
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
    onion: '<path d="M24 8c-9 9-17 15-17 23a17 13 0 0 0 34 0c0-8-8-14-17-23z" fill="currentColor" fill-opacity=".18"/><path d="M24 8c-9 9-17 15-17 23a17 13 0 0 0 34 0c0-8-8-14-17-23z"/><path d="M24 14c-5 6-10 11-10 17a10 9 0 0 0 20 0c0-6-5-11-10-17z"/><path d="M24 20c-2 4-4 7-4 11a4 5 0 0 0 8 0c0-4-2-7-4-11z"/><path d="M24 8c0-3 1-5 3-6M24 8c-1-2-3-3-5-3"/><path d="M18 44l-1 2M24 44v2M30 44l1 2"/>',
    bowl: '<path d="M5 24h38c0 11-9 18-19 18S5 35 5 24z" fill="currentColor" fill-opacity=".18"/><path d="M5 24h38c0 11-9 18-19 18S5 35 5 24z"/><path d="M17 42h14"/><path d="M12 24c3-4 6-4 9 0s6 4 9 0 6-4 9 0"/><path d="M30 4l-8 22M36 6l-10 20"/><path d="M12 18c0-3 3-3 3-6M18 18c0-3 3-3 3-6"/>',
    book: '<path d="M24 13C19 9 11 8 4 10v28c7-2 15-1 20 3 5-4 13-5 20-3V10c-7-2-15-1-20 3z" fill="currentColor" fill-opacity=".18"/><path d="M24 13C19 9 11 8 4 10v28c7-2 15-1 20 3 5-4 13-5 20-3V10c-7-2-15-1-20 3z"/><path d="M24 13v28"/><path d="M9 17c4-1 8 0 11 2M9 23c4-1 8 0 11 2M9 29c4-1 8 0 11 2M28 19c3-2 7-3 11-2M28 25c3-2 7-3 11-2"/><path d="M38 1l1.3 3.2 3.2 1.3-3.2 1.3L38 10l-1.3-3.2-3.2-1.3 3.2-1.3z" fill="currentColor" stroke="none"/>',
    skull: '<path d="M24 6C14 6 7 13 7 22c0 6 3 10 7 12v7h20v-7c4-2 7-6 7-12 0-9-7-16-17-16z" fill="currentColor" fill-opacity=".18"/><path d="M24 6C14 6 7 13 7 22c0 6 3 10 7 12v7h20v-7c4-2 7-6 7-12 0-9-7-16-17-16z"/><ellipse cx="17" cy="22" rx="4" ry="5" fill="currentColor" stroke="none"/><ellipse cx="31" cy="22" rx="4" ry="5" fill="currentColor" stroke="none"/><path d="M24 28l-2.5 3.5h5z" fill="currentColor" stroke="none"/><path d="M19 41v-5M24 41v-5M29 41v-5"/><path d="M40 8c2 2 3 5 2 8M8 8c-2 2-3 5-2 8"/>',
    brooch: '<path d="M24 43S5 31 5 18a9.5 9.5 0 0 1 19-4 9.5 9.5 0 0 1 19 4c0 13-19 25-19 25z" fill="currentColor" fill-opacity=".18"/><path d="M24 43S5 31 5 18a9.5 9.5 0 0 1 19-4 9.5 9.5 0 0 1 19 4c0 13-19 25-19 25z"/><path d="M27 16a9 9 0 1 0 5 15 7 7 0 0 1-5-15z" fill="currentColor" stroke="none"/><circle cx="24" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="9" cy="22" r="1.6" fill="currentColor" stroke="none"/><circle cx="39" cy="22" r="1.6" fill="currentColor" stroke="none"/>',
    peach: '<path d="M24 15c-9-5-20 1-20 13 0 9 8 16 20 16s20-7 20-16c0-12-11-18-20-13z" fill="currentColor" fill-opacity=".18"/><path d="M24 15c-9-5-20 1-20 13 0 9 8 16 20 16s20-7 20-16c0-12-11-18-20-13z"/><path d="M24 15c-3 8-3 19 0 29"/><path d="M24 15c0-4 2-8 5-10"/><path d="M28 9c4-6 11-6 14-3-4 5-10 6-14 3z" fill="currentColor" fill-opacity=".18"/><path d="M28 9c4-6 11-6 14-3-4 5-10 6-14 3z"/>',
    bow: '<path d="M24 21C17 10 4 9 4 21s13 11 20 0z" fill="currentColor" fill-opacity=".18"/><path d="M24 21C17 10 4 9 4 21s13 11 20 0z"/><path d="M24 21c7-11 20-12 20 0s-13 11-20 0z" fill="currentColor" fill-opacity=".18"/><path d="M24 21c7-11 20-12 20 0s-13 11-20 0z"/><ellipse cx="24" cy="21" rx="4.5" ry="5.5" fill="currentColor" fill-opacity=".45"/><ellipse cx="24" cy="21" rx="4.5" ry="5.5"/><path d="M21 26l-5 15 5-3 2 4 1-15M27 26l5 15-5-3-2 4-1-15"/>',
    flame: '<path d="M24 45c-10 0-15-6-15-14 0-10 9-13 9-24 6 4 11 10 11 16 2-2 3-5 3-8 5 4 7 10 7 16 0 8-5 14-15 14z" fill="currentColor" fill-opacity=".18"/><path d="M24 45c-10 0-15-6-15-14 0-10 9-13 9-24 6 4 11 10 11 16 2-2 3-5 3-8 5 4 7 10 7 16 0 8-5 14-15 14z"/><path d="M24 45c-5 0-7-3-7-7 0-5 4-7 5-12 3 3 6 6 6 10 1-1 2-2 2-4 2 2 3 4 3 6 0 4-3 7-9 7z" fill="currentColor" stroke="none" fill-opacity=".45"/>',
  };
  const CHARACTER_EMBLEMS = {
    'Mulan': 'sword', 'Elsa': 'snowflake', 'Moana': 'wave', 'Simba': 'crown', 'Rapunzel': 'lantern',
    'Judy Hopps': 'badge', 'Nick Wilde': 'fox', 'Baymax': 'heart',
    'Woody': 'star', 'Buzz Lightyear': 'rocket', 'WALL-E': 'seedling', 'Remy': 'whisk', 'Joy': 'sun',
    'Iron Man': 'wrench', 'Captain America': 'shield', 'Spider-Man': 'web', 'Hulk': 'mountain',
    'Wonder Woman': 'lasso', 'Batman': 'moon',
    'Pikachu': 'bolt', 'Totoro': 'leaf',
    'Shrek': 'onion', 'Po': 'bowl', 'Hiccup': 'flame',
    'Hermione Granger': 'book', 'Kuromi': 'skull', 'Sailor Moon': 'brooch', 'Princess Peach': 'peach', 'Hello Kitty': 'bow',
    // Retired from the catalogue (lib/prompts.js, RETIRED_CHARACTERS), kept so
    // a card written before they were retired still draws its emblem.
    'Black Panther': 'claw', 'Doctor Strange': 'eye', 'Mario': 'mushroom', 'Link': 'compass',
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
  function characterArt(character, className) {
    const art = (root.PsycheCharacterArt || {})[String(character || '').trim()];
    if (!art) return '';
    const id = 'pc-art-' + (++artDrawn);
    return '<svg class="' + (className || 'pc-art') + '" viewBox="0 0 520 440" preserveAspectRatio="xMaxYMax slice" ' +
      'aria-hidden="true" focusable="false">' + art.replace(/\{id\}/g, id) + '</svg>';
  }

  /** The emblem for a catalogue character, as SVG markup, or '' for any other name. */
  function emblemSvg(character, className) {
    const key = CHARACTER_EMBLEMS[String(character || '').trim()];
    if (!key || !EMBLEM_PATHS[key]) return '';
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
    TRAIT_LABELS, MBTI_POLES, axisLabel, LOVE_LANGUAGE_ICONS, CARD_ICONS,
    ACTIVITY_FACETS, WELLNESS_FACETS, MODE_LABELS, WORK_STANCES, stanceText, BRAND_MARK, TEXT, STRUCTURED,
    CHARACTER_EMBLEMS, EMBLEM_PATHS, emblemSvg, characterArt, gentleAttachment,
  };
})(typeof window !== 'undefined' ? window : globalThis);
