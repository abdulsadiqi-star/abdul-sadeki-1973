/**
 * Upload speed / ETA from a sliding window of (time, bytes) samples. Pure — injectable clock for tests.
 */
export class SpeedMeter {
  private samples: { t: number; bytes: number }[] = [];

  constructor(private readonly windowMs = 6_000) {}

  /** Record the TOTAL number of bytes uploaded so far. */
  add(bytes: number, now: number = Date.now()): void {
    const last = this.samples[this.samples.length - 1];
    // A smaller total means the upload restarted (resume from an earlier offset): forget the old window.
    if (last && bytes < last.bytes) this.samples = [];
    this.samples.push({ t: now, bytes });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 2 && this.samples[1]!.t < cutoff) this.samples.shift();
  }

  /** Bytes per second over the window (0 until two samples exist). */
  bytesPerSecond(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const seconds = (last.t - first.t) / 1000;
    return seconds > 0 ? Math.max(0, (last.bytes - first.bytes) / seconds) : 0;
  }

  /** Seconds until `remainingBytes` are sent at the current speed; null when unknown. */
  etaSeconds(remainingBytes: number): number | null {
    const speed = this.bytesPerSecond();
    return speed > 0 ? Math.ceil(remainingBytes / speed) : null;
  }

  reset(): void {
    this.samples = [];
  }
}
