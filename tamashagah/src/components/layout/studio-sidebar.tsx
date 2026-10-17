'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChannelAvatar } from '@/components/channel-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { Logo } from '@/components/logo';
import { useSidebar } from '@/components/layout/sidebar-provider';
import { isActivePath, studioNav } from '@/components/layout/nav';
import { cn } from '@/lib/utils';

export type StudioChannel = { handle: string; name: string; avatarUrl: string | null; isVerified: boolean };

function StudioNav({ channel, userName }: { channel: StudioChannel | null; userName: string }) {
  const pathname = usePathname();
  const name = channel?.name ?? userName;
  return (
    <div className="flex flex-col gap-4 px-3 py-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <ChannelAvatar name={name} src={channel?.avatarUrl} size="xl" className="ring-4 ring-muted" />
        <p className="flex max-w-full items-center gap-1 text-sm font-bold" dir="auto">
          <span className="truncate">{name}</span>
          {channel?.isVerified && <VerifiedBadge />}
        </p>
        {channel && (
          <Link href={`/channel/${channel.handle}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
            <ExternalLink className="size-3" /> مشاهده‌ی کانال
          </Link>
        )}
      </div>

      {channel && (
        <Button asChild size="sm" shape="pill" className="mx-auto">
          <Link href="/studio/upload">
            <Plus /> بارگذاری ویدیو
          </Link>
        </Button>
      )}

      <nav aria-label="منوی استودیو">
        <ul className="space-y-0.5">
          {studioNav
            // Without a channel only the account settings make sense.
            .filter((item) => channel || item.href === '/studio/settings')
            .map((item) => {
              const active = isActivePath(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      active
                        ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-primary'
                        : 'text-sidebar-foreground hover:bg-muted',
                    )}
                  >
                    <item.icon aria-hidden="true" className="size-5 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </div>
  );
}

/** Creator-studio navigation: fixed on desktop, drawer on mobile (opened by the header menu button). */
export function StudioSidebar({ channel, userName }: { channel: StudioChannel | null; userName: string }) {
  const { mobileOpen, setMobileOpen } = useSidebar();
  return (
    <>
      <aside className="sticky top-(--header-height) hidden h-[calc(100dvh-var(--header-height))] w-(--sidebar-width) shrink-0 overflow-y-auto border-e bg-sidebar scrollbar-thin lg:block">
        <StudioNav channel={channel} userName={userName} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="start" className="w-72 gap-0 overflow-y-auto p-0 sm:max-w-xs">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="sr-only">منوی استودیو</SheetTitle>
            <SheetDescription className="sr-only">پیمایش بین بخش‌های استودیوی سازندگان</SheetDescription>
            <Logo href="/studio" />
          </SheetHeader>
          <StudioNav channel={channel} userName={userName} />
        </SheetContent>
      </Sheet>
    </>
  );
}
