import { describe, expect, it } from 'vitest';
import { TranscodeError, failureMessages, failureReasonFor, isDeterministicDecodeFailure, technicalSummary } from '@/features/transcoding/errors';
import { normalizeFps, parseProbe, summarizeProbe, withMeasuredDuration } from '@/features/transcoding/probe';

const video = (over: Record<string, unknown> = {}) => ({
  index: 0,
  codec_type: 'video',
  codec_name: 'h264',
  width: 1920,
  height: 1080,
  pix_fmt: 'yuv420p',
  avg_frame_rate: '30/1',
  r_frame_rate: '30/1',
  sample_aspect_ratio: '1:1',
  ...over,
});
const audio = (over: Record<string, unknown> = {}) => ({ index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, ...over });
const probe = (streams: unknown[], format: Record<string, unknown> = { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.5', bit_rate: '4000000' }) => ({
  streams,
  format,
});

describe('ffprobe parsing', () => {
  it('extracts the facts the pipeline needs', () => {
    const info = parseProbe(probe([video(), audio()]));
    expect(info).toMatchObject({
      videoStreamIndex: 0,
      audioStreamIndex: 1,
      width: 1920,
      height: 1080,
      rotation: 0,
      durationSeconds: 12.5,
      bitrateKbps: 4000,
      hasAudio: true,
      audioChannels: 2,
      interlaced: false,
      hdr: false,
      durationMissing: false,
    });
    expect(info.fps).toEqual({ num: 30, den: 1, value: 30 });
  });

  it('audio-less sources are fine', () => {
    const info = parseProbe(probe([video()]));
    expect(info.hasAudio).toBe(false);
    expect(info.audioStreamIndex).toBeNull();
  });

  it('applies rotation metadata (display matrix and the legacy rotate tag)', () => {
    const matrix = parseProbe(probe([video({ width: 640, height: 360, side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] })]));
    expect(matrix).toMatchObject({ width: 360, height: 640, rotation: 270, codedWidth: 640, codedHeight: 360 });
    const tag = parseProbe(probe([video({ width: 640, height: 360, tags: { rotate: '90' } })]));
    expect(tag).toMatchObject({ width: 360, height: 640, rotation: 90 });
    const upsideDown = parseProbe(probe([video({ width: 640, height: 360, tags: { rotate: '180' } })]));
    expect(upsideDown).toMatchObject({ width: 640, height: 360, rotation: 180 });
  });

  it('applies the sample aspect ratio of anamorphic sources', () => {
    const info = parseProbe(probe([video({ width: 720, height: 576, sample_aspect_ratio: '16:15' })]));
    expect(info).toMatchObject({ width: 768, height: 576 });
  });

  it('ignores cover art when looking for the video stream', () => {
    const info = parseProbe(
      probe([video({ index: 0, width: 600, height: 600, disposition: { attached_pic: 1 } }), video({ index: 1, width: 1280, height: 720 }), audio({ index: 2 })]),
    );
    expect(info).toMatchObject({ videoStreamIndex: 1, width: 1280, height: 720, audioStreamIndex: 2 });
  });

  it('detects interlaced and HDR material', () => {
    expect(parseProbe(probe([video({ field_order: 'tt' })])).interlaced).toBe(true);
    expect(parseProbe(probe([video({ field_order: 'progressive' })])).interlaced).toBe(false);
    expect(parseProbe(probe([video({ color_transfer: 'smpte2084' })])).hdr).toBe(true);
    expect(parseProbe(probe([video({ color_transfer: 'arib-std-b67' })])).hdr).toBe(true);
  });

  it('falls back to the stream duration, and reports a missing duration instead of guessing', () => {
    expect(parseProbe(probe([video({ duration: '7.25' })], { format_name: 'x' })).durationSeconds).toBe(7.25);
    const missing = parseProbe(probe([video()], { format_name: 'matroska,webm' }));
    expect(missing.durationMissing).toBe(true);
    expect(withMeasuredDuration(missing, 42).durationSeconds).toBe(42);
    expect(() => withMeasuredDuration(missing, 0)).toThrow(TranscodeError);
    expect(() => withMeasuredDuration(missing, 5 * 3600)).toThrowError(/TOO_LONG/);
  });
});

describe('ffprobe parsing: rejections', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as TranscodeError).code;
    }
    return null;
  };

  it('no video stream', () => {
    expect(code(() => parseProbe(probe([audio({ index: 0 })])))).toBe('NO_VIDEO_STREAM');
    expect(code(() => parseProbe(probe([video({ disposition: { attached_pic: 1 } })])))).toBe('NO_VIDEO_STREAM');
  });

  it('unreadable output', () => {
    expect(code(() => parseProbe({}))).toBe('UNREADABLE');
    expect(code(() => parseProbe(null))).toBe('UNREADABLE');
  });

  it('absurd dimensions', () => {
    expect(code(() => parseProbe(probe([video({ width: 0, height: 0 })])))).toBe('INVALID_DIMENSIONS');
    expect(code(() => parseProbe(probe([video({ width: 8, height: 8 })])))).toBe('INVALID_DIMENSIONS');
    expect(code(() => parseProbe(probe([video({ width: 20000, height: 1080 })])))).toBe('INVALID_DIMENSIONS');
    expect(code(() => parseProbe(probe([video({ width: 7000, height: 7000 })])))).toBe('INVALID_DIMENSIONS');
  });

  it('duration above the limit', () => {
    expect(code(() => parseProbe(probe([video()], { duration: String(5 * 3600) })))).toBe('TOO_LONG');
    expect(code(() => parseProbe(probe([video()], { duration: String(3 * 3600) })))).toBeNull();
  });
});

describe('frame-rate normalization', () => {
  it('keeps NTSC rates exact and common rates unchanged', () => {
    expect(normalizeFps('30000/1001')).toMatchObject({ num: 30000, den: 1001 });
    expect(normalizeFps('25/1').value).toBe(25);
    expect(normalizeFps('60/1').value).toBe(60);
  });

  it('halves rates above 60 and doubles rates below 12 (whole factors)', () => {
    expect(normalizeFps('120/1').value).toBe(60);
    expect(normalizeFps('240/1').value).toBe(60);
    expect(normalizeFps('5/1').value).toBe(20);
    expect(normalizeFps('1/1').value).toBe(16);
  });

  it('falls back to the nominal rate, then to 30', () => {
    expect(normalizeFps('0/0', '24/1').value).toBe(24);
    expect(normalizeFps(undefined, 'N/A').value).toBe(30);
  });
});

describe('probe summary', () => {
  it('contains no file names or paths', () => {
    const summary = summarizeProbe(parseProbe(probe([video(), audio()])));
    expect(JSON.stringify(summary)).not.toMatch(/\/|filename/i);
    expect(summary).toMatchObject({ width: 1920, height: 1080, hasAudio: true });
  });
});

describe('failure taxonomy', () => {
  it('maps every code to a safe Persian reason and a retry policy', () => {
    for (const [code, message] of Object.entries(failureMessages)) {
      expect(message, code).toMatch(/[؀-ۿ]/);
      expect(message).not.toMatch(/ffmpeg|ffprobe|\/|stack/i);
    }
    expect(new TranscodeError('UNREADABLE').retryable).toBe(false);
    expect(new TranscodeError('NO_VIDEO_STREAM').retryable).toBe(false);
    expect(new TranscodeError('TRANSCODE_FAILED').retryable).toBe(true);
    expect(new TranscodeError('TRANSCODE_FAILED', 'x', { retryable: false }).retryable).toBe(false);
  });

  it('unknown errors get the generic reason and never leak their message', () => {
    expect(failureReasonFor(new Error('ENOENT /var/secret/path'))).toBe(failureMessages.UNKNOWN);
    expect(failureReasonFor(new TranscodeError('TOO_LONG'))).toBe(failureMessages.TOO_LONG);
  });

  it('technical summaries strip file-system paths and are bounded', () => {
    const text = technicalSummary(new Error('failed reading /tmp/tg-abc/source.mp4 and /var/data/x.ts ' + 'y'.repeat(500)));
    expect(text).not.toContain('/tmp/tg-abc');
    expect(text).toContain('<path>');
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it('recognizes deterministic decoder failures from stderr', () => {
    expect(isDeterministicDecodeFailure('x: Invalid data found when processing input')).toBe(true);
    expect(isDeterministicDecodeFailure('moov atom not found')).toBe(true);
    expect(isDeterministicDecodeFailure('Killed')).toBe(false);
  });
});
