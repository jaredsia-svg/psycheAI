// A read written by Muse, through the PsycheAI plugin (app.psycheai.io).
//
// On the Muse path there is no export and no digest: Muse reads the reader's
// Instagram itself, on their behalf, and writes their card and report in the
// merged schema (MERGED_SCHEMA, the same answer the merged unlock asks a
// provider for), following the merged prompt with a preface (GUIDE_PREFACE).
// The plugin sends that answer here. It is held to exactly the checks a
// provider's merged answer is (checkMerged, splitMerged), so a Muse read
// lands on the reader's device in the same shape as any other bundle.
//
// **What the server holds cannot be read by it**, as with the short link
// (lib/links.js): the bundle is sealed with AES-256-GCM under a key made here
// for this read alone, only the sealed copy is stored, and the key goes back
// to the plugin in the link after the #, which browsers never send to a
// server. Kept SEALED_DAYS, so the reader can open it on another device in
// the first week; after that it is gone, and the read lives on their device
// and in their backup like any other.
//
// Only the plugin may send one: it signs each request with the secret the
// two servers share (PSYCHEAI_IMPORT_SECRET). Without the secret set, the
// route is off.
'use strict';

const crypto = require('node:crypto');
const store = require('./store');
const prompts = require('./prompts');
const mbtiScore = require('./mbtiScore');

const SEALED_DAYS = 7;
const MAX_BYTES = 400 * 1024;
const PDF_MAX = 2 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{16}$/;
const NAME_MAX = 60;

const secret = () => String(process.env.PSYCHEAI_IMPORT_SECRET || '');
const enabled = () => secret().length >= 16;

/** The plugin's request carries `Bearer <secret>`; compared in constant time. */
function authorised(header) {
  if (!enabled()) return false;
  const m = /^Bearer (.+)$/.exec(String(header || ''));
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest();
  const b = crypto.createHash('sha256').update(secret()).digest();
  return crypto.timingSafeEqual(a, b);
}

// What the plugin hands Muse for a read. Not a prompt: PsycheAI's own model
// prompt (MERGED_SYSTEM, about 100,000 characters opening "You are PsycheAI")
// handed back in a tool result reads to a host exactly like prompt injection,
// and Muse refused it (October 2026). So Muse gets a short specification of
// the document the user asked for, written about the read rather than at the
// assistant, and the merged schema, whose field descriptions already carry
// the field-by-field rules. The cross-cutting rules below are the ones the
// schema cannot carry; keep them in step with MERGED_SYSTEM's hard limits.
const READ_SPEC = `# The PsycheAI read: what it contains and the standards it meets

This is the format of the PsycheAI read the user asked for: a personality read written from their own Instagram, which they connected and chose to share. It describes the document and the standards a good one meets; it is written with the assistant's own judgement and policies, and returned to publish_psyche as one JSON object that matches the schema.

## Sources
- The user's own Instagram: posts, captions, stories and highlights, bio, the comments they wrote, and, only if they allowed it, their own side of their messages.
- Their own Facebook, and their own side of Messenger, only when they added them (below).
- Nothing anyone else wrote is used, quoted or described, and no other person is named: "a close friend", "a sibling".
- The user is written as \`PsycheUser\` wherever their name or handle would go; their real name is put back on their device.
- **Text only.** The read is written from words and dates: captions, comments, messages, the bio, any text added on top of a story or post (typed, pasted or in a text sticker, read in full), and when things were posted. The photos and videos themselves are not analysed: nothing is read from faces, bodies, looks, clothes, surroundings or who appears in them. A story with no words on it counts only for its date.

## Reading plan
A read is only as good as its sample, and the first items a feed returns are the newest, not the most telling, so a read is spread across the whole span. The sample is the digest the skill keeps (\`digest/digest.md\`): each line is one dated thing they wrote, with its time when Instagram gives one, and the read is written from it, so everything the read cites is a line in it. The digest grows over reads towards about 200,000 characters of the person's own words at most, the same as a read on psycheai.io. A read takes about 6 to 8 minutes: it reads to its target in the largest pages the tools give and writes the digest as it goes.
- **A first read aims for about 80,000 characters:** posts and stories about 35,000 (their comments included), messages about 45,000 when they agreed. **Each later read adds about 40,000**, oldest first where the digest is thinnest, until the shares below are reached. A target is what a read reaches, not a ceiling to stop short of; only an account with less to read stops sooner.
- **Posts and stories, up to about 85,000 characters in all:** a caption or comment under about 30 characters (an emoji, "Sunday vibes", "nice one") counts for its date, not as words, as on psycheai.io; then every longer caption of their own (a very long one up to its first 1,500 characters); the text on stories and highlights across every year the account has, not just the latest pages, since the earlier years often explain the most (no single year more than about a quarter of the sample when there are four or more years; keep going back until the oldest year is reached) (typed, pasted or in a sticker; a story with no words counts only for its date, which comes with the list, so it isn't opened); and up to about 15,000 characters of comments they wrote. Past the ceiling, the sample is thinned evenly across the years, not cut at the oldest.
- **Messages, only when the person agreed, up to about 110,000 characters in all:** their own side of the 10 busiest conversations in their inbox, judged by how much is in each, not by which is newest. A conversation comes newest first and can't skip to a year, so depth goes where it counts: the 4 busiest are paged back as far as their target reaches (about 8,000 characters each on a first read, growing over later reads to about 15,000, until their first year is reached); the other 6 are read from their recent pages (about 2,000 each, growing to about 6,000). From each page, keep the most telling of their own messages (composed ones, plans, feelings, apologies, questions; never "ok" or "haha"). A message sent word for word to several people (an announcement, a request to follow an account) is one thing they did, kept once. Long pasted or forwarded text (over about 800 characters) and messages that are mostly a link are not their own words and are left out. Which conversations, and how many were read, is never evidence about them.
- **The bio and the counts** (how many posts and stories, and when they post): about 5,000 characters.
- Room the messages leave unused, or all of it when messages weren't shared, goes to posts and stories, never the other way.
- **Likes, saves, follows and searches:** a light look, for interests only and not counted as their words: the accounts they like and save most, the hashtags they meet most, Instagram's topics for them and their most repeated searches, about 15,000 characters at most.
The confidence rationale says what was read, in counts ("380 stories from 2019 to 2026, messages across 10 conversations").

## Facebook they added
Only when the user added it (Facebook, and their own side of Messenger if they chose it), through Muse's own Facebook connection, read like their Instagram and kept in the same digest: their own posts as "[facebook post]" lines among the posts and stories, their comments among the comments, and Messenger conversations, headed "Messenger", ranked with Instagram's by how much is in each, within the same shares. A habit seen on both is one pattern seen twice. The confidence rationale counts Facebook and Messenger with the rest ("Facebook posts from 2012 to 2026 and 6 Messenger conversations").

## WhatsApp chats they added
Only when the user added them, and only as the file the skill made ready on their own device (\`sources/whatsapp.txt\`, from \`bin/psyche.py prep\`), never the export itself:
- It holds their own messages only, each dated; everyone else in a chat is "Friend A", "Friend B" and so on, and numbers, emails, links and handles are already taken out.
- Up to three chats, about 45,000 characters each for one or two, 30,000 each for three (75,000 each in a Deep Psyche), counted as conversations of their own in the messages share, which grows by the same amount.
- Where WhatsApp and Instagram show the same habit, it is one pattern seen twice, and stronger for it, not two.
- The read never names a friend or writes "Friend A": "a long-running chat with a close friend", "a group chat of six". The confidence rationale counts the chats with the rest ("and three WhatsApp chats, 2018 to 2026").

## Evidence, strongest first
When two signals disagree, the stronger one wins and the read says so ("follows a dozen running accounts but no run since 2021").
1. Sustained, repeated action across years: a subject they keep returning to, a habit that recurs, a person they keep writing to.
2. Their own composed words: captions, comments, their own messages, the bio. The richest evidence there is.
3. Rhythm: when and how often they post (the times on the digest's lines), whether they publish or mostly watch.
4. Repeated engagement with others' work: accounts and topics they keep returning to.
5. A single like, follow or save: close to worthless alone.
6. Platform-guessed topics: weakest of all.

Two rules hold throughout:
- **One instance is not a pattern, and the count belongs in the sentence.** "Forty-odd captions across four years", "two mentions, both in 2019": a reader can weigh a claim with a number and cannot weigh "several".
- **Absence is not evidence.** Someone who never posts about family may be private. A blank is read as a finding only where that part of life would be expected to show.

## Who a sentence is about
The author of a caption is not automatically its subject. A story about a friend's new job, car or achievement is evidence about the friend; about the user it shows who they are around, what they notice and admire, and how they write about people. An account largely about other people is itself a finding: the connector, the observer, the one holding the camera. A comment on someone else's post is about that person.

## Time
- Each interest and value has a trajectory from the dates: structural (across the whole span and recently), stable, rising, declining, dormant (nothing for about two years: said plainly, not flattered) or phasic (ran for a window and stopped).
- Reduced posting is not a reduced life: where it matters, the read says the posts stopped, not that the interest did.

## Character
The character (\`essence.character\`) is matched on temperament, drive and how they treat people, never on looks. ${prompts.CHARACTER_SIDE_RULE.replace('in their own data', 'in their own data and their Meta account details')}

## Type and traits
- Each MBTI letter is held only as strongly as its evidence: a lean is written as a lean.
- Each ledger row's \`row\` is an id from the guide's \`rubric\`, for that axis, exactly as spelled there; a row with any other id is dropped when the letters are scored.
- E/I follows breadth of contact (distinct people, plans proposed, circles kept) and how they recharge, never message volume or how long their messages are. Who starts things counts: the plans they propose, the gatherings they organise, joining strangers or new groups, and whether a burst of social activity is followed by a quiet stretch. These are never E/I evidence: how many conversations were read (the reading plan chooses that number), whether the account is private, or that their circle is close (loyalty, not energy). How many people they keep up with is breadth, and counts when it is measured against everyone they message ("about 10 of your 140 threads run for years"), never as the number that was read. When the real signals point both ways, the letter is a slight lean, said so.
- S/N, T/F and J/P each rest on behaviour that bears on that axis alone; one fact is used for one letter.
- Big Five scores run 0 to 100, 50 being average, and agree with the letters they track (extraversion with E/I, openness with S/N, agreeableness with T/F, conscientiousness with J/P). "Neuroticism" is written as "emotional sensitivity", never as a defect.

## Writing
- Second person ("you"), warm and specific, honest about uncertainty, never sycophantic or moralising; things they may not know about themselves, including the unflattering but fair.
- Specific beats general: "your posting spikes on Saturday mornings and half your captions mention a trail" is worth reading; "you love the outdoors" is not.
- Plain words and short sentences. British spelling. Sentence case for every name and title ("The quiet organiser"). No filler words: profound, remarkable, journey, tapestry, navigate, leverage, truly.
- Each piece of evidence is used once in a section and at most twice in the whole read; one fact, one figure everywhere.

## Depth
What separates a read worth keeping from a summary of someone's feed:
- **Moments, not tallies.** Each section rests on specific things they did or wrote, each a line in the digest, in a phrase with its date ("the June 2026 comment taking apart a driverless-car claim"), paraphrased, never anyone else's words. An evidence item is one such moment ("your June 2026 comment correcting a crash report with pedal data"), never the reading itself ("10 sampled conversations", "across 140 conversations", "the digest shows") or a summary of many ("long written debates on media and technology"). If an item would still be true with the date taken out, it is a summary: use the one moment that shows it best. A count backs a moment up; it is not insight on its own. Message length and per-topic counts say little about a person: use each at most once in the whole read.
- **Say what it means.** Every finding answers "so what": what it suggests they want, protect, avoid or are working out, and how that shows up in their life. Name the tension between two things that are both true of them; that is usually where the insight is.
- **Written to them, about them.** Every line speaks to the person as "you", evidence items and ledger rows included ("you start most conversations in your top threads"): never he, she, they, "the user" or their name, and never a guess at their gender. About the person, not the dataset: Not "in the record", "in the sampled messages" or "the data shows". What was not read is said once, in the confidence rationale, never in each section.
- **Across the years.** Where the sample spans several years, each pattern, letter and section draws its evidence from more than one of them, the earlier years included, not only the latest; a theme seen in 2019 and again in 2026 is stronger than one seen twice in 2026, and the read says so. Each pattern's evidence items carry at least two different years, one of them before the latest two, whenever the digest spans three years or more; a theme found in one year is a phase, never a pattern.
- **Names only they fit.** A pattern's name says what this person does, in their own terms ("Argue it with evidence", "The future, tested first"); one that would fit thousands of people ("The curious connector") is renamed. Interests and values each name something particular to them ("Investing and private markets", "Mercy should outrank keeping score"); two that overlap ("Friends and shared meals" beside "Food and dining") are one.
- **Commit where the evidence does.** A score sits where the evidence puts it; it is not pulled towards 50 to be safe. A trait with no evidence goes near 50 with low confidence, and the rationale says so. The test for every paragraph: a close friend would recognise them in it and still learn something; one that would fit anyone with the same interests is rewritten.

## Wellness
A read of behaviour across six dimensions, never a health assessment.
- **lifeTrajectory:** the phase and the arc across the whole span, not the last months. Name a hard stretch plainly (when it started, how long, what changed, whether they came through); never invent its cause, and a gap in posting is ambiguous (a new baby or job as often as grief).
- **outlook:** from their own words, not reposts: plans as expectation or hope, setbacks as temporary or permanent. Use the real word when it fits (bleak, grim, worn down); a feed is partly performance, and deadpan humour is a style, not despair.
- **socialConnection:** distinct people, reach beyond a set circle, and whether it runs both ways; giving far more than they get back is named gently.
- **cognitiveLoad:** how many threads and plans they carry and whether plans close out; apparent load, never capacity.
- **meaning:** what they return to over years and whether stated commitments match behaviour.
- **rhythmAndActivity:** posting times are when they reached for a phone, never a sleep record; activity only from what they chose to post, and silence is not a finding.
Bands describe a pattern, not a person; most people are \`mixed\` on most. \`under strain\` needs a pattern the evidence shows; \`not enough evidence\` is a real answer. \`overall\` is prose: no score, index, grade or average. \`suggestions\` are what an observant friend would suggest this week, never treatment. No condition is named, implied or predicted; where something looks like it warrants one, say it is worth taking to someone who can assess it.

## Attachment
A leaning (secure, anxious or avoidant, or two of them, as "anxious-leaning, with avoidant edges"), never fearful-avoidant or disorganised, shown working.
- From conduct with people: who starts conversations, how fast and warmly they reply, how they write to those closest, what happens around a gap, how large a circle and for how long. What they watch or save about relationships is an interest, one supporting line at most.
- About half of adults lean secure, so a non-secure leaning must show in their own conduct, and a mixed one needs both halves visible. When thin or mixed, take the cautious read ("leans secure, with avoidant defences under stress"), and name in \`why\` the stronger style considered and what would have moved the read to it.
- Lead with what the style is good at, then its costs as tendencies they can work with: what it looks like, what helps, and that it moves. It is the most changeable thing in the read.

## Ideal partner
Argued from the attachment read above, not a fresh read. \`needs\`: three to five requirements that follow from their attachment, love languages and relationship strengths and weaknesses, each with its evidence, not pleasant adjectives. \`carefulOf\`: two to four partner types or dynamics that would predictably go wrong for this person, and what that would look like, not universal red flags. The test: if a line would fit a stranger with a different attachment style, it has not used the read. \`summary\`: the honest verdict in two or three sentences, not a recap. No private person is named; describe the relationship ("the friend they write to most").

## Career
A coach deciding what they should do next, a different job from the how-they-work section: a sentence that would sit there belongs there.
- \`situation\`: where they appear to be, from the work they mention, the rooms they are in and what they are building. Where their own words show their field (its jargon, a workplace joke, the deadlines they mention, a deal or a launch talked through with a colleague), it names that field first, in plain words a stranger would use ("accounting", "nursing"), never traits ("analytical, high-stakes work"), messages and added chats counting as much as captions; the edge, fit and actions start from it, and the first kind of work under \`fit.suits\` is in or beside that field. There is no CV, title, employer or salary here: infer openly and say so, and where work barely shows, say that and keep the section short.
- \`edge\`: the centre. What they do reliably that most people do not, as an advantage they can use, with real counts ("the same twelve people close for four years"). One that would fit any organised, kind or hard-working person is a compliment, not an edge.
- \`underused\`: what they have and visibly don't use. \`holdingBack\`: the pattern most likely to cost them at work, from behaviour, not a label; direct about the pattern, never the person.
- \`fit\`: kinds of work that suit and that would drain, each with its reason from their data; never one job title, nothing about pay or status, and draining is a mismatch, not a fault.
- Who-is-this-about bites hardest here: photographing founders at a demo night makes them the person in the room, not a founder.

## Development and the plan
- \`development\` closes the read by resolving the patterns: \`buildOn\`, two strengths to lean into; \`develop\`, two areas worth working on. Each names the pattern it resolves and \`raisedBy\`, the sections that raised it.
- A \`develop\` area is often a strength that turns costly under pressure (independence that becomes going it alone). It carries \`earlySigns\`, two behaviours someone could notice early, not feelings; \`counterMove\`, one concrete move for that moment; and \`reflect\`, one open question specific to them. Behaviour under pressure, never a condition.
- **One plan of about five actions:** the develop actions, \`careerAssessment.actions\` and \`wellness.suggestions\` together, one or two from each. Every horizon has at least one: this week, this quarter, this year. Each is a first move, not an ambition ("ask your manager which of the three projects counts at review", not "increase your visibility"). No two are the same step, including the same step on a different deadline.
- Nothing in development or the plan makes a claim no section made.

## Thin evidence
Instagram alone, and stories that are mostly pictures with few words, support rhythm and the people around them far better than inner life, work or relationships. Where a section's evidence is thin, it says so in a sentence and stays short; it is never padded with general statements that could describe anyone. A short, true section is better than a long, generic one.

## Limits
- Insight and coaching only: never therapy, treatment or a diagnosis, and no clinical terms. The wellness section is a read of behaviour (posting times, activity, connection), not a health assessment.
- Not inferred unless the user stated it in their own words: sexual orientation, health, immigration status, political affiliation, religion. Nobody is classified by appearance or by who they follow.
- Anything printed on the card (headline, card lines, pattern names) is positive or neutral, and never about romance or dating.
- The send-up (\`bonus\`) is deliberately blunt: pointed and funny, about habits and the gaps between plans and follow-through, with no softening; its \`advice\` is where the kindness goes. It is never about health, appearance, identity or anyone else, and if the user seems to be going through a hard time it sticks to small, harmless habits.

## Confidence
With Instagram as the only source, 65 to 79, at the low end when it is mostly stories and pictures; higher only if their own messages were read too. The confidence rationale names what was read and what was not.

## Before saving
A last pass over the whole read; most weak reads fail one of these:
- **Range.** A theme that explains a lot is a pattern; the other sections show other sides of them, not the same theme again. No one theme anchors more than three sections, counting the patterns, how they work, what holds them back, development, the plan and the send-up.
- **No repeats.** No two items in one list say the same thing (two "what holds you back" entries about spreading thin are one), and no two actions are the same task (capping a debate this week twice, or the same enquiry this week and this quarter, are one action). A field with nothing new to say stays short and says something different; it never restates another and says so.
- **Every citation is in the digest.** Each dated moment the read cites is a line in \`digest/digest.md\`. One that isn't comes out, or goes into the digest first from their Instagram.
- **One count everywhere.** The conversations and items the confidence rationale counts are the digest header's.
- **Their field, by name.** Where the digest shows what they work in, \`careerAssessment.situation\` names it plainly and \`fit.suits\` starts beside it.
- **Every evidence item is a dated moment of theirs,** never a count of conversations or a mention of the digest or the sample.
- **Each pattern spans the years:** two different years, one before the latest two, once the digest spans three.

## Output
One JSON object that matches the schema, and nothing around it.`;

// A Sync written by Muse (the plugin's Muse Sync): the same idea, PsycheAI's
// Sync rules as a specification, with its brief and schema.
const SYNC_SPEC = `# A PsycheAI Sync: what it contains and the standards it meets

A Sync is how two people get on: friends, family, anyone; never romance or dating. Both people agreed to it. It is written from each person's card-level profile (no report, no posts) and the derived facts, which are computed and settled. Person A is the user; person B is the other person. Each is called by the first name their profile gives.

## What it contains: the same as a Sync on psycheai.io
One object matching the schema, in this order, shown to both people as one image (so each part is short enough to read there):
1. **summary:** one warm line, under 25 words.
2. **align:** two or three points: a title of a few words, two short sentences naming both people, and the evidence behind it.
3. **differ:** two or three points, the same way, each with how the difference can work for them.
4. **howToPartner:** three things for person A (forA) and three for person B (forB), each addressed to them as "you", one sentence of under about 120 characters; and two things they could do together.
5. **caveats:** one or two sentences on what this cannot see.

## Standards
- Positive and encouraging throughout. Differences are differences with a way to make them work, never a fault in either person. No blame or labels, and no prediction that the connection will struggle.
- The words tension, conflict, clash, friction, struggle, problem and incompatible are not used; "difference", "disagreement" or "a different pace" instead.
- No score or percentage. The connection is never called a friendship or any other named relationship: "you two", "your connection".
- Types are weighed in a sentence or two at most: E/I and S/N matter most, T/F less, J/P least; a score near 50 is a lean.
- Only shared interests the derived facts list. Each point rests on something in the profiles, named in its evidence.
- Profiles are inferences from social media; if either confidence is low, it is a conversation starter rather than a finding.`;

// The merged schema as Muse is shown it. Its field descriptions were written
// as orders to PsycheAI's own model, and some still read that way to a host's
// safety check: pointers to "the system prompt", "You are reading…", and the
// roast's register ("Roast them… the least charitable reading… after the
// second drink… Unkind and true"). The roast here is still deliberately
// blunt (a send-up, no softening), said without those phrases.
// This copy has the same shape and the same
// checks (checkMerged validates the answer, not the descriptions); only the
// wording a host reads changes.
const MUSE_DESCRIPTIONS = {
  harsh: 'A send-up: two or three short paragraphs, deliberately blunt and pointed, the version a sharp friend gives when it is their turn to be teased in front of everyone. Name the contradictions and habits head-on, with the real specifics: plans announced and dropped, things saved and never done, the gap between the image they post and what the record shows. Do not soften it or balance it with compliments; the next field is where the kindness goes. Funny and true, never cruel about what they cannot change: never health, appearance, identity or anyone else. If they seem to be going through a hard time, tease only small, harmless habits.',
  advice: 'One or two short paragraphs of frank, kind advice that follows from the observations above: concrete, practical, and in plain words.',
};
// Each field's description as its first sentence or two (about 220
// characters): the shape and what goes in it. The full field rules are
// psycheai.io's own model's; Muse has the spec for the cross-cutting ones, and
// the schema was 41,000 characters, twice the spec, read on every read.
const DESCRIPTION_CHARS = 220;
// Sentences end at . ! or ? before a space; "e.g.", "i.e.", "etc." and "vs."
// don't end one. Whole sentences only, from the first, so nothing is dropped
// from the front (a split at "e.g." once lost cardHighlights' first sentence).
const ABBREVIATION = /\b(e\.g|i\.e|etc|vs)\./g;
function brief(text) {
  if (text.length <= DESCRIPTION_CHARS) return text;
  const sentences = text.replace(ABBREVIATION, m => m.replace(/\./g, '\u0000')).split(/(?<=[.!?]["”)]?)\s+/);
  let out = '';
  for (const sentence of sentences) {
    if (out && (out + ' ' + sentence).length > DESCRIPTION_CHARS) break;
    out += (out ? ' ' : '') + sentence;
  }
  return out.replace(/\u0000/g, '.');
}
function museSchema(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  const walk = (node, key) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.description === 'string') {
      node.description = MUSE_DESCRIPTIONS[key] || brief(node.description);
      node.description = node.description
        .replace(/\s*See ([^.]*?)the system prompt[^.]*\./gi, '')
        .replace(/the system prompt/gi, 'the specification')
        .replace(/\bYou are reading\b/g, 'This reads')
        .replace(/\("You are like X"\)/g, '("like X")')
        .replace(/nothing you are citing/g, 'nothing cited');
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, k);
  };
  walk(copy, '');
  return copy;
}
const MUSE_SCHEMA = museSchema(prompts.MERGED_SCHEMA);

/**
 * What the plugin hands Muse. kind 'read' (the default): the read's
 * specification and the merged schema. kind 'sync': the Sync's specification,
 * the brief that opens PsycheAI's Sync request, and its schema.
 */
// A Deep Psyche (README "Deep Psyche from Muse"): the same read from about
// four times the sample, read a year at a time into notes, so a long history
// fits and the read can follow how someone changed.
const DEEP_SPEC = `

## Deep Psyche
This read is a Deep Psyche, which the user chose knowing it takes about 20 to 30 minutes. It is the same document to the same standards, from a sample about four times the reading plan's:
- **About 800,000 characters of their own words at most:** posts and stories up to about 340,000 (comments up to about 40,000 of it); messages, when they agreed, up to about 440,000, across the 20 conversations they write in most, at most about 30,000 from any one; likes, saves, follows and searches up to about 30,000.
- **A year at a time.** Read one year, oldest first, and keep short notes on it before the next: the dated moments that stand out, with counts; what keeps recurring; what started, stopped or changed since the year before. Then write the read from the notes, going back to the items themselves only for the evidence it cites.
- **How they changed is part of the read:** trajectories, patterns and the confidence rationale use the years ("ran most weeks 2019 to 2021, nothing since"), and the rationale says it was a Deep Psyche and what was read, in counts, year by year.`;

function guide(kind, depth) {
  if (kind === 'sync') {
    const chosen = prompts.briefFor();
    const brief = chosen.brief + '\n\nWhat matters most, in this order:\n' + chosen.dimensions.map(d => '  - ' + d).join('\n') + '\n\n' +
      'The fields that decide those most: ' + chosen.lean.join(', ') + '.';
    return { spec: SYNC_SPEC, brief, schema: prompts.COMPATIBILITY_SCHEMA };
  }
  return { spec: depth === 'deep' ? READ_SPEC + DEEP_SPEC : READ_SPEC, rubric: mbtiScore.rubricText(), schema: MUSE_SCHEMA, sealedDays: SEALED_DAYS };
}

/**
 * Check a merged answer and turn it into the bundle the device adopts
 * ({ data: { ...report, freeCard } }), as mergedOrTwoCalls does for a
 * provider. Resolves to { ok, bundle } or { ok: false, problems }.
 */
// Two standards Muse reads were seen breaking although the spec states them,
// checked when the read is saved and sent back as problems to fix, in the
// same descriptive form as checkMerged's (README "Checked when saved").

// E/I from a close circle: the spec's "loyalty, not energy". A preference
// for small groups over strangers is still a real E/I signal; the circle being
// close or trusted is not.
const CLOSE_CIRCLE = /\b(close|small|tight|tight-knit|trusted|familiar)\b[\w ,:-]{0,32}\b(circle|core)\b/i;
const PRIVATE_ACCOUNT = /\b(private account|account is private)\b/i;
function eiProblems(data) {
  const letter = ((data.mbti && data.mbti.letters) || []).find(l => l && /^[EI]$/.test(l.choice));
  if (!letter) return [];
  const said = [letter.why, ...(letter.evidence || [])].join(' ');
  const out = [];
  if (CLOSE_CIRCLE.test(said)) out.push('mbti E/I: its reasons rest on a close circle, which is loyalty rather than energy: it follows who starts things, the groups and new people they join, and how they recharge');
  if (PRIVATE_ACCOUNT.test(said)) out.push('mbti E/I: whether the account is private is not a reason for either letter');
  return out;
}

// Two items that are the same point: in the plan ("confirm the time a day
// earlier" this week, and "confirm its time a day early" in another this
// week), or in one list ("Too many open threads" beside "Spreads across
// interests", both "AI, investing, sport, food and building projects
// together"). The same point when one's title is mostly in the other's words,
// or the two share a run of six words.
const COMMON = new Set('the and you your one this that with for from into next week weeks month year quarter each before after then them their what when will would more than about which have has its are was were can could just only also'.split(' '));
const stems = t => (String(t || '').toLowerCase().match(/[a-z]{3,}/g) || []).filter(w => !COMMON.has(w)).map(w => w.slice(0, 5));
const words = t => String(t || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const RUN = 6;
function samePoint(a, b) {
  const textOf = x => x.title + ' ' + (x.detail || '');
  const titleIn = (x, y) => {
    const t = [...new Set(stems(x.title))];
    const other = new Set(stems(textOf(y)));
    return t.length >= 2 && t.filter(w => other.has(w)).length / t.length >= 0.75;
  };
  if (titleIn(a, b) || titleIn(b, a)) return true;
  const runs = new Set();
  const wa = words(textOf(a)), wb = words(textOf(b));
  for (let i = 0; i + RUN <= wa.length; i++) runs.add(wa.slice(i, i + RUN).join(' '));
  for (let i = 0; i + RUN <= wb.length; i++) if (runs.has(wb.slice(i, i + RUN).join(' '))) return true;
  return false;
}
function firstSame(items, what) {
  const list = items.filter(x => x && typeof x.title === 'string' && x.title.trim());
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (samePoint(list[i], list[j])) return [`${what}: "${list[i].title.slice(0, 60)}" and "${list[j].title.slice(0, 60)}" make the same point; ${what === 'the plan' ? 'the plan keeps one of them and gives the other place to a different step' : 'the list keeps one of them and gives the other place to a different point'}`];
    }
  }
  return [];
}
function planProblems(data) {
  return firstSame([
    ...((data.development && data.development.develop) || []).flatMap(d => (d && d.actions) || []),
    ...((data.careerAssessment && data.careerAssessment.actions) || []),
    ...((data.wellness && data.wellness.suggestions) || []),
  ], 'the plan');
}
// Every other list of titled points in the read (what holds them back, strengths, needs, cautions…).
function listProblems(data) {
  const out = [];
  const walk = (node, path) => {
    if (out.length || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > 1 && node.every(x => x && typeof x === 'object' && typeof x.title === 'string')) out.push(...firstSame(node, path));
      node.forEach(x => walk(x, path));
      return;
    }
    for (const [k, v] of Object.entries(node)) if (!['actions', 'suggestions'].includes(k)) walk(v, path ? path + '.' + k : k);
  };
  walk(data, '');
  return out.slice(0, 1);
}

function bundleFrom(answer) {
  const checked = prompts.checkMerged(answer);
  if (!checked.ok) return { ok: false, problems: checked.problems.slice(0, 12) };
  // The format's own words copied in place of a kind of work ("Kind of work: …"), as a Muse read once did.
  const fit = (checked.data.careerAssessment && checked.data.careerAssessment.fit) || {};
  const placeholders = ['suits', 'draining'].filter(k => (fit[k] || []).some(x => /^\s*kind of work\s*:/i.test(String(x))));
  if (placeholders.length) return { ok: false, problems: placeholders.map(k => `careerAssessment.fit.${k}: each item starts with the kind of work itself ("Research in a small product team: …"), not the words "Kind of work"`) };
  const problems = [...eiProblems(checked.data), ...planProblems(checked.data), ...listProblems(checked.data)];
  if (problems.length) return { ok: false, problems };
  const split = prompts.splitMerged(checked.data);
  // The letters on the card from its own ledger, as for a provider's card;
  // there is no digest, so nothing computed is added to it.
  mbtiScore.scoreMbti(split.card, {}, []);
  return { ok: true, dropped: checked.dropped, bundle: { data: Object.assign({}, split.full, { freeCard: split.card }), model: 'Muse' } };
}

/** Seal a bundle under a fresh key. Resolves to { id, key } or null if the store is down. */
async function seal(bundle, name, now = Date.now()) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = JSON.stringify({ v: 1, source: 'muse', name: String(name || '').slice(0, NAME_MAX), at: now, bundle });
  const box = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
  const id = crypto.randomBytes(12).toString('base64url');
  const record = JSON.stringify({ iv: iv.toString('base64url'), box: box.toString('base64url') });
  const rows = await store.run([['SET', 'muse:' + id, record, 'EX', SEALED_DAYS * 86400]]);
  return rows ? { id, key: key.toString('base64url') } : null;
}

/**
 * The read's PDF (lib/musepdf.js), locked with the read's own key and kept as
 * long as the read. Whoever has the link has the key; this server keeps only
 * the locked copy, and opens it only when that link asks (openPdf).
 */
async function sealPdf(id, key, pdf) {
  if (!ID.test(String(id || '')) || !Buffer.isBuffer(pdf) || !pdf.length || pdf.length > PDF_MAX) return false;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(String(key), 'base64url'), iv);
  const box = Buffer.concat([c.update(pdf), c.final(), c.getAuthTag()]);
  const rows = await store.run([['SET', 'musepdf:' + id, JSON.stringify({ iv: iv.toString('base64url'), box: box.toString('base64url') }), 'EX', SEALED_DAYS * 86400]]);
  return Boolean(rows);
}

/** The PDF for an id, still locked ({ iv, box }), for the browser to open with the key after its link's #; or null. */
async function sealedPdf(id) {
  if (!ID.test(String(id || ''))) return null;
  const rows = await store.run([['GET', 'musepdf:' + id]]);
  if (!rows || !rows[0]) return null;
  try {
    const { iv, box } = JSON.parse(rows[0]);
    return typeof iv === 'string' && typeof box === 'string' ? { iv, box } : null;
  } catch (err) {
    return null;
  }
}

/** The PDF for an id, opened with the key its link carries, or null. */
async function openPdf(id, key) {
  if (!ID.test(String(id || '')) || !/^[A-Za-z0-9_-]{43}$/.test(String(key || ''))) return null;
  const rows = await store.run([['GET', 'musepdf:' + id]]);
  if (!rows || !rows[0]) return null;
  try {
    const { iv, box } = JSON.parse(rows[0]);
    const all = Buffer.from(box, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(iv, 'base64url'));
    d.setAuthTag(all.subarray(all.length - 16));
    return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
  } catch (error) { return null; }
}

/** The sealed copy for an id, or null. */
async function open(id) {
  const key = String(id || '').trim();
  if (!ID.test(key)) return null;
  const rows = await store.run([['GET', 'muse:' + key]]);
  if (!rows || !rows[0]) return null;
  let record = null;
  try {
    const parsed = JSON.parse(rows[0]);
    record = typeof parsed.iv === 'string' && typeof parsed.box === 'string' ? parsed : null;
  } catch (error) { return null; }
  // That it was opened, and nothing else: the plugin asks (status) so it can
  // remind someone whose link is about to close unopened.
  if (record) await store.run([['SET', 'museopened:' + key, '1', 'EX', SEALED_DAYS * 86400]]);
  return record;
}

/** For the plugin: whether a sealed read still exists and has been opened. Nothing from inside it. */
async function status(id) {
  const key = String(id || '').trim();
  if (!ID.test(key)) return null;
  const rows = await store.run([['EXISTS', 'muse:' + key], ['GET', 'museopened:' + key]]);
  if (!rows) return null;
  return { exists: Number(rows[0]) > 0, opened: rows[1] === '1' };
}

module.exports = { sealPdf, sealedPdf, openPdf, READ_SPEC, SYNC_SPEC, MUSE_SCHEMA, SEALED_DAYS, MAX_BYTES, ID, enabled, authorised, guide, bundleFrom, eiProblems, planProblems, listProblems, seal, open, status };
