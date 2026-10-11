/**
 * Minimal, safe CSV writer (runtime-agnostic).
 *
 * Security: cells that start with `= + - @` (or a tab / carriage return) are interpreted as formulas by
 * Excel/Sheets — creators' own video titles end up in exports, so such text is prefixed with an apostrophe
 * ("CSV injection", OWASP). Numbers and booleans are never altered, so negative numbers stay numeric.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 style: comma separated, CRLF line endings, no trailing newline. */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** UTF-8 byte-order mark: makes Excel open Persian text correctly. */
export const CSV_BOM = '\uFEFF';
