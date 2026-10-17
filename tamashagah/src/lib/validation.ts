/**
 * Zod helpers shared by Server Actions and Route Handlers.
 *
 *   const input = parse(loginSchema, rawInput);           // throws AppError(VALIDATION)
 *   const q = parse(searchQuerySchema, Object.fromEntries(url.searchParams));
 */
import type { z } from 'zod';
import './zod-fa';
import { Errors, type FieldErrors } from './errors';

export function issuesToFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw Errors.validation(issuesToFieldErrors(result.error));
  return result.data;
}

/** Read a JSON request body with a size limit (default 256 KiB) and validate it. */
export async function parseJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes = 256 * 1024,
): Promise<z.output<S>> {
  const text = await req.text();
  if (text.length > maxBytes) throw Errors.badRequest('حجم درخواست بیش از حد مجاز است.');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw Errors.badRequest('بدنه‌ی درخواست JSON معتبر نیست.');
  }
  return parse(schema, json);
}

export function parseSearchParams<S extends z.ZodType>(url: URL | string, schema: S): z.output<S> {
  const u = typeof url === 'string' ? new URL(url) : url;
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(u.searchParams.keys())) {
    const all = u.searchParams.getAll(key);
    obj[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return parse(schema, obj);
}
