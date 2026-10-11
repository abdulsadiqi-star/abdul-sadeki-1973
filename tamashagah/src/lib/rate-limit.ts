/**
 * Fixed-window rate limiter backed by Redis (atomic Lua), with an in-memory
 * fallback when Redis is unreachable so a Redis outage never takes the site down.
 *
 *   await enforceRateLimit('login:ip', ip, limits.login);        // throws AppError(RATE_LIMITED)
 *   const r = await rateLimit('comment:user', userId, limits.comment);
 */
import { Errors } from './errors';
import { logger } from './logger';
import { getRedis } from './redis';

export type RateLimitRule = { limit: number; windowSeconds: number };
export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
};

/** Central catalogue so limits are tuned in one place. */
export const limits = {
  login: { limit: 10, windowSeconds: 10 * 60 },
  loginPerAccount: { limit: 8, windowSeconds: 15 * 60 },
  register: { limit: 5, windowSeconds: 60 * 60 },
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  resendVerification: { limit: 3, windowSeconds: 60 * 60 },
  comment: { limit: 12, windowSeconds: 5 * 60 },
  report: { limit: 10, windowSeconds: 60 * 60 },
  like: { limit: 120, windowSeconds: 60 },
  follow: { limit: 60, windowSeconds: 60 },
  view: { limit: 120, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  uploadCreate: { limit: 20, windowSeconds: 60 * 60 },
  ticket: { limit: 5, windowSeconds: 60 * 60 },
  generalWrite: { limit: 60, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {c, ttl}
`;

type MemoryEntry = { count: number; resetAt: number };
const memory = new Map<string, MemoryEntry>();
let lastFallbackWarning = 0;

function memoryLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + rule.windowSeconds * 1000 };
    memory.set(key, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - entry.count),
    resetInSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export async function rateLimit(bucket: string, identifier: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const key = `rl:${bucket}:${identifier}`;
  try {
    const redis = getRedis();
    if (redis.status === 'wait') await redis.connect();
    const [count, ttl] = (await redis.eval(LUA, 1, key, String(rule.windowSeconds))) as [number, number];
    return {
      allowed: count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetInSeconds: ttl > 0 ? ttl : rule.windowSeconds,
    };
  } catch (err) {
    if (Date.now() - lastFallbackWarning > 60_000) {
      lastFallbackWarning = Date.now();
      logger.warn({ err: (err as Error).message }, 'rate limiter falling back to in-memory store');
    }
    return memoryLimit(key, rule);
  }
}

/**
 * Per-client limit. The client IP is only known behind a trusted proxy (TRUSTED_PROXY_HOPS > 0); when it is
 * unknown a strict per-IP rule would lump ALL visitors into one bucket, so a generous shared bucket is used
 * instead (per-account limits still protect individual accounts).
 */
export async function enforceClientRateLimit(bucket: string, ip: string | null, rule: RateLimitRule): Promise<void> {
  if (ip) return enforceRateLimit(`${bucket}:ip`, ip, rule);
  return enforceRateLimit(`${bucket}:shared`, 'all', { limit: rule.limit * 25, windowSeconds: rule.windowSeconds });
}

/** Throws `AppError('RATE_LIMITED')` when the rule is exceeded. */
export async function enforceRateLimit(bucket: string, identifier: string, rule: RateLimitRule): Promise<void> {
  const result = await rateLimit(bucket, identifier, rule);
  if (!result.allowed) throw Errors.rateLimited(result.resetInSeconds);
}

/** Test helper. */
export function resetMemoryRateLimits(): void {
  memory.clear();
}
