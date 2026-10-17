/**
 * BullMQ glue for `video.process`: runs the pipeline and translates its outcome into queue semantics.
 *
 *   ready / skipped / cancelled → the job completes
 *   retry                       → rethrow: BullMQ retries with exponential back-off (attempts left)
 *   failed                      → UnrecoverableError: the job fails now, no pointless retries (the video is FAILED)
 *   interrupted (shutdown)      → the job goes back to the wait list WITHOUT consuming an attempt
 */
import { UnrecoverableError, WaitingError, type Job } from 'bullmq';
import { logger } from '@/lib/logger';
import { VIDEO_JOB_ATTEMPTS, type ProcessVideoJob } from '@/lib/queue';
import { processVideo } from './pipeline/process-video';

const log = logger.child({ module: 'worker' });

export function createVideoProcessor(shutdown: AbortSignal) {
  return async function processVideoJob(job: Job<ProcessVideoJob>, token?: string, signal?: AbortSignal) {
    const outcome = await processVideo(job.data.videoId, {
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? VIDEO_JOB_ATTEMPTS,
      queueJobId: job.id ?? null,
      signal: signal ? AbortSignal.any([shutdown, signal]) : shutdown,
      log,
      onPercent: (percent) => void job.updateProgress(percent).catch(() => undefined),
    });

    switch (outcome.status) {
      case 'ready':
      case 'skipped':
      case 'cancelled':
        return outcome;
      case 'interrupted':
        await job.moveToWait(token);
        throw new WaitingError();
      case 'retry':
        throw outcome.error;
      case 'failed':
        throw new UnrecoverableError(outcome.reason);
    }
  };
}
