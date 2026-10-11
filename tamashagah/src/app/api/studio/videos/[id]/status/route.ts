import { apiHandler } from '@/lib/api';
import { requireChannelUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { Errors } from '@/lib/errors';
import { isVideoId } from '@/lib/ids';
import { enforceRateLimit } from '@/lib/rate-limit';
import { studioLimits } from '@/features/videos-studio/limits';
import { loadVideoStatus } from '@/features/videos-studio/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/studio/videos/[id]/status → processing state of one video (polled by the upload and edit pages).
 * Only people who may manage the video get an answer; everybody else gets the same 404 as for a missing id.
 */
export const GET = apiHandler<{ id: string }>(async (_req, { params }) => {
  const user = await requireChannelUser();
  await enforceRateLimit('studio:status', user.id, studioLimits.status);
  if (!isVideoId(params.id)) throw Errors.notFound();
  const status = await loadVideoStatus(toActor(user), params.id);
  if (!status) throw Errors.notFound();
  return Response.json(status, { headers: { 'Cache-Control': 'private, no-store' } });
});
