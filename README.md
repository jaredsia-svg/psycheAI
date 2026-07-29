# 💞 Kindred

Upload your Instagram data export. Kindred reads it, builds a detailed profile of your
personality, interests, beliefs, values and relationship preferences, and tags that profile to a
QR code. Scan someone else's code and you get two compatibility readings — **romantic** and
**platonic** — with a written assessment of how to best partner each other.

Everything runs in the browser. There is no server, no account and no database: your Instagram
export is read with the File API and never leaves your device.

## Running it

```bash
npm start          # http://localhost:3000 — a dependency-free static server
```

Or host `docs/` anywhere static. For GitHub Pages: **Settings → Pages → Deploy from a branch**,
pick this branch and the **`/docs`** folder.

> Camera scanning needs HTTPS or `localhost`. Pasting a link and uploading a photo of a QR code
> always work.

## How a profile is built

**1 · The Instagram export.** Kindred reads only the JSON files describing your activity — never
your photos:

| Source | Used for |
|---|---|
| Posts, reels, stories, captions | Language markers, posting cadence, themes |
| Comments you wrote | Tone, outward engagement, how many people you engage with |
| Likes and saves | Interests, activity rhythm |
| Accounts you follow, close friends | Social breadth, interest categories |
| Instagram's own `your_topics` and ad interests | High-confidence interest labels |
| Bio, profile info, city | Identity, self-description |
| Direct messages *(opt-in, off by default)* | Aggregate conversation counts and your own message tone |

Meta has shipped several layouts for the export over the years, so files are routed by path
pattern and unwrapped defensively — old and new exports both work. Instagram's characteristic
mojibake (`cafÃ©`) is repaired on read.

**2 · The questionnaire.** The three-step personality test in `docs/questionnaire.js` reproduces
the supplied Personality Test document question by question: background, personality, and
relationship preferences (romantic and platonic). It arrives **pre-filled** from the Instagram
analysis, and every answer you give overrides the guess.

A handful of extra questions are marked *added by Kindred* in the UI — self-declared habits (so
the other person's dealbreakers can actually be checked against something) and conflict style
(which drives the practical advice). Everything else is the document's.

### Personality estimation

Big Five traits come from a weighted blend of language markers and behaviour — vocabulary,
posting regularity, time-of-day activity, engagement breadth, and dominant themes — following the
open-vocabulary approach used in personality research. Language does correlate with personality,
but modestly, and only in aggregate. So:

- every trait lists **the evidence that moved it**, up or down;
- the profile carries a **confidence score** driven by how much data your export actually held,
  and a thin export produces a hedged profile that says so;
- **nothing sensitive is inferred.** Attachment style, love languages, dealbreakers, religion and
  whether you want children come from your answers only. Kindred does not classify the people you
  follow by appearance or gender.

## The QR code

Your whole profile is bit-packed against a shared schema (`docs/codec.js`) and base64url-encoded
into roughly **60–90 characters** — small enough to scan reliably off a phone screen. There is
nothing to look up: the code *is* the profile.

Free-text answers are deliberately excluded from the payload and stay on your device.

## Compatibility

Eight dimensions, weighted differently for each mode — what makes a good partner is not what
makes a good friend:

| Dimension | Romantic | Platonic |
|---|---|---|
| Values & life priorities | 20% | 16% |
| Personality fit | 18% | 20% |
| Attachment & emotional safety | 14% | 8% |
| How you give and receive care | 12% | 9% |
| Shared interests & activities | 11% | **24%** |
| Background & worldview | 10% | 6% |
| Rhythm & conflict style | 8% | 12% |
| Dealbreakers | 7% | 5% |

Each report gives both scores, a per-dimension breakdown, what works, what to watch, and a
**playbook**: specific advice for each person about the other, plus what they should do together.
Attachment pairings use an explicit matrix (the anxious–avoidant trap gets named as a cycle, not
as a person's fault), and love languages are checked in both directions — what you naturally give
against what they need to receive.

Dealbreakers are only ever evaluated against habits the other person declared about themselves.
Anything unobservable — infidelity, anger, drugs — is listed as *a conversation to have* rather
than folded into a score.

## Tests

```bash
npm test           # 94 checks: builds a synthetic Instagram export as a real ZIP and runs
                   # unzip → parse → analyse → encode → decode → compatibility
npm run test:ui    # 36 checks: drives the real UI in Chromium, upload through to report
```

The UI suite needs Playwright (`npm install`); add `--shots` to write screenshots to
`tools/screenshots/`.

## Layout

```
docs/
  index.html        app shell
  app.js            SPA: upload, questionnaire wizard, profile, scanner, report
  zip.js            ZIP reader (ZIP64-aware, inflates only the JSON entries)
  instagram.js      export parser → normalised signals
  lexicon.js        trait, theme and value word lists
  analysis.js       signals → Big Five, themes, rhythm, values, narrative, confidence
  questionnaire.js  the personality test, question by question
  codec.js          bit-packed profile ⇄ QR payload
  compat.js         romantic + platonic scoring and written assessment
  vendor/           qrcode (generation) · jsQR (scanning)
server.js           dependency-free static server for local preview
tools/              test suites and the synthetic export fixture
```

## What this is not

Not a validated psychometric instrument, not a diagnosis, not a background check. A low score is a
list of things worth talking about, not a reason to walk away — and a high score is not a promise.
