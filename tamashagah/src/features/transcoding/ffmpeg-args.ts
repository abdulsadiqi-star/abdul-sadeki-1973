/**
 * ffmpeg / ffprobe argument builders — pure functions returning argv arrays (never shell strings, so file names can
 * not inject options and nothing needs quoting).
 *
 * The transcode is ONE ffmpeg run: the source is decoded once, split, scaled per rendition, encoded with x264 and
 * written as HLS (MPEG-TS) by one `-f hls` output per rendition. `-progress pipe:1` gives machine-readable progress.
 */
import { AUDIO_SAMPLE_RATE, X264_PRESETS } from './constants';
import { fpsExpression, type SourceInfo } from './probe';
import type { RenditionSpec } from './plan';
import type { ThumbnailSpec } from './plan';

/** ffprobe: full stream + container description as JSON. */
export const buildProbeArgs = (input: string): string[] => [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  '-protocol_whitelist',
  'file',
  input,
];

/**
 * Fallback duration measurement for containers that do not store it (e.g. browser-recorded WebM): a stream copy to
 * the null muxer reads every packet without decoding, so it is fast, and the last `out_time_us` is the duration.
 */
export const buildDurationMeasureArgs = (input: string, videoStreamIndex: number): string[] => [
  '-hide_banner',
  '-nostdin',
  '-v',
  'error',
  '-protocol_whitelist',
  'file',
  '-i',
  input,
  '-map',
  `0:${videoStreamIndex}`,
  '-c',
  'copy',
  '-progress',
  'pipe:1',
  '-nostats',
  '-f',
  'null',
  '-',
];

type FilterSource = Pick<SourceInfo, 'interlaced' | 'hdr'>;

/** Tone-map HDR (PQ/HLG) to SDR BT.709 — the canonical zscale/tonemap recipe. Needs libzimg. */
export const HDR_TO_SDR_FILTER =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

/** Filters applied once to the decoded picture, before it is split / scaled. */
export function sourceFilters(source: FilterSource, options: { hdrToSdr?: boolean } = {}): string[] {
  const filters: string[] = [];
  if (source.interlaced) filters.push('yadif=mode=0:deint=interlaced');
  if (source.hdr && options.hdrToSdr) filters.push(HDR_TO_SDR_FILTER);
  return filters;
}

const KNOWN_TAG = /^[a-z0-9][a-z0-9-]*$/;
const clean = (value: string | null | undefined): string | null =>
  value && value !== 'unknown' && value !== 'unspecified' && KNOWN_TAG.test(value) ? value : null;

export type ColorTags = { space: string; primaries: string; trc: string };

/**
 * Colour tags written to every rendition. We never convert the matrix (that would shift colours), we only make
 * explicit what players would otherwise GUESS from the resolution — otherwise a 1080p source downscaled to 360p would
 * be tagged "untagged SD" and rendered with the wrong matrix by some players.
 */
export function colorTagsFor(
  source: Pick<SourceInfo, 'width' | 'height' | 'colorSpace' | 'colorPrimaries' | 'colorTransfer' | 'hdr'>,
  hdrToSdr: boolean,
): ColorTags {
  if (source.hdr && hdrToSdr) return { space: 'bt709', primaries: 'bt709', trc: 'bt709' };
  const hd = source.width >= 1280 || source.height > 576;
  const assumed = hd ? 'bt709' : 'smpte170m';
  return {
    space: clean(source.colorSpace) ?? assumed,
    primaries: clean(source.colorPrimaries) ?? assumed,
    trc: clean(source.colorTransfer) ?? assumed,
  };
}

export type TranscodeArgsInput = {
  input: string;
  /** Directory the renditions are written to: `<outputDir>/<label>/index.m3u8` + `seg_%05d.ts`. */
  outputDir: string;
  source: Pick<
    SourceInfo,
    | 'videoStreamIndex'
    | 'audioStreamIndex'
    | 'hasAudio'
    | 'audioChannels'
    | 'interlaced'
    | 'hdr'
    | 'fps'
    | 'width'
    | 'height'
    | 'colorSpace'
    | 'colorPrimaries'
    | 'colorTransfer'
  >;
  renditions: readonly RenditionSpec[];
  segmentSeconds: number;
  preset: string;
  hdrToSdr?: boolean;
};

export function buildTranscodeArgs(options: TranscodeArgsInput): string[] {
  const { input, outputDir, source, renditions, segmentSeconds, preset } = options;
  if (renditions.length === 0) throw new Error('At least one rendition is required');
  if (!(X264_PRESETS as readonly string[]).includes(preset)) throw new Error(`Unsupported x264 preset: ${preset}`);
  if (!Number.isInteger(segmentSeconds) || segmentSeconds < 1 || segmentSeconds > 30) {
    throw new Error('segmentSeconds must be an integer between 1 and 30');
  }

  const hdrToSdr = Boolean(options.hdrToSdr && source.hdr);
  const fps = fpsExpression(source.fps);
  // GOP aligned to the segment length: a keyframe at least every `segmentSeconds` (exactly at multiples via
  // force_key_frames), no scene-cut keyframes, so every segment starts on an IDR frame and lasts the same time.
  const gop = Math.max(1, Math.round(source.fps.value * segmentSeconds));
  const tags = colorTagsFor(source, hdrToSdr);
  const channels = Math.min(2, Math.max(1, source.audioChannels ?? 2));

  // Decode once → (deinterlace) → (tone-map) → constant frame rate → split → per-rendition scale.
  const shared = [...sourceFilters(source, { hdrToSdr }), `fps=${fps}`].join(',');
  const scaleFor = (r: RenditionSpec) =>
    `scale=${r.width}:${r.height}:flags=lanczos,setsar=1,format=yuv420p`;
  const head = `[0:${source.videoStreamIndex}]${shared}`;
  const graph =
    renditions.length === 1
      ? `${head},${scaleFor(renditions[0]!)}[v0]`
      : `${head},split=${renditions.length}${renditions.map((_, i) => `[s${i}]`).join('')};` +
        renditions.map((r, i) => `[s${i}]${scaleFor(r)}[v${i}]`).join(';');

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',
    '-protocol_whitelist',
  'file',
  '-i',
    input,
    '-filter_complex',
    graph,
  ];

  renditions.forEach((r, i) => {
    const dir = `${outputDir}/${r.label}`;
    args.push(
      '-map',
      `[v${i}]`,
      ...(source.hasAudio && source.audioStreamIndex !== null ? ['-map', `0:${source.audioStreamIndex}`] : []),
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-profile:v',
      'high',
      '-level:v',
      r.level,
      '-crf',
      String(r.crf),
      '-maxrate',
      `${r.maxrateKbps}k`,
      '-bufsize',
      `${r.bufsizeKbps}k`,
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0',
      '-force_key_frames',
      `expr:gte(t,n_forced*${segmentSeconds})`,
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'cfr',
      '-colorspace',
      tags.space,
      '-color_primaries',
      tags.primaries,
      '-color_trc',
      tags.trc,
      ...(source.hasAudio && source.audioStreamIndex !== null
        ? ['-c:a', 'aac', '-b:a', `${r.audioKbps}k`, '-ac', String(channels), '-ar', String(AUDIO_SAMPLE_RATE)]
        : ['-an']),
      '-max_muxing_queue_size',
      '1024',
      '-f',
      'hls',
      '-hls_time',
      String(segmentSeconds),
      '-hls_playlist_type',
      'vod',
      '-hls_flags',
      'independent_segments',
      '-hls_segment_type',
      'mpegts',
      '-hls_segment_filename',
      `${dir}/seg_%05d.ts`,
      `${dir}/index.m3u8`,
    );
  });
  return args;
}

/** One JPEG frame at `thumb.atSeconds` (input seeking: fast even for long files), already rotated and square-pixel. */
export function buildThumbnailArgs(options: {
  input: string;
  output: string;
  thumb: Pick<ThumbnailSpec, 'atSeconds' | 'width' | 'height'>;
  source: Pick<SourceInfo, 'videoStreamIndex' | 'interlaced' | 'hdr'>;
  hdrToSdr?: boolean;
}): string[] {
  const { input, output, thumb, source } = options;
  const filters = [
    ...sourceFilters(source, { hdrToSdr: options.hdrToSdr }),
    `scale=${thumb.width}:${thumb.height}:flags=lanczos`,
    'setsar=1',
  ].join(',');
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-ss',
    thumb.atSeconds.toFixed(3),
    '-protocol_whitelist',
  'file',
  '-i',
    input,
    '-map',
    `0:${source.videoStreamIndex}`,
    '-frames:v',
    '1',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    filters,
    '-q:v',
    '3',
    '-update',
    '1',
    output,
  ];
}
