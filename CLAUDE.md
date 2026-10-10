# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PsycheAI (psycheai.io): a reader loads their own Instagram export (plus, optionally, one or more WhatsApp chats, Google Takeout or Facebook). The browser reduces it to a de-identified **digest**, the reader reviews it, and the server relays it to Gemini, Claude or Grok. The model writes:
- a free **Psyche Card**: a 1080×1920 shareable story card;
- a paid **full premium report** (US$5);
- free **Psyche Sync** friendship-compatibility reads between two people's cards, via each reader's personal link.

The server never stores exports, digests or reports.

## Commands

```bash
npm install
npm run mock          # whole app with canned analyses, no API keys, no Stripe (PSYCHEAI_MOCK=1)
npm start             # real providers: needs GEMINI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY
npm test              # tools/selftest.mjs — ~1,260 unit/integration checks, no browser
npm run test:ui       # tools/uitest.mjs — ~1,450 Playwright checks against mock servers it spawns
npm run test:live     # real API calls (costs tokens); PSYCHEAI_LIVETEST=premium runs only the paid call
node promo/capture.mjs && node promo/og.mjs   # redraw promo/assets/card.png and docs/media/og-card.jpg from the sample card
npm run promo         # rebuild the promo videos (needs promo/.cache: Python venv, voice and ASR models)
```

- **The suites have no test filter.** Both are single scripts of sequential `check(label, ok, detail)` calls. Run the whole file and grep the summary: `npm run test:ui 2>&1 | grep -E "✗|passed|failed"`.
- **Tracing a throw:** `UITEST_STACK=1` prints the stack for a thrown error.
- **Screenshots:** `node tools/uitest.mjs --shots` writes them to `tools/screenshots/`.
- **Ports:** the UI suite spawns its own mock servers on ports 4173–4176. If it fails with `ERR_CONNECTION_REFUSED`, look for a stray `node server.js` holding one of them.
- **Playwright:** Chromium is preinstalled. Do not run `playwright install`.
- **Running both:** run both suites after any change. They pin exact copy, layout and behaviour, so a wording change usually needs a matching check update.

There is no build step, bundler or linter. `docs/` is served as-is.

## Architecture

**Server (`server.js` + `lib/`).** Plain `node:http`, with no framework.
- **Static files:** `serveStatic` serves `docs/` through `lib/staticfiles.js`, which adds Brotli/gzip, weak ETags and 304s. Unknown page addresses get `docs/404.html`. Short links `/c/<id>` 302 to `/?c=<id>`, keeping the rest of the query string.
- **Routing:** the `API_GUARDS` table applies rate limits (`lib/ratelimit.js`) and single-use nonces (`lib/nonce.js`) to the routes that cost money.
- **Providers:** `lib/provider.js` picks gemini, claude, grok or mock (`lib/mock.js`). Every provider shares the prompts and JSON schemas in `lib/prompts.js`.
  - Free card: `STRUCTURED_FREE_SYSTEM` with `FREE_SCHEMA`.
  - Paid report: `PREMIUM_*`, anchored to the free card via `anchorFrom`/`anchorBlock`, so it explains the same conclusions.
  - Sync: `COMPATIBILITY_SYSTEM` with `COMPATIBILITY_SCHEMA`.
  - `selftest` pins load-bearing prompt phrases, so a prompt edit usually needs a test edit.
- **Payments:** `lib/stripe.js` charges only amounts from `docs/prices.js`, a table shared by page and server with local currencies. `verifyPaid` checks the PaymentIntent's amount against the product. `lib/premiumLedger.js` caps reuse of one payment.
- **Promo codes:** `PSYCHEAI_PROMO_CODES=CODE:cap:lastday:percent`, handled by `lib/promo.js`. A link can carry a code as `?promo=`.
- **Persistent state:** all of it lives in `lib/store.js` (Upstash Redis when `UPSTASH_REDIS_REST_*` is set, otherwise in memory and lost on restart).
  - stats and budget: `lib/stats.js`, `lib/budget.js`;
  - referral credits and gifts: `lib/referral.js`;
  - the encrypted short-link blobs: `lib/links.js` (AES-GCM; the key is only in the URL fragment);
  - promo uses and rate limits.
- **Results cache:** finished reports are held in memory only (`lib/results.js`, about 4h) so a dropped connection is not charged twice.
- **`/api/status`:** deliberately exposes only `ready`, `mock`, `freeAnalyses`, `shortLinks`, `reportLayout` and `build.version`. A selftest pins the exact key set.

**Client (`docs/`).** No framework. Scripts are plain `<script>` tags that communicate through `window.*` globals. Load order is in `docs/index.html`, and `app.js` is last.
- **Reading exports:** `zip.js` → `instagram.js` / `supplement.js` (Google, Facebook) / `whatsapp.js` read the exports in the browser.
- **The digest:** `digest.js` builds it.
  - Budgets: `DIGEST_CHARS` 80k for the free read; `DEEP_LIMITS` / `DEEP_DIGEST_CHARS` 160k for the paid read.
  - Per-source shares: `SOURCE_SHARES`.
  - WhatsApp caps: `waThreadChars`, `waChatMaxDigestShare`, `waMaxDigestShare`, and `waSoloChatChars` (one chat in a free read gets a fixed 8,000).
  - `trimToBudget` enforces all of it.
  - `forModel` whitelists exactly what the server will pass on; the server re-applies it.
- **The card:** `card.js` encodes the card payload for links (`Card.shape`, `encodeCard`/`decodeCard`).
- **API calls:** `llm.js` handles them, including background jobs with polling and resume.
- **The app:** `app.js` is the whole SPA, about 10k lines.
  - Views are `<section id="view-*">`, switched by `show()`/`go()`.
  - `#view-profile` has two modes: `profilePage` `'hub'` (My Psyche) and `'report'` (My Report).
  - State lives in `localStorage` under the `KEYS` table; "Delete everything" clears every key in it.
- **Words:** `copy.js` (`window.PsycheCopy`, used as `TEXT`/`Copy`) holds nearly all user-facing strings; edit wording there, not inline.
- **PDFs:** `pdf.js` builds them in the browser.
- **Character art:** `character-art.js`.
- **Static pages:** `docs/*.html` (guides, privacy, terms, refunds, 404) are script-free pages sharing `styles.css`.

**Report layouts.** `PSYCHEAI_REPORT_LAYOUT` is `structured` (production) or `classic`. The UI suite pins **classic** for most checks and tests structured on a second server, so a structured-only UI change can pass classic checks without being exercised.

**Card image export.** `cardImageBlob` in `app.js` serialises the card into an SVG `foreignObject`.
- Only CSS rules matching `:root`, `.psyche-card` or `.pc-*` (`CARD_RULE`) are copied into the image.
- Dark-mode `@media` rules are skipped, so exports are always the light theme.
- The site CSP forbids inline `<style>` injection; tooling sets styles through the DOM instead.

## Conventions that matter here

- **README.md is the design log.** It records why each behaviour exists, often with the numbers behind it. Update the relevant section with every behaviour change. Its opening overview predates later product changes: Psyche Sync is now friends-only, and links rather than camera QR scanning are the main path.
- **Card wording:** anything printed on the Psyche Card (headline, write-up, pattern names) must be neutral or positive and never romantic. Psyche Sync output is written constructively. These are enforced in the prompts and pinned by selftest.
- **Privacy wording:** user-facing privacy claims must stay literally true (e.g. the review sheet and the "Load your data" note). The tests check several of them against the code.
- **Branch:** work happens on the long-lived branch `claude/instagram-personality-compatibility-oqhpa3`, which Render auto-deploys from. Pushing deploys.
