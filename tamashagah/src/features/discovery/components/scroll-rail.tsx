'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronEnd, ChevronStart } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Horizontally scrolling row with scroll-snap. Touch users swipe; mouse users get previous/next buttons that appear
 * only when there is more to see in that direction. Keyboard users simply tab through the items (the browser scrolls
 * the focused one into view). Direction-aware: works in RTL, where the scroll origin is the right edge.
 */
export function ScrollRail({
  label,
  children,
  className,
  arrowTop = '4.8rem',
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Vertical centre of the arrow buttons (the middle of the thumbnails). */
  arrowTop?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setEdges({ atStart: pos <= 4, atEnd: pos >= max - 4 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [update]);

  function page(direction: 'prev' | 'next') {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    // "next" always means toward the END of the line: left in RTL, right in LTR.
    const sign = (direction === 'next' ? 1 : -1) * (rtl ? -1 : 1);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: sign * el.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' });
  }

  const arrow =
    'absolute z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-background/95 text-foreground shadow-md transition-opacity outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:flex';

  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        role="group"
        aria-label={label}
        className="scrollbar-hide -mx-3 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-3 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 motion-reduce:scroll-auto"
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={`${label}؛ مورد قبلی`}
        onClick={() => page('prev')}
        tabIndex={edges.atStart ? -1 : 0}
        aria-hidden={edges.atStart || undefined}
        style={{ top: arrowTop }}
        className={cn(arrow, 'start-1', edges.atStart && 'pointer-events-none opacity-0')}
      >
        <ChevronStart className="size-5" />
      </button>
      <button
        type="button"
        aria-label={`${label}؛ مورد بعدی`}
        onClick={() => page('next')}
        tabIndex={edges.atEnd ? -1 : 0}
        aria-hidden={edges.atEnd || undefined}
        style={{ top: arrowTop }}
        className={cn(arrow, 'end-1', edges.atEnd && 'pointer-events-none opacity-0')}
      >
        <ChevronEnd className="size-5" />
      </button>
    </div>
  );
}
