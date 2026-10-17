import 'server-only';
import { db } from '@/lib/db';
import { watchLaterPlaylistId } from '@/lib/ids';
import { mediaUrl } from '@/lib/media-url';
import { toChannelMini, toVideoCard, videoCardSelect, type ChannelMini, type VideoCardData } from '@/features/videos/card';
import { linkableVideoWhere, publicVideoWhere } from '@/features/videos/visibility';
import type { Prisma } from '@/generated/prisma/client';
import type { Visibility } from '@/generated/prisma/enums';

export const LIBRARY_TABS = ['history', 'watch-later', 'liked', 'following', 'playlists'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
export const isLibraryTab = (value: string): value is LibraryTab => (LIBRARY_TABS as readonly string[]).includes(value);

export const LIBRARY_PAGE_SIZE = 24;
export const PLAYLIST_PAGE_SIZE = 50;

const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

/**
 * Everything in the library is the viewer's OWN data (rows are always filtered by `userId`), and videos only appear while
 * they are still watchable by link — a video that was made private or taken down simply disappears from the lists.
 */

export type HistoryItem = { video: VideoCardData; progress: number; completed: boolean; lastWatchedAt: string };

export async function getHistoryPage(userId: string, page: number) {
  const where: Prisma.WatchHistoryWhereInput = { userId, video: linkableVideoWhere };
  const [total, rows] = await Promise.all([
    db.watchHistory.count({ where }),
    db.watchHistory.findMany({
      where,
      orderBy: [{ lastWatchedAt: 'desc' }, { videoId: 'asc' }],
      skip: (page - 1) * LIBRARY_PAGE_SIZE,
      take: LIBRARY_PAGE_SIZE,
      select: { positionSeconds: true, completed: true, lastWatchedAt: true, video: { select: videoCardSelect } },
    }),
  ]);
  const items: HistoryItem[] = rows.map((row) => {
    const duration = row.video.durationSeconds;
    return {
      video: toVideoCard(row.video),
      completed: row.completed,
      progress: row.completed ? 1 : duration && duration > 0 ? Math.min(1, row.positionSeconds / duration) : 0,
      lastWatchedAt: row.lastWatchedAt.toISOString(),
    };
  });
  return { items, total, pageCount: pageCount(total, LIBRARY_PAGE_SIZE) };
}

export async function getWatchLaterPage(userId: string, page: number) {
  const where: Prisma.PlaylistItemWhereInput = { playlistId: watchLaterPlaylistId(userId), video: linkableVideoWhere };
  const [total, rows] = await Promise.all([
    db.playlistItem.count({ where }),
    db.playlistItem.findMany({
      where,
      orderBy: [{ addedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * LIBRARY_PAGE_SIZE,
      take: LIBRARY_PAGE_SIZE,
      select: { video: { select: videoCardSelect } },
    }),
  ]);
  return { videos: rows.map((r) => toVideoCard(r.video)), total, pageCount: pageCount(total, LIBRARY_PAGE_SIZE) };
}

export async function getLikedPage(userId: string, page: number) {
  const where: Prisma.VideoLikeWhereInput = { userId, video: linkableVideoWhere };
  const [total, rows] = await Promise.all([
    db.videoLike.count({ where }),
    db.videoLike.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { videoId: 'asc' }],
      skip: (page - 1) * LIBRARY_PAGE_SIZE,
      take: LIBRARY_PAGE_SIZE,
      select: { video: { select: videoCardSelect } },
    }),
  ]);
  return { videos: rows.map((r) => toVideoCard(r.video)), total, pageCount: pageCount(total, LIBRARY_PAGE_SIZE) };
}

export type FollowedChannel = ChannelMini & { followerCount: number; notify: boolean; videoCount: number; latestAt: string | null };

export async function getFollowingPage(userId: string, page: number) {
  // suspended channels are not listed (their pages are gone for the public)
  const where: Prisma.FollowWhereInput = { userId, channel: { suspendedAt: null } };
  const [total, rows] = await Promise.all([
    db.follow.count({ where }),
    db.follow.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { channelId: 'asc' }],
      skip: (page - 1) * LIBRARY_PAGE_SIZE,
      take: LIBRARY_PAGE_SIZE,
      select: {
        notify: true,
        channel: { select: { id: true, handle: true, name: true, avatarKey: true, isVerified: true, followerCount: true } },
      },
    }),
  ]);
  const ids = rows.map((r) => r.channel.id);
  const stats = ids.length
    ? await db.video.groupBy({
        by: ['channelId'],
        where: { ...publicVideoWhere, channelId: { in: ids }, kind: 'VIDEO' },
        _count: { _all: true },
        _max: { publishedAt: true },
      })
    : [];
  const byChannel = new Map(stats.map((s) => [s.channelId, s]));
  const channels: FollowedChannel[] = rows.map((r) => ({
    ...toChannelMini(r.channel),
    followerCount: r.channel.followerCount,
    notify: r.notify,
    videoCount: byChannel.get(r.channel.id)?._count._all ?? 0,
    latestAt: byChannel.get(r.channel.id)?._max.publishedAt?.toISOString() ?? null,
  }));
  return { channels, total, pageCount: pageCount(total, LIBRARY_PAGE_SIZE) };
}

export type PlaylistListItem = {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  videoCount: number;
  coverUrl: string | null;
};

/** The viewer's custom playlists (counts/covers consider only videos they can still open). */
export async function getMyPlaylists(userId: string, limit = 100): Promise<PlaylistListItem[]> {
  const playlists = await db.playlist.findMany({
    where: { ownerId: userId, kind: 'CUSTOM' },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      title: true,
      description: true,
      visibility: true,
      _count: { select: { items: { where: { video: linkableVideoWhere } } } },
      items: {
        where: { video: { ...linkableVideoWhere, posterKey: { not: null } } },
        orderBy: { position: 'asc' },
        take: 1,
        select: { video: { select: { posterKey: true } } },
      },
    },
  });
  return playlists.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    visibility: p.visibility,
    videoCount: p._count.items,
    coverUrl: mediaUrl(p.items[0]?.video.posterKey),
  }));
}

/** Count of watch-later items the viewer can still open (for the "playlists" overview card). */
export async function getWatchLaterSummary(userId: string): Promise<{ videoCount: number; coverUrl: string | null }> {
  const where: Prisma.PlaylistItemWhereInput = { playlistId: watchLaterPlaylistId(userId), video: linkableVideoWhere };
  const [videoCount, first] = await Promise.all([
    db.playlistItem.count({ where }),
    db.playlistItem.findFirst({ where: { ...where, video: { ...linkableVideoWhere, posterKey: { not: null } } }, orderBy: { addedAt: 'desc' }, select: { video: { select: { posterKey: true } } } }),
  ]);
  return { videoCount, coverUrl: mediaUrl(first?.video.posterKey) };
}

/** Compact data for the `/library` overview: the latest few of everything. */
export async function getLibraryOverview(userId: string) {
  const [history, watchLater, liked, following, playlists, watchLaterSummary] = await Promise.all([
    getHistoryPage(userId, 1).then((r) => ({ items: r.items.slice(0, 6), total: r.total })),
    getWatchLaterPage(userId, 1).then((r) => ({ videos: r.videos.slice(0, 6), total: r.total })),
    getLikedPage(userId, 1).then((r) => ({ videos: r.videos.slice(0, 6), total: r.total })),
    getFollowingPage(userId, 1).then((r) => ({ channels: r.channels.slice(0, 8), total: r.total })),
    getMyPlaylists(userId, 8),
    getWatchLaterSummary(userId),
  ]);
  return { history, watchLater, liked, following, playlists, watchLaterSummary };
}

// ---------------------------------------------------------------------------
// A single playlist
// ---------------------------------------------------------------------------

export type PlaylistViewer = { id: string; channelId: string | null } | null;

export type PlaylistItemView = { position: number; video: VideoCardData };

export type PlaylistView = {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  kind: 'CUSTOM' | 'WATCH_LATER';
  isOwner: boolean;
  owner: { displayName: string; channel: { handle: string; name: string; avatarUrl: string | null; isVerified: boolean } | null };
  updatedAt: string;
  /** Items shown on this page, in playlist order. */
  items: PlaylistItemView[];
  /** Items the viewer can open (all pages). */
  total: number;
  /** Owner only: items that exist but cannot be opened any more (private, removed, taken down…). */
  unavailable: number;
  pageCount: number;
  coverUrl: string | null;
};

/**
 * Load a playlist for a viewer. Returns `null` — which the page turns into a plain 404 — when it does not exist OR the
 * viewer may not see it (private lists are visible to their owner only; public and unlisted ones by link).
 * Non-owners only ever see items that are publicly listed (an unlisted video must not leak through someone's public
 * playlist); owners see everything they can open, including their own private videos.
 */
export async function getPlaylistView(id: string, viewer: PlaylistViewer, page: number): Promise<PlaylistView | null> {
  const playlist = await db.playlist.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      kind: true,
      title: true,
      description: true,
      visibility: true,
      updatedAt: true,
      owner: { select: { displayName: true, channel: { select: { handle: true, name: true, avatarKey: true, isVerified: true, suspendedAt: true } } } },
    },
  });
  if (!playlist) return null;
  const isOwner = viewer?.id === playlist.ownerId;
  if (!isOwner && playlist.visibility === 'PRIVATE') return null;

  // The owner additionally sees their OWN published videos whatever their visibility (a private video in my own list is
  // fine); drafts, videos still processing and taken-down ones are "unavailable" for everyone, owner included.
  const itemVideo: Prisma.VideoWhereInput = isOwner
    ? {
        OR: [
          linkableVideoWhere,
          ...(viewer?.channelId
            ? [{ channelId: viewer.channelId, processingStatus: 'READY' as const, publishStatus: 'PUBLISHED' as const, takedownAt: null }]
            : []),
        ],
      }
    : publicVideoWhere;
  const where: Prisma.PlaylistItemWhereInput = { playlistId: id, video: itemVideo };
  const [total, allItems, rows] = await Promise.all([
    db.playlistItem.count({ where }),
    isOwner ? db.playlistItem.count({ where: { playlistId: id } }) : Promise.resolve(0),
    db.playlistItem.findMany({
      where,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PLAYLIST_PAGE_SIZE,
      take: PLAYLIST_PAGE_SIZE,
      select: { position: true, video: { select: videoCardSelect } },
    }),
  ]);
  const channel = playlist.owner.channel && !playlist.owner.channel.suspendedAt ? playlist.owner.channel : null;
  const items = rows.map((r) => ({ position: r.position, video: toVideoCard(r.video) }));
  return {
    id: playlist.id,
    title: playlist.title,
    description: playlist.description,
    visibility: playlist.visibility,
    kind: playlist.kind,
    isOwner,
    owner: {
      displayName: playlist.owner.displayName,
      channel: channel ? { handle: channel.handle, name: channel.name, avatarUrl: mediaUrl(channel.avatarKey), isVerified: channel.isVerified } : null,
    },
    updatedAt: playlist.updatedAt.toISOString(),
    items,
    total,
    unavailable: isOwner ? Math.max(0, allItems - total) : 0,
    pageCount: pageCount(total, PLAYLIST_PAGE_SIZE),
    coverUrl: items.find((i) => i.video.posterUrl)?.video.posterUrl ?? null,
  };
}
