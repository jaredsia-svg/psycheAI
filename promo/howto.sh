#!/usr/bin/env bash
# Builds the Muse how-to reel (about 25 s): npm run promo:howto
# Needs promo/.cache from a first `npm run promo`. Pass --vo to remake the voice.
# See promo/README.md, "The Muse how-to reel".
set -euo pipefail
cd "$(dirname "$0")"
PY=.cache/venv/bin/python
FF=$($PY -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
$PY howto.py "$@"
node render.mjs howto --video "$FF"
mkdir -p out
cp build/howto/video.mp4 out/PsycheAI-muse-howto.mp4
"$FF" -y -v error -i build/howto/video.mp4 -i build/howto/music-only.wav -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart out/PsycheAI-muse-howto-music-only.mp4
# The cover: Step 4, the card and report in the chat.
COVER=$($PY -c "import json; s = json.load(open('build/howto/timeline.json'))['scenes'][4]; print(s['end'] - 0.3)")
"$FF" -y -v error -ss "$COVER" -i build/howto/video.mp4 -frames:v 1 -q:v 2 out/PsycheAI-muse-howto-cover.jpg
ls -lh out/PsycheAI-muse-howto*
