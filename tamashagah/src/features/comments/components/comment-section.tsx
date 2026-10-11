'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, MessageSquare, MessageSquareOff, MailWarning } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/error-state';
import { useFormatter } from '@/components/providers/format-provider';
import type { CommentsMode } from '@/generated/prisma/enums';
import { postCommentAction } from '../actions';
import type { CommentPageDTO, RepliesPageDTO } from '../dto';
import { COMMENT_PAGE_SIZE } from '../limits';
import { appendComment, bumpReplyCount, countRemovedBy, flatten, prependComment, removeComment, replaceComment, type ViewComment } from './comment-cache';
import { CommentComposer, type ComposerViewer, type SubmitResult } from './comment-composer';
import { CommentItem, repliesKey, type ViewerCaps } from './comment-item';

export type CommentSectionProps = {
  videoId: string;
  /** First page rendered on the server. */
  initialPage: CommentPageDTO;
  /** The signed-in viewer, or null for visitors. */
  viewer: ComposerViewer | null;
  verified: boolean;
  commentsMode: CommentsMode;
  /** `Video.commentsEnabled`. */
  commentsEnabled: boolean;
  /** The viewer owns the channel (their comments skip approval). */
  viewerIsOwner: boolean;
};

async function fetchPage(videoId: string, cursor: string | null): Promise<CommentPageDTO> {
  const params = new URLSearchParams({ videoId, limit: String(COMMENT_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/comments?${params}`, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('comments'), { status: res.status });
  return res.json();
}

/**
 * The comment section of the watch page: list (newest first, "load more"), composer with optimistic posting,
 * replies threads, delete / report. Everything that matters (modes, blocks, spam rules, counters, permissions)
 * is decided by the server; this component only reflects the result.
 */
export function CommentSection({ videoId, initialPage, viewer, verified, commentsMode, commentsEnabled, viewerIsOwner }: CommentSectionProps) {
  const f = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [total, setTotal] = useState(initialPage.total);
  const [announcement, setAnnouncement] = useState('');
  const tempSeq = useRef(0);
  const rootsKey = ['comments', videoId] as const;

  const off = !commentsEnabled || commentsMode === 'DISABLED' || initialPage.disabled === true;
  const caps: ViewerCaps = { viewer, signedIn: viewer !== null, verified, commentsOpen: !off };

  const list = useInfiniteQuery({
    queryKey: rootsKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchPage(videoId, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    initialData: { pages: [initialPage], pageParams: [null] },
    staleTime: 60_000,
    enabled: !off,
  });
  const comments = flatten(list.data);

  /** Post a comment or a reply with an optimistic placeholder; resolves with what the composer should do. */
  async function post(parent: ViewComment | null, text: string): Promise<SubmitResult> {
    if (!viewer) return { ok: false, message: 'برای ادامه وارد شوید.' };
    const rootId = parent ? (parent.rootId ?? parent.id) : null;
    const tempId = `tmp-${++tempSeq.current}`;
    const held = !viewerIsOwner && commentsMode === 'APPROVAL_REQUIRED';
    const optimistic: ViewComment = {
      id: tempId,
      videoId,
      body: text.trim(),
      status: held ? 'PENDING' : 'APPROVED',
      createdAt: new Date().toISOString(),
      replyCount: 0,
      rootId,
      author: { id: viewer.id, name: viewer.name, avatarUrl: viewer.avatarUrl, handle: null, verified: false, isCreator: viewerIsOwner },
      replyToName: parent && parent.rootId ? parent.author.name : null,
      isOwn: true,
      reported: false,
      optimistic: true,
    };

    const rootsUpdate = (fn: (d: InfiniteData<CommentPageDTO> | undefined) => InfiniteData<CommentPageDTO> | undefined) =>
      queryClient.setQueryData<InfiniteData<CommentPageDTO>>(rootsKey, fn);
    const repliesUpdate = (fn: (d: InfiniteData<RepliesPageDTO> | undefined) => InfiniteData<RepliesPageDTO> | undefined) =>
      rootId && queryClient.setQueryData<InfiniteData<RepliesPageDTO>>(repliesKey(rootId), fn);
    const swap = (next: ViewComment | null) => {
      if (rootId) repliesUpdate((d) => replaceComment(d, tempId, next));
      else rootsUpdate((d) => replaceComment(d, tempId, next));
    };

    if (rootId) repliesUpdate((d) => appendComment(d, optimistic));
    else rootsUpdate((d) => prependComment(d, optimistic));

    const res = await postCommentAction({ videoId, body: text, parentId: parent?.id ?? null });
    if (!res.ok) {
      swap(null);
      if (res.code === 'UNAUTHENTICATED') router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return { ok: false, message: res.fieldErrors?.body?.[0] ?? res.message };
    }

    const { comment, outcome } = res.data;
    swap(comment);
    if (outcome === 'published') {
      setTotal((t) => t + 1);
      if (rootId) rootsUpdate((d) => bumpReplyCount(d, rootId, 1));
      setAnnouncement('دیدگاه شما منتشر شد.');
    } else if (outcome === 'pending') {
      toast.info('دیدگاه شما ثبت شد و پس از تأیید سازنده منتشر می‌شود.');
      setAnnouncement('دیدگاه شما ثبت شد و منتظر تأیید سازنده است.');
    } else {
      toast.warning('دیدگاه شما شبیه هرزنامه تشخیص داده شد و منتشر نشد. سازنده‌ی کانال می‌تواند آن را بررسی کند.');
      setAnnouncement('دیدگاه شما منتشر نشد.');
    }
    return { ok: true };
  }

  function onDeleted(comment: ViewComment) {
    setTotal((t) => Math.max(0, t - countRemovedBy(comment)));
    if (comment.rootId === null) {
      queryClient.setQueryData<InfiniteData<CommentPageDTO>>(rootsKey, (d) => removeComment(d, comment.id));
      queryClient.removeQueries({ queryKey: repliesKey(comment.id) });
    } else {
      const rootId = comment.rootId;
      queryClient.setQueryData<InfiniteData<RepliesPageDTO>>(repliesKey(rootId), (d) => removeComment(d, comment.id));
      if (comment.status === 'APPROVED') queryClient.setQueryData<InfiniteData<CommentPageDTO>>(rootsKey, (d) => bumpReplyCount(d, rootId, -1));
    }
    setAnnouncement('دیدگاه حذف شد.');
  }

  const handlers = { onReply: post, onDeleted };

  return (
    <section id="comments" aria-labelledby="comments-heading" className="scroll-mt-24 space-y-5">
      <h2 id="comments-heading" className="flex items-center gap-2 text-lg font-bold">
        دیدگاه‌ها
        {!off && (
          <span className="text-base font-medium text-muted-foreground tabular-nums" data-testid="comment-count">
            {f.number(total)}
          </span>
        )}
      </h2>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {off ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          <MessageSquareOff aria-hidden="true" className="size-6 shrink-0" />
          سازنده‌ی این ویدیو دیدگاه‌ها را بسته است.
        </div>
      ) : (
        <>
          {viewer === null ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">برای نوشتن دیدگاه یا پاسخ دادن وارد حساب کاربری خود شوید.</p>
              <Button asChild size="sm" shape="pill">
                <Link href={`/login?next=${encodeURIComponent(pathname)}`}>ورود به حساب</Link>
              </Button>
            </div>
          ) : !verified ? (
            <Alert variant="warning">
              <MailWarning />
              <AlertDescription className="text-foreground">برای نوشتن دیدگاه ابتدا ایمیل خود را تأیید کنید. پیوند تأیید به ایمیل شما فرستاده شده است.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <CommentComposer viewer={viewer} label="نوشتن دیدگاه" placeholder="دیدگاه خود را بنویسید…" submitLabel="ارسال دیدگاه" onSubmit={(text) => post(null, text)} id="comment-input" />
              {commentsMode === 'APPROVAL_REQUIRED' && !viewerIsOwner && (
                <p className="ps-[3.25rem] text-xs text-muted-foreground">دیدگاه‌ها پیش از انتشار باید توسط سازنده‌ی کانال تأیید شوند.</p>
              )}
            </div>
          )}

          {list.isError && comments.length === 0 ? (
            <ErrorState title="بارگذاری دیدگاه‌ها ممکن نشد" onRetry={() => list.refetch()} />
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
              <MessageSquare aria-hidden="true" className="size-8 text-muted-foreground" />
              <p className="font-semibold">هنوز دیدگاهی نوشته نشده است</p>
              <p className="text-sm text-muted-foreground">اولین نفری باشید که نظر می‌دهد.</p>
            </div>
          ) : (
            <ul className="space-y-5" aria-label="فهرست دیدگاه‌ها">
              {comments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} caps={caps} handlers={handlers} />
              ))}
            </ul>
          )}

          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" shape="pill" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {list.isFetchingNextPage && <Loader2 className="animate-spin" />}
                نمایش دیدگاه‌های بیشتر
              </Button>
            </div>
          )}
          {list.isError && comments.length > 0 && (
            <p role="alert" className="text-center text-sm text-destructive">
              بارگذاری دیدگاه‌های بیشتر ممکن نشد.{' '}
              <button type="button" className="underline" onClick={() => list.fetchNextPage()}>
                تلاش دوباره
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function CommentsSkeleton() {
  return (
    <section aria-label="دیدگاه‌ها" className="space-y-5" role="status">
      <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
      <div className="flex gap-3">
        <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="h-10 flex-1 animate-pulse rounded-md bg-muted" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3" aria-hidden="true">
          <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </section>
  );
}
