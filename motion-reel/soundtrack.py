"""Synthesises the 15s soundtrack for reel.html — every hit is placed on the
same timeline as the animation (120 BPM, A minor). Pure numpy, no samples.
    python3 soundtrack.py  ->  soundtrack.wav (48 kHz, 16-bit stereo)
"""
import wave
from pathlib import Path

import numpy as np

SR = 48000
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)
SEND = np.zeros(N)  # reverb bus (mono)

NOTE = dict(A2=110.0, C3=130.81, D3=146.83, E3=164.81, F3=174.61, G3=196.0,
            A3=220.0, B3=246.94, C4=261.63, D4=293.66, E4=329.63, F4=349.23, G4=392.0,
            A4=440.0, B4=493.88, C5=523.25, D5=587.33, E5=659.26, G5=783.99, A5=880.0, C6=1046.5)


def tt(d):
    return np.arange(int(d * SR)) / SR


def lowpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** 4), len(x))


def highpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * (1 - 1 / np.sqrt(1 + (f / fc) ** 4)), len(x))


def add(sig, t0, gain=1.0, pan=0.0, rev=0.0):
    i = int(round(t0 * SR))
    if i >= N:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    s = sig[:N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i:i + len(s)] += s * np.cos(a) * 1.414
    R[i:i + len(s)] += s * np.sin(a) * 1.414
    SEND[i:i + len(s)] += s * rev


# ---------- instruments ----------
def kick(d=0.45, f0=160, f1=42, decay=7):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    s += rng.standard_normal(len(t)) * np.exp(-t * 400) * .25
    return np.tanh(s * 1.8)


def snare(d=0.3):
    t = tt(d)
    n = highpass(rng.standard_normal(len(t)), 1500) * np.exp(-t * 16)
    return n * .7 + np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25) * .5


def hat(d=0.06, open_=False):
    t = tt(0.25 if open_ else d)
    return highpass(rng.standard_normal(len(t)), 7000) * np.exp(-t * (14 if open_ else 70))


def click(freq=1400):
    t = tt(0.05)
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 110) + rng.standard_normal(len(t)) * np.exp(-t * 300) * .3


def pluck(freq, d=0.5, bright=6):
    t = tt(d)
    s = sum(np.sin(2 * np.pi * freq * h * t) * np.exp(-t * (5 + h * bright)) / h for h in range(1, 7))
    return s * np.minimum(1, t * 400)


def blip(freq, d=0.18):
    t = tt(d)
    return (np.sin(2 * np.pi * freq * t) + .3 * np.sin(4 * np.pi * freq * t)) * np.exp(-t * 18) * np.minimum(1, t * 300)


def sweep(f0, f1, d, curve=3.0):
    t = tt(d)
    u = t / d
    f = f0 * (f1 / f0) ** (u ** (1 / curve) if f1 > f0 else u)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def riser(d):
    t = tt(d)
    u = t / d
    n = highpass(rng.standard_normal(len(t)), 2000) * u ** 2.5
    return n * .6 + sweep(200, 1600, d) * u ** 3 * .3


def whoosh(d, fc=2500):
    t = tt(d)
    return lowpass(rng.standard_normal(len(t)), fc) * np.sin(np.pi * t / d) ** 2


def rev_cymbal(d=0.5):
    t = tt(d)
    return highpass(rng.standard_normal(len(t)), 5000) * (t / d) ** 3


def impact(d=1.6, big=1.0):
    t = tt(d)
    s = np.zeros(len(t))
    k = kick(0.9, 130, 36, 4)
    s[:len(k)] += k
    s += np.sin(2 * np.pi * 38 * t) * np.exp(-t * 2.5) * .8 * big
    s += lowpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 6) * .5 * big
    return np.tanh(s * 1.3)


def pad(freqs, d, attack=0.4, release=0.5):
    t = tt(d)
    s = np.zeros(len(t))
    for f in freqs:
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            s += sum(np.sin(2 * np.pi * ff * h * t + h * det) / h ** 1.6 for h in range(1, 6))
    env = np.minimum(1, t / attack) * np.minimum(1, (d - t) / release)
    return s * env / (len(freqs) * 3)


def bass(freq, d=0.45):
    t = tt(d)
    s = sum(np.sin(2 * np.pi * freq * h * t) / h ** 1.3 for h in range(1, 6))
    return np.tanh(s * 1.5) * np.exp(-t * 3) * np.minimum(1, t * 200)


def shimmer(d):
    t = tt(d)
    s = np.zeros(len(t))
    for f in (NOTE['A5'], NOTE['E5'] * 2, NOTE['C6'] * 1.5, NOTE['A5'] * 2):
        s += np.sin(2 * np.pi * f * t) * (0.5 + 0.5 * np.sin(2 * np.pi * (6 + f / 500) * t))
    return s * (t / d) ** 2 / 4


# ---------- arrangement ----------
# 01 GENESIS
add(blip(NOTE['A5'], .3), .08, .22, 0, .6)
for b, n in zip((.5, 1.0, 1.5), ('E5', 'A5', 'C6')):
    add(kick(.5, 110, 40), b, .55)
    add(blip(NOTE[n], .5), b, .16, 0, .7)
for i in range(12):
    add(click(2200 + i * 120), .9 + i * .025 + .2, .05, -.8 + i * .145, .3)
add(riser(.8), 1.2, .22, 0, .3)
add(sweep(900, 120, .14) * np.exp(-tt(.14) * 10), 1.68, .2)
add(whoosh(.3, 4000), 1.8, .35)

# 02 FORM — kick on every beat, a pluck per morph
for b, n, bn in zip((2.0, 2.5, 3.0, 3.5, 4.0), ('A4', 'C5', 'D5', 'E5', 'G5'), ('A2', 'A2', 'C3', 'D3', 'E3')):
    add(kick(), b, .85)
    add(pluck(NOTE[n], .6), b, .32, 0, .35)
    add(pluck(NOTE[n] * 2, .4), b + .25, .1, .4, .5)
    add(bass(NOTE[bn]), b, .3)
    add(hat(), b + .25, .25, .3)
add(hat(open_=True), 3.75, .12, -.3)
add(riser(.3), 4.2, .3)
add(rev_cymbal(.3), 4.2, .35)

# 03 KINETIC TYPE
add(impact(1.2), 4.5, .9, 0, .4)
for i in range(6):
    add(click(1100 - i * 60), 4.5 + i * .05 + .27, .35, -.5 + i * .2, .2)
add(whoosh(.3, 3000), 5.2, .3)
hits = {5.5: 'A3', 6.0: 'F3', 6.5: 'G3', 7.0: 'E3'}
for b, n in hits.items():
    add(kick(), b, .9)
    add(snare(), b, .45, 0, .25)
    for k, mul in enumerate((1, 1.5, 2)):
        add(pluck(NOTE[n] * mul * 2, .45, 3), b, .12, (k - 1) * .5, .4)
    add(bass(NOTE[n] / 2, .5), b, .35)
for i in range(16):
    tt0 = 5.5 + i * .125
    add(hat(), tt0, .22 if i % 2 else .12, .35 if i % 2 else -.35)
for i in range(6):
    add(click(2600), 5.5 + i * .032, .12)
add(sweep(2400, 260, .35) * np.exp(-tt(.35) * 4), 6.0, .12, 0, .3)
bt = tt(.45)
add(np.sin(2 * np.pi * np.cumsum(300 + 300 * np.clip(1 + 3.6 * (bt / .4 - 1) ** 3 + 2.6 * (bt / .4 - 1) ** 2, 0, 2)) / SR) * np.exp(-bt * 5), 6.5, .14, 0, .3)
add(kick(), 7.25, .7)
for i in range(8):
    add(snare(.12), 7.25 + i * .03125, .08 + .03 * i)

# 04 DIMENSION
add(impact(1.4), 7.5, .9, 0, .5)
add(rev_cymbal(.4), 7.1, .25)
for t0, chord, root in ((7.5, ('A3', 'C4', 'E4'), 'A2'), (8.5, ('F3', 'A3', 'C4'), 'F3'), (9.5, ('G3', 'B3', 'D4'), 'G3')):
    add(pad([NOTE[c] for c in chord], 1.25, .25, .4), t0, .3, 0, .6)
    rf = NOTE[root] if root != 'F3' else NOTE['F3'] / 2
    rf = rf if rf < 120 else rf / 2
    for k in range(4):
        add(bass(rf, .3), t0 + k * .25, .22 + (.1 if k % 2 == 0 else 0))
for b in np.arange(7.5, 10.0, .5):
    add(kick(), b, .7)
    add(hat(), b + .25, .2, .3)
spark = [NOTE[n] * 2 for n in ('A4', 'C5', 'E5', 'G5', 'A5')]
for i in range(20):
    if rng.random() < .65:
        add(blip(spark[int(rng.random() * 5)], .25), 7.5 + i * .125, .06, rng.random() * 2 - 1, .8)
add(whoosh(.9, 1800), 8.65, .3, 0, .3)
add(riser(.45), 9.55, .35, 0, .2)
add(impact(1.8, 1.4), 10.0, 1.0, 0, .7)

# 05 FIELD
for i in range(6):
    add(whoosh(.22, 5000), 10.5 + i * .03, .14, -.8 + i * .32)
    add(whoosh(.25, 3500), 10.92 + i * .03, .1, -.8 + i * .32)
arp = ['A4', 'C5', 'E5', 'G5', 'A5', 'G5', 'E5', 'C5']
for i in range(int(1.45 / .125)):
    add(pluck(NOTE[arp[i % 8]], .3, 4), 10.95 + i * .125, .15, .5 if i % 2 else -.5, .35)
for b in (11.0, 11.5, 12.0):
    add(kick(), b, .8)
    add(bass(NOTE['A2']), b, .3)
    add(hat(open_=True), b + .25, .1, .2)
add(riser(.45), 12.0, .3)
add(sweep(1800, 200, .4) * np.hanning(int(.4 * SR)), 12.0, .1)

# 06 RESOLVE
add(whoosh(1.0, 2200), 12.45, .32, 0, .3)
add(shimmer(1.05), 12.45, .25, 0, .7)
add(rev_cymbal(.5), 13.0, .4)
add(impact(2.0, 1.2), 13.5, 1.0, 0, .6)
add(pad([NOTE[n] for n in ('A3', 'E4', 'A4', 'B4', 'C5')], 1.0, .02, .6), 13.5, .45, 0, .8)
for i in range(0, 40, 3):
    add(click(3000), 13.62 + i * .006, .04, -.5 + i / 40)
add(whoosh(.45, 2500), 14.3, .3)
add(sweep(1500, 70, .42) * np.hanning(int(.42 * SR)), 14.3, .18)
add(blip(NOTE['A5'], .4), 14.72, .3, 0, .9)
add(kick(.4, 120, 45), 14.72, .5)

# ---------- reverb + master ----------
def reverb_ir(seed, d=1.4):
    t = tt(d)
    r = np.random.default_rng(seed)
    return lowpass(r.standard_normal(len(t)), 6000) * np.exp(-t * 3.2) * .05


def conv(x, h):
    n = len(x) + len(h)
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[:len(x)]


L += conv(SEND, reverb_ir(1))
R += conv(SEND, reverb_ir(2))
mix = np.stack([L, R], 1)
mix /= np.percentile(np.abs(mix), 99.9) + 1e-9
mix = np.tanh(mix * 1.2) * .95
fade = np.ones(N)
fade[-int(.08 * SR):] = np.linspace(1, 0, int(.08 * SR))
mix *= fade[:, None]

out = Path(__file__).with_name('soundtrack.wav')
with wave.open(str(out), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
print(f'wrote {out}  peak={np.abs(mix).max():.2f}')
