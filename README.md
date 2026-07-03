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

## Run it

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
