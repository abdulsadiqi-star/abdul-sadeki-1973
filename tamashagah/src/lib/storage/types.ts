import type { Readable } from 'node:stream';

export interface StoredObjectInfo {
  key: string;
  size: number;
  contentType?: string;
  /** Opaque validator usable as an HTTP ETag. */
  etag?: string;
  lastModified?: Date;
}

/** Inclusive byte range, like the HTTP Range header (`bytes=start-end`). */
export interface ByteRange {
  start: number;
  end?: number;
}

export interface GetResult {
  stream: Readable;
  info: StoredObjectInfo;
  /** Present when a range was requested and satisfied. */
  range?: { start: number; end: number; total: number };
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
}

/**
 * Object storage abstraction. Two implementations ship with the app:
 *  - FsStorage  (STORAGE_DRIVER=fs)  local disk, for development and tests
 *  - S3Storage  (STORAGE_DRIVER=s3)  any S3-compatible service (AWS, MinIO, ...)
 *
 * Keys are POSIX-style relative paths ("videos/<id>/hls/master.m3u8").
 * Never build keys from user-supplied file names — see keys.ts.
 */
export interface StorageDriver {
  readonly kind: 'fs' | 's3';
  put(key: string, body: Buffer | Uint8Array | string | Readable, options?: PutOptions): Promise<void>;
  putFile(key: string, filePath: string, options?: PutOptions): Promise<void>;
  /** `null` when the object does not exist. */
  get(key: string, range?: ByteRange): Promise<GetResult | null>;
  head(key: string): Promise<StoredObjectInfo | null>;
  getToFile(key: string, destinationPath: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete everything whose key starts with `prefix`. Returns the number of objects removed. */
  deletePrefix(prefix: string): Promise<number>;
  list(prefix: string, limit?: number): Promise<StoredObjectInfo[]>;
  /** Short-lived direct download URL. `null` when the driver cannot presign (fs). */
  presignGet(key: string, expiresInSeconds: number): Promise<string | null>;
  /**
   * Abort unfinished multipart uploads whose key starts with `prefix` (S3 keeps the uploaded parts — and bills
   * for them — until the upload is completed or aborted). Returns how many were aborted; always 0 for fs.
   */
  abortIncompleteUploads(prefix: string): Promise<number>;
}
