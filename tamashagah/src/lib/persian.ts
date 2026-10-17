/**
 * Persian / Arabic-script text helpers (runtime-agnostic, no dependencies).
 *
 * Two kinds of normalization exist and must not be confused:
 *  - `normalizeUserText`   — light clean-up of user input that is *displayed*
 *                            (keeps ZWNJ, punctuation and case).
 *  - `normalizeSearchText` — aggressive folding used for the search index and
 *                            for search queries (symmetric on both sides).
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ۱۲۳ / ١٢٣ → 123 */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    return String(p >= 0 ? p : ARABIC_INDIC_DIGITS.indexOf(ch));
  });
}

/** 123 → ۱۲۳ */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

// ---------------------------------------------------------------------------
// Character folding
// ---------------------------------------------------------------------------

/** Arabic letter variants → their Persian counterparts (safe for *display*). */
const DISPLAY_FOLD: Record<string, string> = {
  ي: 'ی',
  ى: 'ی',
  ك: 'ک',
  ڪ: 'ک',
};

/** Extra folding used only for search matching. */
const SEARCH_FOLD: Record<string, string> = {
  ...DISPLAY_FOLD,
  ئ: 'ی',
  ؤ: 'و',
  أ: 'ا',
  إ: 'ا',
  ٱ: 'ا',
  آ: 'ا',
  ة: 'ه',
  ۀ: 'ه',
  ە: 'ه',
};

// Harakat (064B–065F), superscript alef (0670), Quranic marks (06D6–06ED), tatweel (0640)
const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;
// Zero-width joiner, LRM/RLM, bidi controls, BOM
const INVISIBLE = /[‍‎‏‪-‮⁦-⁩﻿]/g;
const ZWNJ = /‌/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function foldChars(input: string, map: Record<string, string>): string {
  let out = '';
  for (const ch of input) out += map[ch] ?? ch;
  return out;
}

/**
 * Clean text typed by a user for storage/display:
 * NFC, Arabic Yeh/Kaf → Persian, strips control + bidi-control characters,
 * collapses runs of spaces, trims. Newlines are preserved when `multiline`.
 */
export function normalizeUserText(input: string, opts: { multiline?: boolean } = {}): string {
  let s = input.normalize('NFC').replace(CONTROL, '').replace(INVISIBLE, '');
  s = foldChars(s, DISPLAY_FOLD);
  if (opts.multiline) {
    s = s
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

/**
 * Fold text for full-text search. Output is lowercase, ASCII digits, tokens
 * separated by single spaces, no punctuation, no diacritics. ZWNJ becomes a
 * space so "می‌خواهم" and "می خواهم" index identically.
 */
export function normalizeSearchText(input: string): string {
  let s = input.normalize('NFKC').replace(CONTROL, ' ').replace(INVISIBLE, '').replace(DIACRITICS, '');
  s = s.replace(ZWNJ, ' ');
  s = toAsciiDigits(s);
  s = foldChars(s, SEARCH_FOLD).toLowerCase();
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.trim().replace(/\s+/g, ' ');
}

/** Normalized, de-duplicated query tokens (max `limit`, each ≤ 48 chars). */
export function tokenizeQuery(query: string, limit = 8): string[] {
  const seen = new Set<string>();
  for (const token of normalizeSearchText(query).split(' ')) {
    if (!token) continue;
    seen.add(token.slice(0, 48));
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/**
 * Build a to_tsquery('simple', …) string. Every token is a prefix match so the
 * search feels instant ("فیلم" finds "فیلمنامه"). Tokens only contain letters and
 * digits after normalization, which makes the result injection-safe.
 */
export function buildTsQuery(query: string, mode: 'and' | 'or' = 'and'): string | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(mode === 'and' ? ' & ' : ' | ');
}

/** Fields stored on Video for search (see prisma/schema.prisma). */
export function buildVideoSearchFields(input: {
  title: string;
  description?: string | null;
  tags?: readonly string[];
  channelName?: string | null;
}): { searchTitle: string; searchBody: string } {
  const body = [(input.description ?? '').slice(0, 5_000), (input.tags ?? []).join(' '), input.channelName ?? '']
    .filter(Boolean)
    .join(' ');
  return {
    searchTitle: normalizeSearchText(input.title),
    searchBody: normalizeSearchText(body),
  };
}

export function buildChannelSearchName(name: string, handle: string): string {
  return normalizeSearchText(`${name} ${handle}`);
}

// ---------------------------------------------------------------------------
// Direction & misc helpers
// ---------------------------------------------------------------------------

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏ]/;

/** First strong character decides, like `dir="auto"` (useful for SSR). */
export function detectDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return 'rtl';
}

export function containsPersian(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

/** Truncate by code points (safe for Persian text and emoji). */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + ellipsis;
}

/** Tags: trim, normalize, drop empties/dupes, max 15 tags × 32 chars. */
export function normalizeTags(input: readonly string[] | string): string[] {
  const list = Array.isArray(input) ? input : String(input).split(/[,،\n]/);
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeUserText(String(raw)).replace(/^#+/, '').slice(0, 32).trim();
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= 15) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Channel handles
// ---------------------------------------------------------------------------

export const HANDLE_REGEX = /^[a-z0-9][a-z0-9_.-]{1,28}[a-z0-9]$/;

export const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'moderator', 'api', 'studio', 'watch', 'search', 'login', 'logout', 'register',
  'shorts', 'category', 'channel', 'help', 'about', 'apps', 'terms', 'privacy', 'copyright', 'verification',
  'forgot-password', 'reset-password', 'verify-email', 'library', 'media', 'static', 'public', 'support',
  'root', 'system', 'tamashagah', 'settings', 'upload', 'embed', 'feed', 'trending', 'new', 'null', 'undefined',
]);

export function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle) && !RESERVED_HANDLES.has(handle) && !/[._-]{2}/.test(handle);
}

/** Suggest a handle from an arbitrary string (latin letters/digits only). */
export function suggestHandle(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/\+[^@]*@/, '@') // sara+news@x.com → sara@x.com
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9_.-]+/g, '')
    .replace(/[._-]{2,}/g, '_')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return base.length >= 3 ? base.slice(0, 30) : `channel${base}`.slice(0, 30);
}
