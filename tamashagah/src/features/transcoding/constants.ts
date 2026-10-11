/**
 * Constants of the transcoding pipeline. Pure data, no I/O — shared by the worker, the studio and the tests.
 */

/**
 * Rendition ladder. Rungs are expressed by the SHORT side of the picture (so a 1080x1920 portrait clip and a
 * 1920x1080 landscape clip both sit on the "1080p" rung). Only rungs <= the source are produced: we NEVER upscale.
 */
export const RENDITION_LADDER = [1080, 720, 480, 360] as const;

export type RungProfile = {
  /** Constrained-VBR ceiling for the video stream (kbit/s). */
  videoKbps: number;
  audioKbps: number;
  /** x264 constant rate factor (quality target, capped by the ceiling above). */
  crf: number;
};

export const RUNG_PROFILES: Record<number, RungProfile> = {
  1080: { videoKbps: 5000, audioKbps: 128, crf: 22 },
  720: { videoKbps: 2800, audioKbps: 128, crf: 22 },
  480: { videoKbps: 1400, audioKbps: 96, crf: 23 },
  360: { videoKbps: 800, audioKbps: 96, crf: 23 },
};

/** Sources whose short side is below the smallest rung get ONE rendition at source size, scaled from this reference. */
export const SMALL_SOURCE_PROFILE = {
  referencePixels: 640 * 360,
  referenceVideoKbps: 800,
  minVideoKbps: 200,
  audioKbps: 64,
  crf: 23,
} as const;

/** What the pipeline refuses to process ("absurd" files). */
export const SOURCE_LIMITS = {
  /** Smaller than this is not a picture. */
  minSide: 16,
  maxLongSide: 8192,
  maxShortSide: 4608,
  /** 4 hours. Transcoding longer sources on a shared worker would starve the queue. */
  maxDurationSeconds: 4 * 3600,
} as const;

/**
 * ffprobe `format_name` tokens we accept as real video containers. ffmpeg happily "demuxes" almost anything — a
 * plain text file is probed as an ANSI-art video by the `tty` demuxer — so the container must be one that people
 * actually upload (the extension allow-list in `features/uploads/policy.ts` maps onto exactly these).
 */
export const ALLOWED_CONTAINERS: ReadonlySet<string> = new Set([
  'mov', // mp4 / m4v / mov / 3gp  (ffprobe reports "mov,mp4,m4a,3gp,3g2,mj2")
  'mp4',
  'matroska', // mkv / webm  ("matroska,webm")
  'webm',
  'avi',
  'asf', // wmv
  'flv',
  'mpeg', // mpg / mpeg (program stream)
  'mpegts',
  'ogg', // ogv
]);

/** Output frame rate is kept in this range (halved / doubled by whole factors to get there). */
export const FPS_RANGE = { min: 12, max: 60 } as const;

export const AUDIO_SAMPLE_RATE = 48_000;

/** Candidate thumbnails (positions as a fraction of the duration) and which one becomes the default poster. */
export const THUMBNAIL_FRACTIONS = [0.12, 0.45, 0.78] as const;
export const DEFAULT_POSTER_INDEX = 2;
export const THUMBNAIL_BOX = { long: 1280, short: 720 } as const;

/** Valid values for `TRANSCODE_PRESET` (anything else is rejected before it reaches ffmpeg's argv). */
export const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;

/** Progress budget per pipeline stage (percent of the whole job). TRANSCODE interpolates inside its window. */
export const STAGE_PROGRESS = {
  PROBE: { from: 0, to: 4 },
  TRANSCODE: { from: 4, to: 86 },
  THUMBNAILS: { from: 86, to: 90 },
  PACKAGE: { from: 90, to: 98 },
  FINALIZE: { from: 98, to: 100 },
} as const;
