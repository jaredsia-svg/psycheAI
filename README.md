# 🧠 PsycheAI

*The personality analysis you didn't know you needed.*

Upload your Instagram data export. PsycheAI unpacks it in your browser, distils it into an evidence
summary, and hands that to a language model — **Google Gemini**, **Anthropic Claude** or **xAI Grok**
— which writes you a detailed profile: your Big Five and a long-form MBTI reading with the reasoning behind
each, a behavioural read of how you actually use Instagram, your interests, beliefs and values, and
your strengths and weaknesses — both in relationships and in your career. Export the whole thing to
PDF when you are done.

That profile comes with a personal **compatibility link**. Send it to someone; once they open it and
make their own card, they choose whether they are asking as **partners**, **family or friends**, or
**colleagues** — and if colleagues, who reports to whom — and the model assesses how the two of you would work together on that basis, with a playbook aimed
at each of you about the other.

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

Camera scanning needs HTTPS or `localhost`; pasting a link and uploading a photo of a code always
work.

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
grouped card number, a postcode after "Singapore"); other people's @handles become "[P1]", "[P2]";
links are stripped; and activity dates — `rhythm.firstActivity`/`lastActivity` and each source's span —
are given to the month (`monthSpan`, applied again in `forModel` for digests stored before). The review
popout says so at its top in one line (`.deid-note`: "De-identified before sending. Your name, contact
details, ID numbers and other people's handles are removed.", set small at `.76rem` so it does not crowd
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

- **Nothing added:** the card's own 80,000-character digest is sent as it is, the payment sheet
  follows directly, and the card is **anchored, not redrawn** — the report explains the card the
  reader already has.
- **A source added or replaced:** that digest plus the new source, reviewed as what will be sent;
  the run redraws the card from it as well as writing the report. This holds even when the Instagram
  export is still in memory — it is not rebuilt wider. The standard digest takes the same new source,
  so later free runs see it.
- **Instagram itself loaded again:** the base is the standard digest of the new export (with the
  sources it already had), and anything else added goes on top the same way.
- **The paid re-run** (Add / change data after unlocking) builds and sends the premium read the same way.

The paid call sends `deep: true` only when something was added; the server allows the larger digest
only on a paid unlock that asks for it, rebuilds it field by field and re-applies the weights if
anything is over. The premium digest is not kept afterwards: the next unlock starts from the standard
digest again. The two calls an unlock can make are held to **$0.247 together** at their worst: $0.079
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

**Mental wellness, Attachment style, Career assessment and Let us roast you** sit behind a single
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
{"ready":true,"mock":false,"freeAnalyses":1,"shortLinks":true,"reportLayout":"structured","build":{"version":"3.0.0"}}
```

It used to also return the provider and model, the premium engine, the exact commit and branch, the
deploy time and platform, the payment settings, and a hint naming any missing API keys. With the code
public, that told anyone exactly which version was live, including any window before a fix was
deployed. None of it was needed by the page:
- Stripe's publishable key comes back with each payment intent.
- Prices come from `docs/prices.js`.
- The footer now shows only the version (`v3.0.0`), with no commit link. The PDF's running head
  does the same.

The operator still sees the build: the server logs the version, commit, branch and platform at
startup (`Build: v3.0.0 · 02f449d · <branch>`), and Render's dashboard shows the deployed commit.

When the server has no provider, the page says only that analyses are unavailable right now.
`tools/selftest.mjs` pins the exact set of keys, so a new field cannot be added without a test change.

The reader's own report still names the model that wrote it (*Psyche Card generated by … on …*).
That comes from their own analysis response, not from this route, and the privacy policy names
Google Gemini and Anthropic Claude as processors anyway.

### Security headers

Every response — static and API alike — carries a CSP, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`, set before the
request branches so no route can be added that forgets them.

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
`.btn` — a page with `#hero-sample` and this button both filled and both saying the same three words
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
at before paying for it. On a phone it drops under the title, right-aligned.

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
three are loaded, and a fourth starts a fresh set.

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
| `ANTHROPIC_API_KEY` | Uses Claude for the free report if `GEMINI_API_KEY` is not set. |
| `XAI_API_KEY` | Uses Grok for the free report, if neither of the above is set. Fully supported, just not the default. |
| `PSYCHEAI_PROVIDER` | Forces `gemini`, `anthropic` or `grok` for the free report when you have more than one key. |
| `PSYCHEAI_FREE_ANALYSES` | How many analyses a browser gets before being asked to pay. Default `1`. A fair-use allowance held in the browser, not enforcement — see ["One free analysis, then US$2"](#one-free-analysis-then-us2--and-what-actually-stops-a-runaway-bill). |
| `PSYCHEAI_DAILY_FREE_LIMIT` | Server-wide ceiling on free model calls per UTC day. Default `200`, about US$50/day at `COST_CAP`. This is the one that actually bounds the bill. A non-numeric value throws at boot rather than failing open. |
| `PSYCHEAI_BUDGET_FILE` | Where that day's tally is appended. Default `data/budget.jsonl`. Holds a date, a kind and a timestamp per row — nothing that could identify a caller. |
| `PSYCHEAI_PREMIUM_PROVIDER` | Which engine runs the four paid sections, independent of the free report's provider above — `gemini` or `anthropic`. Default `gemini`. Set to `anthropic` to revert the paid call to Claude Sonnet 5; needs that provider's own key regardless of which one the free report is using. |
| `PSYCHEAI_GEMINI_THINKING` | Gemini's thinking level for the card and the full premium report: `MINIMAL`, `LOW`, `MEDIUM` (default) or `HIGH`. Takes effect on restart, no deploy needed. At `HIGH`, Gemini 3 Flash thinks until its output cap is nearly spent, which cut the answer off on 3.8 and is why the default is `MEDIUM` (see [Which model, and going back](#which-model-and-going-back)). An unrecognised value is logged and ignored. |
| `PSYCHEAI_COMPAT_THINKING` | Gemini's thinking level for the Psyche Sync call alone: `LOW`, `MEDIUM` or `HIGH`. Unset, it follows `PSYCHEAI_GEMINI_THINKING` (`MEDIUM`). The current model refuses `MINIMAL`. Takes effect on restart. See [What a compatibility costs](#what-a-compatibility-costs). |
| `PSYCHEAI_REPORT_LAYOUT` | `structured` (default) or `classic`. Which report the unlock writes and the page and PDF draw — see [The structured report](#the-structured-report-four-parts-one-thread). Set `classic` to go back to the previous format with no deploy: the prompt, the schema, the page and the PDF all switch together. An unrecognised value is logged and treated as `structured`. |
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
- **The card's thinking level, `MEDIUM`** (`PSYCHEAI_COMPAT_THINKING` to change it). It was `MINIMAL`
  for a while, to save that thinking, but the current Gemini model refuses `MINIMAL` and every sync
  failed with a 400. So a sync costs about 1.5–2¢ again.
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
  preview. The old `og-card.png` is kept for now, so previews that apps cached before the switch
  still resolve. `node promo/og.mjs` draws the preview from the brand mark and the sample Psyche Card,
  with the home-screen icons beside it (`icon-192`, `icon-512`, `apple-touch-icon`) that
  `docs/manifest.webmanifest` names. Those were re-saved losslessly: `icon-512` went from 103 KB to
  48 KB. If they are redrawn, run them through `PIL`'s `optimize=True` again.
- **One `<h1>` and a `favicon.ico`.** The front page's document has a single `<h1>`, the hero's.
  Each app view's title (My Psyche, Your Syncs, the sync popout, FAQ, the print letterhead) is a
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
- **`robots.txt` and `sitemap.xml`** list the front page and the guides and keep `/api/` out.
- **Request the export first.** The export takes Instagram hours to send, so the hero's second button
  is **Request data**, which goes to the steps card, titled *Request your Instagram data first* with
  *It takes 30 seconds. Instagram then emails you the file, usually within a few hours.* under it.
  The illustrated guide it opens is titled *Request your Instagram data*.
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
  free.* — with **Show me how** for the export steps, and spent on the first card the device makes,
  which goes straight into the compatibility analysis. There is no button to throw it away; it
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
export (`accountKey()` in `docs/app.js`, kept as `psycheai_account`). The server scrambles that once
more and keeps it in one set; a second free card for an account already in it is refused with
`402 { freeUsed: true }`, and the page opens the US$2 re-run sheet with *"This Instagram account has
already had its free Psyche Card. Run it again for US$2."* The check runs after the result cache, so
the exact same summary again is answered free (it is the card already made), and before anything is
spent. Paid runs, promo codes and requests without a username are not limited by it; the daily
budget still bounds them. `PSYCHEAI_FREE_PER_ACCOUNT=0` turns it off.

## Invite three friends, get the full report free

Each browser makes a random secret (`psycheai_referral`); its public code is the first 12 hex
characters of the secret's SHA-256 and goes in the reader's invite link, `psycheai.io/?ref=<code>`.
A friend arriving on it keeps the code for 60 days (`psycheai_referred_by`). When the friend's
**first** free card is written, their account is added to that code's friends — once per friend
account, for one referrer only, and never the referrer's own account (tied to the code when the
referrer makes their own card). **Every three friends earn one free full premium report.**

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

On My Syncs one card, **Psyche Sync**, lists them all:
- **Friends waiting** come first, latest first, as dashed rows ("Waiting to sync with you · free, only
  you see it"), each with a **Sync** button.
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
Syncs (titled **Your Syncs**, the same size as My Report's title) with a note, *You have already synced with Jared — it is in your list
below.* Syncs saved before the fingerprint existed are matched by the friend's name. A different
friend's link, or the same friend with a new card, still waits as usual.

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

## Your link: its numbers, free reports, and gifts

My Psyche ends with a **Your link** card, below Evidence and method, free or paid. It opens with what
the link earns: *Every 3 friends who make their card from your link, or 2 who buy the full report,
earn you a free full report.* Then it says *Share your card or link above*. The card has no
copy or share buttons of its own; the card's **Share Card** and **Copy link** carry the same link.

Three purple boxes give the counts:
- **made a card**
- **bought the full report**
- **synced with you**

Opens are still counted for the reader's link, but not shown.
Where each number comes from:
- *opened it*: each browser's first open of someone's link that day, sent with `/api/event`
  `referral_open` and the link's code, then `ref:<code>:opens`.
- *made a card*: friends' first free cards, `ref:<code>:friends`.
- *bought the full report*: friends who paid for the full report with a real Stripe payment, not
  a promo code or a grant. Counted once per buyer account, never the owner's own:
  `ref:<code>:paid`, written by `referral.afterPaid` after the report is written.
- *synced with you*: friends' syncs with the card from the reader's link, at most one a day per
  browser, sent with `/api/event` `sync_done`, then `ref:<code>:syncs`.

**Credits.** Every 3 friends' cards earn a free full report, and so does every 2 paid reports. The
two add up: `earned = floor(friends/3) + floor(paid/2)`. Syncs are shown but earn nothing. The card
shows progress towards both. Only when a report is ready does it show two buttons:
- **Use it** opens the unlock, or on a full report the re-run with new data. The sheet's *Use your
  free full report* claims a grant.
- **Gift it** claims the grant with `{ gift: true }` (counted as `referral_gifted`) and shares or
  copies `psycheai.io/?gift=<grant>`. The link is listed under the card
  (`psycheai_gifts_made`) so it can be copied again.

**Receiving a gift.** The grant is a bearer token: it unlocks one full report, once, within 60
days, for whoever holds it.
- Opening the link keeps it on the device (`psycheai_gift`) and takes it out of the address.
- A 🎁 banner says a free full report is waiting. On the welcome page it says to make a card first;
  on a report it offers to unlock.
- The unlock sheet offers *Use your gifted free full report* ahead of the reader's own credit.
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
- My Syncs' **Copy link**;
- the roast's story image, and **Share PDF** on a sync's result;
- the classic layout's Send my link.

A gift link keeps its own message, since it is a different link. The free card's unlock button
also names the other way in: *or get 3 friends to make their Psyche Card from your link*.

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
you confirm you are 18 or over and agree to the terms and privacy policy* (`#review-legal`). Its
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
  - Beyond your card
  - Evidence and method
  - Your link

  Once paid, the way into My Report is **See Psyche Report →**, one button across the card's three
  tools (`.cx-open-report`), with an arrow on its right (`.cx-open-arrow`) that nudges right on hover. A free reader has the unlock box under Beyond your card instead. The card
  panel and, on a phone, the top of the card's box carry the same light wash as My Syncs' header.
  The panel's purple top line is part of its background rather than a `::before` strip: the panel
  cannot clip (the card's popouts spill out of it), so a strip ran square past its rounded corners.

  A free reader sees the same page, with the unlock box in place of the tile. My Psyche has no
  *Download full report*; its footer is **Delete everything** with the run's note (model and
  date) right beside it.
- **My Report** (`go('full')`, nav `#nav-full`) opens with a header built like My Syncs' one
  (`reportHeroHtml`, `.report-hero`): a purple pill, the title **Your Psyche Report**, a one-line
  lede (*The working behind your Psyche Card: what each result means, the evidence for it in your
  own data, and what to do with it.*), and the character's emblem in a gradient disc. The pill reads
  *5 parts · N pages*. N is counted from the real PDF (`reportPdfPages` builds it when the browser is
  idle, counts its pages, and caches the count per report), so until then it reads *5 parts*.
  The part nav has no title of its own and no purple line on top (`.part-nav.is-report`). On a
  laptop it is the left column, its top level with the header (`--side-nav-top`, measured in
  `layoutSideActions`). On a phone (under 760px) there is no part nav at all: nothing floats over the
  report, and the part headings are the way between parts. Part heads
  are smaller than before: the title is 1.15rem, the number about 2rem. Then come Parts 00 to 05. Part 05, the appendix (only the roast
  now), opens and shuts like the others. The card is not repeated at the top. The left bar's action
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
lands on My Report at Part 00, with a note: *Your full report is ready.* A classic-layout report stays on
one page.

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
  `/api/premium`, it is refused: *That code takes 50% off the full report. Enter it on the payment
  sheet and pay the rest.*
- **A use is spent when the paid report is written**, not when the sheet is opened, and counted under
  `promo:HALF` in the stats like any other code. Expiry and the cap are checked before anyone pays;
  a reader who paid just as the cap ran out is still served.
- **Never below Stripe's minimum charge** for the currency (`MINIMUM` in `docs/prices.js` — 50 cents,
  30p, HK$4, ¥50, RM2): a 95%-off code charges the minimum rather than an amount Stripe would refuse.
  Codes apply to the full report only; the US$2 extra card keeps 100% codes.

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
right before `showModal()`: `'Make payment'` when true, the unchanged `'Send this'` otherwise. Nothing
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
- The review's Send button always reads "Make payment" — unconditionally, regardless of whether a free
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
1. **Instagram (required).**
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

### The structured report: four parts, one thread

The default layout since this change. The classic report was a run of sections that never referred
to each other; the structured one is laid out the way professional assessments are, with one thread
through it. The structure is borrowed and the wording is not: every definition, label and framework
here is either this app's own or a published academic model.

| | Sections |
|---|---|
| **Overview** | Executive summary · **Your signature patterns** |
| **Part 1 – Who you are** | MBTI (first, as the type readers look for) · Big Five, drawn as spectrums with both poles described and the typical band shaded (labelled an estimate). The model still writes the Big Five first, since the E/I letter is checked against the extraversion score; only the display order differs · Wellbeing, as the last section of the part |
| **Part 2 – What drives you** | **What motivates you** (Schwartz's ten basic values, ranked against each other, grouped by his four higher-order values) · Interests · Values & beliefs |
| **Part 3 – How you connect & work** | In relationships (love languages, attachment style and ideal partner in one section) · **How you work** (the description and the coach's read, one section instead of two) |
| **Part 4 – Putting it together** | **Development plan** (build on / develop, each naming the pattern it resolves and the sections that raised it; each develop area carries the strength it tips over from, two early signs, a counter-move and a reflection question) · **Your plan** (about five actions, one column per horizon in the PDF) |
| **After Part 4** | Evidence and method, on its own: the confidence score and why, what was counted in full, and the data sources |
| **Last** | The roast, after the method rather than mid-report, with no heading of its own |

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
relationship sections (`attachment`, `idealPartner`, under *How you connect & work*). The rules
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
each named by a tooltip (`data-tip`), placed at the nav's measured foot (`--side-nav-bottom`,
`layoutSideActions()`). On a phone, beside a full report, they are one row of three equal tiles across
the screen, an icon over a small label each, in the card tools' own style, Delete in red; whichever
label wraps, the three stay the same height. **On a phone the part nav is one thin bar** stuck under the site's header
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
change is additive: a report written in this layout still renders classic, and `?layout=classic` or
`?layout=structured` on any page draws the same stored report either way for comparison. The extra
prompt is about 2,800 input tokens, and the four fields are sized at roughly two ordinary sections of
output; `FIXED_INPUT_TOKENS` rose to 37,600 and `COST_CAP` to $0.151 to keep the 80,000-character
digest inside the cap. **To revert**, set `PSYCHEAI_REPORT_LAYOUT=classic`.

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
explained by a new **`attachment.conflict`** ("In conflict", under the attachment read on the page
and in the PDF), which opens with the card's words; social energy and contact are what
`wellness.socialConnection` explains; and each work cost is one of what holds them back
(`careerAssessment.holdingBack` or `career.weaknesses`).

**Each basis is pointed at the fields that decide it** (`lean` on each mode and work stance, printed
in the request): romantic leans on conflict style, attachment, love languages, motivators and
values, rhythm, relationship watch-outs and neuroticism; friends on interests, contact, extraversion,
conflict and agreeableness; colleagues on strengths and work costs, work style, conscientiousness,
conflict and rhythm; a manager on their report's motivators and work costs and both conflict styles.
The derived facts add the top motivators the two share.

**Beyond your card** (`beyondCardHtml`) shows these lines to the reader, on a free report, between
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
- **`lib/prompts.js`:** `COMPATIBILITY_MODES` has the one key `platonic`, labelled *Friends*, and
  `resolveMode` returns it for anything. `COMPATIBILITY_SYSTEM`'s *Friends only* section rules out
  romance, attachment and work. `WORK_STANCES` is gone.
- **Old reports:** reports saved on the old bases still open on the reader's device, labelled as
  they were.

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
- Love languages are labelled *Receives care as / Shows care as*.
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
