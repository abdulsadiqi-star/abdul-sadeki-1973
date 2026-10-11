import { describe, expect, it } from 'vitest';
import {
  evaluateVerificationRequirements,
  formatCopyrightNotice,
  parseVideoReference,
  verificationRequirements,
} from '@/features/support/rules';
import {
  copyrightNoticeSchema,
  createTicketSchema,
  replyTicketSchema,
  verificationRequestSchema,
} from '@/features/support/schemas';

const ID = 'aB3dE5gH7jK';

describe('parseVideoReference', () => {
  it('accepts the bare id, watch URLs/paths and shorts deep links', () => {
    for (const input of [
      ID,
      `  ${ID}  `,
      `/watch/${ID}`,
      `/watch/${ID}/`,
      `https://tamashagah.example/watch/${ID}`,
      `https://tamashagah.example/watch/${ID}?list=abc#comments`,
      `http://localhost:3103/watch/${ID}`,
      `/shorts?v=${ID}`,
      `https://tamashagah.example/shorts?v=${ID}`,
    ]) {
      expect(parseVideoReference(input), input).toBe(ID);
    }
  });

  it('rejects anything else', () => {
    for (const input of ['', 'short', `${ID}x`, `/watch/${ID}extra`, '/watch/abc', `/channel/${ID}`, `/shorts?v=short`, `/shorts`, 'javascript:alert(1)', 'https://', '<script>']) {
      expect(parseVideoReference(input), input).toBeNull();
    }
  });
});

describe('evaluateVerificationRequirements', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const base = {
    emailVerified: true,
    hasAvatar: true,
    descriptionLength: verificationRequirements.minDescriptionLength,
    channelCreatedAt: new Date(now.getTime() - verificationRequirements.minChannelAgeDays * 86_400_000),
    publicVideoCount: verificationRequirements.minPublicVideos,
    now,
  };

  it('is satisfied exactly at the thresholds', () => {
    const result = evaluateVerificationRequirements(base);
    expect(result.allMet).toBe(true);
    expect(result.items.map((i) => i.key)).toEqual(['email', 'profile', 'age', 'videos']);
  });

  it('reports each missing requirement with progress', () => {
    const none = evaluateVerificationRequirements({ ...base, emailVerified: false, hasAvatar: false, descriptionLength: 5, channelCreatedAt: new Date(now.getTime() - 10 * 86_400_000), publicVideoCount: 1 });
    expect(none.allMet).toBe(false);
    expect(none.items.every((i) => !i.met)).toBe(true);
    expect(none.items.find((i) => i.key === 'age')).toMatchObject({ current: 10, target: 30 });
    expect(none.items.find((i) => i.key === 'videos')).toMatchObject({ current: 1, target: 3 });
    expect(none.items.find((i) => i.key === 'profile')).toMatchObject({ current: 0, target: 2 });
  });

  it('one failing requirement is enough to block', () => {
    for (const patch of [{ emailVerified: false }, { hasAvatar: false }, { descriptionLength: 19 }, { publicVideoCount: 2 }, { channelCreatedAt: new Date(now.getTime() - 29 * 86_400_000) }]) {
      expect(evaluateVerificationRequirements({ ...base, ...patch }).allMet, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe('formatCopyrightNotice', () => {
  it('lists the video, claimant, work description, statements and signature; omits an empty original URL', () => {
    const text = formatCopyrightNotice({ videoId: ID, claimantName: 'علی رضایی', contactEmail: 'ali@example.test', workDescription: 'فیلم کوتاه من', originalUrl: '', signature: 'علی رضایی' });
    expect(text).toContain(`/watch/${ID}`);
    expect(text).toContain('علی رضایی');
    expect(text).toContain('ali@example.test');
    expect(text).toContain('فیلم کوتاه من');
    expect(text).toContain('امضای الکترونیک');
    expect(text).not.toContain('نشانی اثر اصلی');
    expect(formatCopyrightNotice({ videoId: ID, claimantName: 'الف', contactEmail: 'a@b.test', workDescription: 'x', originalUrl: 'https://example.org/work', signature: 'الف' })).toContain('نشانی اثر اصلی: https://example.org/work');
  });
});

describe('support schemas', () => {
  it('ticket: normalizes text and enforces lengths and category', () => {
    const ok = createTicketSchema.safeParse({ category: 'UPLOAD', subject: '  ويديو   پخش نمي‌شود ', message: 'سلام\n\n\n\nلطفاً راهنمایی کنید، مشکل ادامه دارد.' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.subject).toBe('ویدیو پخش نمی‌شود');
      expect(ok.data.message).toBe('سلام\n\nلطفاً راهنمایی کنید، مشکل ادامه دارد.');
    }
    expect(createTicketSchema.safeParse({ category: 'NOPE', subject: 'موضوع خوب', message: 'یک پیام به اندازه‌ی کافی' }).success).toBe(false);
    expect(createTicketSchema.safeParse({ category: 'OTHER', subject: 'کوتاه', message: 'یک پیام به اندازه‌ی کافی' }).success).toBe(true); // 5 chars ok
    expect(createTicketSchema.safeParse({ category: 'OTHER', subject: 'ابج', message: 'یک پیام به اندازه‌ی کافی' }).success).toBe(false);
    expect(createTicketSchema.safeParse({ category: 'OTHER', subject: 'ا'.repeat(121), message: 'یک پیام به اندازه‌ی کافی' }).success).toBe(false);
    expect(createTicketSchema.safeParse({ category: 'OTHER', subject: 'موضوع خوب', message: 'کوتاه' }).success).toBe(false);
    expect(createTicketSchema.safeParse({ category: 'OTHER', subject: 'موضوع خوب', message: 'ا'.repeat(5001) }).success).toBe(false);
  });

  it('reply: id shape and body length', () => {
    expect(replyTicketSchema.safeParse({ ticketId: 'cmv3vh6tn002ymj7dir8zw1hh', body: 'ممنون' }).success).toBe(true);
    expect(replyTicketSchema.safeParse({ ticketId: 'bad id!', body: 'ممنون' }).success).toBe(false);
    expect(replyTicketSchema.safeParse({ ticketId: 'cmv3vh6tn002ymj7dir8zw1hh', body: ' ' }).success).toBe(false);
  });

  it('verification request: message length, https-only evidence links, max 5', () => {
    const message = 'ا'.repeat(30);
    expect(verificationRequestSchema.safeParse({ message }).success).toBe(true);
    expect(verificationRequestSchema.safeParse({ message: 'کوتاه' }).success).toBe(false);
    expect(verificationRequestSchema.safeParse({ message, evidenceLinks: [{ title: 'وب‌سایت', url: 'https://example.org' }] }).success).toBe(true);
    for (const url of ['http://example.org', 'javascript:alert(1)', 'ftp://x.org', 'not a url', 'data:text/html,hi']) {
      expect(verificationRequestSchema.safeParse({ message, evidenceLinks: [{ title: 'پیوند', url }] }).success, url).toBe(false);
    }
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `پیوند ${i}`, url: `https://example.org/${i}` }));
    expect(verificationRequestSchema.safeParse({ message, evidenceLinks: six }).success).toBe(false);
  });

  it('copyright notice: both statements and a valid e-mail are required', () => {
    const valid = {
      videoRef: 'aB3dE5gH7jK',
      claimantName: 'علی رضایی',
      contactEmail: 'Ali@Example.test',
      workDescription: 'این فیلم اثر من است و بدون اجازه بارگذاری شده است.',
      originalUrl: '',
      goodFaith: true,
      accuracy: true,
      signature: 'علی رضایی',
    };
    const ok = copyrightNoticeSchema.safeParse(valid);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.contactEmail).toBe('ali@example.test');
    expect(copyrightNoticeSchema.safeParse({ ...valid, goodFaith: false }).success).toBe(false);
    expect(copyrightNoticeSchema.safeParse({ ...valid, accuracy: false }).success).toBe(false);
    expect(copyrightNoticeSchema.safeParse({ ...valid, contactEmail: 'not-an-email' }).success).toBe(false);
    expect(copyrightNoticeSchema.safeParse({ ...valid, originalUrl: 'http://insecure.example' }).success).toBe(false);
    expect(copyrightNoticeSchema.safeParse({ ...valid, workDescription: 'کوتاه' }).success).toBe(false);
  });
});
