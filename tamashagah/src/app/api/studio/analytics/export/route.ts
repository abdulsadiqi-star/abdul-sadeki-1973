import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { requireChannelUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseSearchParams } from '@/lib/validation';
import { resolveRange } from '@/lib/analytics/ranges';
import { exportFileName, seriesToCsv, videosToCsv } from '@/features/analytics/export';
import { analyticsLimits } from '@/features/analytics/limits';
import { getAnalyticsOverview, listAllVideoPerformance } from '@/features/analytics/queries';
import { analyticsQuerySchema, PRESET_BY_QUERY } from '@/features/analytics/schemas';

export const dynamic = 'force-dynamic';

const exportQuerySchema = analyticsQuerySchema.pick({ range: true, from: true, to: true, granularity: true, video: true }).extend({
  type: z.enum(['series', 'videos']).default('series'),
});

/**
 * GET /api/studio/analytics/export?range=30d&type=series|videos[&video=<id>]
 *
 * Owner only: the channel is ALWAYS the signed-in user's channel — there is no channel parameter, and a `video`
 * that is not theirs answers 404. The file is built from the same aggregations as the page.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireChannelUser();
  await enforceRateLimit('analytics-export:user', user.id, analyticsLimits.export);
  const query = parseSearchParams(req.nextUrl, exportQuerySchema);

  const range = resolveRange({ preset: PRESET_BY_QUERY[query.range], from: query.from, to: query.to, granularity: query.granularity });
  const channelId = user.channel.id;

  let csv: string;
  if (query.type === 'videos') {
    csv = videosToCsv(await listAllVideoPerformance(channelId, range));
  } else {
    const overview = await getAnalyticsOverview({ channelId, videoId: query.video }, range);
    csv = seriesToCsv(overview.series, { channelLevel: overview.video === null });
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(user.channel.handle, range.fromKey, range.toKey, query.type)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
