# 💞 Kindred

Upload your Instagram data export. Kindred unpacks it in your browser, distils it into an evidence
summary, and hands that to **Claude**, which writes you a detailed profile: your Big Five and MBTI
with the reasoning behind each, your interests, beliefs and values, and your strengths and
weaknesses — both in relationships and in your career.

That profile is tagged to a **QR code**. Scan someone else's and Claude assesses how the two of you
would work together, scoring **romantic** and **platonic** compatibility separately and writing a
playbook aimed at each of you about the other.

## Running it

Kindred needs a server because an API key cannot ship inside a web page.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start                 # http://localhost:3000
```

Or click through the whole app with canned analyses and no API calls:

```bash
npm run mock              # http://localhost:3000, KINDRED_MOCK=1
```

Set `KINDRED_MODEL` to use a different model (default `claude-opus-5`). Camera scanning needs HTTPS
or `localhost`; pasting a link and uploading a photo of a code always work.

## What is sent where

This is the part worth reading carefully.

| Stays on your device | Sent to the model |
|---|---|
| The `.zip` archive itself | An **evidence digest**: activity counts, hour-of-day and day-of-week histograms, posting regularity, a sample of your own captions and comments, accounts you follow, and the topics Instagram itself inferred about you |
| Your photos and videos — never opened | |
| Your full long-form report | The compact **card** — the same profile as short phrases — when someone runs a comparison |
| Direct messages, unless you opt in | If you opt in: DM counts plus a sample of **your own** messages only |

The archive is unzipped in the browser with the File API. The server proxies two Claude calls and
stores nothing — your profile and reports live in this browser's local storage until you press
delete.

## How the analysis works

`lib/prompts.js` holds both prompts and both output schemas. The model is asked to weigh the
evidence honestly:

- **Their own words** — captions, comments, bio — are the strongest signal.
- **Instagram's inferred topics** are real signal about attention, but noisy.
- **Accounts followed** mix interest, aspiration and social circle.
- **Behavioural rhythm** — when and how regularly they post, how much they engage outward — is
  genuine trait evidence and usually overlooked.
- **Absence is weak evidence.** Most people are near the middle on most traits.

Both calls use **structured outputs**, so the response is guaranteed to match the schema and the UI
renders it without defensive parsing. Both stream, because adaptive thinking and a long report share
one token budget.

### What the model is told not to do

Identify or speculate about specific other people in your data, or infer sexual orientation, health
conditions, immigration status or political affiliation unless you have stated it outright in your
own words. It does not classify anyone by appearance or by the demographics of who they follow.
These guardrails are asserted by the test suite so they survive edits to the prompt.

## The QR code

Along with the long-form report the model produces a compact **card** — the profile reduced to short
labelled phrases. `docs/card.js` trims it to hard limits, deflate-compresses it and base64url-encodes
it, which gets a rich profile down to **roughly 600–900 characters**: dense, but scannable off a
phone screen. There is nothing to look up and no account to create.

The card is also exactly what the compatibility call receives, so whatever is trimmed is invisible to
the other person's report — and your long-form report never leaves your device.

## Compatibility

Romantic and platonic fit are scored separately because they are different questions. Romance turns
on life direction, values, emotional safety and whether two daily rhythms can coexist; friendship
turns on shared interests, compatible energy and low friction. A pair can be a great friendship and a
poor romance, and the report says so when that is the case.

Each mode gets a score, an honest verdict, what works, what will rub, and a playbook addressed to
each person individually about the other.

## Tests

```bash
npm test           # 65 checks: synthesises a real ZIP export and runs
                   # unzip → parse → digest → card → QR → decode, and validates
                   # both prompt schemas against the structured-output rules
npm run test:ui    # 38 checks: drives the real UI in Chromium against a
                   # mock-mode server, upload through to a compatibility report
npm run test:live  # 15 checks: two real Claude calls. Skips without a key.
```

`test:ui` needs Playwright (installed by `npm install`); add `--shots` to write screenshots to
`tools/screenshots/`.

Only `test:live` exercises the actual model call — everything else runs against `lib/mock.js`, which
returns schema-shaped canned data so the rest of the pipeline can be tested without tokens.

## Layout

```
docs/                 the browser app — no build step
  index.html          app shell
  app.js              upload, profile report, QR, scanner, compatibility report
  zip.js              ZIP reader (ZIP64-aware, inflates only the JSON entries)
  instagram.js        export parser → normalised signals
  digest.js           signals → the bounded evidence digest that gets sent
  card.js             shareable card ⇄ compressed QR payload
  llm.js              client for the two server endpoints
  vendor/             qrcode (generation) · jsQR (scanning)
lib/
  prompts.js          both system prompts and both output schemas
  claude.js           the Anthropic SDK calls
  mock.js             canned analyses for tests and for clicking around
server.js             static hosting + /api/analyse + /api/compatibility
tools/                test suites and the synthetic export fixture
```

## What this is not

Not a validated psychometric instrument, not a diagnosis, not a background check. A language model
reading behavioural traces is a mirror and a conversation starter. A low compatibility score is a
list of things worth talking about, not a reason to walk away — and a high one is not a promise.
