// Turns raw Instagram signals into a personality profile.
//
// Everything in here is an inference from behavioural traces, and it is
// treated as such: each estimate carries a confidence figure, every trait
// lists the evidence behind it, and any answer the user gives in the
// questionnaire overrides the estimate rather than being averaged with it.
(function (root) {
  'use strict';

  const L = root.KindredLexicon;

  // ---------- small numeric helpers ----------

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const saturate = (x, k) => (x <= 0 ? 0 : x / (x + k));

  // Maps a raw quantity onto [-1, 1] around a reference midpoint.
  function norm(x, mid, spread) {
    if (!Number.isFinite(x) || spread <= 0) return 0;
    return clamp(Math.tanh((x - mid) / spread), -1, 1);
  }

  function pct(x) { return Math.round(clamp(x, 0, 100)); }

  function mean(list) {
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  }

  // Coefficient of variation, the basis of the "posts on a regular rhythm"
  // signal. Low variability relative to the mean means a steady cadence.
  function coefficientOfVariation(list) {
    const m = mean(list);
    if (!m) return 1;
    const variance = mean(list.map(v => (v - m) * (v - m)));
    return Math.sqrt(variance) / m;
  }

  // ---------- corpus building ----------

  const EMOJI_RE = /\p{Extended_Pictographic}/gu;

  function tokenise(text) {
    return text.toLowerCase().split(/[^a-z0-9'#]+/).filter(Boolean);
  }

  function buildCorpus(signals, includeMessages) {
    const texts = [];
    for (const c of signals.captions) texts.push(c);
    for (const c of signals.comments) texts.push(c);
    if (includeMessages && signals.messages && signals.messages.ownTexts) {
      for (const t of signals.messages.ownTexts) texts.push(t);
    }

    const unigrams = new Map();
    const bigrams = new Map();
    let total = 0;
    let hashtags = 0;
    let emoji = 0;
    let exclaims = 0;
    let questions = 0;
    let chars = 0;

    const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

    for (const text of texts) {
      chars += text.length;
      emoji += (text.match(EMOJI_RE) || []).length;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '!') exclaims++;
        else if (ch === '?') questions++;
      }
      const raw = tokenise(text);
      let previous = null;
      for (const token of raw) {
        let word = token;
        if (word[0] === '#') { hashtags++; word = word.slice(1); if (!word) continue; }
        total++;
        bump(unigrams, word);
        if (previous) bump(bigrams, previous + ' ' + word);
        previous = word;
      }
    }

    // Type-token ratio saturates on long texts, so measure it on a fixed
    // sample of the vocabulary instead of the whole corpus.
    const lexicalDiversity = total ? clamp(unigrams.size / Math.min(total, 8000), 0, 1) : 0;

    return {
      texts, unigrams, bigrams, total, hashtags, emoji, exclaims, questions, chars,
      lexicalDiversity,
      captionCount: signals.captions.length,
      commentCount: signals.comments.length,
      dmCount: includeMessages && signals.messages ? signals.messages.ownTexts.length : 0,
    };
  }

  // Handles, curated topics and ad interests are matched against the words
  // inside them: "yoga_with_amy" should count for yoga. Splitting into tokens
  // first matters — a naive substring test makes "hiking_club" look like
  // nightlife and "carpenter" look like an interest in cars.
  function indexHandle(text) {
    const raw = text.toLowerCase();
    return { raw, tokens: new Set(raw.split(/[^a-z]+/).filter(Boolean)) };
  }

  function buildHandleIndex(signals) {
    const strong = [];   // Instagram's own topic/interest labels
    const weak = [];     // accounts followed, liked, saved; own searches
    for (const t of signals.topics) strong.push(indexHandle(t));
    for (const t of signals.adInterests) strong.push(indexHandle(t));
    for (const f of signals.following) weak.push(indexHandle(f.name));
    for (const [name] of signals.likedAuthors) weak.push(indexHandle(name));
    for (const [name] of signals.savedAuthors) weak.push(indexHandle(name));
    for (const s of signals.searches) weak.push(indexHandle(s));
    return { strong, weak };
  }

  function countMatches(corpus, words) {
    let hits = 0;
    for (const word of words) {
      if (word.includes(' ')) hits += corpus.bigrams.get(word) || 0;
      else hits += corpus.unigrams.get(word) || 0;
    }
    return hits;
  }

  // A word matches a handle when it appears as a whole token, or — for words
  // long enough that a chance collision is unlikely — anywhere inside a run-on
  // handle like "trailrunning".
  function countHandleMatches(list, words) {
    let hits = 0;
    for (const handle of list) {
      for (const word of words) {
        if (word.includes(' ')) continue;
        if (handle.tokens.has(word) || (word.length >= 7 && handle.raw.includes(word))) { hits++; break; }
      }
    }
    return hits;
  }

  // ---------- theme scoring ----------

  function scoreThemes(corpus, handles) {
    const textBase = Math.max(400, corpus.total);
    const weakBase = Math.max(40, handles.weak.length);
    const out = [];

    for (const theme of L.THEMES) {
      const textHits = countMatches(corpus, theme.words);
      const strongHits = countHandleMatches(handles.strong, theme.words);
      const weakHits = countHandleMatches(handles.weak, theme.words);

      const textRate = (textHits / textBase) * 1000;      // mentions per 1000 words
      const weakRate = (weakHits / weakBase) * 100;       // matching accounts per 100 follows
      const raw = textRate + weakRate * 1.2 + strongHits * 4;

      out.push({
        id: theme.id,
        label: theme.label,
        kind: theme.kind,
        doc: theme.doc || null,
        // Saturating curve: strong evidence should read as strong without
        // every present theme pinning to 100 and flattening the ranking.
        score: pct(100 * (1 - Math.exp(-raw / 11))),
        hits: { text: textHits, topics: strongHits, accounts: weakHits },
        evidence: raw,
      });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function themeMap(themes) {
    const map = {};
    for (const t of themes) map[t.id] = t;
    return map;
  }

  const themeScore = (map, id) => (map[id] ? map[id].score : 0);
  // Themes sit on 0–100 where ~40 is "clearly present"; recentre for traits.
  const themeSignal = (map, id) => clamp((themeScore(map, id) - 38) / 42, -1, 1);

  // ---------- rhythm ----------

  function analyseRhythm(signals) {
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);
    const monthly = new Map();
    let first = Infinity;
    let last = 0;

    for (const ev of signals.events) {
      const d = new Date(ev.ts * 1000);
      const h = d.getHours();
      if (!Number.isFinite(h)) continue;
      hours[h]++;
      weekdays[d.getDay()]++;
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      monthly.set(key, (monthly.get(key) || 0) + 1);
      if (ev.ts < first) first = ev.ts;
      if (ev.ts > last) last = ev.ts;
    }

    const total = signals.events.length;
    const spanDays = total && Number.isFinite(first) ? Math.max(1, Math.round((last - first) / 86400)) : 0;
    const activeMonths = monthly.size;

    // `to` is exclusive and may wrap past midnight, so normalise it first —
    // an un-normalised 24 would never compare equal to the wrapped counter.
    const share = (from, to) => {
      if (!total) return 0;
      const stop = to % 24;
      let n = 0;
      for (let h = from % 24; h !== stop; h = (h + 1) % 24) n += hours[h];
      return n / total;
    };
    const lateNightShare = share(0, 5);          // 00:00–04:59
    const earlyShare = share(5, 10);             // 05:00–09:59
    const eveningShare = share(19, 24);          // 19:00–23:59
    const weekendShare = total ? (weekdays[0] + weekdays[6]) / total : 0;

    // A month the user was on the platform but silent still counts, so build
    // the series over the full span rather than only over months with posts.
    const counts = [];
    if (activeMonths) {
      const start = new Date(first * 1000);
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const end = new Date(last * 1000);
      while (cursor <= end && counts.length < 240) {
        const key = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0');
        counts.push(monthly.get(key) || 0);
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    const regularity = counts.length >= 3 ? clamp(1 - coefficientOfVariation(counts), 0, 1) : 0.5;

    const creationEvents = signals.events.filter(e => e.kind === 'post' || e.kind === 'story' || e.kind === 'reel').length;
    const perMonth = counts.length ? creationEvents / counts.length : 0;

    let chronotype = 'Flexible';
    if (lateNightShare > 0.18 && lateNightShare > earlyShare * 1.4) chronotype = 'Night owl';
    else if (earlyShare > 0.28 && earlyShare > lateNightShare * 2) chronotype = 'Early bird';

    return {
      hours, weekdays, total, spanDays, activeMonths: counts.length,
      firstDate: Number.isFinite(first) ? first : 0,
      lastDate: last,
      lateNightShare, earlyShare, eveningShare, weekendShare,
      regularity, perMonth, chronotype, monthlyCounts: counts,
    };
  }

  // ---------- social footprint ----------

  function analyseSocial(signals, includeMessages) {
    const following = signals.following.length;
    const followers = signals.counts.followers;
    const msgs = signals.messages || { threads: 0, sent: 0, received: 0, groupThreads: 0, avgSentLength: 0 };
    const perMonthDivisor = 1; // filled in by caller when needed

    const breadthParts = [
      saturate(following, 400),
      saturate(signals.commentedOn.size, 60),
      includeMessages ? saturate(msgs.threads, 40) : null,
      saturate(signals.counts.closeFriends, 15),
    ].filter(v => v !== null);

    return {
      following,
      followers,
      followRatio: following ? (followers + 1) / (following + 1) : 0,
      closeFriends: signals.counts.closeFriends,
      blocked: signals.counts.blocked,
      commentsMade: signals.counts.comments,
      distinctCommented: signals.commentedOn.size,
      likes: signals.counts.likes,
      saved: signals.counts.saved,
      storyInteractions: signals.counts.storyInteractions,
      threads: msgs.threads,
      groupThreads: msgs.groupThreads,
      sent: msgs.sent,
      received: msgs.received,
      avgSentLength: msgs.avgSentLength,
      initiationRatio: msgs.total ? msgs.sent / msgs.total : 0,
      breadth: pct(100 * mean(breadthParts)),
      perMonthDivisor,
    };
  }

  // ---------- tone ----------

  function analyseTone(corpus) {
    const per1000 = hits => (corpus.total ? (hits / Math.max(400, corpus.total)) * 1000 : 0);
    const agreeable = L.TRAIT_MARKERS.agreeableness;
    const neurotic = L.TRAIT_MARKERS.neuroticism;
    return {
      positivity: per1000(countMatches(corpus, agreeable.pos)),
      negativity: per1000(countMatches(corpus, agreeable.neg) + countMatches(corpus, neurotic.pos)),
      anxiety: per1000(countMatches(corpus, ['anxious', 'anxiety', 'worried', 'worry', 'stress', 'stressed', 'nervous', 'panic', 'overwhelmed'])),
      selfFocus: per1000(countMatches(corpus, L.SELF_WORDS)),
      socialFocus: per1000(countMatches(corpus, L.SOCIAL_WORDS)),
      emojiPerPost: corpus.captionCount ? corpus.emoji / corpus.captionCount : 0,
      exclaimPer1000: per1000(corpus.exclaims),
      lexicalDiversity: corpus.lexicalDiversity,
      hashtagsPerPost: corpus.captionCount ? corpus.hashtags / corpus.captionCount : 0,
    };
  }

  // ---------- Big Five estimation ----------

  function traitLexScore(corpus, trait) {
    const markers = L.TRAIT_MARKERS[trait];
    const base = Math.max(400, corpus.total);
    const pos = (countMatches(corpus, markers.pos) / base) * 1000;
    const neg = (countMatches(corpus, markers.neg) / base) * 1000;
    return { value: norm(pos - neg, 1.2, 4), pos, neg };
  }

  function estimateBigFive(ctx) {
    const { corpus, rhythm, social, tone, themes, includeMessages } = ctx;
    const tm = themeMap(themes);
    const hasText = corpus.total >= 150;
    const hasEvents = rhythm.total >= 20;
    const themeBreadth = themes.filter(t => t.score >= 35).length;

    const lex = {
      openness: traitLexScore(corpus, 'openness'),
      conscientiousness: traitLexScore(corpus, 'conscientiousness'),
      extraversion: traitLexScore(corpus, 'extraversion'),
      agreeableness: traitLexScore(corpus, 'agreeableness'),
      neuroticism: traitLexScore(corpus, 'neuroticism'),
    };

    const c = (label, value, weight, available) => ({ label, value, weight, available: available !== false });

    const definitions = {
      openness: [
        c('language of curiosity, art and ideas', lex.openness.value, 1.0, hasText),
        c('range of distinct interests', norm(themeBreadth, 6, 5), 0.7, true),
        c('variety of vocabulary', norm(tone.lexicalDiversity, 0.42, 0.16), 0.5, hasText),
        c('art, museums and theatre', Math.max(themeSignal(tm, 'art'), themeSignal(tm, 'theatre')), 0.4, true),
        c('travel and exploration', themeSignal(tm, 'travel'), 0.4, true),
        c('reading', themeSignal(tm, 'reading'), 0.35, true),
        c('music and live performance', themeSignal(tm, 'music'), 0.3, true),
        c('photography and image-making', themeSignal(tm, 'photography'), 0.3, true),
        c('learning and study', themeSignal(tm, 'learning'), 0.25, true),
      ],
      conscientiousness: [
        c('language of plans, goals and follow-through', lex.conscientiousness.value, 1.0, hasText),
        c('steadiness of posting rhythm', norm(rhythm.regularity, 0.45, 0.28), 0.8, rhythm.activeMonths >= 4),
        c('activity after midnight', norm(rhythm.lateNightShare, 0.12, 0.12), -0.5, hasEvents),
        c('work and career content', themeSignal(tm, 'business'), 0.35, true),
        c('training and gym routine', Math.max(themeSignal(tm, 'gym'), themeSignal(tm, 'running')), 0.35, true),
        c('learning and study', themeSignal(tm, 'learning'), 0.3, true),
        c('money and planning', themeSignal(tm, 'finance'), 0.2, true),
      ],
      extraversion: [
        c('language of groups, nights out and celebration', lex.extraversion.value, 1.0, hasText),
        c('how often you post', norm(rhythm.perMonth, 3.5, 7), 0.7, rhythm.activeMonths >= 3),
        c('size of the circle you follow', norm(Math.log10(social.following + 1), 2.5, 0.7), 0.5, social.following > 0),
        c('"we" and "us" rather than "I"', norm(tone.socialFocus - tone.selfFocus * 0.4, 4, 8), 0.5, hasText),
        c('number of DM conversations', norm(social.threads, 30, 45), 0.45, includeMessages && social.threads > 0),
        c('nightlife and bars', Math.max(themeSignal(tm, 'nightclubs'), themeSignal(tm, 'bars'), themeSignal(tm, 'karaoke')), 0.4, true),
        c('commenting on other people', norm(social.distinctCommented, 25, 40), 0.3, social.commentsMade > 0),
        c('stories posted', norm(ctx.signals.counts.stories, 40, 90), 0.3, true),
      ],
      agreeableness: [
        c('warm, grateful, complimentary language', lex.agreeableness.value, 1.0, hasText),
        c('overall positivity of tone', norm(tone.positivity, 9, 12), 0.7, hasText),
        c('causes and volunteering', themeSignal(tm, 'cause'), 0.4, true),
        c('family content', themeSignal(tm, 'family'), 0.35, true),
        c('engaging with others rather than only liking', norm(social.commentsMade / Math.max(1, social.likes + 1), 0.05, 0.09), 0.4, social.likes > 0),
        c('pets and animals', themeSignal(tm, 'pets'), 0.25, true),
        c('accounts blocked', norm(social.blocked, 4, 8), -0.3, true),
      ],
      neuroticism: [
        c('language of stress, worry and hurt', lex.neuroticism.value, 1.0, hasText),
        c('negative emotion words', norm(tone.negativity, 4, 6), 0.6, hasText),
        c('explicit anxiety words', norm(tone.anxiety, 0.9, 2), 0.6, hasText),
        c('self-focused pronouns', norm(tone.selfFocus, 22, 20), 0.5, hasText),
        c('activity after midnight', norm(rhythm.lateNightShare, 0.12, 0.12), 0.4, hasEvents),
        c('irregular bursts of activity', norm(rhythm.regularity, 0.45, 0.28), -0.3, rhythm.activeMonths >= 4),
        c('therapy, healing and self-care language', themeSignal(tm, 'wellness'), 0.25, true),
      ],
    };

    const GAIN = 2.4;
    const result = {};
    for (const trait of Object.keys(definitions)) {
      const comps = definitions[trait];
      let sum = 0;
      let used = 0;
      let possible = 0;
      for (const comp of comps) {
        possible += Math.abs(comp.weight);
        if (!comp.available) continue;
        sum += comp.value * comp.weight;
        used += Math.abs(comp.weight);
      }
      const avg = used ? sum / used : 0;
      const score = used ? pct(100 / (1 + Math.exp(-GAIN * avg))) : 50;
      // Surface the components that actually moved the number.
      const evidence = comps
        .filter(x => x.available && Math.abs(x.value * x.weight) > 0.12)
        .sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))
        .slice(0, 4)
        .map(x => ({ label: x.label, direction: (x.value * x.weight) > 0 ? 'up' : 'down' }));
      result[trait] = { score, coverage: possible ? used / possible : 0, evidence };
    }
    return result;
  }

  // ---------- values, love languages, descriptors ----------

  function scoreValues(corpus, handles, themes) {
    const tm = themeMap(themes);
    const textBase = Math.max(400, corpus.total);
    const out = L.VALUE_MARKERS.map(v => {
      const textHits = countMatches(corpus, v.words);
      const handleHits = countHandleMatches(handles.strong, v.words) * 3 + countHandleMatches(handles.weak, v.words) * 0.5;
      const raw = (textHits / textBase) * 1000 + handleHits * 0.8;
      return { id: v.id, label: v.label, score: pct(100 * (1 - Math.exp(-raw / 9))), hits: textHits };
    });
    // A couple of values map onto themes more cleanly than onto words.
    const lift = (id, themeId, weight) => {
      const item = out.find(v => v.id === id);
      if (item) item.score = pct(Math.max(item.score, themeScore(tm, themeId) * weight));
    };
    lift('health', 'gym', 0.9);
    lift('adventure', 'travel', 0.9);
    lift('spirituality', 'faith', 0.95);
    lift('helping', 'cause', 0.9);
    lift('family', 'family', 0.85);
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function scoreLoveHints(corpus) {
    const textBase = Math.max(300, corpus.total);
    return L.LOVE_MARKERS.map(m => {
      const hits = countMatches(corpus, m.words);
      return { id: m.id, label: m.label, score: pct(100 * (1 - Math.exp(-((hits / textBase) * 1000) / 3))), hits };
    }).sort((a, b) => b.score - a.score);
  }

  function scoreDescriptors(bigFive, themes) {
    const tm = themeMap(themes);
    return L.DESCRIPTOR_RULES.map(rule => {
      let score = 0;
      let weight = 0;
      for (const trait of Object.keys(rule.from || {})) {
        const w = rule.from[trait];
        score += w * ((bigFive[trait].score - 50) / 50);
        weight += Math.abs(w);
      }
      for (const themeId of Object.keys(rule.themes || {})) {
        const w = rule.themes[themeId];
        score += w * themeSignal(tm, themeId);
        weight += Math.abs(w);
      }
      return { label: rule.label, score: weight ? score / weight : 0 };
    }).sort((a, b) => b.score - a.score);
  }

  // ---------- derived shorthand ----------

  // Big Five → MBTI letters. The dimensions correlate (McCrae & Costa 1989)
  // but are not equivalent; the UI presents this as a suggestion only.
  function suggestMbti(bigFive) {
    return (bigFive.extraversion.score >= 50 ? 'E' : 'I') +
      (bigFive.openness.score >= 50 ? 'N' : 'S') +
      (bigFive.agreeableness.score >= 50 ? 'F' : 'T') +
      (bigFive.conscientiousness.score >= 50 ? 'J' : 'P');
  }

  const OCCUPATION_CATEGORIES = [
    { id: 'tech', label: 'Tech & engineering', words: ['engineer', 'developer', 'software', 'programmer', 'data', 'devops', 'it ', 'technical', 'architect', 'scientist ai', 'machine learning'] },
    { id: 'finance', label: 'Finance', words: ['banker', 'banking', 'finance', 'accountant', 'audit', 'trader', 'investment', 'analyst', 'actuary', 'wealth'] },
    { id: 'health', label: 'Healthcare', words: ['doctor', 'nurse', 'physician', 'dentist', 'therapist', 'pharmacist', 'surgeon', 'medical', 'clinical', 'psychologist'] },
    { id: 'education', label: 'Education', words: ['teacher', 'lecturer', 'professor', 'tutor', 'educator', 'principal', 'academic'] },
    { id: 'legal', label: 'Legal', words: ['lawyer', 'solicitor', 'barrister', 'legal', 'attorney', 'paralegal', 'counsel'] },
    { id: 'creative', label: 'Creative & design', words: ['designer', 'artist', 'photographer', 'illustrator', 'architect', 'musician', 'writer', 'creative', 'director film'] },
    { id: 'media', label: 'Media & marketing', words: ['marketing', 'media', 'journalist', 'editor', 'pr ', 'communications', 'content', 'social media', 'brand'] },
    { id: 'sales', label: 'Sales & business development', words: ['sales', 'account manager', 'business development', 'realtor', 'agent', 'broker', 'retail'] },
    { id: 'ops', label: 'Operations & management', words: ['operations', 'manager', 'project', 'product', 'consultant', 'logistics', 'supply', 'hr', 'recruit'] },
    { id: 'science', label: 'Science & research', words: ['researcher', 'research', 'scientist', 'phd', 'laboratory', 'biologist', 'chemist', 'physicist'] },
    { id: 'public', label: 'Government & public service', words: ['government', 'civil service', 'police', 'military', 'army', 'navy', 'firefighter', 'diplomat', 'policy', 'social worker', 'nonprofit'] },
    { id: 'hospitality', label: 'Hospitality & food', words: ['chef', 'restaurant', 'hospitality', 'hotel', 'barista', 'bartender', 'cook', 'catering'] },
    { id: 'trades', label: 'Trades & construction', words: ['builder', 'electrician', 'plumber', 'carpenter', 'construction', 'mechanic', 'technician', 'driver', 'pilot'] },
    { id: 'student', label: 'Student', words: ['student', 'undergraduate', 'postgraduate', 'intern', 'studying'] },
    { id: 'founder', label: 'Founder & self-employed', words: ['founder', 'ceo', 'entrepreneur', 'owner', 'self-employed', 'freelance', 'startup'] },
    { id: 'other', label: 'Other', words: [] },
  ];

  function categoriseOccupation(text) {
    const lower = ' ' + String(text || '').toLowerCase() + ' ';
    for (const cat of OCCUPATION_CATEGORIES) {
      for (const word of cat.words) {
        if (lower.includes(word)) return cat.id;
      }
    }
    return 'other';
  }

  // ---------- confidence ----------

  function scoreConfidence(corpus, rhythm, handles) {
    const parts = [
      { weight: 0.40, value: saturate(corpus.total, 1500) },
      { weight: 0.28, value: saturate(rhythm.total, 500) },
      { weight: 0.16, value: saturate(rhythm.spanDays, 480) },
      { weight: 0.16, value: saturate(handles.strong.length * 3 + handles.weak.length, 200) },
    ];
    return pct(100 * parts.reduce((sum, p) => sum + p.weight * p.value, 0));
  }

  function confidenceLabel(score) {
    if (score >= 70) return 'high';
    if (score >= 45) return 'moderate';
    if (score >= 22) return 'low';
    return 'very low';
  }

  // ---------- narrative ----------

  const BANDS = {
    openness: {
      high: 'Your feed reads as a curious one: new places, new formats, ideas picked up and turned over. You are drawn to things that are unfamiliar rather than things that are safe.',
      mid: 'You mix the new and the familiar. You will try something different when it appears, but you are not restless about it — novelty is a pleasure, not a need.',
      low: 'You know what you like and you return to it. Your activity is grounded in a settled set of places, people and routines rather than a constant search for the next thing.',
    },
    conscientiousness: {
      high: 'There is real structure underneath your activity — steady rhythms, follow-through, and the language of plans and finished things. You are someone who says what they will do and then does it.',
      mid: 'You are organised where it matters and relaxed where it does not. Deadlines get met, but you are not running your life off a spreadsheet.',
      low: 'You move by instinct more than by plan. Your activity comes in bursts when something grabs you, and you would rather keep the day open than schedule it.',
    },
    extraversion: {
      high: 'You are visibly social. Group settings, shared occasions and a wide circle show up throughout your activity, and you are usually the one reaching outward.',
      mid: 'You are sociable without being driven by it. You enjoy people in the right dose and then happily go quiet for a while.',
      low: 'Your energy is inward. You keep a smaller circle, post less often, and are far more likely to be deep in one conversation than spread across twenty.',
    },
    agreeableness: {
      high: 'Warmth is the dominant note. You praise people, thank people and show up for them, and your interactions with others are generous rather than transactional.',
      mid: 'You are warm but not indiscriminate. You give people your goodwill and expect it back, and you can be direct when something needs saying.',
      low: 'You are candid and hold your own line. You would rather be honest than smooth, which reads as bracing to some people and refreshing to others.',
    },
    neuroticism: {
      high: 'You feel things at full volume, and you do not hide it. That makes you emotionally honest and quick to sense what is happening in a room, and it also means stress lands hard.',
      mid: 'You have a normal emotional range — things get to you, and then they pass. You are neither armoured nor easily knocked over.',
      low: 'You are notably even. Stress does not seem to spike your activity, and your tone stays level across good stretches and bad ones.',
    },
  };

  function band(score) { return score >= 60 ? 'high' : score <= 40 ? 'low' : 'mid'; }

  function narrate(analysis) {
    const bf = analysis.bigFive;
    const tm = themeMap(analysis.themes);
    const top = analysis.themes.filter(t => t.score >= 40).slice(0, 6);
    const values = analysis.values.filter(v => v.score >= 30).slice(0, 3);
    const sections = [];

    // Which two traits are furthest from the middle — those define the person.
    const defining = Object.keys(bf)
      .map(k => ({ k, dist: Math.abs(bf[k].score - 50), score: bf[k].score }))
      .sort((a, b) => b.dist - a.dist)
      .slice(0, 2);

    sections.push({
      title: 'Who you look like from the outside',
      body: [
        defining.map(d => BANDS[d.k][band(d.score)]).join(' '),
        top.length
          ? 'The threads that run through everything: ' + top.map(t => t.label.toLowerCase()).join(', ') + '.'
          : 'Your export is thin on content, so the themes below are drawn from very little — take them lightly.',
      ].join(' '),
    });

    const rhythmBits = [];
    rhythmBits.push(analysis.rhythm.chronotype === 'Night owl'
      ? 'You come alive late — a real share of your activity happens after midnight.'
      : analysis.rhythm.chronotype === 'Early bird'
        ? 'You are an early starter; mornings are when you are most active.'
        : 'Your activity is spread across the day rather than concentrated at one end of it.');
    if (analysis.rhythm.weekendShare > 0.36) rhythmBits.push('Weekends are clearly your time.');
    else if (analysis.rhythm.weekendShare < 0.2) rhythmBits.push('Interestingly, you are more active on weekdays than weekends.');
    rhythmBits.push(analysis.rhythm.regularity > 0.6
      ? 'You keep a steady cadence rather than disappearing and reappearing.'
      : 'You post in bursts — quiet stretches, then a run of activity.');
    sections.push({ title: 'Your rhythm', body: rhythmBits.join(' ') });

    const socialBits = [];
    socialBits.push('You follow ' + analysis.social.following.toLocaleString() + ' accounts' +
      (analysis.social.followers ? ' and are followed by ' + analysis.social.followers.toLocaleString() : '') + '.');
    if (analysis.social.distinctCommented > 0) {
      socialBits.push('You have commented on ' + analysis.social.distinctCommented.toLocaleString() +
        ' different people\'s posts, which puts your engagement ' +
        (analysis.social.distinctCommented > 40 ? 'firmly on the outward-facing side' : 'on the selective side') + '.');
    }
    if (analysis.social.closeFriends > 0) {
      socialBits.push('Your close friends list has ' + analysis.social.closeFriends + ' people on it — that is the circle you actually let in.');
    }
    if (analysis.social.threads > 0) {
      socialBits.push('Across ' + analysis.social.threads + ' DM conversations you sent ' +
        Math.round(analysis.social.initiationRatio * 100) + '% of the messages, ' +
        (analysis.social.initiationRatio > 0.55 ? 'so you are usually the one carrying the conversation.' : 'so you tend to match rather than lead.'));
    }
    sections.push({ title: 'How you connect', body: socialBits.join(' ') });

    const beliefBits = [];
    if (values.length) {
      beliefBits.push('What your activity keeps circling back to: ' + values.map(v => v.label.toLowerCase()).join(', ') + '.');
    }
    if (themeScore(tm, 'faith') >= 40) {
      beliefBits.push('Faith language appears often enough to look like a real part of your life rather than an occasional mention.');
    }
    if (themeScore(tm, 'cause') >= 40) {
      beliefBits.push('You engage with causes and community work — that reads as a value, not a hobby.');
    }
    if (themeScore(tm, 'family') >= 45) {
      beliefBits.push('Family is a recurring presence rather than a background detail.');
    }
    if (!beliefBits.length) beliefBits.push('Your export does not carry strong belief or values signals — the questionnaire is doing the work on this one.');
    sections.push({ title: 'What you seem to value', body: beliefBits.join(' ') });

    const loveTop = analysis.loveHints.filter(l => l.score >= 25).slice(0, 2);
    sections.push({
      title: 'How this might show up close up',
      body: (loveTop.length
        ? 'When you write about people you care about, you reach for the language of ' +
          loveTop.map(l => l.label.toLowerCase()).join(' and ') + '. '
        : '') +
        (bf.agreeableness.score >= 60 ? 'You are likely to be the accommodating one in a relationship, which is lovely until you stop saying what you need. ' : '') +
        (bf.neuroticism.score >= 60 ? 'You will need a partner who does not treat big feelings as a problem to be solved. ' : '') +
        (bf.neuroticism.score <= 40 ? 'You are steady under pressure, which makes you easy to lean on — and easy to under-ask for support. ' : '') +
        (bf.extraversion.score <= 40 ? 'Expect to need real recovery time after social stretches. ' : '') +
        'Attachment style, love languages and dealbreakers come from your own answers rather than from Instagram — nothing in an export predicts them reliably.',
    });

    return sections;
  }

  // ---------- questionnaire pre-fill ----------

  function buildPrefill(analysis) {
    const Q = root.KindredQuestions;
    const answers = Q.emptyAnswers();
    const tm = themeMap(analysis.themes);

    for (const theme of analysis.themes) {
      if (!theme.doc || theme.score < 32) continue;
      const bucket = theme.kind === 'fitness' ? 'fitness' : 'interests';
      if (Q[bucket === 'fitness' ? 'DOC_FITNESS' : 'DOC_INTERESTS'].includes(theme.doc)) {
        answers[bucket].push(theme.doc);
      }
    }

    answers.descriptors = analysis.descriptors.filter(d => d.score > 0.08).slice(0, 3).map(d => d.label);
    answers.priorities = analysis.values.filter(v => v.score >= 25).slice(0, 3).map(v => v.label);

    answers.mbti = analysis.mbtiSuggestion;
    answers.bigfive = {
      openness: analysis.bigFive.openness.score,
      conscientiousness: analysis.bigFive.conscientiousness.score,
      extraversion: analysis.bigFive.extraversion.score,
      agreeableness: analysis.bigFive.agreeableness.score,
      neuroticism: analysis.bigFive.neuroticism.score,
    };

    answers.rhythm.chronotype = analysis.rhythm.chronotype;
    answers.rhythm.social_energy = analysis.bigFive.extraversion.score >= 60 ? 'Out and social'
      : analysis.bigFive.extraversion.score <= 40 ? 'Quiet at home' : 'A bit of both';
    answers.rhythm.planning = analysis.bigFive.conscientiousness.score >= 60 ? 'Planned ahead'
      : analysis.bigFive.conscientiousness.score <= 40 ? 'Spontaneous' : 'Loose plans';

    // Nightlife activity is the one habit an export speaks to at all, and
    // even then only as a nudge the user can override.
    if (themeScore(tm, 'bars') >= 45 || themeScore(tm, 'nightclubs') >= 45) answers.habits.drinking = 'Socially';

    if (analysis.profile.country) answers.country = analysis.profile.country;
    return answers;
  }

  // ---------- entry point ----------

  /**
   * @param {object} signals  output of KindredInstagram.readExports
   * @param {object} options  { includeMessages }
   */
  function analyse(signals, options) {
    const opts = options || {};
    const includeMessages = !!opts.includeMessages;
    const corpus = buildCorpus(signals, includeMessages);
    const handles = buildHandleIndex(signals);
    const rhythm = analyseRhythm(signals);
    const social = analyseSocial(signals, includeMessages);
    const tone = analyseTone(corpus);
    const themes = scoreThemes(corpus, handles);

    const bigFive = estimateBigFive({ corpus, rhythm, social, tone, themes, includeMessages, signals });
    const values = scoreValues(corpus, handles, themes);
    const loveHints = scoreLoveHints(corpus);
    const descriptors = scoreDescriptors(bigFive, themes);
    const confidence = scoreConfidence(corpus, rhythm, handles);

    const analysis = {
      profile: {
        name: signals.profile.name || signals.profile.username || '',
        username: signals.profile.username,
        bio: signals.profile.bio,
        city: signals.profile.city,
        country: '',
      },
      corpusStats: {
        words: corpus.total, captions: corpus.captionCount, comments: corpus.commentCount,
        dms: corpus.dmCount, emoji: corpus.emoji, hashtags: corpus.hashtags,
      },
      counts: signals.counts,
      rhythm, social, tone, themes, bigFive, values, loveHints, descriptors,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      includeMessages,
      // Per-trait confidence discounts the overall figure by how much of the
      // trait's evidence base was actually present in this export.
      traitConfidence: Object.keys(bigFive).reduce((acc, k) => {
        acc[k] = pct(confidence * (0.55 + 0.45 * bigFive[k].coverage));
        return acc;
      }, {}),
      caveats: [],
    };

    analysis.mbtiSuggestion = suggestMbti(bigFive);
    analysis.narrative = narrate(analysis);
    analysis.prefill = buildPrefill(analysis);

    if (corpus.total < 300) analysis.caveats.push('Very little written text in this export, so the language-based parts of the estimate are weak.');
    if (rhythm.total < 60) analysis.caveats.push('Not much activity history, so rhythm and cadence signals are thin.');
    if (!includeMessages) analysis.caveats.push('Direct messages were excluded, so social-breadth signals come from public activity only.');
    if (!signals.following.length) analysis.caveats.push('No following list found — interest detection is relying on captions alone.');

    return analysis;
  }

  // ---------- final profile assembly ----------

  const HABIT_KEYS = ['smoking', 'drinking', 'gambling', 'spending', 'opposite_friends', 'kids'];
  const RHYTHM_KEYS = ['chronotype', 'social_energy', 'planning', 'conflict'];

  /**
   * Combines the Instagram analysis with the user's questionnaire answers
   * into the canonical profile that the QR codec and compatibility engine
   * both consume. Answers win wherever they exist.
   */
  function buildProfile(analysis, answers, name) {
    const Q = root.KindredQuestions;
    const closenessIndex = Q.CLOSENESS.indexOf(answers.closeness);
    const tm = themeMap(analysis.themes);

    const igIndex = id => themeScore(tm, id);

    return {
      version: 2,
      name: String(name || analysis.profile.name || 'Me').trim().slice(0, 15) || 'Me',
      createdAt: new Date().toISOString(),
      background: {
        country: answers.country || '',
        education: answers.education || '',
        religion: answers.religion || '',
        occupation: answers.occupation || '',
        occupationCategory: categoriseOccupation(answers.occupation),
      },
      interests: answers.interests.slice(),
      fitness: answers.fitness.slice(),
      descriptors: answers.descriptors.slice(0, 3),
      priorities: answers.priorities.slice(0, 3),
      mbti: answers.mbti && answers.mbti !== 'Not sure' ? answers.mbti : '',
      enneagram: answers.enneagram && answers.enneagram !== 'Not sure' ? answers.enneagram : '',
      bigFive: {
        openness: pct(answers.bigfive.openness),
        conscientiousness: pct(answers.bigfive.conscientiousness),
        extraversion: pct(answers.bigfive.extraversion),
        agreeableness: pct(answers.bigfive.agreeableness),
        neuroticism: pct(answers.bigfive.neuroticism),
      },
      attachment: closenessIndex >= 0 ? Q.CLOSENESS_TO_ATTACHMENT[closenessIndex] : 'secure',
      qualities: answers.qualities.slice(0, 3),
      loveGive: answers.love_give.slice(),
      loveReceive: answers.love_receive.slice(),
      ingredients: answers.ingredients.slice(0, 3),
      dealbreakers: answers.dealbreakers.slice(),
      habits: HABIT_KEYS.reduce((acc, k) => { acc[k] = answers.habits[k] || ''; return acc; }, {}),
      rhythm: RHYTHM_KEYS.reduce((acc, k) => { acc[k] = answers.rhythm[k] || ''; return acc; }, {}),
      // A compact digest of the Instagram side, carried in the QR code so the
      // other person's report can reason about lifestyle, not just answers.
      ig: {
        confidence: analysis.confidence,
        activity: pct(saturate(analysis.rhythm.perMonth, 6) * 100),
        regularity: pct(analysis.rhythm.regularity * 100),
        breadth: analysis.social.breadth,
        positivity: pct(saturate(analysis.tone.positivity, 12) * 100),
        nightlife: Math.max(igIndex('nightclubs'), igIndex('bars')),
        fitnessIndex: Math.max(igIndex('gym'), igIndex('running'), igIndex('hiit')),
        travel: igIndex('travel'),
        family: igIndex('family'),
        faith: igIndex('faith'),
        creator: Math.max(igIndex('photography'), igIndex('art'), igIndex('music')),
        outdoors: Math.max(igIndex('nature'), igIndex('hiking')),
      },
      // Free-text answers stay on this device; they are never encoded into
      // the QR code, which only carries the structured fields above.
      notes: {
        priorities: answers.priorities_note || '',
        mbti: answers.mbti_note || '',
        enneagram: answers.enneagram_note || '',
        bigfive: answers.bigfive_note || '',
        personality: answers.personality_note || '',
        qualities: answers.qualities_note || '',
        ingredients: answers.ingredients_note || '',
        dealbreakers: answers.dealbreakers_note || '',
        relationship: answers.relationship_note || '',
        otherInterests: answers.other_interests || '',
        otherFitness: answers.other_fitness || '',
      },
    };
  }

  root.KindredAnalysis = {
    analyse, buildProfile, categoriseOccupation, OCCUPATION_CATEGORIES,
    confidenceLabel, suggestMbti, HABIT_KEYS, RHYTHM_KEYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
