'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Home, Library, LogIn, Plus, UserRound, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Bottom tab bar for phones (hidden on desktop and on the watch page). */
export function MobileNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  if (pathname.startsWith('/watch/') || pathname.startsWith('/studio/upload')) return null;

  const item = (href: Route, label: string, Icon: typeof Home, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors outline-none focus-visible:bg-accent',
        active ? 'font-semibold text-primary' : 'text-muted-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
      {label}
    </Link>
  );

  return (
    <nav
      aria-label="ناوبری موبایل"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {item('/', 'خانه', Home, pathname === '/')}
      {item('/shorts', 'شورتس', Zap, pathname.startsWith('/shorts'))}
      <Link
        href={signedIn ? '/studio/upload' : '/login?next=/studio/upload'}
        aria-label="بارگذاری ویدیو"
        className="flex flex-1 items-center justify-center outline-none"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-brand-gradient text-white shadow-md">
          <Plus className="size-6" />
        </span>
      </Link>
      {item('/library', 'کتابخانه', Library, pathname.startsWith('/library'))}
      {signedIn ? item('/studio', 'استودیو', UserRound, pathname.startsWith('/studio')) : item('/login', 'ورود', LogIn, pathname === '/login')}
    </nav>
  );
}
