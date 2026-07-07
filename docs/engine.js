// Kindred browser engine: questionnaire definitions, trait scoring,
// social-text analysis, profile payload encode/decode, and the
// compatibility report generator. Mirrors the server implementation in
// src/, adapted to run entirely client-side.
(function () {
  'use strict';

  // ---------- questionnaire definitions ----------

  const LIKERT = [1, 2, 3, 4, 5];

  const BIG_FIVE_ITEMS = [
    { id: 'bf_e1', trait: 'extraversion', reverse: false, text: 'I am outgoing and sociable.' },
    { id: 'bf_e2', trait: 'extraversion', reverse: true, text: 'I tend to be quiet and reserved.' },
    { id: 'bf_a1', trait: 'agreeableness', reverse: false, text: 'I am considerate and kind to almost everyone.' },
    { id: 'bf_a2', trait: 'agreeableness', reverse: true, text: 'I can be cold and distant with people.' },
    { id: 'bf_c1', trait: 'conscientiousness', reverse: false, text: 'I make plans and follow through with them.' },
    { id: 'bf_c2', trait: 'conscientiousness', reverse: true, text: 'I tend to be disorganised.' },
    { id: 'bf_n1', trait: 'neuroticism', reverse: false, text: 'I get stressed or worried easily.' },
    { id: 'bf_n2', trait: 'neuroticism', reverse: true, text: 'I stay calm under pressure.' },
    { id: 'bf_o1', trait: 'openness', reverse: false, text: 'I am curious and love trying new things.' },
    { id: 'bf_o2', trait: 'openness', reverse: true, text: 'I prefer familiar routines over new experiences.' },
  ];

  const ATTACHMENT_ITEMS = [
    { id: 'at_x1', dim: 'anxiety', text: 'I worry that people I care about will leave me.' },
    { id: 'at_x2', dim: 'anxiety', text: 'I need frequent reassurance that my partner cares.' },
    { id: 'at_v1', dim: 'avoidance', text: 'I find it hard to fully open up to a partner.' },
    { id: 'at_v2', dim: 'avoidance', text: 'I prefer to handle problems on my own rather than lean on someone.' },
  ];

  const VALUES = [
    { id: 'family', label: 'Family & long-term commitment' },
    { id: 'career', label: 'Career & ambition' },
    { id: 'adventure', label: 'Adventure & travel' },
    { id: 'stability', label: 'Financial stability & security' },
    { id: 'spirituality', label: 'Spirituality / faith' },
    { id: 'health', label: 'Health & fitness' },
    { id: 'creativity', label: 'Creativity & the arts' },
    { id: 'community', label: 'Community & giving back' },
  ];

  const LOVE_LANGUAGES = [
    { id: 'words', label: 'Words of affirmation' },
    { id: 'time', label: 'Quality time' },
    { id: 'gifts', label: 'Thoughtful gifts' },
    { id: 'acts', label: 'Acts of service' },
    { id: 'touch', label: 'Physical touch' },
  ];

  const LIFESTYLE = [
    { id: 'ls_chrono', text: 'Your natural rhythm:', options: [
      { value: 'early', label: 'Early bird' }, { value: 'flex', label: 'Flexible' }, { value: 'night', label: 'Night owl' }] },
    { id: 'ls_social', text: 'Your ideal weekend:', options: [
      { value: 'out', label: 'Out with friends / events' }, { value: 'mix', label: 'A bit of both' }, { value: 'home', label: 'Quiet time at home' }] },
    { id: 'ls_plan', text: 'When it comes to plans:', options: [
      { value: 'planner', label: 'I plan everything ahead' }, { value: 'mix', label: 'Loose plans, open to change' }, { value: 'spont', label: 'Fully spontaneous' }] },
    { id: 'ls_conflict', text: 'In a disagreement I usually:', options: [
      { value: 'talk', label: 'Talk it through right away' }, { value: 'cool', label: 'Cool off first, then talk' }, { value: 'avoid', label: 'Avoid confrontation' }] },
  ];

  const INTEREST_TAGS = [
    'travel', 'foodie', 'fitness', 'yoga', 'running', 'hiking', 'photography',
    'music', 'live gigs', 'movies', 'gaming', 'reading', 'writing', 'art',
    'cooking', 'baking', 'coffee', 'wine', 'dancing', 'fashion', 'tech',
    'startups', 'investing', 'volunteering', 'pets', 'dogs', 'cats',
    'nature', 'beach', 'skiing', 'football', 'basketball', 'tennis', 'golf',
    'meditation', 'languages', 'history', 'science', 'anime', 'board games',
  ];

  // ---------- trait scoring ----------

  function clampLikert(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
  }

  function classifyAttachment(anxiety, avoidance) {
    return anxiety < 50 && avoidance < 50 ? 'secure'
      : anxiety >= 50 && avoidance < 50 ? 'anxious'
        : anxiety < 50 && avoidance >= 50 ? 'avoidant'
          : 'fearful';
  }

  function scoreAnswers(answers) {
    const traits = { bigFive: {}, attachment: {}, values: {}, loveLanguages: [], lifestyle: {} };

    const sums = {};
    for (const item of BIG_FIVE_ITEMS) {
      let v = clampLikert(answers[item.id]);
      if (item.reverse) v = 6 - v;
      (sums[item.trait] = sums[item.trait] || []).push(v);
    }
    for (const trait of Object.keys(sums)) {
      const vals = sums[trait];
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      traits.bigFive[trait] = Math.round(((mean - 1) / 4) * 100);
    }

    const att = { anxiety: [], avoidance: [] };
    for (const item of ATTACHMENT_ITEMS) att[item.dim].push(clampLikert(answers[item.id]));
    for (const dim of ['anxiety', 'avoidance']) {
      const mean = att[dim].reduce((a, b) => a + b, 0) / att[dim].length;
      traits.attachment[dim] = Math.round(((mean - 1) / 4) * 100);
    }
    traits.attachment.style = classifyAttachment(traits.attachment.anxiety, traits.attachment.avoidance);

    for (const v of VALUES) traits.values[v.id] = clampLikert(answers['val_' + v.id]);

    const lls = Array.isArray(answers.love_languages) ? answers.love_languages : [answers.love_languages];
    traits.loveLanguages = LOVE_LANGUAGES.map(l => l.id).filter(id => lls.includes(id)).slice(0, 2);

    for (const q of LIFESTYLE) {
      const valid = q.options.map(o => o.value);
      traits.lifestyle[q.id] = valid.includes(answers[q.id]) ? answers[q.id] : valid[Math.floor(valid.length / 2)];
    }
    return traits;
  }

  // ---------- social text analysis ----------

  const KEYWORD_MAP = {
    trip: 'travel', wanderlust: 'travel', backpacking: 'travel', explore: 'travel',
    restaurant: 'foodie', brunch: 'foodie', chef: 'cooking', recipe: 'cooking',
    gym: 'fitness', workout: 'fitness', crossfit: 'fitness', marathon: 'running',
    trail: 'hiking', mountains: 'hiking', camera: 'photography',
    concert: 'live gigs', festival: 'live gigs', guitar: 'music', piano: 'music',
    spotify: 'music', cinema: 'movies', netflix: 'movies', film: 'movies',
    books: 'reading', novel: 'reading', author: 'writing', blog: 'writing',
    painting: 'art', gallery: 'art', museum: 'history', barista: 'coffee',
    espresso: 'coffee', vineyard: 'wine', salsa: 'dancing', style: 'fashion',
    engineer: 'tech', developer: 'tech', software: 'tech', ai: 'tech',
    founder: 'startups', entrepreneur: 'startups', stocks: 'investing',
    crypto: 'investing', charity: 'volunteering', nonprofit: 'volunteering',
    puppy: 'dogs', kitten: 'cats', ocean: 'beach', surf: 'beach',
    snowboard: 'skiing', soccer: 'football', nba: 'basketball',
    mindfulness: 'meditation', polyglot: 'languages', physics: 'science',
    manga: 'anime', chess: 'board games', outdoors: 'nature', garden: 'nature',
  };

  const TONE_SIGNALS = {
    extraversion: ['party', 'friends', 'social', 'meetup', 'crowd', 'networking', 'event', 'people person'],
    openness: ['new', 'curious', 'explore', 'learn', 'adventure', 'creative', 'experiment', 'discover'],
    conscientiousness: ['goal', 'discipline', 'plan', 'organised', 'organized', 'deadline', 'consistent', 'routine'],
    agreeableness: ['kind', 'help', 'care', 'support', 'together', 'grateful', 'love', 'community'],
  };

  function analyzeSocialText(text) {
    const tokens = String(text || '').toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .split(/[^a-z0-9#@]+/).filter(Boolean);
    const joined = ' ' + tokens.join(' ') + ' ';
    const interests = new Set();

    for (const tag of INTEREST_TAGS) {
      if (joined.includes(' ' + tag.toLowerCase() + ' ') || tokens.includes('#' + tag.replace(/\s+/g, ''))) interests.add(tag);
    }
    for (const word of Object.keys(KEYWORD_MAP)) {
      if (tokens.includes(word) || tokens.includes('#' + word)) interests.add(KEYWORD_MAP[word]);
    }

    const toneAdjust = {};
    for (const trait of Object.keys(TONE_SIGNALS)) {
      let hits = 0;
      for (const w of TONE_SIGNALS[trait]) if (joined.includes(' ' + w + ' ')) hits++;
      toneAdjust[trait] = Math.min(10, hits * 3);
    }
    return { interests: Array.from(interests), toneAdjust, wordCount: tokens.length };
  }

  function blendTraits(traits, analysis) {
    if (!analysis || analysis.wordCount < 10) return traits;
    const blended = JSON.parse(JSON.stringify(traits));
    for (const trait of Object.keys(analysis.toneAdjust)) {
      const adj = analysis.toneAdjust[trait];
      if (blended.bigFive[trait] != null && adj > 0) {
        blended.bigFive[trait] = Math.min(100, blended.bigFive[trait] + adj);
      }
    }
    return blended;
  }

  // ---------- profile payload encode/decode ----------
  // The QR code carries the whole profile, so no server or database is needed.
  // Format v1 (compact keys, interests as indices into INTEREST_TAGS):
  //   { v:1, n:name, b:[O,C,E,A,N], a:[anxiety,avoidance], vl:[8x 1-5],
  //     ll:[loveLangIdx...], ls:[4x optionIdx], i:[interestIdx...] }

  const BF_ORDER = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  const LL_IDS = LOVE_LANGUAGES.map(l => l.id);

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encodeProfile(profile) {
    const t = profile.traits;
    const payload = {
      v: 1,
      n: String(profile.name || 'Someone').slice(0, 40),
      b: BF_ORDER.map(k => t.bigFive[k]),
      a: [t.attachment.anxiety, t.attachment.avoidance],
      vl: VALUES.map(v => t.values[v.id]),
      ll: t.loveLanguages.map(id => LL_IDS.indexOf(id)).filter(i => i >= 0),
      ls: LIFESTYLE.map(q => Math.max(0, q.options.findIndex(o => o.value === t.lifestyle[q.id]))),
      i: profile.interests.map(x => INTEREST_TAGS.indexOf(x)).filter(i => i >= 0),
    };
    return b64urlEncode(JSON.stringify(payload));
  }

  function decodeProfile(encoded) {
    let p;
    try { p = JSON.parse(b64urlDecode(encoded.trim())); } catch (e) { return null; }
    if (!p || p.v !== 1 || !Array.isArray(p.b) || p.b.length !== 5) return null;

    const clamp100 = x => Math.min(100, Math.max(0, Math.round(Number(x) || 0)));
    const bigFive = {};
    BF_ORDER.forEach((k, i) => { bigFive[k] = clamp100(p.b[i]); });
    const anxiety = clamp100(p.a && p.a[0]);
    const avoidance = clamp100(p.a && p.a[1]);
    const values = {};
    VALUES.forEach((v, i) => { values[v.id] = clampLikert(p.vl && p.vl[i]); });
    const lifestyle = {};
    LIFESTYLE.forEach((q, i) => {
      const idx = Number(p.ls && p.ls[i]);
      lifestyle[q.id] = (q.options[idx] || q.options[1]).value;
    });
    return {
      name: String(p.n || 'Someone').slice(0, 40),
      traits: {
        bigFive,
        attachment: { anxiety, avoidance, style: classifyAttachment(anxiety, avoidance) },
        values,
        loveLanguages: (p.ll || []).map(i => LL_IDS[i]).filter(Boolean).slice(0, 2),
        lifestyle,
      },
      interests: (p.i || []).map(i => INTEREST_TAGS[i]).filter(Boolean),
    };
  }

  // ---------- compatibility engine ----------

  const WEIGHTS = { values: 25, personality: 30, attachment: 15, interests: 15, loveLanguage: 10, lifestyle: 5 };

  function similarity100(a, b) { return 100 - Math.abs(a - b); }

  function scoreValues(a, b) {
    let weighted = 0, weightSum = 0;
    const shared = [], clashes = [];
    for (const v of VALUES) {
      const va = a.values[v.id] != null ? a.values[v.id] : 3;
      const vb = b.values[v.id] != null ? b.values[v.id] : 3;
      const importance = Math.max(va, vb);
      const closeness = 1 - Math.abs(va - vb) / 4;
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
      agreeableness: similarity100(A.agreeableness, B.agreeableness),
      conscientiousness: similarity100(A.conscientiousness, B.conscientiousness),
      openness: similarity100(A.openness, B.openness),
      stability: 100 - (A.neuroticism + B.neuroticism) / 2,
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

  function scoreInterests(intA, intB) {
    const setA = new Set(intA), setB = new Set(intB);
    const shared = Array.from(setA).filter(x => setB.has(x));
    const union = new Set(intA.concat(intB));
    if (union.size === 0) return { score: 50, shared: [] };
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
    for (const pair of pairs) {
      const id = pair[0], label = pair[1];
      total += 1;
      if (la[id] === lb[id]) pts += 1;
      else if (['mix', 'flex', 'cool'].includes(la[id]) || ['mix', 'flex', 'cool'].includes(lb[id])) pts += 0.6;
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

  const LL_LABEL = {};
  LOVE_LANGUAGES.forEach(l => { LL_LABEL[l.id] = l.label.toLowerCase(); });

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

  function listify(arr) {
    const a = arr.map(x => String(x).toLowerCase());
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  function buildReport(nameA, nameB, tA, tB, intA, intB) {
    const values = scoreValues(tA, tB);
    const personality = scorePersonality(tA, tB);
    const attKey = [tA.attachment.style, tB.attachment.style].sort().join('|');
    const attachment = { score: ATTACHMENT_PAIR_SCORES[attKey] != null ? ATTACHMENT_PAIR_SCORES[attKey] : 55 };
    const interests = scoreInterests(intA, intB);
    const loveLang = scoreLoveLanguages(tA, tB);
    const lifestyle = scoreLifestyle(tA, tB);

    const total = Math.round(
      (values.score * WEIGHTS.values + personality.score * WEIGHTS.personality +
        attachment.score * WEIGHTS.attachment + interests.score * WEIGHTS.interests +
        loveLang.score * WEIGHTS.loveLanguage + lifestyle.score * WEIGHTS.lifestyle) / 100
    );

    const strengths = [], watchouts = [], advice = [];

    if (values.shared.length) {
      strengths.push('You both hold ' + listify(values.shared.slice(0, 3)) + ' as core values — this is the strongest long-term glue a couple can have.');
    }
    if (values.clashes.length) {
      watchouts.push('You differ sharply on ' + listify(values.clashes) + ". This won't matter on date three, but it will in year three — talk about it honestly and early.");
      advice.push('On ' + listify(values.clashes) + ': don\'t try to convert each other. Ask "what does this give you?" and look for arrangements that let each of you honour what matters most.');
    }

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
      watchouts.push(social + ' recharges with people while ' + quiet + ' recharges alone — a real but very manageable difference.');
      advice.push(social + ": it's fine to go to that party solo sometimes. " + quiet + ': join for the first hour and take the "quiet exit" pass without guilt. Neither is rejection.');
    } else if (extraGap <= 20) {
      strengths.push('Your social batteries drain and recharge at the same rate, so weekends will rarely be a negotiation.');
    }
    if (similarity100(tA.bigFive.openness, tB.bigFive.openness) >= 75 && tA.bigFive.openness >= 60) {
      strengths.push('You share a high appetite for novelty — new places, ideas and food will keep this relationship self-refreshing.');
    }
    if (Math.abs(tA.bigFive.conscientiousness - tB.bigFive.conscientiousness) > 45) {
      const planner = tA.bigFive.conscientiousness > tB.bigFive.conscientiousness ? nameA : nameB;
      const free = planner === nameA ? nameB : nameA;
      advice.push(planner + ' runs on structure, ' + free + ' on flow. Split domains: ' + planner + ' owns logistics (bookings, bills), ' + free + ' owns spontaneity (surprise plans, keeping weekends unscripted).');
    }

    advice.push(ATTACHMENT_ADVICE[attKey]);
    if (attKey === 'secure|secure') strengths.push('Both of you show a secure attachment pattern — the single best predictor of easy repair after conflict.');
    if (attKey === 'anxious|avoidant') watchouts.push('Your attachment styles (anxious + avoidant) are the pairing that most often traps couples in a pursue-withdraw loop. The advice below matters more than the score.');

    if (interests.shared.length >= 3) {
      strengths.push('You already share real overlap in how you spend time: ' + listify(interests.shared.slice(0, 4)) + '.');
      advice.push('Easy first dates are built in — start with ' + interests.shared[0] + ' and let it do the talking.');
    } else if (interests.shared.length > 0) {
      advice.push('Your one clear common ground is ' + listify(interests.shared) + " — use it as home base while you trade tours of each other's other worlds.");
    } else {
      watchouts.push("Your hobby worlds barely overlap today. That can be a feature — everything is a tour of a new world — but only if you're both curious people.");
    }

    if (loveLang.overlap.length >= 1) {
      strengths.push('You naturally speak the same love language: ' + listify(loveLang.overlap.map(x => LL_LABEL[x])) + '. Affection will land the way it was meant.');
    } else if ((tA.loveLanguages || []).length && (tB.loveLanguages || []).length) {
      watchouts.push(nameA + ' feels loved through ' + listify(tA.loveLanguages.map(x => LL_LABEL[x])) + ', while ' + nameB + ' feels it through ' + listify(tB.loveLanguages.map(x => LL_LABEL[x])) + ' — love could be given and still not felt.');
      advice.push('Learn each other\'s dialect deliberately: ' + nameA + ', offer ' + LL_LABEL[tB.loveLanguages[0]] + '; ' + nameB + ', offer ' + LL_LABEL[tA.loveLanguages[0]] + ". It will feel unnatural for a month and then become the relationship's secret weapon.");
    }

    if (lifestyle.mismatches.length) {
      advice.push('Practical friction points to pre-negotiate: ' + listify(lifestyle.mismatches) + '. Small routines (who owns mornings, how plans get made) prevent 80% of everyday squabbles.');
    } else if (lifestyle.score >= 85) {
      strengths.push('Day-to-day rhythms — sleep, socialising, planning — line up almost perfectly. Cohabiting logistics would be easy for you two.');
    }

    const b = band(total);
    const summary = nameA + ' × ' + nameB + ': ' + total + '/100 — ' + b.label + '. ' +
      (total >= 70
        ? 'The fundamentals here are genuinely aligned; the advice below is about protecting a good thing.'
        : total >= 55
          ? 'There is a real foundation here, with a few structural differences that reward deliberate effort.'
          : 'This pairing asks both of you to work across meaningful differences — worth it only if you both enjoy the work.');

    return {
      total, band: b, summary,
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
      attachmentStyles: [
        { name: nameA, style: tA.attachment.style },
        { name: nameB, style: tB.attachment.style },
      ],
      strengths: strengths.filter(Boolean),
      watchouts: watchouts.filter(Boolean),
      advice: advice.filter(Boolean),
    };
  }

  window.Kindred = {
    BIG_FIVE_ITEMS, ATTACHMENT_ITEMS, VALUES, LOVE_LANGUAGES, LIFESTYLE, INTEREST_TAGS, LIKERT,
    scoreAnswers, analyzeSocialText, blendTraits,
    encodeProfile, decodeProfile, buildReport,
  };
})();
