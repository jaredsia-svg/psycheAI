#!/usr/bin/env bash
# Builds the PsycheAI promo video from scratch: npm run promo
#
# First run sets up a Python environment and downloads the voice and the speech
# recogniser into promo/.cache (about 350 MB, kept for later runs). Everything it
# makes lands in promo/out. See promo/README.md.
set -euo pipefail
cd "$(dirname "$0")"
CACHE=.cache
PY=$CACHE/venv/bin/python
RELEASES=https://github.com/k2-fsa/sherpa-onnx/releases/download

if [ ! -x "$PY" ]; then
  echo "Setting up Python in $CACHE/venv"
  python3 -m venv $CACHE/venv
  $CACHE/venv/bin/pip install -q -r requirements.txt
fi
fetch() { # fetch <release path> <directory it unpacks to> <into>
  if [ ! -d "$3/$2" ]; then
    echo "Downloading $2"
    mkdir -p "$3"
    curl -sSL "$RELEASES/$1" | tar xj -C "$3"
  fi
}
fetch tts-models/vits-piper-en_US-ljspeech-high.tar.bz2 vits-piper-en_US-ljspeech-high $CACHE/voices
fetch asr-models/sherpa-onnx-whisper-base.en.tar.bz2 sherpa-onnx-whisper-base.en $CACHE/asr
FF=$($PY -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")

echo "Voiceover"; $PY vo.py
echo "Music and mix"; $PY audio.py
echo "Video"; node render.mjs --video "$FF"

mkdir -p out
cp build/psycheai-reel.mp4 out/PsycheAI-reel.mp4
# The same picture over the music alone, for posting with Instagram's own music or captions.
"$FF" -y -v error -i build/psycheai-reel.mp4 -i build/music-only.wav -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart out/PsycheAI-reel-music-only.mp4
# A cover frame from the card scene.
COVER=$($PY -c "import json; s = json.load(open('build/timeline.json'))['scenes'][5]; print(s['marks'][3])")
"$FF" -y -v error -ss "$COVER" -i build/psycheai-reel.mp4 -frames:v 1 -q:v 2 out/PsycheAI-reel-cover.jpg
# A lighter copy for the website: 720 wide, a few MB instead of ~25.
"$FF" -y -v error -i build/psycheai-reel.mp4 -vf scale=720:-2 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart out/PsycheAI-reel-web.mp4
ls -lh out
