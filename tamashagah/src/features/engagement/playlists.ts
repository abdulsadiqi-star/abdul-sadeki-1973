/**
 * Custom playlists (create / rename / delete, add / remove a video). "Watch later" is a system playlist with its
 * own toggle (see service.ts) and can neither be renamed nor deleted here. Playlist PAGES belong to the
 * discovery feature; this module is the write side plus the data the watch page's "save to playlist" menu needs.
 *
 * Runtime-agnostic (no next/* imports). Every function re-derives ownership from the database.
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { normalizeUserText } from '@/lib/persian';
import { loadViewableVideo } from '@/features/watch/access';
import type { Visibility } from '@/generated/prisma/enums';
import type { Viewer } from './service';
import { hasVisibleText } from './text';

export const PLAYLIST_TITLE_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 500;
export const MAX_PLAYLISTS_PER_USER = 100;
export const MAX_ITEMS_PER_PLAYLIST = 500;

export type PlaylistSummary = {
  id: string;
  title: string;
  visibility: Visibility;
  itemCount: number;
};

export type PlaylistMenuItem = PlaylistSummary & { contains: boolean };

const actorOf = (v: Viewer) => ({ id: v.id, role: v.role, channelId: v.channelId, emailVerified: v.emailVerified });

function cleanTitle(raw: string): string {
  const title = normalizeUserText(raw);
  if (!hasVisibleText(title)) throw Errors.validation({ title: ['نام فهرست پخش را وارد کنید.'] });
  if (Array.from(title).length > PLAYLIST_TITLE_MAX) {
    throw Errors.validation({ title: [`نام فهرست پخش نباید بیش از ${PLAYLIST_TITLE_MAX} نویسه باشد.`] });
  }
  return title;
}

/** Owned CUSTOM playlist or NOT_FOUND (system lists and other people's lists look the same as missing ones). */
async function loadOwnedCustom(userId: string, playlistId: string) {
  const playlist = await db.playlist.findFirst({
    where: { id: playlistId, ownerId: userId },
    select: { id: true, kind: true, title: true, visibility: true },
  });
  if (!playlist) throw Errors.notFound('فهرست پخش پیدا نشد.');
  if (playlist.kind !== 'CUSTOM') throw Errors.badRequest('این فهرست سیستمی است و قابل تغییر نیست.');
  return playlist;
}

/** The user's custom playlists, each flagged with whether it already contains `videoId`. */
export async function listPlaylistsForVideo(userId: string, videoId: string): Promise<PlaylistMenuItem[]> {
  const rows = await db.playlist.findMany({
    where: { ownerId: userId, kind: 'CUSTOM' },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: MAX_PLAYLISTS_PER_USER,
    select: {
      id: true,
      title: true,
      visibility: true,
      _count: { select: { items: true } },
      items: { where: { videoId }, select: { id: true }, take: 1 },
    },
  });
  return rows.map((p) => ({ id: p.id, title: p.title, visibility: p.visibility, itemCount: p._count.items, contains: p.items.length > 0 }));
}

export async function createPlaylist(
  viewer: Viewer,
  input: { title: string; visibility?: Visibility; videoId?: string | null },
): Promise<PlaylistMenuItem> {
  const title = cleanTitle(input.title);
  const video = input.videoId ? await loadViewableVideo(input.videoId, actorOf(viewer)) : null;

  return db.$transaction(async (tx) => {
    const count = await tx.playlist.count({ where: { ownerId: viewer.id, kind: 'CUSTOM' } });
    if (count >= MAX_PLAYLISTS_PER_USER) {
      throw Errors.quotaExceeded(`حداکثر ${MAX_PLAYLISTS_PER_USER} فهرست پخش می‌توانید بسازید.`);
    }
    const playlist = await tx.playlist.create({
      data: {
        ownerId: viewer.id,
        kind: 'CUSTOM',
        title,
        visibility: input.visibility ?? 'PRIVATE',
        ...(video ? { items: { create: { videoId: video.id, position: 0 } } } : {}),
      },
      select: { id: true, title: true, visibility: true },
    });
    return { id: playlist.id, title: playlist.title, visibility: playlist.visibility, itemCount: video ? 1 : 0, contains: !!video };
  });
}

export async function renamePlaylist(
  userId: string,
  playlistId: string,
  input: { title?: string; visibility?: Visibility },
): Promise<{ id: string; title: string; visibility: Visibility }> {
  await loadOwnedCustom(userId, playlistId);
  const data: { title?: string; visibility?: Visibility } = {};
  if (input.title !== undefined) data.title = cleanTitle(input.title);
  if (input.visibility) data.visibility = input.visibility;
  return db.playlist.update({ where: { id: playlistId }, data, select: { id: true, title: true, visibility: true } });
}

export async function deletePlaylist(userId: string, playlistId: string): Promise<void> {
  await loadOwnedCustom(userId, playlistId);
  await db.playlist.delete({ where: { id: playlistId } }); // items cascade
}

/** Add (idempotent) a video the viewer may see. Returns the new item count. */
export async function addVideoToPlaylist(viewer: Viewer, playlistId: string, videoId: string): Promise<{ itemCount: number }> {
  await loadOwnedCustom(viewer.id, playlistId);
  const video = await loadViewableVideo(videoId, actorOf(viewer));
  return db.$transaction(async (tx) => {
    const count = await tx.playlistItem.count({ where: { playlistId } });
    const exists = await tx.playlistItem.findUnique({ where: { playlistId_videoId: { playlistId, videoId: video.id } }, select: { id: true } });
    if (!exists) {
      if (count >= MAX_ITEMS_PER_PLAYLIST) throw Errors.quotaExceeded(`هر فهرست پخش حداکثر ${MAX_ITEMS_PER_PLAYLIST} ویدیو دارد.`);
      const last = await tx.playlistItem.aggregate({ where: { playlistId }, _max: { position: true } });
      await tx.playlistItem.createMany({
        data: [{ playlistId, videoId: video.id, position: (last._max.position ?? -1) + 1 }],
        skipDuplicates: true,
      });
      await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
    }
    return { itemCount: await tx.playlistItem.count({ where: { playlistId } }) };
  });
}

/** Remove (idempotent). The video does not need to be viewable any more: people can always clean up their lists. */
export async function removeVideoFromPlaylist(userId: string, playlistId: string, videoId: string): Promise<{ itemCount: number }> {
  await loadOwnedCustom(userId, playlistId);
  const { count } = await db.playlistItem.deleteMany({ where: { playlistId, videoId } });
  if (count) await db.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
  return { itemCount: await db.playlistItem.count({ where: { playlistId } }) };
}
