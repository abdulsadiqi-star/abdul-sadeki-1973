/**
 * Background worker (separate process, same code base):
 *
 *   pnpm dev:worker                          tsx watch
 *   pnpm build:worker && pnpm start:worker   production (esbuild bundle)
 *
 *  - queue `video`        video.process  (FFmpeg → HLS), concurrency WORKER_CONCURRENCY
 *  - queue `maintenance`  scheduled publishing, stale uploads, auth purge, counter reconciliation, cleanup
 *
 * SIGTERM / SIGINT: stop taking jobs, give running ones a short grace period to finish, then interrupt them (the
 * ffmpeg children are killed and the job goes back to the queue without consuming an attempt).
 */
import './bootstrap';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { closeQueues, getQueue, QUEUE_NAMES, VIDEO_JOB_ATTEMPTS, type ProcessVideoJob } from '@/lib/queue';
import { createBullConnection, getRedis } from '@/lib/redis';
import { TranscodeError } from '@/features/transcoding/errors';
import { registerMaintenanceSchedulers, processMaintenanceJob } from './jobs/maintenance';
import { killAllChildren } from './pipeline/exec';
import { assertMediaToolsAvailable } from './pipeline/ffmpeg';
import { failVideo } from './pipeline/process-video';
import { createVideoProcessor } from './queue-processor';

const log = logger.child({ module: 'worker' });

/** How long running jobs may keep going after a shutdown signal before they are interrupted and requeued. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const tools = await assertMediaToolsAvailable().catch((err: Error) => {
    log.fatal({ err: err.message, ffmpeg: env.FFMPEG_PATH, ffprobe: env.FFPROBE_PATH }, 'ffmpeg/ffprobe not available');
    process.exit(1);
  });
  log.info({ ...tools, concurrency: env.WORKER_CONCURRENCY, storage: env.STORAGE_DRIVER }, 'worker starting');

  const shutdown = new AbortController();

  const videoWorker = new Worker<ProcessVideoJob>(QUEUE_NAMES.video, createVideoProcessor(shutdown.signal), {
    connection: createBullConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    // Transcodes are long: renew the lock often and tolerate a crashed worker once or twice before giving up.
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });
  const maintenanceWorker = new Worker(QUEUE_NAMES.maintenance, processMaintenanceJob, {
    connection: createBullConnection(),
    concurrency: 2,
  });

  videoWorker.on('error', (err) => log.error({ err }, 'video worker error'));
  maintenanceWorker.on('error', (err) => log.error({ err }, 'maintenance worker error'));
  videoWorker.on('failed', (job, err) => void onVideoJobFailed(job, err));
  maintenanceWorker.on('failed', (job, err) => log.error({ err: err.message, job: job?.name, id: job?.id }, 'maintenance job failed'));

  await registerMaintenanceSchedulers(getQueue('maintenance'));
  log.info('worker ready');

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutdown requested');
    const interrupt = setTimeout(() => {
      log.warn('grace period over: interrupting running jobs');
      shutdown.abort('shutdown');
    }, SHUTDOWN_GRACE_MS);
    // Last resort: never hang forever (the supervisor would SIGKILL us anyway).
    const hardExit = setTimeout(() => {
      log.error('shutdown took too long; exiting');
      killAllChildren('SIGKILL');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS + 20_000);
    hardExit.unref();
    try {
      await Promise.allSettled([videoWorker.close(), maintenanceWorker.close()]);
      await closeQueues();
      await getRedis()
        .quit()
        .catch(() => undefined);
      await db.$disconnect();
    } finally {
      clearTimeout(interrupt);
    }
    log.info('worker stopped');
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}

/**
 * BullMQ gave up on a job. Normally the pipeline already marked the video FAILED (UnrecoverableError) — this catches
 * the other case: the job stalled too often (worker killed repeatedly), so nobody reported the failure.
 */
async function onVideoJobFailed(job: Job<ProcessVideoJob> | undefined, err: Error): Promise<void> {
  if (!job) return;
  log.warn({ jobId: job.id, videoId: job.data?.videoId, attemptsMade: job.attemptsMade, err: err.message }, 'video job failed');
  if (err instanceof UnrecoverableError) return;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? VIDEO_JOB_ATTEMPTS);
  const stalled = /stalled/i.test(err.message);
  if (!exhausted && !stalled) return; // BullMQ will retry; the video was already put back to QUEUED
  try {
    const failed = await failVideo(job.data.videoId, new TranscodeError('UNKNOWN', err.message));
    if (failed) log.error({ videoId: job.data.videoId }, 'video marked FAILED after the queue gave up on its job');
  } catch (e) {
    log.error({ err: e }, 'could not mark the video as failed');
  }
}

process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled rejection'));
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception');
  process.exit(1);
});

main().catch((err) => {
  log.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
