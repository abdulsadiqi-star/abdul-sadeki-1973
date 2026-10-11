import Link from 'next/link';
import type { Route } from 'next';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ChevronEnd } from '@/components/icons';
import { EmptyState } from '@/components/empty-state';
import { getFormatter } from '@/lib/format-server';
import type { NotificationItem } from '@/features/notifications/queries';
import { cn } from '@/lib/utils';

/** Summary of the newest notifications and how many are unread (the full list lives at /studio/notifications). */
export async function NotificationsCard({ unread, items }: { unread: number; items: NotificationItem[] }) {
  const f = await getFormatter();
  return (
    <Card data-testid="notifications-summary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          اعلان‌ها
          {unread > 0 && <Badge>{f.number(unread)} خوانده‌نشده</Badge>}
        </CardTitle>
        <CardAction>
          <Button asChild variant="ghost" size="xs">
            <Link href="/studio/notifications">
              همه‌ی اعلان‌ها <ChevronEnd />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState icon={Bell} title="اعلانی ندارید" description="رویدادهای مهم کانال شما، مثل دنبال‌کننده‌ی جدید یا دیدگاه تازه، اینجا نمایش داده می‌شود." className="py-8" />
        ) : (
          <ul className="grid gap-x-8 gap-y-1 divide-y md:grid-cols-3 md:divide-y-0 md:gap-y-4">
            {items.map((item) => {
              const body = (
                <>
                  <ChannelAvatar name={item.actor?.name ?? 'تماشاگاه'} src={item.actor?.avatarUrl} size="sm" className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('line-clamp-2 text-sm leading-6', !item.read && 'font-semibold')} dir="auto">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {f.relative(item.createdAt)}
                    </p>
                  </div>
                  {!item.read && <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                  {!item.read && <span className="sr-only">خوانده‌نشده</span>}
                </>
              );
              return (
                <li key={item.id} className="py-2.5 first:pt-0 last:pb-0 md:py-0">
                  {item.href ? (
                    <Link href={item.href as Route} className="flex gap-3 rounded-lg outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
