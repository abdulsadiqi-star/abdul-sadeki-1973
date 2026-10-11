import Link from 'next/link';
import type { Route } from 'next';
import { Quote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChannelAvatar } from '@/components/channel-avatar';
import { ResultList, ResultRow } from '@/components/admin/layout-bits';
import { actionTypeLabels } from '@/features/admin/labels';
import type { ActivityItem } from '@/features/admin/queries/activity';
import type { Formatter } from '@/lib/format';
import { labels } from '@/lib/i18n/fa';

/** Audit rows as readable Persian sentences: who did what, why, and links to what it concerned. Server component. */
export function ActivityList({ items, f, label = 'فهرست فعالیت‌ها', compact = false }: { items: ActivityItem[]; f: Formatter; label?: string; compact?: boolean }) {
  return (
    <ResultList label={label}>
      {items.map((item) => (
        <ResultRow key={item.id} className="items-start">
          <ChannelAvatar name={item.actor?.name ?? 'سیستم'} size="sm" className="mt-0.5" />
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-sm leading-7" dir="auto">
              {item.actor ? (
                <Link href={`/admin/users/${item.actor.id}` as Route} className="font-bold hover:text-primary hover:underline">
                  {item.sentence.actor}
                </Link>
              ) : (
                <strong>{item.sentence.actor}</strong>
              )}{' '}
              <span>{item.sentence.predicate}.</span>
            </p>
            {item.reason && (
              <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-6 text-muted-foreground" dir="auto">
                <Quote aria-hidden="true" className="mt-1 size-3.5 shrink-0 rtl:-scale-x-100" />
                <span className="user-text break-words whitespace-pre-line">{item.reason}</span>
              </p>
            )}
            {!compact && item.commentExcerpt && (
              <p className="mt-1 line-clamp-2 rounded-md bg-muted/60 px-2 py-1 text-[13px] text-muted-foreground" dir="auto">
                {item.commentExcerpt}
              </p>
            )}
            {!compact && item.links.length > 0 && (
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {item.links.map((l) => (
                  <Link key={`${l.kind}-${l.href}`} href={l.href as Route} className="text-primary hover:underline" dir="auto">
                    {l.label}
                  </Link>
                ))}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
            <time dateTime={item.createdAt} title={f.dateTime(item.createdAt)} suppressHydrationWarning>
              {f.relative(item.createdAt)}
            </time>
            {!compact && (
              <span className="flex flex-wrap items-center justify-end gap-1">
                <Badge variant="outline">{actionTypeLabels[item.type]}</Badge>
                {item.actor && item.actor.role !== 'MODERATOR' && item.actor.role !== 'ADMIN' && <Badge variant="muted">{labels.role[item.actor.role]}</Badge>}
              </span>
            )}
          </div>
        </ResultRow>
      ))}
    </ResultList>
  );
}
