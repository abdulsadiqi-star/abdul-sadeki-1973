const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Structured data (schema.org JSON-LD). `<` is escaped so user content (channel names, descriptions…) can never
 * close the script element; U+2028/2029 are escaped as well. The block is data, not executable code, so the CSP is unaffected.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll('<', '\\u003c')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029');
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
