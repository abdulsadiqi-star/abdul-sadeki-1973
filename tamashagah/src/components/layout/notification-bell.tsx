'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ChannelAvatar } from '@/components/channel-avatar';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import type { NotificationItem } from '@/features/notifications/queries';

type Summary = { items: NotificationItem[]; nextCursor: string | null; unreadCount: number };

async function fetchSummary(): Promise<Summary> {
  const res = await fetch('/api/notifications?limit=8', { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('notifications'), { status: res.status });
  return res.json();
}

async function markRead(body: { all: true } | { ids: string[] }): Promise<{ unreadCount: number }> {
  const res = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('mark-read');
  return res.json();
}

/**
 * Header bell: polls the unread count every minute and shows the latest
 * notifications in a popover. The full list lives at /studio/notifications.
 */
export function NotificationBell() {
  const f = useFormatter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: fetchSummary,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const read = useMutation({
    mutationFn: markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unreadCount ?? 0;
  const label = unread > 0 ? `اعلان‌ها (${f.number(unread)} خوانده‌نشده)` : 'اعلان‌ها';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" shape="pill" aria-label={label} className="relative">
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute end-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-bold text-destructive-foreground"
            >
              {unread > 99 ? f.number(99) + '+' : f.number(unread)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,24rem)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-bold">اعلان‌ها</h2>
          <Button
            variant="ghost"
            size="xs"
            disabled={unread === 0 || read.isPending}
            onClick={() => read.mutate({ all: true })}
          >
            <CheckCheck /> همه خوانده شد
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isPending && (
            <div className="space-y-3 p-4" role="status" aria-label="در حال بارگذاری اعلان‌ها">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {isError && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p>بارگذاری اعلان‌ها ممکن نشد.</p>
              <Button variant="link" size="sm" onClick={() => refetch()}>
                تلاش دوباره
              </Button>
            </div>
          )}
          {data && data.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <BellOff className="size-8" aria-hidden="true" />
              اعلان جدیدی ندارید.
            </div>
          )}
          {data && data.items.length > 0 && (
            <ul>
              {data.items.map((n) => {
                const content = (
                  <>
                    <ChannelAvatar name={n.actor?.name ?? 'تماشاگاه'} src={n.actor?.avatarUrl} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm leading-6" dir="auto">
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="line-clamp-1 block text-[13px] text-muted-foreground" dir="auto">
                          {n.body}
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground" suppressHydrationWarning>
                        {f.relative(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && <span aria-label="خوانده‌نشده" className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                  </>
                );
                const cls = cn(
                  'flex items-start gap-3 border-b px-4 py-3 text-start transition-colors last:border-b-0 hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none',
                  !n.read && 'bg-accent/30',
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link
                        href={n.href as Route}
                        className={cls}
                        onClick={() => {
                          if (!n.read) read.mutate({ ids: [n.id] });
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className={cls}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
            <Link href="/studio/notifications">مشاهده‌ی همه‌ی اعلان‌ها</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
