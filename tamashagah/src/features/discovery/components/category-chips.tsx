import Link from 'next/link';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import type { CategoryItem } from '@/features/categories/queries';

/** Horizontally scrolling category chips (links, so they work without JS). `active` is a slug, or null for "همه". */
export function CategoryChips({ categories, active }: { categories: CategoryItem[]; active: string | null }) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label="دسته‌بندی‌ها" className="scrollbar-hide -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
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
