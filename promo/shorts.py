"""Short reels for Instagram (about 20 s each): their voiceover, timeline, music and mix.

    python shorts.py notes   # "Your Instagram has been taking notes on you": Mulan
    python shorts.py mbti    # "I took the MBTI test three times": Odysseus

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
              'and you go quiet when you need to recharge.'], 0.92, True, 0.08),
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
}
R = REELS[REEL]
LINES = R['lines']
BUILD = HERE + '/build/' + REEL
os.makedirs(BUILD, exist_ok=True)

names = ['p' + hashlib.sha1(json.dumps(line).encode()).hexdigest()[:10] for line in LINES]
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
EXTRA_LEAD = {REVEAL: 0.45}
snap = lambda x, step: math.ceil(x / step - 1e-6) * step
scenes, t = [], 0.0
for i, d in enumerate(dur):
    lead = 0.3 if i == 0 else LEAD + EXTRA_LEAD.get(i, 0)
    end = t + lead + d + 1.5 if i == len(dur) - 1 else snap(t + lead + d + GAP, BEAT / 2)
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
CHORDS, ROOTS, MELODY = R['chords'], R['roots'], R['melody']

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
fo = int((TOTAL - 1.4) * SR); fade[fo:] = np.clip(np.linspace(1, 0, n - fo) * 1.6, 0, 1)
music *= fade[:, None]
music /= max(1e-6, np.abs(music).max())

envv = lowpass(np.abs(voice), 8.0); envv /= max(1e-6, envv.max())
# As the main video's ending: the music swells at once on the hit and is ducked less after it.
swell_in = np.ones(n, np.float32)
f0 = int(DROP * SR); f1 = min(n, int((DROP + 0.35) * SR))
swell_in[f0:f1] = np.linspace(1.0, 1.6, f1 - f0); swell_in[f1:] = 1.6
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
