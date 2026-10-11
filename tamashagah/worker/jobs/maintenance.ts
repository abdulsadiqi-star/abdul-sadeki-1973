/**
 * The `maintenance` queue: scheduler registration (BullMQ job schedulers) and the processor that dispatches jobs.
 */
import type { Job, Queue } from 'bullmq';
import { logger } from '@/lib/logger';
import { JOB_NAMES, type CleanupVideoJob } from '@/lib/queue';
import { publishDueScheduledVideos } from '@/features/videos-studio/publishing';
import { cleanupVideoFiles, purgeExpiredAuth, purgeStaleUploads, requeueOrphanedVideos } from './housekeeping';
import { reconcileCounters } from './reconcile';

const log = logger.child({ module: 'worker', queue: 'maintenance' });

/** Schedule definitions. `upsertJobScheduler` is idempotent, so registering them on every worker start is safe. */
export const MAINTENANCE_SCHEDULES = [
  { id: 'sched-publish-scheduled', name: JOB_NAMES.publishScheduled, repeat: { every: 60_000 } },
  { id: 'sched-requeue-orphans', name: JOB_NAMES.requeueOrphans, repeat: { every: 5 * 60_000 } },
  { id: 'sched-stale-uploads', name: JOB_NAMES.cleanupStaleUploads, repeat: { every: 60 * 60_000 } },
  // Quiet hours in Iran (UTC+3:30): auth purge at 03:15, counter reconciliation at 03:30.
  { id: 'sched-auth-purge', name: JOB_NAMES.purgeExpiredAuth, repeat: { pattern: '15 3 * * *', tz: 'Asia/Tehran' } },
  { id: 'sched-reconcile', name: JOB_NAMES.reconcileCounters, repeat: { pattern: '30 3 * * *', tz: 'Asia/Tehran' } },
] as const;

export async function registerMaintenanceSchedulers(queue: Queue): Promise<void> {
  for (const schedule of MAINTENANCE_SCHEDULES) {
    await queue.upsertJobScheduler(schedule.id, { ...schedule.repeat }, { name: schedule.name, data: {} });
  }
  log.info({ schedulers: MAINTENANCE_SCHEDULES.map((s) => s.id) }, 'maintenance schedulers registered');
}

export async function processMaintenanceJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.publishScheduled:
      return { published: await publishDueScheduledVideos() };
    case JOB_NAMES.requeueOrphans:
      return requeueOrphanedVideos();
    case JOB_NAMES.cleanupStaleUploads:
      return purgeStaleUploads();
    case JOB_NAMES.purgeExpiredAuth:
      return purgeExpiredAuth();
    case JOB_NAMES.reconcileCounters:
      return reconcileCounters();
    case JOB_NAMES.cleanupVideo:
      return cleanupVideoFiles((job.data as CleanupVideoJob).videoId);
    default:
      log.warn({ name: job.name }, 'unknown maintenance job');
      return { ignored: true };
  }
}
