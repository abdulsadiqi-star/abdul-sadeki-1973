'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Logo } from '@/components/logo';
import { useSidebar } from '@/components/layout/sidebar-provider';
import { adminNav } from '@/components/layout/admin-nav';
import { isActivePath } from '@/components/layout/nav';
import { useFormatter } from '@/components/providers/format-provider';
import { roleCan } from '@/features/admin/policy';
import type { NavCounts } from '@/features/admin/queries/overview';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/generated/prisma/enums';

function AdminNav({ role, displayName, counts }: { role: UserRole; displayName: string; counts: NavCounts }) {
  const pathname = usePathname();
  const f = useFormatter();
  return (
    <div className="flex flex-col gap-4 px-3 py-5">
      <div className="flex items-center gap-3 rounded-xl bg-accent/60 p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-sm">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold">پنل مدیریت</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate" dir="auto">
              {displayName}
            </span>
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
              {labels.role[role]}
            </Badge>
          </p>
        </div>
      </div>

      <nav aria-label="منوی پنل مدیریت">
        <ul className="space-y-0.5">
          {adminNav
            .filter((item) => !item.capability || roleCan(role, item.capability))
            .map((item) => {
              const active = isActivePath(pathname, item);
              const count = item.badge ? counts[item.badge] : null;
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
                    <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                    {count ? (
                      <span
                        className="min-w-6 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-bold text-primary-foreground tabular-nums"
                        aria-label={`${f.number(count)} مورد در انتظار`}
                      >
                        {count > 99 ? `${f.number(99)}+` : f.number(count)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>

      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowRight aria-hidden="true" className="size-4 ltr:rotate-180" />
        بازگشت به سایت
      </Link>
    </div>
  );
}

/** Staff navigation: fixed on desktop, drawer on mobile (opened by the header menu button). */
export function AdminSidebar(props: { role: UserRole; displayName: string; counts: NavCounts }) {
  const { mobileOpen, setMobileOpen } = useSidebar();
  return (
    <>
      <aside className="sticky top-(--header-height) hidden h-[calc(100dvh-var(--header-height))] w-(--sidebar-width) shrink-0 overflow-y-auto border-e bg-sidebar scrollbar-thin lg:block">
        <AdminNav {...props} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="start" className="w-72 gap-0 overflow-y-auto p-0 sm:max-w-xs">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="sr-only">منوی پنل مدیریت</SheetTitle>
            <SheetDescription className="sr-only">پیمایش بین بخش‌های پنل مدیریت</SheetDescription>
            <Logo href="/" />
          </SheetHeader>
          <AdminNav {...props} />
        </SheetContent>
      </Sheet>
    </>
  );
}
