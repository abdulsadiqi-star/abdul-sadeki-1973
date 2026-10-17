import type { Formatter } from '@/lib/format';
import type { SearchDate, SearchDuration, SearchSort, SearchType } from './schemas';

/** Persian labels of the search UI (kept here, not in lib/i18n, to avoid merge conflicts). */
export const searchTypeLabels: Record<SearchType, string> = {
  all: 'همه',
  video: 'ویدیوها',
  short: 'شورتس',
  channel: 'کانال‌ها',
};

export const searchSortLabels: Record<SearchSort, string> = {
  relevance: 'مرتبط‌ترین',
  newest: 'جدیدترین',
  popular: 'پربازدیدترین',
};

export const searchDateLabels: Record<SearchDate, string> = {
  any: 'هر زمان',
  hour: 'ساعت گذشته',
  today: 'امروز',
  week: 'هفته‌ی گذشته',
  month: 'ماه گذشته',
  year: 'سال گذشته',
};

/** Digits follow the viewer's numeral preference, hence a function of the formatter. */
export function searchDurationLabels(f: Formatter): Record<SearchDuration, string> {
  return {
    any: 'هر مدت',
    short: `کمتر از ${f.number(4)} دقیقه`,
    medium: `${f.number(4)} تا ${f.number(20)} دقیقه`,
    long: `بیش از ${f.number(20)} دقیقه`,
  };
}
