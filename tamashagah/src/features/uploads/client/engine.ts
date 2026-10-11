/**
 * Browser upload engine: a queue of files that are sent through a resumable transport (tus), with pause / resume /
 * cancel / retry, speed and ETA, and a snapshot API for `useSyncExternalStore`.
 *
 * The engine itself knows nothing about tus or React: the wire protocol is behind `UploadTransport` (see
 * `tus-transport.ts`), so the state machine is unit-tested with a fake transport.
 *
 *   waiting ──▶ uploading ──▶ finishing ──▶ done
 *      ▲  │         │  │          │
 *      │  ▼         ▼  ▼          ▼
 *    paused ◀───────┘  error ◀────┘   (error ──retry──▶ waiting, or ▶ finishing when only the confirmation failed)
 *
 * A file that is cancelled is removed from the list and deleted on the server.
 */
import { checkDeclaredUpload } from '../policy';
import { describeUploadFailure, videoIdFromUploadUrl, type RawUploadError, type UploadFailure } from './errors';
import { SpeedMeter } from './speed';

export type UploadStatus = 'waiting' | 'uploading' | 'paused' | 'finishing' | 'done' | 'error';

export type UploadItem = Readonly<{
  /** Local key (stable for the lifetime of the item; NOT the video id). */
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** Bytes the server has accepted (plus the chunk in flight). */
  uploaded: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  /** Known once the server created the upload record. */
  videoId: string | null;
  /** True when the upload continues one started earlier (another session, a paused tab, a refresh). */
  resumed: boolean;
  error: UploadFailure | null;
}>;

// ---------------------------------------------------------------------------
// Transport: what the engine needs from the wire protocol
// ---------------------------------------------------------------------------

export type TransportEvents = {
  /** The server-side upload exists (created, or found again when resuming). */
  onUrl(url: string, resumed: boolean): void;
  onProgress(sent: number, total: number): void;
  onSuccess(): void;
  onError(failure: RawUploadError): void;
};

export interface UploadTransport {
  /** Start, or continue after `pause()`. Progress and results arrive through the events. */
  start(): void;
  /** Stop sending; the server keeps what it has. */
  pause(): void;
  /** Stop and delete the upload on the server. Rejects when the server could not be told. */
  terminate(): Promise<void>;
}

export type TransportFactory = (file: File, events: TransportEvents) => UploadTransport;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export type ConfirmResult = { ok: true } | { ok: false; message: string };

export type EngineOptions = {
  createTransport: TransportFactory;
  /** Tell the server the file is complete (idempotent). Never throws: failures are `{ ok: false }`. */
  confirm: (videoId: string) => Promise<ConfirmResult>;
  /** Fallback when the tus DELETE failed: remove the unfinished video through the studio. */
  discard?: (videoId: string) => Promise<unknown>;
  /** Per-file size limit from the server (the server enforces it again). */
  maxBytes: number;
  maxConcurrent?: number;
  /** Minimum time between two notifications caused by progress events. */
  progressIntervalMs?: number;
  now?: () => number;
};

export type AddResult = {
  added: UploadItem[];
  rejected: { name: string; message: string }[];
};

type Entry = {
  item: UploadItem;
  file: File;
  meter: SpeedMeter;
  transport: UploadTransport | null;
  /** All bytes are on the server; only the confirmation is missing. */
  needsConfirm: boolean;
  /** Set while a cancel is in progress, so late events from the transport are ignored. */
  discarded: boolean;
};

const EMPTY: readonly UploadItem[] = Object.freeze([]);

export class UploadEngine {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly UploadItem[] = EMPTY;
  private options: Required<Pick<EngineOptions, 'maxConcurrent' | 'progressIntervalMs' | 'now'>> & EngineOptions;
  private seq = 0;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotify = 0;
  private guarding = false;

  constructor(options: EngineOptions) {
    this.options = { maxConcurrent: 3, progressIntervalMs: 150, now: Date.now, ...options };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }
  }

  // --- React integration -------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly UploadItem[] => this.snapshot;

  getServerSnapshot = (): readonly UploadItem[] => EMPTY;

  /** Adjust limits after construction (the page learns the server limits when it renders). */
  configure(patch: Partial<Pick<EngineOptions, 'maxBytes'>>): void {
    this.options = { ...this.options, ...patch };
  }

  // --- Commands -----------------------------------------------------------

  /** Validate and queue files. Invalid ones are reported back, never silently dropped. */
  add(files: readonly File[]): AddResult {
    const added: UploadItem[] = [];
    const rejected: AddResult['rejected'] = [];

    for (const file of files) {
      const check = checkDeclaredUpload({ filename: file.name, filetype: file.type, size: file.size }, { maxBytes: this.options.maxBytes });
      if (!check.ok) {
        rejected.push({ name: file.name, message: check.message });
        continue;
      }
      if (this.isDuplicate(file)) {
        rejected.push({ name: file.name, message: 'این فایل هم‌اکنون در فهرست بارگذاری است.' });
        continue;
      }
      const id = `u${++this.seq}-${this.options.now().toString(36)}`;
      const item: UploadItem = {
        id,
        name: check.filename,
        size: file.size,
        status: 'waiting',
        uploaded: 0,
        bytesPerSecond: 0,
        etaSeconds: null,
        videoId: null,
        resumed: false,
        error: null,
      };
      this.entries.set(id, { item, file, meter: new SpeedMeter(), transport: null, needsConfirm: false, discarded: false });
      added.push(item);
    }

    if (added.length > 0) {
      this.notify();
      this.pump();
    }
    return { added, rejected };
  }

  pause(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || (entry.item.status !== 'uploading' && entry.item.status !== 'waiting')) return;
    entry.transport?.pause();
    entry.meter.reset();
    this.patch(entry, { status: 'paused', bytesPerSecond: 0, etaSeconds: null });
    this.pump();
  }

  resume(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.item.status !== 'paused') return;
    this.patch(entry, { status: 'waiting', error: null });
    this.pump();
  }

  /** After an error: continue where it stopped (or only repeat the confirmation when all bytes were sent). */
  retry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.item.status !== 'error') return;
    if (entry.needsConfirm) {
      void this.finish(entry);
      return;
    }
    // A fresh transport finds the stored upload again (same file fingerprint) and gets a fresh set of automatic retries.
    entry.transport?.pause();
    entry.transport = null;
    this.patch(entry, { status: 'waiting', error: null });
    this.pump();
  }

  /** Stop, remove from the list and delete the unfinished upload on the server. */
  cancel(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.item.status === 'done') return;
    entry.discarded = true;
    this.entries.delete(id);
    this.notify();
    const videoId = entry.item.videoId;
    const terminate = entry.transport ? entry.transport.terminate() : Promise.resolve();
    void terminate.catch(async () => {
      // The tus DELETE could not be delivered: try the studio's own delete. If that fails too, the stale-upload sweep
      // of the worker removes the record later.
      if (videoId && this.options.discard) await this.options.discard(videoId).catch(() => undefined);
    });
    this.pump();
  }

  /** Remove a finished item from the list (the video itself is untouched). */
  dismiss(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.item.status !== 'done') return;
    this.entries.delete(id);
    this.notify();
  }

  /** Is anything still being sent (the page asks the browser to confirm before closing then)? */
  isBusy(): boolean {
    for (const { item } of this.entries.values()) {
      if (item.status === 'uploading' || item.status === 'waiting' || item.status === 'finishing') return true;
    }
    return false;
  }

  /** Stop listening to browser events (tests, hot reload). */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('beforeunload', this.onBeforeUnload);
    }
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.guarding = false;
    this.listeners.clear();
  }

  // --- Internals ------------------------------------------------------------

  private isDuplicate(file: File): boolean {
    for (const entry of this.entries.values()) {
      if (entry.item.status === 'done') continue;
      if (entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified) return true;
    }
    return false;
  }

  /** Start waiting files while slots are free. */
  private pump(): void {
    let running = 0;
    for (const { item } of this.entries.values()) if (item.status === 'uploading') running++;
    for (const entry of this.entries.values()) {
      if (running >= this.options.maxConcurrent) break;
      if (entry.item.status !== 'waiting') continue;
      this.begin(entry);
      running++;
    }
    this.updateGuard();
  }

  private begin(entry: Entry): void {
    entry.meter.reset();
    this.patch(entry, { status: 'uploading', error: null, bytesPerSecond: 0, etaSeconds: null });
    if (!entry.transport) {
      entry.transport = this.options.createTransport(entry.file, {
        onUrl: (url, resumed) => {
          if (entry.discarded) return;
          this.patch(entry, { videoId: videoIdFromUploadUrl(url), resumed: entry.item.resumed || resumed });
        },
        onProgress: (sent, total) => {
          if (entry.discarded || entry.item.status !== 'uploading') return;
          const now = this.options.now();
          entry.meter.add(sent, now);
          this.patchProgress(entry, {
            uploaded: Math.min(sent, total),
            bytesPerSecond: entry.meter.bytesPerSecond(),
            etaSeconds: entry.meter.etaSeconds(Math.max(0, total - sent)),
          });
        },
        onSuccess: () => {
          if (entry.discarded) return;
          entry.needsConfirm = true;
          void this.finish(entry);
        },
        onError: (raw) => {
          if (entry.discarded || entry.item.status !== 'uploading') return;
          const failure = describeUploadFailure(raw);
          entry.meter.reset();
          this.patch(entry, { status: 'error', error: failure, bytesPerSecond: 0, etaSeconds: null });
          this.pump();
        },
      });
    }
    entry.transport.start();
  }

  /** All bytes are on the server: confirm so the video is queued even if the last response was lost. */
  private async finish(entry: Entry): Promise<void> {
    const videoId = entry.item.videoId;
    this.patch(entry, { status: 'finishing', uploaded: entry.item.size, bytesPerSecond: 0, etaSeconds: null, error: null });
    this.pump();
    if (!videoId) {
      // Cannot happen with a well-behaved server (the URL is announced before the first byte); fail visibly if it does.
      this.fail(entry, 'پاسخ سرور ناقص بود. دوباره تلاش کنید.');
      return;
    }
    let result: ConfirmResult;
    try {
      result = await this.options.confirm(videoId);
    } catch {
      result = { ok: false, message: 'ارتباط با سرور قطع شد. دوباره تلاش کنید.' };
    }
    if (entry.discarded) return;
    if (!result.ok) {
      this.fail(entry, result.message);
      return;
    }
    entry.needsConfirm = false;
    this.patch(entry, { status: 'done', uploaded: entry.item.size, error: null });
    this.pump();
  }

  private fail(entry: Entry, message: string): void {
    this.patch(entry, { status: 'error', error: { message, retryable: true, network: false } });
    this.pump();
  }

  private readonly onOnline = (): void => {
    // The connection is back: continue everything that stopped only because it was lost.
    for (const entry of this.entries.values()) {
      if (entry.item.status === 'error' && entry.item.error?.network) this.retry(entry.item.id);
    }
  };

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.isBusy()) return;
    // Browsers show their own generic text; the value only needs to be non-empty.
    event.preventDefault();
    event.returnValue = '';
  };

  private updateGuard(): void {
    if (typeof window === 'undefined') return;
    const busy = this.isBusy();
    if (busy && !this.guarding) {
      window.addEventListener('beforeunload', this.onBeforeUnload);
      this.guarding = true;
    } else if (!busy && this.guarding) {
      window.removeEventListener('beforeunload', this.onBeforeUnload);
      this.guarding = false;
    }
  }

  private patch(entry: Entry, change: Partial<Mutable<UploadItem>>): void {
    entry.item = { ...entry.item, ...change };
    this.notify();
  }

  /** Progress events arrive many times per second; coalesce them. */
  private patchProgress(entry: Entry, change: Partial<Mutable<UploadItem>>): void {
    entry.item = { ...entry.item, ...change };
    const elapsed = this.options.now() - this.lastNotify;
    if (elapsed >= this.options.progressIntervalMs) {
      this.notify();
    } else if (!this.progressTimer) {
      this.progressTimer = setTimeout(() => {
        this.progressTimer = null;
        this.notify();
      }, this.options.progressIntervalMs - elapsed);
    }
  }

  private notify(): void {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    this.lastNotify = this.options.now();
    this.snapshot = Object.freeze([...this.entries.values()].map((e) => e.item));
    this.updateGuard();
    for (const listener of this.listeners) listener();
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
