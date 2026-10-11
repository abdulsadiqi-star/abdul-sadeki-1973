/**
 * ffprobe result → the facts the pipeline needs about a source file.
 *
 * `parseProbe` is pure: it takes the JSON printed by
 *   ffprobe -v error -print_format json -show_format -show_streams <file>
 * and returns a `SourceInfo` (or throws a `TranscodeError` that explains why the file is refused).
 */
import { ALLOWED_CONTAINERS, FPS_RANGE, SOURCE_LIMITS } from './constants';
import { TranscodeError } from './errors';

export type Fps = { num: number; den: number; value: number };

export type SourceInfo = {
  container: string | null;
  /** ffprobe stream indexes of the streams we transcode (what `-map 0:<index>` needs). */
  videoStreamIndex: number;
  audioStreamIndex: number | null;
  videoCodec: string;
  pixFmt: string | null;
  /** Pixel size exactly as stored in the file (before rotation / sample aspect ratio). */
  codedWidth: number;
  codedHeight: number;
  /** DISPLAY size: rotation and non-square pixels applied. Everything downstream works with these. */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Output frame rate (constant), already clamped into FPS_RANGE. */
  fps: Fps;
  durationSeconds: number;
  /** True when the duration had to be measured because the container did not carry it (see `needsDurationMeasure`). */
  durationMissing: boolean;
  bitrateKbps: number | null;
  interlaced: boolean;
  hdr: boolean;
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
  audioChannels: number | null;
};

type RawStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  bit_rate?: string;
  sample_aspect_ratio?: string;
  field_order?: string;
  color_space?: string;
  color_primaries?: string;
  color_transfer?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number | string }>;
};

type RawProbe = {
  streams?: RawStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string };
};

const toFiniteNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "30000/1001" → { num, den }. Returns null for "0/0", "N/A" and garbage. */
function parseRational(text: string | undefined): { num: number; den: number } | null {
  if (!text) return null;
  const match = /^(\d+)\s*[/:]\s*(\d+)$/.exec(text.trim());
  if (!match) return null;
  const num = Number(match[1]);
  const den = Number(match[2]);
  return num > 0 && den > 0 ? { num, den } : null;
}

/**
 * Constant output frame rate: the source's average rate, halved while above 60 and doubled while below 12
 * (whole factors keep the cadence regular). Falls back to 30 when the file does not say.
 */
export function normalizeFps(avg: string | undefined, nominal?: string): Fps {
  const base = parseRational(avg) ?? parseRational(nominal) ?? { num: 30, den: 1 };
  let { num, den } = base;
  // Bounded loops: absurd values (e.g. 90000/1 time-base leaks) must not spin forever.
  for (let i = 0; i < 12 && num / den > FPS_RANGE.max; i++) den *= 2;
  for (let i = 0; i < 12 && num / den < FPS_RANGE.min; i++) num *= 2;
  return { num, den, value: num / den };
}

/** ffmpeg understands rationals directly ("30000/1001"); keeps NTSC rates exact. */
export const fpsExpression = (fps: Fps): string => (fps.den === 1 ? String(fps.num) : `${fps.num}/${fps.den}`);

function rotationOf(stream: RawStream): 0 | 90 | 180 | 270 {
  let degrees: number | null = null;
  for (const item of stream.side_data_list ?? []) {
    if (item.side_data_type === 'Display Matrix' && item.rotation !== undefined) {
      degrees = toFiniteNumber(item.rotation);
    }
  }
  if (degrees === null && stream.tags?.rotate) degrees = toFiniteNumber(stream.tags.rotate);
  if (degrees === null) return 0;
  const normalized = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

const INTERLACED_ORDERS = new Set(['tt', 'bb', 'tb', 'bt']);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

export function parseProbe(input: unknown): SourceInfo {
  const raw = (input ?? {}) as RawProbe;
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  if (streams.length === 0 && !raw.format) throw new TranscodeError('UNREADABLE', 'ffprobe returned no streams');

  // Refuse things ffmpeg can technically open but that are not video files (text → "ANSI art", raw bitstreams, ...).
  const formatName = raw.format?.format_name;
  if (formatName && !formatName.split(',').some((token) => ALLOWED_CONTAINERS.has(token.trim()))) {
    throw new TranscodeError('UNREADABLE', `unsupported container "${formatName.slice(0, 40)}"`);
  }

  // Cover art (attached pictures) is not a video stream.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new TranscodeError('NO_VIDEO_STREAM');

  const codedWidth = toFiniteNumber(video.width) ?? 0;
  const codedHeight = toFiniteNumber(video.height) ?? 0;
  if (codedWidth <= 0 || codedHeight <= 0) throw new TranscodeError('INVALID_DIMENSIONS', 'missing dimensions');

  // Display geometry: apply the sample aspect ratio (anamorphic sources), then the rotation.
  const sar = parseRational(video.sample_aspect_ratio);
  let width = codedWidth;
  let height = codedHeight;
  if (sar && Math.abs(sar.num / sar.den - 1) > 0.01) width = Math.round((codedWidth * sar.num) / sar.den);
  const rotation = rotationOf(video);
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (
    shortSide < SOURCE_LIMITS.minSide ||
    longSide > SOURCE_LIMITS.maxLongSide ||
    shortSide > SOURCE_LIMITS.maxShortSide
  ) {
    throw new TranscodeError('INVALID_DIMENSIONS', `${width}x${height}`);
  }

  const streamDuration = toFiniteNumber(video.duration);
  const formatDuration = toFiniteNumber(raw.format?.duration);
  const duration = [formatDuration, streamDuration].find((d): d is number => d !== null && d > 0) ?? 0;
  if (duration > SOURCE_LIMITS.maxDurationSeconds) {
    throw new TranscodeError('TOO_LONG', `${Math.round(duration)}s`);
  }

  const audio = streams.find((s) => s.codec_type === 'audio');
  const bitRate = toFiniteNumber(raw.format?.bit_rate);

  return {
    container: raw.format?.format_name ?? null,
    videoStreamIndex: toFiniteNumber(video.index) ?? 0,
    audioStreamIndex: audio ? toFiniteNumber(audio.index) : null,
    videoCodec: video.codec_name ?? 'unknown',
    pixFmt: video.pix_fmt ?? null,
    codedWidth,
    codedHeight,
    width,
    height,
    rotation,
    fps: normalizeFps(video.avg_frame_rate, video.r_frame_rate),
    durationSeconds: duration,
    durationMissing: duration <= 0,
    bitrateKbps: bitRate && bitRate > 0 ? Math.round(bitRate / 1000) : null,
    interlaced: INTERLACED_ORDERS.has(video.field_order ?? ''),
    hdr: HDR_TRANSFERS.has(video.color_transfer ?? ''),
    colorSpace: video.color_space ?? null,
    colorPrimaries: video.color_primaries ?? null,
    colorTransfer: video.color_transfer ?? null,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null,
    audioChannels: toFiniteNumber(audio?.channels),
  };
}

/** After a fallback duration measurement: refuse absurd lengths and return the completed info. */
export function withMeasuredDuration(info: SourceInfo, seconds: number): SourceInfo {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new TranscodeError('UNREADABLE', 'duration could not be determined');
  }
  if (seconds > SOURCE_LIMITS.maxDurationSeconds) throw new TranscodeError('TOO_LONG', `${Math.round(seconds)}s`);
  return { ...info, durationSeconds: seconds, durationMissing: false };
}

/** Sanitized subset stored in `TranscodeJob.probe` (no file names, no paths). */
export function summarizeProbe(info: SourceInfo): Record<string, string | number | boolean | null> {
  return {
    container: info.container,
    videoCodec: info.videoCodec,
    pixFmt: info.pixFmt,
    width: info.width,
    height: info.height,
    codedWidth: info.codedWidth,
    codedHeight: info.codedHeight,
    rotation: info.rotation,
    fps: Math.round(info.fps.value * 1000) / 1000,
    durationSeconds: Math.round(info.durationSeconds * 1000) / 1000,
    bitrateKbps: info.bitrateKbps,
    interlaced: info.interlaced,
    hdr: info.hdr,
    hasAudio: info.hasAudio,
    audioCodec: info.audioCodec,
    audioChannels: info.audioChannels,
  };
}
