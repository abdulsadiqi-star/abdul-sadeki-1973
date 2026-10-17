/**
 * Pure helpers of the video player (no DOM access, no React) — unit-tested in tests/unit/player-utils.test.ts.
 *
 * The product is RTL: the seek bar fills from the RIGHT edge towards the LEFT, so "forward in time" points
 * LEFT. Everything direction-dependent (pointer → time, arrow keys) lives here and takes the writing direction
 * as an argument, so it can be tested for both directions.
 */
import { toAsciiDigits } from '@/lib/persian';
import { resumePositionFor } from '@/features/watch/view-rules';

export type Dir = 'ltr' | 'rtl';

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SEEK_STEP_SECONDS = 5;
export const SEEK_JUMP_SECONDS = 10;
export const VOLUME_STEP = 0.05;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const finite = (n: unknown, fallback = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

export const clamp01 = (n: number) => clamp(finite(n), 0, 1);

/** Playback position clamped into [0, duration] (unknown / invalid duration → only the lower bound). */
export function clampTime(time: number, duration: number): number {
  const t = Math.max(0, finite(time));
  return Number.isFinite(duration) && duration > 0 ? Math.min(t, duration) : t;
}

// ---------------------------------------------------------------------------------------------------------
// Seek bar geometry
// ---------------------------------------------------------------------------------------------------------

/**
 * Pointer x → fraction of the bar [0..1] along the PLAYBACK direction. In RTL the bar starts at its right edge,
 * so a pointer at the right edge is 0 and one at the left edge is 1.
 */
export function fractionFromPointer(clientX: number, rect: { left: number; width: number }, dir: Dir): number {
  if (!(rect.width > 0)) return 0;
  const offset = dir === 'rtl' ? rect.left + rect.width - clientX : clientX - rect.left;
  return clamp01(offset / rect.width);
}

export const timeFromFraction = (fraction: number, duration: number): number =>
  Number.isFinite(duration) && duration > 0 ? clamp01(fraction) * duration : 0;

export const fractionFromTime = (time: number, duration: number): number =>
  Number.isFinite(duration) && duration > 0 ? clamp01(time / duration) : 0;

/**
 * Seconds to move for an arrow key. The arrows follow the VISUAL direction of the bar:
 * in RTL "←" goes forward and "→" goes backward; in LTR the opposite.
 */
export function seekDeltaForArrow(key: 'ArrowLeft' | 'ArrowRight', dir: Dir, step = SEEK_STEP_SECONDS): number {
  const towardsLeft = key === 'ArrowLeft';
  const forward = dir === 'rtl' ? towardsLeft : !towardsLeft;
  return forward ? step : -step;
}

/** Keyboard handling of the seek slider itself (role="slider"): new time, or null when the key is not handled. */
export function seekBarKeyTarget(key: string, current: number, duration: number, dir: Dir): number | null {
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      return clampTime(current + seekDeltaForArrow(key, dir), max);
    case 'PageUp':
      return clampTime(current + SEEK_JUMP_SECONDS, max);
    case 'PageDown':
      return clampTime(current - SEEK_JUMP_SECONDS, max);
    case 'Home':
      return 0;
    case 'End':
      return max;
    default:
      return null;
  }
}

/** Merge touching/overlapping ranges and drop empty ones (TimeRanges → plain, sorted pairs). */
export function normalizeRanges(ranges: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = ranges
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .map(([s, e]) => [s, e] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1] + 0.05) last[1] = Math.max(last[1], range[1]);
    else out.push(range);
  }
  return out;
}

export function rangesOf(ranges: { length: number; start(i: number): number; end(i: number): number }): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < ranges.length; i++) pairs.push([ranges.start(i), ranges.end(i)]);
  return normalizeRanges(pairs);
}

// ---------------------------------------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------------------------------------

/** Next / previous entry of the speed ladder (stops at both ends; an off-ladder value snaps to its neighbour). */
export function stepSpeed(current: number, direction: 1 | -1): number {
  const list = SPEEDS as readonly number[];
  const exact = list.indexOf(current);
  if (exact >= 0) return list[clamp(exact + direction, 0, list.length - 1)]!;
  const idx = direction > 0 ? list.findIndex((s) => s > current) : list.findLastIndex((s) => s < current);
  return list[idx >= 0 ? idx : direction > 0 ? list.length - 1 : 0]!;
}

// ---------------------------------------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------------------------------------

export type PlayerAction =
  | { type: 'toggle-play' }
  | { type: 'fullscreen' }
  | { type: 'mute' }
  | { type: 'captions' }
  | { type: 'help' }
  | { type: 'escape' }
  | { type: 'volume'; delta: number }
  | { type: 'seek-by'; seconds: number }
  | { type: 'seek-percent'; percent: number }
  | { type: 'seek-start' }
  | { type: 'seek-end' }
  | { type: 'speed'; direction: 1 | -1 };

export type KeyLike = { code: string; key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

/**
 * Map a keyboard event to a player action.
 *
 * Letters are matched by their PHYSICAL key (`event.code`), so the shortcuts keep working on the Persian keyboard
 * layout where `event.key` is a Persian letter. ←/→ follow the visual direction of the seek bar (`dir`); J/L are
 * fixed (J = −10 s, L = +10 s) in both directions. Anything with Ctrl/Alt/Meta is left to the browser.
 */
export function mapShortcut(e: KeyLike, dir: Dir): PlayerAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  // Shifted symbols first: "<" ">" "?" (Persian layout: "؟").
  if (e.shiftKey) {
    if (e.code === 'Comma' || e.key === '<') return { type: 'speed', direction: -1 };
    if (e.code === 'Period' || e.key === '>') return { type: 'speed', direction: 1 };
    if (e.code === 'Slash' || e.key === '?' || e.key === '؟') return { type: 'help' };
    return null;
  }
  if (e.key === '<') return { type: 'speed', direction: -1 };
  if (e.key === '>') return { type: 'speed', direction: 1 };
  if (e.key === '?' || e.key === '؟') return { type: 'help' };

  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (digit) return { type: 'seek-percent', percent: Number(digit[1]) * 10 };

  switch (e.code) {
    case 'Space':
    case 'KeyK':
      return { type: 'toggle-play' };
    case 'KeyF':
      return { type: 'fullscreen' };
    case 'KeyM':
      return { type: 'mute' };
    case 'KeyC':
      return { type: 'captions' };
    case 'KeyJ':
      return { type: 'seek-by', seconds: -SEEK_JUMP_SECONDS };
    case 'KeyL':
      return { type: 'seek-by', seconds: SEEK_JUMP_SECONDS };
    case 'ArrowLeft':
    case 'ArrowRight':
      return { type: 'seek-by', seconds: seekDeltaForArrow(e.code, dir) };
    case 'ArrowUp':
      return { type: 'volume', delta: VOLUME_STEP };
    case 'ArrowDown':
      return { type: 'volume', delta: -VOLUME_STEP };
    case 'Home':
      return { type: 'seek-start' };
    case 'End':
      return { type: 'seek-end' };
    case 'Escape':
      return { type: 'escape' };
    default:
      return null;
  }
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when keystrokes belong to a text field / editor (shortcuts must never fire there). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (EDITABLE_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

/** Space / Enter activate the focused control; the player must not steal them from buttons, links and menus. */
export function isActivationTarget(target: EventTarget | null): boolean {
  const el = target as { closest?: (s: string) => Element | null } | null;
  if (!el?.closest) return false;
  return !!el.closest('button, a[href], summary, select, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"], [role="radio"]');
}

// ---------------------------------------------------------------------------------------------------------
// Errors and retries
// ---------------------------------------------------------------------------------------------------------

/** hls.js network problems are retried this many times (with back-off) before the error overlay is shown. */
export const MAX_NETWORK_RETRIES = 4;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 8_000;

/** Exponential back-off: 1 s, 2 s, 4 s, 8 s, 8 s … (attempt is zero-based). */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, Math.floor(finite(attempt))), RETRY_MAX_MS);
}

/** HTTP statuses that will not get better by retrying (hidden / removed video, expired session, …). */
export const isPermanentHttpStatus = (status: number | undefined | null): boolean =>
  status === 401 || status === 403 || status === 404 || status === 410;

export type PlayerErrorInfo = { message: string; retryable: boolean };

/** `MediaError.code` → Persian message. */
export function mapMediaError(code: number | null | undefined): PlayerErrorInfo {
  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      return { message: 'پخش ویدیو متوقف شد.', retryable: true };
    case 2: // MEDIA_ERR_NETWORK
      return { message: 'ارتباط با سرور قطع شد. اتصال اینترنت خود را بررسی کنید.', retryable: true };
    case 3: // MEDIA_ERR_DECODE
      return { message: 'این ویدیو در مرورگر شما قابل پخش نیست یا فایل آسیب دیده است.', retryable: true };
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return { message: 'فرمت این ویدیو در مرورگر شما پشتیبانی نمی‌شود.', retryable: false };
    default:
      return { message: 'در پخش ویدیو مشکلی پیش آمد.', retryable: true };
  }
}

export const UNAVAILABLE_MESSAGE = 'این ویدیو در حال حاضر در دسترس نیست.';
export const NETWORK_MESSAGE = 'بارگیری ویدیو ممکن نشد. اتصال اینترنت خود را بررسی کنید.';
export const UNSUPPORTED_MESSAGE = 'مرورگر شما از پخش این ویدیو پشتیبانی نمی‌کند. لطفاً مرورگر خود را به‌روزرسانی کنید یا از Chrome، Firefox، Edge یا Safari استفاده کنید.';

// ---------------------------------------------------------------------------------------------------------
// Quality levels
// ---------------------------------------------------------------------------------------------------------

export type RawLevel = { height?: number; bitrate?: number };
export type QualityOption = { height: number; levelIndex: number };

/** One entry per distinct height (highest bitrate wins), tallest first — what the quality menu lists. */
export function qualityOptions(levels: readonly RawLevel[]): QualityOption[] {
  const best = new Map<number, { levelIndex: number; bitrate: number }>();
  levels.forEach((level, levelIndex) => {
    const height = level.height ?? 0;
    if (height <= 0) return;
    const bitrate = level.bitrate ?? 0;
    const current = best.get(height);
    if (!current || bitrate > current.bitrate) best.set(height, { levelIndex, bitrate });
  });
  return [...best.entries()].map(([height, v]) => ({ height, levelIndex: v.levelIndex })).sort((a, b) => b.height - a.height);
}

/** Level to use for a remembered height: the exact one, otherwise the closest available. */
export function levelIndexForHeight(options: readonly QualityOption[], height: number): number {
  if (options.length === 0) return -1;
  let best = options[0]!;
  for (const o of options) if (Math.abs(o.height - height) < Math.abs(best.height - height)) best = o;
  return best.levelIndex;
}

export const qualityLabel = (height: number) => `${height}p`;

// ---------------------------------------------------------------------------------------------------------
// Time parameters (?t=90, ?t=1m30s, ?t=1:30) and share links
// ---------------------------------------------------------------------------------------------------------

/** Parse a start time: plain seconds, "1m30s"/"1h2m3s", or "[h:]m:ss". Persian digits are accepted. Invalid → null. */
export function parseTimeParam(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = toAsciiDigits(raw).trim().toLowerCase();
  if (!value || value.length > 12) return null;

  if (/^\d+(\.\d+)?$/.test(value)) return Math.floor(Number(value));

  const clock = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})$/.exec(value);
  if (clock) {
    const [, h, m, s] = clock;
    if (Number(s) >= 60 || (h !== undefined && Number(m) >= 60)) return null;
    return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
  }

  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (units && (units[1] || units[2] || units[3])) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  return null;
}

/** Whole seconds for `?t=` (never negative). */
export const formatTimeParam = (seconds: number): string => String(Math.max(0, Math.floor(finite(seconds))));

/** Absolute watch URL, optionally starting at `seconds`. */
export function buildShareUrl(origin: string, videoId: string, startAtSeconds?: number | null): string {
  const url = new URL(`/watch/${videoId}`, origin);
  if (startAtSeconds && startAtSeconds >= 1) url.searchParams.set('t', formatTimeParam(startAtSeconds));
  return url.toString();
}

// ---------------------------------------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '‎', '&rlm;': '‏', '&quot;': '"', '&#39;': "'" };

/** WebVTT cue text → plain text (cue tags removed, entities decoded). The result is rendered as TEXT, never as HTML. */
export function stripCueMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .trim();
}

// ---------------------------------------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------------------------------------

export type ResumeSource = { position: number; /** epoch ms */ at: number };

/**
 * Where playback should start: an explicit `?t=` wins; otherwise the NEWER of the server position (signed-in
 * users) and the browser-local one, ignoring positions not worth resuming (first seconds, finished video).
 */
export function chooseStartPosition(input: {
  explicit?: number | null;
  server?: ResumeSource | null;
  local?: ResumeSource | null;
  durationSeconds?: number | null;
}): number {
  const { explicit, server, local, durationSeconds } = input;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) return clampTime(explicit, durationSeconds ?? Number.POSITIVE_INFINITY);
  const candidates = [server, local].filter((c): c is ResumeSource => !!c && Number.isFinite(c.position));
  if (candidates.length === 0) return 0;
  const newest = candidates.reduce((a, b) => (b.at > a.at ? b : a));
  return resumePositionFor(newest.position, durationSeconds);
}

// ---------------------------------------------------------------------------------------------------------
// Subtitle selection
// ---------------------------------------------------------------------------------------------------------

type SubtitleRef = { id: string; lang: string; isDefault?: boolean };

const primaryLanguage = (lang: string) => lang.toLowerCase().split('-')[0] ?? '';

/**
 * Which subtitle track starts selected: the remembered language when it exists ('off' = none), otherwise the
 * track the creator flagged as default, otherwise none (captions are opt-in).
 */
export function pickInitialSubtitle(tracks: readonly SubtitleRef[], remembered: string | undefined): string | null {
  if (remembered === 'off') return null;
  if (remembered) {
    const wanted = primaryLanguage(remembered);
    const match = tracks.find((t) => t.lang.toLowerCase() === remembered.toLowerCase()) ?? tracks.find((t) => primaryLanguage(t.lang) === wanted);
    if (match) return match.id;
  }
  return tracks.find((t) => t.isDefault)?.id ?? null;
}

/** Track to switch ON with the "C" key / captions button: the remembered language, else the default, else the first. */
export function pickCaptionsToEnable(tracks: readonly SubtitleRef[], remembered: string | undefined): string | null {
  if (tracks.length === 0) return null;
  const preferred = remembered && remembered !== 'off' ? pickInitialSubtitle(tracks, remembered) : null;
  return preferred ?? tracks.find((t) => t.isDefault)?.id ?? tracks[0]!.id;
}
