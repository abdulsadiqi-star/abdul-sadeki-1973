/**
 * Route Handler wrapper.
 *
 *   export const POST = apiHandler(async (req) => {
 *     const user = await requireUser();
 *     const body = await parseJsonBody(req, schema);
 *     ...
 *     return { ok: true };                 // → 200 JSON
 *   });
 *
 *   export const GET = apiHandler<{ id: string }>(async (req, { params }) => {
 *     return Response.json(await load(params.id));   // Response passes through untouched
 *   });
 *
 * Behaviour:
 *  - non-safe methods must pass the Origin check (CSRF defence) unless `csrf:false`
 *  - AppError → JSON `{ error: { code, message, fieldErrors? } }` with the right status
 *  - unknown errors are logged with a request id and returned as a generic 500
 *  - every response carries `x-request-id`
 */
import { NextResponse, type NextRequest } from 'next/server';
import { Errors, isAppError, isNextControlFlowError, type AppError } from './errors';
import { logger } from './logger';
import { assertTrustedRequest } from './origin';

type Awaitable<T> = T | Promise<T>;
type Handler<P> = (req: NextRequest, ctx: { params: P; requestId: string }) => Awaitable<Response | object | null | undefined>;

export function errorResponse(error: AppError, requestId?: string): NextResponse {
  const res = NextResponse.json(
    { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } },
    { status: error.status },
  );
  if (error.retryAfterSeconds) res.headers.set('Retry-After', String(error.retryAfterSeconds));
  if (requestId) res.headers.set('x-request-id', requestId);
  return res;
}

export function apiHandler<P extends Record<string, string | string[]> = Record<string, string>>(
  handler: Handler<P>,
  options: { csrf?: boolean } = {},
) {
  return async (req: NextRequest, ctx?: { params: Promise<P> }): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    try {
      if (options.csrf !== false) assertTrustedRequest(req);
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const result = await handler(req, { params, requestId });
      let res: Response;
      if (result instanceof Response) res = result;
      else if (result === null || result === undefined) res = new Response(null, { status: 204 });
      else res = NextResponse.json(result);
      res.headers.set('x-request-id', requestId);
      logger.debug({ requestId, method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started }, 'api');
      return res;
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;
      if (isAppError(error)) {
        logger.debug({ requestId, code: error.code, path: req.nextUrl.pathname }, 'api error');
        return errorResponse(error, requestId);
      }
      logger.error({ err: error, requestId, method: req.method, path: req.nextUrl.pathname }, 'unhandled api error');
      return errorResponse(Errors.internal(), requestId);
    }
  };
}

/** `Cache-Control` presets. */
export const cacheControl = {
  none: 'private, no-store',
  immutable: 'public, max-age=31536000, immutable',
  shortPublic: 'public, max-age=60, stale-while-revalidate=300',
};
