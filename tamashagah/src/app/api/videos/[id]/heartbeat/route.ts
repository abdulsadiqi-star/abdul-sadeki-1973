import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { Errors } from '@/lib/errors';
import { isVideoId } from '@/lib/ids';
import { enforceClientRateLimit, enforceRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request';
import { parseJsonBody } from '@/lib/validation';
import { watchLimits } from '@/features/watch/limits';
import { recordHeartbeat } from '@/features/watch/view-service';
import { resolveViewer, setViewerCookie } from '@/features/watch/viewer';

const bodySchema = z.object({
  /** Id returned by /view (absent until the view threshold is reached). */
  viewId: z.string().min(10).max(40).nullish(),
  /** Seconds played since the previous heartbeat. Untrusted: the server clamps it by elapsed wall time. */
  delta: z.number().min(0).max(600),
  position: z.number().min(0).max(864_000),
});

/**
 * POST /api/videos/[id]/heartbeat  { viewId?, delta, position } → { accepted }
 *
 * Sent every ~15 s while playing and via `navigator.sendBeacon` on pause / unload. Adds clamped watch time to
 * the viewer's own ViewEvent and saves the resume position for signed-in users. 404 for hidden videos.
 */
export const POST = apiHandler<{ id: string }>(async (req, { params }) => {
  if (!isVideoId(params.id)) throw Errors.notFound('ویدیو پیدا نشد.');
  const body = await parseJsonBody(req, bodySchema, 4_096);
  const actor = toActor(await getCurrentUser());
  const viewer = resolveViewer(req);

  await enforceClientRateLimit('heartbeat', getClientIp(req.headers), watchLimits.heartbeatPerIp);
  await enforceRateLimit('heartbeat:viewer', viewer.key, watchLimits.heartbeatPerViewer);

  const result = await recordHeartbeat({
    videoId: params.id,
    actor,
    viewerKey: viewer.key,
    viewId: body.viewId ?? null,
    deltaSeconds: body.delta,
    positionSeconds: body.position,
  });

  const res = NextResponse.json(result);
  res.headers.set('Cache-Control', 'private, no-store');
  setViewerCookie(res, viewer);
  return res;
});
