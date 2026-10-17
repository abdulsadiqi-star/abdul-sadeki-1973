/**
 * Persian number / date / size formatting with a user-selectable numeral style.
 *
 *   const f = createFormatter('fa');
 *   f.number(4394265)      // ۴٬۳۹۴٬۲۶۵
 *   f.compact(4100)        // ۴٫۱ هزار
 *   f.views(186)           // ۱۸۶ بازدید
 *   f.duration(5659)       // ۱:۳۴:۱۹
 *   f.date(d)              // ۳۱ شهریور ۱۴۰۵   (Jalali, Asia/Tehran)
 *   f.relative(d)          // ۳ ماه پیش
 *
 * Server Components: `const f = await getFormatter()` (src/lib/format-server.ts)
 * Client Components: `const f = useFormatter()` (src/components/providers/format-provider.tsx)
 */
import { toAsciiDigits } from './persian';
import { TEHRAN_TZ } from './jalali';

export type DigitMode = 'fa' | 'en';

const nf = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions & { locale?: string } = {}): Intl.NumberFormat {
  const { locale = 'fa-IR', ...rest } = options;
  const key = locale + JSON.stringify(rest);
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, rest);
    nf.set(key, f);
  }
  return f;
}

const dtf = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = dtf.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TEHRAN_TZ, ...options });
    dtf.set(key, f);
  }
  return f;
}

const rtf = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });

const BYTE_UNITS = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'] as const;

export type DateStyle = 'long' | 'short' | 'numeric' | 'monthDay' | 'monthYear';

export function createFormatter(digits: DigitMode = 'fa') {
  /** Convert Persian digits/separators to Latin when the user prefers English numerals. */
  const localize = (s: string): string =>
    digits === 'en' ? toAsciiDigits(s).replace(/٬/g, ',').replace(/٫/g, '.').replace(/٪/g, '%') : s;

  const number = (n: number, options?: Intl.NumberFormatOptions) => localize(numberFormat(options).format(n));

  const compact = (n: number) => {
    if (Math.abs(n) < 1_000) return number(n);
    return localize(numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(n));
  };

  const date = (value: Date | string | number, style: DateStyle = 'long') => {
    const d = new Date(value);
    switch (style) {
      case 'numeric':
        return localize(dateFormat({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
      case 'short':
        return localize(dateFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }).format(d));
      case 'monthDay':
        return localize(dateFormat({ month: 'long', day: 'numeric' }).format(d));
      case 'monthYear': {
        // ICU orders this "year month"; Persian reads "شهریور ۱۴۰۵".
        const parts = dateFormat({ month: 'long', year: 'numeric' }).formatToParts(d);
        const month = parts.find((p) => p.type === 'month')?.value ?? '';
        const year = parts.find((p) => p.type === 'year')?.value ?? '';
        return localize(`${month} ${year}`);
      }
      default:
        return localize(dateFormat({ year: 'numeric', month: 'long', day: 'numeric' }).format(d));
    }
  };

  const time = (value: Date | string | number) =>
    localize(dateFormat({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)));

  const dateTime = (value: Date | string | number, style: DateStyle = 'long') =>
    `${date(value, style)}، ${time(value)}`;

  const relative = (value: Date | string | number, now: Date = new Date()) => {
    const diffSec = Math.round((new Date(value).getTime() - now.getTime()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 45) return 'همین الان';
    const sign = diffSec < 0 ? -1 : 1;
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['minute', 60],
      ['hour', 3_600],
      ['day', 86_400],
      ['week', 604_800],
      ['month', 2_592_000], // 30 days
      ['year', 31_536_000], // 365 days
    ];
    let unit: Intl.RelativeTimeFormatUnit = 'minute';
    let size = 60;
    for (const [u, s] of units) {
      if (abs >= s) {
        unit = u;
        size = s;
      }
    }
    // Avoid "4 weeks ago" right before a month boundary and "12 months ago".
    if (unit === 'week' && abs >= 4 * 604_800) {
      unit = 'month';
      size = 2_592_000;
    }
    if (unit === 'month' && abs >= 12 * 2_592_000) {
      unit = 'year';
      size = 31_536_000;
    }
    return localize(rtf.format(sign * Math.max(1, Math.floor(abs / size)), unit));
  };

  /** 5659 → "1:34:19", 201 → "3:21" (Aparat shows the same compact style). */
  const duration = (totalSeconds: number) => {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    const raw = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    return digits === 'en' ? raw : raw.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
  };

  /** 7500 → "۲ ساعت و ۵ دقیقه" */
  const durationLong = (totalSeconds: number) => {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (h) parts.push(`${number(h)} ساعت`);
    if (m) parts.push(`${number(m)} دقیقه`);
    if (!h && (sec || !m)) parts.push(`${number(sec)} ثانیه`);
    return parts.join(' و ');
  };

  const bytes = (n: number) => {
    let value = Math.max(0, n);
    let i = 0;
    while (value >= 1024 && i < BYTE_UNITS.length - 1) {
      value /= 1024;
      i++;
    }
    const fractionDigits = i === 0 || value >= 100 ? 0 : 1;
    return `${number(value, { maximumFractionDigits: fractionDigits })} ${BYTE_UNITS[i]}`;
  };

  const percent = (fraction: number, maximumFractionDigits = 1) =>
    localize(numberFormat({ style: 'percent', maximumFractionDigits }).format(fraction));

  return {
    digits,
    number,
    compact,
    views: (n: number) => `${compact(n)} بازدید`,
    followers: (n: number) => `${compact(n)} دنبال‌کننده`,
    count: (n: number, noun: string) => `${number(n)} ${noun}`,
    percent,
    bytes,
    duration,
    durationLong,
    date,
    time,
    dateTime,
    relative,
    /** Convert any Persian-digit string (e.g. from Intl) to the user's numeral style. */
    localize,
  };
}

export type Formatter = ReturnType<typeof createFormatter>;

/** Default formatter (Persian digits) for places without user context (e.g. e-mails). */
export const fa: Formatter = createFormatter('fa');
