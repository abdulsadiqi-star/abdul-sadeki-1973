import { createReadStream, createWriteStream } from 'node:fs';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { assertSafeKey } from './keys';
import { contentTypeForKey } from './mime';
import type { ByteRange, GetResult, PutOptions, StorageDriver, StoredObjectInfo } from './types';

/** Local-disk driver. Intended for development, tests and single-node setups. */
export class FsStorage implements StorageDriver {
  readonly kind = 'fs' as const;
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Absolute path for a key (validated, cannot escape the root). */
  resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error('Storage key escapes the storage root');
    }
    return full;
  }

  private async tmpPath(full: string): Promise<string> {
    await fs.mkdir(path.dirname(full), { recursive: true });
    return `${full}.tmp-${randomBytes(6).toString('hex')}`;
  }

  async put(key: string, body: Buffer | Uint8Array | string | Readable, _options?: PutOptions): Promise<void> {
    const full = this.resolve(key);
    const tmp = await this.tmpPath(full);
    try {
      if (body instanceof Readable) await pipeline(body, createWriteStream(tmp));
      else await fs.writeFile(tmp, body);
      await fs.rename(tmp, full);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
  }

  async putFile(key: string, filePath: string, _options?: PutOptions): Promise<void> {
    const full = this.resolve(key);
    const tmp = await this.tmpPath(full);
    try {
      await fs.copyFile(filePath, tmp);
      await fs.rename(tmp, full);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
  }

  private async statInfo(key: string, full: string): Promise<StoredObjectInfo | null> {
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) return null;
      return {
        key,
        size: st.size,
        contentType: contentTypeForKey(key),
        etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
        lastModified: st.mtime,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        return null;
      }
      throw error;
    }
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    return this.statInfo(key, this.resolve(key));
  }

  async get(key: string, range?: ByteRange): Promise<GetResult | null> {
    const full = this.resolve(key);
    const info = await this.statInfo(key, full);
    if (!info) return null;
    if (!range) return { stream: createReadStream(full), info };
    const start = Math.max(0, range.start);
    const end = Math.min(info.size - 1, range.end ?? info.size - 1);
    if (start > end || start >= info.size) {
      throw Object.assign(new Error('Range not satisfiable'), { code: 'RANGE_NOT_SATISFIABLE', total: info.size });
    }
    return { stream: createReadStream(full, { start, end }), info, range: { start, end, total: info.size } };
  }

  async getToFile(key: string, destinationPath: string): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(full, destinationPath);
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) await this.walk(child, out);
      else if (entry.isFile() && !entry.name.includes('.tmp-')) out.push(child);
    }
  }

  private toKey(full: string): string {
    return path.relative(this.root, full).split(path.sep).join('/');
  }

  async list(prefix: string, limit = 10_000): Promise<StoredObjectInfo[]> {
    assertSafeKey(prefix.replace(/\/$/, '') || 'x');
    const files: string[] = [];
    const dirOrFile = prefix.endsWith('/') ? this.resolve(prefix.slice(0, -1)) : path.dirname(this.resolve(prefix));
    await this.walk(dirOrFile, files);
    const out: StoredObjectInfo[] = [];
    for (const full of files.sort()) {
      const key = this.toKey(full);
      if (!key.startsWith(prefix)) continue;
      const info = await this.statInfo(key, full);
      if (info) out.push(info);
      if (out.length >= limit) break;
    }
    return out;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const objects = await this.list(prefix, Number.MAX_SAFE_INTEGER);
    for (const obj of objects) await fs.rm(this.resolve(obj.key), { force: true });
    if (prefix.endsWith('/')) {
      await fs.rm(this.resolve(prefix.slice(0, -1)), { recursive: true, force: true });
    }
    return objects.length;
  }

  async presignGet(): Promise<string | null> {
    return null;
  }
}
