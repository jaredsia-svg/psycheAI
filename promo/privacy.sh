#!/usr/bin/env bash
# Builds the privacy reel (about 24 s): npm run promo:privacy
# Needs promo/.cache from a first `npm run promo`. Pass --vo to remake the voice.
# See promo/README.md.
set -euo pipefail
cd "$(dirname "$0")"
PY=.cache/venv/bin/python
FF=$($PY -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
$PY privacy.py "$@"
node render.mjs privacy --video "$FF"
mkdir -p out
cp build/privacy/video.mp4 out/PsycheAI-privacy.mp4
"$FF" -y -v error -i build/privacy/video.mp4 -i build/privacy/music-only.wav -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart out/PsycheAI-privacy-music-only.mp4
# The cover: Step 3, the summary at Vertex AI and "Never used to train AI".
COVER=$($PY -c "import json; s = json.load(open('build/privacy/timeline.json'))['scenes'][3]; print(s['end'] - 0.4)")
"$FF" -y -v error -ss "$COVER" -i build/privacy/video.mp4 -frames:v 1 -q:v 2 out/PsycheAI-privacy-cover.jpg
ls -lh out/PsycheAI-privacy*
