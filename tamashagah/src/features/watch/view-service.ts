/**
 * View counting, watch-time heartbeats and watch history.
 *
 * Runtime-agnostic (no next/* imports): the Route Handlers resolve the viewer (cookie, session, user agent) and
 * hand plain values in, which keeps every rule testable against the real database (tests/integration/views.test.ts).
 *
 * Guarantees
 *  - 404 (never 403) for videos the viewer may not see, on every entry point.
 *  - At most ONE ViewEvent per viewer (cookie key OR user id) + video per 30 minutes; the check and the insert
 *    run under an advisory lock, so two tabs / a double-fired request cannot both count.
 *  - `Video.viewCount` is incremented in the SAME transaction as the ViewEvent insert.
 *  - Watch time only grows through `clampHeartbeatSeconds` (bounded by real elapsed time), see view-rules.ts.
 *  - Only publicly watchable videos produce ViewEvents; an owner/moderator previewing a draft/private video
 *    still gets their own resume position saved.
 */
import { db } from '@/lib/db';
import type { Actor } from '@/lib/permissions';
import { detectDevice, referrerHost } from '@/lib/request';
import type { Prisma } from '@/generated/prisma/client';
import { loadViewableVideo } from './access';
import {
  VIEW_DEDUPE_WINDOW_MS,
  clampFirstReportSeconds,
  clampHeartbeatSeconds,
  clampPosition,
  hasReachedViewThreshold,
  isCompleted,
  isLikelyBot,
} from './view-rules';

type Tx = Prisma.TransactionClient;

/** Upsert the user's watch history row atomically (position is "last wins"; watched seconds accumulate; completed is sticky). */
async function touchHistory(
  client: Tx | typeof db,
  p: { userId: string; videoId: string; positionSeconds: number; watchedDeltaSeconds: number; durationSeconds: number | null; now: Date },
): Promise<void> {
  const completed = isCompleted(p.positionSeconds, p.durationSeconds);
  await client.$executeRaw`
    INSERT INTO "WatchHistory" ("userId", "videoId", "positionSeconds", "watchedSeconds", "completed", "firstWatchedAt", "lastWatchedAt")
    VALUES (${p.userId}, ${p.videoId}, ${p.positionSeconds}, ${p.watchedDeltaSeconds}, ${completed}, ${p.now}, ${p.now})
    ON CONFLICT ("userId", "videoId") DO UPDATE SET
      "positionSeconds" = EXCLUDED."positionSeconds",
      "watchedSeconds" = "WatchHistory"."watchedSeconds" + EXCLUDED."watchedSeconds",
      "completed" = "WatchHistory"."completed" OR EXCLUDED."completed",
      "lastWatchedAt" = EXCLUDED."lastWatchedAt"`;
}

export type RecordViewInput = {
  videoId: string;
  /** null = visitor. */
  actor: Actor;
  /** HMAC of the random viewer cookie (see viewer.ts). */
  viewerKey: string;
  userAgent: string | null;
  /** Raw `document.referrer` reported by the player (reduced to a host here). */
  referrer: string | null;
  /** Our own hostname, so internal navigation is labelled "internal". */
  selfHost?: string;
  /** Seconds the player really played before calling. */
  playedSeconds: number;
  positionSeconds: number;
  now?: Date;
};

export type RecordViewResult = {
  counted: boolean;
  /** Id to attach heartbeats to (also returned for a de-duplicated view so watch time keeps accruing). */
  viewId: string | null;
  reason?: 'bot' | 'duplicate' | 'not-public' | 'below-threshold';
};

export async function recordView(input: RecordViewInput): Promise<RecordViewResult> {
  const video = await loadViewableVideo(input.videoId, input.actor); // 404 first: bots must not learn what exists
  const now = input.now ?? new Date();
  const userId = input.actor?.id ?? null;
  const position = clampPosition(input.positionSeconds, video.durationSeconds);

  if (isLikelyBot(input.userAgent)) return { counted: false, viewId: null, reason: 'bot' };

  if (!video.publiclyWatchable) {
    if (userId) {
      await touchHistory(db, { userId, videoId: video.id, positionSeconds: position, watchedDeltaSeconds: 0, durationSeconds: video.durationSeconds, now });
    }
    return { counted: false, viewId: null, reason: 'not-public' };
  }
  if (!hasReachedViewThreshold(input.playedSeconds, video.durationSeconds)) {
    return { counted: false, viewId: null, reason: 'below-threshold' };
  }

  const initialSeconds = clampFirstReportSeconds(input.playedSeconds, video.durationSeconds);
  const device = detectDevice(input.userAgent);
  const referrer = referrerHost(input.referrer, input.selfHost);

  return db.$transaction(async (tx) => {
    // Serialize concurrent views of the same viewer + video (two tabs, a retried request).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`view:${video.id}:${input.viewerKey}`}, 0))`;

    const existing = await tx.viewEvent.findFirst({
      where: {
        videoId: video.id,
        createdAt: { gt: new Date(now.getTime() - VIEW_DEDUPE_WINDOW_MS) },
        OR: [{ viewerKey: input.viewerKey }, ...(userId ? [{ userId }] : [])],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true },
    });

    if (existing) {
      // Same viewer inside the window: not a new view, but the player keeps reporting watch time on this event.
      await tx.viewEvent.update({
        where: { id: existing.id },
        data: { lastBeatAt: now, ...(userId && !existing.userId ? { userId } : {}) },
      });
      if (userId) {
        await touchHistory(tx, { userId, videoId: video.id, positionSeconds: position, watchedDeltaSeconds: 0, durationSeconds: video.durationSeconds, now });
      }
      return { counted: false, viewId: existing.id, reason: 'duplicate' as const };
    }

    const event = await tx.viewEvent.create({
      data: {
        videoId: video.id,
        channelId: video.channelId,
        userId,
        viewerKey: input.viewerKey,
        watchSeconds: initialSeconds,
        device,
        referrer,
        source: 'REAL',
        createdAt: now,
        lastBeatAt: now,
      },
      select: { id: true },
    });
    await tx.video.update({ where: { id: video.id }, data: { viewCount: { increment: 1 } } });
    if (userId) {
      await touchHistory(tx, { userId, videoId: video.id, positionSeconds: position, watchedDeltaSeconds: initialSeconds, durationSeconds: video.durationSeconds, now });
    }
    return { counted: true, viewId: event.id };
  });
}

export type RecordHeartbeatInput = {
  videoId: string;
  actor: Actor;
  viewerKey: string;
  /** Id returned by the view call (absent when the threshold was not reached yet, e.g. a pause beacon). */
  viewId?: string | null;
  /** Seconds the player says it played since its previous heartbeat (untrusted, clamped). */
  deltaSeconds: number;
  positionSeconds: number;
  now?: Date;
};

export async function recordHeartbeat(input: RecordHeartbeatInput): Promise<{ accepted: number }> {
  const video = await loadViewableVideo(input.videoId, input.actor);
  const now = input.now ?? new Date();
  const userId = input.actor?.id ?? null;
  const position = clampPosition(input.positionSeconds, video.durationSeconds);

  let accepted = 0;
  // Bots never get a viewId (their view call is refused), and anybody else must prove ownership of the event
  // with their viewer key or user id below, so no extra bot check is needed here.
  if (input.viewId && video.publiclyWatchable) {
    const viewId = input.viewId;
    accepted = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hb:${viewId}`}, 0))`;
      const event = await tx.viewEvent.findFirst({
        where: { id: viewId, videoId: video.id, OR: [{ viewerKey: input.viewerKey }, ...(userId ? [{ userId }] : [])] },
        select: { lastBeatAt: true },
      });
      if (!event) return 0; // not this viewer's event (or unknown id): ignore silently
      const add = clampHeartbeatSeconds({ reportedSeconds: input.deltaSeconds, elapsedMs: now.getTime() - event.lastBeatAt.getTime() });
      await tx.viewEvent.update({ where: { id: viewId }, data: { watchSeconds: { increment: add }, lastBeatAt: now } });
      return add;
    });
  }

  if (userId) {
    await touchHistory(db, { userId, videoId: video.id, positionSeconds: position, watchedDeltaSeconds: accepted, durationSeconds: video.durationSeconds, now });
  }
  return { accepted };
}
