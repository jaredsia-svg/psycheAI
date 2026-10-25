"""The privacy reel (about 28 s): its voiceover, timeline, music and mix. npm run promo:privacy

The same voice as the main video (vo.py, imported for it) and the same track: 118 BPM, C G Am F,
the bell tune. It opens on the main video's quiet privacy break (pads, plucks, bells, no drums),
builds under the five steps, and lands with the main video's ending on the last card: the riser,
the hit, the full beat and the brighter bells.
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = HERE + '/build/privacy'
os.makedirs(BUILD, exist_ok=True)

# (phrases, length scale, record each phrase on its own[, pause]), as in vo.py. One line a scene, each
# said in one take at the main video's pace (0.92, its privacy line's): phrase by phrase, or faster, sounded clipped.
LINES = [
    # "your data", not "your Instagram file", since the four sources float in (25 October 2026).
    (['What happens when you load your data onto {B}?'], 0.92, None),
    (['Your files are loaded on your phone, not uploaded.'], 0.92, None),
    (['Only a short summary is made,', 'with names and handles removed.'], 0.92, None),
    # Step 3 since 25 October 2026: the review sheet's two strongest choices, a topic and a chat.
    (['You review it,', 'leave out any topic,', 'and switch off any chat.'], 0.92, None),
    (['The summary is sent encrypted to Google Vertex AI,', 'which never trains on it.'], 0.92, None),
    # As the ChatGPT reel says it (25 October 2026): no account, and nothing for a hack to take.
    (['Your results come back to you,', 'and {B} keeps no copy.', 'It needs no account.', "Even if a hack occurs, there's no data to steal."], 0.92, None),
    (['See for yourself at {B} dot I O.'], 0.9, None),
]

# Each line's take is kept under a name made from its words and pace, so changing or adding a line
# records only that line and the others keep the takes already approved. python privacy.py --vo
# records them all again.
import hashlib
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

import wave
import imageio_ffmpeg, subprocess
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

# Its own music since 25 October 2026 (it shared the launch video's track): warm lo-fi at 92, see below.
BPM = 92; BEAT = 60 / BPM; BAR = 4 * BEAT
GAP, LEAD = 0.02, 0.2
# Each step snaps to the half beat, as in the main video's hook.
minimum = {}
EXTRA_LEAD = {6: 0.25}
snap = lambda x, step: math.ceil(x / step - 1e-6) * step
scenes, t = [], 0.0
for i, d in enumerate(dur):
    lead = 0.3 if i == 0 else LEAD + EXTRA_LEAD.get(i, 0)
    length = max(lead + d + GAP, minimum.get(i, 0))
    # The last card holds on the line and the button.
    end = t + lead + d + 1.2 if i == len(dur) - 1 else snap(t + length, BEAT / 2)
    scenes.append({'start': round(t, 3), 'end': round(end, 3), 'vo': round(t + lead, 3), 'voEnd': round(t + lead + d, 3),
                   'marks': [round(t + lead + m, 3) for m in marks[i]],
                   'words': [[w, round(t + lead + at, 3)] for w, at in word_marks[i]]})
    t = end
TOTAL = round(t, 3)
json.dump({'total': TOTAL, 'bpm': BPM, 'scenes': scenes}, open(BUILD + '/timeline.json', 'w'), indent=1)
print('total', TOTAL)

n = int(TOTAL * SR) + SR
voice = np.zeros(n, np.float32)
for s, x in zip(scenes, lines):
    a = int(s['vo'] * SR); voice[a:a + len(x)] += x
voice /= max(1e-6, np.abs(voice).max()) / 0.9

# The instruments, as in audio.py.
rng = np.random.default_rng(11)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
# A flat major, jazzy: Abmaj7, Fm7, Dbmaj7, Eb7sus.
CHORDS = [[56, 60, 63, 67], [53, 56, 60, 63], [49, 53, 56, 60], [51, 56, 58, 61]]
ROOTS = [44, 41, 37, 39]
# The melody on the last card: a beat each, None a rest.
MELODY = [[75, None, 72, 70], [72, None, 68, None], [72, 70, 68, 65], [70, None, None, 67]]

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
STEPS = sc[1]['start']   # the five steps: the beat comes in
FINAL = sc[6]['start']   # the last card: the melody joins
# Warm lo-fi (25 October 2026, in place of the launch video's track): electric piano and vinyl crackle under the
# hook; a soft boom-bap beat, swung hats and a round bass from Step 1; a gentle electric-piano melody on the last
# card. No risers, booms or bells; it ends on a held chord.
SW = BEAT * 0.11   # the swing on every second eighth
def rhodes(chord, length, gain=0.05):
    L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
    for m in chord:
        f = hz(m)
        y += np.sin(2 * np.pi * f * x) * np.exp(-x * 1.1) + 0.3 * np.sin(2 * np.pi * 2 * f * x) * np.exp(-x * 4) \
            + 0.08 * np.sin(2 * np.pi * 7 * f * x) * np.exp(-x * 30)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * x)
    return y * trem * np.minimum(1, x / 0.008) * np.clip((length - x) / 0.3, 0, 1) * gain
def round_bass(m, length):
    L = int(length * SR); x = np.arange(L) / SR
    return np.sin(2 * np.pi * hz(m) * x) * np.minimum(1, x / 0.01) * np.clip((length - x) / 0.08, 0, 1) * np.exp(-x * 1.2) * 0.32
def snare():
    L = int(0.25 * SR); x = np.arange(L) / SR
    noise = rng.standard_normal(L).astype(np.float32)
    return (lowpass(noise, 3800) * np.exp(-x * 22) * 0.35 + np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30) * 0.25)
def soft_kick():
    L = int(0.35 * SR); x = np.arange(L) / SR
    f = 45 + 70 * np.exp(-x * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 9) * 0.8
def crackle(length):
    L = int(length * SR); y = np.zeros(L, np.float32)
    pops = rng.integers(0, L, int(length * 9))
    y[pops] = rng.standard_normal(len(pops)).astype(np.float32) * 0.35
    return lowpass(y, 3500) + lowpass(rng.standard_normal(L).astype(np.float32), 900) * 0.006
K, SN, H = soft_kick(), snare(), hat()
pump = np.ones(n, np.float32)
at(0, crackle(TOTAL + 1), 1.0)
b = 0.0
while b < TOTAL - BAR * 0.5:
    k8 = int(round(b / (BEAT / 2))); bar_i = k8 // 8 % 4; e = k8 % 8
    swung = b + (SW if e % 2 else 0)
    chord = CHORDS[bar_i]
    beat_on = b >= STEPS - 0.05
    ending = b >= TOTAL - BAR * 1.5
    if e == 0: at(b, rhodes(chord, BAR * 1.02), 1.0, -0.1)
    if e == 5: at(swung, rhodes(chord[1:], BEAT * 1.1, 0.03), 1.0, 0.2)
    if beat_on and not ending:
        if e in (0, 5): at(swung, K, 0.75)
        if e in (2, 6): at(b, SN, 0.6)
        at(swung, H, 0.5 if e % 2 else 0.3, 0.25)
        if e in (0, 3, 4, 7): at(swung, round_bass(ROOTS[bar_i] + (7 if e == 3 else 0), BEAT * (1.4 if e == 0 else 0.6)), 1.0 if e == 0 else 0.75)
    if b >= FINAL - 0.05 and not ending and e % 2 == 0:
        m = MELODY[bar_i][e // 2]
        if m: at(b, rhodes([m + 12], BEAT * 1.6, 0.06), 1.0, 0.15)
    b += BEAT / 2
# The end: the first chord held, the bass under it, nothing struck after.
last = snap(TOTAL - BAR * 1.5, BAR)
at(last, rhodes(CHORDS[0] + [72], BAR * 1.5, 0.06), 1.0); at(last, round_bass(ROOTS[0], BAR), 0.9)

music[:, 0] *= pump[:n]; music[:, 1] *= pump[:n]
fade = np.ones(n, np.float32)
fi = int(0.3 * SR); fade[:fi] = np.linspace(0, 1, fi)
fo = int((TOTAL - 1.4) * SR); fade[fo:] = np.clip(np.linspace(1, 0, n - fo) * 1.6, 0, 1)
music *= fade[:, None]
music /= max(1e-6, np.abs(music).max())

envv = lowpass(np.abs(voice), 8.0); envv /= max(1e-6, envv.max())
# The main video's ending: the music swells at once on the hit and is ducked less under the last line.
swell_in = np.ones(n, np.float32)
f0 = int(FINAL * SR); f1 = min(n, int((FINAL + 0.35) * SR))
swell_in[f0:f1] = np.linspace(1.0, 1.75, f1 - f0); swell_in[f1:] = 1.75
depth = np.where(np.arange(n) >= f0, 0.25, 0.5).astype(np.float32)
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
