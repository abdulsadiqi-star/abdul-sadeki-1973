import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import {
  appendComment,
  bumpReplyCount,
  countRemovedBy,
  flatten,
  prependComment,
  removeComment,
  replaceComment,
  type ViewComment,
} from '@/features/comments/components/comment-cache';
import type { CommentPageDTO } from '@/features/comments/dto';

const c = (id: string, extra: Partial<ViewComment> = {}): ViewComment => ({
  id,
  videoId: 'v',
  body: `متن ${id}`,
  status: 'APPROVED',
  createdAt: '2026-01-01T00:00:00.000Z',
  replyCount: 0,
  rootId: null,
  author: { id: 'u', name: 'کاربر', avatarUrl: null, handle: null, verified: false, isCreator: false },
  replyToName: null,
  isOwn: false,
  reported: false,
  ...extra,
});

const data = (...pages: ViewComment[][]): InfiniteData<CommentPageDTO> => ({
  pages: pages.map((items, i) => ({ items, nextCursor: i < pages.length - 1 ? 'cursor' : null, total: 9 })),
  pageParams: pages.map(() => null),
});
const ids = (d: InfiniteData<CommentPageDTO> | undefined) => d?.pages.map((p) => p.items.map((i) => i.id));

describe('comment cache helpers', () => {
  it('prepends to the first page and keeps every other field of the page', () => {
    const next = prependComment(data([c('a')], [c('b')]), c('new'))!;
    expect(ids(next)).toEqual([['new', 'a'], ['b']]);
    expect(next.pages[0]!.total).toBe(9);
    expect(next.pages[0]!.nextCursor).toBe('cursor');
  });

  it('appends to the last page', () => {
    expect(ids(appendComment(data([c('a')], [c('b')]), c('new')))).toEqual([['a'], ['b', 'new']]);
  });

  it('replaces an optimistic placeholder with the confirmed comment, or drops it', () => {
    const start = data([c('tmp-1', { optimistic: true }), c('a')]);
    expect(replaceComment(start, 'tmp-1', c('real-1'))!.pages[0]!.items.map((i) => i.id)).toEqual(['real-1', 'a']);
    expect(ids(replaceComment(start, 'tmp-1', null))).toEqual([['a']]);
    expect(ids(removeComment(start, 'a'))).toEqual([['tmp-1']]);
  });

  it('adjusts reply counters without going below zero', () => {
    const start = data([c('root', { replyCount: 1 }), c('other', { replyCount: 4 })]);
    expect(bumpReplyCount(start, 'root', 1)!.pages[0]!.items.map((i) => i.replyCount)).toEqual([2, 4]);
    expect(bumpReplyCount(start, 'root', -5)!.pages[0]!.items.map((i) => i.replyCount)).toEqual([0, 4]);
  });

  it('does not mutate its input and tolerates missing data', () => {
    const start = data([c('a')]);
    const snapshot = JSON.stringify(start);
    prependComment(start, c('x'));
    replaceComment(start, 'a', null);
    bumpReplyCount(start, 'a', 3);
    expect(JSON.stringify(start)).toBe(snapshot);
    expect(prependComment(undefined, c('x'))).toBeUndefined();
    expect(replaceComment(undefined, 'a', null)).toBeUndefined();
    expect(prependComment({ pages: [], pageParams: [] } as InfiniteData<CommentPageDTO>, c('x'))!.pages).toEqual([]);
  });

  it('flattens pages and drops duplicates', () => {
    expect(flatten(data([c('a'), c('b')], [c('b'), c('c')])).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(flatten(undefined)).toEqual([]);
  });

  it('knows how many published comments a deletion removes', () => {
    expect(countRemovedBy({ status: 'APPROVED', rootId: null, replyCount: 3 })).toBe(4);
    expect(countRemovedBy({ status: 'APPROVED', rootId: 'root', replyCount: 0 })).toBe(1);
    expect(countRemovedBy({ status: 'PENDING', rootId: null, replyCount: 0 })).toBe(0);
  });
});
