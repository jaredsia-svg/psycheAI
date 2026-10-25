# Handoff: marketing and site work (25 October 2026)

Read this first in a new session, together with `CLAUDE.md` and `marketing/INSTAGRAM.md`.

## Where things stand

- **Branch:** `claude/instagram-personality-compatibility-oqhpa3`. Pushing deploys to Render.
- **Tests:** the site passes both suites, `npm test` (1513 checks) and `npm run test:ui` (1602 checks).
- **Front page:** two sections sit above the Instagram steps, live since 25 Oct: `#vs-coach` (the regret question, both answers) and `#vs-chatgpt` (the four-row table).
  - They are hidden for returning readers. The README's "Why PsycheAI, and why not just ChatGPT" section explains them.
- **Last header change:** the front-page header now reads "Your personal AI coach / that already knows you."
  - The link-preview tags, og-card v=4, the manifest and the README tagline match it.
  - The source-code links point to the deploy-branch tree.
- **Security:** fixes B3 (sync seal), B4 (NUL → 400) and B5 (COOP) are live.
- **Stories:** `marketing/stories/` holds start-1..4.png and privacy-1..4.png, from `node promo/stories.mjs` and `promo/stories-stage.html`.
- **Finished reels:** in `marketing/reels/`. Captions are in `marketing/INSTAGRAM.md`.

## In progress: the ChatGPT reel (`chatgpt`)

The user wants it much more engaging and convincing ("high impact"), with different music.

A second version was built on 25 Oct.
- **Hook:** "Thinking of uploading your Instagram data to ChatGPT? Watch this first." A red "✋ WAIT" stamp slams in.
- **Upload scene:** the export zip shows an upload bar, and six chips fly into the ChatGPT cloud.
- **Warnings:** each one lands with a shake and a red flash.
- **Switch:** "Now watch PsycheAI" opens on a white flash and a music drop. A "0 photos · 0 videos · ~150 KB of text" row follows.
- **Close:** the zeros, then the call to action.
- **Music:** the new `thriller` mood in shorts.py. It is a tense D-minor tick and heartbeat with hits, then a riser and a drop into F-major four-on-the-floor.
- **Third cut (25 Oct, from the user's notes):** the Instagram icon instead of the 📦 box; one smooth SVG cloud; "unless you switch that off" removed; no boom into the switch (a beat of silence, a reversed cymbal, a bright F-major hit); the phone scene re-spaced (Enterprise AI first, the summary absorbed into it); only zeros, no countdown; "Even if a hack occurs, there's no data to steal."; "The code is public for you to inspect." at the end.
- **Fourth cut (25 Oct, "more impressive and convincing"):** opens on a realistic dark-mode ChatGPT phone screen (export attached, question typed, a finger on send as WAIT lands; the cover); the whole ChatGPT half dark; the switch a white flash and a burst of brand-coloured rings wiping to the bright ground; quicker cuts with a zoom punch on each (about 37 s).
- **Fifth cut (25 Oct):** the de-identification is its own beat, each step shown as it is said (name blanked, friends → [N1]/[P1], contacts and links removed, then only the summary flies to the enterprise AI); about 42 s.
- **Sixth cut (25 Oct):** a review beat after the de-identification (the app's review sheet; a finger switches off Direct messages and searches, presses Send this; only then does it go to the enterprise AI); "The code is public" on screen only, no longer said; about 44 s.
- **Status:** awaiting the user's feedback on the sixth cut. Next ideas, if it's still not punchy enough:
  - faster cuts (lower `hold`);
  - a real-looking ChatGPT upload UI;
  - a bigger visual contrast at the switch.

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
