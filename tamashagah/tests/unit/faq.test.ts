import { describe, expect, it } from 'vitest';
import { buildFaq, countFaqItems, filterFaq, type FaqContext } from '@/features/info/faq';
import { createFormatter } from '@/lib/format';

const context = (digits: 'fa' | 'en' = 'fa'): FaqContext => ({
  f: createFormatter(digits),
  maxUploadBytes: 2 * 1024 ** 3,
  dailyQuotaBytes: 5 * 1024 ** 3,
  maxUploadsPerDay: 10,
  shortsMaxSeconds: 60,
  monetization: { minFollowers: 500, minWatchHours: 1000, minPublicVideos: 3, windowDays: 90 },
});

const topics = buildFaq(context());

describe('buildFaq', () => {
  it('has unique ids, non-empty text and only internal links', () => {
    const ids = topics.flatMap((t) => t.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
    expect(countFaqItems(topics)).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    for (const topic of topics) {
      expect(topic.title.length).toBeGreaterThan(2);
      expect(topic.description.length).toBeGreaterThan(5);
      for (const item of topic.items) {
        expect(item.q.endsWith('؟') || item.q.length > 8, item.id).toBe(true);
        expect(item.a.length, item.id).toBeGreaterThan(0);
        for (const paragraph of item.a) expect(paragraph.trim().length, item.id).toBeGreaterThan(10);
        if (item.link) expect(item.link.href.startsWith('/'), item.id).toBe(true);
      }
    }
  });

  it('never claims machine learning for recommendations, other than to deny it', () => {
    const text = JSON.stringify(topics);
    expect(text).not.toMatch(/هوش مصنوعی/);
    for (const topic of topics) {
      for (const item of topic.items) {
        const joined = item.a.join(' ');
        if (/یادگیری ماشین/.test(joined)) expect(joined, item.id).toMatch(/ندارد/);
      }
    }
  });

  it('derives limits from the configuration it is given, in the chosen digit style', () => {
    const upload = topics.find((t) => t.id === 'upload')!.items.find((i) => i.id === 'upload-limits')!;
    expect(upload.a[0]).toContain('۱۰ ویدیو');
    const english = buildFaq(context('en'));
    const uploadEn = english.find((t) => t.id === 'upload')!.items.find((i) => i.id === 'upload-limits')!;
    expect(uploadEn.a[0]).toContain('10');
    const shorts = topics.find((t) => t.id === 'upload')!.items.find((i) => i.id === 'upload-shorts')!;
    expect(shorts.a[0]).toContain('۶۰ ثانیه');
    const money = topics.find((t) => t.id === 'monetization')!.items.find((i) => i.id === 'monetization-requirements')!;
    expect(money.a[0]).toContain('۵۰۰');
    expect(money.a[0]).toContain('۱٬۰۰۰');
    expect(money.a[0]).toContain('۹۰');
  });
});

describe('filterFaq', () => {
  it('returns everything for an empty query and "all"', () => {
    expect(countFaqItems(filterFaq(topics, ''))).toBe(countFaqItems(topics));
    expect(countFaqItems(filterFaq(topics, '   ', 'all'))).toBe(countFaqItems(topics));
  });

  it('matches partial words (prefix) in questions and answers', () => {
    const result = filterFaq(topics, 'گذرواژ');
    const ids = result.flatMap((t) => t.items.map((i) => i.id));
    expect(ids).toContain('account-password');
    expect(ids).toContain('account-register');
  });

  it('requires every word of the query', () => {
    const both = filterFaq(topics, 'ایمیل تأیید');
    const only = filterFaq(topics, 'ایمیل تأیید شورتس');
    expect(countFaqItems(both)).toBeGreaterThan(0);
    expect(countFaqItems(only)).toBe(0);
  });

  it('folds Arabic Yeh/Kaf, ZWNJ, diacritics and digits like the site search', () => {
    // Arabic yeh/kaf instead of Persian ones
    const arabic = filterFaq(topics, 'ويديو پخش نمي‌شود');
    expect(arabic.flatMap((t) => t.items.map((i) => i.id))).toContain('troubleshooting-playback');
    // ZWNJ vs. a plain space vs. none
    for (const query of ['نمی‌شود', 'نمی شود', 'نمیشود']) {
      expect(countFaqItems(filterFaq(topics, `پخش ${query}`)), query).toBeGreaterThan(0);
    }
    // digits: the answer says «۸ نویسه»; searching with Latin digits finds it
    expect(filterFaq(topics, '8 نویسه').flatMap((t) => t.items.map((i) => i.id))).toContain('account-register');
    expect(filterFaq(topics, '۸ نویسه').flatMap((t) => t.items.map((i) => i.id))).toContain('account-register');
    // diacritics are ignored
    expect(countFaqItems(filterFaq(topics, 'گُذرواژه'))).toBeGreaterThan(0);
  });

  it('does not match in the middle of a word', () => {
    expect(countFaqItems(filterFaq(topics, 'ذرواژه'))).toBe(0);
  });

  it('restricts to one topic and drops empty topics', () => {
    const onlyCopyright = filterFaq(topics, '', 'copyright');
    expect(onlyCopyright.map((t) => t.id)).toEqual(['copyright']);
    expect(filterFaq(topics, 'گذرواژه', 'copyright')).toEqual([]);
    const search = filterFaq(topics, 'تیک');
    expect(search.every((t) => t.items.length > 0)).toBe(true);
  });

  it('does not mutate the source topics', () => {
    const before = countFaqItems(topics);
    filterFaq(topics, 'شورتس', 'upload');
    expect(countFaqItems(topics)).toBe(before);
  });
});
