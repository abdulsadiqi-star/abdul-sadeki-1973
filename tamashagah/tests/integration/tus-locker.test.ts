/** The Redis lease locker behind tus: mutual exclusion, cooperative release, abort, timeout, lease expiry and renewal. */
import { afterAll, describe, expect, it } from 'vitest';
import { ERRORS } from '@tus/server';
import { getRedis, createBullConnection } from '@/lib/redis';
import { RedisLocker } from '@/features/uploads/redis-locker';

const lockers: RedisLocker[] = [];
const makeLocker = (options: { ttlMs?: number; acquireTimeoutMs?: number } = {}) => {
  const locker = new RedisLocker({ redis: getRedis, createSubscriber: createBullConnection, ...options });
  lockers.push(locker);
  return locker;
};

afterAll(async () => {
  await Promise.all(lockers.map((l) => l.close()));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = new AbortController().signal;

describe('RedisLocker', () => {
  it('grants one holder at a time and hands over on unlock', async () => {
    const locker = makeLocker();
    const a = locker.newLock('upload-1');
    const b = locker.newLock('upload-1');
    await a.lock(never, () => undefined);

    let bAcquired = false;
    const bPending = b.lock(never, () => undefined).then(() => (bAcquired = true));
    await sleep(150);
    expect(bAcquired).toBe(false); // still waiting

    await a.unlock();
    await bPending;
    expect(bAcquired).toBe(true);
    await b.unlock();
    expect(await getRedis().exists('tuslock:upload-1')).toBe(0);
  });

  it('locks different uploads independently', async () => {
    const locker = makeLocker();
    const a = locker.newLock('one');
    const b = locker.newLock('two');
    await a.lock(never, () => undefined);
    await b.lock(never, () => undefined); // does not wait
    await Promise.all([a.unlock(), b.unlock()]);
  });

  it('asks the current holder to release when somebody else wants the lock (and works across lockers)', async () => {
    const holderSide = makeLocker();
    const requesterSide = makeLocker(); // another "app instance"
    const holder = holderSide.newLock('contended');
    let releaseRequests = 0;
    await holder.lock(never, () => {
      releaseRequests++;
      // a cooperative holder ends its (stale) request, which unlocks
      void holder.unlock();
    });

    const requester = requesterSide.newLock('contended');
    await requester.lock(never, () => undefined);
    expect(releaseRequests).toBeGreaterThanOrEqual(1);
    await requester.unlock();
  });

  it('stops waiting when the request is aborted', async () => {
    const locker = makeLocker();
    const holder = locker.newLock('busy');
    await holder.lock(never, () => undefined);
    const controller = new AbortController();
    const waiting = locker.newLock('busy').lock(controller.signal, () => undefined);
    setTimeout(() => controller.abort(), 100);
    await expect(waiting).rejects.toBe(ERRORS.ABORTED);
    await holder.unlock();
  });

  it('gives up after the acquire timeout', async () => {
    const locker = makeLocker({ acquireTimeoutMs: 250 });
    const holder = locker.newLock('timeout');
    await holder.lock(never, () => undefined);
    const started = Date.now();
    await expect(locker.newLock('timeout').lock(never, () => undefined)).rejects.toBe(ERRORS.ERR_LOCK_TIMEOUT);
    expect(Date.now() - started).toBeLessThan(2_000);
    await holder.unlock();
  });

  it('a crashed holder cannot block the upload forever: its lease expires', async () => {
    const redis = getRedis();
    if (redis.status === 'wait') await redis.connect();
    // simulate an instance that died right after taking the lock (no heartbeat, no unlock)
    await redis.set('tuslock:orphaned', 'dead-instance', 'PX', 300);
    const locker = makeLocker();
    const started = Date.now();
    const lock = locker.newLock('orphaned');
    await lock.lock(never, () => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    await lock.unlock();
  });

  it('renews the lease while the lock is held', async () => {
    const locker = makeLocker({ ttlMs: 3_000, acquireTimeoutMs: 400 });
    const holder = locker.newLock('long-running');
    await holder.lock(never, () => undefined);
    await sleep(4_500); // longer than the TTL: only the heartbeat keeps the key alive
    expect(await getRedis().pttl('tuslock:long-running')).toBeGreaterThan(0);
    await expect(locker.newLock('long-running').lock(never, () => undefined)).rejects.toBe(ERRORS.ERR_LOCK_TIMEOUT);
    await holder.unlock();
  }, 20_000);

  it('unlock only removes its own lease', async () => {
    const redis = getRedis();
    const locker = makeLocker();
    const lock = locker.newLock('mine');
    await lock.lock(never, () => undefined);
    await redis.set('tuslock:mine', 'someone-else', 'PX', 5_000); // the lease was lost and re-taken
    await lock.unlock();
    expect(await redis.get('tuslock:mine')).toBe('someone-else');
    await redis.del('tuslock:mine');
  });
});
