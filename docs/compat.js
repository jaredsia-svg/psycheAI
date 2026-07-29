// Compatibility engine — romantic and platonic, scored separately.
//
// The two modes share the same eight dimensions but weight them very
// differently: what makes a good partner is not what makes a good friend.
// Shared interests carry a friendship; attachment style and life direction
// decide a relationship.
//
// Every dimension returns a score *and* the sentences that explain it, so the
// report is an assessment rather than a number.
(function (root) {
  'use strict';

  const Q = root.KindredQuestions;

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const pct = x => Math.round(clamp(x, 0, 100));
  const similarity = (a, b) => 100 - Math.abs(a - b);
  const bothHigh = (a, b) => 0.6 * Math.min(a, b) + 0.4 * ((a + b) / 2);
  const avg = (a, b) => (a + b) / 2;

  function weighted(parts) {
    let sum = 0;
    let weight = 0;
    for (const p of parts) {
      if (p.score === null || p.score === undefined) continue;
      sum += p.score * p.weight;
      weight += p.weight;
    }
    return weight ? pct(sum / weight) : 50;
  }

  // Cosine-style overlap of two short option lists, scaled so that "two of
  // three shared" reads as a strong match rather than a middling one.
  function listOverlap(a, b) {
    const listA = (a || []).filter(Boolean);
    const listB = (b || []).filter(Boolean);
    if (!listA.length || !listB.length) return { score: 50, shared: [], known: false };
    const setB = new Set(listB);
    const shared = listA.filter(x => setB.has(x));
    const cosine = shared.length / Math.sqrt(listA.length * listB.length);
    return { score: pct(cosine * 118), shared, known: true };
  }

  function indexOf(list, value) { return list.indexOf(value); }

  // Ordered three-option questions (chronotype, planning, …): adjacent
  // answers are close, opposite ends are not.
  function ordinalMatch(options, a, b, scores) {
    const ia = indexOf(options, a);
    const ib = indexOf(options, b);
    if (ia < 0 || ib < 0) return null;
    return scores[Math.abs(ia - ib)];
  }

  // ---------- 1. values & priorities ----------

  // The document asks what qualities you look for; this maps those onto the
  // self-description list so "wants kindness" can meet "describes self as kind".
  const QUALITY_TO_DESCRIPTORS = {
    Kindness: ['Kind', 'Generous'],
    Honesty: ['Having integrity', 'Humble'],
    'Humour': ['Humorous', 'Easy-going'],
    Loyalty: ['Loyal'],
    Ambition: ['Hardworking', 'Growth mindset'],
    Empathy: ['Kind', 'Reflective and contemplative'],
    Intelligence: ['Intelligent', 'Growth mindset'],
    Generosity: ['Generous', 'Kind'],
    Adventurous: ['Adventurous', 'Spontaneous and adaptable'],
    'Physical attraction': [],
    Stability: ['Organized', 'Resilient', 'Simple'],
    Authenticity: ['Humble', 'Having integrity', 'Simple'],
    Reflective: ['Reflective and contemplative'],
  };

  function qualitiesMet(seeker, shown) {
    const wanted = (seeker.qualities || []).filter(q => (QUALITY_TO_DESCRIPTORS[q] || []).length);
    if (!wanted.length) return { score: null, met: [], missed: [] };
    const descriptors = new Set(shown.descriptors || []);
    const met = [];
    const missed = [];
    for (const quality of wanted) {
      const matches = QUALITY_TO_DESCRIPTORS[quality].some(d => descriptors.has(d));
      (matches ? met : missed).push(quality);
    }
    return { score: pct(40 + (met.length / wanted.length) * 60), met, missed };
  }

  function valuesDimension(a, b) {
    const priorities = listOverlap(a.priorities, b.priorities);
    const ingredients = listOverlap(a.ingredients, b.ingredients);
    const aMet = qualitiesMet(a, b);
    const bMet = qualitiesMet(b, a);
    const qualityScores = [aMet.score, bMet.score].filter(s => s !== null);
    const qualityScore = qualityScores.length ? avg(qualityScores[0], qualityScores[qualityScores.length - 1]) : null;

    const score = weighted([
      { score: priorities.score, weight: 0.45 },
      { score: ingredients.score, weight: 0.30 },
      { score: qualityScore, weight: 0.25 },
    ]);

    const strengths = [];
    const watchOuts = [];
    if (priorities.shared.length) {
      strengths.push('You are both building your life around ' + humanList(priorities.shared.map(lower)) + '.');
    } else {
      watchOuts.push('None of your top-three life priorities overlap — ' + a.name + ' is oriented to ' +
        humanList((a.priorities || []).map(lower)) + ', ' + b.name + ' to ' + humanList((b.priorities || []).map(lower)) +
        '. That is workable, but it means you will be pulling in different directions by default rather than by accident.');
    }
    if (ingredients.shared.length) {
      strengths.push('You agree on what a good relationship is made of: ' + humanList(ingredients.shared.map(lower)) + '.');
    } else if (ingredients.known) {
      watchOuts.push(a.name + ' rates ' + humanList((a.ingredients || []).map(lower)) + ' as the essentials while ' +
        b.name + ' rates ' + humanList((b.ingredients || []).map(lower)) + '. Expect to give each other the wrong kind of effort until you say this out loud.');
    }
    if (aMet.missed.length) {
      watchOuts.push(a.name + ' is looking for ' + humanList(aMet.missed.map(lower)) +
        ', which is not how ' + b.name + ' describes themselves.');
    }
    if (bMet.missed.length) {
      watchOuts.push(b.name + ' is looking for ' + humanList(bMet.missed.map(lower)) +
        ', which is not how ' + a.name + ' describes themselves.');
    }
    if (aMet.met.length && bMet.met.length) {
      strengths.push('Each of you is visibly what the other says they are looking for — ' +
        a.name + ' wants ' + humanList(aMet.met.map(lower)) + ' and ' + b.name + ' wants ' + humanList(bMet.met.map(lower)) + '.');
    }

    return { score, strengths, watchOuts, shared: { priorities: priorities.shared, ingredients: ingredients.shared } };
  }

  // ---------- 2. personality ----------

  function personalityDimension(a, b, mode) {
    const x = a.bigFive;
    const y = b.bigFive;
    const romantic = mode === 'romantic';

    const parts = [
      { id: 'agreeableness', score: bothHigh(x.agreeableness, y.agreeableness), weight: romantic ? 0.30 : 0.28 },
      { id: 'conscientiousness', score: 0.6 * similarity(x.conscientiousness, y.conscientiousness) + 0.4 * avg(x.conscientiousness, y.conscientiousness), weight: 0.22 },
      { id: 'openness', score: similarity(x.openness, y.openness), weight: romantic ? 0.18 : 0.20 },
      { id: 'extraversion', score: 100 - 0.6 * Math.abs(x.extraversion - y.extraversion), weight: romantic ? 0.14 : 0.20 },
      { id: 'stability', score: 100 - (0.6 * Math.max(x.neuroticism, y.neuroticism) + 0.4 * avg(x.neuroticism, y.neuroticism)), weight: romantic ? 0.16 : 0.10 },
    ];
    const score = weighted(parts);

    const strengths = [];
    const watchOuts = [];

    if (Math.min(x.agreeableness, y.agreeableness) >= 60) {
      strengths.push('You are both warm, accommodating people. Conflict between you is likely to be gentle — the risk is that neither of you says the hard thing.');
    } else if (Math.max(x.agreeableness, y.agreeableness) < 45) {
      watchOuts.push('Neither of you is naturally accommodating. You will be direct with each other, which is efficient right up until it isn\'t — agree early that bluntness is not contempt.');
    }

    const cGap = Math.abs(x.conscientiousness - y.conscientiousness);
    if (cGap >= 25) {
      const planner = x.conscientiousness > y.conscientiousness ? a : b;
      const improviser = planner === a ? b : a;
      watchOuts.push(planner.name + ' plans; ' + improviser.name + ' improvises. ' + planner.name +
        ' will read ' + improviser.name + ' as unreliable and ' + improviser.name + ' will read ' + planner.name +
        ' as rigid. Neither is true — decide together which decisions actually need a plan and let the rest be loose.');
    } else if (Math.min(x.conscientiousness, y.conscientiousness) >= 60) {
      strengths.push('You are both organised and follow through, so plans you make together will actually happen.');
    }

    const eGap = Math.abs(x.extraversion - y.extraversion);
    if (eGap >= 30) {
      const outgoing = x.extraversion > y.extraversion ? a : b;
      const quiet = outgoing === a ? b : a;
      watchOuts.push(outgoing.name + ' recharges around people and ' + quiet.name + ' recharges away from them. ' +
        'This is the single most common source of low-grade resentment in a ' + (romantic ? 'relationship' : 'friendship') +
        ' — solve it with arrival and exit times agreed before you go out, not after.');
    } else if (Math.min(x.extraversion, y.extraversion) >= 60) {
      strengths.push('You are both outgoing — expect a busy, people-filled shared life.');
    } else if (Math.max(x.extraversion, y.extraversion) <= 40) {
      strengths.push('You are both low-key. Nobody here is going to be dragged to a party they didn\'t want to attend.');
    }

    const oGap = Math.abs(x.openness - y.openness);
    if (oGap >= 30) {
      const curious = x.openness > y.openness ? a : b;
      const grounded = curious === a ? b : a;
      watchOuts.push(curious.name + ' is drawn to novelty and ' + grounded.name + ' to the familiar. ' +
        'Alternate who picks — one trip, one weekend, one restaurant at a time — rather than negotiating each occasion from scratch.');
    } else if (Math.min(x.openness, y.openness) >= 60) {
      strengths.push('You are both curious people, which usually means you will keep finding new things to do together instead of settling into a rut.');
    }

    if (Math.max(x.neuroticism, y.neuroticism) >= 65) {
      const sensitive = x.neuroticism > y.neuroticism ? a : b;
      const steady = sensitive === a ? b : a;
      if (Math.min(x.neuroticism, y.neuroticism) >= 60) {
        watchOuts.push('You both feel things intensely. When you are both dysregulated at once there is no anchor in the room — agree on a rule now for what happens when neither of you is calm.');
      } else {
        watchOuts.push(sensitive.name + ' feels things at full volume; ' + steady.name + ' is steadier. ' +
          steady.name + ' should resist the urge to fix, and ' + sensitive.name + ' should say explicitly whether they want comfort or solutions.');
      }
    } else if (Math.max(x.neuroticism, y.neuroticism) <= 40) {
      strengths.push('Neither of you is easily rattled, which makes this a low-drama pairing.');
    }

    return { score, strengths, watchOuts };
  }

  // ---------- 3. attachment ----------

  const ATTACHMENT_LABELS = {
    secure: 'Secure', anxious: 'Anxious', avoidant: 'Avoidant', fearful: 'Fearful-avoidant',
  };

  // Keyed by the two styles sorted alphabetically, which is how
  // attachmentDimension builds its lookup key.
  const ATTACHMENT_PAIRS = {
    'secure|secure': { score: 94, note: 'Two secure people. Closeness feels natural to you both, and repairs after conflict happen quickly because neither of you is bracing for abandonment.' },
    'anxious|secure': { score: 78, note: 'One secure, one anxious. This is the pairing that most reliably heals anxious attachment — consistency from the secure side gradually stops the alarm going off.' },
    'avoidant|secure': { score: 76, note: 'One secure, one avoidant. The secure partner\'s lack of pursuit is exactly what makes closeness safe for the avoidant one, provided they do not read distance as rejection.' },
    'fearful|secure': { score: 70, note: 'One secure, one fearful-avoidant. Predictability is the whole game here: the fearful partner\'s push-pull settles in direct proportion to how boringly reliable the secure one is.' },
    'anxious|anxious': { score: 58, note: 'Two anxious people. Enormous closeness, and enormous volatility — both of you escalate when you feel unseen, so small ruptures get loud fast.' },
    'anxious|avoidant': { score: 40, note: 'The classic anxious–avoidant trap. One pursues when distressed, the other withdraws, and each behaviour causes the other. This is workable, but only if both of you name the cycle rather than the person.' },
    'anxious|fearful': { score: 46, note: 'Anxious meets fearful-avoidant. The pursuing and the push-pull feed each other; expect intensity and expect it to be exhausting without explicit ground rules.' },
    'avoidant|avoidant': { score: 54, note: 'Two avoidant people. Comfortable, low-demand, and at risk of never getting past pleasant — intimacy will need to be scheduled rather than waited for.' },
    'avoidant|fearful': { score: 44, note: 'Avoidant meets fearful-avoidant. Both of you retreat under stress, so unresolved things pile up quietly instead of being fought about.' },
    'fearful|fearful': { score: 42, note: 'Two fearful-avoidant people. You will both want and fear the same closeness at the same time. Individual work matters more than pairing advice here.' },
  };

  const ATTACHMENT_ADVICE = {
    secure: { give: 'Keep being predictable — your steadiness is doing more work than you realise.', need: 'Say when you need something; people read your calm as "no needs".' },
    anxious: { give: 'Give reassurance freely and early rather than waiting to be asked.', need: 'Ask directly for the reassurance you want instead of testing for it.' },
    avoidant: { give: 'Say when you are going quiet and when you will be back — the silence, not the space, is what wounds.', need: 'Protect your alone time out loud rather than by disappearing.' },
    fearful: { give: 'Be consistent when they pull away; do not match their withdrawal.', need: 'Name the push-pull as it happens — "I want to be close and I am scared" is a complete sentence.' },
  };

  function attachmentDimension(a, b, mode) {
    const key = [a.attachment, b.attachment].sort().join('|');
    const pair = ATTACHMENT_PAIRS[key] || { score: 60, note: '' };
    // Attachment fires hardest in romantic bonds; friendships activate it far
    // less, so compress the spread toward neutral.
    const score = mode === 'romantic' ? pair.score : pct(70 + (pair.score - 70) * 0.45);
    const strengths = [];
    const watchOuts = [];
    (pair.score >= 70 ? strengths : watchOuts).push(pair.note);
    return { score, strengths, watchOuts, note: pair.note, key };
  }

  // ---------- 4. worldview & background ----------

  const NON_RELIGIOUS = ['Agnostic', 'Atheist'];

  function religionScore(a, b) {
    const x = a.background.religion;
    const y = b.background.religion;
    if (!x || !y || x === 'Other' || y === 'Other') return null;
    if (x === y) return 96;
    const xSecular = NON_RELIGIOUS.includes(x);
    const ySecular = NON_RELIGIOUS.includes(y);
    if (xSecular && ySecular) return 88;
    if (xSecular !== ySecular) return 44;
    return 52;   // two different faiths
  }

  function kidsScore(a, b) {
    const x = a.habits.kids;
    const y = b.habits.kids;
    if (!x || !y) return null;
    if (x === y && x !== 'Unsure') return 98;
    if (x === 'Unsure' || y === 'Unsure') return 62;
    return 12;   // one wants kids, the other does not
  }

  function worldviewDimension(a, b, mode) {
    const romantic = mode === 'romantic';
    const religion = religionScore(a, b);
    const kids = kidsScore(a, b);
    const sameCountry = a.background.country && b.background.country &&
      a.background.country.trim().toLowerCase() === b.background.country.trim().toLowerCase();
    const country = (a.background.country && b.background.country) ? (sameCountry ? 88 : 62) : null;
    const education = ordinalMatch(Q.EDUCATION, a.background.education, b.background.education, [90, 76, 62]);
    const occupation = (a.background.occupationCategory && b.background.occupationCategory)
      ? (a.background.occupationCategory === b.background.occupationCategory ? 80 : 66) : null;

    const score = weighted(romantic ? [
      { score: religion, weight: 0.35 },
      { score: kids, weight: 0.30 },
      { score: country, weight: 0.12 },
      { score: education, weight: 0.13 },
      { score: occupation, weight: 0.10 },
    ] : [
      { score: religion, weight: 0.25 },
      { score: kids, weight: 0.05 },
      { score: country, weight: 0.25 },
      { score: education, weight: 0.25 },
      { score: occupation, weight: 0.20 },
    ]);

    const strengths = [];
    const watchOuts = [];
    if (religion !== null) {
      if (religion >= 85) strengths.push('You gave the same answer on faith (' + a.background.religion + '), which removes one of the harder long-term negotiations.');
      else if (religion < 55) watchOuts.push(a.name + ' answered ' + a.background.religion + ' on faith and ' + b.name + ' answered ' + b.background.religion + '. ' + (romantic ? 'Worth establishing early how much of daily life, family expectation and any future children this touches.' : 'Rarely a problem in a friendship, but be aware you are reasoning from different first principles.'));
    }
    if (romantic && kids !== null) {
      if (kids >= 90) strengths.push('You want the same thing on children — ' + (a.habits.kids === 'Yes' ? 'both of you want them' : 'neither of you does') + '. That is the single biggest fork in a long relationship and you are on the same side of it.');
      else if (kids < 30) watchOuts.push('One of you wants children and the other does not. Nothing else in this report matters as much as that; it is not a compromise problem, it is a decision.');
      else watchOuts.push('At least one of you is unsure about children. Fine for now, worth a real conversation before this gets serious.');
    }
    if (sameCountry) strengths.push('Same country, so shared reference points and no distance problem to solve.');
    else if (a.background.country && b.background.country) {
      watchOuts.push(a.name + ' is from ' + a.background.country + ' and ' + b.name + ' from ' + b.background.country + ' — different defaults about family, money and how directly people say things.');
    }

    return { score, strengths, watchOuts };
  }

  // ---------- 5. love languages ----------

  function loveFit(giver, receiver) {
    const give = giver.loveGive || [];
    const want = receiver.loveReceive || [];
    if (!give.length || !want.length) return { score: null, hits: [], misses: want.slice() };
    const giveSet = new Set(give);
    const hits = want.filter(x => giveSet.has(x));
    const misses = want.filter(x => !giveSet.has(x));
    return { score: pct(25 + (hits.length / want.length) * 75), hits, misses };
  }

  function loveDimension(a, b, mode) {
    const aToB = loveFit(a, b);
    const bToA = loveFit(b, a);
    const scores = [aToB.score, bToA.score].filter(s => s !== null);
    const score = scores.length ? pct(scores.reduce((x, y) => x + y, 0) / scores.length) : 50;

    const strengths = [];
    const watchOuts = [];
    const noun = mode === 'romantic' ? 'love' : 'care';

    for (const [giver, receiver, fit] of [[a, b, aToB], [b, a, bToA]]) {
      if (fit.score === null) continue;
      if (fit.hits.length) {
        strengths.push(giver.name + ' naturally shows ' + noun + ' through ' + humanList(fit.hits.map(lower)) +
          ', which is exactly how ' + receiver.name + ' likes to receive it.');
      }
      if (fit.misses.length) {
        watchOuts.push(receiver.name + ' feels most cared for through ' + humanList(fit.misses.map(lower)) +
          ' — not something ' + giver.name + ' reaches for by default. This one has to be done deliberately, because it will never happen by accident.');
      }
    }
    return { score, strengths, watchOuts, aToB, bToA };
  }

  // ---------- 6. shared interests ----------

  const IG_AFFINITY_KEYS = [
    { key: 'travel', label: 'travel' },
    { key: 'fitnessIndex', label: 'training and fitness' },
    { key: 'nightlife', label: 'nightlife' },
    { key: 'creator', label: 'art, music and image-making' },
    { key: 'outdoors', label: 'the outdoors' },
    { key: 'family', label: 'family life' },
    { key: 'faith', label: 'faith' },
  ];

  function igAffinity(a, b) {
    const rows = [];
    let sum = 0;
    let weight = 0;
    for (const item of IG_AFFINITY_KEYS) {
      const x = (a.ig && a.ig[item.key]) || 0;
      const y = (b.ig && b.ig[item.key]) || 0;
      const salience = Math.max(x, y) / 100;
      if (salience < 0.3) continue;
      const match = 100 - Math.abs(x - y);
      sum += match * salience;
      weight += salience;
      rows.push({ label: item.label, a: x, b: y, match });
    }
    return { score: weight ? pct(sum / weight) : null, rows };
  }

  function interestsDimension(a, b) {
    const interests = listOverlap(a.interests, b.interests);
    const fitness = listOverlap(a.fitness, b.fitness);
    const affinity = igAffinity(a, b);

    const score = weighted([
      { score: interests.known ? interests.score : null, weight: 0.42 },
      { score: fitness.known ? fitness.score : null, weight: 0.30 },
      { score: affinity.score, weight: 0.28 },
    ]);

    const strengths = [];
    const watchOuts = [];
    if (interests.shared.length) strengths.push('Shared interests: ' + humanList(interests.shared.map(lower)) + '.');
    if (fitness.shared.length) strengths.push('You both do ' + humanList(fitness.shared.map(lower)) + ' — a ready-made standing plan.');
    if (!interests.shared.length && !fitness.shared.length) {
      watchOuts.push('No overlap at all in the activities you each picked. You will have to build a shared world rather than inherit one — pick one thing each of you loves and take the other to it.');
    }
    const strongAffinity = affinity.rows.filter(r => r.match >= 75);
    if (strongAffinity.length) {
      strengths.push('Your Instagram activity points the same way on ' + humanList(strongAffinity.map(r => r.label)) + '.');
    }
    const divergent = affinity.rows.filter(r => r.match < 45);
    for (const row of divergent) {
      const keener = (a.ig[keyFor(row.label)] || 0) > (b.ig[keyFor(row.label)] || 0) ? a : b;
      const other = keener === a ? b : a;
      watchOuts.push(keener.name + '\'s life visibly revolves around ' + row.label + ' in a way ' + other.name + '\'s does not.');
    }

    return { score, strengths, watchOuts, shared: { interests: interests.shared, fitness: fitness.shared }, affinity: affinity.rows };
  }

  function keyFor(label) {
    const found = IG_AFFINITY_KEYS.find(k => k.label === label);
    return found ? found.key : '';
  }

  // ---------- 7. lifestyle rhythm ----------

  const CONFLICT_PAIRS = {
    'Talk it out now|Talk it out now': { score: 88, note: 'You both want it resolved now. Fast repairs, occasionally hot ones.' },
    'Cool off, then talk|Talk it out now': { score: 74, note: 'One wants it settled immediately, the other needs to cool off first. Agree a number — twenty minutes, an hour — so the pause is a promise instead of a stonewall.' },
    'Avoid confrontation|Talk it out now': { score: 46, note: 'One of you goes toward conflict and the other away from it. Left alone this becomes pursue-and-hide; the fix is a standing agreement that difficult things get raised at a set time, not in the moment.' },
    'Cool off, then talk|Cool off, then talk': { score: 90, note: 'You both take space before talking, so nothing gets said in the heat. Just make sure the return conversation actually happens.' },
    'Avoid confrontation|Cool off, then talk': { score: 62, note: 'Both of you retreat first, and one of you may never come back to it. Someone has to be the one who reopens the subject.' },
    'Avoid confrontation|Avoid confrontation': { score: 44, note: 'Neither of you raises hard things. This feels wonderfully peaceful and quietly accumulates — schedule the awkward conversations, because you will not have them spontaneously.' },
  };

  function lifestyleDimension(a, b, mode) {
    const chronotype = ordinalMatch(['Early bird', 'Flexible', 'Night owl'], a.rhythm.chronotype, b.rhythm.chronotype, [100, 76, 46]);
    const social = ordinalMatch(['Out and social', 'A bit of both', 'Quiet at home'], a.rhythm.social_energy, b.rhythm.social_energy, [100, 78, 50]);
    const planning = ordinalMatch(['Planned ahead', 'Loose plans', 'Spontaneous'], a.rhythm.planning, b.rhythm.planning, [95, 78, 52]);
    const conflictKey = [a.rhythm.conflict, b.rhythm.conflict].sort().join('|');
    const conflict = CONFLICT_PAIRS[conflictKey] || null;
    const igPace = (a.ig && b.ig) ? pct(100 - 0.5 * Math.abs((a.ig.activity || 0) - (b.ig.activity || 0))) : null;

    const score = weighted([
      { score: chronotype, weight: 0.18 },
      { score: social, weight: 0.22 },
      { score: planning, weight: 0.18 },
      { score: conflict ? conflict.score : null, weight: mode === 'romantic' ? 0.30 : 0.24 },
      { score: igPace, weight: 0.12 },
    ]);

    const strengths = [];
    const watchOuts = [];
    if (chronotype !== null) {
      if (chronotype >= 95) strengths.push('Same body clock — ' + lower(a.rhythm.chronotype) + 's, both of you.');
      else if (chronotype < 60) {
        const first = lower(a.rhythm.chronotype);
        const second = lower(b.rhythm.chronotype);
        watchOuts.push('Opposite body clocks: ' + a.name + ' is ' + article(first) + ' ' + first + ' and ' +
          b.name + ' ' + article(second) + ' ' + second + '. Protect the hours you actually overlap instead of hoping they appear.');
      }
    }
    if (social !== null && social < 60) {
      watchOuts.push('Very different ideas of a good weekend — ' + lower(a.rhythm.social_energy) + ' versus ' + lower(b.rhythm.social_energy) + '.');
    } else if (social !== null && social >= 95) {
      strengths.push('You want the same kind of weekend, which removes a surprising amount of friction.');
    }
    if (planning !== null && planning < 60) {
      watchOuts.push('One of you plans ahead and the other prefers to decide on the day.');
    }
    if (conflict) (conflict.score >= 70 ? strengths : watchOuts).push(conflict.note);

    return { score, strengths, watchOuts, conflictNote: conflict ? conflict.note : '' };
  }

  // ---------- 8. dealbreakers ----------

  // Only habits a person has declared about themselves are checked. Nothing
  // here is inferred from who someone follows or what they look like.
  const DEALBREAKER_RULES = {
    Smoking: { habit: 'smoking', hard: ['Regularly'], soft: ['Socially'] },
    Drinking: { habit: 'drinking', hard: ['Regularly'], soft: ['Socially'] },
    Gambling: { habit: 'gambling', hard: ['Regularly'], soft: ['Occasionally'] },
    'Irresponsible spending': { habit: 'spending', hard: [], soft: ['Spender'] },
    'Having too many friends of the opposite gender': { habit: 'opposite_friends', hard: [], soft: ['Many'] },
  };

  const UNCHECKABLE = {
    Infidelity: 'Nothing in a profile predicts this. It belongs in a conversation about expectations and exclusivity.',
    'Anger issues': 'Not visible in any data here — you will only learn this by seeing them under stress.',
    Drugs: 'Not asked and not inferred. Raise it directly if it matters to you.',
    'Following IG models': 'Kindred deliberately does not classify who someone follows by how they look. If this matters to you, ask.',
    Others: 'You listed something outside the standard list — check it yourself.',
  };

  function dealbreakerDimension(a, b) {
    const hard = [];
    const soft = [];
    const toDiscuss = [];
    let score = 100;

    for (const [holder, subject] of [[a, b], [b, a]]) {
      for (const item of holder.dealbreakers || []) {
        const rule = DEALBREAKER_RULES[item];
        if (!rule) {
          if (UNCHECKABLE[item]) toDiscuss.push({ holder: holder.name, item, note: UNCHECKABLE[item] });
          continue;
        }
        const value = (subject.habits || {})[rule.habit];
        if (!value) continue;
        if (rule.hard.includes(value)) {
          hard.push({ holder: holder.name, subject: subject.name, item, value });
          score -= 35;
        } else if (rule.soft.includes(value)) {
          soft.push({ holder: holder.name, subject: subject.name, item, value });
          score -= 14;
        }
      }
    }

    const strengths = [];
    const watchOuts = [];
    if (!hard.length && !soft.length) {
      strengths.push('Nothing either of you named as a dealbreaker shows up in the other\'s declared habits.');
    }
    for (const flag of hard) {
      watchOuts.push(flag.holder + ' lists ' + lower(flag.item) + ' as a dealbreaker, and ' + flag.subject +
        ' has declared it as "' + lower(flag.value) + '". Treat this as decisive rather than negotiable.');
    }
    for (const flag of soft) {
      watchOuts.push(flag.holder + ' lists ' + lower(flag.item) + ' as a dealbreaker; ' + flag.subject +
        ' declared "' + lower(flag.value) + '". Probably survivable, definitely worth naming.');
    }

    return { score: pct(score), strengths, watchOuts, hard, soft, toDiscuss };
  }

  // ---------- assembling a mode ----------

  const DIMENSION_META = {
    values: { label: 'Values & life priorities', romantic: 0.20, platonic: 0.16 },
    personality: { label: 'Personality fit', romantic: 0.18, platonic: 0.20 },
    attachment: { label: 'Attachment & emotional safety', romantic: 0.14, platonic: 0.08 },
    love: { label: 'How you give and receive care', romantic: 0.12, platonic: 0.09 },
    interests: { label: 'Shared interests & activities', romantic: 0.11, platonic: 0.24 },
    worldview: { label: 'Background & worldview', romantic: 0.10, platonic: 0.06 },
    lifestyle: { label: 'Rhythm & conflict style', romantic: 0.08, platonic: 0.12 },
    dealbreakers: { label: 'Dealbreakers', romantic: 0.07, platonic: 0.05 },
  };

  const ROMANTIC_BANDS = [
    { min: 85, band: 'Rare', verdict: 'This is an unusually good fit on paper. The things that normally break a relationship — life direction, emotional safety, how you each handle conflict — are all pointing the same way.' },
    { min: 72, band: 'Strong', verdict: 'A strong match. The foundations are solid and the friction points below are the ordinary kind that get resolved by talking about them once.' },
    { min: 60, band: 'Promising', verdict: 'Promising, with real work attached. There is genuine common ground here, and at least one difference that will need explicit handling rather than hope.' },
    { min: 48, band: 'Workable', verdict: 'Workable but effortful. You are different in ways that matter, so this depends much more than usual on both of you being deliberate.' },
    { min: 0, band: 'Hard going', verdict: 'The gaps here are structural rather than stylistic. Chemistry can carry this for a while; the items below are what it would run into.' },
  ];

  const PLATONIC_BANDS = [
    { min: 85, band: 'Natural', verdict: 'You would probably become close friends without anyone engineering it — enough shared ground to always have something to do, and compatible enough temperaments to make it easy.' },
    { min: 72, band: 'Strong', verdict: 'A strong friendship fit. You have obvious shared territory and no serious clashes of temperament.' },
    { min: 60, band: 'Good', verdict: 'A good friendship with a bit of intent behind it. You overlap in some places and not others, which is usually what keeps a friendship interesting.' },
    { min: 48, band: 'Occasional', verdict: 'More the occasional-catch-up kind of friendship than the every-week kind. You will need a shared context — a sport, a group, a project — to keep it alive.' },
    { min: 0, band: 'Distant', verdict: 'Not much natural overlap. Perfectly pleasant, unlikely to deepen on its own.' },
  ];

  function bandFor(score, bands) {
    return bands.find(b => score >= b.min) || bands[bands.length - 1];
  }

  function buildMode(a, b, mode) {
    const dims = {
      values: valuesDimension(a, b),
      personality: personalityDimension(a, b, mode),
      attachment: attachmentDimension(a, b, mode),
      love: loveDimension(a, b, mode),
      interests: interestsDimension(a, b),
      worldview: worldviewDimension(a, b, mode),
      lifestyle: lifestyleDimension(a, b, mode),
      dealbreakers: dealbreakerDimension(a, b),
    };

    const dimensions = Object.keys(DIMENSION_META).map(id => ({
      id,
      label: DIMENSION_META[id].label,
      weight: DIMENSION_META[id][mode],
      score: dims[id].score,
      strengths: dims[id].strengths,
      watchOuts: dims[id].watchOuts,
    }));

    const total = pct(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
    const bands = mode === 'romantic' ? ROMANTIC_BANDS : PLATONIC_BANDS;
    const banding = bandFor(total, bands);

    return {
      mode,
      total,
      band: banding.band,
      verdict: banding.verdict,
      dimensions,
      strengths: dimensions.flatMap(d => d.strengths).filter(Boolean),
      watchOuts: dimensions.flatMap(d => d.watchOuts).filter(Boolean),
      raw: dims,
    };
  }

  // ---------- how to partner each other ----------

  function buildPlaybook(a, b, mode, dims) {
    const romantic = mode === 'romantic';
    const forA = [];
    const forB = [];
    const shared = [];

    // Love-language translation, in both directions.
    const pairs = [
      { giver: a, receiver: b, fit: dims.love.aToB, bucket: forA },
      { giver: b, receiver: a, fit: dims.love.bToA, bucket: forB },
    ];
    for (const p of pairs) {
      if (p.fit.misses && p.fit.misses.length) {
        p.bucket.push('Show up for ' + p.receiver.name + ' through ' + humanList(p.fit.misses.map(lower)) +
          '. It is not your instinct, so put it on purpose — that is the single highest-leverage thing you can do for them.');
      } else if (p.fit.hits && p.fit.hits.length) {
        p.bucket.push('Keep doing what you already do: ' + humanList(p.fit.hits.map(lower)) + ' lands exactly right with ' + p.receiver.name + '.');
      }
    }

    // Attachment: what each person should give and what they should ask for.
    forA.push(ATTACHMENT_ADVICE[a.attachment].give.replace(/^(\w)/, m => m.toUpperCase()) +
      ' (' + b.name + ' is ' + lower(ATTACHMENT_LABELS[b.attachment]) + '; you are ' + lower(ATTACHMENT_LABELS[a.attachment]) + '.)');
    forA.push('For yourself: ' + lower(ATTACHMENT_ADVICE[a.attachment].need));
    forB.push(ATTACHMENT_ADVICE[b.attachment].give.replace(/^(\w)/, m => m.toUpperCase()) +
      ' (' + a.name + ' is ' + lower(ATTACHMENT_LABELS[a.attachment]) + '; you are ' + lower(ATTACHMENT_LABELS[b.attachment]) + '.)');
    forB.push('For yourself: ' + lower(ATTACHMENT_ADVICE[b.attachment].need));

    // Personality gaps, aimed at whichever person needs to move.
    const gap = (trait) => a.bigFive[trait] - b.bigFive[trait];
    if (Math.abs(gap('extraversion')) >= 25) {
      const outgoing = gap('extraversion') > 0 ? a : b;
      const quiet = outgoing === a ? b : a;
      (outgoing === a ? forA : forB).push('Do not read ' + quiet.name + '\'s need to leave early as a lack of interest — it is a battery, not a verdict.');
      (quiet === a ? forA : forB).push('Say your limit up front rather than enduring and resenting it: "I am good for two hours" is kind, not rude.');
    }
    if (Math.abs(gap('conscientiousness')) >= 25) {
      const planner = gap('conscientiousness') > 0 ? a : b;
      const improviser = planner === a ? b : a;
      (planner === a ? forA : forB).push('Say which plans are load-bearing and let ' + improviser.name + ' be loose about the rest.');
      (improviser === a ? forA : forB).push('When ' + planner.name + ' asks for a decision early, it is not control — it is how they stop worrying.');
    }
    if (Math.abs(gap('neuroticism')) >= 22) {
      const sensitive = gap('neuroticism') > 0 ? a : b;
      const steady = sensitive === a ? b : a;
      (steady === a ? forA : forB).push('Ask ' + sensitive.name + ' "comfort or solutions?" before you offer either.');
      (sensitive === a ? forA : forB).push('Tell ' + steady.name + ' what you need out loud; their calm is not indifference, but they will not guess.');
    }
    if (Math.abs(gap('openness')) >= 25) {
      const curious = gap('openness') > 0 ? a : b;
      const grounded = curious === a ? b : a;
      (curious === a ? forA : forB).push('Give ' + grounded.name + ' notice before the next new thing rather than sprung surprises.');
      (grounded === a ? forA : forB).push('Say yes to one of ' + curious.name + '\'s ideas a month without negotiating it.');
    }

    // Shared, practical, mode-specific. The conflict note is already actionable
    // advice, so carry it here only when it was not surfaced as a watch-out.
    if (dims.lifestyle.conflictNote && !dims.lifestyle.watchOuts.includes(dims.lifestyle.conflictNote)) {
      shared.push(dims.lifestyle.conflictNote);
    }
    const sharedActivities = dims.interests.shared.interests.concat(dims.interests.shared.fitness);
    if (sharedActivities.length) {
      shared.push((romantic ? 'Your default plan together' : 'The thing that will keep this friendship alive') +
        ': ' + humanList(sharedActivities.map(lower)) + '. Make one of them a standing fixture rather than an occasional idea.');
    } else {
      shared.push(romantic
        ? 'You have no shared activity to fall back on, so build one deliberately in the first month — a class, a sport, a weekly thing that belongs to the two of you.'
        : 'Without a shared activity this friendship will need a calendar. Put something recurring in it or you will drift.');
    }
    if (dims.values.shared.priorities.length) {
      shared.push('Lean on what you already agree on: ' + humanList(dims.values.shared.priorities.map(lower)) + '.');
    }
    if (romantic) {
      const kids = kidsScore(a, b);
      if (kids !== null && kids < 70) shared.push('Have the children conversation properly and early. Do not let it ride.');
    }
    if (dims.dealbreakers.toDiscuss.length) {
      shared.push('Some of the dealbreakers you each named cannot be checked from any profile — ' +
        humanList(Array.from(new Set(dims.dealbreakers.toDiscuss.map(t => lower(t.item)))) ) + '. Ask, do not assume.');
    }

    return { forA, forB, shared };
  }

  // ---------- conversation starters ----------

  function conversationStarters(a, b, dims) {
    const out = [];
    for (const interest of dims.interests.shared.interests.slice(0, 2)) {
      out.push('You both picked ' + lower(interest) + ' — what got you into it?');
    }
    for (const activity of dims.interests.shared.fitness.slice(0, 1)) {
      out.push('Compare notes on ' + lower(activity) + ' and find a session you can both make.');
    }
    for (const priority of dims.values.shared.priorities.slice(0, 1)) {
      out.push('You both put ' + lower(priority) + ' in your top three. Ask what that actually looks like day to day for them.');
    }
    const uniqueA = (a.interests || []).filter(x => !(b.interests || []).includes(x))[0];
    if (uniqueA) out.push(b.name + ': ask ' + a.name + ' about ' + lower(uniqueA) + ' — it is theirs, not yours.');
    const uniqueB = (b.interests || []).filter(x => !(a.interests || []).includes(x))[0];
    if (uniqueB) out.push(a.name + ': ask ' + b.name + ' about ' + lower(uniqueB) + '.');
    if (a.mbti && b.mbti) out.push('You typed yourselves ' + a.mbti + ' and ' + b.mbti + ' — compare how much either of you actually believes it.');
    return out.slice(0, 6);
  }

  // ---------- text helpers ----------

  function lower(text) {
    const s = String(text || '');
    // Keep acronyms and proper-ish nouns intact when lowering a label.
    return /^[A-Z]{2,}$/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
  }

  // "a early bird" is the kind of thing that makes generated prose read as
  // generated prose.
  function article(word) {
    return /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
  }

  function humanList(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  // ---------- entry point ----------

  /**
   * Full two-mode compatibility report for a pair of decoded profiles.
   * @param {object} a  the scanner's own profile
   * @param {object} b  the profile from the scanned QR code
   */
  function buildReport(a, b) {
    const romantic = buildMode(a, b, 'romantic');
    const platonic = buildMode(a, b, 'platonic');

    romantic.playbook = buildPlaybook(a, b, 'romantic', romantic.raw);
    platonic.playbook = buildPlaybook(a, b, 'platonic', platonic.raw);

    const confidence = Math.min(
      (a.ig && a.ig.confidence) || 0,
      (b.ig && b.ig.confidence) || 0
    );

    return {
      generatedAt: new Date().toISOString(),
      a: { name: a.name, attachment: a.attachment, mbti: a.mbti, bigFive: a.bigFive },
      b: { name: b.name, attachment: b.attachment, mbti: b.mbti, bigFive: b.bigFive },
      romantic,
      platonic,
      flags: {
        hard: romantic.raw.dealbreakers.hard,
        soft: romantic.raw.dealbreakers.soft,
        toDiscuss: romantic.raw.dealbreakers.toDiscuss,
      },
      shared: {
        interests: romantic.raw.interests.shared.interests,
        fitness: romantic.raw.interests.shared.fitness,
        priorities: romantic.raw.values.shared.priorities,
        ingredients: romantic.raw.values.shared.ingredients,
      },
      attachmentNote: romantic.raw.attachment.note,
      conversationStarters: conversationStarters(a, b, romantic.raw),
      dataConfidence: confidence,
    };
  }

  root.KindredCompat = {
    buildReport, DIMENSION_META, ATTACHMENT_LABELS, ATTACHMENT_PAIRS,
    humanList, lower, article,
  };
})(typeof window !== 'undefined' ? window : globalThis);
