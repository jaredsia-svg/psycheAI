"""Timeline from the voiceover, an upbeat original track, and the final mix."""
import json, os, subprocess, wave
import numpy as np
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
VO = HERE + '/build/vo'
BUILD = HERE + '/build'
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000

def load(path):
    out = subprocess.run([FF, '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0

N_LINES = 9
lines = [load(f'{VO}/l{i:02d}.wav') for i in range(1, N_LINES + 1)]
dur = [len(x) / SR for x in lines]

GAP, LEAD = 0.16, 0.06
marks = json.load(open(VO + '/marks.json'))
minimum = {0: 1.5}
scenes, t = [], 0.0
for i, d in enumerate(dur):
    lead = 0.35 if i == 0 else LEAD
    length = max(lead + d + GAP, minimum.get(i, 0))
    if i == len(dur) - 1: length = lead + d + 1.0
    scenes.append({'start': round(t, 3), 'end': round(t + length, 3), 'vo': round(t + lead, 3), 'voEnd': round(t + lead + d, 3),
                   'marks': [round(t + lead + m, 3) for m in marks[i]]})
    t += length
TOTAL = round(t, 3)

BPM = 118; BEAT = 60 / BPM; BAR = 4 * BEAT
json.dump({'total': TOTAL, 'bpm': BPM, 'scenes': scenes}, open(BUILD + '/timeline.json', 'w'), indent=1)
print('total', TOTAL)

n = int(TOTAL * SR) + SR
voice = np.zeros(n, np.float32)
for s, x in zip(scenes, lines):
    a = int(s['vo'] * SR); voice[a:a + len(x)] += x
voice /= max(1e-6, np.abs(voice).max()) / 0.9

rng = np.random.default_rng(11)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]  # C G Am F
ROOTS = [36, 43, 45, 41]
MELODY = [[76, 74, 72, 74], [74, 71, 67, 71], [72, 76, 79, 76], [77, 76, 72, 69]]

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
def impact():
    L = int(1.2 * SR); x = np.arange(L) / SR
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-x * 8)) / SR) * np.exp(-x * 3.5)
    noise = lowpass(rng.standard_normal(L).astype(np.float32), 3000) * np.exp(-x * 9) * 0.5
    return (boom + noise) * 0.55

sc = scenes
INTRO_END = sc[3]['start']      # the hook: plucks and a light pulse
DROP = sc[4]['start']           # the data goes in: full beat
BREAK = sc[7]['start']          # privacy: pads, plucks, no kick
FINAL = sc[8]['start']          # the end card: back in, then out

K, C = kick(), clap()
H, HO = hat(), hat(True)
pump = np.ones(n, np.float32)   # sidechain from the kick
b = 0.0; step = 0
while b < TOTAL + BEAT:
    bar_i = int(b / BAR) % 4; beat_i = int(round(b / BEAT)) % 4
    full = (DROP <= b < BREAK) or (b >= FINAL and b < TOTAL - 1.0)
    mid = INTRO_END <= b < DROP
    # Kick: light on 1 in the hook, every beat from the footprint, four on the floor in the drop.
    if full or mid or (b < INTRO_END and beat_i == 0):
        at(b, K, 0.95 if full else 0.6)
        a = int(b * SR); L = int(0.22 * SR)
        if full and a < n: pump[a:a + L] = np.minimum(pump[a:a + L], 0.35 + 0.65 * np.linspace(0, 1, min(L, n - a)) ** 0.6)
    if full and beat_i in (1, 3): at(b, C, 0.9)
    if full or mid:
        for k in range(4 if full else 2):
            at(b + k * BEAT / (4 if full else 2), H, 0.7 if k % 2 else 0.45, 0.3)
        if full and beat_i == 3: at(b + BEAT / 2, HO, 0.5, -0.3)
    # Bass: offbeat pumping in the drop, roots elsewhere after the hook.
    if full:
        at(b + BEAT / 2, bass(ROOTS[bar_i] + 12, BEAT * 0.45), 1.0)
        at(b, bass(ROOTS[bar_i], BEAT * 0.3), 0.7)
    elif b >= INTRO_END or b >= BREAK:
        at(b, bass(ROOTS[bar_i], BEAT * 0.8), 0.6)
    # Plucked arpeggio everywhere, eighths.
    notes = CHORDS[bar_i] + [CHORDS[bar_i][0] + 12]
    for k in range(2):
        m = notes[(beat_i * 2 + k) % 4] + 12
        at(b + k * BEAT / 2, pluck(m, 0.1 if b < DROP else 0.08), 1.0, 0.4 if k else -0.4)
    # Chord stabs on the beat in the drop.
    if full and beat_i in (0, 2): at(b, stab(CHORDS[bar_i], BEAT * 0.9), 1.0)
    # Bell melody in the drop and in the break.
    if (full or BREAK <= b < FINAL) and b >= DROP:
        at(b, bell(MELODY[bar_i][beat_i]), 0.9, 0.15)
    b += BEAT

# Pads under the hook and the break.
for bar in range(int(TOTAL / BAR) + 2):
    a0 = bar * BAR
    if a0 >= TOTAL: break
    if a0 < DROP or BREAK <= a0 < FINAL:
        at(a0, stab(CHORDS[bar % 4], BAR * 1.05) * 1.6, 0.8)

at(DROP - 2.2, riser(2.2), 1.0); at(DROP, impact(), 1.0)
at(sc[5]['start'], impact(), 0.6); at(sc[6]['start'], impact(), 0.6)
at(FINAL - 1.6, riser(1.6), 0.9); at(FINAL, impact(), 1.0)

music[:, 0] *= pump[:n]; music[:, 1] *= pump[:n]
fade = np.ones(n, np.float32)
fi = int(0.4 * SR); fade[:fi] = np.linspace(0, 1, fi)
fo = int((TOTAL - 1.4) * SR); fade[fo:] = np.clip(np.linspace(1, 0, n - fo) * 1.6, 0, 1)
music *= fade[:, None]
music /= max(1e-6, np.abs(music).max())

envv = lowpass(np.abs(voice), 8.0); envv /= max(1e-6, envv.max())
duck = 1 - 0.5 * np.clip(envv * 2.4, 0, 1)
mix = music * (0.42 * duck)[:, None] + voice[:, None] * 0.95
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
# 0.89 leaves AAC about 1 dB of headroom, so the encoded file never clips.
mix /= max(1e-6, np.abs(mix).max()) / 0.89
mix = mix[: int(TOTAL * SR)]

def save(path, data):
    data = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(data.tobytes()); w.close()
save(BUILD + '/mix.wav', mix)
save(BUILD + '/music-only.wav', (music * 0.7)[: int(TOTAL * SR)])
print('wrote mix')
