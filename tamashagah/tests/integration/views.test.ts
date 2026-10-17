import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { recordHeartbeat, recordView, type RecordViewInput } from '@/features/watch/view-service';
import { POST as viewRoute } from '@/app/api/videos/[id]/view/route';
import { POST as heartbeatRoute } from '@/app/api/videos/[id]/heartbeat/route';
import { GET as statusRoute } from '@/app/api/videos/[id]/status/route';
import { VIEW_DEDUPE_WINDOW_MS } from '@/features/watch/view-rules';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const T0 = new Date('2026-03-01T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

type U = Awaited<ReturnType<typeof createUser>>;
const actorOf = (u: U | null) =>
  u ? { id: u.id, role: u.role, channelId: u.channel?.id ?? null, emailVerified: u.emailVerifiedAt !== null } : null;

async function setup() {
  const owner = await createUser({ withChannel: true });
  const viewer = await createUser();
  const video = await createVideo(owner.channel!.id, { durationSeconds: 120 });
  return { owner, viewer, video };
}

const viewInput = (videoId: string, key: string, extra: Partial<RecordViewInput> = {}): RecordViewInput => ({
  videoId,
  actor: null,
  viewerKey: key,
  userAgent: CHROME,
  referrer: null,
  playedSeconds: 6,
  positionSeconds: 6,
  now: T0,
  ...extra,
});

const counts = async (videoId: string) => ({
  events: await db.viewEvent.count({ where: { videoId } }),
  viewCount: (await db.video.findUniqueOrThrow({ where: { id: videoId } })).viewCount,
});

describe('recordView', () => {
  it('counts the first view: one REAL event with device + referrer, and bumps viewCount in the same step', async () => {
    const { owner, video } = await setup();
    const result = await recordView(viewInput(video.id, 'key-a', { userAgent: MOBILE, referrer: 'https://www.google.com/search?q=x', selfHost: 'localhost' }));
    expect(result).toMatchObject({ counted: true });
    expect(result.viewId).toEqual(expect.any(String));

    const event = await db.viewEvent.findFirstOrThrow({ where: { videoId: video.id } });
    expect(event).toMatchObject({
      channelId: owner.channel!.id,
      userId: null,
      viewerKey: 'key-a',
      device: 'MOBILE',
      referrer: 'www.google.com',
      source: 'REAL',
      watchSeconds: 6,
    });
    expect(await counts(video.id)).toEqual({ events: 1, viewCount: 1 });
  });

  it('labels navigation from our own pages as "internal" and unknown referrers as "direct"', async () => {
    const { video } = await setup();
    await recordView(viewInput(video.id, 'k1', { referrer: 'http://localhost:3000/', selfHost: 'localhost' }));
    await recordView(viewInput(video.id, 'k2', { referrer: null }));
    const referrers = (await db.viewEvent.findMany({ where: { videoId: video.id }, orderBy: { viewerKey: 'asc' } })).map((e) => e.referrer);
    expect(referrers).toEqual(['internal', 'direct']);
  });

  it('de-duplicates the same viewer within 30 minutes and counts again afterwards', async () => {
    const { video } = await setup();
    const first = await recordView(viewInput(video.id, 'key-a'));
    const again = await recordView(viewInput(video.id, 'key-a', { now: at(29 * 60_000) }));
    expect(again).toMatchObject({ counted: false, reason: 'duplicate', viewId: first.viewId });
    expect(await counts(video.id)).toEqual({ events: 1, viewCount: 1 });

    const later = await recordView(viewInput(video.id, 'key-a', { now: at(VIEW_DEDUPE_WINDOW_MS + 1_000) }));
    expect(later.counted).toBe(true);
    expect(later.viewId).not.toBe(first.viewId);
    expect(await counts(video.id)).toEqual({ events: 2, viewCount: 2 });
  });

  it('counts different viewers separately', async () => {
    const { video } = await setup();
    await recordView(viewInput(video.id, 'key-a'));
    await recordView(viewInput(video.id, 'key-b'));
    expect(await counts(video.id)).toEqual({ events: 2, viewCount: 2 });
  });

  it('de-duplicates a signed-in user across cookies (clearing cookies does not allow re-counting)', async () => {
    const { video, viewer } = await setup();
    await recordView(viewInput(video.id, 'cookie-1', { actor: actorOf(viewer) }));
    const second = await recordView(viewInput(video.id, 'cookie-2', { actor: actorOf(viewer), now: at(60_000) }));
    expect(second).toMatchObject({ counted: false, reason: 'duplicate' });
    expect(await counts(video.id)).toEqual({ events: 1, viewCount: 1 });
  });

  it('attaches the user to an anonymous event once they sign in during the window', async () => {
    const { video, viewer } = await setup();
    await recordView(viewInput(video.id, 'key-a'));
    await recordView(viewInput(video.id, 'key-a', { actor: actorOf(viewer), now: at(30_000) }));
    expect((await db.viewEvent.findFirstOrThrow()).userId).toBe(viewer.id);
  });

  it('counts exactly once under concurrent requests (two tabs, retries)', async () => {
    const { video } = await setup();
    const results = await Promise.all(Array.from({ length: 6 }, () => recordView(viewInput(video.id, 'key-race'))));
    expect(results.filter((r) => r.counted)).toHaveLength(1);
    expect(await counts(video.id)).toEqual({ events: 1, viewCount: 1 });
  });

  it('requires the playback threshold (5 s, or 25 % of videos shorter than 20 s)', async () => {
    const { owner, video } = await setup();
    expect(await recordView(viewInput(video.id, 'k', { playedSeconds: 1 }))).toMatchObject({ counted: false, reason: 'below-threshold' });
    expect(await recordView(viewInput(video.id, 'k', { playedSeconds: 0 }))).toMatchObject({ counted: false, reason: 'below-threshold' });
    expect((await counts(video.id)).viewCount).toBe(0);

    const short = await createVideo(owner.channel!.id, { durationSeconds: 10 });
    expect(await recordView(viewInput(short.id, 'k', { playedSeconds: 2.6 }))).toMatchObject({ counted: true });
  });

  it('clamps what the first report may claim as watch time', async () => {
    const { video } = await setup();
    await recordView(viewInput(video.id, 'cheater', { playedSeconds: 99_999, positionSeconds: 99_999 }));
    expect((await db.viewEvent.findFirstOrThrow()).watchSeconds).toBe(30);
  });

  it('ignores obvious bots (but still answers 404 for hidden videos first)', async () => {
    const { owner, video } = await setup();
    for (const userAgent of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'curl/8.5.0', null, '']) {
      expect(await recordView(viewInput(video.id, 'bot', { userAgent }))).toMatchObject({ counted: false, reason: 'bot', viewId: null });
    }
    expect(await counts(video.id)).toEqual({ events: 0, viewCount: 0 });

    const hidden = await createVideo(owner.channel!.id, { state: 'private' });
    await expect(recordView(viewInput(hidden.id, 'bot', { userAgent: 'curl/8.5.0' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers NOT_FOUND for every video a visitor may not see', async () => {
    const { owner } = await setup();
    for (const state of ['private', 'draft', 'processing', 'failed', 'scheduled', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      await expect(recordView(viewInput(hidden.id, 'k'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await db.channel.update({ where: { id: owner.channel!.id }, data: { suspendedAt: new Date() } });
    const ofSuspended = await createVideo(owner.channel!.id);
    await expect(recordView(viewInput(ofSuspended.id, 'k'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(recordView(viewInput('doesNotExist', 'k'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.viewEvent.count()).toBe(0);
  });

  it('counts unlisted videos (reachable by link) but not previews of private videos by their owner', async () => {
    const { owner } = await setup();
    const unlisted = await createVideo(owner.channel!.id, { state: 'unlisted' });
    expect(await recordView(viewInput(unlisted.id, 'k'))).toMatchObject({ counted: true });

    const priv = await createVideo(owner.channel!.id, { state: 'private' });
    const result = await recordView(viewInput(priv.id, 'owner-key', { actor: actorOf(owner), playedSeconds: 30, positionSeconds: 30 }));
    expect(result).toMatchObject({ counted: false, reason: 'not-public' });
    expect((await db.video.findUniqueOrThrow({ where: { id: priv.id } })).viewCount).toBe(0);
    // ...but the owner's resume position is still saved
    expect(await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: owner.id, videoId: priv.id } } })).toMatchObject({ positionSeconds: 30 });
  });

  it('lets moderators open any video but only public ones are counted', async () => {
    const { owner } = await setup();
    const moderator = await createUser({ role: 'MODERATOR' });
    const taken = await createVideo(owner.channel!.id, { state: 'takedown' });
    expect(await recordView(viewInput(taken.id, 'mod', { actor: actorOf(moderator) }))).toMatchObject({ counted: false, reason: 'not-public' });
  });

  it('records watch history for signed-in viewers (position, watched seconds, completion)', async () => {
    const { video, viewer } = await setup();
    await recordView(viewInput(video.id, 'k', { actor: actorOf(viewer), playedSeconds: 8, positionSeconds: 95 }));
    const h = await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: viewer.id, videoId: video.id } } });
    expect(h).toMatchObject({ positionSeconds: 95, watchedSeconds: 8, completed: false });
    await recordView(viewInput(video.id, 'k', { actor: actorOf(viewer), positionSeconds: 115, now: at(60_000) }));
    expect((await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: viewer.id, videoId: video.id } } })).completed).toBe(true);
  });

  it('writes no history for visitors', async () => {
    const { video } = await setup();
    await recordView(viewInput(video.id, 'k'));
    expect(await db.watchHistory.count()).toBe(0);
  });
});

describe('recordHeartbeat', () => {
  async function started() {
    const ctx = await setup();
    const first = await recordView(viewInput(ctx.video.id, 'key-a', { actor: actorOf(ctx.viewer) }));
    return { ...ctx, viewId: first.viewId! };
  }
  const beat = (videoId: string, viewId: string | null, deltaSeconds: number, ms: number, extra: Partial<Parameters<typeof recordHeartbeat>[0]> = {}) =>
    recordHeartbeat({ videoId, actor: null, viewerKey: 'key-a', viewId, deltaSeconds, positionSeconds: 20, now: at(ms), ...extra });
  const watchSeconds = async (viewId: string) => (await db.viewEvent.findUniqueOrThrow({ where: { id: viewId } })).watchSeconds;

  it('adds the reported seconds when they match the elapsed time', async () => {
    const { video, viewId } = await started();
    expect(await beat(video.id, viewId, 15, 15_000)).toEqual({ accepted: 15 });
    expect(await watchSeconds(viewId)).toBe(21); // 6 from the view + 15
    expect(await beat(video.id, viewId, 15, 30_000)).toEqual({ accepted: 15 });
    expect(await watchSeconds(viewId)).toBe(36);
  });

  it('clamps inflation: claims beyond elapsed wall time or 20 s per beat are cut', async () => {
    const { video, viewId } = await started();
    expect((await beat(video.id, viewId, 20, 2_000)).accepted).toBe(2); // only 2 s passed
    expect((await beat(video.id, viewId, 600, 3_600_000)).accepted).toBe(20); // a long gap still yields ≤ 20 s
    expect(await watchSeconds(viewId)).toBe(28);
  });

  it('makes a burst of beats share real time instead of each claiming 20 seconds', async () => {
    const { video, viewId } = await started();
    for (let i = 1; i <= 10; i++) await beat(video.id, viewId, 20, i * 100); // ten beats within one second
    expect(await watchSeconds(viewId)).toBeCloseTo(6 + 1, 5);
  });

  it('ignores unknown ids and other viewers’ events', async () => {
    const { video, viewId } = await started();
    expect(await beat(video.id, 'cknonexistent0000000000000', 15, 15_000)).toEqual({ accepted: 0 });
    expect(await beat(video.id, viewId, 15, 15_000, { viewerKey: 'someone-else' })).toEqual({ accepted: 0 });
    const other = await createUser();
    expect(await beat(video.id, viewId, 15, 15_000, { viewerKey: 'someone-else', actor: actorOf(other) })).toEqual({ accepted: 0 });
    expect(await watchSeconds(viewId)).toBe(6);
  });

  it('accepts beats from the signed-in owner of the event even with a different cookie', async () => {
    const { video, viewId, viewer } = await started();
    expect(await beat(video.id, viewId, 10, 10_000, { viewerKey: 'new-cookie', actor: actorOf(viewer) })).toEqual({ accepted: 10 });
  });

  it('keeps watch time on the same event when the player re-reports inside the dedupe window', async () => {
    const { video, viewer } = await started();
    const again = await recordView(viewInput(video.id, 'key-a', { actor: actorOf(viewer), now: at(10 * 60_000) }));
    expect(again.counted).toBe(false);
    expect((await beat(video.id, again.viewId, 12, 10 * 60_000 + 12_000)).accepted).toBe(12);
  });

  it('saves the resume position and completion for signed-in users even without a view id', async () => {
    const { video, viewer } = await setup();
    await beat(video.id, null, 0, 1_000, { actor: actorOf(viewer), positionSeconds: 61.5 });
    expect(await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: viewer.id, videoId: video.id } } })).toMatchObject({ positionSeconds: 61.5, watchedSeconds: 0, completed: false });
    await beat(video.id, null, 0, 2_000, { actor: actorOf(viewer), positionSeconds: 118 });
    await beat(video.id, null, 0, 3_000, { actor: actorOf(viewer), positionSeconds: 10 }); // rewatch: position moves, completion sticks
    const h = await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: viewer.id, videoId: video.id } } });
    expect(h).toMatchObject({ positionSeconds: 10, completed: true });
  });

  it('accumulates watched seconds in the history', async () => {
    const { video, viewer, viewId } = await started();
    await beat(video.id, viewId, 15, 15_000, { actor: actorOf(viewer) });
    expect((await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: viewer.id, videoId: video.id } } })).watchedSeconds).toBe(21);
  });

  it('answers NOT_FOUND for hidden videos', async () => {
    const { owner } = await setup();
    const hidden = await createVideo(owner.channel!.id, { state: 'draft' });
    await expect(beat(hidden.id, null, 5, 5_000)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not count watch time on non-public previews', async () => {
    const { owner } = await setup();
    const priv = await createVideo(owner.channel!.id, { state: 'private' });
    expect(await beat(priv.id, 'cksomething0000000000000000', 15, 15_000, { actor: actorOf(owner) })).toEqual({ accepted: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Route handlers: cookies, Origin check, validation, rate limits
// ---------------------------------------------------------------------------------------------------------

function post(path: string, body: unknown, headers: Record<string, string> = {}, raw = false) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json', 'user-agent': CHROME, ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieFrom = (res: Response) => /tg_viewer=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];

describe('POST /api/videos/[id]/view', () => {
  it('sets an HttpOnly viewer cookie, counts once and recognises the returning viewer', async () => {
    const { video } = await setup();
    logout();
    const res = await viewRoute(post(`/api/videos/${video.id}/view`, { played: 6, position: 6 }), ctx(video.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ counted: true });
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/tg_viewer=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);

    const cookie = cookieFrom(res)!;
    const again = await viewRoute(post(`/api/videos/${video.id}/view`, { played: 9, position: 9 }, { cookie: `tg_viewer=${cookie}` }), ctx(video.id));
    expect(await again.json()).toMatchObject({ counted: false, reason: 'duplicate' });
    expect(again.headers.get('set-cookie')).toBeNull();
    expect(await counts(video.id)).toEqual({ events: 1, viewCount: 1 });
    // the stored key is an HMAC, never the cookie value itself
    expect((await db.viewEvent.findFirstOrThrow()).viewerKey).not.toContain(cookie);
  });

  it('attaches the signed-in user and a document referrer', async () => {
    const { video, viewer } = await setup();
    await loginAs(viewer.id);
    const res = await viewRoute(post(`/api/videos/${video.id}/view`, { played: 6, position: 6, referrer: 'https://t.me/somewhere' }, { 'user-agent': MOBILE }), ctx(video.id));
    expect((await res.json()).counted).toBe(true);
    expect(await db.viewEvent.findFirstOrThrow()).toMatchObject({ userId: viewer.id, referrer: 't.me', device: 'MOBILE' });
  });

  it('answers 404 for private, draft and taken-down videos (and unknown ids)', async () => {
    const { owner } = await setup();
    logout();
    for (const state of ['private', 'draft', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      const res = await viewRoute(post(`/api/videos/${hidden.id}/view`, { played: 6, position: 6 }), ctx(hidden.id));
      expect(res.status, state).toBe(404);
    }
    expect((await viewRoute(post('/api/videos/aB3dE5gH7jK/view', { played: 6, position: 6 }), ctx('aB3dE5gH7jK'))).status).toBe(404);
    expect((await viewRoute(post('/api/videos/not-an-id/view', { played: 6, position: 6 }), ctx('not-an-id'))).status).toBe(404);
  });

  it('rejects requests from other origins (CSRF) and without an origin', async () => {
    const { video } = await setup();
    const evil = await viewRoute(post(`/api/videos/${video.id}/view`, { played: 6, position: 6 }, { origin: 'https://evil.example' }), ctx(video.id));
    expect(evil.status).toBe(403);
    const none = new NextRequest(`http://localhost:3000/api/videos/${video.id}/view`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'user-agent': CHROME } });
    expect((await viewRoute(none, ctx(video.id))).status).toBe(403);
    expect(await db.viewEvent.count()).toBe(0);
  });

  it('validates the body', async () => {
    const { video } = await setup();
    const bad = [{ played: -1, position: 0 }, { played: 'a', position: 0 }, { played: 5 }, { played: 1e9, position: 1 }];
    for (const body of bad) {
      expect((await viewRoute(post(`/api/videos/${video.id}/view`, body), ctx(video.id))).status, JSON.stringify(body)).toBe(422);
    }
    expect((await viewRoute(post(`/api/videos/${video.id}/view`, '{not json', {}, true), ctx(video.id))).status).toBe(400);
  });

  it('rate limits a viewer hammering one video', async () => {
    const { video } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await viewRoute(post(`/api/videos/${video.id}/view`, { played: 6, position: 6 }, { cookie: 'tg_viewer=abcdefghijklmnopqrstuv' }), ctx(video.id))).status);
    }
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(6)).toEqual([429, 429]);
    expect((await counts(video.id)).viewCount).toBe(1);
  });
});

describe('POST /api/videos/[id]/heartbeat', () => {
  it('adds clamped watch time for the viewer who owns the event', async () => {
    const { video } = await setup();
    logout();
    const view = await viewRoute(post(`/api/videos/${video.id}/view`, { played: 6, position: 6 }), ctx(video.id));
    const { viewId } = await view.json();
    const cookie = `tg_viewer=${cookieFrom(view)}`;
    // Backdate the last beat so a 15 s beat is plausible.
    await db.viewEvent.update({ where: { id: viewId }, data: { lastBeatAt: new Date(Date.now() - 15_000) } });
    const res = await heartbeatRoute(post(`/api/videos/${video.id}/heartbeat`, { viewId, delta: 15, position: 20 }, { cookie }), ctx(video.id));
    expect(res.status).toBe(200);
    expect((await res.json()).accepted).toBeGreaterThan(14);
    // inflation attempt right away: a second beat claiming 20 s immediately adds ~nothing
    const hack = await heartbeatRoute(post(`/api/videos/${video.id}/heartbeat`, { viewId, delta: 20, position: 20 }, { cookie }), ctx(video.id));
    expect((await hack.json()).accepted).toBeLessThan(1);
  });

  it('ignores a stranger who knows the view id', async () => {
    const { video } = await setup();
    logout();
    const view = await viewRoute(post(`/api/videos/${video.id}/view`, { played: 6, position: 6 }), ctx(video.id));
    const { viewId } = await view.json();
    await db.viewEvent.update({ where: { id: viewId }, data: { lastBeatAt: new Date(Date.now() - 15_000) } });
    const res = await heartbeatRoute(post(`/api/videos/${video.id}/heartbeat`, { viewId, delta: 15, position: 20 }, { cookie: 'tg_viewer=strangerstrangerstranger' }), ctx(video.id));
    expect((await res.json()).accepted).toBe(0);
  });

  it('answers 404 for hidden videos and validates input', async () => {
    const { owner, video } = await setup();
    logout();
    const hidden = await createVideo(owner.channel!.id, { state: 'private' });
    expect((await heartbeatRoute(post(`/api/videos/${hidden.id}/heartbeat`, { delta: 5, position: 5 }), ctx(hidden.id))).status).toBe(404);
    expect((await heartbeatRoute(post(`/api/videos/${video.id}/heartbeat`, { delta: -5, position: 5 }), ctx(video.id))).status).toBe(422);
    expect((await heartbeatRoute(post(`/api/videos/${video.id}/heartbeat`, { delta: 5, position: 5 }, { origin: 'https://evil.example' }), ctx(video.id))).status).toBe(403);
  });

  it('saves the resume position of a signed-in viewer', async () => {
    const { video, viewer } = await setup();
    await loginAs(viewer.id);
    const res = await heartbeatRoute(post(`/api/videos/${video.id}/heartbeat`, { delta: 0, position: 42 }), ctx(video.id));
    expect(res.status).toBe(200);
    expect((await db.watchHistory.findUniqueOrThrow({ where: { userId_videoId: { userId: viewer.id, videoId: video.id } } })).positionSeconds).toBe(42);
  });
});

describe('GET /api/videos/[id]/status', () => {
  const get = (id: string) =>
    statusRoute(new NextRequest(`http://localhost:3000/api/videos/${id}/status`), ctx(id));

  it('shows processing progress to the owner and moderators only', async () => {
    const { owner, viewer } = await setup();
    const processing = await createVideo(owner.channel!.id, { state: 'processing' });
    await db.transcodeJob.create({ data: { videoId: processing.id, status: 'ACTIVE', stage: 'TRANSCODE', progress: 42 } });

    await loginAs(owner.id);
    const res = await get(processing.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processingStatus: 'PROCESSING', progress: 42, stage: 'TRANSCODE' });

    const moderator = await createUser({ role: 'MODERATOR' });
    await loginAs(moderator.id);
    expect((await get(processing.id)).status).toBe(200);

    await loginAs(viewer.id);
    expect((await get(processing.id)).status).toBe(404);
    logout();
    expect((await get(processing.id)).status).toBe(404);
  });

  it('exposes the failure reason', async () => {
    const { owner } = await setup();
    const failed = await createVideo(owner.channel!.id, { state: 'failed' });
    await loginAs(owner.id);
    expect(await (await get(failed.id)).json()).toMatchObject({ processingStatus: 'FAILED', failureReason: 'test failure' });
  });
});
