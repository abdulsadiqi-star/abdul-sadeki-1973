/**
 * The real transport of the upload engine: tus-js-client against `/api/upload`.
 *
 * Resuming works in two ways, both without any server state beyond the tus upload itself:
 *   - pause / resume in the same page: the same `Upload` object continues (`abort()` then `start()` re-reads the offset)
 *   - after a refresh, a crash or another day: the file is picked again, its fingerprint (name, type, size, mtime)
 *     finds the upload URL stored in localStorage, and the client continues from the server's offset.
 */
import { Upload, type DetailedError, type PreviousUpload } from 'tus-js-client';
import { UPLOAD_CHUNK_BYTES, UPLOAD_ENDPOINT } from '../limits';
import type { RawUploadError } from './errors';
import type { TransportEvents, TransportFactory, UploadTransport } from './engine';

/** Wait times (ms) between automatic retries of a failed request; tus resets the sequence whenever progress is made. */
export const UPLOAD_RETRY_DELAYS = [0, 1_000, 3_000, 5_000, 10_000, 20_000];

export type TusTransportConfig = {
  endpoint?: string;
  chunkSize?: number;
  retryDelays?: number[];
};

function rawFailure(error: Error): RawUploadError {
  const response = (error as Partial<DetailedError>).originalResponse;
  if (!response) return { status: null };
  let body: string | null = null;
  try {
    body = response.getBody();
  } catch {
    body = null;
  }
  return { status: response.getStatus(), body };
}

const creationTime = (previous: PreviousUpload) => {
  const t = Date.parse(previous.creationTime);
  return Number.isNaN(t) ? 0 : t;
};

export function createTusTransportFactory(config: TusTransportConfig = {}): TransportFactory {
  return (file: File, events: TransportEvents): UploadTransport => {
    let resumed = false;
    let prepared: Promise<void> | null = null;
    let wanted = false;
    let generation = 0;

    const upload = new Upload(file, {
      endpoint: config.endpoint ?? UPLOAD_ENDPOINT,
      chunkSize: config.chunkSize ?? UPLOAD_CHUNK_BYTES,
      retryDelays: config.retryDelays ?? UPLOAD_RETRY_DELAYS,
      // The server derives everything else; it re-validates both values and replaces them with sanitized ones.
      metadata: { filename: file.name, filetype: file.type },
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      onUploadUrlAvailable: () => {
        if (upload.url) events.onUrl(upload.url, resumed);
      },
      onProgress: (sent, total) => events.onProgress(sent, total),
      onSuccess: () => events.onSuccess(),
      onError: (error) => events.onError(rawFailure(error)),
    });

    /** Look for an earlier upload of the same file (once). Storage problems just mean "start from scratch". */
    function prepare(): Promise<void> {
      prepared ??= upload
        .findPreviousUploads()
        .then((previous) => {
          const latest = [...previous].sort((a, b) => creationTime(b) - creationTime(a))[0];
          if (latest?.uploadUrl) {
            upload.resumeFromPreviousUpload(latest);
            resumed = true;
          }
        })
        .catch(() => undefined);
      return prepared;
    }

    return {
      start() {
        wanted = true;
        const mine = ++generation;
        void prepare().then(() => {
          // Paused, cancelled or started again while the lookup was running: only the latest start counts.
          if (wanted && mine === generation) upload.start();
        });
      },
      pause() {
        wanted = false;
        generation++;
        void upload.abort(false);
      },
      async terminate() {
        wanted = false;
        generation++;
        await upload.abort(true);
      },
    };
  };
}
