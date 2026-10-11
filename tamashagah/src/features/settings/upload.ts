import { Errors } from '@/lib/errors';
import { MAX_IMAGE_BYTES } from '@/lib/images';

/** Multipart framing (boundaries, part headers) on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;
const TOO_LARGE = 'حجم تصویر نباید بیشتر از ۸ مگابایت باشد.';

/** Read the request body, aborting as soon as it exceeds `limit` bytes (no unbounded buffering). */
async function readLimited(req: Request, limit: number): Promise<Buffer> {
  if (!req.body) throw Errors.badRequest('بدنه‌ی درخواست خالی است.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw Errors.quotaExceeded(TOO_LARGE);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Read ONE uploaded image (`multipart/form-data`, field `file`) from a Route Handler request.
 *
 * Defence in depth, cheapest check first: content type → declared Content-Length → bounded streaming read →
 * multipart parse → file size. The bytes are NOT trusted afterwards either: `processImage` identifies the type by
 * magic bytes, decodes the pixels, strips metadata and re-encodes (so polyglot files never reach storage).
 */
export async function readImageUpload(req: Request, fieldName = 'file'): Promise<Buffer> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw Errors.badRequest('تصویر باید به‌صورت فرم فایل (multipart/form-data) ارسال شود.');
  }
  const limit = MAX_IMAGE_BYTES + MULTIPART_OVERHEAD;
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw Errors.quotaExceeded(TOO_LARGE);

  const body = await readLimited(req, limit);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw Errors.badRequest('فرم ارسال‌شده معتبر نیست.');
  }
  const file = form.get(fieldName);
  if (!(file instanceof File) || file.size === 0) throw Errors.badRequest('فایل تصویر ارسال نشد.');
  if (file.size > MAX_IMAGE_BYTES) throw Errors.quotaExceeded(TOO_LARGE);
  return Buffer.from(await file.arrayBuffer());
}
