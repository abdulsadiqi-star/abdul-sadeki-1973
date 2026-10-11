import { describe, expect, it } from 'vitest';
import {
  HDR_TO_SDR_FILTER,
  buildDurationMeasureArgs,
  buildProbeArgs,
  buildThumbnailArgs,
  buildTranscodeArgs,
  colorTagsFor,
  type TranscodeArgsInput,
} from '@/features/transcoding/ffmpeg-args';
import { planRenditions } from '@/features/transcoding/plan';

const fps30 = { num: 30, den: 1, value: 30 };
const source = (over: Partial<TranscodeArgsInput['source']> = {}): TranscodeArgsInput['source'] => ({
  videoStreamIndex: 0,
  audioStreamIndex: 1,
  hasAudio: true,
  audioChannels: 2,
  interlaced: false,
  hdr: false,
  fps: fps30,
  width: 1920,
  height: 1080,
  colorSpace: null,
  colorPrimaries: null,
  colorTransfer: null,
  ...over,
});

const build = (over: Partial<TranscodeArgsInput> = {}) => {
  const src = over.source ?? source();
  return buildTranscodeArgs({
    input: '/tmp/work/source.bin',
    outputDir: '/tmp/work/hls',
    source: src,
    renditions: planRenditions({ width: src.width, height: src.height, fps: src.fps.value }),
    segmentSeconds: 6,
    preset: 'veryfast',
    ...over,
  });
};

const valueAfter = (args: string[], flag: string, from = 0) => {
  const i = args.indexOf(flag, from);
  return i >= 0 ? args[i + 1] : undefined;
};
const allValues = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []));

describe('transcode arguments', () => {
  it('is ONE ffmpeg run with machine-readable progress and one HLS output per rendition', () => {
    const args = build();
    expect(valueAfter(args, '-progress')).toBe('pipe:1');
    expect(args).toContain('-nostats');
    expect(args).toContain('-nostdin');
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
    expect(allValues(args, '-f')).toEqual(['hls', 'hls', 'hls', 'hls']);
    expect(args.filter((a) => a.endsWith('/index.m3u8'))).toEqual([
      '/tmp/work/hls/1080p/index.m3u8',
      '/tmp/work/hls/720p/index.m3u8',
      '/tmp/work/hls/480p/index.m3u8',
      '/tmp/work/hls/360p/index.m3u8',
    ]);
    expect(allValues(args, '-hls_segment_filename')).toEqual([
      '/tmp/work/hls/1080p/seg_%05d.ts',
      '/tmp/work/hls/720p/seg_%05d.ts',
      '/tmp/work/hls/480p/seg_%05d.ts',
      '/tmp/work/hls/360p/seg_%05d.ts',
    ]);
  });

  it('decodes once, forces constant frame rate and scales every rendition from the same split', () => {
    const graph = valueAfter(build(), '-filter_complex')!;
    expect(graph.startsWith('[0:0]fps=30,split=4[s0][s1][s2][s3];')).toBe(true);
    expect(graph).toContain('[s0]scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v0]');
    expect(graph).toContain('[s1]scale=1280:720:flags=lanczos,setsar=1,format=yuv420p[v1]');
    expect(graph).toContain('[s3]scale=640:360:flags=lanczos,setsar=1,format=yuv420p[v3]');
    expect(allValues(build(), '-fps_mode')).toEqual(['cfr', 'cfr', 'cfr', 'cfr']);
  });

  it('uses the exact rational frame rate for NTSC sources', () => {
    const args = build({ source: source({ fps: { num: 30000, den: 1001, value: 29.97 } }) });
    expect(valueAfter(args, '-filter_complex')).toContain('fps=30000/1001');
  });

  it('a single rendition needs no split', () => {
    const args = build({ source: source({ width: 640, height: 360 }) });
    const graph = valueAfter(args, '-filter_complex')!;
    expect(graph).not.toContain('split');
    expect(graph).toBe('[0:0]fps=30,scale=640:360:flags=lanczos,setsar=1,format=yuv420p[v0]');
    expect(allValues(args, '-f')).toEqual(['hls']);
  });

  it('aligns the GOP and the keyframes with the segment length', () => {
    const args = build({ segmentSeconds: 4 });
    expect(new Set(allValues(args, '-g'))).toEqual(new Set(['120']));
    expect(new Set(allValues(args, '-keyint_min'))).toEqual(new Set(['120']));
    expect(new Set(allValues(args, '-sc_threshold'))).toEqual(new Set(['0']));
    expect(new Set(allValues(args, '-force_key_frames'))).toEqual(new Set(['expr:gte(t,n_forced*4)']));
    expect(new Set(allValues(args, '-hls_time'))).toEqual(new Set(['4']));
    expect(new Set(allValues(args, '-hls_flags'))).toEqual(new Set(['independent_segments']));
    expect(new Set(allValues(args, '-hls_playlist_type'))).toEqual(new Set(['vod']));
    expect(new Set(allValues(args, '-hls_segment_type'))).toEqual(new Set(['mpegts']));
  });

  it('writes H.264 High + AAC with per-rendition rate control and levels', () => {
    const args = build();
    expect(new Set(allValues(args, '-c:v'))).toEqual(new Set(['libx264']));
    expect(new Set(allValues(args, '-profile:v'))).toEqual(new Set(['high']));
    expect(new Set(allValues(args, '-pix_fmt'))).toEqual(new Set(['yuv420p']));
    expect(allValues(args, '-level:v')).toEqual(['4.0', '3.1', '3.1', '3.0']);
    expect(allValues(args, '-maxrate')).toEqual(['5000k', '2800k', '1400k', '800k']);
    expect(allValues(args, '-bufsize')).toEqual(['10000k', '5600k', '2800k', '1600k']);
    expect(allValues(args, '-b:a')).toEqual(['128k', '128k', '96k', '96k']);
    expect(new Set(allValues(args, '-c:a'))).toEqual(new Set(['aac']));
    expect(new Set(allValues(args, '-ar'))).toEqual(new Set(['48000']));
    expect(valueAfter(args, '-preset')).toBe('veryfast');
  });

  it('maps the audio stream per output, and drops audio entirely for audio-less sources', () => {
    const withAudio = build();
    expect(allValues(withAudio, '-map').filter((m) => m === '0:1')).toHaveLength(4);
    expect(withAudio).not.toContain('-an');

    const silent = build({ source: source({ hasAudio: false, audioStreamIndex: null }) });
    expect(allValues(silent, '-map').some((m) => m.startsWith('0:'))).toBe(false);
    expect(silent.filter((a) => a === '-an')).toHaveLength(4);
    expect(silent).not.toContain('-c:a');
  });

  it('downmixes surround to stereo but keeps mono as mono', () => {
    expect(new Set(allValues(build({ source: source({ audioChannels: 6 }) }), '-ac'))).toEqual(new Set(['2']));
    expect(new Set(allValues(build({ source: source({ audioChannels: 1 }) }), '-ac'))).toEqual(new Set(['1']));
  });

  it('deinterlaces interlaced sources before scaling', () => {
    const graph = valueAfter(build({ source: source({ interlaced: true }) }), '-filter_complex')!;
    expect(graph.startsWith('[0:0]yadif=mode=0:deint=interlaced,fps=30,split=')).toBe(true);
  });

  it('tone-maps HDR only when asked to', () => {
    expect(valueAfter(build({ source: source({ hdr: true }) }), '-filter_complex')).not.toContain('tonemap');
    const mapped = build({ source: source({ hdr: true }), hdrToSdr: true });
    expect(valueAfter(mapped, '-filter_complex')).toContain(HDR_TO_SDR_FILTER);
    expect(new Set(allValues(mapped, '-color_trc'))).toEqual(new Set(['bt709']));
  });

  it('uses the real stream indexes (cover art or extra streams may come first)', () => {
    const args = build({ source: source({ videoStreamIndex: 2, audioStreamIndex: 4 }) });
    expect(valueAfter(args, '-filter_complex')).toContain('[0:2]fps=30');
    expect(allValues(args, '-map')).toContain('0:4');
  });

  it('never splices the input path into a shell string (spaces, quotes and flags stay one argv element)', () => {
    const nasty = '/tmp/w ork/"; rm -rf / #/-i evil.mp4';
    const args = build({ input: nasty });
    expect(args[args.indexOf('-i') + 1]).toBe(nasty);
    expect(args.filter((a) => a.includes('rm -rf'))).toEqual([nasty]);
  });

  it('rejects an unknown x264 preset and silly segment lengths before touching ffmpeg', () => {
    expect(() => build({ preset: 'veryfast; rm -rf /' })).toThrow(/preset/);
    expect(() => build({ segmentSeconds: 0 })).toThrow(/segmentSeconds/);
    expect(() => build({ segmentSeconds: 1.5 })).toThrow(/segmentSeconds/);
    expect(() => build({ renditions: [] })).toThrow(/rendition/);
  });
});

describe('colour tags', () => {
  const base = { width: 1920, height: 1080, colorSpace: null, colorPrimaries: null, colorTransfer: null, hdr: false };

  it('keeps explicit source tags', () => {
    expect(colorTagsFor({ ...base, colorSpace: 'bt470bg', colorPrimaries: 'bt470bg', colorTransfer: 'smpte170m' }, false)).toEqual({
      space: 'bt470bg',
      primaries: 'bt470bg',
      trc: 'smpte170m',
    });
  });

  it('makes the resolution-based guess explicit for untagged sources', () => {
    expect(colorTagsFor(base, false)).toEqual({ space: 'bt709', primaries: 'bt709', trc: 'bt709' });
    expect(colorTagsFor({ ...base, width: 720, height: 480 }, false)).toEqual({ space: 'smpte170m', primaries: 'smpte170m', trc: 'smpte170m' });
    expect(colorTagsFor({ ...base, colorSpace: 'unknown', colorPrimaries: 'unspecified' }, false).space).toBe('bt709');
  });

  it('tone-mapped HDR is BT.709', () => {
    expect(colorTagsFor({ ...base, hdr: true, colorTransfer: 'smpte2084', colorSpace: 'bt2020nc' }, true)).toEqual({
      space: 'bt709',
      primaries: 'bt709',
      trc: 'bt709',
    });
  });
});

describe('thumbnail, probe and duration arguments', () => {
  it('extracts one JPEG frame with fast input seeking', () => {
    const args = buildThumbnailArgs({
      input: '/tmp/s.bin',
      output: '/tmp/out/auto_2.jpg',
      thumb: { atSeconds: 4.5, width: 1280, height: 720 },
      source: { videoStreamIndex: 0, interlaced: false, hdr: false },
    });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(valueAfter(args, '-ss')).toBe('4.500');
    expect(valueAfter(args, '-frames:v')).toBe('1');
    expect(valueAfter(args, '-vf')).toBe('scale=1280:720:flags=lanczos,setsar=1');
    expect(args.at(-1)).toBe('/tmp/out/auto_2.jpg');
  });

  it('ffprobe prints JSON for the format and every stream', () => {
    expect(buildProbeArgs('/x/y')).toEqual(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '/x/y']);
  });

  it('measures duration by stream copy to the null muxer', () => {
    const args = buildDurationMeasureArgs('/x/y', 3);
    expect(valueAfter(args, '-map')).toBe('0:3');
    expect(valueAfter(args, '-c')).toBe('copy');
    expect(args.slice(-3)).toEqual(['-f', 'null', '-']);
  });
});
