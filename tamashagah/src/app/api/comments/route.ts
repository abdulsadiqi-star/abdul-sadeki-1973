import { apiHandler } from '@/lib/api';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { parseSearchParams } from '@/lib/validation';
import { listCommentsQuerySchema } from '@/features/comments/schemas';
import { getCommentPage } from '@/features/comments/queries';

/**
 * GET /api/comments?videoId=…&cursor=…&limit=20 → { items, nextCursor, total, disabled? }
 *
 * Top-level comments, newest first. Public comments only, plus the signed-in viewer's own held (PENDING) one.
 * 404 for videos the viewer may not see (private, draft, taken down, …).
 */
export const GET = apiHandler(async (req) => {
  const q = parseSearchParams(req.nextUrl, listCommentsQuerySchema);
  const actor = toActor(await getCurrentUser());
  const page = await getCommentPage(q.videoId, actor, { cursor: q.cursor, limit: q.limit });
  return Response.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
});
