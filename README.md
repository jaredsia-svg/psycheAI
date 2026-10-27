# 🧠 PsycheAI

*Your personal AI coach that already knows you.*

Load your own Instagram data, and optionally up to three WhatsApp chats with close connections and
your Google data. PsycheAI reads them in your browser and reduces them to a de-identified **digest**:
your name becomes a blank, other people's handles become `[P1]` and the names of people you message `[N1]`, and contact details and links are
removed. You review the digest and untick anything you like. The server then relays it to a language
model (**Google Gemini**, directly or through Vertex AI, **Anthropic Claude** or **xAI Grok**) and
keeps no copy of it.

- **Psyche Card (free).** A 1080×1920 story card: the character you are most like, your MBTI and
  Big Five, signature patterns, motivators, values, interests and love languages. Under it on My
  Psyche, free: the report's **Overview** (executive summary and signature patterns with their
  evidence), then a secret roast. The card's wording is always neutral or positive and never romantic.
- **Psyche Report (US$5, local prices in `docs/prices.js`).** The full report, which explains
  every part of the card with evidence from your data. It is anchored to the card, so it never
  contradicts it, and it downloads as a PDF typeset in the browser. Your **first** one is free
  once one connection opens your link; re-runs are always paid. It can also come
  free from a gift link, a 100% promo code, or a correct guess of your character before your first card.
- **Psyche Sync (free).** Each reader has one personal link (`/c/<id>#<key>`), also printed on the
  card as a QR code for someone to open. A connection who opens it sees your card and makes their
  own. Psyche Sync then reads what clicks between the two of you, where you differ and how to
  relate better. It is for friends, family or anyone close, never romance, and it has no score.

> **Current behaviour, in short.** The free result is a **Psyche Card**, a shareable story card; the
> paid **Psyche Report** (US$5) explains it. Each reader has one **personal link** (`/c/<id>#<key>`,
> also a QR code on the card). A friend or family member who opens it makes their own card, and
> **Psyche Sync** reads how the two of them sync: no score, never romance, de-identified (Person A and
> Person B), and shared back to the link's owner only if the person syncing chooses to. This README is
> the design log, in the order things were decided. Older sections describe things since replaced
> (romantic and work modes, a percentage score, camera QR scanning); where they disagree, the later
> section and the code win.

## Running it

PsycheAI needs a server because an API key cannot ship inside a web page. Set whichever key you have:

```bash
npm install

# Google Gemini — get a key at aistudio.google.com/apikey
export GEMINI_API_KEY=...
npm start                 # http://localhost:3000

# …or Anthropic Claude
export ANTHROPIC_API_KEY=sk-ant-...
npm start

# …or xAI Grok — get a key at console.x.ai
export XAI_API_KEY=xai-...
npm start
```

Or click through the whole app with canned analyses and no API calls:

```bash
npm run mock              # http://localhost:3000, PSYCHEAI_MOCK=1
```

Gemini can also be reached through Vertex AI with a service account (`GOOGLE_GENAI_USE_VERTEXAI=true`
and the variables listed at the top of `lib/gemini.js`). When `GEMINI_API_KEY` is set as well, the
key is the fallback.

`npm test` runs the unit and integration suite, and `npm run test:ui` runs the browser suite against
mock servers it starts itself.

### "Download full report", and the address list that used to stand in front of it

"Download full report" downloads the PDF straight to the reader's own device — typeset in the
browser, written to a temporary object URL, never near the network. The button does that on the
first click and asks for nothing first.

It did not always. A dialog used to collect an email address, post it to `/api/record-email`, and
let the download through only once recording succeeded. That bought the operator a mailing list at
the price of putting a form in front of the one thing a reader had already paid for, and it is
gone: the dialog, its copy, its styles, and the POST route that received the address. The route was
removed rather than left in place unused, because an unauthenticated write endpoint that nothing
calls is a spam target with no upside.

The archive is gone too. `lib/recipients.js`, `GET /api/recipients` and `PSYCHEAI_ADMIN_TOKEN`
were removed before launch. Nothing had written to `data/recipients.jsonl` since the form went, and
a store of contact details that the privacy policy does not mention should not exist, even empty.
The server's disk on Render is wiped on every deploy anyway. `tools/selftest.mjs` checks that the
module and the route stay gone.

Emailing the report was tried in an earlier version — relaying the PDF through Amazon SES rather
than downloading it — and pulled back out, since it needs a verified sending domain this project
doesn't have. If it returns, address collection would have to return with it; what has been removed
here is the *gate*, not the ability to ever ask again.

### The free run is the summary card; everything that explains it is the unlock

**The free tier costs at most about US$0.06 a run**, and it gets there by changing what the free run is
rather than how hard the model thinks about it. A free run returns the **summary card** — the
character, the MBTI type and its four letters, the five Big Five scores and bands, the
interests, values, beliefs and love languages, the four-sentence highlights, and the shareable
card — and the roast, shown on My Psyche as a secret bonus (see "The roast moves onto My Psyche"
below). Every explanation of those conclusions and the four premium sections are the **US$5 unlock:
the full premium report**, written by **one** model call.

**Two calls in total, one digest, one set of conclusions.** Both calls read the same digest — the
same file, byte for byte — so the only difference between them is what they are asked to write.

- **The card call** (`analyseCard`, kind `card`) runs `FREE_SYSTEM` against `FREE_SCHEMA` in
  `lib/prompts.js`. `FREE_SYSTEM` is a prompt of its own, about 2,300 tokens against the full
  report's 15,000-odd. It keeps the rules that decide a conclusion and drops the reasoning and worked
  prose around them: the evidence order, who a sentence is about, the extraversion correction and
  E/I following the score, the N/S and T/F confounds, how confidence is scored, how the character is
  picked, and every hard limit. The price is two copies of those rules. A selftest check names each
  one that has been the fix for a reported wrong answer, and fails if it is missing from either
  prompt. The card schema asks the model only for what is new on the shareable card: headline,
  strengths and weaknesses in relationships and at work, attachment, conflict style, rhythm, energy
  and work style. The eight card fields that repeat its own conclusions (type, scores, lists, love
  languages, confidence) are
  copied from its answer by `withCard`, so they cannot disagree with it and are not paid for twice
  at the output rate. Both calls think at the same level, `MEDIUM`.
- **The full premium report** (`analyseFull`, kind `full`) runs `FULL_SYSTEM` against `FULL_SCHEMA`.
  That is `PROFILE_SYSTEM` and `PREMIUM_SYSTEM` joined, with their schemas merged, so the written
  report, the roast and the four premium sections come back in a single response. It used to be two
  calls, and the four sections were written by a pass that never saw the report above them. The two
  "this is written by a separate call" notes are rewritten to point down the same response, again on
  marker text that throws if it goes missing. The browser files the four sections under
  `premiumAnalysis`, where the page and the PDF have always looked for them. The call runs on the
  paid engine (`PSYCHEAI_PREMIUM_PROVIDER`). It is handed the free card as an **anchor** and told to
  explain those conclusions rather than reach its own — conclusions reached from the same evidence
  it is reading. The browser then lays the card's labels back over what comes back (`overlayCard` in
  `docs/app.js`): type, letters, scores, character, and the order of the card's lists. The card a
  reader has seen, and may already have shared, therefore never changes when they pay. The writing
  under each label is the full report's own.

The anchor is client-sent, so `anchorFrom` rebuilds it field by field before it reaches a prompt.
Every field is bounded, angle brackets and control characters are stripped, scores are clamped to
0–100, and an anchor with no type and no scores counts as no anchor. The one case that runs
**without** an anchor is a reader who added Google or Facebook data on the way to paying. That
card was read from a digest without that source, so the report reaches its own conclusions and the
card is redrawn from them.

**Measuring the card before changing it: `npm run compare`.** Every cost lever left — a lower
thinking level, a cheaper model — trades on whether the card's conclusions survive it, and that is
a measurement, not an argument. `tools/compare.mjs` runs the free card call several times on a real
digest and reports, per configuration, its cost and how often the type, each letter (with and
without its strength), the Big Five bands and the character match the baseline, plus
the mean Big Five score difference. The baseline row is the production setting compared with its
own first run, which is the number to read first: a card that disagrees with itself a third of the
time sets the ceiling on how well anything else can agree with it.

```
GEMINI_API_KEY=... npm run compare -- psycheai-digest-preview.html --runs 3 \
  --configs gemini-3.8-flash:MEDIUM,gemini-3.8-flash:LOW
```

The digest can be the review screen's "Download what's being sent" file, a digest saved as JSON, or
an Instagram export zip. Each real run costs about five cents and the total is printed first;
`--mock` runs the whole tool against `lib/mock.js` for nothing. The model and thinking overrides it
uses are options on `analyseCard` that production never passes, and a selftest check holds the
default at MEDIUM on the configured model.

**One digest of 80,000 characters, counted as the model reads it.** `DIGEST_CHARS` in `docs/digest.js`
is the decision; both cost ceilings follow from it. The per-list caps are sized so a heavy account
lands near it through the caps themselves — 200 captions, 270 of their own messages from their ten
main conversations, 60 comments, 6 liked-post captions (200 characters each) with the 20 hashtags
most used across every post they liked that year (`samples.likedPostHashtags`), 20 topics, 10 YouTube
titles, and no ad interests — with the trim loop as the backstop for the account that is heavy
everywhere at once, taking a tenth of the largest list at a time. Messages went from 180 to 250 when
the weaker lists were cut: on a real heavy archive they were 1.8% of what was available against 45%
of captions, and liked captions, ad interests and random video titles said least per character.
At $0.75 / $3.75 per million tokens, worst case:

| | free card | full premium report |
|---|---|---|
| output cap (thinking included) | 10,000 → $0.0375 | 28,000 → $0.1050 |
| prompt plus schema | 9,000 → $0.0068 | 38,100 → $0.0286 |
| the digest, 80,000 characters | 22,857 → $0.0171 | 22,857 → $0.0171 |
| **at most** | **$0.0614** (`FREE_COST_CAP` $0.062) | **$0.1507** (`COST_CAP` $0.151) |

**The standard read fills its spare room with the reader's own words** (`buildFilled`). A reader with
no Google or Facebook data, or a lighter account, used to land well under 80,000 and the room went
unused. Now the digest is built once at the caps, measured, and built again with the message and
caption caps raised by what the room holds — two thirds to messages, a third to captions, and only for
a list whose cap actually bound — then trimmed to the line. The places added are recorded as `__fill`
(never sent), and the trim loop takes them back first, evenly across the list, before it would touch
any other list: so a source merged in later pushes out the extra, never the source. Only when there is
more than 1,500 characters of room, and never in the premium read, which keeps its own caps. Every run
therefore reads close to the 80,000 line; the worst-case cost is unchanged, and the typical one rises by
a fraction of a cent. The unit suite builds with `fill: false` unless a check asks for it, since most of
its checks are about the sampling rules at their caps.

**The budget counts the text the model is sent, not the JSON.** `renderEvidence` (in `docs/digest.js`,
which `lib/prompts.js` calls to write both prompts) keeps the small structured fields — profile,
counts, rhythm, coverage, the message statistics — as JSON and writes every list after them under its
own dotted path, one item per line, with ranked entries as "name ×count". The trim loop, the recorded
`coverage.digestChars`, the review file's size and the server's 413 check all measure that text
(`Digest.evidenceChars`). On a real heavy digest the saving over JSON is small — 78,697 characters
became 74,642, and about 4% fewer tokens by a GPT tokenizer, because most of a real digest is prose
where quotes and commas are a small share. (An earlier note here claimed 17–28%; that was measured on
fixtures made mostly of ranked lists.) The 3.5 characters per token the ceilings assume was measured
against Gemini on JSON and stays the conservative figure.

**Lines that share tags say them once.** Messages arrive grouped by conversation and then year, and
captions by year, so "[2024] [t3] " opening every line repeated what the line above had said — about a
tenth of the tokens in a real digest. `groupedLines` writes each run under one line of its tags
("[2024] [t3]:"), with "[untagged]:" where a run without tags follows one with them, and only the known
tags (a year, `t1`–`t99`, post/story/reel) count, so a caption that begins "[sic]" is never read as
one. On a real heavy digest that took 19,970 tokens to 17,861 (10.6%) and freed about 3,300 characters,
which went to messages: 250 became 270. The evidence's opening line tells the model how to read it.

**Other people's @handles never leave the device** (`pseudonymiseHandles`). In the reader's captions,
comments, messages, the liked-post captions and the Facebook text, every other @handle becomes a
numbered marker — "[P1]", "[P2]" — the same number for the same person throughout, case aside, so the
model can still see that one person is tagged in eight posts. The numbering is kept on the digest as
`__people`, which `forModel` never copies, so a source merged in later numbers a known person the
same. Email addresses are not mistaken for handles, and the reader's own "@PsycheUser" is left alone.
The ranked account lists (most liked, saved, engaged with) keep their real names: whether an account
is a friend, a brand or a newsroom is the evidence there. The saving is small — handles were about
2.8% of a real digest's tokens — but the privacy is not. The reader's own "PsycheUser" marker appeared
twice in a real digest, so it was left as it is.

**The names of people the reader messages are numbered too** (`pseudonymiseNames`, October 2026).
Handles were covered, but names were not: "dinner with Sarah" went to the model as written, and in
messages a name was blanked only when its owner was in that same conversation. Now every name the
export itself holds is collected on the device: the participants of the Instagram DMs
(`threadPartners`, `messageSenders`), Messenger threads and WhatsApp chats (each source's `names`,
held in memory and never copied into the digest), and Facebook friends. Each one becomes "[N1]",
"[N2]" wherever the reader's captions, comments, liked captions, messages, Facebook text or bio
mention it, the same number for the same person, kept as `__names` beside `__people` and never sent.
- **What counts as a match:** the whole name in any case, or the first name alone (three letters or
  more) in any case. A first name that is also a word (`COMMON_WORD_NAMES`: Will, Grace, May…) counts
  only capitalised and never as a sentence's first word, so "Will you come?" and "I will" stay.
  Chinese, Japanese and Korean names match inside their own script, which has no spaces. Surnames
  alone, two-letter names, placeholders such as "Instagram User", and the reader's own name are left
  alone.
- **The limit:** nothing here guesses. A friend who is mentioned but never messaged keeps their
  name, which is why the FAQ, privacy page and review note say "the names of people you message",
  not every name. A built-in list of common first names, or a name-recognition model in the browser
  (50–100 MB), were weighed and left out: the first misses many non-English names and catches
  ordinary capitalised words, and the second is too heavy for a phone.
- **The model is told:** the evidence's opening line and the prompt's marker rule name `[N1]`
  beside `[P1]`. The prompt line was rewritten shorter to make room, because the free prompt is held
  to `FREE_FIXED_INPUT_TOKENS` (9,998).
- **Wording made exact on the way:** the FAQ and the review popout's note used to say everyone
  else's @handles are removed. The ranked account lists keep real account names by design, so the
  FAQ now says "in your posts, comments and messages", and the note says *Your name, contact
  details, ID numbers and the handles in your own words are removed.* The note does not mention
  names: a longer one gave the review popout a second scrollbar at 560px tall, which a check
  forbids. The FAQ, privacy page and guide pages carry the names sentence.

**The name comes back on the device.** Everything the model returns says "PsycheUser" where the reader
is meant (the server sets the card's name to it outright), so the app gives the real name back before
anything is stored, shown, put in a compatibility link or printed (`withOwnName`): the card, the page's "…'s
psyche", the PDF header and any stray mention in the writing. Every way a card can arrive does this —
the free card, a paid report that writes a new card because a source was added on the way to paying
(which used to miss it), and a page that rejoins a job after the first was closed, which reads the name
from the job record written when the work started (`ownName`, kept only on the device). A profile stored
before that fix is mended the next time the archive is read on the device (`repairOwnName`), without
running anything again.

**What is de-identified before sending, and what is not.** On the device, before review: the reader's
name and username become "PsycheUser"; email addresses, phone numbers, and identity, card and postal
numbers become "PsycheEmail", "PsychePhone" and "PsycheNumber" (`ID_NUMBERS` — a Singapore NRIC/FIN, a
grouped card number, a postcode after "Singapore"). Since 27 October 2026 also: a US SSN, a Malaysian IC,
a Hong Kong ID, a UK National Insurance number, a passport number beside the word, a Singapore bank's
grouped account number or digits after *account/acct/a/c*, a Singapore car plate, an IP address, a crypto
wallet and a date of birth beside *DOB/born on* (all "PsycheNumber"); an IBAN that passes mod 97 and a
13–19 digit card number in any grouping that passes Luhn (`scrubNumbers`); passwords, OTPs, PINs, CVVs
and long API-key-like tokens, by the word beside them ("PsycheSecret", `SECRETS`; *forgot my password*
stays), and, also on 27 October, login codes of any shape (*backup code 8F3K-2LQ9*, *your code is 482913*)
and usernames given as one (*username: jsmith88*, *user id is 4471*, *login: ana.t*; *login is broken*
and *dress code* stay); and street addresses, a unit (#05-123), a block (Blk 123A) or a number before a street word, not
a year ("PsycheAddress", `ADDRESSES`); other people's @handles become "[P1]", "[P2]";
links are stripped; and activity dates — `rhythm.firstActivity`/`lastActivity` and each source's span —
are given to the month (`monthSpan`, applied again in `forModel` for digests stored before). The review
popout says so at its top in one line (`.deid-note`: "De-identified before sending. Your name, contact
details, ID numbers and the handles in your own words are removed.", set small at `.76rem` so it does not crowd
the list; the list itself scrolls inside a dialog up to 42rem tall and is never shorter than
`min(14rem, 35vh)`), and the FAQ has "Can the digest be linked back to me?". Both
say *de-identified*, not anonymous, on purpose: the reader's own writing, the real names of the accounts
they engage with most (kept because a friend versus a brand is the evidence there), first names and
places written in plain text, and their searches all remain, so someone who already knew them could
recognise them. Nothing in it names them, and no account or login travels with it.

**Sources loaded for an unlock survive a cancelled payment.** `pendingDataSourceReads` is cleared only
once `runPremiumAnalysis` succeeds, not when the data step ends, so a reader who adds Google or Facebook,
reviews, and cancels at the payment sheet finds them still loaded when they open the unlock, or Add /
change data, again.

**The premium read** (`DEEP_LIMITS`, `SOURCE_SHARES`, `premiumDigestFrom`). The full report is written
from the free card's own digest — up to 80,000 characters, **never trimmed** — with any source added at
the unlock merged on top, to a line of **160,000 characters**. There is no option for it (the "Deeper
read" checkbox is gone; the code's names still say `deep`), and nothing is built or kept for it at
upload: one summary per reader, the standard one (a `psycheai_digest_deep` left by an older version is
deleted at start-up).

*Why on top.* The free card's digest is filled by Instagram and Google at upload and lands near its
80,000 on a real account. Facebook and WhatsApp are usually added at the unlock; merged into that full
digest they used to be trimmed first and arrived as a few dozen lines. Now they get the room above it —
at least 80,000 between them — shared by weight:

| Added source | Weight | All three added to a full 80,000 | Why |
|---|---|---|---|
| WhatsApp | 34 | ~32,000 | the reader's private conversational voice — what attachment, conflict and relationships most depend on |
| Google | 25 | ~24,000 | searches and watching: the unperformed self |
| Facebook | 25 | ~24,000 | an older life stage: posts, comments, Messenger |

A source that needs less than its part hands the rest to the others by weight (`allocateShares`,
water-filling), and one added alone has the whole room. Instagram, and any source the card's digest
already carried and was not loaded again, are passed to the trim as `protect` and left exactly as they
are; a source loaded again replaces its older copy and counts as added. Only an added source over its
room is cut (`trimBySource`), evenly through the list (`dropEvenly`) rather than off its end, so its
newest lines are not the first to go. The caps in `DEEP_LIMITS` (100 channels, 140 Google searches, 300
Facebook posts and messages, 600 WhatsApp messages…) are wide enough that the weights decide the mix.

*At the unlock* (`collectDataForPremium`, `premiumDigestFrom`):

- **Nothing added:** the card's own 80,000-character digest is sent, and the card is **anchored, not
  redrawn** — the report explains the card the reader already has. The review still opens first
  (October 2026), with **Proceed** as its button, so a reader can untick a part or download the
  file before paying; it works on a copy marked `__unchanged`, so an unticked part leaves this report
  out of it without touching the card's own digest or redrawing the card. It used to go straight to
  the payment sheet, which left no way to look at what the report would be written from.
- **A source added or replaced:** that digest plus the new source, reviewed as what will be sent;
  the run redraws the card from it as well as writing the report. This holds even when the Instagram
  export is still in memory — it is not rebuilt wider. The standard digest takes the same new source,
  so later free runs see it.
- **Instagram itself loaded again:** the base is the standard digest of the new export (with the
  sources it already had), and anything else added goes on top the same way.
- **The paid re-run** (Add / change data after unlocking) builds and sends the premium read the same way.

The paid call sends `deep: true` only when something was added; the server allows the larger digest
only on a paid unlock that asks for it, rebuilds it field by field and re-applies the weights if
anything is over. The next unlock starts from the standard digest again, but since October 2026 the
premium read is also kept as the latest report's own evidence (`psycheai_report_digest`), exactly
as it was sent (`Digest.forModel`: no names, no numbering). It is written as
`psycheai_report_digest_next` just before the call and promoted when the report lands, here or in a
tab that rejoins the job (`keepReportDigest`). A paid re-run replaces it. It is in the backup file
and goes with Delete everything. It is never the base for another run. The two calls an unlock can make are held to **$0.247 together** at their worst: $0.079
for the card and $0.168 for the full report (`DEEP_FREE_COST_CAP`, `DEEP_COST_CAP`), against a US$5
payment.

A selftest check holds both: `charBudget` at each cap must cover `DIGEST_CHARS`, so raising the
digest, a prompt or an output cap past what its ceiling pays for fails there rather than on the bill.
Each 10,000 characters added to the digest costs each call about $0.002. The free card's output cap
is the number to tune, and `npm run usage` reports how much of it real card calls use; if card calls
fail on `MAX_TOKENS`, raise `CARD_MAX_OUTPUT_TOKENS` in `lib/gemini.js` and `FREE_MAX_OUTPUT_TOKENS`
together (a check holds them equal).

**What leaves the device is `Digest.forModel` of the reviewed digest**, for the free run and the
unlock alike, and the review's download is that same object; it says both calls read it. **The
server applies it again regardless.** `server.js` loads `docs/digest.js` at boot and runs
`Digest.forModel` on whatever it is posted, for both calls. Applying it twice changes nothing, which a
check holds. It does not prune a copy of the input: it builds a new object out of the fields it knows
and clamps every string in them, so unknown fields and padding never reach the model, and the trim
loop brings anything over the line back under it. The one thing construction cannot bound — the
number of keys inside the few objects copied whole — is caught by a size check, which refuses the
request with a 413. Honest exports never reach that check. The card is cached on what was sent, so a
re-run over the same evidence is answered from the card already made, at no cost.

**The paywall is enforced server-side, not just in the page.** `/api/analyse` with
`product: 'unlock'` returns the full report only with a verified unlock PaymentIntent or a valid
promo code, and refuses with a 402 otherwise. Before this change that request fell through to the
free path, which was harmless while both paths produced the same report. With the split it would
have given the paid half away. The unlock is one call on one authorisation (ledger kind
`bundled`, three uses for retries). `/api/premium-analysis` still answers for pages loaded before
this change and is otherwise unused. Profiles saved before the split already carry the whole
report, and keep it.

### One free analysis, then US$2 — and what actually stops a runaway bill

Every free report is a real, metered call to a model, and until recently
`/api/analyse` was completely open: no payment, no limit, nothing stopping a
loop. Two separate things now bound that, and it matters which does what,
because only one of them is enforcement.

**The daily ceiling is the enforcement** (`lib/budget.js`). A server-wide count
of free calls per UTC day, refusing past `PSYCHEAI_DAILY_FREE_LIMIT` (default
200 — sized against `FREE_COST_CAP`, so roughly US$12/day even if every run were
pathological). It applies to `/api/analyse`, and paid calls skip it entirely: a
busy day must not take away a run somebody has already been charged for.
`/api/compatibility` used to draw on it too and no longer does, because it is
no longer free — see the compatibility section below. Recorded *after* the model returns, so a provider
outage does not spend the budget on responses nobody received — the cost of
that ordering is a small overshoot under concurrency, which is the safe
direction to be wrong in.

Crucially, **what it records identifies nobody**: a date, a kind, a timestamp.
That is deliberate and checked. `docs/index.html` promises "no analytics, no
trackers, no cookies… no visitor count", and a tally keyed to anything about
the caller would make that false. A selftest check asserts the written row has
exactly three fields and that nothing in it resembles an address, a device or a
digest — so the ceiling cannot quietly grow into the visitor log the FAQ says
does not exist.

**The per-device allowance is a fair-use nudge, not a wall.** One analysis is
free per browser; each one after is US$2, whether it is a re-run with Google
or Facebook data added or a fresh Instagram upload — unless premium is already
unlocked, in which case a rerun is US$5 and rewrites the four paid sections
along with the free report; see "Re-running with additional data, from the
report page" below. The count lives in
`psycheai_runs`, and the single most important thing about it is that it is
**deliberately not in `KEYS`** — `store.clearAll()` iterates `KEYS`, so anything
listed there is wiped by "Delete everything", which was exactly the free way
round the allowance. It is kept apart with a comment saying so, and the delete
confirmation now names it: *"Your count of analyses already run is kept, so this
does not restore a free analysis."* That is both honest — the button does say
"everything" — and the better deterrent, since it tells a reader the trick does
not work rather than letting them find out.

**Be clear about the limit of that.** Clearing site data, a private window or a
different browser all reset the count, and the server cannot tell: it has no
idea whose first run this is, and giving it one would mean recognising a
returning device, which is the thing the FAQ promises it never does. So what
the server enforces is narrower and honest — a payment presented for a re-run
must be real, must be for the *right product*, and must not already have been
spent. It cannot tell a first run from a fifth. The allowance stops casual
repeat use; the daily ceiling is what bounds the bill.

**Two products through one pipeline.** `lib/stripe.js` carries `PRODUCTS` —
`unlock` at 199 and `analysis` at 99 — and every amount is read from there
rather than from the request, because an amount a client can influence is one it
can set to zero. `verifyPaid(id, product)` checks the retrieved PaymentIntent
against *that* product's price, so a US$2 re-run payment cannot be
re-presented to unlock US$5 of report; both directions are checked. The
ledger gained a `kind` for the same reason, with its own allowance per kind (5
for `premium`, 3 each for `analysis` and `bundled`), so spending a payment on
one leaves the others untouched. Rows written before `kind` existed read as
`premium`, which is what every one of them was.

**One unlock can buy two calls.** A reader who adds a Google or Facebook export
inside the unlock flow would otherwise end up with paid sections that had read
that export and free sections above them that had not — a gap only a further
US$2 could close, which is charging twice over for one decision to hand over
more data. So the US$5 covers both: `/api/analyse` accepts `product:
'unlock'`, verifies the intent against the *unlock* price, and ledgers the use
under `bundled` rather than `analysis`. Naming the product buys nothing on its
own — `verifyPaid` still checks the real amount, so an `analysis` intent
claiming to be an `unlock` fails to verify exactly as it did before. The free
report is generated **first**, deliberately: whichever call runs second can
fail with the first already delivered and nothing owed, whereas the reverse
order would leave a paid-for free report undelivered and no honest way to
retry it. The payment sheet says which of the two it is buying before the
charge, not after.

**The payment dialog serves both**, with one variable — `onPaymentAuthorised` —
deciding what happens once the money clears, rather than a second copy of the
wallet button, card fallback, promo field and mock-pay path. It is restored on
`close`, in the handler every exit passes through, because getting that restore
wrong would send a reader's US$5 down the analysis path. Moving it also fixed
a real bug: it used to live inside `#view-profile`, which carries `[hidden]`
whenever another view is showing, so the upload page could not display it at all
— a `<dialog>` inside a `display:none` ancestor has no box to paint however open
it claims to be.

### The US$5 unlock: four sections behind one paywall

**Wellbeing (titled Mental wellness until 25 October 2026), Attachment style, Career assessment and Let us roast you** sit behind a single
one-time **US$5** charge. One payment (or one promo code) opens all four; each renders as its own
cover until then, saying specifically what is behind it rather than gesturing at "more analysis".
Unlocking is taken on-site through Stripe's Payment Request Button so the browser offers Apple Pay or
Google Pay directly. The "Download full report" button is not gated on this — it always goes straight
to the email prompt described just above, and the file it writes carries exactly what was paid for
(see ["The rule for any paywalled section"](#the-rule-for-any-paywalled-section)).

All four are generated by **one** paid call, not four: `PREMIUM_SCHEMA` carries `wellness`,
`attachment`, `careerAssessment`, `harsh` and `advice` together, so the reader waits once and the
server bills once. That is also why the roast's register is called out explicitly in `PREMIUM_SYSTEM`
— three of the four sections are written in the free report's careful voice and the fourth is
deliberately not, and one call writing both has to be told where the line is.

All four carry the same small **"Premium"** badge beside their title, on the page and on the sample —
one label for "this is one of the things you paid for", rather than a badge worded per-section that
would suggest four different offers. `PAID_SECTIONS` in `docs/app.js` applies it uniformly rather than
each entry supplying its own text, so a fifth paid section gets the badge for free.

```bash
export STRIPE_SECRET_KEY=sk_...        # server-side only — creates and verifies PaymentIntents
export STRIPE_PUBLISHABLE_KEY=pk_...   # sent to the browser, safe to expose
export STRIPE_ACCOUNT_COUNTRY=SG       # optional — the merchant's country, not the buyer's
export PSYCHEAI_PAYMENTS_FILE=...      # optional — where the usage ledger lives; see below
export ANTHROPIC_API_KEY=...           # the paid call always runs on Claude — see below
export PSYCHEAI_PROMO_CODE=...         # optional — the operator's one uncapped code; see below
export PSYCHEAI_PROMO_CODES=AVA:50:2026-12-31,HALF:100:2026-12-31:50   # optional — CODE[:cap[:last day[:percent off]]]
export PSYCHEAI_STATS_TOKEN=...        # optional — unlocks GET /api/stats, the daily totals
npm start
```

Both Stripe keys are required — `STRIPE_SECRET_KEY` alone reports not-ready, since a real charge needs
the browser to have the publishable key too. `PSYCHEAI_MOCK=1` (`npm run mock`) skips Stripe entirely
on both ends: the server hands back a fake PaymentIntent instead of calling Stripe's API, and the
client never loads `js.stripe.com` at all — a "Simulate payment (mock mode)" button stands in for the
whole wallet round trip, the same way mock mode already stands in for a real model call. This is what
`tools/uitest.mjs` drives to test the unlock and the paid model call end to end without a real card.

**A promo code in a link.** Add `?promo=CODE` to any link to the site, and whoever opens it gets the
code without typing it. It works on any `PSYCHEAI_PROMO_CODES` or `PSYCHEAI_PROMO_CODE` code:

```
https://psycheai.io/?promo=HALF                      the front page
https://psycheai.io/?promo=HALF&via=ava              with a campaign tag too
https://psycheai.io/c/k7Qm2xPa1Z?promo=HALF#<key>    a personal link: ?promo= goes before the #
```

- **Kept and cleared from the address.** The page keeps the code for 30 days (`psycheai_link_promo`
  in local storage), so it survives the hours an Instagram export takes, and takes it out of the
  address bar. Delete everything clears it with the rest.
- **Named before the tap.** Under the full report's unlock button: *Promo code HALF from your link is
  applied at checkout.*
- **Applied as the payment sheet opens.** The code is filled in and asked about at once.
  - A **discount** re-prices the sheet straight away: price struck through, the discount, then *You
    pay*.
  - A **100% code** waits for the reader to tap **Apply**: *Promo code X unlocks the full report free.
    Tap Apply to start it.*
  - A code the server **refuses** (unknown, expired or used up) is said, cleared from the field and
    forgotten: *The promo code in your link (X) could not be used: it has expired.*
- **Nothing is trusted from the link.** The server judges the code exactly as if it were typed, so a
  made-up code in an address opens nothing. Caps, last days and redemption counts all apply as usual.
- **Short links keep it.** The `/c/<id>` redirect now carries the rest of the query string (`?promo=`,
  `?via=`) onto the page.

`tools/uitest.mjs` checks the whole path: the code kept and removed from the address, the note, the
sheet re-priced to US$2.50, a refused code forgotten, and the redirect keeping it.

**Prices are in the reader's own currency in the major markets, US dollars everywhere else.**
One table, `docs/prices.js`, is read by both sides — the page shows its prices from it and
`lib/stripe.js` charges and verifies only amounts from it:

| Market | Currency | Full premium report | Another Psyche Card |
|---|---|---|---|
| everywhere not listed | USD | US$5 | US$2 |
| Singapore | SGD | S$7 | S$3 |
| United Kingdom | GBP | £4 | £1.50 |
| Eurozone | EUR | €5 | €2 |
| Australia | AUD | A$8 | A$3 |
| Canada | CAD | C$7 | C$3 |
| New Zealand | NZD | NZ$9 | NZ$3.50 |
| Hong Kong | HKD | HK$39 | HK$15 |
| Japan | JPY | ¥800 | ¥300 |
| Switzerland, Liechtenstein | CHF | CHF 5 | CHF 2 |
| Malaysia | MYR | RM22 | RM9 |

Compatibility reports stay free everywhere. The page guesses the reader's country from the browser's
time zone (which follows the device), then from its language's region, and `localisePrices()` in
`docs/app.js` rewrites every quoted `US$5` / `US$2` in the copy and the FAQ to the local label. The
payment request names the currency; the server takes the amount from the table for that currency and
product — never from the client — and an unknown currency is charged in USD. `verifyPaid` holds a
PaymentIntent to the table's amount *for the currency it was paid in*, so 300 SGD cents (the S$3
card) is refused for the S$7 report, and a currency the table does not list is refused outright.
Because the guess is the browser's, a reader can move their clock to pay a different market's price;
the table is rounded equivalents, so the most that buys is a few cents either way.

**To change a price**, edit its row in `docs/prices.js` (amounts are in the currency's minor unit —
cents, pence — except JPY, which has none) and deploy. **To add a market**, add its currency row and
its country codes to `COUNTRY_CURRENCY` (and its time zones to `ZONE_COUNTRY` if they are not
already there). Nothing in Stripe needs setting up: a Singapore account (`STRIPE_ACCOUNT_COUNTRY`,
default `SG`) accepts all of these currencies on the same PaymentIntent API and converts them to SGD
on payout, at Stripe's conversion fee. There are no Render environment variables involved.
`tools/selftest.mjs` pins the table, the guess and both verification directions;
`tools/uitest.mjs` opens the page in `Asia/Singapore` and checks it shows S$7, its FAQ says S$7 and S$3,
no `US$` is left anywhere, and the payment it starts comes back as 700 SGD cents.

**The paid call runs on a fixed provider of its own, regardless of which one the free report used.**
`server.js`'s `premiumEngine()` picks its engine from `PSYCHEAI_PREMIUM_PROVIDER` (default `gemini`),
not through the same auto-detection `lib/provider.js` uses for the free report — both `lib/claude.js`
and `lib/gemini.js` are required directly, and whichever one `PSYCHEAI_PREMIUM_PROVIDER` names is the
only one whose key counts. A deployment with `ANTHROPIC_API_KEY` set but no `GEMINI_API_KEY` has a
working free report (Claude wins the free report's own auto-detection) and no working paid sections
at all, rather than them quietly running on Claude — the premium engine does not fall back to
whichever key exists. All keys can be set on the same server at once: `lib/provider.js` picks one for
the free report by its own priority order (Gemini first), and `PSYCHEAI_PREMIUM_PROVIDER` decides the
paid call entirely independently of that choice. Mock mode is the one exception: with
`PSYCHEAI_MOCK=1`, `provider.active` is already the mock module and `premiumEngine()` follows it there
rather than demanding a real key just to click through the flow.

**Gemini 3.8 Flash is the current choice, on price** — the same four sections cost a fraction as much
to generate as they did on Claude. **Set `PSYCHEAI_PREMIUM_PROVIDER=anthropic` to revert to Claude
Sonnet 5** (`PREMIUM_MODEL` in `lib/claude.js`) with no code change — that is the whole reason the
provider is a runtime switch rather than a single `require('./lib/claude')`: Claude follows the
wellness section's hard limits more reliably, which is the section with the most to lose from a model
that follows instructions loosely, and reverting should be one environment variable away if Gemini's
output quality on the paid sections doesn't hold up. See ["Cost"](#cost) for what each choice actually
costs per run and where the margin goes.

**A promo code bypasses payment entirely.** The unlock dialog carries a promo-code field at its foot,
independent of the Stripe flow above it — entering the right code calls `/api/premium-analysis` with a
`promoCode` instead of a `paymentIntentId`, and `server.js`'s `isValidPromoCode()` checks it
case-insensitively against `PSYCHEAI_PROMO_CODE`. A valid code skips `verifyPaid` and the usage
ledger both — there is no payment to verify and no use to meter — so it works even on a server with
no Stripe keys configured at all, as long as the premium engine itself is set up.

**There is no default, and an unset variable means no promo path at all.** This used to fall back to
a literal string when `PSYCHEAI_PROMO_CODE` was unset, and that string sat in `server.js`, in this
README and in the test suite — in a public repository. Anyone who read any of the three had a free
pass around every paid gate on any deployment that had not set the variable, which is to say the
paid gates were decorative. A secret with a default committed next to it is not a secret; it is a
password prompt shipped with the password. Unset now switches redemption off rather than falling
back to something guessable, and the self-test's first check on this is that the old built-in code
unlocks nothing. **Any deployment that was relying on the default needs a fresh random value set in
its environment; the old code should be treated as burned.**

### How the front page loads

A first visit to the front page used to download **1,856 KB**, almost all of it text sent
uncompressed: `app.js` alone was 500 KB. It now downloads **445 KB, 76% less**, and nothing the
reader sees changed.

| | Before | After |
| --- | --- | --- |
| Text (HTML, JS, CSS, JSON) | ~1,700 KB raw | ~390 KB Brotli |
| `sample.json` | fetched 3 times | fetched once |
| Video poster | 75 KB JPEG | 49 KB WebP |
| **First visit** | **1,856 KB** | **445 KB** |

- **Compression** (`lib/staticfiles.js`): text and SVG go out Brotli-compressed (quality 11), or
  gzip to a browser that accepts only that. The browser unpacks exactly the bytes on disk, so nothing
  is lost. Each compressed copy is made once per file version, off the event loop, and kept in
  memory. The server makes them at startup (`staticFiles.warm`), so the first visitor after a deploy
  doesn't wait for it. Images and video are already compressed, so they go out as they are.
- **Revalidation:** every file carries a weak ETag (size and modification time). `Cache-Control`
  stays `no-cache`, meaning "check before reusing", so a returning visitor's browser asks and gets a
  bodiless 304 when its copy is current. Long-lived caching would need fingerprinted file names
  (`app.3f9c.js`) and a build step, so a deploy could never be masked by a stale copy. This gets most
  of the gain without one.
- **The sample preview** is drawn several times as the page boots, and each draw used to start its
  own download of `sample.json` and `sample-cards.json`. One shared load (`loadSample`) now serves them all.
- **The video poster** is WebP at quality 85: 49 KB instead of 75 KB, at 42 dB PSNR against the JPEG
  it replaces, which is not a visible difference. Browsers older than Safari 14 (2020) cannot show WebP
  and would show an empty frame until the video plays.

What is left: `app.js` (120 KB compressed) is the largest file. Scripts used only after an upload
(`pdf.js`, `digest.js`, `instagram.js`, `supplement.js`, `whatsapp.js`, `zip.js`, `vendor/qrcode.js`,
about 115 KB compressed together) still load on the front page. Loading them on demand is the next
saving, but it changes when globals exist, so it is a larger change than this one.

`tools/uitest.mjs` checks that `app.js` arrives as Brotli, is identical once unpacked, and is under a
third of its size. It also checks the 304, that images are not compressed twice, and that the
samples are fetched once.

### What `/api/status` tells the world

`/api/status` is public, and so is the repository, so it returns only what the page uses:

```json
{"ready":true,"mock":false,"freeAnalyses":1,"shortLinks":true,"firstRun":"merged","build":{"version":"3.0.0"}}
```

It used to also return the provider and model, the premium engine, the exact commit and branch, the
deploy time and platform, the payment settings, and a hint naming any missing API keys. With the code
public, that told anyone exactly which version was live, including any window before a fix was
deployed. None of it was needed by the page:
- Stripe's publishable key comes back with each payment intent.
- Prices come from `docs/prices.js`.
- The footer now shows only the version (`v3.0.0`), with no commit link. The PDF's running head
  does the same.

**The source links** (the footer's *Source code on GitHub*, the FAQ's *read what the browser sends*, the privacy
page's *is public*) go to the branch Render deploys from, `tree/claude/instagram-personality-compatibility-oqhpa3`,
since 25 October 2026, rather than the repository's front page: every push to it deploys, so what a reader reads
there is the code that is live, whatever the repository's default branch becomes. Not to the exact commit, which
would mean serving the commit to the page, and that stays in the log (below).

The operator still sees the build: the server logs the version, commit, branch and platform at
startup (`Build: v3.0.0 · 02f449d · <branch>`), and Render's dashboard shows the deployed commit.

When the server has no provider, the page says only that analyses are unavailable right now.
`tools/selftest.mjs` pins the exact set of keys, so a new field cannot be added without a test change.

The reader's own report still names the model that wrote it (*Psyche Card generated by … on …*).
That comes from their own analysis response, not from this route, and the privacy policy names
Google Gemini and Anthropic Claude as processors anyway.

### Security headers

Every response — static and API alike — carries a CSP, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` and (24 October 2026)
`Cross-Origin-Opener-Policy: same-origin-allow-popups`, set before the request branches so no route
can be added that forgets them. The last means a page that opens this site in a window of its own
cannot reach into it through `window.opener`; windows this site or Stripe's frame opens keep theirs,
so Apple Pay, Google Pay and the share links work as before.

Worth being accurate about what the CSP does here rather than claiming more. Model output is
rendered with `innerHTML`, which sounds alarming, but it passes through `esc()` in `docs/app.js`
first — 191 call sites, escaping the five characters that matter. There is no known XSS to close.
What the policy buys is the *next* one: 191 escape sites is a lot of places to miss one later, and a
missed escape behind a CSP is a broken paragraph instead of a stolen report.

The policy can afford to be strict because the app is unusually self-contained — every script is a
file in `docs/`, there is not one inline `<script>` or `on*` handler in `index.html`, no web fonts,
no analytics, no CDN. Stripe is the single exception and gets exactly the three origins its own
documentation names. `script-src` carries no `unsafe-inline` and no `unsafe-eval`.

The one genuine weakness is `style-src 'unsafe-inline'`, for the handful of `style=""` attributes in
`index.html`. Styles cannot exfiltrate on their own the way scripts can; removing it means moving
those attributes into `styles.css`, which is worth doing and was not worth blocking this on.

HSTS is sent **only** when the request demonstrably arrived over TLS — `x-forwarded-proto: https`,
or an encrypted socket. Not a nicety: a browser that accepts HSTS for `http://localhost` will refuse
to load any `http://localhost` for a year afterwards, across every project on that machine.

The strongest coverage of the policy is not the header assertions in the UI suite but the
console-error collector at the top of it. Chromium reports every refused load as a console error, so
the whole suite doubles as a CSP smoke test: anything the policy wrongly blocks fails the
end-of-suite "no console errors" check.

**Stripe.js is the one script in this app not vendored under `docs/vendor/`.** Every other third-party
script here is a local file, on the reasoning that nothing should reach a CDN this app doesn't control
— but Stripe does not support a pinned local copy, since the file at that URL carries its own
fraud-detection updates, and it is loaded on demand from `app.js` only once a reader actually presses
Unlock rather than fetched by every visitor whether or not they ever reach this section.

#### The card fallback, for a browser with no wallet

Stripe's Payment Request Button decides which wallet, if either, a browser offers by calling
`paymentRequest.canMakePayment()` — and it resolving falsy is not rare. It happens whenever a device
has no card actually added to Apple Wallet or Google Pay for web use, and just as often when the
*site's own domain* has never been registered with Stripe for Apple Pay (Stripe Dashboard → Payment
methods → Apple Pay → Add a new domain, plus hosting the verification file Apple's side of that
handshake expects) or the page is not served over HTTPS — both of which read to `canMakePayment()`
exactly like a phone with an empty Wallet does. Before this, a reader in any of those situations saw
"This browser does not have Apple Pay or Google Pay available to it" and then nothing: the only other
way to authorise the same call was the promo-code field, which an ordinary paying customer does not
have. A real customer, on a real iPhone, with Apple Pay switched on at the OS level, could reach
Unlock and simply have no way to pay.

**`mountCardFallback` in `docs/app.js` is the other half of what `canMakePayment()` resolving false
means**, not a separate feature bolted beside it: a plain Stripe Card Element, mounted into
`#premium-card-fallback` the moment the wallet button reports it cannot be used, right there in the
same dialog rather than behind a second click. `#premium-status` was moved a few lines up in
`index.html` to sit above the card form rather than below it (its long-standing spot, from before
there was anything after the wallet button worth reading in sequence) — the "no wallet" message is
what the form is answering, so it has to read before the form, not underneath a button the reader has
already pressed by the time they reach it.

Confirming with `stripe.confirmCardPayment(intent.clientSecret, { payment_method: { card } })` is
simpler than the wallet path just above it in the file: a single call walks a card through 3D Secure
itself if one asks for it, where the wallet flow needs `handleActions: false` on a first pass and an
explicit second `confirmCardPayment()` only for the cards that come back `requires_action` — that
two-step exists because the wallet flow has its own `paymentmethod` event to complete first, which the
card form has no equivalent of. A decline surfaces Stripe's own message beside the form and leaves the
dialog open with the section still locked, so trying again — a typo fixed, a different card — reuses
the same mounted form rather than reopening the dialog from nothing.

**Genuinely testing this needed its own page.** `canMakePayment()`'s real answer depends on the actual
device, which is exactly why the rest of this suite drives the unlock through `#premium-mock-pay`
rather than the real Stripe path at all — and that stand-in never reaches `mountCardFallback` either. A
fake `window.Stripe`, injected before the dialog opens, stands in for the real script the same way
`#premium-mock-pay` stands in for the whole flow elsewhere; the one thing neither mock mode nor a real
device in CI can supply is a browser that genuinely owns a wallet-eligible card. It runs on its own
`browser.newPage()` — its own browser context, its own `localStorage` — seeded directly with a profile
built from `docs/sample.json` (skipping the upload wizard entirely) so that page's real unlock, run
against this same mock-mode server, cannot affect the shared page every other check in this file
depends on finding locked. The PaymentIntent itself is not faked: the interception only overwrites
`mock`/`publishableKey` in the response after letting the real request register the id in the server's
own `mockIntents` set, so a fabricated `confirmCardPayment` result still drives a real,
server-verified `/api/premium-analysis` call rather than every layer being a fake talking to another
fake. Fault-injecting the `mountCardFallback` call away, and separately injecting a bug that called
`runPremiumAnalysis` regardless of `confirmation.error`, both reproduced the exact failures the checks
exist to catch — a browser with no wallet left staring at a dead end, and a declined card silently
treated as a successful one.

#### What actually gates the content

An earlier version of this feature had a real problem: "unlocked" was a boolean the *browser* set on
itself once the Payment Request flow reported success, and nothing on the server ever checked that
claim against Stripe. Anyone with devtools open — no special tooling, every browser has this — could
set `state.profile.premiumUnlocked = true` in the console, or just hand-edit the `psycheai_profile`
entry in Local Storage, and see the roast for nothing. Worse, because the unlocked content used to be
static copy sitting in `docs/copy.js`, it shipped to *every* visitor's browser regardless of payment —
it never needed a bypass in the first place, just View Source.

Both problems are closed by making the paid content something the server generates on demand, gated on
its own verification, rather than something the client reveals:

- `POST /api/create-payment-intent` creates the PaymentIntent — the amount is fixed in `lib/stripe.js`
  and never taken from the request, so there is nothing in the body a client could tamper with to
  change what it pays.
- `POST /api/premium-analysis` is the route that actually matters. It takes the digest (resent exactly
  as `/api/analyse` takes it — nothing is stored between the two calls, so this is not a second upload,
  it is the browser's own `psycheai_digest` travelling again) and either a `paymentIntentId` or a
  `promoCode`. Given a `paymentIntentId`, it calls `payments.verifyPaid(paymentIntentId)` before it will
  spend a single token, which independently **re-retrieves that PaymentIntent from Stripe** and confirms
  both that it actually succeeded and that it was for the real US$5 in SGD — status alone is not enough, or a
  client could present some other real PaymentIntent it holds, for any amount, and pass a check that
  only asked whether *something* had succeeded. Given a `promoCode` instead, it checks that against
  `isValidPromoCode()` and skips `verifyPaid` and the ledger below entirely — there is no payment behind
  a promo redemption to verify or meter.
- The model call happens **only after** that check passes, and the result is returned directly — never
  written anywhere the client could read it without asking. There is no static "unlocked" string left
  in the shipped JS for View Source to find, because there no longer is one.

That still leaves one gap `verifyPaid` alone cannot close: a genuinely successful PaymentIntent
verifies as successful *every time it is re-presented*, so without something else, one payment would
buy unlimited free re-generations. `lib/premiumLedger.js` is that something else — a flat, append-only
JSONL file (no database, survives a
restart, greppable) recording each time a PaymentIntent is actually spent, and capping it at five uses
per payment. Five rather than one, because a network error after a real, billed model call should not
strand a reader who paid with nothing to show for it — the cap exists to stop unlimited abuse, not to
punish a legitimate retry.

This is the one piece of server-side state this app keeps about a payment, in a project otherwise
built around having none. It exists because "no database" was, until it existed, exactly how the paid
section could be read for free.

**What this still does not do, on purpose:** there is no webhook, so a browser that closes the instant
after Stripe confirms a charge but before `/api/premium-analysis` returns has been charged with nothing
to show for it yet — though the ledger's cap of five means the reader (or the operator, on request) can
still retry the same payment later and get their generation. A webhook would need a public HTTPS
endpoint registered with Stripe and a signing secret, both deployment-specific in a way the rest of
this app deliberately isn't, so it's left for whoever actually deploys this with real keys. The unlock
is also purely local once delivered: the generated analysis is stored in the same `psycheai_profile`
record everything else about a report is, so it is gone the moment that record is (a fresh analysis,
"Delete everything", or simply a different browser) — there is no account for a payment to attach to,
the same way there is no account for anything else in this app.

#### What the paid section actually asks the model for, and what it refused to

`PREMIUM_SCHEMA` carries the roast's two fields, `harsh` and `advice` — moved here from the free
report, unchanged in substance. It briefly carried two more fields, `patternsWorthAttention` and
`lifeAdvice`, for a second paid section ("Supplementary analysis") sold alongside the roast. That
section was requested as two prompts — "advice on how to live your life better", and "what mental
illness or disorders you should look out for" — the second of which was declined, deliberately, not
built as asked; the section itself was later cut entirely, so this call is the roast and nothing else
again.

`lib/prompts.js` carries an explicit, repeatedly-restated rule that the roast is not licensed to name,
imply or predict a clinical condition even though it is deliberately unkind otherwise — the comment
there says the rule "holds hardest" in exactly the section most tempted to break it. Asking a model to
name what mental illness a reader might have, from Instagram behaviour, would be a confident false
medical claim: no clinical training, no history, no assessment, no standing, in a document the reader
paid for and may keep or show to someone else. `PREMIUM_SYSTEM`'s hard limits restate this ban in full
rather than assuming it carries over from the free report's prompt (it does not — this is its own
system prompt on its own call), stated to hold *however directly the reader framed what they wanted* —
which is there because the framing was, literally, that request.

The safety caveat itself is not something the model writes: unlike the validity caveats elsewhere in
this file (MBTI, love languages — "this framework is popular rather than validated"),
`PREMIUM_SCHEMA` has no `caveat` field at all. It is fixed copy (`bonusCaveat` in `docs/copy.js`) shown
beside the writing regardless of what came back, so it is never subject to being softened, forgotten or
phrased differently on a given run.

Unlike the free report, this call receives no photographs — only the digest — so the roast's old
instructions to draw on a photo when one gave it something worth saying moved out with the rest of the
free report's photograph handling; `summary` is now the only field in either call that reasons about
images at all.

#### Waiting for it, and not losing it

This subsection's tuning knobs (`PREMIUM_MODEL`, `PSYCHEAI_PREMIUM_MODEL`, `PSYCHEAI_PREMIUM_EFFORT`)
are Claude-specific and only take effect when `PSYCHEAI_PREMIUM_PROVIDER=anthropic` — the current
default is Gemini, described just above under "The US$5 unlock". The Opus→Sonnet history below
still explains why Claude runs the way it does on the path back to it.

The paid call is slow by nature: four sections from a ~45,000-token digest with adaptive thinking on,
and unlike the free report, the reader is watching it having already paid — the worst place in the app
to make somebody wait. Four sections written on Opus with thinking at `high` measured **past five
minutes** of wall clock, which is what first forced a choice between latency and quality on this call.

**The choice made twice, in opposite directions, and the second one is the one that stuck.** The first
fix dropped effort to `medium` on Opus — cutting thinking tokens cuts both the wait and the bill, but
at a real quality cost on the section with the tightest hard limits in the app. The second, current fix
instead moved the *model*: the paid call now runs on **Sonnet 5** (`PREMIUM_MODEL` in `lib/claude.js`,
independent of `MODEL`, which is still what the free report's own Claude fallback uses), with effort
put back to `high`. Sonnet runs at roughly 60% of Opus's rate on both input and output at the same
effort, which is enough of a gap that `high` on Sonnet is expected to cost no more than `medium` did on
Opus — full effort, for close to what a reduced one cost before. `PSYCHEAI_PREMIUM_EFFORT` still trades
some of that back for latency if the wait matters more than the quality on a given deployment;
`PSYCHEAI_PREMIUM_MODEL` overrides the model choice the same way; `PSYCHEAI_EFFORT`/`PSYCHEAI_MODEL`
are the free report's own, unaffected by either. An unrecognised effort level throws at boot rather
than reaching the API as a 400 on a call somebody has already paid for.

Sonnet's own speed does not fully cancel `high` costing more wall clock than `medium` did — the reader
may still wait several minutes, and the dialog's copy is written to that expectation rather than a
shorter one. Two more levers exist and are deliberately not taken by default: **fast mode**
(`speed: 'fast'`) is up to 2.5× the output rate — Anthropic's docs describe it as tuned for Opus 5, so
it is a lever this call left behind when it left Opus, not one available to reach for on Sonnet without
its own testing; and **splitting the one call into two parallel ones** — the three considered sections,
and the roast — would make wall clock `max(a, b)` instead of one long generation, and halve each
compiled grammar as a side effect, at the price of sending the digest twice (about +$0.13 on a heavy
run at Sonnet's input rate, down from +$0.22 when this call ran on Opus) and doubling the failure
surface on a route that handles money.

**The socket underneath it needed its own fix, unrelated to how long the call takes.** Node closes an
idle keep-alive socket after **5 seconds** by default. The reverse proxy in front of this server holds
connections open longer than that to reuse them, and Render's own troubleshooting docs name that exact
mismatch as the cause of intermittent timeouts and "Connection reset by peer" on Node services.
`server.js` now sets `keepAliveTimeout` to 120s (`PSYCHEAI_KEEPALIVE_MS`) and `headersTimeout` five
seconds above it — the ordering matters, since inverted, the header timer expires while keep-alive
still considers the socket healthy. Three checks pin it, because a two-line config like this reads as
inert and the defaults it falls back to are silent rather than loud.

Worth being precise about what this does *not* fix: it governs sockets **between** requests, not a
single response that takes minutes to produce. Node's `requestTimeout` (5 minutes, default) measures
receiving the *request* and stops once the body is in, so the paid call's generation time afterwards
is not on any of these clocks. If a reader still sees "Could not reach the PsycheAI server" mid-wait,
this was not the cause and the next suspect is the client, not the socket — see the mobile note below.

**The dialog now says so.** It reads "this usually takes a few minutes, and can pass five. Keep this
tab open — if you do lose it, you will not be charged again", beside the live seconds counter that was
already there. A `beforeunload` guard asks before the tab closes mid-call; browsers have ignored
custom wording there since about 2016, so it only decides *whether* to ask.

**And losing the tab no longer loses the purchase.** This is the part that was actually broken: every
trace of a paid run lived in one page's memory, so closing the tab at minute four meant the payment
was real, the analysis was gone, and the cover went back to asking for US$5. The server has always
allowed a handful of generations per PaymentIntent (`lib/premiumLedger.js`, `MAX_USES = 5`) for
exactly this — the browser simply had no way to know it was entitled to one.

It does now. A **receipt** is written to `psycheai_unlock` the moment payment clears and *before* the
analysis is asked for — written on success it would arrive exactly when it is no longer needed. On
the next visit the covers read **"Get the sections you paid for"** instead of a price, and the dialog
leads with "You have already paid" and returns before `create-payment-intent` is ever reached. That
last part is the one that protects money: asking Stripe for a second PaymentIntent there is how a
reader ends up charged twice for one unlock, and a check counts the real requests rather than
inferring it from the UI.

The receipt holds **the authorisation and nothing else** — a PaymentIntent id or a promo code, both
re-verified server-side on every use. Not the report: that lives in `psycheai_profile` with the rest
of it, and a second copy of somebody's roast on their disk buys nothing. A check asserts the stored
blob contains none of the writing.

**A server-side cache of the finished analysis would have been faster, and is deliberately not what
this does.** It would survive a closed tab with no regeneration at all — but this app's whole shape is
that the server keeps no reader's data, and holding generated reports there to cover a lost tab trades
that promise for a convenience the ledger already covers. The cost of the choice is that resuming
re-runs the model call. That cost falls on whoever runs the server, which is the right person to carry
it.

Fault-injected both ways: writing the receipt *after* the call instead of before reproduces the
original symptom exactly — a reader who paid, shown "Unlock — US$5" — and letting the resume path
fall through to `create-payment-intent` fails the double-charge check.

#### The compiled grammar, and the 400 it returned

**This broke in production the day the paid call moved to Claude, and it is worth recording why.**
Structured outputs compile the schema into a sampling grammar, and a schema whose grammar compiles
too large is refused outright:

```
400 invalid_request_error: The compiled grammar is too large, which would cause
performance issues. Simplify your tool schemas or reduce the number of strict tools.
```

The limit is undocumented — [it is only findable by hitting
it](https://github.com/anthropics/anthropic-sdk-python/issues/1185) — and the one documented cause is
that **repeated sub-schemas compound grammar size**. That is exactly what `wellness` was: six
structurally identical dimension objects, each `{enum, enum, string, string[]}`, inlined six times.
`description` is not part of the grammar (changing one does not even invalidate Anthropic's grammar
cache), so the schema's bulk was never the issue — its *repetition* was.

**Every repeated shape is now one definition under `$defs`, referenced.** Six dimension copies became
one; `{title, detail}` and `{headline, detail}` went the same way. A check states the rule generally
rather than naming `wellness` — *no sub-schema is inlined more than once* — so the next section added
here cannot quietly reintroduce it. The per-dimension guidance that lived in six schema descriptions
moved into `PREMIUM_SYSTEM`, rendered from the same `WELLNESS_DIMENSIONS` array the schema references
are built from, so the two cannot drift and the guidance survives whether or not a provider honours a
`description` sitting beside a `$ref`.

**But the real fix is that a grammar refusal can no longer strand a paying reader.** `lib/claude.js`
now runs three attempts, each reached for a reason narrow enough to name: betas + grammar; no betas,
still grammar (a 400 at step one is almost always the fallback beta not being enabled); and — only
when the message says the grammar is too large — no grammar at all, with the schema moved into the
prompt and the response parsed. An unrelated 400 stops at step two rather than silently dropping the
schema, which would turn a clear error into a confusing one.

That third stage exists because of *where* this call sits. It runs after the money has been taken.
Hard-failing there and showing somebody a raw JSON 400 — which is what happened — is the worst
outcome in the app, and worse than a report the API did not shape-check. The parse is tolerant only
on that path: with the grammar in force the body is bare JSON and anything else is a real break worth
surfacing, so prose around JSON is accepted on the fallback and rejected on the normal path. The
result carries `constrained`, so a run that lost the guarantee is distinguishable from one that kept
it.

**None of this was caught by the suite, because nothing in the suite talks to the real API.** The
fake-SDK fixture now pins the whole ladder — the fallback, the three-call count, fenced JSON with
prose around it, strictness on the constrained path, and an unrelated 400 not reaching stage three.
Fault-injecting the third stage away reproduces the production failure exactly.

**`PROFILE_SCHEMA` is very likely over the same line** — 401 inlined nodes against the premium
schema's 185, with four repeated sub-schemas still in it. It has never hit this because the free
report runs on Gemini. A deployment with only `ANTHROPIC_API_KEY` set would run it on Claude, and
should expect the fallback to carry it. It has been left alone rather than refactored blind: it works
on the provider it actually uses, and the fallback covers the case where it does not.

#### Cost

Two real API calls happen per unlock, and they run on **independently chosen providers**: the free
report on whichever one `lib/provider.js` picks, the four paid sections on whichever one
`PSYCHEAI_PREMIUM_PROVIDER` names. They are not the same call — the paid pass is an independent
request against the *same* digest, so its input cost is not free just because the first call already
saw that data.

**The pricing and comparison below is all Claude, because that is what it was measured against.**
`PSYCHEAI_PREMIUM_PROVIDER` currently defaults to `gemini` (see "The US$5 unlock", above) — Gemini's
own per-token rate on the paid call has not been re-measured into a table here yet, so treat this
section as what the numbers look like on the `anthropic` revert path, not the default one.

**The free report got cheaper.** Moving `wellness`, `attachment` and `careerAssessment` out of
`PROFILE_SCHEMA`/`PROFILE_SYSTEM` took about **5,600 tokens** of prompt and schema off every free run
— `FIXED_INPUT_TOKENS` dropped from 19,700 to 14,200, which is also 19,800 more characters of digest
that `COST_CAP` now buys (the ceiling went from 221,741 to 240,991).

| | Free report (Gemini) | Paid sections (Claude) |
|---|---|---|
| Fixed prompt + schema | 13,852 tok | 8,798 tok (`PREMIUM_SYSTEM`+`PREMIUM_SCHEMA`) |
| Digest, heavy account (156k chars) | 44,706 tok | 44,706 tok (same digest, resent) |
| Images | 14 × 258 = 3,612 tok | none — this call gets no photographs |
| Output cap | 16,000 tok | 32,000 tok (`lib/claude.js`'s `MAX_TOKENS`) |

**Per paid run, by model.** Input is the fixed prompt plus the digest; "typical" is a ~40KB digest
with ~9,000 output tokens, "heavy" is the 156KB fixture at the same output, "worst" is a
ceiling-filling digest at the full 32,000-token output cap. Adaptive thinking bills as output, so the
output column is where the spread lives.

| Model | Input $/1M | Output $/1M | Typical | Heavy | Worst case |
|---|---|---|---|---|---|
| **Claude Sonnet 5** (`claude-sonnet-5`, current, list rate) | $3 | $15 | **$0.20** | **$0.30** | **$0.71** |
| Claude Sonnet 5 (intro rate, if it applies) | $2 | $10 | $0.13 | $0.20 | $0.48 |
| Claude Opus 5 (previous default, still available via `PSYCHEAI_PREMIUM_MODEL`) | $5 | $25 | $0.33 | $0.49 | $1.19 |
| Claude Opus 4.8 / 4.7 | $5 | $25 | $0.33 | $0.49 | $1.19 |
| Claude Haiku 4.5 | $1 | $5 | $0.07 | $0.10 | $0.24 |
| Claude Fable 5 | $10 | $50 | $0.65 | $0.99 | $2.38 |

**The difference the model switch made, holding effort at `high` on both sides:** typical drops from
$0.33 to $0.20 (about **39% less**), heavy from $0.49 to $0.30 (about **39% less**), worst case from
$1.19 to $0.71 (about **40% less**) — matching Sonnet's list-rate discount against Opus almost exactly,
since both are the same digest and (by assumption) close to the same output length at the same effort.
That is *before* accounting for `medium` effort's own token savings on the old Opus configuration this
replaces — the actual before/after gap in production is probably smaller than 39%, since the thing
being replaced was Opus at reduced effort, not Opus at `high`. Anthropic does not publish a fixed
token-budget ratio between named effort levels, so that narrower comparison cannot be computed exactly
without a real measured run; what is certain is the direction — Sonnet at `high` costs meaningfully
less than Opus did at `high`, and is expected to cost no more than Opus did at `medium`, while restoring
the effort the reduction had traded away.

**What that leaves.** At the old S$1.99 price this was thin; at **US$5** it is not. Stripe takes about
3.4% plus a fixed fee of roughly US$0.40, so net is about **US$4.4** per unlock — against a paid call
capped at US$0.151 (`COST_CAP`) and a free card capped at US$0.053. The figures below were worked at the
old price, against a Sonnet 5 call, and are kept for the record:

- **Typical run: ~$0.20, about 19% of net.** Healthy, and lower than Opus's own 31% was.
- **Heavy account: ~$0.30, about 29% of net.** Still comfortably fine.
- **Worst case: ~$0.71, about 68% of net.** Thinner than Opus's worst case (113%, an outright loss),
  but still worth naming plainly: it requires both a ceiling-filling digest *and* the full
  32,000-token output, and the per-source caps make the first unreachable on real input (a heavy real
  account is 156KB against a 241KB ceiling). The output half stays reachable on its own with effort at
  `high` — thinking bills as output, and this is a four-section report rather than a two-field roast —
  but landing there no longer means a loss the way it did on Opus.

**Two levers remain, if the margin gets uncomfortable again**, in the order worth reaching for them:
drop the paid call's `effort` back to `medium` via `PSYCHEAI_PREMIUM_EFFORT`, which cuts thinking
tokens without touching the schema (the same trade this call already made once, on the model it has
since moved off); or lower `MAX_TOKENS` in `lib/claude.js` from 32,000, which bounds the worst case
directly (the free report's own cap is 16,000). Moving to a cheaper model again is no longer free —
Sonnet is already the cheaper move taken; only Haiku is left below it, at a real quality cost on the
section with the tightest hard limits in the app. Nothing here needs the price to change.

**The digest is still sent twice, and switching models does not fix that.** It is sent in full to both
calls. Claude's prompt caching (`cache_control: { type: 'ephemeral' }` in `lib/claude.js`) caches the
system prompt, not the digest — and even if it covered the digest, the two calls use different system
prompts on different providers, so there is no shared prefix to hit. The ~$0.13 of digest input on a
heavy run at Sonnet's list rate (down from ~$0.22 when this call ran on Opus) is paid in full on every
unlock. Trimming what the paid call receives is the only real saving available, and it would need its
own budget rather than reusing the free report's.

### Compatibility is a link, not a QR code

Compatibility used to travel two ways: a link, and a QR code of the same link with a camera scanner
and an image upload to read one. The code is gone. A whole card is a dense code, around 87 modules
across, so it needed a camera at close range and a carefully backed canvas to scan at all; it could
not be read off a screenshot posted to a Story, which is where people actually share; and all it
ever did was open the same link a tap opens. Removing it took out two vendored libraries
(`qrcode.js`, `jsqr.js`, the second patched for a version-23 bug of its own), the camera permission
in `Permissions-Policy`, and several hundred lines of decoding, tiling and labelling code.

Nor is the link printed on the Psyche Card. An image cannot carry a link anyone can tap, and a code
on a card posted to a Story would hand the compact card, Big Five scores and all, to everyone who
saw it, so anyone could run a comparison against someone who never sent it to them. The card carries
the address instead (`psycheai.io`), and the link goes person to person.

**Send my link** hands the share sheet a message written in the sender's voice: *"Let's see how
compatible we are! Make your free Psyche Card and our compatibility analysis runs straight after,
also free: <link>"*. Where there is no share sheet (most desktops) the same message goes to the
clipboard and a line under the buttons says so. **Copy link** copies the bare link. Both sit in the
profile page's popout and on **My Compatibility**, which also takes a pasted link for one that
arrived some other way. The link carries the card in the fragment (`#p=…`), which a browser never
sends to a server.

The analysis runs on the side of whoever opens the link, so the sender does not get the report. The
compatibility report therefore ends with **Want Ava to see it too?** and a **Send my link** button,
so the other person gets their own — the loop closes both ways.

### The mark

`BRAND_MARK` in `docs/copy.js` is the logo, and it is drawn in **six** places from that one
definition: the nav's inline SVG, the welcome hero's watermark, the profile page's own watermark, the
print letterhead's, the PDF's vector operators, and the roast and compatibility story images via `Path2D`. A UI
check compares the shared paths against the `d` attributes in `index.html`, so an inline copy cannot
drift — extended rather than folded in when the profile page got its own copy, so a mismatch there
names itself instead of reading as a fault in one of the others.

The supplied artwork is three `<ellipse>` elements — one rotated 60° — plus a filled `<circle>`.
Each ellipse is written out here as four cubic Béziers, pre-rotated, rather than as arc commands:
every renderer downstream already emits and parses `C` natively, so Béziers mean one geometry instead
of three arc implementations that have to agree. The conversion was checked by rendering both
versions and diffing the pixels — 1% of the inked area differs, all of it antialiasing on curve
edges. The original files are kept in `brand/`.

The centre dot travels separately, as `dot` rather than inside `paths`, because it is **filled** and
everything in `paths` goes through one stroke. That makes it the easiest part of the mark to lose, so
each renderer draws it explicitly and two checks cover it. The first version of the PDF check passed
with the dot removed entirely — it searched to the end of the page, where any rounded rectangle's
fill satisfied it. It is now scoped to the mark's own operators.

The nav has been re-measured twice as its labels changed. "My Personality" (since shortened to
"My Psyche") and "My Compatibility" overflowed by 14px at 375 and 32px at 320, and shrinking the
links to absorb it would have put them under the 11px minimum, so the wordmark came off every phone.
Shortening "How it works" to "FAQ" gave back more than that cost — re-measured at
412 / 390 / 375 / 360 / 320px the nav sits on one row
with no horizontal scroll and nothing under 11.5px — so the wordmark is back, and only a folded
phone under 320px still loses it. The footer kept saying "how it works" for several turns after
that rename, which made one destination look like two; a check now reads both labels and requires
them to match, so the next rename fails rather than half-lands.

### Advertising the paid sections without duplicating them

**The welcome page's "What insights will I get?"** is two tiers and a note, built by `insightsHtml()` in
`docs/app.js` into the `[data-insights]` slot. The free tier is the summary card: the eight things on
it, by the card's own labels (the first as "Your character / superhero", short enough for a phone's
column), as one white box of two columns and four rows (`.card-features`, the
same four by two on a phone), and beside it on a laptop (under it on a phone) a **deck of six sample
cards** (`#insight-deck`, `drawInsightPreview`, `arrangeDeck`): the full sample's own card from
`sample.json` (Emily Carter, Mulan) at the front, then five from `docs/sample-cards.json` — Ethan Tan
(Spider-Man), Olivia Bennett (Moana), Ryan Walker (Hiccup), Hana Sato (Joy) and Kenji Nakamura
(Totoro), made-up people with American and Asian names, women for the female characters and men for
the male ones. That file holds only what a card reads, and a self-test holds each entry to it and the
six to different people and characters. The front card is centred over the arrows and as large as
its column allows (up to 320px wide); the next card peeks out behind it on the right and the previous
one on the left, smaller, tilted and faded, into the gap and padding beside the column rather than
taking width from the front card. Stepping forward moves the front card to the left and brings the
right one forward. Arrows and dots
under the deck (and a swipe, or the arrow keys while it has focus) bring the next or previous card to
the front, wrapping round. Nothing in it scrolls, so no scrollbar shows; the side cards are trimmed at the
tier's edge on the narrowest phones (`overflow-x: clip`), and its space is held before the cards load
so the page never jumps. The front card is a button with the enlarge mark on it: pressing it shows the
card full screen in the sample card dialog (`openInsightCard(index)`), with the same tap-to-explain
guide, a "3 / 6" count at the top and arrows either side. Full screen the cards step left and right
(`stepInsightCard`) by those arrows, the arrow keys, a swipe, or a sideways scroll on a trackpad,
sliding in from the side stepped towards; closing it leaves the deck on the card last looked at. The
sample report's own card opens in the same dialog without the arrows. The
premium tier is the full report by its four numbered parts — named from `Copy.STRUCTURED.parts`, with
each part's sections as chips from the report's own titles (Part 1 leads with **Your character** and
**Your signature patterns**, as the report itself does; Part 3 carries **Conflict style** after
**Attachment style**, since the attachment read explains the card's conflict style in its
`conflict` field) — its price (`premiumPriceLabel`) and what
comes with it, closed by **See sample report** (`#insight-sample`) at its bottom right. Under both, a line saying compatibility is free. The words around the names live in
`Copy.STRUCTURED.insights`.

**One question a part (25 October 2026):** each part's paragraph listed the same sections its pills list
underneath, so the page said everything twice. Each part now keeps its title and its pills, and one italic line,
the question it answers (`partBlurbs`): *Why do I keep doing that?*, *What actually moves me?*, *Why do my
relationships go the way they do?*, *Where would I thrive, and what holds me back?*, *So what do I do next? Your
development plan.* The line under the title no longer promises "the evidence behind it", which "Evidence behind
every finding" below already says: *Your card, explained in five parts. Each answers a question you've asked
yourself.* 1446px tall on a phone became 1228px.

**Compact (late October 2026):** the five parts sit two to a row on a laptop (the fifth across the
width), each a small gradient numeral, its title and its sections as one plain line with dots, and a small
lock; one column on a phone. Part 1 no longer lists *Who you are* or *Your signature patterns*: both are the
free Overview's, already on the page. 814px tall on a laptop became 571px. The history below is how it
got here.

Under a free card, the unlock offer lists what the full report explains and adds. In the structured
layout it runs as **four of the report's parts** (`explainedParts()`, `unlockPartsHtml()`): each a white
panel led by its numeral (01–04) and the part's title from `Copy.STRUCTURED.parts` — no line under the
title — then its sections with their blurbs (`explainedSections()`), the paid
ones where they sit in the report. Part 1 has four rows — the portrait, the signature patterns, **MBTI &
Big Five as one row** (`explainTypeTraits`) and wellbeing. Part 3 has five: relationships, attachment,
**Conflict style** (`explainConflict`, describing what `attachment.conflict` writes), ideal partner and
the career assessment. There is no appendix in the offer: Part 4's panel
takes the left half of its row (`.unlock-part-half`), and **a secret bonus** is a panel of its own on the
right half (`.unlock-secret`, dashed, a gift over its title), naming nothing — the roast, kept a surprise
until it is unlocked. On a phone the two stack. In the classic layout it is the explanations followed by
**`PAID_SECTIONS`** — the same table the report renders those sections from and the PDF gates them on.
The panel beside the card ends its one-line introduction (an en dash, not an em dash) on where the
reasoning behind the card is: "Unlock the premium report to read the full analysis…" on a free report,
"Read the report below for the full analysis…" on a full one (`introFree`, `introPaid`).

That is not tidiness. This is marketing copy naming four sections by title and quoting a price, and
marketing copy that has silently drifted from the product is the kind of wrong nobody notices for
months. Reading the same table means a rename in `docs/copy.js` moves the landing page with it, and
`coverTitle` doubles as the one-line hook here because that is precisely the job it already does on
the cover itself. The price is `premiumPriceLabel`, so the number on the welcome page and the number
on the unlock button are one string — two places showing different prices is worse than either being
wrong alone. Checks pin the section list, the price and the badge; fault-injecting a hardcoded
`$0.99` and a dropped fourth section fails them.

**Writing this exposed two stale claims that had been on the page for a while.** The relationships
branch listed "Your attachment style" and the work branch listed "Where you would thrive" — the first
because attachment used to be part of that section before it became its own paid one, the second
because that subsection was cut from the report entirely and the landing page was never updated with
it. Both were advertising, on the free tier, something the free report does not produce. There is a
check now that no branch may name any of the four paid sections, so the next one fails on the way in
rather than being found by a reader who paid attention.

The tier block sits *below* the diagram rather than becoming a fifth branch in it, and below the free
tiles rather than mixed among them. Folding it into either would say the paid sections and the free
ones are the same kind of thing. Its border is solid accent where the in-report covers are dashed —
dashed reads as "switched off", which is right for a locked section on your own report and wrong for
an offer on a page selling it.

The sample dialog's copy is the one that needed the most care: it says *"This sample is the free
report"* rather than implying the sample is partial. The free report is a whole report, and calling it
incomplete in order to sell the rest would be a lie about what somebody already has.

**The sample report no longer shows the Psyche Card: it opens straight on 00 Overview and the part
nav** (`#sample-card-section` stays hidden). On a laptop (1000px and wider) the nav stands down the left
of the popout, as the full report's does, sticking to the top as the report scrolls past; the popout
widens by that column (`#sample-sections` becomes a two-column grid), and `pinnedHeight()` no longer
adds the nav's height to a jump when the nav is beside the report rather than across it. The front page already shows sample cards of its own. The
card is still built (hidden) for the full-screen copy and the score check. What follows describes the
earlier arrangement, kept for its reasoning.

*Earlier:* the sample opened on the summary card, above the sections, exactly as a real report does. A reader
deciding whether this is worth handing an archive over is shown what the app actually produces, and the
card is the one part of a report that reads at a glance — meeting a list of fourteen shut headings
instead undersold the thing badly. It is built by the same `psycheCardHtml()` the reader's own report
uses, from the same `sample.json` the sections below it come from, so there is no second rendering path
to keep in step.

Three details are deliberate. The card sits *inside* `#sample-body` rather than above it, because that
element is the dialog's scroll container and a card pinned outside it would stay put while the report
moved underneath. Its head carries no `.card-head-toggle`, which is the entire mechanism that keeps it
open — `collapseSections` only shuts cards whose head has one, the same thing that leaves the
confidence card alone, so this needed no special case anywhere. And it renders as a plain frame, not
the report's `.psyche-card-slot` button: full screen, download and share all act on *your* card, and
there is no reader's card here to act on.

The fit is the part that had to be sequenced carefully. `fitCard` measures `offsetHeight`, and a closed
`<dialog>` has no layout at all — called before `showModal()` it reads a natural height of zero, bails
out, and leaves the card at its natural 1000px, overflowing the frame and scrolling the dialog
sideways. `layoutSampleCard()` therefore runs immediately *after* the dialog opens, and is called from
`layoutPsycheCard()` too so the existing resize listener covers both copies without a second one.

The close handler needed a matching change. It used to empty `#sample-body` outright, which is correct
when everything inside it was built by `showSample()`; the card's frame is markup in `index.html` now,
so wiping the container would take it away for good and every later open would find no card — and, as
the fault-injection confirmed, no `#sample-sections` either, which throws before the dialog even opens.
It empties the two slots instead.

**The sample is now the full premium report.** `sample.json` carries its own `premiumAnalysis` —
wellbeing, attachment style, ideal partner and career assessment, hand-written for the same fictional
account and held to `PREMIUM_SCHEMA` by the selftest (its `$ref`s written out in full) — and
`sampleUnlocked()` hands those sections to the renderer, so attachment and career read exactly as on a
paid report, never with a lock. It is the sample's own data, never the reader's `paidAnalysis()`. **The
roast is left out of the sample** (both layouts, and the part nav's Roast entry with it): it is the full
report's secret bonus. *The history below describes how the sample used to show the paid sections
locked.*

**The four paid sections used to be summarised in a footer pinned under the sample; then they rendered
inline, in the sample body itself, the same way an un-unlocked real report does** — see "One
consolidated block before unlock, four cards after" below.
`showSample()` calls the same `reportSectionsHtml()` the real profile page uses, passing
`{ sample: true }` instead of excluding paid sections outright. That option does two things inside
`reportSectionsHtml()` and `paidSectionsLockedHtml()`/`paidCard()`: it forces `unlocked = {}`
regardless of the reader's own `paidAnalysis()` — this report belongs to nobody, so it must never
leak *their* real unlock state into a page meant to show what a stranger's report looks like — and it
renders the single `Unlock` button with a plain, disabled label (`premiumSampleUnlockLabel`) instead
of the real priced or resume-labelled one. A native `disabled` attribute, not a script-side guard, is
what keeps a click on that button from ever reaching the delegated `.premium-unlock` listener that
opens the real payment dialog — browsers never dispatch a `click` event on a disabled button in the
first place. Fault-injecting the `disabled` attribute away confirmed this: the check on the button's
state failed as expected, and the click genuinely opened `#premium-dialog` underneath the sample,
which is exactly the failure this option exists to prevent. Fault-injecting the `unlocked = {}` guard
away (falling back to the reader's real `paidAnalysis()`) was caught the same way, by the check that
the sample's `.premium-body` elements stay empty even when the reader has a real, paid, unlocked
profile of their own open in the same tab.

**The blurb used to name the model doing the deeper read** — "These four sections are a deeper
analysis using Claude's Sonnet model" — and now reads "These four sections provide you with deeper
insights:" instead, dropping the provider name from marketing copy a reader sees before paying
anything. The provenance itself is not hidden: which model actually wrote the paid sections still
appears after the fact, in the report's own "analysed by" footer (see below), which is the honest
place for it — spoken in the past tense, about a specific report, rather than as a selling point on a
page for an account that has not uploaded anything yet.

**The block used to close with a line about payment terms** — "One payment, on the device you read
it on. No account, no subscription, and nothing recurring" — under the price and the section list.
It was cut as redundant with the price already shown two lines above it, in both places the block
mounts (the welcome page's insight diagram and the FAQ's "What you can expect?"), since the two share
one function and cannot say different things. A check asserts no `.premium-tier-note` element
survives in either slot; fault-injecting the paragraph back in confirmed it fails.

**The free half briefly earned the same statement, then lost it again.** A small **"Free"** badge and
a line — *"These four sections come with every report, analysed by Gemini"* — sat above the insight
diagram, making explicit what does this cost and which model writes it. It came out: the section
heading already answers "what insights will I get" without needing a second sentence to say the answer
is free, and naming the model here duplicated the "analysed by" line the report itself carries once a
reader has one. `mountFreeTierNotes()`, its `[data-free-tier-note]` mount point, and `insightFreeBadge`
/`insightFreeNote` in `docs/copy.js` all went with it rather than being left as dead code for a badge
nothing renders any more.

**"See sample report" closes the premium tier**, at its bottom right (`.insight-premium-foot`), so
"can I see one" comes straight after what the full report holds; the card's heading stands alone. It
sat beside "What insights will I get?" for a while before that. It is also `.btn-outline` now instead of the filled purple
`.btn` — a page with the hero's old sample button and this one both filled and both saying the same three words
was two loud calls to the same next step; secondary styling here has one obviously primary "Analyse my
data" in the hero and lets this be the quieter of the two ways to see the report.

### One consolidated block before unlock, four cards after

The four paid sections used to each render their own card and their own `Unlock — US$5` button,
even though one payment has always unlocked all four. That meant a reader met the same price four
times, in four covers stacked one after another, before paying anything — and the `PAID_SECTIONS`
loop that rendered them made it easy to forget this was ever one purchase rather than four.

Now `reportSectionsHtml()` checks `Object.keys(unlocked).length === 0` once: while nothing has been
bought, `paidSectionsLockedHtml()` renders a single block — the same `.premium-tier` shell already
built for the welcome page's marketing copy — listing all four sections by title and blurb under one
"Unlock — US$5" button. The instant anything comes back unlocked (a full response, or a partial one
from a call that only returned some fields), the branch flips to the original per-section loop and
`paidCard()` renders each of the four as its own full card. A reader never sees the four-button
version and never sees the consolidated pitch again once they have paid — the same `unlocked` check
governs the real report; the sample shows its own four sections in full (see above).

`revealPaid()`, which runs when a payment succeeds, has to handle both starting shapes: the normal
case swaps the single `.paid-consolidated` element outright for the four real `paidCard()`s via one
`outerHTML` assignment; a defensive per-card in-place fill is kept underneath for the case where four
individual covers are already on screen (a report loaded before this change, still in `localStorage`,
opened once more), though that path is not reachable by the flow this change ships. The delegated
`document.addEventListener('click', …)` handler that opens `openPremiumDialog` needed no new wiring:
it matches `.premium-unlock` wherever that class appears, whether there is one button or four.

The consolidated block reuses `.premium-tier`'s CSS almost verbatim — an accent-bordered block
originally built for the non-interactive welcome-page teaser — with a couple of spacing rules added
for the wired-up unlock button now living inside it. Checks pin the block's position (below the free
behaviour read, above the confidence card), that it carries exactly one `Premium` badge that never
breaks its own word at phone width, that all four section names and their content descriptions appear
inside it, and that clicking the sample's disabled button still opens nothing. Once the real unlock
succeeds, a parallel pair of checks confirms each of the four now-separate cards carries its own
badge with the same word-wrap guarantee. Fault-injecting the branch to always render four individual
cards — never the consolidated block — was caught immediately: the sample-dialog check expecting one
`.paid-consolidated` and zero `.paid-card` elements failed, along with several checks downstream of it
that could no longer find the element they depend on.

### "See sample report" on the unlock block

The free page's **Unlock the full premium report** block carries **See sample report** at the far
end of its head, opening the same sample report the front page does — what the unlock buys, to look
at before paying for it. On a phone (760px and under) it takes a line of its own under the title, centred (October 2026;
it was right-aligned there, which left it looking stranded at the edge). A zero-height `::after`
flex item on the head forces the line break.

### Three scenes redrawn: Baymax, Pikachu, Kuromi

**Baymax** is now the big white robot himself — round body, small head with the two dots joined
by a line, the red heart with its cross on his chest — in front of the city's bridge at dusk.
**Pikachu** has a Poké Ball at the centre, a lightning bolt cracking behind it, sparks, and a
grassy hill. **Kuromi** is a pink skull on a black heart with little bat wings and a devil's tail,
under a lilac crescent moon, with bats, hearts and a spiked fence along the hills.

### WhatsApp chats, up to three

WhatsApp has no account-wide export — only **Export chat**, one conversation at a time: open the
chat → ⋮ (or the contact's name on iPhone) → **More** → **Export chat** → **Without media**, and
save the .zip it makes. Up to three of those can be loaded in the data popout (**WhatsApp chats**,
the fourth row), which is reached from everywhere the other sources are: the free page's
*Evidence and method* rows (which lead into the unlock, data first), the paid report's
*Add / change data & re-run*, and **Unlock the full premium report** itself. A chat can be loaded
as the .zip or the .txt inside it, one at a time or several together; the row says how many of the
three are loaded, and a fourth starts a fresh set. The same chat is never counted twice
(`sameChat` / `dropRepeats`): a file whose name matches one already loaded, a chat titled after the
same person, or a group with the same members is set aside with *"Your chat with Mia is already
loaded – choose a chat with someone else."*, and the others in the same pick still load. Two slots
spent on one conversation would double its weight in the read and leave less room for anyone else.

`docs/whatsapp.js` reads them on the device:

- **The format varies by phone and locale** — `[08/10/2026, 14:03:22] Name: …` on iOS,
  `08/10/2026, 14:03 - Name: …` on Android, 12- or 24-hour, `/` `.` or `-` between date parts.
  Day-first, month-first and year-first are settled per chat from the dates themselves; a message
  over several lines is joined; system and media lines ("end-to-end encrypted", "image omitted",
  "<Media omitted>", deleted messages) are dropped.
- **The reader is found, not assumed**, because the export does not say whose phone it came from:
  the one sender in every chat loaded; or, in a one-to-one chat whose file WhatsApp named after the
  other person ("WhatsApp Chat with Alex"), the other sender; or a sender matching the reader's own
  name. Failing all three, the popout asks *"Which of these is you?"* with a button per sender.
- **Only the reader's own words are kept**, each with the one message it answered (shortened and
  de-identified — see "How messages are sampled"). Everyone else is otherwise counted and timed — who
  starts conversations (after six hours' quiet), each side's median reply time, when the reader
  writes by hour and weekday, message length, how often they ask questions — and their text is
  dropped as it is read. Other people's names, and their first names, are replaced with "someone",
  the reader's own name with `PsycheUser`, and chats are labelled c1–c3, never by who is in them.

In the digest it is a `whatsapp` block — per-chat numbers and up to 200 of the reader's messages
(600 in the premium read), sampled per chat with each chat given at least a quarter, tagged
`[c1]`–`[c3]` — with its own `note` telling the model what it is. It is trimmed before anything from Instagram when the budget is
tight, `forModel` rebuilds it field by field on the server (so a client cannot slip names or
anyone else's messages in), and the review has one switch for the lot — unticked, the whole block
goes. *Evidence and method* and the data-sources list show it as its own row.

### One file box, and WhatsApp chats alone (October 2026)

Instagram takes one to two hours to email an export, and a reader who arrives from a reel, or from a
friend's Psyche Sync link, wants a result now. A WhatsApp chat exports in seconds. So a first read now
needs **Instagram, or two WhatsApp chats** (three at most; the minimum was three until 26 October
2026), and either is a full free card and report; both together make the fuller read. One chat
describes one friendship more than the reader; two different people start to show what holds across
them, and a third is a short export more for a reader still waiting on Instagram. Competitors that read a chat give a result in minutes, and Instagram's wait was
the biggest drop-off left in the funnel.

**One box for every file.** The data popout opens on **Choose your files** (`#datasources-drop`): the
reader picks or drops any mix of files, and each is sorted by what is inside it before any of it is
read (`Supplement.detectSource`, from the zip's own list of names: a Takeout folder is Google; Meta's
two exports by what only one of them has (`metaProduct`: its own activity folder, its *apps and
websites off of …* folder, and how often "instagram" or "facebook" appears in the paths and the zip's
name), then `profile_information/profile_information.json` is Facebook and two Instagram file names
Instagram; a `.txt` or a zip with no JSON and a `.txt` is WhatsApp). Until 26 October 2026 any
`profile_information….json` meant Facebook, which a real Instagram export matched with its
`instagram_profile_information.json`: it was read as Facebook and refused as Instagram. Facebook's own
reader refused real Facebook exports for the same overlap (four of Instagram's file names, most of which
Facebook's export has too); it now refuses only what `metaProduct` calls Instagram's. A zip
nothing recognises goes with an Instagram export picked beside it (a later part of a split export), or
to the row that was tapped, or to Instagram, whose reader says what is wrong with it. The four rows
below the box are now one checklist rather than four boxes: what is loaded, ticked, and a tap on a row
still adds that source on its own. Instagram no longer has a border of its own; the box stands out
instead. Files dropped on the popout, on a computer, go the same way.

**What a first upload needs** is said under the box (`#datasources-minimum`): *To start: your Instagram
data, or 2 WhatsApp chats.*, then *1 of 2 WhatsApp chats. Add 1 more, or your Instagram data.*, then
*✓ Ready.* Continue says the same in the status line until one of the two is met. The rows' tags read
*Instagram (Or 2–3 WhatsApp chats)* and *WhatsApp chats (Or Instagram)*. On the report page's popouts
Instagram is still *Required*, except for a reader whose card came from chats, for whom it is
*(Optional)*. Three is the most chats a digest holds.

**The digest** of chats alone is `Digest.buildFromSupplements`: the same object with no Instagram part
(no counts, rhythm, captions, DMs or lists) and `coverage.sources` without `instagram`, which is how
everything tells (`Digest.hasInstagram`, and `digestHasInstagram` in the page, which asks before the
readers load). Google or Facebook may sit beside the chats. The chats fill the conversations pool at
up to 40,000 characters each (see the next paragraph but two), and the 20,000 of the reader's own
writing a read needs (`MIN_OWN_WRITING`) still applies.
The thin-data note (once a session, before the review) uses its own line for chats alone,
20,000 characters of evidence rather than 50,000 (`THIN_CHATS_CHARS`), since three full chats hold at
most about 45,000; it and the too-thin refusal have their own words (*not much of your own writing in
these chats*), never "once per Instagram account".
`forModel` leaves the Instagram fields out entirely rather than sending them empty, so the model reads
a digest of chats, not an empty Instagram account. New chats now replace the ones a stored digest
holds (`addSupplements`); before, they were dropped whenever the digest already had chats.

**The popout, redesigned for fewer words** (26 October 2026). It said the same rule three times (each
row's tag, then a status sentence), had two green lines competing, gave every row a second line about
file types the box now sorts by itself, and kept the help a first-timer needs at the very bottom. Now:
- one line under the title, *This step works offline. You can review the data in the next step before
  anything is sent for analysis.*, its first sentence shown only once it is true (the data readers
  loaded);
- the box reads **Choose files**, with *or drop them here* only where there is a mouse;
- on a first upload the rows are two groups, **Need either IG or 2 x WhatsApp** (Instagram, WhatsApp chats) and
  **Optional** (Google Takeout, Facebook), and the first ticks itself once either is in: the group
  says the rule, so no row has a tag and the status sentence is gone (`#datasources-minimum` is that
  heading now, its full meaning in its `aria-label`);
- every row is one line: the name, an empty ring that becomes a tick, and **How?**, which opens that
  source's steps alone below the rows (pressed again, it closes them); the old "See download
  instructions" drawer opens only that way now;
- WhatsApp shows its chats as three dots, filled as they load, the third dashed as the optional one;
  the count in words (*2 of 3 chats loaded*) stays for screen readers;
- Continue is set back (half strength) until a first upload has what it needs, and still says what is
  missing if pressed;
- **Front page, 27 October 2026:** Start here's button reads **Load my data** (it was *Load your data*;
  the guide's last button matches it). On a phone the Psyche Report's two extras (*A PDF to keep*,
  *Evidence behind every finding*) stack on the left with **See sample** beside them, rather than the
  button on a line of its own. Ask PsycheAI's pill sits beside its name on one line, shortened to
  *1 free, then … for 5*; at 420px and under the Sync and Ask rows drop their icons to make room.
- **A row is pink only while pressed** (27 October 2026): on a phone the hover stuck after the tap and
  focus came back to the row from the file picker, so the row stayed pink, and it was pink too while its
  file was read. Now a tap flashes it, a mouse still gets it on hover, the keyboard an outline. The
  WhatsApp row reads *2–3 WhatsApp chats* (*≥2* for a day).
- Restore from a backup sits between Back and Continue (27 October 2026), alone since *Optional ▾* moved
  into the box: a small line under the WhatsApp row, styled like the Required heading, that folds the
  optional rows under it.
- **Google and Facebook are folded away on a first upload** (27 October 2026): four rows read as four
  things to fetch, when Instagram or two chats is all a first read needs. *Optional data ▾*, a quiet grey
  link between Back and Continue, unfolds them under *Optional*; a Google or Facebook file dropped in the
  box is still read, and unfolds them so its tick shows. The required heading became *Required (At least
  one)* and the WhatsApp row *2–3 WhatsApp chats* (first upload only: from the report page one chat beside
  Instagram is fine), so the minimum is on the row itself.
- **The required group says what is still needed** (26 October 2026; it read *Need either IG or 2 x
  WhatsApp* whatever was loaded, so after one chat it was not clear what to do): *Required (IG or 2
  WhatsApp chats)* (*Required (At least one)* since 27 October), then *Required (1 more WhatsApp chat)* once one chat is in, then *Required* with its
  tick. Continue pressed at one chat says *Add 1 more WhatsApp chat, or your Instagram data, to get
  started.*
- **One ring on every row** (26 October 2026, chosen from three mock-ups over a tick + count and a status
  pill): an empty grey ring until a source is loaded, then green with a white tick. WhatsApp's ring is in
  three parts, one a chat, amber at one chat and green with the tick from two, the minimum. It replaced a
  green tick for single files beside three purple dots for the chats. Drawn in CSS on the same markup
  (`.mode-added`, `.ds-dots[data-n]`), so nothing in app.js changed.

The report page's popouts share the rows: no tags, no "Required" pill, the same rings and dots. Only
Instagram kept a second line, *A new .zip replaces it – pick every part*, until 26 October 2026, when
it went too: the box takes every part at once anyway. Each row is a `.ds-row` (the source's button, then
its `.ds-how`), and askDataSources moves rows, not buttons.

**How the conversations pool is shared** (26 October 2026, `waChatChars` in `docs/digest.js`).
WhatsApp chats have first claim on the 95,000-character conversations pool: each may take up to
25,000 beside Instagram (45,000 for two chats with no Instagram, 30,000 for three: two chats fill the
90,000 three do, since 27 October 2026; 40,000 before), and the Instagram DMs with Messenger keep at least
30,000 whenever the export has them, the per-chat share rounded down to 5,000:

| | 1 chat | 2 chats | 3 chats |
|---|---|---|---|
| Instagram, full DMs | 25k, DMs 70k | 25k each, DMs 45k | 20k each, DMs 35k |
| Instagram, no DMs | 25k | 25k each | 25k each |
| WhatsApp alone | – | 45k each | 30k each |

Until then every chat was held to 15,000 wherever it was read. Measured on a heavy synthetic account
(1,500 captions, 25 long DM threads, chats of 8,000 messages): beside an Instagram with no DMs, three
chats were 28% of the read while the room the pool left spilled into more captions (103k); now they
are 69k against 76k of captions. Beside full DMs, three chats went from 42k (DMs 53k over ten
threads) to 55k (DMs 40k). Two chats alone went from 22,000 characters of the reader's own writing,
barely over the 20,000 a read needs, to 60,000. When the chats leave the DMs under 50,000 and the DMs
hold more than that room, their lowest-ranked conversations are dropped first, down to the top six
(`focusThreads`), so a handful of relationships are read properly rather than ten thinly; DMs that
fit are never cut. The sampled places for WhatsApp rose from 450 to 1,200 so a 25,000-character chat
is bounded by characters, not by its two-fifths share of places. The 179,000 line, Instagram's
50,000 of the public pool, and the cost caps are unchanged.

**The report's parts on the front page** (27 October 2026): the last, *Putting it together*, shows a purple
pill, *Your development plan*, where it had the line *So what do I do next? Your development plan.* (`partChips`),
and the green badges beside Your Psyche Card and Your Psyche Report read *Free*, not *FREE*.

**Review and popout tidy-ups** (27 October 2026).
- A file for an optional source dropped in the box shows its row under *Optional* at once, with its
  progress, folded or not (`optionalReading`).
- Messenger's and TikTok's chats are named in the review as Instagram's and WhatsApp's are (they read
  *Chat 1…*): each thread's title is kept on the device only (`threadTitles`, a property JSON cannot see)
  and labels the review's rows through `chatLabels`.
- Facebook friends are no longer in the summary: a list of other people's names says nothing about the
  reader. The names still number the people the reader's own words mention, and the review row went.
- Instagram's review rows say so: *IG accounts liked*, *IG posts liked*, *IG posts & comments*, *IG
  searches*, *IG direct messages*. Beside *Tap to preview*: *most personal last ↓*.
- The journal row says *.md or .txt file* beside its name.

**Leaving with something to lose asks first** (27 October 2026). Beside the guard while a run is in
progress (`guardUnload`), the browser's own "Leave site?" now also comes up when data has been loaded
and not yet sent (`loadedUnsent`: set when a file is read, cleared when a run starts), and while a report
has never been saved anywhere but this browser (no PDF, no backup: `pdfSaved`, `lastBackup`). Not for a
link to another page of the site or an email link, and not while a payment sheet is open, since a bank's
page may take over the tab. The browser words it, not the page; phones often skip it, and it may keep a
page out of the back-forward cache while it applies.

**TikTok and a journal, optional sources** (27 October 2026). Two more rows in both data popouts. In Add
your data they sit under *Optional* with Google and Facebook, folded behind *Optional data*; folded, a
source that is loaded still shows, alone (TikTok loaded shows TikTok, not the list). In Add / change data,
after a first run, nothing is required, so every source shows, with no group labels and nothing folded. The file box sorts them by what is in them (`detectSource`): a TikTok download is
`user_data_tiktok.json` (or `user_data.json`), on its own or zipped; a `.md`, or a `.txt` whose lines are
not dated messages, is a journal; a `.txt` of dated lines stays a WhatsApp chat.
- **TikTok** (`readTikTok`) is read by shape, since TikTok renames its sections between versions: an array
  of records is known by its keys (`SearchTerm`, `Comment`, `Content`/`From`) and the names above it. Watch,
  like, favourite and share histories are links only, so they are counted and never read. What is read:
  the reader's comments, their own videos' captions, their searches, the hashtags on their videos, and
  their side of their DMs (`ownSide`, as Instagram's and Messenger's, tagged `[k1]`…). Public pool for
  the words and searches (ranked as Facebook is, kept to 10,000 before Instagram's own words give),
  conversations pool for the DMs.
- **A journal** (`readJournal`): plain text or Markdown, split into entries at dated headings (2024-03-01,
  1 March 2024, March 1, 2024, 3/1/24) or, undated, at paragraphs; under 150 words is refused. Up to 120
  entries of 900 characters, at most 25,000 in all, in the conversations pool beside the chats. Names the
  other sources know are numbered; others stay as written, which the review row says (*names stay as
  written*), with its "Leave out anything mentioning" box to take them out. Contacts, IDs and the rest
  are redacted as everywhere.
- **Review:** one switch each (`includeTikTok`, `includeJournal`; `omitTikTok`, `omitJournal`).
- **Prompts:** `EXTRA_SOURCES_RULE` in the card, report and paid prompts: TikTok's counts say how much,
  never what; a journal is read gently and a hard entry is never a diagnosis; either with the reader's
  own words scores as a strong source, as Facebook does, and TikTok with only counts and searches is
  light. The rule took the free card's worst case to $0.08703, so `FREE_COST_CAP` (and the deep read's)
  went from $0.087 to $0.088; the prompt reserves rose to 14,900 and 40,920 tokens.

**Group chats and the number of chats are not evidence of breadth** (27 October 2026). Two group chats
alone came back as *slight introversion: directs energy into two enduring circles rather than
broadening the network*, and *others open the majority of exchanges across both groups*. Both read the
loading, not the reader: two or three chats is what PsycheAI asks for, and in a group of eight the
reader opening one conversation in eight is their fair share. `CHATS_ONLY_RULE` now forbids citing the
number of chats or calling the reader's circle few or narrow, and `CONVERSATIONS_RULE` judges who
starts a group conversation against one in `members` (each chat's `kind` and `members` were already
in the digest); only a one-to-one chat shows who reaches out first. The privacy page's line on a
shared link now reads *PsycheAI keeps an encrypted copy…*.

**Back from a payment sheet steps back** (27 October 2026). Two paid paths ignored the sheet's Back.
A first read refused its free card (the account or a chat had one) offered the sheet, and Back fell to
the retry offer, scrolled to the foot of the page, with no way back to the review or the data. Now Back
reopens the review, and Back there opens Add your data with everything loaded (runAnalysis, freeUsed).
And a paid re-run (not the bundled one) ran on unpaid after Back, into an error; it now reviews again.

**A popout closes from outside it, not from its edge** (27 October 2026). The hub's popouts (Save
Backup, AI Personal Context, the link and method sheets), the backup-saved note and Delete everything
closed on any click whose target was the <dialog> itself, which is the backdrop *and* the box's own
padding, so a tap near the edge closed them. Now the click must land outside the box
(`clickedOutside`). And the report's keep note's *Backup* opens the same Save Backup popout as My
Psyche instead of downloading at once: nothing is saved, and the note stays, until *Download backup*.

**The privacy page names the locked box** (27 October 2026). Its line on a shared link adds that this
is client-side encryption, the idea WhatsApp and Signal use for messages, where most cloud services
encrypt what they store but keep the key, so can read it. True of the code: the card is sealed with
AES-GCM in the browser and the key travels after the link's #, which no browser sends (lib/links.js).

**The wait, in words** (27 October 2026). The live count beside an analysis, a sync and the report
reads *1 minute 30 seconds* rather than *90s* (`TEXT.elapsed`), and the wait is said as *2–4 minutes to
complete* rather than *a few minutes* (the working note, `premiumGenerating`, `premiumRefreshingFree`).
The pitch says *Instagram and WhatsApp data* everywhere it said *or*: the link previews, the share
image (`promo/og.mjs`), the web-app manifest, the invite text and the FAQ's first answer. The WhatsApp
story and carousel put iPhone first in step b.

**Saving a chat on Android** (27 October 2026). WhatsApp's export on Android opens the share sheet,
which has no "save to device", so the steps said to save a file the reader could not. They now say:
iPhone, *Save to Files*; Android, *Drive* (or Dropbox, OneDrive), or email it to yourself and download
the attachment. Cut the same day to three short steps: *Export chat → Without media*; *Save it: on
iPhone, Save to Files; on Android, save it to Drive (Google Drive), Dropbox, OneDrive, or email it to yourself*; *Load it here/below*. (A file in
Drive shows in Android's file picker under its ☰ menu; the steps no longer say so.)
The WhatsApp story (start-5) and carousel slide (start-wa) say the same in step d.

**Each chat read across its whole history** (27 October 2026). The reader's own messages were cut to
the most recent 4,000 a chat before sampling (`ownPerChat`, a memory bound set when WhatsApp reading
began, never measured), which in a busy chat reached back only to 2023, though every message read
(up to 60,000 a chat) already fed the counts and span. The cap is gone: all of them go to the sampler,
which reads the last five years first, counted back from the chat's last message (`waRecentYears`):
anything older is held to a fifth of the chat's places (`waOlderShare` 0.2), in up to three periods of
its own, and takes more only when the recent years run short of messages (a chat busy in 2017 and quiet
now). Within each part the places spread over equal periods, each by the square root of its messages,
tilted a little to the later ones (`waRecencyTilt` 0.5: the last weighs 1.5× the first). On a ten-year
chat of 12,000 of the reader's messages, the 422 lines run 2016 to 2026: 78 from 2016–20 (18%), about
70 a year from 2022. The digest's size, and so the cost, does not change.

**The prompts** carry `CHATS_ONLY_RULE` in the card's and the report's digest sections: no captions,
posts, likes, follows or histograms to mention or read absence from; everything from how the reader
writes to these few people; and, since the reader chose them, extraversion near the middle and the E/I
letter slight unless their own words say otherwise. The confidence score starts at 58–72 for two chats
alone and 62–78 for three (see the table under `CONFIDENCE_SCORING`). `sourcePhrase` names WhatsApp. The free prompt's reserve rose to
14,550 tokens (`FREE_FIXED_INPUT_TOKENS`, 14,493 measured).

**One free read each, without an Instagram account to hold it to.** A chat export does not carry the
reader's phone number, and a display name is shared by thousands of people, so the name alone would
refuse strangers. The code is a one-way SHA-256 of the reader's name as the chats show it, then each
chat's other side and the day its first message was sent, sorted (`WhatsApp.accountSource`, hashed in
`accountKeys`). Two people practically never match, and the same three chats in another browser are
refused. The first such code a browser makes is kept (`psycheai_chats_account`, in `KEYS`) and sent
for any later chats-only read there, so three new chats on the same device are refused too. It is a
deliberate, cheap guard, not a proof: three other chats in another browser are a second free read.
**Each chat counts on its own too** (26 October 2026): the page also sends a one-way code of every chat
(`WhatsApp.chatSources`: the reader's name, who the chat is with, the day it began; `chatCodes` in
app.js, kept in `psycheai_chat_codes` for a retry after a reload), with Instagram reads too, and the
server refuses a free read when any one of them was in a free read before (`chatsUsed`, set
`free:chats`, keyed like the account codes), saying only *You have already used your free Psyche Card* (since
26 October 2026; it named the chat as the reason before, which told a reader which chat to swap out). So keeping one chat and swapping the rest is not a second free read; a friend's export
of the same chat is a different code, since it starts from their own name. The privacy policy's
"What PsycheAI keeps" names these codes.
That costs at most a free card and report (about 25 cents) inside the daily free limit, and the
server counts chats-only free reads (`free_chats_only`) and refusals (`free_refused_chats`) to show
whether it is being farmed. If it is, the next step is a one-tap WhatsApp confirmation (the reader
sends a code from WhatsApp to PsycheAI's business number), which was proposed and not built. A
refusal says *Your free Psyche Card has already been used* rather than naming an Instagram account.
The card is named from the chats (`ownDisplayName` falls back to `state.chats.owner`, in memory only).

**The front page and the guides say WhatsApp too** (26 October 2026), with the fewest edits: the hero
line and link previews (*…from your own Instagram and WhatsApp data*, *or* until 27 October 2026), the FAQ's *What is PsycheAI?*,
*How long does it take?* (*No time to wait? Two WhatsApp chats export in seconds.*) and *What file do I
need?*, a line under *Request your Instagram data first*, the friend's Sync invite, the Psyche
personality test's first step, `llms.txt`, and the closing box every generated guide shares (*…or
straight away with two WhatsApp chats*, button *Get your free Psyche Card*). That box is left out of
the guides' date hash like the footer, so changing it does not re-date forty pages. The guides written
for Instagram searches keep their Instagram wording; the reels are unchanged.
Later the same day the front page's optional card lost Google: it is *No Instagram data yet? Start with
2–3 WhatsApp chats*, with WhatsApp's steps alone. Google's steps (the Takeout deep link and its manual
fallback) are in the Load your data popout under Google's *How?*, where the suite now checks them.
Then *What insights will I get?* was tightened: the card's line is *One card that sums you up, ready to
share.*; the report's says what it holds beyond the card, *Every part of your card explained, with the
evidence from your own data behind each finding. Plus deeper insights the card has no room for: your
attachment style, career strengths, wellbeing and a plan to grow.*; and only the plan keeps its question
line (the other four parts are their pills). *Gain insights* reads *Learn more about your personality,
relationships, and career. Ask PsycheAI anything about yourself.*
**Two ways to start** (26 October 2026). Instagram's export takes its email, usually 1–2 hours, and was
the biggest drop-off; two WhatsApp chats take minutes. So the front page no longer leads with *Request
your Instagram data first* and WhatsApp folded under it:
- The hero's buttons are **Start with WhatsApp** (filled, `#hero-wa`) and **Request my IG data**
  (outline), each opening its own way below; *Already have your files? Load here* is a small link under
  them (`#hero-load`, the popout). At 345px and under the two labels shrink a step to stay on one row.
- The steps card is *Two ways to start*, *Choose to load your WhatsApp chats, your IG data, or both.*:
  WhatsApp (*⚡ About 2 minutes*, its two steps, ending *then load it below*: no button of its own since 27
  October, Start here's **Load my data** is the one) and Instagram (*🎯 Most complete ·
  2 hours*, its steps and See illustration), side by side on a laptop, and on a phone two slim tabs,
  *⚡ WhatsApp · now* and *🎯 Instagram · 2hrs*, WhatsApp open first (`chooseWay`). Under both: *💡 Get best
  of both worlds and the highest signal score by requesting your Instagram data now, and loading it
  together with your WhatsApp chats.* (27 October 2026; it was *Both? Request Instagram now…*), which keeps the free read for
  both together. WhatsApp is equal, not the default path: a card from chats alone reads less, and adding
  Instagram after it is the paid re-run (a free first add was offered and set aside).
- *How it works* step 1 is *Load your data*; the app's install description names WhatsApp; the card's
  intro says *sync with friends in Psyche Sync*.

The green *Free* badge on the card and the report now sits on the title's own line, just to its right,
instead of a line of its own above it (`.tier-head`), so on a phone it no longer costs a row.

**Adding data later keeps the chats** (26 October 2026). A stored digest holds the chats' sampled
lines, not the files, and the files are rarely to hand again. So:
- **Instagram added to a card read from chats** (the ordinary paid re-run, US$5): in the same visit,
  the chats still in memory (`state.chats`) ride along as Instagram's own would and are sampled again at
  their share beside Instagram; after a reload, `Digest.carryChats` carries the stored lines into the
  digest rebuilt from Instagram, thinned evenly to that share (25,000 a chat with up to two, 20,000 with
  three beside full DMs). Nothing new is sent, only part of what the reader already reviewed and sent.
  Their `[N#]`/`[P#]` numbers move past the new digest's own, so a number never stands for two people.
  The same applies to the unlock flow and its premium read (`withStoredChats` in `docs/app.js`).
- **Another chat added**: it joins the ones already loaded rather than starting a new set. In the same
  visit, from the parsed files kept in memory (`state.waChats`); after a reload, from the stored
  digest, the new chat marked `addsTo` and numbered after the stored ones (c3 after c1 and c2). The
  popout's row counts both ("3 of 3 chats loaded"). A chat already stored is known again by a one-way
  key of who it is with (`__chatKeys`, kept on the device with the digest, never sent; stored as numbers
  so the phone-number scrub leaves them alone), and refused with the usual *already loaded* line. Past
  three, the new chats start a fresh set, as before.
- **Google and Facebook added after**: unchanged, merged into the stored digest, chats and all.

The popout's note on replacing Instagram no longer names WhatsApp (*Your WhatsApp chats are kept*).
For a card read from chats, the hub's Your Data shows Instagram as one to add, first in the "add more
to sharpen your read" line. Continue pressed while files are still being read now goes on once they
are, rather than being dropped. A free upgrade from chats to Instagram was proposed and not built: it
would give away a US$5 sale for a read the reader was likely to pay for, at up to about 18.5 cents of
model cost each.

### Google/Facebook data survives an Instagram replacement, for real

The "Add / change data" popout lets a reader replace their Instagram export in place, and its own
code comment always claimed that Google or Facebook data loaded earlier in the same browser session
rides along with the replacement automatically. That claim was false: `addDataAndRerun()` in
`docs/app.js` reassigned `state.signals` to the freshly-read Instagram export first, then tried to
read `state.signals.supplements` to merge forward — except by then `state.signals` was already the
new object, which never carries a `.supplements` property of its own, so the read always found
`undefined` and silently dropped whatever was there. The reader saw their Google or Facebook row
still ticked green in the popout (that flag is set independently, from the digest that existed before
the replacement began) right up until the rebuilt report simply did not carry that data any more.

The fix reads `state.signals.supplements` into a `priorSupplements` variable *before* the
reassignment, then merges that into the new signals object instead of the (always empty) one that
follows it — two lines, one moved above the other. A uitest check drives the exact scenario end to
end — load Google, replace Instagram, and assert against the real `/api/analyse` request body that
followed that the digest still carries `.google` — rather than trusting the popout's tick, since the
tick was never the thing that was actually broken. Fault-injecting the bug back in (reverting to
reading `state.signals.supplements` after the reassignment) reproduced it exactly, and surfaced a
second, unrelated effect downstream: with Google actually present in the digest afterward, a later
premium-unlock click in the same test correctly skips the data-offer popout entirely — see
`collectExtraDataForPremium()`'s own short-circuit on an existing `current.google`/`.facebook` — which
the test now asserts explicitly rather than assuming the popout always appears.

### The roast moves back to the free report, and "Ideal partner traits" takes its old place

The roast has moved between the free report and the paid one twice now. It started free, behind a
click-to-reveal cover; moved behind the US$5 unlock so a reader would not have to hand over their
evidence a second time or wait through a second call for something the app was charging for; and has
now moved back to free, for good — a new user can read it without paying anything. The mechanism is
old code brought back rather than reinvented: `roastBlock()`, `revealRoast()` and `hideRoast()` in
`docs/app.js` are close to the original `bonusBlock()`/`revealBonus()`/`hideBonus()` from the first
time this section existed, and the reasoning is identical — the writing is never in the markup until
the reader clicks through, because a CSS blur protects nothing against select-all, a screen reader or
view-source. It sits right after "Your digital footprint", the section its evidence actually comes
from, rather than at the tail of the report where the four paid sections happen to end.

`bonus: { harsh, advice }` moved from `PREMIUM_SCHEMA` to `PROFILE_SCHEMA` with its field names and
descriptions unchanged, and the whole "roast is a different register" section of the prompt — the
three seams worth digging for (follow-through, reciprocity, whatever else is plainly going badly), the
rule against a hollow "X, yet Y" contradiction, and the diagnosis ban restated in full — moved from
`PREMIUM_SYSTEM` to `PROFILE_SYSTEM` alongside it. What is new is a paragraph making the register
change explicit in both directions: the roast must not soften toward the rest of the report's warmer
voice, and the rest of the report must not anticipate or lean toward the roast's tone before the
reader has chosen to open it. That risk barely existed when the roast was a separate paid call with
no other content in the response to bleed into; back in the same call as everything else, it is real,
so the prompt says so.

**"Ideal partner traits" fills the slot the roast left in `PREMIUM_SCHEMA`**, between the attachment
read and the career assessment — both in the schema's key order and on the page, checked by the same
"four paid sections, in report order" assertion the wellness/attachment/career trio was already held
to. It answers what the user asked for in three parts: `needs` (three to five things this person
actually requires in a partner to be well, argued from the attachment section immediately above rather
than from a fresh read of the digest), `carefulOf` (two to four honest warnings about partner types or
dynamics that would predictably go wrong for *this* person specifically, not a list of universal red
flags), and `summary` (an honest verdict in two or three sentences). The prompt is explicit that this
section has to *use* the attachment read rather than just sit beside it: the test it gives the model is
whether a need or a caution here would make just as much sense bolted onto a stranger with a different
attachment style — if so, it has not done its job.

Both changes together left the shape of the paid unlock untouched: it was four sections before and it
is four sections now, just with a different fourth one, so the "consolidated block, one Unlock button"
UI from the previous change needed no rework at all — only the section identities inside it moved.
`docs/pdf.js` follows the same split: the four paid sections stay gated on `meta.unlocked` exactly as
before (with `idealPartner` swapped in for the roast in that table), while the roast prints
unconditionally from `source.bonus` right after the digital footprint section, matching the page.

Fault-injecting the roast's position (moving `roastBlock()`'s call site to after the four paid
sections instead of before them) was caught two ways at once: the app-level position check, and,
separately, the PDF's own "sections run in the page's order" walk — which builds its expected order
by reading the page's actual `<h2>`s rather than a hardcoded list, so it needed no changes of its own
to catch a section moving, only the surrounding commentary explaining why the roast is now part of
that walk rather than excluded from the PDF outright. Fault-injecting a renamed `carefulOf` field
was caught immediately and loudly: the self-test crashes rather than failing quietly, because the
check dereferences the field directly rather than testing for its absence.

**The consolidated block's own grid went from three columns on a laptop screen to two.**
`.premium-tier-list` used `grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr))`, which keeps
adding a column as the block gets wider — one column on a phone, two on a tablet, three once the
report's column is wide enough, which left "Ideal partner traits" as the lone item alone in a second
row above career assessment. Fixed at exactly two columns above the same `560px` breakpoint
`.insight-branches` already switches at, rather than left to `auto-fit`: wellness and attachment now
share the first row and ideal partner and career assessment share the second, on any screen wide
enough for two columns at all, however much wider it gets from there. A check reads each item's own
`top` offset rather than the grid's column count directly — that is what a reader actually sees, and
it is what would have caught the original three-column layout without needing to know in advance how
many columns "wrong" would produce. Fault-injecting `auto-fit` back in for the wide breakpoint
reproduced the three-column layout exactly, and the check caught it.

### The "analysed by" footer grows a second provider

The report's final line used to name one provider and one timestamp — true when one call wrote the
whole thing, false the moment a paid unlock adds four sections a different provider wrote. Printing
only "Analysed by gemini-3.7-flash" under a report that also contains Claude's roast would misdescribe
who actually wrote the paragraph the reader is reading.

**`renderAnalysedBy()` in `docs/app.js` is the one function both moments call.** The free report's
render (`renderProfile()`) and the premium success handler both go through it, so the two call sites
cannot say different things about the same profile. It prints one line normally — "Analysed by
gemini-3.7-flash on 8/21/2026, 11:53:22 AM." — and grows a second the moment `premiumAnalysis`,
`premiumModel` and `premiumAt` are all present: "Premium sections analysed by claude-sonnet-5 on
\<date\>." All three fields have to be there together, not just the analysis — a profile unlocked
before this pair existed still has the writing but not the record of who wrote it, and falls back to
the one-line form rather than printing `undefined`.

**The two fields are recorded separately from the free report's `model`/`createdAt`**, in
`runPremiumAnalysis()`, at the moment the paid call actually returns — `premiumModel: result.model`,
`premiumAt: new Date().toISOString()` — rather than reusing the free report's fields, which would
have overwritten the record of who wrote the *first* nine sections with whoever wrote the last four.
The footer is refreshed immediately after `revealPaid()` inserts the sections, not before it and not
only on the next full render — a reader who has just paid sees the correct footer without a reload,
which is exactly the moment they are most likely to check it.

**Page/PDF parity holds here too.** `docs/pdf.js`'s report builder takes the same `premiumModel` and
a `premiumDate` (day-only, matching the granularity the free line already used in the PDF, rather than
upgrading to the page's full date-and-time and making the two "Analysed by" lines in one file read as
two different conventions) and prints a second `fineprint` line under the same guard. The downloaded
file is the copy a reader keeps and forwards, so it is the copy that most needs to say a second
provider wrote part of it.

Checks pin both providers appearing in the live footer immediately after unlock, the two lines
surviving a reload, and both providers appearing in the downloaded PDF. Fault-injected by removing the
two field writes entirely: every one of those checks fails, reproducing a report that (correctly, for
the fault) claims only one provider wrote a document two providers actually wrote.

### The landing page's outline, and its motion

Two things a sighted reader scrolling past would never notice, and the suite now holds:

The **heading outline** goes `h1 → h2 → h3` with no gaps. It did not: the steps row was the only
block on the page with no heading of its own, so its four `<h3>` cards hung straight off the hero's
`<h1>`, and anyone navigating by heading met level 3 with nothing above it to belong to. Giving the
row a real `<h2>` ("How it works") fixes the outline and labels the section in the same stroke. The
check walks every heading in the welcome view and fails on any jump of more than one level, so it
covers headings nobody has written yet.

**`prefers-reduced-motion` reaches the scroll.** The stylesheet has a reduced-motion block, but it
can only turn off `transition` and `animation`; the hero's primary action moves the page with
`scrollIntoView({ behavior: 'smooth' })`, which is a JS API and never sees the media query. A
page-length glide is precisely the motion that setting exists to suppress. `app.js` now reads the
query at click time — not at load, so changing the OS setting takes effect without a reload — and
passes `'auto'` when it is set. It is checked in two browser contexts that differ only in that
setting, recording the options the handler actually passes: a check on either context alone would
have passed against the bug.

**A free report's foot is one line**: Delete everything on the left and "Psyche Card generated by…"
on the right, the two boxes stretched to the same height (`.profile-foot`, which wraps the page's
action row and `#analysed-by` so they can share a row; a full report's actions keep their own layout).
Under 560px the button is its red bin alone, its label kept for screen readers, so both still fit.

**The hero's faint brand mark sits in a corner**, now the video takes the hero's right: the top left
from 720px up, mostly off the edge and fainter (opacity .09) so the headline reads over it; the top right
of the header on a phone, smaller (165px).

**The promo video, brought up to date** (October 2026; scene by scene in `promo/README.md`). It
had fallen behind the product: no WhatsApp, a card without *Most in sync with*, a "full report" of four
parts and no Psyche Sync. Now WhatsApp is the fourth source flying in; the card's list ends on
*and who you sync with*, highlighted; *Then unlock your Psyche Report, which has the full explanations,
how you connect, how you work, and a plan to grow* shows all five parts, lighting 01 and 02 together
on "the full explanations" (of what the card scene just showed), then 03 to 05 as each is named,
*How you work* its own with a compass; a new Sync scene follows, "Then sync with a friend to see what clicks"
(two friends' cards, *Psyche Sync* over a ring closing on a tick, since Sync has no score), the
beat carrying on through it; and the end card opens on a carousel of every character on the site's strip,
sliding across and slowing to stop on the sample card's Mulan, before the card itself. The ripped-up questionnaire now lands on
*No questions asked.*, the front page's headline, rather than "0 questions". About 53 seconds, from 45.
The sample card was recaptured for it (`npm run promo:card`).

**The welcome hero plays the promo video** (`.hero-video`, `docs/media/psycheai-intro.mp4`, built by
`npm run promo` — see `promo/README.md`). It is 9:16, so it is sized by its width and never
stretched: on a phone it sits centred under the two buttons, as wide as fits without taking more than
about three quarters of the screen's height; from 720px up the hero becomes two columns and it sits
beside the headline at 230px. `aspect-ratio` holds its space before it loads, so nothing jumps.
`initHeroVideo()` loops it muted only while it is on screen (an IntersectionObserver), with
`preload="none"` so a visitor who never reaches it never downloads it, and never resumes a video the
reader paused. It has a player of its own across its foot, in one row: play/pause and the time, the
timing bar (a range input you can drag) stretching between them, then mute and full screen — each
button named for what pressing it does. "Tap for sound" sits above the bar while it is silent: it turns
the sound on and restarts it from the top so the voice is heard from its first line, plays it once
through, then falls back to silent looping. For a reader who asked for less motion it never starts on
its own and that button says "Play with sound". Full screen takes the whole player, so the controls
come with it, shows the 9:16 frame whole (letterboxed, not cropped), and the same button brings it
back; going full screen from the silent loop turns the sound on from the top. On a phone (a coarse
pointer) it does not use the browser's full screen at all: Android lays its own "drag from top and
touch back to exit" notice over any page that does, and iPhone Safari would swap in its own player.
The player instead expands over the window (`.is-expanded`, the hero lifted above the sticky nav and
the page held still), with a history entry so the phone's Back closes it like any video player, as
Esc and the same button do. The video opts out of casting (`disableremoteplayback`), which is what
put a "cast to screen" button in its top-left corner on Android.
The server streams it rather than
reading it whole, answering byte ranges with 206 — Safari, and so every iPhone browser, opens a
video with `Range: bytes=0-1` and will not play one served as a plain 200 — and an ETag, so a
returning visitor's browser keeps its copy (`serveMedia()` in `server.js`).

**The profile page echoes the welcome hero now**, rather than the plain `.page-head` every other
internal page uses. `.profile-hero` reuses `.hero`'s bleed, rounded foot and two-radial-gradient wash
outright, and only overrides what has to differ because there is one line of text and one button here
instead of a headline, a lede and two buttons — reusing `.hero`'s own padding wholesale would leave a
band far taller than its content needs. `.profile-hero-mark` is a *separate* class and gradient id
from `.hero-mark`, not a second copy of it: the check holding the mark to one shared definition counts
every `.hero-mark` node in the document, and a sixth instance under that same class would have
inflated the count it holds at exactly one rather than being covered by it. The two share their
position, fade and colour through one selector and diverge only on size and bleed distance, scaled
down to suit the shorter band.

**Every error that lands back on the welcome page now scrolls to itself.** `show(view)` always calls
`window.scrollTo(0, 0)`, and five places used to call it in the same breath as flashing a message into
`#upload-error` — a bad archive, a bad photo, a failed analysis, a shared link arriving without a
profile, asking to compare before building one. All five landed the reader at the very top of the
page, with the reason sitting below the hero, the how-it-works row, the insight card and the
instructions — a reader who had scrolled down to the dropzone to drop a file saw the page snap away
from what they had just done. `showUploadError()` now runs `show()` and `flash()` as before, then
`scrollIntoView`s the message itself, so the archive and the reason it failed stay on screen together.
Checked against a reader's actual position — scrolled to the dropzone before the upload, the same
place anyone dropping a file would be — rather than from the top, where the check would pass either
way.

### My Psyche opens on the card; My Compatibility gets a real header

**My Psyche has no page header.** The Psyche Card carries the reader's name at its top, so a
"Jared's psyche" heading above it said the same thing twice and pushed the card down a screen on a
phone. The title stays in the markup as a visually hidden `<h1>` for screen readers and the document
outline, and the card starts directly under the navigation.

**My Compatibility** was four plain white boxes and a table. It is now:

- **a header panel** — a soft purple-to-pink gradient, an eyebrow ("Compatibility · free, every
  time"), the title, one sentence on what comes back, three chips for the ways two people can be
  compared (as a couple, as family or friends, as colleagues), and the page's one picture: the
  reader's initial overlapping a dashed "?" seat for whoever sends their link next, joined by a star;
- **past results as rows**, not a table — an initial coloured by basis (rose for romantic, violet for
  family and friends, blue for work), the name, basis and date, the score as a small ring filled to
  it, and a chevron; the whole row opens the report. The old five-column table scrolled sideways on a
  phone and cut the date off;
- **"Test your compatibility" and "Send my link" side by side** on a laptop (stacked on a phone), each
  under an icon tile, their buttons aligned along the bottom;
- **"What your link contains"** as a preview of what the other person receives: the name, card
  headline and interest tags in a tinted panel, with the note on what else rides along beneath it.

**The card's top edge** now carries the same purple-to-pink line as every other section: the
section had it all along, but the card fills its box edge to edge and was drawn over it, so the line
is now layered above the card.

**A wider page on laptops.** From 1200px wide the reading column grows from 820px to 940px (1000px
for the full report, which shares the screen with its menu), and the root and body text step up from
16px to 17px, so at 100% zoom the page no longer sits small in the middle of a large screen.
`--page-w` on `:root` is the one width the container, the report's offset beside the menu and the
menu's own position all read. Phones and tablets are unchanged.

Past results still come first, above the two actions, for the reason they moved there: someone
returning to the page is usually looking for a report they already ran.

The profile page's popout and the compatibility page both offer this person's own link and the same
two actions, so sending and copying are each one function bound to both pairs of buttons.

"What your link contains" — the card headline, summary and interest tags, plus a note on what else
rides along as short phrases — sits at the bottom of the compatibility page, under **Send my link**:
it is about the link someone is about to send from that page, not about the report.
`linkContentsBlock()` in `docs/app.js` builds it and `renderScan()` repaints it on every visit,
rather than appending, so leaving the page and coming back does not stack a second copy underneath
the first.

### Choosing a provider and model

| Variable | Effect |
|---|---|
| `GEMINI_API_KEY` | Uses Gemini for the free report. Takes priority if more than one key is set. |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` reaches Gemini through Google Cloud's Vertex AI with a service account instead of the API key; see [Gemini through Vertex AI](#gemini-through-vertex-ai). Ignored, with one log line, until the service account below is complete. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the service-account key file (on Render, a secret file: `/etc/secrets/gcp-key.json`). Or `GOOGLE_APPLICATION_CREDENTIALS_JSON` with the file's contents. |
| `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | The Google Cloud project (default: the key file's `project_id`) and region (default `global`). |
| `GEMINI_VERTEX_MODEL` | Only if Vertex names the model differently from `GEMINI_MODEL`. |
| `PSYCHEAI_MERGED_UNLOCK` | The card and the report in one call instead of two (card, then report), for the free first read and every unlock. **On by default since 26 October 2026** (off before); `false` goes back to two calls. Read on every request, so it switches with no deploy. See [One call for the unlock that adds data](#one-call-for-the-unlock-that-adds-data-october-2026). |
| `ANTHROPIC_API_KEY` | Uses Claude for the free report if `GEMINI_API_KEY` is not set. |
| `XAI_API_KEY` | Uses Grok for the free report, if neither of the above is set. Fully supported, just not the default. |
| `PSYCHEAI_PROVIDER` | Forces `gemini`, `anthropic` or `grok` for the free report when you have more than one key. |
| `PSYCHEAI_FREE_ANALYSES` | How many analyses a browser gets before being asked to pay. Default `1`. A fair-use allowance held in the browser, not enforcement — see ["One free analysis, then US$2"](#one-free-analysis-then-us2--and-what-actually-stops-a-runaway-bill). |
| `PSYCHEAI_DAILY_FREE_LIMIT` | Server-wide ceiling on free model calls per UTC day. Default `200`, about US$50/day at `COST_CAP`. This is the one that actually bounds the bill. A non-numeric value throws at boot rather than failing open. |
| `PSYCHEAI_BUDGET_FILE` | Where that day's tally is appended. Default `data/budget.jsonl`. Holds a date, a kind and a timestamp per row — nothing that could identify a caller. |
| `PSYCHEAI_PREMIUM_PROVIDER` | Which engine runs the four paid sections, independent of the free report's provider above — `gemini` or `anthropic`. Default `gemini`. Set to `anthropic` to revert the paid call to Claude Sonnet 5; needs that provider's own key regardless of which one the free report is using. |
| `PSYCHEAI_GEMINI_THINKING` | Gemini's thinking level for the card and the full premium report: `MINIMAL`, `LOW`, `MEDIUM` (default) or `HIGH`. Takes effect on restart, no deploy needed. At `HIGH`, Gemini 3 Flash thinks until its output cap is nearly spent, which cut the answer off on 3.8 and is why the default is `MEDIUM` (see [Which model, and going back](#which-model-and-going-back)). An unrecognised value is logged and ignored. |
| `PSYCHEAI_COMPAT_THINKING` | Gemini's thinking level for the Psyche Sync call alone: `LOW`, `MEDIUM` or `HIGH`. Unset, it is `LOW`, whatever `PSYCHEAI_GEMINI_THINKING` says; the card and report stay at `MEDIUM`. The current model refuses `MINIMAL`. Takes effect on restart. See [What a compatibility costs](#what-a-compatibility-costs). |
| `GEMINI_MODEL` | Gemini model ID, used for both the free report (when Gemini wins auto-detection) and the paid call (when `PSYCHEAI_PREMIUM_PROVIDER=gemini`). Default `gemini-3.8-flash`. Setting this is the zero-deploy way to go back to `gemini-3.7-flash` — see [Which model, and going back](#which-model-and-going-back). |
| `PSYCHEAI_MODEL` | Claude model ID for the free report's Claude fallback. Default `claude-opus-5`. |
| `PSYCHEAI_PREMIUM_MODEL` | Claude model ID for the paid call specifically when `PSYCHEAI_PREMIUM_PROVIDER=anthropic`, independent of `PSYCHEAI_MODEL`. Default `claude-sonnet-5`. |
| `PSYCHEAI_PREMIUM_EFFORT` | Adaptive thinking effort for the paid call on Claude. Default `high` — see ["Waiting for it, and not losing it"](#waiting-for-it-and-not-losing-it). |
| `XAI_MODEL` | Grok model ID. Default `grok-4.6`. |
| `PSYCHEAI_MOCK=1` | Canned analyses, no API calls. Beats everything else. |
| `PSYCHEAI_PROMO_CODES` | Creator codes, comma-separated, each `CODE[:cap[:last day[:percent off]]]` — e.g. `AVA:50:2026-12-31,BEN:20,HALF:100:2026-12-31:50`. A cap counts distinct reports; the last day is inclusive, UTC; percent off defaults to 100 (free), and 1–99 makes a discount paid through the payment sheet. See [Counting what works](#counting-what-works-without-counting-anyone). |
| `PSYCHEAI_CANONICAL_HOST` | The site's one address, e.g. `psycheai.io`. Set, a page requested at any `*.onrender.com` address gets a 301 to the same path there, so search engines index one copy; `/api/` is left alone so a tab already open on the old address can still collect its report. Unset ⇒ nothing is redirected. Browser storage is per address, so a card saved on the old address stays there. |
| `PSYCHEAI_STATS_TOKEN` | Bearer token for `GET /api/stats`, the daily totals and how much of each creator code is left. Unset ⇒ the route 404s. `?days=N` reads up to 400 days back from the store. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis (REST). With both set, stats, creator-code uses, the daily free budget, payment retries, shared rate limits, the one-free-card-per-account record and invite-friends counts survive deploys. Unset ⇒ all of it runs in memory, as before. See [Kept across deploys](#kept-across-deploys-upstash). |
| `PSYCHEAI_HASH_SECRET` | Optional. The key every stored identifier is scrambled with; defaults to one derived from the Upstash token. Changing it forgets which accounts had their free card. |
| `PSYCHEAI_FREE_PER_ACCOUNT` | `0` turns off one free card per Instagram account (a test server, or checking your own account repeatedly). On by default. |

Model IDs change often on every provider, so the defaults above will go stale. List what your key
can actually reach:

```bash
npm run models:grok       # needs XAI_API_KEY
npm run models            # needs GEMINI_API_KEY, lists Gemini's
```

`gemini-3.8-flash` is the default, at the same price as 3.7. For a deeper read try `GEMINI_MODEL=gemini-3.1-pro-preview`, which is stronger at reasoning
but preview-only.

### Gemini through Vertex AI

The same Gemini models through Google Cloud, on a service account, to spend Google Cloud credits
rather than the Gemini API key's billing (`lib/gemini.js`, backend selection). Set
`GOOGLE_GENAI_USE_VERTEXAI=true`, the key file (`GOOGLE_APPLICATION_CREDENTIALS`, a Render secret
file, or `GOOGLE_APPLICATION_CREDENTIALS_JSON`), and optionally `GOOGLE_CLOUD_PROJECT` and
`GOOGLE_CLOUD_LOCATION` (default `global`). The service account needs the **Vertex AI User** role,
the project the **Vertex AI API** enabled and billing linked.

Built so the site keeps making cards whatever state those settings are in:

- **Half set is off.** Asked for but missing the key file, an unreadable one, or no project: one line
  in the log and the API key carries on as before.
- **Every client says which it is.** The SDK reads `GOOGLE_GENAI_USE_VERTEXAI` by itself, and the old
  `new GoogleGenAI({ apiKey })` would have turned into a Vertex client on the API key the moment that
  variable was set, failing every call. The key client now passes `vertexai: false`.
- **The key is the fallback.** With both set, Vertex goes first. A call Vertex refuses for a reason
  of its own (credentials, permission, the API not enabled, billing, quota, no such model, overload,
  the network) is sent again with the key at once, and the key keeps the next ten minutes before Vertex
  is tried again, with a log line each time. A refusal about the content (safety, length, unreadable
  JSON) is not: the key would refuse it too. Context-cache entries are kept per backend.
- **The boot log says which:** `Provider: gemini · model: … · via Vertex AI, GEMINI_API_KEY as
  fallback`, or `via the Gemini API key`.

The privacy page names both ways (the Gemini API or Google Cloud's Vertex AI) and both sets of terms;
the data goes to Google either way, and on Google Cloud as on the paid Gemini API it is not used for
training. Choosing a Singapore region would make "processed outside Singapore" untrue; it is
`global` by default.

### Which model, and going back

The default is `gemini-3.8-flash`. It was made the default once before and moved back the same day:
the model resolved and the key could reach it, but Google answered **"Gemini is overloaded right now
and stayed unavailable after retrying automatically"** — declining to serve under launch load, three
automatic retries deep, rather than anything wrong with the switch. It is the default again now that
launch traffic has had time to settle. If the overload errors come back, `GEMINI_MODEL=gemini-3.7-flash`
returns to 3.7 on the next request with no deploy.

**At thinking level HIGH, Gemini 3 Flash thinks until its output cap is nearly gone.** On Google's
own SDK tracker ([googleapis/python-genai#2062](https://github.com/googleapis/python-genai/issues/2062))
thinking took about 96% of whatever `maxOutputTokens` allowed — 7,862 of 8,192, 31,455 of 32,768 —
while the visible answer stayed the same size. So every HIGH call is billed for nearly its whole
cap, and an answer bigger than the ~4% left over is cut off as `MAX_TOKENS`, which is billed and
lost. The card (about 700 tokens against 8,000) and the full report (about 10,000 against 28,000)
are both bigger than that. A larger cap does not help, because the thinking grows into it. A level
that stops on its own does: on the same measurements `MEDIUM` thought about 2,500 tokens and `LOW`
about 1,400. **So both calls think at `MEDIUM`**, on `gemini-3.8-flash`. `PSYCHEAI_GEMINI_THINKING`
changes the level with no deploy; measure a change with `npm run compare` first. A cut-off call is now recorded in `npm run usage`, with its cost.

### What a compatibility costs

Compatibility is free to the reader, so its call is held small on all three counts that bill it
(`lib/gemini.js`, `analyseCompatibility`):

- **Its own output cap, 8,000 tokens** (`COMPAT_MAX_OUTPUT_TOKENS`), the free card's. It used to
  inherit the full report's 18,000, so a call that thought for long could bill about 7¢. The answer
  is about 1,000 tokens at its longest, and the thinking about 2,500 more.
- **Thinking at `LOW`**, below the card and report's `MEDIUM` (`PSYCHEAI_COMPAT_THINKING` to change
  it). It was `MINIMAL` for a while, to save that thinking, but the current Gemini model refuses
  `MINIMAL` and every sync failed with a 400; it then followed the card at `MEDIUM`, about 1.5–2¢ a
  sync. `LOW` is the lowest the model accepts. A sync's answer is short and built from two cards
  already reasoned out, so it needs less thinking than the card does.
- **A shorter system prompt**, 4,830 characters from 9,826, every rule kept. It is under Gemini's
  caching floor, so it is billed in full on every call.

At $0.75 / $3.75 per million tokens: input about 2,700–3,400 tokens (prompt, the 3k-character answer
schema, two cards and the derived facts) is about 0.2–0.26¢; output about 800–1,100 tokens is about
0.3–0.4¢ for the answer, plus about 2,500 thinking tokens at `MEDIUM`, about 0.9¢. So **about 1.5–2¢
a sync**, and **at most about 3.2¢** with both cards at every length limit and the output at its cap.
A repeat of the same pair is answered from memory and costs nothing.
These are estimates from sizes; `npm run usage` has the real figures once there is traffic, and if it
shows compatibility calls ending on `MAX_TOKENS`, raise the cap.

The link carries the same card for a free reader as for a paid one: the free analysis writes every
field in it, including the ones the visible card does not show — and those are shown under the card
now, in *Beyond your card* (see [The K5 card](#the-k5-card-and-beyond-your-card)).

Two ways to move between them, and the first needs no deploy:

1. **Set `GEMINI_MODEL` in the environment.** It overrides the default, takes effect on the next
   request, and is the right lever for trying 3.8 again without a deploy — or for backing out of it
   in a hurry. The digest budget stays priced for the default, which is safe in either direction
   only because the two models carry identical standard rates — see below.
2. **Change the default**, which is two lines and nothing else: `DEFAULT_MODEL` in `lib/gemini.js`
   and `PRICED_MODEL` in `docs/digest.js`. `MODEL_RATES` beside the second already carries both
   models' rates, so nothing has to be looked up, and a check in `tools/selftest.mjs` fails if only
   one of the two lines moves. Nothing else in the codebase names a model.

**On the rates**, which are load-bearing rather than documentation: `docs/digest.js` checks both
cost ceilings against them, so a price that is too low would let a ceiling break quietly rather than
fail loudly. Both models are budgeted at $0.75 in and $3.75 out per million tokens — the price treated
as permanent for both — so the two are interchangeable as far as every budget is concerned, and
switching between them changes no other number in the app. If Google's price for either changes,
`MODEL_RATES` in `docs/digest.js` and `RATES` in `lib/usage.js` are the two places to change it; a
selftest check fails if they disagree.

A `PRICED_MODEL` with no entry in `MODEL_RATES` throws at load, naming the model and listing the
alternatives, rather than surfacing as a `TypeError` from inside `charBudget` — the half-finished
switch is the likeliest mistake here, since the two lines that must move live in different files.

All three providers share the same prompts and the same output schemas (`lib/prompts.js`). Gemini's
`responseJsonSchema` accepts real JSON Schema and Grok's `response_format` strict JSON schema mode
does too, so nothing is translated for either of them; Claude's structured-output config takes the
same schema object under a different field name. The server picks a provider at startup and the rest
of the app never knows which one ran.

`lib/grok.js` talks to xAI through the `openai` package rather than a dedicated xAI SDK — xAI's API
is deliberately OpenAI-compatible, so this is `openai` pointed at `https://api.x.ai/v1` with an
`XAI_API_KEY` rather than an `OPENAI_API_KEY`, not a call to OpenAI's own models.

### When the model is overloaded

All three APIs occasionally answer "too much load right now" rather than an actual response — Gemini
as an `UNAVAILABLE`/503, Anthropic as a 529 `overloaded_error`, Grok as a generic 5xx (xAI does not
document a distinct overloaded code the way the other two do, so any `InternalServerError` from the
`openai` SDK is treated the same way). It is a capacity blip on the provider's side, not a problem
with the key, the request, or this app, and it usually clears within seconds. So `lib/gemini.js`,
`lib/claude.js` and `lib/grok.js` each retry automatically — three attempts with growing gaps
(2s, 5s, 12s) — before giving up and surfacing a message that says so, rather than failing on the
first hit the way a straight pass-through would.

`tools/fixtures/retry-behaviour.cjs` tests this against fake SDKs standing in for `@google/genai`,
`@anthropic-ai/sdk` and `openai`, stubbed into the require cache before `lib/gemini.js`/`lib/claude.js`/
`lib/grok.js` ever import the real packages — the fakes have to be there first, so this runs in its
own process rather than inside `tools/selftest.mjs` directly, which has already loaded the real
modules by the time it gets here. It scripts an overload that clears after a couple of attempts
(recovers), one that never clears (gives up at exactly four attempts and reports it), and a
non-retryable error (fails on the first
attempt, no delay). `tools/selftest.mjs` spawns it and folds each line of its output into its own
tally, so a break here fails `npm test` rather than needing a separate command.

Writing that fixture found a second, unrelated bug in the Claude error path: `describeError`'s
catch-all checked `error instanceof Anthropic.APIStatusError`, and that class does not exist on this
SDK version — the real base class is `Anthropic.APIError`. `instanceof` an undefined value throws,
so any Anthropic error not already special-cased above it (a 400, a 404, a fresh status code) would
have crashed the error handler instead of returning a message. Fixed alongside the retry logic, with
its own regression check.

## The compatibility read is free

Opening someone's link and asking how you two get on is free. It was briefly a paid product,
priced level with the premium unlock; it is free again so that the feature that brings a second
person to the app costs them nothing to try.

It is still bounded. `POST /api/compatibility` draws on the same daily free ceiling as the free card
(`lib/budget.js`), so a day's free calls across every reader stay capped, and it consults the result
cache first, so a reader whose connection dropped gets the same report back without a second call.
Its cache key includes the mode and stance, not just the two cards — the same pair read as colleagues
and read as partners are different reports. A payment id or promo code sent by an older page is
ignored; `lib/stripe.js` no longer has a compatibility product at all.

The page asks the two questions — the basis (romantic, family/friends, professional) and, for a
professional read, whether they are colleagues, manage the other person or report to them — and then
runs the comparison straight away, with no payment sheet in between.

## Rate limits and single-use tickets

A security researcher pointed out that `POST /api/create-payment-intent` accepted an empty body from
anyone and returned a live PaymentIntent with a `client_secret`, with no cookie, no CSRF token and
no rate limit — two probes, two real `pi_…` objects. The same was true of the three model routes,
which cost budget rather than Stripe quota but cost something either way. Two mechanisms went in
together, and it is worth being precise about which does what, because it is easy to credit a nonce
with protection it does not provide.

**`lib/ratelimit.js` is the ceiling.** A token bucket per caller per route — six payment intents per
ten minutes, twenty analyses an hour, eight of each paid route — refusing with a `429` and a
`Retry-After`. A bucket rather than a fixed window, because a fixed window lets a caller spend one
window's allowance in its last second and the next window's in its first, which is twice the
intended rate in a burst at exactly the moment a flood is most useful to whoever is running it.

The analysis limit started at six an hour and was raised to twenty, because an address is very often
not a person: an office, a school or a café each look like one caller, and a mobile carrier can put
thousands of phones behind a single address. Six shared between all of them turns readers away for
something they did not do. Loosening it costs nothing defensively — the flooding this was built to
stop is bounded by the `payment-intent` bucket, which is separate, and by the daily budget ceiling
above it.

The dangerous part is deciding *who the caller is*. Behind a proxy the socket address is the
proxy's, identical for everyone, so a limiter that used it would put every reader in the world in
one bucket and lock them all out together. So `X-Forwarded-For` has to be read — but it is a request
header, and a limiter that trusts its leftmost entry is defeated by typing a different number. Each
proxy *appends* the address it saw, so the rightmost entry is the one written by the hop closest to
us and the only one a remote caller cannot forge. That is the one counted, stepping back
`PSYCHEAI_TRUST_PROXY` hops (default 1). Four checks cover this, including two that forge chains and
confirm the forged entries are ignored.

**`lib/nonce.js` raises the cost per attempt.** Every protected POST must carry a ticket from
`GET /api/nonce` in an `X-PsycheAI-Nonce` header. A blind `curl` now gets a `400` rather than a
PaymentIntent, and a cross-site form POST cannot read the ticket it would need, which closes the
drive-by CSRF shape. The header rather than the body, for
three reasons: two of these routes carry somebody's evidence digest and do not need another field in
it, the digest is the result cache's key so a per-request value in there would make every request a
miss, and a custom header is exactly what a cross-origin form cannot set.

What a nonce does **not** do is stop a determined attacker, who can fetch one and use it just as the
page does. It doubles the traffic they need and puts the minting itself under a limit; the limiter
is what sets the actual ceiling. Neither is worth much without the other, which is why they shipped
together. The limit is spent *before* the ticket is checked, so guessing tickets is not free — the
one way of probing this that must not be.

**The tickets are signed rather than remembered**, and that was a correction rather than a
refinement. They started as entries in a `Map`, which lives in one process — but a ticket is minted
by one request and spent by another, and nothing routes those two to the same process: not with more
than one instance, and not during the window of a zero-downtime deploy, which this repository enters
on every push. Readers were being told to reload a page they had done nothing to. A ticket now
carries its own expiry and randomness under an HMAC, keyed by `PSYCHEAI_NONCE_SECRET` or, unset, by
a hash of the provider or Stripe key the deployment already has — identical across instances,
stable across restarts, needing no configuration. Any process can verify what any other minted.

The cost is exact and worth stating: single use is now enforced per process rather than across the
deployment, so a replay landing on a *different* instance inside the ticket's ten minutes would be
accepted. The round trip and the CSRF case — the two reasons the file exists — are untouched, and
the limiter is unaffected. Being refused for nothing was a certainty; that replay is a hypothetical
worth one request an attacker could have asked for anyway.

The guarded routes live in one table (`API_GUARDS` in `server.js`) rather than as four copies of the
same two checks inside four handlers, because a guard that lives inside the thing it guards is a
guard somebody adds a fifth route without. A check names the routes in that table rather than
counting them, so adding a costly endpoint and forgetting to guard it fails the suite.

**A payment also stops being spendable.** `verifyPaid` gained a thirty-day redemption window, since
without one an intent created today and completed at any point after — next week, next year — stays
a live key to the paid routes, bounded only by the per-payment use cap. That cap says how *many*
times a payment is worth something; the window says how *long*. It is built on `intent.created`, a
field neither path through `retrievePaymentIntent` previously returned, and it fails open if that
field ever goes missing — a Stripe response that stops carrying it should cost us a window we no
longer enforce, not every reader their purchase. Two checks hold both paths to populating it, so the
fail-open branch cannot quietly become the only branch.

The per-payment retry allowance came down from five to three at the same time, for a reason that had
already changed underneath it: the result cache now serves a repeat of a *successful*
generation before the ledger is touched, so the common retry — a reader whose connection died while
the report was coming back — is free. What the number still covers is generations that genuinely
failed, and three of those in a row is a broken provider, not a reader who needs a fourth.

## The analysis outlives the page that asked for it

A free card takes up to a minute (the page says so while it waits) and the full report several, and for
most of this app's life the browser had to hold one connection open for all of it. Everything built to survive that connection dying — the keep-alive
whitespace, the retry on a cut stream, the retry on a dropped socket, the result cache behind both —
was a way of recovering from a design in which a phone being a phone was a failure.

So the connection stopped being load-bearing. `POST /api/analyse` with `background: true` starts the
work and returns `202 { job }` at once; `GET /api/result?job=…` says what has become of it. The work
runs in the server process whether or not anybody is listening — which was **always** true, since
Node never aborted a handler when the client disconnected, and which used to be useless because the
only thing that knew how to collect the result was a closure inside a page about to be discarded.

The key is therefore written to `localStorage` while the job is still running, and that single line
is what turns "I closed the app" from a loss into a pause. The next page to open — thirty seconds
later or two hours later — finds the job, returns to the waiting screen, and picks it up. It is
checked at startup *and* on every return to visibility, because a suspended tab restored from memory
resumes its JavaScript context without a reload, and a poll loop that stopped ticking while the phone
slept is indistinguishable from one that never existed.

Every long call works this way, not only the first upload: the free report, a re-run from **Add /
change data & re-run analysis**, the paid sections, and a compatibility read. The record carries a
`kind`, because collecting one is not the same as collecting another — a free report replaces the
profile wholesale, paid sections attach to the one already on screen, and a comparison belongs to no
profile at all — and a resume that guessed would eventually put one in the place of another. For a
comparison it also carries the other person's card and the basis, which came off a QR code and two
dialogs and exist nowhere else once the tab is gone.

One case is deliberately partial and worth knowing about. A **bundled refresh** — the re-run that
happens when premium is already unlocked, regenerating the free report and the paid sections
together on one charge — records its free half, so a reader who closes the app gets that report
back. What a resumed one cannot restore is the promotion of the newly-supplemented digest into
storage, because that digest lives in a closure and is far too large to write beside a key. So the
popout will show the source they just added as unticked and ask for it again. That is worse than
the unbroken path and better than the alternative, which is losing the refreshed report outright.

Four job states, and each sends the client somewhere different: `running` (wait), `done` (take the
report), `failed` (show the reason), `unknown` (this process has no memory of it — start again).
Folding any two together is how a reader ends up watching a spinner for a job that failed, so
failures are remembered briefly and separately for exactly that reason. A poll that cannot reach the
server is not counted as any of them: it is the condition the whole design exists to sit through, and
only a run of consecutive failures long enough to mean something other than "the phone is asleep"
gives up.

`/api/result` is rate-limited but carries no ticket, which is a deliberate exception and is named as
one in the guard-table check. A three-minute job polled every few seconds is dozens of requests, and
a ticket apiece would exhaust the reader's own nonce allowance and turn the fix into a new failure.
What stands in for the ticket is the job key itself: a SHA-256 of the digest, which cannot be
produced without already holding the evidence it names.

The blocking form still works and is still tested, because during a rollout a browser holding an
already-loaded `docs/llm.js` and a freshly-deployed server are the same reader, mid-analysis, and a
response shape the page cannot parse would break them.

## Being found, and being shared

The site lives at **psycheai.io**. What a search engine or a pasted link sees is part of the product,
so it is built in rather than left to a plugin.

- **The front page's head** (`docs/index.html`) has a title written for search (*free personality
  test from your Instagram data — MBTI, Big Five, love languages*), a description, one canonical
  address, Open Graph and Twitter tags, and a JSON-LD block describing the app and its two prices.
  The JSON-LD is a data block, never executed, so the `script-src 'self'` policy is untouched.
- **The link preview** is `docs/media/og-card.jpg`, 1200×630, at an absolute address — WhatsApp, X
  and iMessage show nothing for a relative one. It was a 444 KB PNG. As a JPEG at quality 92 with
  full colour resolution it is 163 KB, a 63% saving, with no visible difference (41.7 dB PSNR
  against the PNG). That also brings it under the roughly 300 KB above which WhatsApp can drop a
  preview. The old `og-card.png` has since been removed: previews cached before the switch have
  long expired. `node promo/og.mjs` draws the preview from the brand mark and the sample Psyche Card,
  with the home-screen icons beside it (`icon-192`, `icon-512`, `apple-touch-icon`) that
  `docs/manifest.webmanifest` names. Those were re-saved losslessly: `icon-512` went from 103 KB to
  48 KB. If they are redrawn, run them through `PIL`'s `optimize=True` again.
- **One `<h1>` and a `favicon.ico`.** The front page's document has a single `<h1>`, the hero's.
  Each app view's title (My Psyche, Your Psyche Syncs, the sync popout, FAQ, the print letterhead) is a
  `<div class="h1" role="heading" aria-level="1">`. Search engines see one main heading, screen
  readers still hear each visible view's title as its main heading, and `.h1` styles it as one.
  `docs/favicon.ico` (16, 32 and 48px, with bolder strokes at the small sizes so the mark survives)
  is linked on every page with `sizes="any"`. It serves crawlers, search results and browsers
  without SVG icons, and answers the `/favicon.ico` request browsers make on their own. The SVG icon
  beside it still wins wherever it is supported.
- **Four guides**, static pages with no script, each answering one thing people search for:
  [`/instagram-personality-test`](docs/instagram-personality-test.html),
  [`/compatibility-test`](docs/compatibility-test.html),
  [`/mbti-test-no-questions`](docs/mbti-test-no-questions.html) and
  [`/download-instagram-data`](docs/download-instagram-data.html). The last is the app's own
  illustrated export guide (`#guide-dialog`) as a public page — the same seven screenshots and the
  three settings that matter — because "how to download Instagram data" is searched far more than
  anything about personality, and every reader of it is one step from a card. Each has its own canonical address,
  an FAQ, and two buttons: into the app, and `/#sample`, which opens the sample report directly and
  tidies the address back to `/`. The server serves `/name` as `name.html` when that page exists,
  and nothing else; anything else is still a 404. The MBTI guide carries the trademark notice.
- **`robots.txt` and `sitemap.xml`** list every page and keep `/api/` out.
- **The hero (October 2026)** is no taller than the video beside it on a laptop. Its line is *Your personal AI
  coach that already knows you, built from your Instagram data*, and above the buttons one clean line says
  what the reading covers: MBTI · Attachment Style · Career Strengths · Blind Spots (plain words and dots, no
  pills or fill; smaller on a phone so it still fits one line down to 320px).
- **Two hero buttons, one for each kind of visitor.** **Request my IG data** (was Get my data; filled) is for someone who still
  has to ask Instagram, which takes hours, so it comes first. It goes to the steps card, titled
  *Request your Instagram data first* with *It takes 30 seconds. Instagram then emails you the file,
  usually within a few hours.* under it; for a reader with a card it opens the illustrated guide,
  titled *Request your Instagram data*. **Load my data** (outline) is for someone who has the file:
  it opens the Add your data popout straight away. Before, they scrolled about five screens to Start
  here. For a reader with a card it goes to their card and opens the same add-data popout their
  report uses. The hero used to lead with *See sample report*. The sample is still one tap away, at
  the foot of the gallery's premium tier.
  The lede ends *No questions asked. No sign-up.* since 26 October 2026, for visitors tired of
  subscriptions. A line of its own under the buttons (*Free Psyche Card and report · No sign-up*) was
  tried the same day and dropped: it made the hero look busy.
  *your own Instagram and WhatsApp data* since 27 October (it was *or*): the two read together, not one or
  the other.
- **The logo goes to the main page.** For a reader with a card, `data-nav="main"` shows the main page
  (not `home`, which is also where Back lands and so has to stay their card). There the steps card
  and the Start here card are hidden (`#view-welcome.is-returning`): they already have data. Request
  data opens the illustrated guide instead of scrolling to a card that is not there, an upload error
  brings the Start here card back so the message is seen, and the sample card is re-fitted on
  arrival, since the page was hidden when it was first drawn. For them the main page is an excursion,
  like the FAQ, so Back returns to their card. Closing the guide, the sample or the expanded video
  gives back its own history entry through `popOwnEntry()`, and the popstate that causes is passed
  over rather than read as Back — before, closing the guide on the FAQ sent the reader to their card.
  `/#sample` also opens the sample when the hash changes on a page already open, not only on load.
- **Everything shared carries the address.** The Psyche Card's footer reads *psycheai.io · your
  personality, read from your own data*, on screen, in the shared image and in the PDF, and the
  share sheet's text is *I got <character> on my Psyche Card. Get yours free, no questionnaire:
  <link>*, the one share message (see "One share message"). A card that travels is an invitation.

- **A compatibility link waits for the friend who opens it.** Whoever taps someone's link usually has
  no Instagram export yet, and Instagram takes hours to email one. The invite used to sit in
  `sessionStorage` behind an error-coloured line and vanished with the tab. It is now kept on the device
  (`psycheai_invite`, in `KEYS`, so *Delete everything* takes it) for fourteen days, shown at the top
  of the welcome page — *Ava Tan wants to see how compatible you both are. Download your Instagram data
  and make your free Psyche Card. The compatibility analysis with Ava Tan runs straight after it, also
  free.* — with **Show me how** for the export steps. (Later the invite came to wait on My Syncs once
  the card is made, synced only when the reader presses **Sync** there; see "Psyche Sync".) Its ✕
  puts the banner out of sight (`psycheai_invite_banner_closed`) without throwing the invite away; it
  expires on its own.
- **The roast as a story image.** Once the roast is read, **Share this roast** draws its opening
  sentence or two in a panel on a 1080×1920 image — *I let AI read my Instagram. It said:* above,
  *Get roasted free · psycheai.io* at the foot — and hands it to the share sheet with *"I let AI read
  my Instagram and it roasted me. Get yours free: https://psycheai.io"*. Only the opening goes: the
  rest runs to paragraphs and turns personal further in. The sample's roast has no share button.
- **The Psyche Card is already story-sized.** The structured layout's card is a 1080×1920 canvas on
  screen and in the export, with the address in its footer, so it goes to a Story as it is.

The plan this serves (audiences, loops, content, channels, launch calendar, measurement, risks) is
in [`marketing/PLAN.md`](marketing/PLAN.md).

`npm test` holds this together: the canonical and share-image tags, valid JSON-LD, the images on
disk, and every address in the sitemap served with a 200 and naming itself as canonical. The UI suite
follows a guide's sample link into the open sample.

### The headline, and "Continue" with no Instagram (October 2026)

The front page's headline is **A full personality study.** with **No questions asked.** under it in
the accent gradient, and the line below reads *Discover your MBTI, love languages, mental wellbeing, and
career strengths directly from your Instagram and digital footprint — zero quizzes required.* It
replaced *The personality analysis you didn't know you needed*. The checks pin the two lines and
"zero quizzes required", the claim no quiz can make.

**Since 25 October 2026** the headline is **Your personal AI coach** with **that already knows you.** under it in
the accent gradient, and the lede is *A full personality study from your own Instagram data. No questions asked.*
The reels, the Instagram bio and the story highlights all say *your personal AI coach*, so someone arriving from
them now meets the promise they tapped; "already knows you" is the part no other coach can claim, so it carries the
gradient; and the personality study and "No questions asked" stay in the line beneath. The checks pin both lines and
that the hero still says no questions are asked.

In the Add your data popout, **Continue** with no Instagram loaded used to close the popout, say
*Load your Instagram data to get started.* on the page behind it, and open the popout again. Now
the popout stays open and says it in its own status line (`requireInstagram` in `askDataSources`).

### A lighter front page

Measured on an emulated mid-range phone (Chrome with the CPU slowed 4×, 9 Mbps 4G), a first visit was
painting its text in about 2 seconds but taking about 8 to be ready and 14 to finish, with the CPU
busy for 11 seconds, almost all of it laying out and styling about 36,000 elements. Now it is about 6,000
elements, ready in about 3 seconds, finished in under 5, with 5.3 seconds of CPU work:
- **The cast strip's tiles are one image** (see below), not five live copies of 29 scenes.
- **The sample-card gallery draws a card only when it is in view**: the front one and the two peeking
  beside it (`drawDeckCard`, from `arrangeDeck`). The rest are drawn as they come forward. Drawing all
  six, scenes and all, was the page's heaviest part after the strip, and it was redrawn each time the
  front page came back.
- **The PDF maker loads only with a Psyche Report.** It is kept in `<template id="pdf-scripts">`,
  which the browser neither fetches nor runs while the server still fingerprints its address. It is
  loaded when a report is drawn (`renderProfile`) or a PDF is asked for. It had been prefetched on
  every visit and then run when the page went idle.
- **The data readers load only to read data.** `zip.js`, `instagram.js`, `supplement.js`,
  `whatsapp.js` and `digest.js` sit in `<template id="reader-scripts">` and are loaded, in that order,
  when the Add your data popout opens or a file is dropped, and by every flow that reads, reviews or
  sends a digest (`readersReady`), including a paid run's (`runPremiumAnalysis`). A reader with a
  card already gets them in the background once the page has settled. `IG`, `Supplement` and
  `Digest` in `app.js` are looked up when used (`lazyGlobal`), not held from the start. The server
  loads `digest.js` itself, as before.

### Guess your character, win the report

*Moved to the waiting screen in October 2026: see "The guessing game moved to the waiting screen". The
strip below is gone; how a guess is judged still holds.*

The 29 characters are the app's strongest draw, and the front page showed one at a time. Above
*Request your Instagram data first* there is now one slim row (about 150px with its note): the title
**Guess which character you are and win a Psyche Report for free**, every character in its own scene
cropped to a round tile with its name under it, spinning slowly past (about 45px a second,
`mountCast` in `docs/app.js`), and a line under it saying what to do or what was picked.

*The strip.* It turns slowly on its own (40px a second) until the reader touches it, anywhere: a
tap, a swipe, a press, a wheel or a key stops that for good on the visit, and from then on it is
theirs.
- **It scrolls natively**, the browser's own sideways swipe with its own momentum. An earlier version
  moved it by hand with pointer events and a transform, and on a phone that felt dead and hard to
  swipe; the browser's own scrolling is as sensitive as any list on the phone. A mouse can drag it
  (`pointerType === 'mouse'`), and a drag is not taken as a tap.
- **Small arrows** either side move it about two-thirds of its width each way, and say it can be swiped.
- **It has no ends.** The cast is drawn five times over and started in the middle copy. Each scene is
  drawn once, in a hidden sprite (`.cast-sprite`), and placed by `<use>`, so the page carries 29
  drawings, not 145, and only the middle copy is read out or tabbed to. When the strip comes to rest
  (no scrolling for 180ms, no finger down) more than half a copy from the middle, it is moved back a
  whole copy's width: the same tiles, so nothing visibly moves, and never mid-swipe, which would stop
  a phone's momentum dead.
- It turns only while on screen and the tab is visible, and not at all for a reader who asked for less
  motion.
- **Its tiles are one image.** `docs/media/cast-sprite.webp` (65 KB) holds all 29 tiles side by side,
  drawn by `node tools/cast-sprite.mjs` from the same scenes and crop in the catalogue's order, with
  `cast-sprite.json` naming that order; each tile is a background position on it. The first version
  drew the 29 scenes live and placed five copies with `<use>`, which made the browser lay out about
  17,000 extra elements and nearly doubled the front page's work on a phone. `npm test` fails while
  the image is out of date.
- **Get my data** (and an invite's *Get my free Psyche Card*) lands on it, with the request steps
  straight below. The tiles are buttons, not links: the front page gains no links to the new pages.

*The guess.* Before a first card, a tap picks a tile (a ring and a tick; tap again to clear it), kept
as `psycheai_guess`. It goes with that first free card's request as `guess`, beside the digest and
never inside it, so the model cannot see it, and only the server judges it, against the card it has just
written (`referral.judgeGuess`):
- **One guess per Instagram account, ever**: the scrambled account code is marked the first time,
  right or wrong, so a second card cannot try again. No account (an export without a username), or a
  name outside the catalogue, is not judged. Paid re-runs are never judged.
- **A right guess wins a grant** exactly like a friend-earned free report: one Psyche Report, once,
  within 60 days. It is kept as a gift (`psycheai_gift` with `won: true`), the card's gift banner says
  *You guessed right! You said Hulk, and your Psyche Card agrees. Your Psyche Report is free.* with
  **Unlock it free**, and the unlock sheet offers it.
- **An account is only what the page says it is**, so a made-up account is a fresh guess. With 29
  characters a farmer needs about 29 free cards a win, and each win is also held to one a day from one
  connection and `PSYCHEAI_GUESS_WINS_PER_DAY` (25) for the site; past either, a right guess is told so
  and wins nothing. The terms say all of this (section 6), and the privacy page says where the guess
  goes.
- **Every guess hears back, in a popout** (`#guess-dialog`, `sayGuessOutcome`) once the card is on
  screen: the guessed character's tile (and the card's, when they differ) with *You guessed right!*
  and **Unlock it free**, or *Not this time: You guessed Po, and your card says Mulan. Nice try!*, or
  *Your guess wasn't counted* and why. The first version said a win with the card's banner and a miss
  with a note in the alert line, and said nothing at all when a guess was not judged, which is how a
  reader who chose Iron Man saw no result. Guesses that are not judged, and now say so:
  - **a paid re-run**, which never carries a guess (the account had its free card, the US$2 sheet
    came up, a promo code paid it). Also no longer offered at all on a device whose free run is spent
    (`runCount` survives *Delete everything*): the strip reads *Which one are you?* with *The guessing
    game is for a first free Psyche Card, and this device has made one already.*;
  - **an account that has guessed before** (`reason: 'guessed'`) or an export with no username
    (`'account'`), each now answered by the server rather than dropped;
  - **the same card asked for again within the hours a result is held** (`lib/results.js`). This
    used to be judged against the remembered card, and that was a free report on demand: make a
    card with no guess, read the character off it, then send the same request again with that
    character as the guess and any new account. Each "guess" won, and only the day's two limits
    stood in the way. A remembered card is now never judged: the guess is told it was not counted
    (`reason: 'guessed'`), and any judgement the card first came with, token included, is left
    off. A reader whose connection dropped gets that from the background job they resume, not
    from asking again. A card made without a guess also marks the account's one guess as spent
    (`afterFreeCard({ guessed: false })`), as the first bullet always said it did.
  A won report has no banner on the card as well: the popout says it, and the report waits on the
  unlock's sheet, which the slim *Unlock your Psyche Report* bar leads back to once the popout is
  closed. A report gifted by someone else keeps its banner, since nothing else announces it.
- **Nothing else competes with a gift.** While a gifted report's banner shows, the slim *Unlock your
  Psyche Report* bar stands down (`prizeShowing`), as it already does for a friend's Sync invite.
- Once a card exists the strip turns to friends: *Which one are your friends? Send them your link to
  find out.*, and nothing is pickable.

`npm test` holds the server's side (one guess per account, a grant only for a win, the connection
limit, the guess read only after the card is written); the UI suite plays the whole thing on the
structured server, whose mock card is Hulk.

### Three button styles, and one set of line icons

**Buttons.** There were five unrelated looks: the filled gradient, a hairline *ghost*, a tinted *soft*,
the 2px *outline* and the underlined text link. Now there are three: **filled** (`.btn`) for the one
main action on a screen, **outline** (`.btn-outline`) for every secondary one, Back and Cancel
included, and **plain** (`.link-btn`) for a quiet text action. `.btn-ghost` and `.btn-soft` are gone
from the markup and the stylesheet; a destructive outline (Delete everything) is `.btn-outline.danger`.

**Icons.** Emoji used as icons (📷 💬 🔍 📘 for the sources, 🧲 🌱 💼 🧿 for section heads, 🔥 🎁 for
the roast, 📖 🔒 📄 🛡️ 📈 on the page's cards) looked generic next to the line icons used elsewhere.
They are now one line-icon set, `LINE_ICONS` in `docs/copy.js`: 32 icons on a 24px grid with a round
1.8 stroke in `currentColor`, keyed by the emoji each replaces, so code that names an icon still names it
the same way (`Copy.lineIcon(glyph)`, or `Copy.iconHtml(glyph)`, which falls back to the emoji). Section
heads, the source rows, the offer's lists, the roast and the hero video's mute icon draw them, and the
page's static icons in `index.html` are swapped on load. The Psyche Card keeps its emoji labels, because
they are part of the shared image, and so do the card guide and the love languages, which mirror what
the card prints. Line icons are told apart by their drawing, so the UI suite's "no two sections share a
glyph" check compares their markup.

### One name: the Psyche Report

The paid report went by five names: *full report*, *premium report*, *full premium report*, *paid
report* and, sometimes, *Psyche Report*. Everything a reader sees now says **Psyche Report**: the app's
copy, the front page, the guides and policies, the PDF, the Stripe line on a bank statement (*PsycheAI –
Psyche Report*) and the server's error messages. *My Report* stays as the menu label for where it
lives, and the small *Premium* badge still marks the sections only it has. Code names (`premium*`,
`fullReport*`), comments and the model's prompts keep their old words, since no reader sees them.

### Most in sync with: the cast on every card

The card's last row used to be one box, *Receives care as* beside *Shows care as*. With a catalogue
character it is now two boxes: **Shows care as** (up to two), then **Most in sync with**, the three
characters the reader's character fits most easily with, each drawn in its own scene cropped to a
round tile (`Copy.characterArt(name, cls, true)`). Every card now shows four of the 29 characters
rather than one. A friend who sees their own character on someone's card has a reason to make theirs
and sync. Receiving stays in the report, the card guide and the PDF report. A card with no catalogue
character (a long link without its face, or a retired character) keeps the old receiving-and-giving
panel, since there is nobody to list.

The partners are one table, `CHARACTER_SYNCS` in `docs/copy.js`. The card, the PDF card and the
character pages (*Most in sync with …*) all read it, so they cannot disagree. It is balanced:
- every character is named exactly three times (29 × 3 = 87 picks, so three each is the only
  even share), so no character goes unseen;
- every woman is paired with at least one man and at least one woman, and every man with at
  least one woman and at least one man (Baymax, WALL-E, Remy, Pikachu and Totoro are neither, and
  exempt);
- the pairings go both ways, except one loop of three (Pikachu → Totoro → Shrek → Pikachu), because 87
  is odd, so the 29 characters cannot all pair off. (Since Totoro's retirement in October 2026 there are
  28, and every pairing goes both ways.)

`npm test` checks all of these. The card guide explains the box, and the UI suite checks that the
reader's own card, QR code included, still fits its 1080×1920 canvas.

### Pages for search, generated

A review for search found the site had five indexable pages, and the front page showed nothing
without JavaScript: the landing section was `hidden` until `app.js` ran. What changed:

- **The landing is in the HTML.** `#view-welcome` is no longer `hidden`, so crawlers and readers
  without JavaScript see the hero, the steps and the sample. A returning reader or a link that opens
  something else (`?c=`, `?gift=`, `#p=`, `#sample`) would see it flash, so `docs/early.js`, a
  one-line head script, marks `<html class="view-pending">` in those cases; `show()` clears it, and
  so does a four-second failsafe.
- **`pdf.js` loads when needed.** It was 160 KB fetched and parsed on every visit for a feature used after a
  report. It is now a `<link rel="prefetch">`, loaded by `loadPdf()` in `app.js` when the browser is
  idle, and awaited by every PDF button, so a button pressed early still works.
- **54 new pages, all generated by `tools/seo-pages.mjs`** from the data in `tools/seo/`. Run
  `node tools/seo-pages.mjs` after editing it, or the guides' footer; `npm test` fails while a page is
  stale (`--check`).
  - A page for each of the 29 characters (`/<name>-personality`) and the 16 MBTI types
    (`/intj-personality`), with hubs at `/characters` and `/mbti-types`. Each character page shows the
    card's own art, the types it tends to match and the traits behind it; every line is neutral or
    kind, as the card's are. Type titles are ours, not another test's.
  - Five topic pages: love languages, the Big Five, what Instagram knows about you, download fixes,
    and best-friend compatibility. Their claims are the app's own behaviour.
  - `/faq` is the app's FAQ, lifted from `#view-about` at generation, so the two cannot drift, with
    FAQPage structured data. `/sample-report` is the sample report from `sample.json` as plain HTML.
  - Every page has a breadcrumb, Open Graph tags and BreadcrumbList data, and fits a search result
    (title of 60 characters or fewer).
- **The four guides** gained the sample card image, a longer section each linking into the new pages,
  FAQPage and breadcrumb data built from their own FAQ, and the shared footer. The policies gained
  Open Graph tags.
- **`llms.txt`** describes the site for AI search tools, with the pages worth reading.
- **The front page links to none of it.** The new pages link to each other and to the app from the
  guides' footer; the front page stays as it was. `npm test` checks that.

Submitting the sitemap to Google Search Console and Bing Webmaster Tools is done by hand, once.

**Two phrases to rank for** (20 October 2026): "psyche personality test" and "AI coach". Neither was in
a title or heading. The front page's title is now "PsycheAI – Psyche personality test and AI coach"
(its description leads with the same phrase), and its WebApplication data gains `alternateName`
("Psyche AI", "Psyche personality test") and Ask PsycheAI in its description. Two topic pages:
`/psyche-personality-test` (what the test measures, linking the MBTI, Big Five, love language and
character pages) and `/ai-personality-coach` (Ask PsycheAI: what it knows, questions to ask, an
example from the sample's *Bursts, then recovery* pattern, and its price). "AI coach" alone belongs to
funded apps; the page goes for the longer "AI personality coach" and "AI coach that knows you". Both
are linked from the guides' footer on the front page and every generated page. 63 pages in the sitemap. The description became *The Psyche AI personality test reads your Instagram, no quiz: MBTI, attachment style, career strengths, blind spots, and an AI coach that already knows you* (23 October), dropping "a free Psyche Card", which read as a sales line in the search result.

**Dates, an author and Markdown copies** (23 October 2026). Search engines and AI answer engines
weigh freshness and a named author, and AI crawlers read Markdown more cheaply than HTML.
- **Dates.** `tools/seo/dates.json` records when each page was published and last changed, with a
  hash of the page with its dates and the shared footer left out. `node tools/seo-pages.mjs` moves a
  page's "Updated" date to today only when that hash moves, so regenerating unchanged pages never makes
  them look fresh, and a link added to the footer does not re-date every page (25 October 2026).
  First dates came from the day each file reached git. `SEO_TODAY=` pins today.
- **Author.** Every guide and generated page (36: not the front page or the policies) carries a
  visible byline, *By Jared, founder of PsycheAI · Updated …*, linking to his LinkedIn, and Article
  data with `datePublished`, `dateModified`, the author and PsycheAI as publisher. The four
  hand-written guides get the same, injected by the generator.
- **The sitemap** gives each dated page its `<lastmod>`.
- **Markdown copies.** Each dated page has `/<slug>.md`: front matter (title, description,
  canonical, author, dates), then the page's words without nav, buttons or footer. The page links it
  as `rel="alternate" type="text/markdown"`. The server sends a `.md` with
  `Link: <https://psycheai.io/<slug>>; rel="canonical"` so it is never indexed as a second copy, and
  sends the copy in place of the page to a reader whose `Accept` ranks `text/markdown` above HTML
  (`Vary: Accept`). `llms.txt` now points at the copies.
- **IndexNow.** Bing and the other IndexNow engines (which also feed ChatGPT search and Copilot)
  are told which pages changed by the live server itself (`lib/indexnow.js`): 90 seconds after a
  deploy starts listening, once Render has moved traffic to it, it compares `sitemap.xml` with the
  one it last sent (each address's `<lastmod>`, kept in the store as `indexnow:sent`) and sends only
  the new or re-dated addresses; nothing changed, nothing sent, so a restart costs nothing. A refused
  ping is not remembered, so the next deploy tries again. On Render only (`RENDER=true`), never in
  mock mode; `PSYCHEAI_INDEXNOW=0` turns it off; the log says what was sent. `npm run indexnow`
  (`-- /faq` for named pages) sends by hand. The key is served at
  `/ffd11799b5d07d5cf6542ebb723deaff.txt`; it is not a secret.

**Draft pages** (23 October 2026). A topic with `draft: true` is written as a page but with
`noindex, nofollow`, no dates or byline, no Markdown copy, and left out of the sitemap and llms.txt,
so it can be read at its address before it is meant to be found. Six are drafted for review: three
honest lists (`/best-free-personality-tests`, `/best-ai-life-coach-apps`,
`/best-friendship-compatibility-tests`, each naming PsycheAI as "ours" and saying what each other
option is best for) and three questions people actually ask (`/am-i-in-the-wrong-job`,
`/what-will-i-regret-when-im-old`, citing Bronnie Ware's five regrets, and
`/why-do-we-fight-over-small-things`, citing Gottman's finding that 69% of a couple's conflicts are
perpetual). Each opens with a one-sentence answer for AI summaries. All six were published on
24 October 2026 (their flag deleted, dated that day); the next deploy sends them to IndexNow on its
own. 46 addresses in the sitemap.

**Two chat analyzers and the ChatGPT comparison** (25 October 2026), from the competitive review:
the searches thin "Instagram analyzer" tools hold, and the viral "ChatGPT, tell me about myself"
prompt.
- `/instagram-chat-analyzer`: what the digest reads in DMs (how many people, how much of each
  conversation is the reader, message length, a sample of their words) and the privacy difference.
- `/whatsapp-chat-analysis`: who starts, reply times, hours, question share, why hand-picked chats
  are not read as sociability, and the export steps. Since the chats-alone path, it says three
  chats are enough.
- `/chatgpt-tell-me-about-myself`: what ChatGPT answers from (memory, past chats, files, connected
  apps), the front page's regret question with both answers, and the FAQ's upload facts.

All three say exactly what goes: the reader's own messages, some with a short, de-identified line of
what they answered (`messageContextShare`), never "only your messages". The shared footer links them,
and `/best-ai-life-coach-apps` links the ChatGPT page. 49 addresses in the sitemap.

**Three pages for unclaimed searches** (26 October 2026), each linking `/sample-report`:
- `/mbti-test-from-instagram-chats`: what chats show about each letter, the steps (WhatsApp for
  those who can't wait), and why "MBTI-style" (the trademark, and a read from behaviour).
- `/personality-report-from-google-takeout`: what My Activity adds (searches, YouTube), how to
  export only it, and plainly that Google alone is not enough: it adds to Instagram or 2–3 chats.
- `/personality-read-from-your-exports`: our own honest version of the "tools compared" guides that
  leave PsycheAI out. TypeMyVibe, MosaicChats and general chatbots, each with what it is best for
  and where the file goes, PsycheAI as "ours", and a limits section (an inference, only what was
  exported, chosen chats are a biased sample, old data, other people in the data, not therapy).
52 addresses in the sitemap.

**No therapy claims** (25 October 2026). Illinois and Nevada ban AI therapy, Utah requires
disclosure, and five more states restricted it in 2026. PsycheAI is coaching and insight, and its
words have to say so everywhere. A selftest scans every page, Markdown copy, `llms.txt`, `copy.js`,
the Instagram captions, the topic sources and the reel scripts for affirmative clinical phrases
("AI therapist", "therapy app", "mental health app", "clinically proven", "treats your…", "diagnoses
you…"). Disclaimers ("not a diagnosis", "Is it therapy? No.") are untouched. The same audit:
- renamed the report's paid section title *Mental wellness* to **Wellbeing**, the structured layout's
  name for it;
- corrected the review sheet's chat note, which said *Only your messages are sent*, to *Your messages
  are sent, some with a short line of what they answered*;
- added the same detail to the FAQ's "Why not just upload my data to ChatGPT?";
- replaced "Google Gemini or Anthropic Claude" on three guides and in `llms.txt` with Google Vertex
  AI, as the privacy policy says.

## Kept across deploys (Upstash)

`lib/store.js` talks to Upstash Redis over its REST API (`UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`) — one pipeline request per call, a 2.5-second timeout, and an in-memory
imitation of the same commands when the variables are unset, so local runs and the test suite need
nothing. Everything that used to reset on a deploy is now written through to it and read back at
boot (`hydrateFromStore()` in `server.js`, at most six seconds before the port opens):

| What | Key | Before |
|---|---|---|
| Daily totals (`lib/stats.js`) | `psy:stats:YYYY-MM-DD` (hash) | memory, lost on deploy |
| Creator-code uses (`lib/promo.js`) | `psy:promo:CODE` (set of report hashes) | memory — a capped code got a fresh allowance every deploy |
| Today's free budget (`lib/budget.js`) | `psy:budget:YYYY-MM-DD` (3-day expiry) | a file on the container's disk |
| Payment retries (`lib/premiumLedger.js`) | `psy:ledger` (hash) | a file on the container's disk |
| Rate limits (`takeShared` in `lib/ratelimit.js`) | `psy:rl:<limit>:<code>:<window>` (expires with the window) | per process only |
| One free card per account (`lib/referral.js`) | `psy:free:accounts` (set) | — |
| Invite-friends counts (`lib/referral.js`) | `psy:ref:<code>:*`, `psy:grant:<token>` | — |

The in-process checks stay synchronous and answer from memory; the store is the copy that survives,
written fire-and-forget. A store that cannot be reached is logged once and the server carries on as
it did before (rate limits allow, the free-card check allows). Identifiers are never stored as they
are: an address (rate limits) or the browser's account code is scrambled with `PSYCHEAI_HASH_SECRET`
(HMAC-SHA-256) first.

## One free card per Instagram account

The browser sends `account`: SHA-256 of `psycheai:` + the Instagram username it read from the
export (`accountKey()` in `docs/app.js`, kept as `psycheai_account`). *Since October 2026 it is
`psycheai:v2:` + the username + the time of the earliest own message or post, and a free read with
no account is refused; see "Security and display fixes (October 2026)".* The server scrambles that once
more and keeps it in one set; a second free card for an account already in it is refused with
`402 { freeUsed: true }`, and the page opens the US$2 re-run sheet with *"This Instagram account has
already had its free Psyche Card. Run it again for US$2."* The check runs after the result cache, so
the exact same summary again is answered free (it is the card already made), and before anything is
spent. Paid runs, promo codes and requests without a username are not limited by it; the daily
budget still bounds them. `PSYCHEAI_FREE_PER_ACCOUNT=0` turns it off.

**Past the free card, never a card alone (late October 2026).** The US$2 card re-run is gone. A
reader past their free card (refused with `freeUsed` on a new device or after Delete everything, or
on a browser whose free run is spent) is offered only the card and its Psyche Report together, the
US$5 unlock: *"This Instagram account has already had its free Psyche Card. A new Psyche Card now
comes with your full Psyche Report: US$5 for both."* `authoriseAnalysis` opens the sheet as
`bundle` (the unlock's price and ledger, over the digest the upload just reviewed: nothing
collected, no receipt resumed) and marks the auth `bundle: true`. `runAnalysis` then sends it as
`product: 'unlock'` with no anchor, so the server writes the card first and the report anchored to
it (`cardThenFull`, or one call with `PSYCHEAI_MERGED_UNLOCK`), and `adoptBundle` takes the card as a
fresh card would be taken and lays the report under it. A resumed job or a pending purchase
carries the `bundle` mark, so a closed tab gets both back. The classic layout's re-run button bundles
the same way. The bundle gives both free Ask PsycheAI questions (card and report). The server
enforces it too: `create-payment-intent` refuses `product: 'analysis'`, and a promo code on a card
run without the report is refused (`CARD_ALONE_REFUSAL`). An `analysis` payment made before this
deployed is still honoured. Why: a reader who comes back has already seen what the card says, and is
paying for what is new, which is mostly the report. Two prices (US$2, then US$5 to unlock) split one
decision in two.

## Invite three friends, get the full report free

Each browser makes a random secret (`psycheai_referral`); its public code is the first 12 hex
characters of the secret's SHA-256 and goes in the reader's invite link, `psycheai.io/?ref=<code>`.
A friend arriving on it keeps the code for 60 days (`psycheai_referred_by`). When the friend's
**first** free card is written, their account is added to that code's friends — once per friend
account, for one referrer only, and never the referrer's own account (tied to the code when the
referrer makes their own card). **Every two friends earn one free full premium report.**

A free report shows an **Invite 3 friends** card under the unlock offer. It has three dots, *Copy
invite link* and *Share*, and once a report is earned, *1 free full report ready* and *Claim your free
full report*, which opens the unlock. A full report has no such card, since the reader already has
what it offers. The payment sheet then offers *Use your free full report — from
inviting friends*: `POST /api/referral/claim` with the secret spends one and returns a grant, which
the full-report request carries as `referralGrant` instead of a payment. A grant unlocks one report
(retries of that same report are fine) and lasts 60 days. `POST /api/referral` with the secret
returns `{ friends, earned, claimed, available }`; the code alone proves nothing.

## One short personal link: `psycheai.io/c/<id>#<key>`

The compatibility link (about 760 characters) and the invite link were two things to share, and the
first was too long to paste comfortably. They are now one link of about 45 characters that does
both: a friend who opens it is offered a compatibility reading against the reader's card, and the
reader's invite code comes with it.

**The server holds the card but cannot read it.** After the card is drawn (`publishShortLink` in
`docs/app.js`), the browser makes a 12-byte random key, locks the packed card with AES-GCM under its
SHA-256, and sends only the locked bytes to `POST /api/link/save` with the reader's invite secret.
`lib/links.js` keeps `link:<id>` = `{ blob, ref, at }` for a year, renewed on each open. The key
goes in the link after the `#`, which a browser never sends to a server — so what PsycheAI stores is
opaque to it, and the FAQ says so.

**The id is the reader's own:** the first 10 base64url characters of
SHA-256(`psycheai-link:` + secret). Only the browser holding the secret can write it, and the same
reader always has the same link: a redrawn card replaces what it shows, so a link already in a bio
stays current (the key is kept in `psycheai_link`).

`/c/<id>` redirects to `/?c=<id>` (the fragment survives a redirect). The page fetches
`GET /api/link?id=` — `{ blob, ref }`, counted as `link_opened` — keeps `ref` as the invite, unlocks
the card with the key and goes on exactly as the long link did, then strips the key from the address
bar. A missing or wrong key, or an unknown id, says the link could not be opened and to ask for it again.

**A friend sees the card itself.** Opening a friend's link before having a card of your own shows,
at the top of the welcome page, *"⭐ This is Jared's Psyche Card"* (by first name only, on the card
too) over their card: tilted, and a tap away from full screen (the sample cards' dialog, with its
part-by-part guide). Under it, joined to it by a short dashed line, comes a panel: *"PsycheAI reads
your personality from your own Instagram data. No questionnaire, no sign-up. Get your free Psyche
Card, and see how compatible you are with Jared."* Then *Get my free Psyche Card*, which scrolls to *Request your Instagram data first*. On a laptop the
panel sits to the right of the card. The dashed *You + Jared = ?% in sync* box that used to sit
in the panel is gone. The card is drawn by the same `psycheCardHtml` as everyone's own, from
`reportFromCard(card, face)`. The **face** holds what the compatibility read never needs: the character,
franchise and icon, the two lines on why, each type letter's strength and the patterns' full names.
It also carries every list exactly as the owner's card shows it: motivators (`m`), values & beliefs
(`v`), interests (`n`), and how they receive and show care (`lr`, `lg`). That way a friend's view has
no gaps where the payload is shorter, and nothing is missing when a paid re-run wrote a card without
motivators. A card stored with those gaps is mended before its link is published
(`mendCardPayload`), so a link already shared shows them on its next open. The payload now carries
two *Shows care as* entries, not one. The face is not in the card payload, so the long link is
unchanged. `cardFace` puts it inside the locked
short link instead (`{ p: payload, f: face }`, falling back to the bare payload past 4 KB), so a
friend sees the card exactly as its owner posts it. A long link has no face, so its card is drawn
without the character. The share message now leads
with the card: *"Here's my Psyche Card ✨ Who are you most like?…"*.

**One link for everything.** A reader's bio link, invite link and compatibility link are the same
one link (`myLinkUrl`). Every share uses it, in the one share message: *Share Card*, *Copy link*,
the roast image and the sync result. Without short links it is the long form, `/?ref=<code>#p=…`,
which carries the invite code too.

**The QR code on the reader's card.** The foot of the reader's own card, on the page, full screen and
in the downloaded or shared image, carries a QR code of that same short link. Beside it are *Scan to see
how compatible we are* and the site line. Any copy of the card, such as a story post or a
screenshot, therefore leads back to the link. Scanning it opens exactly what tapping the link does
and counts as their invite. `fillCardQr` draws it as SVG squares from `vendor/qrcode.js`
(node-qrcode, MIT; only `QRCode.create`) once `publishShortLink` has the link, then fits the card
again. It appears only with a short link: a long one is far too dense to scan, so without short links
the card goes without a code. Sample cards and a friend's card have no slot for one. The exported
1080×1920 image decodes at full, half and a third of its size.

Short links are on when Upstash is configured (`/api/status` → `shortLinks`), or with
`PSYCHEAI_SHORT_LINKS=1`; otherwise — or if saving fails — the long link is what gets copied, and long
links keep opening.

## More than one friend's link

Each friend's link is kept for 14 days, however many arrive. The latest is `psycheai_invite`, and
the welcome page shows its card, with a line naming anyone else waiting ("Mei also sent you their
card"). The ones before it are in `psycheai_invites_more`, newest first, five at most, one per
friend.

At the top of My Psyche, above the card, one bar holds them all, with the number waiting in its ring.
Its ✕ closes it until a friend's link arrives that was not waiting then (`psycheai_sync_bar_closed`);
those friends still wait on My Syncs.
- **One friend:** *You have a friend waiting to sync with you*.
- **More:** *You have friends waiting to sync with you*.

The bar is the title alone; the line naming who sent a link is gone.

The bar has one button, **Sync**, which goes to My Syncs. No sync runs on My Psyche, and My Report
never shows the bar.

My Syncs is titled **Your Psyche Syncs**, and one card, **Sync list**, lists them all:
- **People waiting** come first, latest first, as dashed rows ("Waiting to sync with you · free, only
  you see it"). Each has one filled button, **Sync?**, with a soft glow.
- **Past syncs** read "Synced · <date>" (the *Friends* label is gone) and have one outlined button,
  **Results**. Two words and two looks make it plain which rows still wait on the reader and which are
  done. Both used to read **Sync**, so a waiting row and a finished one looked the same.
- **Each name is a link to that person's Psyche Card**, full screen. For someone waiting, the card is
  decoded from the card their link carries, so the reader can see who they are syncing with before
  choosing to. The separate **Card** button is gone.
- **Each circle shows their character's emblem**, the one at the head of the report (`emblemSvg`),
  read from the card face their link carried (`face.c`). It falls back to their initial when there is
  no character, which happens with a plain `#p=` link (no face) or a character that has no emblem.
- **Past syncs** follow. Tapping one opens its result in a popout (`#sync-dialog`) over My Syncs,
  not a page of its own.

A sync from a waiting row opens in the same popout. Behind it, that friend has already moved from the
waiting rows to the past syncs. The popout closes with its ✕, **Close**, Esc, a click outside it, or
Back.

**One row per friend in the list.** A double tap on **Sync** used to start two syncs before the
working screen appeared. Both finished, the second got the server's cached answer, and the list showed
the same friend twice with the same score. Now:
- One sync runs at a time (`syncInFlight`), and the waiting row's button greys out while it runs.
- A result for a card already in the list replaces that row and moves it to the top.
- A link pasted into *Sync with others* that has already been synced says so instead of running again.
- Lists already saved with duplicates are tidied when the page opens (`dedupeHistory`). The newest row
  for each card is kept. Rows from before cards were fingerprinted are only merged when the name and
  the whole result match.

**A link already synced is not taken again.** Each past sync stores a fingerprint of the friend's
card (`with`, from `syncCardKey`: a hash of the card's shape). Opening a friend's link checks it
(`alreadySynced`). A card synced before is not added to the waiting rows: the reader lands on My
Syncs (titled **Your Psyche Syncs**, the same size as My Report's title) with a note, *You have already synced with Jared — it is in your list
below.* Syncs saved before the fingerprint existed are matched by the friend's name. A different
friend's link, or the same friend with a new card, still waits as usual.

**A reader's own link is never a friend waiting.** Opening it (from their bio or a story) or pasting
it on Syncs used to offer a sync with themselves. It is now known (`isOwnLink`) by the link id this
device published (`psycheai_link`), by its referral code being this device's, or by the card matching
the reader's own, and they land on their own card (or stay on Syncs) with a note: *This is your own
link. Send it to friends: they see your Psyche Card, make theirs and sync with you.* An own link saved
as waiting before this was caught is filtered out of the waiting rows (`ownInvite`). On another
device with no card of theirs it cannot be told from a friend's link.

Below the list is one box with two halves, divided by a hairline:
- **My link** (left): **Copy link**, then *What your link contains*: the fields as chips (first name,
  character, tagline, MBTI, Big Five and so on), not the reader's own values.
- **Sync with others** (right): paste a link, then **Sync**.

Both buttons are the lighter shade (`.btn-soft`): a pale purple tint with purple text, not the filled
gradient. The header's line reads *Open a friend's PsycheAI link for your Psyche Sync score: what
clicks between you, what may grate, and how to relate better to each other.*

In the result,
the sections are *How to relate to each other* and *What to look out for*.

Each sync spends only its own friend's link, and only once it lands. A sync with a link that carried
a referral code also sends `/api/event` `sync_done` with that code, counted in `ref:<code>:syncs`. The free card credits the most
recent link the reader arrived on.

## Your Referral: its numbers, credits, and gifts

My Psyche ends with a **Your Referral** card (titled *Your link* until October 2026), below Evidence
and method, free or paid. It opens with what the link earns: *Every 3 connections who make their
Psyche Card from your link earn you 1 credit. Use credits to gift a Psyche Report, with more premium
features coming soon.* (Before the October 2026 change below it was 2 cards, or 1 friend's paid
report, for a free Psyche Report of the reader's own.) Then it says *Share your card or link to start*. A small **Copy link**
sits right beside the title (`.referral-copy`, since October 2026; at first at the card's far right). It does exactly what the
card's own **Copy link** does (`copyShareMessage`): the one share message with the short link, and
*Copied ✓* on the button for two seconds. It runs before the click handler awaits anything, so the
copy still counts as the tap's own in Safari. It used to have no buttons of its own, but a reader
looking at the counts is the one most ready to share, and the card's tools were a scroll away.

Four purple boxes give the counts, opens first (leftmost) so a reader sees the link working before
anyone has made a card:
- **opened your link**
- **made a card**
- **synced with you**
- **credits** (left to spend)

Where each number comes from:
- *opened your link*: each browser's first open of someone's link that day (never the owner's own), sent with `/api/event`
  `referral_open` and the link's code, then `ref:<code>:opens`.
- *made a card*: friends' first free cards, `ref:<code>:friends`.
- *credits*: drawn apart from the three counts, in gold with a border (`.referral-stat-credits`),
  because it is what the counts earn rather than another count. `floor(friends / 3) − spent` (`CARDS_PER_CREDIT`; spent is `ref:<code>:spent`).
- *synced with you*: friends' syncs with the card from the reader's link, at most one a day per
  browser, sent with `/api/event` `sync_done`, then `ref:<code>:syncs`.

### UI suite: waits on conditions, not the clock (October 2026)

`tools/uitest.mjs` had 173 fixed `waitForTimeout` sleeps (about 65 s of them in all, once the deploy branch's
new link-open check was merged in). Each one guessed how long something takes: too long on a fast machine,
and on a slow one too short to catch what it was waiting for. 171 of them now wait on the thing itself,
with helpers at the top of the file that throw when it never comes:

- `frames` (two `requestAnimationFrame`s, for layout after a resize, a class flip or an instant scroll),
  `settle` (those frames plus every finite CSS transition and animation in a scope finished, through
  `getAnimations()`, with infinite pulses left out) and `scrollSettled` (the window or an element still for a
  quiet spell, which covers smooth scrolls and the app's own follow-up scrolls, such as the report bar's
  second scroll at 350 ms and the cast strip's 180 ms rest timer);
- `booted` (`/api/status` answered, so the mock-mode line is drawn, and `document.fonts.ready`),
  `bootedQuiet` (the private-window note's storage estimate answered as well), `dialogClosed`, `runLanded`
  (a re-run's job collected and the profile drawn again), `backLanded` (app.js's 400 ms step after a Back
  that puts away the Ask panel, ending with scroll restoration back on) and `syncsCollected` (the Syncs
  inbox read and, when anything was in it, cleared);
- and, where a check is about one visible outcome (an alert's words, a "Copied" label, the hub's tick),
  a `waitForFunction` on that outcome that gives up quietly, so the check itself reports the failure.

Two are kept, each with a comment. Both are negative checks with nothing to wait for: a double tap must
not start a second Psyche Sync, and "Sync without sharing" must not send anything to the link's owner.
Neither a second sync nor a send fires an event when it does not happen.

The timings also turned up two older tolerant waits that always timed out: `chooseDepth` waited 30 s for a
supplement offer the caller had already answered (twice per run), and a wait for "already synced" missed
the capital A of the copy. They now wait for the offer or the review after it, and match either case.

Going faster exposed one race the old sleeps had hidden. Closing the guide or the sample calls the app's
own `history.back()` (`popOwnEntry`), which lands a moment later, and the suite's next Back could get there
first and leave My Psyche. `afterOwnBack` now waits for that popstate before going on.

The suite went from 498 s to 383–398 s (three runs in a row on the final code: 398, 383 and 387 s), with all 1,586 checks still passing.

### The classic layout retired (18 Oct 2026)

The structured report had been the default for weeks, with the classic one kept as a no-deploy way back
(`PSYCHEAI_REPORT_LAYOUT=classic`). By now it was a worse product to fall back to — the hub, the trimmed
report and the MBTI changes were structured-only — and it cost twice: every report change had to decide
what classic did, and the UI suite ran most of its checks on a classic server, so a structured-only
change could pass without the live layout being exercised. Gone:

- **The switch.** `REPORT_LAYOUT`/`REPORT_LAYOUTS` in `lib/prompts.js`, `reportLayout` in `/api/status`
  (the pinned key set is now `build, firstRun, freeAnalyses, mock, ready, shortLinks`), the page's
  `reportLayout()` and its `?layout=` override, and the env-var row. `FREE_*`, `FULL_*` and the pinned
  schemas are the structured ones outright; an unlock with no card always goes through
  `mergedOrTwoCalls`; `PSYCHEAI_FIRST_RUN` no longer checks the layout. An old
  `PSYCHEAI_REPORT_LAYOUT` left set on Render is ignored.
- **The classic page.** The classic card, report sections, axes, interest and value tiles, digital
  footprint and confidence card in `docs/app.js` (`psycheCardHtml` is the story card only; `fitCard` always
  fits the portrait canvas), the narrow-card constants, and the classic unlock list.
- **The classic PDF.** `build` in `docs/pdf.js` is `buildStructured` and nothing else (the card-only
  build went with the dead-code pass below). The PDF card is the story card's layout always.
- **Kept as the base.** The classic prompt and schemas are still what the report is spliced from, renamed
  so the name says so: `CARD_BASE_SYSTEM`/`CARD_BASE_SCHEMA` (were `CLASSIC_FREE_*`), `FULL_SYSTEM_BASE`
  (was also exported as `CLASSIC_FULL_SYSTEM`), and `BASE_FULL_SCHEMA` (was `CLASSIC_FULL_SCHEMA`), still
  the yardstick `tools/probe-schema.mjs` and a selftest measure the pinned schema against.
- **Tests.** The UI suite's main server runs the structured page (nothing else exists), and its
  classic-era checks were moved onto the structured markup rather than dropped wherever an equivalent
  exists: the report is read on My Report (`toReport`), the card, hub and Signal strength on My Psyche
  (`toHub`, `openMethod`); the report's disclosures are the seven part cards (all open on a laptop, an
  accordion on a phone); the card checks read the story card (`.pc-s*`); download, share, copy, backup
  and Delete everything are driven from the card's tools and the hub; the sources list is Signal
  strength's "Your data"; a link is pasted on My Syncs; a re-run of an explained profile is the paid
  card-and-report one, and on a free card Add / change data is the unlock. The main page's report is
  adopted with app.js's own `overlayCard` (lifted from its source), keeping the premium sections out so
  the unlock checks still unlock them — the state a profile saved before the one-call unlock is in. The
  suite passes at 1,586 checks. Checks deleted, because what they pinned no longer exists:
  - *Free card:* a free profile's PDF (no PDF download before the unlock).
  - *Disclosures:* "every section arrives shut", the confidence card untouched by the accordion, the
    laptop accordion, and the four scroll-anchoring checks with their vacuity guard (only parts open and
    shut now; on a phone an opened part is scrolled to the top, which is checked).
  - *Classic card:* centred box, inline preview capped at 470px, trait bullets, Big Five rows stretching,
    "no headline", and the five narrow-card (`pc-narrow`) checks: two-up love row, MBTI strengths column,
    letters two-by-two, type and Big Five in one row, long labels wrapping.
  - *Compatibility popout* (`#compat-dialog`; its only opener `#test-compat-open` is always hidden): the
    gradient on Test compatibility, opens, storage-model copy, no QR, titled Psyche Sync, says what the
    link is for, closes, scroll kept, "Got their link?" paste box, closes behind a pasted link. Share and
    copy moved to the hub; pasting to My Syncs.
  - *Report sections that are gone:* MBTI nickname; digital footprint and its four facets (post, active,
    changed, take in), footprint after At work, the three behaviour-grid checks; confidence as the last
    section and above the buttons; interest/value trajectory chips (six checks) and tiles; the two career
    sections being different (they are one How you work); career action horizons (on the plan now);
    attachment as its own card, its Read from / In practice / points / caveat (it is inside In
    relationships, with evidence chips); the housekeeping-actions list (pinned by the structured
    Back|Report|Add data check); the Instagram-and-Google hint (Signal strength gives no advice).
  - *Paid sections:* the consolidated block's position, badge, badge wrapping, two-by-two and one-column
    layout, single price; the roast's Bonus badge (three checks); the four unlocked cards' Premium badges
    and their wrapping; the wellness caveat disclaiming a diagnosis (the sub-line and GP note are checked).
  - *Main PDF:* the Values, Beliefs, Strengths, Weaknesses, What could hold you back, Read from and What it
    means in practice headings; the three franchise-placement checks (always its own line now); accent
    name and no wedge on the cover, and "no headline" (the cover is the story card); first-match section
    order (pinned by `structured PDF: the page's sections in the page's order`).
  Rewritten checks that now assert something different are noted beside them in `tools/uitest.mjs`; the
  notable ones: the glyph-uniqueness check lets the development plan share Wellbeing's 🌱 (an owner's call
  which changes), and "one text size" measures only what is printed.
- **Dead code left behind, removed (19 Oct 2026).** What only the classic page reached, or nothing did:
  - `docs/app.js`: `sourcesUsedHtml()` and `sourceRowsHtml()` (the confidence card's sources table) with the
    `#rerun-with-data` button, its price note and its delegated listener; `paidSectionsLockedHtml()` (the
    four-section consolidated block) and `revealPaid()`, which spliced cards in over it and had no caller;
    the `#compat-dialog` handlers (open, close, backdrop, the "Got their link?" paste box) and its
    `#share-link`/`#copy-link` buttons; the `cardOnly` flag passed to the PDF. Live paths that passed
    `$('#rerun-with-data')` now pass what they always got on this page: the bundled payment and the paid
    re-run open the payment sheet with no button (`null`), and the gift banner's and the guess game's
    "use it" click the report's own `.premium-unlock` with no fallback.
  - `docs/index.html`: `#compat-dialog` and `#test-compat-open`.
  - `docs/pdf.js`: the card-only `build` path with `cover()`, `psycheCard()`, `cardColumn()`,
    `coverContents()`, its `PAID_SECTIONS` table, `matchTable`, and the `facet`, `points` and `muted`
    helpers only they used; the classic roast (the structured one is `renderRoast` now). About 610 lines.
  - `docs/styles.css`: the compat popout, its paste box and close button, the sources table
    (`.trust-sources`, `.source-list`, `.source-row`…), and the consolidated block's list, icon and text.
  - `docs/copy.js`: strings only those used (`sourcesUsed`, `sourcesUsedHint`, `STRUCTURED.sourcesHint`,
    `rerunAnalysis`, `sourceLoaded`/`sourceMissing`, `premiumTierTitle`/`Blurb`, `matchWith`/`Basis`/`When`,
    `trustSub`).
  - Tests: the popout's "takes no space" check now asserts the popout, its opener and paste box are not in
    the DOM; its print check was deleted, and so was the sample guard's "compatibility-link panel" row (that
    `.link-panel` was the popout's; the guard keeps its download and delete rows); the hub tools check asserts `#test-compat-open` is absent.

### Security and display fixes (October 2026)

A review found a batch of holes, mostly ways to get paid work for free, and a handful of display bugs.
Each is pinned by a check in `tools/selftest.mjs` (the block "security and display fixes").

**Server**

- **S1. One payment bought every product.** `verifyPaid` checked status, age and amount, but the
  Psyche Report and five Ask PsycheAI questions are both US$5, so one `ask` PaymentIntent was accepted
  by `/api/analyse` (`product: 'unlock'`), by `/api/premium-analysis` for another digest, and by
  `/api/ask/buy`. `createPaymentIntent` now writes `metadata.product` (the server's choice, beside any
  promo fields), and `verifyPaid` requires it to match. An intent with no product, made before this
  deployed, is honoured as `unlock` only (the one thing sold at that price before); the 30-day
  redemption window retires them. Mock intents carry the same metadata. `/api/premium-analysis` no
  longer spends a payment at all: the page has bought the report through `/api/analyse` for a long
  time, and that route's separate ledger kind and binding let one payment buy a report and then the
  premium sections of another digest. It answers `410` and asks an old page to reload; promo codes
  still work there.
- **S2. The free first report needs a friend's card, not an open.** On the card-first path the free
  report unlocked on `opens >= 1`, and `/api/event` `referral_open` is unauthenticated, so a script
  looping fake opens and fresh secrets got unlimited reports outside the daily budget. With no user
  accounts (the owner's decision), it now needs one friend to make their card from the link
  (`friends >= 1`, `status().first`). Opens stay a statistic. A card made by the link's own owner
  never counts (`afterFreeCard`: `from === mine`, and the owner's own account). Reports paid for by a
  grant (the free first one, a gift, a guess) are now metered by the daily free budget
  (`freeFunded` in `handleAnalyse`), refused when it is spent and recorded twice like a free first
  read, since nobody paid for them. Every string that said an open unlocks it now says a friend making
  their card does (`docs/copy.js` `unlockShare`, `referral.useFree`/`firstFailed`/`tips.reportLocked`;
  the FAQ in `docs/index.html` and `faq.html`; `terms.html`; the server's claim refusal).
- **S3. A code or a grant wrote more than one report.** Grants and creator-code reservations were held
  to `digestHash(body.digest)`, while the result cache and a payment's binding use the whole key
  (the digest as the model reads it, the `anchor`, and `deep` through it). Varying `anchor` or
  `deep` reran the paid engine on one use. `handleAnalyse` now computes the key first and holds
  `promoRefusal`, `promo.reserve`/`redeem`, `grantRefusal`, `reserveGrant`, `spendGrant` and a
  discount's redemption to it.
- **S4, S5. The account code was computable from a username.** `sha256('psycheai:' + handle)` could be
  worked out for anyone: `/api/referral` said whether a named person had used PsycheAI, and
  `/api/analyse` with `product: 'first'` and their code spent their free read. `accountKeys()` now
  hashes `psycheai:v2:` + the handle + `ownMark`: the time, in seconds, of the earliest message the
  reader sent (`signals.messages.sentTimestamps`), or with none the earliest own post, story or
  caption (`dm:` or `post:` says which). Only the export's owner has it, and it is the same in every
  new download. With no export in memory (after a reload, a restored backup) the stored
  `psycheai_account` is used, as before. **The trade-off:** a reader who deletes their earliest
  message (or post, with no messages) gets a new code, and so a second free read; one whose
  download covers a shorter date range may too. That is the price of a code nobody else can compute.
  **The transition:** until 18 November 2026 (`LEGACY_ACCOUNT_UNTIL`, in `lib/referral.js` and
  `docs/app.js`) the page also sends the old code as `legacyAccount`. An account counts as used
  (free card, first report, guess) when either code is in a set, but only the new one is ever
  written, and `/api/referral` reports `first.used` for the new code only. During those 30 days the
  old code can still be used to ask `/api/analyse` whether a named person had a free card; after
  them it is ignored. The privacy page now says the code is made from the username and that time.
- **Free reads with no account.** The one-free-per-account check was skipped when no account was sent,
  so leaving it out made every free read the first. A free read (the merged first read, or a free
  card) with no account is now refused, `402 { noAccount: true }`, and the page says so in its own
  words (`freeNoAccount`). An export with a username, or any dated message or post, always has one.
  No per-IP daily cap was added (deferred by the owner). `PSYCHEAI_FREE_PER_ACCOUNT=0` still turns
  both checks off for a test server.
- **S6. Every POST buffered 24 MB.** Bodies are now held per route (`bodyLimitFor`): 64 KB for the
  small routes (events, referral, links, syncs, payments, Ask credits and buying, and the Psyche Sync,
  whose two shaped cards are under 4 KB each), and 2 MB for the three that carry a digest and a report
  (`/api/analyse`, `/api/premium-analysis`, `/api/ask`): at most 179,000 characters of evidence plus
  a report of up to 150,000, about 1 MB even in three-byte UTF-8, a few hundred KB in practice. A body
  over its limit is refused from its `Content-Length` before any of it is read, and stopped as it
  passes the limit when there is none.
- **S7. A free first read could skip being counted.** One sent with an `anchor` never marked its
  account (`afterFreeCard` ran only without one), and `deep` was honoured on the free path. A free
  read now ignores both, and a free first read always marks its account.
- **S8. Provider errors reached the reader word for word,** naming the model, the API key, the service
  account or the setting to change. `publicError` in `server.js` passes the server's own refusals (a
  4xx it raised) as they are, logs everything else, and tells the reader one of four plain things:
  busy (429/503), declined by the AI's filter (422), incomplete, or that something went wrong. A
  missing engine says only that analyses are unavailable; the set-up goes to the log. Stripe's
  set-up failures (401, 403, 5xx) are logged and said as "The payment could not be started"; a
  card decline is still Stripe's own words.
- **S9. `/api/stats` took `?token=`** (which ends up in proxy logs and history) and had no rate limit.
  The token is read from `Authorization: Bearer` only, and the route has a bucket of its own
  (`stats`, 30 an hour).
- **S10. Is Render's proxy chain what `PSYCHEAI_TRUST_PROXY` assumes?** The first proxied request
  logs, once per process, how many `X-Forwarded-For` entries it carried and how many hops the server
  steps back. No address is logged.

**Browser**

- **B1. A spoofed Psyche Sync.** `verifiedSender` only checks that the sender's link opens to the same
  card, and a card is public: anyone holding a reader's link could publish a link showing a friend's
  card and send a sync that showed as that friend's, replacing the real one. Syncing with someone new
  is exactly as easy as before. But history rows now keep the sender's link id (`linkId`: the short
  link a sync was run from, or the one a received sync came from), and a received sync that claims a
  card with a row here is that person only when it comes from that row's link. From any other link
  it is saved as a row of its own (`with: <card key>~<link id>`), beside theirs, and never replaces
  it.
- **B2. A link could be a decompression bomb.** A 270 KB `#p=` link inflated to 200 MB, and a stored
  invite was decoded again on every visit for 14 days. `decodeCard` refuses a payload over 4 KB
  (`MAX_PAYLOAD`) before inflating and stops inflating past 16 KB (`MAX_INFLATED`), a chunk at a
  time. An invite kept from before with a payload over the limit is dropped.
- **B3. The reader's name in the anchor.** The unlock sent the stored card and report as its `anchor`,
  and those have the reader's real name put back in (`withOwnName`), so a stray name in a summary or
  a pattern line reached the server and the model. `withPlaceholderName` swaps the card's name, its
  first word, the display name and the handle back to `PsycheUser`, as whole words, before sending.
- **B4. A ZIP entry could unpack without limit.** `inflateRaw` read the whole stream, Instagram
  entries had no size check, and the Google, Facebook and WhatsApp readers trusted the stated size.
  Output is now counted as it streams; an entry past its limit fails with a reason (`oversize`).
  150 MB by default (`MAX_ENTRY_BYTES`, the Google/Facebook per-file limit), WhatsApp chats 60 MB.
  A JSON entry that fails is skipped with a console warning, as an oversized one always was.

**Display**

- **F1. Dark mode on My Psyche.** Your Link, Your Data and Save your profile kept their light pastel
  backgrounds under the dark theme's near-white titles. They now take deep tints of the same peach,
  mint and sky in `prefers-color-scheme: dark`.
- **F2. A paid re-run landed on My Report.** The rule: every read that writes a card lands on My Psyche
  at the card; only an unlock of a card already held lands on My Report. A re-run from Add / change
  data (and an unlock that added data) redraws the card, so `runPremiumAnalysis` now goes to My
  Psyche when `dataChanged`.
- **F3. The PDF's title showed "Aleç™s psyche".** The Info dictionary's title was written in WinAnsi,
  but PDF reads those strings as PDFDocEncoding, where WinAnsi's curly apostrophe is "™".
  `pdfInfoString` writes plain ASCII as a literal string and anything else as UTF-16BE with its
  byte-order mark.
- **F4. The Psyche Sync popout cut off its header.** `.hero` pulls up by the page's padding, more than
  the popout's; inside the popout it now pulls by the popout's own padding, top and sides.
- **F5. "This is your own link" was said out of sight,** under the card, about 1,400px down. Same
  words, now scrolled into view where they are said.
- **F7. My Report's part list kept the wrong part lit** after a jump to the top, because the observer
  hears only a part crossing its band. On every scroll, above the first part, the first part is lit;
  when scrolling stops (`scrollend`), the part across the band is worked out again.
- **F8. The card image's file name dropped letters** ("Aleç" saved as `psycheai-card-ale.png`, a name
  in another script as `psycheai-card-.png`). It folds accents as the backup and PDF names do, and
  falls back to `psycheai-card.png` when nothing is left.

### The hub's sections in the site's colours (October 2026)

The hub's four sections were lilac, peach, mint and sky. They were easy to tell apart, but peach, mint and
sky appear nowhere else on the site, so the hub read as a different product. The owner compared a
one-tint, an alternating and two purple-to-pink versions, and chose "B2", the wider range:
- **The four colours:** violet for the tiles, orchid for Your Link, pink for Your Data and coral for Save
  Your Profile. They run top to bottom, as the hub's own border runs purple to coral.
- **Where they live:** variables on `.hub-card` (`--hub-violet`, `--hub-orchid`, `--hub-pink`,
  `--hub-coral`, each with a `-line` border colour). The tiles' dividers use the violet line.
- **Dark mode:** the same four at the dark page's depth.

### The card fills its corners; no line over it on a phone (October 2026)

- **Laptop corners:** the Psyche Card is drawn on a 1080-wide canvas and scaled into its box on the page. Its
  own 44px corner, once scaled, came out rounder than the box's 16px, so the box's white showed in each
  corner. On a laptop the card's own corner is now square on the page, and the box's rounding clips it, so
  the colour runs to the edge. The saved image keeps its rounded corners: the rule starts `#view-profile`,
  which `CARD_RULE` does not copy into the image.
- **Phone line:** on a phone the gradient line was drawn by the box around the card and its title
  (`.profile-top::before`), not by the card's own section. It is gone too.

### Keeping the Psyche, and no studios (26 Oct 2026)

- **The browser is asked to keep the data** (`keepStorage`, on every write of the profile and at start-up
  with one): `navigator.storage.persist()`, so a phone low on space does not clear it. Chrome and Safari
  answer quietly, in a tab or an installed app alike; Firefox would ask out loud, so it is not asked. It
  does not survive the reader clearing site data: only a backup does, which the FAQ now says as a callout
  (*Clearing website data or removing the app deletes your Psyche. Save a backup first.*; coloured, not
  bold, as the FAQ keeps bold for its questions) and the hub's Save Your Profile tip too (*If you ever
  clear this site's data, your backup file brings your profile back.*). No separate phone app: the owner
  decided against one.
- **No studio beside a character, anywhere.** The card and the report already left it out; the card
  guide's *Yours* line still read *Iron Man (Marvel)*. It is the name alone now, and the character rule
  in the prompts says never to name the studio, company or franchise in anything written (reserves +50).
- **Hub tips:** Ask PsycheAI's no longer explains *2/5* (its number says its own words) and mentions
  History only once its button is there; the credit rule's tooltip was drawn transparent, because the
  pill's styling reached every span in it, and is the black box now.

### Every part of the hub explains itself (26 Oct 2026)

A line under the hub's title says how: *Tap any name, number or icon to see what it means* on a phone,
*Hover over…* with a mouse. Every part that is not a button now opens words of its own on a tap, hover
or focus:
- the tiles' numbers (`.hub-numtip`, `fillNumTip`), worded from the number as it stands, since the
  server fills the counts in later: *You have synced with 10 people.*, *1 question asked out of 5
  available.*;
- the link's three counts: *N people have opened your link.*, *N people have made their Psyche Card
  from your link.*, *You have N credits. Each is 5 questions to PsycheAI or a Psyche Report to gift.*;
- the credit rule pill (its words were a `title` that phones never showed);
- the report's lock, with the tile's own words, as the ticks already did.

Before, a tile's number opened the tile's general tip. On a phone, My Report's foot is now one tinted
section like the laptop's side menu: the signal strength row, then Back, Report and Add data as quiet
icons, set apart in colour from the white report sections above (each was a white button of its own).

### The hub's buttons lift off their rows (October 2026)

**What changed.** The hub's buttons (Read, download, See list, share, Ask, copy, the data-source chips,
Save Backup, AI Personal Context, delete) were transparent with a faint lilac outline, so on the tinted
rows they barely read as buttons. The owner compared four styles at phone width (today, a thicker black
border, a shadow, a purple border plus shadow) and chose the shadow:
- **Light mode:** white buttons (`--bg-alt`), no outline, and a soft purple shadow (`--hub-press`).
- **Dark mode:** buttons a step lighter than the surface (`--hub-button`), with a deeper shadow.

**What stays.** "Add / change data" keeps its gradient. The link's counts (opened, cards, credits) keep
their dashed outline, because they are figures, not buttons.

### Signal strength over My Report's actions, and as text in its header (October 2026)

My Report's header carried Signal strength as a button beside the *6 parts · 16 pages* pill. The pill now reads
*6 parts · 16 pages · 84% signal strength* as plain text, and on a phone the signal strength takes its own line.
The ring that opens the Signal strength popout moved to a row over the page's actions (Back, Report, Add data):
in the side column on a laptop and over the bottom row on a phone (`refreshReportSignal`). The score is in the
ring, so the row says only *Signal strength*, with a chevron: the whole row opens the full read. The side nav
leaves room for the taller box. On a phone the row and the three buttons take the hub's pressable look
(white, a soft purple shadow, no outline), so each reads as a button.

In the Signal strength popout, *Add / change data* beside Your data was a small text link the eye slid past. It
is now the hub's filled purple-to-pink button, a size up, with its re-run icon.

Reached from there (or any *Add data*), the *Add or change your data* popout now says why and what it costs:
*Add more data to improve your signal strength. A re-run costs US$5, and you review what is sent first.* (the
local price; `rerunSourcesBlurb`). A first upload keeps its own line.

On the front page, *Your Psyche Report* no longer carries a *Premium* badge, and its line ends at *in five
parts*: "plus the sections only the Psyche Report has" said nothing a reader could picture.

### A floor of their own writing; a signal-strength bar under 80 (October 2026)

**The floor.** A card read from an export with almost no writing of the reader's own is mostly guesswork, and
used to cost a free card and a model call all the same: the only guard was a *Continue anyway* warning. A run
now needs **20,000 characters of the reader's own writing** (about 3,000 words: captions, comments, and their
own messages on Instagram, WhatsApp and Facebook), counted by `Digest.ownWritingChars` on the page and on the
server alike.
- **On the page:** under it, the first upload and a re-run stop before the review with *Not enough of your own
  writing to read*. The only way on is **Add more data** (Back leaves them where they were). A re-run is
  stopped before any payment.
- **On the server:** `/api/analyse` refuses a digest under it (422, `tooThin`, `refused_too_thin` in the stats),
  except for a report written to explain a card they already have.
- **The number** comes from `PSYCHEAI_MIN_WRITING` (default 20000) and reaches the page as `minWriting` in
  `/api/status`. The UI suite runs with it at 0, since its fixture holds about 4,400 characters, apart from
  the one server that checks it.
- **The old warning** remains for a digest over the floor but small in all (under 50,000 characters), once a
  session.

**The bar.** After the merged run the report is in hand, so the only nudge to add data was one dismissible line
in the hub. Now, while signal strength is under 80, a bar sits under the navigation on every page the Psyche
Report's offer uses, and on My Report as well: the hub's ring with the score, then **Add more data to improve your signal strength – US$5 →** (the
local price; on a phone, *Add data for a stronger signal – US$5 →*, to keep it on one line), which opens the
re-run. It cannot be closed, goes
at 80, never shows with the unlock bar (it needs the report unlocked), and replaces the hub's line while it
shows.

### Tentative: attachment style and conflict style (October 2026)

Two reads rest on the least direct evidence: attachment style (already described as *a guess from behaviour,
and the most changeable read here*) and how they deal with conflict (which the model wrote with "(tentative)"
on the end). Each heading now carries a **Tentative** pill, on the page (`tentativePill`, with a tooltip) and in
the PDF (`subhead`'s new tag). The model's own "(tentative)" is taken off the conflict line, since the pill says
it. Nothing else is labelled: the Big Five, MBTI (whose letters already show *slight*), motivators, interests,
values and work rest on many direct signals.

### My Report's header on a phone: the pills beside the emblem (October 2026)

On a phone the header stacked the emblem, the *6 parts · 16 pages* pill and the Signal strength pill on three
lines of their own above the title. The two pills now sit one over the other beside the emblem (a two-column
grid under 640px), with the title and lede full width below. (Since the signal strength became text in the pill,
the one pill sits there, on two lines.) At 390px wide the header is 238px tall instead of
311px.

### Copy link copies the link; a credit is five questions (October 2026)

- **Copy link is the link alone.** The card's Copy link, the hub row's copy icon and My Syncs' Copy link each put
  only the reader's link on the clipboard, and say *Link copied*. They used to copy the whole share message, which
  a reader pasting into their own text had to delete. Share still sends the message.
- **Psyche Sync's Share asks them to sync:** *I got Iron Man for my Psyche Card. Get yours now for free and sync
  with me: <link>* (`syncInviteText`). The card's own share message is unchanged.
- **"Your Link" is "Share Your Link"**, and its rule reads *1 card made = 1 credit = 5 questions or report to
  gift*.
- **A link credit is worth five questions.** A credit buys a Psyche Report to gift, and a report costs what five
  questions cost, so one credit spent on Ask PsycheAI now turns into five questions (`PER_CREDIT` in
  `lib/askcredits.js`; it was one). Bought questions still go first. When none are left, `spend` takes one credit,
  adds five questions and spends one of them. A failed answer gives that question back, not the credit. The
  balance counts the link's credits in questions (`referral` = credits × 5), so *Includes 5 questions from your
  Referral credits* reads right. The FAQ says *five questions for PsycheAI*.

### FAQ said once, terms in order (October 2026)

**The FAQ repeated itself.** "PsycheAI keeps no copy" appeared five times, "no account" three, the
de-identification list twice. Each answer now says its own thing once:
- *Is my data used to train AI?* is the no, and why, in one sentence.
- *Can the digest be linked back to me?* keeps the specifics ([P1], [N1], dates cut to the month) and the
  encryption line ("stored encrypted", not "encrypted at rest").
- *Why not just upload my data to ChatGPT?* (added late October 2026, from a reader's question) answers on
  privacy first: a raw export goes to its servers as it is, nothing de-identified; on ChatGPT's personal plans
  it may be used for training unless turned off, and turning that off deletes nothing: it stays in the history
  until deleted and up to 30 days after, or longer when required for legal or security reasons (OpenAI's own
  wording; a 2025 court order to keep even deleted chats is left out, its status unconfirmed); against that, files read on the
  device, a de-identified digest, an enterprise service that does not train, no copy and no account, and the
  people in the messages never uploaded. Then that it works better: an export is usually more than a chatbot
  can take in at once. It calls ChatGPT capable, and states its settings rather than how good it is.
- *Can anyone else access my data?* is two paragraphs: nothing stored to take, the administrator cannot see it,
  the privacy policy lists what is kept; shared cards and syncs are locked with a key only the link holds.
- *Does PsycheAI count anything?*, *How does Psyche Sync work?* and *How do I keep my report?* are shorter.
- *What is PsycheAI?* names WhatsApp, Google and Facebook as optional sources.
- **The wait for Instagram's email is 1–2 hours** everywhere: the FAQ, the request steps, the guides and the
  search pages (`tools/seo/topics.mjs`).

**The privacy page** opens with one line instead of three, and the Google/Anthropic bullet is half as long with
the same facts.

**The terms** (dated 20 October 2026) follow the order a reader meets things. Fair use now says a reading needs
enough of their own writing. Section 6, *What is free, and what you pay for*:
- **Free:** the first card and report once per Instagram account, one Ask PsycheAI question, every sync.
- **Paid:** a re-run (card and report) and Ask PsycheAI questions, five at a time.
- **Credits** (one per friend's card): five questions or a gift link.
- **Gift links and promo codes.** Ask PsycheAI. **Guess your character**: a right guess on the first free card
  wins a credit.
- **No cash value, and refunds.**

**Refunds:** a re-run is refunded in full within 24 hours; **Ask PsycheAI question packs are non-refundable**. The
refund policy, the FAQ's contact answer and the payment sheet say so; the sheet shows the line that fits what is
being bought (`#premium-refund`, `#premium-refund-ask`).

It had gone stale: a credit was one question, the report brought a second free question, the first report needed a
friend's card, and a right guess won a report.

### What leaves your device, said plainly (October 2026)

The FAQ's *What data leaves this device?* and the privacy page's *What stays on your device?* led with an aside:
the finished report stays on the device *unless you use Ask PsycheAI*, when the card or report, the digest and
the question go to Gemini. True, but Gemini wrote that report from that digest in the first place, so it read as
a second, alarming disclosure. Now:
- **The FAQ** says it in three short paragraphs: the zip and media never leave (read in the browser); the only
  thing sent is a short digest (about 100–200 KB of text) with personal details removed, reviewed first, which
  goes to Google Gemini, on the enterprise paid tier, for the card, the report and Ask PsycheAI; and PsycheAI keeps no copy, with no
  account to create. Hosting and payment providers see only that the site was used or a payment made.
- **The privacy page** keeps its full detail, with Ask PsycheAI named once, under *Who receives it?*, beside the
  card and report. Its date moved to 20 October 2026.
- **One answer per question.** *Is my data used to train AI?* no longer adds a line on encryption; *Can the
  digest be linked back to me?* says it instead, and only what is true: it travels over HTTPS (the site sends
  HSTS, and the Gemini SDK calls Google over HTTPS), PsycheAI never writes it to disk, and anything Google keeps
  for a short time is encrypted at rest. *Can anyone else access my data?* drops the link's counts, which the
  privacy policy lists. The privacy page drops the bullet about the character guess, and says *100-200KB*.

### Three fixes from the overnight review (24 October 2026)

Pinned by B3 to B5 in `tools/selftest.mjs` and a UI check.

- **B3. A sync's words are sealed.** A sync sent back to a link's owner travels locked with the
  link's key, so the server never reads it, and the owner's device took the result on trust: anyone
  with the link (it is on the owner's story card) and a friend's real card link could leave a
  "sync" in words of their own, shown as PsycheAI's. Every result now leaves `/api/compatibility`
  carrying `seal`, a keyed hash of the rest of it (`lib/syncseal.js`, under the store's key, so it
  holds across deploys), made before the names go in. The sender's device keeps that sealed result
  (`sealed` on the row) and sends it (`v: 3`) instead of its own copy; the owner's device asks
  `/api/sync/check`, ticketless and keeping nothing, and only then fills in the names, turns the
  advice round, and saves it. A seal that fails is dropped like a forged sender. Syncs left before
  `SEAL_FROM` (26 October 2026, by the server's own clock on the item) are taken as before, so
  nothing in flight was lost; after it, an unsealed one is dropped, and a row synced before the seal
  can no longer be shared. What the seal does not prove is who ran the sync: a real result can be
  sent as another's, but its words are still the model's.
- **B4. A NUL in the address** (`/faq%00`) reached the file system, which threw, and was answered
  500. It is now refused as a bad request (400), beside the malformed escapes.
- **B5. `Cross-Origin-Opener-Policy`** (see Security headers).

The review's other note, creator payouts on arrivals rather than conversions, is a business rule,
not a code change.

### The link preview says the current tagline (October 2026)

A pasted link still showed the old line, *Your personality, read from your Instagram*, while the front page had
moved on to *A full personality study. No questions asked.* The preview now says what the hero says:
- **The image** (`promo/og.mjs`, redrawn into `og-card.jpg`): the brand, *A full personality study.* with *No
  questions asked.* on its own line in the gradient, then *Your personal AI coach that already knows you, built
  from your Instagram data.*, the free-card pill and the sample card.
- **The text:** `og:title` and `twitter:title` are *PsycheAI – A full personality study. No questions asked.*,
  and the descriptions open with the AI-coach line. The app manifest's description follows. The page `<title>`
  and meta description stay keyword-led, for search.
- **`?v=2`** on the image address in every page's `og:image` and `twitter:image`: WhatsApp, iMessage and
  Facebook keep a preview cached against its address, so a new address is what makes them fetch the new one.


**Since 25 October 2026**, with the hero: the preview's title is *PsycheAI – Your personal AI coach that already
knows you* (og and twitter alike), its description *A full personality study from your own Instagram data. No
questions asked: MBTI, attachment style, career strengths and blind spots. Your first Psyche Card is free.*, the
image says the same two lines (the headline set at 50px on two lines, where 60px wrapped to four) and its alt text
leads with the coach; the front page asks for `og-card.jpg?v=4` so apps fetch the new picture. The other pages keep
`?v=3`: changing it there would move every page's "Updated" date for a change that is not to its words, and the
picture refreshes in their previews as the apps' caches expire. The web app manifest's description leads with the
coach too.
### The guessing game on every card's wait (October 2026)

**What went wrong.** A reader loaded their data and ran their card and report, and there was no game. It
opened only while `canGuess()` held: no card on the device, and the device's free run unspent. The run
counter survives Delete everything, so any device that had made a card before never saw it. Yet every first
upload asks for a free card whatever the device has made (the server decides by Instagram account), so those
runs could still have won.

**What changed.**
- **Every run that writes a card shows the game:** a free first read, a paid card and report, a re-run.
- **On a free run** the note offers the credit as before. Only the server knows whether this account's guess
  can still win, and `judgeGuess` now says how a guess that cannot count went: the card's character and
  whether it was right, beside the reason.
- **On a paid run** the note says *Just for fun this time: credits come with a first free card*, and the
  server answers it with `forFun`: how it went, nothing to win (`guess_for_fun` in the stats).
- **The popout** for a guess that could not win reads like the others (*You guessed right!* or *Not this
  time*, both characters when they differ), then one line on why there was no credit. It never offers
  *Unlock it free*.
- **One guess per card:** a stored guess from an earlier card, once told, makes way for the next one, and a
  guess locked on the waiting screen is never resent with a request.

### The words they choose to pass on: a weak row on N/S and T/F (October 2026)

A reader whose posts were mostly photos, not her own writing, shared book pages (*Just Mercy*, a passage
on the love you deserve) and loved *The Little Prince*. What someone chooses to pass on is a form of
self-expression, so `shared-words` is now a row on two axes:
- **N/S:** symbol, meaning, what lies under the surface, a fable (N), against practical, factual, step by
  step (S).
- **T/F:** argument, systems, how things work (T), against feeling, worth, how people are treated (F).

It is weak, entered once for all of it, and their own writing outranks it: taste is not how somebody
thinks, and the rubric already says a topic is not a thinking style. It only counts what reaches the
digest: captions that name a book or quote one, searches, saved and liked captions. Text inside a photo
(a book page in a story) does not reach it; reading it in the browser is being prototyped separately.
**Cost:** `FREE_FIXED_INPUT_TOKENS` is 14,250 (14,216 measured), inside the 8.7¢ cap.

### Totoro retired: 28 characters, every sync mutual (October 2026)

**Why Totoro.** Of the characters drawn as neither woman nor man, Totoro (calm, comforting, at home in
quiet places) overlapped most with Baymax (gentle, patient, caring) and WALL-E (gentle, quietly devoted),
and all three are open to every reader. The other two in that group each cover a type nobody else there
does: Pikachu is the only upbeat one open to everyone (Joy is offered to women only), and Remy the only
driven, craft-focused one.

**The sync table.** 29 characters could not all pair off, so the table carried one loop of three
(Pikachu → Totoro → Shrek → Pikachu). Without Totoro, Baymax and WALL-E take each other and Pikachu takes
Shrek, who already listed Pikachu. Every character is still named exactly three times, every pairing is now
mutual, and every woman and man still has at least one of each side. `npm test` checks all of it.

**What changed with it.**
- **Catalogue and prompt:** `CHARACTER_CATALOGUE` holds 28, and readers the model cannot place choose from
  four instead of five.
- **Old cards:** Totoro moved to `RETIRED_CHARACTERS`, so a card already naming Totoro still draws its scene
  and emblem, in the older layout without the sync row.
- **Front page:** the Totoro sample card (Kenji Nakamura) is gone from the gallery. A Hulk card (Marcus Lee,
  INFP) took its place, so the gallery is again the full sample and five more.
- **Search pages:** the Totoro page is deleted, and `/totoro-personality` now goes to `/baymax-personality`
  with a permanent redirect (`RETIRED_PAGES` in `server.js`). The other pages, the sitemap and the
  character tile image were regenerated.
- **Guessing game:** 28 tiles, a neat 4 × 7 on a phone.

### J/P read by area; uncounted notes are weak (October 2026)

**What went wrong.** J/P kept swinging between reports for one reader. Their backup's J/P ledger had three
J pieces and one P piece, none counted or quoted ("tracks property transactions", "occasionally books
spontaneous flights"), and no own-words row. It tallied 5 to 2 out of 7, which the guide calls slight, yet
the model printed *moderate J*. The data is genuinely split: hard planning on money, property and travel,
loose plans with friends. Which side got more entries depended on what the model happened to pick up on
that run, and J/P has no rows the code computes.

**What changed.**
- **J/P is read by area.** The model looks at four areas: work and money, travel, plans with friends and
  day to day. For each area the digest shows, it enters that area's strongest piece for each letter and
  opens the note with the area (`travel: flights booked 6 weeks ahead in 3 chats`). A row may repeat across
  areas, never inside one. An area the digest is silent on is left out.
- **A split is slight.** Where every area shown leans one way, the letter can be moderate or clear. Where
  they split (planning hard in some and loose in others), the axis is `slight`, towards the side of the
  areas that carry most of their time, money and effort. Own words about planning outweigh any one area.
- **Counted or quoted, or weak, on every axis.** Each note gives a count from the digest or quotes their
  words. A note with neither ("often", "occasionally") counts as weak whatever its row, and impressions
  alone never make a letter more than slight.

**What the code does.** `cleanLedger` in `lib/mbtiScore.js` keeps one J/P entry per row, letter and area
(`areaOf` reads the area off the note), and counts an uncounted, unquoted note as weak (`counted`). This
changes only the advisory tally behind `mbti_flip`; the model still decides the letter. The sample
report's ledgers were rewritten to the new rules, with their notes counted and its J/P ledger by area.
**Cost:** `FREE_FIXED_INPUT_TOKENS` is 14,100 (14,074 measured), inside the 8.7¢ cap.

**Temperature was considered and left alone.** A lower temperature would cut run-to-run randomness, but
Gemini's thinking models are meant to run at the default 1.0 (lowering it risks looping), and Claude allows
only 1 while thinking is on. The swing came from which evidence went into the ledger, which these rules
address on any provider.

### The guessing game moved to the waiting screen; the bar sweeps again (October 2026)

**The bar.** While a card was being written, the progress bar sat empty. The steps before it (opening the
archive, building the digest) set the bar's width inline, and an inline width overrides the sweep's own 40%,
so the stripe stayed at whatever was set last, usually 0. `startElapsed` now clears that width before the
sweep starts.

**The game.** The front page's strip of 29 characters is gone. Most readers never noticed that a tap on it
was a guess, and the reader is at the waiting screen with two or three minutes to fill anyway. Now, while a
free first read is written, the waiting screen shows *While you wait: guess which character you are*: every
character as a round tile, one picked, then **Lock in Hulk** (`openGuessGame` in `docs/app.js`). On a phone
the button rides at the foot of the screen while the grid scrolls. Locked in, the pick stays marked, the rest
step back, and the note says *Locked in: Hulk. Your card will tell you if you're right.*

**Keeping it fair.** The request has already gone by then, so the guess is sent on its own, to `/api/guess`
with the job's key (`handleGuess` in `server.js`):
- **Accepted only while the job is running.** The server holds it beside the job, never in the digest, so the
  model never sees it.
- **Closed the moment the card is written.** `takeLockedGuess` reads the guess and closes the job to any
  more, after the model returns and before the result can reach anyone. A guess can still only be made before
  the answer exists. A late one gets 409 `tooLate`, and the page says it can't count.
- **One per job.** A second lock returns the guess already held.
- **Judged as before.** `judgeGuess` against the card just written, one guess per Instagram account, and a
  right guess is one credit on the reader's link.
- **No ticket.** As with `/api/result`, the job key is a SHA-256 of the digest, so holding it means holding
  the evidence. The route spends nothing.

A reload during the wait reopens the game, with the guess still locked if it was (`psycheai_guess` keeps the
job it was locked onto). A guess picked on the old front-page strip before this deployed is still sent with
the request and judged as it was. If the card arrives before a guess is locked, the game simply closes. The
character tiles are the same one image as before (`docs/media/cast-sprite.webp`). *Get my data* and *See
below* now land on the request steps. `PSYCHEAI_MOCK_DELAY_MS` holds the mock's card back so the wait can be
played and tested.

### MBTI: the model decides; the rubric guides (October 2026)

**What went wrong.** A report printed a slight I with extraversion 47, under a paragraph ending
"extraversion holds a narrow lead". The model had written its paragraph for E. The code then added up the
ledger, came out I, and replaced the letter, the type and the score, but it could not rewrite the
paragraph. Handing the model the computed rows narrowed that gap but did not close it: whenever the
model's own weighing differed from the arithmetic, the page contradicted itself.

**What changed.** The model now decides each letter, its strength and the extraversion score:
- **The ledger stays.** It is still written first: every piece of evidence for either letter, tagged with
  a rubric row and quoted or counted.
- **The weights are a guide.** "Strong about 3, medium about 2, weak about 1" says what a typical piece is
  worth. The model weighs each piece on its merits: a vivid, repeated or recent showing counts for more, a
  faint or one-off one for less.
- **Strength is described, not computed.** `moderate` is one side clearly ahead on several solid pieces,
  and `clear` is the other side having little to offer. Mixed own words still mean `slight`.
- **The writing follows the letter.** Every line about the axis (`why`, the evidence, the trait reading,
  the summary) argues the letter chosen. An I never scores above 50 and an E never below.
- **Computed rows are context.** The sustained-conversation and share rows still arrive as a note after the
  evidence, each with a suggested weight, to weigh with the rest.

**What the code does now.** `lib/mbtiScore.js` `scoreMbti` checks without changing anything. It cleans
each ledger to the rubric. It reports, as `mbti_flip` in the stats and an `[mbti]` log line, any axis
where the model's own ledger would tally the other letter, and any extraversion score on the wrong side of
50 for the E/I letter. If that count climbs, the prompt needs tightening, not the code. The mock's
extraversion score (48 under an E) is now 62, so the mock agrees with itself.

### Titles without "Your", each with its mark; no line over the card (October 2026)

- **Titles:** My Psyche's card panel is "Psyche Card" and its hub "Psyche Hub". My Report's header is
  "Psyche Report". My Syncs is "Psyche Sync", and its pill says only "Free, every time".
- **Marks:** each title carries its mark on the left, in the hub's purple-to-pink gradient (`titleMark` in
  app.js, from `HUB_ICONS`: card, grid, report, sync).
- **No gradient line:** the line along the top of the Psyche Card and of its panel on My Psyche is gone.

### Who starts conversations is a weak E/I row; no unsupported group chats (October 2026)

- **`initiates` row.** Who starts the conversations, across their chats, is a weak row: they open most
  (E), or the other side usually does (I). It is entered once for all chats, never per chat. The
  never-counted list keeps reply speed and message counts inside one chat, and WhatsApp's volume.
- **Group chats.** A report claimed "active ties across multiple group chats" and "WhatsApp group chats"
  against `activeGroupThreads: 0` and three one-to-one WhatsApp chats. `CONVERSATIONS_RULE` now says no
  field may claim group chats unless the counts show one: `activeGroupThreads` above 0, or a WhatsApp chat
  whose `kind` is `group`.
- **Cost:** `FREE_FIXED_INPUT_TOKENS` is 13,700 (13,663 measured), inside the 8.7¢ cap.

### Mixed in their own words stays slight; thin ledgers stay slight (October 2026)

A read with the five-year rows working (33 sustained conversations, neither way; 9% sustained, a weak I)
still came back a moderate E at 69. The model's ledger was E 8 vs I 1. Two causes:
- **Own words were lost.** The digest held the reader's own words from 2018: "I think I am quite mixed… a
  lot of times I feel extroverted… many instances I feel introverted". `own-words` let the model pick only
  one letter, so "mixed" had nowhere to go.
- **The E rows were inflated.** Dinners, tennis and trips with old friends went in as `pursuits` and
  `setting`.

The changes:
- **Mixed counts both ways, and caps the axis.** Calling themselves mixed, both or an ambivert is entered
  under both letters, and the axis is then `slight` whatever the rest of the ledger builds (`scoreAxis`).
  What someone says of themselves outweighs a lead built from behaviour.
- **Thin ledgers stay slight.** `moderate` needs 10 points in play (was 6) and `clear` 14 (was 10). The
  slight score scales by points in play over 10.
- **`pursuits` is weak.** A sport or hobby with friends is common to everyone.
- **`setting` E is strangers and big events only.** That means parties, mixers, conferences and meeting
  new people. Seeing several groups of friends they already have is not this row.
- **Cost:** the free card's prompt reserve is 13,600 (13,547 measured). `FREE_COST_CAP` and
  `DEEP_FREE_COST_CAP` are 8.7¢.
- **The sample** now adds up to E, N and F slight and J moderate, with extraversion 55.

**Landing.** Every read that writes a card now lands on My Psyche at the card: a first free read, and a
card bought with its report (`adoptBundle`). An unlock of a card the reader already held lands on the
report, live or picked up after a reload.

**The front page's pills.** Psyche Sync's "Free" and Ask PsycheAI's "1 free, then … for 5" (*1 question free…* until 27 October 2026) take
the card tier's "Free" design: faint green (`--good-soft`) behind green text.

### Breadth is sustained conversations in every field, not only the ledger (October 2026)

A signature pattern, "The generous networker", cited "378 active direct message conversations over the
lifetime of your account". The MBTI ledger's never-counted list already kept `activeThreads` out of the
letters, but it bound only the ledger. `CONVERSATIONS_RULE` now says it once for everything: patterns,
sections, the card and the ledger.
- **The rule:** how many conversations someone ever wrote in, or any lifetime total of contacts, friends
  or followers, is never evidence of how many people they keep up with. The number that measures that is
  `engagedThreads.last5Years.atLeast50`.
- **Where it sits:** in the report prompt's numbers rules and the card prompt's "Reading it"; once in the
  merged prompt.
- **Schemas:** the patterns' `evidence` descriptions say it too.
- **Cost:** `FREE_FIXED_INPUT_TOKENS` 13,450 (13,441 measured), still inside the 8.6-cent cap.

### A slight extravert read as moderate, and S off search counts (October 2026)

The first report built on the ledger still called one reader a moderate E (extraversion 68), and gave them
an S they are not. Two of the code's own rows did most of it:
- **E/I:** the sustained row added Instagram's 40 to Messenger's 126 (a history from 2007) and entered
  166 as a strong E. That weighed as much as the reader's own words.
- **N/S:** the search-shape row read 7,330 practical searches against 509 conceptual as a medium S. But
  "how to", "near me", prices and bookings are what anyone's search box is for.
- **Model rows:** the model also cited group chats against `activeGroupThreads: 0`, and counted dinners
  and trips with old friends as reaching out.

The changes:
- **Five years, and never a sum.** The browser readers count each conversation's own messages over the
  five years up to the export's latest message, and send `engagedThreads.last5Years`: how many
  conversations they wrote in then, and how many hold 10, 50 and 200 of their own messages (`instagram.js`
  `recentPerThread`, Messenger in `supplement.js`; `forModel` passes the five integers). The scorer reads
  only those, Instagram's and Messenger's added together; a source without them (a digest built before
  this) adds nothing. The share is the five-year sustained count over the five-year conversations written
  in.
- **A count weighs less than words.** Over 100 sustained conversations is now a medium E; 50–100 a weak
  E; under 20 a weak I.
- **Group chats count for neither letter**, busy or empty. Whether someone group-chats on these apps is a
  habit of the app, not of the person. The row is gone from the rubric, a ledger that names it is
  dropped, and the never-counted list says so.
- **`reach-out` means beyond the usual circle.** Plans for the same friends, however often, are
  `convenes-known-circle`, which counts neither way.
- **Strength is stricter.** `moderate` needs a margin of a third with 6 points in play (was a quarter with
  5); `clear` needs two-thirds with 10 (was three-fifths). The extraversion bands are unchanged in their
  ranges.
- **N/S unwound.** `search-shapes` is no longer a row, and the never-counted list says a mostly practical
  search history is everyone's. `compares-tracks` and `practical-craft` are weak, and leave out the
  numbers a reader's job runs on and a sport's technique.

The sample's extraversion moved from 58 to 57 with the new slight formula.

### MBTI scored from a ledger, not an impression (October 2026)

One reader's J/P came back J, J and P in a day. The digest was the same each time (its sampling is
seeded), and each run was "moderate". The data genuinely ran both ways: planning for money and work, loose
plans with friends. A model that forms one view and then writes a paragraph defending it lands wherever its
first impression did. E/I had been patched rule by rule, with nine thousand characters of bands, bans and
corrections, and still swung.

Now the model judges each piece of evidence, and code does the adding up (`lib/mbtiScore.js`):

- **The ledger:** for each axis the model writes a `ledger` first. It lists every piece of evidence for
  either letter, each tagged with a rubric row (`RUBRIC`), the letter it points to, and a short note with
  its count. `why` and `evidence` then explain what it shows. The ledger is never printed.
- **Weights:** each rubric row has a fixed weight: strong 3 (their own words; the setting they choose; the
  T/F tie-break), medium 2, weak 1. One entry per row and letter, so repeating a row adds nothing. Rows the
  model may not use, wrong letters and duplicates are dropped (`cleanLedger`).
- **Computed rows:** some rows the code works out from the digest and never accepts from the model
  (`computedPieces`):
  - *Sustained conversations* (Instagram's `engagedThreads.atLeast50`, plus Messenger's): over 100 is a
    strong E; 50 or more a medium E; under 20 a medium I; anything between leans neither way. The bands
    halve for under three years of data. (Since revised: five years, the larger source, weaker weights;
    see "A slight extravert read as moderate" above.)
  - *Share:* over 60% of conversations spoken in being sustained, with at least 30 of them, is a weak E.
    Under 10%, around fewer than 50, is a weak I. A high share needs the floor because six kept up out of
    eight is a small circle, not reach.
  - *Both:* neither row counts when direct messages are not a channel the reader uses (under 1,000 of
    their own messages and under 50 conversations spoken in). Someone who barely uses DMs is not counted
    as an introvert.
  - *Search shapes:* Google's `searchShapes` give a medium N or S at two to one, over at least 30.

  The model once read 378 conversations "ever spoken in" as breadth. A number nobody reads cannot be
  misread.
- **Letter and strength:** the side with more points wins. A tie goes to the side with the strongest
  single piece, then to the model's pick. `moderate` needs a margin (difference ÷ points in play) of a
  quarter, with at least 5 points in play. `clear` needs three-fifths, with at least 10.
- **The extraversion score** comes from the same result: slight 51–59, moderate 60–69, clear 70–85,
  mirrored for I. At slight it is scaled by how much was in play, so one piece alone sits nearer 50.
  The letter and the score can no longer disagree.
- **Where it runs:** on the server, on every answer before it is served (`scrubbed`). On the two-call
  path the card is scored before the report is anchored to it. When the sum changes the type, the
  nickname, `card.mbti` and any line that named the old type follow. A report pinned to its card has no
  ledger and is left alone. Scoring twice changes nothing.

**The prompts got shorter.** Both prompts now share one section, `MBTI_LEDGER_RULES`. It holds the method,
the rubric tables (`rubricText()`, so the prompt and the code cannot drift) and a short "never in a
ledger" list:
- volume;
- totals that include what the reader never joined;
- what happens inside one chat, and WhatsApp's hand-picked chats;
- how and when they write, posting bursts included;
- the platform's genre: a camera is not S, warmth is not F, a topic is not a thinking style;
- a blank.

This replaced the report prompt's "Reading extraversion fairly" and "N/S and T/F have the same problem"
sections, and the card prompt's E/I bullets. The report prompt is about 15,000 characters shorter and the
merged prompt about 19,000 shorter (`MERGED_FIXED_INPUT_TOKENS` 45,000 → 40,500).

The card prompt is about 4,000 longer, because it now carries the rubric. `FREE_FIXED_INPUT_TOKENS` went
from 11,900 to 13,300, and `FREE_COST_CAP` and `DEEP_FREE_COST_CAP` from 8.5¢ to 8.6¢. In the card prompt
MBTI now comes before the Big Five, so the merged prompt's card rules (sliced from `# Big Five`) do not
carry the section twice.

**The model sees the computed rows.** The computed rows are added after the evidence, as a short note
(`computedText`, sent by `freeBlocks`, `profileBlocks` and `mergedBlocks`). For example: "E/I, `sustained`:
15 conversations … → I (medium, 2)". The model adds those points into its own sum before it writes `why`.
Without the note, it couldn't foresee them. A close E/I could then flip in the code under a paragraph
arguing the other letter. A report pinned to its card gets no note, because it writes no letters.

**Flips are counted.** If the code's sum still overturns the letter the model picked, the server logs it
(`[mbti]`) and counts `mbti_flip` plus `mbti_flip:<axis>`. If that rate climbs, the prompt needs
tightening.

`why` names no strength word and no score, because the code may move either after the model has written.
The sample report carries ledgers that add up to its own letters (the extraversion score went from 52 to
58 to match). A selftest re-scores the sample and checks that it agrees.

### E/I bands and bans at the field; N/S read both ways (18 Oct 2026)

The first report built with `engagedThreads` used it ("378 conversations joined with at least 40 sustained
past 50 messages") and still came back a moderate E (64): it led with 378 and Facebook's raw count, cited
"850 of 1,535 conversation openers in your primary chat", called "20 distinct contacts" breadth, and set the
reader's own "quiet solitary weekends" aside as "personal pacing rather than social withdrawal". The rules
were there; the model was not applying them where it wrote the field.

- **Breadth, roughly defined** (judgement, said so in the prompt): conversations with at least 50 of their
  own messages, over the whole span — under about 20 narrow (leans I), 20–50 ordinary (neither), 50–100 wide
  (leans E), over 100 very wide; halved for under three years of data. The share sustained of all spoken in
  is context, never the decider. Barely using direct messages is no evidence either way and never counts
  towards I. Commenting is rare for nearly everyone, so people commented on is not breadth. The count of
  conversations ever spoken in is given only beside the sustained count.
- **Their own words about their energy count most**, either way (introvert, ambivert, drained by crowds,
  alive in one), and contrary behaviour is weighed at face value, never re-described to set it aside.
- **The kind of setting counts as much as how often.** Seeking new people and big events (parties, mixers,
  conferences) and widening the circle lean E; preferring small, familiar groups, avoiding mixers and
  strangers, and tiring in unfamiliar settings lean I. Earlier reports had read exactly this ("focused
  gatherings over broad, superficial crowds… avoid large-scale industry mixers") and the prompt never
  named it. Organising plans for a familiar circle is not seeking crowds: on its own it leans neither way.
- **Strength.** Breadth alone carries a letter only to `slight`; `moderate` needs their words or conduct the
  same way, and real evidence for the other letter makes it `slight`. On every axis, behaviour that runs both
  ways — a letter a second reading could flip — is `slight`, never `moderate` (three runs on one reader went
  ENTJ, ENTJ, ENTP with J/P flipping at "moderate").
- **Bans at the field.** The E/I `why` and `evidence` descriptions now carry the bans themselves: no
  spoken-in count or unjoined total as breadth, nothing inside one chat as breadth, no re-describing the
  counter-case — the group-chat lesson again, that an explanation in the prompt is not a prohibition where
  the field is written.
- **N/S both ways.** It leaned N the way E/I leaned I: concreteness discounted as the platform, every N
  signal counted, and precise figures explained away as "inputs to a bigger thesis". Sensing now has its own
  evidence (practical skills built step by step, comparing specs and prices, sensory craft, exact tracking,
  staying with what is in front of them); a topic is not a thinking style (following markets or politics
  says nothing, how they engage with it does); precision is never explained away unless the data shows the
  step; start from the middle.
- **Search shapes over the whole history.** The model saw the top 50 of tens of thousands of searches. The
  browser now counts every Google search by a plain English word match — practical (how to, near me, a
  price, a fix, a booking) or conceptual (why, what if, meaning of, difference between, explained),
  conceptual first, most matching neither — into `google.counts.searchShapes` (`searchShape` in
  `docs/supplement.js`). Two integers; unticking Google searches at the review removes them too.
- `FREE_FIXED_INPUT_TOKENS` 11,600 → 11,900 (11,738 measured), `MERGED_FIXED_INPUT_TOKENS` 43,500 → 45,000
  (44,812 measured), `MERGED_COST_CAP` $0.184 → $0.185.

### Thumbs on each finding (26 Oct 2026)

From Cognius's "that's me / not quite" deck: a reader agreeing or disagreeing with a finding is both a
reason to read it closely and the start of a running record of themselves. On their own My Report only
(never the sample), one small row under each signature pattern and one at the foot of each section
(MBTI, Big Five, What drives you, How you connect, How you work, Under pressure): about nine in a
report, never one a paragraph, so the report is not a page of buttons. *Sounds like you?* with 👍 and
👎, grey until used. 👍 says *That's you · saved on this device*; 👎 opens one optional line, *What's
closer?*, and once saved it stays there as *You said "…"* with Edit. The same thumb again takes the
mark back.

- **Kept:** `psycheai_marks` (`KEYS.marks`), stamped with the report's `createdAt`, so a re-run
  starts clean rather than pinning old marks to new findings. In `BACKUP_KEYS`; `readBackup` keeps
  only yes/no marks, labels to 120 characters and notes to 200.
- **Used:** Ask PsycheAI gets them as `readerMarks` beside the report (`askReport`), and `ASK_SYSTEM`
  takes a "not quite" and its note as the reader's word: build on it, never argue it back. Nothing
  re-runs on its own.
- **Into the next report:** a paid run that replaces the report (a re-run, an unlock) carries them as
  `readerMarks`, so the new report answers what was disputed instead of repeating it. They go only as
  reviewed: the review shows them as a row of their own, *Your thumbs on your last report · as you
  wrote them*, with a switch (`includeMarks`), and the file from *Download what's sent* includes them.
  The reader's own name becomes PsycheUser, as for Ask; notes are otherwise sent as written, which
  the row says. The server takes them on a paid run only (`cleanReaderMarks`: up to 20, findings to
  120 characters, a note only on a "not quite", to 200, no angle brackets) and holds them on the
  digest as `__readerMarks`, a device key, so they are never counted or shown as evidence.
  `marksBlock` tells them to the model after the evidence, in the card, merged, report and premium
  calls: weigh each "not quite" honestly; write it the reader's way where the evidence allows; where
  it still clearly shows the original, keep it and say once in the report, never on the card, which
  evidence points that way; a "fits" never a reason to overstate.
- Small and quiet: the row's text .7rem; the note box a thin underline drawn at 12px (16px underneath,
  so a phone does not zoom in on focus); a saved note one grey italic line, *You said "…"* · Edit.
  Hidden in print.

### The roast keeps its My Psyche design in My Report (18 Oct 2026)

Once the report was unlocked the roast moved from My Psyche to My Report's Appendix 1 and lost its look: the
appendix drew it with the plain `roastBlock` (a grey striped cover and an outline button), dimmed further to
the part's plain rows. The appendix now uses `secretRoastHtml` too, with `{ appendix: true, title }`: the
animated gradient frame, the sparks, the badge and the glowing, pulsing reveal button, under "Appendix 1: Let
us roast you". It keeps `.roast-appendix` and `data-appendix="roast"`; the structured layout's grey-room rules
skip `.secret-roast`, and the appendix-only overrides that dimmed it are gone. `roastBlock` stays for the
sample report.

### One chain: character line, executive summary, card write-up (18 Oct 2026)

Three short pieces of writing say who the reader is: the character line (`essence.why`, beside the
character at the top of the Overview), the executive summary (`summary`, the Overview) and the card's
write-up (`cardHighlights`, its two sentences on the cover, under the `card.headline` one-liner). Each was
written on its own, held apart by "don't repeat" cross-references, and the paths disagreed on order: the card
call wrote no character line, the report written to a card wrote a character line told to avoid the card's
lines and a write-up the page then threw away, and the merged call wrote the character line before the
write-up it was told to avoid.

Now one chain, the same everywhere, in this order: the **character line** first; the **summary** second,
building on it rather than retelling the comparison; then the **write-up** and the **headline**, condensed
from the two. The card call writes all three (`STRUCTURED_FREE_ESSENCE` gains `why`, one `ESSENCE_WHY` for
both schemas), so the card settles them: a report written to a card that carries its summary leaves out the
write-up (`STRUCTURED_OVERVIEW_PINNED_SCHEMA`), and to a card that also has its character line, the essence
too (`STRUCTURED_LINE_PINNED_SCHEMA`, chosen by `anchor.essenceWhy`); `overlayCard` keeps the card's line,
summary and write-up. The merged call writes the chain in the same order and splits along the line-pinned
schema. The only cross-references left are between pieces printed side by side: the summary does not retell
the comparison the line above it makes, and the write-up does not open by naming the character printed
above it.

### No real reader's figures or handles in the prompts (18 Oct 2026)

A sweep of every prompt for anything tied to one reader's data found three worked examples in the report
prompt (and so the merged one) built from real reports: "378 Instagram conversations" quoted under three
sections, "over 64,000 Google searches" against "86,000+", and two real-looking @handles in the
misattributed-caption examples. Each went out with every request, for every reader: an anchor for the
model to reach for the same figures, and a third party's handle in a prompt whose whole promise is
de-identification. The lessons stay; the specifics are gone: "the same count of conversations" under three
sections, "one figure for their searches … and a different one in another", invented figures (12,000
searches, 9,000 distinct terms) for naming what a figure counts, and the caption examples rewritten with the
digest's own `[P1]`/`[P2]` markers. A selftest refuses the old handles and figures in the prompt.

### Breadth is conversations with real exchange, not conversations ever spoken in (18 Oct 2026)

After the symmetric E/I rules a reader who calls himself a slight extravert at best came back a moderate E
(64), the case resting on "378 active Instagram message threads" — quoted four times — and the Big Five
line "you sustain contact across hundreds of contacts". `activeThreads` counts every conversation the
reader ever wrote in, over the whole span of the export: one reply to a story counts the same as years of
talk, and over fourteen years the number grows for anyone. The morning's rule had called "a few hundred" wide
reach and a real point towards E; that was this project's own over-correction. The other two E points were
"initiated 850 conversations in your closest WhatsApp thread" (one person, in a chat the reader picked) and
"nearly 1,000 Messenger conversations" (Facebook's raw thread count, requests included).

- **A new breadth number.** The browser already tallied each conversation's messages by sender to tell
  spoken-in threads from the inbox, and threw the tallies away. It now keeps three integers,
  `directMessages.engagedThreads` = `{ atLeast10, atLeast50, atLeast200 }`: how many of the conversations
  they wrote in hold at least 10, 50 and 200 of their own messages (`engagedCounts` in `docs/instagram.js`).
  Messenger gets the same in `facebook.counts.engagedThreads` (`docs/supplement.js`), its `threads` being
  every conversation file, requests and filtered ones included. Counts only; `forModel` passes exactly the
  three integers.
- **The rules, written generally.** A count of conversations spoken in measures reach over the whole span,
  not the people they keep up with: weak on its own, and never a claim about how many people they stay in
  touch with; the breadth number is the conversations with real, repeated exchange. Any total that includes
  what they never took part in — requests, unjoined conversations, Messenger's thread count, friend and
  follower lists — is an inbox or a list, not reach. Who starts and how fast they reply inside one
  conversation is attachment's evidence about that tie, never breadth. Depth stays neutral. The "few
  hundred is wide reach" line is gone; the E bar, the E/I axis and the letter's evidence list now name
  "conversations with real, repeated exchange". The card prompt carries the short version.
- `FREE_FIXED_INPUT_TOKENS` 11,400 → 11,600 (11,459 measured), `MERGED_FIXED_INPUT_TOKENS` 43,000 → 43,500
  (43,322 measured); the merged cap stays $0.184 ($0.1835 at most).

### The report's character rule matches the card's (18 Oct 2026)

A review of the merged prompt against the card-then-report pair found the report still carrying the base
prompt's free-form character rule: "pick the character before you write anything else, then let the rest
of the profile agree with it", "someone globally famous", examples outside the catalogue (Kevin Flynn,
Superman) and Elsa, who is in it, as a bad pick, and the old same-sex rule. In the merged call it sat beside
the card's catalogue rule, and against the scores-first order; in the report written to a card it told the
model to bend the whole report towards a character already settled. A structured splice replaces it: the
character comes from the catalogue, after MBTI, the Big Five and the patterns, on the card's own side rule
(`CHARACTER_SIDE_RULE`: a woman one of the twelve women or the five who are neither, a man likewise), and
once the card has named it, `essence.why` explains it and nothing else bends to it.

The same day the full and merged schemas moved the character, the summary and the card's write-up to after
"What drives you" and "How you connect / How you work": `confidence, mbti, bigFive, patterns, interests,
beliefs, values, (topMotivators,) motivators, relationship, career, essence, summary, cardHighlights`, then
the premium sections. The character is matched on temperament, drive and how they treat people, and drive
(the motivators) and how they treat people (the relationships) had been written after it; the summary is
"the whole report in miniature", closeness and work included. The patterns stay straight after the scores,
since the sections point back at them. The merged call's copy of the card's summary rule says to write it
after every section above it and after the character. The card call already picked the character after its
interests, motivators and values, so its order is unchanged. The card prompt's
"Two or three" signature patterns now say "Exactly three", as its schema, the report and the merged schema
already did.

### MBTI: an evidence list per letter, and J/P read from planning (18 Oct 2026)

Three reports for one reader (14 Oct card-then-report ENTJ, 18 Oct before the E/I fix INTJ, after it ENTP)
showed two weaknesses in the MBTI read beyond E/I.

**J/P read posting rhythm.** The prompt called J/P "the least confounded of the four" and sent it to
`rhythm.regularity` and the month-by-month series. People post when something happens, so bursts with long
quiet stretches are how nearly everyone posts: the after-fix report called P off "zero regularity" against
the itineraries, spreadsheets and property paperwork both earlier reports read as J, and, the score now
following the letter, took conscientiousness from 74–78 to 58. J/P now has its own confound paragraph:
posting rhythm is weak support at most and never decides the letter; J is bookings made ahead, lists,
trackers, deadlines met, decisions closed; P is same-day plans, short-notice trips, options kept open,
changing course, parallel projects; forward-planning searches support it; a planner in one area and loose in
another is weighed by where their time and money go, and mixed is `slight`. The card prompt carries the
short version. Evidence allocation gives how they plan to J/P and the posting rhythm to rhythm and activity.

**Each letter's evidence is a list, as the Big Five's was.** The letter's case had to fit "at least two"
counted pieces and a counted tempering into three or four sentences, and in practice most axes cited one or
two. Each letter now writes `why` and `evidence` together, in that order, as a Big Five trait once wrote its
reading and its evidence, and as the page prints them: `why` is two or three sentences, the case in plain
words and then the behaviour that runs the other way with its own count, which belongs there and not in the
list; `evidence` is three or four behaviours, a short clause each (under about 15 words), from different
parts of the digest, none used for another letter and none restating the paragraph, fewer only when the
data is thin (then said in `why`, and `slight`). Writing the list first was tried and dropped the same day:
the paragraph opened on "Together that is…", pointing at a list the reader had not reached yet. On E/I the list is the breadth and, in the structured layout, the only place the extraversion
evidence is laid out. The page prints the list as the evidence chips under each axis's paragraph
(`mbtiSlidersHtml`, and the classic `mbtiAxesHtml`), the PDF as small pills under it (`axis`, `evidence`
option). The paid report pinned to a card keeps writing it (only `choice` and `strength` are pinned).
`docs/sample.json`'s four letters are rewritten in the new shape. The structured layout also drops each letter's `inPractice` line (`structuredMbti`; the page and PDF no longer print it): after the paragraph and its list it was a third telling of the same letter. The classic layout keeps it. `MERGED_FIXED_INPUT_TOKENS` 42,500 → 43,000
(42,863 measured) and `MERGED_COST_CAP` $0.183 → $0.184 so the merged call still pays for the premium digest.

### Scores first, and E/I read the same way in both directions (18 Oct 2026)

A reader's E/I came back "While you have spoken in 378 active direct message conversations over the years,
your actual emotional investment is concentrated in two primary one-to-one chats carrying over 70,000 total
messages": the WhatsApp mistake below again, and a wide count argued away by two deep chats. Earlier reads
from the card-then-report path had argued the same person from breadth ("initiating plans, gathering
groups… across dozens of circles… hundreds of contacts", tempered by "solitary weekends to recharge").
Two causes, both fixed.

**The write order.** The structured full report and the merged first run wrote `essence`, `summary`, the
patterns and `cardHighlights` before `bigFive` and `mbti`, and the prompt said to decide the patterns
"before you write any section": the portrait, type included, came first and the scores followed it. The
card call wrote the character before its scores too, and every schema wrote `mbti.type` before the letters
and each letter's `choice` before its `why`. Gemini's `responseJsonSchema` keeps key order, so that is the
order the model commits in. Now:
- full and merged: `confidence, mbti, bigFive, patterns`, then the sections, with `essence, summary,
  cardHighlights` after `career` (moved there the same day, below); the patterns are decided "straight after MBTI and the Big Five, from the evidence and those
  scores"; the merged call's copy of the card rules says so in place of the card's "decide them last" and
  "write it last but one";
- card: `confidence, mbti, bigFive, …, beliefs, essence, summary, …` — the character just before the
  Overview;
- **MBTI before the Big Five**, everywhere (classic schemas too). Since the report trim the letters carry
  the paragraphs of evidence and each trait one line, so the score was being fixed on one line and E/I's
  full case written after it, only able to explain it. Now the case comes first and the score follows the
  letter and its strength: E `slight` 50–59, `moderate` about 60–69, `clear` 70+; I `slight` 41–50,
  `moderate` about 31–40, `clear` 30 or below — so 55+ is still always E, 45 or below always I, 46–54
  either at `slight`. Openness, agreeableness and conscientiousness read off N/S, T/F and J/P the same way,
  without a threshold; neuroticism has no axis and rests on its line. The E/I `why` names no score, and
  the old "say 'your extraversion score of N', not 'the score above'" note is gone: MBTI is first on the
  page and in the writing;
- MBTI: `letters` (each `axis, why, evidence, choice, strength, inPractice`), then `type`, "the type the four letters
  spell"; each structured Big Five trait writes its `reading` (now "the behaviour that sets this score")
  before its `score`.
Thinking models reason before they answer, so the order matters less than it would without thinking, but
nothing now asks for a conclusion ahead of what it rests on.

**The rules leaned towards I.** The extraversion block began as a correction for introverts scored as
extraverts off DM volume and had become one-sided: depth (messages ÷ active threads) read as "textbook
introversion", long messages, late nights, solitary imagery and lurking were "weighted up", the default was
"below 50" for volume with few people, and only **E** had a bar to clear. The block is now *Reading
extraversion fairly*:
- volume is evidence for neither letter, and the error is named as running both ways;
- `activeThreads` is the breadth number: the low dozens a settled circle, a few hundred wide reach and a
  real point towards E (a judgement, not a measured norm); depth is neutral, and a few deep chats are never
  set against a wide count;
- what they do with people counts both ways: plans proposed, people gathered, group outings, conversations
  started with many people and several distinct circles lean E; a stated need for time alone, leaving
  early, declined invitations and solitary pursuits chosen over group ones lean I;
- long messages, a late-night rhythm, solitary imagery and liking far more than posting are no longer E/I
  evidence;
- start at 50: above ~60 needs breadth, below ~40 needs signs of seeking quiet; missing breadth is not I.
The WhatsApp rule, the group-chat and close-friends one-way rules, the no-messages hedge and the 55/45
letter-to-score tie (now read from the letter's side) are unchanged. The card prompt carries the short version. The E/I `why` is a full
paragraph again (it was "deliberately shorter"): the breadth behind the letter and what tempers it, each
counted. The evidence-allocation rule gives plans proposed and conversations started across many people
to extraversion; who starts and how fast they reply inside close chats stays with attachment.

The digest's own WhatsApp note now says the chats are hand-picked, usually the closest people, so their
volume says nothing about how many people the reader seeks out: the model meets that beside the numbers,
not only in the prompt. `FREE_FIXED_INPUT_TOKENS` 11,300 → 11,400 (11,310 measured). Not yet run against a
real model: the first live report after this should be read for the E/I case.

### WhatsApp volume is not introversion (October 2026)

A reader who had read as a slight extravert came back a moderate introvert, the E/I case citing "378 active
direct message threads … your volume is overwhelmingly concentrated in two WhatsApp chats logging over
35,000 messages each". That reasoning is wrong by construction: the reader chooses up to three WhatsApp
chats to add, usually with their closest people, so all of that volume sits in a few chats for anyone.
The messages-per-thread rule (thousands across a few conversations is depth, leaning I) was written for
Instagram's own DMs, where the spread is the reader's behaviour, not their choice.

Both the card's prompt (which the merged first run reads too) and the full report's now say so: WhatsApp
chats are hand-picked; their volume is never set against Instagram or Messenger threads, never called
"concentrated" and never counted towards I. Breadth comes from `activeThreads`, `activeGroupThreads` and
distinct people; WhatsApp adds who starts conversations, reply speed and how they write.

Two other changes this month made the E/I read more exposed to it: the merged first run writes the card
and report in one call from a longer prompt, and the trimmed Big Five moved the extraversion evidence into
the E/I `why`, which is told to name the breadth number behind the score.

### A new reader's first run: the card and the report together, free (October 2026)

A new reader's first free run now writes the Psyche Card and the Psyche Report together, the way the
US$5 bundle does (`mergedOrTwoCalls`: one call with `PSYCHEAI_MERGED_UNLOCK` on, the card then the report
without it), and lands on My Psyche's hub, scrolled past the card, with the report unlocked there (18 Oct
2026; it landed on the card at first). It is free once per Instagram
account: the same per-account record as the free card (`PSYCHEAI_FREE_PER_ACCOUNT`), so the same account
on a new device, or after Delete everything, is offered the card and report together at US$5, as before.
A run with no account to hold it to gets the card alone.

- **The switch.** `PSYCHEAI_FIRST_RUN` on the server: `merged` (the default) or `card`, the path before
  (the free card, then the report unlocked by a link open, a guess, a gift or US$5). Setting it to `card`
  is the whole revert: the page asks every free run for `product: 'first'` only when `/api/status` says
  `firstRun: 'merged'`, and the server decides what that buys; what came back is read off the result (a
  report carries its card as `freeCard`). The classic layout is always `card`.
- **Cost.** A first read costs about a card and a report (`MERGED_COST_CAP` against `FREE_COST_CAP`, roughly
  twice), so it counts twice against the day's free ceiling (`PSYCHEAI_DAILY_FREE_LIMIT`), which was sized in
  cards: the same daily spend ceiling buys half as many first reads. Raise the limit when traffic justifies it.
- **The guessing game stays, with a credit as its prize, on both paths.** With the report free on the first
  read, a report would be a second copy, so a right guess adds one credit to the reader's link
  (`ref:<code>:bonus`, added to `credits` in `referral.status`): a question to PsycheAI or a Psyche Report to
  gift. The card-first path pays the same credit, so the game is one game whichever way the switch is set
  (judgeGuess still mints a report grant when called without `creditTo`; the server no longer does). The cast
  says "win a free credit"; the popout says the credit is on their link. Counted as `guess_won_credit`; the
  first read itself as `first_full`.
- **The price wording** (the front page's Psyche Report badge, now a green "Free" with the re-run price as a footnote, the FAQ, the guides, the search pages, llms.txt and the re-run sheet) now says the
  first Psyche Card and Psyche Report are free and a re-run is US$5. That is true only while the switch is
  `merged`: going back to `card` should take the wording back too (the re-run sheet follows the switch on its
  own; the static pages and the front page's badge do not).
- **The card intro on a phone** breaks before "Go deeper in your Psyche Report" (or "Unlock the reasoning…"),
  so the report's sentence starts a line (`{br}` in `introPaid`/`introFree`, `.cx-br`, shown under 760px).
- **Ask PsycheAI's count in the hub is asked/total** (was left/total): 0/5 before any question, 2/5 after
  two; a reader with none at all reads 0. The total is still what is left plus what was asked, never a
  remembered high-water mark.
- The free-report-for-one-open panel still serves readers on the card path.
- **Landing on the hub (18 Oct 2026).** A first read that brings the card and its report together now opens
  My Psyche at its hub (`landOnHub` in `adoptBundle`: `leaveHub()` then `go('profile')`, the same scroll
  Back from My Report uses), so the reader meets both results at once instead of scrolling past the card to
  find the report. A resumed job lands the same way. The bought bundle still opens My Report.
- **One free question in all (18 Oct 2026).** Ask PsycheAI gives one free question per link, with its card,
  however the report comes: the report no longer brings a second (`GIFTS = { card: 1 }` in
  `lib/askcredits.js`; the server gifts `card` on every run, and `gift` is once per code). The front page's
  Ask line reads "1 question free, then S$7 for 5", and the FAQ says one question free, then five for
  US$5.

### Share-first: the first Psyche Report free for one connection opening the link (October 2026)

The free card's unlock offer used to lead with *Unlock your Psyche Report – US$5*, with *or get 2
connections to make their Psyche Card from your link* in small type under the price. It now leads
with sharing, because a shared link brings a new reader and a US$5 sale brings one payment:

- **The panel** (`unlockShareHtml`, inside `.full-report-locked`): *Unlock by sharing your link with
  1 connection*, the line *Your Psyche Report unlocks free as soon as 1 connection makes their
  Psyche Card from your link* (it said *opens your link* until the October 2026 fixes), and **Share my link** (the share sheet with the one share message, or
  copied where there is none). Under the box, as a small grey link, **or pay US$5**, the only
  `.premium-unlock` in the panel. Once someone has opened the link (`status.first.unlocked`,
  `refreshUnlockShare`), the line says so and the button becomes **Unlock my Psyche Report free**.
- **The payment sheet** (`showReferralOffer`) carries the same offer in a box above the ways to pay
  (`#premium-share`), then a small *Or pay US$5* heading. While the box shows, the sheet takes
  `.share-first` and the pay button is drawn as an outline. **Unlock my Psyche Report free**
  (`#premium-first`) posts `/api/referral/claim` with `{ first: true }` and runs the report on the
  grant. A gifted report waiting on the device is offered instead, as before.
- **"Sharing" is one friend's card from the link** again since the October 2026 fixes (below): an
  open is an unauthenticated count anyone can send with a fresh code each time, so it was a free
  report on demand. Opens are a statistic only. What follows is the history. **It was one open of the link by someone else** (`ref:<code>:opens`, from `/api/event`
  `referral_open`; the owner's own browser never sends one), or one friend's card. It began as a
  friend's card only. A week later it was lowered to an open, to make the free report easy to get
  for now: a friend no longer needs their own Instagram export first. The cost is that an open is
  easy to fake, for example by the reader opening their own link in a private window. That
  is accepted for now and bounded by the first-report-only rule below; to tighten it again, set
  `first.unlocked` in `status()` back to cards only.
- **First report only.** `claimFirst` gives one grant per code, the same token each time it is
  asked (so a failed report can be asked again), stored as `first:<code>`. Every full report, paid
  or not, adds its account to `full:accounts`. `grantRefusal` refuses a `first:` grant's first use
  for an account already there: *for your first Psyche Report only. A re-run is paid.* A spent grant
  refuses any other digest, as every grant does, so it can never pay for a re-run. The panel and the
  sheet offer it only while the reader has no Psyche Report (`firstFreeOffered`).
- **Short enough for a phone** (October 2026). The panel had a paragraph under each of its eleven
  sections and took 2,208 pixels on a 390×844 phone, about two and a half screens. Each part is now
  its numeral, its title and its sections as small chips (`.unlock-chips`), the front page's shape,
  under one line saying what the report is for: *explains each one with the evidence from your own
  data, adds what the card leaves out, and ends with a plan for your personal growth.* "See sample
  report" in the head shows what each section holds. A check holds the whole panel, share box
  included, under one and a half screens.
- **It notices the open by itself.** The status used to be asked for once, when My Psyche was drawn,
  so the free unlock appeared only after a reload. Now, while the share box is on screen, the tab is
  visible and the report is still locked, it asks again every 20 seconds (`watchUnlockShare`), and at
  once when the reader comes back to the tab, which is the likeliest moment after sharing from
  another app. It stops once unlocked, or after 30 minutes. That is at most 180 calls an hour against
  `/api/referral`'s 300.
- **Nothing to pay, nothing shown.** While a free report is written, the sheet takes `.is-free-run`:
  the price, the wallet and card buttons, the promo code, the *Or pay* heading and the payment terms
  all go, and only the progress is left.
- **The front page** says it under the Psyche Report's blurb (`insights.premiumHow`): *US$5 – or
  free for your first one when you share your link with a friend and they open it.*
- **Credits are separate.** Every 3 friends' cards earn one credit, and the friend who unlocked the
  first report counts toward them. A credit is spent only on a gift today
  (**Gift a Psyche Report (1 credit)**, `claim`, a `gift:<code>` grant). A gift grant is refused for
  the code that made it, so it is for someone else. Premium features to spend credits on are to come.
  *Use it* is gone, and friends' paid reports are no longer counted (`afterPaid` is removed). Old
  grants keep working until they expire; old unclaimed rewards were not carried over, and credits
  start from `ref:<code>:spent`, not the old `claimed`.
- **Terms, privacy and FAQ** say the same: the first report free once 1 connection makes their card from the link (an open, until the October 2026 fixes), re-runs
  paid, 3 cards a credit, and that the scrambled account code also notes whether an account has had
  a Psyche Report.

**Receiving a gift.** The grant is a bearer token: it unlocks one full report, once, within 60
days, for whoever holds it.
- Opening the link keeps it on the device (`psycheai_gift`) and takes it out of the address.
- A 🎁 banner says a free full report is waiting. On the welcome page it says to make a card first;
  on a report it offers to unlock.
- The unlock sheet offers *Use your gifted free Psyche Report* ahead of the share-first offer.
- The gift is cleared once a full report is written with it.

## The QR code's explanation

The QR code in the foot of the reader's own card is one of the card's explained parts (`qr` in
`GUIDE_TARGETS`). Pointing at it, or tapping it, says: *Share this QR code, or your link, with friends.
When they open it and make their free Psyche Card, you see how well you sync.*

## The Psyche Card on a phone

On a phone there is no "Tap to open full screen" button. A faded expand mark sits in the card's
bottom-right corner (`.psyche-card-expand`). It pulses twice on arrival, and not at all with reduced
motion. A tap anywhere on the card opens it full screen, as before. The card has a thin, faint edge,
an inset shadow drawn at the card's own scale. With a
part explained, a tap anywhere outside the explanation puts it away, including a tap on another
part. The tap returns to the card rather than opening the next explanation. This applies on the
page (touch screens), full screen, and on the sample cards. With a pointer, hovering still moves
the explanation from part to part. The explanation's border and the ring around the part it explains are
thin and faint: a 28% accent hairline, and a 3px ring at 38%.

## The plan's horizons

*Your plan* shows a column only for a horizon that has steps, as the PDF already did. An empty one used
to say *Nothing here yet*. The premium prompt also asks that, across the development and career
actions, the plan covers this week, this quarter and this year, at least one each. Before, it only
required one *this week* action, and a model could leave *this year* empty. The wellbeing suggestions
always count as *this week*.

## One share message

Every share and copy of the reader's link sends the same message, from `shareMessage()` in
`docs/app.js` (`TEXT.cardShareText`):

> I got Mulan on my Psyche Card. Get yours free, no questionnaire: psycheai.io/c/…

It is used by:
- the card's **Share Card** (with the card image) and **Copy link**;
- Your Referral's **Copy link**;
- My Syncs' **Copy link**;
- the roast's story image, and **Share PDF** on a sync's result;
- the classic layout's Send my link.

A gift link keeps its own message, since it is a different link. The free card's unlock button
also names the other way in: *or get 2 connections to make their Psyche Card from your link*.

**About the founder, at the FAQ's foot.** After "How do I contact PsycheAI?", in small print under a
thin rule: *Jared, Founder · PsycheAI, founded 2026*, one line on the background (private equity and
venture capital; AI tools focused on psychology-based personality analysis and life coaching
across relationships and career) and a LinkedIn link. There for the reader who looks rather than as a
headline, and not an `h3`, so it is not one of the FAQ's questions on `/faq` or in its FAQPage data.

## Policies: privacy, terms, refunds

Three static pages, served at `/privacy`, `/terms` and `/refunds` like the guides, and listed in the
sitemap. They are linked from every page's footer, from the FAQ's contact answer, and from the payment
sheet (*By paying you agree to the terms. Full refund within 24 hours*). The operator is PsycheAI,
Singapore, and the pages are dated 9 October 2026. The terms set the minimum age at 18 and Singapore
law. A refund is given for any reason within 24 hours of payment, and at any time if a paid report
cannot be delivered. A payment is found by its date, amount and the card's last four digits, since there
is no account. The privacy policy restates what this README says the code does: the summary goes to
Gemini or Claude, finished reports are held in memory for four hours (`lib/results.js`), and Upstash
holds what is listed under "Kept across deploys". **Change the pages when the code changes what it
keeps.**

**Agreement before anything is sent.** The terms used to be agreed only at payment, and the free path
never reaches the payment sheet. So the review sheet now says, just above **Send this**, *By sending,
you agree to the terms and privacy policy* (`#review-legal`; until 25 October 2026 it also had the reader confirm
they were 18 or over, which the terms themselves still require). Its
opening line said *None of this data or the results can be accessed by PsycheAI or others*, which
was not true: Gemini or Claude read the data, and the server holds the finished report in memory for
four hours. It now says *PsycheAI keeps no copy of this data or your report*. The review rows count
in the right number too (*1 comment*, *1 hashtag*), and leave out a hashtag clause when there are
none.

**Not affiliated.** Every page's footer says *PsycheAI is independent and is not affiliated with,
endorsed or sponsored by Instagram, Meta or Google* (`.footer-note`). The terms' section 7 says the
same for Facebook and WhatsApp, and that MBTI is The Myers-Briggs Company's trademark.

**Page not found.** An address that names no page gets `docs/404.html` with a 404 status: what to do
next, a link home, and the contact address. It uses absolute paths throughout so it works at any
depth, and carries `noindex`. A missing script, image or other file still gets a plain-text 404.

**Smaller launch fixes.**
- The front page's **sample cards follow the card rule.** Patterns and write-ups are neutral or
  positive. For example, *Humour that lightens the room* replaces *Humour as a pressure valve*, and
  *Generous with attention* replaces *Generous with attention, sparing with disclosure*. The premium
  sample report still names costs, as a real one does. The link preview (`og-card.jpg`) was redrawn
  from the new sample. `promo/capture.mjs` now hides the full-screen viewer's arrows before its
  picture, which it does through the DOM because the CSP refuses an injected stylesheet.
  `docs/media/psycheai-intro.mp4` still shows the old Mulan wording: rebuild it with `npm run promo`.
- **The front page's video plays by itself in Chrome.** `Permissions-Policy` had `autoplay=()`,
  added before the video. It made `play()` reject without a tap, so the silent loop never started.
  It is now `autoplay=(self)`. `ambient-light-sensor` and `battery`, which Chrome does not recognise
  and warned about on every page, are gone.
- **Psyche Sync promises one thing everywhere:** *how to relate better to each other*. That covers
  the front page, the FAQ, the compatibility guide and the free card's blurb.
- **Search results:** every page title is 60 characters or fewer, and every description 155 or fewer,
  so neither is cut short.
- **The promise under "Load your data"** now says only what is literally true: *Your Instagram file
  never leaves your device. Only a de-identified summary, which you check first, is sent to Gemini or
  Claude to write your card — and PsycheAI keeps no copy of it or your report. No sign-up, no cookies,
  no trackers or third-party analytics.* It links to the privacy policy. The old version said *No one
  can see that you visited, let alone what you uploaded*. That was not true: the host sees an IP
  address, and PsycheAI counts daily totals. It also said the data was *kept on your device*, when the
  summary is sent.

## My Psyche and My Report

A paid structured report is split into two pages, which are two modes of `#view-profile`
(`profilePage` in `docs/app.js` is `'hub'` or `'report'`).

- **My Psyche** (`go('profile')`) has the Psyche Card and its guide at the top, then a fixed order:
  - the secret roast
  - Evidence and method
  - Your Referral

  *Beyond your card* used to sit under the roast; it was removed in October 2026 (see "The K5
  card, and Beyond your card").

  Once paid, the way into My Report is **See Psyche Report →**, one button across the card's three
  tools (`.cx-open-report`), with an arrow on its right (`.cx-open-arrow`) that nudges right on hover. A free reader has the unlock box under the secret roast instead. The card
  panel and, on a phone, the top of the card's box carry the same light wash as My Syncs' header.
  The panel's purple top line is part of its background rather than a `::before` strip: the panel
  cannot clip (the card's popouts spill out of it), so a strip ran square past its rounded corners.

  A free reader sees the same page, with the unlock box in place of the tile. My Psyche has no
  *Download full report*; its footer is **Save a backup** and **Delete everything**, with the
  run's note (model and date) right beside them.
- **My Report** (`go('full')`, nav `#nav-full`) opens with a header built like My Syncs' one
  (`reportHeroHtml`, `.report-hero`): a purple pill, the title **Your Psyche Report**, a one-line
  lede (*The working behind your Psyche Card: what each result means, the evidence for it in your
  own data, and what to do with it.*), and the character's emblem in a gradient disc. The pill reads
  *6 parts · N pages* (the overview and five parts). N is counted from the real PDF (`reportPdfPages` builds it when the browser is
  idle, counts its pages, and caches the count per report), so until then it reads *6 parts*.
  The part nav has no title of its own and no purple line on top (`.part-nav.is-report`). On a
  laptop it is the left column, its top level with the header (`--side-nav-top`, measured in
  `layoutSideActions`). On a phone (under 760px) there is no part nav at all: nothing floats over the
  report, and the part headings are the way between parts. Part heads
  are smaller than before: the title is 1.15rem, the number about 2rem. Then come Parts 00 to 05
  (see "How you connect and How you work, apart" below); the roast is on My Psyche. The card is not repeated at the top. The left bar's action
  row starts with **← Back** (`#report-back`), before Download, and returns to My Psyche.
- **Open or shut by default:** on a laptop every part starts open; on a phone (under 760px) Part 00
  starts open and the others shut.
- **One part at a time on a phone:** opening a part shuts the others and brings its top to the top
  of the screen, clear of the site's header. On a laptop, parts open and shut on their own, and a
  jump from the left column opens the part it lands on.
- **No sync bar:** My Report never shows the "You + Jared" bar.

The nav shows My Report only once the report is unlocked. The current page is marked the same way
on every link (My Psyche, My Report, My Syncs, FAQ): `.is-current` with `aria-current="page"`, in
bold purple and nothing more. At 640px and below the nav uses short labels: Psyche, Report, Syncs, FAQ. My Report
gets its own history entry, so the phone's Back button returns to My Psyche. After payment the reader
lands on My Report at Part 00. The note at its head says *Your Psyche Report is only saved in this browser, and not on PsycheAI's servers. Download [PDF] or [full backup] to keep it.*, the two choices buttons inside the sentence (26 October 2026; before, *Your Psyche Report is ready! It is saved only in this browser, and PsycheAI keeps no copy. Download the PDF to keep it.* with a Download PDF button). Either puts the note away for good. There used to be a second, green *Your Psyche Report is ready.* note above it, with a ✕, fading after ten seconds; it was removed in October 2026 as one note too many, and its words went into the keep note. A classic-layout report stays on
one page.

## Save a backup, and restore it in another browser

Everything a reader has lives in one browser's `localStorage`, and the server keeps no copy. A
cleared browser, a new phone or **Delete everything** therefore meant starting again, and paying
again for a report already bought. **Save a backup** (`#save-backup`) writes it all to one file,
*Psyche Backup - Name - DDMMYYYY.json*. It is on both pages:

- **On My Psyche** it sits at the foot, spelled out in full, beside Delete everything. Delete
  everything is its red bin alone, and shows the tooltip *Delete everything* on hover or focus
  (`::after` with `attr(data-tip)`). On a phone the two buttons share the first line and the
  run's note takes the next, across the screen; beside the wider backup button the note had been
  squeezed into a narrow column.
- **On My Report** it is the third of the actions under the part nav. Those are one word each
  there (**Back**, **Report**, **Backup**; `Copy.STRUCTURED.actions`), since the row is 232px wide,
  and each keeps its full name as its `aria-label`.

**Restore from a backup** is a small link left of Continue in the *Add your data* popout
(`#restore-open`). It is shown only on a first upload in a browser with no card (`askDataSources`
with `first`), and the handler refuses anyway, so a restore can never replace a card. On a phone the
link takes two short lines rather than pushing Continue under Back. A good file closes the popout
and lands on My Psyche. `restoredBackup` stops the upload that opened the popout from treating that
close as Back and returning to the main page. A bad file leaves the popout open, with the reason
above its buttons.

Since October 2026 a good file reloads the page instead of drawing My Psyche in place. A reader
reported landing back on the main page after a restore. The cause did not reproduce here, but
drawing in place depended on every part of the drawing succeeding. A reload takes the path every
returning reader takes: `boot()` lands on My Psyche and sets up the link, the Syncs and the
referral as usual.

**Save a backup from the Delete everything sheet.** Its buttons are *Cancel*, *Save a backup*
(`#delete-backup`) and *Delete everything*, in that order. Saving keeps the sheet open, so deleting
is still the reader's next choice, now with a copy kept. On a phone (480px and under) the three
stack full width.

- **What goes in** (`BACKUP_KEYS` in `docs/app.js`): the profile (card, report, paid sections),
  the digest (so the full report can still be bought without loading the export again), every Psyche
  Sync (`history`), the ticked plan, `pdfSaved`, and the personal link with its invite secret
  (`link`, `referral`) and the account code. The link and secret matter: with them, the restored
  browser has the same `/c/<id>#<key>` link, and Syncs sent back to it (`lib/syncbox.js`) are still
  collected there.
- **What stays out:** anything mid-purchase or mid-run (`unlock`, `pending`, `job`), other people's
  invites, banners, and the runs count.
- **Format:** `{ kind: 'psycheai-backup', v: 1, savedAt, data: { … } }`, the stored values exactly
  as they are.
- **Restoring checks every part** (`readBackup`). The file could be any .json, or could have been
  edited, so a part with the wrong shape is left out rather than stored. The card must decode from
  its own payload, or nothing is restored. The invite code is worked out again from its secret, and
  the link is kept only beside a valid secret, since it is saved under that code. Files over 5 MB are
  refused. A restored card counts as an analysis already had (`psycheai_runs` becomes at least 1), so
  restoring is not a way to a fresh free analysis. The server's one-free-card-per-account rule
  holds regardless.
- **No new trust:** a reader could always edit their own storage, so a hand-edited backup unlocks
  nothing they could not already fake locally. Giving a backup to someone else gives them the
  report and the link, the same as sending the PDF and the link.
- **FAQ:** *How do I keep my report from getting lost?* (October 2026) says the card, report and
  syncs live only in this browser, and points to Save a backup and Restore from a backup.
- **Privacy:** the file is made and read in the browser, like the PDF. The FAQ and the privacy page
  say so, and say to keep it private because it holds the link's key. The Delete everything sheet
  suggests saving a backup first.

## Ask PsycheAI: questions about your own report (October 2026)

A reader with a full Psyche Report can ask it questions and get coaching built on it. It is paid
per question: **five for US$5** (`ask` in `docs/prices.js`, the report's price in every currency),
and every credit Your Referral earns (three friends' cards) is one more question.

**What the model is given: the report and card, and the digest the report was written from.** At
first it was the report alone. Since the browser now keeps each report's own digest
(`psycheai_report_digest`), Ask PsycheAI sends it too (`askDigest`), or the standard digest for a report
made before that was kept. The report's conclusions are what the model builds on. The digest is
evidence for fresh, concrete examples, never a reason to overturn a conclusion (`ASK_SYSTEM`). The
server holds the digest to `forModel` and the premium read's size, and answers from the report alone
when there is no digest or it is over. The reader's own name goes back to "PsycheUser" before the
report is sent (`askReport`) and comes back into the answer on the device (`askOwnName`). The last
three questions and answers go along for follow-ups.

**Answers draw on the data, and say so** (October 2026). Early answers opened with "Looking across
your report…", which read as if only the report had been read, because the prompt said "Answer from
the report" and gave "your report reads you as…" as its example. `ASK_SYSTEM` now has the model answer
as someone who knows the reader from both the report and their own data. When the evidence holds a
pattern that fits the question, it grounds the answer in at least one concrete one. It talks about
the reader, not a document: never "your report says" or "looking across your report". The server
returns `fromData` (whether a digest went with the question), and each answer carries a quiet line
under it: *Drawn from your report and the data it was written from.*, or, with no digest in the
browser, *Drawn from your report alone: the data it was written from is not in this browser.*
Answers kept from before this have no line.

| Context | Input tokens | Per question | Per 5-question pack |
|---|---|---|---|
| Report only (the first version) | ~12,000 | ~1.7¢ | ~8¢ |
| Digest only | ~38,000–53,000 | ~3.6–4.8¢ | ~18–24¢ |
| **Report + digest (chosen)** | ~48,000–64,000 | **~4.4–5.5¢** | **~22–28¢** |

These are at Gemini flash prices ($0.75 per million input tokens, $3.75 per million output), at 3.5
characters a token, with about 2,000 tokens out (answer plus thinking). Stripe's fee on US$5, about
55¢, is larger than any of them.

**Coaching, not just answers.** The prompt (`ASK_SYSTEM`, `ASK_SCHEMA` in lib/prompts.js) answers
from the report, names the finding it rests on, never invents evidence, stays on the reader's own
growth, is not therapy or diagnosis, and keeps the report's conduct rule. Each answer is 120 to 250
words, then *Your next steps* (one to three things for this week), then two follow-up questions as
chips. The empty popout offers six ready-made questions, coaching first (*What should I focus on
this week to grow?*).

**Credits** (`lib/askcredits.js`): kept under the reader's referral code, which only the holder of
its secret can spend from. That secret is in the backup file, so questions bought survive a new
browser.
- `addPack` adds five per verified `ask` payment, once per PaymentIntent.
- `spend` takes a bought question first, then a link credit (`referral.spendCredit`), before the
  model is asked, and gives it back if no answer comes.
- A payment is written down on the device before it is credited (`psycheai_ask_pending`), so a tab
  closed in between is credited on the next open.
- The stored record is counts only: no question, report or answer.

**Routes:** `/api/ask/credits` (a read, no ticket), `/api/ask/buy` and `/api/ask` (ticketed; `ask`
is limited to 30 an hour, since each call is paid for anyway). The question is held to 300
characters (`ASK_QUESTION_MAX`), the report to 150,000.

**Where it is:**
- **The floating button** (`#ask-fab`) on My Psyche and My Report is the way in. There used to be
  an *Ask PsycheAI* card under the roast on My Psyche and again at the end of My Report; with the
  button always on screen the cards were redundant and were removed (October 2026).
- **My Report:** at the foot of every part, *Ask PsycheAI about this →* opens it with *About "Who
  you are": * already typed.
- **The name** was *Ask Psyche* until October 2026, when it became *Ask PsycheAI*, everywhere it
  appears (panel, button, payment sheet, FAQ, privacy page, terms).
- **A panel you can minimise, not a page or a modal** (October 2026). It opens with `show()`, not
  `showModal()`, so nothing behind it is blocked:
  - **On a phone (760px and under):** a bottom sheet, 85% of the screen, with a handle, edged in the
    accent colour along its top and sides with a shadow cast up over the page, so it is plainly apart
    from the page beneath (a thin grey line was easy to miss). On a laptop the border is a softer accent. A tap or a
    swipe down on the handle or the head minimises it. The sheet follows the finger; let go past
    60px and it minimises, otherwise it springs back. The handle and head carry `touch-action: none`:
    without it a phone's browser took the drag as a scroll and cancelled the pointer, so the swipe
    did nothing.
  - **On a laptop:** the page never moves for it (`placeAsk`). The panel opens 12px right of the
    report's column when there is at least 320px beside it (up to 400px wide); with less room it
    floats over the page at the right. It used to shift the column and the part nav left to make
    room (`body.ask-docked`), which moved the report away from where the reader was looking. Both
    the button and the panel are placed from the left edge, as the column is measured: the gutter
    kept for the scrollbar (`scrollbar-gutter: stable`) put a `right` offset about 15px short.
  - **Expand, on a laptop** (October 2026): a round button beside – (`#ask-expand`, *Expand* / *Back
    to the side*) makes the panel fill the screen under the site's header (`.ask-dialog.is-wide`), the
    conversation and the box kept to 820px in the middle and set a little larger, for reading long
    answers; again, it goes back to the side. It stays as it is through minimising. A phone has no such
    button: its sheet already fills the screen.
  - **Minimising:** the – button, the handle, or Escape anywhere on the page (unless another popout
    is open on top). The floating button reads **Ask PsycheAI** on a laptop, sitting at the
    bottom just right of the report's column, outside it, rather than in the window's corner (inside
    the column's bottom right only when there is no room beside it), and just **Ask** on a
    phone (`.ask-fab-long` / `.ask-fab-short`; its `aria-label` is always *Ask PsycheAI*). The phone's Back minimises it too: opening it pushes a history entry
    (`askHistoryEntry`), the popstate listener minimises the panel before anything else, and the – button
    gives the entry back (`minimiseAsk`). Before this, Back on My Psyche left the site with the panel
    up. `show()` counts the entries it has to give back (the page's and the panel's) and gives them back
    in one `history.go(-n)`, reusing one for a page it is about to push, since two `history.back()` calls
    in a row, or one followed by `pushState`, race each other. It leaves a floating **Ask PsycheAI** button (`#ask-fab`) at the bottom right of
    My Psyche and My Report, shown only once the reader has the report. The button is one slim line
    (`white-space: nowrap`, a smaller mark and padding): on a small laptop, placed just right of the
    report where the margin is narrow, it used to wrap into a fat two-line pill. An answer that lands while
    minimised turns it into **Answer ready**, with a soft pulse, until it is opened.
  - **Nothing is lost:** the conversation, a half-typed question and an answer still coming all stay.
  - **Not a separate nav page:** on a phone the nav already has four short labels, and Ask PsycheAI is
    most useful beside the report rather than instead of it.
- **Ideas, out of the way.** The ready-made questions are no longer on the screen. They sit behind a
  small **💡 Ideas** button by the character count, which opens a short scrolling list above the box.
  Tapping one fills the box and folds the list away. Opened from the floating button, the panel
  shows the ideas straight away, over about the lower half of the conversation (the list is held to
  `40dvh − 4rem`), and a ✕ on them folds them back under the Ideas button. When the button says
  *Answer ready* they stay folded, so the answer is what is seen. With no questions left the box and Ideas
  stay, and only the Ask button gives way to *Get 5 questions*. At first the whole box was hidden
  then, which hid the Ideas button with it, so a reader without questions never saw the ideas. They are ten deeper questions the report does
  not already answer, ordered from the most universal to the most specific, career last:
  1. Who am I when I'm not being useful, impressive or needed?
  2. What do I keep trying to prove, and to whom?
  3. What would make my life worthwhile, even if nobody ever knew what I achieved?
  4. What would I regret most about my life when I'm old?
  5. What do I already know needs attention in my life, but keep putting off because it means a hard
     choice?
  6. Which commitments deserve my loyalty, and which need rethinking?
  7. How can I show up better for my partner, my family and the people closest to me?
  8. Should I move abroad and start again? If you picked one country for me, which would it be, and why?
  9. How can I become a better leader, at work and with the people around me?
  10. I'm thinking about a big change in my career. Is it right for me, given everything else in my life?

  Two of the twelve proposed were left out. *My life has no meaning and no purpose* overlapped with
  question 3 and reads as distress put in the reader's mouth. *My happiest and saddest moment* is
  something the data cannot reliably show and could surface a loss. The empty panel says one line:
  *Ask PsycheAI anything about yourself.* (It added *Need a starting point? Tap Ideas.* until the
  ideas opened by themselves.)
- **The keyboard:** the box takes focus only with a fine pointer (a laptop). On a phone the keyboard
  is never pulled up unasked, including from *Ask PsycheAI about this →*, which starts the question
  but leaves the reader to tap the box. The character count sits close under the box (the textarea
  is a block, the row 0.2rem below it, and the count at the top of the row rather than centred on
  the taller Ask button).
- **The popout** (`#ask-dialog`, `openAsk`): the conversation so far, a counter of questions left,
  and a box with a character count. When none are left, *Get 5 questions* opens the ordinary
  payment sheet for the `ask` product, with no share box. **Promo codes work on it** (October 2026):
  a discount re-prices the five questions like any other product (`/api/create-payment-intent`
  with `product: 'ask'`; `verifyPaid` holds the payment to the discounted price written on the
  intent, and `/api/ask/buy` spends the code's use). A code worth 100% skips paying:
  `/api/ask/buy` takes `{ secret, promoCode }` and adds five questions. Its use is counted against
  the reader's link (`ask:<link code>`), and the pack's id is `promo:<CODE>:<link code>`, so one reader
  gets one pack from a given code. It was trimmed to that
  in October 2026: the subtitle is *Your personal coach.*, the empty state is the six questions under
  *Try one of these*, and the line under the box reads *Your question goes to Gemini for this one
  answer; PsycheAI keeps no copy. Answers are saved only in this browser.* Referral credits are named
  only when some of the questions left are theirs (*Includes 1 question from your Referral
  credits.*).
- **Storage:** every question and answer is kept in this browser (`psycheai_ask`, the latest 50), in
  the backup file (`BACKUP_KEYS`), and goes with Delete everything.

**Everywhere, and out of the way** (October 2026):
- **On every page** once the report is unlocked (the front page, My Syncs, the FAQ too), not only
  My Psyche and My Report; the panel stays open across them.
- **The page behind keeps scrolling.** The rule that freezes the page under a popout
  (`body:has(dialog[open])`) now leaves Ask PsycheAI's panel out: it sits beside the page, not over it.
- **On a phone the sheet fills the screen below the site's header** (`--header-h`), so the logo and
  menu stay in view, and **a swipe down from anywhere on it minimises it**: from the conversation only
  once it is scrolled to its top (otherwise the swipe scrolls it), never from the box being typed in.
- **Minimise is a filled round button**; the bare "–" read as a dash.
- **Typing a question of your own folds the ideas away**; an idea tapped fills the box without doing so.
- **"Get 5 questions" stays in view** with none left: the conversation gives way first
  (`min-height: 0`), where the ideas list used to push it out of the panel on a phone.
- **An appendix of every question asked** at the foot of My Report (`askAppendixHtml`, refreshed after
  each answer): the question as a line, its answer and steps folded under it. The PDF prints the same
  appendix after Evidence and method, answers in full (`asked` in `buildReportPdf`).

**The hero's lede** now pitches the coach: *Your personal AI coach that already knows you, built
from your Instagram data and digital footprint.* It used to list MBTI, love languages, wellbeing and
career strengths "with zero quizzes required"; the headline above it, *No questions asked.*, already
says the second half.

**On the front page**, under the Psyche Report's tier, Psyche Sync's "Free" is a green pill beside its
name (`.insight-free-pill`), and under it a line of its own offers *Ask PsycheAI*: a personal coach that
already knows you from your report, with its price for five questions (`.insight-ask`, the price from
`docs/prices.js` in the reader's currency). The how-it-works steps stay four; step 2 names Gemini alone.

**After Save a backup** a popout says what the file is for, in plain words: it holds the card, the
report, the Syncs and the questions; if this browser loses them, open PsycheAI elsewhere, tap *Load
your data*, then *Restore from a backup*; keep it private (`backupSaved` in copy.js). Both Save a
backup buttons carry a tooltip saying the same in one line.

**Privacy wording changed with it.** The FAQ and privacy page used to say the finished report never
leaves the device. They now say it stays on the device unless the reader uses Ask PsycheAI, when the
report, its digest and the question go to Google Gemini for that one answer and PsycheAI keeps
none of them. The
privacy page also lists the question counts, and the terms describe the questions.

**On the front page** the Psyche Report wears the Psyche Card's own green **Free** badge over its
title (`.tier-badge-free`), and its head carries no price. The price of a re-run is a footnote under
what comes with the report, *Re-runs are US$5.* (`.insight-rerun`, `premiumRerun`), in the reader's own
currency, the one checkout charges (S$7 in Singapore). It replaced, in late October 2026, a gift tag
beside the price in the head, *Your first one is free! then S$7* (`.premium-free-badge`), which read as
a price first and a gift second; before that the tag said *Share with a friend and get it free!*.

**The privacy note on the upload card** is a lead line, *We take the privacy of your data seriously.*,
then four points: the Instagram file never leaves the device; only a de-identified summary, checked
first, is sent to Gemini or Claude to write the card; PsycheAI keeps no copy of it or the report; no
sign-up, cookies, trackers or third-party analytics. Then the link to the privacy page. It was one
paragraph of the same claims, which read as small print; the wording of each claim is unchanged, so
each stays literally true.

## The Overview goes free, and Ask PsycheAI starts with the card (October 2026)

The free card's call now also writes the report's **Overview**: the executive summary
(`STRUCTURED_SUMMARY`, about 120 words, moved up beside the free schema) and the signature patterns
whole, with their two to four pieces of counted evidence and `showsUpIn`. My Psyche shows it open
under the card (`freeOverviewHtml`), then the secret roast, then the locked offer, whose five parts
now each carry a lock (`unlockPartsHtml`). A free reader still has no My Report page.

- **Why:** the card says *what* someone is; the Overview is the first taste of *why*, which is what
  the US$5 report sells. Giving it away costs about half a cent a card and shows the report's quality
  before the paywall instead of describing it.
- **The paid run is anchored to it.** `anchorFrom` carries the summary (`ANCHOR_SUMMARY_MAX`, 1,400)
  when the card's patterns have their evidence, and `fullSchemaFor` then sends
  `STRUCTURED_OVERVIEW_PINNED_SCHEMA`: the pinned schema without `summary` or `patterns`, so the
  paid report neither rewrites nor contradicts what the reader already read, and its output is about
  600 tokens shorter. `overlayCard` puts both back from the card. A card made before this has neither
  and its report writes them as before.
- **`hasExplanations`** used to treat any `summary` as a whole report (from the days the free run was
  the full report). A free card has one now, so the old test also needs a section only a full report
  has (`career`, or `relationship.strengths`).
- **Cost:** the free prompt measured 10,528 tokens (`FREE_FIXED_INPUT_TOKENS` 10,600). Output stays at
  10,000: the Overview is about 550 tokens of it, out of the room left for thinking. `FREE_COST_CAP`
  $0.072 → $0.073, `SOLO_FREE_COST_CAP` $0.063 → $0.064; `DEEP_FREE_COST_CAP` stays $0.084 ($0.0838).
  If `npm run usage` shows card calls stopping on MAX_TOKENS, this is the first place to look.
- **Gemini:** the free schema gains one string list and one enum list (the 11 `SECTION_KEYS`). It
  stays under half the full profile schema's size (a selftest check), but only a live run proves
  Gemini accepts it.
- **Ask PsycheAI from the card.** `askReady` no longer needs a report. Free questions go into the same
  count a bought pack does (`lib/askcredits.js`, `gift`): one with the card, once per referral code
  (until 18 Oct 2026, one more with the Psyche Report). The card's is given when any card is written for the link (free
  or a re-run) and, for a link that already had a card, the first time its balance is read — at first
  it came only with an account's first free card, so a reader who had made one before never got it.
  The report's was two at first, then one. The gift is awaited before the run replies: it used to
  be fired and forgotten, and on Redis the page's balance read (made as soon as the report landed)
  could beat it, so a reader who unlocked with the card's question unused saw 1 where they had 2,
  and kept seeing it. The page also reads the balance again once an unlock finishes. The prompt is told a reader
  may have only the card and its Overview, and never to point them at a section they lack. The answer's
  source line says "your results" rather than "your report".
- **The first report** still unlocks when one person opens the reader's link: easy on purpose for now.
- **Once unlocked, both move to My Report.** The Overview is its Part 00, as before, and the roast
  leaves My Psyche to become **Appendix 1** after the five parts (`secretRoastHtml(bonus, { appendix:
  true })`), with the Ask PsycheAI questions as **Appendix 2** (`askAppendixNumber`; unnumbered on a
  report with no roast). The PDF follows the same order: the roast on its own page, then the questions.
  My Psyche, unlocked, keeps the card, Evidence and method, and the link.
- **The appendix is Part 06.** Both sit in an Appendix part after Part 05, with its own numeral and an
  entry in the part nav (`06 Appendix`), opening and shutting like the other parts. Each is a section
  under the same header every section has (icon, title, a line under it): *Appendix 1: Let us roast
  you* (`roastBlock`, still behind its reveal) and *Appendix 2: Ask PsycheAI*, with the count of
  questions under it. The header's "N parts" count and the sample report leave the appendix out.


## Counting what works, without counting anyone

The site promises no trackers, no cookies and no third-party analytics, and that no one can see
that you visited. That rules out the usual way of knowing which post, creator or campaign worked. What it
leaves is counting the work the server already does, as totals.

**`lib/stats.js`** keeps, per UTC day: free cards (`card`), paid re-runs (`card_paid`), full reports
(`full_report`), compatibility reports (`compatibility`), cards made while a friend's compatibility
link was waiting (`card_from_invite`), cards and reports from a campaign link (`via:<code>`,
`via:<code>:full_report`), promo redemptions (`promo:<CODE>`), and the invite-friends flow (`referral_friend`,
`referral_claimed`, `referral_report`, `free_refused_account`). The **journey** is counted too, step by
step, overall (`step:<step>`) and per campaign link (`via:<code>:<step>`): `open` (arrived on a
`?via=` link), `export_loaded` (an Instagram export read on the device), `unlock_open` (the unlock
opened), `referral_open` (arrived on a friend's link) — sent by the page to `POST /api/event`, once
per step per day per browser, with nothing but the step and the campaign code — alongside the
server's own `via:<code>` (card made) and `via:<code>:full_report`. Each report is counted once per report
actually written: the result cache answers a repeat of the same digest without generating, so a
retry is not a second card. There is no IP, device, digest or time finer than the day anywhere in
it, and the only visits counted are arrivals on a campaign or friend's link. The last 31 days are kept in memory
and every day in the store (see [Kept across deploys](#kept-across-deploys-upstash)); each day's totals are
written to the log as one line when the day turns and when a deploy stops the process
(`stats 2026-11-11 {"card":41,"compatibility":12,"via:ava":9}`), so they survive a restart in the
host's logs. `GET /api/stats` with `Authorization: Bearer $PSYCHEAI_STATS_TOKEN` returns them.

**`?via=<code>`** is how a creator's link is told apart: `psycheai.io/?via=ava`. The page reads it
on arrival, keeps it on the device for 14 days (`psycheai_via`, in `KEYS`, so *Delete everything*
takes it) because the export takes hours and the card is made on a later visit, takes it out of the
address so it is not passed on, and sends it beside the digest with the analysis — never in the
cache key. The server accepts only short lower-case codes of letters, digits and dashes, and drops
anything else rather than counting it.

**Creator codes** (`lib/promo.js`, `PSYCHEAI_PROMO_CODES`) are promo codes a creator can hand out:
each has a cap — the number of different reports it can unlock — and optionally a last day. The
single `PSYCHEAI_PROMO_CODE` still works, uncapped, for the operator; it could never be given out,
because whoever it leaked to had unlimited free reports. A code at its cap still answers a retry for
a report it already unlocked (it remembers SHA-256 hashes of what it unlocked, never the digests)
and refuses a new one with *That code has been used up.*; past its last day it says *That code has
expired.* The counts are in memory like everything else here, so a restart starts them again: set
caps with that in mind, and the end date bounds it.

**Discount codes.** A fourth field takes a percentage off instead of opening the report for free:
`HALF:100:2026-12-31:50` is 50% off, at most 100 uses, until the end of 31 December 2026. Leave a
field empty to skip it (`HALF:100::50` never expires; `HALF:::50` has no cap and no end). Left out,
the percentage is 100 — every code written before this behaves exactly as it did. A malformed
percentage (`5o`, `0`, `150`) drops the code rather than defaulting to 100, so a typo can never turn a
discount into free reports.

- **In the unlock sheet**, Apply asks `/api/create-payment-intent` about the code first. A 100% code
  comes back as `{ free: true }` and unlocks as before; a refused one says why on the sheet; a
  discount comes back as a new PaymentIntent for what is left of the *local* price (50% of US$5 is
  US$2.50, of S$7 is S$3.50, of £4 is £2), the sheet's price box changes from *Price US$5* to the
  original price struck through, *Promo HALF (50% off) −US$2.50* and *You pay US$2.50*
  (`renderPremiumPrice`), says *Promo code HALF applied: 50% off.*, and the wallet button, card form
  or mock button are re-mounted for that amount.
- **Codes are capitals.** The promo field turns lower case into capitals as it is typed or pasted and
  drops anything that is not a letter, digit or hyphen. Write codes in capitals in
  `PSYCHEAI_PROMO_CODES`; the server still matches them case-insensitively.
- **The server writes the code and its percentage onto the PaymentIntent** (Stripe `metadata`).
  `verifyPaid` holds a payment to the discounted price only when that metadata is there, and only
  this server can write it — a client cannot claim a discount, and a half-price payment presented
  without one fails as the wrong amount.
- **A discount code never opens anything by itself.** Sent straight to `/api/analyse` or
  `/api/premium`, it is refused: *That code takes 50% off. Enter it on the payment sheet and pay the
  rest.*
- **Only the server's answer makes a code free.** A code is called free only when
  `/api/create-payment-intent` says `free: true`. Any other failure (a rate limit, the network,
  Stripe) is said as such, *Promo code JIALAT75 could not be checked just now. Tap Apply to try
  again.*, and nothing else is offered. The page used to take any failure for a 100% code, so a 75%
  code read *unlocks the Psyche Report free* whenever the check failed, which happened most often from
  the rate limit: opening the sheet asked for a full-price payment and then for the link's code, two
  of the route's six a connection every 10 minutes. A code from the link is now checked first, and the
  full price is asked for only when it is not a discount: one request per opening.
- **A use is spent when the paid report is written**, not when the sheet is opened, and counted under
  `promo:HALF` in the stats like any other code. Expiry and the cap are checked before anyone pays;
  a reader who paid just as the cap ran out is still served.
- **Never below Stripe's minimum charge** for the currency (`MINIMUM` in `docs/prices.js` — 50 cents,
  30p, HK$4, ¥50, RM2): a 95%-off code charges the minimum rather than an amount Stripe would refuse.
- **Running the card again takes codes too.** The sheet for a card past the free one (US$2) prices a
  code exactly as the unlock sheet does: a discount re-prices it (50% off is US$1, S$1.50), a 100% code
  runs it free, and a code in the reader's link is filled in there as well. Codes once applied to the
  full report only, which left a reader holding a discount code with nothing to use it on before they
  were ready for the report. One code covers both, and a capped code spends one use per distinct
  digest whichever it buys. Psyche Sync is free, so a code there is refused.

**To create one on Render**: Environment → `PSYCHEAI_PROMO_CODES` → add `NEWCODE:cap:YYYY-MM-DD:50`
to the comma-separated list → Save, which redeploys. Use counts reset when the server restarts (each
deploy is a restart), so the cap is per deploy until the counts have somewhere permanent to live.

The FAQ says all of this under **Does PsycheAI count anything?**, and a UI check holds it to that.

## The sample report

The welcome page asks for a 400MB download from Instagram and an email that takes hours to arrive,
in exchange for something the reader has never seen. **See sample report** — in the hero and again
under the diagram — closes that gap: it renders `docs/sample.json` through the same `renderProfile`
a real report goes through, so what appears is the actual layout rather than a picture of one.

The sample card carries a person's name, **Emily Carter**, rather than the word "Sample": it is the card
the welcome page and the promo video show, and a placeholder there read as unfinished. The dialog
around it still says plainly that it is a sample.

It is hand-written rather than taken from `lib/mock.js`. The mock says *"Mock reading for
agreeableness. In a real run this is several sentences grounded in the actual export"* on purpose,
which is exactly right for a fixture and useless as a shop window. It is also deliberately not
flattering — two relationship weaknesses, two career weaknesses, a 68/100 confidence and a
`(tentative)` attachment read — because a sample that only praises misrepresents what the model
actually returns, and the reader finds that out at the worst possible moment.

It opens as a dialog over the page rather than as a view of its own — something to look into and
step back out of. A title, a cross, and the report: the cross is the only control it offers, which
is why the head is pinned while the report scrolls under it. Nothing it does touches `state.profile` or storage, so the nav does not change
underneath it and there is no state to hand back.

**Back closes it.** On a phone, back is what people reach for to dismiss something covering the
page, and with no history entry to pop they leave the site instead. Opening pushes one; closing by
any other route pops it again, or the reader's next Back press does nothing and looks broken. A flag
keeps the two paths from chasing each other, since a close triggered by `popstate` must not call
`history.back()` a second time.

What it deliberately does not carry: the download buttons, **Delete everything**, and the
compatibility panel. Those all live outside `#profile-body` in `index.html`, so building only the
report sections excludes them by construction rather than by a list of things to hide that someone
has to remember to update. One of them is worse than clutter on a stranger's report — delete would
clear the reader's own stored profile.

The guard for each one now asserts the control **exists on the real report** before asserting it is
absent from the sample. Without that half, removing a control turns its guard into a check that
nothing is nothing — which is exactly what happened when **Re-run the analysis** was taken off the
profile page: its sample guard kept passing while guarding nothing at all.

Two bugs came out of building it, both invisible until measured. Styling the dialog `display: flex`
beats the user agent's `dialog:not([open]) { display: none }`, so the closed dialog stayed laid out
over the page and swallowed every click on it; the rule is scoped to `[open]` now, and a check asks
what is actually under the pointer after closing. And a closed dialog is still in the document, so
leaving the sample's markup in place left a second report's worth of sections shadowing the real
one's selectors — the body is emptied on close.

A self-test walks `sample.json` against `PROFILE_SCHEMA` field by field. A sample missing a field is
a field the renderer reads as `undefined` in the one report most visitors will ever see; deleting
`career.watchOuts` fails it by name.

## What is sent where

This is the part worth reading carefully.

| Stays on your device | Sent to the model |
|---|---|
| The `.zip` archive itself | An **evidence digest**: activity counts, hour-of-day and day-of-week histograms, posting regularity, a sample of your own captions and comments, accounts you follow, and the topics Instagram itself inferred about you |
| Every video — never opened | By default: about **14 of your own photographs**, downscaled, spread across your whole account history |
| Your full long-form report | The compact **card** — the same profile as short phrases — when someone runs a comparison |
| Direct messages, if you untick them in the pre-send review | By default: DM counts plus a sample of **your own** messages; about a third open with a short, anonymised line of the message they answered |

The right column's own heading used to just say "Sent to be read" — accurate, but silent on *who*
reads it, sitting directly beside a list a human never sees. It says "Sent to be read by AI model"
now, which is the fact that actually matters to somebody deciding whether to untick a row.

**The website names Gemini and Claude, and stops there.** `lib/grok.js` is a real, working provider —
a deployment can still set `XAI_API_KEY` and run on Grok exactly as before, and `lib/provider.js`'s
own tests still cover it. What changed is only the copy a reader meets: naming a third provider that
only some deployments run would be explaining this repository's configuration options rather than
answering the question the reader actually has, which is what happens to *their* upload. Grok's own
paid-API terms carry the same no-training clause the page states for the other two, so this is a
decision about what the reader needs told, not a narrower guarantee for anyone who does run it.

### The FAQ says exactly this, and is held to it

The in-app FAQ has to get somebody comfortable uploading their DMs and their search history, which
makes it the easiest page in the app to overstate. It says three things, and each is a promise the
code has to keep:

- **The archive is reduced before anything is sent.** Unzipping and digest-building happen in the
  browser; the summary is what is posted, and the reader can review it themselves in the pre-send
  dialog before it goes anywhere.
- **The summary reaches Gemini or Claude, and only for as long as the request takes.** It is held for
  the few seconds the analysis takes and never saved, stored or logged — the claim the page actually
  makes now. It does not name PsycheAI's own server as the hop in between, on the reasoning that the
  device-to-model story is what a reader needs; what it must not do is claim the opposite, that the
  summary reaches the model *directly*, bypassing any relay at all, since that would misrepresent
  `server.js`, which really is a relay. That negative is what the checks hold — see below.
- **There is no store to breach.** No sign-up, no password, no user table, no database. The report
  lives in `localStorage` and is never uploaded; the shared card is self-contained, so there is no record
  behind it to look up.

Both privacy sections are written for an adult with no technical background: no jargon, and no
explaining-to-a-child similes either. "Your device will summarize the contents locally to a ~100kb
file, which you can review the contents of, before sending it off for analysis." Simplifying is
where accuracy usually slips, so the suite guards both ends — nine terms (`bounded summary`,
`archive`, `.zip`, `API key`, `localStorage`, `proxy`, `endpoint`, `payload`, `end-to-end`) are
asserted absent from those two sections, and the honesty checks below are re-pointed at whatever the
current wording is rather than dropped whenever the copy is rewritten.

One of those cut caveats came back in a smaller form. Everything above is an *assertion*: the page
asks for somebody's whole Instagram history, including their messages, and answers the obvious
question with promises. The repository is public, so the promises are checkable, and the privacy
card now says so and links to it — as does the footer. Both links are held to the same URL by a
check, since two links disagreeing about where the source lives is worse than one, and a reader who
notices the disagreement stops believing either. What did not come back is the self-hosting
explainer; a link is a pointer, and that was a paragraph.

The page used to explain *why* the relay exists and to note two further caveats — that an unlocked
device is readable, and that the code can be self-hosted. All three were cut as clutter. Cutting a
caveat is a product call rather than an accuracy one, so the checks for them went too. The page later
also dropped its one remaining explicit mention of the relay — "The summary goes to PsycheAI, which
passes it straight on" — in favour of shorter copy that just names the destination model. That
sentence's check was removed rather than repointed, since there is no wording left on the page for it
to hold; what survives is the disclosure that Gemini or Claude read the summary under their own
terms, and the negative guard below.

A tempting claim — that the summary never reaches the PsycheAI server at all, or reaches the model
directly with nothing in between — would be false, and the suite fails if it ever appears.
Checks read the claims off the rendered page *and* the behaviour out of `server.js`, so the page
cannot drift into overstatement and the server cannot quietly stop honouring it: `fs` is asserted to
be read-only, `Cache-Control: no-store` to still be set, and the copy is checked for the word
"directly" beside the model or either provider's name, which it must never carry.

Two more additions answer specific fears rather than the general one. **"No analytics, no trackers,
no cookies"** is checkable the same way the source link is: nothing in `docs/` calls out to a
tracking domain, sets a cookie, or loads an analytics script, and it stays true because there is
nothing here that would need one — no accounts, no funnels, nothing to measure. It appears twice:
folded into the single badge at the moment of the ask, alongside the storage promise rather than as
a separate one beside it, and again with more detail in the FAQ. The two were split into two badges
at first, on the reasoning that they answer different worries — what happens to the data once
PsycheAI has it, against whether PsycheAI can see the reader at all — but a reader scanning the
upload card only has to read one bar to get the whole promise, so they were merged back into one.

That merge is also why the badge is no longer a pill. `border-radius: 999px` reads fine for a short
single-line label, which is what it started as; sized to a three-sentence paragraph it just rounds
the corners of a block, which looks like a badge that outgrew its shape rather than a banner. It is
styled like `.alert` instead — a plain bordered card, left-aligned, with the storage sentence in
`<strong>` for hierarchy, the same bold-lead-in pattern the FAQ card bullets already use. A UI check
holds the border radius to a small, rectangular-reading value and confirms the text never overflows
its box, so a future rewording that lengthens the claim again cannot silently bring the pill back.

The **paid-API-access** paragraph is the one place this page states something about a third party's
policy rather than only its own, so it stays hedged even after being trimmed to one sentence: "that
is their policy to keep, not ours to guarantee," rather than asserted as this app's own promise —
not a claim PsycheAI is in a position to make on Google's or Anthropic's behalf. The claim itself is
narrow and true — Gemini and Claude are both reached through paid API access, and paid API terms from
both providers exclude customer inputs from training, as of when this was written. That second half
is exactly why it stays phrased as their policy rather than restated as fact: it is the one claim on
this page that could become false without this app changing anything at all. An earlier version also
named the free consumer chat apps as the contrast and pointed readers at the providers' own terms to
verify it; both were cut as the paragraph was tightened to what a reader actually needs on first
read, not as a change to what is being claimed.

**Grok is not named on this page**, even though `lib/grok.js` is a real, working provider a
deployment can still choose. The page describes what a reader's own upload will actually meet, and
naming a third provider only some deployments run would be explaining this repository's options
rather than answering the question a reader actually has. Grok's own paid-API terms carry the same
no-training clause as the other two, so the underlying claim is unaffected by which providers the
page happens to name — this is a decision about what the reader needs told, not a narrower privacy
guarantee for anyone running Grok themselves.

The unpacking screen carried this same claim as a fineprint line under the progress bar — "Reading
your data on this device… (nothing has been sent yet)" — set once, at the point where it is true,
and overwritten the moment it stops being true. That row is gone now; the claim moved into the
progress label itself, reported from `docs/instagram.js` as each batch of files is parsed:
"Reading your data on your device. No data is being sent out." The heading above it is just
"Loading" rather than naming the phase, on the same reasoning the badge redesign followed — say less,
say it once. `runAnalysis` still replaces the working screen's title and note with the actual
send-in-progress copy the instant a request is about to go out, so the claim is never left on screen
past the point where it would become a lie. Because the label moves fast against the mock and the
supplement dialog opens once reading finishes, the check records every value the label takes rather than
trying to catch it mid-flight, then confirms the claim appeared at least once during reading.

### Recognising the archive at all

Before any of that, `readExports` decides whether the thing it just unpacked is an Instagram export.
Two checks, and the second is the one that earns its keep. The first refuses an archive with no JSON
in it, and names the HTML-format mistake specifically because that is the one people actually make.

The second counts **kinds of activity**, and requires at least four. That exists because "contains
JSON" is a low bar that a Facebook download clears easily — and Facebook shares three filenames with
Instagram (`comments.json`, `following.json`, `followers_1.json`), so those route, run, and extract
close to nothing. The follow lists use flat `{name, timestamp}` records rather than Instagram's
`string_list_data`, so every row is skipped; the comments have no `string_map_data`, so the handler
falls through to `title` and files Facebook's own *"X commented on Y's post"* boilerplate as if it
were the user's writing. None of that fails loudly. Without the floor the archive reaches the model
and comes back as a personality, and a profile written off three sources reads exactly like one
written off twenty — the confidence figure is the only thing that differs, and by then the reader has
already been told who they are.

Breadth rather than volume, because a real export ships the whole file skeleton whether the account
has three posts or thirty thousand. A quiet account is thin, not unrecognisable, and belongs in the
report with a low confidence rather than turned away at the door. Messages are excluded from the
count for two reasons: they can end up withheld from the model by a choice made after the archive is
already open — see the pre-send review below — so counting them would let the threshold move with a
decision that has nothing to do with what kind of archive this is, and they are the one route a
Facebook export gets perfectly right, being the same Messenger format — so they are the last thing
that should count towards recognising Instagram.

`tools/fixture.mjs` builds a Facebook download shaped the way Meta writes one, and both suites run it
through: the unit suite asserts the refusal and its wording, the browser suite asserts it reaches
`#upload-error` and that nothing was sent. Deleting the floor, lowering it to three, or counting
messages towards it each let that archive through, and each is caught.

### Supplementary sources: Google Takeout and Facebook

**Download steps are written once.** Each source's steps live in a `<template>` in `index.html`
(`#howto-instagram`, `#howto-google`, `#howto-facebook`), and `app.js` copies each into every
`<ol data-howto="…">` at start-up — the front page's how-to card, the first-upload "Add more data?"
popout and the "Add or change your data" popout — so the three can no longer drift apart. A UI check
holds them identical.

Instagram is the performed self: what somebody chose to publish. A Google Takeout "My Activity"
export is the unperformed half — what they searched, watched, browsed and asked an AI — and a
Facebook export is usually an older life stage that Instagram replaced. Both are offered *after*
the Instagram archive has parsed, in a dialog whose forward button is **Skip this step** until
something has actually been added.

That dialog and the review below it are **one loop**, not two steps in a line: the review's left
button reads **Back** and reopens the supplement offer rather than throwing the upload away, and
`askSupplement` is seeded with whatever the previous pass added so returning does not silently
discard an archive already read — re-reading a Takeout is slow, and a reader who went back to change
one checkbox has every reason to expect their export to still be there. The digest is rebuilt on each
pass rather than reused, because going back is precisely how somebody adds a source they had skipped.
Three signals come out of `askReview` and they are all different: a decision object means Send,
`REVIEW_BACK` means reopen the offer, and `null` — Escape — means abandon. Only **Back on the
supplement offer** leaves for the welcome page, which is what keeps the two Back buttons distinct.

**The primary recognition floor is untouched.** A Facebook download still cannot pass as an
Instagram export: every assertion in the section above passes unmodified, and `buildForeignExportZip()`
is now reused as the Facebook *supplement* fixture — one archive proving both behaviours. Reading it
with handlers that know its real shapes (`comments_v2` → `data[].comment.comment`, not the
"X commented on Y's post" boilerplate the Instagram handler falls back to) turns the same file from
worthless-as-primary into worth-having-as-addition. `readFacebook` separately refuses an *Instagram*
archive by name, because re-picking the same zip is the likeliest mistake at that step and Meta's two
exports overlap enough that it would otherwise half-parse and silently double-count.

**Aggregate at collection time, never accumulate.** A decade of Search history is six figures of
records. Counting into a `Map` costs one entry per distinct term where keeping the list costs one per
record, so `docs/supplement.js` builds histograms as it reads and retains only a bounded text buffer
for texture; `digest.js` then does the final `topKeys`/`sampleTexts`, the same split
`signals.likedAuthors` has always used. This is not a micro-optimisation. The test fixture's watch
history shipped raw would be **3.1M characters and $1.33 of input on its own** — five times the
entire per-run budget. Aggregated, it is $0.02.

**Never classify on English.** Google localises the folder name, the filename and the title verbs
("Watched", "Searched for"). Classification reads `products` and the *shape of `titleUrl`* — a
YouTube search is `/results?search_query=` in every language — and the query text is pulled out of
the URL rather than by stripping a prefix. Prefix-stripping survives only as a cosmetic last step
that keeps the raw string when it does not match. The fixture carries a German block including a
German YouTube *search*, which is the single record that separates the two approaches: it is
`products: YouTube` exactly as a watch is, and only the URL says otherwise.

**Chrome is reduced to hostnames.** Never the page, the address, the query or the time. A full
browsing history is at once the most invasive thing this app could carry and mostly noise — every
page of every site somebody ever opened — where the domain histogram keeps the signal and drops the
surveillance. The fixture's URLs carry deep paths and query strings so that a parser which kept them
is caught rather than trusted.

The instructions for requesting a Google export live in a collapsed `<details>` on the welcome page —
a native disclosure rather than the JS-managed one the paid roast's cover uses, because that one
keeps its text out of the DOM entirely as a payment gate and this is only a page of instructions for
a step most readers skip. Left in the document while closed, they stay findable with Find-in-page
and reachable by a
screen reader navigating headings; the checks read `textContent` for the content and visibility for
the disclosure, since `innerText` reports nothing for a closed `<details>` and would prove neither.
Facebook's own instructions no longer live here. The welcome page's card now reads *"Optional: Also
add a WhatsApp chat or Google data for a fuller analysis"* and holds the WhatsApp steps (a chat with a
close friend: ⋮ → More → Export chat → Without media), then Google's. That matches the order and the
*optional* tags of the "Load your data" popout. "How it works" step 1 says *a WhatsApp chat and Google
data are optional*, where it used to call Google recommended. Facebook's steps live only in the
supplement dialog's own disclosure, opened after Instagram has already been read. A check on the welcome page's card asserts the word "Facebook"
does not appear in it at all, so the two cannot quietly drift back into sync by somebody restoring the
old copy without noticing the dialog now carries it alone.

The eight new review rows appear **only when that source was added**, so a reader who skipped sees
the same seven rows as before — which is what keeps the "exactly seven checkboxes" check meaningful
instead of turning it into a count of whatever happens to be present.

### What is complete and what is sampled

The distinction matters more than the digest's size. **Complete** — every count, the full
hour-of-day and day-of-week histograms computed over every timestamped event, month-by-month
activity across your whole account history, posting regularity, and Instagram's own inferred
topics. **Sampled** — the text:

| Source | Cap |
|---|---|
| Captions | 560 |
| Comments you wrote | 360 |
| Accounts you follow | 1,000, spread evenly across the list rather than taken from the head |
| Accounts you like / save most | 240 / 120 |
| Your own DMs | 1,000 — parsed and counted unconditionally now; excluded from what is sent only if you untick them in the pre-send review, after you have seen the real count |
| Searches | top 160 **by how often each was repeated**, with the count — not the last 160 |

Google Takeout, when added — every one of these is a cap on an **aggregate**, never on a raw list:

| Source | Cap |
|---|---|
| YouTube channels | 120, as a histogram with real watch counts |
| YouTube video titles | 150 sampled, out of however many were watched |
| YouTube / Google search terms | 100 / 150, ordered by how often they were repeated |
| Google search sample | 150 |
| Chrome | 100 **hostnames** — never a URL, a page title, a query or a time |
| Gemini Apps prompts | 80 |

Facebook, when added: 200 posts, 150 comments, 300 friends sampled evenly, 80 repeated searches,
and 200 of the reader's own Messenger messages, sampled per conversation exactly as Instagram DMs are.

**Two things about the budget that supplements exposed.**

The character ceiling is *derived*, not typed. It used to be a hand-written `totalChars: 600000`,
which was 49,516 characters past what `COST_CAP` actually buys — a digest that filled it would have
cost **$0.5212 against a $0.50 cap**. That was dormant while Instagram was the only source, because
a heavy account reaches 156k and never approached it; supplements make it reachable. It is
`charBudget(COST_CAP, IMAGES)` now, so the price is the thing being set and the character count
falls out of it, and a check holds the two together.

The trim loop shrinks whichever list is largest, which is source-blind — so a big Takeout would have
shaved Instagram captions to make room for a browsing histogram. Instagram is the primary evidence
and the thing the report is written from; a supplement is an addition, so **additions are trimmed
first, and further** (floor 10 rather than 20) before any Instagram list is touched. Fault-injected
by blocking supplement trimming entirely: captions collapse from 299 to 20.

**The guarantee on captions is a bounded one, and the change is worth being precise about.** It used
to be that a supplement cost the primary export *no* captions at all, and that held while the test
fixture had headroom to hold it with. It does not now: the fixture is deliberately oversized and run
against a deliberately lowered ceiling, so Instagram alone very nearly fills it, and once every
supplement list is at its floor the irreducible remainder (per-service counts, coverage rows, the
floored lists themselves) still costs one trim step. What is checked is therefore the property the
system can actually deliver, which is also the more precise one: **every supplement list is driven to
its floor before a single caption is touched** — 4,000 video titles and 6,000 searches come out at ten
apiece — and captions may then lose at most one 25% step. A second step means the ordering has
stopped working, and that still fails.

Worth keeping in proportion, though: **output dominates the bill.** Worst-case generation alone is
$0.2458 of a heavy run's $0.33 ceiling, against $0.085 for the entire digest. Both supplements
together add about $0.043 — roughly 2% of realistic total cost.

Captions, comments and messages share one sampler, and it now drops anything under 4 characters
before the caps above are even applied — "ok", "lol", "brb" carry nothing a model can read anything
into, and every slot one of those occupies is a slot a real sentence does not get.

**Searches are a histogram now, and that was a real bug.** Instagram's searches were a plain
`slice(-160)` while Google's went through `topKeys` — the two sources got different treatment for
identical data, and the Instagram side was the wrong one. Measured on a realistic history (740
searches: a handful of terms repeated, a long one-off tail, and forty instances of "ok"), the tail
spent **40 of its 160 slots on the literal string "ok"** — it never passed through `sampleTexts`, so
it never met the 4-character floor everything else does — and **39 more on duplicates**, leaving
roughly half the budget carrying no information. Worse, the most-repeated term in the history was
**absent entirely**, because it did not happen to fall inside the last 160 records. A repeated
search is precisely the signal; recency alone throws it away. It is `topKeys(countTerms(...), 160, 4)`
now, matching what Google's searches always did, and the model is told the counts are there.

The 4-character floor on `topKeys` is **opt-in per call site**, which is the part worth not getting
wrong: it is right for search terms and actively harmful for names. NPR, BBC and A24 are real
channels and `x.com` is a real domain, so a blanket floor inside `topKeys` would delete them
silently. Fault-injected in both directions — floor ignored, and floor applied to everything — and
each direction fails its own check.

A small account sends about 6KB; a heavy one with thousands of posts lands around **150KB**, well
inside the ~222KB ceiling and a small fraction of either provider's 1M-token context. The digest
carries a `coverage.sampling` field saying what fraction of each source the model is seeing, and the
prompt tells it to factor that into its confidence score rather than treating the sample as the
whole picture.

### One budget, not two

There used to be two depths. **Standard** was the caps above; **Comprehensive** lifted every
per-source cap far past what any real export reaches, so that the thing bounding the digest was a
price rather than ten separately-reasoned caps, and sent 20 photographs instead of 14. A depth
picker sat between the supplement offer and the review, asking which to run.

**The picker went first.** Comprehensive had never been on sale, so it was a question with one
available answer, costing a click and a decision to arrive exactly where the reader started. A
disabled row naming a future price is worth showing on a page somebody chose to read; it is not
worth an interruption in a flow. `askDepth`, `#depth-dialog` and the synthetic-click guard that
protected the disabled row all went with it.

**The second budget followed, and the reason is worth recording.** It was kept for a while on the
reasoning that putting the feature on sale should mean adding a way to choose it rather than
rebuilding it. That did not survive contact with the cost work. An unreachable second budget is a
second number everyone has to reason about, and it was actively misleading: during the wellness and
career-coaching changes, two budget checks fired against `comprehensive` and reported pressure on a
ceiling no reader can reach, while the real one had 28% of itself spare. Both were being read as
warnings about the shipping path. They were not about it at all.

So `DEPTHS`, `depthOf()`, the lifted caps and `coverage.depth` are gone. `digest.js` holds one
`LIMITS`, one `IMAGES = 14`, and `LIMITS.totalChars = charBudget(COST_CAP, IMAGES)` — **221,741
characters**, derived from the price rather than typed. Restoring a paid deeper tier means adding
caps and a way to choose them, which was always the honest version of that promise.

The one thing that had to survive the removal is **trim-loop coverage**, since the loop was the only
part of `comprehensive` doing real work: it is the safety net that stops a future cap change or a new
source quietly buying a digest the cost cap does not cover. On real input the per-source caps bind
first and the loop never fires — a heavy account is 156k against a 221k ceiling — so it cannot be
driven by feeding it more data. `build()` therefore takes an optional `maxChars`, which exists for
those tests and nothing else: production passes nothing and gets the derived ceiling, and the tests
lower the ceiling instead of inflating the account. A check pins the headroom that makes this
necessary (`digestChars < totalChars * 0.8`), so the "the caps bind first" claim cannot rot into a
comment that used to be true.

The budget is derived rather than picked, in `charBudget()`:

```
worst-case output   16,000 tokens × $7.50/M   = $0.1200   (the hard generation cap)
left for input      $0.25 − $0.1200           = $0.1300
                    ÷ $1.50/M                 =  86,667 tokens
less system prompt + response schema          −  16,800
less 20 images × 258                          −   5,160
                    × 3.5 chars/token         = 226,473 characters
```

That fixed reserve was **8,600 for a long time, and had gone stale** — it was typed when the system
prompt was 10,434 characters, and the supplementary-source rules, the hard limits and the
extraversion correction all landed after it. By the time anyone measured, the prompt and schema were
about 13,100 tokens, so the reserve was nearly 4,500 short. Under-reserving fails quietly in exactly
the wrong direction: it *inflates* what `charBudget` returns, so a digest that fills its ceiling costs
more than `COST_CAP` claims it can.

The check that was supposed to catch this could not, because it repeated the same `8600` literal
rather than reading it. It was holding the arithmetic against the implementation's own number, so the
two agreed with each other while neither agreed with the prompt being sent — a check written to mirror
the code instead of the world. It now reads `Digest.FIXED_INPUT_TOKENS` and, separately, measures
`PROFILE_SYSTEM` plus `PROFILE_SCHEMA` and fails if the reserve is smaller than either. `digest.js`
runs in the browser and cannot import `lib/prompts.js` to compute this for itself, so that check is
the only thing standing between the constant and a third round of drift.

It budgets for the **worst** case, not the likely one. `thinkingLevel` is HIGH and thinking bills at
the output rate, so the only number that can be relied on is the generation cap — reserving all of it
means the ceiling holds even when the model thinks for as long as it is allowed to, instead of
holding on average and quietly breaking on exactly the accounts that give it the most to chew on.

### Context caching, and why the ceiling is the wrong thing to look at

The budget above governs the digest, and on a typical run the digest is **4% of the bill**:

| | typical run | share |
| --- | --- | --- |
| Output, including thinking, at $7.50/M | $0.0600 | 64% |
| System prompt + schema, 16,000 tokens, identical every call | $0.0240 | 26% |
| Photographs (14) | $0.0054 | 6% |
| The digest itself | $0.0040 | 4% |

The fixed prompt costs six times what the evidence does, and it is the same bytes every time. Claude's
adapter had always cached it (`cache_control: ephemeral`); Gemini's — the default provider — re-sent
and re-paid for it on every call. `lib/gemini.js` now parks `PROFILE_SYSTEM` in an explicit context
cache, which is about 9,100 tokens, worth roughly **$0.010–0.012 a call, or 11–13% of a typical run**,
with identical inputs and outputs.

Three decisions in there are worth stating, because each one is a place this could have been done
badly.

**Explicit, not implicit.** Implicit caching is automatic and free but best-effort, with a short
eviction window that suits steady high-rate traffic. This app goes minutes or hours between analyses,
which is precisely when an implicit entry has already been evicted. An explicit entry with its own TTL
survives the gaps.

**Off by default, because caching is not free.** Cached tokens carry an hourly storage charge, so an
entry no second call ever reaches costs more than it saved. The break-even is worth writing down,
because the prompt size cancels out of both sides and what is left is a rate against a rate:

```
caching pays when   calls per hour  >  storage rate / (input rate − cached rate)
```

At Gemini's flash pricing that is `1.00 / (1.50 − 0.375)` — about **0.9 analyses an hour, sustained**.
Ten a day is 0.4, comfortably under. This paragraph carried the same figure for a long time while the
default sat at a 15-minute TTL, which is the worst case at that rate: gaps of a couple of hours mean
nearly every call misses *and* still pays to create an entry that expires unread. Lengthening the TTL
makes it worse rather than better — a day of storage on a 15,000-token prompt costs more than the
handful of hits it earns.

So the default is `0`: the system instruction rides inline and no storage is billed. Set
`PSYCHEAI_GEMINI_CACHE_TTL` to a number of seconds once `npm run usage` shows sustained traffic above
about one call an hour, choosing a TTL longer than the typical gap between calls. The cache is still
created lazily, only ever *after* a real call, when another is most likely.

**The compatibility prompt is deliberately left uncached.** At ~1,900 tokens it is under the floor
Gemini will accept, so offering it would fail on every call and buy a wasted round trip. The schema is
excluded for a different reason: `responseJsonSchema` is generation config rather than content, so
those ~6,600 tokens are still billed in full. Only the system instruction is cacheable, which is why
the saving is 11–13% and not the 26% the table might suggest.

None of this may fail the analysis, so every path returns to sending the prompt inline: a create that
fails backs off for ten minutes rather than retrying per call, and a handle the API has forgotten is
dropped and the call retried once without it. A cache that works and a cache that silently stopped
being hit produce identical reports, so `usage.cachedTokens` reports what was actually served from
cache, and `tools/livetest.mjs` runs the analysis twice and prints whether the second call hit — the
only place the arrangement can be confirmed against the real API rather than against a stub.

For most accounts the per-source caps are never reached, and `coverage.sampling` then reports shown
equal to available. What the caps are protecting against is the tail: 4,000 captions at ~150
characters is 600,000 on its own, nearly three times the whole budget. The promise is "as much as
$0.25 buys", which is usually all of it and sometimes is not, and the digest says which.

Trimming is what actually enforces the ceiling, so it repeatedly shrinks whichever sample list is
currently costing the most. It used to touch captions and comments only, which was safe while every
other cap was in the low hundreds and would stop being safe the moment any of them was raised: an
account with a very long follow list would sail past the budget with nothing the loop was willing to
touch. The self-test pins this down with a 120,000-follow export — against the old loop it produced a
**2.3-million-character** digest, four times the budget and about $1.35 a run, while gutting captions
to 20 to spare a list of account names.

The `samplingNote` is written from what the coverage numbers say rather than from what the caps
would permit, so a run that did send everything does not tell the model it is reading a subset and
hedge a confidence figure it has no reason to hedge.

### Reviewing what actually gets sent

Once the digest is built, and before anything reaches the model, a second dialog shows the reader the
real digest that was just built — real counts, not a description of what the app generally does —
as seven checkboxes, one per category: captions & comments, activity & timing, accounts followed and
engaged with, Instagram's own inferred topics, searches, direct messages, and photos. All seven are
ticked by default and every one is a real control, not just the two — DMs and photos — that used to
be. Untick anything and it is genuinely gone before Send is pressed, the same guarantee the DM/photo
switches always made, just extended to the rest of the digest. All seven used to be checkboxes on the
upload page, ticked before the archive had even been opened; they moved here because a choice made
before you can see what it actually contains is not an informed one, and because "download this
app's data practices in the abstract" and "here are your own 18 messages, sampled from 36, decide"
are different levels of consent.

That move inverted how messages and images are handled upstream. `IG.readExports` used to take
`includeMessages`/`includeImages` and skip parsing the relevant files outright when either was off —
cheap, but it meant the old checkboxes were a blind guess, since there was nothing yet to show a
count of. Both are now parsed unconditionally, and the review dialog is what removes anything the
reader declines, **after** it already exists. Five of the seven rows are plain field deletions on an
already-built digest — `Digest.omitCaptionsAndComments()`, `omitActivity()`, `omitAccounts()`,
`omitTopics()`, `omitSearches()`, each following the shape `omitMessages()` set: empty the real
fields, correct the coverage counters that named them, touch nothing else. `omitActivity()` deletes
`counts` and `rhythm` together, since both are numbers-only — post/like/save/follow totals and the
hour-of-day/day-of-week histograms — never names or text, which is what separates that row from
`omitAccounts()`, the one row here that does carry other people's names. Photos are the one row that
also changes what happens *upstream*: extraction is deferred until after the review closes, so
declining photos skips the decode-and-downscale step outright rather than doing the work and
throwing the result away. `tools/uitest.mjs` checks that half directly, not just its outcome — it
records every `#progress-label` value during a decline and asserts `"Preparing image"` never appears
in it, which a version that extracted first and discarded second would still pass on "no images were
sent" alone.

Declining is proven rather than trusted. The suite drives a real upload, unticks all seven rows, and
checks the actual request body: no `directMessages` key, no message text anywhere in the digest — not
just the user's own, the whole block — empty arrays for following/topics/searches/engagement, no
`counts` or `rhythm` at all, and an empty `images` array with not one base64 byte in the payload.
Every `omit*()` function and the deferred-extraction guard were fault-injected while this shipped:
each was skipped or disabled in turn, and each broke a different, specific set of checks with a
diagnostic naming what leaked — proof that the checks are wired to the field they claim to guard,
not just to each other.

A row with nothing in it says so rather than pretending to be a live switch: an export with no direct
messages shows "Direct messages — none found" with the checkbox disabled, instead of an untickable
promise about content that was never there. The same applies to any of the other six rows on a
genuinely thin export — the fixture used by the UI suite is deliberately built to have something in
every row, precisely so this disabled-when-empty path never accidentally becomes the only path
exercised.

**Reading the summary in your own words is one thing; reading the actual digest is another.** A
"Download what's being sent, as an HTML file" link is the list's own last child — inside the same
scroll region as the seven checkboxes, below Photos, not floating above the list where it would
always be visible regardless of scroll position. It downloads a `.html` file rather than `.json`
deliberately: opening it takes a double-click into whatever browser is already installed, not an app
that knows how to pretty-print JSON. The page it opens to is two things — a readable table naming
each of the seven categories as Included or Excluded with the same detail line the checklist itself
shows, and the full digest below it in a `<pre>` block for anyone who wants the exact fields. Both
halves are read from the same `rows` array `askReview()` builds the checklist from, so the table's
copy cannot drift from the checklist's.

**The photographs ride along in it too**, embedded as `data:` URIs, so the file is the whole of what
leaves the device rather than the text half of it. Three things make that honest rather than
decorative. They are the **resized, re-encoded copies** the request actually carries — read through
the same `Images.extract` the send uses, so what the reader opens cannot flatter what is sent, and the
file says plainly that these are softer than the originals still in the export. They are **embedded,
not linked**, so the file survives being moved out of the Downloads folder. And unticking Photos
removes them from the file as well as from the table, because a preview of "what gets sent" that still
showed the pictures would be describing a request nobody is making.

Decoding is what makes this awkward, and the awkwardness is why it is wired the way it is: it is the
slowest thing the app does, and it is deliberately deferred until *after* the review so that unticking
Photos or pressing Back costs nothing. So the download button is the trigger — the one path where the
reader has actually asked — and `getExtractedImages` caches the result, so a reader who previews and
then sends does not sit through the same work twice. A reader who never clicks pays nothing, exactly
as before. On the synthetic fixture the file is 91KB; with real photographs at the 768px edge expect
a few megabytes, which is why this is a download rather than a panel in the dialog. The sentence in
that file naming the edge is interpolated from `Images.LIMITS.edge` rather than written out — it
shipped once saying 1024px against a real edge of 768, and a file whose whole job is to state what
leaves the device should not carry a number kept in sync by hand.

The file is the same object the checkboxes describe, not a second, separately-written description of
it that could quietly drift from the first. `applyReviewDecision()` in `docs/app.js` is the one
function that redacts a digest according to a set of ticked boxes, and it is shared by both callers:
`handleFiles` runs it on the real digest once Send has resolved, and the download button runs it on a
throwaway `JSON.parse(JSON.stringify(digest))` clone at click time, against whatever the boxes say
*right now* — so unticking three rows and downloading again produces a file with exactly those three
marked Excluded and gone from the embedded digest, everything else untouched, without ever mutating
the digest the dialog itself is still holding. Clicking Download does not check, uncheck, close the
dialog, or send anything; the suite proves the first of those by downloading twice with different
boxes ticked in between and checking both the table and the embedded digest in each file, and the
rest by asserting the dialog is still `open` and the request count has not moved. Photos are the one
field the shared function does not touch — `handleFiles`'s decode-and-downscale step is a real async
side effect a preview must never trigger, so both callers patch `coverage.images` by hand instead, and
the download reflects a decline in that flag immediately rather than waiting for an extraction that
has not happened yet.

**One dialog, one scrollbar.** A `<dialog>` shown with `showModal()` gets `overflow: auto` from the
browser's own stylesheet by default, and this one also holds a scrollable list — which meant the
dialog element and the list inside it could both grow scrollbars for the same content at once. Fixed
by making `.review-dialog` a fixed-height flex column (`max-height: min(30rem, calc(100vh - 2rem));
overflow: hidden`) so the title, subtitle and buttons keep their natural size and only `.review-list`
absorbs the rest, with `flex: 1 1 auto; min-height: 0` on the list so it actually shrinks to fit
instead of holding its content's full height regardless of the cap. The 30rem ceiling is deliberate
rather than "as tall as the content wants to be": a fixed, modest card puts the scrolling where it
belongs, on the list, on every screen — not just a short one — which is also most of what "fit the
popout box into the mobile version better" turned out to mean in practice.

The bug this fixes is height-dependent, not fixture-dependent: at this suite's own 900px-tall default
viewport the content fits regardless of which container is doing the scrolling, so a check written
against that height alone would pass whether or not the fix was in place. The two checks that guard
it shrink the browser window to 900, 650 and 560px, the same way the hero-mark sweep elsewhere in
this file does for its own claim, and assert the dialog never scrolls at any of the three while the
list does once the window is genuinely short. Removing the fix entirely was tried against this: both
checks fail, and the diagnostic shows the outer dialog scrolling at 560 and 650px while the list does
not — the exact shape of the original bug — while 900px alone reports nothing wrong.

**"Send this" says so only when that is actually all it does.** The button read "Send this" in every
one of the three places this dialog opens, regardless of what came right after it — which was
sometimes a payment. A reader past their free allowance who unticked nothing, read the review, and
pressed what plainly said "Send this" landed on a payment sheet they had not been told to expect at
the moment they agreed to anything. Agreeing to a price should happen with the price already named,
not discovered on the very next screen.

Each of the three callers already knows whether a charge follows, before this dialog ever opens: a
first upload and a report-page rerun both call the existing `mustPayForAnalysis()` — true once this
browser's free allowance is spent — and the premium unlock's own data offer (`collectExtraDataForPremium`)
is never reached except on the way into a US$5 charge, so payment is unconditionally due there. Each
now passes that single fact in as `options.paymentDue`, and `askReview()` sets the button's own text
right before `showModal()`: `'Make payment'` when true, the unchanged `'Send this'` otherwise.
(October 2026: `'Make payment'` became **Proceed** — `TEXT.reviewProceed` — everywhere. The button
never charged anything; it opens the payment sheet, where the charge is made, and on the free unlock
from a shared link there is nothing to pay at all. The checks below now look for `'Proceed'`.) Nothing
about what the button *does* changes — it still only ever hands the reviewed decision back to
whichever caller opened the dialog, which is what actually goes on to ask for money — only what it
*says* does.

`tools/uitest.mjs` checks the label directly at all three sites: the very first, free upload (`'Send
this'`, nothing due), a report-page rerun run after the free allowance is spent (`'Make payment'`,
right before the payment sheet that follows confirms it), and the premium unlock's own review once
data has been added to it (`'Make payment'`, since that review is never reached without a charge
waiting on the other side). Fault-injected both directions — forcing the label to `'Send this'`
unconditionally fails the two paid cases, forcing it to `'Make payment'` unconditionally fails the
free one — proving the text tracks the real condition rather than one hard-coded value happening to
read correctly in whichever case was tested first.

### The review's finer choices (25 October 2026)

The review sheet was rebuilt so a reader who is unsure about sending anything to Google Vertex AI can cut
it down as far as they like, line by line, and see what that costs. It was mocked up first
(`marketing/site-mockups/review-sheet.html`) and agreed one change at a time before it was built.

- **Layout.** The body scrolls; the foot stays put: a read-quality meter, the size of what is sent
  ("~13 KB of text"), *Download what's sent*, the terms line and Back / Send this. While a word is being typed
  the foot steps aside (`.is-typing`), so on a phone the keyboard has the room. At the top, *Nothing sent
  yet* and what is already taken out, ending in a *Where does it go?* link that opens inside the same green
  box (no line of its own): the provider, that Google does not train its AI on it and that PsycheAI keeps no copy.
- **What's included** is one list, least personal first (`TEXT.review.rows` sets the order and the short
  names): activity and timing, Chrome, Instagram's guesses, accounts, Facebook friends, liked posts, YouTube,
  your posts and comments, Facebook posts, your searches, YouTube and Google searches, then direct messages,
  Messenger and WhatsApp. A scale runs down its left edge. Each row is a name, a live count and a switch; the
  switch is still the real checkbox with the row's old id, so the decision, every flow that unticks one and
  the download table read it as before. Tapping a row's name previews its actual lines, each with a ✕ that
  leaves that one line out (↺ puts it back). Messages count their chats ("2 chats") and open into one switch
  per chat. A kind of data the export has none of is not listed at all (it was shown struck through, "none
  found", until a reader's own export showed how much noise that made).
- **Chats by their real names, on this device only.** The summary tags each chat [t1]…, [c1]… or [m1]…
  by rank; the reader cannot know which is which. `instagram.js` now keeps each thread's title in memory
  (`threadTitles`) and WhatsApp's summary carries its file-name title, and `Digest.build` hangs the names on
  the digest as `chatNames`, a property JSON cannot see (`chatLabels`): never sent, stored or backed up. A
  digest read back from storage has none, and its chats read "Chat 1", "Chat 2". The row says the name
  shows only here and each chat is labelled as its number. A single chat's messages carry no tag, so that row does not
  open.
- **A switched-off chat's room is filled (25 October 2026).** The summary samples a second, larger pool of
  the reader's own messages (`spareMessages` in digest.js: 1.5× the lines, from the top 15 chats rather than 10)
  and keeps what is not already sent as `__spareMessages`, device bookkeeping like `__names`: forModel never
  copies it and the evidence size never counts it. When a chat is switched off, `trimLines` fills the
  characters it freed from the spares (`refill`): the chats that stay get more of their own lines and the
  next chats in line come in, shared by how many spares each has, never past the room freed, and never a line
  the reader left out by year, word or ✕. The list is put back in chat order. The review lists a chat that
  came in this way as "filling in"; it can be switched off too, and the next one comes in. It works on a
  summary read back from storage as well, since the spares are stored with it. It costs storage, not
  tokens: about half the size of the sent messages again (56 KB beside 110 KB for 6,000 messages across 40
  chats). Instagram and Messenger have spares; WhatsApp does not, since its three chats are hand-picked and
  there is no next one. The message note's "[t1]…[t10]" became "[t1], [t2] …", since a chat that fills in
  can be t11 or later.
- **Which ten chats (25 October 2026).** Chats are ranked by eligible messages (the reader's own, after the
  sampler's filters: no system notices, bursts joined, no pastes or forwards, no filler, no repeats), weighted
  towards chats kept up over years: × (1 + 0.20 for each extra year with at least 10 eligible messages), at most
  ×2 (`messageSpanBonus`, `messageSpanCap`, `messageYearFloor`). 200 over three years ranks with 280 in one; 50
  over five ranks below 300 in one. Ties go to the older chat. It applies wherever the sampler ranks chats:
  Instagram, Messenger, and WhatsApp's hand-picked three (where it changes only their order).
- **Which years.** A bar a year, from every dated line the model would read; each bar switches its year
  off on its own, and All / 3 yrs / 1 yr set a range. The last year left cannot be switched off.
- **Leave out anything mentioning.** Removes the whole post or message, never just the word: "Happy
  birthday ___! 30 looks good on you" would still say who. Whole words, any case. By the review the
  digest's people are numbers already, so the word also finds the [N…] or [P…] that stands for a name or
  handle it is part of (from `__names` and `__people`, which the device keeps and never sends); "Sam" finds
  [N2] and sam_runs. It does not understand context ("she", "my ex"): that would need a model to read the
  data first. An option to also drop the messages either side of a match was mocked and dropped as
  confusing; switching the chat off does that job.
  Since 26 October 2026: the words are never written into *Download what's sent* (its "Also left out"
  line said *anything mentioning "…"*, which put the very topic the reader kept back into the file).
  And on a phone the first press of *Leave out* counts: it used to blur the box, the keyboard closed,
  the foot came back and the button moved from under the finger, so only a second press worked.
  Pressing it no longer takes the focus (pointerdown is cancelled); pressed, the word is added and the
  keyboard goes, while Enter keeps it up for the next word.
- **The foot, one row** (26 October 2026): *Quality* (was *Read quality*), its bar and word, then
  *Download (16KB)*, the size in the link's own words (it was a line of its own, *~16 KB of text*
  beside *Download what's sent*); on a phone under about 360px the link drops to a second line. The file
  is `psycheai-summary.html` (was `psycheai-digest-preview.html`) and says *summary*, the word the reels
  and the privacy page use. The *↑ Least personal / Most personal ↓* labels under the list are gone.
- **Read quality** is an estimate: the square root of how much of the text is kept, against all of it,
  as Strong, Good, Fair or Thin. It moves as the reader removes things so the trade is visible; the real
  confidence still comes from the model.
- **One code path.** `Digest.trimLines(digest, { yearsOff, words, chatsOff, drop })` does all of it over
  `EVIDENCE_LISTS`, and `applyReviewDecision` calls it first, so Send and the download cannot differ. The
  download says what was left out under its table ("Also left out: everything from 2014; anything
  mentioning “older”; 1 chat"). The self-test pins `trimLines` on a small digest, and the UI suite pins each
  control against the file that would be sent, then undoes them all and checks the file is the default one.
- **Nothing says "photos".** The size line was "~13 KB of text, no photos" until the suite's rule that the
  review never mentions photos caught it: a reader approving what leaves must not read the word at all.

### Re-running with additional data, from the report page

A reader who uploaded Instagram alone the first time is not stuck with that choice forever. "Re-run
analysis with additional data" sits in the report's own action row, right of "Download full report",
and offers exactly what the name says: add a Google or Facebook export now, and get a new free report
written from the enlarged digest — without giving up the Instagram export a second time.

**The button is conditional, and the condition is the stored digest — not what happens to be in
memory.** `renderProfile()` shows it whenever `state.digest` exists and carries neither a `google` nor
a `facebook` block: this report was written from Instagram alone, so there is something left to add.
That is a fact about the *report*, and it survives a reload, a new tab, and coming back next week,
because the digest is in `localStorage`.

It was keyed to `state.signals` first — the parsed export held in memory — and that was wrong in a way
worth recording. `state.signals` is memory-only by design, on the same terms as `state.images`: never
written to disk, gone the moment the tab reloads. Keying the button to it meant the button vanished on
reload, which is precisely when a reader coming back to a saved report would go looking for it. The
in-session case passed every check while the case that actually matters did not exist.

**Pressing it opens the Google/Facebook popout immediately** — the same dialog, the same two sources,
the same collapsed download instructions a first-time upload gets. There was an intermediate version
that checked for `state.signals` first and, on a reloaded page, opened an OS file picker for the
*Instagram* export before showing anything. That was wrong twice over: being asked for the archive you
already handed over reads as a broken button, and cancelling the picker left nothing on screen at all,
so the button appeared to do nothing.

**The Instagram archive is not needed here at all**, which is what let that step go. Every field a
supplement contributes — `digest.google`, `digest.facebook`, their `coverage.sampling` entries — is
derived from `signals.supplements` alone; none of it reads the Instagram signals. So `build()`'s
supplement half and its trim loop were lifted into `applySupplements()` and `trimToBudget()`, and
`Digest.addSupplements(digest, supplements)` merges a source into an **already-built, stored** digest
and re-applies the budget. The branch that remains is small and honest:

- **Same session:** rebuild from the archive via `Digest.build`, so the photographs come too.
- **After a reload:** merge into a copy of the stored digest. No re-upload, no lost Instagram evidence.

The budget is re-applied rather than assumed to still hold — the stored digest was trimmed against its
own contents and this one is larger — and `trimToBudget` prefers supplement lists over Instagram ones,
so the report's primary evidence is not quietly shaved to make room for a browsing histogram.

**The one real cost of the merge path is the photographs**, and the review says so rather than hiding
it. They live in the archive this tab no longer has, so a rerun from a saved report sends none, and the
Photos row reads "your photos stay on your device and were never saved… upload your Instagram export
again to include them" instead of the ordinary "none selected", which would wrongly suggest the export
never had any. The dialog's own subtitle is swapped too: "…or skip straight to it" is true of the
first-upload offer and false here, where Skip is not shown at all.

**It reuses the first upload's own two dialogs — the supplement offer and the review — with one
deliberate difference.** `askSupplement()` gained an `opts.requireAtLeastOne` mode: Skip is never
shown, and the dialog's native Escape path is refused for as long as nothing has been added yet (a
`<dialog>` fires a cancelable `cancel` event just before closing on Escape, which is what makes this
enforceable rather than cosmetic — hiding the button alone would not have stopped Escape from doing the
same job). Once a source is in, Escape is allowed again and resolves the same way Continue does,
exactly as it already did outside this mode. Back is untouched in both modes: "I changed my mind" always
has to stay available, only "leave with nothing, some other way" is what this mode closes off. The
review dialog needs no changes at all — it is already driven entirely off whatever the digest actually
contains.

**A cancelled attempt costs nothing.** Pressing Back at the supplement offer, or Escape at the review
once a source has been added, resolves the whole rerun to a no-op: the digest, the profile and
`localStorage` are all untouched, because nothing is written until Send genuinely resolves at the very
end. The report a reader is looking at was likely worth several minutes of generation; an attempt to
add to it must never risk it. The same reasoning governs the failure paths: a zip that will not parse,
or photographs that will not decode, write their message to `#profile-alert` and leave the reader on
their report — rather than calling `showUploadError()`, which drops back to the welcome page and would
look for all the world like the report had been lost.

**The digest never expires, and the app is finally honest about the one way it can vanish.** It is
plain `localStorage` under `psycheai_digest` with no TTL, no expiry field and no timestamp check
anywhere — it survives until "Delete everything", a site-data wipe, or browser eviction takes it.
Those all take the report with it, which is a clean state to be in.

What was not clean is the asymmetric case. The profile and the digest are separate entries, the
profile is written first, and `store.write` swallows a quota failure and returns `false` — so a
browser with room for the report and not the evidence behind it produced a report whose digest was
gone. The profile's write had always checked that return value and warned; the digest's four writes
did not. Downstream, two things then lied about it:

- The Instagram row in the confidence card was hardcoded `loaded: true`, on the reasoning that a
  report on screen proves its export was read. It ticked green about data the device no longer had.
- `rerunWithAdditionalData`'s no-signals branch did `JSON.parse(JSON.stringify(state.digest))` on a
  `null` and then dereferenced `digest.coverage`. That threw where nothing catches: the popout shut,
  no review opened, **no message appeared at all**, and the button read as simply broken.

All three are fixed together, because any one alone still leaves a reader stuck. The Instagram row
reads the digest like the other two, so missing means missing whichever source it is. The confidence
card swaps its "add Google to raise confidence" hint for one that says the evidence is gone, the
report is safe, and re-running will ask for the export again — a different message, because the
ordinary one is beside the point when the primary source is what went. The data-sources popout seeds
Instagram unticked to match, so it never promises to be holding an archive it does not have; Instagram
was always replaceable there, so the recovery needed no new UI. And the re-run branch asks for the
export back instead of dereferencing null. A single `writeDigest()` helper now wraps all four writes
and warns at the moment the digest fails to save, so the situation announces itself rather than being
discovered a fortnight later.

The recovery is driven end to end in `tools/uitest.mjs` — digest removed, reload, Instagram crossed
out, the report still whole, Continue-with-nothing-loaded producing a message instead of a
`pageerror`, then a real re-upload through the popout bringing the photographs back, sending one
analysis, restoring the digest and ticking the row green — with a `pageerror` listener asserting zero
uncaught errors across the whole thing. The quota failure that creates the state has its own isolated
page whose `setItem` refuses the digest key specifically, since a real quota wall cannot be aimed at
one key and aiming it is what proves the report still saves while the digest does not. Four
fault-injections: the hardcoded `loaded: true`, the unguarded null branch (which reproduces
`Cannot read properties of null (reading 'coverage')` verbatim), the popout's unconditional tick, and
the unchecked write.

**Back at the review steps upstream; only Escape leaves.** The popout and the review are one loop, for
the same reason the first upload's supplement offer and review are — `addDataAndRerun` now runs both in
a `for(;;)`, and `rerunWithAdditionalData` returns the `REVIEW_BACK` sentinel rather than swallowing it.
Back means "let me change what I am sending", and the only screen that can answer that is the one
behind it; returning to the report instead, which is what this did, threw away a source the reader had
just spent a minute loading and read as the button having failed. Nothing is re-read on the way back:
`pendingDataSourceReads` still holds any Google or Facebook fragment, a replaced Instagram export is
already in `state.signals`, and neither is cleared until a run actually commits — so a second pass
through the loop is idempotent rather than additive, and the popout reopens with the same ticks. Escape
is deliberately left alone and still abandons the whole attempt: the two gestures now mean different
things, where collapsing them was the bug.

**Dismissing the OS file picker is not Back, and used to be treated as it.** A reader who pressed
Google Takeout, thought better of the file, and then pressed Continue watched the whole re-run vanish
with no message at all. `<input type="file">` fires a `cancel` event of its own when the picker is
dismissed without a choice — and it *bubbles* — so with `#datasources-input` sitting inside
`#datasources-dialog`, that event reached the dialog's own `cancel` listener looking exactly like
Escape and set `cancelled = true`. The next Continue then resolved `null`, and `addDataAndRerun`'s
`if (!collected) return` did the rest, silently. Both this dialog's listener and `askSupplement`'s
Escape guard are now scoped to `event.target === dialog`, so a bubbled `cancel` from a descendant is
ignored — the same hazard existed in the supplement offer, where an unscoped `preventDefault()` was
refusing a dismissal the reader had every right to make.

**A paid unlock from before the rerun used to be quietly cleared, and now it is rewritten instead.**
`runAnalysis()` replaces `state.profile` wholesale on success, which used to be exactly what dropped any
`premiumAnalysis` left over from before — the paid sections read the *old*, smaller digest, and
carrying them forward under a new one would misdescribe what they are about. The payment itself was
never lost: the receipt in `psycheai_unlock` is written independently of the report, so
`hasUnfetchedUnlock()` picked the gap up on its own and the paid cards fell back to "Get the sections
you paid for", the existing lost-tab recovery path, borrowed for a different reason. That was a real
answer, but it charged nothing for a materially bigger request (regenerate the free report **and**
re-fetch four paid sections from newer evidence) and left the reader an extra click before either half
was actually current.

**Once premium is unlocked, "Add / change data & re-run analysis" now costs US$5, not US$2, and
rewrites everything in one request.** `rerunWithAdditionalData()` checks `Object.keys(paidAnalysis())`
before it builds anything: empty, and the button behaves exactly as documented above — the ordinary
US$2-or-free rerun, free report only. Non-empty, and the whole shape of the rerun changes:

- The digest is built without photographs even when `state.signals` is in memory, because it is about
  to feed the paid call, and nothing premium-adjacent in this app has ever carried a photograph — see
  `collectExtraDataForPremium`'s own no-photos rule below. Offering photos here and quietly dropping
  them afterwards would be worse than never offering them, so the review's photos row explains why
  instead.
- The review's Send button always reads "Make payment" (now "Proceed") — unconditionally, regardless of whether a free
  run is still available, because this is no longer the free-run allowance's price to set.
- Send does not lead to `authoriseAnalysis()`/`runAnalysis()` at all. It leads to `openPremiumDialog()`
  with a third product, `'rerunAll'`, and the digest just reviewed handed in as `pendingPremiumDigest`.
  That is the same variable `runPremiumAnalysis()`'s own bundled-refresh mechanism already watches —
  built originally for adding data on the way to a *first* unlock — so paying the US$5 here reruns
  the free report and regenerates all four paid sections together, on one authorisation, with no second
  copy of that machinery written. `runAnalysis()` is never called on this branch, so there is nothing
  left to wipe `premiumAnalysis` in the first place.
- The dialog itself says so before the charge is agreed to: a new title, "Re-run your full analysis",
  and a new blurb naming both halves, rather than reusing "Unlock premium sections" for a reader who
  already has them.
- The confidence card's fineprint switches from "Your next analysis costs US$2" to a note naming
  US$5 and both halves, and it has to be refreshed at the moment of unlock, not just at the next full
  render — an unlock with no added data never used to touch this note (`mustPayForAnalysis()`, what it
  read before, does not change when premium is bought), so the gap was invisible until the note started
  reading unlock status too.

`tools/uitest.mjs` drives all of this for real: the button appearing after an ordinary upload **and
surviving a reload**; pressing it on a reloaded page opening the popout straight away, with both
sources and their instructions, and **without** demanding the Instagram export (the file-chooser event
is asserted not to fire); the merge path sending a digest that carries both the Instagram evidence and
the new Google block, inside budget, in one request; Skip absent and Escape
refused in the forced dialog; Back leaving the digest, the profile and the request count exactly where
they were; and, once premium is unlocked, adding a Facebook export and completing the rerun sending
exactly one more free-report request and exactly one premium request — both against the enriched
digest, both authorised by the same unlock-tier charge — landing the paid sections filled back in
rather than cleared, a fresh receipt, no resume prompt left on screen, and the confidence card's price
note reading US$5 before any of it is even sent.

Each was fault-injected — dropping `requireAtLeastOne`, inverting the button's visibility condition,
forcing `alreadyUnlocked` false so the rerun fell back to the old US$2 path, and disabling the price
note's post-unlock refresh — and each broke a different, specific check. The reload check was
fault-injected against the original `state.signals` condition specifically, since that is the bug it
exists to prevent: it fails with `hidden=true`, and the file-chooser check behind it times out, which is
exactly what the reader saw.

### A closed dialog does not stop the fetch behind it

A reader hit `Cannot read properties of null (reading '__addedSupplements')` in the "you have
already paid" resume dialog, about 30 seconds into fetching the paid sections — and a second press
of the same button then worked. That timing is the tell: something the first attempt was still
doing got undercut by something the reader did in the meantime, and only the second attempt's clean
state let it finish.

`runPremiumAnalysis` snapshots `pendingPremiumDigest` into a local `paidDigest` once, at the top,
before anything asynchronous happens. Two spots deep in the function, after the network call that
actually takes the 30 seconds, used to read the *module-level* `pendingPremiumDigest` again instead
of that snapshot — on the assumption that nothing else touches it while a fetch most readers would
just wait out is running. Nothing enforced that assumption. `#premium-dialog` could still be closed
by Escape, a backdrop click, or Cancel while the fetch was in flight — closing a `<dialog>` does not
cancel the `fetch()` a click handler kicked off earlier — and `openPremiumDialog` unconditionally
resets `pendingPremiumDigest = null` at its own top every time it runs, including the resume path
that shows this exact dialog again. A reader who closed the dialog out of impatience and reopened
it — landing back on "you have already paid" because the receipt existed but the analysis still
had not — reset the variable the original call was about to read. It read `null.__addedSupplements`
the moment its `fetch()` finally resolved, and the error rendered straight into the resume dialog's
own status line, which is exactly what the screenshot showed.

The fix is two changes, not one — a guard on the trigger, and a guard on the read that would still
be one future caller away from the same crash if only the trigger were closed off:

- **The read.** Both post-`await` sites now use `paidDigest`, never `pendingPremiumDigest`, matching
  what the function already did *before* its own `await` calls. A local snapshot cannot be reset by
  code running somewhere else while this call is suspended, whatever that other code turns out to
  be — this one change makes the specific crash structurally impossible regardless of the trigger.
- **The trigger.** A `premiumRunInFlight` flag, set for the same span `guardUnload(true)` already
  covers, stops a second `runPremiumAnalysis` call from starting while one is already spending this
  reader's retry budget.

**The dialog itself was then closed off from Escape and a backdrop click entirely, not only while a
run is in flight — a separate, later request.** This sheet is either entering or authorising a real
charge, so a reader should only ever leave it by pressing Cancel, or by a run finishing on its own;
losing the whole sheet to a stray tap was never the intended behaviour, in flight or not. A native
`<dialog>`'s backdrop click actually targets the dialog element itself — no different, as far as the
DOM is concerned, from a click landing on the dialog's own padding, which is why "clicking any part
of the box" and "clicking outside it" were reported as the same complaint and fixed the same way: the
backdrop-click listener was removed outright, and the `cancel` event Escape fires is unconditionally
prevented.

**Cancel was the last door, and it is now shut too once something has actually been authorised.** The
moment a charge clears or a promo code is accepted, `runPremiumAnalysis` greys Cancel out alongside
the promo field and the wallet button it already cleared, and the sheet closes itself when the run
ends. Leaving mid-flight never stopped anything — the `fetch()` is not tied to the dialog, which is
precisely what made the crash above reachable — so all it ever did was hide the progress bar and the
retry button belonging to work already paid for. The catch block re-enables it, deliberately and
symmetrically: a *failed* generation is exactly when a reader must be able to leave, and that includes
someone whose promo code turns out to be wrong, for whom nothing was ever charged. `openPremiumDialog`
resets it on every open, because this markup is reused across every purchase and a sheet that opened
with no way out at all would be the worse bug by far.

That change exposed a smaller one worth naming: there was no `.btn:disabled` rule in the stylesheet at
all. A button the app had genuinely switched off — this Cancel, the promo Apply beside it, the sample
report's inert Unlock — sat at full strength, took a click, and did nothing, which reads as broken
rather than as deliberate. One rule now greys every one of them (greyscale plus a flat opacity, so it
lands the same way on the filled gradient, the ghost and the outline without three separate rules) and
withdraws the hover and active feedback with it.

`tools/uitest.mjs` reproduces the original race directly rather than only asserting its symptoms
separately: it slows `/api/premium-analysis` down (the same technique the mock-payment check above
already uses to make a transient state observable), checks Cancel is offered right up until the
moment something is authorised, presses "fetch my analysis" on the resume dialog, and while that
request is still pending checks Cancel has gone grey — both as an attribute and as computed style,
since the greying is half the point — then tries Escape, a synthetic backdrop click, and a direct
`.click()` on Cancel itself, checking after each that the dialog is still open. A real reader's click
on a disabled button dispatches no event at all, which is what actually holds them there, so the test
drives that same no-op rather than waiting on an enabled state that is never coming. It then lets the
delayed response land and checks the sheet closed itself, the console never logged
`__addedSupplements`, and the analysis completed regardless. Fault-injected three ways — reverting to
the old backdrop-click-closes listener, leaving Cancel enabled during an authorised run, and removing
the `.btn:disabled` rule — and each broke a different, specific check.

### A read inside "Add or change your data" survives Back

A reader opened "Add / change data & re-run analysis", picked Google Takeout, watched it read
successfully — the row ticked — and then pressed Back, or hit Escape. Reopening the same popout
afterwards showed Google unticked again, as if nothing had happened, and reading the same archive a
second time was the only way forward.

`askDataSources()` is called fresh every time the button is pressed; nothing carried state between
calls. Its own `added` map seeded Google and Facebook only from what `state.digest` already
permanently held (`Boolean(digest && digest.google)`), which is correct for anything already
committed but blind to a read this same popout had *just* done, in this same call, if that call then
resolved `null` on Back rather than reaching Continue. The read itself was real: `Supplement.readGoogle`
had genuinely parsed the archive and `added.google` briefly held the fragment — it just was not kept
anywhere once the promise resolved, because Back's whole contract is "resolve `null`, touch nothing".
That contract is right for `state.digest` and the stored report, which must not change on a whim, but
it was quietly also erasing work the reader had already done, which is a different thing entirely:
Back means "not right now", not "throw that away".

The fix adds one piece of state scoped to *this popout's own attempts*, not to the report:
`pendingDataSourceReads`, a plain object keyed by source, holding the same fragment `read()` produces.
It is written the moment a Google or Facebook read succeeds — regardless of what happens to the
dialog afterwards — and folded into `added`'s seed alongside the `state.digest` check
(`Boolean(digest && digest.google) || pendingDataSourceReads.google || undefined`), so a fragment read
in an earlier, abandoned attempt still shows loaded, and — since the caller's own
`typeof value === 'object'` test still sees a real fragment rather than a bare `true` — is still ready
to send the moment Continue actually is pressed, without asking the reader to pick the file again.
It is cleared in exactly the two places that make it stale: a fresh Instagram upload in `handleFiles`
(a new report owes nothing to the last one's abandoned attempts), and the point in
`rerunWithAdditionalData` where a rerun actually commits — at which point `state.digest` already
carries the fragment permanently, so keeping a second copy here would be pure dead weight.

**Escape needed its own fix alongside it, and not a cosmetic one.** `askDataSources()` had no
`cancel` listener at all, unlike `askSupplement()`'s own `blockEscape` a few hundred lines above it.
A native `<dialog>` closes on Escape by default, `cancelled` stayed `false` because only `goBack` ever
set it, and the `close` handler resolves `cancelled ? null : added` — so Escape used to resolve
exactly as if Continue had been pressed, silently sending whatever was loaded into the review dialog
that follows. A reader reaching for the universal "get me out of this" key got the opposite of an
exit. The fix is a `cancel` listener that sets `cancelled = true` and otherwise does nothing — Escape
should still close the dialog, it just now means what Back means rather than what Continue means.

`tools/uitest.mjs` extends the existing "Back discards a source loaded inside the popout" check
rather than replacing it — that check's own claim (nothing sent, nothing in `state.digest` or
`localStorage` changes) is still exactly true and stays as its own assertion. Immediately after it,
the popout is reopened — with a `filechooser` listener attached to prove no picker fires — and Google
is checked still ticked. The same shape is repeated for Escape: open the popout, press Escape, confirm
nothing was sent and the review dialog never opened, then reopen once more and confirm the tick
survived that path too. Fault-injected by reverting each half independently: dropping the
`pendingDataSourceReads` seed fails both "still shows loaded on reopen" checks directly; dropping the
`cancel` listener (restoring the old no-op) reproduces the original bug's own trigger — Escape closes
the dialog and silently continues into the review — which then cascades into a timeout later in the
suite, when a subsequent step collides with a review dialog a prior step's "cancellation" had actually
left open behind it.

**The carry-forward note then needed to catch up to its own fix.** `#datasources-instagram-note`
("Replacing Instagram starts your Google and Facebook data fresh too — reload them here as well if
you want them included in this run.") used to appear the instant Instagram was replaced, full stop,
with no regard for whether there was actually anything at risk of being lost. Before
`pendingDataSourceReads` existed, that blanket rule was at least never *wrong* in the case that
mattered: a Google or Facebook row ticked only because `state.digest` already carried it
(`added.google === true`, the seeded boolean) genuinely would not survive a `Digest.build()` rebuild
from a fresh Instagram export, because a stored digest keeps only the sampled, capped view, not the
raw fragment the rebuild needs. But a row ticked because it was *just read in this same popout* —
which was always possible within one open dialog, and now also possible across a Back thanks to
`pendingDataSourceReads` — carries the real fragment, and rides forward into the rebuild exactly as
if it had been read again. Warning about losing something that was not actually going to be lost is
its own kind of wrong, and became more common the moment reads started surviving Back.

The fix folds the note's visibility into `markAdded()`, which already runs every time `added` changes
shape: `hidden = !(replacedInstagram && (added.google === true || added.facebook === true))`. Only the
seeded boolean trips it — an object, whichever way it got there, does not. Recomputing it in
`markAdded()` rather than only at the moment Instagram is read also means reading Google or Facebook
*afterwards*, in the same dialog session, correctly clears a note that was showing a moment before.

`tools/uitest.mjs` covers both directions with the fixture already built for the persistence checks
above: reopening the popout on the Back-preserved Google tick and then replacing Instagram confirms
the note stays hidden (the real fragment carries forward), while the pre-existing "replacing Instagram
shows the note" check — now backed by a genuinely committed `digest.google` from an in-memory session
rather than a fresh read — still expects it to appear, and does. The wait condition needed care here:
Instagram's own row carries `.is-added` from the moment the dialog opens (it is always "already
loaded"), so waiting on that class proves nothing about a fresh read actually finishing — the fix
waits on the row going busy and then idle again instead, the same caution the pre-existing "shows the
note" check next to it already took by waiting on the note itself rather than the row. Fault-injected
in both directions: forcing the note to always follow `replacedInstagram` alone reproduces the false
positive directly; forcing it permanently hidden times out the older check that proves the warning
still fires when it should.

**A related question turned out to already be answered correctly, and just untested:** does the
"Data sources" subsection's tick for Google or Facebook also update when that data was added through
the *premium unlock's own* data offer (`collectExtraDataForPremium`, a different dialog entirely —
`askSupplement`, not `askDataSources`) rather than through this rerun popout? It does — `sourcesUsedHtml()`
reads `state.digest` directly, and the bundled free-report refresh that runs alongside a paid unlock
(see "One consolidated block before unlock, four cards after") already writes the enriched digest into
`state.digest` and calls `renderProfile()`, which redraws this subsection along with everything else.
Verified directly rather than assumed: a check now confirms the Google row ticks in Data sources
after that exact bundled-refresh path, alongside the existing checks for the digest and the paid
sections themselves — a gap in coverage, not a gap in behaviour.

### Losing an in-progress analysis to the back button

Two long calls carried no protection against a reader simply leaving mid-flight: the free report's
own generation (`runAnalysis`, used by both a first upload and "Re-run analysis with additional
data") and a compatibility comparison (`runMatch`). Each shows the same `#view-working` screen for up
to a few minutes, and neither called `guardUnload(true)` — the same one-line guard
`runPremiumAnalysis` already carries, registering a `beforeunload` listener that asks the browser to
confirm before the tab is actually left. Without it, a reader reaching for the back button — on a
phone, the natural gesture for "get me off this screen," and not obviously different from leaving
any other loading screen — would navigate away with nothing to stop them, aborting the in-flight
`fetch()` and losing the analysis outright, no warning, no confirmation, nothing to undo it.

The fix adds the identical guard to both calls, restructured into a `try`/`finally` so it lifts on
every exit path — success, a thrown error, or the early return `runAnalysis` takes when a pending
compatibility match runs immediately after (`stopElapsed()` moved into the same `finally`, rather
than being duplicated in both the success and catch branches as before). Nothing else about either
function's behaviour changes: the guard only ever asks the browser to confirm before leaving, it
never blocks navigation outright, and a reader who really does want to leave still can.

`tools/uitest.mjs` proves the guard is actually wired up, rather than trusting the one-line diff: it
dispatches a synthetic `beforeunload` event via `page.evaluate` and reads back whether it was
prevented, both before a comparison starts (not prevented — nothing running yet) and while one is
deliberately slowed down mid-flight (prevented), then again once it lands (not prevented — the guard
lifted). A synthetic event was used rather than driving a real navigation through Playwright, since
`beforeunload` dialogs are handled inconsistently enough across browsers and Playwright versions to
make that the less reliable test, not the more thorough one. Fault-injected by dropping the
`guardUnload(true)` call from `runMatch`: the mid-flight check fails directly, which is the one this
whole fix exists to prevent.

**Whether the "back" instinct itself needs handling separately from the confirmation prompt** — i.e.,
whether the working screen should also push a history entry the way the report view below does, so
Back cannot even reach a state where the prompt is needed — was considered and set aside for now: the
`beforeunload` confirmation is the same protection the premium flow already relies on, and the
working view has no dialog-like "cover the page, then get out of it" shape to hang a history entry
off in the first place. Worth revisiting if a reader ever reports the prompt itself as confusing
rather than as not appearing at all.

### Any secondary view leaving the site on Back

The first pass at this fix only covered `show('report')` — reached from a fresh comparison or a past
one in the history table — with a dedicated `showReport()` wrapper. It shipped, and the very next
report named the actual scope of the bug: the compatibility *scan* page and the FAQ had the identical
problem, for the identical reason, since neither pushed a history entry either. A one-off wrapper for
one view was the wrong shape for a bug that was never about `report` specifically — it was about
`show(view)` being the single funnel every view change already runs through, and none of them pushing
anything for the browser to pop. A reader on a phone reaching for Back from any of these — "My
Compatibility", the FAQ, a comparison's result — left the site entirely rather than returning to
their own psyche page, the same failure `showSample()`'s dialog needed fixing for its own overlay.

The fix moved into `show()` itself, generalized rather than duplicated per view. Two view lists name
the two roles: `SECONDARY_VIEWS = ['scan', 'report', 'about']` are the views a reader reaches by
navigating away from wherever they actually live, and `HOME_VIEWS = ['welcome', 'profile']` are the
two places Back should land — whichever is real, which is exactly what `go('home')` already knows how
to pick. `'working'` deliberately belongs to neither list: it is a transient step *inside* reaching
`report` (`scan` → `working` → `report`), never a page someone arrives at directly or means to leave
from, so it must not trigger a push or a pop just by being shown in between.

`show(view)` now pushes one history entry — guarded on `!navHistoryEntry`, so moving between two
secondary views (`about` → `scan`, or `scan` → its own `report`) never stacks a second `pushState`
behind the first — the moment `view` is a secondary one and no entry is already open for this
excursion. One entry covers the whole excursion, not one per view visited inside it, which matches
what a reader actually wants from Back: return to where they started, not retrace every screen they
happened to pass through. Landing on a home view consumes that entry the same way, whether the reader
got there by pressing Back or by any other route — a nav-link click, "Back to my profile," a fresh
upload — because leaving a secondary view any way other than Back still has to give the entry back,
or a later Back press from wherever that other navigation landed would pop a phantom state and jump
home unannounced. The `popstate` listener that already existed for the sample dialog gained the
equivalent second branch, reached only once the sample dialog (if it happened to be open on top of
whatever secondary view) is out of the way: pop the flag and call `go('home')`, which is what makes a
reader who opens the FAQ before ever having a profile land back on `welcome` rather than a `profile`
view that does not exist yet.

`tools/uitest.mjs` drives a real comparison through to its report and presses the browser's actual
back button (`page.goBack()`), confirming the psyche page comes back rather than the site's exit —
and does the same from the FAQ, reached by a plain nav click with no comparison involved at all, to
prove the fix is genuinely general rather than still secretly report-shaped. Both follow the same
shape as the sample dialog's own back-button check earlier in the suite. Fault-injected by dropping
`'about'` from `SECONDARY_VIEWS` alone: the FAQ back-button check fails directly, and the very next
step — a plain nav-link click that assumes the page is still there to click on — times out, the same
cascade a real reader leaving the site would produce.

### When, not just whether

An export flattens a decade into one pile. Until now the model got that pile with no way to date any
of it: `sampleTexts` stripped everything but the string, so 560 captions arrived with nothing to say
whether one was written in 2016 or last month. It could see the *shape* of a life over time —
`activity.monthly` is complete rather than sampled — and could not place a single thing anybody had
said inside it. An interest somebody dropped four years ago and one they are in the middle of reached
the reader identically.

**Every sampled caption now carries its year**, as a leading `[2019] ` prefix. Comments and messages
take the same treatment where the source dates them. The cost is four characters and a space per
item — under 4,000 characters across the full sample, about a sixth of a cent — which is why this
never needed to be a trade-off discussion.

`interests` and `values` each gained a `trajectory` and a `lastSeen` year. The six trajectories are
**structural** (across the whole span, including recently), **stable** (several periods, confirmed
within about eighteen months), **rising**, **declining**, **dormant** (last evidence over two years
old) and **phasic** (ran for a defined window and stopped). Dormant is the one that earns its place:
without it the honest answer to "do they still run?" had to be squeezed into either "yes" or silence.
The report renders it as a chip beside the intensity one — two questions, "how much" and "still?", so
they get two chips rather than one compound label — and the three that mean *the evidence stopped*
carry the year and the same red the missing-source cross uses.

The prompt names the trap directly, in the reference implementation's words: **a runner in 2015 is
not necessarily a runner in 2026.** Two counter-cautions sit with it, because the failure mode of a
temporal rule is over-applying it: reduced posting is not a reduced life (people stop performing an
interest long before they stop having it), and an undated caption is unknown rather than ancient.

**Dating the captions immediately exposed a bug in the sampler that had been there all along.** The
"take the most recent half" step was `cleaned.slice(-recentCount)` — the tail of the array, on the
assumption it ran oldest-first. A real Instagram export does not: `posts_1.json` leads with the
latest post. So the tail was the *oldest* half, and the sampler had been doing the exact opposite of
what its own comment claimed, for as long as it had existed. Nothing caught it because nothing
downstream knew when any caption was written. The fix is to sort on the timestamp rather than
inherit whatever order the parser produced, which also makes the output one chronological run instead
of two interleaved halves. A check builds the same captions in both orders and asserts the sample is
now identical either way; under the old code the two differed completely.

### Nothing behind a dialog moves

`showModal()` makes the rest of the page inert — unclickable, untabbable — but it does not stop it
**scrolling**. A wheel or a swipe anywhere outside the dialog still ran the page underneath, so a
reader working through a long popout could look up and find the page behind them somewhere else
entirely, and on a phone the two scroll areas fought over every gesture.

One rule fixes it for all eleven dialogs and for the twelfth automatically:

```css
body:has(dialog[open]) { overflow: hidden; }
```

Written as `:has()` rather than a class toggled from JS because a class has to be added and removed
by every open and close path, and this app has several — including the `setAttribute('open')`
fallback some dialogs use where `showModal` is missing, which a JS toggle would have had to remember
separately.

`scrollbar-gutter: stable` is the other half, and its scoping is the interesting part. Hiding overflow
removes the scrollbar, and where that scrollbar occupies layout width the page shifts right by 15px
the instant a dialog opens — a visible lurch behind the thing that just appeared. Reserving the gutter
keeps it still. But applied unscoped it costs 15px on a phone, which draws scrollbars as an overlay
and so has no width to lose and no lurch to prevent — 5% of a 320px screen given up for nothing. The
suite caught that directly: five `does not scroll sideways` checks went to `-15px` the moment it
landed. It is scoped to 560px and up, the app's own narrowest breakpoint.

One limit worth stating: iOS Safari does not always honour `overflow: hidden` on the body for touch
scrolling. The dialogs' own `overscroll-behavior: contain` catches the common case — a swipe that runs
past the end of the dialog's own scroll — and the bulletproof fix (`position: fixed` on the body)
loses the reader's scroll position on open, which is worse than the problem.

### The psyche card's close button

It used to sit top right, diagonally opposite the download and share buttons it belongs with. It is
bottom right now: every control on one line, and under the thumb on a phone rather than at the far end
of a reach.

The part that needed care is that it must never land on those two buttons. It is positioned against
the action bar rather than the viewport, and the bar carries a matching gutter on its actions row, so
the gap is a fact of the layout rather than a coincidence of widths. That mattered more than it looked
like it would: the pair of pill buttons is centred, and **at 320px they run 25px underneath a
viewport-fixed cross** while looking perfectly fine at 390px and up. The first version of the check
stopped at 390 and pronounced the gutter unnecessary — fault-injecting it passed, which is what
exposed the check rather than the code. The geometry is now asserted at 320, 390 and 1100.

The bar also needed `justify-self: stretch`. The dialog sets `place-items: center`, which centres
*and* shrinks both its grid rows — right for the card above, wrong for a bar whose close button is
meant to reach the corner. Without it the cross landed a third of the way in from the right on a
laptop and only looked correct on a phone, where the content happened to fill the width anyway.

### The step-by-step guide

"See illustration" in the how-to card opens the export journey as real screenshots of the real
screens: seven captures across four steps, each with a caption saying what to tap. The numbered list
in the card stays as it was — that is the quick version for somebody who has done this before. The
button was "Show me step by step", which described the numbered list it sits beside as much as the
thing it opens; what is actually behind it is pictures.

**Four steps, numbered 1 to 4.** Date range, format and media quality are three fields on one
"Confirm your export" screen, so they are three bullets inside step 3, not steps of their own. They
were numbered 3, 4 and 5 in their own pills, which made a four-screen journey advertise itself as six
steps and gave three fields the same visual weight as the four screens around them. A check pins the
step numbers as the literal sequence `1,2,3,4`, because that is the claim — "there are four of these"
— rather than counting elements, which stayed true the whole time the labels said otherwise.

The step 3 capture (`guide/07-confirm-export.jpg`) was cropped in October 2026 to drop the empty
back-arrow bar above *Confirm your export*: 80 pixels off the top, 480×866 to 480×786. Its ring
(`.guide-mark-7`) moved with it, from 70.4% / 25.8% to 67.4% / 28.4%, so it still frames the Date
range, Format and Media quality rows.

The first version drew the screens as CSS sketches, because Meta's UI is theirs and a capture goes
stale silently the next time they move a menu. That was the wrong call: a sketch tells a reader a list
exists, where a capture tells them what the row they are hunting for actually looks like — which is
the whole reason somebody opens a guide instead of reading six lines.

**Every screenshot was redacted before it shipped, and that was not optional.** The originals carried
the account holder's full name, three handles, a **phone number**, an **email address** and their
profile photograph. None of it teaches anybody anything, and this is a public page on a branch that
deploys on push. The grey blocks are deliberate; the platform labels beside them are untouched,
because "the row that says Instagram" *is* the instruction. A check asserts the guide's own markup
never names the account, since alt text is where a redacted image most easily leaks what it was
hiding.

**Every screenshot rings the thing to tap.** A capture of an Instagram menu is a picture of fifteen
rows, and the reader needs one of them — the ring is what turns "here is the screen" into "here is
what to press", and it is the difference between a guide and a gallery. The rings are positioned in
percentages over the image from the markup rather than burnt into the JPEG, so they scale at every
column width and can be corrected without re-exporting a picture. They are magenta rather than the
app's own accent, because these sit on Instagram's white and blue UI and a purple ring on a blue
button is the one pairing that does not read; the white outer ring is what keeps them visible where
they cross a grey row rather than a white one. `aria-hidden`, since the caption and the alt text both
already say what to tap.

**No horizontal scrolling.** The screenshots were a sideways scroller — three across where there was
room, swipe on a phone. That hid two of every three behind a gesture nothing on the page advertised,
inside a dialog whose entire job is to show somebody what they are about to look at. It is a wrapping
grid now: three on a laptop, one on a phone, everything reachable by scrolling the one direction the
dialog already scrolls.

**The three settings are three bullets**, each one sentence: what to change, what to change it to,
and why in a few words. This started as three headed paragraphs — which gave "media quality" as much
room as the setting that costs a reader their afternoon — then became a grid of numbered rows, and is
now the plainest thing that carries the same content. The format bullet keeps its warning, "JSON —
**not HTML**", because naming only the right value reads as a preference where naming the wrong one
reads as a trap. It dropped the two-row HTML/JSON widget in favour of that one phrase; the check that
used to pin the widget now asserts the warning instead, which is the thing the widget was for.

**The guide ends at the upload, not at a summary.** The last step carried three fact boxes — arrives
in, link valid for, file format — restating what the steps above had just said, in a dialog whose
last useful sentence is "now go and upload it". A closing paragraph about Instagram moving its menus
around went with them: it hedged the whole guide at the moment a reader should be leaving it, and the
seven screenshots are a better answer to "the labels have changed" than a paragraph warning that they
might.

**The how-to card's own numbered list lost the same widget, and a clause besides.** Step 1 no longer
says the deep link "goes straight to the right page" — the link's own text already promises that, and
a reader who has clicked the same kind of link before does not need it restated. Step 4 shrank from a
sentence naming the cost of getting it wrong plus a struck-through HTML/JSON widget to one line: "Set
Format to JSON, not HTML." The widget made sense back when this was the only place the setting was
shown; now that the guide carries real, ringed screenshots of the exact same screen, drawing it twice
was the redundant copy, not the concise one. The widget's CSS and its two other copies — the Google
fallback instructions on this page and the identical copy inside the supplement dialog — went with it;
all three now carry the same one-sentence warning as plain text, and a check confirms no `.format-trap`
markup is left anywhere on the page.

**Four of the seven are cropped to their top half.** A phone screenshot is 931px tall against 480
wide, and on four of these screens everything the reader needs is in the first third — the rest is
menu rows they are not being sent to, or, on the "Create export" screen, half a page of white. Cropped
to 466px they show the row and its context and nothing else, and the four files together dropped from
138KB to 88KB.

That crop has a trap in it worth naming, because it is the kind that fails silently: the rings are
positioned as percentages *of the image box*, so halving an image's height without changing the
`height` attribute leaves every ring on it pointing at the wrong row. There is a check for it now —
each declared `width`/`height` has to match the file's own `naturalWidth`/`naturalHeight`. The
existing "the ring sits inside its screenshot" check would not have caught it: a ring at the wrong
percentage is still inside the picture.

**Steps 2 and 3's four screens lost their browser chrome as well.** Those four are the ones served
from `accountscenter.instagram.com` rather than the Instagram app itself, so each carried roughly
65px of address bar — the padlock, the URL, the "Instagram" subtitle — sitting above the actual
screen. None of it is an instruction; it is the same bar on all four and teaches nothing after the
first one. Cropped away, the same trap applied a second time: every ring's percentage had to be
recomputed against the new, shorter box rather than just re-measured by eye, since a ring left at its
old percentage would still land "inside the picture" — just the wrong part of it.

**The "Tap Instagram" screenshot lost its bottom half too, on top of that.** Once the chrome was gone,
the profile list still ran on well past Instagram's own row into Meta, WhatsApp and Threads — rows the
caption never sends anyone to. Keeping only the top half leaves Facebook and Instagram in full and the
next row cut off mid-line, which is what the alt text now says rather than naming platforms that are
no longer in the picture.

**The screenshots have a real border.** They had one already — a `--line` hairline, which is the pale
lilac used to separate rows *inside* a card. Against a white phone capture on a near-white dialog that
is not an edge at all, and the pictures bled into the page. It is a proper mid-grey now with a soft
shadow under it, so a capture reads as a thing lying on the page rather than as more page. The check
measures the border's contrast against the background rather than asserting a border exists, since a
border painted in the background colour would satisfy the latter and be exactly the bug.

They are downscaled from 1080px to 480px and `loading="lazy"` inside a closed dialog, so a reader who
never opens the guide never downloads any of it. Each carries explicit `width`/`height` so the dialog
does not reflow as they arrive.

One thing worth recording about the tests. The new block declared `const shots` for the screenshot
locator, which shadowed the module-level `--shots` flag inside that scope and silently switched on
every screenshot-writing branch in the suite. One of them then timed out on a locator that was not
ready, and the reported failure was a wellness-card screenshot several hundred checks away from
anything that had changed. The variable is `guideShotImgs` now.

**The caption moved above the picture, and two sentences that only narrated the screenshot are gone.**
A caption below a picture reads as a footnote to something already shown; above it, it is the
instruction the picture then proves. All six captioned screenshots were rebuilt this way — figcaption
first, then the frame — and a check pins the order rather than just the caption's presence, since a
caption in the wrong place still passes any check that only asks whether one exists.

The two sentences it dropped alongside that move were pure narration of what a screenshot already
showed: "Choose the profile with the Instagram badge — not Facebook, Threads or WhatsApp" when the
picture already rings the Instagram row, and "All three are rows on the one Confirm your export screen
— ringed below" when the three bullets underneath now say exactly what those rows are. The step 3
screenshot's own caption, "The three rows sit at the bottom", went the same way and was not
replaced — it has no caption at all now, because the bullets above it already say what to do with it.
That makes the guide's screenshot count and its caption count genuinely different numbers for the
first time (seven pictures, six captions), so the check that used to require every screenshot to carry
a caption was split into two: one asserting the alt text on all seven, a second asserting the caption
on six and confirming the seventh — matched by its filename, not by position — is the one without.

**Step 3's bullets and its "Start export" line moved above the screenshot they describe**, for the
same reason as the caption move: a reader hit "ringed below" before anything was ringed yet, because
the paragraph came before the picture but the picture came before the settings it was ringing. Reading
order is now: what to change, then what it looks like changed. The check walks `compareDocumentPosition`
between the settings list and the screenshot rather than reading rendered pixel order, so it holds at
every viewport width the grid reflows to.

**Step 1 says where the deep link actually lands.** It used to say the link "goes straight to the
right page", which is true and useless — a reader who has just been handed a link expects it to work,
and the sentence's real job is telling them what to skip if it does not. It names the step instead:
"The link above brings you to step 2." That is a claim about the guide's own numbering rather than
about Instagram, and nothing in the markup connects the sentence to the step it names, so it would go
quietly false the next time a step was added or reordered. Two checks hold it: the number has to match
a step the guide actually has, and that step has to be the one showing the screen the link opens
(`04-create-export.jpg`). The second is the one that matters — pointing at an existing but wrong step
is the failure that looks fine.

**Step 1 now names the mobile route instead.** "Click Download your information. If you are on your
mobile, you can also go to your Instagram app > Settings > Accounts Centre > Your information and
permissions > Export your information", the same in the steps, the illustrated guide and
`/download-instagram-data`; the "if the link doesn't open" footnote is gone, and with it the "brings you
to step 2" sentence and its two checks. In the steps (not the guide, which shows the screens anyway) each
of the three screen names is a button (`.ui-peek`) that shows its screenshot from the guide, ring and all.
**Menu (≡)** in step one is one too (`guide/00-profile-menu.jpg`, `.guide-mark-0`): the top half of the
PsycheAI account's own profile, cut above the "Follow some accounts" suggestions so no one else's
photo is in it, with the menu button at the top right ringed. It is the guide's first picture as well.
"your Instagram account" in step two is one too (`guide/05-pick-profile.jpg`), and the Accounts Centre
screenshot is cropped to the rows from its title down to Ad preferences. The guide's step one no longer
repeats the route as a sentence: its screenshots carry it. On a phone, See illustration is a link under
the steps, *See the illustrated walkthrough* (`#steps-guide-open`), rather than the button beside the
title, which stays on a laptop.

**In a popout they are plain text again (October 2026).** Inside the Add your data popout's *See
download instructions*, the purple pills and the numbered rows were too small to read or tap, so
that copy is drawn like the WhatsApp and Google steps (`plainHowto`): each pill becomes an ordinary
label, and the three settings become one sentence: *set: Date range to All time, Format to JSON (not
HTML), Media quality to Lower.* The front page keeps the rows and the screenshots.

**The steps as rows (October 2026).** Five numbered rows (`ol.howto-rows`), each a full sentence, with
every screen name that has a screenshot as a purple pill, and plain or bold text for one that has none
(Profile, Start export), so a pill always opens something. Step four sets the three values as a small
table on **Confirm your export**: Date range All time, Format JSON (not HTML), Media quality Lower. A
line above says how to open them, by device: *Tap a purple label to see that screen* on a phone,
*Hover over a purple label…* with a mouse (`(hover: hover) and (pointer: fine)`). Step five ends
"load it into PsycheAI below", and the "below" is hidden in the data popout, where the upload is
above. The steps, as before:
on hover with a mouse, and on a tap or click anywhere, kept open until the next tap elsewhere or Escape
(`mountPeeks` in `docs/app.js`). The popup is placed beside its name inside the window, drawn narrower
when the screenshot is too tall for the room, and added to the open dialog when there is one so it shows
above it.

**The guide ends with a "Start here" button** rather than a sentence pointing at the bottom of the
page. It closes the dialog and scrolls straight to the upload card, the same way the hero's own
"Analyse my data" button already lands on the how-to card — so a reader who has just read six screens
of instructions does not also have to go find the box they were reading about. The check clicks it and
asserts both halves: the dialog is gone, and the upload card's own top edge is what is now under the
nav, not merely "somewhere on screen".

**The order of those two things is load-bearing, and it was wrong.** Closing the guide gives back the
history entry it pushed, and the browser then restores the scroll position that entry was created at —
wherever the reader was standing when they opened the guide. That restoration lands *after* a scroll
started before it, so scrolling first raced it and lost: the button dropped the reader back where they
started, with no sign anything had been attempted. The scroll now waits for the pop to land — a
`popstate` listener and two animation frames, the first for the handler and the second for the
browser's own restoration to paint — and only then moves the page. Measured 5/5 failing in the old
order and 5/5 correct in the new one.

Worth recording how close this came to shipping, because the test was the problem twice over. It first
passed on a flat 600ms wait, which happened to land in the gap before the restoration arrived. Made to
poll for two equal readings instead, it then failed *every* run — but for the wrong reason: the scroll
does not begin until two frames after the pop, so two equal readings were satisfied by the quiet
period before it started, and the check was measuring an unscrolled page. Fixing that to require
movement *then* stillness made it pass again — including against the known-broken ordering, because
the restoration lands after the smooth scroll finishes easing, so a short stillness window reads a
position the browser is about to yank back. Only requiring 600ms of sustained stillness separated the
two. Three versions of this check passed against a genuinely broken button; the one that finally
distinguished them is the one pinned now, and the ordering fix was verified against a direct
five-run measurement rather than against the suite.

### "Start here" is a button and a popout, and a failed run costs nothing to retry

The welcome page asked for a file through a dropzone that only ever took Instagram, and the report
page asked for the same three sources through a popout with per-source ticks. The dropzone is gone:
the card carries a **button** that opens the same `#datasources-dialog` popout, so all three sources
are offered in one place on a first upload instead of Instagram here and the other two in a later
dialog.

**The reason it matters is what happens when an analysis fails.** Nothing is lost — `docs/app.js`
sets `state.digest`, `state.signals` and calls `writeDigest(digest)` *before* `runAnalysis`, and the
digest is the only thing the server is ever sent. But `showUploadError` returned the reader to a
welcome page whose sole affordance said "Drop your Instagram .zip here", so the only visible option
was to upload everything again. It was a dead end, not data loss, and it was producing exactly the
expensive double run the server-side fixes above are also aimed at.

Now the card reads its own state: the button says **"Continue with your data"** and a line under it
names what survived — *"Instagram and Google already loaded — nothing to upload again."* Opening the
popout shows those same rows ticked. `refreshStartHere()` reads `state.signals` and `state.digest`,
the same two places the popout seeds its ticks from, so the card and the popout cannot disagree; it
runs on every arrival at the welcome view rather than only at boot, because arriving is when the line
is read. The checks name the sources individually rather than counting them — "two sources" would
pass while naming the wrong two, and telling a reader *which* of their exports survived is the whole
job of the line.

**One dialog, two audiences.** It was saying the report page's words to both: *"Add or change your
data"* describes a report that does not exist yet and offers to replace data nobody has loaded, and
the Instagram row's *"…to replace it"* had the same problem one line down. `askDataSources()` now
takes a `title`, a `blurb`, `sublines` and a list of `sources`; the welcome page passes **"Add your
data"**, while the report page passes nothing and gets all four rows and its own wording back.
Facebook is not gone, just not offered at the point where a reader has uploaded nothing yet — it is
one screen away, on the report page, which is where somebody who wants it will already be.

**What a new reader is offered.** "Load your data" shows three rows, in this order:
1. **Instagram (required).** (Until October 2026: now Instagram or three WhatsApp chats; see "One file box, and WhatsApp chats alone".)
2. **WhatsApp chat with a close friend (optional).** One chat only (`whatsappMax: 1`): a second
   replaces the first (*One chat is the most here — this one replaces the last.*), and the row reads
   *Chat loaded — tap to load a different one*.
3. **Google Takeout (optional).**

The download instructions under *See download instructions* follow the same order: Instagram, WhatsApp
(the chat's ⋮ → More → Export chat → Without media), then Google Takeout.

`askDataSources()` also takes `titles`, `tags` and `whatsappMax`, and puts the rows and their
instruction blocks (`[data-help]`) in the order of `sources`. Every opening sets the order, labels and
limit afresh, keeping each label's markup text in `dataset.defaultText` like the sub-lines, so the
report page still shows *WhatsApp chats (up to 3)*, *Google Takeout (recommended)* and its own order.
`tools/uitest.mjs` loads Instagram and two chats as a new reader, checks the second replaced the
first and that one chat reaches the review, and checks the report page still offers three.

Two traps in that, both of which had to be written out rather than assumed. Rows are *hidden*, not
removed, and `.mode-option`'s own `display: flex` beats the user agent's `[hidden] { display: none }`
outright — specificity never enters into it — so without an explicit `.mode-option[hidden]` rule the
row would be excluded from every list in the function and still drawn on screen. And the sub-line
override works by overwriting the markup's text, so the original is stashed in `dataset.defaultText`
the first time and restored on every later open; without that, the welcome page's wording would stick
for the rest of the page's life. The suite can prove the stash exists but *not* that the restore
works: eight page reloads sit between the one welcome-page use and the first report-page use, and a
reload restores the markup anyway. Injecting the leak passes the suite unchanged, so what is checked
is the half that can fail.

**And Back at the review kept losing the tick.** The Instagram row was seeded from `state.digest`
alone — but a first upload has no digest until the review has been agreed *and paid for*. So a reader
who loaded their export, pressed Continue, then pressed Back found the row unticked and was being
told to load the same archive again: the exact thing this popout exists to prevent, at the moment it
is most likely. Seeding from `state.signals` as well — set the instant an archive is read — is the
fix, and it is the one source that had no memory of its own because on the report page a digest was
always there to stand in for it.

`startFromSources()` then does the popout → review → payment → analysis loop, with Back at the review
stepping upstream to the popout rather than abandoning the run. It is deliberately not routed through
`rerunWithAdditionalData()`, which does the same three steps on the report page: that one also has to
decide whether a US$5 unlock is regenerating four paid sections alongside the free ones, and there
is no report here for any of that to be true of. The shared thing is the popout and the review, not
the pricing.

**Drag-and-drop survived the change**, moved from the box to the card itself. An Instagram export
arrives as several `.zip` parts and dropping them together is genuinely faster than a picker; nothing
advertises it any more, which is the trade — an accelerator for people who already reach for it. The
`.upload-card.is-over` highlight only appears while something is actually being dragged, so the
affordance shows exactly when it is usable and costs no space the rest of the time.

### Backing out of an upload

The dropzone sits near the foot of a long welcome page. Uploading covers it with the working screen
for a moment, and pressing Back at the supplement offer used to drop the reader at the **top** of the
page they had never really left — so the next thing they had to do was scroll a page and a half back
down to reach the box they had just been using.

`show()` scrolls every view change to the top, which is right for arriving somewhere and wrong for
backing out. Both abandon paths — Back at the offer, Escape at the review — go through one
`abandonUpload()` that remembers where the reader was standing (read *before* `show('working')`,
since show() scrolls to the top itself) and puts them back. The restore overrides show()'s scroll
rather than suppressing it: both run in the same synchronous task, so nothing is painted between them
and there is no visible jump.

There was a `keepScroll` option threaded through `show()` at first, and fault-injecting it exposed it
as dead weight — the suite stayed green with the option ignored, because the explicit restore put the
reader in the right place either way. An option no test can catch failing is worse than no option, so
it came out and the check now bites on the line that does the work.

**And the upload box has to still work afterwards**, which is the half that actually looked broken. A
file input only fires `change` when its value *changes*, so picking the same archive twice in a row
fires nothing at all. After abandoning an upload the most likely next action is to pick that same file
again — and it was the one action that silently did nothing: the OS chooser opened, the reader chose
their export, and the page sat there. Clearing `fileInput.value` on every pick is what makes the
second attempt fire like the first. Both of the app's other file inputs already did this
(`askSupplement`, `askDataSources`, which document the hazard in their own comments); the main
dropzone was the one that never did.

Playwright's `setFiles` dispatches `change` whether or not the value really changed, so it cannot
reproduce the browser's rule directly. The check asserts the condition the rule turns on — the input
must not still be holding the last pick — and a second check drives the whole round trip through a
real file chooser.

### The evidence ladder

The prompt had weighting rules scattered through it as prose — photographs are weakest, absence is
weak, watch history is not taste, a like is not an interest. All true, none of it ordered, so a model
facing two signals that disagreed had no rule for which wins.

They are one ranked list now, strongest first: **sustained repeated action across time** → **their
own composed words** → **what they searched for when nobody was watching** → **behavioural rhythm**
(complete rather than sampled, and routinely overlooked) → **repeated engagement with someone else's
work** → **a single endorsement** → **passive membership and inferred labels**. The rule that makes
it a ladder rather than a list: when two signals disagree, the higher tier wins *and the report says
so* — "they follow a dozen running accounts but have not mentioned a run since 2021" is a better
sentence than either half alone.

Two rules govern the whole thing. **"N=1 is not a pattern, and the count belongs in the sentence"** is
new, and applies to every `evidence` string and every `why`: say "forty-odd captions across four
years" rather than "several", because a reader can weigh a claim with a number attached and cannot
weigh one without. **Absence is the weakest evidence there is** was already in the prompt and moved
here, where its relationship to the rest is visible.

Both are pinned rung by rung in `tools/selftest.mjs` rather than by one loose match, since the point
of a ranked list is the ranking and a check that only proved "the words appear somewhere" would pass
on a shuffled one.

Adapted from [Tomasz-T/social-profile-analyzer](https://github.com/Tomasz-T/social-profile-analyzer),
a Claude Code Skill that reads the same kind of exports locally. Its trajectory vocabulary and its
anti-overstatement rules are the two ideas worth stealing; its verification-by-Python-query approach
does not port to a browser app that ships one capped digest to a metered API, and was not attempted.

### The photographs, and why they are gone

Fourteen of the reader's own stills used to ride alongside the digest — decoded and downscaled in
the browser, each labelled with the date it was posted, chosen by an effort-weighted scorer in
`docs/images.js` that preferred long captions and assembled carousels. The reasoning was a real
blind spot: a wordless photo of a summit and a wordless photo of a nightclub are the same row in a
text digest.

**They were removed, and the trade is worth writing down because it was a real one.**

The argument for removing them:

- **They were never in more than one report per reader.** The paid call has always refused them, and
  a re-run drops them whenever the Instagram archive is no longer in memory — which is every re-run
  after a reload, since the archive is deliberately never written to disk. So the report most people
  ended up holding had no photographs in it either way, and the first one differed from every later
  one in a way nobody could see.
- **The prompt itself ranked them last.** "The weakest evidence per item and the easiest to
  over-read — twelve pictures out of thousands, chosen by a crude filter, and Instagram is where
  people post their best day of the month."
- **They carried the strictest safety rules in the file**, because other people appear in them
  without having agreed to any of it.
- **They were the slowest step in the app** by a wide margin, and the largest part of the request.

What was lost, stated plainly rather than waved away: the setting, whether somebody is usually alone
or in company, and how much care goes into what they publish. Some of that is recoverable from
captions and rhythm and some of it is not. **There is no A/B evaluation behind this** — the mock
engine returns canned data, so no test in this repo can measure report quality, and nobody should
claim the change is quality-neutral on the strength of the reasoning above alone.

What it bought is measurable. `IMAGE_TOKENS * 14` = 3,612 tokens of reserve became **12,642 more
characters** of captions, searches and messages — evidence the ladder ranks higher and which *every*
run gets, not just the first. Against that, the same commit spent about 800 tokens on the longer
prompt (the evidence ladder and the temporal rules), so the digest ceiling still rose by roughly
9,800 characters on net. `coverage.images` is gone with them; what survives is
`coverage.stillsInArchive`, a count of how many stills the archive held, which is real evidence
about how visual a life this is and costs nothing because it is read off the JSON rather than the
files.

The privacy copy moved with the behaviour, which is the part that could not be left: the FAQ used to
promise "every photo except the few you agree to send" stays on the device, and now says none are
sent at all. A page describing what leaves a reader's machine cannot lag the code that decides it.

**Direct messages are included by default**, because how someone writes to people who already know
them is the most revealing text in the export. Only the user's own messages are sampled. The other
side of every conversation is counted for the statistics and then discarded before anything leaves
the browser — except that each of the reader's replies keeps the one message it answered, shortened to
160 characters and de-identified where it is read (`ownSide` in `docs/instagram.js`: the reader's own
name in any form becomes `PsycheUser`, every participant's name `someone`, links, emails and numbers
are removed, and @handles become [P1]…), and about a third of the sampled lines show it. The Direct
messages row in the pre-send review turns the whole thing off.

**How messages are sampled** (`sampleConversations` in `docs/digest.js`, one sampler for Instagram,
Messenger and WhatsApp):

1. **Per conversation, a guaranteed minimum each, and a ceiling.** Instagram and Messenger: the ten
   conversations the reader writes in most, each at least 4% of the places, the rest by volume, none over
   a fifth (a soft cap: it yields when the others run dry). WhatsApp: every chat (up to three) at least a
   quarter and at most two fifths — a hard cap (`waMaxShare`), so places a chat cannot use stay empty
   rather than going to the busiest one. And every conversation is held to a ceiling in characters,
   however much room is left, so no one relationship outweighs the rest:
   - an Instagram conversation: 10,000 (`igThreadChars`);
   - a Messenger conversation: 6,000 (`messageThreadChars`; 16,000 in the premium read);
   - a WhatsApp chat: 8,000 (`waThreadChars`; 16,000 in the premium read), a tenth of each read's budget.

   One WhatsApp chat on its own is bounded by that ceiling rather than by the share. Whatever room is
   left, two shares of the evidence actually sent also hold:
   - no one chat more than a tenth (`waChatMaxDigestShare`);
   - WhatsApp as a whole, three chats at most, no more than three tenths (`waMaxDigestShare`).

   Its chats are the densest, most personal text there is. At about half the digest, as it was with
   three chats added at the unlock, they set the tone of the whole report. Room WhatsApp does not use
   goes to the other added sources, or the digest is simply smaller.

   **One chat in the free read is the exception.** A new reader can add one chat, with a close friend,
   on the first upload. That chat gets a fixed allowance instead of the shares: up to 8,000 characters in
   all, lines and counts together (`waSoloChatChars`). Under the shares, a tenth of a lighter account's
   digest (11,000 characters with the test export) cut a long chat to three lines (1,230 characters); it
   now keeps about 7,800. The whole free digest is still held to 80,000 characters, so the cost ceiling is
   unchanged. The full report sets the allowance to 0 (`DEEP_LIMITS`) and keeps the shares. Two or three
   chats in a free re-run from the report page keep them too.
2. **Spread across time.** Each conversation's span is cut into ten equal stretches, places shared by
   the square root of what was written in each — a two-year chat is read across two years.
3. **A mix of lengths.** In every stretch about half the places go to substantial messages (120+
   characters) and two fifths to ordinary ones. The floor is 30 characters, counted after a burst is
   joined; under it only a short message that reveals something — an apology, a feeling, a question, a
   conversation opener ("sorry!!", "miss u", "wdym?") — may take a place, a tenth of them at most, and
   never a bare "ok", "haha" or "lol" (`MESSAGE_FILLER`).
4. **The revealing ones first** within each length: openers (first message after six hours' quiet),
   apologies, feelings and conflict, questions, and replies to a question.
5. **Bursts as one.** Lines sent within two minutes, with nobody answering between, are joined with " / ".
6. **No near-duplicates, nothing pasted.** "ok", "Ok!" and "okkk" count once per conversation. A message
   over 800 characters, one over 280 that carries a link, or one marked forwarded is left out as
   pasted or forwarded text; length counts for at most 280 characters when ranking. A message longer
   than shown keeps its opening 330 characters and its last 150, " … " between, so a long apology keeps
   its "anyway, I'm sorry".
7. **What it answered**, as «them: …» at the start of about 35% of the lines — the ones where it
   matters most (apologies, feelings, answers to a question). The prompt tells the model to read the
   reply against it and never to attribute, quote or describe the other person from it.

**The data rows say what the full report read.** After a full report written from the premium read
(data added at the unlock), the sample counts it read are kept with the profile
(`state.profile.readFrom`) and the *Your data* rows show them (`readView` in `docs/app.js`): a
WhatsApp chat added at the unlock reads "584 of your 37.8k messages read", not the "10 of" the standard
digest beside it holds once Instagram has filled its 80,000. An unlock with nothing added clears them.

Lines are tagged `[t1]`… (Instagram), `[m1]`… (Messenger) and `[c1]`–`[c3]` (WhatsApp, matching the
chat metrics), and `coverage.sampling` records how many lines carry context. When a digest is over its
line the trim now thins each list evenly rather than cutting its end, which used to lose the newest
year or the last conversations first.

The archive is unzipped in the browser with the File API. The server proxies two model calls and
stores nothing — your profile and reports live in this browser's local storage until you press
delete. Whichever provider you configure receives the digest, so pick the one whose data-handling
terms you are happy with.

## How the analysis works

`lib/prompts.js` holds both prompts and both output schemas. The model is asked to weigh the
evidence honestly:

- **Their own words** — captions, comments, bio — are the strongest signal.
- **Instagram's inferred topics** are real signal about attention, but noisy.
- **Accounts followed** mix interest, aspiration and social circle.
- **Behavioural rhythm** — when and how regularly they post, how much they engage outward — is
  genuine trait evidence and usually overlooked.
- **Their photographs** show what captions leave out — setting, activity, alone or in company —
  but are the weakest evidence per item and the easiest to over-read.
- **Absence is weak evidence.** Most people are near the middle on most traits.

Both calls use **structured outputs**, so the response is guaranteed to match the schema and the UI
renders it without defensive parsing. Both stream, because thinking tokens and a long report share
one output budget.

### The front page's video plays only once the page has settled

Measured on a simulated 4G connection (9 Mbps, 60ms) with the cache cleared, the front page shows content
in about 0.4s and finishes loading in about 1.2s, at about 600KB. The upload readers and the PDF maker were
already loaded on demand (`<template>` blocks, `loadReaders`, `loadPdf`). The video (54s, 720×1280,
about 0.58 Mbit/s, 4MB) streams as it plays. It now plays on its own only once the page has loaded and
1.5s have passed, only when half of it is on screen (the threshold was 40%), and never for a reader with
Data Saver on or on a 2G connection (`navigator.connection`). The poster and the play button stay for them.
A slow first visit is more likely the host than the page: Render's free instances sleep after about 15
idle minutes and take 30–60s to wake, and a region far from the readers adds a round trip per request.

### The card intro names all five features; the hub's tiles carry their icons

Since late October 2026 the intro reads *"[Psyche Card] – your personality on one card, read from your
own data. Go deeper in your [Psyche Report], compare with friends in [Psyche Sync], get advice from
[Ask PsycheAI], and track your progress in [Psyche Hub]."* Before an unlock, the second sentence starts
*"Unlock the reasoning in your [Psyche Report]"*. `introClauses` cuts the paragraph into clauses that
each end with their button. The button's comma or full stop is kept with it, so neither starts a line. It
is one plain paragraph on a laptop and a phone alike; right-aligning each clause on a phone was tried and
undone. The Card button opens the card full size and Ask opens the panel. The hub's tiles carry
the same icons before their names, and the hub's grid sits left of its title in the title's gradient
(`#hub-title-grad`). On a laptop Read, See list and History are their word alone. On a phone the
button column is 40% of a tile (it was half). The "?" has a line height of 1, so it is no taller than the
other buttons.

### The card intro's next steps, as buttons in the sentence

The Psyche Card's intro is one line, then where to go next: *"Your personality on one card, read from
your own data. Go deeper in your [Psyche Report], compare with friends in [Psyche Sync], and track your
progress in [Psyche Hub]."* Before an unlock it reads *"Unlock your [Psyche Report] for the reasoning
behind it, …"* and the report button carries the lock icon. Each name is a small rounded button
(`.cx-go`) with the hub's own icon. Report opens My Report once unlocked, and the unlock offer before.
Sync goes to the Sync page. Hub scrolls down to the hub. Plain links were tried and rejected: three
underlines read as clutter, and the names broke across lines in the narrow column beside the card.
Rows with a line each read clearly but cost about 180px. In the hub, Ask beside History is a "?" a
quarter of the row wide on both widths, and the last row is *Save Your Profile*.

### Ask PsycheAI's box and minimising; a larger laptop hub

The question box empties as a question is sent. The question shows in the thread while the answer is
written, and goes back into the box only if sending fails. Minimising keeps the page where the reader
has scrolled to. `popOwnEntry(y)` turns the browser's scroll restoration off for the step back, which had
been putting back the position the panel was opened at, and on again 400ms after it. `minimiseAsk` also
scrolls back after closing, since closing hands focus to whatever opened the panel. That still bounced:
scroll restoration is kept per history entry and applied by the entry being returned to, so the page's
own entry (still on auto) put back the position the panel was opened at for about 400ms. `openAsk` now
turns restoration off on the page's entry before pushing the panel's. Minimising, by the button or by
Back, leaves the page exactly where it is, and restoration comes on again once it has landed.

The laptop hub is 1.1× (`zoom` on `.hub-card` from 760px): type, buttons, icons and spacing together, in
the same width. The phone's is unchanged. On both, Download and Share are their icon alone at a quarter
of the row (their names stay as `aria-label`), and Read and See list take the rest.

### The server decides who gets the free card; a bundle's link is registered

Every first upload asks for the free card, whatever the browser made before. Until late October 2026,
the browser's own run count (`psycheai_runs`, which survives Delete everything) sent any later upload
straight to the paid sheet. That charged a second Instagram account on the same laptop, which the
server would have given a free card. Now the server's once-per-account check decides. If it refuses
(`freeUsed`), the card and report bundle is offered over the same reviewed digest, with nothing loaded
again. The refusal comes before any model call, so it costs nothing. The browser count still prices
the re-run button, where the account has certainly had its card. An identical re-upload within the
results cache's hours gets the same card back, which gives nothing away.

A card bought with its report (an anchorless unlock: a new device, or after Delete everything) now runs
`referral.afterFreeCard` as a free card does. That records the new link's owner, so friends' cards from
it are credited, and spends the account's guess. Before, the owner was recorded only for free cards, so a
bundle buyer's link never earned credits.

### One 179,000 line for every read

Since late October 2026 every read is held to the same pools, whether free or paid, Instagram alone or
with other sources. These are the premium read's: public 70,000 (Instagram's share 50,000, Facebook at
least 10,000 beside it), conversations 95,000 (15,000 a conversation, 450 WhatsApp messages) and Google
8,000, plus 6,000 fixed. The Instagram-only tier (100,000) and the free read with a second source
(136,000) are gone. Why: with Facebook offered at the first upload, the premium read's only edge was
room, and one line means the report explains its card from exactly the evidence the card was drawn
from. `premiumDigestFrom` returns the card's own digest when nothing is added at the unlock, so no
deeper rebuild happens. Worst cases: free card 8.5¢ (`FREE_COST_CAP`, was 6.8¢ Instagram alone and
7.6¢ with a source), full report 17.2¢ (`COST_CAP`). The daily free ceiling of 200 is at most about
US$17. `SOLO_*` names remain as aliases of the one line.

### Add your data: four sources, two lines each; Back on the payment sheet

The first upload's *Add your data* popout offers Facebook too (Instagram required; WhatsApp, Google and
Facebook optional). Each row is two lines at most: the tag sits beside the name ("Google Takeout
(Optional)"), where a generic `.mode-title` flex rule had pushed it onto a line of its own, and the
WhatsApp line is "Up to 3 close-friend chats (.zip or .txt)", which fits a phone.

The payment sheet's Cancel is **Back**: it returns to the step before the sheet (`premiumBackStep`).
For an unlock, that is the review again over the sources already loaded (`collectDataForPremium`
re-entered with the same answer, `lastPremiumCollected`). For a re-run it is `rerunWithAdditionalData`
again, and for a first upload past the free card it is the same digest's review (`PAY_BACK` from
`authoriseAnalysis`). From the review, Back goes on to the data popout as before. Ask PsycheAI and
Sync purchases have nothing before the sheet, so Back closes it.

### Who a caption was written for: private or public

Instagram's `personal_information.json` carries `"Private Account": {"value": "True"}`.
`docs/instagram.js` reads it into `profile.privateAccount` (left unset when absent), and the digest
sends it as `profile.account`, `'private'` or `'public'`, beside `counts.followers`. `forModel` passes only
those two values, and unticking "Activity & timing" at the review takes it out with the counts. The
review's line says so: *"…whether your account is private…"*. `ACCOUNT_AUDIENCE_RULE` in
`lib/prompts.js`, in both the card's prompt and the report's, sets the weight:
- **A private account under 1,000 followers** writes for a circle the reader let in, so its captions
  read close to their messages in candour.
- **A public account, or a private one with 1,000 followers or more,** writes for an audience, so its
  captions are curated, partly performative self-presentation, and messages, searches and rhythm carry
  more of what lies under it.
- **No flag:** the model assumes nothing.

Posts and stories are not told apart: a `[post]`/`[story]` tag was tried and removed before (see the
caption-tag note), and the audience matters more than the format. The rule cost about 120 prompt
tokens, so `FREE_FIXED_INPUT_TOKENS` went to 11,300 and `FREE_COST_CAP` to $0.076.

### Who a caption is about

Reported from real output: *"Finance professional turned vibe coding guru @mokkzy casually lecturing a
group of software engineers on his next SaaS startup"* came back as evidence that the **reader** was a
founder. *"Toyota 1987 MR2 Supercharger, prob the only one in sg today, owned by prolific vintage car
collector @yuhanchong"* made them a car collector. In both the caption states outright whose job and
whose car it is, and in both the reader is the person who was in the room and wrote it down.

The prompt had invited this. It said their own words are the strongest signal and never distinguished
**authoring** a sentence from **being its subject** — and Instagram is largely a place where people
photograph other people. This is the worst class of error the report can make, because it does not
read as a hedge or a stretch: it is a confident statement of fact about a life the reader does not
have, and it propagates from the evidence string into interests, into the essence pick, into the card,
and from there through a QR code into a compatibility report about somebody who never asked.

The fix gives the model a mechanical test it can actually apply — the reader's handle is in
`profile.username`, so **any other `@handle` is somebody else** — and both reported captions are
written into the prompt as worked examples, since a rule stated abstractly is easier to nod along to
than to apply.

The half that matters more is the half that stops it overcorrecting. A caption about somebody else is
not noise to be dropped; it is **rich evidence about its author**, just about different things: who
they are around and what rooms they are in, what detail they bother to get right, how they write about
other people, and whether the account is one where they document rather than star — which is itself a
finding, and usually invisible to the person. The same rule governs comments more strictly still,
since a comment sits on somebody else's post: "Congratulations on the new place!" says they show up
warmly, not that they moved house. Where authorship is genuinely ambiguous the instruction is to say
what the caption shows them *doing* — being there, noticing, writing it up — because that is true
either way.

The fixture had no third-party captions at all, so none of this was testable and the report could
attribute a stranger's biography to the reader with every check still green. It now carries both
reported captions verbatim, and a check asserts they survive sampling into the digest — the rule
guards nothing if the captions that trigger it never reach the model. The live test asserts across the
*whole* report that no SaaS startup, no vintage car and neither handle appears anywhere, since
checking one section would miss the propagation that makes this damaging.

### The extraversion trap

Introverted readers kept coming back rated as extraverts, and the cause is structural rather than a
model quirk: **every social number in the digest is a volume count of mediated, asynchronous,
text-based contact.** Messages sent, comments written, posts published, accounts followed — all of it
composed alone, on a phone, at a moment of the person's choosing, with as long as they liked to word
it. That is not merely compatible with introversion; it is the mode of contact introverts
specifically prefer, because it strips out everything they find costly about the live version. Heavy
DM traffic and constant meme-swapping with four close friends was being read as sociability.

The correction is a block of the prompt that says so outright, and then replaces the raw totals with
**breadth** measures: messages ÷ active threads (depth versus reach), group *participation* against
it, `counts.distinctPeopleCommentedOn` rather than `commentsWritten`, `closeFriends` rather than
`followers`, and likes-and-saves against posts as a lurking ratio. Alongside that it weights
introvert-leaning evidence *up*, because it is the quieter half of the data and easy to skip: long
average message length, solitary imagery, a rhythm that clusters when nobody else is awake, a small
set of repeatedly-engaged accounts. Then it raises the bar with a number on it — do not score above
roughly 60, and do not assign **E**, without breadth evidence; a high volume of talk with a small
circle scores below 50.

**Absence is not the low end of a scale**, and getting that wrong was the third round of this. Once
group *participation* counted as evidence for **E**, an empty count started reading as evidence for
**I** — but almost nobody group-chats on Instagram or Facebook whatever their temperament. That part
of a life is on WhatsApp, iMessage, Discord or in a room, none of which appears in this export, so
zero active group threads is the **modal** result rather than an introverted one. The same trap sits
under `closeFriends`: it is an opt-in list most accounts never configure, so a zero means the feature
went unused, not that nobody is close to them. Both now read one-directionally — a busy group life or
a long close-friends list counts for something, an empty one counts for nothing — and the general rule
sits above them, because this recurs with every opt-in or platform-specific field the export has:
**a missing behaviour is only evidence if you would have expected to see it.** Saved collections,
stories, a filled-in bio, all the same. Say nothing rather than reading a blank as a finding.

**The first version of this correction had the same bug it was fixing**, one layer down, and it is
worth writing out because it is the more interesting half. It sent the model to `threads` and
`groupThreads` — and those count every conversation *in the archive*, not every conversation the
person took part in. An Instagram export is full of message requests, one-off DMs from strangers who
got no reply, and group chats somebody was added to and never opened. Measured on a synthetic pair,
the identical person — same 2,510 messages sent — read as 1,250 messages per thread with a clean
inbox and 28.8 with 180 unanswered DMs and 12 silent groups behind it. The second one trips
"spread thin across many threads is breadth", which is the original complaint arriving by a different
road. It passed the suite only because the fixture had three threads and the reader had answered all
three.

So the digest now carries `activeThreads` and `activeGroupThreads` — conversations they actually
spoke in — computed in `summariseMessages` because it needs the account owner, and the owner is only
known once every thread has been read. They are **null, not zero**, when the export does not identify
its owner, since zero is a claim and null is the absence of one. The per-thread sender tallies that
produce them are transient in the same way `threadPartners` and `messageSenders` already are: held
during the parse, dropped immediately after, and no name from them reaches the digest — asserted by
its own check, because silent threads were a new way for a stranger's name to escape.

The fixture gained nine unanswered DMs and one silent group chat, which is what makes any of this
testable: it now reports 13 threads against 3 active, and 1 group against 0 spoken in. A check holds
the *gap* rather than the numbers, so a fixture that stopped exercising the case fails instead of
going quietly vacuous — verified by deleting the silent threads and watching six checks fall over.

One case runs the other way from intuition. When a reader unticks direct messages, every breadth
ratio above disappears with them, and what is left is almost entirely publishing volume — the single
most misleading evidence for this trait. So a missing message block is *more* reason to hedge, not
less, and the prompt says so.

Each part of this is pinned by its own check rather than one loose match over the block, so three
quarters of it cannot be deleted without a failure. The live test — the only place a prompt
instruction can be shown to actually land, rather than merely to be present — now sends the fixture
*with* its messages, which it previously did not, and asserts that an account with 3 threads, no
group threads and 240 likes against 12 posts does not come back as an extravert.

**Two fields, one trait, and nothing was making them agree.** `bigFive.extraversion` and the MBTI E/I
letter describe the same thing, and the summary card puts them a few centimetres apart — so a score
of 62 above the word **I** reads as the report arguing with itself, which is exactly what was coming
back. The prompt already set the same raised bar for both, but a shared bar is not a shared answer:
each field was free to land wherever its own reasoning took it.

It is now arithmetic rather than a plea for consistency. `bigFive` is written before `mbti`, so the
number exists by the time the axis is chosen: **55 or above takes E, 45 or below takes I**, and the
band between them allows either letter at `slight` strength only. `strength` tracks distance from 50
on the same scale, and the axis's `why` may not argue against the trait's `reading` — if one says
"sociable" while the other says "keeps to a few people", one of them is wrong and the evidence decides
which, rather than either being nudged to match the other. The rule is repeated at the field
descriptions themselves, because that is where the letter actually gets picked.

**And the empty group chat is now banned outright rather than explained.** The prompt had said twice
that an absent group life means nothing — once in the group-threads bullet, once in the general
missing-behaviour rule — and reports kept citing it anyway. An explanation is not a prohibition. The
phrasings are named and barred from every `evidence` string and every axis `why`: Instagram and
Facebook messaging is overwhelmingly one-to-one, group life happens on WhatsApp, iMessage, Discord or
in a room, and zero group threads is what the *average extravert's* export looks like. It separates
nobody from anybody, so it is silence, and silence does not go in an evidence list.

The live test carries the alignment rule too — the letter against the score, the middle band hedged,
and the axis reasoning checked for the same blank the trait evidence is checked for. That is the only
place either rule can be shown to land rather than merely to be present.

### N/S and T/F get the same treatment, and every axis now argues both sides

Readers reported those two letters as the ones their report got subtly wrong, and the cause was
structural: E/I had a whole section explaining what its evidence looks like and which way its error
runs, and the other three axes had one line telling the model to cite evidence. A letter with no
account of what counts as evidence for it gets picked off whatever the model noticed first.

**Each axis now opens with what it actually measures.** Intuition as an appetite for meaning, purpose,
abstraction, analogy and pattern; Sensing as an appetite for facts, the senses, steps, specs and
verifiable data. Thinking as deciding by logic and impartial fairness, stating a criticism plainly,
tolerating being disliked for a position; Feeling as deciding by the effect on people, weighting the
relationship as a real cost, keeping harmony, withholding a criticism rather than damaging a bond.
Both definitions carry an explicit "neither pole is the better one" — N is not the deep one and F is
not the warm one — because a letter that reads as a compliment stops being a measurement.

**Then each gets its own version of the extraversion trap, because both have one.** Instagram is a
camera, so concrete sensory specificity is the *genre*: naming the place, the date, the model and the
price is what a caption is for, and counting it as Sensing types the platform rather than the person.
The instruction is to read what they do once the concrete detail is down — whether the caption goes on
to say what the thing meant or resembled — and to cite the ratio between "how to" and "why does"
across searches and prompts rather than one example of either.

The T/F version is sharper, and it falls straight out of the definition. The F pole is defined partly
by withholding criticism to protect a relationship — and withholding criticism in public is the
platform norm for *everybody*, so an export of comments and captions looks Feeling for the entire
population. **The error on this axis runs towards F**, exactly as E/I runs towards E and for the same
structural reason. That gives the axis its single best probe: criticism that survives the medium
anyway. A plainly-stated disagreement, ranking or unflattering verdict in a room built for being liked
is worth several times its weight as Thinking evidence. Its absence, as ever, is worth nothing.

**And every axis is now a real analysis that tempers itself**, written at the depth a Big Five trait
gets rather than as a caption: four to six sentences in one paragraph. `why` has a floor — at least
three separate pieces of evidence from different parts of the digest, not three readings of the same
caption, each with a count on it — and a ceiling on one-sidedness: where behaviour runs the other way
it has to be named in the same paragraph, with its own count and a statement of what it does and does
not overturn. `strength` is read off how close that tempering comes: close is `slight`, one clearly
stronger showing is `moderate`, `clear` only where the contrary behaviour stayed thin after an honest
search. A report that returns `clear` on all four axes has told on itself. Even-handedness is not the
goal, though — an axis that genuinely runs one way says so rather than manufacturing a doubt to look
balanced, because a model told to always temper will invent the temper.

**That tempering was briefly its own field, and briefly its own block on the page.** `counterEvidence`
rendered under each argument as a labelled "The case against:", set off by a rule down its left edge.
It came out. Two blocks made every axis read as a debate transcript rather than as a finding, and —
worse — gave the contrary evidence fixed visual weight equal to the case that won, whatever its actual
weight. A clause that says "six accounts absorb most of the engagement, and every cluster is followed
by a fortnight of silence — what tips it to E is that the organising is outward-facing" carries its own
proportion; the same words in a bordered box below the argument read as a rebuttal of it. The field is
gone from the schema, the label from `copy.js`, the rule from the stylesheet; `docs/app.js` and
`docs/pdf.js` still render a legacy `counterEvidence` if a report saved during that window has one,
appended as ordinary body text rather than dropping a paragraph of real analysis on the floor.

Rewriting `docs/sample.json` to the tempered shape moved one of its own letters: T/F was `clear`, and
once the contrary behaviour was actually written out — deadlines tracked on delivery, other people's
work assessed about as often as celebrated — it was plainly `moderate`. That is the mechanism doing
the job it was added for, on the exact axis readers complained about. The sample's four axes now run
95 to 137 words each, against the 15-word captions they replaced.

This cost 2,500 tokens of fixed prompt, taking the reserve from 17,800 to 20,300 and roughly 8,750
characters off the digest ceiling. That is the most expensive kind of prompt text there is: it buys
nothing on a thin account and every account pays for it. It is worth it because those two letters were
wrong often enough for readers to say so, and a sampled caption or two is a cheaper thing to lose than
half the type. Folding the counter back into `why` did not give any of it back — 20,085 tokens before,
20,126 after: a longer `why` description costs about what dropping a whole field saves.

### What the model is told not to do

Identify or speculate about specific other people in your data, or infer sexual orientation, health
conditions, immigration status or political affiliation unless you have stated it outright in your
own words. It does not classify anyone by appearance or by the demographics of who they follow, and
the photographs carry the further limits described above. These guardrails are asserted by the test
suite so they survive edits to the prompt.

## What the report contains

### The structured report: five parts, one thread

The default layout since this change. The classic report was a run of sections that never referred
to each other; the structured one is laid out the way professional assessments are, with one thread
through it. The structure is borrowed and the wording is not: every definition, label and framework
here is either this app's own or a published academic model.

| | Sections |
|---|---|
| **Overview** | Executive summary (the character and why, the four facts, the summary; no *In one line* banner, which only repeated the card's headline from the cover) · **Your signature patterns** |
| **Part 1 – Who you are** | MBTI (first, as the type readers look for) · Big Five, drawn as spectrums with both poles described and the typical band shaded (labelled an estimate). Since 18 Oct 2026 the model writes them in this order too, MBTI first, and the extraversion score follows the E/I letter (see Scores first, below) · Wellbeing, as the last section of the part |
| **Part 2 – What drives you** | **What motivates you** (Schwartz's ten basic values, ranked against each other, grouped by his four higher-order values) · Interests · Values & beliefs |
| **Part 3 – How you connect** | In relationships (love languages, attachment style and ideal partner in one section) |
| **Part 4 – How you work** | The description and the coach's read as one section under the part's own title, opening on the edge: its two intro paragraphs, `career.workStyle` and `careerAssessment.situation`, said again what the edge and the careers list say, so the structured schema no longer asks for them |
| **Part 5 – Putting it together** | **Development plan** (build on / develop, each naming the pattern it resolves and the sections that raised it; each develop area carries the strength it tips over from, two early signs, a counter-move and a reflection question) · **Your plan** (about five actions, one column per horizon in the PDF) |
| **After Part 5** | Evidence and method, on its own: the confidence score and why, what was counted in full, and the data sources |
| **Last** | The roast, after the method rather than mid-report, with no heading of its own |

**How you connect and How you work, apart.** They were one part, *How you connect & work*. Career is
one of the main reasons people pay, and the menu hid it behind the second half of a part named for
both; it was also the longest part. Now Part 3 is *How you connect* and Part 4 *How you work* (key
`career`), on the page, in the menu, in the PDF (each opens a page; the contents run 00 to 06, the
appendix last), on the front page's premium tier and in the unlock offer (`offerConnect` and
`offerCareer`, two rows each). The work part has no second "How you work" heading inside it: the part
title is the heading, and the edge opens it. On the front page five parts run two by two, the plan
across the last row. Putting it together carries no section pill there: "Development plan" only
repeated its own line.

**A pass over the paid prompt for contradictions.** Read end to end against the structured schema and
the page, the prompt asked for things the paid call never writes or the page never shows:
- **The digital footprint** (`activity`, `activity.diet`): written in full on every report and shown
  nowhere in the structured layout. Dropped from the schema (`STRUCTURED_DROPS`) and its instructions
  cut, which saves output and time.
- **The shareable card**: the paid call's schema has no card (it is pinned from the free one), but the
  prompt still told it how to fill each field. Cut (`STRUCTURED_CUTS`).
- **Attachment "as its own section, written to stand alone"**: it sits inside How you connect, beside
  the relationship read, and the prompt said so elsewhere. Now it builds on that read.
- **"Pick the character", "decide the patterns"**: in the paid call these come from the card. The
  card block now says that wherever the prompt says to pick one of them, the card is that decision.
- **AI prompts**: the prompt explained how to read them, but the digest never sends them. Removed.
- **MBTI**: three counted pieces of evidence plus a counted tempering do not fit three or four
  sentences; now two, none used for another letter.
- **Which section owns common evidence**: breadth of contact is extraversion's (social connection
  points back), the hour-of-day shape is rhythm's (cognitive load points back), regularity is J/P's,
  who starts conversations is attachment's, searches are the interests'. That is what put "378
  conversations" in three places.
- WhatsApp is named among the optional sources in both prompts, and the work strengths' length
  agrees between the list and its items.

The structured prompt is now the classic one with a listed set of splices and cuts
(`STRUCTURED_SPLICES`, `STRUCTURED_CUTS`), each throwing if its text goes missing, and a check
rebuilds it from them.

**Each piece of evidence once in a section, twice at most in the report.** A real 20-page report cited
"378 Instagram conversations" under the E letter, under extraversion and under social connection, and
the same late-night hours under two wellbeing dimensions side by side. The old rule ("spell it out once,
then point back") was advice; the prompt now sets two limits. Inside one section (the four MBTI letters
are one, the five traits another, the wellbeing dimensions another) a fact is used once, evidence lists
included. Across the report it appears at most twice: in full where it matters most, then at most one
short back-reference. Twice rather than three times because the second mention is what ties two findings
to one behaviour; a third only adds length. Signature patterns count as the first use. The MBTI prompt
also now agrees with its own field (three or four sentences a letter, E/I two or three, pointing back at
the extraversion evidence rather than citing it again; the body text had said four to six), and the
character paragraph in the overview is one or two sentences, since the card on the cover already says
who they are like.

**No Enneagram anywhere, and the patterns are on the free card.** The Enneagram is gone from the app
— both layouts, both calls, the card, the link, the page and the PDF; the summary card's column names
the two or three signature patterns instead. They are decided by the free card call (`STRUCTURED_FREE_SCHEMA`), so they are
the hook a reader sees before paying, and the paid report is anchored to them (`anchorFrom` carries
their ids, names and lines) so it explains the same patterns under the same names. A link made before
the Enneagram went still opens; its Enneagram is simply left behind.

**What is printed on the card is neutral or positive, and never about romance.** The card is shared
with friends, so the headline, the two sentences on the character (`cardHighlights`) and the
signature pattern names are phrased neutrally or positively: they name the behaviour, never a
fault ("The quiet organiser", "Warm in small circles", not "guarded", "avoidant" or "stubborn").
The honest cost of each pattern still exists, in its `line`, which only the paid report shows, and
in the paid report's development and pressure sections. No pattern is about romance or dating, in
its name, line or evidence: how someone is with a partner belongs only in the paid report's
relationship sections (`attachment`, `idealPartner`, under *How you connect*). The rules
are in both calls' prompts and schema descriptions in `lib/prompts.js` (`STRUCTURED_FREE_SYSTEM`,
`FREE_PATTERNS`, `STRUCTURED_CARD_HIGHLIGHTS`, `CARD_SCHEMA.headline`, and the paid `patterns`).
Cards already made keep what they were written with until they are re-run.

**Characters come from a catalogue, each with an original emblem.** In the structured layout the
model chooses the character from `CHARACTER_CATALOGUE` (29 characters across temperaments, in
`lib/prompts.js`) rather than naming anyone it likes, so every character has artwork. The artwork
is an original line emblem drawn for this app (`CHARACTER_EMBLEMS` and `EMBLEM_PATHS` in
`docs/copy.js`): a generic object the character is associated with, never the studio's character
art or logo. A report from before the catalogue keeps its emoji. The summary card is one
1080 × 1920 story, the same on screen and in the export; a report whose content runs long is scaled
down just enough to fit, rather than clipped.

**The card has My Syncs' light wash, edge to edge.** It used to fade from white at the top to a
near-white pink, and the exported image filled its rounded corners with white. Instagram picks a
story's background from the image's edges, so it picked white. Now:
- **The wash.** `.psyche-card.pc-story` has pink from the top right and purple from the bottom left
  over a lightly tinted base, mixed with `color-mix()` from the theme's own colours. It is a light wash
  in the image, which is always drawn in the light theme, and a matching dark one on screen in dark mode.
- **Square corners.** `cardImageBlob` exports the story card square-cornered, so the tint reaches every
  edge and corner.
- **The test.** `tools/uitest.mjs` downloads the image and checks eight points along its edges, corners
  included: none may be white, and each must carry colour.
- **Everywhere else.** The front page's sample cards use the same design, and the link preview
  (`og-card.jpg`) was redrawn from it.

**The catalogue is balanced: twelve women, twelve men, five who are neither.** It started with seven
women out of 28. Each character holds a temperament nobody else in the list does:

| Added | Temperament it brings | | Retired | Overlapped with |
|---|---|---|---|---|
| Hermione Granger | the diligent, principled over-preparer who has read ahead | | Doctor Strange | Iron Man (brilliant, proud expert) |
| Kuromi | the mischievous contrarian, tough outside and sentimental inside | | Black Panther | Captain America (principled, duty-bound leader) |
| Sailor Moon | the big-hearted, emotional, imperfect friend who rises when it counts | | Mario | Po (cheerful, uncomplicated persistent doer) |
| Princess Peach | the gracious, composed leader and host who keeps everyone steady | | Link | Moana and Hiccup (quiet, brave explorer) |
| Hello Kitty | the warm, gentle connector who shows care through small kindnesses | | | |

**Each woman has a male counterpart of similar temperament**, which keeps the two sides of the
catalogue covering the same ground:

| Shared temperament | Woman | Man |
|---|---|---|
| The principled protector | Wonder Woman | Captain America |
| The earnest, by-the-book go-getter | Judy Hopps | Buzz Lightyear |
| A big force held under tight control | Elsa | Hulk |
| The over-prepared planner | Hermione Granger | Batman |
| The mischievous contrarian with a softer centre | Kuromi | Nick Wilde |
| The explorer who leaves the family's map | Moana | Hiccup |
| The relentless enthusiast | Joy | Po |
| The ordinary, big-hearted hero juggling too much | Sailor Moon | Spider-Man |
| The steady leader who holds the group together | Princess Peach | Woody |
| The one who steps up for family | Mulan | Simba |
| The restless creator | Rapunzel | Iron Man |
| The homebody with a big heart for a small circle | Hello Kitty | Shrek |

The five who are neither each hold a temperament of their own: Baymax the gentle caretaker, WALL-E
the quiet romantic and collector, Remy the craftsman with taste, Pikachu the loyal live wire, Totoro
the calm, steady presence.

My Melody, Bubbles and Barbie were considered and left out: My Melody and Bubbles overlap Hello
Kitty and Joy, and Barbie overlaps Judy Hopps and invites a read on looks the prompt rules out.
**A woman chooses among the twelve women and the five who are neither, a man among the twelve men
and the five, and anyone the model cannot place among the five alone.** Each entry in
`CHARACTER_CATALOGUE` carries its side (`w`, `m`, `n`), and `CHARACTER_SIDE_RULE` tells the free
card's call to judge, privately, whether the reader is most likely a woman or a man from how they
present themselves in their own data — their name, pronouns in a bio, how they write about
themselves, how friends address them. A woman's choice is then the twelve women plus Baymax, WALL-E,
Remy, Pikachu and Totoro; a man's the twelve men plus the same five; and when it cannot tell with
reasonable confidence, or they present as neither, only those five. Then it finds the closest
temperament among the seventeen (or five) open to them. The judgement is used for nothing else
and **never written**: the rule says so, and the privacy rules (which forbid saying anything about
anyone's gender) carve out only this private choice. The full report's prompt carries the shorter
`CHARACTER_GENDER_RULE` (same sex or non-human, and only non-human when unsure) for a report written without
a card to anchor to; with one, the card's character is pinned and nothing is chosen again. The rule
adds about 250 tokens to the free prompt (`FREE_FIXED_INPUT_TOKENS` 6,700, `FREE_COST_CAP` $0.053 —
about 0.02¢ a run in practice).

Retired characters are no longer offered to the model but keep their scene and emblem
(`RETIRED_CHARACTERS`), so a card written before they went still draws. The five new scenes follow
the same rule as the rest — symbols, never likenesses: a spellbook over a castle of lit windows, a
pink skull on a black bat-winged heart with a devil's tail under a crescent moon, a heart-shaped brooch over a city and its
lattice tower, a gem-set crown above a pink-roofed castle, a red bow over a cottage on a hill of apples.

Each signature pattern lists the sections it shows up in; the sections themselves no longer carry a
"Connects to" row back, and neither plan items nor pressure points name a pattern. There is no digital
footprint section (it restated what the other sections already say). **The parts open and shut, and
all start open** — the overview and the four parts are the report's five disclosures, a part shut by
the reader stays shut while they open another, and every section inside a part is shown whole, with
no "More" behind any of it. **A part nav** under the summary card names each part as it is headed
("00 Overview" … "05 Appendix"), opens the part it
jumps to, and lights the part the reader is in — the whole part is watched, not just its heading, so a
jump into the middle of a long part still lights it. Every name shows in full: the nav wraps onto a
second row rather than scrolling one off the end, sticks under the header on a tablet and laptop, stays
put on a phone, and on a screen 1300px or wider becomes a fixed column to the left of the report. In
Your plan, the section each action comes from ("How you work", "Wellbeing", or a development area) is a
small accent tag under the action (`.plan-from`), set apart from the action's own explanation. MBTI and the Big Five are
rows with the scale on the left and the reading beside it; the MBTI pole not chosen is faint. A section
has a line under its title only where the title does not already say what it is. Values and beliefs
are one list of distinct ideas with no tag saying which is which. Who suits you is the verdict as a
banner over two numbered lists, what you need beside what to be careful of, with no rule between
entries; what you bring beside where it gets hard, and your other strengths beside what holds you back,
use the same pair of lists (`pairedListsHtml()`).

**The Psyche Card** (what was "the summary card") is shown by itself at the top of the report, with
its name kept for screen readers only. **On any laptop (1000px wide or more) a full report has its part
nav down the left**, the page's actions under it once the screen is 520px tall (`sideCardMode()`).
Where the screen is too narrow to centre the 820px report with the nav beside it (under about 1350px),
the report moves right to make room (`main.container`, `margin-left: max(248px, …)`) rather than the
nav dropping back to a bar over the report. **A free report has no nav** and no "Download full report"
— the action row's own `display` used to override that button's `hidden`
(`.cta-row .btn[hidden]`). The card
fills three fifths of the column, edge to edge, and the panel beside it the rest, the two the same height.
Until the reader points at a part of the card, the panel rests on its title, "Your Psyche Card", the
card's three actions across its width — Download, Share, Compatibility, each an icon over a word — a line on
what the card is, and how to learn more ("Hover over any part of your card…", "Tap…" on a touch screen).
**A full report opens the same way**: the card and this panel above 00 Overview, with the part nav down
the left column on a wide screen and the page's actions under it — the thumbnail that used to sit above
the nav is gone. All of this holds (`[data-cx]`, marked by
`markCardParts()`). Then that part's meaning pops out level with it, pointing back at it
(`explainCardPart()`, words in `Copy.STRUCTURED.cardGuide`): what the part is and where it comes from (the
MBTI's background and each letter pair in plain words, the reader's own letters marked; Schwartz's ten
values; why patterns are worth naming) and why it is worth knowing, in **one short paragraph** of two
sentences or so, then the reader's own reading under **Yours** ("On this card" in the sample). There is
no separate "Why it matters" box any more: it was folded into the paragraph. The Big Five's note is one line, then the four traits
on the card defined in a line each (`terms`, drawn like MBTI's letter pairs) — no score ranges.
The part lights up and the rest of the card steps back; the ring pulses until the reader points at
anything. On a tablet, with nothing to hover, tapping a part explains it the same way; a phone explains
it full screen instead (below). **Read from rounds its totals**
(`roughCount()`): 9,741 messages reads "9.7k", 637 accounts "~600"; what was actually read stays exact. Evidence and method sits
under the unlock offer (`freeMethodCardHtml()`): the score and why, then **Your data** — one row per
source (`sourcesReadHtml()`): icon, name, and beneath it what was read or counted from that source
(`countedBySource()`; `countedInFull()` flattens it for the PDF), with "Change ›" on the right, or a
"+ Add" pill and "Not added – adding it raises confidence" for a source not loaded. There is no button:
**the whole row opens the data popout** — on a free report the US$5 unlock (`data-flow="unlock"`), never
the US$2 re-run of the card; on a paid one the re-run (`startRerun()`), its US$5 price in the note under
the rows. The classic layout keeps its own sources table (`sourcesUsedHtml()`). **The rows and "Unlock
the full premium report" open the same popout**: the data
sources popout, titled "Your data for the full report" (`collectDataForPremium()`, which replaced
`collectExtraDataForPremium`), where any source — Instagram, Google, Facebook, and whatever comes later —
can be added or replaced by a fresh export, or the reader carries on with what is loaded. New data goes
through the review, then the payment sheet; nothing new goes straight to the payment sheet. **The
payment sheet asks for no agreement of its own.** Instead, in the data popout over an existing card —
never a first upload (`askDataSources({ cardNote: true })`) — the first tap on any source opens a small
confirm over the popout before the file picker: "Updating your data sources may change your Psyche
Card." with **Cancel** and **Choose file** (`#datasources-confirm`, `Copy.cardChangeNote`). Choose file
opens the picker from its own click (a picker opened after an await is blocked in Safari); it is asked
once per opening, and Escape or Cancel puts it away without closing the popout. The popout itself is
compact: a shorter line under the title, tighter rows, and the source list scrolling on its own (thin
visible bar) when the screen is too short for it, with the title and buttons staying put.
When the data actually changed — a new evidence summary whose fingerprint (`digestFingerprint()`:
coverage, counts, and each supplement's counts) differs from the one the card was read from — the payment
sheet's blurb says the card is redrawn at no extra cost. With no evidence summary
on the device and no export loaded, the popout's Continue says what is needed instead of doing nothing. A free report has no "Download full report"
either: there is nothing beyond the card, which has its own download. In the left column of a full
report the card likewise fills its box. **Part 05** is a heading over two boxes of their own, Evidence
and method and then the roast, and does not fold. On the card, each MBTI letter carries its strength in
words — slight, moderate, clear — on the page and on the PDF's cover. The PDF downloads as **"Psyche
Report - [name] - [ddmmyyyy].pdf"** (`reportFileName()`), the name's accents folded to plain letters,
since a browser saves a file name it cannot encode as just "download". **Who wrote it** closes the page in
one quiet box (`.provenance-box`), a line each: "Psyche Card generated by …" and, once unlocked, "Full
premium report written by …", the model in ink and the date short. **The page's three actions** —
download, test compatibility, delete — each carry an icon to the left of their label; beside a full report on a wide
screen they move under the part nav in the left column as quiet icon buttons in the nav's own box style,
each with its small label under the icon (it was a tooltip only, which a reader had to hover to find),
placed at the nav's measured foot (`--side-nav-bottom`,
`layoutSideActions()`). On a phone, beside a full report, they are one row of equal tiles across
the screen, an icon over a small label each, in the card tools' own style; whichever
label wraps, they stay the same height. My Report shows two: **Back to card** on the left and
**Download Report** on the right (it read "Download Psyche Report"; the page is already the Psyche
Report). **On a phone the part nav is one thin bar** stuck under the site's header
(`--header-h`, measured on load and resize): the name of the part being read — "Overview", "What drives
you", set by `markStructured()` as the reader scrolls — then the six numerals, sized so the longest name
fits whole on a 390px screen. **On a phone the Psyche Card sits in one white box**, read top to bottom:
"Your Psyche Card", the card, a **Tap to open full screen** button (`.cx-open-full`, in place of the
hint line), then Download, Share and Compatibility across the box — the panel's own boxes dissolve
(`display: contents`) so their pieces can be ordered around the card, and the one-line introduction goes. **On a phone the card is explained
full screen, not on the page** (`explainsFullScreen()`: the structured layout under 720px wide): tapping
the card anywhere opens it full screen, and the hint under it says so — "Tap your card to open it full
screen, then tap any part to learn more." — now just *Tap to open full screen*. Full screen there has no Download or Share; in their place
under the card is "Tap any part to learn more" (`.card-dialog.is-guided`, `#card-dialog-tip`), and the
ring pulses until a part is tapped. **There the card fills the phone** (`fitGuidedCard()`): a 10px margin
each side, clear of the notch and home bar, the tip line kept short under it. Phones run from about
1:1.6 to 1:2.5 once the browser's bars are off, so this copy takes the screen's own shape rather than
9:16 — its height set to match (1400–2800 on the 1080 canvas), its contents drawn up to 1.3× larger on a
tall phone or a little smaller on a short one (`fitStoryContent()`, `data-grow`), and any height left
over shared between the sections. The card on the page and the saved image stay 1080 x 1920. A tapped
part lights up and its explanation opens in a sheet inside
the dialog (`explainFullCardPart()`, sharing `fillCardPop()` with the panel) right against the part, 8px
off it, on whichever side has more room — just under "Who you are most like", just over the love
languages — scrolling if it must, and covering the part only when the screen leaves less than a third
of its height free. Its cross, or a tap off the
card, puts it away; only with no explanation showing does a tap off the card close full screen. On a
laptop the parts that pop out show the help cursor and a click explains them; **everywhere else on the
card the cursor is a zoom-in and a click opens it full screen**. Full screen in the structured layout,
laptop or phone, has **no Download or Share** (`.card-dialog.no-tools`) — they sit beside the card. **Download and Share beside the card** draw the image from the card on the page when the full
screen view is closed (`cardImageBlob()`); they used to read the closed dialog's copy, which has no size,
and failed without a word. **00 in the nav goes to the top of the page**: part 00 begins with the Psyche
Card. **"Delete everything" asks first** in a warning sheet of its own (`#delete-dialog`) rather than the
browser's `confirm()`, which some in-app browsers never show; Cancel keeps everything, and Delete
everything clears this browser's copy and lands on the new reader's page, at its top. **A jump from the nav** sets the part's
`scroll-margin-top` to whatever is pinned over the page at that width (`pinnedHeight()` — the site
header, and the nav itself where it sticks), so the part's heading always lands in full view. **Read from** says what
was read of each source and what was only counted — "180 of your 9,741 messages read", "623 stories
counted", "Top 50 of 21,400 distinct Google searches read" — from the digest's own `coverage.sampling`.
No section carries a Premium badge.

The PDF follows the page section for section: numbered part dividers with no labels or intros, no
about page, no "Connects to" or "Raised by", no digital footprint, and an evidence page after Part 4 with
the same Read from list (passed in as `meta.counted`) and no build or format rows.

**Its cover is the story card** (`storyCover()` in `docs/pdf.js`): a purple-to-pink gradient band with
the title and the provenance line, and the card lifted over its foot — the character in a gradient
block of its own with its emblem (`Doc.emblem()` draws the same SVG the page uses; `tracePath()` gained
S and Q curves for it), then the patterns, motivators, type with strength dots, Big Five with mini bars,
values and interests as chips, and the love languages, each in a small tinted panel. Under it the
contents list (`storyContents()`) puts each part's numeral in an accent tile. **The overview page**
(`overviewOpening()`) opens on the headline in a gradient block, the character beside its emblem in a
tinted card, and four tiles — type, strongest drive, strongest trait, confidence — before the summary,
whose first paragraph leads a size up.

**Cards and colour throughout.** `Report.boxed()` draws a block inside a card, narrowing the text
column (`out.x`/`out.w`, which every text helper now reads) and slipping the card in underneath at the
height the block came to: each signature pattern, MBTI letter and Big Five trait is a white card;
each wellbeing dimension is a card tinted by its band (green steady, amber mixed, pink under strain);
each motivator group a card topped in its group's colour; build-on and develop items green and amber
cards; each horizon of the plan one card, with each step's source as a small bent arrow and an accent
tag. Part 3 keeps its boxes (`subhead`, `panel`, `pairedPanels`) and Under pressure its gauge cards
(`pressureCard`). **Supporting text is a size down**: evidence chips (`tags({ small: true })`) at 7.6pt,
a letter's "in practice" line, a love language's why and the motivator lines, so the finding reads first.
"Shows up in" is a row of accent pills (`pills()`), not a sentence of commas.

**The PDF's cover** draws its band in deep plum into the accent, so the character block on the card
— accent into pink — stays the brightest thing on the page, and the card's panels carry their labels
with no dot beside them. **Your plan** is set as the page sets it: each horizon named on the left and
its steps beside it as white cards with a box to tick (`planStep()`), each with its source as a tag.
**The roast is grey while it is covered** (`.bonus-card:not(.is-revealed)`), and turns to the page's
own colours once "Read it anyway" opens it — `revealRoast()` adds `is-revealed`, `hideRoast()` takes it
away — so the unkind part is set apart without being hard to read. **The sample card's full screen
view** has a faint cross fixed in the screen's top right (`#sample-card-dialog-close`), since a phone
has no Escape key. **In the structured layout its parts are explained as the reader's own are**
(`guideSampleCard()`, `explainSampleCardPart()`, `sampleGuideState` from `cardGuideFor()`), whether it was
opened from the front page or from the sample report: on a laptop, pointing at a part lights it and its
note opens beside the card, level with the part and pointing at it, until the pointer leaves the card;
on a phone, tapping a part opens its note right against it, as in the reader's own full screen
(`placeCardPop()`, shared by both). The note's own reading is headed "On this card" rather than "Yours".
**On a phone every full-screen note is one lavender surface** (`.card-dialog-pop:not(.at-side)`), unlike
the card's white, outlined in purple and inset from both of the card's edges (`placeCardPop()`, 5% of
the card's width, at least 14px) so it reads as laid over the card: no heading band, no boxes, no rules
inside it. Its icon, title, what the part is, the MBTI letter pairs (the reader's letter in purple, the
other faint) and "Yours" are told apart only by space and a small purple heading. **Beside the card on a laptop** (`.at-side`) the note keeps the report panel's own white note
with its arrow, untouched.
Under the card a line says how — "Hover over any part of the card to learn more", or "Tap any part to
learn more" on a touch screen (`#sample-card-tip`) — and on a phone the cross moves down beside it,
since there the card reaches the top corner and a faint cross over its white would vanish. On the front page's premium tier, **See sample** shares the last line of "A PDF to
keep", "Evidence behind every finding" and "A secret bonus section" (🎁 — the roast is not named) on a
laptop, and drops under them on a phone.

**Part 05, the Appendix**, holds Evidence and method and the roast, on the page and in the PDF: on the
page it is a sixth part card (`PART_ORDER` ends in `appendix`) and one "05 Appendix" entry in the nav in
place of the two it replaced; in the PDF it follows on after Part 4 where there is room, with the roast
alone on the last page under a "05 Appendix" label, and the contents list names it like any other part.
**The PDF's roast** (`renderStructuredRoast()`) puts the caveat in a tinted note rather than fineprint,
then each half in a card of its own under a small tracked label and a faint open quote in its corner:
the least charitable read edged in pink, the honest friend's advice edged in green. The classic PDF's
roast is unchanged.

**The story card's small print is a step up**: panel labels 24px, strength pills 21px, kicker and
franchise 25.5px, pattern and motive numerals 23.5px, the footer 21.5px. The card is a fixed canvas
whose contents are scaled to fit, so on the sample this costs about one percent off the main text
while the small print comes out eight to nine percent larger.

**The PDF's MBTI opens on a "Your type" panel** (`Report.prototype.mbtiType`) rather than the four
letters at display size over the section: the type at 26pt with its nickname and confidence on the
left, and on the right each pair as a short spectrum — the picked pole's name in bold purple, the other
grey, the marker leaning that way by how firmly it was picked (`MBTI_LEAN`: slight, moderate, clear).
Each letter's card below carries its strength in a pill (filled for "clear") and its "in your week"
line as a purple italic quote with a bar down its side.

**No heading is left at the foot of a page.** Every part opens a page of its own, and each section's
title is drawn together with its first block inside `Report.keep()`: the block is drawn once, and if it
ran over a page break, everything it drew is taken back and it is drawn again from the top of a fresh
page. "How you work" with its edge, "Under pressure" with its first card, "Who suits you" with its lists
move over together; a section whose first block fits — the Big Five under MBTI — stays where it is.
A card that would break with a fair share on each side — 120pt or more before the break, 90pt or more
after it — is allowed to break instead, so a long card no longer leaves most of a page empty: `boxed()`
draws one piece of the card on each page it touches (`bodyAt`, recorded by `Report.page()`, is where a
continued card slips in under the text), and Under pressure's cards are drawn as flowing text inside
one, rather than measured whole. A heading still needs 200pt of its own content under it.
`tools/uitest.mjs` reads the PDF page by page to hold all of this.

**The card's three motivators come from the free call.** `topMotivators` in `STRUCTURED_FREE_SCHEMA`
is the three of Schwartz's ten that show most, strongest first; `anchorFrom` carries them to the paid
call, which is told to score them highest, and `overlayCard` keeps them on the report. A report from
before the field falls back to the three highest of the paid report's ten. **Values and beliefs are
four at most** — three values and one belief, in both prompts and both schemas — and the page and the
PDF draw no more than that from an older report.

The model writes three more fields for it — `patterns`, `motivators` and `development`
(`STRUCTURED_KEYS` in `lib/prompts.js`) — on top of the classic fields, so the
change was additive (until the classic layout was retired, below, a report in this layout still rendered
classic, and `?layout=` drew the same stored report either way). The extra
prompt is about 2,800 input tokens, and the four fields are sized at roughly two ordinary sections of
output; `FIXED_INPUT_TOKENS` rose to 37,600 and `COST_CAP` to $0.151 to keep the 80,000-character
digest inside the cap.

**Less repetition, written into the schema rather than asked for.** A review of two real paid reports
found the same point made three or four times — the character three times before page 3, MBTI letters
re-arguing the Big Five, the edge restated as the first strength, one cost listed three ways, the same
action three times with different deadlines, and "Under pressure" repeating the develop areas. The
prompts already forbade most of it, so where a field existed only to be repeated, the structured schema
now leaves it out (`reshaped()` in `lib/prompts.js`; classic is unchanged):

- `summary` is about 120 words with **no numbers or scores** (`STRUCTURED_SUMMARY`); the character box
  above it stays.
- **Values & Beliefs is three at most**, chosen after `topMotivators` and `patterns` in the free call
  and forbidden to restate either.
- `attachment.implications` ("In practice") is gone — relationships' own strengths and weaknesses carry it.
- `career.watchOuts` ("Where it goes wrong") is gone; `career.strengths` must not restate the edge and
  `career.weaknesses` is at most one cost that `holdingBack` does not name, so "What holds you back"
  is two items at most (the page and the PDF also cap it at two for older reports).
- **`pressurePoints` is folded into `development.develop`**: each area to develop carries the strength it
  tips over from, `earlySigns` and `counterMove`. Older reports still render their "Under pressure" cards.
- **The plan holds about five actions**: one or two from each develop area, `careerAssessment.actions`
  and `wellness.suggestions`, and none the same step on a different deadline.

The full prompt also gained **Plain words, short sentences** (a short banned-word list, British spelling,
sentence case for every name) and **What never appears in the report**: conversation tags (`[t1]`),
field names, sampling figures outside the confidence fields, "neuroticism", and "we". Conversation tags
are also caught after the model writes: `untagged()` in `lib/privacy.js` turns "thread t1" into "one of
your closest conversations" and "threads t1, t2" into "your closest conversations" in every report
before it is stored or served.

**PDF flow.** Only the five parts start a new page. A panel or a pair of panels that does not fit splits
between two of its items (`rowsThatFit()`, `continued()`) when a fair part fits, instead of jumping
whole and leaving a gap; `keep()` now notices a heading stranded at the foot of a page with its first
block overleaf (`breakPage()`/`markHead()`) and moves the two together. The plan is a grid — a column
per horizon, cards in rows of equal height, the column heads repeated after a page break (`planGrid()`).
An older report's "Under pressure" card draws a real arrow between the strength and what it turns into
instead of "->", with no end labels repeating the heading.

**The paid call sends a pinned schema.** Gemini refuses the whole structured schema with a bare
400 "Request contains an invalid argument." — it is past a complexity limit Gemini does not name,
and `npm run probe:schema` (tools/probe-schema.mjs) showed it is the total rather than any one part.
So when the unlock has a free card to anchor to, it is sent `STRUCTURED_PINNED_FULL_SCHEMA`, which
leaves out everything the card already fixed: the card itself, the character, the confidence score,
every Big Five score and band, the MBTI type and letter choices, interest intensities and
love-language strengths. The browser pins all of those over the paid report anyway (`overlayCard`),
so the model was only re-deciding them to be overwritten. The pinned schema is smaller than the
classic one on every count, and a self-test holds it there. An unlock with no card to anchor to (a
reader who added a source while paying) runs the card first and the pinned report after it
(`cardThenFull` in server.js), and the new card comes back beside the report as `freeCard`.

**Why those two calls are not merged into one (looked at again in October 2026).** One call that
writes the card and the report together would need the unpinned structured schema, and that is the
schema Gemini refuses. Merging would also save little:

- The card call on this path reads the same premium-size digest the report does. At its worst
  case (`DEEP_FREE_COST_CAP` in docs/digest.js) that is about 61,000 input tokens ($0.046) and up to
  10,000 output tokens ($0.0375): $0.084. Typically it is nearer $0.06.
- Merged, the digest and a prompt would be read once instead of twice, saving about $0.045. The
  card's ~2,000 tokens of writing, and its thinking, would move into the report call rather than
  disappear.
- Net: about **4 to 6 cents per unlock that adds data**, about 1% of the US$5. It applies only on
  that path; an ordinary unlock is already one call.

A cheaper route, if it is ever wanted, is to draw the new card from the standard digest rather
than the premium one (about 1.5 cents less), or Gemini context caching of the digest across the
two calls. Caching cannot share a cached entry between two different system prompts, and the
storage arithmetic under "Context caching" applies.

**Probing a merge.** `tools/probe-schema.mjs` has rows for it: `combined` (the structured full
schema with the free card's `card` and the roast added, everything both calls write in one answer),
the same with every enum made a plain string and its values listed in the description (option 1,
which would need the server to check each value), the same keeping only the character catalogue's
enum, the same with the values dropped (the floor), and option 1 with nested arrays flattened.
`structured full, enums as strings` asks whether enums alone are what Gemini refuses today.
`node tools/probe-schema.mjs --dry` prints every row's size and enum count without a key;
`GEMINI_API_KEY=... npm run probe:schema -- combined` runs only those rows. Option 2 (sending real
JSON Schema as `responseJsonSchema`) is not a row because it is what lib/gemini.js already sends.
Production goes to Vertex AI first, and a schema Vertex refuses is not retried with the key
(`isBackendFailure`), so `--vertex` sends the rows there with the server's own service-account
variables; the two can differ, and Vertex's answer is the one that decides.

### One confidence rule, scored from the sources (October 2026)

The card and the report scored confidence under two rules: a short one on the card and a strict one
in the report ("score what you were shown, not what exists", written after a report claimed 88 from 3%
of the messages). Two calls hid it, because the report keeps the card's score; the one-call unlock read
both and came out lower (78 and 68 against 88 and 84 for the same reader). And the strict rule scored
the sample, which is PsycheAI's choice and the same for everyone: Instagram, Google and three WhatsApp
chats came out under 70, and a reader who has given everything should not see that.

Both prompts now carry one rule, `CONFIDENCE_SCORING` (lib/prompts.js; the merged prompt says it once):

- **Start from the sources loaded:** since 26 October 2026 by strong sources: Instagram, Facebook and
  WhatsApp chats are strong, Google light, and above 80 needs two strong sources. Never above 90.

  | Sources | Range |
  | --- | --- |
  | Instagram alone | 65–79 |
  | Instagram + Google | 68–80 |
  | Instagram + Facebook or WhatsApp | 72–86 |
  | Instagram + Facebook or WhatsApp + Google | 74–88 |
  | Instagram + Facebook + WhatsApp (± Google) | 76–90 |
  | 2 WhatsApp chats | 58–72 |
  | 3 WhatsApp chats | 62–78 |
  | 2 / 3 chats + Google | 60–74 / 64–80 |
  | 2 / 3 chats + Facebook (± Google) | 65–82 / 68–86 |

  (Chats alone raised on 27 October 2026, from 55–68 for two and 58–74 for three, with Google 57–70 / 60–76
  and with Facebook 62–80 / 65–84: three chats now top out at 78, just under Instagram alone.
  Before: Instagram alone 65–79, one more source 70–84, two or more 75–90, chats alone 55–72 or 60–76
  with Google or Facebook. Those let Instagram with only Google reach 84, and did not tell two chats from
  three. Earlier still, late October 2026, lowered from 68–82, 76–88 and 82–92: an Instagram-only reader
  scored 81.) The prompt reserves rose by 50 tokens for the longer rule.
- **Always three signature patterns** (late October 2026): a real card came back with two, which the
  prompt then allowed. The schema's description and the report prompt now ask for exactly three, and the
  merged call's strict schema holds it with minItems/maxItems 3.
- **Within the range**, higher when the sources agree and the reader writes in their own words across
  years; lower when it is mostly likes and follows, the span is short, or the sources disagree. Below
  the range only for a genuinely thin export.
- **Never lowered for the sample.** The sample still limits what may be *claimed* (their voice, not
  every relationship), and `basedOn` still says what was read of what exists, never a total as coverage.
- `level`: high from 75, moderate 60–74, low 40–59, very low under 40.

The free prompt grew to 10,959 tokens (`FREE_FIXED_INPUT_TOKENS` 11,000); `DEEP_FREE_COST_CAP` $0.084 →
$0.085. The ring's explanation on the card no longer says the score depends on how much was read.

### Psyche Hub (October 2026)

My Psyche's control panel: a **Psyche Hub** section (`hubHtml` in docs/app.js, `.hub-*` in styles.css),
under the card once the report is unlocked and at the foot of the page before it (after the Overview,
the roast and the offer). The first version read as one more section, so it was redrawn to look like
the site's panel and to use as few words as possible:

- **A gradient bar with its name**, centred, over a panel with the same light wash as the My Syncs header
  (`.scan-hero`). No icon or subtitle.
- **Header**: *Your Psyche Hub*, centred in gradient type with a short gradient rule under it, inside a
  gradient ring and a soft glow that mark it as the site's control panel. Tile and row titles are all
  bold and the same size.
- **Colour per section** (late October 2026): the tiles lavender, Your Link peach, Signal Strength mint,
  Save your profile sky, so the eye can follow them; buttons, chips, counts and the score ring are
  see-through on their section's colour with a thin outline, and Unlock free is the one filled button.
  The four tiles are one grouped box, a strip with dividers on a laptop and a list on a phone.
- **Late October 2026 polish:** the four colours sit on a plain white panel inside the gradient frame, each
  section with its own thin outline; a lock where the locked report's tick would be; tooltips on the tile and row names
  (no longer clipped), Signal Strength's saying to tap the score; the link's counts dotted, as they are not
  buttons; *Save Profile*; no second popout after a backup saved from the hub; who wrote the card centred
  under the hub; and "Psyche Hub below" in the card's description is a link down to it (the description
  now shows on a phone too, under the buttons).
- **Psyche Sync** (was Your Syncs): *See list* and a Share icon for the reader's link. **Ask PsycheAI**,
  once there are answers: *History* wide and a small *?* to ask a new one; before, Ask across the width.
- **Phones a size up** (late October 2026): titles about 14px, buttons about 13px and at least 40px
  tall, chips and counts a step larger, so it is easier to tap; Download is just its icon there.
  Laptops keep the compact sizes.
- **Psyche Card is the first tile** (a green tick; Read opens it full size, Download saves the image), then
  Psyche Report, Your Syncs and Ask PsycheAI. The locked report keeps the plain tile border: its filled
  Unlock button is enough.
- **One card, one credit** (late October 2026, `CARDS_PER_CREDIT` in lib/referral.js; three until then):
  every connection who makes a card from the reader's link earns a credit, for an Ask PsycheAI question
  or a Psyche Report to gift.
- **Your Link is a row**, above Signal Strength: its name with a copy-link icon beside it, a small purple
  pill with the rule ("1 card = 1 credit = 1 question or report to gift"), the three counts as pills
  (opened · cards · credits; syncs are on their own tile) at the right on a laptop, and,
  once there is a credit, Gift a Psyche Report and the gift links made. It reuses the referral card's
  classes, so `refreshReferral` fills it and its handlers run it; there is no popout.
- **Four small tiles, two lines each**, in the rows' own faint lavender, with white buttons lifted by a
  soft shadow rather than a line, and type as light as the source chips (the heavy capitals read badly
  on a laptop): the name and its one number or state, then its buttons. *Psyche Report* (a plain green
  tick; Read and Download, which is the PDF), *Your Syncs* (how many; Sync), *Ask PsycheAI* (questions as
  left/of, e.g. 2/5, where "of" is what is left plus the questions actually asked (Appendix 2's list):
  never asked, 5/5; a lone free question 1/1. (A remembered high-water mark, `psycheai_ask_of`, read 5/6
  for a reader who had asked nothing once a link credit went on a gift, so it was dropped); Ask, which opens with the ideas showing, and History once there are answers,
  which opens My Report's Appendix 2), *Your link* (a copy-link icon in the corner, then opened · cards · credits, all one size,
  which open *Credits and gifts*). Only the locked report has colour of its own: a breathing gradient
  ring and one filled *Unlock free* (or *Unlock*) button. The server's numbers fill in as they arrive
  (`refreshHub`).
- **Back lands on the hub**: leaving for My Report or My Syncs from a tile, Back (the browser's or the
  report's own) returns to My Psyche with the hub in view, in the same frame, so the card is never seen
  on the way. The browser's scroll restoration is off from the tap until the reader is back
  (`leaveHub`): left on, it puts back the top of the page the history entry remembers.
- **Tooltips, no "i"**: each tile's name is a button whose one or two lines show on hover or
  focus, and on a tap on a phone (a tap elsewhere or Escape hides them). The two rows have none: the ring
  and the buttons say what they are.
- **Data row**: "Signal Strength" and the score's ring, one button (opening *Signal strength*; no level
  words beside it), then the four
  sources as chips, in one line on a laptop and two by two on a phone.
- **"Your Data" and Add / change data** (October 2026). Readers said they could not find where to add
  or change data and run the analysis again. The chips worked as buttons but did not look like them, and
  "Signal Strength" named the score rather than the data. The row is now *Your Data*, with one filled
  **Add / change data** button after the chips (full width on a phone). It opens the same flow as a chip:
  the re-run popout once unlocked, the unlock popout before that. My Report has the same way in among
  its actions, as **Add data** (`#report-rerun`) in Save a backup's place: *Back · Report · Add data*,
  in the side menu under the part nav on a laptop and in the bottom row on a phone. The hub keeps Save
  Backup. The report's header has no button of its own; one there was tried and dropped.
- **Signal strength in My Report's header** (October 2026): beside the parts-and-pages pill, the score
  in the hub's ring and "Signal strength" (`reportSignalHtml`), so the report says how well the data
  supports it before the reader starts. A tap opens the same *Signal strength* popout as the hub's
  ring. It is hidden in print. The popout keeps its title, *Signal strength*: that
  is what it shows.
- **A tip when the score is below 80**: one dashed line under Your Data naming the sources not yet
  added ("Add WhatsApp, Google or Facebook to sharpen your read."). It opens the same flow. A tap on it
  or its × hides it until the next reading: `psycheai_data_nudge` holds that reading's `premiumAt` or
  `createdAt`, so a re-run that still scores low shows it once more. It never shows at 80 or more, or
  when every source is already loaded.
- **The ticks carry who made it and when** (October 2026). The Psyche Card and Psyche Report ticks show
  the day under them (Oct 15). Who made it and when ("Psyche Card generated by **model** on 15 Oct 2026,
  18:51.") is the last line of the tile's own tooltip, under a thin rule (`hubMade`). The same tooltip
  shows on hovering the name or the tick on a laptop, and on a tap of either on a phone. A separate bubble
  on the tick was tried first and merged into the tooltip so the tile has one. The line that sat under
  the hub (`#analysed-by`) is hidden wherever the hub shows; My Report keeps it at its foot, where people
  save and print the report. A profile with no date on record keeps the plain tick.
- **The numbers explain themselves too**: hovering (laptop) or tapping (phone) the count on Psyche Sync
  or Ask PsycheAI shows that tile's tooltip, as its name does. Their native `title`s are gone, so two
  tooltips never show at once. Tooltips let taps through (`pointer-events: none`), so an open one never
  blocks the tile below it on a phone.
- **Words**: the tile names, "Signal Strength" and "Save your profile" in black at the buttons' own size; the source
  chips short (Instagram, WhatsApp, Google, Facebook); *Save Backup*; AI Personal Context, while locked,
  greyed with a dashed outline and its lock, so it plainly cannot be used yet.
- **Save your profile row** (the label on the left and its buttons at the right, beside the bin, on a
  laptop; the label centred above its three buttons on a phone; the data row is centred on a phone too): Save a backup (with when it was last saved,
  `psycheai_last_backup`), *AI Personal Context* (report holders only) and a bin for Delete everything.
  Backup and AI Personal Context open a short popout first (locked, AI Personal Context opens the same
  explanation with Download greyed out: available once the report is unlocked; the backup's words say
  plainly that the file brings the profile back if the browser clears its data) (what the file holds, that it is made on the
  device) with Back and Download: nothing downloads on the first click.
- **Signal strength** (was Evidence and method, then Confidence score; its lead line, in the report and the
  PDF too, reads "Signal strength: 86/100 (high)") opens in a popout cut down for the hub: every source
  open, "Not added" where missing, one *Add / change data* link by YOUR DATA instead of one per row, and
  no WhatsApp advice.
- **The referral card is gone from the page**; it opens whole in the *Credits and gifts* popout, so its
  own handlers still run. On phones the popouts rise from the bottom as sheets.
- **AI Personal Context** (`aiProfileMarkdown`, was "AI profile"): a short Markdown file made on the
  device, to paste into ChatGPT, Claude or Gemini. It opens with **How to talk to me** (`howToTalkTo`),
  built only from what clearly leans one way: a Big Five trait at 65 or more or 35 or less, an MBTI
  T/F or J/P letter held more than slightly, and the conflict style. Then who they are, personality,
  what drives them, patterns, interests, how they connect, how they work (with work style and
  watch-outs), their rhythm and social energy, and what they are working on. Never the roast, the
  attachment style or the partner section.
- The classic layout keeps its old confidence and referral cards: the hub is the structured layout's.

### The report trimmed: one line a trait, one box for what drives you, five plan steps (October 2026)

Four parts were cut down after reading sample reports end to end, where the same findings recurred under
different headings. The structured layout only; classic keeps its full sections.

- **The Big Five is five scores and a line each.** MBTI, printed above it, carries the case for the type.
  Each trait keeps its score and band and gets one sentence; the evidence list is gone from the schema
  (`STRUCTURED_TRAIT`). The E/I letter still reads off the extraversion score, which stays: 55 or above
  takes E, 45 or below I. Its `why` is now where the extraversion evidence, the breadth number, is laid
  out (`structuredMbti`, and three `STRUCTURED_SPLICES` on the prompt: no "cite real evidence per trait",
  the breadth number goes in the E/I `why`, and `why` no longer measured against a Big Five trait's depth).
  A report written before the cut shows only the first sentence of each trait, on the page and in the PDF.
- **What drives you is one box.** The motivators (circle, reading, ten bars), then **Values & beliefs**
  (the same list of three, untagged) and **Interests** (every one), each a bold name and one line
  (`drivesLinesHtml`). The Interests section of tiles with trend markers and evidence is gone; the card
  still shows interests. The schema's interests lose their evidence and keep a one-sentence detail
  (`STRUCTURED_INTERESTS`).
- **The plan holds five steps** (`Copy.planPick`, `PLAN_STEPS`), shared by the page and the PDF. The
  develop areas', the work coaching's and the wellbeing suggestions' actions are each strongest first, so
  they are taken in turns, first of each, then second of each; one step per horizon is taken first, so
  the plan still runs from this week to this year. A step repeating another's words is dropped.
- **Strengths and friction** heads What you bring and Where it gets hard in How you connect, on the page
  and in the PDF.

The sample report's Big Five lines were rewritten as single sentences to match.

### Values & Beliefs: exactly three (October 2026)

"At most three" let a report show two (the 17 October merged report did). The list is now exactly three:
two values and a belief — religious, political, ethical or philosophical, wherever the reader's own data
supports one (a search never does) — or a third value where no belief is supported. None may repeat
another, a top motivator or a pattern; fewer only for a genuinely thin export. Religion is allowed, as
it always was, under the same rule as any belief; it is on the card, so it appears only where the
reader's own words or record show it.

### One call for the unlock that adds data (October 2026)

The probe answered it: Gemini refuses the merged schema only because of its enums. With every enum a
plain string, even card + report + roast in one schema is accepted, and the character catalogue can
stay a real enum. So, behind `PSYCHEAI_MERGED_UNLOCK` (off by default until 26 October 2026, on by
default since, and `false` to turn it off), the unlock that adds data — and the free first read, which
writes the card and its report together — runs one call (`mergedOrTwoCalls` in server.js,
`analyseMerged` in lib/gemini.js). At most 18.5 cents a read (`MERGED_COST_CAP`) against 25.9 for the
two calls; an answer that fails its checks still falls back to them (counted as `merged_fallback`).

- **The prompt** (`MERGED_SYSTEM`) is the full report's, then the free card's own prompt word for word
  from its Big Five section on: the character catalogue and its side rule, the lists, confidence, the
  patterns, the Overview, the card's wording rules and the roast. Where the two differ about a card
  field, the card's rules win. It is told to settle the conclusions first and write the report to
  explain them, as if the card had come first.
- **The schema** (`MERGED_SCHEMA`) is `MERGED_STRICT_SCHEMA` — the structured full schema with the
  free card's `card`, `topMotivators` and the roast last — with every enum but the character's sent
  as a string whose description lists its values.
- **The checks** (`checkMerged`) hold the answer to the strict schema: a value matching its allowed
  spelling ignoring case, spaces and hyphens is put right; one in a list that matches nothing is
  dropped (a pattern's `showsUpIn`, say); one on its own that matches nothing, or a missing roast,
  summary, card or patterns, fails the answer. The report's motivator scores are nudged so the card's
  three are its three highest, as the anchored call is told to do.
- **The fallback.** A refused schema, a cut-off or unreadable answer, or one that fails its checks
  goes to the two calls as before (`cardThenFull`), so the reader always gets an answer every check
  already trusts; that run costs both. Each is logged and counted (`merged_unlock`,
  `merged_fallback` in the daily stats).
- **Thin answers are kept, and logged.** The first live merged report (16 October 2026) had one
  development area where the prompt asks for two, and wrote a partner as "she". The merged prompt now
  says the card never shortens the report (`develop` has exactly two areas), and every prompt says how
  to write about people without gender (`NEUTRAL_PEOPLE_RULE`: "a partner", "the right person",
  "someone", "they"; the reader only as "you"). An answer with fewer than two develop areas is still
  kept — sending it back would cost two more calls — but logs `[unlock] one call: thin answer` and
  counts `merged_thin`; if those keep coming, switch `PSYCHEAI_MERGED_UNLOCK` off.
- **Two develop areas, held by the schema.** The merged schema sets `minItems`/`maxItems` 2 on
  `development.develop`, so Gemini cannot return one. The probe never tested those keywords; if Gemini
  refuses them, the merged call falls back to the two calls and logs `schema refused`, which is why
  they are on the merged schema only — the ordinary paid call has no way back from a refusal.
  `npm run probe:schema -- MERGED` checks it.
- **The split** (`splitMerged`) hands back exactly what the two calls return: the card as the free
  schema shapes it (completed by `withCard`) and the report as the Overview-pinned schema shapes it,
  so the browser's `overlayCard` and everything after it cannot tell the difference.
- **Cost:** about 41,500 tokens of prompt and schema against 43,100 for the two calls, and the
  premium digest read once. At worst $0.184 (`MERGED_COST_CAP`, $0.183 until the MBTI evidence lists of 18 Oct 2026, 30,000 output tokens) against
  $0.256; typically about 5–6 cents less, and a minute or so sooner.

**Before switching it on**, `npm run compare:unlock -- <digest> --runs 3` (tools/compare-unlock.mjs)
runs both ways on the same digest and prints, side by side: how often each is sent back, how often each
agrees with itself and the two with each other (type, character, Big Five bands), words per report
section, the Overview's and roast's length, whether the report's top motivators match the card's, any
word the card's rules forbid, cost and time. It writes every answer and a side-by-side page of the card's
lines, the Overview, the roast and the plan to `compare-unlock-out/` (ignored by git: a real person's
reading). Switch it on when the one call is never sent back, agrees with the two calls about as often as
they agree with themselves, writes sections about as long, and reads as well on the page. The probe has
a row for exactly what it sends: `npm run probe:schema -- --vertex MERGED`.

### The report opens as an index, not a scroll

Every section arrives shut. What a reader meets on the psyche page is a list of headings — Who you
are, Big Five, MBTI, Interests, Values & Beliefs, In relationships, At work, Your digital
footprint, the roast, and the four paid sections — each one line of title, one line of purpose, and a
chevron. Opening one is a click on the row. The full report is around **6,000 pixels** tall; shut, it
is **1,835**, and 577 of those are the confidence card at the bottom that does not collapse. A reader
looking for what the model said about their work no longer scrolls past six other sections to reach
it.

**One card does not collapse, deliberately: the confidence card.** It is the only section that is not
part of the reading — it holds the confidence score, the Data sources rows and the button that adds a
source or runs the analysis again. Those are the things a reader comes back to the bottom of the
report to *do*, and shutting a page's own controls behind a disclosure is hiding, not tidying. It is
also the reason the fault-injection for this was worth running: making it collapse like the rest
fails the suite twice over, once on the section count and once on a check further down that simply
cannot reach `#rerun-with-data` any more.

**The four paid sections are the other exception, but only at the moment they are bought.** Somebody
who has just paid should be looking at what they paid for, not at four more shut headings. Both routes
into a fresh unlock end in `openPaidSections()` — the one that splices the four cards in over the
consolidated block (`revealPaid`) and the one that redraws the whole report after a bundled free
refresh (`renderProfile`). Stating it once at the end of `revealPaid` rather than inside the branch
that happens to need it is what makes it a property of the function: cards built fresh are born open
because nothing has run `collapseSections` over them, while the ones the fallback finds already on
screen were shut by the render that put them there. Break both — have `paidCard` emit `is-collapsed`
*and* drop the call — and eight checks fail across the wellness, attachment and career reads.

**Once every section is a heading, the glyph beside it is doing real work**, and two of them were the
same. Career assessment and "How much to trust this" both wore 🎯 — fine when the report was a scroll
and the two sat 4,000 pixels apart, but a duplicate in a fifteen-row index reads as a rendering
mistake. Career assessment is 🪜 now, which says the same thing without colliding with 💼 ("At work",
the free section) or 🧭 (the MBTI block) either. The check that pins it is written as a property of the
whole report — no two `.card-icon` values in `#profile-body` may repeat — rather than as an assertion
about those two, so the next section added cannot quietly reintroduce the problem.

Mechanically it is deliberately small. `sectionHead` gained a `collapsible` flag that puts a real
`<button>` **inside** the existing `<h2>` — the canonical disclosure pattern, which gives the control
its accessible name from the section title for free and leaves the document outline intact, where
wrapping the whole row in a button would have destroyed both (a heading is not valid button content).
The body is hidden by sibling selector — `.section-card.is-collapsed > :not(.card-head)` — rather than
by wrapping each section's content in a container: every section was already a head followed by its
content, so "everything that is not the head" names the body exactly, and not one of the ten builders
had to be restructured to introduce a wrapper. The whole head row is the click target, not the chevron
alone; the button inside bubbles to the same delegated handler, which is why one of the checks exists
specifically to prove a click on the chevron toggles **once** rather than opening and immediately
shutting again.

`collapseSections()` sets the state after `innerHTML` rather than baking `is-collapsed` into the
markup — it runs in the same synchronous task, so nothing is ever painted expanded first, and one
function closing whatever is currently there beats threading a "start closed" flag through every
builder and every caller. Sub-lines are clamped to one line while shut, which is what makes the list
uniform: the four paid sections have sub-lines three lines long, and left alone their rows were twice
the height of the free ones for text the reader is about to see in full the moment they open it.

**Opening a section scrolls its heading to the top of the screen, and it did not used to.** The
accordion shuts whichever section was open, and when that one sat *above* the one being opened its
whole height leaves the flow — so the card the reader just clicked jumps upward by however tall the
closing section happened to be. Measured on a 390×844 phone before the fix, headings landed around
400px down the viewport instead of just under the nav, and in the worst ordering the heading ended up
at **−165px**: above the top edge entirely, leaving the reader looking at the middle of a section
whose title was off-screen. The distance depended on which section had been open a moment earlier,
which is what made it read as the page misbehaving rather than as a layout consequence.

Two details make it work. The `scrollIntoView` runs **after** the accordion's collapse loop, not
before: those `display: none` switches are synchronous, so the position measured afterwards is the
settled one, and scrolling first aims at coordinates the collapse is about to invalidate — worth
stating because it looks like a free reordering and is not. Fault-injecting exactly that, moving the
scroll one statement earlier, put the heading at **−979px**. And the offset that keeps the heading
clear of the sticky nav is `scroll-margin-top` on `.section-card` rather than a pixel figure in the
JS, so it cannot drift the next time the nav changes height; inside the sample dialog it is overridden
to a much smaller value, since that dialog's head sits outside its scrolling body and overlaps
nothing.

The checks drive both orderings — closing a section *below* the new one, which shifts nothing, and
closing one *above* it, which is the case that was broken — because a single ordering passes against
a half-fix. A third asserts the heading clears the nav rather than merely reaching scroll position
zero, since a heading tucked under a translucent sticky nav would satisfy "at the top" and still be
the bug. All three fail, with real numbers, against each of: no scroll at all, no `scroll-margin-top`,
and the scroll placed before the collapse.

**The collapse is screen-only.** In print there is nobody to click anything, and a report that printed
as ten headings and nothing else would be worthless — so the rule lives inside `@media screen` and the
chevrons join the other controls in the print-hidden list. The PDF export is unaffected either way: it
is built from the report object in `docs/pdf.js`, never from the DOM.

`tools/uitest.mjs` gained a block that runs at the first report render, before anything in the suite
opens a section — the one place that sees the report as a reader actually meets it. It checks that
every section but one arrives shut, that a shut section still shows its heading while genuinely
hiding its body, that shutting the report at least halves its height, and then drives real clicks:
open one, confirm only that one opened, shut it again, click the chevron alone and confirm it toggles
once. Everywhere else, an `openAllSections()` helper opens the report first, so a check about the
*writing* never has to care about the disclosure. Fault-injected in five directions — never
collapsing, collapsing the confidence card too, leaving the paid sections shut after payment, breaking
the born-open assumption, and a second listener on the chevron — and each broke a different, specific
set of checks.

**Opening a section shuts whichever one was open before it** — an accordion, not a pile of sections a
reader has to remember to close again. The point of arriving shut was to keep the report navigable at
a glance; a reader who opens three sections while exploring and never closes any of them ends up back
at a long scroll, just with three extra clicks behind it. The rule lives in the same delegated click
handler `.card-head-toggle` already used: opening a section walks every other `.card-head-toggle` in
the *same* report — `card.closest('#profile-body, #sample-body')`, so opening a section in the sample
dialog can never reach across and shut one in a reader's own report sitting underneath it — and shuts
whichever of them are open. Closing a section, the other direction, touches nothing else: only opening
triggers the sweep. The confidence card is the one exception both ways, exactly as it is for
`collapseSections()` itself — it is never in the set the sweep walks, since it carries no
`.card-head-toggle` at all, so it stays open regardless of what a reader does to the ten sections
around it.

Two checks pin this: opening a second section confirms the first one shut and the second one did not,
and a separate check confirms the confidence card survived that sweep untouched. Fault-injected both
ways — dropping the sweep entirely, and widening it from `.card-head-toggle` elements to every
`.section-card` in scope — and each broke a different one of the two.

### One character

It opens on **one character** — a globally famous one from Disney, Pixar, Marvel, DC, Nintendo,
Pokémon, Ghibli or similar — with the franchise beside the name and the reasoning for why that one
and not a neighbouring one. The prompt's test is whether a stranger in another country would picture
them instantly, so no deep cuts; it rejects a compliment in a costume (Superman), a restatement of a
hobby, and anything only a fandom could name. The match is on temperament and drive, and the prompt
forbids matching on how anyone looks, or on gender or background.

**There is no character artwork, and there will not be.** Mickey, Pikachu and Iron Man belong to
Disney, Nintendo and Marvel; bundling their art, or hotlinking it, is not something this repo can
do. The icon is an emoji standing *for* the character — the thing they carry or are known for, so a
lightning bolt for Pikachu, a shield for Captain America — shown in a round medallion and labelled
with `aria-label` so anyone not seeing it still gets the name. If you have licensed assets, the
place to put them is `essenceBlock` in `docs/app.js`. Because a model told to send exactly one emoji
will occasionally send a sentence, the client checks the glyph and substitutes a placeholder rather
than printing prose where the icon goes.

The field is still called `noun` in profiles saved before this change, and profiles live in
localStorage indefinitely with no server copy to migrate, so both the page and the PDF fall back to
it — covered by a check that stores an old-shape profile and renders it.

Under the character sits a two-or-three-paragraph summary that lands the findings from every section
below, so someone who reads only the opening still leaves with the answers.

A **glance strip** — MBTI type, highest and lowest Big Five trait — used to
sit between the two. It came off the page once the psyche card moved above the report, since the card
already carried all four and repeating them a few centimetres below was the same facts twice. It
survived in the PDF a while longer on the grounds that the PDF had no card in front of it; page one is
that card now, so it is gone from both, and `Copy.glanceItems` and the four labels that fed it went
with it rather than sitting in `copy.js` as strings nothing renders.

Then Big Five with per-trait evidence; interests, beliefs and values; relationship and career
strengths and weaknesses — the **attachment** guess shows its working, naming the behavioural traces
it rests on, the style it rejected, and what it means in practice for them and for a partner, since
a named style with no reasoning is worthless and slightly harmful.

**Three names, not four.** The attachment read uses *secure*, *anxious* or *avoidant*, and a read
that genuinely leans both ways is called **an anxious and avoidant mix**, naming the two leanings,
never "fearful-avoidant" or "disorganised". Those two labels read as a diagnosis, are the harshest
thing a reader could be told about how they love, and are the least supportable from what someone
watches — and what a reader follows, watches or saves *about* attachment is explicitly not evidence
of their own style (someone binge-watching fearful-avoidant explainers is far more likely to be
trying to understand a partner or an ex). The card schema, the premium schema and `PREMIUM_SYSTEM`
all say so. Reports generated before the change are softened on display: `Copy.gentleAttachment()`
rewrites the old labels in the web report, the "Beyond your card" panel and the PDF, and the
attachment map's fourth corner is labelled "Mixed".

**Love languages** are given twice over, for receiving and for giving, because most people do not
match on the two. Each language is ranked `primary` / `secondary` / `minor` and carries both its
evidence and what it looks like for this person; the two columns sit side by side so the difference
is visible without being narrated. Giving is read from what they visibly do; receiving is thinner
evidence and the prompt says to hedge it harder. Physical touch is close to invisible in an
Instagram export and may not be claimed as primary unless the person's own words make it obvious.

And two longer sections:

**MBTI**, which is four axes and nothing else. The type and its nickname, then per axis how strongly
the data leans (`slight` / `moderate` / `clear`), what in their data put it there, and what that
letter looks like in their ordinary week. There is no summary paragraph, and the prompt says so
outright so the model does not smuggle one into the last axis. It also requires that a sentence
which would survive being pasted into a stranger's profile be rewritten or cut, that one of the four
sting slightly, and that a hedged letter beats a confident wrong one.

There is no Enneagram section: the Enneagram has been removed from the app.

**Your digital footprint**, which is the part of the export nobody reads themselves: what they post and
in what mix, when they reach for the app, how their use changed month by month, and what they take
in. It used to run to six facets and a list of hedged behavioural implications; the shape-of-attention
facet and the implications list were trimmed for being the two subsections that told a reader the
least per word, and both were cut from `PROFILE_SCHEMA` too, not just from the page — asking the
model for output nobody reads is tokens spent for nothing.

It is now **four facets and nothing else** — no sub-line under the heading, no caveat closing it.
The summary restated in prose what the facets say with the evidence attached, and the blind-spots
line duplicated the confidence section that closes the whole report. `align-items: start` on the
grid keeps each facet only as tall as its own text: stretched to the row height instead, the accent
rule on a short facet ran a couple of hundred pixels past the end of its paragraph, which reads as a
rendering fault rather than a divider. That only became visible once the fourth facet arrived with a
paragraph much longer than the other three.

### What you take in

The rest of the report reads what somebody produces. This one reads what they consume, which the
export supports better than it looks: `following` is what they subscribed to, `mostLikedAccounts` is
what actually catches them, `mostSavedAccounts` is what they meant to come back to, and
`mostEngagedWith` is who they actually talk to. Those are four different appetites and they rarely
agree, so the prompt asks for the **gaps** — six hundred follows against forty live ones is a
subscription someone stopped reading, and a wall of saved training plans against the same twelve-week
block every year is an ambition that is not converting.

This replaced **Publishing vs reading**, which asked the same counts and answered them more thinly.
The publish-against-read ratio is now one sentence of this read rather than a facet beside it —
keeping both meant two facets reaching for the same numbers and saying the same thing twice.

It is one paragraph, and one of the four facets. It briefly carried four more subsections — a ranked
list of the accounts taking the most attention, a read of Instagram's own inferred topics, and a
**Worth changing** / **Leave alone** pair of recommendation lists closing the section — and all four
were cut together for length. The behaviour section had grown to about a screen and a half and was
outweighing findings that say considerably more about a person than their feed does. All four came
out of `PROFILE_SCHEMA` as well as the page, on the same reasoning as the facets before them: output
nobody reads is tokens spent for nothing. Losing the list and the second reading left it the same
shape as the other three, which is why it went back into the grid rather than running full width
beneath it.

**Two rules outlived the list that introduced them**, because the surviving paragraph still reads
the same counts, and cutting a section must not quietly cut a guardrail with it. A selftest check
holds each one against `PROFILE_SYSTEM` directly rather than against the field that used to carry
it:

- **Attention is counted in likes, saves and comments.** An Instagram export contains no watch time,
  no session length, no screen time of any kind, so anything phrased in minutes would be a number
  the app invented.
- **Private individuals are described, never named.** Outlets, brands and public creators can be
  named where one is genuinely the point. A friend or a relative gets "a friend you have run with
  since 2021" — the reader knows who their friends are, and a handle written into a PDF they may
  hand to somebody else drags in a person who never agreed to any of this.

  The prompt asks for this, and the server also checks it after the model has written
  (`lib/privacy.js`), because a real report still listed three friends' handles with their like
  counts. Every report is scrubbed before it is stored or served. The check removes any handle
  the digest itself supplied (liked, saved and commented-on accounts, plus @handles in the
  reader's own writing) and Facebook friends' full names, replacing them with "an account" or
  "a friend". A handle is removed only where the text uses it as a name: written with an @,
  followed by a count, or containing a digit, an underscore or a dot. A handle that is also an
  ordinary word in the digest ("travel") keeps its ordinary uses. Public channels and brands the
  model names from elsewhere are left alone. The log records how often this happens, never what
  was removed.

### Mental wellness

Six behavioural dimensions, sitting directly under the behaviour read that evidences them: **sleep and rhythm**, **cognitive load**, **social connection**, **emotional
processing**, **physical activity**, and **meaning**. Each gets a band, its own confidence, a couple
of sentences and the evidence behind them; then a prose overall read and three to five concrete
suggestions.

**It is paid content now**, generated by the same call as the attachment read, the career coaching and the roast, and opened by the same single US$5 unlock. It was free while it was written by the free report's own call; moving it did not loosen a single one of the limits below — the hard-limits subsection moved with it into `PREMIUM_SYSTEM` intact, and the same ten checks pin it there. If anything the move raised the stakes: a section somebody paid for is a section they are more likely to keep, forward and believe.

**It has no score, and that is the design rather than an omission.** Every other scored thing in this
report draws a 0–100 — the Big Five, the compatibility dimensions. This one bands instead, because
the notation is most of what makes a claim read as a measurement. "Emotional processing: 41/100" is a
mental health score in all but name; a reader screenshots the number and forgets the caveat, and a
validated instrument earns its number by being tested against real outcomes with known error rates,
which nothing derived from posting timestamps has. `overall` is prose for the same reason — averaging
six bands into a "wellbeing index" would rebuild the health rating through the back door with a
veneer of arithmetic. Two checks pin this: no `integer` may appear anywhere under the wellness
schema, and the rendered section may contain no bar, meter, `n/100` or percentage.

**The six have been reshaped once, and every reshape has pulled the names narrower than the request.**
The section was first asked for as "physical health" and "emotional processing and health"; the export
carries neither, so those became `physicalActivity` and `emotionalProcessing`. The current six are
`lifeTrajectory`, `outlook`, `socialConnection`, `cognitiveLoad`, `meaning` and `rhythmAndActivity`.
Sleep and physical activity merged: they were always two readings of the same thing — when somebody is
up and about — and the weaker half now sits beside the strongest evidence in the section instead of
standing alone as a dimension that is silent for most people.

**This section is deliberately blunt, and that is the considered position rather than an oversight.**
It exists for reflection, and it is read by people in a vulnerable frame of mind who paid for it. The
first version of the two newest dimensions hedged hard — it banned "despair", "hopeless" and their
synonyms outright, and required a difficult year to be described only as a "stretch" whose cause was
not visible. That was the wrong trade. Somebody genuinely in a dark place who reads four paragraphs of
careful euphemism about their "quieter chapter" has been failed twice: once by the softening, and once
by paying for it. **The prompt now hands the model the plain words on purpose** — "difficult",
"depressing", "bleak", "despair", "grim", "lonely", "stuck", "exhausted" — and says in as many words
that hedging is the failure mode here, not the safe option.

**The one line that does not move is diagnosis, and it is drawn as a distinction rather than as a
banned vocabulary.** The prompt states both halves next to each other, because the difference is real
and easy to blur: *"this reads as a genuinely depressing stretch and you sound worn down by it"* is an
honest description of evidence and is exactly what the section is for; *"you appear to have been
depressed"* is a medical claim about a person, made from posting timestamps, by something with no
clinical training, in a document they keep and may show other people. Where something looks like it
warrants a professional, the instruction is to say so directly rather than to hint. The field names
hold the same line — `outlook` names the writing, where `mood` would name an inner state the data
cannot reach — and a check refuses any dimension named for a clinical condition or a health
measurement. Two further checks pin the directness itself, because the natural drift on a section like
this is back towards hedging one careful rewrite at a time, and the people that costs most are the
ones least likely to complain about it. The reader is also told up front, in the section's own
sub-line, that it is "written to be honest rather than gentle, including about the harder stretches" —
which lets somebody choose when to read it, a kinder thing to offer than a softened section they were
never warned about.

**The bands are descriptions, not grades:** `steady`, `mixed`, `under strain`, `not enough evidence`.
Deliberately not a red/amber/green ramp and deliberately not good/bad, because "under strain"
describes a rhythm where "poor" would be a verdict on a life. `not enough evidence` is load-bearing
rather than a formality — the six are evidenced very unevenly. Hour-of-day and day-of-week histograms
are complete, so the rhythm half of `rhythmAndActivity` almost always has something real; the activity
half of the same dimension rests entirely on whether somebody happened to post about exercise, and
plenty of active people never do. `lifeTrajectory` needs years to say anything at all, and on a thin
or recent export it is often genuinely unreadable — saying so beats narrating an arc out of a handful
of months. It is
styled as the most neutral of the four rather than the worst, so "we could not tell" does not read as
"you scored badly", and the mock puts it on physical activity in every run so that path is always
exercised.

The hard limits get their own subsection in `PREMIUM_SYSTEM` and ten individually-pinned checks,
because the failure mode here is not one bad edit — it is accretion, where each addition looks
reasonable and three releases later the section is a screening tool nobody decided to build. No
condition may be named or implied; no health score under any label; posting timestamps are **not a
sleep record** (somebody active at 3am reached for their phone at 3am); nothing about anyone's body,
and an absence of exercise posts is silence rather than a finding; no mood read off the writing. Where
something genuinely looks heavier than a behavioural pattern the model is told to say it is worth
raising with someone qualified to actually assess it, in those words, and stop — not counsel, not
reassure, not work out what it is.

The caveat is **fixed app copy** (`wellnessCaveat` in `docs/copy.js`), not a schema field — the same
choice the roast's caveat makes, in the section with the most reason to make it. It says what the
section is not, names a GP as the person who can actually assess what this cannot, and is worded
identically on every run rather than left to a field the model could soften or forget. It prints with
the PDF too, since that is the copy that gets kept and forwarded.

Cost: about **+$0.012** on a free report — roughly 3,900 extra tokens of prompt and schema, plus the
output to write it. The career coaching section added about 1,300 more on top (net of "where you
would thrive" coming out), so the fixed reserve now stands at 19,700 tokens against 14,300 before
either section existed. Every token reserved for the prompt is one the digest cannot spend, which cost
the character ceiling about 19,000 characters in total. Real accounts are unaffected — the per-source
caps bind long before the ceiling does — but chasing where those 19,000 characters showed up is what
uncovered the second, unreachable budget and led to [collapsing it](#one-budget-not-two).

### Attachment style

Its own section now, between the wellness read and the career one. It spent most of this app's life
as a callout inside "In relationships", competing with the love languages inside a card that already
carried strengths and weaknesses — and it is the single most-quoted finding in the report, so it was
the wrong thing to bury. The schema moved with it: `attachment` is top-level rather than nested under
`relationship`, because a section rendered three cards away from the object it hangs off is a trap for
whoever edits this next. The renderers fall back to the old location so a report stored before the
move still shows it.

The card's own `attachment` and `attachmentWhy` fields are a separate, compressed thing and were not
touched — those are what travels in the compatibility link, and a check asserts they survived the move.

### Career assessment

A second career section, after the attachment read: **"At work" describes, "Career assessment"
advises.** The first says how this person works; the second is a coach deciding what they should do
about it. Two career headings in one report only earn their place if the second is actionable, so the
prompt says at length that they must not say the same thing twice — if a sentence would sit
comfortably in `career.workStyle`, it belongs there instead — and a check pins that instruction.

It carries `situation`, an evidenced `edge`, what is `underused`, what is `holdingBack`, and
`actions`. The edge is the centre of it: the thing they do reliably that most people do not, stated
as an advantage rather than a compliment, with real counts behind it. The test in the prompt is that
an edge which would fit any organised, agreeable or hard-working person is not an edge.

**Actions carry a horizon** — `this week`, `this quarter`, `this year` — and at least one must be
startable now. An answer with nothing in it before next quarter is a wish list, so the page groups by
horizon with "this week" first and the PDF orders them the same way. The prompt asks for the first
move rather than the ambition: *"ask your manager which of the three projects counts at review"*
beats *"increase your visibility"*.

**The evidence here is the thinnest in the report and the prompt is blunt about it.** An Instagram
export contains no CV, no job history, no title, no employer, no salary and no performance review.
That is enough to find an edge and name a pattern that is costing somebody; it is nowhere near enough
to state what job they hold. The who-is-this-about rule bites hardest here — somebody who photographs
founders at a demo night is the person who was in the room — and reading a borrowed biography as a
career is named in the prompt as the single most damaging error available in the section, because
unlike a wrong trait score it reads as a confident statement of fact about a life they do not have.

**"Where you would thrive" was removed** from "At work" in the same pass. It listed ideal
environments inferred from an export with no job history, and it was advice sitting in a section that
is meant to describe. It is gone from the schema, both renderers and the fixtures, and the prompt
forbids folding it back into `workStyle` or `watchOuts` — checked as an absence in the schema and as a
ban in the prompt, since that is the shape this would come back in.

### The psyche card

The report opens with the whole of itself on one card, above the writing. It is real elements rather
than a rendered image — crisp at any size, readable to a screen reader, and built from the same
`report` object the sections below render, so the two cannot drift apart. Clicking it opens it full
screen.

**It is laid out at one fixed width and then scaled, rather than reflowed.** A card that reflows fits
every screen and looks composed on none, and the requirement here is the opposite: one screen, no
scrolling, on a phone and on a laptop alike. Fixed geometry plus a scale factor gives that on both,
and leaves a single layout to reason about. The *height* is measured rather than fixed, because a
real report's titles run longer than any number typed into the source would allow for — the first
version of this carried a hardcoded 1320px and silently clipped its own last row on the test fixture,
which is exactly the failure a fixed height produces.

Two adjustments earn their keep. On a screen much taller than it is wide the paired rows stack, which
makes the card taller and narrower — closer to the shape of the phone it has to land on, so the same
content is drawn larger. Padding tightens in the same mode, since the card is height-bound there and
every pixel of padding comes back as scale. The love-language pair is the one exception to the
stacking: giving and receiving are read *against* each other, and stacking them loses the comparison
the row exists to make. The inline preview is capped at 460px tall, because left width-led it filled
the column and pushed "Who you are" a screen and a half down the page — the opposite of what a summary
above the report is for.

**What is on it was cut back to make room for the rest.** The strength and weakness lists for
relationships and work came off, which bought the space for four to six lines of the report's own
opening — the card previously carried the two-sentence version written for the QR payload, which was
a strapline rather than a summary. Every block gained a glyph, love languages reuse the same five
already mapped in `copy.js`, and the type sizes went up a step throughout. Together those took the
laptop from 13px body text to 16px and the phone from 10px to 12px, with the card still landing whole
on both.

The MBTI block shows the four letters with their slight/moderate/clear leans and no longer prints the
code above them, since the row already spells it and says how firmly each letter was picked.

Two overflow bugs surfaced only under measurement, and both are pinned now. "Agreeableness" is one
unbreakable word, and at the narrow card's column width it pushed its own score past the card edge
where the frame's `overflow: hidden` swallowed it — grid children do not shrink below min-content
unless told to. And the four strength words under the MBTI letters ran into the block beside them.
The full-screen check measures the right edge as well as the bottom, and a separate check compares
the letter row's `scrollWidth` against its `clientWidth`, because overflow *inside* a block is
invisible to a card-level measurement.

It sits in a section of its own — "Summary card" — above the writing, opened with an icon beside the
title the same way every other section on the page is (`sectionHead()`'s `.card-head` / `.card-icon`
pair). The section used to carry a bespoke `<h2>` with no icon at all, which was the one place on the
page breaking a rhythm the rest of it keeps.

**The box around it is sized to the card, not to the page.** Every other `.section-card` spans the full
container because its content — paragraphs, trait bars — actually wants that width. This one does not:
the inline preview is capped at `PREVIEW_MAX_H` and stops growing once it is tall enough, so on a
laptop the frame stalls out at roughly a third of the container's width while the box around it stayed
full width — a slab of empty white down each side, 199px of it either way on a 1440px screen. `width:
fit-content` with `margin: auto` makes the box hug whichever child is widest, ordinarily the frame, and
centres what is left. One box-sizing rule rather than a breakpoint: on a phone the frame already runs
close to the full slot width, so fit-content lands on essentially the box the old full-width rule
produced, and there was nothing there to guard with a media query.

Inside the card, headed by the lockup on the left and whose card it is on the right. The wordmark used
to sit alone at the foot, which named the product but not the person; on a card meant to be shown to
somebody else the name is the more useful half. The mark is the same path data the nav, the PDF and
the story images draw, so the logo is one shape in five places rather than a picture to keep in step.

**Full screen offers it as a PNG.** The card is DOM and the reader wants an image, so it is
rasterised through an SVG `<foreignObject>` — the one route a browser offers without shipping a
rendering library. Painted at twice the card's own size so it stands up to being posted, on an opaque
white ground because a PNG with alpha would go transparent where the corner radius rounds, which reads
as a hole in any viewer with a dark page.

The failure mode there is specific and quiet: the image loads, the canvas paints, and what comes out
is blank — so a check that the file exists proves nothing. The test reads the pixels back and counts
strongly purple ones, since the hero gradient guarantees thousands of them in a correct render and
none in a broken one. Stripping the stylesheet from the export fails it at `purple: 0`.

Getting there cost one wrong diagnosis worth recording. Inlining the whole of `styles.css` into the
SVG fails outright, and the obvious suspect — four `url(#hero-mark-gradient)` references to gradients
that live in `index.html` — is not the culprit. The file's *comments* mention `<linearGradient>` and
`<dialog>`, and raw CSS dropped into an XML `<style>` hands those to the parser as unclosed tags.
Reading `cssText` off the CSSOM sidesteps it for free, because the parser has already stripped every
comment.

**Download sits on the left, share on the right, each a rounded pill with an icon and a small label
beside it, with a real gap between the two.** The full-screen bar used to carry one button, centred,
with a visible label — "Download as image". A share button joined it, and the pair went through an
icon-only phase — two bare glyphs, no visible words — that read as unfinished rather than deliberate:
a button with nothing beside its icon does not look like a control so much as a stray symbol. Each now
carries a short visible label (`cardDownloadLabel`/`cardShareLabel`, "Download"/"Share") next to the
icon inside the same pill, plus a fuller `aria-label` (`cardDownload`/`cardShare`) for a screen reader,
which does not have to say the same thing as the short visible word. `docs/app.js` sets both the label
text and the aria-label from `docs/copy.js` at render time, the same as every other label in the app —
the icon glyphs themselves are the one exception, hardcoded in `index.html` directly, since they are
not language-dependent copy. The two buttons sit in a flex row with an explicit `gap` between them
rather than being spread to the edges of a shared container, so the space between them reads as
deliberate rather than as the pair having drifted apart on a wide screen. A shared status line under
the pair (`#card-dialog-status`) still carries a failure from either button, since the visible label is
a fixed word rather than a place an error could borrow.

Sharing reuses `cardImageBlob()` outright — the same rasterised PNG the download button already
built — wrapped in a `File`, and calls the Web Share API only where `navigator.canShare({ files })`
says a file can actually be shared: Safari and Chrome on a phone, not desktop Chrome or Firefox, where
it silently falls back to the same download instead. A share button that did nothing on the browsers
that cannot show a share sheet would be worse than one that hands over the file another way. Declining
the share sheet (`AbortError`) is treated as success, not a failure to fall back from — the reader
made a choice, not a mistake. Two checks cover both branches: the download fallback (`navigator.share`
is genuinely absent in headless Chromium) and, with `navigator.share`/`canShare` stubbed the way Stripe
is stubbed elsewhere in this suite, that the real call receives an actual PNG `File` rather than a
link or text. Fault-injecting the branch that decides between them — forcing the download fallback
even when Web Share is stubbed as available — reproduced the failure as a hard timeout waiting for the
stub to be called, rather than a clean assertion, which is itself the point: nothing else in the flow
can substitute for that branch actually running.

**The download button at the top of the page is gone**, leaving the one at the foot. Two buttons put
the exit before the thing being exited; somebody who has read the report is at the bottom of it.

**The paragraph carries three findings, not one**: the report's own opening, then one sentence on how
they are with people, then one on how they are at work — the first sentence of the strongest thing the
analysis found in each. They are quoted from `relationship.strengths` and `career.strengths` rather
than written again for the card, and a check reads both back out of the stored report, so the card
cannot start inventing sentences about a person it sits above. The summary's own share came down to
make room, which is why the card did not need to grow to fit them.

**The MBTI block is labelled MBTI and names the type under its letters** — "The Protagonist" is the
part a reader repeats, and the row above already spells the code out.

**The summary is whole sentences or nothing.** The first version cut to a character count and
appended an ellipsis when it could not find a sentence break, which put a visible "…" on the card and
left the reader with a thought that stops halfway — worst of all on a phone, where the narrow card
runs the text longest. It now falls back through the card's own two-sentence summary to the first
sentence of the report, and none of those paths can produce an ellipsis. The character's name and
icon came down a size to make the room, and down again on a narrow card, where the hero is the
tightest block and the name is the largest thing in it.

That freed enough height on a phone to make the card **narrower**, which is counter-intuitive but
correct: the card is width-bound there, so a narrower one is drawn *larger*. It could not go below
820px while the stats sat in three columns — four strength words will not fit a third of 700px — so
the column count gives way instead, two-up on narrow. Body text went 12.1px to 13.6px.

**The glance row is gone from the page, and now from the PDF too.** It repeated the MBTI type, the
highest and lowest traits a few centimetres under a card that already shows them. The PDF kept its own while it had no card in front of it; once page one became that card the
same reasoning applied there, and the strip, its renderer, `Copy.glanceItems` and its four labels all
went. A check asserts neither renderer builds one — the call *and* the thing it called, because a
renderer left behind with no caller is the kind of dead code that gets wired back up by accident.
The block of geometry checks that proved the strip's row height, bottom rule and column widths went
with it: 116 lines testing something that is no longer drawn.

**Three things are deliberately left off**, each for its own reason. The franchise ("Marvel", "Pixar")
goes because the comparison is to a character's temperament and naming the studio invites the reader
to check the costume instead. Attachment style goes because this is the most shareable surface in the
app and it is the most intimate line in the report. And no code of any kind is drawn on it:
compatibility travels person to person as a link. All three are pinned by a check, since "we removed it" is the
kind of claim that quietly stops being true.

**Every character has a scene instead of a medallion.** `docs/character-art.js`, generated by
`node tools/character-art.mjs`, holds a full drawing for the purple box for all 28 catalogue
characters (an ice palace under an aurora for Elsa, a tower with a golden braid falling from its
window for Rapunzel, a web over the night city for Spider-Man, a black dragon with a red tail fin for
Hiccup, a boot and spur for Woody, a binocular-eyed robot under a planet for WALL-E, a copper pot in a
kitchen for Remy, a red-and-gold robot flying on its thrusters for Iron Man, a panther under a purple
moon for Black Panther, a stump house in the swamp for Shrek…). The generator shares one frame —
bright centrepiece upper right, dark ground along the bottom, faded in from the left — and building
blocks (tint, glow, skyline, stars, scatter), and a self-test holds every scene to resolving only its
own ids. Mulan's was the first: a glowing moon, a jian with its red tassel
cutting across it, plum blossom, falling petals, and mountains with a pagoda. It is drawn from the
symbols of the story rather than the character's likeness, which belongs to the studio. It fills the
right 68% of the box and bleeds off it, fading in from the left so the name, headline and blurb sit
over its quiet side and the dark mountains. The fade is a CSS mask on the `.pc-art` element, not
only a mask inside the drawing: a tall box (a long blurb) scales the scene up and crops its left side
away, and a fade drawn there went with it, leaving a hard seam. Ground bands run off the left of
every scene for the same reason; the medallion is dropped for that character, the name is
set larger, and the box no longer shrinks to fit (`flex-shrink: 0`), so the card scales instead of
clipping the blurb. A name outside the catalogue keeps the emblem medallion. The scene finds its gradients
by id, and the same card markup goes into the page and its full-screen copy, so each inserted copy
gets ids of its own (`freshArtIds`): a shared id can resolve to the copy in a closed dialog and draw
the art blank. A check holds every gradient reference to an id that exists once.

**Seven scenes redrawn to keep to that rule** (October 2026). A review found seven that drew the
character itself or an emblem its owner protects as a mark, and those carry more risk than naming the
character does. They now draw the story's things, in the character's own colours:

| Character | Was | Now |
|---|---|---|
| Baymax | Baymax | A white pillow-heart with a red first-aid badge over the bridge and city. The cross is white on red: a red cross on white is the Red Cross's protected emblem. |
| WALL-E | the robot | A seedling in an old boot on a pyramid of rust-yellow crushed cubes, under a cloud-swirled blue Earth with no land drawn, kept clear of the plant |
| Iron Man | the suit | A glowing reactor ring in a gold rim with a pale-gold burst, red and gold trails rising from the city, and red and orange trails swooping round the ring. Rays were tried and dropped as too busy. |
| Captain America | the shield | A white star through red-and-white stripes, red and blue sparks bursting from it |
| Pikachu | a Poké Ball | A thunderbolt striking into a floodlit stadium on a meadow, a generic arena rather than any game's own building |
| Totoro | Totoro | A rainy bus stop under a camphor tree, a red and a grey umbrella open, and a great leaf held up like a third, with acorns and fireflies |
| Kuromi | her skull face | The same bat-winged black heart holding a pink heart with a crescent |

The cast strip is redrawn with them (`node tools/cast-sprite.mjs`).

**Woody's round tile has its own crop.** Round tiles show the same upper-right square of every scene, but
Woody's boot stands on the ground below it, so the tile showed only its shaft. `ART_CROPS` in copy.js
gives Woody a lower, slightly larger square; the full card is unchanged.

**No studio on the card** (October 2026). "Marvel", "Disney", "Pixar" and the rest no longer print under
the character's name on the Psyche Card, on screen, in its image or on the PDF's card and story cover. The
card is the image people post, and a studio's name beside its character there reads as co-branding. The
report itself still names the studio beside the character, and the character pages keep their
not-affiliated line.

**No studio anywhere, and Mulan pinned to the legend** (20 October 2026). The studio is now gone from the
report and its PDF too, and from the search pages: each character page's fine print says only that
characters belong to their owners, and /characters is one alphabetical list instead of studio headings.
The model's schema still carries `essence.franchise` (it tells two same-named characters apart), but
nothing shows it. The sample — the card, the report, the og image and the promo card, i.e. the face of
the marketing — carries `essence.source: "The Ballad of Mulan"` instead, printed where the studio was
(`.pc-ssource` on the card, `.essence-source` in the report, capitals in the PDF). That frames its
Mulan as the public-domain legend, whose art here is our own. Real reports never get a source: the
schema has no such field. The og image is `?v=3`. The promo videos still show the old card until
`npm run promo` is re-run with its cache.

**Five public-domain faces for the marketing** (21 October 2026). The samples, the link preview and the
search pages now show only characters from public-domain stories, so no studio's character is in
anything we advertise with.
- **Three swaps in the catalogue, same slots:** Woody → **Dr Watson**, Iron Man → **Odysseus**,
  Batman → **Sherlock Holmes** (12 women, 12 men, 4 neither, as before). The three join the retired
  list, so old cards still draw them, and their pages 301 to their replacements'.
- **The samples:** Mulan (the full sample) and a gallery of four, Odysseus (second, after Mulan),
  Rapunzel, Sherlock Holmes and Dr Watson, each with `essence.source` (Grimm's Fairy Tales, Arthur Conan Doyle, Homer's Odyssey)
  where the studio used to be. The five sync with each other wherever they can (five cannot all pair
  off three ways, so Rapunzel's third is Remy); every other pairing stays mutual and balanced.
- **Rapunzel redrawn** from the Grimm tale: moon, braid and rampion, without the floating lanterns,
  which are the 2010 film's. New scenes: Sherlock Holmes (a glass over footprints in the fog),
  Dr Watson (a doctor's bag and casebook under a lit window), Odysseus (*Odyssey* book 9: the ship,
  with the eye Greek sailors painted on the bow, running from the Cyclops in a storm).
- **Pages for the five only.** The other 23 catalogue characters' pages are gone and their addresses
  301 to /characters, which lists the five and says how many more there are (`MARKETED` in
  `tools/seo/characters.mjs`). The catalogue itself is unchanged: readers can still get any of 28.
- **Eight scenes redrawn without the studio's signature design** (`tools/art/`): Hello Kitty (a
  teapot, not the bow), Kuromi (a gothic chapel, iron fence, bats and a black cat, not the winged
  skull-heart), Sailor Moon (a pastel crescent and a cat on a roof, not the brooch), Joy (a bubble
  shooter, not memory-orb shelves), Wonder Woman (a sapphire in the tiara, not the red star), Hiccup
  (a soaring dragon with no red fin or green eyes), Simba (a grown lion at a savanna sunrise, not
  Pride Rock) and Shrek (a treehouse in a forest, not the stump house in a swamp). New emblems for
  five of them.
- **A reserve for a takedown letter:** public-domain replacements drawn in advance, scenes and
  emblems, in `tools/reserve/art-*.mjs` (built to `tools/reserve/character-art-reserve.js`, never
  served): Joan of Arc, Athena, Belle, Alice, Cinderella, Dorothy, Snow White, Goldilocks, Heidi,
  King Arthur, Hercules, Aladdin, Robin Hood, Merlin, The Beast, Sun Wukong, Sinbad, the Tortoise and
  the Ant. `node tools/reserve/preview.mjs --reserve out.png` draws them as the card does.
- **Six medium-risk scenes touched up, same palette and idea:** Moana's sail carries a frigatebird
  and stars, not Te Fiti's spiral; Princess Peach's crown is peach blossom, not the jewelled one;
  WALL-E's seedling is in a clay pot on wooden crates, not a boot on rubbish cubes; Judy Hopps is a
  plain rabbit (emblem: a rabbit, not a police badge) before one ordinary skyline; Hermione's
  candles are fireflies and the castle a domed library; Hulk's blast is amber-gold, not green.
- **Every studio character has a backup:** 23 in all, with the Tin Man, the Gingerbread Man, Gretel
  and Atlas added. `tools/reserve/slots.json` says which backup takes which slot (the Beast is
  Shrek's, Atlas is Hulk's).
- **The promo videos** were rebuilt (`npm run promo`): the card shows the Ballad of Mulan, and Psyche
  Sync pairs Mulan with a fellow sample character rather than Baymax.
- **Odysseus is the Trojan Horse** (`tools/art/odysseus.mjs`): his own plan, a muscular wooden war-horse
  towering over Troy's walls at sunset, the sea and the Greek fleet behind, in place of the storm with
  the Cyclops, whose round tile showed no ship. Emblem: a horse on wheels.
- **The promo, rebuilt again:** the card's MBTI and Big Five light as one box, "Type & Traits", said
  as one phrase ("your type and traits"); every highlight's tag now sits fully above its outline;
  Psyche Sync pairs Mulan with Odysseus; the end card's carousel rolls a run of the whole cast again
  (the cast is never named in the video); and the end card (about 50 s) is the original ending, the
  drop's groove after the swoosh and hit, made to land as a contrast with the quiet privacy break: the
  music swells three quarters louder within a third of a second of the hit and dips less under the
  closing line, and the bell melody leads, with a soft octave above it (`swell_in` and `lead` in
  `promo/audio.py`). Tried and dropped: a lift up a tone with sixteenths; offbeat hats and ghost
  claps; whooshes under the spinning carousel. Each stood apart from the rest of the track.
  The pulse in the animation and the kick share one 118 BPM grid from 0 s, every scene cut lands on
  it, and the encoded audio lines up with the mix to the sample.

**The five, final (21 October 2026).** The marketing five are now Mulan, Odysseus, Rapunzel, Sherlock
Holmes and The Tin Man, in that order in the gallery (Odysseus second).
- **The Tin Man replaces WALL-E** in the catalogue (the four neither stay four); WALL-E is retired and its
  page 301s to his. He is drawn as a figure, from W. W. Denslow's 1900 illustrations for Baum's book,
  which are public domain (funnel cap, riveted tin), never MGM's 1939 film look, which Warner Bros.
  still enforces. Sample: Maya Ibrahim, source "The Wonderful Wizard of Oz".
- **Dr Watson leaves the samples** and loses his page (it and Woody's old address go to /characters);
  he stays in the catalogue.
- **Two sets of pairings.** A real card's three most in sync are `CHARACTER_SYNCS`: the original table,
  with each public-domain heir taking over its predecessor's pairings as they were (Woody's to Dr
  Watson, Iron Man's to Odysseus, Batman's to Sherlock Holmes, WALL-E's to The Tin Man), so a real Mulan
  card shows Baymax, Po and Hermione Granger. The samples and the five search pages show
  `MARKETING_SYNCS` instead, the five naming each other: each sample carries its three as
  `sampleSyncs`, which `cardSyncs()` in `docs/copy.js` prefers; the model's schema has no such field.
- **Redrawn, epic** (`tools/art/`): Mulan as the Ballad's lone rider galloping before the moon, a
  faceless silhouette with spear and red pennant, plum blossom and the Great Wall (no Disney cues; a
  drawn face and armour would invite the comparison); Rapunzel's tower with a three-strand braid woven
  with flowers; Sherlock Holmes's London night with the clock tower and a brass glass over footprints;
  Dr Watson's study by lamplight. `tools/character-art-mulan.txt` is gone: every scene is built.

**Instagram, so a share can tag us (21 October 2026).**
- Every footer (front page, search pages, policies, 404) links Instagram @psycheai.io beside the email,
  and the front page's Organization data lists it in `sameAs`.
- The card image's foot line reads "psycheai.io · tag us @psycheai.io" (`cardFooter`); on a reader's own
  card it sits under the QR code instead. Samples carry no QR: it is the reader's own link.
- Share card's message is now "My Psyche Card from @psycheai.io. I got Mulan. Get yours here: [link]"
  (`cardShareText`). Instagram keeps a shared image but drops its text, so the tap also copies the
  caption and says so ("Caption copied. Paste it into your post to tag @psycheai.io.").
- The link's credit note: "1 card made = 1 credit = 5 questions or 1 report to gift".
- The card's signature is set out rather than in small capitals (`cardSignHtml()`): **psycheai.io** in
  ink, a dot, "Tag us" and **@psycheai.io** in the accent, about 40% larger.
- Five emblems now match their scenes and drop a studio's mark: Mulan a spear with pennant and blossom
  (was a sword), Simba a savanna sunrise with an acacia (was a crown), Hiccup a dragon's wing (was a
  flame), Wonder Woman a laurel wreath (was her lasso), Captain America a plain star (was his shield).

### Let us roast you

Everything above it is written to be fair. This one is a roast — accurate without being kind: the
least charitable reading the evidence still supports, and the advice a friend gives when they have
stopped managing your feelings. It sits below the behaviour read and above confidence, so the reader
meets every fair section first and the confidence caveat still gets the last word over all of it. A
small "Premium" badge sits beside the title — the same badge every paid section carries (see
["The US$5 unlock"](#the-us5-unlock-four-sections-behind-one-paywall)), spliced onto the
already-escaped title text rather than a second heading competing with the one next to it.

**It used to run free, in the same call as the rest of the report — it does not any more.** `harsh`
and `advice` moved out of `PROFILE_SCHEMA`/`PROFILE_SYSTEM` entirely and into `PREMIUM_SCHEMA`/
`PREMIUM_SYSTEM`, the paid, Claude-only call described in ["The US$5 unlock"](#the-us5-unlock-four-sections-behind-one-paywall)
above. The prompt instructions below carried over essentially unchanged; only the reader's
relationship to them changed — one US$5 unlock (or one promo code) now buys the roast, rather than it
opening for free on a click. `PREMIUM_SCHEMA` briefly carried two more fields, `patternsWorthAttention`
and `lifeAdvice`, behind this same unlock, for a second paid section ("Supplementary analysis") sold
alongside the roast; that section was cut, so this call is the roast and nothing else again. One
casualty of the original move, which survived the cut: this call receives no photographs (only the
digest), so the old instruction for the roast to spend a sentence on a photograph when one gave it
something worth saying is gone along with the images themselves — `summary`, in the free report, is
now the only field in either call that reasons about pictures at all.

The register is stated in the prompt rather than left for the model to infer from "unkind", because
the page calls it a roast on the cover and the two would otherwise drift apart. What the prompt is
careful about is the half that makes a roast work: **it is a licence to drop the softening, not a
licence to make things up.** The form depends on the target recognising themselves, so the funniest
line available is nearly always the specific one — the count, the caption written four times, the
gap between what somebody announces and what they do. Generic insults are not roasting; they read
as a machine that did not actually look, and two checks hold that reasoning in the prompt rather
than trusting it to survive the next edit.

**The sharper failure is not the invented insult but the hollow one**, and it took a real report to
surface it: *"you preach the gospel of self-driving cars and an autonomous future, yet half your
stories are screenshots of news articles posted at 1am from your room."* Both halves are true. Neither
touches the other — expecting a technology to arrive is not a promise to be asleep, or outdoors, or
anywhere at all — so the sentence has the shape of a roast and none of the substance. It is what a
model produces when it pattern-matches the rhetoric of wit without checking that the second clause
costs the first anything, and a section full of it reads as a compilation of odd details rather than
a reading of a person.

The prompt now makes that a test rather than a hope. Before writing any line of the form *X, yet Y*
the model has to state in one plain sentence what commitment X makes and what exactly Y costs it; if
it cannot, it has two facts standing next to each other and is told to cut the line and either find
the behaviour that genuinely undercuts the claim or make the point about X alone. Both halves must
bear on the same commitment, posting rhythm is explicitly barred as evidence about whether opinions
are sincere — it is evidence about habits — and two observations that can be defended are ranked
above six that cannot. Nine checks pin it, and the worked example is pinned separately from the rule,
because the rule without a concrete instance of it being broken is the part that historically fails
to change anything.

A third reading, **Where this ends up** — the five-year behavioural forecast — was cut along with
the behaviour section's subsections, back when this still lived in the free report. The no-diagnosis
rule did not go with it: `harsh` and `advice` can drift into a clinical claim just as easily, and the
forecast happened to be the field carrying the longest statement of the ban, so the checks now read
it off the hard limits instead.

**It is not a diagnosis, and cannot become one.** The obvious question — *what is wrong with me* —
is the one thing this section may not answer. A model naming a condition from posting patterns is
inventing a clinical claim it has no standing to make, in a document people export to PDF and show
to other people, and the landing page says in as many words that this is not a clinical or
diagnostic tool. The ban is stated once in `PREMIUM_SYSTEM`'s hard limits — restated in full rather
than assumed to carry over from `PROFILE_SYSTEM`, since this is its own system prompt on its own call
— and it holds *however directly the reader framed what they wanted*, which is stated because the
framing was, literally, requested as "what mental illness or disorders to look out for" and declined
for this exact reason — see
["What the paid section actually asks the model for, and what it refused to"](#what-the-paid-section-actually-asks-the-model-for-and-what-it-refused-to)
above.

**The cover is a real gate, not a blur**, and it now works as a payment or promo-code gate rather than
a plain "show me anyway" click. The writing is not in the document until a real result actually
arrives from the server. Blurring it in CSS would look identical and protect nothing — select-all
copies it, a screen reader announces it, view-source hands it over — so `bonusBlock()` ships the cover
alone and `revealRoast()` fills the card's body from the paid call's result, once it actually succeeds.
A UI check asserts the mock's own wording is absent from the card's `innerHTML` before that.

**The PDF carries it if and only if it was paid for.** It used to be excluded outright, as the one
place the PDF was not a faithful rendering of the page: a PDF has no cover to open, so printing the
section unconditionally would have put the harshest writing in the report into a file that gets
reopened cold and forwarded, including by a reader who never pressed the button. Gating on the
unlock answers that directly — the only way a paid section reaches the file is that somebody paid US$5
or entered a promo code to see this exact writing, and a paid section belongs to whoever paid for
it. What the gate cannot govern is where the file goes next, which is why the caveat now prints
*with* the section rather than being left on screen: the PDF is the copy that gets kept and
forwarded, so it is the copy that most needs to say what the writing is.

### The rule for any paywalled section

The mechanism is deliberately a table rather than an `if` per section, so that "paid sections are
absent unless unlocked" is one rule in two places rather than a convention each new section has to
remember:

- **`PAID_SECTIONS` in `docs/pdf.js`** — one entry per paywalled section, `{ key, render }`. `build()`
  walks it once, printing a section only when `meta.unlocked` carries its key.
- **`unlockedSections()` in `docs/app.js`** — the single place the app decides what has been bought,
  keyed by the same names. `paidAnalysis()`, which the page renders from, is routed through it too,
  so the page and the downloaded file answer "is this unlocked?" from the same line of code and
  cannot drift apart.

There is no `paid` boolean anywhere. The presence of the paid content **is** the unlock, on the page
and in the PDF alike — a boolean would be a second thing to keep in step with the content, and a
stale one would either hide something bought or print something that was not. Paid content is also
read from `meta` rather than off the report object on purpose: a paid section pulled from
`source.<field>` would print for anyone whose stored profile happened to contain it.

Both directions are checked and both were fault-injected. With the roast unlocked it is held to the
same parity and ordering rules as every free section — the page/PDF walk no longer exempts it, it
just strips the `Premium` badge from the heading before comparing (the PDF has no badge on any
section) — and its heading, both
subheadings, the caveat and a phrase from the writing itself all have to be in the file, since a
renderer could lay down the headings and drop the prose. The same report built with nothing unlocked
must contain none of it, while still containing everything else. Injecting "never unlock" fails the
first three; injecting "render regardless of the gate" fails the fourth.

One subtlety worth recording, because getting it wrong would have produced a *false* pass: the
typesetter draws one `(...) Tj` per wrapped line, so a sentence is nowhere contiguous in the file —
`not an assessment, not a diagnosis` straddles a line break. Anything longer than a heading is
matched against the drawn strings joined back into prose. Against the raw bytes it would fail on
wrapping alone and read as missing content, which is precisely the wrong answer for a check about a
paywall.

## Downloading the report

**Download full report** at the top and bottom of the profile writes a PDF and downloads it, and
**Download report** does the same for a comparison. No library: `docs/pdf.js` emits the file itself,
which for a text report means page objects, content streams, and the base-14 fonts every viewer
already has. It is about 600 lines and no bytes of
dependency — `html2canvas` and friends would rasterise the same words into a fuzzy image and cost
200KB, and the text here stays real text that a reader can select, search and copy.

`build()` and `buildCompatibility()` are two documents over one writer. They share the page
furniture — the coloured cover band, the brand lockup, the running head, the bars, the bulleted
lists, the evidence chips, the page numbering — and differ only in what they lay out and what the
cover says: a person and a confidence figure for one, a pair and a score for the other. The
comparison runs section for section with the report page and in the same order, and its headings
come from `docs/copy.js` for exactly the reason the profile's do — two renderings of one document
drift the moment the strings are typed twice, and a UI check fails if either renderer re-types one.
On a work run the playbook heading and the cover subtitle both carry the stance, so a manager's
download does not arrive titled "How to work with each other".

The subtitle slot under the cover title is used on a comparison and deliberately left empty on a
profile. The comparison's says what basis was chosen, which the reader picked themselves and needs
to see. The profile's used to print the card's one-line headline, and that read as a verdict handed
down before any of the evidence for it — "High-energy tech investor, macro thinker, and social
catalyst" set in italics under someone's own name. A check fails if a headline reappears there, and
another fails if the title itself goes missing, since "no headline" would otherwise also pass with
the whole block deleted.

### Page one is the summary card

Removing that headline left the band with the title at the top and 70pt of empty purple under it, and
then the report's first section heading immediately below — a paid document opening on dead space.
Page one is now a real cover carrying the **psyche card**, the same object the reader sees on screen:
the character and franchise over the four-sentence blurb, then the MBTI code with its per-axis
strengths, the five trait scores, the values/beliefs/interests row and
the giving/receiving pair. It is the one thing in this product people actually share, and the only
page of a nine-page PDF anybody would screenshot rather than read, so it is what the document should
open on. The report proper starts on page two, under the running head.

**The card is paper, and the band keeps the colour.** It did not start that way: the card was an
accent-filled panel with the same magenta wedge across its foot that the masthead above it has.
Stacked, the two read as one continuous block of purple with the page title floating in it, and the
card — the thing worth looking at — had no identity of its own. Contrast now does the work the
repetition was undoing: a saturated masthead, then a light panel lifted off the page beneath it on
three points of tinted offset, which is the whole of the shadow this writer can draw. The accent
survives as detailing rather than as a fill — a five-point rule across the top, the character's name
set in it, the confidence figure in a pale pill, the eyebrow in the second brand colour — and the
wedge stays the masthead's alone.

Two checks pin it, both on the drawn output rather than on the source. `Doc.draw` emits a fill colour
immediately before each text run, so the last `rg` before the character name's `Tj` *is* its colour:
the accent triple passes, the `1 1 1` it used to be reversed out in fails. And the wedge is a single
filled path ending `l f`, so exactly one of those on the cover means the motif belongs to the band
and the card is not copying it.

Worth recording that the redesign broke something silently: the taller card pushed the contents list
past the guard that only draws it when it fits above the colophon, and it stopped appearing at all.
The existing checks caught that — but only after the render did, which is the order it should have
happened in. The gap between card and list came down from 32pt to 24.

The card's blurb is `report.cardHighlights`, the same field the on-screen card uses. `cardBlurb()` in
`app.js` has two further fallbacks for reports written before that field existed, but both stitch
text out of fields this file would have to re-derive; `card.summary` is the shaped card's own line
and is never empty, so it is the single fallback kept here.

**The contents list is a record, not a table.** It sits under the card and is built from the sections
that actually printed — `sectionTitle` appends its own title and page number as each one lays out —
so it cannot promise a paid section the reader did not buy, or miss one added later. That means it
can only be drawn once the whole document exists, which is also the only moment its page numbers are
known; it reaches back onto page one by pointing the writer's op buffer at page one's own array for
the duration, since `Doc.op` appends to `this.buffer` and nothing caches it. Two columns past six
entries: a full report runs to a dozen sections, one column of those is taller than the space the
card leaves, and the first version simply never drew because its own fits-on-the-page guard was
declining every time.

**One widow fixed, and one check deleted for being unfalsifiable.** `sectionTitle` reserved enough
room for a title, its rule and its sub-line — which is what stranded "Big Five" and its "0–100, where
50 is an average person" at the foot of a page with the first trait overleaf. The reserve now covers
the first content block too. A check was written for it and then removed: with the sample fixture the
widow cannot be reproduced at all any more, because adding the cover shifted the pagination out of
the case. Dropping the reserve back to its old 130, and then to 46, still left real content under the
last heading on every page. A check that passes against the bug it was written for is not coverage —
it would have claimed the reserve was protected while nothing protected it — so the fix stands on the
before/after renders and a comment stands where the check would have been.

The suite clicks the real button, keeps the file the browser saved, and greps the drawn text out of
it — streams are uncompressed partly so it can. That is what proves the document exists rather than
that a function returned a Blob.

This replaced `window.print()`. Print-to-PDF was free and the print CSS was good, but the output was
never the user's: page size, margins, whether backgrounds were included and the browser's own header
and footer all belonged to the dialog, and on mobile there is often no *Save as PDF* destination at
all. Typesetting it directly makes the download one click and identical everywhere.

What the writer has to provide, it provides:

**Metrics.** Wrapping is impossible without character widths, so Adobe's Helvetica and
Helvetica-Bold widths are embedded. Asking canvas to measure would be wrong — the viewer renders with
its own Helvetica, not whatever the page substituted.

**An encoding.** Strings are written in WinAnsi, which covers the accents and curly quotes the model
produces. Characters with no slot are handled rather than lost: accents fall back to the bare letter,
arrows to `->`, and emoji are dropped instead of drawn as a black box — which is why the essence icon
is not in the PDF, though the character's name and franchise are. The franchise sits beside the last
line of the name, or on its own line when it would not fit: a name whose last line nearly fills the
column pushed it past the right margin, measured at 48pt over for "Nick Wilde and Judy Hopps of
Zootopia".

**A layout.** The report is the profile page, section for section, in the same order: a letterhead,
then *Who you are* (the character, the headline findings strip, the summary), *Big Five*, *MBTI*,
*Interests*, *Values & Beliefs*, *In relationships*, *At work*, *Your Instagram
behaviour*, *Your matches* when this device has any, and *How much to trust this*.
Running head and page numbers on every page — the head carries the orbit mark and the word
*PsycheAI* beside it, the same lockup the nav and the cover use, because a page pulled out of the
stapled set on its own showed a logo and no name for it. The mark is stroked from the same path data
`index.html` draws, which means converting the
mark's elliptical arcs to béziers because PDF has no arc operator. Only the corner of the SVG path
grammar the mark uses is implemented; a general SVG renderer is not the job. The screen's cards become rules and whitespace, and its
emoji section glyphs are dropped, but nothing is added and nothing is left out.

Alignment is structural rather than a promise, because the first version was not aligned: it renamed
half the sections, split values from beliefs where the page groups them, said "Neuroticism" where the
page says "Emotional sensitivity", and ran the sections in a different order. Every string and label
both renderings show — section titles, sub-lines, column headings, empty-state wording, the trait
labels, the MBTI poles, the behaviour facets, the compatibility bases — now lives once in
`docs/copy.js`, which the page and the PDF both read. Three checks hold the line: each section title
is defined in `copy.js`, neither renderer re-types one, and the test reads the section headings off
the live page and requires the PDF to carry all of them, worded identically and in the same order.

Streams are written uncompressed. It costs about 30KB on a seven-page report and makes the output
greppable, which is how the suite checks that a section is really in the file rather than trusting it
was drawn. It also means the drawn geometry can be read back out, which is how the
findings strip is tested: it is a grid, and its row height has to be *measured* rather than assumed —
"Openness to experience" and "Leans Anxious-Preoccupied" both wrap in a quarter-width column, and a
fixed row height pushed the notes beneath them straight through the strip's bottom rule. The checks
pull the rules and the text baselines out of the page stream and assert nothing crosses a rule, no
cell is wider than its column, and every value appears in full — because the tempting fix for a
two-line value is to render one line of it, which loses half the finding without leaving a mark. Each
of those three faults was reintroduced to confirm its check fails. The tests download the actual file, assert it is a well-formed PDF whose cross-reference
table points inside itself, and rebuild the report from a deliberately wordy profile, an almost empty
one and `{}` — the wordy one caught two overflows, an unwrapped point title and a right-aligned label
measured without its letter-spacing.

Ctrl+P still works, and `@media print` in `styles.css` still shapes it: a letterhead, since the nav
bar is dropped, backgrounds nothing depends on, breaks between items rather than through them, and
one type size throughout. Those rules keep their own UI checks.

### The card's blurb is written for the card, not skimmed off the report

The four to six lines under the character on the psyche card used to be assembled at *read* time, in
`docs/app.js`, by taking the opening two sentences of `report.summary` verbatim and appending one
sentence read off `relationship.strengths` and one off `career.strengths`. That produced an excerpt
rather than a summary — whichever sentence happened to come first in each of three unrelated fields,
however well or badly it read stitched to the next, with the card's own paragraph on relationships and
career left out entirely because the code stopped at `summary`'s opening two sentences on purpose.

`cardHighlights` in `PROFILE_SCHEMA` (`lib/prompts.js`) asks the model to do this instead, immediately
after it writes `summary` itself: **exactly four sentences — the first condensing `essence.why`, the
next two condensing `summary`'s first paragraph, the fourth condensing its second** — real
summarizing, in the model's own words, never sentences lifted verbatim out of either source. If
`summary` runs to a third paragraph, as it sometimes does, that paragraph is not covered — the card
stays roughly the length the old stitched version was.

**The first sentence is given to the character rather than to more of `summary`,** because the card
prints the character's name in its largest type and then never justifies it. The reasoning lives in
the report's own essence section, which is precisely what somebody handed the card is not reading —
so the card's single most prominent claim was the one thing on it with no support at all. That
sentence is a swap, not an addition: `summary`'s second paragraph dropped from two sentences of
coverage to one, and the card stays four sentences long because being short enough to take in at a
glance is the whole of what it is for.

The schema also tells the model not to spend that sentence restating the name or announcing the
comparison — "You are like X" — since the name is printed directly above the paragraph and the reader
has already read it. It should open on the shared trait. Both halves are checked: the selftest pins
the instruction's wording in the schema, and the UI suite checks the sample fixture's blurb actually
opens on the character rationale *and* does not lead with the character's name. Those two are
asserted against `docs/sample.json` rather than the mock, because the mock's copy is deliberate filler
("sentence one", "sentence two") that could satisfy a wording test by accident — `sample.json` is the
one fixture written as a real report.

`cardBlurb()` in `docs/app.js` now reads `cardHighlights` directly, and falls back to the old
stitching logic only for a report saved before this field existed — a real path, not a defensive
guess: `tools/uitest.mjs` proves it by seeding an isolated page with a `cardHighlights`-free profile
(a copy of `docs/sample.json` with the field deleted) and confirming the card still shows the old
excerpt rather than nothing. That check needs its own page rather than a reload of the suite's shared
one, the same reason the card's `confirmCardPayment` fallback check a little further down does — a
reload wipes `window.__titles` and the other in-page state the shared page has been accumulating
since the very first upload this run made, and `browser.newPage()` gets its own `localStorage`
without touching any of it.

Bumped `FIXED_INPUT_TOKENS` in `docs/digest.js` from 16,600 to 16,800 alongside this: the new field's
prompt guidance grew `PROFILE_SYSTEM` + `PROFILE_SCHEMA` to roughly 16,584 real tokens against the old
16,600 reserve — a margin of 16, tight enough that one more sentence of guidance anywhere in this
schema would have put the free call over its own reserve. The new figure restores the ~200-token
headroom the reserve is meant to carry.

### The roast moves onto My Psyche, written by the free call

The roast ("Let us roast you") used to be Part 05 of My Report, the appendix, after Evidence and
method — which on the reader's own page made the appendix the roast and nothing else. It is now
**free, written by the card call, and shown on My Psyche straight under the card**, above "Beyond your
card", as a secret bonus: a gradient-framed box with a "Secret bonus unlocked" badge, a few sparks
drifting up, and one "Reveal my roast" button (`secretRoastHtml()` in `docs/app.js`, `.secret-roast`
in `styles.css`, the words in `Copy.secretRoast`). It works the old cover's way: the writing is not in
the page until the reader reveals it, `revealRoast()`/`hideRoast()` put it in and take it out, the
caveat sits above it and the reader can share its opening as a story image. Once opened the box
settles to a plain card so the writing reads like the rest of the page. The pulse on the button is a
glow, not a scale, so the button never moves under the pointer. Movement stops under
`prefers-reduced-motion`. The badge and button use the fixed brand pair rather than the tokens, so
their white text keeps its contrast in dark mode.

**Part 05 is gone.** My Report is Parts 00–04. Evidence and method was already on My Psyche for the
reader's own report; the sample, which has no My Psyche, keeps it at the end of Part 04. The PDF is
unchanged and still prints its appendix with the roast.

**The prompt moved, it was not copied.** The "The roast — a different register entirely" section
(`FREE_ROAST_SECTION`), the roast's no-diagnosis paragraph (`ROAST_LIMIT`) and the two fields
(`ROAST_SCHEMA`) came out of `PROFILE_SYSTEM` and `PROFILE_SCHEMA` and into the free call: the section
before its hard limits, the paragraph joined to them. `bonus` is the last field of both free schemas,
after `card`, so the card is written fair before the register changes. **The paid call writes no
roast**: no paid prompt mentions one and no paid schema has `bonus` (selftest checks both). Its
evidence-bound rules are pinned against `FREE_SYSTEM` now.

**The cost.** The free prompt grew from 6,680 to 9,120 tokens (`FREE_FIXED_INPUT_TOKENS` 6,700 → 9,300)
and the card call's output cap from 8,000 to 10,000 (`CARD_MAX_OUTPUT_TOKENS`, `FREE_MAX_OUTPUT_TOKENS`):
the roast is about 1,200 tokens and needs room to think. Worst case per free run goes from $0.0521 to
$0.0616 (`FREE_COST_CAP` $0.053 → $0.062), about **1 cent more**; the deep card on an unlock from
$0.070 to $0.079. The paid call is cheaper by the same section and the roast's output, about half a
cent a run. At the 200-a-day ceiling that is about US$12.40 a day at worst, up from US$10.60.
A typical run adds about half a cent.

**The unlock.** `overlayCard` carries the free card's roast into the full report, and
`adoptFullReport` keeps the one already stored when a reader who added data is given a report with no
card beside it (the classic layout's unanchored path), so the roast a reader opened before paying is
the one they keep and the one the PDF prints. A free report saved before this change has no roast, and
neither will its full report. The unlock offer no longer promises "a secret
bonus" beside the plan, and the front page's premium extras drop "A secret bonus section": the roast
is not what the US$5 buys any more.

### Psyche Sync without a score, the friend's card on My Syncs, and a round of polish

**Psyche Sync has no score any more.** A percentage between two friends read as a grade, and the low
ones as a verdict on the friendship. `COMPATIBILITY_SCHEMA` is now `summary` (one warm line),
`align` and `differ` (two or three points each, with evidence), then `howToPartner` ("How to relate
better") and `caveats`. A "How this usually plays out" paragraph was tried between them and taken out. `score`, `band`, `verdict`,
`strengths`, `frictions` and `sharedGround` are gone, and so is the prompt's "# Score" section. The tone
section asks for positive and encouraging throughout and bans the words tension, conflict, clash,
friction, struggle, problem and incompatible (selftest checks the schema and prompt carry none of
them outside that rule). The page, the PDF and My Syncs show no ring or percentage. "Where you differ"
is drawn in the brand purple, not the warning amber. A sync saved before this is read the new way by
`syncSections()` (its verdict as the summary, its strengths and frictions as align and differ) and its
old score is never shown.

**My Syncs rows have two buttons**: **Card** opens the other person's Psyche Card full screen, in the
dialog their link's card opens in (`openFriendCard`), and **Sync** opens the sync. To draw the card, each
new sync keeps the card the link carried (`card`, and the link's `face` when it came from a waiting
invite) in the saved history on this device; Delete everything clears it with the rest. Syncs saved
before this have no card, so their row shows only Sync.

**"Your friend" is "your connection"** in the sync wording: the My Syncs intro, the waiting bar, the
invite card and the front page's step four. The My Syncs intro reads "…for your Psyche Sync: what
clicks between you…", with no score.

**The Psyche Card is positive and encouraging, with no negative connotation at all.** The headline, the
two sentences on the character and the pattern names are held to that in `CARD_SCHEMA`,
`STRUCTURED_CARD_HIGHLIGHTS`, `FREE_PATTERNS` and both card prompts. Anything that could sting belongs in
the full report. The free prompt reserve went to 9,500 tokens for the longer rules; the cap is unchanged
at $0.062.

**Careers that suit you**, under How you work in My Report and in the PDF: `careerAssessment.fit` is two
string lists, `suits` (three kinds of work) and `draining` (two or three), each "Kind of work: why", split
on the colon for display (`careerFitHtml`). Strings rather than objects because the structured full
schema sits near the size Gemini will serve. This adds about as much to it as the roast's two fields took
out, but it has not been run against Gemini from here; `node tools/probe-schema.mjs` with a key checks it.
The limit is Gemini's and cannot be raised, so `analyseFull` in `lib/gemini.js` has a safety net: a bare
400 "invalid argument" (`schemaRefused`) is retried once with `withoutCareerFit(schema)`, which costs
nothing because a refused schema is decided before the model runs. The report then arrives without that
block, and a second refusal reaches the reader as before.

**A pasted link is read the way a tapped one is.** The character, its write-up and the card's lists are
not in the long `#p=` payload; they are the short link's `face`, which a tap fetched and unlocked but the
"Sync with others" box never did. A pasted short link (`psycheai.io/c/<id>#<key>`, even inside a sentence)
was not recognised at all. `readLinkText()` now fetches and unlocks it, so the sync keeps the face and
the Card button shows the whole card, and a sync from a pasted short link counts on its owner's "Your
link" as a tapped one does. A long `#p=` link still has no face to give; links are short wherever short
links are on.

**Smaller changes.** The share message is "I got X for my Psyche Card. Get yours now for free: <link>".
Delete everything is its red bin alone (its name still read out): at the foot of My Psyche at every width,
and on My Report on a phone, where it sits narrow on the left with Download in the middle and **Back to
card** on the right. "Your link"'s three counts are compact and have no icons. The front page calls the
paid report **Your Psyche Report**, and step one says "Download your data from Instagram (WhatsApp and
Google data are optional). See below for instructions.", its "below" scrolling to the cast ("Guess
which character"), with "Request your Instagram data first" straight below it, as Get my data lands,
without touching the hash. On My Syncs, "What your link contains" is a row across
the whole box under My link and Sync with others. The revealed roast's caveat is a soft note and its two
halves are panels under an icon each. The FAQ's two data answers are in full sentences, the digest
answer drops its paragraph on who might recognise it, the one-free-card question is gone (its code is a
clause in the access answer), the Psyche Sync answer is two short paragraphs, and "What does it cost?"
no longer promises a secret bonus section in the paid report.

### Your data's order, a quieter footer, and no roast sharing

**Your data** under Evidence and method runs Instagram, WhatsApp, Google, Facebook (the order Load your
data uses), and the WhatsApp row carries a line of its own: "Up to 3 chats with close connections are
recommended." (`sourceWhatsAppHint`; three is the digest's own limit, `supplements.whatsapp.chats.slice(0,
3)`).

**Folded, with ticks** (October 2026). The rows had grown into paragraphs of counts, so what was read
is now folded away: the source's name, with a chevron beside it, opens and closes its full list, one
item per line (`.source-read-toggle`, `.source-read-more`). On the right an added source shows a green
tick, and WhatsApp three, one per recommended chat, green for each chat loaded (two chats: two of
three green). Then *Change ›*, the only part of the row that opens the data popout now that the name
folds. A source not added has no ticks and a filled *+ Add* pill instead; its "Not added – adding it
raises confidence" line was dropped as the pill says it. WhatsApp's recommendation is always in view, a
line under the row, loaded or not: it is advice for adding chats, so it is no use folded away.

**The footer** shows the independence note and the release number (`v3.0.0`, `package.json`'s version,
there so a problem report can name the build) only on the front page and the FAQ: `show()` sets
`.footer.is-content` on every other view, and CSS hides the two lines there. The static pages keep the
note in their own footers. The footer's links are a size down (.78rem) and the guide links under them
(.74rem).

**The roast has no share button.** "Share this roast" and the story image behind it are gone, along with
the canvas helpers that only it used; the roast is for the reader alone. The PDF still prints it.

### Part 3 of the unlock offer in four rows, and gifts that are given

The unlock offer's **How you connect & work** is four rows (`Copy.STRUCTURED.offerConnect`): In
relationships & ideal partner traits; Attachment style & conflict style; How you are at work; Career
assessment (which now names the careers that suit and drain).

**Gifts, given.** The schema has one name for gifts, "Receiving gifts", on both sides, so "Shows care as"
used to read "Receiving gifts". `Copy.givingLove()` shows it as **Giving gifts** wherever the giving side
is drawn (the card, the report, the PDF, the card guide), and `withCard` writes it that way into the
shared card, so a Psyche Sync reads it right too. The data itself is unchanged.

### Each source has a ceiling of its own

A real digest showed the problem: Instagram filled the old 80,000 on its own (79,741), so a WhatsApp chat of
17,039 of the reader's messages was trimmed to **10 lines** and Google to about thirty entries a list,
while Instagram kept all 270 messages and 200 captions. The trim loop cut supplements first.

**From first principles.** Cost is characters sent: each 10,000 is about $0.002 a call, and the premium
report re-sends the digest. Each further line of one source adds less than the one before, while a
second good source adds a new angle. Instagram and WhatsApp carry the reader's own voice; Google is
questions and autoplay; Facebook is an older life stage. So each source gets a ceiling of its own, sized
to what it is worth, the **same in the free read and the premium read** (`SOURCE_CAPS`):

| Source | Ceiling |
|---|---|
| Instagram | 75,000 (`DIGEST_CHARS`), built first and never cut for an added source |
| WhatsApp | 12,000 a chat (`waThreadChars`, about fifty lines with their context), up to 3 chats, plus each chat's counts |
| Google | 8,000 (its lists, cut back to 30 channels, 8 titles, 25 YouTube and 35 Google searches, come to 5,000–6,000) |
| Facebook | 12,000, offered at the unlock |

*(Superseded by the three pools below: the ceilings are now shared by kind of evidence.)*

### Two free tiers: Instagram alone, or Instagram and another source

The 126,000 pools are for a reader who loads a second source at the first upload (a WhatsApp chat or
Google). Taking that effort shows more interest and likely a higher conversion, so it buys the fuller
card. Instagram alone gets the allocation the card was first sized at, about 80,000, cut by the same pools
(`SOLO_POOL_CAPS`):

| Pool | Instagram only | Instagram + another source |
|---|---|---|
| Public self | 32,000 | 40,000 |
| Conversations | 46,000 | 72,000 |
| Searches | — | 8,000 |
| Fixed | 4,000 (measured 2,600) | 6,000 |
| **Line** | **82,000** (`SOLO_DIGEST_CHARS`) | **126,000** |
| Worst-case free card | $0.063 (`SOLO_FREE_COST_CAP`) | $0.072 |
| Worst-case full report from that digest | $0.152 (`SOLO_COST_CAP`) | $0.161 |

32,000 and 46,000 because a full real account came to about 30,000 of public evidence and 42,500 of DMs.
The tier is read off the digest itself (`carriesSecondSource`, `poolCapsFor`, `budgetFor`): a source
unticked at the review does not count, so what is sent falls back to 82,000, and the server's size check
reads the tier the same way. A digest built with a second source fills Instagram at the larger tier first
(`poolTier: 'sources'`). Facebook, offered at the first upload since late October 2026, counts as a second source; the
premium read keeps its own pools for every reader. A heavy Instagram-only account's 200 captions now
just pass the 32,000, so its captions are cut to about 180.

**Late October 2026: public 50,000 in both tiers, Google searches 50.** The public pool (Instagram's
share of it too, `INSTAGRAM_PUBLIC_CHARS`) is 50,000 whether or not a second source is loaded. Captions
were the list the cap bound hardest: a private account's stories and posts say more than their rank
among sources suggested, and 18,000 more characters is under half a cent a call. The lines are now
**100,000** for Instagram alone and **136,000** with another source. Worst cases: free card $0.068 /
$0.075, a full report from that digest $0.156 / $0.163 (`SOLO_*` and `FREE_COST_CAP`/`COST_CAP`).
`googleSearchTerms` went from 35 to 50, because the item counts, not the 8,000 pool, were what bound
Google (about 4,500 used). The premium read keeps its 70,000 public pool, so Facebook's room above
Instagram there is now 20,000 rather than 30,000 (never under its 10,000). The caption start count
stays at 200: when it binds, `buildFilled` raises it to fill the pool anyway, so starting at 250 or 300
would change which captions are picked first but not how many go or what they cost. The year rule
(no year more than a quarter of the places) already yields: `allocatePlaces` hands out any places the
cap left unclaimed with the cap lifted, and there is no cap at all when every caption fits.

### Spare room flows one way: conversations to public, never back

Room the conversations pool leaves unused goes to the public pool; the reverse never happens
(`conversationsSpare`, `instagramPublicLimit` in `docs/digest.js`). Public evidence is broad and is what
the card mostly describes, so it may dominate a digest; one or two heavy conversations should not. The
conversations pool is trimmed first, then the public pool is held to its ceiling plus that spare (and
Instagram's own share of it grows by the same spare), so a chat added later takes its room back from the
public pool before anything of its own is cut. `buildFilled` fills the messages first, then the captions
into Instagram's share plus the spare. The line does not move — the spill is only room that would sit
empty — and Google's searches neither give nor take. Measured: Instagram alone with few DMs, public
72,000 and conversations 5,000 (80,000 of 82,000); add three chats and they go in whole (34,000) while
the public pool gives back what it borrowed.

### Nothing sexual, no accusations, and harm to others is never a joke

A stress test of a married man liking "thirst trap" posts, a cheater, an abusive spouse and boss and a
man harassing women showed the rules had no answer for infidelity, sexual content, abuse or crime, and
that the roast, whose brief is the gap between what someone says and does, would aim straight at them.
A roast naming an affair is a bombshell on a screen a partner can see, and a like is not an affair.
Every prompt now carries a conduct rule (`CONDUCT_RULE` for the card and roast, `CONDUCT_RULE_REPORT`,
which never mentions a roast, for the paid report): nothing sexual and nothing about infidelity (at most
"a lot of late-night scrolling"); never an accusation or a word for a crime ("cheater", "abuser",
"predator", "harasser"); never a quoted threat; and harm to others is never a joke. Where the reader's
own messages show controlling, threatening or pressuring behaviour, the roast leaves it alone and the
advice says plainly, without labels, that it is worth taking seriously and that someone qualified could
help. The card stays positive and non-romantic. The card prompt measured 9,898 tokens with it, so
`FREE_FIXED_INPUT_TOKENS` is 9,900; every cap still covers its line.

A second stress run (a married lurker and a playboy, on a kit built just before the rule) showed what
the roast does without it: "covert operation", "burner chats", "cover stories", a quoted "she can never
find out", and advice as an ultimatum ("cut the burner chats", "your luck runs out"). That was too harsh
and read as a verdict. Silence is not the answer either, since the gap between the public picture and
the private one is real. The rule therefore says how to name it. Where posts and private activity pull
apart, it is noted once, neutrally, and as one possible reading, never a verdict: "Your posts put family
first; your searches and messages show privacy questions and contact outside that circle." There is no
spy, double-life or cover-story language. The advice invites self-reflection and never orders or warns,
and nothing of it reaches the card. The card prompt measured 9,998 tokens with this, which is the most
the 7.2-cent free cap leaves room for, so `FREE_FIXED_INPUT_TOKENS` is 9,998.

### Extra Instagram lists fill the public pool's spare room

The Instagram export holds more than the reader's own words, and the digest used little of it: Instagram
searches were counted and no longer sent (an earlier round removed them, with their review row; the
reason was not recorded, and the likeliest one, that people search for people, is now handled by
leaving those searches out), liked-post captions were cut
to six, and the account lists to fifteen. They now go in as **extra lists**, each held to a ceiling of
its own (`EXTRA_CAPS`), filling whatever room the reader's own words leave in the public pool,
including what the conversations left (see "spare room flows one way"):

| List | Ceiling |
|---|---|
| Instagram searches, by repeats (`instagramSearches`, new) | 3,000 (~80) |
| Captions on posts they liked, two years | 8,000 (~40) |
| Hashtags on posts they liked | 1,500 (~60) |
| Accounts they like most / save most | 1,200 each (~40) |
| Accounts whose stories they like most (`storyLikedAccounts`, new) | 900 (~30) |
| Instagram's inferred topics | 1,200 (~40) |

The reader's own captions and comments come first. The extras are the first thing trimmed when room is
needed (ranked below Facebook's posts and the reader's own words in `trimToPools`), except a
**guaranteed 3,000** (`EXTRAS_GUARANTEED`), so a reader who writes a great deal still shows some of what
they search for and reach for; `buildFilled` counts the extras at that 3,000 when it sizes the captions,
and the trim takes the rest back. Ad interests stay out. A search shaped like a username (no spaces,
with a digit, dot or underscore) or matching an account they follow is left out on the device
(`searchableTerms`): people search for people. The review sheet has a row for the searches ("Your
Instagram searches"), and story-liked accounts sit under "Accounts you engage with". The prompts call
the new lists attention and taste, not voice. No line moves: they only use room already allowed.

### A note when Instagram has almost no writing in it

Some readers post photos and videos without writing anything. Their digest is likes, saves, follows and
timing, and in a test it came to about 2,400 characters: a card that is mostly a guess. On a first upload
(both the "Add your data" popout and the drop-on-the-card path), when the digest has fewer than 10
captions and comments, fewer than 50 of the reader's own DM lines, and no WhatsApp chat or Google
(`thinDigest` in `docs/app.js`), a note comes up before the review: "Your Instagram has little writing in
it", saying a WhatsApp chat with a close connection or Google data will make the card much more accurate.
"Add more data" goes back to the popout with Instagram still loaded; "Continue anyway" goes on to the
review. It is said once per upload. It reuses the low-confidence note's popup (`noteDialog`).

**Late October 2026: thin by the reader's own writing.** The old rule (fewer than 10 captions and comments,
fewer than 50 DM lines, no second source) caught only nearly empty accounts. A digest is now thin when the
reader wrote fewer than 20,000 characters of it (about 3,000 words: captions, comments, their own messages
on Instagram, WhatsApp and Facebook, and Facebook posts, without the «them: …» context or the tags), or
when the digest is under 50,000 in all (`ownWritingChars`, `THIN_OWN_CHARS`, `THIN_DIGEST_CHARS`). Size
alone was the wrong measure: counts, likes and follows fill a digest without saying how someone writes or
thinks. The saving in tokens is small, since a card's cost is mostly its output (about 4.6¢ thin against
8.4¢ full, worst case). What a thin run really wastes is the reader's one free card, so the note now says so,
and names Facebook beside WhatsApp and Google. It is one gentle note ("Add more data" / "Continue
anyway"), shown once per browser session (`psycheai_thin_said` in sessionStorage), not on every attempt.
The UI suite's pages start with it said, since the sample export is small; the thin-data check clears it.
`buildExportZip({ silent: true })` in `tools/fixture.mjs` makes such an export for the UI suite.

### The roast goes gentle on someone who is struggling

A stress test of five profiles found the roast the riskiest part of the free card: its brief is the least
charitable reading the evidence supports, and for a reader whose data shows depression or acute anxiety
that reads as kicking someone who is down. The roast section (both free prompts) and `ROAST_SCHEMA` now
say to read for clear distress first — recurring sadness or low mood, grief, withdrawal, sleeplessness,
being hard on themselves, dread or panic — and where the digest shows it, to tease only a few small,
harmless habits, affectionately and briefly, never the struggle itself; `advice` turns kind and practical
and may suggest talking to someone they trust or someone qualified. One sad post is not a pattern. No
condition is ever named. The longer prompt measured 9,688 tokens, so `FREE_FIXED_INPUT_TOKENS` is 9,800
and `DEEP_FREE_COST_CAP` $0.084; the free and Instagram-only caps still cover their lines.

### The privacy page in the FAQ's words, and a clearer first data popout

The privacy page is now questions and plain answers, the way the FAQ's "Your data" section reads: what
stays on your device, what leaves it, who receives it, whether anyone else can access it, what PsycheAI
keeps, and your rights. Every fact it stated before is still there. The first upload's "Add your data"
popout now sets Instagram apart (an accent border and a "Required" pill), drops "Select multiple files as
needed" (several files can still be picked at once), and reads "WhatsApp chats (Optional)", "Up to 3 chats
with close connections (.zip or .txt)". The screenshots behind the Instagram steps are now fetched and
decoded once the page settles, and a popup is shown only once its image is ready, so a hover or tap shows
it whole rather than painting in halves.

### A slim Psyche Report bar once the free card is in

Once a reader has a free card that is not yet unlocked, one slim line under the navigation offers the
report: "✨ See the full story behind your card · Unlock your Psyche Report →", and on a phone only the
offer, so it stays one line. It shows on the front page, My Psyche, My Syncs and the FAQ. It is not shown
on My Report, while an analysis runs, or once anything is unlocked. A tap opens My Psyche at the
"Unlock your Psyche Report" section, scrolled clear of the sticky navigation. It has no close button:
until something is unlocked it stays, since the report is the one thing PsycheAI charges for. With the
bar showing, every page starts about 10px below it: My Psyche's card had sat 20–40px down (the page's
usual top padding), and the front page's banner, which runs up to the navigation, had touched the bar,
so it steps down by the same gap and rounds its top corners. It never shows beside a friend's sync
invite: while a friend's link is waiting, that comes first, and the bar appears once the invite is closed
or the sync is done (`refreshReportPromo`, `syncInviteShowing` in `docs/app.js`).

### The full report lives on one device, and says so

The full report is kept only in the browser it was made in (`localStorage`); the server never stores
it. A browser can clear that without asking: Safari deletes a site's stored data after seven days of
use without a visit, a reader can clear their history, and a private tab forgets it on closing. So until
the reader has downloaded its PDF once, the report opens with a short note: *Your Psyche Report is saved
only in this browser, and PsycheAI keeps no copy. Download the PDF to keep it.* (The longer version named
Safari's seven days; it read as a wall of text above the report.) It has a **Download PDF** button beside
it (`showKeepNote` in `docs/app.js`) and a ✕ in its corner that puts it away for this visit only: it is
back on the next, until the PDF is saved. On a laptop the left column is laid level with the report's
header, so when this note or the "ready" note above it goes, the column is laid out again
(`removeHeadNote`); otherwise it was left a note's height below the header. The first download, from there or
from the page's own button, sets `psycheai_pdf_saved` and the note goes for good. A new full report
clears the key, so the note asks again for that one.

### A note in an app's own browser

A link tapped inside Instagram, Facebook, Messenger, TikTok, Snapchat, LINE or X opens in that app's
own browser. Each keeps its own storage, apart from Safari or Chrome, and the app can clear it at any
time, so a card made there can vanish, or seem to when the reader later opens the site in their usual
browser. These browsers mark their user agent (`inAppBrowser`). When one is detected, a note under
the navigation says so and how to leave: *Tap ⋯ or the share icon and choose Open in Safari* on iOS,
or *Tap ⋮ and choose Open in Chrome* on Android, where an **Open in Chrome** button sends the same
address to Chrome directly (an `intent://` link). A **Copy link** button sits beside it. The note's ✕
puts it away for the visit, and the *Add your data* popout says it again before any data is loaded.
WhatsApp and Telegram open links in a system browser sheet whose user agent looks like Safari's or
Chrome's, so nothing can detect those.

**A friend's invite starts with leaving.** A friend who taps someone's link inside Instagram or
Messenger used to hit a dead end. The invite was saved in that app's browser, they requested their
data, and hours later they opened Instagram's email in Mail or Safari, a different browser, where the
invite did not exist. They made a card, and the sync with whoever invited them never happened. Now,
in an app's own browser, the invite's first box is **Step 1: open this page in Safari** (or Chrome),
saying why: *Ava's invite is saved only in Instagram's browser, and your Instagram data takes a few
hours to arrive.* It comes with **Copy link**, which copies the address they arrived on, key and all,
and on Android **Open in Chrome**, both built from that address because the app has already taken
the link out of the address bar. The general note under the navigation stands down while this shows,
so the same thing is not said twice. It used to show at once and then stand down when the invite
drew, a moment later, so a friend's link opened in Instagram flashed the yellow note for a split
second. Now, when a link is in the address (`?c=`, `#p=`) or an invite is waiting on the device, the
note waits until boot has finished (`settleInAppWarn`) and shows only if no invite step did.

### A private window

A private (incognito) window forgets the card, the guess, a friend's invite and any free report
waiting when it closes, the same loss as an app's browser clearing itself. Browsers hide whether a
window is private on purpose, so the page guesses (`looksPrivate`) and says so as a guess: *This
looks like a private window. Your Psyche Card is saved only in this browser, and a private window
forgets it when you close it. Open psycheai.io in a normal window to keep it.* It uses the in-app
note's bar, with **Copy link** and a ✕ that holds for the tab (`psycheai_private_closed`), and stands
down for the in-app note when both apply.

- **Chrome, Edge and other Chromium browsers:** a private window's storage quota is tied to memory
  (about 0.9 GB measured), a normal profile's to the disk (about 160 GB on the same machine). Under
  twice the JavaScript heap limit reads as private. A normal window on a nearly full device could be
  taken for one, which is why the note says "looks like".
- **Firefox:** a private window has no service workers.
- **Safari (iPhone and Mac):** gives nothing away, so it is never told.

The UI suite's pages are private windows themselves, so each starts with the note closed, as its ✕
leaves it; the note's own checks use a page without that.

### "Your data", never "the export"

A report said "the export reveals you are a …", which reads as a file talking about the reader. Everything
a reader sees now calls the exported file "your data" (or names it: "your Instagram data", "your WhatsApp
chats"): the app's copy, error messages, the review sheet's empty rows, the PDF's subtitle, the FAQ, the
privacy and terms pages and the guides. The model is told the same in every prompt that writes for the
reader (`DATA_WORDS` in `lib/prompts.js`, in the free, full and premium prompts' hard limits), and the
server rewrites any "the/your/an (Instagram) export" or "archive" that still comes back (`readerText`
in `server.js`, beside the en-dash pass). Instagram's, Google's and WhatsApp's own button names — Export
your information, Create export, Export to device, Start export, Export once, Export chat — are left as
they are, because they are the words the reader has to find on screen.

### The waiting counter keeps counting

Coming back to the tab during an analysis restarted "Analysing – 0s". The return to the tab rejoined the
job the page was already waiting on (`resumeRunningJob` on `visibilitychange`), which restarted the
counter and started a second poll on the same job. A job this tab's own call is waiting on is now never
rejoined (`liveJobKey`), and a job that really is rejoined after a reload counts from when it began
(`startElapsed(label, job.at)`).

### En dashes, not em dashes, and a shorter Part 4 blurb

Every em dash (—) a reader sees is now an en dash (–). That covers the site's own text: the strings in
`docs/copy.js`, `docs/app.js` and `docs/pdf.js`, the text of `docs/index.html` and the static pages, the
in-browser error messages and the server's own user-facing messages, including the Stripe product
labels. The model's output is handled on its way back: `enDashes` in `server.js` converts every dash in
the card, the report and the Sync read. Code comments, and the digest's own notes to the model, keep
theirs. On the front page, "Your Psyche Report"'s Part 4 row now reads "A development plan built from
everything above." It no longer mentions the plan to tick off or how strengths behave under pressure, and
its section tags no longer list "Your plan". The report itself still has both sections.

### Closeness on the card is never a gate

A real card read "fierce, generous loyalty to the few people who pass your screening". Every word was
meant kindly, but "screening" casts the reader as someone who filters and excludes. The card's wording
rule (shared by both free prompts) now adds that, in the headline and the write-up, closeness is never framed as a gate — no screening,
vetting, testing or filtering, no "select few", nobody having to earn or pass anything — and says what
to write instead: what they give, to whom ("deep loyalty to the people you are closest to"). It covers the
card's headline and write-up only: how selective someone is may still be named in the weaknesses under
the card and in the paid report, whose prompts are untouched.

### No version number in the footer

The footer's "v3.0.0" is gone (`#footer-version` and `renderBuild` removed). `/api/status` still reports
`build.version`, so a deploy can still be told apart from the server side.

### The list clamp thins evenly, at 1,000

Four real digests (Instagram alone; with one chat; with one chat and Google; with two chats and Google)
showed the pools working — 81,000 of 82,000, then 103,000, 106,000 and 117,000 of 126,000, each chat at
about 11,200 of its 12,000, and nothing identifying left in any of them — and one fault. `forModel`'s
clamp held every list to 400 items by cutting it off its end. Filling by room asks for more DM lines than
that, and the DM list runs conversation by conversation, so the last conversations went: three of ten in
two of the digests, and the clamp left about 14,000 of the conversations pool empty. `maxListItems` is now
1,000 (1,500 in the premium read), filling never asks for more, and a list over it is thinned evenly
(`dropEvenly`) so every conversation and every year keeps something.

### Instagram's steps stay inside the app

Step 1 no longer sends the reader to an outside link — a link to another site is one more thing to
trust. The steps are now "Open your Instagram app > Go to your Profile > tap the Menu (≡) top right to Settings >
Accounts Centre", then "Tap Your information and permissions > Export your information > Create export >
your Instagram account > Export to device", the same in the illustrated guide (whose first screenshot is
captioned "Settings → tap Accounts Centre") and on `/download-instagram-data`, which also lost its "Open
Download your information" button and its computer answer's link. Every screen name in the steps now
shows its screenshot on hover or tap (`mountPeeks`): Accounts Centre, Your information and permissions,
Export your information, Create export and Export to device their own, and All time, JSON and Lower the
Confirm your export screen, where those three rows are ringed.

### Privacy wording: no access, and the four-hour hold explained

The FAQ's "What data leaves this device" no longer mentions other people's messages (the review sheet's
Messenger and DM rows still say what of the other side is included), and says the digest is usually
about 100 KB of text — it is at most 126,000 characters, and a full Instagram account lands near
100,000–115,000. "Can anyone else access my data" adds that not even PsycheAI's administrator can see
your data or results: there is no admin view of them, and nothing from a digest or report is stored or
logged (the server's logs carry error messages and the kind of report a name was scrubbed from, never
content). The privacy page's server line used to say only that a finished report is "held in memory for
up to four hours", which read as PsycheAI having it. It now says what that is: the server stores, logs and
shows nothing, PsycheAI has no access to your data or results, and the finished report waits in working
memory under a code worked out from your own summary (`lib/results.js` keys it on a SHA-256 of the
digest), so only the device holding that summary can collect it.

### Answering the sceptic's three questions

People wary of a new app ask three things before loading their data, so each now has a plain answer
(October 2026). **How does PsycheAI make money?** From paid re-runs and Ask PsycheAI questions, never
from your data; no ads, nothing sold or shared (FAQ, the privacy policy's no-tracking line, and the front
page's privacy panel). **Do I need to give my Instagram password?** No: PsycheAI never asks for one or
logs in to any account; the reader downloads their own data (FAQ, privacy policy, front page). **What if
PsycheAI gets hacked?** There is none of your data to take: no accounts, no store of exports, digests or
reports, a report in progress held only sealed until collected (`lib/results.js`), and shared cards and
syncs locked with the link's key (FAQ). The FAQ and the front page's how-it-works step 2 also stopped
naming Gemini: step 2 now says a de-identified summary is analysed by Google Vertex AI, since only the
summary is.

### The front page's privacy panel, shortened

The panel under *Start here* had grown to a heading, four labels and three sentences (no copy, no
password, no cookies or trackers, how PsycheAI makes money): about 60 words where people skim. It is now
*Your data stays private*, the same four steps, and one line, *No sign-up, no password, no trackers.*,
with *How your data flows →* to the privacy page. Everything cut is one tap away, there or in the FAQ.

### No internet connection needed to read the export

The strongest proof that the files stay on the phone is one the reader can run: airplane mode. Once
"Add your data" has opened, the data readers (`reader-scripts`, fetched on opening it) are in, and from
there to the review nothing is needed from the network: the export is read, de-identified and
summarised, and the review opens, with the connection off (the only request tried is the step counter,
`/api/event`, which carries a step's name and fails quietly). So the popout says *No internet connection
needed for this step* (`#datasources-offline`, `dataSourcesOffline` in copy.js), shown only once the
readers have loaded so it is true when seen; the privacy page's last line and the FAQ's *Can I verify
this?* invite the airplane-mode test. Send pressed while still offline keeps the review open and says
*You are offline. Turn your connection back on to send.* (`#review-offline`), rather than closing it
into a connection error. The UI suite runs the whole test with the network cut. A bytes-sent counter was
considered and dropped: a number the app shows is still the app's word; airplane mode is the reader's.

### The held report is sealed, and released on collection

Why the server holds a finished report at all: writing it takes minutes, and a phone loses its
connection meanwhile (switching apps, Wi-Fi to mobile data). Holding it means the reader is never
charged twice or made to wait again. But "held in memory" still meant PsycheAI *could* read it. So
`lib/results.js` now stores only ciphertext: AES-256-GCM under a key derived from the digest
(`unlockFor(kind, digest)`: SHA-256 of a label, the kind and the stable digest JSON), separate from the
job key that indexes it. The server forgets the key after writing; the client gets it in the 202
(`unlock`) and keeps it with the job (`job.unlock` in the remembered token, split by `jobParts` in
`docs/llm.js`). A poll sends it in the `X-Result-Key` header, never in the URL, so it stays out of
logs; without it a poll gets `unknown`, the same as an empty slot. A retry with the digest re-derives
the key, so the free re-serve after a dropped connection still works, and an old client simply restarts
and is served from the cache. Once the device has the report it calls `DELETE /api/result`
(`release`), which drops the entry only if the key decrypts it: usually within seconds, never more than
the four-hour ceiling.

### How your data flows: the diagram

The privacy page opens with a five-step diagram (`.data-flow`, plain HTML and CSS since the page is
script-free): the files are loaded on the phone, not uploaded (step 1 said "stay on your phone", a
state rather than a step, until October 2026); a 100–200 KB summary is made there (the digest caps are 126,000
and 179,000 characters), names removed (step 2's title: *A short de-identified summary is made*); the reader chooses what is sent (the review sheet's switches, one a kind of data, all on
by default, and its download of exactly what goes: its own step since October 2026, as the one step the
reader takes rather than the app, where it had been "You check it first" at the end of step 2); only
that summary is sent, encrypted, to
Google Vertex AI enterprise, which does not train on it; the results (card, report, Syncs) come back and
are saved only on the phone. A panel lists what never leaves (photos, videos, the data files, full
messages), and a line links the public client code. The steps sit in two zones (`.flow-zones`, since October 2026): steps 1 to 3 in light green, *No internet
needed* (loading, summarising and reviewing all run with the network off, as the UI
suite tests), and 4 and 5 in light purple, *The only part online · encrypted*, each label drawn in front
of the cards so its border shows whole. Step 5 is online because the results are downloaded, and the
site is not an offline app, so it is not in the green zone. An all-purple version, the zones told apart
by shade, was tried and was not clear enough. The *Never leaves your phone* panel was dropped: the
review already shows exactly what is sent. The front page carries a compact four-icon version (its second label *Names removed. You choose what
is sent*)
of it (`.mini-flow`) above the no-copy line, linking to `/privacy#flow-title`. The diagram opens with the 28-second
privacy reel (`promo/`, `npm run promo:privacy`) as a plain click-to-play `<video>` (`.flow-video`,
300 px wide, `preload="none"`, 1.5 MB at 720 wide): readers checking privacy get the short version first,
the steps under it. It is not on the front page, which already has the main video and the compact flow. The site now names only
Vertex AI as the provider, since that is what production runs.

### Three pools, by kind of evidence

Per-source ceilings left room stranded: an Instagram account with few captions could not lend its spare
room to Facebook, and a reader with only Facebook's public posts had 12,000 characters for them. So the
room is now shared **by kind of evidence**, and spare room is shared **inside a pool, never across**
(`POOL_CAPS`, `DEEP_POOL_CAPS`, `POOLS` and `trimToPools` in `docs/digest.js`):

| Pool | Free | Premium | What is in it, and in what order |
|---|---|---|---|
| Public self | 40,000 | 70,000 | Instagram captions, comments, likes, saves, topics, accounts (up to 40,000 in both reads, `INSTAGRAM_PUBLIC_CHARS`); then Facebook posts, comments, friends and searches in the room left, never under 10,000 (`FACEBOOK_MIN_CHARS`) |
| Conversations | 72,000 | 95,000 | WhatsApp chats first; then Instagram DMs and Messenger share the rest, the larger trimmed first. 12,000 a conversation, 15,000 in the premium read |
| Searches | 8,000 | 8,000 | Google |
| Fixed | 6,000 | 6,000 | counts, rhythm, each chat's timings, notes (measured at 5,950 with three chats) |
| **Line** | **126,000** | **179,000** | `DIGEST_CHARS`, `DEEP_DIGEST_CHARS`; `budgetFor(digest, deep)` |

Facebook (and Messenger with it) was offered only at the unlock until late October 2026; the first
upload now takes Instagram, up to three WhatsApp chats, Google and Facebook. Beside Facebook, Instagram
keeps 40,000 of the free read's 50,000 public pool, and Facebook never less than 10,000. Instagram fills its two pools with the reader's own words
(`buildFilled`: messages up to the conversations pool, captions up to Instagram's 40,000), and a chat added
after takes its room back from the Instagram DMs. Measured on a heavy synthetic account: Instagram alone
114,000 (DMs fill the conversations pool); with three chats and Google 120,000 (chats 34,000, DMs cut
back to 38,000); the premium read with every source 173,000 (Facebook 30,000 of the public pool; chats
43,000, DMs and Messenger about 26,000 each).

**The premium read.** With the export still open in the tab, the full report is written from a digest
rebuilt from it at the premium pools (`deepDigestFrom` in `docs/app.js`). It holds lines the reader has not
seen, so it is reviewed before payment even when nothing was added; with nothing added the card stands and
the report is anchored to it. When the export has gone (a reload, a later visit), the report is written from
the card's own digest; a source added at the unlock is merged into its pool at the premium ceilings (a chat
still goes in ahead of the DMs, and the card is redrawn). Nothing is protected from trimming there any more:
protecting the card's DMs left an added chat about 23,000.

**Costs at worst:** free card $0.072 (`FREE_COST_CAP`, 126,000 characters); a full report from the card's
digest $0.161 (`COST_CAP`); the premium read's report $0.172 (`DEEP_COST_CAP`) and, when data is added
and the card is redrawn, its card $0.083 (`DEEP_FREE_COST_CAP`): $0.255 together. Of the free card's
$0.072, the roast is about $0.009 (its 2,400 tokens of prompt and the 2,000 tokens of output room it added).

### "Unlock your Psyche Report", a note when confidence is low, and flattering pattern names

The free page's offer, its button and the payment sheet say **Unlock your Psyche Report**. Pressing it
with a card read at **under 80% confidence** first opens a short note (`offerMoreData`, `#more-data-dialog`):
the confidence, and that WhatsApp chats with up to 3 close connections, Google or Facebook data would
give the full report more to go on, added on the next page. Continue goes on to "Your data for the full
report"; Back leaves the unlock. That page, like every data popout, now lists Instagram, WhatsApp,
Google, Facebook. **Signature pattern names must sound flattering** (the behaviour at its best); the
pattern's line, which only the paid report shows, may name the blind spot plainly.

### Why PsycheAI, and why not just ChatGPT (25 October 2026)

The question readers ask most before trying it is "why not just upload my data to ChatGPT?". Two short sections
above the Instagram steps answer it, so a reader has it before they start the export.
- **"Why PsycheAI stands out?"** (until 25 October 2026 "…as your personal AI coach") puts one question to both: "What would I regret most
  about my life when I'm old?".
  - The two real answers sit side by side, trimmed: ChatGPT's list that could fit anyone, and three lines of
    PsycheAI's, written from one reader's own data.
  - The note under them says only "Real answers, trimmed." (Its second sentence, "ChatGPT had nothing to go on;
    PsycheAI read one reader's own data.", was dropped on 25 October 2026.) ChatGPT was asked with nothing to go on;
    with an upload it would not be generic, so the section claims only that it starts from what you tell it.
- **"Where does your data go?"** (*Why not just upload my data to ChatGPT?* until 27 October 2026, a question
  many visitors never had; the FAQ keeps it) is a table of where the data goes with PsycheAI and with the same
  files uploaded to ChatGPT: the service, what is sent, training, what is kept, and since 27 October who can read
  the results (*OpenAI, for safety or legal reasons* against *Only you*: a report waits on the server only
  encrypted, lib/results.js, and is kept on the device), then a link to how data flows on the privacy page. (A
  row "Reads", on how much each takes in, was dropped on 25 October 2026.)
  - It is the FAQ answer of the same name in short. Its claims are the FAQ's, about ChatGPT's personal plans: it
    *may* train unless you turn that off, and it keeps data until you delete it and then up to 30 days.
  - It stays a table on a phone, in smaller type, because the two columns side by side are the point.
- Both use the theme's colour tokens, so they follow dark mode.
- Like the request steps, both are hidden for a returning reader (`.is-returning`), who has already decided.
- The UI suite pins the headings, the order, the table's rows and the phone layout.

## The compatibility link

Along with the long-form report the model produces a compact **card** — the profile reduced to short
labelled phrases. `docs/card.js` trims it to hard limits, packs it, deflate-compresses it and
base64url-encodes it into the link's fragment, which gets a rich profile down to **roughly 680
characters**. There is nothing to look up and no account to create. The budgets below were measured
when the card also travelled as a QR code, which needed it far tighter than a link does; they stand,
because a shorter link survives being pasted through chat apps intact.

The card is also exactly what the compatibility call receives, so whatever is trimmed is invisible to
the other person's report — and your long-form report never leaves your device.

### The K5 card, and Beyond your card

The shareable card — what the compatibility link carries and what the comparison reads — is shaped
around what the three kinds of comparison turn on. Partners turn on conflict, emotional safety, care
given against care wanted, and life direction; friends and family on shared interests, energy and
how much contact each wants; colleagues on complementary strengths and gaps, standards, disagreement
and load, and a manager and their report on direction, autonomy, whether problems surface and what
keeps someone. **K5** (`docs/card.js`) carries, besides name, headline, MBTI, the Big Five and
confidence:

| For | Fields |
|---|---|
| What they care about | interests ×4, **values & beliefs as one list** ×3, **top motivators** ×3 (Schwartz's ten, sent as their index), **pattern names** ×3 |
| Relationships | love languages (2 received, 1 given), attachment, **conflict style**, relationship strengths ×2 and watch-outs ×2 |
| Day to day | rhythm, social energy **and how they keep in touch** (who starts conversations, reply speed and length) |
| Work | work style, career strengths ×2, **what holds them back** ×2 |

It dropped the **Enneagram** (gone from the app), the **summary** (the headline and the rest say it)
and the **attachment's reasoning** (the most identifying line, in a link anyone can decode); separate
beliefs became part of values. Motivators and pattern names are copied from the free answer by
`withCard` rather than written twice; the conflict style and the work costs are new lines in the free
call's card (`CARD_SCHEMA`). A sample card's link is about 760 characters; the budget
(`COMFORTABLE_PAYLOAD`) is 1,000 now that no QR code has to scan it. Lines are cut at a word, not
mid-word. **K4 and K3 links still open**: a K4 link's beliefs fold into values, and its Enneagram,
summary and reasoning are left behind. A saved card is re-shaped before it is sent to a comparison.

**Each line matches the premium report.** The full report is anchored to the card (`anchorFrom`'s
`cardLines`): the attachment leaning is `attachment.style`, worded the same way; the conflict style is
explained by a new **`attachment.conflict`**, which opens with the card's words. It was "In conflict"
inside the attachment box; it is now its own subsection after it, **How you deal with conflict**, on the
page and in the PDF, with that opening sentence (the card's conflict style) in bold
(`Copy.leadSentence` splits it off); social energy and contact are what
`wellness.socialConnection` explains; and each work cost is one of what holds them back
(`careerAssessment.holdingBack` or `career.weaknesses`).

**Each basis is pointed at the fields that decide it** (`lean` on each mode and work stance, printed
in the request): romantic leans on conflict style, attachment, love languages, motivators and
values, rhythm, relationship watch-outs and neuroticism; friends on interests, contact, extraversion,
conflict and agreeableness; colleagues on strengths and work costs, work style, conscientiousness,
conflict and rhythm; a manager on their report's motivators and work costs and both conflict styles.
The derived facts add the top motivators the two share.

**Removed in October 2026.** My Psyche no longer has this panel. My Syncs still names each field
the link carries under *What your link contains*, but as field names, not the reader's own values,
so the values themselves are now seen only in a sync and in the full report. `beyondCardHtml`, its styles (`.beyond-*`, `--pcs`) and `Copy.STRUCTURED.beyond` went
with it. What follows is the record of what it was.

**Beyond your card** (`beyondCardHtml`) showed these lines to the reader, on a free report, between
the card and the unlock box: three columns — *In relationships* (attachment and conflict, each with a
*tentative* tag in place of the model's "(tentative)", strengths ✓ and watch-outs), *Day to day*
(rhythm, social energy & contact) and *At work* (work style, strengths, what holds you back) —
stacked on a phone, under the line *"A few more things your data says. These also go into your
compatibility link."* and over *"The full report explains each of these with the evidence behind
it."* It reads the card the link carries, so what the reader sees is what is shared.

**It is drawn as part of the card.** The panel uses the card's own background, white panels with the
same border and corner, uppercase letter-spaced panel labels with the emoji in a soft circle, bold
ink lines for each value, the MBTI strength pill for *tentative*, the card's round numerals for ✓ and
!, and its spaced uppercase footer. Every size is the card's own (in its 1080-pixel units) times
`--pcs`, the scale the card is actually drawn at, which `layoutPsycheCard()` measures and sets on
`#view-profile` — so on a laptop the panel's text is exactly the card's text size. On a phone, where
the card is a small thumbnail, each size has a floor (12.5px for lines) so the panel stays readable.

### What the card carries, and what that cost

The card used to hold about a tenth of the report, and specifically the wrong tenth. The
compatibility prompt is told that attachment and love languages decide a romantic read, that contact
appetite decides a platonic one, and that standards and follow-through decide a professional one —
and the card carried none of those. Love languages were absent entirely; attachment was the string
`"leans secure (tentative)"` with all of its reasoning discarded. Meanwhile interests, the thing the
same prompt says matters least, had eight slots. The model was being asked to weigh evidence it had
never been given, so it fell back on hobbies and filled the rest with something plausible.

**K4** carried the reasoning under the attachment guess, both love-language sides, an `energy` line
for contact appetite, a `workStyle` line, and the Enneagram type. **K5** (now) is shaped around what
the three kinds of comparison turn on — see *The K5 card* below.

There was no spare room for any of it. The `COMFORTABLE_PAYLOAD` constant claimed 1800 characters and
that number was fiction: measured against the scan ladder in `tools/uitest.mjs` — redraw at 450px and
300px, then sit the code in a 480p and a 720p camera frame — 656 characters passes everything, 721
still does, and **761 starts dropping frames**. Past that it is erratic rather than progressively
worse: 838 passed where 924 failed, because survival depends on the individual bit pattern. The old
card already sat at 633, so the real headroom was a few per cent, not four fifths. The constant is now
730, which also means the "dense, use the link instead" warning can fire at all — at 1800 it never
could, since that is roughly QR version 33 and no phone reads one off a screen.

The room was therefore bought, three ways. **Packing the wire format** was the largest single win:
nothing inside the compressed blob is ever read by a human, and spelled-out keys like
`relationshipWeaknesses` and `conscientiousness` came to roughly 420 characters that deflate could
not win back, because each occurs only once or twice. `pack()` maps them to one or two characters and
makes the Big Five positional; `unpack()` restores the canonical shape, so nothing downstream knows.
Then **cutting what the prompt does not weigh**: interests went from eight slots to four, career
detail collapsed into the single `workStyle` line, and the per-trait commentary went entirely — the
derived-facts block below now hands the model both Big Five scores and the gap between them, which
was the part it could not work out for itself. The result carries markedly more of what decides a
comparison, inside a QR code slightly *smaller* than the one before it.

Codes made before this still scan. `K3` payloads spell their keys out and lack the new fields, so
`decodeCard` reads the old format when it sees the old prefix and fills the additions as empties —
someone may have a code saved as a JPEG or printed on something, and refusing to read it would be a
worse failure than a slightly thinner comparison.

The profile page ends in three parts, in this order: the report, then the action row, then a line of
fineprint naming the model and the time it ran. The action row holds three buttons — **Download full
report**, **Test compatibility** and **Delete everything** — all housekeeping rather than part of the
document, so they close the page rather than sitting inside it. In the structured layout **Test
compatibility becomes the third of the card's buttons**, after Download and Share, labelled
**Compatibility** (`.cx-tool[data-act="compat"]`, which clicks `#test-compat-open`; the long bar under the
buttons is gone), and the action row keeps Download full report and Delete everything (a free report: Delete everything only).
The phone's row lays out a column per visible action. The **sample dialog's** title bar is a slim strip
(`#sample-dialog .sample-dialog-head`), and its part nav sticks flush to the top of the scrolling body
(`top: -1rem`, over the body's padding). The **payment sheet**
for the unlock has no blurb — its title, then the ways to pay — since the offer has already said what it
opens; the re-run and US$2 sheets keep a one-line blurb each (no wallet sentence, no reasoning about
cost). The wellbeing and roast caveats are two sentences each, still saying "not a diagnosis" and
pointing to a professional; the payment-recovery lines are one sentence each; and the FAQ's file answer
is one line plus the illustration link. An empty wallet slot (no Apple Pay or Google Pay, or mock
mode) collapses rather than leaving a band under the title.

**Test compatibility** opens a popout carrying **Send my link**, **Copy link** and **Got their link? →**
(to the compatibility page) — once a QR code, a copy-link and a download-QR button, and before that the same content a whole panel used to hold in the page flow itself,
always taking up a slab of the page between the report and the buttons whether or not anyone wanted
it. It is a `<dialog>` now, closed by a cross in its own top-right corner or by clicking outside it,
and opened only when the reader actually wants to test something — the compatibility panel used to
open the page before that, which asked someone to hand out their code before reading a word of what
was in it. It is no longer printed: with no code in it there is nothing on it for paper.

Three things changed once this actually shipped and got used. The character-count fineprint under the
QR code (`#payload-size`, "Shareable card: N characters…") is gone — a number nobody asked for and a
sentence reassuring the reader about something they had not wondered about. `#test-compat-open` lost
its `.btn-ghost` class in favour of plain `.btn`, the same gradient **Download full report** and
**Copy my link** already carry, so the one button that opens something now looks like it opens
something. And closing the popout used to snap the whole page back to the top — jarring on a report
long enough to need real scrolling to reach the button in the first place. The cause was not the
close, where the jump was actually seen, but the open: `.compat-dialog` had overridden `position` to
`relative` so the close cross would have a positioning root, on the reasoning that `.mode-dialog`'s
UA-stylesheet `position: fixed` was the wrong thing to keep — except `fixed` is *already* a valid
containing block for an `absolute` child, so nothing needed the override, and it broke the one thing
`fixed` was doing: pinning the dialog to the viewport regardless of scroll. With that gone, `showModal()`
laid the dialog out at its in-flow position instead, which is what actually reset the scroll. Removing
the override fixed it outright — the width-only version of `.compat-dialog` is all that survived.

The row held a fourth button, once: **Re-run the analysis**, which spent a second model call on the
same export and replaced the report with a differently-worded one; it has been removed, and the row
is pinned as an exact list of three so nothing creeps back into it. Its handler went with it rather
than staying bound to an id that no longer exists.

That leaves one loose end worth naming: `psycheai_digest` in `localStorage` existed only so the
re-run button had something to re-send, and nothing reads it now. It is still written, and **Delete
everything** still clears it. It is not a leak — it never leaves the device, and it is the reduced
summary rather than the archive — but it is a copy of somebody's evidence digest kept for no
purpose, and it should come out. It has not been removed here because three UI checks read it as
their observation point for what was actually sent (the digest size, the image coverage, the
opt-out), so removing it is a test change as much as a code one. The "analysed by" line used to sit inside the report body, right after
confidence — it now has its own fixed element after the buttons, since it is a record of the run
rather than a finding and stays true regardless of what else gets added above it. It is unchanged in
the PDF, which has no link panel or buttons after its own confidence section for it to be pushed past.

## Psyche Sync (was "compatibility")

**Friends only, and called Psyche Sync.** A reader's link is often public: an Instagram bio, or the
QR code on their card. A stranger running a romantic read against someone's card was the creepy
version of this feature, so the romantic and work comparisons were removed outright.
- **The basis picker is gone:** the romantic / family-friends / work choice, and the
  colleagues / manager / report choice after it.
- **`lib/prompts.js`:** `COMPATIBILITY_MODES` has the one key `platonic`, labelled *Connections*,
  and `resolveMode` returns it for anything. `COMPATIBILITY_SYSTEM`'s *Any two connections* section
  rules out romance, attachment and work. `WORK_STANCES` is gone.
- **Any two connections, never named.** The two people may be friends, family or anyone close, and
  the model is not told which. A sister syncing with her brother got "a dependable friendship built
  on…", so the prompt now asks how the two sync, vibe and relate, never calls them friends or what
  they share a friendship, and never names another relationship: *you two*, *the two of you*, *your
  connection*.
- **Old reports:** reports saved on the old bases still open on the reader's device, labelled as
  they were.

### Closing gaps a review found: privacy

A full review traced several places where the digest said less than the site promised:
- **Links, the profile's website and city.** Links were taken out of liked captions only, so a reader's
  own captions, bio and comments kept theirs, and the profile's website and city went to the model as
  they were. The review sheet never showed those two. Links now go from every field
  (`LINKS` in `redactContacts`), city and website are no longer kept, and `forModel` copies the
  profile field by field and runs the same contact pass. Because the server re-applies `forModel`, a
  page that missed something cannot send it on.
- **Postcodes beyond Singapore.** UK (*LS1 4AP*), Canadian (*M5V 2T6*) and US ZIPs after their state
  (*CA 94110*) are replaced. A bare five-digit number is left alone, since it is as likely to be a year
  or a price.
- **Names in Instagram DMs.** WhatsApp and Messenger blanked the other person's name in the reader's
  own words, but Instagram did not ("see you at Sam's"). It does now (`blankOwnText`).
- **Names in any script.** The reader's own name was matched with `\b`, which knows only ASCII
  letters, so *Ömer Yılmaz* stayed. Name edges are now Unicode letters.
- **The report scrub** now also checks story-liked accounts, which are mostly close friends, and
  WhatsApp and Messenger tags (`[c2]`, `[m1]`) as well as Instagram's.
- **An empty WhatsApp block** no longer opens the larger free read.

### Closing gaps a review found: payments

- **Friends' cards, farmed.** An account is only what the page says it is, and a card is free, so
  three made-up accounts from one phone earned a US$5 report. A referrer must now have made a card of
  their own. At most `FRIEND_CREDITS_PER_CONNECTION` (2) friends an hour count from one connection,
  for any referrer, keyed by a scrambled IP code kept for an hour, as the privacy page says. One
  referrer earns at most `FRIEND_CREDITS_PER_DAY` (6) a day.
- **One payment, one report.** A payment's three uses were for retries, but they were counted per
  payment, so one US$5 wrote reports for three people. Each payment and kind is now tied to the first
  report written with it (`digestRefusal`, `bindDigest` in `lib/premiumLedger.js`). A different one is
  refused; the same one again is free.
- **Spending once, even at once.** A free report's grant and a creator code's place under its cap are
  now taken before the report is written (`reserveGrant`, `promo.reserve`) and given back if it fails.
  Before, they were counted afterwards, so requests sent together all passed.
- **The older premium route** (`/api/premium-analysis`) now sends `Digest.forModel` of what was posted,
  held to the line, and scrubs what comes back on both ways in. It used to pass the posted object on
  whole.
- **A Sync's two cards** are `Card.shape`d on the server, so each field is held to its length and a
  free call cannot be filled to the model's context.

### Short messages, when there is room

A message under 30 characters was dropped unless it opened a conversation, apologised, showed a
feeling or asked a question, which is right for a heavy account but left a light one's
conversations pool half empty while "see you at 8" and "running late!" were thrown away. Once the
message count step is done (`buildFilled`), if the pool still has at least 1,500 characters free,
the floor steps down to 15 and then to 6 (`SHORT_MESSAGE_FLOORS`) and the DMs are read again.
Fillers ("ok", "lol", "haha") never come in at any floor, and short messages that repeat are kept
once. An account whose messages already fill the pool keeps the 30-character floor. The extra
messages count as fill (`__fill.ownMessages`), so they are the first to go when WhatsApp or another
chat needs the room.

### Closing gaps a review found: the app

- **A shared Sync can no longer be forged.** The key that locks a reader's inbox is in their link, and
  their link is on their story card, so anyone could leave a "sync from Jared" with invented text.
  Each sync now carries the sender's own link, and the receiving device opens it (`verifiedSender`)
  and checks that it shows the same card the sync claims. One that does not match is dropped unseen.
  A received sync also never replaces one the reader ran themselves.
- **Someone else's data is held to shape.** A received sync is rebuilt to the sync's own fields, as
  strings and short lists each cut to a length (`shapeSyncReport`). A card face from a link or a
  sync keeps only the fields `cardFace` writes (`shapeFace`). Character lookups take own properties
  only, so a name like "toString" draws nothing instead of breaking the card.
- **Nothing lost, nothing doubled.** A received sync is acknowledged, and so deleted from the server,
  only once it is saved (a full store keeps it for next time). Sharing runs once per sync however
  often it is tapped. A double tap on the paste box's Sync starts one sync.
- **Copy link in an app's own browser** copies the address the page was opened at (`ARRIVED_AT`),
  not the one left after the friend's link has been read out of it.
- **The keep-your-PDF note** stays in an app's own browser after Download, where a download often
  goes nowhere.
- **A promo code checked as the sheet closes** no longer starts a report, and one check runs at a time.

### Faster returning visits: fingerprinted scripts and styles

Every file used to be served `no-cache`, so a returning visitor made about fifteen revalidation round
trips before the app ran. Each page now links its own scripts and stylesheet with a fingerprint of
their contents (`app.js?v=1a2b3c4d5e6f`, `versionedHtml` in `lib/staticfiles.js`). A file asked for by
its current fingerprint is cached for a year (`immutable`). A changed file has a new fingerprint and
so a new address, so nobody is served an old copy. Pages themselves still revalidate, with an ETag of
what is sent, so a page whose scripts changed is new even when its own file is not.

### Housekeeping

- **Dead code removed:** five unused functions, 28 unused strings in `copy.js` (the old score, the
  removed sync sections, the method rows) and 55 style rules for removed features (camera scanning,
  the score card, the old link preview).
- **A stray `}` pair in `styles.css`** made browsers drop the rule after it,
  `#report-back[hidden] { display: none }`, which had never applied. It does now.
- **Out-of-date pages:** the Psyche Sync guide described a percentage score and a verdict, and the
  `package.json` description named romantic reports. Both now say what the app does. The README
  opens with a short note on current behaviour.

### De-identified, as the card is

The free card and the report have always blanked the reader's name before anything is sent. A Psyche
Sync sent both cards with the names on them, and the model wrote with them. Now each card goes as
**Person A** (the reader) or **Person B** (the other person), so no name reaches PsycheAI or the
model, and the prompt keeps those stand-ins unchanged. `restoreSyncNames` in `docs/app.js` puts the
first names back on the device before the result is shown or saved. Two people who share a first
name become *Jean A* and *Jean B*. A result written before this already has the names in it, and
passes through unchanged.

### The result goes back to the person whose link it was

A sync ran on the device of whoever opened the link, and the result stayed there, so the person who
shared their link never saw it unless it was sent to them by hand. Now it reaches them
if the person who synced chooses (`lib/syncbox.js`, `sendSyncBack` and `collectSyncs` in `docs/app.js`):
- **Locked with the link's key.** Whoever syncs with a personal link (`/c/<id>#<key>`) holds its
  key, and so does the device that made it. The finished sync goes with the sender's Psyche Card and
  its face, locked in the browser (AES-GCM, the link card's own lock), to `/api/sync/send`. The
  server keeps it under the owner's invite code, only after checking that the link exists and carries
  that code, so only someone given the link can leave anything. PsycheAI cannot read it.
- **Only the owner collects.** `/api/sync/inbox` takes the owner's invite secret. Their device asks on
  start and on coming back to the page, at most once a minute, unlocks each sync with its own link key,
  and acknowledges it (`/api/sync/done`), which deletes it. A sync that cannot be unlocked, for example
  because the link key has since been replaced, is cleared too.
- **Small and short-lived.** At most 20 syncs wait for one person, each up to 24,000 characters, for
  30 days.
- **Flipped for them.** `howToPartner.forA` and `forB` swap, so the tips written for the owner are
  addressed to them as "you". The row reads **New · Synced with you** with the sender's character in
  the circle, and a dot on **Syncs** shows until they open its **Results**. A sync from someone whose
  link was also waiting on that device answers that invite too.
- **Told in a popout, once.** The row and the dot were easy to miss for a reader who was not on
  **Syncs**, so syncs collected in one go are also announced in a popout (`saySyncsArrived`):
  *Pat synced with you*, with the sender's character tile, **See the results** (straight to that
  result) and **Later**. Several at once read *3 connections synced with you*, naming them, and the
  button goes to My Syncs. Either way the rows stay marked New until opened. It shows only when a
  sync arrives, so it never comes back on a later start. If another popout is open (the guess
  result, say), it waits for that one to close. The slim report bar stands down while it is open.
  There is still no push notification or email: PsycheAI holds no way to reach a reader, so a
  sync is collected only when the owner next opens the site.
- **Asked, each time.** Tapping **Sync?** on a waiting row, or syncing a pasted personal link, first
  opens a popout: *Share the results with Jean?* It explains that Jean will see the results and the
  reader's Psyche Card, locked so PsycheAI cannot read them, and that there is a Share button for
  later. The two buttons are **Yes, share with Jean** and **Sync without sharing**. Closing the
  popout cancels the sync (`askShareSync`). The first version was a tickbox, on by default, which
  shared before the reader had seen what they were sharing.
- **Or later, from the row.** A sync with a personal link keeps where it can go (`back` on the
  history entry). Until it is shared, its row has a **Share** button beside **Results**, which asks
  the same question with **Not now**. Once shared, the row reads *Synced · Shared* and the button
  goes; My Syncs says *Shared with Jean, with your Psyche Card.* A long `#p=` link has no key and no
  owner, so it is never asked and has no Share button.
- **Under the results.** The panel at the foot of a sync's results says first whether the other person
  can see them (`refreshCompatReturn`). Not yet, and it can be shared: *Share the results with Jean?*,
  *Jean cannot see these results yet…*, with **Yes, share with Jean**. Shared: *Shared with Jean*.
  Sent by them: *Jean shared these results with you*. From a long link, which cannot be shared:
  *Jean cannot see these results yet*, with **Send my link** so they make their own. It read *Want
  Jean to see it too?*, which did not say whether Jean already could.
- **Older syncs.** A sync saved before links were kept with it has only **Results**. Opening or
  pasting that person's personal link again, which lands on the list as *already synced*, keeps the
  link with that row (`keepLinkForSharing`), and its **Share** button appears.
- **Wording.** The waiting rows lose "only you see it". The FAQ, the privacy page and the Psyche Sync
  guide say the result reaches the link's owner, locked, if the sender chooses to share it, and that it is
  deleted once collected or after 30 days. A selftest holds them to `syncbox.KEEP_DAYS`.

**Wording.** "Compatibility" is "Psyche Sync" everywhere a reader looks, and the score is said the
way people say it:
- *78% in sync*, beside a band, on the result page.
- *% sync* under the PDF's ring.
- *We're 78% in sync on PsycheAI…* in the share text.
- The page is **My Syncs**, its button **See how in sync we are**, and the card tool **Sync**.
- The QR line on the card reads *Scan to see how in sync we are*.
- The `/compatibility-test` landing page keeps its address and "friend compatibility test" in its
  title, for search, and is otherwise about Psyche Sync.

**The free card is not romantic either.**
- It carries no attachment style any more: not in `CARD_SCHEMA`, not in the payload (`docs/card.js`
  drops an old link's `a`), and not in *Beyond your card*.
- Its first column is *With connections* (it was *With friends*: the column covers family and colleagues as much as friends, and still says nothing about romance).
- Love languages are labelled *Receives care as / Shows care as*. With a catalogue character the card now
  shows only *Shows care as*, beside *Most in sync with* (see "Most in sync with: the cast on every card").
- The relationship strengths and watch-outs are asked for as being with friends.
- The full premium report keeps *How you attach* and *Who suits you*.

**Card first.** A friend who arrives on a link and makes their card lands on their own card, not
in a comparison. A bar above it (`#sync-invite`) reads *You have a friend waiting to sync with you*;
its **Sync** goes to My Syncs, and the sync runs only when they tap it there. The invite is spent then, and restored
if the run fails. A reader who already has a card and opens a friend's link lands the same way. The
result stays on the friend's device.

**Written warmly, like the Psyche Card.** Both friends read a sync and may share it, so
`COMPATIBILITY_SYSTEM` has a `# Tone` section: warm, and at least neutral.
- **Differences, not faults.** Each one is framed with a way to make it work (*"Mei likes plans set
  early; Jun likes to decide on the day — agree a time, leave the rest open"*), with no fault labels
  (needy, cold, flaky, stubborn) and no prediction that the friendship will struggle.
- **Low scores said kindly.** A low score means *different, not incompatible*.
- **Schema wording.** The band is warm or neutral at every score (*Easy company*, *Good balance*,
  *Different rhythms*, never *Hard going*). The verdict opens with the truest warm thing. *What to
  look out for* names each difference neutrally (*Different paces*, never *Constant clashes*).
- **Type and trait notes.** These now describe what to agree on rather than what grates.
- **Honesty is kept.** The score is still not inflated: tone changes how a difference is said, not
  whether it is said.

`tools/selftest.mjs` pins these rules. The mock uses the same warm bands.

**The report is three blocks, on the page and in the PDF.** It had grown long and repetitive — five
scored dimensions, a biggest upside and a biggest risk that restated the verdict, and conversation
starters — and all of that is gone, from the schema as well as the page, so the model is not asked to
write it. What is left:

1. **The answer**: the score as a ring, the band in words, a verdict of two or three sentences under
   60 words whose first sentence is the sharpest true thing about the pair, and *What you share* as
   tags inside the same card.
2. **How it plays out**: two or three things that work and two or three to look out for, each with its
   evidence on one small line.
3. **The playbook**: three things for each person, two for both.

**How the types are weighed.** Until now the model was handed a mechanical line ("ENFP vs ISTJ —
shares 1 of 4 axes") and nothing about what it meant. `TYPE_AXES` in `lib/prompts.js` now says, and
the system prompt explains: **E/I matters most** (how much company and quiet each needs — a split is
a weekly negotiation over evenings and weekends), **S/N as much** (concrete and present against ideas
and possibilities — the usual reason two people feel off-wavelength), **T/F less** (how each decides
and fights; a difference balances a pair and costs most in arguments) and **J/P least** (plans against
open options). For work, J/P and T/F count for more than elsewhere, but E/I and S/N still lead. The
card carries only the four letters, so each letter's strength comes from the Big Five trait that
tracks it — extraversion for E/I, openness for S/N, agreeableness for T/F, conscientiousness for J/P —
and the derived facts say, per axis, whether each person's letter is *a lean*, *moderate* or *clear*:
two leans either side of the line are closer than their letters suggest. Sharing E/I and S/N lifts
the score; splitting both lowers it unless the scores show the gaps are small.

**The types have no section of their own.** A *Your types together* section, axis by axis, was tried
and taken out again: it made the report longer for something better said in passing. The model weighs
the types in the score and in what it writes, and says what they mean for these two in one or two
sentences at most, wherever it lands hardest — the verdict, a strength or a friction.

The five focus areas per basis and stance (*Briefing and direction*, *Whether problems reach you*… for
a manager) still go to the model, as what matters most on that basis, rather than as five scored
sections.

**The page's actions** are the paid report's card tools: three tiles, an icon over a short label —
**Download PDF**, **Share PDF** and **Close**. The download at the top and *Check someone else* are gone.

**The PDF is one page, in the premium report's design** (`buildCompatibility` / `laySync` in
`docs/pdf.js`):
- **The band:** the plum-to-purple band with the brand, *Emily & Jared* and *Psyche Sync · band ·
  date*. The score sits in a white ring at its right.
- **The verdict:** in the gradient box the report's *In one line* uses.
- **What you share:** as chips.
- **How it plays out:** *What works* and *What to look out for*, side by side, each point with its
  evidence.
- **How to relate to each other:** one column for each person, then *Both of you*.

It is laid out at the most generous of three settings that stays on one page; the last drops the
evidence lines. Two people with the same name are told apart as "(you)" and "(them)"
(`pairLabels`).

The prompt still says each thing once (a piece of evidence quoted once in the whole report; shared
ground not the strengths retitled), never talks about the data, quotes a phrase only whole, and calls
two people with the same name "<name> A" and "<name> B".

**"Got their link?"** in the Test compatibility popout opens a paste box right there, rather than going
to My Compatibility to find one. A link that is not one is refused in the popout; a real one closes it
and goes straight to choosing the basis, and backing out of that leaves the link in My Compatibility's
box. **The guide links** at the foot (*Instagram personality test*, *Compatibility test*…) show only on
the main page for a new reader.

**My Compatibility** is titled for whoever the device belongs to, and opens with one short sentence
on what a comparison is for: open someone's link and get a score, the five things behind it, what
works, what will grate, and what each of you could do differently — as a couple, as family or
friends, or as colleagues. It was two paragraphs; the second one restated the picker that appears
moments later, so it was cut rather than trimmed.

The box for a link that arrived some other way is one line, a field and **Check compatibility**: a
tapped link opens the comparison by itself, so pasting is the fallback. Below it, **My link** with
**Copy link** (the one share message), then what the link contains. The intro is one line: *Open a
friend's PsycheAI link for your Psyche Sync score: what clicks between you, what may grate, and how
to be a better friend to each other.*

Past results sit *above* the box that makes new ones. Someone returning to that page is far more
often looking for a report they already ran than starting another.

**"Your matches"** — the history table that used to close the personality report — was removed from
that page; past comparisons live only on the compatibility page now, under "Your compatibility
results". It stays in the downloadable PDF, which still lists history when the device has any: the
request was to change the live page, and match history is a record of what this device has done
rather than part of the model's read on the person, so the two are free to differ here without
breaking the rule that the page and the PDF have to agree on what the *report* says.

Opening someone's link opens a picker before anything is sent: **Romantic**, **Family / Friends**,
or **Professional / work**. The report answers that question and only that one.

This is a deliberate change from scoring several at once. A reader who picked "professional" does not
want to be told about their romantic prospects, the prompt is explicit about not hedging across all
three, and one basis done properly beats three done shallowly for the same output budget. Each basis
carries its own brief: romance turns on life direction, values, emotional safety and whether two
daily rhythms can coexist; family and friendship on shared interests, matching energy and low
friction; work on complementary strengths, standards, how each handles a deadline, and whether one
will quietly end up carrying the other.

The second basis covers **relatives as well as chosen friends**, and the brief says so rather than
the label alone changing: people do not pick their family, so where a pairing is one, the question is
not whether the two of them suit each other but how to get on well given they are already in each
other's lives.

### Three questions hiding inside "professional"

Picking work asks one more thing before running: are you **colleagues**, do you **manage** them, or
do you **report to** them?

They are not the same question. A manager wants to know how to get someone's best work without
losing them. Someone's report wants to know how to work for them and keep their footing. Peers want
neither. Answering all three with "complementary strengths and load balance" handed two thirds of
readers a report about the wrong thing — advice about delegation is useless to somebody with nobody
to delegate to.

So the stance, not the basis, picks the brief and the five scored dimensions:

| Stance | Dimensions |
|---|---|
| Colleagues | Complementary strengths · Standards and follow-through · Working rhythms · Handling disagreement · Load balance |
| You manage them | Briefing and direction · How they take feedback · Autonomy against oversight · Whether problems reach you · Keeping them |
| You report to them | Reading what they want · Getting a decision · Raising a problem safely · Visibility of your work · Room to grow |

Direction is asymmetric and easy to get backwards, so it is stated from the reader's side in the UI
("I am the superior of Jordan") and spelled out for the model as person A and person B — A is always
whoever scanned. The prompt says outright that getting it the wrong way round produces a report
confidently about the wrong person.

Because a power difference is exactly where a report like this could do harm, the prompt carries two
explicit constraints: stay even-handed — name what the junior person should do differently *and*
what the senior one is getting wrong, since a report that only audits whoever has less power is both
unfair and useless — and never write anything that reads as a method for pushing somebody out,
keeping them dependent, or getting round them. If a pairing looks bad the honest answer is to say so,
not to supply tactics.

The stance travels client → server → provider → prompt, and dropping it anywhere in that chain is
silent, because a peer brief is a perfectly valid brief. Both providers built the user turn
themselves and originally ignored the argument; a self-test now patches the prompt builder, calls
each real provider, and reads back what it actually passed.

### One number, then five

A single score for a whole pairing is unfalsifiable: it cannot show where the fit is strong and where
it is thin, and a reader has no way to argue with it. The profile side broke the Big Five into five
scored traits with evidence apiece for exactly this reason, and the compatibility side did not follow
until now.

The report scores **five dimensions** chosen for the basis that was picked — romance on values and
life direction, emotional safety, daily rhythms, how each gives care, and energy match; work on
complementary strengths, standards and follow-through, working rhythms, handling disagreement, and
load balance. Each carries its own score, a reading, and its evidence, drawn as the same bars the
trait scores use. The overall number is asked to be recognisably their weighted middle rather than a
separate impression formed first and justified afterwards.

Every strength and friction now carries an `evidence` field too. The profile schema has demanded
evidence per trait since it was written; this side had none anywhere, so a claim could be asserted
with nothing behind it. The prompt asks for the actual number or phrase — "her 77 agreeableness
against his 51", not "both are quite agreeable" — and says outright that a claim nothing supports
does not belong in the report.

### Arithmetic the model should not be doing

Set intersection and subtraction are things a model does slowly, expensively and sometimes wrongly: it
will miss an exact match, or offer a near-match as shared ground because the two words rhyme. So
`derivedFacts()` in `lib/prompts.js` computes them and hands them over as settled fact — exact
interest and value overlap (case- and punctuation-insensitive, so `coffee!` matches `Coffee`),
both Big Five scores side by side with the gap and whether it is close or wide, MBTI axis agreement,
and both confidence figures. The prompt says to reason from that block and not recompute it, which is
also what stops a report inventing a shared interest neither person has. `docs/copy.js` already
refuses to ask the model twice for anything derivable, on the grounds that a second answer can
disagree with the first; this is the same rule applied to the second call.

The result is a score, an honest verdict, what works, what to look out for, and a playbook addressed to each
person individually about the other. Paste their link again to compare on a different basis — the
picker appears on every read, whether the link was tapped or pasted.

**Share PDF** hands the share sheet that same PDF, the file **Download PDF** saves, with the one
share message. Where a browser cannot share files, it downloads it instead.

## Tests

```bash
npm test           # 986 checks: synthesises a real ZIP export and runs
                   # unzip → parse → digest → card → link → decode; proves the
                   # digest caps and budget hold on a heavy account; checks the
                   # image selector spans the timeline and drops what it should;
                   # validates both prompt schemas against the structured-output
                   # rules and the keyword subset Gemini supports; exercises
                   # every branch of provider selection; and drives the
                   # automatic-retry logic against fake SDKs standing in for
                   # all three real providers
npm run test:ui    # 1191 checks: drives the real UI in Chromium against a
                   # mock-mode server, upload through to a compatibility report.
                   # Decodes and re-encodes the fixture's real PNGs, and asserts
                   # against the actual request body that the images sent are
                   # JPEGs, are not the originals, and vanish on opt-out — an
                   # opt-out now made in the pre-send review dialog, checked
                   # against the real request body rather than UI state alone.
npm run test:live  # three real model calls: the free report and a
                   # compatibility read on whichever provider is configured,
                   # then the paid analysis on whichever engine
                   # PSYCHEAI_PREMIUM_PROVIDER names. Skips cleanly without a
                   # key. PSYCHEAI_LIVETEST=premium runs only the paid call;
                   # =free runs only the other two.
```

`test:ui` needs Playwright (installed by `npm install`); add `--shots` to write screenshots to
`tools/screenshots/`.

Only `test:live` exercises the actual model call — everything else runs against `lib/mock.js`, which
returns schema-shaped canned data so the rest of the pipeline can be tested without tokens. Run
`test:live` once against your own key before trusting the app end to end.

**The paid call is covered there now, and it was not before** — which is the whole reason the
compiled-grammar 400 above reached production. It was the only call that always runs on Claude and
the only one with no live coverage at all, so the schema that broke was the schema nothing ever sent
to the API that compiles it. `test:live` now sends it, checks all six wellness dimensions came back
with real bands, that no score or clinical condition appears in either the wellness read or the
roast, that the career actions carry real horizons with one startable this week, and — the line worth
reading — whether the schema **compiled** or the fallback carried it:

```
paid schema   : compiled and enforced by the API
paid schema   : REFUSED — the fallback generated this, nothing enforced the shape
```

A green run showing the second line is not the same as a green run. `PSYCHEAI_LIVETEST=premium` makes
that one call and nothing else, which is the cheap way to check after touching the paid schema.

Wiring this up surfaced a second thing worth naming: the compatibility half of `test:live` had been
broken since the basis picker landed. It called `analyseCompatibility(card, other)` with no mode and
then read `compat.romantic.score` and `compat.platonic.score` — a two-mode shape `COMPATIBILITY_SCHEMA`
stopped producing when the reader started choosing one basis up front. It threw on every run, before
reaching anything after it. Nobody noticed, because a live test that costs real tokens is one nobody
runs casually, which is exactly the argument for keeping it honest.

## Layout

```
docs/                 the browser app — no build step
  index.html          app shell
  app.js              upload, profile report, sharing, compatibility report
  zip.js              ZIP reader (ZIP64-aware, inflates only the JSON entries)
  instagram.js        export parser → normalised signals
  digest.js           signals → the bounded evidence digest that gets sent
  card.js             shareable card ⇄ compressed link payload
  copy.js             every string the page and the PDF both show, written once
  pdf.js              writes the downloadable report — a small PDF writer, no library
  llm.js              client for the two server endpoints
lib/
  prompts.js          both system prompts and both output schemas, provider-neutral
  provider.js         picks Gemini, Claude, Grok or mock from the environment
  grok.js             the openai SDK, pointed at xAI's API
  gemini.js           the Google GenAI SDK calls
  claude.js           the Anthropic SDK calls
  mock.js             canned analyses for tests and for clicking around
  ratelimit.js        per-caller token buckets on the routes that cost money
  nonce.js            signed tickets for those same routes
server.js             static hosting, the API routes, and the guard table in front of them
tools/                test suites, the synthetic export fixture, model listing
promo/                the Instagram promo video: npm run promo (see promo/README.md)
```

The promo video's closing link ("Link in bio" today, the site's address later) is one line in
`promo/config.json`; `npm run promo` rebuilds the voice, music and picture around it.

## What this is not

Not a validated psychometric instrument, not a diagnosis, not a background check. A language model
reading behavioural traces is a mirror and a conversation starter. A low compatibility score is a
list of things worth talking about, not a reason to walk away — and a high one is not a promise.
