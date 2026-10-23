"""Short reels for Instagram (about 20 s each): their voiceover, timeline, music and mix.

    python shorts.py notes   # "Your Instagram has been taking notes on you": Mulan
    python shorts.py mbti    # "I took the MBTI test three times": Odysseus
    python shorts.py coach   # "Some questions are hard to ask anyone": Ask PsycheAI
    python shorts.py coach-misunderstood   # the same, opening on "What do people misunderstand about me?"

npm run promo:shorts builds both. The same voice as the other videos (vo.py, imported for it), and music
from the main video's instruments: each reel its own tempo, key and feel, so they sound related but not
the same. Each line's take is kept, as in privacy.py, and remade only when its words change or with --vo.
"""
import hashlib, json, math, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REEL = sys.argv[1]

# (phrases, length scale, record each phrase on its own[, pause]), as in vo.py; one line a scene. The voice
# script spells as it is said: "organizes", "organizer", "center" (the screen: organises, organiser, centre), "E N T P".
REELS = {
    'notes': {
        'lines': [
            (['Your Instagram has been taking notes on you for years.'], 0.92, None),
            (["It knows you're the one who organizes every plan,", 'you give more attention than you ask for,',
              "and you're the first to check on a friend who's gone quiet."], 0.92, True, 0.08),
            (['So I let {B} read it.'], 0.92, None),
            (['I got {Mulan}. The organizer with a warm center.'], 0.92, None),
            (["Comment card, and I'll send you the link."], 0.92, None),
        ],
        # Curious, then bright: A minor (Am F C G) at 112, a ticking pulse under the habits, the reveal on the hit.
        'bpm': 112, 'chords': [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], 'roots': [45, 41, 36, 43],
        'melody': [[76, 72, 69, 72], [77, 72, 69, 72], [79, 76, 72, 76], [74, 71, 67, 71]],
        'reveal': 3, 'swing': 0.0, 'early_claps': False,
    },
    'mbti': {
        'lines': [
            (['I took the MBTI test three times,', 'and got three different answers.'], 0.92, None),
            (['So I loaded my Instagram data instead.'], 0.92, None),
            (['No questions asked.', 'Just what my online patterns actually show.'], 0.92, None),
            (['I got {Odysseus}. E N T P, with the evidence.'], 0.92, None),
            (['What does yours say? Comment your type.'], 0.92, None),
        ],
        # Playful: the main video's C G Am F moved up to D (D A Bm G) at 124, with claps from the start and
        # the plucks a little swung.
        'bpm': 124, 'chords': [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]], 'roots': [38, 45, 47, 43],
        'melody': [[78, 76, 74, 76], [76, 73, 69, 73], [74, 78, 81, 78], [79, 78, 74, 71]],
        'reveal': 3, 'swing': 0.06, 'early_claps': True,
    },
    'coach': {
        # At the other reels' pace, each question held for a breath, the regret one a little longer.
        'lines': [
            (['Some questions are hard to ask anyone.'], 0.92, None),
            (['What am I most insecure about?'], 0.92, None),
            (['What do I keep trying to prove, and to whom?'], 0.92, None),
            (["What would I regret most, when I'm old?"], 0.92, None),
            (['{B} answers from what your own data shows.'], 0.92, None),
            (['A coach that already knows you.'], 0.92, None),
            (['Ask yours at {B} dot I O.'], 0.9, None),
        ],
        'hold': {1: 0.5, 2: 0.5, 3: 1.0, 4: 1.6, 5: 1.0},  # 5: time to read the whole answer
        # Its own piece, hopeful rather than sombre: E minor to G (Em C G D) at 88, a rolling piano and strings
        # swelling through the questions, lifting into a light beat and bells as the answer types.
        'mood': 'uplifting', 'bpm': 88,
        'chords': [[64, 67, 71], [60, 64, 67], [67, 71, 74], [62, 66, 69]], 'roots': [40, 36, 43, 38],
        'melody': [[79, 78, 76, 74], [76, 79, 81, 79], [83, 81, 79, 74], [78, 76, 74, 78]],
        'reveal': 4, 'swing': 0.0, 'early_claps': False,
    },
}
# The roast: the card is nice, then the roast button is pressed and three burns land, each punchline on a beat.
# Every line is a phrase pair, set-up then punchline, recorded apart so the punchline can be moved onto the beat
# (`punch`). The numbers are a made-up sample, written as said. Its own voice: British and male, for Sherlock.
REELS['roast'] = {
    'voice': 'en_GB-alan-medium',
    'lines': [
        (['My Psyche Card was so nice.', 'Then I clicked, reveal my roast.'], 0.8, True, 0.2),
        (['Six hundred workout videos saved.', 'Zero workouts done.'], 0.8, True, 0.15),
        (['Your friends like every post you make.', 'You never like theirs back.'], 0.8, True, 0.15),
        (['You left forty seven people on read.', 'Including your mum.'], 0.8, True, 0.15),
        (['Then it tells you what an honest friend would.'], 0.8, None),
        (['Your roast is free with every card.', "Comment roast, if you're brave."], 0.8, True, 0.15),
    ],
    'hold': {1: 0.15, 2: 0.15, 3: 0.4, 4: 3.2},  # 4: time to read the honest friend
    'punch': (1, 2, 3),
    # Its own piece, dark and heavy: C minor (Cm Ab Eb Bb) at 140 in half time. A low ticking pulse and plucked
    # strings under the nice card; a riser and a low brass hit into 808s, a half-time snare, rolling hats and a
    # brass riff; the drums drop out for the beat before each punchline and a hit lands on it. Piano and a low
    # pad for the honest friend, everything back for the ask.
    'mood': 'roast', 'bpm': 140,
    'chords': [[48, 51, 55], [44, 48, 51], [43, 46, 51], [46, 50, 53]], 'roots': [36, 32, 39, 34],
    # The riff, in eighths (None a rest).
    'riff': [[72, None, None, 72, 70, None, 67, None], [68, None, None, 68, 67, None, 63, None],
             [67, None, None, 67, 70, None, 72, None], [70, None, None, 70, 74, None, 72, 70]],
    'reveal': 1, 'swing': 0.0, 'early_claps': False,
}
# The same reel opening on "What do people misunderstand about me?" instead, the gentler first cut, kept to
# post a few days apart and compare.
REELS['coach-misunderstood'] = dict(REELS['coach'], lines=[REELS['coach']['lines'][0], (['What do people misunderstand about me?'], 0.92, None)] +
                                    REELS['coach']['lines'][2:])
R = REELS[REEL]
LINES = R['lines']
BUILD = HERE + '/build/' + REEL
os.makedirs(BUILD, exist_ok=True)

names = ['p' + hashlib.sha1(json.dumps([line, R['voice']] if 'voice' in R else line).encode()).hexdigest()[:10] for line in LINES]
if 'voice' in R: os.environ['PROMO_VOICE'] = R['voice']
stored = json.load(open(BUILD + '/marks.json')) if os.path.exists(BUILD + '/marks.json') else {'lines': {}, 'words': {}}
todo = [(name, line) for name, line in zip(names, LINES)
        if '--vo' in sys.argv or name not in stored['lines'] or not os.path.exists(f'{BUILD}/{name}.wav')]
if todo:
    import vo
    vo.OUT = BUILD
    for name, line in todo: stored['lines'][name] = vo.write(name, *line)
    stored['words'].update(vo.word_marks)
    json.dump(stored, open(BUILD + '/marks.json', 'w'))

import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000
def load(path):
    out = subprocess.run([FF, '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0

lines = [load(f'{BUILD}/{name}.wav') for name in names]
dur = [len(x) / SR for x in lines]
word_marks = [stored['words'][name] for name in names]
marks = [stored['lines'][name] for name in names]

BPM = R['bpm']; BEAT = 60 / BPM; BAR = 4 * BEAT
GAP, LEAD = 0.02, 0.2
REVEAL = R['reveal']
# The reveal lets the card land before the voice names it; every cut snaps to the half beat.
EXTRA_LEAD = {REVEAL: 0.45 if R.get('mood') != 'uplifting' else 0.6}
snap = lambda x, step: math.ceil(x / step - 1e-6) * step
scenes, t = [], 0.0
for i in range(len(lines)):
    lead = 0.3 if i == 0 else LEAD + EXTRA_LEAD.get(i, 0)
    if i in R.get('punch', ()):
        # Silence before the punchline so it starts on the next beat: a beat's pause at most, the comic one.
        cut = marks[i][1]; at = t + lead + cut
        pad = snap(at + 0.12, BEAT) - at
        a = int(cut * SR)
        lines[i] = np.concatenate([lines[i][:a], np.zeros(int(pad * SR), np.float32), lines[i][a:]])
        marks[i] = marks[i][:1] + [round(m + pad, 3) for m in marks[i][1:]]
        word_marks[i] = [[w, round(s + pad, 3) if s >= cut - 0.05 else s] for w, s in word_marks[i]]
        dur[i] = len(lines[i]) / SR
    d = dur[i]
    end = t + lead + d + 1.5 if i == len(dur) - 1 else snap(t + lead + d + GAP + R.get('hold', {}).get(i, 0), BEAT / 2)
    scenes.append({'start': round(t, 3), 'end': round(end, 3), 'vo': round(t + lead, 3), 'voEnd': round(t + lead + d, 3),
                   'marks': [round(t + lead + m, 3) for m in marks[i]],
                   'words': [[w, round(t + lead + at, 3)] for w, at in word_marks[i]]})
    t = end
TOTAL = round(t, 3)
json.dump({'total': TOTAL, 'bpm': BPM, 'reel': REEL, 'scenes': scenes}, open(BUILD + '/timeline.json', 'w'), indent=1)
print(REEL, 'total', TOTAL)

n = int(TOTAL * SR) + SR
voice = np.zeros(n, np.float32)
for s, x in zip(scenes, lines):
    a = int(s['vo'] * SR); voice[a:a + len(x)] += x
voice /= max(1e-6, np.abs(voice).max()) / 0.9

# The instruments, as in audio.py.
rng = np.random.default_rng(7)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
CHORDS, ROOTS, MELODY = R['chords'], R['roots'], R.get('melody')

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); out = np.empty_like(x); prev = 0.0
    for i in range(0, len(x), 8192):
        seg = x[i:i + 8192]; res = np.empty_like(seg)
        for j, v in enumerate(seg):
            prev = (1 - a) * v + a * prev; res[j] = prev
        out[i:i + 8192] = res
    return out
def env(L, a, r):
    e = np.ones(L, np.float32); na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr); return e

music = np.zeros((n, 2), np.float32)
def at(sec, sig, gain=1.0, pan=0.0):
    a = int(sec * SR)
    if a >= n or a < 0: return
    end = min(n, a + len(sig))
    music[a:end, 0] += sig[:end - a] * gain * (1 - max(0, pan))
    music[a:end, 1] += sig[:end - a] * gain * (1 + min(0, pan))

def kick():
    L = int(0.3 * SR); x = np.arange(L) / SR
    f = 48 + 110 * np.exp(-x * 32)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 11) + 0.25 * rng.standard_normal(L) * np.exp(-x * 120)) * 0.95
def clap():
    L = int(0.22 * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32); noise = noise - lowpass(noise, 900)
    bursts = np.exp(-x * 30) + 0.6 * np.exp(-np.maximum(0, x - 0.012) * 40) * (x > 0.012)
    return lowpass(noise, 5000) * bursts * 0.45
def hat(open_=False):
    L = int((0.12 if open_ else 0.04) * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32); noise = noise - lowpass(noise, 7000)
    return noise * np.exp(-x * (18 if open_ else 90)) * 0.28
def bass(m, length):
    L = int(length * SR); x = np.arange(L) / SR
    s = np.sin(2 * np.pi * hz(m) * x) + 0.4 * np.sin(4 * np.pi * hz(m) * x)
    return np.tanh(1.8 * s) * env(L, 0.005, 0.05) * 0.3
def pluck(m, gain=0.12):
    L = int(0.4 * SR); x = np.arange(L) / SR
    s = (np.sin(2 * np.pi * hz(m) * x) + 0.5 * np.sin(4 * np.pi * hz(m) * x) * np.exp(-x * 8)) * np.exp(-x * 9)
    return s * gain
def bell(m):
    L = int(0.9 * SR); x = np.arange(L) / SR
    s = np.sin(2 * np.pi * hz(m) * x) + 0.35 * np.sin(2 * np.pi * hz(m) * 2.01 * x) * np.exp(-x * 5) + 0.15 * np.sin(2 * np.pi * hz(m) * 3 * x) * np.exp(-x * 9)
    return s * np.exp(-x * 3.2) * 0.1
def stab(chord, length):
    L = int(length * SR); x = np.arange(L) / SR; s = np.zeros(L, np.float32)
    for m in chord + [chord[0] + 12]:
        for det in (-0.08, 0.08):
            f = hz(m) * (1 + det / 100); ph = 2 * np.pi * f * x
            s += 0.5 * (2 * (x * f % 1) - 1) + 0.5 * np.sin(ph)
    return lowpass(s * env(L, 0.01, length * 0.6), 2600) * 0.045
def riser(length):
    L = int(length * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32)
    sweep = lowpass(noise, 4000) * (x / length) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (x / length) ** 2) / SR) * (x / length) ** 3 * 0.15
    return (sweep * 0.35 + tone)
def swell(length):
    L = int(length * SR); x = np.arange(L) / SR
    return lowpass(rng.standard_normal(L).astype(np.float32), 2500) * (x / length) ** 2.5 * 0.22
def impact():
    L = int(1.2 * SR); x = np.arange(L) / SR
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-x * 8)) / SR) * np.exp(-x * 3.5)
    noise = lowpass(rng.standard_normal(L).astype(np.float32), 3000) * np.exp(-x * 9) * 0.5
    return (boom + noise) * 0.55

def echo(x, delay, feedback, mix):
    """A simple feedback delay, for the coach reel's piano."""
    out = x.copy(); d = int(delay * SR)
    for k in range(1, 6):
        if d * k >= len(x): break
        out[d * k:] += x[:len(x) - d * k] * (feedback ** k) * mix
    return out
def piano(m, length=1.6, gain=0.13):
    # Round and bright: a quick attack, a long decay, a little detune.
    L = int(length * SR); x = np.arange(L) / SR
    s = sum(np.sin(2 * np.pi * hz(m) * f * x) * a for f, a in ((1, 1), (2.002, 0.4), (3.001, 0.15), (0.998, 0.4)))
    return s * np.minimum(1, x / 0.006) * np.exp(-x * 2.2) * gain
def strings(chord, length, gain=0.05):
    # A slow-swelling section: detuned saws, filtered, a soft half-second attack.
    L = int(length * SR); x = np.arange(L) / SR; s = np.zeros(L, np.float32)
    for m in chord + [chord[0] - 12]:
        for det in (-0.12, 0, 0.12):
            f = hz(m) * (1 + det / 100); s += 2 * (x * f % 1) - 1
    e = np.minimum(1, x / 0.5) * np.minimum(1, (length - x) / 0.4)
    return lowpass(s * e, 1800) * gain

if R.get('mood') == 'uplifting':
    sc = scenes
    DROP = sc[REVEAL]['start']
    QUESTIONS = sc[1]['start']
    H = hat()
    pump = np.ones(n, np.float32)
    keys = np.zeros(n, np.float32)
    b = 0.0
    while b < TOTAL + BEAT:
        bar_i = int(b / BAR) % 4; beat_i = int(round(b / BEAT)) % 4
        lifted = b >= DROP
        chord = CHORDS[bar_i]
        # A rolling piano: the chord broken in eighths, rising, the top note an octave up after the lift.
        roll = chord + [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12, chord[0] + 12]
        for k in range(2):
            a = int((b + k * BEAT / 2) * SR); p = piano(roll[(beat_i * 2 + k) % len(roll)] + (12 if lifted and k else 0))
            if a < n: keys[a:a + len(p)] += p[:max(0, min(len(p), n - a))]
        # A soft pulse from the questions on; after the lift a light kick on every beat, claps on 2 and 4, the bells.
        if QUESTIONS <= b < DROP and beat_i == 0: at(b, kick(), 0.3)
        if lifted and b < TOTAL - 1.2:
            at(b, kick(), 0.6)
            if beat_i in (1, 3): at(b, clap(), 0.45)
            at(b + BEAT / 2, H, 0.4, 0.3)
            at(b, bell(MELODY[bar_i][beat_i]), 0.9, 0.15)
        b += BEAT
    keys = echo(keys, BEAT * 0.75, 0.35, 0.45)
    music[:, 0] += keys; music[:, 1] += keys * 0.94
    # Strings and bass a bar at a time: swelling louder through the questions, full after the lift.
    for bar in range(int(TOTAL / BAR) + 2):
        a0 = bar * BAR
        if a0 >= TOTAL: break
        grow = 0.5 if a0 < QUESTIONS else min(1.0, 0.6 + 0.4 * (a0 - QUESTIONS) / max(1, DROP - QUESTIONS)) if a0 < DROP else 1.3
        at(a0, strings(CHORDS[bar % 4], BAR * 1.02), grow, 0.0)
        at(a0, bass(ROOTS[bar % 4], BAR * 0.9) * 0.6, 0.5 if a0 < DROP else 0.8)
    # The lift: a rising swell into the answer, and a bright last chord.
    at(DROP - 2.2, swell(2.2) * 1.8, 1.0)
    at(TOTAL - 2.4, strings([67, 71, 74, 79], 2.4, 0.07), 1.0)
elif R.get('mood') == 'roast':
    sc = scenes
    DROP = sc[1]['start']                         # the roast button: a riser, then the beat
    ADVICE, CTA = sc[4]['start'], sc[5]['start']  # the honest friend, then everything back for the ask
    PUNCH = [sc[i]['marks'][1] for i in R['punch']]
    END = sc[5]['voEnd'] + 0.4
    RIFF = R['riff']
    EIGHTH = BEAT / 2

    def drive(x, k): return np.tanh(k * x) / np.tanh(k)
    def brass(chord, length, bright=3000, gain=0.05):
        # Low synth brass: detuned saws that scoop into the note, the filter opening on the attack, a little drive.
        L = int(length * SR); x = np.arange(L) / SR; s_ = np.zeros(L, np.float32)
        scoop = 1 - 0.02 * np.exp(-x * 40)
        for m in chord:
            for det in (-0.12, 0.0, 0.12):
                ph = np.cumsum(hz(m) * (1 + det / 100) * scoop) / SR; s_ += 2 * (ph % 1) - 1
        e = np.minimum(1, x / 0.01) * np.minimum(1, (length - x) / 0.05).clip(0)
        dull, sharp = lowpass(s_ * e, 500), lowpass(s_ * e, bright)
        return drive((dull + (sharp - dull) * np.exp(-x * 6)) * 0.35, 1.6) * gain * 6
    def braam(chord, length):
        # The hit: brass two octaves down and one up, swelling open, with a sub under it.
        L = int(length * SR); x = np.arange(L) / SR
        low = brass([m - 12 for m in chord] + [chord[0] - 24], length, 1800, 0.07)
        sub = np.sin(2 * np.pi * hz(chord[0] - 24) * x) * np.exp(-x * 1.5) * 0.4
        return low + sub
    def eight08(m, length, glide_from=None):
        # An 808: a sine with a click and a quick drop in pitch, long, driven.
        L = int(length * SR); x = np.arange(L) / SR
        f = hz(m) * (1 + 1.5 * np.exp(-x * 60))
        if glide_from is not None: f = f * (hz(glide_from) / hz(m)) ** np.exp(-x * 9)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, x / 0.003) * np.minimum(1, (length - x) / 0.04).clip(0)
        return drive(y * np.exp(-x * 1.6), 2.2) * 0.5
    def snare():
        L = int(0.3 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        body = np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30) * 0.6
        return (lowpass(noise - lowpass(noise, 1200), 8000) * np.exp(-x * 16) * 0.55 + body) * 0.9
    def tick():
        L = int(0.03 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        return (noise - lowpass(noise, 3000)) * np.exp(-x * 160) * 0.35
    def string_pluck(m):
        # A dark plucked string, for the detective's intro.
        L = int(0.7 * SR); x = np.arange(L) / SR
        y = sum(np.sin(2 * np.pi * hz(m) * k * x) * np.exp(-x * (4 + 3 * k)) / k for k in (1, 2, 3, 4))
        return lowpass(y.astype(np.float32), 2500) * 0.16
    def pad(chord, length, gain=0.04):
        L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
        for m in chord:
            for det in (-0.15, 0.15): y += np.sin(2 * np.pi * hz(m) * (1 + det / 100) * x) + 0.3 * (2 * (x * hz(m) % 1) - 1)
        return lowpass(y * np.minimum(1, x / 0.6) * np.minimum(1, (length - x) / 0.5).clip(0), 900) * gain
    def crash():
        L = int(1.8 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
        return (noise - lowpass(noise, 5000)) * np.exp(-x * 2.4) * 0.28
    def reverse_crash(length):
        return crash()[:int(length * SR)][::-1].copy() * 1.3
    notes = {}
    def riff_note(m, length):
        key = (m, round(length, 3))
        if key not in notes: notes[key] = brass([m - 12, m - 24], length, 2600, 0.045)
        return notes[key]

    K, C, SN, H, HO, TK = kick(), clap(), snare(), hat(), hat(True), tick()
    pump = np.ones(n, np.float32)
    b = 0.0
    while b < END:
        k8 = int(round(b / EIGHTH)); bar_i = k8 // 8 % 4; e = k8 % 8
        chord, root = CHORDS[bar_i], ROOTS[bar_i]
        hook, adv, cta = b < DROP, ADVICE <= b < CTA, b >= CTA
        # The beat drops out for the beat before each punchline.
        held = any(p - BEAT - 0.01 <= b < p - 0.01 for p in PUNCH)
        roll = any(p - 2 * BEAT - 0.01 <= b < p - BEAT - 0.01 for p in PUNCH) or (CTA - BEAT - 0.01 <= b < CTA - 0.01)
        if hook:
            # The nice card, but something is coming: a clock-like tick, a low pad and a plucked figure.
            at(b, TK, 0.8 if e % 2 == 0 else 0.4, 0.3)
            if e == 0: at(b, pad(chord, BAR * 1.02), 1.0)
            if e in (0, 3, 6): at(b, string_pluck(chord[(e // 3) % 3] + 12), 1.0, -0.2)
            if e == 0: at(b, eight08(root, BAR * 0.9) * 0.4, 0.6)
        elif adv:
            # The honest friend: piano chords, a low pad, a soft kick on the one.
            if e == 0:
                at(b, pad(chord, BAR * 1.02, 0.05), 1.0); at(b, K, 0.5); at(b, eight08(root, BAR * 0.9) * 0.6, 0.6)
                for m in chord + [chord[0] + 12]: at(b, piano(m + 12, 2.0, 0.08), 1.0)
            if e == 4:
                for m in chord: at(b, piano(m + 24, 1.4, 0.05), 1.0)
        elif not held:
            # Half time: kicks with an 808 under them, the snare and clap on three, hats in eighths that roll into a hit.
            if e in (0, 3) or (e == 6 and bar_i % 2):
                at(b, K, 1.0); at(b, eight08(root, EIGHTH * (3 if e == 0 else 2.5), glide_from=root + 7 if e == 6 else None), 1.0)
                a_ = int(b * SR); L = int(0.25 * SR)
                if a_ < n: pump[a_:a_ + L] = np.minimum(pump[a_:a_ + L], 0.35 + 0.65 * np.linspace(0, 1, min(L, n - a_)) ** 0.6)
            if e == 4: at(b, SN, 1.0); at(b, C, 0.7)
            if roll:
                for k in range(3): at(b + k * EIGHTH / 3, H, 0.4 + 0.15 * k, 0.3)
            else:
                at(b, H, 0.45 if e % 2 else 0.6, 0.3)
            if e == 7 and bar_i % 2: at(b, HO, 0.5, -0.3)
            if e == 0: at(b, brass(chord, BAR * 0.95, 1400, 0.03), 1.0)
            # The riff: under the voice (the mix ducks it), out in front for the ask.
            m = RIFF[bar_i][e]
            if m: at(b, riff_note(m, EIGHTH * 0.8), 1.3 if cta else 0.8, 0.12)
        b += EIGHTH

    # The roast button: a reversed crash and riser into a low brass hit as the beat drops.
    at(DROP - 1.4, reverse_crash(1.4), 0.9); at(DROP - 1.4, riser(1.4), 0.6)
    at(DROP, impact(), 1.0); at(DROP, crash(), 1.0); at(DROP, braam(CHORDS[0], 1.8), 1.6)
    # Each punchline: a hit, a crash and the 808 dropping in under it.
    for p in PUNCH:
        at(p, braam(CHORDS[0], 1.2), 1.5); at(p, crash(), 0.9); at(p, impact(), 0.8); at(p, eight08(ROOTS[0] - 12, 1.0, glide_from=ROOTS[0]), 0.9)
    # Into the honest friend, the beat falls away; into the ask, it comes back with a hit.
    at(ADVICE, crash(), 0.5)
    at(CTA - 1.4, reverse_crash(1.4), 0.9); at(CTA - 1.2, swell(1.2) * 1.6, 1.0)
    at(CTA, crash(), 1.0); at(CTA, braam(CHORDS[0], 1.4), 1.3); at(CTA, impact(), 0.8)
    last = snap(END - 0.2, BEAT)
    at(last, braam(CHORDS[0], 2.4), 1.8); at(last, impact(), 1.0); at(last, crash(), 0.9)
else:
    sc = scenes
    MID = sc[1]['start']       # a light pulse comes in after the hook
    DROP = sc[REVEAL]['start']  # the card: riser, hit, the full beat to the end
    K, C = kick(), clap()
    H, HO = hat(), hat(True)
    pump = np.ones(n, np.float32)
    b = 0.0
    while b < TOTAL + BEAT:
        bar_i = int(b / BAR) % 4; beat_i = int(round(b / BEAT)) % 4
        full = DROP <= b < TOTAL - 1.0
        mid = MID <= b < DROP
        if full or mid:
            at(b, K, 0.95 if full else 0.45)
            a = int(b * SR); L = int(0.22 * SR)
            if full and a < n: pump[a:a + L] = np.minimum(pump[a:a + L], 0.35 + 0.65 * np.linspace(0, 1, min(L, n - a)) ** 0.6)
        if (full or (mid and R['early_claps'])) and beat_i in (1, 3): at(b, C, 0.9 if full else 0.5)
        if full or mid:
            for k in range(4 if full else 2):
                at(b + k * BEAT / (4 if full else 2), H, 0.7 if k % 2 else 0.45, 0.3)
            if full and beat_i == 3: at(b + BEAT / 2, HO, 0.5, -0.3)
        if full:
            at(b + BEAT / 2, bass(ROOTS[bar_i] + 12, BEAT * 0.45), 1.0)
            at(b, bass(ROOTS[bar_i], BEAT * 0.3), 0.7)
        elif b >= MID:
            at(b, bass(ROOTS[bar_i], BEAT * 0.8), 0.6)
        # Plucks on the eighths; the second of each pair a touch late in a swung reel.
        notes = CHORDS[bar_i] + [CHORDS[bar_i][0] + 12]
        for k in range(2):
            m = notes[(beat_i * 2 + k) % 4] + 12
            at(b + k * (BEAT / 2 + R['swing']), pluck(m, 0.1 if not full else 0.08), 1.0, 0.4 if k else -0.4)
        if full and beat_i in (0, 2): at(b, stab(CHORDS[bar_i], BEAT * 0.9), 1.0)
        # The bell tune: soft before the reveal, leading after it with a soft octave above.
        lead = min(1, (b - DROP + BEAT) / (2 * BEAT)) if b >= DROP else 0
        at(b, bell(MELODY[bar_i][beat_i]), (0.55 if b < MID else 0.8) + 0.6 * lead, 0.15)
        if lead: at(b, bell(MELODY[bar_i][beat_i] + 12), 0.28 * lead, -0.15)
        b += BEAT

    for bar in range(int(TOTAL / BAR) + 2):
        a0 = bar * BAR
        if a0 >= DROP: break
        at(a0, stab(CHORDS[bar % 4], BAR * 1.05) * 1.6, 0.8)

    for k in range(1, REVEAL): at(sc[k]['start'] - 0.5, swell(0.5), 1.0)
    at(DROP - 1.6, riser(1.6), 0.9); at(DROP, impact(), 1.0)

music[:, 0] *= pump[:n]; music[:, 1] *= pump[:n]
fade = np.ones(n, np.float32)
fi = int(0.3 * SR); fade[:fi] = np.linspace(0, 1, fi)
# The roast's last hit rings on a little longer.
fo = int((TOTAL - (0.9 if R.get('mood') == 'roast' else 1.4)) * SR); fade[fo:] = np.clip(np.linspace(1, 0, n - fo) * 1.6, 0, 1)
music *= fade[:, None]
music /= max(1e-6, np.abs(music).max())

envv = lowpass(np.abs(voice), 8.0); envv /= max(1e-6, envv.max())
# As the main video's ending: the music swells at once on the hit and is ducked less after it.
swell_in = np.ones(n, np.float32)
f0 = int(DROP * SR); f1 = min(n, int((DROP + 0.35) * SR))
top = 1.35 if R.get('mood') == 'uplifting' else 1.6
swell_in[f0:f1] = np.linspace(1.0, top, f1 - f0); swell_in[f1:] = top
depth = np.where(np.arange(n) >= f0, 0.3, 0.5).astype(np.float32)
duck = 1 - depth * np.clip(envv * 2.4, 0, 1)
mix = music * (0.42 * duck * swell_in)[:, None] + voice[:, None] * 0.95
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix /= max(1e-6, np.abs(mix).max()) / 0.89
mix = mix[: int(TOTAL * SR)]

def save(path, data):
    data = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(data.tobytes()); w.close()
save(BUILD + '/mix.wav', mix)
save(BUILD + '/music-only.wav', (music * 0.7)[: int(TOTAL * SR)])
print('wrote mix')
