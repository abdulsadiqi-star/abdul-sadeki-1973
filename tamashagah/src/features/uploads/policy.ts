/**
 * Upload policy: what may be uploaded, how big, how often. Pure functions (no I/O) — enforced on the server in the
 * tus hooks, mirrored in the browser only to give instant feedback.
 */
import { fa } from '@/lib/format';
import { normalizeUserText } from '@/lib/persian';

/**
 * Accepted containers. The real gate is ffprobe in the worker (it refuses non-video content whatever the name
 * says); this list only rules out obvious mistakes early. Documented in docs/features/media.md.
 */
export const ALLOWED_VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  '3gp',
  'ogv',
] as const;

export type VideoExtension = (typeof ALLOWED_VIDEO_EXTENSIONS)[number];

const MIME_BY_EXTENSION: Record<VideoExtension, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
};

/** What the file picker's `accept` attribute offers. */
export const VIDEO_ACCEPT = [...ALLOWED_VIDEO_EXTENSIONS.map((e) => `.${e}`), 'video/*'].join(',');

/** "MP4، MOV، MKV …" for help texts. */
export const ALLOWED_FORMATS_LABEL = ALLOWED_VIDEO_EXTENSIONS.map((e) => e.toUpperCase()).join('، ');

export function extensionOf(filename: string): string | null {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** Browsers report an empty or generic type for formats they cannot identify (mkv on Windows, ...). */
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function isAcceptableMime(filetype: string | null | undefined): boolean {
  const type = (filetype ?? '').trim().toLowerCase();
  if (GENERIC_TYPES.has(type)) return true;
  return type.startsWith('video/') || type === 'application/ogg' || type === 'application/vnd.rn-realmedia-vbr';
}

/** File name as shown to the creator: no path, no control characters, bounded. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return normalizeUserText(base).slice(0, 200);
}

/** Default title for a new upload: the file name without its extension, separators turned into spaces. */
export function titleFromFilename(filename: string): string {
  const withoutExtension = sanitizeFilename(filename).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const title = normalizeUserText(withoutExtension.replace(/[_.]+/g, ' ')).slice(0, 100).trim();
  return title || 'ویدیوی بدون عنوان';
}

export type UploadLimits = { maxBytes: number; maxPerDay: number; dailyQuotaBytes: number };

export type PolicyFailure = { ok: false; code: 'VALIDATION' | 'QUOTA_EXCEEDED'; message: string };
export type DeclaredUploadOk = { ok: true; filename: string; extension: VideoExtension; mime: string };

const formatsHint = `قالب‌های پشتیبانی‌شده: ${ALLOWED_FORMATS_LABEL}`;

/** Validate what the client declares when it creates an upload (never trust it beyond this: ffprobe re-checks). */
export function checkDeclaredUpload(
  declared: { filename: string | null | undefined; filetype: string | null | undefined; size: number | null | undefined },
  limits: Pick<UploadLimits, 'maxBytes'>,
): DeclaredUploadOk | PolicyFailure {
  const filename = sanitizeFilename(declared.filename ?? '');
  if (!filename) return { ok: false, code: 'VALIDATION', message: 'نام فایل مشخص نیست.' };

  const extension = extensionOf(filename);
  if (!extension || !(ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, code: 'VALIDATION', message: `این قالب فایل پشتیبانی نمی‌شود. ${formatsHint}` };
  }
  if (!isAcceptableMime(declared.filetype)) {
    return { ok: false, code: 'VALIDATION', message: `این فایل ویدیو نیست. ${formatsHint}` };
  }

  const size = declared.size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, code: 'VALIDATION', message: 'فایل خالی است یا اندازه‌ی آن مشخص نیست.' };
  }
  if (size > limits.maxBytes) {
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: `حجم فایل (${fa.bytes(size)}) بیشتر از سقف مجاز (${fa.bytes(limits.maxBytes)}) است.`,
    };
  }
  return { ok: true, filename, extension: extension as VideoExtension, mime: MIME_BY_EXTENSION[extension as VideoExtension] };
}

export type QuotaUsage = { count: number; bytes: number };

/** Daily quota over the last 24 hours (rows created, not files finished: abandoned uploads count too). */
export function checkQuota(
  usage: QuotaUsage,
  newBytes: number,
  limits: Pick<UploadLimits, 'maxPerDay' | 'dailyQuotaBytes'>,
): { ok: true } | PolicyFailure {
  if (usage.count + 1 > limits.maxPerDay) {
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: `سقف بارگذاری روزانه (${fa.number(limits.maxPerDay)} ویدیو در ۲۴ ساعت) تکمیل شده است. چند ساعت دیگر دوباره تلاش کنید.`,
    };
  }
  if (usage.bytes + newBytes > limits.dailyQuotaBytes) {
    const left = Math.max(0, limits.dailyQuotaBytes - usage.bytes);
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: `سهمیه‌ی حجم بارگذاری روزانه (${fa.bytes(limits.dailyQuotaBytes)}) کافی نیست؛ ${fa.bytes(left)} باقی مانده است.`,
    };
  }
  return { ok: true };
}
