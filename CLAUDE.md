# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PsycheAI (psycheai.io): a reader loads their own Instagram export, or two or three WhatsApp chats instead (plus, optionally, Google Takeout or Facebook), through one file box that sorts each file by its contents. The browser reduces it to a de-identified **digest**, the reader reviews it, and the server relays it to Gemini, Claude or Grok. The model writes:
- a free **Psyche Card**: a 1080×1920 shareable story card;
- a paid **full premium report** (US$5);
- free **Psyche Sync** friendship-compatibility reads between two people's cards, via each reader's personal link.

The server never stores exports, digests or reports. The only content it holds is ciphertext it cannot read: short-link cards (`lib/links.js`) and Psyche Syncs waiting for a link's owner (`lib/syncbox.js`, deleted once collected or after 30 days).

## Commands

```bash
npm install
npm run mock          # whole app with canned analyses, no API keys, no Stripe (PSYCHEAI_MOCK=1)
npm start             # real providers: needs GEMINI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY
npm test              # tools/selftest.mjs — ~1,370 unit/integration checks, no browser
npm run test:ui       # tools/uitest.mjs — ~1,580 Playwright checks against mock servers it spawns
npm run test:live     # real API calls (costs tokens); PSYCHEAI_LIVETEST=premium runs only the paid call
node tools/seo-pages.mjs    # regenerate the search pages, sitemap.xml and llms.txt (npm test fails while stale)
node tools/cast-sprite.mjs  # redraw the character tile image (the guessing game) after a scene or the catalogue changes (npm test fails while stale)
node promo/capture.mjs && node promo/og.mjs   # redraw promo/assets/card.png and docs/media/og-card.jpg from the sample card
npm run promo         # rebuild the promo videos (needs promo/.cache: Python venv, voice and ASR models)
```

- **The suites have no test filter.** Both are single scripts of sequential `check(label, ok, detail)` calls. Run the whole file and grep the summary: `npm run test:ui 2>&1 | grep -E "✗|passed|failed"`.
- **Tracing a throw:** `UITEST_STACK=1` prints the stack for a thrown error.
- **Screenshots:** `node tools/uitest.mjs --shots` writes them to `tools/screenshots/`.
- **Ports:** the UI suite spawns its own mock servers on ports 4173–4177. If it fails with `ERR_CONNECTION_REFUSED`, look for a stray `node server.js` holding one of them.
- **Playwright:** Chromium is preinstalled. Do not run `playwright install`.
- **Running both:** run both suites after any change. They pin exact copy, layout and behaviour, so a wording change usually needs a matching check update.

There is no build step, bundler or linter. `docs/` is served as-is.

## Architecture

**Server (`server.js` + `lib/`).** Plain `node:http`, with no framework.
- **Static files:** `serveStatic` serves `docs/` through `lib/staticfiles.js`, which adds Brotli/gzip, weak ETags and 304s, and rewrites each page's own `src`/`href` to `x.js?v=<content hash>` so those assets are cached for a year (`immutable`) while pages revalidate. Unknown page addresses get `docs/404.html`. Short links `/c/<id>` 302 to `/?c=<id>`, keeping the rest of the query string.
- **Routing:** the `API_GUARDS` table applies rate limits (`lib/ratelimit.js`) and single-use nonces (`lib/nonce.js`) to the routes that cost money.
- **Providers:** `lib/provider.js` picks gemini, claude, grok or mock (`lib/mock.js`). Gemini can go through Vertex AI (service account), with `GEMINI_API_KEY` as the fallback. Every provider shares the prompts and JSON schemas in `lib/prompts.js`.
  - Free card: `STRUCTURED_FREE_SYSTEM` with `FREE_SCHEMA`.
  - Paid report: `PREMIUM_*`, anchored to the free card via `anchorFrom`/`anchorBlock`, so it explains the same conclusions.
  - Sync: `COMPATIBILITY_SYSTEM` with `COMPATIBILITY_SCHEMA`.
  - Ask PsycheAI: `ASK_SYSTEM` with `ASK_SCHEMA`, given the report and card, the digest the report was written from (`psycheai_report_digest`), and the question (`/api/ask`).
  - `selftest` pins load-bearing prompt phrases, so a prompt edit usually needs a test edit.
- **Payments:** `lib/stripe.js` charges only amounts from `docs/prices.js`, a table shared by page and server with local currencies. `verifyPaid` checks the PaymentIntent's amount against the product. `lib/premiumLedger.js` caps reuse of one payment.
- **Promo codes:** `PSYCHEAI_PROMO_CODES=CODE:cap:lastday:percent`, handled by `lib/promo.js`. A link can carry a code as `?promo=`.
- **Persistent state:** all of it lives in `lib/store.js` (Upstash Redis when `UPSTASH_REDIS_REST_*` is set, otherwise in memory and lost on restart).
  - stats and budget: `lib/stats.js`, `lib/budget.js`;
  - the free first report (one open of the link), referral credits (3 cards each), gifts and the guess-your-character game (`judgeGuess`; a guess is judged only against a card being written, never a remembered one): `lib/referral.js`;
  - Ask PsycheAI question credits (five per `ask` payment, plus the link's credits; counts only, never a question): `lib/askcredits.js`;
  - Syncs sent back to a link's owner: `lib/syncbox.js`;
  - the encrypted short-link blobs: `lib/links.js` (AES-GCM; the key is only in the URL fragment);
  - promo uses and rate limits.
- **Results cache:** finished reports are held in memory only (`lib/results.js`, about 4h) so a dropped connection is not charged twice.
- **`/api/status`:** deliberately exposes only `ready`, `mock`, `freeAnalyses`, `minWriting`, `shortLinks`, `firstRun` and `build.version`. A selftest pins the exact key set.

**Client (`docs/`).** No framework. Scripts are plain `<script>` tags that communicate through `window.*` globals. Load order is in `docs/index.html`, and `app.js` is last.
- **Reading exports:** `zip.js` → `instagram.js` / `supplement.js` (Google, Facebook) / `whatsapp.js` read the exports in the browser.
- **The digest:** `digest.js` builds it.
  - Budgets: one line for every read, free or paid, `DIGEST_CHARS` 179k: three pools by kind of evidence plus ~6k fixed (`POOL_CAPS`, `POOLS`, `trimToPools`). Public 70k (Instagram's own share 50k, `INSTAGRAM_PUBLIC_CHARS`; Facebook above it); conversations 95k; Google 8k. Spare room flows one way: what conversations leave unused goes to the public pool (`conversationsSpare`), never the reverse. Extra Instagram lists fill the public pool's spare room, each to its own ceiling (`EXTRA_CAPS`), trimmed first except a guaranteed 3k (`EXTRAS_GUARANTEED`).
  - Conversations: WhatsApp chats go first, up to 25k a chat beside Instagram (with no Instagram, 45k each for two chats and 30k for three, so two fill what three do), and Instagram DMs with Messenger keep at least 30k when present, in 5k steps (`waChatChars`); squeezed under 50k, the DMs drop to their top six threads (`focusThreads`). A digest of chats alone is `buildFromSupplements`, with no Instagram part (`hasInstagram`).
  - The premium read is rebuilt at the premium pools from the export when it is still open in the tab (reviewed before payment), otherwise it is the card's digest with any added source merged in. Costs are priced by `FREE_COST_CAP`, `COST_CAP` and the `DEEP_*` caps.
  - `trimToBudget` enforces all of it.
  - `forModel` whitelists exactly what the server will pass on; the server re-applies it.
- **The card:** `card.js` encodes the card payload for links (`Card.shape`, `encodeCard`/`decodeCard`).
- **API calls:** `llm.js` handles them, including background jobs with polling and resume.
- **The app:** `app.js` is the whole SPA, about 10k lines.
  - Views are `<section id="view-*">`, switched by `show()`/`go()`.
  - `#view-profile` has two modes: `profilePage` `'hub'` (My Psyche) and `'report'` (My Report).
  - State lives in `localStorage` under the `KEYS` table; "Delete everything" clears every key in it.
  - "Save a backup" writes the `BACKUP_KEYS` subset (card, report, digest, the latest report's own digest, syncs, Ask PsycheAI history, the thumbs on findings, link and invite secret) to a .json file, and "Restore from a backup" in the Add your data popout validates each part (`readBackup`) before writing it back. A new stored key that a reader would miss on a new device belongs in `BACKUP_KEYS`.
- **Words:** `copy.js` (`window.PsycheCopy`, used as `TEXT`/`Copy`) holds nearly all user-facing strings; edit wording there, not inline.
- **PDFs:** `pdf.js` builds them in the browser.
- **Character art:** `character-art.js`.
- **Static pages:** `docs/*.html` (guides, privacy, terms, refunds, 404) are script-free pages sharing `styles.css`.

**One report layout.** The report is the structured one (five parts, one thread). The classic layout and its `PSYCHEAI_REPORT_LAYOUT` switch were retired on 18 Oct 2026; its prompt and schema survive only as the base the report is spliced from (`FULL_SYSTEM_BASE`, `PROFILE_SCHEMA`, `CARD_BASE_SYSTEM`, `CARD_BASE_SCHEMA`, and `BASE_FULL_SCHEMA` as the size yardstick for Gemini). The PDF exists only for an unlocked report: `build` in `docs/pdf.js` is `buildStructured`.

**Card image export.** `cardImageBlob` in `app.js` serialises the card into an SVG `foreignObject`.
- Only CSS rules matching `:root`, `.psyche-card` or `.pc-*` (`CARD_RULE`) are copied into the image.
- Dark-mode `@media` rules are skipped, so exports are always the light theme.
- The site CSP forbids inline `<style>` injection; tooling sets styles through the DOM instead.

## Conventions that matter here

- **README.md is the design log.** It records why each behaviour exists, often with the numbers behind it. Update the relevant section with every behaviour change. Its opening overview predates later product changes: Psyche Sync is now friends-only, and links rather than camera QR scanning are the main path.
- **Card wording:** anything printed on the Psyche Card (headline, write-up, pattern names) must be neutral or positive and never romantic. Psyche Sync output is written constructively. These are enforced in the prompts and pinned by selftest.
- **No therapy claims:** PsycheAI is coaching and insight, never therapy, treatment or diagnosis, because several US states restrict AI therapy. Disclaimers are fine. A selftest scans every page, caption and reel script for clinical claim phrases.
- **Privacy wording:** user-facing privacy claims must stay literally true (e.g. the review sheet and the "Load your data" note). The tests check several of them against the code.
- **Branch:** work happens on the long-lived branch `claude/instagram-personality-compatibility-oqhpa3`, which Render auto-deploys from. Pushing deploys.
