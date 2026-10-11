/**
 * Rendition planner — pure and deterministic.
 *
 * Rules (see docs/features/media.md):
 *  - The ladder is defined by the SHORT side: 1080 / 720 / 480 / 360. Portrait works the same way.
 *  - Only rungs <= the source's short side are produced. NEVER upscale.
 *  - Sources below the smallest rung get exactly ONE rendition at their own size (even dimensions).
 *  - Every output dimension is even (H.264 4:2:0 requirement) and the aspect ratio is preserved.
 */
import {
  DEFAULT_POSTER_INDEX,
  RENDITION_LADDER,
  RUNG_PROFILES,
  SMALL_SOURCE_PROFILE,
  THUMBNAIL_BOX,
  THUMBNAIL_FRACTIONS,
} from './constants';
import { pickH264Level } from './h264';

export type RenditionSpec = {
  /** "720p" — also the directory name under `videos/<id>/hls/`. */
  label: string;
  /** The short-side target this rendition sits on (equals the source's short side for tiny sources). */
  rung: number;
  width: number;
  height: number;
  crf: number;
  /** Constrained-VBR ceiling for video (kbit/s). */
  videoKbps: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioKbps: number;
  /** H.264 level passed to x264 ("3.1"). */
  level: string;
  /** `level_idc`, for the CODECS attribute. */
  levelIdc: number;
};

export type PlanInput = { width: number; height: number; fps: number };

/** Nearest even integer, at least 2. */
export const evenRound = (n: number): number => Math.max(2, 2 * Math.round(n / 2));
/** Largest even integer <= n, at least 2. */
export const evenFloor = (n: number): number => Math.max(2, 2 * Math.floor(n / 2));

function finishSpec(label: string, rung: number, width: number, height: number, fps: number, base: {
  videoKbps: number;
  audioKbps: number;
  crf: number;
}): RenditionSpec {
  const level = pickH264Level(width, height, fps);
  return {
    label,
    rung,
    width,
    height,
    crf: base.crf,
    videoKbps: base.videoKbps,
    maxrateKbps: base.videoKbps,
    bufsizeKbps: base.videoKbps * 2,
    audioKbps: base.audioKbps,
    level: level.label,
    levelIdc: level.idc,
  };
}

export function planRenditions(input: PlanInput): RenditionSpec[] {
  const { width, height, fps } = input;
  const landscapeOrSquare = width >= height;
  const shortSide = Math.min(width, height);
  const rungs = RENDITION_LADDER.filter((rung) => rung <= shortSide);

  if (rungs.length === 0) {
    // Smaller than the smallest rung: one rendition at the source's own (even) size. Never upscaled.
    const w = evenFloor(width);
    const h = evenFloor(height);
    const rung = Math.min(w, h);
    const videoKbps = Math.min(
      RUNG_PROFILES[360]!.videoKbps,
      Math.max(
        SMALL_SOURCE_PROFILE.minVideoKbps,
        Math.round((SMALL_SOURCE_PROFILE.referenceVideoKbps * (w * h)) / SMALL_SOURCE_PROFILE.referencePixels),
      ),
    );
    return [
      finishSpec(`${rung}p`, rung, w, h, fps, {
        videoKbps,
        audioKbps: SMALL_SOURCE_PROFILE.audioKbps,
        crf: SMALL_SOURCE_PROFILE.crf,
      }),
    ];
  }

  return rungs.map((rung) => {
    const profile = RUNG_PROFILES[rung]!;
    // Scale so the SHORT side equals the rung; the long side follows the aspect ratio (rounded to even, never larger
    // than the source's own long side).
    const w = landscapeOrSquare ? Math.min(evenRound((width * rung) / height), evenFloor(width)) : rung;
    const h = landscapeOrSquare ? rung : Math.min(evenRound((height * rung) / width), evenFloor(height));
    return finishSpec(`${rung}p`, rung, w, h, fps, profile);
  });
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

export type ThumbnailSpec = { index: number; atSeconds: number; width: number; height: number };

/** Largest size inside the thumbnail box (1280x720, or 720x1280 for portrait) without upscaling, even numbers. */
export function thumbnailSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, THUMBNAIL_BOX.long / long, THUMBNAIL_BOX.short / short);
  return { width: evenFloor(width * scale), height: evenFloor(height * scale) };
}

/** Three candidate frames spread over the clip (the middle one becomes the default poster). */
export function planThumbnails(durationSeconds: number, width: number, height: number): ThumbnailSpec[] {
  const size = thumbnailSize(width, height);
  const last = Math.max(0, durationSeconds - 0.1);
  return THUMBNAIL_FRACTIONS.map((fraction, i) => ({
    index: i + 1,
    atSeconds: Math.round(Math.min(last, Math.max(0, durationSeconds * fraction)) * 1000) / 1000,
    ...size,
  }));
}

export { DEFAULT_POSTER_INDEX };
