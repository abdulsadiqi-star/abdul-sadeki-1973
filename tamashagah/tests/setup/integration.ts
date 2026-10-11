import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { testDatabaseUrl } from '../helpers/test-env';
import { requestContext } from '../helpers/request-context';

// Environment must be fixed BEFORE any application module is imported.
Object.assign(process.env, { NODE_ENV: 'test' }); // NODE_ENV is typed read-only by Next
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET ??= 'integration-secret-0123456789abcdef0123456789abcdef';
process.env.APP_URL = 'http://localhost:3000';
process.env.MAIL_TRANSPORT = 'file';
process.env.MAIL_FILE_DIR = path.join(os.tmpdir(), `tg-mailbox-${process.pid}`);
process.env.STORAGE_DRIVER = 'fs';
process.env.STORAGE_FS_ROOT = path.join(os.tmpdir(), `tg-storage-${process.pid}`);
// Dedicated Redis database for tests (rate-limit counters, queues) — flushed before every test.
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
redisUrl.pathname = '/15';
process.env.REDIS_URL = redisUrl.toString();

// Next.js request-scoped APIs → in-memory request context.
vi.mock('next/headers', () => ({
  cookies: async () => requestContext.cookiesApi(),
  headers: async () => requestContext.headers,
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  },
}));

beforeAll(async () => {
  await fs.mkdir(process.env.MAIL_FILE_DIR!, { recursive: true });
});

beforeEach(async () => {
  const { resetDatabase } = await import('../helpers/db');
  await resetDatabase();
  requestContext.reset();
  const { resetMemoryRateLimits } = await import('@/lib/rate-limit');
  resetMemoryRateLimits();
  try {
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    if (redis.status === 'wait') await redis.connect();
    await redis.flushdb();
  } catch {
    /* Redis is optional for these tests: the limiter falls back to memory */
  }
  await fs.rm(process.env.MAIL_FILE_DIR!, { recursive: true, force: true });
  await fs.mkdir(process.env.MAIL_FILE_DIR!, { recursive: true });
});

afterAll(async () => {
  const { db } = await import('@/lib/db');
  await db.$disconnect();
  const { getRedis } = await import('@/lib/redis');
  await getRedis().quit().catch(() => undefined);
  await fs.rm(process.env.MAIL_FILE_DIR!, { recursive: true, force: true });
  await fs.rm(process.env.STORAGE_FS_ROOT!, { recursive: true, force: true });
});
