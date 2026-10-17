/**
 * Helpers for the multipart upload endpoints (thumbnail, subtitles): the body size is capped WHILE reading, so a
 * client that lies about (or omits) Content-Length cannot make the server buffer an arbitrary amount of memory.
 */
import { Errors } from '@/lib/errors';

export async function readBodyLimited(req: Request, maxBytes: number, tooLargeMessage: string): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw Errors.badRequest(tooLargeMessage);
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw Errors.badRequest(tooLargeMessage);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Parse a size-capped multipart/form-data request into `FormData`. */
export async function readFormDataLimited(req: Request, maxBytes: number, tooLargeMessage: string): Promise<FormData> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw Errors.badRequest('درخواست باید به‌صورت فرم چندبخشی ارسال شود.');
  const bytes = await readBodyLimited(req, maxBytes, tooLargeMessage);
  try {
    return await new Response(bytes as BodyInit, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw Errors.badRequest('درخواست نامعتبر است.');
  }
}
