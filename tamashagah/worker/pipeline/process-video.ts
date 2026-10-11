/**
 * `video.process` — the heart of the pipeline.
 *
 *   download source → PROBE → TRANSCODE (one ffmpeg run, every rendition) → THUMBNAILS → PACKAGE (upload) → FINALIZE
 *
 * The function never throws for expected failures: it returns an outcome and leaves the database in a consistent
 * state (see `ProcessOutcome`). The BullMQ glue (retries, requeue on shutdown) lives in `worker/queue-processor.ts`,
 * so the pipeline can also be driven directly — by tests and by the demo seed.
 *
 * State machine of `Video.processingStatus`:
 *   QUEUED → PROCESSING → READY
 *                      ↘ QUEUED   (transient failure with attempts left, or the worker is shutting down)
 *                      ↘ FAILED   (final failure; partial outputs removed; creator notified)
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db, type Prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger, type Logger } from '@/lib/logger';
import { VIDEO_JOB_ATTEMPTS } from '@/lib/queue';
import { contentTypeForKey, getStorage, keys, type StorageDriver } from '@/lib/storage';
import { notify } from '@/features/notifications/service';
import { removeProcessedFiles } from '@/features/videos-studio/cleanup';
import { decidePublishOnReady, fanOutNewVideo } from '@/features/videos-studio/publishing';
import { invalidateVideoAccess } from '@/features/videos/media-access';
import { DEFAULT_POSTER_INDEX, STAGE_PROGRESS } from '@/features/transcoding/constants';
import {
  TranscodeError,
  failureReasonFor,
  isTranscodeError,
  technicalSummary,
} from '@/features/transcoding/errors';
import { AAC_LC_CODEC, avcCodecString } from '@/features/transcoding/h264';
import { detectKind, resolveKind, type KindChoice } from '@/features/transcoding/kind';
import { planRenditions, planThumbnails, type RenditionSpec } from '@/features/transcoding/plan';
import { analyzeMediaPlaylist, bandwidthOf, buildMasterPlaylist, type MasterVariant } from '@/features/transcoding/playlist';
import { summarizeProbe, withMeasuredDuration, type SourceInfo } from '@/features/transcoding/probe';
import { mapToWindow } from '@/features/transcoding/progress';
import { randomToken } from '@/lib/ids';
import { extractThumbnail, measureDuration, probeSource, runTranscode, supportsHdrToneMapping } from './ffmpeg';
import type { JobStage } from '@/generated/prisma/enums';

export type ProcessOptions = {
  /** 1-based attempt number (BullMQ `attemptsMade + 1`). */
  attempt?: number;
  maxAttempts?: number;
  queueJobId?: string | null;
  /** Aborts the run. `signal.reason === 'shutdown'` means "put the job back in the queue", anything else cancels. */
  signal?: AbortSignal;
  storage?: StorageDriver;
  log?: Logger;
  /** Called with the overall percentage (0..100), e.g. to mirror it into BullMQ's `job.updateProgress`. */
  onPercent?: (percent: number) => void;
};

export type ProcessOutcome =
  | { status: 'ready'; videoId: string; renditions: string[]; publishStatus: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'; kind: 'VIDEO' | 'SHORT' }
  | { status: 'skipped'; reason: 'not-found' | 'already-ready' }
  /** The video was deleted while it was processed. */
  | { status: 'cancelled' }
  /** The worker is shutting down: the video is QUEUED again, the job must be returned to the queue. */
  | { status: 'interrupted' }
  /** Transient failure with attempts left: the video is QUEUED again, rethrow so the queue retries with back-off. */
  | { status: 'retry'; error: TranscodeError }
  /** Final failure: the video is FAILED with a Persian reason. */
  | { status: 'failed'; error: TranscodeError; reason: string };

type LoadedVideo = {
  id: string;
  title: string;
  channelId: string;
  sourceKey: string | null;
  originalFilename: string | null;
  kind: 'VIDEO' | 'SHORT';
  channel: { ownerId: string; name: string };
};

const HLS_CACHE = 'public, max-age=31536000, immutable';
const PLAYLIST_CACHE = 'public, max-age=30';
const UPLOAD_CONCURRENCY = 6;

const clampPercent = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

class RunCancelled extends Error {}

/** Writes stage/percent to the TranscodeJob row (throttled) and notices when the row disappeared (video deleted). */
class ProgressReporter {
  private lastWrite = 0;
  private lastPercent = -1;
  private lastStage: JobStage | null = null;
  private inFlight = false;

  constructor(
    private readonly jobRowId: string,
    private readonly onCancelled: () => void,
    private readonly onPercent?: (percent: number) => void,
    private readonly log?: Logger,
  ) {}

  async update(stage: JobStage, percentage: number, force = false): Promise<void> {
    const percent = clampPercent(percentage);
    const stageChanged = stage !== this.lastStage;
    const now = Date.now();
    if (!force && !stageChanged && (percent === this.lastPercent || now - this.lastWrite < 1_000)) return;
    if (this.inFlight && !force && !stageChanged) return;
    this.inFlight = true;
    this.lastWrite = now;
    this.lastPercent = percent;
    this.lastStage = stage;
    try {
      this.onPercent?.(percent);
      const { count } = await db.transcodeJob.updateMany({
        where: { id: this.jobRowId, status: 'ACTIVE' },
        data: { stage, progress: percent },
      });
      if (count === 0) this.onCancelled();
    } catch (err) {
      this.log?.warn({ err }, 'could not write progress');
    } finally {
      this.inFlight = false;
    }
  }
}

async function loadAndStart(
  videoId: string,
  run: { attempt: number; maxAttempts: number; queueJobId: string | null },
): Promise<{ video: LoadedVideo; jobRowId: string } | { skipped: 'not-found' | 'already-ready' }> {
  return db.$transaction(async (tx) => {
    const video = await tx.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        channelId: true,
        sourceKey: true,
        originalFilename: true,
        kind: true,
        processingStatus: true,
        channel: { select: { ownerId: true, name: true } },
      },
    });
    if (!video) return { skipped: 'not-found' as const };
    if (video.processingStatus === 'READY') return { skipped: 'already-ready' as const };

    let job = await tx.transcodeJob.findFirst({
      where: { videoId, status: { in: ['QUEUED', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) job = await tx.transcodeJob.create({ data: { videoId, status: 'QUEUED', maxAttempts: run.maxAttempts } });

    const now = new Date();
    // Older unfinished rows of this video are leftovers of crashed runs.
    await tx.transcodeJob.updateMany({
      where: { videoId, id: { not: job.id }, status: { in: ['QUEUED', 'ACTIVE'] } },
      data: { status: 'CANCELLED', finishedAt: now },
    });
    await tx.transcodeJob.update({
      where: { id: job.id },
      data: {
        status: 'ACTIVE',
        stage: 'PROBE',
        progress: 0,
        attempt: run.attempt,
        maxAttempts: run.maxAttempts,
        queueJobId: run.queueJobId,
        startedAt: job.startedAt ?? now,
        finishedAt: null,
        error: null,
      },
    });
    await tx.video.update({ where: { id: videoId }, data: { processingStatus: 'PROCESSING', failureReason: null } });
    return { video: video as LoadedVideo, jobRowId: job.id };
  });
}

/** Run `tasks` with at most `limit` in flight; the first rejection wins. */
async function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type RenditionOutput = {
  spec: RenditionSpec;
  dir: string;
  segments: { name: string; bytes: number; duration: number }[];
  bandwidth: { peak: number; average: number };
  totalBytes: number;
};

/** Read what ffmpeg wrote for one rendition and validate it. */
async function inspectRendition(spec: RenditionSpec, hlsDir: string): Promise<RenditionOutput> {
  const dir = path.join(hlsDir, spec.label);
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, 'index.m3u8'), 'utf8');
  } catch {
    throw new TranscodeError('TRANSCODE_FAILED', `no playlist written for ${spec.label}`);
  }
  const info = analyzeMediaPlaylist(text);
  if (info.segments.length === 0 || !info.ended) {
    throw new TranscodeError('TRANSCODE_FAILED', `incomplete playlist for ${spec.label}`);
  }
  const segments: RenditionOutput['segments'] = [];
  for (const segment of info.segments) {
    const stat = await fs.stat(path.join(dir, segment.uri)).catch(() => null);
    if (!stat?.isFile() || stat.size === 0) {
      throw new TranscodeError('TRANSCODE_FAILED', `missing segment ${spec.label}/${segment.uri}`);
    }
    segments.push({ name: segment.uri, bytes: stat.size, duration: segment.duration });
  }
  return {
    spec,
    dir,
    segments,
    bandwidth: bandwidthOf(segments),
    totalBytes: segments.reduce((sum, s) => sum + s.bytes, 0),
  };
}

function sourceExtension(originalFilename: string | null): string {
  const match = originalFilename ? /\.([A-Za-z0-9]{1,5})$/.exec(originalFilename) : null;
  return match ? `.${match[1]!.toLowerCase()}` : '.bin';
}

export async function processVideo(videoId: string, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  const attempt = options.attempt ?? 1;
  const maxAttempts = options.maxAttempts ?? VIDEO_JOB_ATTEMPTS;
  const storage = options.storage ?? getStorage();
  const log = (options.log ?? logger.child({ module: 'worker' })).child({ videoId, attempt });

  const started = await loadAndStart(videoId, { attempt, maxAttempts, queueJobId: options.queueJobId ?? null });
  if ('skipped' in started) {
    log.info({ reason: started.skipped }, 'video.process skipped');
    return { status: 'skipped', reason: started.skipped };
  }
  const { video, jobRowId } = started;

  // `deleted` aborts come from the progress reporter (the job row vanished); outside aborts arrive via options.signal.
  const internal = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, internal.signal]) : internal.signal;
  const reporter = new ProgressReporter(
    jobRowId,
    () => {
      if (!internal.signal.aborted) internal.abort('deleted');
    },
    options.onPercent,
    log,
  );

  const root = env.WORKER_TMP_DIR ?? os.tmpdir();
  await fs.mkdir(root, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(root, `tg-${videoId}-`));
  const t0 = Date.now();

  try {
    await reporter.update('PROBE', STAGE_PROGRESS.PROBE.from, true);

    // --- download the source ---------------------------------------------------------------------------------------
    const sourceKey = video.sourceKey ?? keys.upload(videoId);
    const head = await storage.head(sourceKey).catch((err) => {
      throw new TranscodeError('STORAGE_FAILED', 'could not read the source', { cause: err });
    });
    if (!head) throw new TranscodeError('SOURCE_MISSING');
    const sourcePath = path.join(workDir, `source${sourceExtension(video.originalFilename)}`);
    try {
      await storage.getToFile(sourceKey, sourcePath);
    } catch (err) {
      throw new TranscodeError('STORAGE_FAILED', 'could not download the source', { cause: err });
    }
    if (signal.aborted) throw new RunCancelled();

    // --- PROBE ---------------------------------------------------------------------------------------------------------
    let source: SourceInfo = await probeSource(sourcePath, signal);
    if (source.durationMissing) {
      source = withMeasuredDuration(source, await measureDuration(sourcePath, source.videoStreamIndex, signal));
    }
    const renditions = planRenditions({ width: source.width, height: source.height, fps: source.fps.value });
    const thumbs = planThumbnails(source.durationSeconds, source.width, source.height);
    const hdrToSdr = source.hdr ? await supportsHdrToneMapping() : false;
    await db.transcodeJob.updateMany({
      where: { id: jobRowId },
      data: { probe: summarizeProbe(source), renditionPlan: renditions as unknown as Prisma.InputJsonArray },
    });
    // Show size/duration in the studio while the heavy work is still running.
    await db.video.updateMany({
      where: { id: videoId },
      data: { durationSeconds: source.durationSeconds, width: source.width, height: source.height },
    });
    log.info(
      { width: source.width, height: source.height, seconds: source.durationSeconds, renditions: renditions.map((r) => r.label) },
      'probe done',
    );
    await reporter.update('TRANSCODE', STAGE_PROGRESS.TRANSCODE.from, true);

    // --- TRANSCODE (one ffmpeg run, one HLS output per rendition) ------------------------------------------------------
    const hlsDir = path.join(workDir, 'hls');
    for (const r of renditions) await fs.mkdir(path.join(hlsDir, r.label), { recursive: true });
    await runTranscode({
      args: {
        input: sourcePath,
        outputDir: hlsDir,
        source,
        renditions,
        segmentSeconds: env.HLS_SEGMENT_SECONDS,
        preset: env.TRANSCODE_PRESET,
        hdrToSdr,
      },
      durationSeconds: source.durationSeconds,
      signal,
      onProgress: (fraction) => void reporter.update('TRANSCODE', mapToWindow(fraction, STAGE_PROGRESS.TRANSCODE)),
    });
    const outputs: RenditionOutput[] = [];
    for (const spec of renditions) outputs.push(await inspectRendition(spec, hlsDir));

    // --- THUMBNAILS -----------------------------------------------------------------------------------------------------
    await reporter.update('THUMBNAILS', STAGE_PROGRESS.THUMBNAILS.from, true);
    const thumbsDir = path.join(workDir, 'thumbs');
    await fs.mkdir(thumbsDir, { recursive: true });
    const madeThumbs: { index: number; file: string; atSeconds: number; width: number; height: number }[] = [];
    for (const thumb of thumbs) {
      const file = path.join(thumbsDir, `auto_${thumb.index}.jpg`);
      try {
        await extractThumbnail({ input: sourcePath, output: file, thumb, source, hdrToSdr, signal });
        const stat = await fs.stat(file).catch(() => null);
        if (stat?.isFile() && stat.size > 0) madeThumbs.push({ ...thumb, file });
      } catch (err) {
        if (isTranscodeError(err) && (err.code === 'CANCELLED' || err.code === 'INTERRUPTED')) throw err;
        log.warn({ err, index: thumb.index }, 'thumbnail failed; continuing with the others');
      }
    }
    if (madeThumbs.length === 0) throw new TranscodeError('TRANSCODE_FAILED', 'no thumbnail could be extracted');
    const posterSource = madeThumbs.find((t) => t.index === DEFAULT_POSTER_INDEX) ?? madeThumbs[0]!;

    // --- PACKAGE: upload to storage (segments and playlists first, the master playlist LAST) -----------------------------
    await reporter.update('PACKAGE', STAGE_PROGRESS.PACKAGE.from, true);
    const variants: MasterVariant[] = outputs.map((o) => ({
      name: o.spec.label,
      uri: `${o.spec.label}/index.m3u8`,
      width: o.spec.width,
      height: o.spec.height,
      bandwidth: o.bandwidth.peak,
      averageBandwidth: o.bandwidth.average,
      frameRate: source.fps.value,
      codecs: `${avcCodecString({ idc: o.spec.levelIdc })}${source.hasAudio ? `,${AAC_LC_CODEC}` : ''}`,
    }));
    const masterText = buildMasterPlaylist(variants);
    const posterKey = keys.poster(videoId, randomToken(9));

    try {
      // A previous attempt may have died half-way: start from a clean slate.
      await storage.deletePrefix(`${keys.videoPrefix(videoId)}hls/`);
      const uploads: { key: string; file: string; cache: string }[] = [];
      for (const o of outputs) {
        for (const segment of o.segments) {
          uploads.push({
            key: `${keys.hlsRenditionPrefix(videoId, o.spec.rung)}${segment.name}`,
            file: path.join(o.dir, segment.name),
            cache: HLS_CACHE,
          });
        }
      }
      let done = 0;
      const total = uploads.length + outputs.length + madeThumbs.length + 2;
      const tick = () => reporter.update('PACKAGE', mapToWindow(++done / total, STAGE_PROGRESS.PACKAGE));
      await runPool(uploads, UPLOAD_CONCURRENCY, async (u) => {
        if (signal.aborted) throw new RunCancelled();
        await storage.putFile(u.key, u.file, { contentType: contentTypeForKey(u.key), cacheControl: u.cache });
        void tick();
      });
      for (const o of outputs) {
        const key = keys.hlsRenditionPlaylist(videoId, o.spec.rung);
        await storage.putFile(key, path.join(o.dir, 'index.m3u8'), { contentType: contentTypeForKey(key), cacheControl: PLAYLIST_CACHE });
        void tick();
      }
      for (const t of madeThumbs) {
        const key = keys.autoThumb(videoId, t.index);
        await storage.putFile(key, t.file, { contentType: 'image/jpeg', cacheControl: PLAYLIST_CACHE });
        void tick();
      }
      await storage.putFile(posterKey, posterSource.file, { contentType: 'image/jpeg', cacheControl: HLS_CACHE });
      void tick();
      if (signal.aborted) throw new RunCancelled();
      await storage.put(keys.hlsMaster(videoId), masterText, {
        contentType: contentTypeForKey(keys.hlsMaster(videoId)),
        cacheControl: PLAYLIST_CACHE,
      });
      void tick();
    } catch (err) {
      if (err instanceof RunCancelled || isTranscodeError(err)) throw err;
      throw new TranscodeError('STORAGE_FAILED', 'could not store the processed files', { cause: err });
    }

    // --- FINALIZE ------------------------------------------------------------------------------------------------------
    await reporter.update('FINALIZE', STAGE_PROGRESS.FINALIZE.from, true);
    const result = await finalize({ video, jobRowId, source, outputs, madeThumbs, posterKey, posterSource, masterBytes: Buffer.byteLength(masterText), renditions });
    await afterReady(video, result, storage, log);
    options.onPercent?.(100);
    log.info({ ms: Date.now() - t0, renditions: renditions.map((r) => r.label), publishStatus: result.publishStatus, kind: result.kind }, 'video ready');
    return {
      status: 'ready',
      videoId,
      renditions: renditions.map((r) => r.label),
      publishStatus: result.publishStatus,
      kind: result.kind,
    };
  } catch (err) {
    return handleFailure(err, { video, jobRowId, attempt, maxAttempts, signal, internal, storage, log });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

type FinalizeResult = { publishStatus: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'; kind: 'VIDEO' | 'SHORT'; becamePublished: boolean; title: string };

async function finalize(input: {
  video: LoadedVideo;
  jobRowId: string;
  source: SourceInfo;
  outputs: RenditionOutput[];
  madeThumbs: { index: number; atSeconds: number; width: number; height: number }[];
  posterKey: string;
  posterSource: { index: number; width: number; height: number };
  masterBytes: number;
  renditions: RenditionSpec[];
}): Promise<FinalizeResult> {
  const { video, source, outputs, madeThumbs, posterKey, posterSource } = input;
  const now = new Date();

  return db.$transaction(async (tx) => {
    // Lock the row: a creator saving the form right now must not interleave with the publish decision.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Video" WHERE "id" = ${video.id} FOR UPDATE`;
    if (locked.length === 0) throw new RunCancelled();

    const current = await tx.video.findUniqueOrThrow({
      where: { id: video.id },
      select: { title: true, kind: true, publishOnReady: true, scheduledFor: true, publishStatus: true },
    });
    const sourceAsset = await tx.mediaAsset.findFirst({ where: { videoId: video.id, kind: 'SOURCE' }, select: { meta: true } });
    const choice = ((sourceAsset?.meta as { kindChoice?: KindChoice } | null)?.kindChoice ?? 'auto') as KindChoice;
    const detected = detectKind({ width: source.width, height: source.height, durationSeconds: source.durationSeconds });
    const kind = resolveKind(choice, current.kind, detected);

    const decision = decidePublishOnReady({ publishOnReady: current.publishOnReady, scheduledFor: current.scheduledFor }, now);

    // Replace every derived asset (a retry produces a fresh set).
    await tx.mediaAsset.deleteMany({ where: { videoId: video.id, kind: { in: ['HLS_MASTER', 'RENDITION', 'THUMBNAIL', 'POSTER'] } } });
    const master = keys.hlsMaster(video.id);
    await tx.mediaAsset.createMany({
      data: [
        {
          videoId: video.id,
          kind: 'HLS_MASTER',
          storageKey: master,
          mimeType: contentTypeForKey(master),
          sizeBytes: BigInt(input.masterBytes),
          meta: { renditions: outputs.map((o) => o.spec.label) },
        },
        ...outputs.map((o) => ({
          videoId: video.id,
          kind: 'RENDITION' as const,
          storageKey: keys.hlsRenditionPrefix(video.id, o.spec.rung),
          mimeType: 'application/vnd.apple.mpegurl',
          sizeBytes: BigInt(o.totalBytes),
          width: o.spec.width,
          height: o.spec.height,
          bitrateKbps: Math.round(o.bandwidth.average / 1000),
          codec: `${avcCodecString({ idc: o.spec.levelIdc })}${source.hasAudio ? `,${AAC_LC_CODEC}` : ''}`,
          label: o.spec.label,
          meta: { segments: o.segments.length, peakBitsPerSecond: o.bandwidth.peak },
        })),
        ...madeThumbs.map((t) => ({
          videoId: video.id,
          kind: 'THUMBNAIL' as const,
          storageKey: keys.autoThumb(video.id, t.index),
          mimeType: 'image/jpeg',
          width: t.width,
          height: t.height,
          label: String(t.index),
          meta: { atSeconds: t.atSeconds },
        })),
        {
          videoId: video.id,
          kind: 'POSTER' as const,
          storageKey: posterKey,
          mimeType: 'image/jpeg',
          width: posterSource.width,
          height: posterSource.height,
          isDefault: true,
          meta: { source: 'auto', index: posterSource.index },
        },
      ],
    });

    await tx.video.update({
      where: { id: video.id },
      data: {
        processingStatus: 'READY',
        failureReason: null,
        durationSeconds: source.durationSeconds,
        width: source.width,
        height: source.height,
        posterKey,
        hlsMasterKey: master,
        kind,
        publishStatus: decision.publishStatus,
        publishedAt: decision.publishedAt,
        scheduledFor: decision.scheduledFor,
      },
    });
    await tx.transcodeJob.update({
      where: { id: input.jobRowId },
      data: { status: 'COMPLETED', stage: 'FINALIZE', progress: 100, error: null, finishedAt: now },
    });
    return {
      publishStatus: decision.publishStatus,
      kind,
      becamePublished: decision.publishStatus === 'PUBLISHED' && current.publishStatus !== 'PUBLISHED',
      title: current.title,
    };
  });
}

/** Everything that happens after the commit: notifications, follower fan-out, source retention. Never throws. */
async function afterReady(video: LoadedVideo, result: FinalizeResult, storage: StorageDriver, log: Logger): Promise<void> {
  invalidateVideoAccess(video.id);
  try {
    await notify({
      userId: video.channel.ownerId,
      type: 'VIDEO_READY',
      title: `ویدیوی «${result.title}» آماده‌ی پخش شد`,
      body: result.publishStatus === 'PUBLISHED' ? 'ویدیو منتشر شد.' : result.publishStatus === 'SCHEDULED' ? 'در زمان تعیین‌شده منتشر می‌شود.' : 'برای انتشار، آن را از استودیو منتشر کنید.',
      href: result.publishStatus === 'PUBLISHED' ? `/watch/${video.id}` : `/studio/videos/${video.id}/edit`,
      channelId: video.channelId,
      videoId: video.id,
    });
    if (result.becamePublished) await fanOutNewVideo(video.id);
  } catch (err) {
    log.error({ err }, 'notifications after READY failed');
  }

  if (!env.KEEP_ORIGINAL_SOURCE) {
    try {
      const key = video.sourceKey ?? keys.upload(video.id);
      await storage.delete(key);
      await db.video.updateMany({ where: { id: video.id }, data: { sourceKey: null } });
      await db.mediaAsset.deleteMany({ where: { videoId: video.id, kind: 'SOURCE' } });
    } catch (err) {
      log.warn({ err }, 'could not delete the original source');
    }
  }
}

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

async function handleFailure(
  err: unknown,
  ctx: {
    video: LoadedVideo;
    jobRowId: string;
    attempt: number;
    maxAttempts: number;
    signal: AbortSignal;
    internal: AbortController;
    storage: StorageDriver;
    log: Logger;
  },
): Promise<ProcessOutcome> {
  const { video, jobRowId, attempt, maxAttempts, signal, storage, log } = ctx;
  const videoId = video.id;

  // Was the video deleted while we worked? (the progress reporter noticed, or finalize found no row)
  const deleted = err instanceof RunCancelled || (isTranscodeError(err) && err.code === 'CANCELLED') || ctx.internal.signal.aborted;
  if (deleted && signal.reason !== 'shutdown') {
    const stillThere = await db.video.findUnique({ where: { id: videoId }, select: { id: true } }).catch(() => null);
    if (!stillThere) {
      log.info('video deleted during processing; discarding the run');
      await removeProcessedFiles(videoId, storage).catch((e) => log.warn({ err: e }, 'cleanup after cancel failed'));
      return { status: 'cancelled' };
    }
  }

  const shuttingDown = signal.aborted && signal.reason === 'shutdown';
  const error: TranscodeError = shuttingDown
    ? new TranscodeError('INTERRUPTED')
    : isTranscodeError(err)
      ? err
      : new TranscodeError('UNKNOWN', technicalSummary(err), { cause: err });

  // Remove partial outputs in every non-success path: a retry (or the creator) starts from a clean slate.
  await removeProcessedFiles(videoId, storage).catch((e) => log.warn({ err: e }, 'could not remove partial outputs'));

  if (error.code === 'INTERRUPTED') {
    await requeue(videoId, jobRowId, null);
    log.warn('worker shutting down: video returned to the queue');
    return { status: 'interrupted' };
  }

  const isFinal = !error.retryable || attempt >= maxAttempts;
  if (!isFinal) {
    await requeue(videoId, jobRowId, technicalSummary(error));
    log.warn({ err: error.message, attempt, maxAttempts }, 'transient failure; will retry');
    return { status: 'retry', error };
  }

  const reason = await markFailed(video, jobRowId, error, attempt);
  log.error({ err: error.message, code: error.code, attempt }, 'video processing failed');
  return { status: 'failed', error, reason };
}

/** Final failure: FAILED status + Persian reason on the video, FAILED job row, VIDEO_FAILED notification. */
async function markFailed(video: LoadedVideo, jobRowId: string, error: TranscodeError, attempt?: number): Promise<string> {
  const reason = failureReasonFor(error);
  await db.$transaction([
    db.transcodeJob.updateMany({
      where: { id: jobRowId },
      data: { status: 'FAILED', error: technicalSummary(error), finishedAt: new Date(), ...(attempt ? { attempt } : {}) },
    }),
    db.video.updateMany({
      where: { id: video.id, processingStatus: { not: 'READY' } },
      data: { processingStatus: 'FAILED', failureReason: reason },
    }),
  ]);
  invalidateVideoAccess(video.id);
  await notify({
    userId: video.channel.ownerId,
    type: 'VIDEO_FAILED',
    title: `پردازش ویدیوی «${video.title}» ناموفق بود`,
    body: reason,
    href: `/studio/videos/${video.id}/edit`,
    channelId: video.channelId,
    videoId: video.id,
  });
  return reason;
}

/**
 * Fail a video from the outside — used when the queue gave up on a job without the pipeline getting to report it
 * (e.g. the worker was killed repeatedly and BullMQ's stalled-job limit was reached). No-op unless the video is
 * still waiting for / in processing.
 */
export async function failVideo(videoId: string, error: TranscodeError): Promise<boolean> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      channelId: true,
      sourceKey: true,
      originalFilename: true,
      kind: true,
      processingStatus: true,
      channel: { select: { ownerId: true, name: true } },
    },
  });
  if (!video || (video.processingStatus !== 'PROCESSING' && video.processingStatus !== 'QUEUED')) return false;
  const job = await db.transcodeJob.findFirst({ where: { videoId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  await removeProcessedFiles(videoId).catch(() => undefined);
  await markFailed(video as LoadedVideo, job?.id ?? '', error);
  return true;
}

/** Back to the queue: the job row waits for the next run, the video shows "queued" again. */
async function requeue(videoId: string, jobRowId: string, error: string | null): Promise<void> {
  await db.$transaction([
    db.transcodeJob.updateMany({
      where: { id: jobRowId, status: 'ACTIVE' },
      data: { status: 'QUEUED', stage: null, progress: 0, error },
    }),
    db.video.updateMany({
      where: { id: videoId, processingStatus: 'PROCESSING' },
      data: { processingStatus: 'QUEUED' },
    }),
  ]);
}
