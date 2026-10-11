/**
 * BullMQ queue definitions shared by the web app (producers) and the worker
 * (consumers, see worker/index.ts).
 *
 * Job ids are deterministic (`<name>-<videoId>`) so the same video is never
 * queued twice. NOTE: BullMQ forbids ":" in custom job ids.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { createBullConnection } from '../redis';

export const QUEUE_NAMES = {
  video: 'video',
  maintenance: 'maintenance',
} as const;

export const JOB_NAMES = {
  processVideo: 'video.process',
  cleanupVideo: 'video.cleanup',
  publishScheduled: 'video.publish-scheduled',
  reconcileCounters: 'stats.reconcile',
  purgeExpiredAuth: 'auth.purge-expired',
  cleanupStaleUploads: 'upload.cleanup-stale',
} as const;

export type ProcessVideoJob = { videoId: string };
export type CleanupVideoJob = { videoId: string };

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

const globalForQueue = globalThis as unknown as { __queues?: Partial<Record<keyof typeof QUEUE_NAMES, Queue>> };

export function getQueue(name: keyof typeof QUEUE_NAMES): Queue {
  const queues = (globalForQueue.__queues ??= {});
  return (queues[name] ??= new Queue(QUEUE_NAMES[name], {
    connection: createBullConnection(),
    defaultJobOptions,
  }));
}

/** Queue a freshly uploaded video for transcoding. Idempotent per attempt. */
export async function enqueueVideoProcessing(videoId: string): Promise<string> {
  const jobId = `process-${videoId}-${Date.now()}`;
  await getQueue('video').add(JOB_NAMES.processVideo, { videoId } satisfies ProcessVideoJob, { jobId });
  return jobId;
}

/** Remove a video's files from storage (after the DB row has been deleted). */
export async function enqueueVideoCleanup(videoId: string): Promise<void> {
  await getQueue('maintenance').add(JOB_NAMES.cleanupVideo, { videoId } satisfies CleanupVideoJob, {
    jobId: `cleanup-${videoId}-${Date.now()}`,
  });
}
