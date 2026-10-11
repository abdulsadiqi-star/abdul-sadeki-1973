import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { normalizeSearchText } from '@/lib/persian';
import { sortByIds, toVideoCard, videoCardSelect, type VideoCardData } from '@/features/videos/card';
import { PUBLIC_VIDEO_SQL, publicVideoWhere } from '@/features/videos/visibility';
import { highlightSegments, snippetSegments, type Segment } from './highlight';
import {
  SEARCH_CHANNEL_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  type SearchParams,
} from './schemas';
import {
  COUNT_CAP,
  FUZZY_MIN_LENGTH,
  FUZZY_THRESHOLD,
  SPARSE_MIN_RESULTS,
  channelFuzzyCondition,
  channelPrefixCondition,
  channelTierSql,
  countSql,
  fromSql,
  matchCondition,
  pageSql,
  prepareQuery,
  type PreparedQuery,
  type SearchMode,
  type VideoSearchPlan,
} from './sql';

export type VideoResult = {
  card: VideoCardData;
  titleSegments: Segment[];
  /** Highlighted excerpt of the description (empty when there is none). */
  snippet: Segment[];
};

export type ChannelResult = {
  id: string;
  handle: string;
  name: string;
  nameSegments: Segment[];
  avatarUrl: string | null;
  isVerified: boolean;
  followerCount: number;
  videoCount: number;
  description: string;
};

export type VideoSearchResult = {
  mode: SearchMode | 'browse';
  /** Matching videos (capped at COUNT_CAP + 1: `capped` tells the UI to say "more than …"). */
  total: number;
  capped: boolean;
  page: number;
  pageCount: number;
  videos: VideoResult[];
  /** The normalized tokens that were searched (for highlighting and the UI note). */
  tokens: string[];
};

type Tx = Prisma.TransactionClient;

/** Run `fn` inside a transaction where the trigram word-similarity threshold is lowered for typo tolerance. */
async function withFuzzyThreshold<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true)`;
    return fn(tx);
  });
}

const runCount = async (client: Pick<Tx, '$queryRaw'>, plan: VideoSearchPlan): Promise<number> => {
  const rows = await client.$queryRaw<{ n: number }[]>(countSql(plan));
  return rows[0]?.n ?? 0;
};

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

/**
 * Public video search. Mode selection ("sparse" = fewer than SPARSE_MIN_RESULTS hits):
 *   1. all words match (AND, every word is a prefix)            → used when it yields enough results
 *   2. any word matches (OR; results containing all words rank first)
 *   3. typo-tolerant: trigram `word_similarity` against the normalized title (pg_trgm) as a last resort
 * The widest mode that was needed is reported so the UI can say so honestly.
 */
export async function searchVideos(params: SearchParams, opts: { categoryId: string | null; now?: Date }): Promise<VideoSearchResult> {
  const now = opts.now ?? new Date();
  const query = params.q ? prepareQuery(params.q) : null;
  const filters = { type: params.type, date: params.date, duration: params.duration, categoryId: opts.categoryId };
  const base = { query, filters, sort: params.sort, now };
  const offset = (params.page - 1) * SEARCH_PAGE_SIZE;

  let mode: SearchMode | 'browse' = query ? 'and' : 'browse';
  let total: number;

  if (!query) {
    total = await runCount(db, { ...base, mode: 'browse' });
  } else {
    total = await runCount(db, { ...base, mode: 'and' });
    if (total < SPARSE_MIN_RESULTS) {
      if (query.tokens.length > 1) {
        const orTotal = await runCount(db, { ...base, mode: 'or' });
        if (orTotal > total) {
          mode = 'or';
          total = orTotal;
        }
      }
      if (total < SPARSE_MIN_RESULTS && query.norm.length >= FUZZY_MIN_LENGTH) {
        const fuzzyTotal = await withFuzzyThreshold((tx) => runCount(tx, { ...base, mode: 'fuzzy' }));
        if (fuzzyTotal > total) {
          mode = 'fuzzy';
          total = fuzzyTotal;
        }
      }
    }
  }

  const capped = total > COUNT_CAP;
  const shownTotal = Math.min(total, COUNT_CAP);
  const pageCount = Math.max(1, Math.ceil(shownTotal / SEARCH_PAGE_SIZE));
  const empty: VideoSearchResult = { mode, total: shownTotal, capped, page: params.page, pageCount, videos: [], tokens: query?.tokens ?? [] };
  if (total === 0 || offset >= shownTotal) return empty;

  const plan: VideoSearchPlan = { ...base, mode };
  const rows =
    mode === 'fuzzy'
      ? await withFuzzyThreshold((tx) => tx.$queryRaw<{ id: string }[]>(pageSql(plan, SEARCH_PAGE_SIZE, offset)))
      : await db.$queryRaw<{ id: string }[]>(pageSql(plan, SEARCH_PAGE_SIZE, offset));

  const ids = rows.map((r) => r.id);
  // Re-check visibility on hydration: the ids came from raw SQL, the cards come through the shared Prisma filter.
  const hydrated = await db.video.findMany({
    where: { ...publicVideoWhere, id: { in: ids } },
    select: { ...videoCardSelect, description: true },
  });
  const videos = sortByIds(hydrated, ids).map((row): VideoResult => {
    const tokens = query?.tokens ?? [];
    return {
      card: toVideoCard(row),
      titleSegments: highlightSegments(row.title, tokens),
      snippet: row.description ? snippetSegments(row.description, tokens, 170) : [],
    };
  });
  return { ...empty, videos };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

type ChannelRow = {
  id: string;
  handle: string;
  name: string;
  description: string;
  avatarKey: string | null;
  isVerified: boolean;
  followerCount: number;
  videoCount: number;
};

const channelColumns = Prisma.sql`c.id, c.handle, c.name, c.description, c."avatarKey", c."isVerified", c."followerCount",
  (SELECT count(*)::int FROM "Video" v WHERE v."channelId" = c.id AND (${Prisma.raw(PUBLIC_VIDEO_SQL)})) AS "videoCount"`;

function toChannelResult(row: ChannelRow, tokens: string[]): ChannelResult {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    nameSegments: highlightSegments(row.name, tokens),
    avatarUrl: mediaUrl(row.avatarKey),
    isVerified: row.isVerified,
    followerCount: row.followerCount,
    videoCount: row.videoCount,
    description: row.description,
  };
}

async function channelRows(client: Pick<Tx, '$queryRaw'>, query: PreparedQuery, mode: 'prefix' | 'fuzzy', limit: number, offset: number) {
  const condition = mode === 'fuzzy' ? channelFuzzyCondition(query) : channelPrefixCondition(query);
  return client.$queryRaw<ChannelRow[]>`
    SELECT ${channelColumns}
    FROM "Channel" c
    WHERE c."suspendedAt" IS NULL AND ${condition}
    ORDER BY ${channelTierSql(query)} DESC, c."followerCount" DESC, c.id ASC
    LIMIT ${limit}::int OFFSET ${offset}::int`;
}

async function channelCount(client: Pick<Tx, '$queryRaw'>, query: PreparedQuery, mode: 'prefix' | 'fuzzy'): Promise<number> {
  const condition = mode === 'fuzzy' ? channelFuzzyCondition(query) : channelPrefixCondition(query);
  const rows = await client.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (SELECT 1 FROM "Channel" c WHERE c."suspendedAt" IS NULL AND ${condition} LIMIT ${COUNT_CAP + 1}::int) t`;
  return rows[0]?.n ?? 0;
}

/** Channels matching the query by name/handle (word prefixes, typo-tolerant when there are very few hits). */
export async function searchChannels(
  q: string,
  opts: { limit?: number; page?: number } = {},
): Promise<{ channels: ChannelResult[]; total: number; hasMore: boolean }> {
  const query = q ? prepareQuery(q) : null;
  const limit = opts.limit ?? SEARCH_CHANNEL_PAGE_SIZE;
  const offset = ((opts.page ?? 1) - 1) * limit;

  if (!query) {
    // No query: the most followed channels (the "browse" view of the channels tab).
    const rows = await db.$queryRaw<ChannelRow[]>`
      SELECT ${channelColumns} FROM "Channel" c WHERE c."suspendedAt" IS NULL
      ORDER BY c."followerCount" DESC, c.id ASC LIMIT ${limit + 1}::int OFFSET ${offset}::int`;
    const total = await db.channel.count({ where: { suspendedAt: null } });
    return { channels: rows.slice(0, limit).map((r) => toChannelResult(r, [])), total, hasMore: rows.length > limit };
  }

  let mode: 'prefix' | 'fuzzy' = 'prefix';
  let total = await channelCount(db, query, 'prefix');
  if (total < 3 && query.norm.length >= FUZZY_MIN_LENGTH) {
    const fuzzyTotal = await withFuzzyThreshold((tx) => channelCount(tx, query, 'fuzzy'));
    if (fuzzyTotal > total) {
      mode = 'fuzzy';
      total = fuzzyTotal;
    }
  }
  if (total === 0 || offset >= total) return { channels: [], total, hasMore: false };

  const rows =
    mode === 'fuzzy'
      ? await withFuzzyThreshold((tx) => channelRows(tx, query, 'fuzzy', limit + 1, offset))
      : await channelRows(db, query, 'prefix', limit + 1, offset);
  return { channels: rows.slice(0, limit).map((r) => toChannelResult(r, query.tokens)), total, hasMore: rows.length > limit };
}

// ---------------------------------------------------------------------------
// Suggestions (header combobox)
// ---------------------------------------------------------------------------

export type Suggestion =
  | { type: 'video'; id: string; text: string; subtitle: string; href: string }
  | { type: 'channel'; id: string; text: string; subtitle: string; href: string };

export const SUGGEST_MAX_ITEMS = 8;
export const SUGGEST_MAX_VIDEOS = 5;
export const SUGGEST_MAX_CHANNELS = 3;
export const SUGGEST_MIN_LENGTH = 2;

/** Up to 8 suggestions: popular matching video titles (prefix, typo-tolerant when sparse) and matching channels. */
export async function suggest(q: string): Promise<Suggestion[]> {
  const query = prepareQuery(q);
  if (!query || normalizeSearchText(q).length < SUGGEST_MIN_LENGTH) return [];

  const fetchTitles = async (client: Pick<Tx, '$queryRaw'>, mode: 'and' | 'fuzzy') =>
    client.$queryRaw<{ id: string; title: string; channelName: string }[]>`
      SELECT v.id, v.title, c.name AS "channelName"
      ${fromSql(query)}
      WHERE (${Prisma.raw(PUBLIC_VIDEO_SQL)}) AND ${matchCondition(mode, query)}
      ORDER BY v."viewCount" DESC, v.id ASC
      LIMIT ${SUGGEST_MAX_VIDEOS * 2}::int`;

  let titles = await fetchTitles(db, 'and');
  if (titles.length < 3 && query.norm.length >= FUZZY_MIN_LENGTH) {
    titles = await withFuzzyThreshold((tx) => fetchTitles(tx, 'fuzzy'));
  }

  const seen = new Set<string>();
  const videos: Suggestion[] = [];
  for (const t of titles) {
    const key = normalizeSearchText(t.title);
    if (seen.has(key)) continue;
    seen.add(key);
    videos.push({ type: 'video', id: t.id, text: t.title, subtitle: t.channelName, href: `/watch/${t.id}` });
    if (videos.length >= SUGGEST_MAX_VIDEOS) break;
  }

  const { channels } = await searchChannels(q, { limit: SUGGEST_MAX_CHANNELS });
  const channelItems: Suggestion[] = channels.map((c) => ({ type: 'channel', id: c.id, text: c.name, subtitle: `@${c.handle}`, href: `/channel/${c.handle}` }));
  return [...videos.slice(0, SUGGEST_MAX_ITEMS - Math.min(channelItems.length, SUGGEST_MAX_CHANNELS)), ...channelItems].slice(0, SUGGEST_MAX_ITEMS);
}

