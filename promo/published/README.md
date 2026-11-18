# Published promo files

The finished files to post, copied from `promo/out/` (which git leaves out, since every build rewrites it).
After rebuilding one, copy it here again and commit, so this folder always holds what's live.

| File | What it is | Built by |
| --- | --- | --- |
| `PsycheAI-muse-howto.mp4` | The Muse how-to reel, about 30 s, 1080×1920: post this | `npm run promo:howto` |
| `PsycheAI-muse-howto-music-only.mp4` | The same with music only, for Instagram's own audio or captions | `npm run promo:howto` |
| `PsycheAI-muse-howto-cover.jpg` | Its cover: Step 6, the card and report in the chat | `npm run promo:howto` |
| `PsycheAI-muse.mp4` | The Muse reel: "Install psycheai.io/skill and generate my Psyche" | `npm run promo -- muse` |
| `PsycheAI-muse-carousel-1.png` … `-4.png` | The Muse carousel, four slides, in order | `node promo/carousel-muse.mjs` |

The privacy reel's website copy is `docs/media/psycheai-privacy.mp4` (720 wide); its full-size post isn't kept here.
