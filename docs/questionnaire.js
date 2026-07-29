// The guided questionnaire.
//
// Steps 1–3 reproduce the supplied Personality Test document question by
// question, in its order, with its option lists. A handful of extra questions
// are marked `extra: true` — they are the ones the compatibility engine needs
// but the document does not ask for (self-declared habits, so the other
// person's dealbreakers can actually be checked, plus rhythm and conflict
// style, which drive the "how to partner each other" advice). The UI labels
// them so it stays obvious what came from the document and what did not.
(function (root) {
  'use strict';

  const MBTI = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
    'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];

  const ENNEAGRAM = [
    '1 — The Reformer', '2 — The Helper', '3 — The Achiever', '4 — The Individualist',
    '5 — The Investigator', '6 — The Loyalist', '7 — The Enthusiast', '8 — The Challenger',
    '9 — The Peacemaker',
  ];

  const RELIGIONS = ['Buddhist', 'Christianity', 'Muslim', 'Hindu', 'Sikh', 'Agnostic', 'Atheist', 'Other'];

  const EDUCATION = ['High school', 'Undergrad', 'Post grad'];

  const DOC_INTERESTS = ['Watching TV', 'Art and museums', 'Reading', 'Listening to music', 'Karaoke',
    'Nightclubs', 'Bars', 'Theatre', 'Comedies', 'Board games', 'Cooking', 'Podcasts', 'Gaming', 'Foodie'];

  const DOC_FITNESS = ['Tennis', 'Badminton', 'Basketball', 'Bouldering', 'HIIT', 'Running', 'Cycling',
    'Golf', 'Gym', 'Hiking', 'Pickleball', 'Scuba diving', 'Yoga', 'Pilates', 'Dancing'];

  const DESCRIPTORS = ['Having integrity', 'Loyal', 'Kind', 'Hardworking', 'Humble', 'Adventurous',
    'Resilient', 'Religious', 'Growth mindset', 'Generous', 'Reflective and contemplative',
    'Spontaneous and adaptable', 'Intelligent', 'Easy-going', 'Humorous', 'Organized', 'Simple', 'Laid-back'];

  const PRIORITIES = ['Family and relationships', 'Career success', 'Becoming rich',
    'Personal happiness and fulfilment', 'Health and physical fitness', 'Pursuing your passion',
    'Helping others and making a difference', 'Adventure and travel', 'Freedom and creative expression',
    'Security and stability', 'Spirituality', 'Raising kids', 'Leaving a legacy', 'Learning', 'Others'];

  const QUALITIES = ['Kindness', 'Honesty', 'Humour', 'Loyalty', 'Ambition', 'Empathy', 'Intelligence',
    'Generosity', 'Adventurous', 'Physical attraction', 'Stability', 'Authenticity', 'Reflective'];

  const LOVE_LANGUAGES = ['Physical touch', 'Gifts', 'Quality time', 'Acts of service', 'Words of affirmation'];

  const CLOSENESS = [
    'I feel safe and it feels natural',
    'I get nervous and worried they will pull away',
    'I feel trapped and I need my space',
    'I feel torn as at times I want intimacy but at the same time I fear it',
  ];

  // The document's four closeness answers are, in order, the four adult
  // attachment styles — which is what the compatibility engine reasons over.
  const CLOSENESS_TO_ATTACHMENT = ['secure', 'anxious', 'avoidant', 'fearful'];

  const INGREDIENTS = ['Communication', 'Physical attraction', 'Chemistry', 'Friendship', 'Respect',
    'Compromise', 'Honesty', 'Fun', 'Teamwork', 'Vulnerability', 'Others'];

  const DEALBREAKERS = ['Infidelity', 'Anger issues', 'Smoking', 'Drinking', 'Drugs', 'Gambling',
    'Having too many friends of the opposite gender', 'Following IG models', 'Irresponsible spending', 'Others'];

  const BIG_FIVE_TRAITS = [
    { id: 'openness', label: 'Openness to experience', low: 'Practical, prefers the familiar', high: 'Curious, craves novelty' },
    { id: 'conscientiousness', label: 'Conscientiousness', low: 'Flexible, improvises', high: 'Organised, follows through' },
    { id: 'extraversion', label: 'Extraversion', low: 'Recharges alone', high: 'Recharges around people' },
    { id: 'agreeableness', label: 'Agreeableness', low: 'Blunt, competitive', high: 'Warm, accommodating' },
    { id: 'neuroticism', label: 'Emotional sensitivity', low: 'Even-keeled under stress', high: 'Feels things intensely' },
  ];

  const STEPS = [
    {
      id: 'background',
      title: 'Step 1 of 3 — Background',
      questions: [
        { id: 'country', type: 'text', required: true, text: 'Which country are you from?', placeholder: 'e.g. Singapore' },
        { id: 'education', type: 'single', required: true, text: 'What is your highest education level?', options: EDUCATION },
        { id: 'religion', type: 'single', required: true, text: 'What is your religion?', options: RELIGIONS },
        { id: 'occupation', type: 'text', required: true, text: 'What is your occupation?', placeholder: 'e.g. product designer' },
        {
          id: 'interests', type: 'multi', required: true, options: DOC_INTERESTS, allowOther: true,
          text: 'What interests do you have?',
          help: 'Pre-ticked from your Instagram activity — correct anything that is wrong.',
        },
        {
          id: 'fitness', type: 'multi', required: true, options: DOC_FITNESS, allowOther: true,
          text: 'What fitness activities are you interested in?',
          help: 'Also pre-ticked from Instagram.',
        },
      ],
    },
    {
      id: 'personality',
      title: 'Step 2 of 3 — Personality',
      questions: [
        {
          id: 'descriptors', type: 'multi', required: true, max: 3, options: DESCRIPTORS,
          text: 'Which of the following describes you the most? Choose top 3',
        },
        {
          id: 'priorities', type: 'multi', required: true, max: 3, options: PRIORITIES,
          text: 'What are your priorities in life? Choose top 3.',
          note: { id: 'priorities_note', label: 'Explain', rows: 3 },
        },
        {
          id: 'mbti', type: 'single', options: MBTI.concat(['Not sure']),
          text: 'What is your MBTI?',
          note: { id: 'mbti_note', label: 'Elaborate', rows: 2 },
          help: 'A suggestion is pre-selected from your Instagram-derived traits. MBTI is popular rather than validated — treat it as shorthand.',
        },
        {
          id: 'enneagram', type: 'single', options: ENNEAGRAM.concat(['Not sure']),
          text: 'What is your Enneagram?',
          note: { id: 'enneagram_note', label: 'Elaborate', rows: 2 },
          help: 'Nothing in an Instagram export predicts Enneagram type, so this one is left to you.',
        },
        {
          id: 'bigfive', type: 'sliders', traits: BIG_FIVE_TRAITS,
          text: 'What is your Big Five personality?',
          note: { id: 'bigfive_note', label: 'Elaborate', rows: 3 },
          help: 'Sliders start at the estimate drawn from your Instagram language and behaviour. Drag any that feel wrong — your answer wins.',
        },
        {
          id: 'personality_note', type: 'textarea', rows: 5,
          text: 'What else about your personality, values, interests, and beliefs is not covered in the above questions?',
        },
      ],
    },
    {
      id: 'relationships',
      title: 'Step 3 of 3 — Relationship preferences',
      subtitle: 'Both romantic and platonic',
      questions: [
        {
          id: 'qualities', type: 'multi', required: true, max: 3, options: QUALITIES,
          text: 'What qualities do you look out for in a partner or in friends? Choose top 3.',
          note: { id: 'qualities_note', label: 'Explain', rows: 3 },
        },
        {
          id: 'love_give', type: 'multi', required: true, options: LOVE_LANGUAGES,
          text: 'If you love someone deeply, how do you typically express your love to him / her?',
        },
        {
          id: 'love_receive', type: 'multi', required: true, options: LOVE_LANGUAGES,
          text: 'How do you like to receive love from your loved ones that would make you feel truly appreciated and cared for?',
        },
        {
          id: 'closeness', type: 'single', required: true, options: CLOSENESS,
          text: 'How do you usually feel when someone gets really close to you emotionally?',
        },
        {
          id: 'ingredients', type: 'multi', required: true, max: 3, options: INGREDIENTS,
          text: 'In your opinion, what are important ingredients of a good relationship or friendship? Choose top 3.',
          note: { id: 'ingredients_note', label: 'Explain', rows: 3 },
        },
        {
          id: 'dealbreakers', type: 'multi', required: true, options: DEALBREAKERS,
          text: 'Which of the following are dealbreakers for you for your loved ones?',
          note: { id: 'dealbreakers_note', label: 'Explain', rows: 3 },
        },
        {
          id: 'relationship_note', type: 'textarea', rows: 5,
          text: 'What else do you seek for in a partner or in a friend? Is there anything mentioned above that is especially important or a dealbreaker to you? Be as detailed as possible (optional)',
        },
        {
          id: 'habits', type: 'grid', extra: true,
          text: 'Your own habits',
          help: 'Dealbreakers can only be checked against something. These are self-declared and shared in your QR code exactly as you set them.',
          rows: [
            { id: 'smoking', label: 'Smoking', options: ['Never', 'Socially', 'Regularly'] },
            { id: 'drinking', label: 'Drinking', options: ['Never', 'Socially', 'Regularly'] },
            { id: 'gambling', label: 'Gambling', options: ['Never', 'Occasionally', 'Regularly'] },
            { id: 'spending', label: 'Money style', options: ['Saver', 'Balanced', 'Spender'] },
            { id: 'opposite_friends', label: 'Close friends of the opposite gender', options: ['Few', 'Some', 'Many'] },
            { id: 'kids', label: 'Wanting kids', options: ['Yes', 'Unsure', 'No'] },
          ],
        },
        {
          id: 'rhythm', type: 'grid', extra: true,
          text: 'Your rhythm and conflict style',
          help: 'Drives the practical advice in your compatibility reports. The first three are pre-set from your Instagram activity patterns.',
          rows: [
            { id: 'chronotype', label: 'Natural rhythm', options: ['Early bird', 'Flexible', 'Night owl'] },
            { id: 'social_energy', label: 'Ideal weekend', options: ['Out and social', 'A bit of both', 'Quiet at home'] },
            { id: 'planning', label: 'Plans', options: ['Planned ahead', 'Loose plans', 'Spontaneous'] },
            { id: 'conflict', label: 'In a disagreement I', options: ['Talk it out now', 'Cool off, then talk', 'Avoid confrontation'] },
          ],
        },
      ],
    },
  ];

  function allQuestions() {
    const out = [];
    for (const step of STEPS) out.push(...step.questions);
    return out;
  }

  function questionById(id) {
    return allQuestions().find(q => q.id === id) || null;
  }

  // A blank answer sheet, so every code path can assume the keys exist.
  function emptyAnswers() {
    const answers = {};
    for (const q of allQuestions()) {
      if (q.type === 'multi') answers[q.id] = [];
      else if (q.type === 'grid') { answers[q.id] = {}; for (const r of q.rows) answers[q.id][r.id] = ''; }
      else if (q.type === 'sliders') { answers[q.id] = {}; for (const t of q.traits) answers[q.id][t.id] = 50; }
      else answers[q.id] = '';
      if (q.note) answers[q.note.id] = '';
    }
    answers.other_interests = '';
    answers.other_fitness = '';
    return answers;
  }

  function missingRequired(answers) {
    const missing = [];
    for (const step of STEPS) {
      for (const q of step.questions) {
        if (!q.required) continue;
        const value = answers[q.id];
        const empty = q.type === 'multi' ? !(value && value.length) : !String(value || '').trim();
        if (empty) missing.push({ step: step.id, id: q.id, text: q.text });
      }
    }
    return missing;
  }

  root.KindredQuestions = {
    STEPS, MBTI, ENNEAGRAM, RELIGIONS, EDUCATION, DOC_INTERESTS, DOC_FITNESS,
    DESCRIPTORS, PRIORITIES, QUALITIES, LOVE_LANGUAGES, CLOSENESS, CLOSENESS_TO_ATTACHMENT,
    INGREDIENTS, DEALBREAKERS, BIG_FIVE_TRAITS,
    allQuestions, questionById, emptyAnswers, missingRequired,
  };
})(typeof window !== 'undefined' ? window : globalThis);
