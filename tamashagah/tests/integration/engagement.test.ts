import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { watchLaterPlaylistId } from '@/lib/ids';
import {
  getViewerState,
  setFollow,
  setFollowNotifications,
  setLike,
  setWatchLater,
  type Viewer,
} from '@/features/engagement/service';
import { toggleFollowAction, toggleLikeAction, toggleWatchLaterAction } from '@/features/engagement/actions';
import { getRelatedVideos, getTrendingVideos } from '@/features/recommendations';
import { createCategory, createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';

const viewerOf = (u: Awaited<ReturnType<typeof createUser>>): Viewer => ({
  id: u.id,
  displayName: u.displayName,
  role: u.role,
  channelId: u.channel?.id ?? null,
  emailVerified: u.emailVerifiedAt !== null,
});

async function setup() {
  const owner = await createUser({ withChannel: true, displayName: 'سازنده' });
  const fan = await createUser({ displayName: 'علاقه‌مند' });
  const video = await createVideo(owner.channel!.id, { title: 'ویدیوی عمومی' });
  return { owner, fan, video };
}

describe('likes', () => {
  it('likes once (idempotent), keeps the counter exact and notifies the owner once per day', async () => {
    const { owner, fan, video } = await setup();
    expect(await setLike(viewerOf(fan), video.id, true)).toEqual({ liked: true, likeCount: 1 });
    expect(await setLike(viewerOf(fan), video.id, true)).toEqual({ liked: true, likeCount: 1 });
    expect(await db.videoLike.count({ where: { videoId: video.id } })).toBe(1);

    // like → unlike → like again must not spam the creator
    await setLike(viewerOf(fan), video.id, false);
    await setLike(viewerOf(fan), video.id, true);
    const notifications = await db.notification.findMany({ where: { userId: owner.id, type: 'VIDEO_LIKED' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ actorId: fan.id, videoId: video.id, href: `/watch/${video.id}` });
  });

  it('unlikes and never drives the counter negative', async () => {
    const { fan, video } = await setup();
    await setLike(viewerOf(fan), video.id, true);
    expect(await setLike(viewerOf(fan), video.id, false)).toEqual({ liked: false, likeCount: 0 });
    expect(await setLike(viewerOf(fan), video.id, false)).toEqual({ liked: false, likeCount: 0 });
  });

  it('counts likes from several users', async () => {
    const { video } = await setup();
    const others = await Promise.all([createUser(), createUser(), createUser()]);
    for (const u of others) await setLike(viewerOf(u), video.id, true);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).likeCount).toBe(3);
  });

  it('refuses to like what the viewer cannot see (404, never 403)', async () => {
    const { owner, fan } = await setup();
    const hidden = await Promise.all(
      (['private', 'draft', 'processing', 'scheduled', 'takedown'] as const).map((state) => createVideo(owner.channel!.id, { state })),
    );
    for (const video of hidden) {
      await expect(setLike(viewerOf(fan), video.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // the owner may like their own private video
    await expect(setLike(viewerOf(owner), hidden[0]!.id, true)).resolves.toMatchObject({ liked: true });
    // unlisted videos are reachable by link
    const unlisted = await createVideo(owner.channel!.id, { state: 'unlisted' });
    await expect(setLike(viewerOf(fan), unlisted.id, true)).resolves.toMatchObject({ liked: true });
  });

  it('does not notify when the owner likes their own video', async () => {
    const { owner, video } = await setup();
    await setLike(viewerOf(owner), video.id, true);
    expect(await db.notification.count()).toBe(0);
  });
});

describe('follows', () => {
  it('follows, logs events, updates the counter and notifies the owner', async () => {
    const { owner, fan } = await setup();
    const channelId = owner.channel!.id;
    expect(await setFollow(viewerOf(fan), channelId, true)).toEqual({ following: true, followerCount: 1 });
    expect(await setFollow(viewerOf(fan), channelId, true)).toEqual({ following: true, followerCount: 1 }); // idempotent
    expect(await setFollow(viewerOf(fan), channelId, false)).toEqual({ following: false, followerCount: 0 });

    const events = await db.followEvent.findMany({ where: { channelId }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['FOLLOW', 'UNFOLLOW']);
    expect(await db.notification.count({ where: { userId: owner.id, type: 'NEW_FOLLOWER' } })).toBe(1);
    expect(events.every((e) => e.source === 'REAL')).toBe(true);
  });

  it('forbids following yourself and unknown or suspended channels', async () => {
    const { owner, fan } = await setup();
    await expect(setFollow(viewerOf(owner), owner.channel!.id, true)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(setFollow(viewerOf(fan), 'does-not-exist-123', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.channel.update({ where: { id: owner.channel!.id }, data: { suspendedAt: new Date() } });
    await expect(setFollow(viewerOf(fan), owner.channel!.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('toggles new-video notifications only for followed channels', async () => {
    const { owner, fan } = await setup();
    await expect(setFollowNotifications(fan.id, owner.channel!.id, false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await setFollow(viewerOf(fan), owner.channel!.id, true);
    await setFollowNotifications(fan.id, owner.channel!.id, false);
    expect((await db.follow.findFirstOrThrow()).notify).toBe(false);
  });
});

describe('watch later', () => {
  it('uses the deterministic system playlist and appends in order', async () => {
    const { owner, fan, video } = await setup();
    const second = await createVideo(owner.channel!.id);
    await setWatchLater(viewerOf(fan), video.id, true);
    await setWatchLater(viewerOf(fan), second.id, true);
    await setWatchLater(viewerOf(fan), second.id, true); // idempotent

    const playlist = await db.playlist.findUniqueOrThrow({
      where: { id: watchLaterPlaylistId(fan.id) },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    expect(playlist).toMatchObject({ kind: 'WATCH_LATER', visibility: 'PRIVATE', ownerId: fan.id });
    expect(playlist.items.map((i) => i.videoId)).toEqual([video.id, second.id]);

    await setWatchLater(viewerOf(fan), video.id, false);
    expect((await db.playlistItem.findMany()).map((i) => i.videoId)).toEqual([second.id]);
  });

  it('cannot save videos the viewer is not allowed to see', async () => {
    const { owner, fan } = await setup();
    const hidden = await createVideo(owner.channel!.id, { state: 'private' });
    await expect(setWatchLater(viewerOf(fan), hidden.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('viewer state', () => {
  it('reports like / follow / saved flags in one call', async () => {
    const { owner, fan, video } = await setup();
    expect(await getViewerState(null, video.id, owner.channel!.id)).toEqual({ liked: false, following: false, notifyEnabled: false, saved: false });
    await setLike(viewerOf(fan), video.id, true);
    await setFollow(viewerOf(fan), owner.channel!.id, true);
    await setWatchLater(viewerOf(fan), video.id, true);
    expect(await getViewerState(fan.id, video.id, owner.channel!.id)).toEqual({ liked: true, following: true, notifyEnabled: true, saved: true });
  });
});

describe('server actions', () => {
  it('require a signed-in user', async () => {
    const { owner, video } = await setup();
    logout();
    expect(await toggleLikeAction({ videoId: video.id, liked: true })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await toggleFollowAction({ channelId: owner.channel!.id, follow: true })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await toggleWatchLaterAction({ videoId: video.id, saved: true })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('validate their input', async () => {
    const { fan } = await setup();
    await loginAs(fan.id);
    expect(await toggleLikeAction({ videoId: 'bad', liked: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await toggleLikeAction({ videoId: 'aB3dE5gH7jK', liked: 'yes' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('work end to end for a logged-in fan', async () => {
    const { owner, fan, video } = await setup();
    await loginAs(fan.id);
    expect(await toggleLikeAction({ videoId: video.id, liked: true })).toEqual({ ok: true, data: { liked: true, likeCount: 1 } });
    expect(await toggleFollowAction({ channelId: owner.channel!.id, follow: true })).toEqual({ ok: true, data: { following: true, followerCount: 1 } });
    expect(await toggleWatchLaterAction({ videoId: video.id, saved: true })).toEqual({ ok: true, data: { saved: true } });
  });
});

describe('recommendations (foundation implementation)', () => {
  it('returns only publicly listed videos and never the current one', async () => {
    const owner = await createUser({ withChannel: true });
    const other = await createUser({ withChannel: true });
    const cat = await createCategory('music', 'موسیقی');
    const current = await createVideo(owner.channel!.id, { categoryId: cat.id });
    const sameCategory = await createVideo(other.channel!.id, { categoryId: cat.id, viewCount: 50 });
    await createVideo(other.channel!.id, { state: 'private', categoryId: cat.id });
    await createVideo(other.channel!.id, { state: 'draft', categoryId: cat.id });
    await createVideo(other.channel!.id, { state: 'takedown', categoryId: cat.id });

    const related = await getRelatedVideos(current.id, { limit: 10 });
    expect(related.map((v) => v.id)).toEqual([sameCategory.id]);
    expect(related[0]).toMatchObject({ channel: { handle: other.channel!.handle }, viewCount: 50 });

    const trending = await getTrendingVideos({ limit: 5 });
    expect(trending.map((v) => v.id)).toEqual([sameCategory.id, current.id]);
    expect(await getRelatedVideos('does-not-exist')).toEqual([]);
  });
});
