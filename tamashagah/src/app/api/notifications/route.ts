import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth/guards';
import { parseSearchParams } from '@/lib/validation';
import { countUnreadNotifications, listNotifications } from '@/features/notifications/queries';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().min(1).max(40).optional(),
  unread: z.enum(['1', '0']).optional(),
});

/** GET /api/notifications?limit=10&cursor=<id>&unread=1 → { items, nextCursor, unreadCount } */
export const GET = apiHandler(async (req) => {
  const user = await requireUser();
  const q = parseSearchParams(req.nextUrl, querySchema);
  const [page, unreadCount] = await Promise.all([
    listNotifications(user.id, { limit: q.limit, cursor: q.cursor, unreadOnly: q.unread === '1' }),
    countUnreadNotifications(user.id),
  ]);
  return Response.json({ ...page, unreadCount }, { headers: { 'Cache-Control': 'private, no-store' } });
});
