import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { watchLaterPlaylistId } from '@/lib/ids';
import { setFollowNotificationsAction, toggleWatchLaterAction } from '@/features/engagement/actions';
import { setFollow } from '@/features/engagement/service';
import {
  clearHistoryAction,
  createPlaylistAction,
  deletePlaylistAction,
  removeFromPlaylistAction,
  removeHistoryItemAction,
  updatePlaylistAction,
} from '@/features/library/actions';
import {
  PLAYLIST_PAGE_SIZE,
  getFollowingPage,
  getHistoryPage,
  getLibraryOverview,
  getLikedPage,
  getMyPlaylists,
  getPlaylistView,
  getWatchLaterPage,
} from '@/features/library/queries';
import { MAX_PLAYLISTS_PER_USER } from '@/features/library/schemas';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { addLikes, follow, watch } from '../support/discovery';

async function world() {
  const creator = await createUser({ withChannel: true, displayName: 'سازنده' });
  const alice = await createUser({ displayName: 'آلیس' });
  const bob = await createUser({ displayName: 'باب' });
  const channelId = creator.channel!.id;
  return { creator, alice, bob, channelId };
}

const ids = <T extends { id: string }>(list: T[]) => list.map((i) => i.id);

describe('history', () => {
  it('lists only my own entries that are still watchable, newest first, with progress', async () => {
    const { alice, bob, channelId } = await world();
    const a = await createVideo(channelId, { title: 'الف', durationSeconds: 200 });
    const b = await createVideo(channelId, { title: 'ب', durationSeconds: 200 });
    const unlisted = await createVideo(channelId, { title: 'فقط لینک', state: 'unlisted', durationSeconds: 200 });
    const hidden = await Promise.all((['private', 'draft', 'takedown', 'processing'] as const).map((state) => createVideo(channelId, { state })));
    await watch(alice.id, a.id, { position: 50, daysAgo: 3 });
    await watch(alice.id, b.id, { position: 200, completed: true, daysAgo: 1 });
    await watch(alice.id, unlisted.id, { position: 100, daysAgo: 2 });
    for (const h of hidden) await watch(alice.id, h.id, { position: 10 });
    await watch(bob.id, a.id, { position: 10 });

    const page = await getHistoryPage(alice.id, 1);
    expect(page.items.map((i) => i.video.id)).toEqual([b.id, unlisted.id, a.id]);
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.progress)).toEqual([1, 0.5, 0.25]);
    expect(page.items[0]!.completed).toBe(true);
    expect((await getHistoryPage(bob.id, 1)).items.map((i) => i.video.id)).toEqual([a.id]);
  });

  it('paginates', async () => {
    const { alice, channelId } = await world();
    for (let i = 0; i < 30; i++) {
      const v = await createVideo(channelId, { title: `ویدیو ${i}` });
      await watch(alice.id, v.id, { position: 10, daysAgo: i / 10 });
    }
    const first = await getHistoryPage(alice.id, 1);
    const second = await getHistoryPage(alice.id, 2);
    expect([first.items.length, second.items.length, first.total, first.pageCount]).toEqual([24, 6, 30, 2]);
    expect(new Set([...first.items, ...second.items].map((i) => i.video.id)).size).toBe(30);
  });

  it('removes one entry — only mine, never somebody else’s', async () => {
    const { alice, bob, channelId } = await world();
    const v = await createVideo(channelId);
    await watch(alice.id, v.id);
    await watch(bob.id, v.id);

    await loginAs(alice.id);
    expect(await removeHistoryItemAction({ videoId: v.id })).toEqual({ ok: true, data: undefined });
    expect(await db.watchHistory.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.watchHistory.count({ where: { userId: bob.id } })).toBe(1); // untouched
    // idempotent
    expect((await removeHistoryItemAction({ videoId: v.id })).ok).toBe(true);
  });

  it('clears all of MY history and nothing else', async () => {
    const { alice, bob, channelId } = await world();
    const vs = await Promise.all([createVideo(channelId), createVideo(channelId), createVideo(channelId)]);
    for (const v of vs) {
      await watch(alice.id, v.id);
      await watch(bob.id, v.id);
    }
    await loginAs(alice.id);
    const res = await clearHistoryAction();
    expect(res).toEqual({ ok: true, data: { removed: 3 } });
    expect(await db.watchHistory.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.watchHistory.count({ where: { userId: bob.id } })).toBe(3);
  });

  it('requires a login and validates ids', async () => {
    logout();
    expect(await removeHistoryItemAction({ videoId: 'aaaaaaaaaaa' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await clearHistoryAction()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    const { alice } = await world();
    await loginAs(alice.id);
    expect(await removeHistoryItemAction({ videoId: 'not-an-id' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await removeHistoryItemAction({})).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('is rate limited', async () => {
    const { alice } = await world();
    await loginAs(alice.id);
    let last = await removeHistoryItemAction({ videoId: 'aaaaaaaaaaa' });
    for (let i = 0; i < 60; i++) last = await removeHistoryItemAction({ videoId: 'aaaaaaaaaaa' });
    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('watch later and liked', () => {
  it('lists the viewer’s saved videos and lets them remove them — even ones that became hidden', async () => {
    const { alice, bob, channelId } = await world();
    const a = await createVideo(channelId, { title: 'الف' });
    const b = await createVideo(channelId, { title: 'ب' });
    await loginAs(alice.id);
    expect((await toggleWatchLaterAction({ videoId: a.id, saved: true })).ok).toBe(true);
    expect((await toggleWatchLaterAction({ videoId: b.id, saved: true })).ok).toBe(true);
    expect(ids((await getWatchLaterPage(alice.id, 1)).videos).sort()).toEqual([a.id, b.id].sort());
    expect((await getWatchLaterPage(bob.id, 1)).videos).toEqual([]);

    // b becomes private: it disappears from the list, but the row is still removable
    await db.video.update({ where: { id: b.id }, data: { visibility: 'PRIVATE' } });
    expect(ids((await getWatchLaterPage(alice.id, 1)).videos)).toEqual([a.id]);
    const wl = watchLaterPlaylistId(alice.id);
    expect((await removeFromPlaylistAction({ playlistId: wl, videoId: b.id })).ok).toBe(true);
    expect(await db.playlistItem.count({ where: { playlistId: wl } })).toBe(1);
  });

  it('nobody can remove from somebody else’s watch-later list (404, not 403)', async () => {
    const { alice, bob, channelId } = await world();
    const v = await createVideo(channelId);
    await loginAs(alice.id);
    await toggleWatchLaterAction({ videoId: v.id, saved: true });
    await loginAs(bob.id);
    const res = await removeFromPlaylistAction({ playlistId: watchLaterPlaylistId(alice.id), videoId: v.id });
    expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await db.playlistItem.count({ where: { playlistId: watchLaterPlaylistId(alice.id) } })).toBe(1);
  });

  it('liked page: only my likes of watchable videos', async () => {
    const { alice, bob, channelId } = await world();
    const a = await createVideo(channelId, { title: 'الف' });
    const b = await createVideo(channelId, { title: 'ب', state: 'private' });
    const c = await createVideo(channelId, { title: 'ج', state: 'unlisted' });
    await addLikes(a.id, [alice.id, bob.id]);
    await addLikes(b.id, [alice.id]);
    await addLikes(c.id, [alice.id]);
    expect(ids((await getLikedPage(alice.id, 1)).videos).sort()).toEqual([a.id, c.id].sort());
    expect(ids((await getLikedPage(bob.id, 1)).videos)).toEqual([a.id]);
  });
});

describe('following', () => {
  it('lists followed channels with public counts, hides suspended ones, toggles notifications (own rows only)', async () => {
    const { alice, bob, creator, channelId } = await world();
    const other = await createUser({ withChannel: true, displayName: 'دیگری' });
    const suspended = await createUser({ withChannel: true, displayName: 'معلق' });
    await db.channel.update({ where: { id: suspended.channel!.id }, data: { suspendedAt: new Date() } });
    await createVideo(channelId, { title: 'عمومی' });
    await createVideo(channelId, { title: 'خصوصی', state: 'private' });
    await follow(alice.id, channelId);
    await follow(alice.id, other.channel!.id);
    await follow(alice.id, suspended.channel!.id);
    await follow(bob.id, channelId);

    const page = await getFollowingPage(alice.id, 1);
    expect(page.total).toBe(2);
    const mine = page.channels.find((c) => c.id === channelId)!;
    expect(mine.videoCount).toBe(1); // the private video is not counted
    expect(mine.latestAt).not.toBeNull();
    expect(mine.followerCount).toBe(2);
    expect(page.channels.map((c) => c.id)).not.toContain(suspended.channel!.id);

    await loginAs(alice.id);
    expect((await setFollowNotificationsAction({ channelId, enabled: false })).ok).toBe(true);
    expect((await db.follow.findUniqueOrThrow({ where: { userId_channelId: { userId: alice.id, channelId } } })).notify).toBe(false);
    expect((await db.follow.findUniqueOrThrow({ where: { userId_channelId: { userId: bob.id, channelId } } })).notify).toBe(true); // Bob unaffected
    // not following → cannot toggle
    await loginAs(creator.id);
    expect((await setFollowNotificationsAction({ channelId: other.channel!.id, enabled: false })).ok).toBe(false);
  });

  it('unfollow keeps counters exact (shared service)', async () => {
    const { alice, channelId } = await world();
    const viewer = { id: alice.id, displayName: alice.displayName, role: alice.role, channelId: null, emailVerified: true };
    await setFollow(viewer, channelId, true);
    await setFollow(viewer, channelId, false);
    expect((await getFollowingPage(alice.id, 1)).total).toBe(0);
  });
});

describe('playlists: actions and authorization', () => {
  it('creates a playlist with normalized text and a private default', async () => {
    const { alice } = await world();
    await loginAs(alice.id);
    const res = await createPlaylistAction({ title: '  كتاب‌هاي   علي  ', description: '', visibility: undefined });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await db.playlist.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row).toMatchObject({ ownerId: alice.id, kind: 'CUSTOM', title: 'کتاب‌های علی', visibility: 'PRIVATE', description: '' });
  });

  it('validates input and enforces the per-user cap', async () => {
    const { alice } = await world();
    await loginAs(alice.id);
    expect(await createPlaylistAction({ title: 'ا' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createPlaylistAction({ title: 'ا'.repeat(101) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createPlaylistAction({ title: 'خوب', description: 'ا'.repeat(501) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createPlaylistAction({ title: 'خوب', visibility: 'SECRET' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createPlaylistAction({})).toMatchObject({ ok: false, code: 'VALIDATION' });

    await db.playlist.createMany({ data: Array.from({ length: MAX_PLAYLISTS_PER_USER }, (_, i) => ({ ownerId: alice.id, title: `لیست ${i}` })) });
    expect(await createPlaylistAction({ title: 'یکی بیشتر' })).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
  });

  it('only the owner can rename, change visibility, delete or remove items — everyone else gets 404', async () => {
    const { alice, bob, channelId } = await world();
    const v = await createVideo(channelId);
    await loginAs(alice.id);
    const created = await createPlaylistAction({ title: 'لیست من', visibility: 'PUBLIC' });
    if (!created.ok) throw new Error('setup failed');
    const id = created.data.id;
    await db.playlistItem.create({ data: { playlistId: id, videoId: v.id, position: 0 } });

    await loginAs(bob.id);
    for (const result of [
      await updatePlaylistAction({ id, title: 'هک شد', visibility: 'PUBLIC' }),
      await deletePlaylistAction({ id }),
      await removeFromPlaylistAction({ playlistId: id, videoId: v.id }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    }
    expect(await db.playlist.findUniqueOrThrow({ where: { id } })).toMatchObject({ title: 'لیست من', visibility: 'PUBLIC' });
    expect(await db.playlistItem.count({ where: { playlistId: id } })).toBe(1);

    logout();
    expect(await updatePlaylistAction({ id, title: 'ناشناس', visibility: 'PUBLIC' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });

    await loginAs(alice.id);
    expect((await updatePlaylistAction({ id, title: 'نام تازه', description: 'توضیح', visibility: 'UNLISTED' })).ok).toBe(true);
    expect(await db.playlist.findUniqueOrThrow({ where: { id } })).toMatchObject({ title: 'نام تازه', description: 'توضیح', visibility: 'UNLISTED' });
    expect((await removeFromPlaylistAction({ playlistId: id, videoId: v.id })).ok).toBe(true);
    expect(await db.playlistItem.count({ where: { playlistId: id } })).toBe(0);
    expect((await deletePlaylistAction({ id })).ok).toBe(true);
    expect(await db.playlist.count({ where: { id } })).toBe(0);
  });

  it('the system watch-later list cannot be renamed or deleted', async () => {
    const { alice, channelId } = await world();
    const v = await createVideo(channelId);
    await loginAs(alice.id);
    await toggleWatchLaterAction({ videoId: v.id, saved: true });
    const id = watchLaterPlaylistId(alice.id);
    expect(await updatePlaylistAction({ id, title: 'نام دیگر', visibility: 'PUBLIC' })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(await deletePlaylistAction({ id })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect((await db.playlist.findUniqueOrThrow({ where: { id } })).visibility).toBe('PRIVATE');
  });

  it('lists my playlists with counts of watchable videos only', async () => {
    const { alice, channelId } = await world();
    const pl = await db.playlist.create({ data: { ownerId: alice.id, title: 'لیست', visibility: 'PUBLIC' } });
    const items = [await createVideo(channelId), await createVideo(channelId), await createVideo(channelId, { state: 'private' }), await createVideo(channelId, { state: 'draft' })];
    await db.playlistItem.createMany({ data: items.map((v, position) => ({ playlistId: pl.id, videoId: v.id, position })) });
    const lists = await getMyPlaylists(alice.id);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id: pl.id, videoCount: 2 });
  });
});

describe('playlist page visibility', () => {
  async function setup(visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE') {
    const w = await world();
    const pl = await db.playlist.create({ data: { ownerId: w.creator.id, title: 'لیست آزمایشی', visibility } });
    const pub = await createVideo(w.channelId, { title: 'عمومی' });
    const unlisted = await createVideo(w.channelId, { title: 'فقط لینک', state: 'unlisted' });
    const priv = await createVideo(w.channelId, { title: 'خصوصی', state: 'private' });
    const draft = await createVideo(w.channelId, { title: 'پیش‌نویس', state: 'draft' });
    const takedown = await createVideo(w.channelId, { title: 'حذف‌شده', state: 'takedown' });
    await db.playlistItem.createMany({
      data: [pub, unlisted, priv, draft, takedown].map((v, position) => ({ playlistId: pl.id, videoId: v.id, position })),
    });
    return { ...w, pl, pub, unlisted, priv };
  }
  const viewerOf = (u: { id: string; channel?: { id: string } | null }) => ({ id: u.id, channelId: u.channel?.id ?? null });

  it('public list: visitors and other users see only publicly listed videos', async () => {
    const { pl, pub, alice } = await setup('PUBLIC');
    for (const viewer of [null, viewerOf(alice)]) {
      const view = await getPlaylistView(pl.id, viewer, 1);
      expect(view).not.toBeNull();
      expect(view!.isOwner).toBe(false);
      expect(view!.items.map((i) => i.video.id)).toEqual([pub.id]);
      expect(view!.total).toBe(1);
      expect(view!.unavailable).toBe(0); // never reveals how many hidden items exist
    }
  });

  it('the owner also sees unlisted and own private videos, and how many are unavailable', async () => {
    const { pl, pub, unlisted, priv, creator } = await setup('PUBLIC');
    const view = await getPlaylistView(pl.id, viewerOf(creator), 1);
    expect(view!.isOwner).toBe(true);
    expect(view!.items.map((i) => i.video.id).sort()).toEqual([pub.id, unlisted.id, priv.id].sort());
    expect(view!.unavailable).toBe(2); // draft + taken down
  });

  it('unlisted list: viewable by id for everyone; same item rules', async () => {
    const { pl, pub, alice } = await setup('UNLISTED');
    expect((await getPlaylistView(pl.id, null, 1))!.items.map((i) => i.video.id)).toEqual([pub.id]);
    expect(await getPlaylistView(pl.id, viewerOf(alice), 1)).not.toBeNull();
  });

  it('private list: only the owner — everybody else gets null (a 404), indistinguishable from "missing"', async () => {
    const { pl, creator, alice, bob } = await setup('PRIVATE');
    expect(await getPlaylistView(pl.id, null, 1)).toBeNull();
    expect(await getPlaylistView(pl.id, viewerOf(alice), 1)).toBeNull();
    expect(await getPlaylistView(pl.id, viewerOf(bob), 1)).toBeNull();
    expect(await getPlaylistView('doesNotExist1', viewerOf(creator), 1)).toBeNull();
    expect(await getPlaylistView(pl.id, viewerOf(creator), 1)).not.toBeNull();
  });

  it('watch-later lists are private to their owner', async () => {
    const { alice, bob, channelId } = await world();
    const v = await createVideo(channelId);
    await loginAs(alice.id);
    await toggleWatchLaterAction({ videoId: v.id, saved: true });
    const id = watchLaterPlaylistId(alice.id);
    expect(await getPlaylistView(id, viewerOf(bob), 1)).toBeNull();
    expect(await getPlaylistView(id, null, 1)).toBeNull();
    expect((await getPlaylistView(id, viewerOf(alice), 1))!.kind).toBe('WATCH_LATER');
  });

  it('paginates long lists (50 per page) in playlist order', async () => {
    const { creator, channelId } = await world();
    const pl = await db.playlist.create({ data: { ownerId: creator.id, title: 'بلند', visibility: 'PUBLIC' } });
    const videos = [];
    for (let i = 0; i < PLAYLIST_PAGE_SIZE + 5; i++) videos.push(await createVideo(channelId, { title: `قسمت ${i}` }));
    await db.playlistItem.createMany({ data: videos.map((v, position) => ({ playlistId: pl.id, videoId: v.id, position })) });
    const p1 = await getPlaylistView(pl.id, null, 1);
    const p2 = await getPlaylistView(pl.id, null, 2);
    expect([p1!.items.length, p2!.items.length, p1!.total, p1!.pageCount]).toEqual([50, 5, 55, 2]);
    expect(p1!.items[0]!.video.id).toBe(videos[0]!.id);
    expect(p2!.items[0]!.video.id).toBe(videos[50]!.id);
  });
});

describe('library overview', () => {
  it('collects the latest of every section for one user only', async () => {
    const { alice, bob, channelId } = await world();
    const v = await createVideo(channelId, { title: 'همه‌جا', durationSeconds: 100 });
    await watch(alice.id, v.id, { position: 20 });
    await addLikes(v.id, [alice.id]);
    await follow(alice.id, channelId);
    await loginAs(alice.id);
    await toggleWatchLaterAction({ videoId: v.id, saved: true });
    const overview = await getLibraryOverview(alice.id);
    expect(overview.history.total).toBe(1);
    expect(overview.watchLater.total).toBe(1);
    expect(overview.liked.total).toBe(1);
    expect(overview.following.total).toBe(1);
    const empty = await getLibraryOverview(bob.id);
    expect([empty.history.total, empty.watchLater.total, empty.liked.total, empty.following.total, empty.playlists.length]).toEqual([0, 0, 0, 0, 0]);
  });
});
