/** Browser upload engine: speed meter, failure descriptions and the queue / pause / resume / cancel / retry state machine. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeUploadFailure, videoIdFromUploadUrl } from '@/features/uploads/client/errors';
import { SpeedMeter } from '@/features/uploads/client/speed';
import {
  UploadEngine,
  type ConfirmResult,
  type TransportEvents,
  type TransportHints,
  type UploadItem,
  type UploadTransport,
} from '@/features/uploads/client/engine';

describe('SpeedMeter', () => {
  it('is zero until two samples exist and then averages over the window', () => {
    const meter = new SpeedMeter(5_000);
    expect(meter.bytesPerSecond()).toBe(0);
    meter.add(0, 1_000);
    expect(meter.bytesPerSecond()).toBe(0);
    meter.add(1_000_000, 2_000);
    expect(meter.bytesPerSecond()).toBe(1_000_000);
    meter.add(3_000_000, 3_000);
    expect(meter.bytesPerSecond()).toBe(1_500_000);
    expect(meter.etaSeconds(3_000_000)).toBe(2);
  });

  it('forgets samples older than the window, so a speed change shows up', () => {
    const meter = new SpeedMeter(4_000);
    meter.add(0, 0);
    meter.add(4_000_000, 4_000); // fast: 1 MB/s
    for (let t = 5_000; t <= 12_000; t += 1_000) meter.add(4_000_000 + ((t - 4_000) / 1_000) * 100_000, t); // slow: 100 kB/s
    expect(meter.bytesPerSecond()).toBeLessThan(150_000);
    expect(meter.bytesPerSecond()).toBeGreaterThan(90_000);
  });

  it('starts over when the total goes backwards (resume from an earlier offset)', () => {
    const meter = new SpeedMeter();
    meter.add(5_000_000, 0);
    meter.add(6_000_000, 1_000);
    meter.add(1_000_000, 2_000);
    expect(meter.bytesPerSecond()).toBe(0);
    meter.add(2_000_000, 3_000);
    expect(meter.bytesPerSecond()).toBe(1_000_000);
  });

  it('has no ETA without a speed and never reports a negative speed', () => {
    const meter = new SpeedMeter();
    expect(meter.etaSeconds(100)).toBeNull();
    meter.add(10, 0);
    meter.add(10, 1_000);
    expect(meter.bytesPerSecond()).toBe(0);
    expect(meter.etaSeconds(100)).toBeNull();
  });
});

describe('describeUploadFailure', () => {
  it('treats a missing status as a network problem that can be retried', () => {
    const failure = describeUploadFailure({ status: null });
    expect(failure).toMatchObject({ retryable: true, network: true });
    expect(failure.message).toMatch(/اینترنت/);
    expect(describeUploadFailure({ status: 0 }).network).toBe(true);
  });

  it('uses the Persian message of the server when it sent one', () => {
    const body = JSON.stringify({ error: { code: 'QUOTA_EXCEEDED', message: 'سهمیه‌ی روزانه تمام شده است.' } });
    expect(describeUploadFailure({ status: 413, body })).toMatchObject({ message: 'سهمیه‌ی روزانه تمام شده است.', retryable: false });
    expect(describeUploadFailure({ status: 422, body: 'not json' }).message).toBe('این فایل پذیرفته نمی‌شود.');
  });

  it('knows which statuses are worth retrying', () => {
    const retryable = (status: number) => describeUploadFailure({ status }).retryable;
    for (const status of [404, 423, 429, 500, 502, 503]) expect(retryable(status), String(status)).toBe(true);
    for (const status of [400, 401, 403, 409, 413, 422]) expect(retryable(status), String(status)).toBe(false);
    expect(describeUploadFailure({ status: 401 }).message).toMatch(/نشست/);
  });
});

describe('videoIdFromUploadUrl', () => {
  it('extracts the 11 character id from relative and absolute upload URLs', () => {
    expect(videoIdFromUploadUrl('/api/upload/AbC12301xyZ')).toBe('AbC12301xyZ');
    expect(videoIdFromUploadUrl('https://site.test/api/upload/AbC12301xyZ?x=1')).toBe('AbC12301xyZ');
    expect(videoIdFromUploadUrl('/api/upload/')).toBeNull();
    expect(videoIdFromUploadUrl('/api/upload/short')).toBeNull();
    expect(videoIdFromUploadUrl(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Engine with a scripted transport
// ---------------------------------------------------------------------------

class FakeTransport implements UploadTransport {
  starts = 0;
  pauses = 0;
  terminated = false;
  terminateError: Error | null = null;
  constructor(
    readonly file: File,
    readonly events: TransportEvents,
    readonly hints?: TransportHints,
  ) {}
  start() {
    this.starts++;
  }
  pause() {
    this.pauses++;
  }
  async terminate() {
    this.terminated = true;
    if (this.terminateError) throw this.terminateError;
  }
  // scripted server behaviour
  created(id = 'AAAAAAAAAAA') {
    this.events.onUrl(`/api/upload/${id}`, false);
  }
  progress(sent: number) {
    this.events.onProgress(sent, this.file.size);
  }
  succeed() {
    this.events.onSuccess();
  }
  fail(status: number | null, body?: string) {
    this.events.onError({ status, body });
  }
}

const file = (name: string, size = 1_000_000, lastModified = 1) => {
  const f = new File([new Uint8Array(1)], name, { type: 'video/mp4', lastModified });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

function setup(overrides: { confirm?: (id: string) => Promise<ConfirmResult>; maxBytes?: number; maxConcurrent?: number } = {}) {
  const transports: FakeTransport[] = [];
  let clock = 1_000;
  const confirm = vi.fn(overrides.confirm ?? (async () => ({ ok: true }) as ConfirmResult));
  const discard = vi.fn(async () => undefined);
  const engine = new UploadEngine({
    createTransport: (f, events, hints) => {
      const t = new FakeTransport(f, events, hints);
      transports.push(t);
      return t;
    },
    confirm,
    discard,
    maxBytes: overrides.maxBytes ?? 10_000_000,
    maxConcurrent: overrides.maxConcurrent ?? 2,
    progressIntervalMs: 0,
    now: () => clock,
  });
  const tick = (ms: number) => (clock += ms);
  const items = () => engine.getSnapshot();
  const byName = (name: string): UploadItem => items().find((i) => i.name === name)!;
  return { engine, transports, confirm, discard, tick, items, byName };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('UploadEngine', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('rejects files the server would refuse, with a Persian reason, and queues the rest', () => {
    const { engine, items } = setup({ maxBytes: 5_000_000 });
    const result = engine.add([file('ok.mp4'), file('notes.txt'), file('huge.mp4', 6_000_000), new File([], 'empty.mp4', { type: 'video/mp4' })]);
    expect(result.added.map((i) => i.name)).toEqual(['ok.mp4']);
    expect(result.rejected.map((r) => r.name)).toEqual(['notes.txt', 'huge.mp4', 'empty.mp4']);
    expect(result.rejected.every((r) => /[؀-ۿ]/.test(r.message))).toBe(true);
    expect(items()).toHaveLength(1);
  });

  it('does not queue the same file twice', () => {
    const { engine } = setup();
    expect(engine.add([file('a.mp4')]).added).toHaveLength(1);
    const again = engine.add([file('a.mp4')]);
    expect(again.added).toHaveLength(0);
    expect(again.rejected[0]!.message).toMatch(/فهرست/);
    expect(engine.add([file('a.mp4', 1_000_000, 2)]).added).toHaveLength(1); // another file with the same name
  });

  it('runs at most `maxConcurrent` uploads and starts the next one when a slot frees up', () => {
    const { engine, transports, byName } = setup({ maxConcurrent: 2 });
    engine.add([file('a.mp4'), file('b.mp4', 1_000_000, 2), file('c.mp4', 1_000_000, 3)]);
    expect(transports).toHaveLength(2);
    expect([byName('a.mp4').status, byName('b.mp4').status, byName('c.mp4').status]).toEqual(['uploading', 'uploading', 'waiting']);

    engine.pause(byName('a.mp4').id);
    expect(byName('a.mp4').status).toBe('paused');
    expect(transports).toHaveLength(3);
    expect(byName('c.mp4').status).toBe('uploading');
  });

  it('learns the video id from the upload URL and reports progress, speed and ETA', () => {
    const { engine, transports, tick, byName } = setup();
    engine.add([file('a.mp4', 4_000_000)]);
    const t = transports[0]!;
    t.created('Vid00000001');
    expect(byName('a.mp4').videoId).toBe('Vid00000001');

    t.progress(0);
    tick(1_000);
    t.progress(1_000_000);
    tick(1_000);
    t.progress(2_000_000);
    const item = byName('a.mp4');
    expect(item.uploaded).toBe(2_000_000);
    expect(item.bytesPerSecond).toBe(1_000_000);
    expect(item.etaSeconds).toBe(2);
  });

  it('coalesces bursts of progress events into few notifications', () => {
    vi.useFakeTimers();
    let clock = 0;
    const transports: FakeTransport[] = [];
    const engine = new UploadEngine({
      createTransport: (f, events) => {
        const t = new FakeTransport(f, events);
        transports.push(t);
        return t;
      },
      confirm: async () => ({ ok: true }),
      maxBytes: 10_000_000,
      progressIntervalMs: 200,
      now: () => clock,
    });
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.add([file('a.mp4', 5_000_000)]);
    listener.mockClear();
    for (let i = 1; i <= 50; i++) {
      clock += 4; // 50 events in 200 ms
      transports[0]!.progress(i * 10_000);
    }
    expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
    vi.advanceTimersByTime(300);
    expect(engine.getSnapshot()[0]!.uploaded).toBe(500_000); // the trailing notification delivers the latest value
  });

  it('confirms a finished upload with the server and ends in `done`', async () => {
    const { engine, transports, confirm, byName } = setup();
    engine.add([file('a.mp4', 3_000_000)]);
    const t = transports[0]!;
    t.created('Vid00000002');
    t.progress(3_000_000);
    t.succeed();
    expect(byName('a.mp4').status).toBe('finishing');
    await flush();
    expect(confirm).toHaveBeenCalledWith('Vid00000002');
    expect(byName('a.mp4')).toMatchObject({ status: 'done', uploaded: 3_000_000, error: null });
    engine.dismiss(byName('a.mp4').id);
    expect(engine.getSnapshot()).toHaveLength(0);
  });

  it('keeps a failed confirmation retryable WITHOUT sending the file again', async () => {
    let attempts = 0;
    const { engine, transports, byName } = setup({
      confirm: async () => (++attempts === 1 ? { ok: false, message: 'ذخیره‌ی فایل کامل نشد.' } : { ok: true }),
    });
    engine.add([file('a.mp4')]);
    const t = transports[0]!;
    t.created('Vid00000003');
    t.succeed();
    await flush();
    expect(byName('a.mp4')).toMatchObject({ status: 'error', error: { message: 'ذخیره‌ی فایل کامل نشد.', retryable: true } });

    engine.retry(byName('a.mp4').id);
    await flush();
    expect(byName('a.mp4').status).toBe('done');
    expect(transports).toHaveLength(1); // no new upload
    expect(t.starts).toBe(1);
  });

  it('pauses and resumes the SAME transport (the tus client continues from the server offset)', () => {
    const { engine, transports, byName } = setup();
    engine.add([file('a.mp4')]);
    const t = transports[0]!;
    t.created();
    t.progress(400_000);
    const id = byName('a.mp4').id;

    engine.pause(id);
    expect(t.pauses).toBe(1);
    expect(byName('a.mp4')).toMatchObject({ status: 'paused', bytesPerSecond: 0, etaSeconds: null, uploaded: 400_000 });
    t.progress(450_000); // a late event from the aborted request is ignored
    expect(byName('a.mp4').uploaded).toBe(400_000);

    engine.resume(id);
    expect(transports).toHaveLength(1);
    expect(t.starts).toBe(2);
    expect(byName('a.mp4').status).toBe('uploading');
  });

  it('ignores errors that arrive after a pause', () => {
    const { engine, transports, byName } = setup();
    engine.add([file('a.mp4')]);
    engine.pause(byName('a.mp4').id);
    transports[0]!.fail(null);
    expect(byName('a.mp4').status).toBe('paused');
  });

  it('describes failures, frees the slot and retries with a fresh transport', () => {
    const { engine, transports, byName } = setup({ maxConcurrent: 1 });
    engine.add([file('a.mp4'), file('b.mp4', 1_000_000, 2)]);
    expect(transports).toHaveLength(1);

    transports[0]!.fail(500);
    expect(byName('a.mp4')).toMatchObject({ status: 'error', error: { retryable: true, network: false } });
    expect(byName('b.mp4').status).toBe('uploading'); // the slot went to the next file

    engine.pause(byName('b.mp4').id);
    engine.retry(byName('a.mp4').id);
    expect(byName('a.mp4').status).toBe('uploading');
    expect(transports).toHaveLength(3); // b started, then a again with a new transport
    expect(transports[0]!.pauses).toBe(1); // the failed one was stopped for good
  });

  it('retry only applies to failed items', () => {
    const { engine, transports, byName } = setup();
    engine.add([file('a.mp4')]);
    engine.retry(byName('a.mp4').id);
    expect(transports).toHaveLength(1);
    expect(transports[0]!.starts).toBe(1);
  });

  it('cancelling removes the item at once and deletes the upload on the server', async () => {
    const { engine, transports, discard, items, byName } = setup();
    engine.add([file('a.mp4')]);
    const t = transports[0]!;
    t.created('Vid00000004');
    engine.cancel(byName('a.mp4').id);
    expect(items()).toHaveLength(0);
    await flush();
    expect(t.terminated).toBe(true);
    expect(discard).not.toHaveBeenCalled();
    t.progress(10); // events of the dead transport do not resurrect the item
    t.fail(500);
    expect(items()).toHaveLength(0);
  });

  it('falls back to the studio delete when the tus DELETE cannot be delivered', async () => {
    const { engine, transports, discard, byName } = setup();
    engine.add([file('a.mp4')]);
    const t = transports[0]!;
    t.created('Vid00000005');
    t.terminateError = new Error('offline');
    engine.cancel(byName('a.mp4').id);
    await flush();
    await flush();
    expect(discard).toHaveBeenCalledWith('Vid00000005');
  });

  it('cancelling a waiting file never touches the network', async () => {
    const { engine, transports, discard, byName } = setup({ maxConcurrent: 1 });
    engine.add([file('a.mp4'), file('b.mp4', 1_000_000, 2)]);
    engine.cancel(byName('b.mp4').id);
    await flush();
    expect(transports).toHaveLength(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it('cancel does nothing to finished items', async () => {
    const { engine, transports, byName } = setup();
    engine.add([file('a.mp4')]);
    transports[0]!.created('Vid00000006');
    transports[0]!.succeed();
    await flush();
    engine.cancel(byName('a.mp4').id);
    expect(byName('a.mp4').status).toBe('done');
  });

  it('retries network failures by itself when the browser is back online', () => {
    const listeners = new Map<string, Set<() => void>>();
    const fakeWindow = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
      removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    };
    vi.stubGlobal('window', fakeWindow);
    try {
      const { engine, transports, byName } = setup();
      engine.add([file('a.mp4'), file('b.mp4', 1_000_000, 2)]);
      transports[0]!.fail(null); // connection lost
      transports[1]!.fail(403); // refused: must NOT be retried automatically
      expect(byName('a.mp4').error?.network).toBe(true);

      for (const fn of listeners.get('online') ?? []) fn();
      expect(byName('a.mp4').status).toBe('uploading');
      expect(byName('b.mp4').status).toBe('error');
      engine.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks the browser to confirm closing the page only while something is in flight', async () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
      removeEventListener: (type: string, fn: (event: unknown) => void) => listeners.get(type)?.delete(fn),
    });
    try {
      const { engine, transports } = setup();
      expect(listeners.get('beforeunload')?.size ?? 0).toBe(0);
      engine.add([file('a.mp4')]);
      expect(listeners.get('beforeunload')?.size).toBe(1);
      const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
      for (const fn of listeners.get('beforeunload')!) fn(event);
      expect(event.preventDefault).toHaveBeenCalled();

      transports[0]!.created('Vid00000007');
      transports[0]!.succeed();
      await flush();
      expect(engine.isBusy()).toBe(false);
      expect(listeners.get('beforeunload')?.size).toBe(0);
      engine.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives React a stable snapshot between changes and a new one after each change', () => {
    const { engine, transports } = setup();
    const empty = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(empty);
    engine.add([file('a.mp4')]);
    const first = engine.getSnapshot();
    expect(first).not.toBe(empty);
    expect(engine.getSnapshot()).toBe(first);
    transports[0]!.created();
    expect(engine.getSnapshot()).not.toBe(first);
    expect(engine.getServerSnapshot()).toHaveLength(0);
  });

  it('continues a specific unfinished upload when asked to (resume from the pending list)', () => {
    const { engine, transports } = setup();
    engine.add([file('a.mp4')], { resumeVideoId: 'Vid00000009' });
    expect(transports[0]!.hints).toEqual({ resumeUrl: '/api/upload/Vid00000009' });
    engine.add([file('b.mp4', 1_000_000, 2)]);
    expect(transports[1]!.hints).toBeUndefined();
  });

  it('marks an upload as resumed when the transport found the earlier one', () => {
    const { engine, transports, byName } = setup();
    engine.add([file('a.mp4')]);
    transports[0]!.events.onUrl('/api/upload/Vid00000008', true);
    expect(byName('a.mp4')).toMatchObject({ resumed: true, videoId: 'Vid00000008' });
  });
});
