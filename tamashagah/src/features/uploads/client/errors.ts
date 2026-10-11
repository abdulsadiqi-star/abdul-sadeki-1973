/**
 * Turn what went wrong during an upload into a Persian sentence and a "can the user retry?" flag. Pure.
 *
 * The server answers errors of its own hooks with JSON `{ error: { code, message } }` (already Persian); plain tus
 * errors (size exceeded, bad offset, ...) only carry a status code, so those are described here.
 */
export type UploadFailure = {
  message: string;
  retryable: boolean;
  /** True when the cause was the connection, not the server's answer. */
  network: boolean;
};

export type RawUploadError = {
  /** HTTP status of the last response, or null/0 when there was none (network error, aborted, ...). */
  status: number | null | undefined;
  body?: string | null;
};

const NETWORK_MESSAGE = 'ارتباط با سرور قطع شد. اینترنت خود را بررسی کنید؛ پس از اتصال دوباره می‌توانید ادامه دهید.';

function serverMessage(body: string | null | undefined): string | null {
  if (!body) return null;
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    return typeof message === 'string' && message.trim() ? message : null;
  } catch {
    return null;
  }
}

export function describeUploadFailure({ status, body }: RawUploadError): UploadFailure {
  if (!status) return { message: NETWORK_MESSAGE, retryable: true, network: true };
  const fromServer = serverMessage(body);

  switch (status) {
    case 401:
      return { message: 'نشست شما منقضی شده است. دوباره وارد حساب شوید و فایل را انتخاب کنید.', retryable: false, network: false };
    case 403:
      return { message: fromServer ?? 'اجازه‌ی بارگذاری ویدیو را ندارید.', retryable: false, network: false };
    case 404:
      // The server forgot the upload (cancelled, purged): starting again simply creates a fresh one.
      return { message: 'این بارگذاری دیگر وجود ندارد. با «تلاش دوباره» از اول شروع می‌شود.', retryable: true, network: false };
    case 409:
      return { message: fromServer ?? 'این بارگذاری پیش‌تر تکمیل شده است.', retryable: false, network: false };
    case 413:
      return { message: fromServer ?? 'حجم فایل یا سهمیه‌ی بارگذاری روزانه بیش از حد مجاز است.', retryable: false, network: false };
    case 422:
      return { message: fromServer ?? 'این فایل پذیرفته نمی‌شود.', retryable: false, network: false };
    case 423:
      return { message: 'این بارگذاری لحظه‌ای در حال استفاده است؛ دوباره تلاش کنید.', retryable: true, network: false };
    case 429:
      return { message: fromServer ?? 'درخواست‌های زیادی ارسال شد. کمی صبر کنید و دوباره تلاش کنید.', retryable: true, network: false };
    default:
      if (status >= 500) return { message: 'خطایی در سرور رخ داد. چند لحظه‌ی دیگر دوباره تلاش کنید.', retryable: true, network: false };
      return { message: fromServer ?? 'بارگذاری ناموفق بود.', retryable: false, network: false };
  }
}

/** Video id from a tus upload URL (`/api/upload/<id>` or absolute), or null. */
export function videoIdFromUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const last = url.split(/[?#]/)[0]!.split('/').filter(Boolean).pop();
  return last && /^[0-9A-Za-z]{11}$/.test(last) ? last : null;
}
