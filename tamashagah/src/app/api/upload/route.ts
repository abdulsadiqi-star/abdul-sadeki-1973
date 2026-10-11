import { apiHandler } from '@/lib/api';
import { handleTusRequest } from '@/features/uploads/tus';

export const dynamic = 'force-dynamic';

/**
 * tus endpoint — creation (POST /api/upload) and capability discovery (OPTIONS).
 * See `features/uploads/tus.ts` for the protocol handling, authorization and quotas.
 * `apiHandler` adds the Origin (CSRF) check for POST; the tus server does the rest.
 */
const handler = apiHandler(async (req) => handleTusRequest(req));

export { handler as GET, handler as POST, handler as OPTIONS, handler as HEAD };
