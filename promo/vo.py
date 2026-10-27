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
# The voice: LJSpeech unless a reel names another Piper voice in PROMO_VOICE (the roast reel's is British
# and male, for Sherlock). Each is downloaded into .cache/voices.
VOICE = os.environ.get('PROMO_VOICE', 'en_US-ljspeech-high')
M = HERE + f'/.cache/voices/vits-piper-{VOICE}/{VOICE}'
v = PiperVoice.load(M + '.onnx', config_path=M + '.onnx.json')
SR = v.config.sample_rate
W = HERE + '/.cache/asr/sherpa-onnx-whisper-base.en/base.en-'
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=W + 'encoder.int8.onnx', decoder=W + 'decoder.int8.onnx',
                                                 tokens=W + 'tokens.txt', language='en', task='transcribe')
# A second recogniser, for when each word is said: Whisper hears the words best, this one says when.
Z = HERE + '/.cache/asr/sherpa-onnx-zipformer-en-2023-06-26/'
timer = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=Z + 'encoder-epoch-99-avg-1.int8.onnx',
                                                      decoder=Z + 'decoder-epoch-99-avg-1.onnx',
                                                      joiner=Z + 'joiner-epoch-99-avg-1.int8.onnx', tokens=Z + 'tokens.txt')
BRAND = list('sˈaɪkiː ˈeɪ ˈaɪ')
TAKES = 24

# (phrases, length scale, record each phrase on its own[, pause between phrases in seconds]).
# A phrase may be (text, length scale) to be said at its own pace, and the pause a list, one per gap.
# A list has no pauses to find,
# so its phrases are recorded one by one, each checked on its own.
LINES = [
    (['What if I told you...'], 0.87, None),
    (['you could get a full personality study of yourself,'], 0.87, None),
    (['without answering a single question?'], 0.87, None),
    # Slower than the rest, and a beat after "footprint" so the idea lands before the payoff.
    (["And what if your digital footprint,", "could show you patterns you have never noticed before?"], 1.0, True, 0.38),
    # Two halves, each checked on its own: as one take "data you" kept coming back "debtor you", and a
    # single word on its own ("WhatsApp,", "Google,") comes out garbled.
    # "Whatsapp" as one word (spelled "WhatsApp" the voice says two, slowly, stressed on "app"), and
    # said quicker than the rest with "Google" in a phrase of their own.
    (['{B} reads the Instagram,', ('Whatsapp, Google,', 0.8), 'and Facebook data you already have.'], 1.0, True, [0.05, 0.06]),
    # The card's own line is said slower than the list after it, with a beat before the list starts.
    ([("You will get a Psyche Card.", 1.0), "Which character you're most like,", 'your signature patterns,', 'your motivations,',
      'your type and traits,', 'your interests and values,', 'your love languages,', "and who you sync with."],
     0.87, True, [0.45] + [0.06] * 6),
    # Parts 1 and 2 together as "the full explanations" (the card already showed what they explain).
    (['Then unlock your Psyche Report,', 'which has the full explanations,', 'how you connect,', 'how you work,', 'and a plan to grow.'], 0.87, True),
    # Psyche Sync, after the report: a beat between the two halves.
    # Psyche Sync, said as what it gives: ending on "clicks." so the line falls.
    (['Then sync with a friend', 'to see what clicks.'], 0.92, True, 0.06),
    (['Your files never leave your device.', 'Only a de-identified summary is analysed by Gemini,', 'and {B} keeps no copy.'], 0.92, None),
]
# The closing line: this, then each version's own words from config.json.
END = 'Your first Psyche Card is free!'

# Other names the voice gets wrong, given as sounds the same way: {Mulan} (it said "Meellen"; "Moo-larn", as the
# owner says it, since 24 October 2026, where it was "moo-lan") and {Odysseus} ("Utysis"). The recogniser hears
# them as the plain word.
# Odysseus is given in three parts, oh-DISS-ee-us, since the run-together form read oddly (24 October 2026).
NAMES = {'{Mulan}': list('muːlˈɑːn'), '{Odysseus}': list('oʊ dˈɪsi əs'),
         # The address said as seven even syllables, Psy-che-A-I-dot-I-O, for the male voices: given the brand's
         # sounds (BRAND), Ryan runs the A and I together, and "Psyche" said as "sigh key" keeps them apart.
         '{PsycheAIdotIO}': list('sˈaɪ kˈiːʲ ˌeɪˈaɪ dˈɑːt aɪ ˈoʊ'),
         # Quicker, and with "Psyche" as one word, so the A and I stay apart mid-sentence (the form above was heard
         # as "psychei" in the mirror reel's last line, 24 October 2026).
         '{PsycheAIdotIOquick}': list('sˈaɪki ˌeɪˈaɪ dˌɑːt ˌaɪˈoʊ'),
         # Every letter given its sound: as text, "E N T P" after "of" was said "ANTP" (24 October 2026).
         '{MBTIofENTP}': list('ˈɛm bˈiː tˈiː ˈaɪ əv ˈiː ˈɛn tˈiː pˈiː'),
         # WOTS-ap, stressed first: as text it was "wuts-APP" (27 October 2026).
         '{WhatsApp}': list('wˈʌtsæp')}

def named(text):
    """Phonemes for a line with a {Name} in it: the words around it phonemized, the name as given."""
    sents = [[]]
    for part in re.split(r'(\{\w+\})', text):
        if part in NAMES or part == '{B}':
            sents[-1] = sents[-1] + ([' '] if sents[-1] else []) + (BRAND if part == '{B}' else NAMES[part])
        elif re.search('[A-Za-z0-9]', part):
            # Punctuation straight after a name ("{Mulan}. The…") stays with the name, so the voice pauses there.
            lead = re.match(r'\s*([,.?!]*)', part).group(1)
            if lead: sents[-1] = sents[-1] + list(lead)
            said = v.phonemize(part[len(re.match(r'\s*[,.?!]*', part).group(0)):])
            sents[-1] = sents[-1] + ([' '] if sents[-1] else []) + said[0]
            sents += said[1:]
        elif part.strip():
            sents[-1] = sents[-1] + list(part.strip())
    return sents

def phonemes(text):
    if any(name in text for name in NAMES): return named(text)
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
    text = text.replace('{WhatsApp}', 'whatsapp').replace('{MBTIofENTP}', 'mbti of entp').replace('{PsycheAIdotIOquick}', 'psyche ai dot i o').replace('{PsycheAIdotIO}', 'psyche ai dot i o').replace('{B}', 'psyche ai').replace('analysed', 'analyzed').lower()
    # The recogniser writes a spoken address as one: "psyche ai dot app" comes back "psycheai.app".
    text = re.sub(r'(?<=[a-z])\.(?=[a-z])', ' dot ', text).replace('psycheai', 'psyche ai')
    # A spelled-out ending, "dot I O", is heard as ".io", and a spelled-out type, "E N T P", as "ENTP".
    return [part for w in re.findall(r"[a-z']+", text)
            for part in (['i', 'o'] if w == 'io' else list(w) if re.fullmatch('[ei][ns][tf][jp]', w) else [w])]

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

def speak(phrases, ls, split, pause=0.06):
    """One line: its audio, where each phrase after the first starts, and how it scored."""
    if split:
        out, cuts, t, scores = [], [], 0.0, []
        for k, p in enumerate(phrases):
            text, pace = p if isinstance(p, tuple) else (p, ls)
            score, a = best_take(text, pace)
            gap = (pause[k - 1] if isinstance(pause, list) else pause) if k else 0
            if k: out.append(np.zeros(int(gap * SR), np.float32)); t += gap; cuts.append(round(t, 3))
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

def word_times(a, script):
    """When each word of the script starts in `a`, in seconds.

    The recogniser's words are lined up against the script's, so a word it
    mishears ("you are" for "your") still gets its neighbours' timing: matched
    words take the recogniser's time, the rest are placed evenly between them.
    """
    s = timer.create_stream(); s.accept_waveform(SR, a); timer.decode_stream(s)
    heard_words, times = [], []
    for token, at in zip(s.result.tokens, s.result.timestamps):
        if token.startswith(' ') or not heard_words:
            heard_words.append(''); times.append(at)
        heard_words[-1] += token.strip().lower()
    want = words(script)
    known = {}
    for block in difflib.SequenceMatcher(None, want, heard_words).get_matching_blocks():
        for k in range(block.size): known[block.a + k] = times[block.b + k]
    out = []
    for i, w in enumerate(want):
        if i in known: out.append(known[i]); continue
        before = max((j for j in known if j < i), default=None)
        after = min((j for j in known if j > i), default=None)
        if before is not None and after is not None:
            out.append(known[before] + (known[after] - known[before]) * (i - before) / (after - before))
        elif before is not None: out.append(known[before] + 0.25 * (i - before))
        elif after is not None: out.append(max(0.0, known[after] - 0.25 * (after - i)))
        else: out.append(len(a) / SR * i / max(1, len(want)))
    return [[w, round(t, 3)] for w, t in zip(want, out)]

def write(name, phrases, ls, split, pause=0.06):
    a, cuts, ok, score, got = speak(phrases, ls, split, pause)
    a = a / np.max(np.abs(a)) * 0.9
    sf.write(f'{OUT}/{name}.wav', a, SR, subtype='PCM_16')
    print(name, f'{len(a) / SR:.2f}s', 'score', round(score, 3), 'pauses ok' if ok else 'PAUSES?', [0.0] + cuts, '|', got)
    word_marks[name] = word_times(a, ' '.join(p[0] if isinstance(p, tuple) else p for p in phrases))
    return [0.0] + cuts

# Lines 1-9 are shared; the closing line is spoken once per version in config.json.
# (privacy.py imports this file for the voice and writes its own lines.)
word_marks = {}
if __name__ == '__main__':
    marks = {'lines': [write(f'l{i:02d}', *line) for i, line in enumerate(LINES, 1)], 'end': {}, 'words': word_marks}
    for version, settings in CONFIG.items():
        marks['end'][version] = write(f'l{len(LINES) + 1:02d}-' + version, [END, settings['spoken']], 0.9, True)
    json.dump(marks, open(OUT + '/marks.json', 'w'))
