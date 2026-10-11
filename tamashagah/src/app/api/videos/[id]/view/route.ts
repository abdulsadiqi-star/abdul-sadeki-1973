import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { Errors } from '@/lib/errors';
import { isVideoId } from '@/lib/ids';
import { enforceClientRateLimit, enforceRateLimit, limits } from '@/lib/rate-limit';
import { getClientIp, getUserAgent } from '@/lib/request';
import { parseJsonBody } from '@/lib/validation';
import { watchLimits } from '@/features/watch/limits';
import { recordView } from '@/features/watch/view-service';
import { resolveViewer, setViewerCookie } from '@/features/watch/viewer';

const bodySchema = z.object({
  /** Seconds the player has really played in this session. */
  played: z.number().min(0).max(86_400),
  position: z.number().min(0).max(864_000),
  /** `document.referrer` of the watch page (reduced to a host on the server). */
  referrer: z.string().max(300).optional(),
});

/**
 * POST /api/videos/[id]/view  { played, position, referrer? } → { counted, viewId, reason? }
 *
 * Sent once by the player after the playback threshold (≥ 5 s, or 25 % of videos shorter than 20 s). One view
 * per viewer per video per 30 minutes; 404 for videos the viewer may not see. See features/watch/view-service.ts.
 */
export const POST = apiHandler<{ id: string }>(async (req, { params }) => {
  if (!isVideoId(params.id)) throw Errors.notFound('ویدیو پیدا نشد.');
  const body = await parseJsonBody(req, bodySchema, 4_096);
  const actor = toActor(await getCurrentUser());
  const viewer = resolveViewer(req);

  await enforceClientRateLimit('view', getClientIp(req.headers), limits.view);
  await enforceRateLimit('view:viewer', `${viewer.key}:${params.id}`, watchLimits.viewPerViewer);

  const result = await recordView({
    videoId: params.id,
    actor,
    viewerKey: viewer.key,
    userAgent: getUserAgent(req.headers),
    referrer: body.referrer ?? null,
    selfHost: new URL(env.APP_URL).hostname,
    playedSeconds: body.played,
    positionSeconds: body.position,
  });

  const res = NextResponse.json(result);
  res.headers.set('Cache-Control', 'private, no-store');
  setViewerCookie(res, viewer);
  return res;
});
