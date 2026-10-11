import { describe, expect, it } from 'vitest';
import { PlayTimeAccumulator, type PlaySample } from '@/components/player/play-time';

/** Drive the accumulator like the 500 ms timer does. */
function run(samples: Array<Partial<PlaySample> & { advanceMs?: number }>, start: Partial<PlaySample> = {}) {
  const acc = new PlayTimeAccumulator();
  let wall = start.wallMs ?? 10_000;
  let media = start.mediaTime ?? 0;
  const base: PlaySample = { wallMs: wall, mediaTime: media, playing: true, rate: 1, ...start };
  acc.sample(base); // priming sample
  const credits: number[] = [];
  for (const s of samples) {
    const step = s.advanceMs ?? 500;
    wall += step;
    media = s.mediaTime ?? media + (step / 1000) * (s.rate ?? 1);
    credits.push(acc.sample({ wallMs: wall, mediaTime: media, playing: s.playing ?? true, rate: s.rate ?? 1 }));
  }
  return { acc, credits };
}

describe('PlayTimeAccumulator', () => {
  it('credits continuous playback one sample at a time', () => {
    const { acc, credits } = run(Array.from({ length: 20 }, () => ({})));
    expect(acc.total).toBeCloseTo(10, 5);
    expect(credits.every((c) => c === 0.5)).toBe(true);
  });

  it('never credits the priming sample', () => {
    const acc = new PlayTimeAccumulator();
    expect(acc.sample({ wallMs: 1000, mediaTime: 50, playing: true, rate: 1 })).toBe(0);
    expect(acc.total).toBe(0);
  });

  it('counts wall-clock seconds at higher speeds (the media clock runs faster)', () => {
    const { acc } = run(Array.from({ length: 10 }, () => ({ rate: 2 })), { rate: 2 });
    expect(acc.total).toBeCloseTo(5, 5);
    const slow = run(Array.from({ length: 10 }, () => ({ rate: 0.5 })), { rate: 0.5 });
    expect(slow.acc.total).toBeCloseTo(5, 5);
  });

  it('credits nothing while paused, buffering or seeking', () => {
    const { acc } = run([{}, {}, { playing: false }, { playing: false, mediaTime: 3 }, { playing: false }]);
    expect(acc.total).toBeCloseTo(1, 5); // only the first two playing samples
  });

  it('does not count a stalled media clock as playing', () => {
    const { acc } = run([{}, { mediaTime: 0.5 }, { mediaTime: 0.5 }, { mediaTime: 0.5 }]); // the clock froze after the first sample
    expect(acc.total).toBeCloseTo(0.5, 5);
  });

  it('does not count seeks (forward or backward jumps) as watching', () => {
    const { acc } = run([{}, { mediaTime: 120 }, {}, { mediaTime: 3 }, {}]);
    // samples: 0.5 (play) + 0 (jump to 120) + 0.5 (play) + 0 (jump back) + 0.5 (play)
    expect(acc.total).toBeCloseTo(1.5, 5);
  });

  it('caps what one late sample can claim (throttled background timers)', () => {
    const { acc, credits } = run([{ advanceMs: 30_000 }]);
    expect(credits[0]).toBe(2);
    expect(acc.total).toBe(2);
  });

  it('ignores a rate of 0 / garbage by treating it as normal speed', () => {
    const acc = new PlayTimeAccumulator();
    acc.sample({ wallMs: 0, mediaTime: 0, playing: true, rate: 0 });
    expect(acc.sample({ wallMs: 1000, mediaTime: 1, playing: true, rate: 0 })).toBe(1);
    expect(acc.sample({ wallMs: 1000, mediaTime: 2, playing: true, rate: 1 })).toBe(0); // no wall time passed
  });
});
