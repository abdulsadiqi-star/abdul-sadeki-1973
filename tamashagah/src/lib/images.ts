/**
 * Safe image ingestion for user uploads (avatars, banners, custom thumbnails).
 * Runtime-agnostic (used by Route Handlers and the worker). Backed by sharp/libvips.
 *
 *   const img = await processImage(buffer, { width: 400, height: 400, fit: 'cover' });
 *   await getStorage().put(keys.avatar(userId, token), img.data, { contentType: img.contentType, cacheControl: ... });
 *
 * Guarantees: the file is decoded (so non-images and polyglot files are rejected), animated images are flattened
 * to a single frame, EXIF/metadata (GPS!) is stripped, orientation is applied, pixel count is capped, and the output
 * is always re-encoded — the original bytes are never stored.
 */
import sharp from 'sharp';
import { Errors } from './errors';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000; // ~ 6300 x 6300

type Kind = 'jpeg' | 'png' | 'webp';

/** Identify an image by magic bytes (never trust the client-supplied MIME type or file name). */
export function sniffImageType(buf: Uint8Array): Kind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  const riff = String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!);
  const webp = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  return null;
}

export type ProcessedImage = { data: Buffer; contentType: string; ext: string; width: number; height: number };

export type ProcessImageOptions = {
  width: number;
  height: number;
  /** cover = crop to exactly width×height (avatars, banners, thumbnails); inside = shrink only, keep aspect. */
  fit?: 'cover' | 'inside';
  format?: 'webp' | 'jpeg';
  quality?: number;
};

export async function processImage(input: Buffer, options: ProcessImageOptions): Promise<ProcessedImage> {
  if (input.length === 0) throw Errors.badRequest('فایل تصویر خالی است.');
  if (input.length > MAX_IMAGE_BYTES) throw Errors.badRequest('حجم تصویر نباید بیشتر از ۸ مگابایت باشد.');
  if (!sniffImageType(input)) throw Errors.badRequest('فقط تصویر JPG، PNG یا WebP پذیرفته می‌شود.');

  const { width, height, fit = 'cover', format = 'webp', quality = 82 } = options;
  try {
    // `limitInputPixels` guards against decompression bombs; `failOn: 'error'` rejects truncated/corrupt files.
    const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
      .rotate() // apply EXIF orientation, then drop metadata (default behaviour of toBuffer)
      .resize({ width, height, fit: fit === 'cover' ? 'cover' : 'inside', withoutEnlargement: fit === 'inside', position: 'attention' });
    const out = format === 'jpeg' ? pipeline.jpeg({ quality, mozjpeg: true }) : pipeline.webp({ quality });
    const { data, info } = await out.toBuffer({ resolveWithObject: true });
    return {
      data,
      contentType: format === 'jpeg' ? 'image/jpeg' : 'image/webp',
      ext: format === 'jpeg' ? 'jpg' : 'webp',
      width: info.width,
      height: info.height,
    };
  } catch {
    throw Errors.badRequest('تصویر معتبر نیست یا قابل پردازش نبود.');
  }
}

/** Read an uploaded `File` (from FormData) into a Buffer with an early size check. */
export async function readImageFile(file: File): Promise<Buffer> {
  if (file.size > MAX_IMAGE_BYTES) throw Errors.badRequest('حجم تصویر نباید بیشتر از ۸ مگابایت باشد.');
  return Buffer.from(await file.arrayBuffer());
}
