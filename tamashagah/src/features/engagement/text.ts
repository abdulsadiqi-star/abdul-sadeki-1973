/**
 * True when the text contains at least one character a reader can actually see.
 *
 * `normalizeUserText` keeps ZWNJ (it is meaningful inside Persian words), so a value made only of ZWNJ / other
 * invisible format characters and whitespace survives normalization as a non-empty string — and would render as
 * an empty comment or playlist title. Letters, digits, punctuation, symbols and emoji all count as visible.
 */
export function hasVisibleText(text: string): boolean {
  return /[^\s\p{Cf}\p{Cc}]/u.test(text);
}
