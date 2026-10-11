'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/lib/errors';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import '@/lib/zod-fa';
import {
  PLAYLIST_TITLE_MAX,
  addVideoToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeVideoFromPlaylist,
  renamePlaylist,
  type PlaylistMenuItem,
} from './playlists';
import { toViewer } from './viewer';

const videoId = z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.');
const cuid = z.string().min(10).max(40);
// Generous raw bound: the real limit is applied after normalization (invisible characters, whitespace runs).
const title = z.string().max(PLAYLIST_TITLE_MAX * 4, 'نام فهرست پخش بیش از حد طولانی است.');
const visibility = z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']);

const viewer = async () => toViewer(await requireUser());

function touched() {
  revalidatePath('/library/playlists');
}

/** Create a playlist, optionally putting `videoId` into it right away. */
export async function createPlaylistAction(input: unknown): Promise<ActionResult<PlaylistMenuItem>> {
  return runAction(async () => {
    const v = await viewer();
    const data = parse(z.object({ title, visibility: visibility.optional(), videoId: videoId.optional() }), input);
    await enforceRateLimit('playlist:user', v.id, limits.generalWrite);
    const created = await createPlaylist(v, data);
    touched();
    return created;
  });
}

export async function renamePlaylistAction(input: unknown): Promise<ActionResult<{ id: string; title: string }>> {
  return runAction(async () => {
    const v = await viewer();
    const data = parse(z.object({ playlistId: cuid, title }), input);
    await enforceRateLimit('playlist:user', v.id, limits.generalWrite);
    const updated = await renamePlaylist(v.id, data.playlistId, { title: data.title });
    touched();
    return { id: updated.id, title: updated.title };
  });
}

export async function deletePlaylistAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = await viewer();
    const data = parse(z.object({ playlistId: cuid }), input);
    await enforceRateLimit('playlist:user', v.id, limits.generalWrite);
    await deletePlaylist(v.id, data.playlistId);
    touched();
  });
}

/** Add (`present: true`) or remove a video from one of the viewer's playlists. */
export async function setPlaylistMembershipAction(input: unknown): Promise<ActionResult<{ present: boolean; itemCount: number }>> {
  return runAction(async () => {
    const v = await viewer();
    const data = parse(z.object({ playlistId: cuid, videoId, present: z.boolean() }), input);
    await enforceRateLimit('playlist:user', v.id, limits.generalWrite);
    const { itemCount } = data.present
      ? await addVideoToPlaylist(v, data.playlistId, data.videoId)
      : await removeVideoFromPlaylist(v.id, data.playlistId, data.videoId);
    touched();
    return { present: data.present, itemCount };
  });
}
