import { Suspense } from 'react';
import Link from 'next/link';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { SearchBox } from '@/components/layout/search-box';
import { ServicesMenu } from '@/components/layout/services-menu';
import { NotificationBell } from '@/components/layout/notification-bell';
import { UserMenu } from '@/components/layout/user-menu';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { SidebarToggle } from '@/components/layout/sidebar-toggle';
import type { CurrentUser } from '@/lib/auth/session';

/**
 * Global top bar (identical on every page, like the reference):
 *   start (right):  menu button + logo
 *   center:         search
 *   end (left):     upload · services · notifications · account
 */
export function SiteHeader({ user, desktopToggle = true }: { user: CurrentUser | null; desktopToggle?: boolean }) {
  const uploadHref = user ? '/studio/upload' : '/login?next=/studio/upload';
  return (
    <header className="sticky top-0 z-40 h-(--header-height) border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="relative mx-auto flex h-full max-w-[120rem] items-center gap-2 px-3 sm:px-4">
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <SidebarToggle desktop={desktopToggle} />
          <Logo />
        </div>

        <div className="flex min-w-0 flex-1 justify-center px-2">
          <Suspense fallback={null}>
            <SearchBox className="w-full max-w-xl" />
          </Suspense>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <Button asChild variant="outline" shape="pill" size="sm" className="hidden sm:inline-flex">
            <Link href={uploadHref}>
              <Upload /> بارگذاری ویدیو
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" shape="pill" className="sm:hidden">
            <Link href={uploadHref} aria-label="بارگذاری ویدیو">
              <Upload className="size-5" />
            </Link>
          </Button>
          <ServicesMenu />
          <ThemeToggle />
          {user ? (
            <>
              <NotificationBell />
              <UserMenu
                user={{
                  displayName: user.displayName,
                  email: user.email,
                  avatarUrl: user.avatarUrl,
                  role: user.role,
                  channel: user.channel
                    ? {
                        handle: user.channel.handle,
                        name: user.channel.name,
                        avatarUrl: user.channel.avatarUrl,
                        isVerified: user.channel.isVerified,
                      }
                    : null,
                }}
              />
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">ورود</Link>
              </Button>
              <Button asChild size="sm" shape="pill">
                <Link href="/register">ثبت‌نام</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
