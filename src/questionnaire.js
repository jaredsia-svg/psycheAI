// Questionnaire definitions plus scoring into a trait profile.
//
// Sections:
//  - Big Five (BFI-10 style: two items per trait, one reverse-keyed), 1-5 Likert
//  - Attachment style (anxiety + avoidance items), 1-5 Likert
//  - Values importance ratings, 1-5
//  - Love languages (pick top two)
//  - Lifestyle single-choice items
//  - Interests (multi-select tags)

const LIKERT = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' },
];

const IMPORTANCE = [
  { value: 1, label: 'Not important' },
  { value: 2, label: 'Slightly' },
  { value: 3, label: 'Moderately' },
  { value: 4, label: 'Very' },
  { value: 5, label: 'Essential' },
];

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
  {
    id: 'ls_chrono', text: 'Your natural rhythm:',
    options: [
      { value: 'early', label: 'Early bird' },
      { value: 'flex', label: 'Flexible' },
      { value: 'night', label: 'Night owl' },
    ],
  },
  {
    id: 'ls_social', text: 'Your ideal weekend:',
    options: [
      { value: 'out', label: 'Out with friends / events' },
      { value: 'mix', label: 'A bit of both' },
      { value: 'home', label: 'Quiet time at home' },
    ],
  },
  {
    id: 'ls_plan', text: 'When it comes to plans:',
    options: [
      { value: 'planner', label: 'I plan everything ahead' },
      { value: 'mix', label: 'Loose plans, open to change' },
      { value: 'spont', label: 'Fully spontaneous' },
    ],
  },
  {
    id: 'ls_conflict', text: 'In a disagreement I usually:',
    options: [
      { value: 'talk', label: 'Talk it through right away' },
      { value: 'cool', label: 'Cool off first, then talk' },
      { value: 'avoid', label: 'Avoid confrontation' },
    ],
  },
];

const INTEREST_TAGS = [
  'travel', 'foodie', 'fitness', 'yoga', 'running', 'hiking', 'photography',
  'music', 'live gigs', 'movies', 'gaming', 'reading', 'writing', 'art',
  'cooking', 'baking', 'coffee', 'wine', 'dancing', 'fashion', 'tech',
  'startups', 'investing', 'volunteering', 'pets', 'dogs', 'cats',
  'nature', 'beach', 'skiing', 'football', 'basketball', 'tennis', 'golf',
  'meditation', 'languages', 'history', 'science', 'anime', 'board games',
];

function clampLikert(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
}

// Convert raw answers into a normalised trait profile. All scale scores are 0-100.
function scoreAnswers(answers) {
  const traits = { bigFive: {}, attachment: {}, values: {}, loveLanguages: [], lifestyle: {} };

  // Big Five: average the two items per trait (reverse-keyed flipped), map 1-5 -> 0-100.
  const sums = {};
  for (const item of BIG_FIVE_ITEMS) {
    let v = clampLikert(answers[item.id]);
    if (item.reverse) v = 6 - v;
    (sums[item.trait] ||= []).push(v);
  }
  for (const [trait, vals] of Object.entries(sums)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    traits.bigFive[trait] = Math.round(((mean - 1) / 4) * 100);
  }

  // Attachment: mean anxiety and avoidance 0-100, then classify.
  const att = { anxiety: [], avoidance: [] };
  for (const item of ATTACHMENT_ITEMS) att[item.dim].push(clampLikert(answers[item.id]));
  for (const dim of ['anxiety', 'avoidance']) {
    const mean = att[dim].reduce((a, b) => a + b, 0) / att[dim].length;
    traits.attachment[dim] = Math.round(((mean - 1) / 4) * 100);
  }
  const { anxiety, avoidance } = traits.attachment;
  traits.attachment.style =
    anxiety < 50 && avoidance < 50 ? 'secure'
      : anxiety >= 50 && avoidance < 50 ? 'anxious'
        : anxiety < 50 && avoidance >= 50 ? 'avoidant'
          : 'fearful';

  for (const v of VALUES) traits.values[v.id] = clampLikert(answers['val_' + v.id]);

  const lls = Array.isArray(answers.love_languages) ? answers.love_languages : [answers.love_languages];
  traits.loveLanguages = LOVE_LANGUAGES.map(l => l.id).filter(id => lls.includes(id)).slice(0, 2);

  for (const q of LIFESTYLE) {
    const valid = q.options.map(o => o.value);
    traits.lifestyle[q.id] = valid.includes(answers[q.id]) ? answers[q.id] : valid[Math.floor(valid.length / 2)];
  }

  return traits;
}

module.exports = {
  LIKERT, IMPORTANCE, BIG_FIVE_ITEMS, ATTACHMENT_ITEMS, VALUES,
  LOVE_LANGUAGES, LIFESTYLE, INTEREST_TAGS, scoreAnswers,
};
