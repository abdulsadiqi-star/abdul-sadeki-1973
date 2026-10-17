'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellOff, Check, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { useFormatter } from '@/components/providers/format-provider';
import { tehranDayKey } from '@/lib/jalali';
import { cn } from '@/lib/utils';
import type { NotificationItem } from '@/features/notifications/queries';
import { notificationTitle, notificationTypeMeta } from '@/features/notifications/types';
import { NotificationIcon } from './notification-icon';

type Filter = 'all' | 'unread';
type Page = { items: NotificationItem[]; nextCursor: string | null; unreadCount?: number };

const PAGE_SIZE = 20;

async function fetchPage(filter: Filter, cursor: string | null): Promise<Page> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  if (filter === 'unread') params.set('unread', '1');
  const res = await fetch(`/api/notifications?${params}`, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('notifications'), { status: res.status });
  return res.json();
}

async function postRead(body: { all: true } | { ids: string[] }): Promise<{ unreadCount: number }> {
  const res = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('mark-read');
  return res.json();
}

/** Local (optimistic) effect of marking notifications read. In the unread filter read items leave the list. */
function applyRead(data: InfiniteData<Page> | undefined, filter: Filter, target: 'all' | ReadonlySet<string>): InfiniteData<Page> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      nextCursor: filter === 'unread' && target === 'all' ? null : page.nextCursor,
      items: page.items
        .map((n) => (target === 'all' || target.has(n.id) ? { ...n, read: true } : n))
        .filter((n) => filter === 'all' || !n.read),
    })),
  };
}

/** Group a (newest-first) list into Tehran calendar days. */
function groupByDay(items: NotificationItem[]): Array<{ key: string; first: string; items: NotificationItem[] }> {
  const groups: Array<{ key: string; first: string; items: NotificationItem[] }> = [];
  for (const item of items) {
    const key = tehranDayKey(new Date(item.createdAt));
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, first: item.createdAt, items: [item] });
  }
  return groups;
}

const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    active ? 'bg-foreground text-background' : 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
  );

/**
 * The full notifications list of /studio/notifications: unread/all filter, cursor pagination ("نمایش بیشتر"),
 * mark one / mark all read with optimistic updates, deep links, grouped by day. The first page is rendered on
 * the server and handed in as `initial`.
 */
export function NotificationsCenter({ filter, initial, initialUnread }: { filter: Filter; initial: Page; initialUnread: number }) {
  const f = useFormatter();
  const queryClient = useQueryClient();
  const [unread, setUnread] = useState(initialUnread);
  const [announcement, setAnnouncement] = useState('');
  const key = useMemo(() => ['notifications', 'center', filter] as const, [filter]);

  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchPage(filter, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    initialData: { pages: [initial], pageParams: [null] },
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: ({ target }: { target: 'all' | string[] }) => postRead(target === 'all' ? { all: true } : { ids: target }),
    onMutate: async ({ target }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<InfiniteData<Page>>(key);
      const set = target === 'all' ? 'all' : new Set(target);
      const newlyRead = (previous?.pages.flatMap((p) => p.items) ?? []).filter((n) => !n.read && (set === 'all' || set.has(n.id))).length;
      queryClient.setQueryData<InfiniteData<Page>>(key, (data) => applyRead(data, filter, set));
      setUnread((u) => (target === 'all' ? 0 : Math.max(0, u - newlyRead)));
      return { previous, unreadBefore: unread };
    },
    onError: (_error, _vars, context) => {
      if (context) {
        queryClient.setQueryData(key, context.previous);
        setUnread(context.unreadBefore);
      }
      toast.error('علامت‌گذاری انجام نشد. لطفاً دوباره تلاش کنید.');
    },
    onSuccess: (data, { target }) => {
      setUnread(data.unreadCount);
      setAnnouncement(target === 'all' ? 'همه‌ی اعلان‌ها خوانده شد.' : 'اعلان خوانده شد.');
    },
    onSettled: () => {
      // keep the header bell in sync (its own query key lives under "notifications")
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'summary'] });
    },
  });

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const groups = useMemo(() => groupByDay(items), [items]);

  const dayLabel = useCallback(
    (iso: string) => {
      const day = tehranDayKey(new Date(iso));
      const now = new Date();
      if (day === tehranDayKey(now)) return 'امروز';
      if (day === tehranDayKey(new Date(now.getTime() - 86_400_000))) return 'دیروز';
      return f.date(iso, 'long');
    },
    [f],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="فیلتر اعلان‌ها" className="flex items-center gap-2">
          <Link href="/studio/notifications" aria-current={filter === 'all' ? 'page' : undefined} className={tabClass(filter === 'all')}>
            همه
          </Link>
          <Link href={'/studio/notifications?filter=unread' as Route} aria-current={filter === 'unread' ? 'page' : undefined} className={tabClass(filter === 'unread')}>
            خوانده‌نشده
            {unread > 0 && (
              <span
                className={cn(
                  'min-w-5 rounded-full px-1.5 text-center text-xs leading-5 tabular-nums',
                  filter === 'unread' ? 'bg-background/20' : 'bg-destructive text-destructive-foreground',
                )}
              >
                {unread > 99 ? `${f.number(99)}+` : f.number(unread)}
              </span>
            )}
          </Link>
        </nav>
        <Button variant="outline" size="sm" shape="pill" disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate({ target: 'all' })}>
          <CheckCheck /> علامت‌گذاری همه به‌عنوان خوانده‌شده
        </Button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {list.isError && items.length === 0 ? (
        <ErrorState title="بارگذاری اعلان‌ها ممکن نشد" onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={filter === 'unread' ? 'همه‌ی اعلان‌ها خوانده شده‌اند' : 'هنوز اعلانی ندارید'}
          description={
            filter === 'unread'
              ? 'اعلان خوانده‌نشده‌ای باقی نمانده است.'
              : 'وقتی کسی دیدگاه بگذارد، کانال شما را دنبال کند یا ویدیوی شما آماده شود، این‌جا خبردار می‌شوید.'
          }
          action={
            filter === 'unread' ? (
              <Button asChild variant="outline" shape="pill">
                <Link href="/studio/notifications">دیدن همه‌ی اعلان‌ها</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-label={dayLabel(group.first)}>
              <h2 className="mb-2 px-1 text-xs font-semibold text-muted-foreground" suppressHydrationWarning>
                {dayLabel(group.first)}
              </h2>
              <ul className="space-y-2">
                {group.items.map((n) => (
                  <NotificationRow key={n.id} n={n} onRead={(id) => markRead.mutate({ target: [id] })} />
                ))}
              </ul>
            </section>
          ))}

          {list.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" shape="pill" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {list.isFetchingNextPage && <Loader2 className="animate-spin" />}
                نمایش بیشتر
              </Button>
            </div>
          )}
          {list.isError && (
            <p role="alert" className="text-center text-sm text-destructive">
              بارگذاری اعلان‌های بیشتر ممکن نشد.{' '}
              <button type="button" className="underline" onClick={() => list.fetchNextPage()}>
                تلاش دوباره
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n, onRead }: { n: NotificationItem; onRead: (id: string) => void }) {
  const f = useFormatter();
  const meta = notificationTypeMeta[n.type];
  const title = notificationTitle(n);

  const text = (
    <>
      <span className="block text-[15px] leading-7 font-medium" dir="auto">
        {title}
      </span>
    </>
  );

  return (
    <li
      className={cn(
        'relative flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors focus-within:ring-[3px] focus-within:ring-ring/40 sm:p-4',
        n.read ? 'hover:bg-accent/30' : 'border-primary/30 bg-accent/30 hover:bg-accent/50',
      )}
      data-read={n.read}
    >
      {n.actor ? (
        <span className="relative shrink-0">
          <ChannelAvatar name={n.actor.name} src={n.actor.avatarUrl} size="md" />
          <NotificationIcon type={n.type} className="absolute -end-1 -bottom-1 size-5 ring-2 ring-card [&_svg]:size-3" />
        </span>
      ) : (
        <NotificationIcon type={n.type} />
      )}

      <div className="min-w-0 flex-1">
        {n.href ? (
          <Link
            href={n.href as Route}
            onClick={() => {
              if (!n.read) onRead(n.id);
            }}
            className="outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            {text}
          </Link>
        ) : (
          text
        )}
        {n.body && (
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground" dir="auto">
            {n.body}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{meta.label}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={n.createdAt} title={f.dateTime(n.createdAt)} suppressHydrationWarning>
            {f.relative(n.createdAt)}
          </time>
          {!n.read && <span className="sr-only">خوانده‌نشده</span>}
        </span>
      </div>

      {!n.read && (
        <div className="relative z-10 flex shrink-0 items-center gap-2 self-center">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          <Button variant="ghost" size="icon-sm" shape="pill" aria-label="علامت‌گذاری به‌عنوان خوانده‌شده" title="علامت‌گذاری به‌عنوان خوانده‌شده" onClick={() => onRead(n.id)}>
            <Check />
          </Button>
        </div>
      )}
    </li>
  );
}
