#!/usr/bin/env bash
# Builds the PsycheAI promo video from scratch: npm run promo
#
# First run sets up a Python environment and downloads the voice and the speech
# recogniser into promo/.cache (about 350 MB, kept for later runs). Everything it
# makes lands in promo/out, and the website version also in docs/media.
# See promo/README.md.
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
mkdir -p out
# Every version in config.json, or only those named: npm run promo -- site
VERSIONS=${*:-$($PY -c "import json; print(' '.join(json.load(open('config.json'))))")}
for V in $VERSIONS; do
  echo "Music, mix and video: $V"
  $PY audio.py "$V"
  node render.mjs "$V" --video "$FF"
  # The cover or poster: the Psyche Card scene, halfway through "Which character you are most like",
  # with one highlight fully on rather than two crossing.
  COVER=$($PY -c "import json; m = json.load(open('build/$V/timeline.json'))['scenes'][5]['marks']; print((m[1] + m[2]) / 2)")
  case $V in
    reel)
      cp build/reel/video.mp4 out/PsycheAI-reel.mp4
      # The same picture over the music alone.
      "$FF" -y -v error -i build/reel/video.mp4 -i build/reel/music-only.wav -map 0:v -map 1:a -c:v copy \
        -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart out/PsycheAI-reel-music-only.mp4
      "$FF" -y -v error -ss "$COVER" -i build/reel/video.mp4 -frames:v 1 -q:v 2 out/PsycheAI-reel-cover.jpg
      ;;
    site)
      # 720 wide and about 4 MB, straight into the site: docs/media is what the front page plays.
      "$FF" -y -v error -i build/site/video.mp4 -vf scale=720:-2 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
        -c:a aac -b:a 96k -movflags +faststart out/PsycheAI-site.mp4
      "$FF" -y -v error -ss "$COVER" -i build/site/video.mp4 -frames:v 1 -vf scale=720:-2 -q:v 4 out/PsycheAI-site-poster.jpg
      mkdir -p ../docs/media
      cp out/PsycheAI-site.mp4 ../docs/media/psycheai-intro.mp4
      cp out/PsycheAI-site-poster.jpg ../docs/media/psycheai-intro-poster.jpg
      ;;
    *)
      cp "build/$V/video.mp4" "out/PsycheAI-$V.mp4"
      ;;
  esac
done
ls -lh out
