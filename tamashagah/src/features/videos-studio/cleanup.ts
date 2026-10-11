/**
 * Removing a video's files from storage. Runtime-agnostic (used by the web app and the worker).
 *
 * Everything here is idempotent: deleting what is already gone is not an error, so a job can safely run twice.
 */
import { logger } from '@/lib/logger';
import { getStorage, keys, type StorageDriver } from '@/lib/storage';
import { uploadArtifactKeys } from '@/features/uploads/keys';

const log = logger.child({ module: 'cleanup' });

/** Delete the processed outputs (`videos/<id>/…`: HLS, thumbnails, subtitles). Returns the object count. */
export async function removeProcessedFiles(videoId: string, storage: StorageDriver = getStorage()): Promise<number> {
  return storage.deletePrefix(keys.videoPrefix(videoId));
}

/** Delete the raw upload and whatever the resumable-upload protocol left next to it (state files, partial parts). */
export async function removeUploadFiles(videoId: string, storage: StorageDriver = getStorage()): Promise<void> {
  for (const key of uploadArtifactKeys(videoId)) await storage.delete(key);
  // S3: unfinished multipart uploads keep (billed) parts until aborted.
  await storage.abortIncompleteUploads(keys.upload(videoId));
}

/** Everything a video owns in storage: processed outputs AND the raw upload. */
export async function removeAllVideoFiles(videoId: string, storage: StorageDriver = getStorage()): Promise<{ processed: number }> {
  const processed = await removeProcessedFiles(videoId, storage);
  await removeUploadFiles(videoId, storage);
  log.info({ videoId, processed }, 'video files removed');
  return { processed };
}
