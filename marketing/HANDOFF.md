# Handoff: marketing and site work (25 October 2026)

Read this first in a new session, together with `CLAUDE.md` and `marketing/INSTAGRAM.md`.

## Where things stand

- **Branch:** `claude/instagram-personality-compatibility-oqhpa3`. Pushing deploys to Render.
- **Tests:** the site passes both suites, `npm test` (1513 checks) and `npm run test:ui` (1598 checks).
- **Last site change:** the front-page header now reads "Your personal AI coach / that already knows you."
  - The link-preview tags, og-card v=4, the manifest and the README tagline match it.
  - The source-code links point to the deploy-branch tree.
- **Security:** fixes B3 (sync seal), B4 (NUL → 400) and B5 (COOP) are live.
- **Stories:** `marketing/stories/` holds start-1..4.png and privacy-1..4.png, from `node promo/stories.mjs` and `promo/stories-stage.html`.
- **Finished reels:** in `marketing/reels/`. Captions are in `marketing/INSTAGRAM.md`.

## In progress: the ChatGPT reel (`chatgpt`)

The user wants it much more engaging and convincing ("high impact"), with different music.

- **Stage:** `promo/chatgpt-stage.html`.
- **Script:** the `REELS['chatgpt']` entry in `promo/shorts.py`.
- **Build:** `bash promo/shorts.sh chatgpt`, then `cp promo/out/PsycheAI-chatgpt* marketing/reels/`.
  - The final `ls` in shorts.sh exits with code 2, which is harmless.
  - Don't edit shorts.sh while a build is running.
- **Claims about ChatGPT** must stay literally true, using the FAQ's wording about its personal plans:
  - It *may* train on your data unless you turn that off.
  - Data is kept until you delete it, then up to 30 days.
- **Claims about PsycheAI:**
  - Only a de-identified text summary of 100–200 KB leaves your phone; no photos or videos.
  - The reader reviews the summary before it is sent.
  - It goes to an enterprise tier (Google Vertex AI), which doesn't train on it.
  - No accounts; results stay on your device.

## Awaiting the user's go-ahead (don't do these unasked)

1. **Put the two front-page mock-up sections live.**
   - The sections are "Why PsycheAI stands out as your personal AI coach" and "Why not just upload my data to ChatGPT?".
   - The mock-ups are `marketing/site-mockups/front-page-sections.html` and `.css`.
   - Add the HTML to `docs/index.html` before `#request-data`. The CSS goes in `docs/styles.css`, because the CSP forbids inline styles.
   - Then add uitest checks, update the README, run both suites and push.
2. **Relationship reel:** switch "Try it at psycheai.io" to `{PsycheAIdotIOquick}`.
3. **Older reels:** optionally rebuild notes, mbti and intro with the new Mulan pronunciation.
4. **Roast reel:** optionally soften the 4 s drop hit.
5. **Rate limiter:** optionally add a diagnostic log for the X-Forwarded-For proxy chain.

## The promo toolchain

- **`promo/.cache` is not in git.** It holds 2.4 GB: the Python venv, Piper voices and ASR models.
  - A fresh container won't have it. Rebuild it with a first `npm run promo` (see `promo/README.md`).
- **Voice:** `promo/vo.py` renders it with Piper and checks every line with ASR.
  - Use the phoneme tokens in `NAMES` for hard words:
    - `{PsycheAIdotIOquick}` for the address, said quickly;
    - `{Mulan}`, `{Odysseus}` and `{MBTIofENTP}`.
- **Music:** each reel's `mood` picks a branch in `promo/shorts.py`.
- **Card images:** `promo/capture.mjs` writes the character card PNGs.
  - Afterwards, restore `card.png`, `card-odysseus.png`, `card-sherlock.png` and `card-parts.json` with `git checkout`.
- **Killing stray servers:** never `pkill -f` a pattern that also appears in the same command line, because it kills its own shell. Use `pkill -f "^node server.js$"`.
