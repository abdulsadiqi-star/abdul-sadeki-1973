import { describe, expect, it } from 'vitest';
import {
  buildTsQuery,
  buildVideoSearchFields,
  detectDirection,
  isValidHandle,
  normalizeSearchText,
  normalizeTags,
  normalizeUserText,
  suggestHandle,
  toAsciiDigits,
  toPersianDigits,
  tokenizeQuery,
  truncate,
} from '@/lib/persian';

describe('digits', () => {
  it('converts Persian and Arabic-Indic digits to ASCII', () => {
    expect(toAsciiDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(toAsciiDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
    expect(toAsciiDigits('فیلم ۲۰۲۴ و 5')).toBe('فیلم 2024 و 5');
  });
  it('converts ASCII digits to Persian', () => {
    expect(toPersianDigits(1405)).toBe('۱۴۰۵');
    expect(toPersianDigits('12:30')).toBe('۱۲:۳۰');
  });
});

describe('normalizeSearchText', () => {
  it('folds Arabic Yeh and Kaf to Persian', () => {
    expect(normalizeSearchText('علي كريمي')).toBe(normalizeSearchText('علی کریمی'));
  });
  it('treats ZWNJ as a word separator', () => {
    expect(normalizeSearchText('می‌خواهم')).toBe('می خواهم');
    expect(normalizeSearchText('می‌خواهم')).toBe(normalizeSearchText('می خواهم'));
  });
  it('strips diacritics and tatweel', () => {
    expect(normalizeSearchText('مَحَمَّد')).toBe(normalizeSearchText('محمد'));
    expect(normalizeSearchText('سلامـــــت')).toBe('سلامت');
  });
  it('unifies hamza/alef variants and ta marbuta / heh yeh', () => {
    expect(normalizeSearchText('أحمد إبراهيم')).toBe(normalizeSearchText('احمد ابراهیم'));
    expect(normalizeSearchText('آب')).toBe('اب');
    expect(normalizeSearchText('خانۀ')).toBe('خانه');
  });
  it('normalizes digits, case and punctuation', () => {
    expect(normalizeSearchText('  Episode ۱۲،  FINAL!! ')).toBe('episode 12 final');
    expect(normalizeSearchText('#آموزش_پایتون')).toBe('اموزش پایتون');
  });
  it('is idempotent', () => {
    const once = normalizeSearchText('فيلم «سينمايي» ۲۰۲۴ — نسخه‌ی كامل');
    expect(normalizeSearchText(once)).toBe(once);
  });
  it('handles empty input', () => {
    expect(normalizeSearchText('')).toBe('');
    expect(normalizeSearchText('   ')).toBe('');
  });
});

describe('queries', () => {
  it('tokenizes, de-duplicates and limits', () => {
    expect(tokenizeQuery('فیلم فیلم ایرانی')).toEqual(['فیلم', 'ایرانی']);
    expect(tokenizeQuery('a b c d e f g h i j k', 3)).toEqual(['a', 'b', 'c']);
  });
  it('builds a safe prefix tsquery', () => {
    expect(buildTsQuery('فیلم ایرانی')).toBe('فیلم:* & ایرانی:*');
    expect(buildTsQuery('فیلم ایرانی', 'or')).toBe('فیلم:* | ایرانی:*');
    expect(buildTsQuery("a' | b:* & (c) \\ !d")).toBe('a:* & b:* & c:* & d:*');
    expect(buildTsQuery('   ')).toBeNull();
    expect(buildTsQuery('!!! ???')).toBeNull();
  });
  it('builds weighted search fields for videos', () => {
    const fields = buildVideoSearchFields({
      title: 'آموزش پایتون',
      description: 'یادگیری ۱۰۰٪ عملی',
      tags: ['برنامه‌نویسی', 'Python'],
      channelName: 'آرمان تک',
    });
    expect(fields.searchTitle).toBe('اموزش پایتون');
    expect(fields.searchBody).toContain('100');
    expect(fields.searchBody).toContain('python');
    expect(fields.searchBody).toContain('ارمان تک');
  });
});

describe('normalizeUserText', () => {
  it('fixes Arabic letters but keeps ZWNJ and punctuation', () => {
    expect(normalizeUserText('كتاب  ي ‌می‌خوانم؟')).toBe('کتاب ی ‌می‌خوانم؟');
  });
  it('removes bidi control characters and collapses whitespace', () => {
    expect(normalizeUserText('  سلام‮  دنیا‏ ')).toBe('سلام دنیا');
  });
  it('preserves paragraphs in multiline mode', () => {
    expect(normalizeUserText('الف\r\n\r\n\r\n\r\nب', { multiline: true })).toBe('الف\n\nب');
  });
});

describe('misc', () => {
  it('detects direction by first strong character', () => {
    expect(detectDirection('سلام world')).toBe('rtl');
    expect(detectDirection('Hello سلام')).toBe('ltr');
    expect(detectDirection('123 ... سلام')).toBe('rtl');
  });
  it('truncates by code point', () => {
    expect(truncate('سلام دنیا', 20)).toBe('سلام دنیا');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(Array.from(truncate('😀😀😀😀😀😀', 4))).toHaveLength(4);
  });
  it('normalizes tags', () => {
    expect(normalizeTags('#آموزش, python،  Python ,, ')).toEqual(['آموزش', 'python']);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(15);
  });
  it('validates channel handles', () => {
    expect(isValidHandle('sara-cooks')).toBe(true);
    expect(isValidHandle('a_b.c-d')).toBe(true);
    expect(isValidHandle('ab')).toBe(false);
    expect(isValidHandle('-abc')).toBe(false);
    expect(isValidHandle('abc-')).toBe(false);
    expect(isValidHandle('a--b')).toBe(false);
    expect(isValidHandle('Admin')).toBe(false);
    expect(isValidHandle('admin')).toBe(false);
    expect(isValidHandle('studio')).toBe(false);
    expect(isValidHandle('سارا')).toBe(false);
  });
  it('suggests a handle from an e-mail', () => {
    expect(suggestHandle('Sara.Ahmadi+x@example.com')).toBe('sara.ahmadi');
    expect(suggestHandle('ab@example.com').length).toBeGreaterThanOrEqual(3);
  });
});
