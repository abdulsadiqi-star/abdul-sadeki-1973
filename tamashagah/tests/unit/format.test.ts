import { describe, expect, it } from 'vitest';
import { createFormatter } from '@/lib/format';

const fa = createFormatter('fa');
const en = createFormatter('en');
/** ICU puts a no-break space between a number and its unit; the UI relies on it to avoid ugly wraps. */
const nb = (s: string) => s.replace(/ /g, '\u00A0');

describe('numbers', () => {
  it('formats with Persian digits and separators', () => {
    expect(fa.number(4394265)).toBe('۴٬۳۹۴٬۲۶۵');
    expect(fa.number(186)).toBe('۱۸۶');
  });
  it('formats with English digits on request', () => {
    expect(en.number(4394265)).toBe('4,394,265');
    expect(en.compact(4100)).toBe(nb('4.1 هزار'));
  });
  it('compacts large numbers like the reference dashboard', () => {
    expect(fa.compact(4100)).toBe(nb('۴٫۱ هزار'));
    expect(fa.compact(999)).toBe('۹۹۹');
    expect(fa.compact(1_300_000)).toBe(nb('۱٫۳ میلیون'));
    expect(fa.views(186)).toBe('۱۸۶ بازدید');
    expect(fa.views(9500)).toBe(`${nb('۹٫۵ هزار')} بازدید`);
  });
  it('formats percentages and counts', () => {
    expect(fa.percent(0.256)).toBe('۲۵٫۶٪');
    expect(fa.count(3, 'دیدگاه')).toBe('۳ دیدگاه');
  });
});

describe('durations and sizes', () => {
  it('formats durations like a video player', () => {
    expect(fa.duration(201)).toBe('۰۳:۲۱');
    expect(fa.duration(5659)).toBe('۱:۳۴:۱۹');
    expect(fa.duration(0)).toBe('۰۰:۰۰');
    expect(en.duration(5659)).toBe('1:34:19');
    expect(fa.duration(59.6)).toBe('۰۱:۰۰');
  });
  it('formats long durations in words', () => {
    expect(fa.durationLong(7500)).toBe('۲ ساعت و ۵ دقیقه');
    expect(fa.durationLong(45)).toBe('۴۵ ثانیه');
  });
  it('formats byte sizes', () => {
    expect(fa.bytes(0)).toBe('۰ بایت');
    expect(fa.bytes(1536)).toBe('۱٫۵ کیلوبایت');
    expect(fa.bytes(5 * 1024 ** 3)).toBe('۵ گیگابایت');
  });
});

describe('Jalali dates (Asia/Tehran)', () => {
  const d = new Date('2026-09-22T10:00:00Z'); // 31 Shahrivar 1405
  it('formats long, numeric and partial dates', () => {
    expect(fa.date(d)).toBe('۳۱ شهریور ۱۴۰۵');
    expect(fa.date(d, 'numeric')).toBe('۱۴۰۵/۰۶/۳۱');
    expect(en.date(d, 'numeric')).toBe('1405/06/31');
    expect(fa.date(d, 'monthDay')).toBe('۳۱ شهریور');
    expect(fa.date(d, 'monthYear')).toBe('شهریور ۱۴۰۵');
  });
  it('uses the Tehran wall clock', () => {
    expect(fa.time(d)).toBe('۱۳:۳۰');
    // 21:00 UTC is already the next day in Tehran (00:30)
    expect(fa.date(new Date('2026-09-22T21:00:00Z'))).toBe('۱ مهر ۱۴۰۵');
  });
});

describe('relative time', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;
  const DAY = 86_400_000;
  it('speaks Persian', () => {
    expect(fa.relative(ago(10_000), now)).toBe('همین الان');
    expect(fa.relative(ago(5 * MIN), now)).toBe('۵ دقیقه پیش');
    expect(fa.relative(ago(2 * 60 * MIN), now)).toBe('۲ ساعت پیش');
    expect(fa.relative(ago(1 * DAY), now)).toBe('دیروز');
    expect(fa.relative(ago(3 * DAY), now)).toBe('۳ روز پیش');
    expect(fa.relative(ago(14 * DAY), now)).toBe('۲ هفته پیش');
    expect(fa.relative(ago(90 * DAY), now)).toBe('۳ ماه پیش');
    expect(fa.relative(ago(800 * DAY), now)).toBe('۲ سال پیش');
  });
  it('supports the future (scheduled publishing)', () => {
    expect(fa.relative(new Date(now.getTime() + 3 * 60 * 60_000), now)).toBe('۳ ساعت بعد');
  });
  it('never says "4 weeks" or "12 months"', () => {
    expect(fa.relative(ago(29 * DAY), now)).not.toMatch(/۴ هفته/);
    expect(fa.relative(ago(330 * DAY), now)).toBe('۱۱ ماه پیش');
    expect(fa.relative(ago(364 * DAY), now)).toBe('سال گذشته');
  });
});
