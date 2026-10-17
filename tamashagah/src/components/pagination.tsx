import Link from 'next/link';
import type { Route } from 'next';
import { ChevronEnd, ChevronStart } from '@/components/icons';
import { cn } from '@/lib/utils';
import { toPersianDigits } from '@/lib/persian';

/** Page numbers with ellipses: 1 … 4 [5] 6 … 20 */
export function pageWindow(page: number, pageCount: number, siblings = 1): (number | 'gap')[] {
  const items: (number | 'gap')[] = [];
  const add = (n: number | 'gap') => {
    if (items[items.length - 1] !== n) items.push(n);
  };
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || (p >= page - siblings && p <= page + siblings)) add(p);
    else add('gap');
  }
  return items;
}

const itemClass =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Server-friendly pagination built from plain links, so it works without JS and
 * is crawlable. `href(page)` must return the URL for a page (keep other params!).
 */
export function Pagination({
  page,
  pageCount,
  href,
  className,
}: {
  page: number;
  pageCount: number;
  href: (page: number) => string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const toRoute = (p: number) => href(p) as Route;
  return (
    <nav aria-label="صفحه‌بندی" className={cn('flex flex-wrap items-center justify-center gap-1.5', className)}>
      {page > 1 ? (
        <Link href={toRoute(page - 1)} rel="prev" className={cn(itemClass, 'gap-1 hover:bg-accent')}>
          <ChevronEnd className="size-4" />
          قبلی
        </Link>
      ) : null}
      {pageWindow(page, pageCount).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={toRoute(item)}
            aria-label={`صفحه‌ی ${toPersianDigits(item)}`}
            aria-current={item === page ? 'page' : undefined}
            className={cn(itemClass, item === page ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
          >
            {toPersianDigits(item)}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={toRoute(page + 1)} rel="next" className={cn(itemClass, 'gap-1 hover:bg-accent')}>
          بعدی
          <ChevronStart className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}
