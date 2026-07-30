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

### Making the code scannable

A whole profile is a lot of data for a QR code — about 630 characters, which comes out around **87
modules across**. Everything about scanning reliability follows from pixels per module, and there are
two places to lose them.

The canvas is backed at **900px and displayed at 300**, so module edges stay sharp on a high-DPI
screen instead of being upscaled into grey mush that a lens then has to guess at. And the camera is
asked for **1920×1080**; the default stream is often 640×480, which puts this code at about a
pixel and a half per module and simply never decodes. A simulated 480p frame with the code filling
55% of its height is a UI check, and it fails against the old 300px backing.

The downloadable image is rendered fresh at **1600px with a four-module quiet zone** rather than
reusing the display canvas, because a saved file gets viewed at whatever size a photo app picks — at
300px wide it is back to three pixels per module and unreadable. It is written as a JPEG at quality
0.95 through a Blob URL: a detached anchor click is ignored by Firefox, and Safari will not honour
`download` on a large `data:` URL. Lossless would be marginally more robust in principle, but at 17
pixels per module JPEG artefacts are nowhere near a module edge — the suite takes the real download
and decodes it at 1600, 600 and 400px.

Stills are the hardest case, because what someone actually uploads is rarely the pristine file — it
is a screenshot of a chat, recompressed, with the code a small off-centre part of a much bigger
picture. So `decodeStill` works through, cheapest first:

1. The whole image at 1600, 1100, 2400, 800, 600px and native size. jsQR locates a code best when
   the modules are a few pixels across, so a 12-megapixel photo often fails at native and reads
   instantly at 1600.
2. Failing that, **nine overlapping tiles** — halves stepped by quarters — each blown up to 1200px.
   This is what finds a code at 25% of a laptop screenshot. The overlap matters: a clean grid would
   cut a code straddling a boundary in half, and a single centre crop misses anything off-centre.

Every rendering is read twice, once as drawn and once through a global luminance threshold, which
rescues JPEG-softened edges and grey screenshot backgrounds. Both paths try inverted as well as
normal. The camera loop alternates a full frame with a zoomed middle, which catches a code held too
far away.

A blank draw is told apart from a missing code: iOS Safari silently returns an unrendered canvas once
a page holds too much backing store, so a uniform result is reported as "this browser would not open
an image that big" rather than "no code found". And a failure message carries the image dimensions
and the number of renderings tried, because without those a bug report of this is unactionable.

That failure message is what caught a real bug: a laptop-downloaded JPEG, re-uploaded on the same
machine, reported "1600×1600, 13 attempts, 4 blank" — every one of the four whole-image attempts
(the only renderings capable of decoding a full-frame code; each of the nine tiles holds only a
quarter of it) had been written off as blank and never even reached jsQR. The blank check sampled a
fixed stride of roughly 300 pixels, and on a plain, tightly-cropped QR code that stride could land
exactly on the repeating module grid — walking straight down a column of white (or black) modules and
seeing no variation at all. It was also gating the read: a `looksBlank() === true` result returned
before `jsQR` was ever called, on the very attempts most likely to succeed. The fix samples up to
4000 pixels on a stride forced coprime with the canvas width (so it cannot alias onto the grid), checks
a luminance *range* rather than exact equality, and — the part that actually mattered — the blank
check no longer gates anything. `jsQR` always runs first; `looksBlank` is consulted only afterward,
to label an already-failed attempt. The suite now downloads the real exported file and re-uploads it
through the actual file input, and separately proves the old stride did produce a false "blank" on the
real code while the new one never does.

The suite puts real composites through the actual file input — a phone screenshot with the code at
30%, a 2560×1440 laptop screenshot at 25%, a recompressed 800px copy — and asserts each reads.

Underneath all of that sat a bug none of it could fix: **jsQR cannot read a version 23 QR code.** Its
version table gives version 23's fourth alignment centre as 74, where ISO/IEC 18004 says 78 — almost
certainly a copy of version 22's row above, which legitimately contains 74. Every version spaces its
centres evenly, and 54 → 74 → 102 does not. Four modules off is enough that the decoder never locks
onto the sampling grid, so such a code is unreadable at *any* size, scale, mask or quality. Version 23
is roughly a 1350–1470 character payload, which is squarely in range for a real profile, so whether
someone's code scanned at all came down to how long their text happened to be — a pristine
1600×1600 download failing every rendering with no blank draws.

`vendor/jsqr.js` is patched, which also rescues codes generated before the fix. On top of that the app
steps over version 23 when encoding: our codes get scanned by whatever app the other person has, and
anything built on unpatched jsQR carries the same bug, so it is worth four extra modules to avoid the
version. The guard against a repeat is the invariant rather than the single number — a check asserts
no version in the table spaces its centres unevenly, which would have caught this typo, and would
catch its siblings across all 40 versions.

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

## Downloading the report

**Download full report** at the top and bottom of the profile writes a PDF and downloads it. No
library: `docs/pdf.js` emits the file itself, which for a text report means page objects, content
streams, and the base-14 fonts every viewer already has. It is about 600 lines and no bytes of
dependency — `html2canvas` and friends would rasterise the same words into a fuzzy image and cost
200KB, and the text here stays real text that a reader can select, search and copy.

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
is not in the PDF, though its noun is.

**A layout.** The report is the profile page, section for section, in the same order: a letterhead,
then *Who you are* (the essence noun, the headline findings strip, the summary), *Big Five*, *MBTI*,
*Interests*, *Values & Beliefs*, *In relationships*, *At work*, *Your Instagram behaviour*, *What
your QR code contains*, *Your matches* when this device has any, and *How much to trust this*.
Running head and page numbers on every page. The screen's cards become rules and whitespace, and its
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
npm run test:ui    # 248 checks: drives the real UI in Chromium against a
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
  copy.js             every string the page and the PDF both show, written once
  pdf.js              writes the downloadable report — a small PDF writer, no library
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
