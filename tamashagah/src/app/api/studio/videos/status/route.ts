import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { requireChannelUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseSearchParams } from '@/lib/validation';
import { studioLimits } from '@/features/videos-studio/limits';
import { loadVideoStatuses } from '@/features/videos-studio/queries';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ids: z
    .string()
    .max(30 * 12)
    .transform((s) => [...new Set(s.split(',').filter(Boolean))])
    .pipe(z.array(z.string().regex(VIDEO_ID_REGEX)).min(1).max(30)),
});

/**
 * GET /api/studio/videos/status?ids=a,b,c → `{ items: [...] }` — the batch variant used by the video list so that all
 * processing cards share ONE poll. Ids the caller may not manage are silently absent.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireChannelUser();
  await enforceRateLimit('studio:status', user.id, studioLimits.status);
  const { ids } = parseSearchParams(req.nextUrl, querySchema);
  const items = await loadVideoStatuses(toActor(user), ids);
  return Response.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } });
});
