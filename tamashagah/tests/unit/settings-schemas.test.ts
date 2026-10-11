import { describe, expect, it } from 'vitest';
import {
  MAX_CHANNEL_LINKS,
  accountSettingsSchema,
  channelSettingsSchema,
  httpsUrlSchema,
  parseStoredLinks,
  revokeSessionSchema,
} from '@/features/settings/schemas';

describe('https URLs for channel links', () => {
  it('accepts https URLs and normalizes them', () => {
    expect(httpsUrlSchema.parse('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(httpsUrlSchema.parse('  https://EXAMPLE.com  ')).toBe('https://example.com/');
    expect(httpsUrlSchema.parse('https://sub.example.co.ir/path#frag')).toBe('https://sub.example.co.ir/path#frag');
  });

  it.each([
    ['plain http', 'http://example.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html;base64,PHNjcmlwdD4='],
    ['ftp', 'ftp://example.com/file'],
    ['credentials in the URL', 'https://user:pass@example.com'],
    ['host without a dot', 'https://localhost'],
    ['not a URL', 'not a url'],
    ['empty', ''],
    ['too long', `https://example.com/${'a'.repeat(300)}`],
  ])('rejects %s', (_label, value) => {
    expect(httpsUrlSchema.safeParse(value).success).toBe(false);
  });
});

describe('channel settings', () => {
  const valid = {
    name: '  آشپزی   با سارا ',
    description: 'سلام\r\n\r\n\r\n\r\nدنیا',
    links: [{ title: ' سایت من ', url: 'https://example.com' }],
    commentsMode: 'APPROVAL_REQUIRED' as const,
    defaultVisibility: 'UNLISTED' as const,
  };

  it('normalizes text and keeps valid fields', () => {
    const out = channelSettingsSchema.parse(valid);
    expect(out.name).toBe('آشپزی با سارا');
    expect(out.description).toBe('سلام\n\nدنیا');
    expect(out.links).toEqual([{ title: 'سایت من', url: 'https://example.com/' }]);
    expect(out.commentsMode).toBe('APPROVAL_REQUIRED');
    expect(out.defaultVisibility).toBe('UNLISTED');
  });

  it('folds Arabic letters in names to Persian ones', () => {
    expect(channelSettingsSchema.parse({ ...valid, name: 'كانال علي' }).name).toBe('کانال علی');
  });

  it('enforces length limits', () => {
    expect(channelSettingsSchema.safeParse({ ...valid, name: 'ا' }).success).toBe(false);
    expect(channelSettingsSchema.safeParse({ ...valid, name: 'ا'.repeat(61) }).success).toBe(false);
    expect(channelSettingsSchema.safeParse({ ...valid, name: 'ا'.repeat(60) }).success).toBe(true);
    expect(channelSettingsSchema.safeParse({ ...valid, description: 'ا'.repeat(1001) }).success).toBe(false);
  });

  it(`allows at most ${MAX_CHANNEL_LINKS} links and removes duplicates`, () => {
    const link = (i: number) => ({ title: `پیوند ${i}`, url: `https://example.com/${i}` });
    expect(channelSettingsSchema.safeParse({ ...valid, links: Array.from({ length: 5 }, (_, i) => link(i)) }).success).toBe(true);
    expect(channelSettingsSchema.safeParse({ ...valid, links: Array.from({ length: 6 }, (_, i) => link(i)) }).success).toBe(false);
    const deduped = channelSettingsSchema.parse({ ...valid, links: [link(1), { title: 'تکراری', url: 'https://example.com/1' }, link(2)] });
    expect(deduped.links.map((l) => l.url)).toEqual(['https://example.com/1', 'https://example.com/2']);
  });

  it('rejects unsafe links and unknown enum values', () => {
    expect(channelSettingsSchema.safeParse({ ...valid, links: [{ title: 'x', url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(channelSettingsSchema.safeParse({ ...valid, links: [{ title: '', url: 'https://example.com' }] }).success).toBe(false);
    expect(channelSettingsSchema.safeParse({ ...valid, commentsMode: 'EVERYONE' }).success).toBe(false);
    expect(channelSettingsSchema.safeParse({ ...valid, defaultVisibility: 'SECRET' }).success).toBe(false);
  });
});

describe('account settings', () => {
  it('validates the display name and preferences', () => {
    expect(accountSettingsSchema.parse({ displayName: '  سارا   احمدی ', digitStyle: 'EN', notifyByEmail: false })).toEqual({
      displayName: 'سارا احمدی',
      digitStyle: 'EN',
      notifyByEmail: false,
    });
    expect(accountSettingsSchema.safeParse({ displayName: 'ا', digitStyle: 'FA', notifyByEmail: true }).success).toBe(false);
    expect(accountSettingsSchema.safeParse({ displayName: 'سارا', digitStyle: 'XX', notifyByEmail: true }).success).toBe(false);
    expect(accountSettingsSchema.safeParse({ displayName: 'سارا', digitStyle: 'FA', notifyByEmail: 'yes' }).success).toBe(false);
  });

  it('refuses unexpected keys when revoking a session', () => {
    expect(revokeSessionSchema.safeParse({ sessionId: 'cmv3vh8cs002ys97d6zgpyrcz' }).success).toBe(true);
    expect(revokeSessionSchema.safeParse({ sessionId: 'cmv3vh8cs002ys97d6zgpyrcz', userId: 'someone-else' }).success).toBe(false);
    expect(revokeSessionSchema.safeParse({ sessionId: 'x' }).success).toBe(false);
  });
});

describe('stored links reader', () => {
  it('ignores malformed entries and caps the list', () => {
    expect(parseStoredLinks(null)).toEqual([]);
    expect(parseStoredLinks('nope')).toEqual([]);
    expect(parseStoredLinks([{ title: 'a', url: 'https://a.com' }, 5, null, { title: 1, url: 'x' }, { title: 'b' }])).toEqual([
      { title: 'a', url: 'https://a.com' },
    ]);
    expect(parseStoredLinks(Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, url: `https://x${i}.com` })))).toHaveLength(MAX_CHANNEL_LINKS);
  });
});
