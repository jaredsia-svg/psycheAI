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

# The relationship reel's music since 25 October 2026 (it shared the launch video's track; a lo-fi of its own was
# tried the same day and dropped): its instruments, key and tempo, laid over these steps. See below.
BPM = 84; BEAT = 60 / BPM; BAR = 4 * BEAT
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
# The relationship reel's: F sharp minor to A (F#m D A E), its vibraphone tune.
CHORDS = [[54, 57, 61], [50, 54, 57], [57, 61, 64], [52, 56, 59]]
ROOTS = [42, 38, 45, 40]
MELODY = [[73, 69, 66, 69], [74, 69, 66, 69], [76, 73, 69, 73], [71, 68, 64, 68]]

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
STEPS = sc[1]['start']   # the steps: a soft low pulse comes in
DROP = sc[3]['start']    # Step 3 on: the gentle groove and the tune
BRIGHT = sc[5]['start']  # Step 5 on: the tune a touch brighter
FINAL = sc[6]['start']   # the last card
END = sc[6]['voEnd'] + 0.6
# The relationship reel's music (shorts.py, mood 'relationship'), its instruments copied as they are: an electric
# piano with a slow tremolo and a soft pad throughout; a low pulse under Steps 1 and 2; from Step 3 a soft groove of
# brushed snare, rim and bass with a vibraphone tune; a softly rolled A chord to close.
EIGHTH = BEAT / 2
def lp(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x)).astype(np.float32)
def rhodes(m, length=2.0, gain=0.07):
    L = int(length * SR); x = np.arange(L) / SR; f = hz(m)
    y = np.sin(2 * np.pi * f * x + 1.4 * np.exp(-x * 7) * np.sin(2 * np.pi * f * x)) + 0.25 * np.sin(2 * np.pi * f * 2 * x) * np.exp(-x * 3)
    y *= np.exp(-x * 1.3) * (1 + 0.18 * np.sin(2 * np.pi * 4.2 * x)) * np.minimum(1, x / 0.004) * np.clip((length - x) / 0.1, 0, 1)
    return y.astype(np.float32) * gain
def vibes(m, gain=0.06):
    L = int(1.6 * SR); x = np.arange(L) / SR; f = hz(m)
    y = np.sin(2 * np.pi * f * x) + 0.3 * np.sin(2 * np.pi * f * 4 * x) * np.exp(-x * 8)
    return (y * np.exp(-x * 2.2) * (1 + 0.25 * np.sin(2 * np.pi * 5.5 * x))).astype(np.float32) * gain
def brush():
    L = int(0.35 * SR); x = np.arange(L) / SR; noise = rng.standard_normal(L).astype(np.float32)
    return lp(noise - lp(noise, 1500), 6000) * np.minimum(1, x / 0.03) * np.exp(-x * 9) * 0.3
def rim():
    L = int(0.06 * SR); x = np.arange(L) / SR
    return (np.sin(2 * np.pi * 1800 * x) * np.exp(-x * 120) + np.sin(2 * np.pi * 520 * x) * np.exp(-x * 60) * 0.5) * 0.25
def soft_bass(m, length):
    L = int(length * SR); x = np.arange(L) / SR
    return (np.sin(2 * np.pi * hz(m) * x) + 0.2 * np.sin(4 * np.pi * hz(m) * x)) * np.minimum(1, x / 0.01) * np.clip((length - x) / 0.08, 0, 1) * 0.3
def pad(chord, length, gain=0.03):
    L = int(length * SR); x = np.arange(L) / SR; y = np.zeros(L, np.float32)
    for m in chord + [chord[0] + 12]:
        for det in (-0.12, 0.12): y += np.sin(2 * np.pi * hz(m) * (1 + det / 100) * x) + 0.2 * (2 * (x * hz(m) * (1 + det / 100) % 1) - 1)
    return lp(y * np.minimum(1, x / 0.6) * np.clip((length - x) / 0.5, 0, 1), 1500) * gain
K = kick()
pump = np.ones(n, np.float32)
last = snap(END - BAR, BAR)
stop = END - BAR
b = 0.0
while b < END:
    k8 = int(round(b / EIGHTH)); bar_i = k8 // 8 % 4; e = k8 % 8; beat_i = e // 2
    chord, root = CHORDS[bar_i], ROOTS[bar_i]
    if b >= stop: b += EIGHTH; continue
    if e in (0, 3):
        for m in chord: at(b, rhodes(m + 12, 2.2, 0.05), 1.0, -0.15)
    if e == 6: at(b, rhodes(chord[2] + 24, 1.2, 0.04), 1.0, 0.2)
    if e == 0: at(b, pad(chord, BAR * 1.02), 1.0)
    if STEPS <= b < DROP:
        if e % 2 == 0: at(b, K, 0.25)
        if e == 0: at(b, soft_bass(root - 12, BAR * 0.95), 0.8)
    elif DROP <= b:
        bright = b >= BRIGHT
        if e in (0, 5): at(b, K, 0.55)
        if e in (2, 6): at(b, brush(), 1.0)
        if e % 2 == 1: at(b, rim(), 0.6 if bright else 0.4, 0.3)
        if e in (0, 3, 4): at(b, soft_bass(root - 12, EIGHTH * 1.7), 1.0)
        if e % 2 == 0: at(b, vibes(MELODY[bar_i][beat_i], 0.06 if bright else 0.045), 1.0, 0.15)
    b += EIGHTH
at(DROP - 1.6, swell(1.6), 0.6)
end = [45, 57, 61, 64, 69, 73]
for k, m in enumerate(end): at(last + k * 0.1, rhodes(m, 3.2, 0.045), 1.0)
at(last - 0.6, pad(end[1:4], 3.8, 0.04), 1.0)

music[:, 0] *= pump[:n]; music[:, 1] *= pump[:n]
fade = np.ones(n, np.float32)
fi = int(0.3 * SR); fade[:fi] = np.linspace(0, 1, fi)
fo = int((TOTAL - 1.4) * SR); fade[fo:] = np.clip(np.linspace(1, 0, n - fo) * 1.6, 0, 1)
music *= fade[:, None]
music /= max(1e-6, np.abs(music).max())

envv = lowpass(np.abs(voice), 8.0); envv /= max(1e-6, envv.max())
# The main video's ending: the music swells at once on the hit and is ducked less under the last line.
swell_in = np.ones(n, np.float32)
f0 = int(DROP * SR); f1 = min(n, int((DROP + 0.35) * SR))
swell_in[f0:f1] = np.linspace(1.0, 1.35, f1 - f0); swell_in[f1:] = 1.35
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
