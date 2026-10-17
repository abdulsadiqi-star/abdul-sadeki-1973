import Link from 'next/link';
import type { Route } from 'next';
import { studioListHref } from '@/features/videos-studio/filters';
import { studioTabs, type StudioTab } from '@/features/videos-studio/labels';
import type { StudioListParams } from '@/features/videos-studio/schemas';
import { getFormatter } from '@/lib/format-server';
import { cn } from '@/lib/utils';

/**
 * The state tabs of the video list as plain links (so they work without JavaScript and every tab has its own URL).
 * Same look as the `pills` Tabs variant.
 */
export async function VideoTabsNav({ params, counts }: { params: StudioListParams; counts: Record<StudioTab, number> }) {
  const f = await getFormatter();
  return (
    <nav aria-label="وضعیت ویدیوها">
      <ul className="scrollbar-hide flex w-full items-center gap-2 overflow-x-auto pb-1">
        {studioTabs.map((tab) => {
          const active = params.tab === tab.value;
          return (
            <li key={tab.value} className="shrink-0">
              <Link
                href={studioListHref(params, { tab: tab.value, page: 1 }) as Route}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'bg-foreground text-background' : 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
                )}
              >
                {tab.label}
                <span className={cn('text-xs tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}>{f.number(counts[tab.value])}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
