/**
 * Safe auto-linking of user text (video descriptions, comments).
 *
 * `tokenizeText` splits plain text into text / URL / #hashtag tokens; the components render the tokens as React
 * elements, so user text is NEVER interpreted as HTML (no dangerouslySetInnerHTML anywhere). Only `http:` and
 * `https:` URLs become links — `javascript:`, `data:`, `mailto:` … stay inert text. Pure and unit-tested
 * (tests/unit/linkify.test.ts).
 */

export type TextToken =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }
  | { type: 'hashtag'; value: string; tag: string };

export const MAX_URL_LENGTH = 2_000;
export const MAX_HASHTAG_LENGTH = 50;
/** Texts longer than this are not scanned (descriptions are ≤ 5 000 and comments ≤ 1 000 characters anyway). */
const MAX_SCAN_LENGTH = 20_000;

// Candidate URL: explicit scheme or "www.", ending at whitespace, markup characters or Persian/Arabic punctuation.
// Hashtag: "#" + a letter + letters/digits/underscore/ZWNJ (the length limit is checked afterwards, so an over-long
// tag is left alone instead of being cut in the middle).
const TOKEN = /(?:https?:\/\/|www\.)[^\s<>"'`،؛؟«»]+|#\p{L}[\p{L}\p{N}_\u200c]*/giu;

/** Characters that may directly precede a hashtag (start of text, whitespace, opening or separating punctuation). */
const HASHTAG_BOUNDARY = /[\s([{«"'،؛.,!?:;…\-—–]/u;
const TRAILING_PUNCTUATION = /[.,;:!?'"»›،؛؟…)\]}]$/u;

/** Remove sentence punctuation glued to the end of a URL; keep a ")" when it closes a "(" inside the URL. */
function trimUrl(candidate: string): string {
  let url = candidate;
  while (url.length > 0 && TRAILING_PUNCTUATION.test(url)) {
    const last = url[url.length - 1]!;
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    if (last === ']' && (url.match(/\[/g)?.length ?? 0) >= (url.match(/\]/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** Normalised http(s) href for a candidate, or null when it is not a safe, well-formed web link. */
export function toSafeHref(candidate: string): string | null {
  if (candidate.length > MAX_URL_LENGTH) return null;
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null; // https://trusted.com@evil.com tricks
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function tokenizeText(input: string): TextToken[] {
  if (!input) return [];
  if (input.length > MAX_SCAN_LENGTH) return [{ type: 'text', value: input }];

  const tokens: TextToken[] = [];
  let cursor = 0;
  const pushText = (end: number) => {
    if (end > cursor) tokens.push({ type: 'text', value: input.slice(cursor, end) });
  };

  for (const match of input.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index < cursor) continue; // swallowed by an earlier token
    let raw = match[0];

    if (raw.startsWith('#')) {
      const previous = index > 0 ? input[index - 1]! : '';
      if (previous && !HASHTAG_BOUNDARY.test(previous)) continue; // "word#tag" is not a hashtag
      if (Array.from(raw).length - 1 > MAX_HASHTAG_LENGTH) continue;
      pushText(index);
      tokens.push({ type: 'hashtag', value: raw, tag: raw.slice(1) });
      cursor = index + raw.length;
      continue;
    }

    raw = trimUrl(raw);
    const href = toSafeHref(raw);
    if (!href) continue;
    pushText(index);
    tokens.push({ type: 'url', value: raw, href });
    cursor = index + raw.length;
  }
  pushText(input.length);
  return tokens;
}

/** `/search?q=` target of a hashtag (the search normalizes away the "#", so the bare tag is searched). */
export const hashtagSearchHref = (tag: string): string => `/search?q=${encodeURIComponent(tag)}`;
