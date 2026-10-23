# PsycheAI promo video

A 9:16 video (about 53 seconds) for Instagram Reels and Stories, built entirely from this folder:
the voice, the music and every frame. The website version also plays at the top of the front page.

```
npm run promo
```

It makes two versions from the same voiceover, set in `config.json`:

| Version | Ends with | Files |
| --- | --- | --- |
| `reel`, for Instagram | "Your first Psyche Card is free! Try it at PsycheAI dot io." (button: psycheai.io) | `out/PsycheAI-reel.mp4` (1080×1920, post this), `out/PsycheAI-reel-music-only.mp4`, `out/PsycheAI-reel-cover.jpg` |
| `site`, for the front page | "Your first Psyche Card is free! Try it below." | `out/PsycheAI-site.mp4` (720 wide, about 4 MB) and its poster, **also copied into `docs/media/`**, which is what the front page plays |

`npm run promo -- site` builds only the named version (the voiceover is always remade).
After building `site`, commit `docs/media/` so the site serves the new video.

The first run sets up Python in `promo/.cache` and downloads the voice and a speech recogniser
(about 700 MB, kept for later runs). A full build takes about ten minutes, most of it rendering
frames. It needs `python3`, `curl` and the repo's `npm install` (for Playwright).

## Changing the ending, the link or the colours

Each version in `promo/config.json` has three settings:

```json
{
  "reel": { "button": "psycheai.io ↗", "spoken": "Try it at {B} dot I O.", "theme": "light" },
  "site": { "button": "Try it below ↓", "spoken": "Try it below.", "theme": "light" }
}
```

- `button` is the text on the last screen's button, arrow included. A long one shrinks to fit.
- `spoken` is what the voice says after "Your first Psyche Card is free!". Write `{B}` wherever it
  should say **PsycheAI**: that is the only way it is pronounced right (see below). Spell an address
  the way it is said, as the reel's `"Try it at {B} dot I O."` does. A longer ending makes the
  video a little longer. "Link in bio" is `"button": "Link in bio ↗"`, `"spoken": "Link in bio."`.
- `theme` is `"light"` (pastel, plum text) or `"dark"` (deep purple, white text).

A version with any other name is built too, into `out/PsycheAI-<name>.mp4`.

## How it is made

1. **`vo.py`** speaks each line with the [LJSpeech](https://keithito.com/LJ-Speech-Dataset/) Piper
   voice (US English, public domain). The voice varies from take to take, so it speaks every line up
   to 24 times, has the speech recogniser transcribe each take, and keeps the first one that comes
   back word for word. Each line prints its score (1.0 is word for word).
   **PsycheAI** is given as sounds, SY-kee AY EYE, rather than spelling: written as "Psyche AI"
   the voice ran it into "Psychete AI", and as "Psyche, A. I." it ended a sentence on each letter.
   The card and report lines, which are lists, are spoken one phrase at a time so the highlights
   land on the words; `build/vo/marks.json` records where each phrase starts. A second recogniser
   (a Zipformer transducer, which reports when each word begins) times every word of every line, and
   the on-screen words are matched to the spoken ones so each pops in as the voice says it.
2. **`audio.py`** lays one version's lines out into scenes (`build/<version>/timeline.json`), writes an original
   118 BPM track for them, and mixes the two with the music ducked under the voice.
3. **`render.mjs`** draws `stage.html` frame by frame in Chromium at 30 fps and encodes it with
   the mix. The brand mark comes from `docs/copy.js`, so it matches the site.

The script itself (what each scene says) is in `vo.py` (`LINES`) and `stage.html` (the on-screen
words). Change both together.

The ten scenes, as of October 2026:

| # | Scene | What changed then |
| --- | --- | --- |
| 0–2 | The hook: no questionnaire; it is ripped up and *No questions asked.* lands | was "0 questions", now the site's headline |
| 3 | Digital footprint | |
| 4 | The data sources fly into the mark | WhatsApp added: four files, two by two |
| 5 | The Psyche Card, part by part | ends on "and who you sync with", highlighting *Most in sync with* |
| 6 | The Psyche Report | was "full report"; all five parts, *How you work* its own (a compass). The voice names 01 and 02 together as "the full explanations" (of what the card just showed) and lights them as one, then 03, 04 and 05 in turn |
| 7 | Psyche Sync | new: "Then sync with a friend to see what clicks." Two friends' cards, *Psyche Sync* in the gradient over a ring closing on a tick (Sync has no score, so none is shown). The full beat carries on through it |
| 8 | Privacy | |
| 9 | Your first Psyche Card is free | first a carousel of characters sliding slowly across (the last fifteen before her), easing to a stop on the sample card's Mulan, her name appearing under her |

`audio.py` counts nine shared lines and a closing one (`SHARED`); `BREAK` and `FINAL` in both it and
`stage.html` are scene 8 and 9. The roll and the Sync scene's two characters use the site's own
character strip, `docs/media/cast-sprite.webp` and its `.json` (`tools/cast-sprite.mjs`), which
`render.mjs` passes in as `CAST`, so a new character joins the roll by itself.

## The privacy reel

A second, short reel (about 28 seconds) walks through the privacy page's five steps:

```
npm run promo:privacy            # after a first npm run promo, which sets up .cache
npm run promo:privacy -- --vo    # remake its voice too
```

`out/PsycheAI-privacy.mp4` (post this), `out/PsycheAI-privacy-music-only.mp4` and `out/PsycheAI-privacy-cover.jpg`.
It also writes the privacy page's copy, `docs/media/psycheai-privacy.mp4` (720 wide) and its poster
`psycheai-privacy-poster.webp` (the cover's frame); commit `docs/media/` after a rebuild.
`privacy.py` speaks its six lines with the same voice (it imports `vo.py`, whose own lines only run
when it is run itself), lays them out and writes the music and mix. `privacy-stage.html` draws it, and
`render.mjs privacy` renders it. The script and scenes:

| Line | On screen |
| --- | --- |
| What happens when you load your Instagram file onto PsycheAI? | the Instagram file lands large in the middle, the WhatsApp, Google and Facebook files smaller around it |
| Your files are loaded on your phone, not uploaded. | Step 1: they land in a phone |
| Only a short summary is made, with names and handles removed. | Step 2: the same words; they fold into a summary, *100–200 KB of text* comes in on "short summary", and on "with names and handles removed" (which appears then) its name, email, phone number and handle blur into placeholders |
| You review it, and untick anything you'd rather keep. | Step 3: the app's review sheet, *Review what gets sent*, a switch a kind of data; on "untick" *Google searches* turns off, then *Send this* is pressed |
| The summary is sent encrypted to Google Vertex AI, which never trains on it. | Step 4: *The summary is sent encrypted*; it flies up locked to *Google Vertex AI enterprise*; *Never used to train AI* |
| Your results come back to you, and PsycheAI keeps no copy. | Step 5: the sample card and the sample report (`assets/report.png`) come back down; *PsycheAI keeps no copy* |
| See for yourself at PsycheAI dot io. | the mark, *See for yourself*, the reel's button, *The code is public*, *No sign-up · No cookies · No trackers* |

Through Steps 1 to 3 the phone's own screen says *No internet needed* (light green; it no longer
says *On your phone*), gone as the summary leaves at Step 4: the privacy page's two zones, said where the phone already
is (a tag above the step label was tried and dropped). The Instagram post (`post-privacy.html`) draws the
two zones round its cards, their labels in front of the cards.

Steps 1 to 3 happen on the phone, so once the files are in it grows to 1.4 times its size to fill the
frame, and settles back as Step 4 starts, to leave room for the Vertex AI panel above it. It grows again in Step 5,
once the panel has gone, with the card and the report inside it.

Each line's take is kept (`build/privacy/p<hash>.wav`, named from its words and pace), so adding or
changing a line records only that one and the approved takes stay; `--vo` records them all again.
Each line is said in one take at the main video's pace (0.92, its privacy line's). A first cut
recorded phrases one by one and sped up to fit 20 seconds, and sounded clipped and robotic; "Where
does your data go?" came out oddly on "data go", and "It's sent encrypted…" sounded off; it now
starts "The summary is sent…". An ending on "PsycheAI takes your data privacy very seriously" was
tried and dropped for "See for yourself".

The music is the main video's own track, so the two sound like one brand: it opens on the privacy
break (pads, plucks and bells, no drums), a soft kick and then hats come in under the steps with a
swoosh into each, and the last card gets the main video's ending (riser, hit, full beat, the bells
louder with an octave above, and the music swelling on the hit). The words pop in a line at a time
rather than word by word: on "It's sent encrypted to Google Vertex AI" the word timer lost its place.

## The short reels

```
npm run promo:shorts             # notes, mbti and coach; or name them: npm run promo:shorts -- coach-misunderstood
```

Short reels of 20 to 25 seconds for reach, `out/PsycheAI-notes.mp4` and `out/PsycheAI-mbti.mp4` (and a
cover each), from `shorts.py` (voice, timeline, music) and one stage, `shorts-stage.html`:

| Reel | Lines | On screen |
| --- | --- | --- |
| `notes` | Your Instagram has been taking notes on you for years. / It knows you're the one who organises every plan, you give more attention than you ask for, and you're the first to check on a friend who's gone quiet. / So I let PsycheAI read it. / I got Mulan. The organiser with a warm centre. / Comment card, and I'll send you the link. | a phone with a scrolling feed; three habits pop as they are said (Mulan's own patterns, so the reveal is earned; trivia like "saves recipes, never cooks" was tried first, and "goes quiet to recharge", which read as an introvert beside her ENFJ) and are drawn into the phone as it is read; the sample card flips in on the hit; *Comment "CARD"* |
| `mbti` | I took the MBTI test three times, and got three different answers. / So I loaded my Instagram data instead. / No questions asked. Just what my online patterns actually show. / I got Odysseus. ENTP, with the evidence. / What does yours say? Comment your type. | three test results (INFJ, ESTP, INTP) and a "?"; Instagram on the phone; three of his own signature patterns as his card evidences them (*Rescues every plan with a plan B*, *Talks every group round*, *Same few friends hear it all first*); the Odysseus sample card (`assets/card-odysseus.png`) with its MBTI ringed; the sixteen types scrolling |

| `coach` | Some questions are hard to ask anyone. / What am I most insecure about? / What do I keep trying to prove, and to whom? / What would I regret most, when I'm old? / PsycheAI answers from what your own data shows. / A coach that already knows you. / Ask yours at PsycheAI dot io. | the hook typed out as said, then each question alone on a dusk-plum ground, held for a breath (the regret one longer); the ground warms and, as the voice says PsycheAI answers from your own data, Instagram and WhatsApp fly into the phone and a *Reading your data…* bar fills with its dots flickering, so the claim is seen (added in October 2026, in the voice's own second person rather than the career reel's "So I asked"); then Ask PsycheAI answers the regret question, typed in, in plain words (*You'll wish you'd spent more time with your parents and friends.* … *Don't wait. Call home. Message them. Book the trip.*: a sample reader's, from the kinds of evidence the app reads); *Ask yours*, the address, and last *Your first question is free* |

The music is the main video's instruments in a different key and feel each: `notes` in A minor
(Am F C G) at 112, curious then bright; `mbti` in D (D A Bm G) at 124, with early claps and swung plucks.
Both end like the main video: riser, hit, the full beat. `coach-misunderstood` is the same reel opening on *What do people misunderstand about me?*: the gentler first cut, kept to post a few days apart and compare (insecure, then prove, then regret, reads as one story but is heavier). `coach` has a piece of its own, hopeful: E minor to G (Em C G D) at 88, a rolling piano with an echo and strings swelling through the questions, lifting into a light beat and bells as the answer types, ending on a bright chord. (A slower, sombre version in D minor, with the narration at 1.0, was tried first.)

### The roast reel

```
npm run promo:shorts -- roast    # out/PsycheAI-roast.mp4, about 28 s
```

Built by `shorts.py` like the others, but with a stage of its own, `roast-stage.html`, and music of its own.
It sells the free roast under every card (`secretRoast` in `docs/copy.js`): the card is nice, then *Reveal my roast*.

| Scene | Lines | On screen |
| --- | --- | --- |
| 0 | My Psyche Card was so nice. / Then I clicked, reveal my roast. | Sherlock's sample card (Daniel Okafor, `assets/card-sherlock.png`) on a warm sand ground with an orange glow round it and *so nice* in orange (pink read as too sweet for a man's reel), then the site's roast cover; a finger presses the button |
| 1 | You've saved three hundred cooking videos. / Your most cooked dish is instant noodles. | a saved grid of recipes counting to 300, greyed out under a *#1 most cooked 🍜* stamp |
| 2 | You type K when you're angry. / You've sent K two hundred fourteen times. | a friend trying to make up, answered "k." each time, the count climbing to 214; then the chat floods with them |
| 3 | You left forty seven people on red. / Including your dad. | an inbox of "Seen" chats stopping on *Dad: Proud of you. Call when you can 🙂* |
| 4 | Then it tells you what an honest friend would. | *What an honest friend would tell you* (the report's `bonusAdvice`), typed in: *You're not lazy, and you're not cold.* … *And "k." is easier than saying what actually hurt.* *Start the thing. Call your dad.* |
| 5 | Your roast is free with every card. Comment roast, if you're brave. | *Comment "ROAST"*, the address |

Burns 1 to 3 are ash and ember rather than the brand's colours: a charcoal ground lit red from below, charcoal
panels, desaturated pictures, a dark-red ROAST #n badge; the set-up shows whole as it is said, and the punchline
slams in, in ember red, with a red flash in from the edges and a shake (a first cut in the brand's pinks and
purples read as too friendly). The honest friend, by contrast, is in the brand's colours, but only its words:
*an honest friend* and the card's heading in the gradient, the card edged in it, on a dark plum ground (a full
gradient background was too loud); the ask goes back to the brand's dusk.

The burns are a made-up sample, written to the roast prompt's own rules: behaviour, never looks, health or
romance, and simple enough to get on one hearing. Earlier ones were cut: "your thumb has never been in better
shape" and "combined revenue: the likes" were too clever by half; 600 workout videos was too trivial (a skill
everyone wants, cooking, replaced it); "you never like theirs back" gave way to temper. The honest friend is
what is under all three burns, not the burns turned round (a first cut ticked off one tip per burn). Sherlock
rather than Mulan or the Tin Man: his card's late-night saves and small circle set the burns up, where the Tin
Man's checking in on quiet friends would contradict "left 47 people on read"; and the start has no hearts or
sparkles, only a glow, for a reel in a man's voice.

The voice is Piper's Ryan (`en_US-ryan-high`, `voice` in its entry, passed to `vo.py` as `PROMO_VOICE`; download
it into `.cache/voices` like the others), at 0.85. LJSpeech, then a British voice (Alan), then a darker one were
tried: too light against Sherlock, then too deep. "Read" is written "red", or the voice says it in the present.

Each burn is recorded as set-up and punchline apart (`punch` in its entry): `shorts.py` puts silence before the
punchline so it starts on a beat. The music is brass house, F major (F Dm Bb C) at 124: piano stabs and a soft
kick under the nice card; a reversed crash and riser into four on the floor, open hats on the offbeat, a funky
octave bass and a bright brass hook; the drums drop out for the beat before each punchline and a horn hit lands
on it. From the honest friend to the end, a soft crash and then the breakdown: the same chords held, a pad, the
piano on the one, the bass held, no drums; at the very end a reversed cymbal and a swell rise gently into a last
held F, with nothing struck under it. (Endings tried and dropped: a horn hit and a struck piano chord, which
landed as a bang; an anthem over a house beat, which kept the roast's energy; and a new calm piano piece, which
broke from the rest of the reel.) Two earlier pieces were dropped: B flat at
132 with a music box (too childish) and C minor trap at 140 (too sombre).

### The career reel

```
npm run promo:shorts -- career   # out/PsycheAI-career.mp4, about 29 s
```

Its own stage, `career-stage.html`, and Ryan's voice, as the roast.

| Scene | Lines | On screen |
| --- | --- | --- |
| 0 | Struggling with your job? | typed out on a dusk ground, a briefcase |
| 1 | Am I in the wrong job? / Am I the problem? | only a search bar: three doubts typed in, each with a "?", piling up as recent searches (searches are among what the app reads); the voice says the first and last, and *why does my workday go so slowly?* is typed in the pause between them |
| 2 | So I asked PsycheAI, and it answered from my own data. | the ground warms; the dots after *PsycheAI* flicker while Instagram and WhatsApp fly into the phone and a *Reading your data…* bar fills; Ask PsycheAI, the question asked |
| 3 | You don't hate your job. You hate the routine parts of it. | the answer typed in: the routine parts drain you, your longest, fastest messages are about untangling a problem; *A new job won't fix that. Go after the messy problems in the one you have.* (a sample reader's) |
| 4 | Your Psyche Report goes further. Your edge at work, what's holding you back, and the careers that suit you best. | three cards from the report's career assessment as each is named: *Your edge*, *What's holding you back*, *Careers that suit you* with *Suits you best* and *Likely to drain you* |
| 5 | A coach that already knows you. Try it at PsycheAI dot I O. | the line, the address, *Your first Psyche Card is free* |

The answer is held a second and a half once it is fully typed. "Your edge," on its own came out garbled, so it is said "your edge at work,". The first answer, "you hate
following a plan you didn't help make", was hard to follow and did not match the evidence under it. The music:
B minor (Bm G D A) at 96 for the questions, a muffled piano and a slow pulse; a swell into D major (D A Bm G) for
the answer, with a light beat of kick, snaps and shaker, a warm bass and a plucked tune; fuller for the report;
a D chord to close, rolled softly up the piano a note at a time over a swelling pad (struck all at once, it
landed as a bang).

### The relationship reel

```
npm run promo:shorts -- relationship   # out/PsycheAI-relationship.mp4, about 34 s
```

Its own stage, `relationship-stage.html` (the career reel's, reworked), and its own voice: Piper's HFC female
(`en_US-hfc_female-medium`), at 0.85, chosen from five.

| Scene | Lines | On screen |
| --- | --- | --- |
| 0 | We fought about the dishes. Again. | on an evening dusk, a plate, the line typed out, *…again.* in pink |
| 1 | Different topic. Same fight. | first, with music only (`lead` in its entry), the fights that keep coming back as messages, one after another: *You always put your parents before me.* … *You don't listen to me.*; then they blur as the voice names them |
| 2 | So I asked PsycheAI why we keep fighting over small things, and it answered from my own data. | the career reel's loading: Instagram and WhatsApp fly into the phone, *Reading your data…*, the dots flickering |
| 3 | It's not the dishes. It's feeling like you come second. | the answer typed in: she shows love by doing things, and when no one notices a small thing becomes the fight; her messages get short before an argument; *Say what you need before it builds: "I need to feel like a priority."* (a sample reader's) |
| 4 | Your Psyche Report shows how you love, how you handle conflict, and what you need from the person you love. | three cards: *How you show love* (you give / you need), *How you deal with conflict*, *What you need in a partner* |
| 5 | A coach that already knows you. Try it at PsycheAI dot I O. | the line, the address, *Your first Psyche Card is free* |

Only her data is read, so nothing speaks for him or for the couple: the report line was "how to better relate to
each other" until that was seen to promise a reading of both (Psyche Sync is friends-only). The fights are ones
that recur; a towel on the floor and the thermostat were cut as too trivial. The music: F sharp minor to A (F#m D A
E) at 84 on an electric piano with a slow tremolo and a pad; a low pulse under the fights that tightens into
eighths; the piano alone for the asking; a soft groove for the answer (brushed snare, rim, bass, a vibraphone
tune); a last A chord rolled softly up the electric piano.

## The privacy post

`node promo/post.mjs` writes `out/PsycheAI-privacy-post.png`, an Instagram post (1080 x 1350, the
feed's 4:5) of the privacy page's diagram: the five steps in their two zones and *The code is
public · psycheai.io*. Its words are the page's, shortened to fit (`post-privacy.html`); change both
together.

## Keeping the voice on the music

`audio.py` puts every cut on the beat grid (`SNAP`): the half beat in the hook, the beat from the
data scene on. Each line then
starts a pickup (`LEAD`, 0.2 s) after its cut. Scenes used to start wherever the last line ended,
which put the transition hits off the beat. Only the two big moments, the data going in and the end
card, get the riser and the hit now; the card and report cuts get a soft swoosh into them. The beat
carries on through Sync with nothing at its cut, and privacy follows on the next beat after Sync's
line (a pause there, stretched to a whole bar, left the music running on alone and dragging). The
privacy break is the original drop-out (pads, plucks, bass and bells, no drums), and the ending the
original riser and hit into the end card, then a fade. (A slower half-time break, a sub-drop into it
and a big closing chord were tried in October 2026 and dropped: they felt worse.)

## Words the voice says oddly

Write them the way the voice says them right, and check the result with the recogniser:
**PsycheAI** is given as sounds (`{B}`); **Whatsapp** is spelled with a small *a*, because
"WhatsApp" is read as two words, slowly, stressed on "app", and said a fifth quicker than the rest of
its line, in a phrase with "Google" (a phrase may carry its own pace: `('Whatsapp, Google,', 0.8)`); a list of single words is recorded in
longer phrases, since a word on its own ("Google,") comes out garbled; and a line that should fall at
its end ends on a full stop ("see how you sync.", where "sync," before "for free" rose).

## When the Psyche Card changes

The card in the video is a picture of the sample card, `assets/card.png`, with where each part
sits in `assets/card-parts.json`. After changing the card's design, recapture both:

```
npm run promo:card
```

It starts the app in mock mode on its own port, opens the sample card full screen, saves the
picture and measures each part with the same selectors the card guide uses (`syncs` included, for
the *Most in sync with* highlight). It also saves the sample report's opening, `assets/report.png`,
for the privacy reel.

## Checking a scene without rendering it all

```
node promo/render.mjs site --stills '[18.3, 27.4]'
```

writes `build/site/still-18_3.png` and `build/site/still-27_4.png` from that version's current
timeline (after a build, or after `vo.py` and `audio.py site`).

## Licences

The voice (LJSpeech) is public domain. The font is Inter (`assets/inter-LICENSE.txt`, SIL Open Font
Licence). The music is generated by `audio.py`. Mulan appears only as the app's own sword emblem
and her name, never Disney's artwork.
