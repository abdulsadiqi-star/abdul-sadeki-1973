/**
 * HTTP Range header parsing (RFC 9110 §14). Only single ranges are supported;
 * anything else (multi-range, malformed) falls back to serving the full body.
 */
export type RangeResult =
  | { type: 'full' }
  | { type: 'partial'; start: number; end: number }
  | { type: 'unsatisfiable' };

export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { type: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { type: 'full' };
  const [, rawStart, rawEnd] = match;

  if (rawStart === '' && rawEnd === '') return { type: 'full' };

  // Suffix range: the last N bytes.
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { type: 'unsatisfiable' };
    if (size === 0) return { type: 'unsatisfiable' };
    return { type: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(start) || start >= size || start > end) return { type: 'unsatisfiable' };
  return { type: 'partial', start, end };
}
