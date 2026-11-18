#!/usr/bin/env bash
# Builds the short reels (about 20 to 25 s each): npm run promo:shorts [-- notes|mbti|coach|coach-misunderstood]
# Needs promo/.cache from a first `npm run promo`. Add --vo to remake every line of the voice.
# See promo/README.md.
set -euo pipefail
cd "$(dirname "$0")"
PY=.cache/venv/bin/python
FF=$($PY -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
REELS=$(printf '%s\n' "$@" | grep -v '^--' || true)
FLAGS=$(printf '%s\n' "$@" | grep '^--' || true)
mkdir -p out
for R in ${REELS:-notes mbti coach}; do
  $PY shorts.py "$R" $FLAGS
  node render.mjs "$R" --video "$FF"
  cp "build/$R/video.mp4" "out/PsycheAI-$R.mp4"
  # The cover: the card just after it has landed; in the roast, "You're only 27."; in coach, the answer typed out; in relationship, the report's cards; in career, the hook; in compare, the two answers side by side; in mirror, the first number.
  SCENE=3; case $R in coach*) SCENE=5;; relationship|compare*) SCENE=4;; esac
  COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][$SCENE]; print(s['vo'] + 1.6)")
  # In the roast, the last burn just after its punchline lands.
  # In the character reel, the Tin Man's whole card, before the camera moves in.
  if [ "${R%%-*}" = character ]; then COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][3]; print(s['start'] + 0.75)"); fi
  # In the mirror reel, the first number just after it lands.
  if [ "$R" = mirror ]; then COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][0]; print(s['marks'][1] + 0.9)"); fi
  # In the ChatGPT reel, WAIT over the ChatGPT screen, the finger on send.
  if [ "$R" = chatgpt ]; then COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][0]; print(s['marks'][1] + 0.35)"); fi
  # In the career reel, the hook fully typed: the promotion that made work worse (28 October 2026).
  if [ "$R" = career ]; then COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][0]; print(s['end'] - 0.4)"); fi
  if [ "$R" = roast ]; then COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][3]; print(s['marks'][1] + 0.7)"); fi
  "$FF" -y -v error -ss "$COVER" -i "build/$R/video.mp4" -frames:v 1 -q:v 2 "out/PsycheAI-$R-cover.jpg"
done
ls -lh out/PsycheAI-notes* out/PsycheAI-mbti* out/PsycheAI-coach* 2>/dev/null
