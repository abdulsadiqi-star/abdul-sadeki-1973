/**
 * POST a multipart form to one of the studio's upload endpoints and turn every outcome (HTTP error, JSON error body,
 * network failure) into a Persian message. Browser only.
 */
export type PostFormResult<T> = { ok: true; data: T } | { ok: false; message: string };

const NETWORK_ERROR = 'ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.';

export async function postForm<T>(url: string, form: FormData): Promise<PostFormResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', body: form });
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }
  if (response.ok) {
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, message: 'پاسخ سرور نامعتبر بود. دوباره تلاش کنید.' };
    }
  }
  try {
    const body = (await response.json()) as { error?: { message?: unknown; fieldErrors?: Record<string, string[]> } };
    const fieldMessage = body.error?.fieldErrors ? Object.values(body.error.fieldErrors)[0]?.[0] : undefined;
    const message = typeof body.error?.message === 'string' && body.error.message ? body.error.message : fieldMessage;
    if (message) return { ok: false, message };
  } catch {
    /* not JSON (proxy error page, ...) */
  }
  return { ok: false, message: response.status === 413 ? 'حجم فایل بیش از حد مجاز است.' : 'ذخیره‌ی فایل ناموفق بود. دوباره تلاش کنید.' };
}
