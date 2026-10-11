/**
 * BullMQ queue definitions shared by the web app (producers) and the worker
 * (consumers, see worker/index.ts).
 *
 * Job ids are deterministic (`<name>-<videoId>`) so the same video is never
 * queued twice. NOTE: BullMQ forbids ":" in custom job ids.
 */
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { createBullConnection } from '../redis';

export const QUEUE_NAMES = {
  video: 'video',
  maintenance: 'maintenance',
} as const;

export const JOB_NAMES = {
  processVideo: 'video.process',
  cleanupVideo: 'video.cleanup',
  publishScheduled: 'video.publish-scheduled',
  requeueOrphans: 'video.requeue-orphans',
  reconcileCounters: 'stats.reconcile',
  purgeExpiredAuth: 'auth.purge-expired',
  cleanupStaleUploads: 'upload.cleanup-stale',
} as const;

export type ProcessVideoJob = { videoId: string };
export type CleanupVideoJob = { videoId: string };

/** How many times a transcode is attempted (BullMQ attempts == `TranscodeJob.maxAttempts`). */
export const VIDEO_JOB_ATTEMPTS = 3;

const defaultJobOptions: JobsOptions = {
  attempts: VIDEO_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

const globalForQueue = globalThis as unknown as {
  __queues?: Partial<Record<keyof typeof QUEUE_NAMES, Queue>>;
  /** BullMQ never closes connections it did not create itself, so we track ours. */
  __queueConnections?: Redis[];
};

export function getQueue(name: keyof typeof QUEUE_NAMES): Queue {
  const queues = (globalForQueue.__queues ??= {});
  const existing = queues[name];
  if (existing) return existing;
  const connection = createBullConnection();
  (globalForQueue.__queueConnections ??= []).push(connection);
  return (queues[name] = new Queue(QUEUE_NAMES[name], { connection, defaultJobOptions }));
}

/** Queue a freshly uploaded video for transcoding. Returns the BullMQ job id. */
export async function enqueueVideoProcessing(videoId: string): Promise<string> {
  const jobId = `process-${videoId}-${Date.now()}`;
  await getQueue('video').add(JOB_NAMES.processVideo, { videoId } satisfies ProcessVideoJob, { jobId });
  return jobId;
}

/**
 * Remove a video's files from storage (after the DB row has been deleted).
 * `delayMs` schedules a second pass later: a PATCH that was still in flight when the video was deleted may write
 * its last bytes AFTER the first pass, and the delayed pass sweeps those leftovers.
 */
export async function enqueueVideoCleanup(videoId: string, options: { delayMs?: number } = {}): Promise<void> {
  await getQueue('maintenance').add(JOB_NAMES.cleanupVideo, { videoId } satisfies CleanupVideoJob, {
    jobId: `cleanup-${videoId}-${Date.now()}${options.delayMs ? '-late' : ''}`,
    ...(options.delayMs ? { delay: options.delayMs } : {}),
  });
}

/** Close every queue (and its Redis connection) opened by this process: graceful shutdown, tests. */
export async function closeQueues(): Promise<void> {
  const queues = globalForQueue.__queues;
  const connections = globalForQueue.__queueConnections;
  globalForQueue.__queues = undefined;
  globalForQueue.__queueConnections = undefined;
  await Promise.allSettled(Object.values(queues ?? {}).map((queue) => queue?.close()));
  await Promise.allSettled((connections ?? []).map((connection) => connection.quit()));
}
