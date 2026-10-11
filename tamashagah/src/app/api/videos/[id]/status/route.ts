import { apiHandler } from '@/lib/api';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { isVideoId } from '@/lib/ids';
import { canManageVideo } from '@/lib/permissions';
import { enforceRateLimit } from '@/lib/rate-limit';
import { watchLimits } from '@/features/watch/limits';

/**
 * GET /api/videos/[id]/status → processing state for the owner / moderators (polled by the watch page's status
 * panel while a video is still being processed). Everybody else gets a plain 404, exactly like the page.
 */
export const GET = apiHandler<{ id: string }>(async (_req, { params }) => {
  if (!isVideoId(params.id)) throw Errors.notFound('ویدیو پیدا نشد.');
  const actor = toActor(await getCurrentUser());
  if (!actor) throw Errors.notFound('ویدیو پیدا نشد.');
  await enforceRateLimit('video-status:user', actor.id, watchLimits.statusPoll);

  const video = await db.video.findUnique({
    where: { id: params.id },
    select: {
      channelId: true,
      processingStatus: true,
      publishStatus: true,
      failureReason: true,
      jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, stage: true, progress: true, error: true } },
    },
  });
  if (!video || !canManageVideo(actor, video)) throw Errors.notFound('ویدیو پیدا نشد.');

  const job = video.jobs[0] ?? null;
  return Response.json(
    {
      processingStatus: video.processingStatus,
      publishStatus: video.publishStatus,
      progress: job?.progress ?? 0,
      stage: job?.stage ?? null,
      failureReason: video.failureReason ?? job?.error ?? null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
