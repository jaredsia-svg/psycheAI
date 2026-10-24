// The topic pages (tools/seo-pages.mjs): one question people search for each,
// answered properly, with a way into the app. Static HTML, readable without
// JavaScript. Claims here must stay true to what the app does.
export const TOPICS = [
  {
    slug: 'psyche-personality-test',
    title: 'Psyche personality test: free, no questions | PsycheAI',
    description: 'The Psyche personality test reads your MBTI, Big Five, love languages, values and the character you are most like from your own Instagram data. No quiz.',
    h1: 'The Psyche personality test',
    lede: 'Most personality tests ask you questions about yourself. The Psyche personality test asks none: it reads how you actually behave in your own Instagram data, and shows the evidence for every result.',
    sections: [
      ['What it measures', '<ul class="ticks"><li><strong>MBTI</strong>: your four letters, each with how clearly it showed (slight, moderate or clear). <a href="/mbti-types">The 16 types</a>.</li><li><strong>The Big Five</strong>: openness, conscientiousness, extraversion, agreeableness and emotional sensitivity, each scored 0 to 100. <a href="/big-five-personality-test">More on the Big Five</a>.</li><li><strong>Love languages</strong>: how you show care, and in the Psyche Report how you like to receive it. <a href="/love-language-test">More on love languages</a>.</li><li><strong>Values, motivations and interests</strong>: what you stand for and what you keep coming back to.</li><li><strong>Your patterns</strong>: three habits of yours, named, with the evidence behind each.</li><li><strong>The character you are most like</strong>, by temperament, never by looks. <a href="/characters">Which character are you?</a></li></ul>'],
      ['How it works', '<ol class="guide-steps"><li>Request your data from Instagram. It takes about 30 seconds, and the file usually arrives within 1–2 hours. <a href="/download-instagram-data">Step-by-step guide</a>.</li><li>Load the file in PsycheAI. It is read in your own browser and reduced to a short, de-identified digest of your own activity, which you can review.</li><li>Your Psyche Card is written from that digest, with a signal strength score saying how much evidence there was.</li></ol>'],
      ['Why no questions', '<p>A questionnaire measures how you see yourself on the day you answer it. Years of your own posts, comments and messages show what you actually do. That is harder to fake and often more interesting, because it can show the patterns you would not think to mention.</p>'],
      ['Card, report and coach', '<p>Your free <strong>Psyche Card</strong> is a shareable summary of all of the above. The <strong>Psyche Report</strong> explains every part with the evidence, and adds your wellbeing, attachment style, career strengths and a development plan. <a href="/ai-personality-coach">Ask PsycheAI</a> then answers your own questions about it, as a coach that has read your report.</p>'],
    ],
    faq: [
      ['Is the Psyche personality test free?', 'Yes. Your first Psyche Card and Psyche Report are free, together.'],
      ['How long does it take?', 'About a minute once your Instagram data has arrived. Requesting it takes about 30 seconds.'],
      ['Is it accurate?', 'It is an inference from behaviour, not a clinical measurement, and it says how confident it is. More of your own writing gives a stronger signal; you can add WhatsApp chats or Google and Facebook data to sharpen it.'],
      ['Do I need an account?', 'No. There is no account. Your results stay in your browser until you delete them.'],
    ],
  },
  {
    slug: 'ai-personality-coach',
    title: 'AI personality coach that already knows you | PsycheAI',
    description: 'Ask PsycheAI is an AI coach that has read your personality report, built from your own Instagram data. Ask about your work, friendships and habits.',
    h1: 'An AI coach that already knows you',
    lede: 'A coach is only as good as what they know about you. Ask PsycheAI starts with your Psyche Report, read from your own Instagram data, so you can skip the background and ask the real question.',
    sections: [
      ['What it knows', '<p>Ask PsycheAI answers from your Psyche Card and Psyche Report and the de-identified digest they were written from: your type, your Big Five scores, your patterns, your values and the evidence behind each. It does not have your Instagram file, your photos or your full messages.</p>'],
      ['What you can ask', '<ul class="ticks"><li>Why do I go quiet after a busy week?</li><li>What kind of work suits the way I plan?</li><li>How do I tell a friend I need more space without hurting them?</li><li>Which of my patterns is most likely to hold me back, and what is one thing to try?</li><li>How can I show care to someone whose love language is different from mine?</li></ul>'],
      ['An example', '<p>One of the sample report’s three patterns is <em>Bursts, then recovery</em>: posts in clusters around events the reader arranged, then a quiet fortnight. Asked “Why do I go quiet after a busy week?”, the coach would start there: the quiet is recovery, not withdrawal, and the useful move is to plan for it, for example by telling the people who rely on you when a quiet stretch is coming, rather than to fight it. <a href="/sample-report">See the sample report</a>.</p>'],
      ['How it is different', '<p>A general chatbot knows only what you type into it. Ask PsycheAI begins from a full personality study of your own behaviour, so its answers are tied to evidence about you, and it says when the evidence is thin.</p>'],
    ],
    faq: [
      ['How much does Ask PsycheAI cost?', 'Your first question is free with your Psyche Card. After that, five questions are US$5, and each friend who makes their card from your link earns you five more.'],
      ['Is it therapy?', 'No. Answers are coaching and general information, not medical, psychological or professional advice.'],
      ['Is what I ask kept?', 'Your questions and answers are kept in your browser, not by PsycheAI. To answer, the question goes to Google Gemini with your report and digest, on Google Cloud’s enterprise tier, where they are not used to train AI.'],
      ['Do I need to pay first?', 'No. Your first Psyche Card and Psyche Report are free, and your first question comes with them.'],
    ],
  },
  {
    slug: 'love-language-test',
    title: 'Love language test without questions | PsycheAI',
    description: 'Find your love languages without a quiz: how you like to receive care and how you show it, read from your own Instagram messages and posts.',
    h1: 'Your love languages, without a quiz',
    lede: 'Quizzes ask how you would like to be loved. PsycheAI looks at how you actually behave with the people close to you: what you write, what you remember, how you show up.',
    sections: [
      ['The five love languages', '<p>The love languages are five ways people tend to give and receive care: <strong>words of affirmation</strong>, <strong>quality time</strong>, <strong>acts of service</strong>, <strong>gifts</strong> and <strong>physical touch</strong>. Most people lean on one or two, and the way someone likes to receive care is often different from the way they give it.</p>'],
      ['How your data shows them', '<ul class="ticks"><li><strong>Words of affirmation</strong> show in warm comments, thank-yous and the encouragement you write to friends.</li><li><strong>Quality time</strong> shows in plans you make, meet-ups you post and long conversations you keep going.</li><li><strong>Acts of service</strong> show in the favours, help and logistics you take on in your messages.</li><li><strong>Gifts</strong> show in what you mark and celebrate: birthdays, surprises, things you buy for people.</li><li><strong>Physical touch</strong> is hardest to see in data, so it is named only when the evidence is clear.</li></ul>'],
      ['Receiving and giving, separately', '<p>Your Psyche Card shows how you tend to <strong>show</strong> care, strongest first. The Psyche Report adds how you like to <strong>receive</strong> it, and explains each with the moments in your own data that point to it.</p>'],
      ['Using it with friends and family', '<p>Love languages are most useful between two people. Send a friend or family member your Psyche Card link and Psyche Sync compares how each of you shows care, with simple things each of you could do for the other. It is free, and never about romance.</p>'],
    ],
    faq: [
      ['Is this the official love languages test?', 'No. The five love languages come from Gary Chapman’s book; PsycheAI is not connected to it. It gives a reading inferred from your behaviour, not a questionnaire score.'],
      ['Do I need to answer any questions?', 'No. Your love languages are read from your own Instagram data, alongside your MBTI, Big Five and values.'],
      ['Is it free?', 'Yes. Your first Psyche Card, love languages included, is free.'],
    ],
  },
  {
    slug: 'big-five-personality-test',
    title: 'Big Five personality test without questions | PsycheAI',
    description: 'Your Big Five traits (openness, conscientiousness, extraversion, agreeableness, emotional sensitivity) read from your own Instagram data. No questionnaire.',
    h1: 'A Big Five personality test without a questionnaire',
    lede: 'The Big Five is the personality model most research uses. PsycheAI scores all five from how you actually behave in your own data, and shows the evidence behind each score.',
    sections: [
      ['The five traits', '<ul class="ticks"><li><strong>Openness</strong>: curiosity, imagination and appetite for new things.</li><li><strong>Conscientiousness</strong>: planning, follow-through and reliability.</li><li><strong>Extraversion</strong>: energy from people and activity, measured by the breadth of people you seek out rather than how much you talk.</li><li><strong>Agreeableness</strong>: warmth, cooperation and how you handle disagreement.</li><li><strong>Emotional sensitivity</strong> (often called neuroticism): how strongly you feel stress and worry.</li></ul>'],
      ['How behaviour is scored', '<p>Each trait is read from patterns, not single posts: how regularly you post and follow through on plans, how many different people you talk to, how you reply when a conversation turns tense, how wide your interests range. Scores run from 0 to 100, and each comes with the evidence that supports it.</p>'],
      ['Why not just answer questions?', '<p>Questionnaires measure how you see yourself. Behaviour shows what you actually do, which can be different, and more interesting. Both are useful; this one needs no forms and nothing to remember.</p>'],
      ['What you get', '<p>Your free Psyche Card shows all five scores alongside your MBTI, values, interests and the character you are most like. The Psyche Report explains each score with the evidence and what it means for your relationships and work.</p>'],
    ],
    faq: [
      ['How accurate is a Big Five read from social media?', 'It is an inference, not a clinical measurement, and it says how confident it is. Accounts with more of your own writing give a clearer read.'],
      ['What is the difference between the Big Five and MBTI?', 'MBTI sorts people into 16 types; the Big Five scores five traits on a scale. PsycheAI shows both.'],
      ['Is it free?', 'Yes. Your first Psyche Card, with all five scores, is free.'],
    ],
  },
  {
    slug: 'what-instagram-knows-about-you',
    title: 'What Instagram knows about you, from your data | PsycheAI',
    description: 'What is in your Instagram data download, from posts and messages to searches and ad interests, and what it can reveal about your personality.',
    h1: 'What Instagram knows about you',
    lede: 'Instagram lets you download everything it holds about your account. Most people never look inside. Here is what is in there, and what it says about you.',
    sections: [
      ['What is in the download', '<ul class="ticks"><li><strong>Your content</strong>: posts, stories, reels and their captions.</li><li><strong>Your activity</strong>: likes, comments, saved posts, searches and the accounts you follow.</li><li><strong>Messages</strong>: your direct messages, with timestamps.</li><li><strong>How Instagram sees you</strong>: topics and ad interests it has inferred about you.</li><li><strong>Account information</strong>: your profile, login and device history.</li></ul>'],
      ['What it can reveal', '<p>Together these are a detailed record of how you spend attention and how you treat people: when you are active, who you talk to and how, what you return to, and what you announce but never mention again. That is the material a personality reading is built from.</p>'],
      ['How PsycheAI reads it, privately', '<p>PsycheAI opens your download inside your own browser. The zip, your photos and your full messages never leave your device. A short summary of your own activity is de-identified first, you review it, and only then is it sent to Google Gemini or Anthropic Claude to write your reading. PsycheAI keeps no copy.</p>'],
      ['How to get your data', '<p>It takes about 30 seconds to request, and Instagram emails you the file, usually within 1–2 hours. <a href="/download-instagram-data">Follow the step-by-step guide</a>, choosing JSON format and All time.</p>'],
    ],
    faq: [
      ['Can Instagram see what I do with my download?', 'No. Once downloaded, the file is yours, and PsycheAI reads it on your own device.'],
      ['Does PsycheAI read my photos?', 'No. Photos and videos are never read or uploaded; only text and activity counts are used.'],
      ['How do I delete what PsycheAI saved?', 'Everything is kept in your browser. Press Delete everything in the app to remove it.'],
    ],
  },
  {
    slug: 'instagram-data-download-help',
    title: 'Instagram data download not working? Fixes | PsycheAI',
    description: 'Fixes for common Instagram data download problems: HTML instead of JSON, a missing email, an expired link, several zip files, and finding the setting.',
    h1: 'Instagram data download not working? Common fixes',
    lede: 'Requesting your Instagram data is quick, but a few small settings decide whether the file works. Here are the problems people run into most, and how to fix each.',
    sections: [
      ['You chose HTML instead of JSON', '<p>The download has two formats. PsycheAI needs <strong>JSON</strong>; an HTML download cannot be read. Request a new download and set Format to JSON before you confirm.</p>'],
      ['Only part of your history is there', '<p>The date range defaults to a recent slice. Set Date range to <strong>All time</strong>, or the reading will only see the last few months.</p>'],
      ['The email has not arrived', '<p>Instagram usually takes 1–2 hours, sometimes longer for large accounts. Check your spam folder and the email address on your account. You can also see the request’s progress in the Download your information screen.</p>'],
      ['The download link has expired', '<p>The link Instagram sends only works for a few days. If it has expired, request a new download; it is quick to do again.</p>'],
      ['Your download came as several zip files', '<p>Large accounts can arrive in parts. Load all of them at once: PsycheAI reads them together.</p>'],
      ['You cannot find the setting', '<p>Open Instagram, go to your profile, tap the menu (≡) at the top right, then <strong>Accounts Centre</strong> → <strong>Your information and permissions</strong> → <strong>Download your information</strong>. <a href="/download-instagram-data">The illustrated guide</a> shows every screen.</p>'],
      ['The file is too big', '<p>Set Media quality to <strong>Lower</strong>. Your photos and videos are never read, so lower quality only makes the download smaller and faster.</p>'],
    ],
    faq: [
      ['How long does Instagram take to send my data?', 'Usually 1–2 hours. Large accounts can take longer.'],
      ['Can I use the file on my phone?', 'Yes. Save the zip to Files (iPhone) or Downloads (Android), then load it in PsycheAI in Safari or Chrome.'],
      ['Is my data safe?', 'The zip is read in your own browser and never uploaded. Only a short, de-identified summary you review is sent for the reading.'],
    ],
  },
  {
    slug: 'best-friend-compatibility-test',
    title: 'Best friend compatibility test, free, no quiz | PsycheAI',
    description: 'How in sync are you with your best friend, sibling or family member? A free Psyche Sync compares two Psyche Cards: what clicks and how to relate better.',
    h1: 'How in sync are you with your best friend?',
    lede: 'Psyche Sync compares two Psyche Cards and shows where you align, where you differ and how each of you can relate better to the other. For best friends, siblings, cousins or anyone close.',
    sections: [
      ['How it works', '<ol class="guide-steps"><li>Each of you makes a free Psyche Card from your own Instagram data.</li><li>One of you sends the other their personal link.</li><li>One tap shows your Psyche Sync. You can choose to share the result with them.</li></ol>'],
      ['What it compares', '<p>Your energy and how much contact you each like, your shared interests, your values, how each of you shows care, and how you each handle a disagreement. Each point comes with the evidence from both cards.</p>'],
      ['For friends and family alike', '<p>The reading never assumes what you are to each other. It works the same for a best friend, a sibling or a parent, and it is never romantic.</p>'],
      ['No score, no verdict', '<p>There is no percentage and no ranking. Differences are written as differences, each with a way to make it work, so it is something you can share without anyone feeling judged.</p>'],
    ],
    faq: [
      ['Is it free?', 'Yes. Psyche Sync is free, and so is each person’s first Psyche Card.'],
      ['Does my friend see my data?', 'No. Your link carries only your card’s short summary, never your data, messages or report.'],
      ['Can I do it with my sister or brother?', 'Yes. Psyche Sync is for any two people who know each other.'],
    ],
  },

  // ---------- three honest lists and three questions (published 24 October 2026) ----------
  // The comparisons describe each tool by how it works, not by a price, which
  // changes; PsycheAI is named as ours. A new topic can be marked `draft: true`
  // to be read at its address first: noindex, and out of the sitemap and
  // llms.txt until the flag is deleted.
  {
    slug: 'best-free-personality-tests',
    title: 'Best free personality tests in 2026 | PsycheAI',
    description: 'The best free personality tests in 2026 compared: 16Personalities, Truity, Big Five research tests, and PsycheAI, which asks no questions.',
    h1: 'The best free personality tests in 2026',
    lede: 'The short answer: for a quick, popular type, take 16Personalities; for research-grade Big Five scores, take an IPIP-based test; for a reading of how you actually behave rather than how you see yourself, try PsycheAI, which asks no questions at all. Most good tests give a free result and charge for a longer report.',
    sections: [
      ['The list', '<ol class="guide-list"><li><h3>16Personalities</h3><p>The best known. A questionnaire of about a dozen minutes gives you a four-letter type with a fifth letter for how assertive or turbulent you are, and a long free profile. Premium reports and courses are paid. <strong>Best for:</strong> a quick, widely recognised type to compare with friends.</p></li><li><h3>Truity</h3><p>Several free tests from one place: a 16-type test (TypeFinder), the Big Five, the Enneagram and career tests. Each gives a free basic result, with an optional paid full report. <strong>Best for:</strong> trying more than one framework, and career-focused results.</p></li><li><h3>IPIP-based Big Five tests</h3><p>Free questionnaires built on the International Personality Item Pool, the open set of items researchers use, offered by projects such as the Open-Source Psychometrics Project. Plain scores, little interpretation. <strong>Best for:</strong> the measure psychologists rely on most, without a sales pitch. <a href="/big-five-personality-test">More on the Big Five</a>.</p></li><li><h3>The official love languages quiz</h3><p>A free quiz from the five love languages books, on how you like to give and receive care. <strong>Best for:</strong> relationships, not personality as a whole. <a href="/love-language-test">More on love languages</a>.</p></li><li><h3>PsycheAI (ours)</h3><p>No questions. You load your own Instagram data (and, if you like, WhatsApp, Google or Facebook), and it reads your MBTI, Big Five, love languages, values and the character you are most like from how you actually behave, with the evidence for each result. Your first Psyche Card and Psyche Report are free. <strong>Best for:</strong> anyone tired of answering questions about themselves, or who suspects their answers would be wishful. <a href="/psyche-personality-test">How it works</a>.</p></li></ol>'],
      ['Questionnaire or behaviour?', '<p>Every questionnaire measures how you see yourself on the day you answer: people answer as the person they would like to be, and their results drift between attempts. A reading from behaviour has the opposite strength and weakness: it is harder to fake, but it is an inference, and only as good as the data behind it. The two are best side by side. If a test from behaviour gives you a different type from a questionnaire, the difference is usually the interesting part.</p>'],
      ['How to choose', '<ul class="ticks"><li><strong>Want a type to talk about with friends?</strong> 16Personalities, or the <a href="/mbti-test-no-questions">MBTI without questions</a>.</li><li><strong>Want the most scientific measure?</strong> An IPIP Big Five test.</li><li><strong>Want to see yourself as others see you?</strong> A reading from your own behaviour, like PsycheAI.</li><li><strong>Want it for a friendship?</strong> See <a href="/best-friendship-compatibility-tests">the best friendship compatibility tests</a>.</li></ul>'],
    ],
    faq: [
      ['Which free personality test is the most accurate?', 'For the Big Five, tests built on the research item pool (IPIP) are the best studied. Type tests are popular rather than precise: many people get a different type on a second attempt. A reading from behaviour avoids self-report bias but is an inference, so it says how confident it is.'],
      ['Is there a personality test with no questions?', 'Yes. PsycheAI reads your personality from your own Instagram data instead of a questionnaire. Your first reading is free.'],
      ['Are free personality tests really free?', 'Most give a free result and sell a longer report. Check what the free result includes before you start.'],
    ],
  },
  {
    slug: 'best-ai-life-coach-apps',
    title: 'Best AI life coach apps in 2026 | PsycheAI',
    description: 'AI life coach apps in 2026 compared by what they know about you: chat, journals, goals or your own data. Rocky.ai, Rosebud, Pi, Purpose and more.',
    h1: 'The best AI life coach apps in 2026',
    lede: 'The short answer: almost every AI coach knows only what you tell it, in chat or a journal. Pick by how you like to work: daily goals (Rocky.ai), journaling (Rosebud, Mindsera), open conversation (Pi, ChatGPT, Claude) or a coach that challenges you (Purpose). PsycheAI is the one that starts from your actual behaviour, read from your own data.',
    sections: [
      ['The list', '<ol class="guide-list"><li><h3>Rocky.ai</h3><p>A daily coaching chat: reflective questions, goals and check-ins that hold you to them, with a free tier. <strong>Knows you from:</strong> what you tell it each day. <strong>Best for:</strong> building a habit of reflection.</p></li><li><h3>Rosebud and Mindsera</h3><p>AI journals: you write, and they reflect patterns back, ask follow-up questions and summarise your entries over time. <strong>Knows you from:</strong> your journal. <strong>Best for:</strong> people who already like writing things down.</p></li><li><h3>Pi, ChatGPT and Claude</h3><p>General assistants, warm and capable, and good to think aloud with. With memory turned on they remember what you have said before. <strong>Knows you from:</strong> your conversations, and whatever you upload. <strong>Best for:</strong> working through one problem at a time.</p></li><li><h3>Purpose</h3><p>A coaching app from the author Mark Manson, built to challenge your assumptions rather than reassure you. <strong>Knows you from:</strong> chat and a values intake. <strong>Best for:</strong> people who want to be pushed.</p></li><li><h3>BetterUp</h3><p>Human coaches with AI support, mostly through employers. <strong>Knows you from:</strong> assessments and sessions. <strong>Best for:</strong> work and leadership, if your company offers it.</p></li><li><h3>Ask PsycheAI (ours)</h3><p>Starts from a full personality study of your own Instagram data (and, if you like, WhatsApp, Google or Facebook): your type, traits, patterns and values, each with its evidence. You skip the background and ask the real question, such as <a href="/am-i-in-the-wrong-job">am I in the wrong job?</a> or <a href="/what-will-i-regret-when-im-old">what will I regret when I am old?</a> Your first question is free. <strong>Knows you from:</strong> what you actually do. <strong>Best for:</strong> deep questions about yourself.</p></li></ol>'],
      ['Why where the advice comes from matters', '<p>A coach that knows only what you tell it can only work with the story you already believe about yourself. That is fine for goals and accountability. For the hard questions, what you are avoiding, what you will regret, why a pattern keeps repeating, the most useful evidence is often what you would not think to say. That is the gap a coach built on your own behaviour fills.</p>'],
      ['A note on privacy', '<p>Uploading your raw Instagram or chat history to a general chatbot sends everything, names and all, to its servers as it is. PsycheAI reads your files on your own device and sends only a de-identified summary. <a href="/faq">How PsycheAI handles your data</a>.</p>'],
    ],
    faq: [
      ['What is the best free AI life coach?', 'Several have free tiers: Rocky.ai for daily goals, Pi and ChatGPT for conversation. PsycheAI gives a free personality reading and one free question to its coach.'],
      ['Can an AI coach replace a therapist?', 'No. AI coaches are for reflection and everyday decisions. For anything affecting your health or safety, talk to someone qualified.'],
      ['Which AI coach knows me best?', 'Most know only what you tell them. PsycheAI starts from a study of your own data, so it can point to patterns you might not mention.'],
    ],
  },
  {
    slug: 'best-friendship-compatibility-tests',
    title: 'Best friendship compatibility tests 2026 | PsycheAI',
    description: 'Ways to test friendship compatibility in 2026: BFF quizzes, MBTI charts, love language quizzes, and Psyche Sync, which compares two real readings.',
    h1: 'The best friendship compatibility tests in 2026',
    lede: 'The short answer: BFF quiz apps test how well you know each other; MBTI compatibility charts guess from your types alone; love language quizzes compare how you show care. Psyche Sync, from PsycheAI, compares two full personality readings from each person’s own data, for free.',
    sections: [
      ['The list', '<ol class="guide-list"><li><h3>BFF quiz apps</h3><p>One friend writes ten questions about themselves and the other guesses. Fun, fast and free. <strong>Measures:</strong> how well you know each other, not whether you suit each other.</p></li><li><h3>MBTI compatibility charts</h3><p>Tables that rate each pair of the 16 types. Free and everywhere. <strong>Measures:</strong> a guess from four letters each, the same for every pair with those types. <a href="/mbti-types">The 16 types</a>.</p></li><li><h3>Love language quizzes</h3><p>Each of you takes the quiz and compares how you like to give and receive care. <strong>Measures:</strong> one thing, but a useful one. <a href="/love-language-test">Love languages without a quiz</a>.</p></li><li><h3>Psyche Sync (ours)</h3><p>Each of you makes a free Psyche Card from your own Instagram data, then one link compares them: where you align, where you differ, and what each of you can do for the other, with the evidence from both cards. No score and no verdict, and never romantic. <strong>Measures:</strong> your actual temperaments, side by side. <a href="/best-friend-compatibility-test">How Psyche Sync works</a>.</p></li></ol>'],
      ['What makes a friendship test worth taking', '<ul class="ticks"><li><strong>It looks at you both, not your labels.</strong> Two people of the same type can be very different friends.</li><li><strong>It explains, rather than scores.</strong> A percentage invites a fight; a difference with a way to handle it is something you can share.</li><li><strong>It respects your privacy.</strong> Psyche Sync shares only each card’s short summary, never your data or messages.</li></ul>'],
    ],
    faq: [
      ['Is there a free friendship compatibility test?', 'Yes. Psyche Sync is free, and so is each person’s first Psyche Card. BFF quiz apps and MBTI charts are usually free too.'],
      ['Does MBTI compatibility work?', 'As a conversation starter. Type charts give the same answer for every pair with those letters, so they miss most of what makes a friendship work.'],
      ['Can I compare with a sibling or parent?', 'Yes. Psyche Sync works for any two people who know each other.'],
    ],
  },
  {
    slug: 'am-i-in-the-wrong-job',
    title: 'Am I in the wrong job? How to tell | PsycheAI',
    description: 'Am I in the wrong job, or am I the problem? Signs it is the job, signs it is the part of the job, and how your own behaviour shows which part you love.',
    h1: 'Am I in the wrong job?',
    lede: 'The short answer: often it is not the whole job but the part of it you spend most time on. If every new job feels good for a few months and then the same feeling comes back, change what you do inside the job before you change the job. Your own behaviour, the work you talk about with energy, usually shows which part that is.',
    sections: [
      ['Signs it may be the job', '<ul class="ticks"><li>Your values clash with what the work asks of you, not just with a colleague.</li><li>You dread the work itself, not only Monday mornings.</li><li>The things you are best at are not used at all, and cannot be.</li><li>You feel better on holiday and worse within a day of coming back, every time.</li></ul>'],
      ['Signs it is the part of the job', '<ul class="ticks"><li>You liked each new role at first, then the same feeling returned.</li><li>Some days fly by: the ones with a problem to solve, or a person to help.</li><li>What drains you is the same kind of task wherever you go: routine, approvals, waiting on others.</li><li>You talk about one part of your work with energy, and the rest not at all.</li></ul>'],
      ['How to find the part you love', '<p>Notice what you talk about when no one asks: the projects you describe at length to friends, the problems you keep turning over, the help people come to you for. That is the evidence a careers test cannot ask about. A <a href="/psyche-personality-test">Psyche Report</a> reads it from your own Instagram data (and, if you like, WhatsApp, Google or Facebook): your edge, what is holding you back, and the kinds of work that suit you and drain you. Then <a href="/ai-personality-coach">Ask PsycheAI</a> the question directly.</p>'],
      ['What to do next', '<ol class="guide-steps"><li>Write down the last three times work felt easy. What were you doing?</li><li>Ask for more of that in your current role before you leave it.</li><li>If there is none of it to be had, that is your answer: it is the job.</li></ol>'],
    ],
    faq: [
      ['How do I know if I am in the wrong career or just burnt out?', 'If rest restores your interest, the job may be right and the load wrong. If rest does not, look at the work itself. If tiredness or low mood lasts, talk to someone qualified.'],
      ['Will changing jobs make me happier?', 'Only if the new job changes the part that drains you. Many people carry the same routine tasks into a new role.'],
      ['Can AI tell me what career suits me?', 'It can point to patterns. PsycheAI reads the careers that suit you, and the ones likely to drain you, from your own behaviour, with the evidence. Treat it as a starting point.'],
    ],
  },
  {
    slug: 'what-will-i-regret-when-im-old',
    title: 'What will I regret most when I’m old? | PsycheAI',
    description: 'The most common regrets at the end of life, from a palliative carer’s notes, and how to spot which apply to you from your own behaviour.',
    h1: 'What will I regret most when I’m old?',
    lede: 'The short answer: people near the end of life rarely regret what they did; they regret what they put off. Bronnie Ware, a palliative carer, heard the same five again and again: not living true to themselves, working too much, not saying how they felt, losing touch with friends, and not letting themselves be happier. Which one applies to you shows in how you spend your time now.',
    sections: [
      ['The five most common regrets', '<ol class="guide-list"><li><h3>Not living a life true to myself</h3><p>Living the life others expected instead of the one they wanted.</p></li><li><h3>Working too hard</h3><p>Missing time with family and friends for work.</p></li><li><h3>Not expressing my feelings</h3><p>Keeping the peace by keeping quiet.</p></li><li><h3>Losing touch with friends</h3><p>Letting friendships fade in the busy years.</p></li><li><h3>Not letting myself be happier</h3><p>Staying in old habits out of fear of change.</p></li></ol><p class="fineprint">From Bronnie Ware’s <em>The Top Five Regrets of the Dying</em> (2012), based on her years as a palliative carer: observations, not a scientific survey.</p>'],
      ['Which one is yours?', '<p>Your future regrets are usually visible now, in small patterns: the friends you keep meaning to call, the plans you save and never book, the messages home that have shrunk to a word. They are easy to miss in yourself and plain in your own data. Asked this question, Ask PsycheAI answers from the patterns in your own Instagram data (and WhatsApp, Google or Facebook, if you add them), with the evidence, and says what to do this week. <a href="/ai-personality-coach">How Ask PsycheAI works</a>.</p>'],
      ['Start this week', '<ul class="ticks"><li>Message one friend you have lost touch with.</li><li>Say one thing you have been holding back, kindly.</li><li>Book one thing you have saved and never done.</li><li>Leave work on time one day, on purpose.</li></ul>'],
    ],
    faq: [
      ['What is the most common regret at the end of life?', 'In Bronnie Ware’s account, not having the courage to live a life true to oneself rather than the life others expected.'],
      ['Can AI predict what I will regret?', 'Not predict, but it can point to patterns that tend to lead to regret, such as friendships fading or plans put off, and show you the evidence in your own data.'],
      ['Is this about mental health?', 'No. It is about how you spend your time. If you are struggling, talk to someone you trust or someone qualified.'],
    ],
  },
  {
    slug: 'why-do-we-fight-over-small-things',
    title: 'Why do we fight over small things? | PsycheAI',
    description: 'Why couples and families fight over small things, what the fight is usually about, and how knowing how you love and handle conflict breaks the cycle.',
    h1: 'Why do we fight over small things?',
    lede: 'The short answer: the small thing is rarely the point. A fight about the dishes is usually about feeling unseen, unappreciated or not a priority, and it comes back in a different form until that is said. Relationship researchers John and Julie Gottman found that about 69% of couples’ conflicts are perpetual: they are never solved, only handled well or badly.',
    sections: [
      ['What the small fight is really about', '<ul class="ticks"><li><strong>Feeling second.</strong> “You always put your parents first” and “your work comes first” are the same complaint.</li><li><strong>Effort that goes unnoticed.</strong> If you show love by doing things, a small thing left undone can feel like your effort does not count.</li><li><strong>Different love languages.</strong> One of you gives help; the other wants to hear it. Both feel unloved.</li><li><strong>A build-up.</strong> Going quiet for days, then everything coming out over something small.</li></ul>'],
      ['Different topic, same fight', '<p>If the arguments change subject but feel the same, you have found your perpetual problem. The Gottmans’ point is that the couples who do well are not the ones with fewer of these, but the ones who talk about them gently and with humour, instead of having the same fight about a new topic.</p><p class="fineprint">The 69% figure is from John and Julie Gottman’s research on couples.</p>'],
      ['Knowing your side of it', '<p>You cannot read your partner’s mind, but you can know your own patterns: how you show care, how you want to receive it, and what you do in a disagreement. A <a href="/psyche-personality-test">Psyche Report</a> reads these from your own data: your love languages, your attachment style, how you handle conflict, and what you need from the person you love. It reads only your data, so it speaks for you, never for them. <a href="/love-language-test">More on love languages</a>.</p>'],
      ['Try this next time', '<ol class="guide-steps"><li>Name the feeling, not the dishes: “I feel like I come second.”</li><li>Say what you need in one sentence.</li><li>Ask what they need, and listen to the answer.</li></ol>'],
    ],
    faq: [
      ['Is it normal to fight over small things?', 'Yes. Most couples do. What matters is whether the real issue underneath gets talked about.'],
      ['How do I stop fighting about the same thing?', 'Find what the fights have in common, say the feeling underneath, and agree on how to handle it rather than trying to win.'],
      ['Can PsycheAI analyse my relationship?', 'It reads only your own data: how you love, your attachment style and how you handle conflict. Psyche Sync compares two people, but for friends and family, never romance. For serious difficulties, a couples counsellor can help.'],
    ],
  },
];
