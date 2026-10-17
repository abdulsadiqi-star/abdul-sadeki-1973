import Link from 'next/link';
import type { Route } from 'next';
import { CHANNEL_TABS, channelTabLabels, type ChannelTab } from '@/features/channels/queries';
import { cn } from '@/lib/utils';

/** Underlined tab links (server-rendered, so each tab is a real, shareable URL). */
export function ChannelTabs({ handle, active }: { handle: string; active: ChannelTab }) {
  return (
    <nav aria-label="بخش‌های کانال" className="scrollbar-hide overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {CHANNEL_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab}>
              <Link
                href={`/channel/${handle}${tab === 'videos' ? '' : `?tab=${tab}`}` as Route}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-11 items-center border-b-2 px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {channelTabLabels[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
