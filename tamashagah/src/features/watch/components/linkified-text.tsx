import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/utils';
import { hashtagSearchHref, tokenizeText } from '../linkify';

/**
 * User text with safe auto-linking: URLs (http/https only) open in a new tab with
 * `rel="nofollow noopener noreferrer ugc"`, #hashtags link to the search. Rendered as React nodes — user text is
 * never parsed as HTML. Line breaks are preserved; direction follows the first strong character (`dir="auto"`).
 * Works in Server and Client Components (no hooks).
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  return (
    <span dir="auto" className={cn('user-text block text-sm leading-7 break-words whitespace-pre-wrap', className)}>
      {tokenizeText(text).map((token, i) => {
        if (token.type === 'url') {
          return (
            <a
              key={i}
              href={token.href}
              target="_blank"
              rel="nofollow noopener noreferrer ugc"
              className="ltr-isolate inline text-primary [overflow-wrap:anywhere] hover:underline focus-visible:underline"
            >
              {token.value}
            </a>
          );
        }
        if (token.type === 'hashtag') {
          return (
            <Link key={i} href={hashtagSearchHref(token.tag) as Route} className="text-primary hover:underline focus-visible:underline">
              {token.value}
            </Link>
          );
        }
        return token.value;
      })}
    </span>
  );
}
