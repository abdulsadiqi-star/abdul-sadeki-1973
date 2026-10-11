import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { normalizeSearchText } from '@/lib/persian';
import { enforceClientRateLimit, limits } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request';
import { parse } from '@/lib/validation';
import { SEARCH_QUERY_MAX } from '@/features/search/schemas';
import { SUGGEST_MIN_LENGTH, suggest } from '@/features/search/queries';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ q: z.string().max(SEARCH_QUERY_MAX).default('') });

/**
 * GET /api/search/suggest?q=…  →  { items: Suggestion[] }  (≤ 8 items: public video titles and channels)
 * Needs at least 2 characters after normalization; rate-limited per client; only public videos are ever suggested.
 */
export const GET = apiHandler(async (req) => {
  const { q } = parse(querySchema, { q: req.nextUrl.searchParams.get('q') ?? undefined });
  if (normalizeSearchText(q).length < SUGGEST_MIN_LENGTH) {
    return Response.json({ items: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  await enforceClientRateLimit('search:suggest', getClientIp(req.headers), limits.search);
  const items = await suggest(q);
  return Response.json({ items }, { headers: { 'Cache-Control': 'private, max-age=20' } });
});
