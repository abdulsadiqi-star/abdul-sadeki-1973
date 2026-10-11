import { z } from 'zod';
import '@/lib/zod-fa';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import type { RangePreset } from '@/lib/analytics/ranges';
import { VIDEO_SORT_KEYS } from './types';

/**
 * Query-string contract of /studio/analytics and /api/studio/analytics/export.
 *
 *   ?range=30d|7d|90d|this-month|last-month|custom   &from=YYYY-MM-DD&to=YYYY-MM-DD (custom only; Tehran days)
 *   &granularity=day|month   &video=<id>   &sort=views&dir=desc&page=2   (table)
 *
 * The CHANNEL is never a parameter: it always comes from the session. Unknown parameters are ignored.
 */
export const RANGE_QUERY_VALUES = ['7d', '30d', '90d', 'this-month', 'last-month', 'custom'] as const;
export type RangeQueryValue = (typeof RANGE_QUERY_VALUES)[number];

export const PRESET_BY_QUERY: Record<RangeQueryValue, RangePreset> = {
  '7d': 'last7',
  '30d': 'last30',
  '90d': 'last90',
  'this-month': 'thisMonth',
  'last-month': 'lastMonth',
  custom: 'custom',
};

export const QUERY_BY_PRESET: Record<RangePreset, RangeQueryValue> = {
  last7: '7d',
  last30: '30d',
  last90: '90d',
  thisMonth: 'this-month',
  lastMonth: 'last-month',
  custom: 'custom',
};

export const analyticsQuerySchema = z.object({
  range: z.enum(RANGE_QUERY_VALUES).default('30d'),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  video: z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.').optional(),
  sort: z.enum(VIDEO_SORT_KEYS).default('views'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;

type RawParams = Record<string, string | string[] | undefined>;

const firstValue = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Forgiving parser for the PAGE: every field falls back to its default on its own, so a hand-edited or stale link
 * still renders. (`video` is the exception: a malformed id is reported through `invalidVideo` so the page can 404.)
 */
export function parseAnalyticsQueryLenient(raw: RawParams): { query: AnalyticsQuery; invalidVideo: boolean } {
  const picked: Record<string, string | undefined> = {};
  for (const key of Object.keys(analyticsQuerySchema.shape)) picked[key] = firstValue(raw[key]);

  const out: Record<string, unknown> = {};
  let invalidVideo = false;
  for (const [key, field] of Object.entries(analyticsQuerySchema.shape)) {
    const parsed = (field as z.ZodType).safeParse(picked[key]);
    if (parsed.success) out[key] = parsed.data;
    else {
      if (key === 'video') invalidVideo = true;
      out[key] = (field as z.ZodType).safeParse(undefined).data;
    }
  }
  return { query: out as AnalyticsQuery, invalidVideo };
}

/** Query string for a link, omitting values that equal the defaults (short, canonical URLs). `extra` is appended as is. */
export function analyticsHref(base: string, query: Partial<AnalyticsQuery>, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  const range = query.range ?? '30d';
  if (range !== '30d') params.set('range', range);
  if (range === 'custom') {
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
  }
  if (query.granularity && query.granularity !== 'day') params.set('granularity', query.granularity);
  if (query.video) params.set('video', query.video);
  if (query.sort && query.sort !== 'views') params.set('sort', query.sort);
  if (query.dir && query.dir !== 'desc') params.set('dir', query.dir);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
