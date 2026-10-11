import { apiHandler } from '@/lib/api';
import { handleTusRequest } from '@/features/uploads/tus';

export const dynamic = 'force-dynamic';

/**
 * tus endpoint — one upload: HEAD (offset), PATCH (bytes), DELETE (cancel). The owner check happens inside the tus
 * server (`onIncomingRequest`); anything that is not the caller's own unfinished upload is a 404.
 */
const handler = apiHandler<{ id: string }>(async (req) => handleTusRequest(req));

export { handler as GET, handler as HEAD, handler as PATCH, handler as DELETE, handler as OPTIONS };
