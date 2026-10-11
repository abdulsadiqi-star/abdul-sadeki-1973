import '@/lib/zod-fa';
import { z } from 'zod';
import { normalizeUserText } from '@/lib/persian';

/**
 * Search state lives entirely in the URL (shareable, back/forward friendly, works without JS):
 *   /search?q=…&type=video|short|channel&sort=relevance|newest|popular&date=hour|today|week|month|year
 *          &duration=short|medium|long&category=<slug>&page=2
 * Parsing is forgiving: an invalid value silently falls back to its default instead of failing the page.
 */

export const SEARCH_TYPES = ['all', 'video', 'short', 'channel'] as const;
export const SEARCH_SORTS = ['relevance', 'newest', 'popular'] as const;
export const SEARCH_DATES = ['any', 'hour', 'today', 'week', 'month', 'year'] as const;
export const SEARCH_DURATIONS = ['any', 'short', 'medium', 'long'] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];
export type SearchSort = (typeof SEARCH_SORTS)[number];
export type SearchDate = (typeof SEARCH_DATES)[number];
export type SearchDuration = (typeof SEARCH_DURATIONS)[number];

export const SEARCH_QUERY_MAX = 120;
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_CHANNEL_PAGE_SIZE = 12;
/** Offset pagination stops here: deep pages cost more and nobody reads them. */
export const SEARCH_MAX_PAGES = 50;

export type SearchParams = {
  /** As typed (trimmed, spaces collapsed, ≤ 120 chars) — shown back to the user. */
  q: string;
  type: SearchType;
  sort: SearchSort;
  date: SearchDate;
  duration: SearchDuration;
  category: string | null;
  page: number;
};

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

const enumOr = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z
    .enum(values)
    .catch(fallback);

const rawSchema = z.object({
  q: z
    .string()
    .transform((v) => normalizeUserText(v).slice(0, SEARCH_QUERY_MAX).trim())
    .catch(''),
  type: enumOr(SEARCH_TYPES, 'all'),
  sort: z.enum(SEARCH_SORTS).optional().catch(undefined),
  date: enumOr(SEARCH_DATES, 'any'),
  duration: enumOr(SEARCH_DURATIONS, 'any'),
  category: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
    .nullable()
    .catch(null),
  page: z.coerce
    .number()
    .catch(1)
    .transform((n) => Math.min(SEARCH_MAX_PAGES, Math.max(1, Math.trunc(Number.isFinite(n) ? n : 1)))),
});

/** The sort used when none is given: relevance for a text query, popularity when just browsing. */
export const defaultSortFor = (hasQuery: boolean): SearchSort => (hasQuery ? 'relevance' : 'popular');

/** Parse Next's `searchParams` (or `Object.fromEntries(url.searchParams)`) into a normalized, fully defaulted state. */
export function parseSearchState(raw: Record<string, string | string[] | undefined>, hasQueryOverride?: boolean): SearchParams {
  const parsed = rawSchema.parse({
    q: first(raw.q) ?? '',
    type: first(raw.type),
    sort: first(raw.sort),
    date: first(raw.date),
    duration: first(raw.duration),
    category: first(raw.category) ?? null,
    page: first(raw.page) ?? 1,
  });
  const hasQuery = hasQueryOverride ?? parsed.q.length > 0;
  // "relevance" only makes sense with a query.
  const sort = parsed.sort && !(parsed.sort === 'relevance' && !hasQuery) ? parsed.sort : defaultSortFor(hasQuery);
  return { ...parsed, sort };
}

/** Is any narrowing filter (not the query, not paging) active? */
export const hasActiveFilters = (p: SearchParams): boolean =>
  p.type !== 'all' || p.date !== 'any' || p.duration !== 'any' || p.category !== null;

/** Build `/search?…` for a state, omitting defaults so URLs stay short and canonical. A change resets paging. */
export function searchHref(base: SearchParams, patch: Partial<SearchParams> = {}): string {
  const next: SearchParams = { ...base, ...patch };
  if (!('page' in patch)) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.type !== 'all') params.set('type', next.type);
  if (next.sort !== defaultSortFor(next.q.length > 0)) params.set('sort', next.sort);
  if (next.date !== 'any') params.set('date', next.date);
  if (next.duration !== 'any') params.set('duration', next.duration);
  if (next.category) params.set('category', next.category);
  if (next.page > 1) params.set('page', String(next.page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

const DAY = 86_400_000;
const DATE_WINDOWS: Record<Exclude<SearchDate, 'any'>, number> = { hour: 3_600_000, today: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

/** Lower bound of `publishedAt` for a date filter (rolling windows), or null for "any time". */
export function dateFilterSince(filter: SearchDate, now: Date): Date | null {
  return filter === 'any' ? null : new Date(now.getTime() - DATE_WINDOWS[filter]);
}

export const DURATION_BOUNDS = { shortBelow: 4 * 60, longAbove: 20 * 60 } as const;

/** [min, max] seconds for a duration filter: short < 4 min, medium 4–20 min, long > 20 min. `null` = unbounded. */
export function durationFilterRange(filter: SearchDuration): { min: number | null; max: number | null } {
  switch (filter) {
    case 'short':
      return { min: null, max: DURATION_BOUNDS.shortBelow - 1 };
    case 'medium':
      return { min: DURATION_BOUNDS.shortBelow, max: DURATION_BOUNDS.longAbove };
    case 'long':
      return { min: DURATION_BOUNDS.longAbove + 1, max: null };
    default:
      return { min: null, max: null };
  }
}
