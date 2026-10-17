/**
 * In-memory stand-in for the Next.js request context (`cookies()` / `headers()`),
 * so Server Actions and auth helpers can run inside Vitest integration tests.
 *
 *   import { requestContext } from '../helpers/request-context';
 *   requestContext.reset();                           // new browser, no cookies
 *   requestContext.headers.set('x-forwarded-for', '10.0.0.1');
 *   await loginAction({...});
 *   requestContext.cookie('tg_session')               // the cookie the action set
 */
type CookieOptions = { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string };

class RequestContext {
  readonly jar = new Map<string, { value: string; options: CookieOptions }>();
  headers = new Headers();

  reset(): void {
    this.jar.clear();
    this.headers = new Headers({ 'user-agent': 'vitest' });
  }

  cookie(name: string): string | undefined {
    return this.jar.get(name)?.value;
  }

  cookieOptions(name: string): CookieOptions | undefined {
    return this.jar.get(name)?.options;
  }

  /** Object shaped like Next's `ReadonlyRequestCookies` / `ResponseCookies`. */
  cookiesApi() {
    return {
      get: (name: string) => {
        const entry = this.jar.get(name);
        return entry ? { name, value: entry.value } : undefined;
      },
      set: (name: string, value: string, options: CookieOptions = {}) => {
        if (options.maxAge === 0 || value === '') this.jar.delete(name);
        else this.jar.set(name, { value, options });
      },
      delete: (name: string) => void this.jar.delete(name),
      has: (name: string) => this.jar.has(name),
      getAll: () => [...this.jar].map(([name, e]) => ({ name, value: e.value })),
    };
  }
}

export const requestContext = new RequestContext();
requestContext.reset();
