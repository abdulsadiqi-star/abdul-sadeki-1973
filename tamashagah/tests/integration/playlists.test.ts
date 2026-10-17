import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { watchLaterPlaylistId } from '@/lib/ids';
import {
  MAX_PLAYLISTS_PER_USER,
  addVideoToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylistsForVideo,
  removeVideoFromPlaylist,
  renamePlaylist,
} from '@/features/engagement/playlists';
import {
  createPlaylistAction,
  deletePlaylistAction,
  renamePlaylistAction,
  setPlaylistMembershipAction,
} from '@/features/engagement/playlist-actions';
import { setWatchLater, type Viewer } from '@/features/engagement/service';
import { GET as playlistsRoute } from '@/app/api/videos/[id]/playlists/route';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';

type U = Awaited<ReturnType<typeof createUser>>;
const viewerOf = (u: U): Viewer => ({
  id: u.id,
  displayName: u.displayName,
  role: u.role,
  channelId: u.channel?.id ?? null,
  emailVerified: u.emailVerifiedAt !== null,
});

async function setup() {
  const owner = await createUser({ withChannel: true });
  const me = await createUser({ displayName: 'من' });
  const stranger = await createUser({ displayName: 'غریبه' });
  const video = await createVideo(owner.channel!.id, { title: 'ویدیوی یکم' });
  const video2 = await createVideo(owner.channel!.id, { title: 'ویدیوی دوم' });
  return { owner, me, stranger, video, video2 };
}

describe('create / rename / delete', () => {
  it('creates private playlists by default, optionally with the current video', async () => {
    const { me, video } = await setup();
    const empty = await createPlaylist(viewerOf(me), { title: '  آموزش‌های   آشپزی ' });
    expect(empty).toMatchObject({ title: 'آموزش‌های آشپزی', visibility: 'PRIVATE', itemCount: 0, contains: false });

    const withVideo = await createPlaylist(viewerOf(me), { title: 'برای آخر هفته', visibility: 'UNLISTED', videoId: video.id });
    expect(withVideo).toMatchObject({ itemCount: 1, contains: true, visibility: 'UNLISTED' });
    const row = await db.playlist.findUniqueOrThrow({ where: { id: withVideo.id }, include: { items: true } });
    expect(row).toMatchObject({ kind: 'CUSTOM', ownerId: me.id });
    expect(row.items.map((i) => [i.videoId, i.position])).toEqual([[video.id, 0]]);
  });

  it('validates the title', async () => {
    const { me, video } = await setup();
    await expect(createPlaylist(viewerOf(me), { title: '   ' })).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { title: expect.any(Array) } });
    await expect(createPlaylist(viewerOf(me), { title: '‌‌' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createPlaylist(viewerOf(me), { title: 'ن'.repeat(101) })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createPlaylist(viewerOf(me), { title: 'ن'.repeat(100) })).resolves.toBeTruthy();
    await expect(createPlaylist(viewerOf(me), { title: 'x', videoId: 'aB3dE5gH7jK' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.playlist.count()).toBe(1);
    expect(video.id).toBeTruthy();
  });

  it('caps the number of playlists per user', async () => {
    const { me } = await setup();
    await db.playlist.createMany({ data: Array.from({ length: MAX_PLAYLISTS_PER_USER }, (_, i) => ({ ownerId: me.id, title: `فهرست ${i}` })) });
    await expect(createPlaylist(viewerOf(me), { title: 'یکی بیشتر' })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('renames and changes visibility; only the owner may', async () => {
    const { me, stranger } = await setup();
    const p = await createPlaylist(viewerOf(me), { title: 'قدیمی' });
    expect(await renamePlaylist(me.id, p.id, { title: ' جدید ' })).toMatchObject({ title: 'جدید', visibility: 'PRIVATE' });
    expect(await renamePlaylist(me.id, p.id, { visibility: 'PUBLIC' })).toMatchObject({ title: 'جدید', visibility: 'PUBLIC' });
    await expect(renamePlaylist(stranger.id, p.id, { title: 'هک' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(renamePlaylist(me.id, p.id, { title: '  ' })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await db.playlist.findUniqueOrThrow({ where: { id: p.id } })).title).toBe('جدید');
  });

  it('deletes with its items; others cannot', async () => {
    const { me, stranger, video } = await setup();
    const p = await createPlaylist(viewerOf(me), { title: 'برای حذف', videoId: video.id });
    await expect(deletePlaylist(stranger.id, p.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await deletePlaylist(me.id, p.id);
    expect(await db.playlist.count()).toBe(0);
    expect(await db.playlistItem.count()).toBe(0);
    await expect(deletePlaylist(me.id, p.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps "Watch later" a system list: it cannot be renamed, deleted or filled through this API', async () => {
    const { me, video } = await setup();
    await setWatchLater(viewerOf(me), video.id, true);
    const wl = watchLaterPlaylistId(me.id);
    await expect(renamePlaylist(me.id, wl, { title: 'نام دیگر' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(deletePlaylist(me.id, wl)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(addVideoToPlaylist(viewerOf(me), wl, video.id)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await db.playlist.findUniqueOrThrow({ where: { id: wl } })).title).toBe('بعداً تماشا می‌کنم');
    expect((await listPlaylistsForVideo(me.id, video.id))).toEqual([]);
  });
});

describe('membership', () => {
  it('adds idempotently (append order) and removes', async () => {
    const { me, video, video2 } = await setup();
    const p = await createPlaylist(viewerOf(me), { title: 'فهرست من' });
    expect(await addVideoToPlaylist(viewerOf(me), p.id, video.id)).toEqual({ itemCount: 1 });
    expect(await addVideoToPlaylist(viewerOf(me), p.id, video2.id)).toEqual({ itemCount: 2 });
    expect(await addVideoToPlaylist(viewerOf(me), p.id, video.id)).toEqual({ itemCount: 2 }); // idempotent
    const items = await db.playlistItem.findMany({ where: { playlistId: p.id }, orderBy: { position: 'asc' } });
    expect(items.map((i) => [i.videoId, i.position])).toEqual([[video.id, 0], [video2.id, 1]]);

    expect(await removeVideoFromPlaylist(me.id, p.id, video.id)).toEqual({ itemCount: 1 });
    expect(await removeVideoFromPlaylist(me.id, p.id, video.id)).toEqual({ itemCount: 1 }); // idempotent
    expect((await db.playlistItem.findMany()).map((i) => i.videoId)).toEqual([video2.id]);
  });

  it('only adds videos the user may see, to their own lists', async () => {
    const { owner, me, stranger, video } = await setup();
    const p = await createPlaylist(viewerOf(me), { title: 'فهرست من' });
    for (const state of ['private', 'draft', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      await expect(addVideoToPlaylist(viewerOf(me), p.id, hidden.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(addVideoToPlaylist(viewerOf(stranger), p.id, video.id)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // someone else's list
    await expect(addVideoToPlaylist(viewerOf(owner), p.id, video.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.playlistItem.count()).toBe(0);
    // the owner can add their own private video to their own list
    const priv = await createVideo(owner.channel!.id, { state: 'private' });
    const mine = await createPlaylist(viewerOf(owner), { title: 'خصوصی‌ها' });
    await expect(addVideoToPlaylist(viewerOf(owner), mine.id, priv.id)).resolves.toEqual({ itemCount: 1 });
  });

  it('lets people remove videos that were taken down meanwhile', async () => {
    const { me, video } = await setup();
    const p = await createPlaylist(viewerOf(me), { title: 'فهرست من', videoId: video.id });
    await db.video.update({ where: { id: video.id }, data: { takedownAt: new Date() } });
    expect(await removeVideoFromPlaylist(me.id, p.id, video.id)).toEqual({ itemCount: 0 });
  });

  it('flags which of my playlists already contain the video', async () => {
    const { me, stranger, video, video2 } = await setup();
    const a = await createPlaylist(viewerOf(me), { title: 'الف', videoId: video.id });
    const b = await createPlaylist(viewerOf(me), { title: 'ب', videoId: video2.id });
    await createPlaylist(viewerOf(stranger), { title: 'مال دیگری', videoId: video.id });
    const list = await listPlaylistsForVideo(me.id, video.id);
    expect(list.map((p) => [p.id, p.contains, p.itemCount]).sort()).toEqual([[a.id, true, 1], [b.id, false, 1]].sort());
  });
});

describe('server actions', () => {
  it('require a signed-in user and validate input', async () => {
    const { me, video } = await setup();
    logout();
    expect(await createPlaylistAction({ title: 'x' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await deletePlaylistAction({ playlistId: 'cknonexistent0000000000000' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await loginAs(me.id);
    expect(await createPlaylistAction({ title: 5 })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createPlaylistAction({ title: 'x', visibility: 'SECRET' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await setPlaylistMembershipAction({ playlistId: 'x', videoId: video.id, present: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await setPlaylistMembershipAction({ playlistId: 'cknonexistent0000000000000', videoId: 'bad', present: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('work end to end', async () => {
    const { me, stranger, video } = await setup();
    await loginAs(me.id);
    const created = await createPlaylistAction({ title: 'مورد علاقه‌ها', videoId: video.id });
    expect(created).toMatchObject({ ok: true, data: { title: 'مورد علاقه‌ها', itemCount: 1, contains: true } });
    const id = created.ok ? created.data.id : '';

    expect(await renamePlaylistAction({ playlistId: id, title: 'محبوب‌ترین‌ها' })).toEqual({ ok: true, data: { id, title: 'محبوب‌ترین‌ها' } });
    expect(await setPlaylistMembershipAction({ playlistId: id, videoId: video.id, present: false })).toEqual({ ok: true, data: { present: false, itemCount: 0 } });
    expect(await setPlaylistMembershipAction({ playlistId: id, videoId: video.id, present: true })).toEqual({ ok: true, data: { present: true, itemCount: 1 } });

    await loginAs(stranger.id);
    expect(await deletePlaylistAction({ playlistId: id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await loginAs(me.id);
    expect(await deletePlaylistAction({ playlistId: id })).toEqual({ ok: true, data: undefined });
  });

  it('are rate limited', async () => {
    const { me } = await setup();
    await loginAs(me.id);
    const results = [];
    for (let i = 0; i < 62; i++) results.push(await createPlaylistAction({ title: `فهرست ${i}` }));
    expect(results.filter((r) => !r.ok && r.code === 'RATE_LIMITED').length).toBeGreaterThan(0);
  });
});

describe('GET /api/videos/[id]/playlists', () => {
  const get = (id: string) => playlistsRoute(new NextRequest(`http://localhost:3000/api/videos/${id}/playlists`), { params: Promise.resolve({ id }) });

  it('lists the signed-in user’s playlists with the membership flag; visitors get 401', async () => {
    const { me, video } = await setup();
    const p = await createPlaylist(viewerOf(me), { title: 'فهرست من', videoId: video.id });
    logout();
    expect((await get(video.id)).status).toBe(401);
    await loginAs(me.id);
    const res = await get(video.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ playlists: [{ id: p.id, title: 'فهرست من', visibility: 'PRIVATE', itemCount: 1, contains: true }] });
    expect((await get('bad')).status).toBe(404);
  });
});
