import { apiHandler } from '@/lib/api';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { Errors } from '@/lib/errors';
import { parseSearchParams } from '@/lib/validation';
import { listRepliesQuerySchema } from '@/features/comments/schemas';
import { getReplyPage } from '@/features/comments/queries';

/**
 * GET /api/comments/[id]/replies?cursor=…&limit=10 → { items, nextCursor }
 *
 * Replies under a top-level comment, oldest first. 404 when the comment or its video is not visible to the viewer.
 */
export const GET = apiHandler<{ id: string }>(async (req, { params }) => {
  if (params.id.length < 10 || params.id.length > 40) throw Errors.notFound('دیدگاه پیدا نشد.');
  const q = parseSearchParams(req.nextUrl, listRepliesQuerySchema);
  const actor = toActor(await getCurrentUser());
  const page = await getReplyPage(params.id, actor, { cursor: q.cursor, limit: q.limit });
  return Response.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
});
