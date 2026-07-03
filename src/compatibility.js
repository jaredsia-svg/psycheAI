// Romantic compatibility engine.
//
// Blends six research-informed dimensions into a 0-100 score and generates a
// written assessment with concrete "how to partner each other" advice.
//
// Weights (sum = 100):
//   values alignment       25  — shared values predict long-term satisfaction
//   personality fit        30  — similarity on A/C/O helps; combined low
//                                neuroticism helps; extraversion can complement
//   attachment pairing     15  — secure pairs easiest; anxious+avoidant hardest
//   shared interests       15  — Jaccard overlap of interest tags
//   love-language match    10  — do they naturally speak each other's language
//   lifestyle rhythm        5  — chronotype, social energy, planning, conflict

const { VALUES, LOVE_LANGUAGES } = require('./questionnaire');

const WEIGHTS = { values: 25, personality: 30, attachment: 15, interests: 15, loveLanguage: 10, lifestyle: 5 };

function similarity100(a, b) { return 100 - Math.abs(a - b); }

function scoreValues(a, b) {
  // Mean per-value closeness on the 1-5 importance scale, emphasising values
  // either person rated 4+ (mismatches on things nobody cares about are cheap).
  let weighted = 0, weightSum = 0;
  const shared = [], clashes = [];
  for (const v of VALUES) {
    const va = a.values[v.id] ?? 3, vb = b.values[v.id] ?? 3;
    const importance = Math.max(va, vb); // 1-5
    const closeness = 1 - Math.abs(va - vb) / 4; // 0-1
    weighted += closeness * importance;
    weightSum += importance;
    if (va >= 4 && vb >= 4) shared.push(v.label);
    if (Math.abs(va - vb) >= 3) clashes.push(v.label);
  }
  return { score: Math.round((weighted / weightSum) * 100), shared, clashes };
}

function scorePersonality(a, b) {
  const A = a.bigFive, B = b.bigFive;
  const parts = {
    // Similarity is protective on these three.
    agreeableness: similarity100(A.agreeableness, B.agreeableness),
    conscientiousness: similarity100(A.conscientiousness, B.conscientiousness),
    openness: similarity100(A.openness, B.openness),
    // Emotional stability: what matters most is that the *pair* average is calm.
    stability: 100 - (A.neuroticism + B.neuroticism) / 2,
    // Extraversion: both similarity and mild complementarity work; only score
    // low when the gap is extreme.
    extraversion: 100 - Math.max(0, Math.abs(A.extraversion - B.extraversion) - 30) * 1.4,
  };
  const score = Math.round(
    parts.agreeableness * 0.25 + parts.conscientiousness * 0.2 +
    parts.openness * 0.2 + parts.stability * 0.25 + parts.extraversion * 0.1
  );
  return { score: Math.min(100, Math.max(0, score)), parts };
}

// Keys are the two styles sorted alphabetically and joined with '|'.
const ATTACHMENT_PAIR_SCORES = {
  'secure|secure': 95, 'anxious|secure': 78, 'avoidant|secure': 75, 'fearful|secure': 65,
  'anxious|anxious': 60, 'anxious|avoidant': 40, 'anxious|fearful': 45,
  'avoidant|avoidant': 55, 'avoidant|fearful': 45, 'fearful|fearful': 40,
};

function scoreAttachment(a, b) {
  const key = [a.attachment.style, b.attachment.style].sort().join('|');
  return { score: ATTACHMENT_PAIR_SCORES[key] ?? 55, styles: [a.attachment.style, b.attachment.style] };
}

function scoreInterests(intA, intB) {
  const setA = new Set(intA), setB = new Set(intB);
  const shared = [...setA].filter(x => setB.has(x));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return { score: 50, shared: [] };
  // Jaccard is harsh for long tag lists; smooth it so a handful of genuine
  // shared interests still scores well.
  const jaccard = shared.length / union.size;
  const score = Math.round(Math.min(1, jaccard * 2.2 + shared.length * 0.06) * 100);
  return { score, shared };
}

function scoreLoveLanguages(a, b) {
  const la = a.loveLanguages || [], lb = b.loveLanguages || [];
  if (!la.length || !lb.length) return { score: 50, overlap: [] };
  const overlap = la.filter(x => lb.includes(x));
  return { score: overlap.length >= 2 ? 100 : overlap.length === 1 ? 75 : 45, overlap };
}

function scoreLifestyle(a, b) {
  const la = a.lifestyle, lb = b.lifestyle;
  let pts = 0, total = 0;
  const notes = [];
  const pairs = [
    ['ls_chrono', 'daily rhythm'], ['ls_social', 'social energy'],
    ['ls_plan', 'planning style'], ['ls_conflict', 'conflict style'],
  ];
  for (const [id, label] of pairs) {
    total += 1;
    if (la[id] === lb[id]) pts += 1;
    else if (la[id] === 'mix' || lb[id] === 'mix' || la[id] === 'flex' || lb[id] === 'flex' || la[id] === 'cool' || lb[id] === 'cool') pts += 0.6;
    else { pts += 0.2; notes.push(label); }
  }
  return { score: Math.round((pts / total) * 100), mismatches: notes };
}

function band(score) {
  if (score >= 85) return { label: 'Exceptional match', emoji: '💞' };
  if (score >= 70) return { label: 'Strong potential', emoji: '💖' };
  if (score >= 55) return { label: 'Promising with effort', emoji: '💛' };
  if (score >= 40) return { label: 'Challenging but possible', emoji: '🧩' };
  return { label: 'An uphill pairing', emoji: '⛰️' };
}

const LL_LABEL = Object.fromEntries(LOVE_LANGUAGES.map(l => [l.id, l.label.toLowerCase()]));

// Keys are the two styles sorted alphabetically and joined with '|'.
const ATTACHMENT_ADVICE = {
  'anxious|avoidant': 'This is the classic pursue-withdraw pairing: one of you seeks closeness under stress while the other seeks space. Agree on a signal for "I need a moment, and I am coming back" — the returning part is what calms the anxious side.',
  'anxious|anxious': 'You both feel worry in the gaps. Over-communicate reassurance early on: quick check-in texts and clear plans go a long way for both of you.',
  'avoidant|avoidant': 'You will respect each other\'s independence, but intimacy may stall by default. Put connection on the calendar — a weekly, phones-down date — so closeness doesn\'t depend on either of you initiating spontaneously.',
  'anxious|secure': 'The secure partner\'s consistency is the superpower here. Keep promises small and always kept; predictability slowly turns the anxious partner\'s alarm system down.',
  'avoidant|secure': 'The secure partner should invite closeness without cornering — offer, don\'t insist. The avoidant partner: say "I need space" out loud rather than just taking it.',
  'secure|secure': 'You both self-regulate well and repair quickly after friction. Your risk is complacency, not conflict — keep dating each other.',
  'anxious|fearful': 'Both of you can spiral when things feel uncertain. Name feelings early ("I\'m feeling wobbly about us today") before they become fights about something else.',
  'avoidant|fearful': 'Both of you retreat under stress, from different fears. Agree that silence never means the relationship is in danger, and set a time to reconnect after space.',
  'fearful|secure': 'Steadiness plus patience wins here. Secure partner: be boringly reliable. Fearful partner: let them see one small vulnerable thing at a time.',
  'fearful|fearful': 'You both want closeness and fear it at once. Go slow, keep expectations explicit, and consider talking through past patterns with someone you trust.',
};

function buildReport(nameA, nameB, tA, tB, intA, intB) {
  const values = scoreValues(tA, tB);
  const personality = scorePersonality(tA, tB);
  const attachment = scoreAttachment(tA, tB);
  const interests = scoreInterests(intA, intB);
  const loveLang = scoreLoveLanguages(tA, tB);
  const lifestyle = scoreLifestyle(tA, tB);

  const total = Math.round(
    (values.score * WEIGHTS.values + personality.score * WEIGHTS.personality +
      attachment.score * WEIGHTS.attachment + interests.score * WEIGHTS.interests +
      loveLang.score * WEIGHTS.loveLanguage + lifestyle.score * WEIGHTS.lifestyle) / 100
  );

  const strengths = [];
  const watchouts = [];
  const advice = [];

  // --- Values ---
  if (values.shared.length) {
    strengths.push(`You both hold ${listify(values.shared.slice(0, 3))} as core values — this is the strongest long-term glue a couple can have.`);
  }
  if (values.clashes.length) {
    watchouts.push(`You differ sharply on ${listify(values.clashes)}. This won't matter on date three, but it will in year three — talk about it honestly and early.`);
    advice.push(`On ${listify(values.clashes)}: don't try to convert each other. Ask "what does this give you?" and look for arrangements that let each of you honour what matters most.`);
  }

  // --- Personality ---
  const p = personality.parts;
  if (p.stability >= 70) strengths.push('Emotionally, this is a calm pairing — neither of you tends to escalate, so disagreements should stay proportionate.');
  else if (p.stability < 45) {
    watchouts.push('Both of you feel stress strongly, so tense moments can amplify each other.');
    advice.push('Adopt a shared rule: when either of you says "pause", you take 20 minutes apart and then resume. Never problem-solve at peak stress.');
  }
  const extraGap = Math.abs(tA.bigFive.extraversion - tB.bigFive.extraversion);
  if (extraGap > 45) {
    const social = tA.bigFive.extraversion > tB.bigFive.extraversion ? nameA : nameB;
    const quiet = social === nameA ? nameB : nameA;
    watchouts.push(`${social} recharges with people while ${quiet} recharges alone — a real but very manageable difference.`);
    advice.push(`${social}: it's fine to go to that party solo sometimes. ${quiet}: join for the first hour and take the "quiet exit" pass without guilt. Neither is rejection.`);
  } else if (extraGap <= 20) {
    strengths.push('Your social batteries drain and recharge at the same rate, so weekends will rarely be a negotiation.');
  }
  if (similarity100(tA.bigFive.openness, tB.bigFive.openness) >= 75 && tA.bigFive.openness >= 60) {
    strengths.push('You share a high appetite for novelty — new places, ideas and food will keep this relationship self-refreshing.');
  }
  if (Math.abs(tA.bigFive.conscientiousness - tB.bigFive.conscientiousness) > 45) {
    const planner = tA.bigFive.conscientiousness > tB.bigFive.conscientiousness ? nameA : nameB;
    const free = planner === nameA ? nameB : nameA;
    advice.push(`${planner} runs on structure, ${free} on flow. Split domains: ${planner} owns logistics (bookings, bills), ${free} owns spontaneity (surprise plans, keeping weekends unscripted).`);
  }

  // --- Attachment ---
  const attKey = [tA.attachment.style, tB.attachment.style].sort().join('|');
  advice.push(ATTACHMENT_ADVICE[attKey]);
  if (attKey === 'secure|secure') strengths.push('Both of you show a secure attachment pattern — the single best predictor of easy repair after conflict.');
  if (attKey === 'anxious|avoidant') watchouts.push('Your attachment styles (anxious + avoidant) are the pairing that most often traps couples in a pursue-withdraw loop. The advice below matters more than the score.');

  // --- Interests ---
  if (interests.shared.length >= 3) {
    strengths.push(`You already share real overlap in how you spend time: ${listify(interests.shared.slice(0, 4))}.`);
    advice.push(`Easy first dates are built in — start with ${interests.shared[0]} and let it do the talking.`);
  } else if (interests.shared.length > 0) {
    advice.push(`Your one clear common ground is ${listify(interests.shared)} — use it as home base while you trade tours of each other's other worlds.`);
  } else {
    watchouts.push('Your hobby worlds barely overlap today. That can be a feature — everything is a tour of a new world — but only if you\'re both curious people.');
  }

  // --- Love languages ---
  if (loveLang.overlap.length >= 1) {
    strengths.push(`You naturally speak the same love language: ${listify(loveLang.overlap.map(x => LL_LABEL[x]))}. Affection will land the way it was meant.`);
  } else if ((tA.loveLanguages || []).length && (tB.loveLanguages || []).length) {
    watchouts.push(`${nameA} feels loved through ${listify(tA.loveLanguages.map(x => LL_LABEL[x]))}, while ${nameB} feels it through ${listify(tB.loveLanguages.map(x => LL_LABEL[x]))} — love could be given and still not felt.`);
    advice.push(`Learn each other's dialect deliberately: ${nameA}, offer ${LL_LABEL[tB.loveLanguages[0]]}; ${nameB}, offer ${LL_LABEL[tA.loveLanguages[0]]}. It will feel unnatural for a month and then become the relationship's secret weapon.`);
  }

  // --- Lifestyle ---
  if (lifestyle.mismatches.length) {
    advice.push(`Practical friction points to pre-negotiate: ${listify(lifestyle.mismatches)}. Small routines (who owns mornings, how plans get made) prevent 80% of everyday squabbles.`);
  } else if (lifestyle.score >= 85) {
    strengths.push('Day-to-day rhythms — sleep, socialising, planning — line up almost perfectly. Cohabiting logistics would be easy for you two.');
  }

  const b = band(total);
  const summary =
    `${nameA} × ${nameB}: ${total}/100 — ${b.label}. ` +
    (total >= 70
      ? 'The fundamentals here are genuinely aligned; the advice below is about protecting a good thing.'
      : total >= 55
        ? 'There is a real foundation here, with a few structural differences that reward deliberate effort.'
        : 'This pairing asks both of you to work across meaningful differences — worth it only if you both enjoy the work.');

  return {
    total,
    band: b,
    summary,
    dimensions: [
      { key: 'values', label: 'Values alignment', score: values.score, weight: WEIGHTS.values },
      { key: 'personality', label: 'Personality fit', score: personality.score, weight: WEIGHTS.personality },
      { key: 'attachment', label: 'Attachment pairing', score: attachment.score, weight: WEIGHTS.attachment },
      { key: 'interests', label: 'Shared interests', score: interests.score, weight: WEIGHTS.interests },
      { key: 'loveLanguage', label: 'Love languages', score: loveLang.score, weight: WEIGHTS.loveLanguage },
      { key: 'lifestyle', label: 'Lifestyle rhythm', score: lifestyle.score, weight: WEIGHTS.lifestyle },
    ],
    sharedValues: values.shared,
    sharedInterests: interests.shared,
    attachmentStyles: { [nameA]: tA.attachment.style, [nameB]: tB.attachment.style },
    strengths: strengths.filter(Boolean),
    watchouts: watchouts.filter(Boolean),
    advice: advice.filter(Boolean),
  };
}

function listify(arr) {
  const a = arr.map(x => String(x).toLowerCase());
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

module.exports = { buildReport };
