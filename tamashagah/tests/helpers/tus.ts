/**
 * A minimal tus client that talks to the REAL route handlers in-process (no HTTP server): requests are plain
 * `NextRequest`s, the session comes from the mocked request context (`loginAs`).
 */
import { NextRequest } from 'next/server';
import * as collection from '@/app/api/upload/route';
import * as single from '@/app/api/upload/[id]/route';

export const BASE_URL = 'http://localhost:3000';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

export function uploadMetadata(meta: Record<string, string | undefined>): string {
  return Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === '' ? k : `${k} ${b64(v!)}`))
    .join(',');
}

type Extra = { headers?: Record<string, string>; origin?: string | null };

const baseHeaders = (extra: Extra = {}): Record<string, string> => ({
  'Tus-Resumable': '1.0.0',
  Host: 'localhost:3000',
  ...(extra.origin === null ? {} : { Origin: extra.origin ?? BASE_URL }),
  ...extra.headers,
});

export type CreateOptions = {
  filename?: string;
  filetype?: string;
  size: number;
  /** Raw Upload-Metadata (overrides filename/filetype). */
  metadata?: string;
  deferLength?: boolean;
} & Extra;

export async function tusCreate(options: CreateOptions): Promise<Response> {
  const metadata = options.metadata ?? uploadMetadata({ filename: options.filename ?? 'clip.mp4', filetype: options.filetype ?? 'video/mp4' });
  const req = new NextRequest(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: {
      ...baseHeaders(options),
      ...(options.deferLength ? { 'Upload-Defer-Length': '1' } : { 'Upload-Length': String(options.size) }),
      'Upload-Metadata': metadata,
    },
  });
  return collection.POST(req);
}

export const tusOptions = () =>
  collection.OPTIONS(new NextRequest(`${BASE_URL}/api/upload`, { method: 'OPTIONS', headers: { Host: 'localhost:3000' } }));

const idContext = (id: string) => ({ params: Promise.resolve({ id }) });
const urlFor = (id: string) => `${BASE_URL}/api/upload/${id}`;

export const tusHead = (id: string, extra?: Extra) =>
  single.HEAD(new NextRequest(urlFor(id), { method: 'HEAD', headers: baseHeaders(extra) }), idContext(id));

export const tusGet = (id: string, extra?: Extra) =>
  single.GET(new NextRequest(urlFor(id), { method: 'GET', headers: baseHeaders(extra) }), idContext(id));

export const tusPatch = (id: string, offset: number, bytes: Uint8Array, extra?: Extra) =>
  single.PATCH(
    new NextRequest(urlFor(id), {
      method: 'PATCH',
      headers: { ...baseHeaders(extra), 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream', 'Content-Length': String(bytes.byteLength) },
      body: Buffer.from(bytes),
    }),
    idContext(id),
  );

export const tusDelete = (id: string, extra?: Extra) =>
  single.DELETE(new NextRequest(urlFor(id), { method: 'DELETE', headers: baseHeaders(extra) }), idContext(id));

/** Video id from a creation response's `Location` header (`/api/upload/<id>`). */
export function videoIdFrom(response: Response): string {
  const location = response.headers.get('location');
  if (!location) throw new Error(`no Location header (status ${response.status})`);
  return decodeURIComponent(location.split('/').pop()!);
}

/** Deterministic non-trivial bytes. */
export function bytesOf(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

/** Create + upload a whole file in `chunks` PATCH requests. Returns the video id. */
export async function uploadWholeFile(size: number, options: { filename?: string; filetype?: string; chunks?: number } = {}): Promise<{ id: string; bytes: Uint8Array; last: Response }> {
  const created = await tusCreate({ size, filename: options.filename, filetype: options.filetype });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${await created.text()}`);
  const id = videoIdFrom(created);
  const bytes = bytesOf(size);
  const chunks = options.chunks ?? 1;
  const step = Math.ceil(size / chunks);
  let last = created;
  for (let offset = 0; offset < size; offset += step) {
    last = await tusPatch(id, offset, bytes.subarray(offset, Math.min(size, offset + step)));
    if (last.status !== 204) throw new Error(`patch failed: ${last.status} ${await last.text()}`);
  }
  return { id, bytes, last };
}
