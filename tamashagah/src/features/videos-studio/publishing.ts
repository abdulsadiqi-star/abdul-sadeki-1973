/**
 * Publishing rules, in one place — used by the worker (when a transcode finishes, by the scheduler) and by the studio
 * (edit form, bulk actions). Runtime-agnostic: no `next/*`, no `server-only`.
 *
 * Three axes are independent (see docs/architecture.md): processingStatus, publishStatus, visibility. This module
 * only moves `publishStatus` / `publishedAt` / `scheduledFor` / `publishOnReady`.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isListedPublicly } from '@/lib/permissions';
import { notify, notifyMany } from '@/features/notifications/service';
import type { ProcessingStatus, PublishStatus } from '@/generated/prisma/enums';

const log = logger.child({ module: 'publishing' });

// ---------------------------------------------------------------------------
// Decisions (pure)
// ---------------------------------------------------------------------------

export type PublishIntent = { publishOnReady: boolean; scheduledFor: Date | null };
export type PublishDecision = { publishStatus: PublishStatus; publishedAt: Date | null; scheduledFor: Date | null };

/**
 * What happens to a video the moment its processing succeeds:
 *  - a schedule in the future → SCHEDULED (the scheduler publishes it when the time comes)
 *  - a schedule that already passed → PUBLISHED now (the creator wanted it live by then)
 *  - `publishOnReady` → PUBLISHED now
 *  - otherwise it stays a DRAFT until the creator publishes it
 */
export function decidePublishOnReady(intent: PublishIntent, now: Date = new Date()): PublishDecision {
  if (intent.scheduledFor && intent.scheduledFor.getTime() > now.getTime()) {
    return { publishStatus: 'SCHEDULED', publishedAt: null, scheduledFor: intent.scheduledFor };
  }
  if (intent.scheduledFor || intent.publishOnReady) {
    return { publishStatus: 'PUBLISHED', publishedAt: now, scheduledFor: null };
  }
  return { publishStatus: 'DRAFT', publishedAt: null, scheduledFor: null };
}

/** What the creator asks for in the studio. */
export type PublishRequest = { mode: 'PUBLISH' | 'SCHEDULE' | 'DRAFT'; scheduledFor?: Date | null };

export type PublishCurrent = {
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  publishedAt: Date | null;
};

export type PublishUpdate = {
  publishOnReady: boolean;
  scheduledFor: Date | null;
  publishStatus: PublishStatus;
  publishedAt: Date | null;
  /** True when this change makes a previously unpublished video live (→ notify followers, creator). */
  becamePublished: boolean;
};

/**
 * Translate a studio request into the fields to write. Videos that are not READY yet only record the creator's
 * intent (`publishOnReady` / `scheduledFor`): the worker applies it when processing finishes.
 */
export function computePublishUpdate(current: PublishCurrent, request: PublishRequest, now: Date = new Date()): PublishUpdate {
  const ready = current.processingStatus === 'READY';

  if (request.mode === 'SCHEDULE') {
    const at = request.scheduledFor ?? null;
    if (!at) throw new Error('A schedule needs a time');
    return {
      publishOnReady: false,
      scheduledFor: at,
      publishStatus: 'SCHEDULED',
      publishedAt: null,
      becamePublished: false,
    };
  }

  if (request.mode === 'DRAFT') {
    return { publishOnReady: false, scheduledFor: null, publishStatus: 'DRAFT', publishedAt: null, becamePublished: false };
  }

  // PUBLISH
  if (!ready) {
    return {
      publishOnReady: true,
      scheduledFor: null,
      publishStatus: current.publishStatus === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
      publishedAt: current.publishedAt,
      becamePublished: false,
    };
  }
  return {
    publishOnReady: true,
    scheduledFor: null,
    publishStatus: 'PUBLISHED',
    publishedAt: current.publishedAt ?? now,
    becamePublished: current.publishStatus !== 'PUBLISHED',
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const FAN_OUT_BATCH = 500;

/**
 * Tell followers (who kept notifications on) about a video that just became publicly published. Runs at most once
 * per video: a NEW_VIDEO notification for the video is the marker. Returns how many notifications were created.
 */
export async function fanOutNewVideo(videoId: string): Promise<number> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      channelId: true,
      visibility: true,
      publishStatus: true,
      processingStatus: true,
      takedownAt: true,
      channel: { select: { name: true, ownerId: true, suspendedAt: true } },
    },
  });
  if (!video) return 0;
  const listed = isListedPublicly({
    channelId: video.channelId,
    visibility: video.visibility,
    publishStatus: video.publishStatus,
    processingStatus: video.processingStatus,
    takedownAt: video.takedownAt,
    channelSuspendedAt: video.channel.suspendedAt,
  });
  if (!listed) return 0;

  const already = await db.notification.findFirst({ where: { type: 'NEW_VIDEO', videoId }, select: { id: true } });
  if (already) return 0;

  let total = 0;
  let cursor: string | undefined;
  for (;;) {
    const followers = await db.follow.findMany({
      where: { channelId: video.channelId, notify: true },
      orderBy: { userId: 'asc' },
      take: FAN_OUT_BATCH,
      ...(cursor ? { cursor: { userId_channelId: { userId: cursor, channelId: video.channelId } }, skip: 1 } : {}),
      select: { userId: true },
    });
    if (followers.length === 0) break;
    await notifyMany(
      followers.map((f) => ({
        userId: f.userId,
        type: 'NEW_VIDEO' as const,
        title: `${video.channel.name} ویدیوی جدیدی منتشر کرد`,
        body: video.title,
        href: `/watch/${video.id}`,
        actorId: video.channel.ownerId,
        channelId: video.channelId,
        videoId: video.id,
      })),
    );
    total += followers.length;
    if (followers.length < FAN_OUT_BATCH) break;
    cursor = followers[followers.length - 1]!.userId;
  }
  log.info({ videoId, recipients: total }, 'new-video notifications sent');
  return total;
}

/** Creator-facing "your video went live" notice for scheduled publishing. */
export async function notifyScheduledPublished(video: { id: string; title: string; channelId: string; ownerId: string }): Promise<void> {
  await notify({
    userId: video.ownerId,
    type: 'VIDEO_PUBLISHED',
    title: `ویدیوی «${video.title}» در زمان مقرر منتشر شد`,
    href: `/watch/${video.id}`,
    channelId: video.channelId,
    videoId: video.id,
  });
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Publish every scheduled video whose time has come. Only READY videos can go live (a SCHEDULED video that is still
 * processing is published by the worker the moment it becomes READY). Safe to run concurrently and repeatedly.
 */
export async function publishDueScheduledVideos(now: Date = new Date(), limit = 200): Promise<number> {
  const due = await db.video.findMany({
    where: { publishStatus: 'SCHEDULED', processingStatus: 'READY', scheduledFor: { lte: now } },
    orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, title: true, channelId: true, channel: { select: { ownerId: true } } },
  });

  let published = 0;
  for (const video of due) {
    // The guard on publishStatus makes this idempotent: a concurrent run flips each row at most once.
    const { count } = await db.video.updateMany({
      where: { id: video.id, publishStatus: 'SCHEDULED', scheduledFor: { lte: now } },
      data: { publishStatus: 'PUBLISHED', publishedAt: now, scheduledFor: null },
    });
    if (count === 0) continue;
    published++;
    try {
      await notifyScheduledPublished({ id: video.id, title: video.title, channelId: video.channelId, ownerId: video.channel.ownerId });
      await fanOutNewVideo(video.id);
    } catch (err) {
      log.error({ err, videoId: video.id }, 'notifications after scheduled publish failed');
    }
  }
  if (published > 0) log.info({ published }, 'scheduled videos published');
  return published;
}
