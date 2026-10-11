import { describe, expect, it } from 'vitest';
import { FfmpegProgressParser, mapToWindow, progressFraction } from '@/features/transcoding/progress';
import { STAGE_PROGRESS } from '@/features/transcoding/constants';

const block = (extra: Record<string, string>, end = false) =>
  Object.entries({ frame: '240', fps: '118.4', ...extra, progress: end ? 'end' : 'continue' })
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

describe('ffmpeg -progress parser', () => {
  it('parses a complete block', () => {
    const parser = new FfmpegProgressParser();
    const out = parser.push(
      block({ out_time_us: '8008000', out_time_ms: '8008000', out_time: '00:00:08.008000', speed: '3.95x', total_size: '123456' }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ outTimeSeconds: 8.008, frame: 240, fps: 118.4, speed: 3.95, totalSize: 123456, done: false });
  });

  it('handles output split at arbitrary byte boundaries', () => {
    const parser = new FfmpegProgressParser();
    const text = block({ out_time_us: '2000000' }) + block({ out_time_us: '4000000' }) + block({ out_time_us: '6000000' }, true);
    const seen: number[] = [];
    let done = false;
    for (let i = 0; i < text.length; i += 7) {
      for (const snap of parser.push(text.slice(i, i + 7))) {
        seen.push(snap.outTimeSeconds);
        done = snap.done;
      }
    }
    expect(seen).toEqual([2, 4, 6]);
    expect(done).toBe(true);
  });

  it('treats N/A and negative times as zero and falls back to the clock string', () => {
    const parser = new FfmpegProgressParser();
    expect(parser.push(block({ out_time_us: 'N/A', out_time_ms: 'N/A', out_time: 'N/A' }))[0]!.outTimeSeconds).toBe(0);
    expect(parser.push(block({ out_time_us: '-9223372036854775807' }))[0]!.outTimeSeconds).toBe(0);
    expect(parser.push(block({ out_time: '00:01:02.500000' }))[0]!.outTimeSeconds).toBe(62.5);
    // out_time_ms is microseconds too (ffmpeg quirk)
    expect(parser.push(block({ out_time_ms: '3500000' }))[0]!.outTimeSeconds).toBe(3.5);
  });

  it('ignores garbage lines and Windows line endings', () => {
    const parser = new FfmpegProgressParser();
    const out = parser.push('hello\r\nout_time_us=1000000\r\nprogress=continue\r\n');
    expect(out).toHaveLength(1);
    expect(out[0]!.outTimeSeconds).toBe(1);
  });

  it('does not emit anything until a block is closed', () => {
    const parser = new FfmpegProgressParser();
    expect(parser.push('out_time_us=1000000\nframe=3\n')).toHaveLength(0);
    expect(parser.push('progress=continue\n')).toHaveLength(1);
  });
});

describe('progress mapping', () => {
  it('clamps the fraction and handles unknown durations', () => {
    expect(progressFraction(5, 10)).toBe(0.5);
    expect(progressFraction(12, 10)).toBe(1);
    expect(progressFraction(-1, 10)).toBe(0);
    expect(progressFraction(5, 0)).toBe(0);
  });

  it('maps a stage fraction into its window of the whole job', () => {
    expect(mapToWindow(0, STAGE_PROGRESS.TRANSCODE)).toBe(STAGE_PROGRESS.TRANSCODE.from);
    expect(mapToWindow(1, STAGE_PROGRESS.TRANSCODE)).toBe(STAGE_PROGRESS.TRANSCODE.to);
    expect(mapToWindow(0.5, { from: 10, to: 20 })).toBe(15);
    expect(mapToWindow(7, { from: 10, to: 20 })).toBe(20);
  });

  it('stage windows are contiguous and cover 0..100', () => {
    const order = ['PROBE', 'TRANSCODE', 'THUMBNAILS', 'PACKAGE', 'FINALIZE'] as const;
    expect(STAGE_PROGRESS[order[0]].from).toBe(0);
    for (let i = 1; i < order.length; i++) expect(STAGE_PROGRESS[order[i]!].from).toBe(STAGE_PROGRESS[order[i - 1]!].to);
    expect(STAGE_PROGRESS.FINALIZE.to).toBe(100);
  });
});
