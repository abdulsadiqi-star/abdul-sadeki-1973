'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useSearchParams } from 'next/navigation';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Logo } from '@/components/logo';
import { CategoryIcon } from '@/components/category-icon';
import { useSidebar } from '@/components/layout/sidebar-provider';
import { infoNav, libraryNav, primaryNav, type NavItem } from '@/components/layout/nav';
import type { CategoryItem } from '@/features/categories/queries';
import { cn } from '@/lib/utils';

function useIsActive() {
  const pathname = usePathname();
  const search = useSearchParams();
  return (item: Pick<NavItem, 'href' | 'match'>) => {
    const [path, query] = item.href.split('?') as [string, string | undefined];
    if (query) {
      const wanted = new URLSearchParams(query);
      return pathname === path && [...wanted].every(([k, v]) => search.get(k) === v);
    }
    // The plain "/search" link must not light up for "/search?sort=popular".
    if (item.match === 'exact') return pathname === path;
    return pathname === path || pathname.startsWith(`${path}/`);
  };
}

function ExpandedLink({ href, icon: Icon, label, active }: { href: Route; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-primary'
          : 'text-sidebar-foreground hover:bg-muted',
      )}
    >
      {Icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function RailLink({ href, icon: Icon, label, active }: { href: Route; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center gap-1 rounded-xl px-1 py-3 text-[10px] leading-4 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-muted',
      )}
    >
      {Icon}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      {title && <h2 className="px-3 pb-1.5 text-xs font-semibold text-muted-foreground">{title}</h2>}
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function ExpandedNav({ categories }: { categories: CategoryItem[] }) {
  const isActive = useIsActive();
  const pathname = usePathname();
  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <li key={item.href}>
        <ExpandedLink href={item.href} label={item.label} active={isActive(item)} icon={<item.icon aria-hidden="true" className="size-5 shrink-0" />} />
      </li>
    ));

  return (
    <nav aria-label="منوی اصلی" className="divide-y px-2 py-2">
      <Section>{renderItems(primaryNav)}</Section>
      <Section title="شما">{renderItems(libraryNav)}</Section>
      {categories.length > 0 && (
        <Section title="دسته‌بندی‌ها">
          {categories.map((c) => (
            <li key={c.id}>
              <ExpandedLink
                href={`/category/${c.slug}` as Route}
                label={c.nameFa}
                active={pathname === `/category/${c.slug}`}
                icon={<CategoryIcon name={c.icon} className="size-5 shrink-0" />}
              />
            </li>
          ))}
        </Section>
      )}
      <Section title="تماشاگاه">
        {infoNav.map((item) => (
          <li key={item.href}>
            <ExpandedLink href={item.href} label={item.label} active={isActive(item)} icon={<item.icon aria-hidden="true" className="size-5 shrink-0" />} />
          </li>
        ))}
      </Section>
    </nav>
  );
}

function RailNav() {
  const isActive = useIsActive();
  const items = [...primaryNav, libraryNav[libraryNav.length - 1]!, libraryNav[0]!];
  return (
    <nav aria-label="منوی اصلی" className="px-1.5 py-2">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.href}>
            <RailLink href={item.href} label={item.label.length > 10 ? item.label.split(' ')[0]! : item.label} active={isActive(item)} icon={<item.icon aria-hidden="true" className="size-5" />} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Right-hand navigation:
 *  - desktop: expanded (15rem) or icon rail (4.75rem). Always a rail on watch/shorts.
 *  - mobile: drawer opened from the header menu button.
 */
export function SiteSidebar({ categories }: { categories: CategoryItem[] }) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const pathname = usePathname();
  const rail = collapsed || pathname.startsWith('/watch/') || pathname.startsWith('/shorts');

  return (
    <>
      <aside
        className={cn(
          'sticky top-(--header-height) hidden h-[calc(100dvh-var(--header-height))] shrink-0 overflow-y-auto border-e bg-sidebar transition-[width] duration-200 scrollbar-thin lg:block',
          rail ? 'w-(--sidebar-width-collapsed)' : 'w-(--sidebar-width)',
        )}
      >
        {rail ? <RailNav /> : <ExpandedNav categories={categories} />}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="start" className="w-72 gap-0 p-0 sm:max-w-xs">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="sr-only">منوی اصلی</SheetTitle>
            <SheetDescription className="sr-only">پیمایش بین بخش‌های سایت</SheetDescription>
            <Logo />
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <ExpandedNav categories={categories} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
