'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import type { CategoryItem } from '@/features/categories/queries';

/**
 * Horizontally scrolling category chips (real links, so they work without JS). `active` is a slug, or null for "همه".
 * With 17 chips the active one can sit off-screen on a phone, so it is scrolled into view on mount.
 */
export function CategoryChips({ categories, active }: { categories: CategoryItem[]; active: string | null }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || active === null) return;
    // Scroll only the chip row (never the page): centre the active chip. Bounding boxes are direction-agnostic,
    // and scrollBy's `left` is physical (positive = view moves right), so this works in RTL too.
    const navBox = nav.getBoundingClientRect();
    const chipBox = current.getBoundingClientRect();
    nav.scrollBy({ left: chipBox.left + chipBox.width / 2 - (navBox.left + navBox.width / 2), behavior: 'auto' });
  }, [active]);

  if (categories.length === 0) return null;
  return (
    <nav ref={ref} aria-label="دسته‌بندی‌ها" className="scrollbar-hide -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
      <Button asChild size="sm" shape="pill" variant={active === null ? 'default' : 'secondary'} className="shrink-0">
        <Link href="/" aria-current={active === null ? 'page' : undefined}>
          همه
        </Link>
      </Button>
      {categories.map((c) => (
        <Button key={c.id} asChild size="sm" shape="pill" variant={active === c.slug ? 'default' : 'secondary'} className="shrink-0">
          <Link href={`/category/${c.slug}` as Route} aria-current={active === c.slug ? 'page' : undefined}>
            <CategoryIcon name={c.icon} />
            {c.nameFa}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
