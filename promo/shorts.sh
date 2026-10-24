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
  # The cover: the card just after it has landed; in the roast, "You're only 27."; in coach, the answer typed out; in career and relationship, the report's cards; in compare, the two answers side by side.
  SCENE=3; case $R in coach*) SCENE=5;; career|relationship|compare) SCENE=4;; esac
  COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][$SCENE]; print(s['vo'] + 1.6)")
  # In the roast, the last burn just after its punchline lands.
  if [ "$R" = roast ]; then COVER=$($PY -c "import json; s = json.load(open('build/$R/timeline.json'))['scenes'][3]; print(s['marks'][1] + 0.7)"); fi
  "$FF" -y -v error -ss "$COVER" -i "build/$R/video.mp4" -frames:v 1 -q:v 2 "out/PsycheAI-$R-cover.jpg"
done
ls -lh out/PsycheAI-notes* out/PsycheAI-mbti* out/PsycheAI-coach* 2>/dev/null
