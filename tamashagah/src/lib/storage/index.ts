/**
 * Storage entry point:
 *
 *   import { getStorage, keys } from '@/lib/storage';
 *   await getStorage().put(keys.poster(id, token), buffer, { contentType: 'image/jpeg' });
 */
import { env } from '../env';
import { FsStorage } from './fs';
import { S3Storage } from './s3';
import type { StorageDriver } from './types';

export * from './types';
export * from './keys';
export { contentTypeForKey } from './mime';
export { FsStorage } from './fs';
export { S3Storage } from './s3';

const globalForStorage = globalThis as unknown as { __storage?: StorageDriver };

export function createStorage(): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return new FsStorage(env.STORAGE_FS_ROOT);
}

/** Process-wide singleton chosen by STORAGE_DRIVER. */
export function getStorage(): StorageDriver {
  return (globalForStorage.__storage ??= createStorage());
}
