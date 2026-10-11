import 'server-only';
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { hlsMasterUrl, mediaUrl } from '@/lib/media-url';
import { getLikedVideoIds } from '@/features/engagement/service';
import { videoCardSelect } from '@/features/videos/card';
import { linkableVideoWhere, publicVideoWhere } from '@/features/videos/visibility';
import type { Prisma } from '@/generated/prisma/client';

export type ShortItem = {
  id: string;
  title: string;
  posterUrl: string | null;
  hlsUrl: string;
  /** Wider than tall → shown letterboxed instead of cropped. */
  landscape: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  channel: { id: string; handle: string; name: string; avatarUrl: string | null; isVerified: boolean };
  liked: boolean;
  following: boolean;
  isOwner: boolean;
};

export type ShortsPage = { items: ShortItem[]; nextCursor: string | null };

export const SHORTS_PAGE_SIZE = 8;

const shortSelect = {
  ...videoCardSelect,
  likeCount: true,
  commentCount: true,
  width: true,
  height: true,
} satisfies Prisma.VideoSelect;

type ShortRow = Prisma.VideoGetPayload<{ select: typeof shortSelect }>;

// --- cursor -----------------------------------------------------------------------------------------------------------
// Keyset pagination over (publishedAt DESC, id DESC): stable while new shorts are published, no duplicates, no offsets.

export function encodeCursor(row: { publishedAt: Date | null; createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([(row.publishedAt ?? row.createdAt).toISOString(), row.id])).toString('base64url');
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const [iso, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown];
    const at = typeof iso === 'string' ? new Date(iso) : null;
    if (!at || Number.isNaN(at.getTime()) || typeof id !== 'string' || !VIDEO_ID_REGEX.test(id)) throw new Error('bad cursor');
    return { at, id };
  } catch {
    throw Errors.badRequest('نشانه‌ی صفحه‌بندی نامعتبر است.');
  }
}

async function toItems(rows: ShortRow[], viewer: { userId: string | null; channelId: string | null }): Promise<ShortItem[]> {
  const ids = rows.map((r) => r.id);
  const channelIds = [...new Set(rows.map((r) => r.channel.id))];
  const [liked, follows] = await Promise.all([
    getLikedVideoIds(viewer.userId, ids),
    viewer.userId && channelIds.length
      ? db.follow.findMany({ where: { userId: viewer.userId, channelId: { in: channelIds } }, select: { channelId: true } })
      : Promise.resolve([]),
  ]);
  const following = new Set(follows.map((f) => f.channelId));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    posterUrl: mediaUrl(row.posterKey),
    hlsUrl: hlsMasterUrl(row.id),
    landscape: !!row.width && !!row.height && row.width > row.height,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    channel: {
      id: row.channel.id,
      handle: row.channel.handle,
      name: row.channel.name,
      avatarUrl: mediaUrl(row.channel.avatarKey),
      isVerified: row.channel.isVerified,
    },
    liked: liked.has(row.id),
    following: following.has(row.channel.id),
    isOwner: viewer.channelId === row.channel.id,
  }));
}

/**
 * One page of the shorts feed: public SHORT videos that really have an HLS playlist (processing or failed items are
 * never listed), newest first. `firstId` (the `?v=` deep link) is pinned to the top of the FIRST page — it may also be
 * an unlisted short, because anyone with the link may watch it — and excluded from the rest.
 */
export async function getShortsPage(opts: {
  userId: string | null;
  channelId: string | null;
  cursor?: string | null;
  firstId?: string | null;
  limit?: number;
}): Promise<ShortsPage> {
  const limit = opts.limit ?? SHORTS_PAGE_SIZE;
  const viewer = { userId: opts.userId, channelId: opts.channelId };
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const pinnedId = !cursor && opts.firstId && VIDEO_ID_REGEX.test(opts.firstId) ? opts.firstId : null;

  const pinned = pinnedId
    ? await db.video.findFirst({
        where: { ...linkableVideoWhere, id: pinnedId, kind: 'SHORT', hlsMasterKey: { not: null } },
        select: shortSelect,
      })
    : null;

  const where: Prisma.VideoWhereInput = {
    ...publicVideoWhere,
    kind: 'SHORT',
    hlsMasterKey: { not: null },
    ...(pinned ? { id: { not: pinned.id } } : {}),
    ...(cursor ? { OR: [{ publishedAt: { lt: cursor.at } }, { publishedAt: cursor.at, id: { lt: cursor.id } }] } : {}),
  };
  const rows = await db.video.findMany({
    where,
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: shortSelect,
  });
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const items = await toItems(pinned ? [pinned, ...pageRows] : pageRows, viewer);
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
