# 💞 Kindred — compatibility, decoded

Kindred is a web app that builds a detailed personality profile for each user — from their
social/online presence plus a science-informed questionnaire — and gives every account a unique
**QR code**. Scan another user's QR code to get an instant **romantic compatibility report**:
a weighted score, your strengths as a pair, watch-outs, and concrete advice on how to best
partner each other.

## Features

- **Accounts** — email + password (bcrypt-hashed), session-based login, all data stored in SQLite.
- **Rich profiles**
  - Social links: LinkedIn, Instagram, Twitter/X, TikTok, Facebook, website.
  - Paste-in analysis of bios/posts/LinkedIn summaries you consent to share — Kindred extracts
    interest tags and soft personality tone signals from the text.
  - Questionnaire: Big Five personality (BFI-10 style), attachment style (anxiety/avoidance),
    values importance, love languages, lifestyle rhythm, and interest tags.
- **Personal QR code** — generated server-side for every user, shown on the dashboard with a
  fallback short code (`KIN-…`).
- **QR scanning** — in-browser camera scanning (jsQR) or manual code entry.
- **Compatibility engine** — weighted blend of six research-informed dimensions:

  | Dimension | Weight | Basis |
  |---|---|---|
  | Values alignment | 25% | Shared core values predict long-term satisfaction |
  | Personality fit | 30% | Similarity on agreeableness/conscientiousness/openness, pair-level emotional stability, extraversion tolerance |
  | Attachment pairing | 15% | Secure pairings easiest; anxious+avoidant flagged with targeted advice |
  | Shared interests | 15% | Smoothed Jaccard overlap of interest tags |
  | Love languages | 10% | Whether affection naturally lands the way it's meant |
  | Lifestyle rhythm | 5% | Chronotype, social energy, planning and conflict styles |

- **Written assessment** — every report includes strengths, watch-outs, and a "how to be great
  together" section with specific, named advice for each person.
- **Match history** — both people can revisit any report from their dashboard.

## Two ways to run it

### Option 1 — hosted webapp, no installation (recommended)

The `docs/` folder contains a **zero-server version** that runs entirely in the browser:
your profile is stored on your device and encoded *inside* your QR code, so scanning works
between any two people with no accounts, database, or backend.

Host it on GitHub Pages (no command line needed):

1. On GitHub, open the repository **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick this branch and the **`/docs`** folder, then **Save**.
4. After a minute, the app is live at `https://<user>.github.io/<repo>/` — share that link.

How it differs from the server version: no login (one profile per browser, kept in
localStorage), and the QR code carries the full profile payload (~190 characters), so
compatibility is computed locally by whoever scans it. Match history is saved on-device.

### Option 2 — full server version

```bash
npm install
npm start          # http://localhost:3000
```

Environment variables (all optional):

- `PORT` — default `3000`
- `SESSION_SECRET` — set in production (random per-boot fallback otherwise)
- `BASE_URL` — public origin baked into QR codes (defaults to the request host)
- `DATA_DIR` — where the SQLite DB lives (default `./data`)

> Camera access requires HTTPS (or `localhost`). The manual code entry always works.

## A note on social data

Kindred does **not** scrape LinkedIn or social platforms — scraping violates their terms of
service. Instead, users link their profiles for identity verification and paste any public text
(bios, posts, "about" sections) they explicitly consent to having analysed. Building deeper
integrations would use each platform's official OAuth APIs.

## Stack

Node.js · Express · EJS · better-sqlite3 · bcryptjs · qrcode (server-side generation) · jsQR (client-side scanning)
