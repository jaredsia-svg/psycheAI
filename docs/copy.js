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
    // Download sits on the left, share on the right — the order a reader
    // meets them reading left to right. Each carries a small visible label
    // beside its icon (`cardDownloadLabel`/`cardShareLabel`) plus a fuller
    // aria-label (`cardDownload`/`cardShare`) for a screen reader — the two
    // do not have to say the same thing, and the aria-label is the one that
    // still spells out what the download actually produces.
    cardDownload: 'Download as image',
    cardDownloadLabel: 'Download',
    cardShare: 'Share',
    cardShareLabel: 'Share',
    // One shared status line under both buttons rather than each swallowing
    // its own label on failure, since the visible label is a fixed word
    // ("Download"/"Share") rather than a place an error could borrow.
    cardImageError: 'Could not build the image',

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

    // Cover copy for the three sections behind the paywall. Each says
    // specifically what is behind it rather than gesturing at "more
    // analysis": a reader deciding whether to pay is owed the same honesty
    // as a reader deciding whether to look at the roast below, and a vague
    // cover is the version that sells worst *and* informs least.
    wellnessCoverTitle: 'Six dimensions, read from your behaviour',
    wellnessCoverBlurb: 'Sleep and rhythm, cognitive load, social connection, physical activity, ' +
      'emotional processing and meaning — each with the evidence behind it, an honest confidence ' +
      'level, and concrete suggestions. A behavioural read, never a health assessment.',
    attachmentCoverTitle: 'How you are to be close to',
    attachmentCoverBlurb: 'Your likely attachment style with the working shown — which traces point ' +
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
      'attachment style rather than a wishlist of adjectives — what to be careful of, and an honest ' +
      'verdict on what suits you.',
    idealPartnerNeeds: 'What you actually need',
    idealPartnerCarefulOf: 'What to be careful of',
    idealPartnerSummary: 'The honest verdict',

    careerCoverTitle: 'A career coach on your edge',
    careerCoverBlurb: 'Where you appear to be, the thing you do reliably that most people do not, ' +
      'what you are visibly not using, the pattern most likely to cost you — and actions to take ' +
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
    premiumTierBlurb: 'These four sections provide you with deeper insights:',
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
      'deliberately unkind, not a diagnosis, and free with the rest of this report. Read it if you ' +
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
    // Shown while the paid model call is in flight, after payment has already
    // cleared — this can take as long as the free report did, for the same
    // reason: a long structured response with thinking enabled. The dialog
    // also shows a live seconds count beside it (see #premium-progress) for
    // the same reason app.js shows elapsed time on the free analysis: a
    // still sentence next to a spinning bar reads as stalled.
    premiumGenerating: 'Writing your four sections… this may take a few minutes.',
    // The three states of coming back to an unlock that never arrived. Not one
    // string, because "you already paid" is the part that has to land first
    // and a reader skimming a dialog reads the title.
    premiumResumeLabel: 'Get the sections you paid for',
    premiumResumeTitle: 'You have already paid',
    premiumResumeBlurb: 'Your payment went through but the analysis did not reach this device — the ' +
      'tab closed, the connection dropped, or the device slept while it was being written. Fetching ' +
      'it again costs nothing.',
    premiumResumeAction: 'Fetch my analysis',
    // The second thing this app sells, and the reason its copy is separate
    // from the unlock's: they buy different things, and a dialog that says
    // "unlock premium sections" while charging S$0.99 for a re-run would be
    // describing the wrong purchase.
    analysisDialogTitle: 'Run another analysis',
    analysisDialogBlurb: 'Your first analysis is free. Each one after that — including re-running ' +
      'with Google or Facebook data added — is S$0.99, because every run is a fresh call to the AI ' +
      'model and costs real money to produce.',
    // Shown on the upload page and beside the re-run button once the free run
    // is spent, so the price is never a surprise sprung at the last moment.
    analysisPriceNote: 'Your next analysis costs S$0.99.',
    // Shown instead of the above once premium is unlocked — re-running then
    // bundles the four paid sections back in, at the unlock's own S$1.99
    // rather than the plain re-run's S$0.99, whether or not a free run is
    // still available. See rerunWithAdditionalData's alreadyUnlocked branch.
    analysisPriceNoteUnlocked: 'Your premium sections are unlocked, so re-running costs S$1.99 and ' +
      'refreshes everything — the free report and all four premium sections.',
    analysisFreeNote: 'Your first analysis is free.',
    analysisDeclined: 'No charge was made. Your existing report is untouched.',
    // The daily server-wide ceiling, which is nobody's fault and not something
    // paying can always fix — so it says what it is rather than blaming them.
    analysisBudgetExhausted: 'PsycheAI has hit its limit of free analyses for today. Please try ' +
      'again tomorrow.',
    premiumDialogTitle: 'Unlock premium sections',
    premiumDialogBlurb: 'One charge opens the mental wellness read, your attachment style, what ' +
      'partner truly suits you and the career assessment. Taken on this device — Apple Pay or Google ' +
      'Pay, whichever this browser offers.',
    // Shown instead of the above when the reader added a Google or Facebook
    // export on the way here. The same S$1.99 now also rewrites the free
    // sections against that data, so the price is doing more and says so
    // before it is agreed to rather than after.
    premiumDialogBlurbWithData: 'One charge opens the mental wellness read, your attachment style, ' +
      'what partner truly suits you and the career assessment — and, because you added more data, ' +
      'rewrites the rest of your report with it at no extra cost. Taken on this device — Apple Pay or ' +
      'Google Pay, whichever this browser offers.',
    // Shown instead of the unlock copy above when the reader already has
    // premium and is re-running with added or changed data — "unlock" would
    // be the wrong verb for sections they already have. Same S$1.99, same
    // product, just a different reason to be paying it — see
    // rerunWithAdditionalData's alreadyUnlocked branch.
    premiumRerunDialogTitle: 'Re-run your full analysis',
    premiumRerunDialogBlurb: 'One charge regenerates everything against your new data — the free ' +
      'report and all four premium sections together. Taken on this device — Apple Pay or Google Pay, ' +
      'whichever this browser offers.',
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
    premiumRefreshingFree: 'Paid sections are ready. Rewriting the rest of your report with the new data — no extra charge…',
    premiumCancel: 'Cancel',
    premiumRetry: 'Try again',
    premiumPromoLabel: 'Have a promo code?',
    premiumPromoPlaceholder: 'Promo code',
    premiumPromoApply: 'Apply',

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
    sourceLoaded: 'Loaded',
    sourceMissing: 'Not loaded',
    rerunAnalysis: 'Add / change data & re-run analysis',
    // Flashed on the report when Continue is pressed with no Instagram export
    // loaded and none stored. Names the one thing that would make the re-run
    // possible, rather than reporting a failure the reader cannot act on.
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
    dataSourcesBlurb: 'Load a fresh export to replace a source, or add one you have not used yet. ' +
      'Nothing is sent anywhere until you review it on the next screen.',
    // Only shown once a fresh Instagram export is actually picked — see the
    // reasoning at the call site in app.js for why this cannot always be
    // carried forward automatically.
    dataSourcesInstagramReplaceNote: 'Replacing Instagram starts your Google and Facebook data fresh ' +
      'too — reload them here as well if you want them included in this run.',
    dataSourcesContinue: 'Continue',
    dataSourcesBack: 'Back',

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
