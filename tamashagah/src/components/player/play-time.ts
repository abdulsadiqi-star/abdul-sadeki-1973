/**
 * Counts how long a video has ACTUALLY been playing (pure, unit-tested).
 *
 * It is fed periodic samples of the wall clock and the media clock. Time is only credited when the media clock
 * advanced by about what the wall clock did (× the playback rate): a seek (forward or back), a stall, buffering
 * or a paused element therefore never counts as watching. Credit per sample is capped, so a throttled timer in a
 * background tab cannot suddenly claim a long stretch.
 */
export type PlaySample = {
  /** Monotonic wall clock in milliseconds (performance.now()). */
  wallMs: number;
  /** video.currentTime */
  mediaTime: number;
  /** Not paused, not ended, not seeking, enough data to play. */
  playing: boolean;
  /** video.playbackRate */
  rate: number;
};

const MAX_CREDIT_PER_SAMPLE_SECONDS = 2;
/** Tolerance on "media advanced as expected" (timer jitter, rate changes between samples). */
const ADVANCE_FACTOR = 1.5;
const ADVANCE_SLACK_SECONDS = 0.35;

export class PlayTimeAccumulator {
  private lastWall = 0;
  private lastMedia = 0;
  private primed = false;
  /** Total seconds credited so far. */
  total = 0;

  /** Feed one sample; returns the seconds credited by it. */
  sample(s: PlaySample): number {
    if (!this.primed) {
      this.primed = true;
      this.lastWall = s.wallMs;
      this.lastMedia = s.mediaTime;
      return 0;
    }
    const wallSeconds = (s.wallMs - this.lastWall) / 1000;
    const mediaDelta = s.mediaTime - this.lastMedia;
    this.lastWall = s.wallMs;
    this.lastMedia = s.mediaTime;

    if (!s.playing || !(wallSeconds > 0)) return 0;
    const expected = wallSeconds * (s.rate > 0 ? s.rate : 1);
    if (!(mediaDelta > 0) || mediaDelta > expected * ADVANCE_FACTOR + ADVANCE_SLACK_SECONDS) return 0;

    const credit = Math.min(wallSeconds, MAX_CREDIT_PER_SAMPLE_SECONDS);
    this.total += credit;
    return credit;
  }
}
