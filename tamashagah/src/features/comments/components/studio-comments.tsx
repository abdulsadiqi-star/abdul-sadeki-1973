'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, Check, Ellipsis, Loader2, MessageSquare, MessageSquareOff, Reply, Search, ShieldCheck, Trash2, TriangleAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { useFormatter } from '@/components/providers/format-provider';
import { PosterPlaceholder } from '@/components/video/video-card';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import {
  blockCommenterAction,
  bulkModerateCommentsAction,
  creatorReplyAction,
  moderateCommentAction,
  unblockCommenterAction,
} from '../studio-actions';
import type { ModerationStatus, StudioTab } from '../schemas';
import type { SpamWriter, StudioCommentRow, StudioCommentsPage, StudioCounts } from '../studio-queries';
import { CommentComposer, type ComposerViewer } from './comment-composer';
import { SpamWritersDialog } from './spam-writers-dialog';

const TABS: Array<{ id: StudioTab; label: string }> = [
  { id: 'all', label: 'همه دیدگاه‌ها' },
  { id: 'spam', label: 'دیدگاه‌های هرز' },
  { id: 'pending', label: 'تأیید نشده' },
  { id: 'replies', label: 'پاسخ‌ها' },
];

const EMPTY: Record<StudioTab, { title: string; description: string }> = {
  all: { title: 'هنوز دیدگاهی ثبت نشده است', description: 'وقتی بیننده‌ها زیر ویدیوهای شما دیدگاه بنویسند، این‌جا می‌بینید و می‌توانید مدیریتشان کنید.' },
  spam: { title: 'دیدگاه هرزی وجود ندارد', description: 'دیدگاه‌هایی که به‌عنوان هرزنامه شناسایی یا علامت‌گذاری شوند، این‌جا نگهداری می‌شوند.' },
  pending: { title: 'دیدگاهی در انتظار تأیید نیست', description: 'اگر کانال شما «نیاز به تأیید من» باشد، دیدگاه‌های تازه این‌جا منتظر تصمیم شما می‌مانند.' },
  replies: { title: 'هنوز پاسخی ثبت نشده است', description: 'پاسخ‌های بیننده‌ها و پاسخ‌های شما به دیدگاه‌ها در این بخش فهرست می‌شود.' },
};

const statusBadge: Record<StudioCommentRow['status'], { text: string; variant: 'success' | 'warning' | 'muted' | 'destructive' }> = {
  APPROVED: { text: labels.commentStatus.APPROVED, variant: 'success' },
  PENDING: { text: labels.commentStatus.PENDING, variant: 'warning' },
  REJECTED: { text: labels.commentStatus.REJECTED, variant: 'muted' },
  SPAM: { text: labels.commentStatus.SPAM, variant: 'destructive' },
  DELETED: { text: labels.commentStatus.DELETED, variant: 'muted' },
};

const tabHref = (tab: StudioTab, q: string): Route => {
  const params = new URLSearchParams();
  if (tab !== 'all') params.set('tab', tab);
  if (q) params.set('q', q);
  const qs = params.toString();
  return (qs ? `/studio/comments?${qs}` : '/studio/comments') as Route;
};

type Props = {
  tab: StudioTab;
  q: string;
  counts: StudioCounts;
  data: StudioCommentsPage;
  writers: SpamWriter[];
  owner: ComposerViewer;
};

/**
 * Comment moderation for the channel owner (reference: the creator-studio "دیدگاه‌ها" screen): pill tabs with live
 * counts, rows with checkbox / avatar / text / video / "تأیید و انتشار", a "…" menu (reject, spam, delete, reply,
 * block), inline creator reply, bulk actions on the selected rows, search, and the spam-writers list.
 * All the work happens in server actions that re-check permissions; this component only calls them.
 */
export function StudioComments({ tab, q, counts, data, writers, owner }: Props) {
  const f = useFormatter();
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StudioCommentRow | 'bulk' | null>(null);
  const [, startTransition] = useTransition();

  const visibleIds = new Set(data.items.map((c) => c.id));
  const selectedIds = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = data.items.length > 0 && selectedIds.length === data.items.length;

  const countText = (n: number) => (n > 99 ? `${f.number(99)}+` : f.number(n));

  function toggleOne(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(data.items.map((c) => c.id)) : new Set());
  }

  /** One server action for one row, then a refresh of the server-rendered list and counts. */
  function runRow(id: string, action: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  const setStatus = (row: StudioCommentRow, status: ModerationStatus, success: string) =>
    runRow(row.id, () => moderateCommentAction({ commentId: row.id, status }), success);

  async function runBulk(status: ModerationStatus, success: (changed: number) => string) {
    setBulkBusy(true);
    const res = await bulkModerateCommentsAction({ commentIds: selectedIds, status });
    setBulkBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    toast.success(res.data.changed > 0 ? success(res.data.changed) : 'تغییری لازم نبود.');
    setSelected(new Set());
    router.refresh();
    return true;
  }

  async function confirmDelete() {
    if (deleting === 'bulk') return runBulk('DELETED', (n) => `${f.number(n)} دیدگاه حذف شد.`);
    if (!deleting) return false;
    const row = deleting;
    const res = await moderateCommentAction({ commentId: row.id, status: 'DELETED' });
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    toast.success('دیدگاه حذف شد.');
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-4">
      {/* Tabs + spam writers */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="دسته‌بندی دیدگاه‌ها" className="scrollbar-hide -mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <Link
                key={t.id}
                href={tabHref(t.id, q)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'bg-foreground text-background' : 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
                )}
              >
                {t.label}
                <span
                  className={cn('min-w-6 rounded-md px-1.5 text-center text-xs leading-5 tabular-nums', active ? 'bg-background/20' : 'bg-foreground/10')}
                  aria-label={`${f.number(counts[t.id])} مورد`}
                >
                  {countText(counts[t.id])}
                </span>
              </Link>
            );
          })}
        </nav>
        <SpamWritersDialog writers={writers} />
      </div>

      {/* Search */}
      <form role="search" method="get" action="/studio/comments" className="flex max-w-xl items-center gap-2">
        {tab !== 'all' && <input type="hidden" name="tab" value={tab} />}
        <div className="relative flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" name="q" defaultValue={q} aria-label="جستجو در دیدگاه‌ها" placeholder="جستجو در متن، نویسنده یا عنوان ویدیو…" maxLength={100} className="ps-9" />
        </div>
        <Button type="submit" variant="outline">
          جستجو
        </Button>
        {q && (
          <Button asChild variant="ghost">
            <Link href={tabHref(tab, '')}>پاک کردن</Link>
          </Button>
        )}
      </form>

      {/* Bulk bar */}
      {data.items.length > 0 && (
        <div className="sticky top-(--header-height) z-20 flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur" role="toolbar" aria-label="عملیات گروهی">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={allSelected ? true : selectedIds.length > 0 ? 'indeterminate' : false} onCheckedChange={(v) => toggleAll(v === true)} aria-label="انتخاب همه‌ی دیدگاه‌های این صفحه" />
            {selectedIds.length > 0 ? `${f.number(selectedIds.length)} مورد انتخاب شده` : 'انتخاب همه'}
          </label>
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" shape="pill" disabled={bulkBusy} onClick={() => void runBulk('APPROVED', (n) => `${f.number(n)} دیدگاه تأیید و منتشر شد.`)}>
                {bulkBusy ? <Loader2 className="animate-spin" /> : <Check />} تأیید و انتشار
              </Button>
              <Button type="button" size="sm" shape="pill" variant="outline" disabled={bulkBusy} onClick={() => void runBulk('REJECTED', (n) => `${f.number(n)} دیدگاه رد شد.`)}>
                <X /> رد کردن
              </Button>
              <Button type="button" size="sm" shape="pill" variant="outline" disabled={bulkBusy} onClick={() => void runBulk('SPAM', (n) => `${f.number(n)} دیدگاه به‌عنوان هرز علامت خورد.`)}>
                <TriangleAlert /> هرز
              </Button>
              <Button type="button" size="sm" shape="pill" variant="destructive" disabled={bulkBusy} onClick={() => setDeleting('bulk')}>
                <Trash2 /> حذف
              </Button>
              <Button type="button" size="sm" shape="pill" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
                لغو انتخاب
              </Button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {data.items.length === 0 ? (
        q ? (
          <EmptyState icon={Search} title="نتیجه‌ای پیدا نشد" description={`برای «${q}» در این بخش دیدگاهی وجود ندارد.`} />
        ) : (
          <EmptyState icon={tab === 'spam' ? MessageSquareOff : MessageSquare} title={EMPTY[tab].title} description={EMPTY[tab].description} />
        )
      ) : (
        <ul className="space-y-3" aria-label="فهرست دیدگاه‌ها">
          {data.items.map((row) => (
            <CommentRow
              key={row.id}
              row={row}
              owner={owner}
              selected={selected.has(row.id)}
              busy={busyId === row.id}
              replying={replyId === row.id}
              onSelect={(on) => toggleOne(row.id, on)}
              onApprove={() => setStatus(row, 'APPROVED', 'دیدگاه تأیید و منتشر شد.')}
              onReject={() => setStatus(row, 'REJECTED', 'دیدگاه رد شد.')}
              onSpam={() => setStatus(row, 'SPAM', 'دیدگاه به‌عنوان هرز علامت خورد.')}
              onDelete={() => setDeleting(row)}
              onReply={() => setReplyId(row.id)}
              onCancelReply={() => setReplyId(null)}
              onBlockToggle={() =>
                runRow(
                  row.id,
                  () => (row.author.blocked ? unblockCommenterAction({ userId: row.author.id }) : blockCommenterAction({ userId: row.author.id, reason: 'مسدود از بخش دیدگاه‌ها' })),
                  row.author.blocked ? `«${row.author.name}» از مسدودیت خارج شد.` : `«${row.author.name}» مسدود شد.`,
                )
              }
              onReplySent={(approvedParent) => {
                setReplyId(null);
                toast.success(approvedParent ? 'پاسخ ثبت شد و دیدگاه هم منتشر شد.' : 'پاسخ شما ثبت شد.');
                router.refresh();
              }}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={deleting === 'bulk' ? `حذف ${f.number(selectedIds.length)} دیدگاه؟` : 'حذف دیدگاه؟'}
        description="دیدگاه حذف می‌شود و قابل بازگشت نیست. پاسخ‌های زیر یک دیدگاه اصلی هم همراه با آن حذف می‌شوند."
        confirmLabel="حذف"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CommentRow({
  row,
  owner,
  selected,
  busy,
  replying,
  onSelect,
  onApprove,
  onReject,
  onSpam,
  onDelete,
  onReply,
  onCancelReply,
  onBlockToggle,
  onReplySent,
}: {
  row: StudioCommentRow;
  owner: ComposerViewer;
  selected: boolean;
  busy: boolean;
  replying: boolean;
  onSelect: (on: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onSpam: () => void;
  onDelete: () => void;
  onReply: () => void;
  onCancelReply: () => void;
  onBlockToggle: () => void;
  onReplySent: (approvedParent: boolean) => void;
}) {
  const f = useFormatter();
  const badge = statusBadge[row.status];
  const canReply = row.status === 'APPROVED' || row.status === 'PENDING';

  const video = (
    <Link
      href={`/watch/${row.video.id}` as Route}
      className="group/video flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:flex-col md:items-stretch md:gap-1.5"
    >
      <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted md:w-full">
        {row.video.posterUrl ? <img src={row.video.posterUrl} alt="" loading="lazy" className="size-full object-cover" /> : <PosterPlaceholder />}
      </span>
      <span className="line-clamp-2 min-w-0 text-xs leading-5 text-muted-foreground group-hover/video:text-foreground" dir="auto">
        {row.video.title}
      </span>
    </Link>
  );

  return (
    <li className={cn('rounded-xl border bg-card p-3 transition-colors sm:p-4', selected && 'border-primary/50 bg-accent/20', busy && 'pointer-events-none opacity-60')} aria-busy={busy} data-comment-id={row.id} data-status={row.status}>
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 md:grid-cols-[auto_auto_minmax(0,1fr)_11rem_auto]">
        <Checkbox className="mt-2" checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`انتخاب دیدگاه ${row.author.name}`} />
        <ChannelAvatar name={row.author.name} src={row.author.avatarUrl} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold" dir="auto">
              {row.author.name}
            </span>
            {row.isOwner && (
              <Badge variant="default" className="rounded-full px-2 py-0 text-[11px]">
                سازنده
              </Badge>
            )}
            <time dateTime={row.createdAt} title={f.dateTime(row.createdAt)} className="text-xs text-muted-foreground" suppressHydrationWarning>
              {f.relative(row.createdAt)}
            </time>
            <Badge variant={badge.variant} className="rounded-full px-2 py-0 text-[11px]">
              {badge.text}
            </Badge>
            {row.author.blocked && (
              <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                کاربر مسدود
              </Badge>
            )}
            {row.reportCount > 0 && (
              <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                {f.number(row.reportCount)} گزارش
              </Badge>
            )}
          </div>

          {row.parentExcerpt && (
            <p className="mt-1 line-clamp-1 border-s-2 ps-2 text-xs text-muted-foreground" dir="auto">
              در پاسخ به: «{row.parentExcerpt}»
            </p>
          )}
          <p dir="auto" className="user-text mt-1 text-[15px] leading-7 break-words whitespace-pre-wrap">
            {row.body}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {row.status !== 'APPROVED' && (
              <Button type="button" variant="link" size="xs" className="h-auto px-0 font-semibold" onClick={onApprove}>
                تأیید و انتشار <Check />
              </Button>
            )}
            {canReply && !replying && (
              <Button type="button" variant="ghost" size="xs" shape="pill" onClick={onReply} aria-label={`پاسخ به ${row.author.name}`}>
                <Reply /> پاسخ
              </Button>
            )}
          </div>

          {replying && (
            <div className="mt-3">
              <CommentComposer
                viewer={owner}
                label={`پاسخ به ${row.author.name}`}
                placeholder="پاسخ خود را بنویسید…"
                submitLabel="ارسال پاسخ"
                replyingTo={row.author.name}
                autoFocus
                compact
                onCancel={onCancelReply}
                onSubmit={async (text) => {
                  const res = await creatorReplyAction({ commentId: row.id, body: text });
                  if (!res.ok) return { ok: false, message: res.fieldErrors?.body?.[0] ?? res.message };
                  onReplySent(res.data.approvedParent);
                  return { ok: true };
                }}
              />
              {row.status === 'PENDING' && <p className="mt-1 ps-11 text-xs text-muted-foreground">با ارسال پاسخ، این دیدگاه هم منتشر می‌شود.</p>}
            </div>
          )}
        </div>

        <div className="col-span-4 row-start-2 md:col-span-1 md:col-start-4 md:row-start-1">{video}</div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" shape="pill" className="col-start-4 row-start-1 md:col-start-5" aria-label={`گزینه‌های دیدگاه ${row.author.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {row.status !== 'APPROVED' && (
              <DropdownMenuItem onSelect={onApprove}>
                <Check /> تأیید و انتشار
              </DropdownMenuItem>
            )}
            {row.status !== 'REJECTED' && (
              <DropdownMenuItem onSelect={onReject}>
                <X /> رد کردن
              </DropdownMenuItem>
            )}
            {row.status !== 'SPAM' && (
              <DropdownMenuItem onSelect={onSpam}>
                <TriangleAlert /> علامت‌گذاری به‌عنوان هرز
              </DropdownMenuItem>
            )}
            {canReply && (
              <DropdownMenuItem onSelect={onReply}>
                <Reply /> پاسخ دادن
              </DropdownMenuItem>
            )}
            {!row.isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onBlockToggle}>
                  {row.author.blocked ? <ShieldCheck /> : <Ban />}
                  {row.author.blocked ? 'رفع مسدودیت کاربر' : 'مسدود کردن کاربر'}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> حذف دیدگاه
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
