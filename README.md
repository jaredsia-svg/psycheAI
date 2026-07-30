# 🧠 PsycheAI

*The personality analysis you didn't know you needed.*

Upload your Instagram data export. PsycheAI unpacks it in your browser, distils it into an evidence
summary, and hands that to a language model — **Google Gemini** or **Anthropic Claude** — which
writes you a detailed profile: your Big Five and a long-form MBTI reading with the reasoning behind
each, a behavioural read of how you actually use Instagram, your interests, beliefs and values, and
your strengths and weaknesses — both in relationships and in your career. Export the whole thing to
PDF when you are done.

That profile is tagged to a **QR code**. Scan someone else's, choose whether you are asking as
**partners**, **friends** or **colleagues**, and the model assesses how the two of you would work
together on that basis, with a playbook aimed at each of you about the other.

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
```

Or click through the whole app with canned analyses and no API calls:

```bash
npm run mock              # http://localhost:3000, PSYCHEAI_MOCK=1
```

Camera scanning needs HTTPS or `localhost`; pasting a link and uploading a photo of a code always
work.

### Choosing a provider and model

| Variable | Effect |
|---|---|
| `GEMINI_API_KEY` | Uses Gemini. Takes priority if both keys are set. |
| `ANTHROPIC_API_KEY` | Uses Claude. |
| `PSYCHEAI_PROVIDER` | Forces `gemini` or `anthropic` when you have both keys. |
| `GEMINI_MODEL` | Gemini model ID. Default `gemini-3.6-flash`. |
| `PSYCHEAI_MODEL` | Claude model ID. Default `claude-opus-5`. |
| `PSYCHEAI_MOCK=1` | Canned analyses, no API calls. Beats everything else. |

Gemini model IDs change often, so the default here will go stale. List what your key can actually
reach:

```bash
npm run models            # needs GEMINI_API_KEY
```

`gemini-3.6-flash` is the default because it is generally available and cheap enough to re-run
freely. For a deeper read try `GEMINI_MODEL=gemini-3.1-pro-preview`, which is stronger at reasoning
but preview-only.

Both providers share the same prompts and the same output schemas (`lib/prompts.js`) — Gemini's
`responseJsonSchema` accepts real JSON Schema, so nothing is translated between them. The server
picks a provider at startup and the rest of the app never knows which one ran.

## What is sent where

This is the part worth reading carefully.

| Stays on your device | Sent to the model |
|---|---|
| The `.zip` archive itself | An **evidence digest**: activity counts, hour-of-day and day-of-week histograms, posting regularity, a sample of your own captions and comments, accounts you follow, and the topics Instagram itself inferred about you |
| Every video — never opened | By default: about **14 of your own photographs**, downscaled, spread across your whole account history |
| Your full long-form report | The compact **card** — the same profile as short phrases — when someone runs a comparison |
| Direct messages, if you untick the box | By default: DM counts plus a sample of **your own** messages — never the other side of a conversation |

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
| Your own DMs | 280 — included by default, untick the box before uploading to exclude them |

A small account sends about 6KB; a heavy one with thousands of posts lands around **150KB**, well
inside the 600KB ceiling and a small fraction of either provider's 1M-token context. The digest
carries a `coverage.sampling` field saying what fraction of each source the model is seeing, and the
prompt tells it to factor that into its confidence score rather than treating the sample as the
whole picture.

### The photographs

Text alone leaves a real blind spot: a wordless photo of a summit and a wordless photo of a
nightclub are the same row in the digest. So **a small sample of images is sent by default**, and
the switch on the upload page turns it off.

`docs/images.js` picks them. Candidates are the stills the JSON references — carousels contribute
only their cover frame, videos never qualify, and anything under 12KB is discarded as a thumbnail
or a screenshot of text. Each is scored: posts outrank stories, **wordless posts get a bonus**
because they are precisely what the digest cannot see, and larger files break ties. Then the
timeline is cut into as many buckets as there are slots and the best of each bucket is taken, with
no two picks from the same day — so the result spans first post to last rather than fifteen photos
from one good summer.

The chosen images are decoded, downscaled to a 768px long edge and re-encoded as JPEG **in the
browser**, which also strips whatever EXIF the originals carried, GPS included. About 14 images
land near 1MB of base64 and add roughly $0.01 to a Gemini Flash run.

The prompt's limits on them are stricter than anything else in the app, and the test suite pins
each one: nothing about any other person in the frame, nothing about anyone's race, body, age,
attractiveness or wealth, no reading a location closely enough to place someone, and no quoting
text out of a photo. What the model may use is the setting, the activity, whether someone is alone
or in company, and the care taken over the shot.

The images are held in memory only. They are never written to localStorage, so re-running the
analysis after a page reload uses the written evidence alone unless you upload the `.zip` again.

**Direct messages are included by default**, because how someone writes to people who already know
them is the most revealing text in the export. Only the user's own messages are ever sampled — the
other side of every conversation is counted for the statistics and then discarded, before anything
leaves the browser. The switch on the upload page turns the whole thing off.

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

### What the model is told not to do

Identify or speculate about specific other people in your data, or infer sexual orientation, health
conditions, immigration status or political affiliation unless you have stated it outright in your
own words. It does not classify anyone by appearance or by the demographics of who they follow, and
the photographs carry the further limits described above. These guardrails are asserted by the test
suite so they survive edits to the prompt.

## What the report contains

It opens on **one noun** — an animal, a material, a place, a trade, with an emoji and the reasoning
for why that one and not a neighbouring one. The prompt asks for something concrete and slightly
surprising, and explicitly rejects a compliment in a costume ("Diamond", "Star") or a restatement of
a hobby. Because a model told to send exactly one emoji will occasionally send a sentence, the
client checks the glyph and substitutes a placeholder rather than printing prose where the icon goes.

Under the noun sits a **glance strip** — MBTI type, highest and lowest Big Five trait, attachment
read — then a two-or-three-paragraph summary that lands the findings from every section below, so
someone who reads only the opening still leaves with the answers. The strip is derived in
`docs/app.js` from the sections themselves rather than asked of the model a second time: restating
them in another field costs tokens and creates something that can disagree with itself. A UI check
compares the strip against the trait bars to prove it cannot.

Then Big Five with per-trait evidence; interests, beliefs and values; relationship and career
strengths and weaknesses — the **attachment** guess shows its working, naming the behavioural traces
it rests on, the style it rejected, and what it means in practice for them and for a partner, since
a named style with no reasoning is worthless and slightly harmful.

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

**Instagram behaviour**, which is the part of the export nobody reads themselves: what they post and
in what mix, when they reach for the app, how their use changed month by month, whether they publish
more than they read, and what the shape of their following and liking says about where attention
goes. Each implication pairs one concrete observation with one hedged inference, so the reader can
tell a fact from a guess.

## Exporting to PDF

Buttons at the top and bottom of the profile call `window.print()`, and `@media print` in
`styles.css` *is* the PDF. The document opens on a letterhead — brain mark, wordmark, PERSONALITY
PROFILE, the subject's name, the date and the confidence score — because the nav bar that carries
the brand on screen is dropped. Sections become rules-and-whitespace rather than boxes, the QR code
squares off at 150px, and everything is set at 9.6pt on A4 with 15mm margins.

Two constraints shape every rule:

**Backgrounds do not print** unless the reader ticks a box in the dialog, so nothing may depend on a
fill. Every accent is a text colour or a border, both of which always print. A UI check walks the
tiles, callouts, chips and icon frames and fails if any of them has an opaque background under print
media.

**Breaks land between items, never through one.** Sections flow and pack, so two short ones share a
page rather than each claiming a sheet. What is unbreakable is the level below: a trait with its bar
and evidence, an MBTI axis, a tile, a facet, a love language, a term with its definition. A break
falls in a gap.

**One size for every word.** `#view-profile *` is set at 10pt in print, with the letterhead name,
the wordmark, the section titles and the noun as the only deliberate exceptions — hierarchy comes
from weight, case and colour instead. A UI check walks every text node under print media and fails
on any that is not 10pt, because the rem-based sizes from the screen stylesheet leak in otherwise
and the document ends up looking assembled from parts.

The section glyphs are dropped from the printed headers. They sit on a tinted tile, and that tint
was showing as a pale marking at the top left of every heading for anyone who prints with
*Background graphics* ticked; the emoji itself is a colour bitmap that smears at heading size.

This is deliberately not a bundled PDF library. A dozen pages of long-form text is exactly what
print CSS is for — the text stays selectable and searchable, pagination and paper size are the
browser's problem, and it adds nothing to the page weight. `html2canvas` and friends would rasterise
the same report into a fuzzy image and cost 200KB. The trade is that the user picks *Save as PDF* in
their own print dialog rather than getting an automatic download; the page says so under the button.

## The QR code

Along with the long-form report the model produces a compact **card** — the profile reduced to short
labelled phrases. `docs/card.js` trims it to hard limits, deflate-compresses it and base64url-encodes
it, which gets a rich profile down to **roughly 600–900 characters**: dense, but scannable off a
phone screen. There is nothing to look up and no account to create.

The card is also exactly what the compatibility call receives, so whatever is trimmed is invisible to
the other person's report — and your long-form report never leaves your device.

## Compatibility

Reading someone's code opens a picker before anything is sent: **Romantic**, **Platonic**, or
**Professional / work**. The report answers that question and only that one.

This is a deliberate change from scoring several at once. A reader who picked "professional" does not
want to be told about their romantic prospects, the prompt is explicit about not hedging across all
three, and one basis done properly beats three done shallowly for the same output budget. Each basis
carries its own brief: romance turns on life direction, values, emotional safety and whether two
daily rhythms can coexist; friendship on shared interests, matching energy and low friction; work on
complementary strengths, standards, how each handles a deadline, and whether one will quietly end up
carrying the other.

The result is a score, an honest verdict, what works, what will rub, and a playbook addressed to each
person individually about the other. Scan again to compare on a different basis — the picker appears
on every read, whether it came from the camera, a photo of a code, a pasted link or a shared URL.

## Tests

```bash
npm test           # 189 checks: synthesises a real ZIP export and runs
                   # unzip → parse → digest → card → QR → decode; proves the
                   # digest caps and budget hold on a heavy account; checks the
                   # image selector spans the timeline and drops what it should;
                   # validates both prompt schemas against the structured-output
                   # rules and the keyword subset Gemini supports; and exercises
                   # every branch of provider selection
npm run test:ui    # 225 checks: drives the real UI in Chromium against a
                   # mock-mode server, upload through to a compatibility report.
                   # Decodes and re-encodes the fixture's real PNGs, and asserts
                   # against the actual request body that the images sent are
                   # JPEGs, are not the originals, and vanish on opt-out
npm run test:live  # 15 checks: two real model calls against whichever provider
                   # is configured. Skips cleanly without a key.
```

`test:ui` needs Playwright (installed by `npm install`); add `--shots` to write screenshots to
`tools/screenshots/`.

Only `test:live` exercises the actual model call — everything else runs against `lib/mock.js`, which
returns schema-shaped canned data so the rest of the pipeline can be tested without tokens. Run
`test:live` once against your own key before trusting the app end to end.

## Layout

```
docs/                 the browser app — no build step
  index.html          app shell
  app.js              upload, profile report, QR, scanner, compatibility report
  zip.js              ZIP reader (ZIP64-aware, inflates only the JSON entries)
  instagram.js        export parser → normalised signals
  images.js           picks ~14 photos worth looking at, downscales them
  digest.js           signals → the bounded evidence digest that gets sent
  card.js             shareable card ⇄ compressed QR payload
  llm.js              client for the two server endpoints
  vendor/             qrcode (generation) · jsQR (scanning)
lib/
  prompts.js          both system prompts and both output schemas, provider-neutral
  provider.js         picks Gemini, Claude or mock from the environment
  gemini.js           the Google GenAI SDK calls
  claude.js           the Anthropic SDK calls
  mock.js             canned analyses for tests and for clicking around
server.js             static hosting + /api/analyse + /api/compatibility
tools/                test suites, the synthetic export fixture, model listing
```

## What this is not

Not a validated psychometric instrument, not a diagnosis, not a background check. A language model
reading behavioural traces is a mirror and a conversation starter. A low compatibility score is a
list of things worth talking about, not a reason to walk away — and a high one is not a promise.
