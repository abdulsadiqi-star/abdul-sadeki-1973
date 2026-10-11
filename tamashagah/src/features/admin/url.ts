/**
 * Query-string helpers for the admin lists (pure).
 * The URL is the state of every list: filters and the page number live there, nowhere else.
 */
type RawParams = Record<string, string | string[] | undefined>;

/** Keep the user's filters, replace the page number (page 1 is the default and stays out of the URL). */
export function pageHref(basePath: string, raw: RawParams, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (key === 'page' || !v) continue;
    params.set(key, v);
  }
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
