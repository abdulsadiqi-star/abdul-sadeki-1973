'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Ellipsis, Flag, Loader2, Reply, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { VerifiedBadge } from '@/components/verified-badge';
import { useFormatter } from '@/components/providers/format-provider';
import { LinkifiedText } from '@/features/watch/components/linkified-text';
import { ReportDialog } from '@/features/reports/components/report-dialog';
import { deleteCommentAction } from '../actions';
import type { RepliesPageDTO } from '../dto';
import { REPLY_PAGE_SIZE } from '../limits';
import { flatten, type ViewComment } from './comment-cache';
import { CommentComposer, type ComposerViewer, type SubmitResult } from './comment-composer';

export type ViewerCaps = {
  viewer: ComposerViewer | null;
  signedIn: boolean;
  verified: boolean;
  /** Posting is possible (comments are on for this video). */
  commentsOpen: boolean;
};

type Handlers = {
  onReply: (parent: ViewComment, text: string) => Promise<SubmitResult>;
  onDeleted: (comment: ViewComment) => void;
};

export const repliesKey = (rootId: string) => ['comment-replies', rootId] as const;

async function fetchReplies(rootId: string, cursor: string | null): Promise<RepliesPageDTO> {
  const params = new URLSearchParams({ limit: String(REPLY_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/comments/${rootId}/replies?${params}`, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('replies'), { status: res.status });
  return res.json();
}

/** One comment (top-level or reply) with its actions; top-level comments also own their replies thread. */
export function CommentItem({ comment, caps, handlers }: { comment: ViewComment; caps: ViewerCaps; handlers: Handlers }) {
  const f = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const isRoot = comment.rootId === null;
  const [replyOpen, setReplyOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reported, setReported] = useState(comment.reported);

  const pending = comment.status === 'PENDING';

  function requireLogin() {
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
  }

  function openReply() {
    if (!caps.signedIn) return requireLogin();
    if (!caps.verified) return void toast.error('برای نوشتن دیدگاه ابتدا ایمیل خود را تأیید کنید.');
    setReplyOpen(true);
  }

  function openReport() {
    if (!caps.signedIn) return requireLogin();
    if (!caps.verified) return void toast.error('برای گزارش دادن ابتدا ایمیل خود را تأیید کنید.');
    setReportOpen(true);
  }

  async function confirmDelete() {
    const res = await deleteCommentAction({ commentId: comment.id });
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    handlers.onDeleted(comment);
    toast.success('دیدگاه حذف شد.');
    return true;
  }

  async function submitReply(text: string): Promise<SubmitResult> {
    const result = await handlers.onReply(comment, text);
    if (result.ok) {
      setReplyOpen(false);
      setThreadOpen(true);
    }
    return result;
  }

  return (
    <li id={`comment-${comment.id}`} className={comment.optimistic ? 'flex gap-3 opacity-60' : 'flex gap-3'} data-comment-id={comment.id}>
      <div className="shrink-0">
        {comment.author.handle ? (
          <Link href={`/channel/${comment.author.handle}` as Route} aria-label={comment.author.name} tabIndex={-1}>
            <ChannelAvatar name={comment.author.name} src={comment.author.avatarUrl} size={isRoot ? 'md' : 'sm'} />
          </Link>
        ) : (
          <ChannelAvatar name={comment.author.name} src={comment.author.avatarUrl} size={isRoot ? 'md' : 'sm'} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          {comment.author.handle ? (
            <Link href={`/channel/${comment.author.handle}` as Route} className="font-semibold hover:underline" dir="auto">
              {comment.author.name}
            </Link>
          ) : (
            <span className="font-semibold" dir="auto">
              {comment.author.name}
            </span>
          )}
          {comment.author.verified && <VerifiedBadge className="size-3.5" />}
          {comment.author.isCreator && (
            <Badge variant="default" className="rounded-full px-2 py-0 text-[11px]">
              سازنده
            </Badge>
          )}
          <time dateTime={comment.createdAt} title={f.dateTime(comment.createdAt)} className="text-muted-foreground" suppressHydrationWarning>
            {comment.optimistic ? 'در حال ارسال…' : f.relative(comment.createdAt)}
          </time>
          {pending && (
            <Badge variant="warning" className="rounded-full px-2 py-0 text-[11px]">
              در انتظار تأیید سازنده
            </Badge>
          )}
        </div>

        {comment.replyToName && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            در پاسخ به <span className="font-medium text-foreground">{comment.replyToName}</span>
          </p>
        )}
        <LinkifiedText text={comment.body} className="mt-0.5" />

        {!comment.optimistic && (
          <div className="mt-1 flex items-center gap-1 text-muted-foreground">
            {caps.commentsOpen && !pending && (
              // Visitors are sent to the login page, unverified users are told why they cannot (see openReply).
              <Button type="button" variant="ghost" size="xs" shape="pill" onClick={openReply} aria-label={`پاسخ به ${comment.author.name}`}>
                <Reply /> پاسخ
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" shape="pill" aria-label="گزینه‌های دیدگاه">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {comment.isOwn ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 /> حذف دیدگاه
                  </DropdownMenuItem>
                ) : reported ? (
                  <DropdownMenuItem disabled>
                    <Flag /> گزارش شد
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={openReport}>
                    <Flag /> گزارش دیدگاه
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {replyOpen && caps.viewer && (
          <div className="mt-2">
            <CommentComposer
              viewer={caps.viewer}
              label={`پاسخ به ${comment.author.name}`}
              placeholder="پاسخ خود را بنویسید…"
              submitLabel="ارسال پاسخ"
              replyingTo={comment.author.name}
              autoFocus
              compact
              onSubmit={submitReply}
              onCancel={() => setReplyOpen(false)}
            />
          </div>
        )}

        {isRoot && comment.replyCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            shape="pill"
            className="mt-1 -ms-2 text-primary hover:text-primary"
            aria-expanded={threadOpen}
            onClick={() => setThreadOpen((open) => !open)}
          >
            {threadOpen ? <ChevronUp /> : <ChevronDown />}
            {f.number(comment.replyCount)} پاسخ
          </Button>
        )}
        {isRoot && threadOpen && <RepliesThread rootId={comment.id} caps={caps} handlers={handlers} />}
      </div>

      <ReportDialog target={{ type: 'comment', commentId: comment.id }} open={reportOpen} onOpenChange={setReportOpen} onReported={() => setReported(true)} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title="حذف دیدگاه؟"
        description={isRoot && comment.replyCount > 0 ? 'این دیدگاه همراه با پاسخ‌هایش حذف می‌شود و قابل بازگشت نیست.' : 'این دیدگاه حذف می‌شود و قابل بازگشت نیست.'}
        confirmLabel="حذف"
        onConfirm={confirmDelete}
      />
    </li>
  );
}

function RepliesThread({ rootId, caps, handlers }: { rootId: string; caps: ViewerCaps; handlers: Handlers }) {
  const query = useInfiniteQuery({
    queryKey: repliesKey(rootId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchReplies(rootId, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
  const replies = flatten(query.data);

  return (
    <div className="mt-2 border-s ps-3" aria-label="پاسخ‌ها">
      {query.isPending && (
        <div className="space-y-3 py-2" role="status" aria-label="در حال بارگذاری پاسخ‌ها">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      )}
      {query.isError && (
        <p role="alert" className="py-2 text-sm text-destructive">
          بارگذاری پاسخ‌ها ممکن نشد.{' '}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            تلاش دوباره
          </button>
        </p>
      )}
      {replies.length > 0 && (
        <ul className="space-y-4 py-2">
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} caps={caps} handlers={handlers} />
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button type="button" variant="ghost" size="sm" shape="pill" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {query.isFetchingNextPage && <Loader2 className="animate-spin" />}
          نمایش پاسخ‌های بیشتر
        </Button>
      )}
    </div>
  );
}
