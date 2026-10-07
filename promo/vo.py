"""Voiceover lines from the LJSpeech Piper voice, with the start of every phrase found.

PsycheAI is given as phonemes (SY-kee AY EYE, both letters stressed): every spelling
of it either ran the words together ("Psychete AI") or broke "A. I." into sentences.

The voice varies from take to take, so each line is spoken several times, a speech
recogniser transcribes every take, and the one closest to the script is kept. Phrase
starts come from that take's pauses: the longest silences, one per phrase boundary.
"""
import json, os, re, difflib, numpy as np, soundfile as sf, sherpa_onnx
from piper import PiperVoice, SynthesisConfig

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE + '/build/vo'
os.makedirs(OUT, exist_ok=True)
CONFIG = json.load(open(HERE + '/config.json'))
M = HERE + '/.cache/voices/vits-piper-en_US-ljspeech-high/en_US-ljspeech-high'
v = PiperVoice.load(M + '.onnx', config_path=M + '.onnx.json')
SR = v.config.sample_rate
W = HERE + '/.cache/asr/sherpa-onnx-whisper-base.en/base.en-'
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=W + 'encoder.int8.onnx', decoder=W + 'decoder.int8.onnx',
                                                 tokens=W + 'tokens.txt', language='en', task='transcribe')
BRAND = list('sˈaɪkiː ˈeɪ ˈaɪ')
TAKES = 24

# (phrases, length scale, record each phrase on its own). A list has no pauses to find,
# so its phrases are recorded one by one, each checked on its own.
LINES = [
    (['What if I told you...'], 0.87, None),
    (['you could get a full personality study of yourself,'], 0.87, None),
    (['without answering a single question?'], 0.87, None),
    (["And what if your digital footprint could show you patterns you have never noticed before?"], 0.87, None),
    (['{B} reads the Instagram,', 'Google,', 'and Facebook data you already have.'], 1.0, None),
    (["You'll get a Psyche Card.", "Which character you're most like,", 'your signature patterns,', 'your motivations,',
      'your type,', 'your traits,', 'your interests and values,', 'and your love languages.'], 0.87, True),
    (['Then unlock the full report.', 'Who you are,', 'what drives you,', 'how you connect and work,', 'and a plan to grow.'], 0.87, True),
    (['Your files never leave your device.', 'Only a de-identified summary is analysed by Gemini,', 'and {B} keeps no copy.'], 0.92, None),
]
# The closing line: this, then each version's own words from config.json.
END = 'Your first Psyche Card is free!'

def phonemes(text):
    if '{B}' not in text: return v.phonemize(text)
    before, after = text.split('{B}')
    sents = v.phonemize(before) if before.strip() else [[]]
    tail = v.phonemize(after) if re.search('[A-Za-z]', after) else [list(after.strip())]
    sents[-1] = sents[-1] + ([' '] if sents[-1] else []) + BRAND + ([' '] if re.search('[A-Za-z]', after) else []) + tail[0]
    return sents + tail[1:]

def say(text, ls):
    cfg = SynthesisConfig(length_scale=ls)
    gap = np.zeros(int(0.1 * SR), np.float32)
    parts = [v.phoneme_ids_to_audio(v.phonemes_to_ids(s), cfg) for s in phonemes(text)]
    return np.concatenate([x for p in parts for x in (p, gap)][:-1])

def trim(a, thr=0.004):
    loud = np.nonzero(np.abs(a) > thr)[0]
    return a[max(0, loud[0] - int(0.06 * SR)): loud[-1] + int(0.06 * SR)]

def heard(a):
    pad = np.zeros(SR // 5, np.float32)
    s = rec.create_stream(); s.accept_waveform(SR, np.concatenate([pad, a, pad])); rec.decode_stream(s); return s.result.text

def words(text):
    text = text.replace('{B}', 'psyche ai').replace('analysed', 'analyzed').lower()
    # The recogniser writes a spoken address as one: "psyche ai dot app" comes back "psycheai.app".
    text = re.sub(r'(?<=[a-z])\.(?=[a-z])', ' dot ', text).replace('psycheai', 'psyche ai')
    return re.findall(r"[a-z']+", text)

def pauses(a, phrases):
    """Where each phrase after the first starts: the silence nearest where its share of the script falls."""
    frame = int(0.01 * SR)
    quiet = np.array([np.max(np.abs(a[i:i + frame])) < 0.02 for i in range(0, len(a) - frame, frame)])
    runs, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None: start = i
        if not q and start is not None:
            if start > 5 and i - start >= 4: runs.append(i * 0.01 - 0.03)
            start = None
    chars = [len(p) for p in phrases]
    total, out, last = len(a) / SR, [], 0.0
    for k in range(1, len(phrases)):
        expect = total * sum(chars[:k]) / sum(chars)
        near = [r for r in runs if r > last + 0.25]
        if not near: return None
        pick = min(near, key=lambda r: abs(r - expect))
        if abs(pick - expect) > 0.8: return None
        out.append(round(pick, 3)); last = pick
    return out

def best_take(text, ls):
    """The take of `text` the recogniser hears closest to the script."""
    best = None
    for take in range(TAKES):
        a = trim(say(text, ls))
        score = difflib.SequenceMatcher(None, words(text), words(heard(a))).ratio()
        if best is None or score > best[0]: best = (score, a)
        if score == 1.0: break
    return best

def speak(phrases, ls, split):
    """One line: its audio, where each phrase after the first starts, and how it scored."""
    if split:
        out, cuts, t, scores = [], [], 0.0, []
        for k, p in enumerate(phrases):
            score, a = best_take(p, ls)
            if k: out.append(np.zeros(int(0.06 * SR), np.float32)); t += 0.06; cuts.append(round(t, 3))
            out.append(a); t += len(a) / SR; scores.append(round(score, 2))
        return np.concatenate(out), cuts, True, min(scores), 'phrase scores ' + str(scores)
    best = None
    for take in range(TAKES):
        a = trim(say(' '.join(phrases), ls))
        got = words(heard(a))
        score = difflib.SequenceMatcher(None, words(' '.join(phrases)), got).ratio()
        cuts = pauses(a, phrases)
        ok = cuts is not None
        key = (ok, score)
        if best is None or key > best[0]: best = (key, a, cuts or [], ' '.join(got))
        if ok and score == 1.0: break
    (ok, score), a, cuts, got = best
    return a, cuts, ok, score, got

def write(name, phrases, ls, split):
    a, cuts, ok, score, got = speak(phrases, ls, split)
    a = a / np.max(np.abs(a)) * 0.9
    sf.write(f'{OUT}/{name}.wav', a, SR, subtype='PCM_16')
    print(name, f'{len(a) / SR:.2f}s', 'score', round(score, 3), 'pauses ok' if ok else 'PAUSES?', [0.0] + cuts, '|', got)
    return [0.0] + cuts

# Lines 1-8 are shared; the closing line is spoken once per version in config.json.
marks = {'lines': [write(f'l{i:02d}', *line) for i, line in enumerate(LINES, 1)], 'end': {}}
for version, settings in CONFIG.items():
    marks['end'][version] = write('l09-' + version, [END, settings['spoken']], 0.9, True)
json.dump(marks, open(OUT + '/marks.json', 'w'))
