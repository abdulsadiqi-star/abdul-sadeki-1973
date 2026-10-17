import { db } from '@/lib/db';
import { isRedisHealthy } from '@/lib/redis';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Health probe.
 *   GET /api/health         liveness  — the process is up (always 200, no dependencies touched)
 *   GET /api/health?deep=1  readiness — PostgreSQL, Redis and object storage must answer (503 otherwise)
 * Never reveals versions, hostnames or error details.
 */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (new URL(request.url).searchParams.get('deep') !== '1') {
    return Response.json({ status: 'ok' }, { headers });
  }

  const check = async (fn: () => Promise<unknown>) => {
    try {
      await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3_000))]);
      return true;
    } catch {
      return false;
    }
  };

  const [database, redis, storage] = await Promise.all([
    check(() => db.$queryRaw`SELECT 1`),
    isRedisHealthy(2_000),
    // head() on a key that does not exist still proves credentials/connectivity (returns null).
    check(() => getStorage().head('health/probe')),
  ]);
  const ok = database && redis && storage;
  return Response.json({ status: ok ? 'ok' : 'degraded', checks: { database, redis, storage } }, { status: ok ? 200 : 503, headers });
}
