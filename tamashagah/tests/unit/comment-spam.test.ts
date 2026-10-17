import { describe, expect, it } from 'vitest';
import { countLinks, duplicateKey, evaluateComment, matchBadPattern } from '@/features/comments/spam';

describe('countLinks', () => {
  it('counts explicit URLs, www hosts, bare domains and messenger short links', () => {
    expect(countLinks('سلام')).toBe(0);
    expect(countLinks('ببینید https://example.com/a?b=1')).toBe(1);
    expect(countLinks('http://a.com و https://b.org و www.c.net')).toBe(3);
    expect(countLinks('فروشگاه shop.ir عالیه')).toBe(1);
    expect(countLinks('t.me/somechannel')).toBe(1);
    expect(countLinks('wa.me/98912')).toBe(1);
  });
  it('counts one link once even when several patterns match it', () => {
    expect(countLinks('https://www.example.com/path')).toBe(1);
    expect(countLinks('https://t.me/x')).toBe(1);
  });
  it('does not mistake ordinary text for links', () => {
    expect(countLinks('قیمت ۱۲.۵ هزار تومان بود.')).toBe(0);
    expect(countLinks('نسخه 2.0 خیلی بهتره')).toBe(0);
    expect(countLinks('تمام شد.عالی بود')).toBe(0);
  });
});

describe('matchBadPattern', () => {
  it('recognises common Persian scam and ad phrases', () => {
    expect(matchBadPattern('کسب درآمد روزانه بدون سرمایه، پیام بدید')).toBe('income-ad');
    expect(matchBadPattern('خرید فالوور ارزان')).toBe('follower-sale');
    expect(matchBadPattern('شما برنده جایزه شدید!')).toBe('prize-scam');
    expect(matchBadPattern('سیگنال رایگان ارز دیجیتال')).toBe('crypto-signal');
    expect(matchBadPattern('عضو کانال ما شوید')).toBe('join-ad');
  });
  it('recognises common English spam', () => {
    expect(matchBadPattern('Buy followers cheap')).toBe('english-spam');
    expect(matchBadPattern('CLICK HERE to win')).toBe('english-spam');
  });
  it('leaves normal comments alone', () => {
    expect(matchBadPattern('ممنون از آموزش خوبتون، خیلی کمک کرد')).toBeNull();
    expect(matchBadPattern('درآمد این کانال چقدره؟')).toBeNull();
    expect(matchBadPattern('Great video, thanks for sharing!')).toBeNull();
  });
});

describe('evaluateComment', () => {
  it('accepts an ordinary comment', () => {
    expect(evaluateComment({ body: 'خیلی عالی بود، دستتون درد نکنه' })).toEqual({ verdict: 'ok', reasons: [] });
    expect(evaluateComment({ body: 'ههههههههههه خیلی خنده‌دار بود' }).verdict).toBe('ok'); // long laughter is fine
    expect(evaluateComment({ body: 'عالی بود', recentBodies: ['عالی بود'] }).verdict).toBe('ok'); // too short to judge duplicates
  });

  it('holds comments with more than two links for review', () => {
    const two = evaluateComment({ body: 'https://a.com https://b.com' });
    expect(two.verdict).toBe('ok');
    const three = evaluateComment({ body: 'https://a.com https://b.com https://c.com' });
    expect(three).toEqual({ verdict: 'pending', reasons: ['too-many-links'] });
  });

  it('holds comments that carry phone numbers', () => {
    expect(evaluateComment({ body: 'تماس بگیرید ۰۹۱۲۳۴۵۶۷۸۹' })).toEqual({ verdict: 'pending', reasons: ['contact-info'] });
    expect(evaluateComment({ body: 'call 0912 345 6789' }).verdict).toBe('pending');
    expect(evaluateComment({ body: '+98 912 345 6789' }).verdict).toBe('pending');
  });

  it('holds character floods', () => {
    expect(evaluateComment({ body: `عالی ${'!'.repeat(30)}` })).toEqual({ verdict: 'pending', reasons: ['flood'] });
  });

  it('marks duplicates of the author’s recent comments as spam (digits and ZWNJ folded)', () => {
    const result = evaluateComment({ body: 'ویدیوی عالی بود ۱۲۳', recentBodies: ['ویدیوی  عالی بود 123'] });
    expect(result).toEqual({ verdict: 'spam', reasons: ['duplicate'] });
    expect(evaluateComment({ body: 'ویدیوی عالی بود', recentBodies: ['یک متن کاملاً دیگر'] }).verdict).toBe('ok');
  });

  it('marks known-bad patterns and repeated words as spam', () => {
    expect(evaluateComment({ body: 'کسب درآمد دلاری بدون سرمایه' })).toMatchObject({ verdict: 'spam', reasons: ['bad-pattern'] });
    expect(evaluateComment({ body: 'عالی عالی عالی عالی عالی عالی عالی عالی عالی' })).toMatchObject({ verdict: 'spam', reasons: ['repeated-words'] });
  });

  it('lets spam win over pending when both apply and lists every reason', () => {
    const result = evaluateComment({ body: 'خرید فالوور https://a.com https://b.com https://c.com' });
    expect(result.verdict).toBe('spam');
    expect(result.reasons).toEqual(['bad-pattern', 'too-many-links']);
  });
});

describe('duplicateKey', () => {
  it('folds case, digits, punctuation and ZWNJ', () => {
    expect(duplicateKey('می‌خواهم ۱۲۳!')).toBe(duplicateKey('می خواهم 123'));
    expect(duplicateKey('Hello, World')).toBe(duplicateKey('hello world'));
  });
});
