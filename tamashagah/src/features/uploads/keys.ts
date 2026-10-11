import { VIDEO_ID_REGEX } from '@/lib/ids';
import { keys } from '@/lib/storage/keys';

/**
 * Upload id ⇄ storage key mapping.
 *
 * The tus store identifies an upload by an opaque id and uses it as the object key. We make that id the storage
 * key `uploads/<videoId>`, so the raw upload lives exactly where the rest of the system expects it, while the
 * URL a client sees only carries the 11-character video id (`/api/upload/<videoId>`).
 */
export const UPLOAD_KEY_PREFIX = 'uploads/';

/** `uploads/<videoId>` for a video id. */
export const tusIdForVideo = (videoId: string): string => keys.upload(videoId);

/** The video id inside a tus id, or null when the id is not one of ours. */
export function videoIdFromTusId(tusId: string): string | null {
  if (!tusId.startsWith(UPLOAD_KEY_PREFIX)) return null;
  const videoId = tusId.slice(UPLOAD_KEY_PREFIX.length);
  return VIDEO_ID_REGEX.test(videoId) ? videoId : null;
}

/**
 * Every object a (possibly unfinished) upload may leave behind:
 *  - `<key>`        the raw bytes (S3: exists once the multipart upload completed)
 *  - `<key>.info`   S3 store: upload state
 *  - `<key>.part`   S3 store: the unfinished trailing part
 *  - `<key>.json`   file store: upload state
 */
export function uploadArtifactKeys(videoId: string): string[] {
  const base = keys.upload(videoId);
  return [base, `${base}.info`, `${base}.part`, `${base}.json`];
}
