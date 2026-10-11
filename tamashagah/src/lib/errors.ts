/**
 * Application errors and the uniform result type returned by Server Actions.
 *
 * Rules:
 *  - Throw `AppError` (via the `Errors.*` helpers) for expected failures.
 *  - Server Actions wrap their body in `runAction()` so they always return an
 *    `ActionResult` (never throw to the client, never leak internals).
 *  - Route handlers use `apiHandler()` from `src/lib/api.ts`.
 *  - User-visible messages are Persian.
 */
import { logger } from './logger';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EMAIL_NOT_VERIFIED'
  | 'QUOTA_EXCEEDED'
  | 'BLOCKED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EMAIL_NOT_VERIFIED: 403,
  QUOTA_EXCEEDED: 413,
  BLOCKED: 403,
  INTERNAL: 500,
};

export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { fieldErrors?: FieldErrors; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.fieldErrors = opts.fieldErrors;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

/** Factory helpers with sensible Persian default messages. */
export const Errors = {
  unauthenticated: (message = 'برای ادامه باید وارد حساب کاربری شوید.') =>
    new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'شما اجازه‌ی انجام این کار را ندارید.') => new AppError('FORBIDDEN', message),
  notFound: (message = 'مورد درخواستی پیدا نشد.') => new AppError('NOT_FOUND', message),
  validation: (fieldErrors: FieldErrors, message = 'اطلاعات واردشده معتبر نیست.') =>
    new AppError('VALIDATION', message, { fieldErrors }),
  badRequest: (message = 'درخواست نامعتبر است.') => new AppError('BAD_REQUEST', message),
  conflict: (message = 'این مورد قبلاً ثبت شده است.') => new AppError('CONFLICT', message),
  rateLimited: (retryAfterSeconds = 60, message = 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.') =>
    new AppError('RATE_LIMITED', message, { retryAfterSeconds }),
  emailNotVerified: (message = 'ابتدا ایمیل خود را تأیید کنید.') => new AppError('EMAIL_NOT_VERIFIED', message),
  quotaExceeded: (message = 'سهمیه‌ی مجاز شما به پایان رسیده است.') => new AppError('QUOTA_EXCEEDED', message),
  blocked: (message = 'امکان انجام این کار برای شما محدود شده است.') => new AppError('BLOCKED', message),
  internal: (message = 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.') => new AppError('INTERNAL', message),
};

export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
  retryAfterSeconds?: number;
};
export type ActionSuccess<T> = { ok: true; data: T };
export type ActionResult<T = void> = ActionSuccess<T> | ActionFailure;

export const ok = <T = void>(data?: T): ActionSuccess<T> => ({ ok: true, data: data as T });

export function fail(error: AppError): ActionFailure {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    fieldErrors: error.fieldErrors,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Next.js control-flow errors (redirect()/notFound()) must be re-thrown. */
export function isNextControlFlowError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const digest = (e as { digest?: unknown }).digest;
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND') || digest.includes('HTTP_ERROR_FALLBACK'))
  );
}

/**
 * Run a Server Action body and convert thrown errors into an `ActionResult`.
 * Unknown errors are logged with a correlation id and returned as INTERNAL.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await body();
    return ok(data);
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    if (isAppError(error)) return fail(error);
    const errorId = Math.random().toString(36).slice(2, 10);
    logger.error({ err: error, errorId }, 'unhandled server action error');
    return fail(Errors.internal(`خطای غیرمنتظره‌ای رخ داد (کد پیگیری: ${errorId}).`));
  }
}
