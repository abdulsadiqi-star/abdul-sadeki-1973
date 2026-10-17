'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { discoveryLimits } from '@/features/discovery/limits';
import {
  MAX_PLAYLISTS_PER_USER,
  createPlaylistSchema,
  deletePlaylistSchema,
  removeFromPlaylistSchema,
  removeHistoryItemSchema,
  updatePlaylistSchema,
} from './schemas';

/**
 * Library mutations. Every action re-derives who the caller is and what they own from the DATABASE:
 * the ids sent by the client only select a row, never grant access. A playlist that is not yours is reported as
 * "not found" (404), never "forbidden", so ids cannot be probed.
 */

async function writer() {
  const user = await requireUser();
  await enforceRateLimit('library:write', user.id, discoveryLimits.libraryWrite);
  return user;
}

async function ownedPlaylist(userId: string, id: string) {
  const playlist = await db.playlist.findUnique({ where: { id }, select: { id: true, ownerId: true, kind: true } });
  if (!playlist || playlist.ownerId !== userId) throw Errors.notFound('لیست پخش پیدا نشد.');
  return playlist;
}

const refreshLibrary = () => revalidatePath('/library', 'layout');

// --- history -----------------------------------------------------------------------------------------------------------

export async function removeHistoryItemAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await writer();
    const { videoId } = parse(removeHistoryItemSchema, input);
    await db.watchHistory.deleteMany({ where: { userId: user.id, videoId } });
    refreshLibrary();
  });
}

export async function clearHistoryAction(): Promise<ActionResult<{ removed: number }>> {
  return runAction(async () => {
    const user = await writer();
    const { count } = await db.watchHistory.deleteMany({ where: { userId: user.id } });
    refreshLibrary();
    return { removed: count };
  });
}

// --- playlists ---------------------------------------------------------------------------------------------------------

export async function createPlaylistAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await writer();
    const data = parse(createPlaylistSchema, input);
    await enforceRateLimit('playlist:create', user.id, discoveryLimits.playlistCreate);
    const existing = await db.playlist.count({ where: { ownerId: user.id, kind: 'CUSTOM' } });
    if (existing >= MAX_PLAYLISTS_PER_USER) throw Errors.quotaExceeded('به سقف تعداد لیست‌های پخش رسیده‌اید. ابتدا لیست‌های بی‌استفاده را حذف کنید.');
    const playlist = await db.playlist.create({
      data: { ownerId: user.id, kind: 'CUSTOM', title: data.title, description: data.description, visibility: data.visibility },
      select: { id: true },
    });
    refreshLibrary();
    return playlist;
  });
}

export async function updatePlaylistAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await writer();
    const data = parse(updatePlaylistSchema, input);
    const playlist = await ownedPlaylist(user.id, data.id);
    if (playlist.kind !== 'CUSTOM') throw Errors.badRequest('لیست «بعداً تماشا می‌کنم» قابل ویرایش نیست.');
    await db.playlist.update({ where: { id: playlist.id }, data: { title: data.title, description: data.description, visibility: data.visibility } });
    refreshLibrary();
    revalidatePath(`/playlist/${playlist.id}`);
  });
}

export async function deletePlaylistAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await writer();
    const { id } = parse(deletePlaylistSchema, input);
    const playlist = await ownedPlaylist(user.id, id);
    if (playlist.kind !== 'CUSTOM') throw Errors.badRequest('لیست «بعداً تماشا می‌کنم» حذف‌شدنی نیست؛ می‌توانید ویدیوهای آن را یکی‌یکی بردارید.');
    await db.playlist.delete({ where: { id: playlist.id } });
    refreshLibrary();
  });
}

/** Remove one video from a playlist you own (custom lists and "watch later"). Works even if the video became hidden. */
export async function removeFromPlaylistAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await writer();
    const { playlistId, videoId } = parse(removeFromPlaylistSchema, input);
    const playlist = await ownedPlaylist(user.id, playlistId);
    await db.playlistItem.deleteMany({ where: { playlistId: playlist.id, videoId } });
    refreshLibrary();
    revalidatePath(`/playlist/${playlist.id}`);
  });
}
