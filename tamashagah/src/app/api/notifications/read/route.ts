import { z } from 'zod';
import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth/guards';
import { parseJsonBody } from '@/lib/validation';
import { countUnreadNotifications, markNotificationsRead } from '@/features/notifications/queries';

const bodySchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(100) }),
]);

/** POST /api/notifications/read  { all: true } | { ids: [...] } → { unreadCount } */
export const POST = apiHandler(async (req) => {
  const user = await requireUser();
  const body = await parseJsonBody(req, bodySchema);
  await markNotificationsRead(user.id, 'ids' in body ? body.ids : undefined);
  return { unreadCount: await countUnreadNotifications(user.id) };
});
