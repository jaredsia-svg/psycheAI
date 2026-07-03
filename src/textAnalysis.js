// Lightweight analysis of user-provided social/online text (bios, posts,
// LinkedIn "about" sections the user pastes in). We do NOT scrape platforms —
// scraping LinkedIn/Instagram/etc. violates their terms and needs official
// APIs — so the user pastes text they consent to having analysed.
//
// Output: interest tags detected in the text plus soft tone signals that are
// blended into the questionnaire-derived traits at low weight.

const { INTEREST_TAGS } = require('./questionnaire');

// Extra vocabulary mapping words -> canonical interest tags.
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

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9#@]+/)
    .filter(Boolean);
}

function analyzeSocialText(text) {
  const tokens = tokenize(text);
  const joined = ' ' + tokens.join(' ') + ' ';
  const interests = new Set();

  for (const tag of INTEREST_TAGS) {
    if (joined.includes(' ' + tag.toLowerCase() + ' ') || tokens.includes('#' + tag.replace(/\s+/g, ''))) {
      interests.add(tag);
    }
  }
  for (const [word, tag] of Object.entries(KEYWORD_MAP)) {
    if (tokens.includes(word) || tokens.includes('#' + word)) interests.add(tag);
  }

  // Tone: count signal hits, convert to a mild -10..+10 adjustment per trait.
  const toneAdjust = {};
  for (const [trait, words] of Object.entries(TONE_SIGNALS)) {
    let hits = 0;
    for (const w of words) if (joined.includes(' ' + w + ' ')) hits++;
    toneAdjust[trait] = Math.min(10, hits * 3);
  }

  return { interests: [...interests], toneAdjust, wordCount: tokens.length };
}

// Blend tone signals into questionnaire-derived Big Five scores (questionnaire
// dominates; social text only nudges).
function blendTraits(traits, analysis) {
  if (!analysis || analysis.wordCount < 10) return traits;
  const blended = JSON.parse(JSON.stringify(traits));
  for (const [trait, adj] of Object.entries(analysis.toneAdjust)) {
    if (blended.bigFive[trait] != null && adj > 0) {
      blended.bigFive[trait] = Math.min(100, blended.bigFive[trait] + adj);
    }
  }
  return blended;
}

module.exports = { analyzeSocialText, blendTraits };
