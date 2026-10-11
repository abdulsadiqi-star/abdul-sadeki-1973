import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { HANDLE_REGEX } from '@/lib/persian';
import { toVideoCard, videoCardSelect, type VideoCardData } from '@/features/videos/card';
import { publicVideoWhere } from '@/features/videos/visibility';
import { parseChannelLinks, type ChannelLink } from './links';

export const CHANNEL_TABS = ['videos', 'shorts', 'playlists', 'about'] as const;
export type ChannelTab = (typeof CHANNEL_TABS)[number];
export const CHANNEL_SORTS = ['new', 'popular'] as const;
export type ChannelSort = (typeof CHANNEL_SORTS)[number];
export const CHANNEL_PAGE_SIZE = 24;

export const channelTabLabels: Record<ChannelTab, string> = {
  videos: 'ویدیوها',
  shorts: 'شورتس',
  playlists: 'لیست‌های پخش',
  about: 'درباره',
};
export const channelSortLabels: Record<ChannelSort, string> = { new: 'جدیدترین', popular: 'پربازدیدترین' };

export const parseChannelTab = (value: string | string[] | undefined): ChannelTab => {
  const v = Array.isArray(value) ? value[0] : value;
  return (CHANNEL_TABS as readonly string[]).includes(v ?? '') ? (v as ChannelTab) : 'videos';
};
export const parseChannelSort = (value: string | string[] | undefined): ChannelSort => {
  const v = Array.isArray(value) ? value[0] : value;
  return (CHANNEL_SORTS as readonly string[]).includes(v ?? '') ? (v as ChannelSort) : 'new';
};

export type ChannelProfile = {
  id: string;
  ownerId: string;
  handle: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  isVerified: boolean;
  followerCount: number;
  links: ChannelLink[];
  /** ISO string. */
  createdAt: string;
  suspended: boolean;
};

/** Channel by (case-insensitive) handle, regardless of state — the caller decides who may see a suspended one. */
export async function getChannelByHandle(handle: string): Promise<ChannelProfile | null> {
  const h = handle.toLowerCase();
  if (!HANDLE_REGEX.test(h)) return null;
  const row = await db.channel.findUnique({
    where: { handle: h },
    select: {
      id: true,
      ownerId: true,
      handle: true,
      name: true,
      description: true,
      avatarKey: true,
      bannerKey: true,
      isVerified: true,
      followerCount: true,
      links: true,
      createdAt: true,
      suspendedAt: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    handle: row.handle,
    name: row.name,
    description: row.description,
    avatarUrl: mediaUrl(row.avatarKey),
    bannerUrl: mediaUrl(row.bannerKey),
    isVerified: row.isVerified,
    followerCount: row.followerCount,
    links: parseChannelLinks(row.links),
    createdAt: row.createdAt.toISOString(),
    suspended: row.suspendedAt !== null,
  };
}

export type ChannelStats = { videoCount: number; shortCount: number; totalViews: number };

/** Public counts only — a private/draft video never inflates a public number. */
export async function getChannelStats(channelId: string): Promise<ChannelStats> {
  const groups = await db.video.groupBy({
    by: ['kind'],
    where: { ...publicVideoWhere, channelId },
    _count: { _all: true },
    _sum: { viewCount: true },
  });
  const stats: ChannelStats = { videoCount: 0, shortCount: 0, totalViews: 0 };
  for (const g of groups) {
    if (g.kind === 'VIDEO') stats.videoCount = g._count._all;
    else stats.shortCount = g._count._all;
    stats.totalViews += g._sum.viewCount ?? 0;
  }
  return stats;
}

export type ChannelVideosPage = { videos: VideoCardData[]; total: number; pageCount: number };

export async function getChannelVideos(
  channelId: string,
  opts: { kind: 'VIDEO' | 'SHORT'; sort: ChannelSort; page: number },
): Promise<ChannelVideosPage> {
  const where = { ...publicVideoWhere, channelId, kind: opts.kind };
  const [total, rows] = await Promise.all([
    db.video.count({ where }),
    db.video.findMany({
      where,
      orderBy:
        opts.sort === 'popular'
          ? [{ viewCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }]
          : [{ publishedAt: 'desc' }, { id: 'desc' }],
      skip: (opts.page - 1) * CHANNEL_PAGE_SIZE,
      take: CHANNEL_PAGE_SIZE,
      select: videoCardSelect,
    }),
  ]);
  return { videos: rows.map(toVideoCard), total, pageCount: Math.max(1, Math.ceil(total / CHANNEL_PAGE_SIZE)) };
}

export type PlaylistSummary = { id: string; title: string; description: string; videoCount: number; coverUrl: string | null };

/**
 * The owner's PUBLIC custom playlists. Counts and covers only consider videos that are publicly listed, so a playlist
 * can never reveal how many private videos it holds; playlists without any listed video are not shown.
 */
export async function getChannelPlaylists(ownerId: string): Promise<PlaylistSummary[]> {
  const playlists = await db.playlist.findMany({
    where: { ownerId, kind: 'CUSTOM', visibility: 'PUBLIC' },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: 48,
    select: {
      id: true,
      title: true,
      description: true,
      // a filtered count and ONE cover row — never the whole item list
      _count: { select: { items: { where: { video: publicVideoWhere } } } },
      items: {
        where: { video: { ...publicVideoWhere, posterKey: { not: null } } },
        orderBy: { position: 'asc' },
        take: 1,
        select: { video: { select: { posterKey: true } } },
      },
    },
  });
  return playlists
    .filter((p) => p._count.items > 0)
    .map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      videoCount: p._count.items,
      coverUrl: mediaUrl(p.items[0]?.video.posterKey),
    }));
}
