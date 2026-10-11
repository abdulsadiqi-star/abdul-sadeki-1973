/**
 * Spam heuristics for new comments — pure functions, no I/O (unit-tested in tests/unit/comment-spam.test.ts).
 *
 * Verdicts
 *   ok       publish according to the channel mode
 *   pending  hold for the creator's review (suspicious, but plausibly legitimate)
 *   spam     store as SPAM (visible to the creator in the "هرز" tab, never public)
 *
 * What is checked (transparent rules, no ML is claimed):
 *   - more than 2 links                                   → pending
 *   - phone numbers / contact ads                         → pending
 *   - flooding with one repeated character                → pending
 *   - the same text again by the same author in 10 min    → spam
 *   - known scam / ad patterns (fa + en)                  → spam
 *   - the same word repeated many times in a row          → spam
 */
import { normalizeSearchText, toAsciiDigits } from '@/lib/persian';
import { SPAM_DUPLICATE_MIN_CHARS, SPAM_MAX_LINKS } from './limits';

export type SpamReason = 'too-many-links' | 'contact-info' | 'flood' | 'duplicate' | 'bad-pattern' | 'repeated-words';
export type SpamVerdict = { verdict: 'ok' | 'pending' | 'spam'; reasons: SpamReason[] };

// --- links -------------------------------------------------------------------------------------------------

const LINK_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s<>"']+/gi,
  /\bwww\.[^\s<>"']+/gi,
  // short-link / messenger hosts that are almost always ads in comments
  /\b(?:t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com|instagram\.com|ig\.me|bit\.ly|tinyurl\.com|goo\.gl|cutt\.ly)\/[^\s<>"']*/gi,
  // bare domains with a common TLD: example.com, shop.ir/...
  /\b[a-z0-9][a-z0-9-]{1,40}\.(?:com|net|org|info|biz|ir|io|me|co|cc|xyz|top|ru|cn|tk|ml|ga|cf|gq|link|click|site|online|shop|store|live|vip|ws|ly|app|dev|pw|club)(?:\/[^\s<>"']*)?(?![a-z0-9-])/gi,
];

/** Number of distinct link occurrences in the text (overlapping patterns are counted once). */
export function countLinks(text: string): number {
  const ranges: Array<[number, number]> = [];
  for (const pattern of LINK_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!ranges.some(([s, e]) => start < e && end > s)) ranges.push([start, end]);
    }
  }
  return ranges.length;
}

// --- patterns ------------------------------------------------------------------------------------------------

/** Iranian mobile numbers (09xx…, +989xx…, 00989xx…) in either digit style. */
const PHONE = /(?:\+|00)?(?:98|0)9\d{9}/;
const LONG_DIGITS = /\d{10,}/;

const BAD_PATTERNS: Array<{ id: string; test: RegExp }> = [
  { id: 'income-ad', test: /(?:کسب\s*درآمد|درآمد\s*(?:روزانه|میلیونی|دلاری|هفتگی)|بدون\s*سرمایه|سرمایه\s*گذاری\s*(?:تضمینی|مطمئن)|ثروتمند\s*شو)/ },
  { id: 'crypto-signal', test: /(?:سیگنال\s*(?:رایگان|vip|وی\s*آی\s*پی)|ربات\s*(?:معامله|ترید)|ارز\s*دیجیتال.*(?:سود|درآمد))/i },
  { id: 'follower-sale', test: /(?:(?:خرید|فروش)\s*(?:فالوور|لایک|ویو|بازدید|سابسکرایبر)|فالوور\s*(?:رایگان|ارزان|واقعی))/ },
  { id: 'prize-scam', test: /(?:شما\s*برنده|برنده\s*(?:جایزه|شدید|شده‌?اید)|جایزه\s*(?:نقدی|ویژه)\s*(?:دریافت|برنده))/ },
  { id: 'join-ad', test: /(?:عضو\s*(?:کانال|گروه)\s*(?:ما\s*)?(?:شو|شوید|بشید)|برای\s*(?:ورود|عضویت)\s*(?:به\s*)?(?:کانال|گروه|لینک))/ },
  { id: 'adult-ad', test: /(?:سکس\s*چت|چت\s*(?:داغ|جنسی)|فیلم\s*(?:سوپر|سکسی)|دوستیابی\s*(?:داغ|رایگان))/ },
  {
    id: 'english-spam',
    test: /(?:\bviagra\b|\bcasino\b|\bforex\s+signals?\b|\bfree\s+(?:followers|likes|subscribers|views)\b|\bbuy\s+(?:followers|likes|subscribers|views)\b|\bearn\s+\$?\d+|\bclick\s+here\b|\bwork\s+from\s+home\b.*\$|\bsex\s*chat\b|\bporn\b|\bxxx\b|\bcrypto\b.*\b(?:profit|double|giveaway)\b)/i,
  },
];

/** Id of the first known-bad pattern that matches, or null. */
export function matchBadPattern(text: string): string | null {
  const ascii = toAsciiDigits(text);
  for (const { id, test } of BAD_PATTERNS) if (test.test(text) || test.test(ascii)) return id;
  return null;
}

/** 25+ times the same character in a row (long laughter like «هههههههه» is normal and does not trigger this). */
const FLOOD = /(\S)\1{24,}/u;
/** The same token 8+ times in a row ("عالی عالی عالی …"). */
const REPEATED_WORDS = /(?:^|\s)(\S+)(?:\s+\1){7,}(?=\s|$)/u;

/** Fold text so trivially edited copies compare equal (digits, ZWNJ, diacritics, punctuation, case). */
export function duplicateKey(text: string): string {
  return normalizeSearchText(text);
}

export function evaluateComment(input: { body: string; recentBodies?: readonly string[] }): SpamVerdict {
  const body = input.body;
  const spam: SpamReason[] = [];
  const pending: SpamReason[] = [];

  if (matchBadPattern(body)) spam.push('bad-pattern');
  if (REPEATED_WORDS.test(body)) spam.push('repeated-words');

  const key = duplicateKey(body);
  if (key.length >= SPAM_DUPLICATE_MIN_CHARS && (input.recentBodies ?? []).some((prev) => duplicateKey(prev) === key)) {
    spam.push('duplicate');
  }

  if (countLinks(body) > SPAM_MAX_LINKS) pending.push('too-many-links');
  const ascii = toAsciiDigits(body).replace(/[\s\-.]/g, '');
  if (PHONE.test(ascii) || LONG_DIGITS.test(ascii)) pending.push('contact-info');
  if (FLOOD.test(body)) pending.push('flood');

  if (spam.length) return { verdict: 'spam', reasons: [...spam, ...pending] };
  if (pending.length) return { verdict: 'pending', reasons: pending };
  return { verdict: 'ok', reasons: [] };
}
