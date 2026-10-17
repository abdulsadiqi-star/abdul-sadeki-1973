/**
 * Safe search-term highlighting.
 *
 * The index and the query are matched on FOLDED text (Arabic Yeh/Kaf → Persian, ZWNJ → space, diacritics/tatweel removed,
 * digits → ASCII, case-folded — see `normalizeSearchText`). To highlight the ORIGINAL text we fold it character by
 * character while remembering where every folded character came from, find the query tokens in the folded text
 * (word-prefix matches, like the `token:*` tsquery), and map the hits back to ranges of the original string.
 *
 * The output is a list of plain `{ text, match }` segments — never an HTML string — so React renders `<mark>` elements
 * itself and no user content can ever be interpreted as markup.
 */
import { normalizeSearchText } from '@/lib/persian';

export type Segment = { text: string; match: boolean };

// Combining marks (harakat, superscript alef, Quranic marks…), tatweel and zero-width joiners / bidi controls are dropped.
const SKIPPED = /[\p{M}ـ‍‎‏‪-‮⁦-⁩﻿]/u;

export type FoldedText = {
  folded: string;
  /** folded index → start offset in the original string */
  starts: number[];
  /** folded index → end offset (exclusive) in the original string */
  ends: number[];
};

/** Fold `text` like the search index does, keeping a map from folded characters back to the original. */
export function foldWithMap(text: string): FoldedText {
  const starts: number[] = [];
  const ends: number[] = [];
  let folded = '';
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const next = i + ch.length;
    if (SKIPPED.test(ch)) {
      // extend the previous character so a trailing diacritic is highlighted with its letter
      if (ends.length) ends[ends.length - 1] = next;
    } else {
      const n = normalizeSearchText(ch);
      if (n === '') {
        // whitespace, ZWNJ, punctuation → one word separator
        if (folded !== '' && !folded.endsWith(' ')) {
          folded += ' ';
          starts.push(i);
          ends.push(next);
        }
      } else {
        for (const c of n) {
          folded += c;
          for (let k = 0; k < c.length; k++) {
            starts.push(i);
            ends.push(next);
          }
        }
      }
    }
    i = next;
  }
  return { folded, starts, ends };
}

/** Ranges [start, end) of the ORIGINAL text where a query token starts a word. Overlaps are merged, sorted ascending. */
export function findMatchRanges(text: string, tokens: readonly string[]): [number, number][] {
  if (tokens.length === 0 || text === '') return [];
  const { folded, starts, ends } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(token, from);
      if (idx === -1) break;
      if (idx === 0 || folded[idx - 1] === ' ') {
        ranges.push([starts[idx]!, ends[idx + token.length - 1]!]);
      }
      from = idx + 1;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Split `text` into alternating plain / matched segments. With no tokens (or no hit) the whole text is one plain segment. */
export function highlightSegments(text: string, tokens: readonly string[]): Segment[] {
  const ranges = findMatchRanges(text, tokens);
  if (ranges.length === 0) return text ? [{ text, match: false }] : [];
  const out: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false });
  return out;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Move `index` to a safe cut point: never between the halves of a surrogate pair. */
function safeCut(text: string, index: number): number {
  return index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1)) ? index - 1 : index;
}

/**
 * A short excerpt of `text` (≤ `maxLength` chars) centred on the first match, cut at word boundaries with "…" markers,
 * returned as highlighted segments. Without a match it is simply the beginning of the text.
 */
export function snippetSegments(text: string, tokens: readonly string[], maxLength = 160): Segment[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return [];
  if (clean.length <= maxLength) return highlightSegments(clean, tokens);

  const first = findMatchRanges(clean, tokens)[0];
  let start = first ? Math.max(0, first[0] - Math.floor(maxLength / 4)) : 0;
  if (start > 0) {
    const space = clean.indexOf(' ', start);
    start = space !== -1 && space - start < 24 ? space + 1 : start;
    start = safeCut(clean, start);
  }
  let end = Math.min(clean.length, start + maxLength);
  if (end < clean.length) {
    const space = clean.lastIndexOf(' ', end);
    end = space > start + maxLength / 2 ? space : safeCut(clean, end);
  }
  const body = highlightSegments(clean.slice(start, end), tokens);
  // the ellipses are separate plain segments so they never end up inside a highlighted <mark>
  if (start > 0) body.unshift({ text: '…', match: false });
  if (end < clean.length) body.push({ text: '…', match: false });
  return body;
}
