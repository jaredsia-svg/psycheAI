// Word lists behind the profile analysis.
//
// The trait markers follow the open-vocabulary tradition (Pennebaker's LIWC
// categories, Yarkoni 2010, Schwartz et al. 2013): language use correlates
// with personality, modestly but reliably, in the aggregate. Everything here
// is a *signal*, not a diagnosis — analysis.js reports confidence alongside
// every estimate and the questionnaire always overrides it.
(function (root) {
  'use strict';

  // ---------- Big Five language markers ----------
  // `pos` raises the trait estimate, `neg` lowers it.

  const TRAIT_MARKERS = {
    openness: {
      pos: ['art', 'museum', 'gallery', 'exhibition', 'poetry', 'novel', 'philosophy', 'design',
        'architecture', 'jazz', 'vinyl', 'film', 'cinema', 'documentary', 'curious', 'imagine',
        'wonder', '创', 'culture', 'abstract', 'theatre', 'ballet', 'opera', 'literature',
        'experiment', 'perspective', 'discover', 'explore', 'unusual', 'creative', 'idea',
        'ideas', 'dream', 'writing', 'sketch', 'painting', 'concept', 'meaning', 'universe'],
      neg: ['usual', 'same', 'routine', 'normal', 'boring', 'whatever', 'basic'],
    },
    conscientiousness: {
      pos: ['plan', 'planned', 'planning', 'goal', 'goals', 'discipline', 'disciplined', 'schedule',
        'progress', 'consistent', 'consistency', 'training', 'prepare', 'prepared', 'deadline',
        'organised', 'organized', 'checklist', 'routine', 'commit', 'committed', 'finished',
        'completed', 'achieved', 'achievement', 'milestone', 'graduated', 'certified', 'promotion',
        'launch', 'shipped', 'built', 'target', 'focus', 'focused', 'early', 'responsibility'],
      neg: ['messy', 'chaos', 'chaotic', 'procrastinate', 'procrastinating', 'lazy', 'oops',
        'forgot', 'late', 'whoops', 'random', 'lost', 'winging'],
    },
    extraversion: {
      pos: ['party', 'friends', 'squad', 'everyone', 'crowd', 'night', 'nightout', 'dancing',
        'drinks', 'karaoke', 'celebration', 'celebrate', 'birthday', 'gang', 'crew', 'reunion',
        'gathering', 'together', 'meetup', 'festival', 'concert', 'club', 'bar', 'cheers',
        'loud', 'hype', 'vibes', 'social', 'toast', 'wedding', 'dinner'],
      neg: ['alone', 'solitude', 'quiet', 'introvert', 'homebody', 'cosy', 'cozy', 'reading',
        'hermit', 'peaceful', 'solo', 'recharge'],
    },
    agreeableness: {
      pos: ['thank', 'thanks', 'thankful', 'grateful', 'gratitude', 'love', 'loved', 'lovely',
        'kind', 'kindness', 'sweet', 'beautiful', 'proud', 'congrats', 'congratulations',
        'support', 'supportive', 'appreciate', 'appreciated', 'blessed', 'care', 'caring',
        'help', 'helping', 'together', 'family', 'friend', 'gentle', 'warm', 'welcome',
        'amazing', 'wonderful', 'happy', 'miss', 'hug'],
      neg: ['hate', 'stupid', 'idiot', 'annoying', 'ugly', 'trash', 'worst', 'disgusting',
        'shut', 'damn', 'fuck', 'shit', 'wtf', 'ridiculous', 'pathetic', 'useless'],
    },
    neuroticism: {
      pos: ['anxious', 'anxiety', 'worried', 'worry', 'stress', 'stressed', 'overwhelmed',
        'exhausted', 'tired', 'sad', 'lonely', 'lonely', 'cry', 'crying', 'hurt', 'afraid',
        'scared', 'fear', 'panic', 'depressed', 'struggling', 'struggle', 'hard', 'difficult',
        'pain', 'painful', 'lost', 'insecure', 'doubt', 'regret', 'sorry', 'angry', 'upset',
        'frustrated', 'nervous', 'burnout', 'healing'],
      neg: ['calm', 'peace', 'peaceful', 'steady', 'grounded', 'content', 'relaxed', 'easy',
        'fine', 'chill', 'balanced', 'settled', 'okay'],
    },
  };

  // ---------- pronoun / style buckets ----------

  const SELF_WORDS = ['i', 'me', 'my', 'mine', 'myself', "i'm", 'im', "i've", "i'll'"];
  const SOCIAL_WORDS = ['we', 'us', 'our', 'ours', 'ourselves', 'together', 'everyone', 'y\'all'];

  // ---------- interest themes ----------
  //
  // `doc` links a theme to the questionnaire's own option list so an
  // Instagram signal can pre-tick the right box. `kind` separates the
  // document's "interests" list from its "fitness activities" list.

  const THEMES = [
    // --- questionnaire interests ---
    { id: 'tv', label: 'Watching TV', kind: 'interest', doc: 'Watching TV',
      words: ['netflix', 'series', 'season', 'episode', 'binge', 'kdrama', 'sitcom', 'hbo', 'streaming', 'tvshow'] },
    { id: 'art', label: 'Art & museums', kind: 'interest', doc: 'Art and museums',
      words: ['art', 'museum', 'gallery', 'exhibition', 'painting', 'sculpture', 'artist', 'louvre', 'biennale', 'curator'] },
    { id: 'reading', label: 'Reading', kind: 'interest', doc: 'Reading',
      words: ['book', 'books', 'reading', 'novel', 'bookstore', 'library', 'author', 'bookshelf', 'chapter', 'goodreads'] },
    { id: 'music', label: 'Listening to music', kind: 'interest', doc: 'Listening to music',
      words: ['music', 'spotify', 'playlist', 'album', 'song', 'band', 'concert', 'gig', 'vinyl', 'festival', 'dj'] },
    { id: 'karaoke', label: 'Karaoke', kind: 'interest', doc: 'Karaoke',
      words: ['karaoke', 'ktv', 'singing'] },
    { id: 'nightclubs', label: 'Nightclubs', kind: 'interest', doc: 'Nightclubs',
      words: ['clubbing', 'nightclub', 'nightlife', 'rave', 'afterparty', 'edm', 'techno', 'dancefloor', 'bottleservice'] },
    { id: 'bars', label: 'Bars', kind: 'interest', doc: 'Bars',
      words: ['bars', 'cocktail', 'cocktails', 'whisky', 'whiskey', 'wine', 'beer', 'pub', 'happyhour', 'speakeasy', 'aperitivo'] },
    { id: 'theatre', label: 'Theatre', kind: 'interest', doc: 'Theatre',
      words: ['theatre', 'theater', 'musical', 'broadway', 'westend', 'playhouse', 'opera', 'ballet'] },
    { id: 'comedy', label: 'Comedies', kind: 'interest', doc: 'Comedies',
      words: ['comedy', 'standup', 'improv', 'funny', 'meme', 'memes', 'jokes', 'humour', 'humor', 'lol'] },
    { id: 'boardgames', label: 'Board games', kind: 'interest', doc: 'Board games',
      words: ['boardgame', 'boardgames', 'catan', 'chess', 'mahjong', 'poker', 'monopoly', 'dnd', 'tabletop', 'puzzle'] },
    { id: 'cooking', label: 'Cooking', kind: 'interest', doc: 'Cooking',
      words: ['cooking', 'cook', 'recipe', 'baking', 'homemade', 'kitchen', 'sourdough', 'meal', 'mealprep', 'roast', 'pasta'] },
    { id: 'podcasts', label: 'Podcasts', kind: 'interest', doc: 'Podcasts',
      words: ['podcast', 'podcasts', 'episode', 'listening'] },
    { id: 'gaming', label: 'Gaming', kind: 'interest', doc: 'Gaming',
      words: ['gaming', 'gamer', 'playstation', 'xbox', 'nintendo', 'steam', 'valorant', 'fortnite', 'twitch', 'esports', 'mmo'] },
    { id: 'foodie', label: 'Foodie', kind: 'interest', doc: 'Foodie',
      words: ['food', 'foodie', 'restaurant', 'brunch', 'dinner', 'lunch', 'ramen', 'sushi', 'tasting', 'michelin', 'omakase', 'dessert', 'cafe', 'coffee', 'hawker', 'bbq'] },

    // --- questionnaire fitness activities ---
    { id: 'tennis', label: 'Tennis', kind: 'fitness', doc: 'Tennis', words: ['tennis', 'wimbledon', 'atp', 'wta', 'racquet'] },
    { id: 'badminton', label: 'Badminton', kind: 'fitness', doc: 'Badminton', words: ['badminton', 'shuttlecock'] },
    { id: 'basketball', label: 'Basketball', kind: 'fitness', doc: 'Basketball', words: ['basketball', 'nba', 'hoops', 'dunk', 'ballislife'] },
    { id: 'bouldering', label: 'Bouldering', kind: 'fitness', doc: 'Bouldering', words: ['bouldering', 'climbing', 'belay', 'crag', 'topout'] },
    { id: 'hiit', label: 'HIIT', kind: 'fitness', doc: 'HIIT', words: ['hiit', 'crossfit', 'wod', 'bootcamp', 'circuit', 'f45'] },
    { id: 'running', label: 'Running', kind: 'fitness', doc: 'Running', words: ['running', 'runner', 'marathon', 'halfmarathon', '10k', '5k', 'ultramarathon', 'strava', 'pacing'] },
    { id: 'cycling', label: 'Cycling', kind: 'fitness', doc: 'Cycling', words: ['cycling', 'cyclist', 'bike', 'biking', 'peloton', 'roadbike', 'mtb', 'gravel'] },
    { id: 'golf', label: 'Golf', kind: 'fitness', doc: 'Golf', words: ['golf', 'golfing', 'birdie', 'tee', 'fairway', 'handicap'] },
    { id: 'gym', label: 'Gym', kind: 'fitness', doc: 'Gym', words: ['gym', 'lifting', 'deadlift', 'squat', 'bench', 'workout', 'reps', 'hypertrophy', 'gains'] },
    { id: 'hiking', label: 'Hiking', kind: 'fitness', doc: 'Hiking', words: ['hiking', 'hike', 'trail', 'trek', 'trekking', 'summit', 'mountain', 'backpacking'] },
    { id: 'pickleball', label: 'Pickleball', kind: 'fitness', doc: 'Pickleball', words: ['pickleball'] },
    { id: 'diving', label: 'Scuba diving', kind: 'fitness', doc: 'Scuba diving', words: ['scuba', 'diving', 'divemaster', 'padi', 'freediving', 'reef', 'wreck'] },
    { id: 'yoga', label: 'Yoga', kind: 'fitness', doc: 'Yoga', words: ['yoga', 'asana', 'vinyasa', 'namaste', 'yogi', 'ashtanga'] },
    { id: 'pilates', label: 'Pilates', kind: 'fitness', doc: 'Pilates', words: ['pilates', 'reformer', 'barre'] },
    { id: 'dancing', label: 'Dancing', kind: 'fitness', doc: 'Dancing', words: ['dance', 'dancing', 'salsa', 'bachata', 'hiphopdance', 'ballet', 'choreography', 'zouk'] },

    // --- extra themes that colour the profile but aren't in the document ---
    { id: 'travel', label: 'Travel', kind: 'extra', words: ['travel', 'trip', 'flight', 'airport', 'wanderlust', 'passport', 'roadtrip', 'backpacking', 'vacation', 'holiday', 'itinerary', 'exploring', 'abroad'] },
    { id: 'photography', label: 'Photography', kind: 'extra', words: ['photography', 'photo', 'camera', 'lens', 'shot', 'portrait', 'filmphotography', 'leica', 'shooting', 'goldenhour'] },
    { id: 'fashion', label: 'Fashion & style', kind: 'extra', words: ['fashion', 'outfit', 'ootd', 'style', 'streetwear', 'runway', 'vintage', 'thrift', 'sneakers', 'tailoring'] },
    { id: 'pets', label: 'Pets & animals', kind: 'extra', words: ['dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'pet', 'rescue', 'adopted', 'vet', 'paws'] },
    { id: 'family', label: 'Family life', kind: 'extra', words: ['family', 'mum', 'mom', 'dad', 'parents', 'sister', 'brother', 'grandma', 'grandpa', 'nephew', 'niece', 'cousin', 'baby', 'son', 'daughter', 'kids', 'anniversary'] },
    { id: 'nature', label: 'Nature & outdoors', kind: 'extra', words: ['nature', 'sunset', 'sunrise', 'ocean', 'beach', 'forest', 'lake', 'camping', 'wildlife', 'garden', 'plants', 'sky'] },
    { id: 'tech', label: 'Tech', kind: 'extra', words: ['tech', 'coding', 'developer', 'software', 'startup', 'engineering', 'hackathon', 'github', 'programming'] },
    { id: 'business', label: 'Business & career', kind: 'extra', words: ['work', 'career', 'business', 'founder', 'entrepreneur', 'client', 'team', 'office', 'conference', 'keynote', 'hiring', 'promotion', 'launch', 'company'] },
    { id: 'finance', label: 'Money & investing', kind: 'extra', words: ['investing', 'invest', 'stocks', 'portfolio', 'crypto', 'bitcoin', 'property', 'savings', 'wealth', 'markets', 'trading'] },
    { id: 'wellness', label: 'Wellness & mindfulness', kind: 'extra', words: ['wellness', 'meditation', 'mindfulness', 'therapy', 'journaling', 'selfcare', 'breathwork', 'healing', 'balance', 'retreat'] },
    { id: 'faith', label: 'Faith & spirituality', kind: 'extra', words: ['god', 'jesus', 'church', 'blessed', 'prayer', 'pray', 'faith', 'bible', 'worship', 'allah', 'ramadan', 'eid', 'masjid', 'temple', 'buddha', 'dharma', 'gurdwara', 'guru', 'spiritual', 'grace', 'amen'] },
    { id: 'cause', label: 'Causes & volunteering', kind: 'extra', words: ['volunteer', 'volunteering', 'charity', 'fundraiser', 'donate', 'donation', 'nonprofit', 'community', 'awareness', 'climate', 'sustainability', 'equality', 'activism', 'protest'] },
    { id: 'learning', label: 'Learning & study', kind: 'extra', words: ['learning', 'study', 'studying', 'course', 'degree', 'masters', 'phd', 'exam', 'lecture', 'research', 'thesis', 'certification', 'language'] },
    { id: 'motors', label: 'Cars & motorsport', kind: 'extra', words: ['cars', 'motorsport', 'formula1', 'porsche', 'garage', 'motorbike', 'racing', 'supercar'] },
    { id: 'football', label: 'Football / soccer', kind: 'extra', words: ['football', 'soccer', 'premierleague', 'worldcup', 'fifa', 'matchday', 'arsenal', 'liverpool'] },
    { id: 'snow', label: 'Snow sports', kind: 'extra', words: ['skiing', 'snowboard', 'snowboarding', 'apres', 'slopes', 'chalet', 'offpiste'] },
    { id: 'watersports', label: 'Surf & water sports', kind: 'extra', words: ['surfing', 'kayak', 'paddleboard', 'sailing', 'wakeboard', 'kitesurf', 'swimming'] },
    { id: 'anime', label: 'Anime & comics', kind: 'extra', words: ['anime', 'manga', 'otaku', 'cosplay', 'comics', 'marvel', 'ghibli'] },
    { id: 'beauty', label: 'Beauty & grooming', kind: 'extra', words: ['skincare', 'makeup', 'beauty', 'salon', 'haircare', 'manicure', 'grooming', 'facial'] },
    { id: 'diy', label: 'Making & DIY', kind: 'extra', words: ['diy', 'woodworking', 'craft', 'knitting', 'pottery', 'ceramics', 'sewing', 'renovation', 'handmade'] },
  ];

  // ---------- value / priority markers ----------
  //
  // Keyed to the document's "priorities in life" option list.

  const VALUE_MARKERS = [
    { id: 'family', label: 'Family and relationships', words: ['family', 'wife', 'husband', 'partner', 'girlfriend', 'boyfriend', 'anniversary', 'parents', 'mum', 'mom', 'dad', 'siblings', 'home', 'together', 'wedding', 'engaged'] },
    { id: 'career', label: 'Career success', words: ['career', 'work', 'promotion', 'job', 'company', 'team', 'client', 'founder', 'launch', 'project', 'business', 'office', 'award', 'conference'] },
    { id: 'wealth', label: 'Becoming rich', words: ['wealth', 'rich', 'money', 'investing', 'portfolio', 'crypto', 'luxury', 'financial', 'passiveincome', 'millionaire'] },
    { id: 'happiness', label: 'Personal happiness and fulfilment', words: ['happy', 'happiness', 'joy', 'grateful', 'fulfilment', 'fulfillment', 'content', 'peace', 'smile', 'blessed', 'living'] },
    { id: 'health', label: 'Health and physical fitness', words: ['health', 'fitness', 'gym', 'training', 'workout', 'nutrition', 'running', 'strength', 'wellness', 'recovery', 'sleep'] },
    { id: 'passion', label: 'Pursuing your passion', words: ['passion', 'craft', 'obsessed', 'dream', 'calling', 'artist', 'creating', 'practice', 'devoted'] },
    { id: 'helping', label: 'Helping others and making a difference', words: ['volunteer', 'charity', 'donate', 'community', 'impact', 'giveback', 'support', 'mentor', 'nonprofit', 'fundraiser', 'awareness'] },
    { id: 'adventure', label: 'Adventure and travel', words: ['adventure', 'travel', 'explore', 'trip', 'wanderlust', 'roadtrip', 'summit', 'expedition', 'backpacking', 'abroad'] },
    { id: 'freedom', label: 'Freedom and creative expression', words: ['freedom', 'creative', 'create', 'expression', 'art', 'design', 'music', 'write', 'independent', 'myway', 'nomad'] },
    { id: 'stability', label: 'Security and stability', words: ['stability', 'savings', 'mortgage', 'insurance', 'secure', 'steady', 'longterm', 'plan', 'settled', 'routine'] },
    { id: 'spirituality', label: 'Spirituality', words: ['god', 'faith', 'prayer', 'church', 'spiritual', 'blessed', 'meditation', 'temple', 'soul', 'grace', 'allah', 'dharma'] },
    { id: 'kids', label: 'Raising kids', words: ['kids', 'baby', 'son', 'daughter', 'children', 'parenting', 'newborn', 'toddler', 'school', 'firstday'] },
    { id: 'legacy', label: 'Leaving a legacy', words: ['legacy', 'generations', 'impact', 'build', 'foundation', 'remembered', 'mission', 'purpose'] },
    { id: 'learning', label: 'Learning', words: ['learning', 'learn', 'study', 'course', 'book', 'curious', 'growth', 'reading', 'degree', 'skill', 'research'] },
  ];

  // ---------- love-language markers ----------

  const LOVE_MARKERS = [
    { id: 'touch', label: 'Physical touch', words: ['hug', 'hugs', 'cuddle', 'kiss', 'held', 'holding', 'snuggle', 'embrace'] },
    { id: 'gifts', label: 'Gifts', words: ['gift', 'gifts', 'present', 'surprise', 'bought', 'flowers', 'wrapped', 'delivery'] },
    { id: 'time', label: 'Quality time', words: ['together', 'datenight', 'date', 'trip', 'weekend', 'quality', 'hours', 'talked', 'walk'] },
    { id: 'acts', label: 'Acts of service', words: ['cooked', 'helped', 'drove', 'picked', 'fixed', 'made', 'looked', 'took care', 'supported'] },
    { id: 'words', label: 'Words of affirmation', words: ['proud', 'grateful', 'thank', 'appreciate', 'love you', 'admire', 'inspires', 'lucky'] },
  ];

  // ---------- descriptor suggestions ----------
  //
  // Maps the document's self-description list onto trait / theme evidence, so
  // the questionnaire can arrive pre-filled with defensible suggestions.

  const DESCRIPTOR_RULES = [
    { label: 'Having integrity', from: { conscientiousness: 0.6, agreeableness: 0.5 } },
    { label: 'Loyal', from: { agreeableness: 0.7 }, themes: { family: 0.4 } },
    { label: 'Kind', from: { agreeableness: 0.9 } },
    { label: 'Hardworking', from: { conscientiousness: 0.9 }, themes: { business: 0.4, learning: 0.2 } },
    { label: 'Humble', from: { agreeableness: 0.5, extraversion: -0.4 } },
    { label: 'Adventurous', from: { openness: 0.6 }, themes: { travel: 0.7, hiking: 0.4, diving: 0.3, snow: 0.3 } },
    { label: 'Resilient', from: { neuroticism: -0.4, conscientiousness: 0.5 }, themes: { running: 0.4, gym: 0.3 } },
    { label: 'Religious', themes: { faith: 1.2 } },
    { label: 'Growth mindset', from: { openness: 0.5, conscientiousness: 0.4 }, themes: { learning: 0.7, wellness: 0.3 } },
    { label: 'Generous', from: { agreeableness: 0.6 }, themes: { cause: 0.8 } },
    { label: 'Reflective and contemplative', from: { openness: 0.6, extraversion: -0.3 }, themes: { wellness: 0.6, reading: 0.4 } },
    { label: 'Spontaneous and adaptable', from: { conscientiousness: -0.6, openness: 0.4 } },
    { label: 'Intelligent', from: { openness: 0.7 }, themes: { learning: 0.5, tech: 0.4, reading: 0.4 } },
    { label: 'Easy-going', from: { neuroticism: -0.6, agreeableness: 0.4 } },
    { label: 'Humorous', from: { extraversion: 0.4 }, themes: { comedy: 1.0 } },
    { label: 'Organized', from: { conscientiousness: 0.9 } },
    { label: 'Simple', from: { openness: -0.4, neuroticism: -0.3 } },
    { label: 'Laid-back', from: { conscientiousness: -0.5, neuroticism: -0.4 } },
  ];

  root.KindredLexicon = {
    TRAIT_MARKERS, SELF_WORDS, SOCIAL_WORDS, THEMES,
    VALUE_MARKERS, LOVE_MARKERS, DESCRIPTOR_RULES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
