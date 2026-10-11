/**
 * Pure transformations of the TanStack Query infinite-list caches used by the comment section (optimistic
 * posting, deleting, reply counters). Kept free of React so they are unit-tested
 * (tests/unit/comment-cache.test.ts).
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { CommentDTO } from '../dto';

/** A comment as shown in the UI: the server DTO plus a client-only flag for not-yet-confirmed ones. */
export type ViewComment = CommentDTO & { optimistic?: boolean };

type Page<C> = { items: C[] };

export function mapItems<P extends Page<ViewComment>>(data: InfiniteData<P> | undefined, fn: (items: ViewComment[]) => ViewComment[]): InfiniteData<P> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: fn(page.items) })) };
}

/** Put a comment at the top (newest first) of the first page. */
export function prependComment<P extends Page<ViewComment>>(data: InfiniteData<P> | undefined, comment: ViewComment): InfiniteData<P> | undefined {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  return { ...data, pages: [{ ...first!, items: [comment, ...first!.items] } as P, ...rest] };
}

/** Put a comment at the end of the last loaded page (replies read oldest → newest). */
export function appendComment<P extends Page<ViewComment>>(data: InfiniteData<P> | undefined, comment: ViewComment): InfiniteData<P> | undefined {
  if (!data || data.pages.length === 0) return data;
  const pages = [...data.pages];
  const last = pages[pages.length - 1]!;
  pages[pages.length - 1] = { ...last, items: [...last.items, comment] } as P;
  return { ...data, pages };
}

/** Swap one comment for another (the optimistic placeholder for the server's version), or remove it with `null`. */
export function replaceComment<P extends Page<ViewComment>>(data: InfiniteData<P> | undefined, id: string, next: ViewComment | null): InfiniteData<P> | undefined {
  return mapItems(data, (items) => (next ? items.map((c) => (c.id === id ? next : c)) : items.filter((c) => c.id !== id)));
}

export const removeComment = <P extends Page<ViewComment>>(data: InfiniteData<P> | undefined, id: string) => replaceComment(data, id, null);

/** Adjust the reply counter of a root comment (never below zero). */
export function bumpReplyCount<P extends Page<ViewComment>>(data: InfiniteData<P> | undefined, rootId: string, delta: number): InfiniteData<P> | undefined {
  return mapItems(data, (items) => items.map((c) => (c.id === rootId ? { ...c, replyCount: Math.max(0, c.replyCount + delta) } : c)));
}

/** Flatten all loaded pages, dropping duplicates (a comment can arrive both optimistically and through a refetch). */
export function flatten<P extends Page<ViewComment>>(data: InfiniteData<P> | undefined): ViewComment[] {
  const seen = new Set<string>();
  const out: ViewComment[] = [];
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** How many published comments disappear from `Video.commentCount` when `comment` is deleted (a root takes its replies along). */
export function countRemovedBy(comment: Pick<ViewComment, 'status' | 'rootId' | 'replyCount'>): number {
  if (comment.status !== 'APPROVED') return 0; // held comments were never counted
  return comment.rootId === null ? 1 + comment.replyCount : 1;
}
