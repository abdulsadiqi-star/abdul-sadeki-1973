/**
 * Redis lease locker for the tus server (`@tus/server` `Locker`).
 *
 * tus must never let two requests write the same upload at once (a client that lost its connection retries while the
 * old PATCH may still be streaming). The lock is a Redis key with a TTL ("lease") that its holder renews while it works,
 * so a crashed instance cannot block an upload for longer than the TTL. Works across several app instances.
 *
 * Contention is cooperative, as the tus protocol wants: a request that cannot get the lock publishes a "please
 * release" message on a Redis channel; the holder's `requestRelease()` then cancels its (stale) request, which lets
 * the new one proceed quickly instead of waiting for a half-open TCP connection to time out.
 */
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ERRORS, type Lock, type Locker, type RequestRelease } from '@tus/server';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'tus-locker' });

const RENEW_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export type RedisLockerOptions = {
  /** Connection for commands (shared, lazily connected). */
  redis: () => Redis;
  /** A connection that may enter subscriber mode (must not be used for anything else). */
  createSubscriber: () => Redis;
  prefix?: string;
  /** Lease length; renewed every third of it while the lock is held. */
  ttlMs?: number;
  /** How long a request waits for a busy upload before giving up (HTTP 500 → the client retries). */
  acquireTimeoutMs?: number;
};

/** One subscriber connection shared by all locks of a locker; dispatches release requests to the holders. */
class ReleaseBus {
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, Set<() => void>>();

  constructor(private readonly create: () => Redis) {}

  private ensure(): Redis {
    if (this.subscriber) return this.subscriber;
    const subscriber = this.create();
    subscriber.on('message', (channel: string) => {
      for (const handler of this.handlers.get(channel) ?? []) handler();
    });
    subscriber.on('error', (err: Error) => log.warn({ err: err.message }, 'locker subscriber error'));
    this.subscriber = subscriber;
    return subscriber;
  }

  async subscribe(channel: string, handler: () => void): Promise<() => Promise<void>> {
    const subscriber = this.ensure();
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await subscriber.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        await subscriber.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    this.handlers.clear();
    await subscriber?.quit().catch(() => undefined);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

export class RedisLocker implements Locker {
  readonly prefix: string;
  readonly ttlMs: number;
  readonly acquireTimeoutMs: number;
  readonly redis: () => Redis;
  readonly bus: ReleaseBus;

  constructor(options: RedisLockerOptions) {
    this.prefix = options.prefix ?? 'tuslock:';
    this.ttlMs = options.ttlMs ?? 20_000;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 30_000;
    this.redis = options.redis;
    this.bus = new ReleaseBus(options.createSubscriber);
  }

  newLock(id: string): Lock {
    return new RedisLock(this, id);
  }

  async close(): Promise<void> {
    await this.bus.close();
  }
}

class RedisLock implements Lock {
  private readonly token = randomUUID();
  private readonly key: string;
  private readonly channel: string;
  private held = false;
  private heartbeat: NodeJS.Timeout | undefined;
  private unsubscribe: (() => Promise<void>) | undefined;

  constructor(
    private readonly locker: RedisLocker,
    id: string,
  ) {
    this.key = `${locker.prefix}${id}`;
    this.channel = `${locker.prefix}release:${id}`;
  }

  private async redis(): Promise<Redis> {
    const redis = this.locker.redis();
    if (redis.status === 'wait') await redis.connect();
    return redis;
  }

  async lock(signal: AbortSignal, requestRelease: RequestRelease): Promise<void> {
    const redis = await this.redis();
    const deadline = Date.now() + this.locker.acquireTimeoutMs;
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw ERRORS.ABORTED;
      const acquired = await redis.set(this.key, this.token, 'PX', this.locker.ttlMs, 'NX');
      if (acquired === 'OK') break;
      if (Date.now() >= deadline) throw ERRORS.ERR_LOCK_TIMEOUT;
      // Ask the current holder to let go (it cancels its own, now stale, request), then try again.
      await redis.publish(this.channel, this.token);
      await sleep(Math.min(25 * 2 ** Math.min(attempt, 4), 250) + Math.floor(Math.random() * 20), signal);
    }
    this.held = true;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void Promise.resolve()
        .then(() => requestRelease())
        .catch((err) => log.warn({ err }, 'requestRelease failed'));
    };
    this.unsubscribe = await this.locker.bus.subscribe(this.channel, release);
    // The lease must outlive the request: renew it while we hold the lock. Losing it means somebody else may write
    // now, so we ask our own request to stop.
    this.heartbeat = setInterval(() => {
      void redis
        .eval(RENEW_LUA, 1, this.key, this.token, String(this.locker.ttlMs))
        .then((renewed) => {
          if (renewed === 0) {
            log.warn({ key: this.key }, 'lock lease was lost');
            release();
          }
        })
        .catch((err) => log.warn({ err: (err as Error).message }, 'lock renewal failed'));
    }, Math.max(1_000, Math.floor(this.locker.ttlMs / 3)));
    this.heartbeat.unref();
  }

  async unlock(): Promise<void> {
    if (!this.held) return;
    this.held = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.unsubscribe?.().catch(() => undefined);
    const redis = await this.redis();
    await redis.eval(RELEASE_LUA, 1, this.key, this.token);
  }
}
