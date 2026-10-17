/**
 * SQL builders for the video search (pure: they only assemble `Prisma.Sql`, nothing touches the database).
 *
 * Injection safety, by construction:
 *  - the ONLY user-derived values are normalized tokens (letters/digits, see `buildTsQuery`) and filter enums/numbers;
 *  - every one of them is a BOUND PARAMETER (`${…}` inside `Prisma.sql`), never interpolated into the statement text;
 *  - the only raw SQL fragment is the shared `PUBLIC_VIDEO_SQL` constant;
 *  - enum comparisons use explicit `::"VideoKind"` casts, counters use `::int` / `::float8`.
 */
import { Prisma } from '@/generated/prisma/client';
import { buildTsQuery, tokenizeQuery } from '@/lib/persian';
import { PUBLIC_VIDEO_SQL } from '@/features/videos/visibility';
import { dateFilterSince, durationFilterRange, type SearchDate, type SearchDuration, type SearchSort, type SearchType } from './schemas';

/** Fewer results than this counts as "sparse": the search then widens (AND → OR → typo-tolerant). */
export const SPARSE_MIN_RESULTS = 5;
/** `pg_trgm.word_similarity_threshold` used for the typo-tolerant tier (default is 0.6). */
export const FUZZY_THRESHOLD = 0.5;
/** Fuzzy matching needs at least this many characters in the normalized query. */
export const FUZZY_MIN_LENGTH = 3;
/** Counting stops here ("بیش از ۱۰۰۰ نتیجه"). */
export const COUNT_CAP = 1000;

/** Documented blend of the relevance score (inside a match tier). Sums to 1. */
export const RANK_WEIGHTS = { ftsRank: 0.55, titleSimilarity: 0.2, popularity: 0.15, recency: 0.1 } as const;
export const RECENCY_HALF_LIFE_DAYS = 90;
/** Popularity saturates at this many views (log scale). */
export const POPULARITY_REFERENCE_VIEWS = 1_000_000;

export type SearchMode = 'and' | 'or' | 'fuzzy';

export type PreparedQuery = {
  tokens: string[];
  /** Tokens joined by single spaces — what trigram matching compares against `searchTitle`. */
  norm: string;
  and: string;
  or: string;
};

/** Normalize a raw query into tokens + the two tsquery strings; `null` when nothing searchable is left. */
export function prepareQuery(q: string): PreparedQuery | null {
  const tokens = tokenizeQuery(q);
  const and = buildTsQuery(q, 'and');
  const or = buildTsQuery(q, 'or');
  if (tokens.length === 0 || !and || !or) return null;
  return { tokens, norm: tokens.join(' '), and, or };
}

export type VideoFilters = {
  type: SearchType;
  date: SearchDate;
  duration: SearchDuration;
  categoryId: string | null;
};

const isVideoLikeType = (type: SearchType): type is 'video' | 'short' => type === 'video' || type === 'short';

/** `WHERE` conditions: public visibility first, then the filters. */
export function filterConditions(filters: VideoFilters, now: Date): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`(${Prisma.raw(PUBLIC_VIDEO_SQL)})`];
  if (isVideoLikeType(filters.type)) {
    conditions.push(Prisma.sql`v."kind" = ${filters.type === 'video' ? 'VIDEO' : 'SHORT'}::"VideoKind"`);
  }
  const since = dateFilterSince(filters.date, now);
  // Plain column (not COALESCE) so the (publishStatus, visibility, processingStatus, publishedAt) index can serve it:
  // a PUBLISHED video always has publishedAt.
  if (since) conditions.push(Prisma.sql`v."publishedAt" >= ${since}`);
  const { min, max } = durationFilterRange(filters.duration);
  if (min !== null) conditions.push(Prisma.sql`v."durationSeconds" >= ${min}::float8`);
  if (max !== null) conditions.push(Prisma.sql`v."durationSeconds" <= ${max}::float8`);
  if (filters.categoryId) conditions.push(Prisma.sql`v."categoryId" = ${filters.categoryId}`);
  return conditions;
}

/** `FROM` clause; with a query it also exposes the two tsqueries as `q.tq_and` / `q.tq_or`. */
export function fromSql(query: PreparedQuery | null): Prisma.Sql {
  if (!query) return Prisma.sql`FROM "Video" v JOIN "Channel" c ON c.id = v."channelId"`;
  return Prisma.sql`FROM "Video" v JOIN "Channel" c ON c.id = v."channelId"
    CROSS JOIN LATERAL (SELECT to_tsquery('simple', ${query.and}) AS tq_and, to_tsquery('simple', ${query.or}) AS tq_or) q`;
}

/** The text-match condition of a search mode. */
export function matchCondition(mode: SearchMode, query: PreparedQuery): Prisma.Sql {
  switch (mode) {
    case 'and':
      return Prisma.sql`v."searchVector" @@ q.tq_and`;
    case 'or':
      return Prisma.sql`v."searchVector" @@ q.tq_or`;
    case 'fuzzy':
      return Prisma.sql`(v."searchVector" @@ q.tq_or OR ${query.norm} <% v."searchTitle")`;
  }
}

/**
 * Relevance: match tier (all words = 2, some words = 1, typo-only = 0) × 10 plus a blend of
 * ts_rank_cd (title weighted above description/tags), word similarity of the title, log-popularity and recency decay.
 */
export function scoreSql(query: PreparedQuery, now: Date): Prisma.Sql {
  return Prisma.sql`((CASE WHEN v."searchVector" @@ q.tq_and THEN 2 WHEN v."searchVector" @@ q.tq_or THEN 1 ELSE 0 END) * 10
    + ${RANK_WEIGHTS.ftsRank}::float8 * ts_rank_cd(v."searchVector", q.tq_or, 32)
    + ${RANK_WEIGHTS.titleSimilarity}::float8 * word_similarity(${query.norm}, v."searchTitle")
    + ${RANK_WEIGHTS.popularity}::float8 * LEAST(1, ln(1 + v."viewCount"::float8) / ln(${POPULARITY_REFERENCE_VIEWS + 1}::float8))
    + ${RANK_WEIGHTS.recency}::float8 * exp(-ln(2) * GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamp - COALESCE(v."publishedAt", v."createdAt"))) / 86400) / ${RECENCY_HALF_LIFE_DAYS}::float8)
  )::float8`;
}

const PUBLISHED = Prisma.sql`v."publishedAt"`;

/** Total, deterministic ordering (id is always the final tie-breaker). */
export function orderSql(sort: SearchSort, hasQuery: boolean): Prisma.Sql {
  if (sort === 'relevance' && hasQuery) return Prisma.sql`score DESC, v.id ASC`;
  if (sort === 'newest') return Prisma.sql`${PUBLISHED} DESC, v.id DESC`;
  return Prisma.sql`v."viewCount" DESC, ${PUBLISHED} DESC, v.id DESC`;
}

export type VideoSearchPlan = {
  query: PreparedQuery | null;
  mode: SearchMode | 'browse';
  filters: VideoFilters;
  sort: SearchSort;
  now: Date;
};

function whereSql(plan: VideoSearchPlan): Prisma.Sql {
  const conditions = filterConditions(plan.filters, plan.now);
  if (plan.query && plan.mode !== 'browse') conditions.push(matchCondition(plan.mode, plan.query));
  return Prisma.join(conditions, ' AND ');
}

/** One page of ids (+ relevance score when there is a query). */
export function pageSql(plan: VideoSearchPlan, limit: number, offset: number): Prisma.Sql {
  const select = plan.query ? Prisma.sql`v.id, ${scoreSql(plan.query, plan.now)} AS score` : Prisma.sql`v.id, 0::float8 AS score`;
  return Prisma.sql`SELECT ${select} ${fromSql(plan.query)} WHERE ${whereSql(plan)}
    ORDER BY ${orderSql(plan.sort, !!plan.query)} LIMIT ${limit}::int OFFSET ${offset}::int`;
}

/** Capped match count (never scans more than COUNT_CAP + 1 rows). */
export function countSql(plan: VideoSearchPlan): Prisma.Sql {
  return Prisma.sql`SELECT count(*)::int AS n FROM (SELECT 1 ${fromSql(plan.query)} WHERE ${whereSql(plan)} LIMIT ${COUNT_CAP + 1}::int) t`;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Escape LIKE wildcards (tokens never contain them after normalization — defence in depth). */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Every token must start a word of the channel's normalized "name + handle". */
export function channelPrefixCondition(query: PreparedQuery): Prisma.Sql {
  const perToken = query.tokens.map((t) => {
    const like = escapeLike(t);
    return Prisma.sql`(c."searchName" LIKE ${`${like}%`} OR c."searchName" LIKE ${`% ${like}%`})`;
  });
  return Prisma.sql`(${Prisma.join(perToken, ' AND ')})`;
}

export function channelFuzzyCondition(query: PreparedQuery): Prisma.Sql {
  return Prisma.sql`(${channelPrefixCondition(query)} OR ${query.norm} <% c."searchName")`;
}

/** Ranking tier of a channel match: name starts with the query (3) > all tokens start a word (2) > typo-only (1). */
export function channelTierSql(query: PreparedQuery): Prisma.Sql {
  return Prisma.sql`(CASE WHEN c."searchName" LIKE ${`${escapeLike(query.norm)}%`} THEN 3 WHEN ${channelPrefixCondition(query)} THEN 2 ELSE 1 END)`;
}
