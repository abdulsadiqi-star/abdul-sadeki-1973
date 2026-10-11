/**
 * H.264 level selection (ITU-T H.264 Table A-1) and the RFC 6381 codec strings used in the master playlist.
 * Only the limits that matter for picking a level for our ladder are listed (MaxMBPS, MaxFS).
 */
export type H264Level = {
  /** What we pass to `-level` (e.g. "3.1"). */
  label: string;
  /** `level_idc` (31 for level 3.1). */
  idc: number;
  /** Max macroblocks per second. */
  maxMbps: number;
  /** Max frame size in macroblocks. */
  maxFs: number;
};

const LEVELS: readonly H264Level[] = [
  { label: '3.0', idc: 30, maxMbps: 40_500, maxFs: 1_620 },
  { label: '3.1', idc: 31, maxMbps: 108_000, maxFs: 3_600 },
  { label: '3.2', idc: 32, maxMbps: 216_000, maxFs: 5_120 },
  { label: '4.0', idc: 40, maxMbps: 245_760, maxFs: 8_192 },
  { label: '4.2', idc: 42, maxMbps: 522_240, maxFs: 8_704 },
  { label: '5.0', idc: 50, maxMbps: 589_824, maxFs: 22_080 },
  { label: '5.1', idc: 51, maxMbps: 983_040, maxFs: 36_864 },
  { label: '5.2', idc: 52, maxMbps: 2_073_600, maxFs: 36_864 },
];

/** Smallest level that can hold `width`x`height` at `fps` frames per second. */
export function pickH264Level(width: number, height: number, fps: number): H264Level {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  return (
    LEVELS.find((level) => level.maxFs >= macroblocks && level.maxMbps >= macroblocks * fps) ??
    LEVELS[LEVELS.length - 1]!
  );
}

/** `avc1.PPCCLL` for High profile (profile_idc 100 = 0x64, no constraint flags). */
export function avcCodecString(level: Pick<H264Level, 'idc'>): string {
  return `avc1.6400${level.idc.toString(16).padStart(2, '0')}`;
}

export const AAC_LC_CODEC = 'mp4a.40.2';
