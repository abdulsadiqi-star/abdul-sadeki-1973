/**
 * Storage backend self-test.
 *
 *   pnpm check:storage
 *
 * Runs the operations the application depends on against whatever STORAGE_DRIVER / S3_* point to
 * (local disk, MinIO-compatible servers, AWS S3, Arvan, Liara, ...) and exits 1 on the first problem:
 *
 *   put / head / get / byte ranges / list / delete / deletePrefix        every driver
 *   large upload (multipart through the SDK), integrity via SHA-256     every driver
 *   raw multipart: create → upload parts → list parts → complete/abort  S3 only (this is what resumable uploads use)
 *   pre-signed GET honouring Range                                      S3 only
 *
 * Everything is written under `healthcheck/<random>/` and removed afterwards. Secrets are never printed.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { env } from '../src/lib/env';
import { getStorage, S3Storage } from '../src/lib/storage';

const MiB = 1024 * 1024;
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function readAll(stream: AsyncIterable<Uint8Array | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const storage = getStorage();
  const prefix = `healthcheck/${randomBytes(6).toString('hex')}`;
  const target =
    storage.kind === 's3'
      ? `s3 → ${env.S3_ENDPOINT ?? 'AWS'} / bucket "${env.S3_BUCKET}" (${env.S3_FORCE_PATH_STYLE ? 'path' : 'virtual-host'} style)`
      : `fs → ${path.resolve(env.STORAGE_FS_ROOT)}`;
  console.log(`Storage self-test\n  backend: ${target}\n  prefix:  ${prefix}/\n`);

  let failed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    const started = performance.now();
    try {
      await fn();
      console.log(`  ✓ ${name} (${Math.round(performance.now() - started)} ms)`);
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tamashagah-storage-'));
  try {
    const small = Buffer.from('سلام، تماشاگاه — hello 0123456789');
    await step('put + head', async () => {
      await storage.put(`${prefix}/small.txt`, small, { contentType: 'text/plain; charset=utf-8' });
      const info = await storage.head(`${prefix}/small.txt`);
      assert(info, 'object not found right after put');
      assert(info.size === small.length, `size ${info.size} ≠ ${small.length}`);
    });

    await step('head of a missing key returns null', async () => {
      assert((await storage.head(`${prefix}/missing.bin`)) === null, 'expected null');
      assert((await storage.get(`${prefix}/missing.bin`)) === null, 'get should also return null');
    });

    await step('get returns the exact bytes', async () => {
      const result = await storage.get(`${prefix}/small.txt`);
      assert(result, 'not found');
      assert((await readAll(result.stream)).equals(small), 'content differs');
    });

    await step('byte ranges (closed, open-ended)', async () => {
      const closed = await storage.get(`${prefix}/small.txt`, { start: 2, end: 9 });
      assert(closed?.range, 'no range reported');
      assert(closed.range.start === 2 && closed.range.end === 9 && closed.range.total === small.length, `bad range ${JSON.stringify(closed.range)}`);
      assert((await readAll(closed.stream)).equals(small.subarray(2, 10)), 'closed range bytes differ');
      const open = await storage.get(`${prefix}/small.txt`, { start: 5 });
      assert(open && (await readAll(open.stream)).equals(small.subarray(5)), 'open-ended range bytes differ');
    });

    await step('unsatisfiable range is reported', async () => {
      let code: string | undefined;
      try {
        const result = await storage.get(`${prefix}/small.txt`, { start: small.length + 10 });
        if (result) await readAll(result.stream);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      assert(code === 'RANGE_NOT_SATISFIABLE', `expected RANGE_NOT_SATISFIABLE, got ${code ?? 'no error'}`);
    });

    const bigPath = path.join(tmp, 'big.bin');
    const big = randomBytes(20 * MiB + 123);
    await fs.writeFile(bigPath, big);
    await step('large upload (multipart) + SHA-256 round trip', async () => {
      await storage.putFile(`${prefix}/big.bin`, bigPath, { contentType: 'application/octet-stream' });
      const info = await storage.head(`${prefix}/big.bin`);
      assert(info?.size === big.length, `size ${info?.size} ≠ ${big.length}`);
      const back = path.join(tmp, 'back.bin');
      await storage.getToFile(`${prefix}/big.bin`, back);
      assert(sha256(await fs.readFile(back)) === sha256(big), 'checksum mismatch after download');
    });

    await step('list by prefix', async () => {
      const listed = await storage.list(`${prefix}/`);
      const names = listed.map((o) => o.key).sort();
      assert(names.length === 2 && names[0] === `${prefix}/big.bin` && names[1] === `${prefix}/small.txt`, `unexpected listing: ${names.join(', ')}`);
    });

    if (storage instanceof S3Storage) {
      const { client, bucket } = storage;

      await step('raw multipart (create → parts → list → complete)', async () => {
        const key = `${prefix}/multipart.bin`;
        const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'video/mp4' }));
        assert(created.UploadId, 'no UploadId');
        const part1 = randomBytes(5 * MiB);
        const part2 = randomBytes(MiB + 7);
        const up1 = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId, PartNumber: 1, Body: part1 }));
        const up2 = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId, PartNumber: 2, Body: part2 }));
        const parts = await client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId }));
        assert(parts.Parts?.length === 2, `ListParts returned ${parts.Parts?.length ?? 0} parts`);
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: created.UploadId,
            MultipartUpload: { Parts: [{ ETag: up1.ETag, PartNumber: 1 }, { ETag: up2.ETag, PartNumber: 2 }] },
          }),
        );
        const info = await storage.head(key);
        assert(info?.size === part1.length + part2.length, `assembled size ${info?.size}`);
        const tail = await storage.get(key, { start: 5 * MiB });
        assert(tail && sha256(await readAll(tail.stream)) === sha256(part2), 'second part content differs');
      });

      await step('abort multipart leaves nothing behind', async () => {
        const key = `${prefix}/aborted.bin`;
        const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
        assert(created.UploadId, 'no UploadId');
        await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId, PartNumber: 1, Body: randomBytes(5 * MiB) }));
        await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId }));
        const pending = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: `${prefix}/` }));
        assert(!pending.Uploads?.some((u) => u.UploadId === created.UploadId), 'aborted upload is still listed');
        assert((await storage.head(key)) === null, 'aborted object exists');
      });

      await step('pre-signed GET with a Range header', async () => {
        const url = await storage.presignGet(`${prefix}/small.txt`, 60);
        assert(url, 'no URL');
        const response = await fetch(url, { headers: { Range: 'bytes=0-5' } });
        assert(response.status === 206, `expected 206, got ${response.status}`);
        assert(Buffer.from(await response.arrayBuffer()).equals(small.subarray(0, 6)), 'ranged bytes differ');
      });
    }

    await step('delete + deletePrefix', async () => {
      await storage.delete(`${prefix}/small.txt`);
      assert((await storage.head(`${prefix}/small.txt`)) === null, 'object still exists after delete');
      const removed = await storage.deletePrefix(`${prefix}/`);
      assert(removed >= 1, `deletePrefix removed ${removed}`);
      assert((await storage.list(`${prefix}/`)).length === 0, 'objects remain after deletePrefix');
    });
  } finally {
    await storage.deletePrefix(`${prefix}/`).catch(() => undefined);
    await fs.rm(tmp, { recursive: true, force: true });
  }

  console.log(failed === 0 ? '\nAll storage checks passed.' : `\n${failed} storage check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
