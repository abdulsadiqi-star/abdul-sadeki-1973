/**
 * Redis access (ioredis). Used for rate limiting, small caches and BullMQ.
 *
 * - `getRedis()`        shared connection for the app (lazy, auto-reconnect)
 * - `createBullConnection()` dedicated connection for BullMQ (maxRetriesPerRequest: null)
 *
 * Redis is an optimisation for the app (rate limiting falls back to memory in
 * development) but a hard requirement for the video queue.
 */
import { Redis } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

const globalForRedis = globalThis as unknown as { __redis?: Redis };

export function getRedis(): Redis {
  if (!globalForRedis.__redis) {
    const client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 200, 3_000),
    });
    client.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
    globalForRedis.__redis = client;
  }
  return globalForRedis.__redis;
}

/** A fresh connection suitable for BullMQ Queue/Worker/QueueEvents. */
export function createBullConnection(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  });
  client.on('error', (err) => logger.warn({ err: err.message }, 'redis(bull) error'));
  return client;
}

/** True when Redis answers PING within the timeout. Never throws. */
export async function isRedisHealthy(timeoutMs = 1_000): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status === 'wait') await redis.connect();
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}
