import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertSafeKey } from './keys';
import { contentTypeForKey } from './mime';
import type { ByteRange, GetResult, PutOptions, StorageDriver, StoredObjectInfo } from './types';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const isNotFound = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

/** S3-compatible driver (AWS S3, MinIO, Ceph, Arvan, Liara, ...). */
export class S3Storage implements StorageDriver {
  readonly kind = 's3' as const;
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // S3-compatible servers (MinIO, Ceph, ...) don't all support the SDK's default flexible checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Buffer | Uint8Array | string | Readable, options: PutOptions = {}): Promise<void> {
    assertSafeKey(key);
    const common = {
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType ?? contentTypeForKey(key),
      CacheControl: options.cacheControl,
    };
    if (body instanceof Readable) {
      await new Upload({
        client: this.client,
        params: { ...common, Body: body },
        partSize: 8 * 1024 * 1024,
        queueSize: 4,
      }).done();
      return;
    }
    await this.client.send(new PutObjectCommand({ ...common, Body: body }));
  }

  async putFile(key: string, filePath: string, options: PutOptions = {}): Promise<void> {
    assertSafeKey(key);
    const { size } = await fs.stat(filePath);
    // Small files: single PUT with a known length (most compatible). Large: multipart.
    if (size <= 8 * 1024 * 1024) {
      await this.put(key, await fs.readFile(filePath), options);
      return;
    }
    await this.put(key, createReadStream(filePath), options);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        etag: res.ETag,
        lastModified: res.LastModified,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async get(key: string, range?: ByteRange): Promise<GetResult | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined,
        }),
      );
      const contentRange = res.ContentRange ? /bytes (\d+)-(\d+)\/(\d+)/.exec(res.ContentRange) : null;
      const total = contentRange ? Number(contentRange[3]) : (res.ContentLength ?? 0);
      return {
        stream: res.Body as Readable,
        info: {
          key,
          size: total,
          contentType: res.ContentType ?? contentTypeForKey(key),
          etag: res.ETag,
          lastModified: res.LastModified,
        },
        range: contentRange
          ? { start: Number(contentRange[1]), end: Number(contentRange[2]), total }
          : undefined,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 416) {
        throw Object.assign(new Error('Range not satisfiable'), { code: 'RANGE_NOT_SATISFIABLE' });
      }
      throw error;
    }
  }

  async getToFile(key: string, destinationPath: string): Promise<void> {
    const result = await this.get(key);
    if (!result) throw new Error(`Storage object not found: ${key}`);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await pipeline(result.stream, createWriteStream(destinationPath));
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string, limit = 10_000): Promise<StoredObjectInfo[]> {
    const out: StoredObjectInfo[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: Math.min(1000, limit) }),
      );
      for (const o of res.Contents ?? []) {
        if (!o.Key) continue;
        out.push({ key: o.Key, size: o.Size ?? 0, etag: o.ETag, lastModified: o.LastModified });
        if (out.length >= limit) return out;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertSafeKey(prefix.replace(/\/$/, '') || 'x');
    let deleted = 0;
    for (;;) {
      const batch = await this.list(prefix, 1000);
      if (batch.length === 0) break;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((o) => ({ Key: o.key })), Quiet: true },
        }),
      );
      deleted += batch.length;
    }
    return deleted;
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string | null> {
    assertSafeKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async abortIncompleteUploads(prefix: string): Promise<number> {
    assertSafeKey(prefix.replace(/\/$/, '') || 'x');
    let aborted = 0;
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const res = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const upload of res.Uploads ?? []) {
        if (!upload.Key || !upload.UploadId) continue;
        try {
          await this.client.send(
            new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: upload.Key, UploadId: upload.UploadId }),
          );
          aborted++;
        } catch (error) {
          // Already completed or aborted by somebody else (NoSuchUpload): nothing left to do.
          if (!isNotFound(error) && (error as { name?: string }).name !== 'NoSuchUpload') throw error;
        }
      }
      keyMarker = res.IsTruncated ? res.NextKeyMarker : undefined;
      uploadIdMarker = res.IsTruncated ? res.NextUploadIdMarker : undefined;
    } while (keyMarker || uploadIdMarker);
    return aborted;
  }
}
