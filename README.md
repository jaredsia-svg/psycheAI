# 🧠 PsycheAI

*The personality analysis you didn't know you needed.*

Upload your Instagram data export. PsycheAI unpacks it in your browser, distils it into an evidence
summary, and hands that to a language model — **Google Gemini** or **Anthropic Claude** — which
writes you a detailed profile: your Big Five and a long-form MBTI reading with the reasoning behind
each, a behavioural read of how you actually use Instagram, your interests, beliefs and values, and
your strengths and weaknesses — both in relationships and in your career. Export the whole thing to
PDF when you are done.

That profile is tagged to a **QR code**. Scan someone else's, choose whether you are asking as
**partners**, **family or friends**, or **colleagues** — and if colleagues, who reports to whom —
and the model assesses how the two of you would work together on that basis, with a playbook aimed
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

The download carries a label, because a saved or forwarded file loses all context otherwise: a
strip is appended *below* the code — never over it, so the module grid is untouched — with the
brand mark, "PSYCHEAI", and the person's name. The mark is stroked from the same SVG path data the
nav and the PDF use, via `Path2D`. A name shrinks to fit rather than running off the strip —
`Card.shape` caps a name at 24 characters, but the download reads `profile.card.name` as stored,
uncapped, so a profile saved under an older schema could carry something longer. The suite forces a
name that measures past 1900px against the strip's 1440px budget and checks the rendered pixels
clear the margin, having first confirmed a version without the shrink logic does not.

### The mark

`BRAND_MARK` in `docs/copy.js` is the logo, and it is drawn in **four** places from that one
definition: the nav's inline SVG, the print letterhead's, the PDF's vector operators, and the QR
download's label strip via `Path2D`. A UI check compares the shared paths against the `d` attributes
in `index.html`, so an inline copy cannot drift.

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

The nav has been re-measured twice as its labels changed. "My Personality" and "My Compatibility"
overflowed by 14px at 375 and 32px at 320, and shrinking the links to absorb it would have put them
under the 11px minimum, so the wordmark came off every phone. Shortening "How it works" to "FAQ"
gave back more than that cost — re-measured at 412 / 390 / 375 / 360 / 320px the nav sits on one row
with no horizontal scroll and nothing under 11.5px — so the wordmark is back, and only a folded
phone under 320px still loses it. The footer kept saying "how it works" for several turns after
that rename, which made one destination look like two; a check now reads both labels and requires
them to match, so the next rename fails rather than half-lands.

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

The profile page and the scan page both show this person's own code and offer the same two actions,
so painting the canvas, copying the link and building the download are each one function bound to
two buttons rather than duplicated. The CSS constraining the canvas's *display* size (independent of
its backing store, which is what keeps it sharp) is written against `.qr-holder canvas` for the same
reason — scoped to the single `#qr-canvas` ID, the scan page's copy rendered at its full 900px
backing size and broke the layout. That regression shipped once during development with the checks
in place, because the first version only asserted the code sat left of its buttons, which held even
while the canvas was three times too large; the fix added a check that the two canvases compute to
the same display width.

"What your QR code contains" — the card headline, summary and interest tags, plus a note on what
else rides along as short phrases — used to sit on the profile page. It moved to the bottom of the
scan page instead, right under the code itself: it is about the code someone is looking at or about
to send from that page, not about the report. `qrContentsBlock()` in `docs/app.js` builds it and
`renderScan()` repaints it on every visit, rather than appending, so leaving the page and coming
back does not stack a second copy underneath the first.

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

### When the model is overloaded

Both APIs occasionally answer "too much load right now" rather than an actual response — Gemini as
an `UNAVAILABLE`/503, Anthropic as a 529 `overloaded_error`. It is a capacity blip on the provider's
side, not a problem with the key, the request, or this app, and it usually clears within seconds. So
`lib/gemini.js` and `lib/claude.js` each retry automatically — three attempts with growing gaps
(2s, 5s, 12s) — before giving up and surfacing a message that says so, rather than failing on the
first hit the way a straight pass-through would.

`tools/fixtures/retry-behaviour.cjs` tests this against fake SDKs standing in for `@google/genai` and
`@anthropic-ai/sdk`, stubbed into the require cache before `lib/gemini.js`/`lib/claude.js` ever import
the real packages — the fakes have to be there first, so this runs in its own process rather than
inside `tools/selftest.mjs` directly, which has already loaded the real modules by the time it gets
here. It scripts an overload that clears after a couple of attempts (recovers), one that never clears
(gives up at exactly four attempts and reports it), and a non-retryable error (fails on the first
attempt, no delay). `tools/selftest.mjs` spawns it and folds each line of its output into its own
tally, so a break here fails `npm test` rather than needing a separate command.

Writing that fixture found a second, unrelated bug in the Claude error path: `describeError`'s
catch-all checked `error instanceof Anthropic.APIStatusError`, and that class does not exist on this
SDK version — the real base class is `Anthropic.APIError`. `instanceof` an undefined value throws,
so any Anthropic error not already special-cased above it (a 400, a 404, a fresh status code) would
have crashed the error handler instead of returning a message. Fixed alongside the retry logic, with
its own regression check.

## The sample report

The welcome page asks for a 400MB download from Instagram and an email that takes hours to arrive,
in exchange for something the reader has never seen. **See sample report** — in the hero and again
under the diagram — closes that gap: it renders `docs/sample.json` through the same `renderProfile`
a real report goes through, so what appears is the actual layout rather than a picture of one.

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

What it deliberately does not carry: the download buttons, **Delete everything**, and the QR
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
| Direct messages, if you untick the box | By default: DM counts plus a sample of **your own** messages — never the other side of a conversation |

### The FAQ says exactly this, and is held to it

The in-app FAQ has to get somebody comfortable uploading their DMs and their search history, which
makes it the easiest page in the app to overstate. It says three things, and each is a promise the
code has to keep:

- **The archive is reduced before anything is sent.** Unzipping and digest-building happen in the
  browser; the summary is what is posted.
- **The server relays and does not store.** It is a proxy, and the page says so rather than implying
  the browser talks to Gemini directly — it cannot, because an API key cannot ship in a static page.
  What the page does claim is that nothing is written to disk, put in a database, or logged.
- **There is no store to breach.** No sign-up, no password, no user table. The report lives in
  `localStorage` and is never uploaded; the QR card is self-contained, so there is no record behind
  it to look up.

Both privacy sections are written for an adult with no technical background: no jargon, and no
explaining-to-a-child similes either. "The file Instagram sends you contains everything: every post,
every message, every search. Your device opens it and reduces it to a short summary." Simplifying is
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
caveat is a product call rather than an accuracy one, so the checks for them went too; what could
not go is the statement that the summary reaches the PsycheAI server at all, and the disclosure that
Google or Anthropic read it under their own terms. Those two are what the remaining guards hold.

A tempting fourth claim — that the summary never reaches the PsycheAI server at all — would be
false, and the suite fails if it ever appears. Checks read the claims off the rendered page *and*
the behaviour out of `server.js`, so the page cannot drift into overstatement and the server cannot
quietly stop honouring it: `fs` is asserted to be read-only, `Cache-Control: no-store` to still be
set, and the copy to keep naming both things outside the app's control — the model provider's terms,
and an unlocked device.

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
count for two reasons: they are an opt-out, so counting them would let the threshold move with a
switch on the upload page, and they are the one route a Facebook export gets perfectly right, being
the same Messenger format — so they are the last thing that should count towards recognising
Instagram.

`tools/fixture.mjs` builds a Facebook download shaped the way Meta writes one, and both suites run it
through: the unit suite asserts the refusal and its wording, the browser suite asserts it reaches
`#upload-error` and that nothing was sent. Deleting the floor, lowering it to three, or counting
messages towards it each let that archive through, and each is caught.

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
| Searches | last 160 |

(Those are the Standard caps; see below for Comprehensive.)

A small account sends about 6KB; a heavy one with thousands of posts lands around **150KB**, well
inside the 600KB ceiling and a small fraction of either provider's 1M-token context. The digest
carries a `coverage.sampling` field saying what fraction of each source the model is seeing, and the
prompt tells it to factor that into its confidence score rather than treating the sample as the
whole picture.

### Standard and Comprehensive

Those caps are the **Standard** depth. Once the archive is open — but before anything is sent, and
before the images are decoded, which is the slowest step here — a picker asks which depth to run.

**Comprehensive** lifts every per-source cap far past what any real export reaches, so that the
thing bounding the digest is a **price**, in one place, rather than ten caps that each have to be
reasoned about separately. It also sends 20 photographs instead of 14.

**Comprehensive is not on sale yet.** Its row in the picker is `disabled`, dimmed, and labelled
*Coming soon* at USD 2.99 per analysis. It is shown rather than hidden because a disabled row that
names a price reads as "later" where a missing row reads as "never existed". Two things enforce it:
the attribute, which is what stops a real click and keeps the row out of the tab order entirely, and
one line in `askDepth` that returns early when the clicked button is disabled — which covers the
only route past the attribute, a synthetic `dispatchEvent('click')` that goes straight to the
listener. A check fires a synthetic click and fails if anything is chosen; deleting that one line
fails it while the attribute is still in place. Neither is a security boundary — the digest is built
on the client, so anyone editing `app.js` sends whatever they like — it is a product gate, and the
level of effort matches that.

Everything behind the gate is built and still under test. The suite re-enables the row deliberately
and runs the whole comprehensive path, rather than dropping the coverage until it ships; the shipped
markup is asserted shut on a fresh load first, so the re-enabling cannot mask a regression.

The budget is derived rather than picked, in `charBudget()`:

```
worst-case output   32,768 tokens × $7.50/M   = $0.2458   (the hard generation cap)
left for input      $0.50 − $0.2458           = $0.2542
                    ÷ $1.50/M                 = 169,493 tokens
less system prompt + response schema          −   8,600
less 20 images × 258                          −   5,160
                    × 3.5 chars/token         = 545,066 characters
```

It budgets for the **worst** case, not the likely one. `thinkingLevel` is HIGH and thinking bills at
the output rate, so the only number that can be relied on is the generation cap — reserving all of it
means the ceiling holds even when the model thinks for as long as it is allowed to, instead of
holding on average and quietly breaking on exactly the accounts that give it the most to chew on.

For most accounts comprehensive sends **everything**, and `coverage.sampling` then reports shown
equal to available. For a very heavy account it does not: 4,000 captions at ~150 characters is
600,000 on its own, past the budget, so the digest is trimmed back to fit and reports the fraction
honestly. The feature is "as much as $0.50 buys", which is usually all of it and sometimes is not —
on the self-test's heavy fixture that is 1,265 captions against standard's 560.

Trimming is what actually enforces the ceiling, so it repeatedly shrinks whichever sample list is
currently costing the most. It used to touch captions and comments only, which was safe while every
other cap was in the low hundreds and stopped being safe the moment comprehensive lifted them: an
account with a very long follow list would have sailed past the budget with nothing the loop was
willing to touch. The self-test pins this down with a 120,000-follow export — against the old loop
it produced a **2.3-million-character** digest, four times the budget and about $1.35 a run, while
gutting captions to 20 to spare a list of account names.

The `samplingNote` is written from what the coverage numbers say rather than from the setting that
was chosen, so a comprehensive run that did send everything does not tell the model it is reading a
subset and hedge a confidence figure it has no reason to hedge.

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

Under the character sits a **glance strip** — MBTI type, highest and lowest Big Five trait, Enneagram
type and wing — then a two-or-three-paragraph summary that lands the findings from every section
below, so someone who reads only the opening still leaves with the answers. The strip is derived in
`docs/copy.js` from the sections themselves rather than asked of the model a second time: restating
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

Right after it, **Enneagram** — the smallest section in the schema, but not a throwaway one: one
type (1-9), its wing when one is clear (written bare, so the client builds "9w1" rather than the
model doing string formatting), its nickname, a confidence level, five or six sentences of real
explanation, and a caveat. No per-facet breakdown the way MBTI has one — a second full typing system
next to the first would be a wall, not a second look — but the one paragraph it does get is asked to
teach, not just cite: explain what the core type itself centres on in plain language, as if the
reader has never heard of it, then explain what the wing specifically adds or shifts, and only then
tie both to something in their data. A reader should come away understanding the number and the wing
on their own terms, not just being told which ones they got. The caveat does one more specific job
beyond the usual "this is popular, not validated" hedge: say plainly if the Enneagram read and the
MBTI read seem to pull in different directions, rather than quietly smoothing the disagreement over.

**Instagram behaviour**, which is the part of the export nobody reads themselves: what they post and
in what mix, when they reach for the app, and how their use changed month by month. It used to run
to six facets and a list of hedged behavioural implications; the shape-of-attention facet and the
implications list were trimmed for being the two subsections that told a reader the least per word,
and both were cut from `PROFILE_SCHEMA` too, not just from the page — asking the model for output
nobody reads is tokens spent for nothing.

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

It is one paragraph. It briefly carried four more subsections — a ranked list of the accounts taking
the most attention, a read of Instagram's own inferred topics, and a **Worth changing** /
**Leave alone** pair of recommendation lists closing the section — and all four were cut together
for length. The behaviour section had grown to about a screen and a half and was outweighing
findings that say considerably more about a person than their feed does. All four came out of
`PROFILE_SCHEMA` as well as the page, on the same reasoning as the facets before them: output
nobody reads is tokens spent for nothing.

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

### The bonus section

Everything above it is written to be fair. This one is written to be accurate without being kind:
the least charitable reading the evidence still supports, and the advice a friend gives when they
have stopped managing your feelings. It sits below the behaviour read and above confidence, so the
reader meets every fair section first and the confidence caveat still gets the last word over all
of it.

A third reading, **Where this ends up** — the five-year behavioural forecast — was cut along with
the behaviour section's subsections. The no-diagnosis rule did not go with it: `harsh` and `advice`
can drift into a clinical claim just as easily, and the forecast happened to be the field carrying
the longest statement of the ban, so the checks now read it off the hard limits instead.

**It is not a diagnosis, and cannot become one.** The obvious question — *what is wrong with me* —
is the one thing this section may not answer. A model naming a condition from posting patterns is
inventing a clinical claim it has no standing to make, in a document people export to PDF and show
to other people, and the landing page says in as many words that this is not a clinical or
diagnostic tool. The ban is stated twice in `PROFILE_SYSTEM` — once as *being unkind is not a
licence to become one*, once in the hard limits with the note that it holds *however the reader has
framed what they want* — and asserted by five checks in `tools/selftest.mjs`, including one that
scans `docs/sample.json` for the vocabulary a model reaches for when it starts drifting from
behaviour towards diagnosis, so the exemplar cannot teach the wrong thing.

**The cover is a real gate, not a blur.** The writing is not in the document until the reader
presses the button. Blurring it in CSS would look identical and protect nothing — select-all copies
it, a screen reader announces it, view-source hands it over — so `bonusBlock()` ships the cover
alone and `revealBonus()` injects the text on the click, reading it from the report object rather
than out of the page. Covering it back up empties the container again, so the gate works more than
once. A UI check asserts the mock's own bonus wording is absent from the card's `innerHTML` before
the click; it fails against a version that writes the text in and blurs it.

There is no clicking in a PDF, so the cover cannot travel. The caveat goes *above* the writing
there rather than after it, because a reader reopening that file in six months meets it cold, and a
check pins that ordering by string offset.

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
catalyst" set in italics under someone's own name. The band keeps its height either way, so the
space is blank rather than closed up; a check fails if a headline reappears there, and another
fails if the title itself goes missing, since "no headline" would otherwise also pass with the whole
block deleted.

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
*Enneagram*, *Interests*, *Values & Beliefs*, *In relationships*, *At work*, *Your Instagram
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

## The QR code

Along with the long-form report the model produces a compact **card** — the profile reduced to short
labelled phrases. `docs/card.js` trims it to hard limits, packs it, deflate-compresses it and
base64url-encodes it, which gets a rich profile down to **roughly 680 characters**: dense, but
scannable off a phone screen. There is nothing to look up and no account to create.

The card is also exactly what the compatibility call receives, so whatever is trimmed is invisible to
the other person's report — and your long-form report never leaves your device.

### What the card carries, and what that cost

The card used to hold about a tenth of the report, and specifically the wrong tenth. The
compatibility prompt is told that attachment and love languages decide a romantic read, that contact
appetite decides a platonic one, and that standards and follow-through decide a professional one —
and the card carried none of those. Love languages were absent entirely; attachment was the string
`"leans secure (tentative)"` with all of its reasoning discarded. Meanwhile interests, the thing the
same prompt says matters least, had eight slots. The model was being asked to weigh evidence it had
never been given, so it fell back on hobbies and filled the rest with something plausible.

**K4** carries the reasoning under the attachment guess, both love-language sides, an `energy` line
for contact appetite, a `workStyle` line, and the Enneagram type — the five things the mode briefs
actually name.

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

The profile page ends in four parts, in this order: the report, then **"Test your compatibility"**
— the QR code, the copy-link and download-QR buttons, and the link to the scan page — then the
download/delete row, then a line of fineprint naming the model and the time it ran. The
compatibility panel used to open the page, which asked someone to hand out their code before reading
a word of what was in it. The action buttons then sat between the report and the code, which put a
delete button in the middle of the page; they are housekeeping rather than part of the document, so
they close it instead. The row held a third button, **Re-run the analysis**, which spent a second
model call on the same export and replaced the report with a differently-worded one; it has been
removed, and the row is now pinned as an exact list of two so nothing creeps back into it. Its
handler went with it rather than staying bound to an id that no longer exists.

That leaves one loose end worth naming: `psycheai_digest` in `localStorage` existed only so the
re-run button had something to re-send, and nothing reads it now. It is still written, and **Delete
everything** still clears it. It is not a leak — it never leaves the device, and it is the reduced
summary rather than the archive — but it is a copy of somebody's evidence digest kept for no
purpose, and it should come out. It has not been removed here because four UI checks read it as
their observation point for what was actually sent (the chosen depth, the image coverage, the
opt-out), so removing it is a test change as much as a code one. The "analysed by" line used to sit inside the report body, right after
confidence — it now has its own fixed element after the buttons, since it is a record of the run
rather than a finding and stays true regardless of what else gets added above it. It is unchanged in
the PDF, which has no QR panel or buttons after its own confidence section for it to be pushed past.

## Compatibility

**My Compatibility** is titled for whoever the device belongs to, and opens with one short sentence
on what a comparison is for: scan someone's code and get a score, the five things behind it, what
works, what will grate, and what each of you could do differently — as a couple, as family or
friends, or as colleagues. It was two paragraphs; the second one restated the picker that appears
moments later, so it was cut rather than trimmed.

The scanning box itself carries no instructions any more, just its heading and the three ways in:
camera, upload, paste. **Use my camera** and **Upload a photo of a code** became **Use camera** and
**Upload QR code** — short enough to read as labels rather than sentences — and the "fill the frame
with it" paragraph under them is gone, since the box's own controls say what it does. The button
that starts a comparison reads **Analyze**.

Past results sit *above* the box that makes new ones. Someone returning to that page is far more
often looking for a report they already ran than starting another.

**"Your matches"** — the history table that used to close the personality report — was removed from
that page; past comparisons live only on the compatibility page now, under "Your compatibility
results". It stays in the downloadable PDF, which still lists history when the device has any: the
request was to change the live page, and match history is a record of what this device has done
rather than part of the model's read on the person, so the two are free to differ here without
breaking the rule that the page and the PDF have to agree on what the *report* says.

Reading someone's code opens a picker before anything is sent: **Romantic**, **Family / Friends**,
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

The result is a score, an honest verdict, what works, what will rub, and a playbook addressed to each
person individually about the other. Scan again to compare on a different basis — the picker appears
on every read, whether it came from the camera, a photo of a code, a pasted link or a shared URL.

## Tests

```bash
npm test           # 330 checks: synthesises a real ZIP export and runs
                   # unzip → parse → digest → card → QR → decode; proves the
                   # digest caps and budget hold on a heavy account; checks the
                   # image selector spans the timeline and drops what it should;
                   # validates both prompt schemas against the structured-output
                   # rules and the keyword subset Gemini supports; and exercises
                   # every branch of provider selection
npm run test:ui    # 573 checks: drives the real UI in Chromium against a
                   # mock-mode server, upload through to a compatibility report.
                   # Decodes and re-encodes the fixture's real PNGs, and asserts
                   # against the actual request body that the images sent are
                   # JPEGs, are not the originals, and vanish on opt-out.
                   # Includes the scan ladder the card's size budget is set
                   # against: the code is redrawn at 450px and 300px and sat
                   # inside 480p and 720p camera frames, and has to decode in
                   # every one
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
