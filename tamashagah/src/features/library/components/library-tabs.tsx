import Link from 'next/link';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { LIBRARY_TABS, type LibraryTab } from '@/features/library/queries';
import { libraryTabLabels } from '@/features/library/labels';

/** Pill links between the library sections (each one is a real URL). */
export function LibraryTabs({ active }: { active: 'overview' | LibraryTab }) {
  const tabs = ['overview', ...LIBRARY_TABS] as const;
  return (
    <nav aria-label="بخش‌های کتابخانه" className="scrollbar-hide -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      {tabs.map((tab) => (
        <Button key={tab} asChild size="sm" shape="pill" variant={active === tab ? 'default' : 'secondary'} className="shrink-0">
          <Link href={(tab === 'overview' ? '/library' : `/library/${tab}`) as Route} aria-current={active === tab ? 'page' : undefined}>
            {libraryTabLabels[tab]}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
