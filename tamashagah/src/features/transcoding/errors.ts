/**
 * Failure taxonomy of the pipeline. Every failure the worker can hit is mapped to a code; the code decides
 *  - whether retrying makes sense (`retryable`), and
 *  - which SAFE Persian sentence the creator sees as `Video.failureReason` (never raw ffmpeg output, paths or stack traces).
 */
export type TranscodeErrorCode =
  | 'SOURCE_MISSING'
  | 'UNREADABLE'
  | 'NO_VIDEO_STREAM'
  | 'INVALID_DIMENSIONS'
  | 'TOO_LONG'
  | 'TRANSCODE_FAILED'
  | 'STORAGE_FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'UNKNOWN';

const RETRYABLE: Record<TranscodeErrorCode, boolean> = {
  SOURCE_MISSING: false,
  UNREADABLE: false,
  NO_VIDEO_STREAM: false,
  INVALID_DIMENSIONS: false,
  TOO_LONG: false,
  TRANSCODE_FAILED: true,
  STORAGE_FAILED: true,
  CANCELLED: false,
  INTERRUPTED: true,
  UNKNOWN: true,
};

/** Creator-facing explanations (Persian). Keep them short, actionable and free of technical detail. */
export const failureMessages: Record<TranscodeErrorCode, string> = {
  SOURCE_MISSING: 'فایل بارگذاری‌شده پیدا نشد. لطفاً ویدیو را دوباره بارگذاری کنید.',
  UNREADABLE: 'این فایل خراب است یا قالب آن پشتیبانی نمی‌شود. فایل دیگری (مثلاً MP4) را امتحان کنید.',
  NO_VIDEO_STREAM: 'در این فایل تصویر ویدیویی پیدا نشد. مطمئن شوید فایل یک ویدیوی واقعی است.',
  INVALID_DIMENSIONS: 'ابعاد تصویر این ویدیو معتبر نیست یا بیش از حد بزرگ است.',
  TOO_LONG: 'مدت این ویدیو بیش از حد مجاز است (حداکثر ۴ ساعت).',
  TRANSCODE_FAILED: 'تبدیل ویدیو به قالب قابل پخش با خطا روبه‌رو شد. دوباره تلاش کنید یا فایل دیگری بارگذاری کنید.',
  STORAGE_FAILED: 'ذخیره‌ی فایل‌های ویدیو با مشکل روبه‌رو شد. چند دقیقه‌ی دیگر دوباره تلاش کنید.',
  CANCELLED: 'پردازش این ویدیو لغو شد.',
  INTERRUPTED: 'پردازش به‌طور موقت متوقف شد و دوباره ادامه پیدا می‌کند.',
  UNKNOWN: 'پردازش ویدیو با یک خطای غیرمنتظره متوقف شد. دوباره تلاش کنید.',
};

export class TranscodeError extends Error {
  readonly code: TranscodeErrorCode;
  readonly retryable: boolean;

  constructor(code: TranscodeErrorCode, detail?: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(detail ? `${code}: ${detail}` : code, { cause: options?.cause });
    this.name = 'TranscodeError';
    this.code = code;
    this.retryable = options?.retryable ?? RETRYABLE[code];
  }
}

export const isTranscodeError = (e: unknown): e is TranscodeError => e instanceof TranscodeError;

/** Persian reason stored on the video (safe to show to the creator). */
export function failureReasonFor(error: unknown): string {
  return failureMessages[isTranscodeError(error) ? error.code : 'UNKNOWN'];
}

/**
 * Short technical summary stored in `TranscodeJob.error` (studio staff / debugging). No file-system paths, no
 * long stderr dumps: just the code and a trimmed message.
 */
export function technicalSummary(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(?:\/[\w.@%+=:,~-]+){2,}/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Substrings of ffmpeg's stderr that mean "this file is broken" — retrying will not help. */
const DETERMINISTIC_STDERR = [
  'Invalid data found when processing input',
  'moov atom not found',
  'Could not find codec parameters',
  'Invalid argument',
  'Unsupported codec',
  'Decoder (codec',
];

export function isDeterministicDecodeFailure(stderr: string): boolean {
  return DETERMINISTIC_STDERR.some((needle) => stderr.includes(needle));
}
