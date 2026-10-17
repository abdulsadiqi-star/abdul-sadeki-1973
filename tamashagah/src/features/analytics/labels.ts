/** Persian copy of the analytics UI (kept out of the shared `lib/i18n/fa.ts`). */
import type { Formatter } from '@/lib/format';
import type { RangeQueryValue } from './schemas';

export const rangeLabel = (f: Formatter, value: RangeQueryValue): string => {
  switch (value) {
    case '7d':
      return `${f.number(7)} روز اخیر`;
    case '30d':
      return `${f.number(30)} روز اخیر`;
    case '90d':
      return `${f.number(90)} روز اخیر`;
    case 'this-month':
      return 'ماه جاری شمسی';
    case 'last-month':
      return 'ماه قبل';
    case 'custom':
      return 'سفارشی';
  }
};

export const metricLabels = {
  views: 'بازدید',
  uniqueViewers: 'بازدیدکننده‌ی یکتا',
  watchMinutes: 'دقایق تماشا',
  avgViewDuration: 'میانگین مدت تماشا',
  likes: 'پسند',
  comments: 'دیدگاه',
  newFollowers: 'دنبال‌کننده‌ی جدید',
  unfollows: 'لغو دنبال',
  netFollowers: 'رشد خالص',
} as const;

/** Traffic-source labels. Hosts are shown as they are (LTR-isolated by the UI). */
export const sourceLabel = (source: string): string | null => {
  switch (source) {
    case 'direct':
      return 'مستقیم (بدون ارجاع)';
    case 'internal':
      return 'صفحه‌های تماشاگاه';
    case 'other':
      return 'سایر منابع';
    default:
      return null;
  }
};

/** Exact wording required by the product brief (U+0654 = the ezafe hamza of «نمونهٔ»). */
export const SEED_NOTICE = 'بخشی از داده‌های این بازه نمونه\u0654 آزمایشی است';
export const SEED_NOTICE_HINT =
  'این بازدیدها و رویدادها برای نمایش و آزمایش تولید شده‌اند (برچسب «نمونه»)، نه رفتار واقعی بینندگان. در بخش درآمدزایی هرگز محاسبه نمی‌شوند.';
