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

`BRAND_MARK` in `docs/copy.js` is the logo, and it is drawn in **six** places from that one
definition: the nav's inline SVG, the welcome hero's watermark, the profile page's own watermark, the
print letterhead's, the PDF's vector operators, and the QR download's label strip via `Path2D`. A UI
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
| Direct messages, if you untick them in the pre-send review | By default: DM counts plus a sample of **your own** messages — never the other side of a conversation |

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
  lives in `localStorage` and is never uploaded; the QR card is self-contained, so there is no record
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

A tempting claim — that the summary never reaches the PsycheAI server at all, or reaches Gemini or
Claude directly with nothing in between — would be false, and the suite fails if it ever appears.
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
narrow and true — Gemini and Claude are reached through paid API access, and paid API terms from
both providers exclude customer inputs from training, as of when this was written. That second half
is exactly why it stays phrased as their policy rather than restated as fact: it is the one claim on
this page that could become false without this app changing anything at all. An earlier version also
named the free consumer chat apps as the contrast and pointed readers at the providers' own terms to
verify it; both were cut as the paragraph was tightened to what a reader actually needs on first
read, not as a change to what is being claimed.

The unpacking screen carried this same claim as a fineprint line under the progress bar — "Reading
your data on this device… (nothing has been sent yet)" — set once, at the point where it is true,
and overwritten the moment it stops being true. That row is gone now; the claim moved into the
progress label itself, reported from `docs/instagram.js` as each batch of files is parsed:
"Reading your data on your device. No data is being sent out." The heading above it is just
"Loading" rather than naming the phase, on the same reasoning the badge redesign followed — say less,
say it once. `runAnalysis` still replaces the working screen's title and note with the actual
send-in-progress copy the instant a request is about to go out, so the claim is never left on screen
past the point where it would become a lie. Because the label moves fast against the mock and the
depth dialog opens once reading finishes, the check records every value the label takes rather than
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

The instructions for requesting either export live in a collapsed `<details>` on the welcome page —
a native disclosure rather than the JS one the bonus section uses, because that one keeps its text
out of the DOM as a consent gate and this is only a page of instructions for a step most readers
skip. Left in the document while closed, they stay findable with Find-in-page and reachable by a
screen reader navigating headings; the checks read `textContent` for the content and visibility for
the disclosure, since `innerText` reports nothing for a closed `<details>` and would prove neither.

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
and 200 of the reader's own Messenger messages — never the other side, exactly as Instagram DMs work.

(Those are the Standard caps; see below for Comprehensive.)

**Two things about the budget that supplements exposed.**

The character ceiling is now *derived* for both depths. Standard carried a hand-typed
`totalChars: 600000`, which is 49,516 characters past what `COST_CAP` actually buys — a digest that
filled it would have cost **$0.5212 against a $0.50 cap**. That was dormant while Instagram was the
only source, because a heavy account reaches 156k and never approached it; supplements make it
reachable. It is `charBudget(COST_CAP, 14)` now, the way Comprehensive already was, and a check
holds the two together.

The trim loop shrinks whichever list is largest, which is source-blind — so a big Takeout would have
shaved Instagram captions to make room for a browsing histogram. Instagram is the primary evidence
and the thing the report is written from; a supplement is an addition, so **additions are trimmed
first, and further** (floor 10 rather than 20) before any Instagram list is touched. Fault-injected
by merging the two lists back into one: captions collapse from 1265 to 533.

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
inside the 600KB ceiling and a small fraction of either provider's 1M-token context. The digest
carries a `coverage.sampling` field saying what fraction of each source the model is seeing, and the
prompt tells it to factor that into its confidence score rather than treating the sample as the
whole picture.

### Standard and Comprehensive

Those caps are the **Standard** depth, and Standard is what every run now uses.

**Comprehensive** lifts every per-source cap far past what any real export reaches, so that the
thing bounding the digest is a **price**, in one place, rather than ten caps that each have to be
reasoned about separately. It also sends 20 photographs instead of 14.

**The depth picker is gone.** It used to sit between the supplement offer and the review, asking
which depth to run — but Comprehensive has never been on sale, so it was a question with one
available answer, costing a click and a decision to arrive exactly where the reader started. A
disabled row naming a future price is worth showing on a page somebody chose to read; it is not
worth an interruption in a flow. `app.js` holds a single `DEPTH = 'standard'` now, and
`askDepth`, `#depth-dialog` and the synthetic-click guard that protected the disabled row all went
with it.

The comprehensive **machinery is untouched** — `DEPTHS.comprehensive`, the lifted caps, the derived
budget and `coverage.depth` are all still in `digest.js` and still work. What changed is that no
click can reach them, so the coverage moved with the reachability: the browser suite no longer
drives it (there is no dialog to drive), and `tools/selftest.mjs` carries it — depth recorded, caps
lifted, budget respected on an oversized account, coverage reported honestly. Putting the feature on
sale means adding a way to choose it, not rebuilding it.

The budget is derived rather than picked, in `charBudget()`:

```
worst-case output   32,768 tokens × $7.50/M   = $0.2458   (the hard generation cap)
left for input      $0.50 − $0.2458           = $0.2542
                    ÷ $1.50/M                 = 169,493 tokens
less system prompt + response schema          −  15,000
less 20 images × 258                          −   5,160
                    × 3.5 chars/token         = 522,666 characters
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

**Short TTL, because caching is not free.** Cached tokens carry an hourly storage charge, so an entry
no second call ever reaches costs more than it saved — roughly break-even at one analysis per hour on
a one-hour TTL. The cache is therefore created lazily, only ever *after* a real call, when another is
most likely, and defaults to a 15-minute life so a quiet night lapses instead of billing storage.
`PSYCHEAI_GEMINI_CACHE_TTL` raises it once traffic keeps it warm, or `0` turns it off.

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

### Reviewing what actually gets sent

Once depth is chosen, and before anything reaches the model, a second dialog shows the reader the
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

### The photographs

Text alone leaves a real blind spot: a wordless photo of a summit and a wordless photo of a
nightclub are the same row in the digest. So **a small sample of images is sent by default**, and
the Photos row in the pre-send review turns it off.

`docs/images.js` picks them. Candidates are the stills the JSON references — carousels contribute
only their cover frame, videos never qualify, and anything under 12KB is discarded as a thumbnail
or a screenshot of text. Each is scored: posts outrank stories, larger files break ties, and the two
rules that carry the most weight both measure **effort** — how much they wrote, and how much they
assembled. A caption over 300 characters is worth 26 points and a nine-image carousel 22, against
nothing for a wordless single.

**Then recency decides which era those scores compete inside.** The slots are filled from the last
two years on score alone; only when that window cannot fill them does selection reach further back,
and only after that — when the whole archive is bunched onto a handful of days — does it give up the
rule that no two picks share a day. The window is measured back from their most recent post rather
than from the clock, which is the same thing for an export downloaded days after the last post, and
a much better thing for a dormant account: counting from today would put the entire archive outside
the window and collapse straight through to the fallback, losing the preference for recency
altogether.

This replaced an even spread across the whole timeline. That guaranteed range, and spent most of the
slots describing somebody who no longer exists — on the test fixture, which reaches back to 2021, it
took photographs from four years ago over the ones from this year. Now every pick comes from the
recent window even though the older era in that fixture is deliberately its strongest material: the
best score it passes over is 75, against 69 for the best it takes.

**Effort is a stand-in for something the archive does not carry.** The question you actually want
answered is which posts *mattered*, and the honest measure of that would be likes, comments and
views — none of which Instagram exports. Every likes file in the download records what you gave
other people (`liked_posts.json`, `liked_comments.json`), never what you received. So selection
reads the two things the person themselves put in, both of which are in the export: caption length,
and how many pieces they assembled into one post.

This replaced an earlier rule that paid a bonus for the *absence* of a caption, on the theory that
wordless posts were invisible to a text-only digest. That was true, and it still spent the scarcest
resource in the app on the least considered posts in the archive — measured against the fixture, the
old rule picked a set whose mean caption length (34 characters) was *below* the pool it drew from
(39). The current rule pulls it to 61, and drops the wordless share of the picks from 61% to 43%.

Recency still outranks effort by construction — the window decides which posts are eligible before
any of them are scored — but within that window effort now decides freely, which is what the old
per-era bucketing prevented.

Both of these are visible to the model rather than left implicit. The prompt says the sample leans
recent and deliberate, so a report cannot read the absence of an early era as the absence of a life,
and it names `summary` and `harsh` as the two sections that should each spend a sentence or two on
the photographs — conditionally, with an explicit instruction to leave them out when the pictures
only repeat what the text already carries or when none came through at all.

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
leaves the browser. The Direct messages row in the pre-send review turns the whole thing off.

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

### Let us roast you

Everything above it is written to be fair. This one is a roast — accurate without being kind: the
least charitable reading the evidence still supports, and the advice a friend gives when they have
stopped managing your feelings. It sits below the behaviour read and above confidence, so the reader
meets every fair section first and the confidence caveat still gets the last word over all of it. A
small "Bonus Section" badge sits beside the title — a label for what the section is, spliced onto the
already-escaped title text rather than a second heading competing with the one next to it.

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

**The PDF leaves it out entirely**, and it is the one place the PDF is not a faithful rendering of
the page. A PDF has no cover to open, so the consent gate cannot travel into one — printing it would
put the harshest writing in the report into a file that gets reopened cold and forwarded, including
by a reader who never pressed the button. The page/PDF parity check exempts this one section by
name, and a second check asserts every part of it absent: the heading, both subheadings, the caveat,
and a phrase from the writing itself, since a renderer could drop the headings and still lay down
the prose.

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
npm test           # 526 checks: synthesises a real ZIP export and runs
                   # unzip → parse → digest → card → QR → decode; proves the
                   # digest caps and budget hold on a heavy account; checks the
                   # image selector spans the timeline and drops what it should;
                   # validates both prompt schemas against the structured-output
                   # rules and the keyword subset Gemini supports; and exercises
                   # every branch of provider selection
npm run test:ui    # 705 checks: drives the real UI in Chromium against a
                   # mock-mode server, upload through to a compatibility report.
                   # Decodes and re-encodes the fixture's real PNGs, and asserts
                   # against the actual request body that the images sent are
                   # JPEGs, are not the originals, and vanish on opt-out — an
                   # opt-out now made in the pre-send review dialog, checked
                   # against the real request body rather than UI state alone.
                   # Includes the scan ladder the card's size budget is set
                   # against: the code is redrawn at 450px and 300px and sat
                   # inside 480p and 720p camera frames, and has to decode in
                   # every one
npm run test:live  # 24 checks: two real model calls against whichever provider
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
