/**
 * Parser for ffmpeg's machine-readable progress (`-progress pipe:1 -nostats`).
 *
 * ffmpeg prints blocks of `key=value` lines and closes each block with `progress=continue` (or `progress=end` as the
 * very last one):
 *
 *   frame=240
 *   fps=118.4
 *   out_time_us=8008000
 *   out_time_ms=8008000        <- (sic) also microseconds, a long-standing ffmpeg quirk
 *   out_time=00:00:08.008000
 *   speed=3.95x
 *   progress=continue
 */
export type ProgressSnapshot = {
  /** How far the output has come, in seconds of media time. */
  outTimeSeconds: number;
  frame: number | null;
  fps: number | null;
  /** Encoding speed relative to real time ("3.95x" → 3.95). */
  speed: number | null;
  totalSize: number | null;
  done: boolean;
};

function parseClock(value: string): number | null {
  const match = /^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]);
  return match[1] === '-' ? -seconds : seconds;
}

const num = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export class FfmpegProgressParser {
  private buffer = '';
  private block: Record<string, string> = {};

  /** Feed raw stdout text; returns every block completed by it (usually 0 or 1). */
  push(chunk: string): ProgressSnapshot[] {
    this.buffer += chunk;
    const out: ProgressSnapshot[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      this.block[key] = value;
      if (key === 'progress') {
        out.push(this.snapshot(value === 'end'));
        this.block = {};
      }
    }
    return out;
  }

  private snapshot(done: boolean): ProgressSnapshot {
    const b = this.block;
    // Prefer the exact microsecond counter; fall back to the clock string, then to the (microsecond) `out_time_ms`.
    const micros = num(b.out_time_us) ?? num(b.out_time_ms);
    let seconds = micros !== null ? micros / 1_000_000 : null;
    if (seconds === null && b.out_time) seconds = parseClock(b.out_time);
    return {
      outTimeSeconds: seconds !== null && seconds > 0 ? seconds : 0,
      frame: num(b.frame),
      fps: num(b.fps),
      speed: b.speed ? num(b.speed.replace(/x$/, '')) : null,
      totalSize: num(b.total_size),
      done,
    };
  }
}

/** 0..1, clamped. Unknown duration → 0 (the caller shows an indeterminate state). */
export function progressFraction(outTimeSeconds: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 0;
  return Math.min(1, Math.max(0, outTimeSeconds / durationSeconds));
}

/** Map a 0..1 fraction of a stage into its window of the whole job (integer percent). */
export function mapToWindow(fraction: number, window: { from: number; to: number }): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(window.from + (window.to - window.from) * clamped);
}
