/**
 * Pure rules for view counting and watch-time accounting.
 *
 * No I/O and no framework imports on purpose: the server (view/heartbeat endpoints) and the player's client
 * hook share the constants, and every rule is unit-tested (tests/unit/view-rules.test.ts).
 *
 * How a viewing session is accounted:
 *  1. The player accumulates the time it has ACTUALLY been playing. When it passes `viewThresholdSeconds`
 *     (5 s, or 25 % of videos shorter than 20 s) it POSTs /view once.
 *  2. The server records one ViewEvent per viewer + video per 30 minutes (`isWithinDedupeWindow`).
 *  3. Every ~15 s (and on pause / unload) the player POSTs a heartbeat with the seconds played since the last
 *     one. The server never trusts that number: it is clamped by the wall-clock time that really elapsed
 *     (`clampHeartbeatSeconds`), so a client cannot inflate watch time faster than real time.
 */

/** A viewer re-watching a video within this window is not a new view. */
export const VIEW_DEDUPE_WINDOW_MS = 30 * 60_000;
/** Seconds actually played before a view counts (videos shorter than 20 s use 25 % of their length). */
export const VIEW_MIN_PLAYED_SECONDS = 5;
export const VIEW_SHORT_VIDEO_SECONDS = 20;
export const VIEW_SHORT_VIDEO_FRACTION = 0.25;
/** Network/rounding slack when the server re-checks the played threshold. */
export const VIEW_THRESHOLD_TOLERANCE_SECONDS = 0.5;

/** Client cadence; the server only enforces the upper bounds below. */
export const HEARTBEAT_INTERVAL_SECONDS = 15;
/** One heartbeat can add at most this much watch time. */
export const HEARTBEAT_MAX_SECONDS = 20;
/** Beats arriving at least `HEARTBEAT_SLACK_MIN_GAP_SECONDS` apart may add this much on top of the elapsed time (timer jitter). */
export const HEARTBEAT_SLACK_SECONDS = 1;
export const HEARTBEAT_SLACK_MIN_GAP_SECONDS = 5;
/** The first report (the view itself) cannot claim more than this much already-played time. */
export const FIRST_REPORT_MAX_SECONDS = 30;

/** A video counts as watched ("completed") from this fraction of its duration. */
export const COMPLETED_FRACTION = 0.9;
/** Resume restarts from 0 when the saved position is this close to the end. */
export const RESUME_RESTART_FRACTION = 0.95;
export const RESUME_RESTART_TAIL_SECONDS = 8;
/** Positions below this are not worth resuming. */
export const RESUME_MIN_SECONDS = 5;

const round2 = (n: number) => Math.round(n * 100) / 100;
const finiteOr = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
const hasDuration = (d: number | null | undefined): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0;

/** Seconds of real playback required before a view is counted. */
export function viewThresholdSeconds(durationSeconds: number | null | undefined): number {
  if (!hasDuration(durationSeconds) || durationSeconds >= VIEW_SHORT_VIDEO_SECONDS) return VIEW_MIN_PLAYED_SECONDS;
  return Math.max(1, round2(durationSeconds * VIEW_SHORT_VIDEO_FRACTION));
}

/** Client-side check (exact). */
export function hasPlayedEnough(playedSeconds: number, durationSeconds: number | null | undefined): boolean {
  return finiteOr(playedSeconds, 0) >= viewThresholdSeconds(durationSeconds);
}

/** Server-side re-check (with a small tolerance for rounding). */
export function hasReachedViewThreshold(playedSeconds: number, durationSeconds: number | null | undefined): boolean {
  return finiteOr(playedSeconds, 0) >= viewThresholdSeconds(durationSeconds) - VIEW_THRESHOLD_TOLERANCE_SECONDS;
}

/** True when a previous view at `previousAt` still covers a view happening at `now` (strictly inside the window). */
export function isWithinDedupeWindow(previousAt: Date | number, now: Date | number): boolean {
  const elapsed = new Date(now).getTime() - new Date(previousAt).getTime();
  return elapsed >= 0 && elapsed < VIEW_DEDUPE_WINDOW_MS;
}

/** Watch time the view request itself may claim (capped; never more than the video's own length). */
export function clampFirstReportSeconds(playedSeconds: number, durationSeconds: number | null | undefined): number {
  const cap = hasDuration(durationSeconds) ? Math.min(FIRST_REPORT_MAX_SECONDS, durationSeconds) : FIRST_REPORT_MAX_SECONDS;
  return round2(Math.min(Math.max(0, finiteOr(playedSeconds, 0)), cap));
}

/**
 * Watch seconds a heartbeat may add.
 *
 *   added = min(reported, 20, elapsed since the previous beat (+1 s slack when beats are ≥ 5 s apart))
 *
 * Bounding by the time since the PREVIOUS beat (which the server moves forward on every beat) makes the total
 * of any number of heartbeats at most the real wall-clock duration of the session — ten beats in one second
 * share that one second instead of each claiming 20.
 */
export function clampHeartbeatSeconds(input: { reportedSeconds: number; elapsedMs: number }): number {
  const reported = finiteOr(input.reportedSeconds, 0);
  if (reported <= 0) return 0;
  const elapsed = Math.max(0, finiteOr(input.elapsedMs, 0)) / 1000;
  const allowance = elapsed + (elapsed >= HEARTBEAT_SLACK_MIN_GAP_SECONDS ? HEARTBEAT_SLACK_SECONDS : 0);
  return round2(Math.min(reported, HEARTBEAT_MAX_SECONDS, allowance));
}

/** Playback position bounded to the video (unknown duration → only the lower bound). */
export function clampPosition(positionSeconds: number, durationSeconds: number | null | undefined): number {
  const position = Math.max(0, finiteOr(positionSeconds, 0));
  return round2(hasDuration(durationSeconds) ? Math.min(position, durationSeconds) : position);
}

export function isCompleted(positionSeconds: number, durationSeconds: number | null | undefined): boolean {
  return hasDuration(durationSeconds) && positionSeconds / durationSeconds >= COMPLETED_FRACTION;
}

/** Where to resume: saved position, or the start when there is nothing worth resuming / the video was finished. */
export function resumePositionFor(positionSeconds: number | null | undefined, durationSeconds: number | null | undefined): number {
  const position = finiteOr(positionSeconds, 0);
  if (position < RESUME_MIN_SECONDS) return 0;
  if (hasDuration(durationSeconds)) {
    if (position >= durationSeconds * RESUME_RESTART_FRACTION || position >= durationSeconds - RESUME_RESTART_TAIL_SECONDS) return 0;
    return Math.min(position, durationSeconds);
  }
  return position;
}

// ---------------------------------------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------------------------------------

/**
 * Declared crawlers, link-preview fetchers, uptime monitors and scripting HTTP clients. This is deliberately a
 * short "obvious bots" list: it keeps search engines and scripts from inflating counters, but never tries to
 * fingerprint real browsers (headless Chrome used for testing is NOT treated as a bot).
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|facebookexternalhit|facebot|embedly|whatsapp|telegram|twitter|linkedin|discord|slack|pinterest|vkshare|bingpreview|yandex|baidu|duckduck|petalbot|semrush|ahrefs|mj12|dotbot|lighthouse|pingdom|uptime|statuscake|datadog|nagios|zabbix|monitor|curl\/|wget\/|libwww|python-requests|python-urllib|aiohttp|httpx|scrapy|go-http-client|apache-httpclient|java\/\d|node-fetch|undici|axios\//i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 8) return true;
  return BOT_UA.test(userAgent);
}
