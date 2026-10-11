'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Collapses long content to a few lines with a "نمایش بیشتر / نمایش کمتر" toggle. The toggle only appears when the
 * content really overflows (measured with a ResizeObserver, so it stays right when the viewport or font changes).
 * Without JavaScript the text is simply clamped by CSS.
 */
export function ExpandableDescription({ children, lines = 3, id }: { children: ReactNode; lines?: 2 | 3 | 4; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return; // measuring only makes sense while clamped
    const observer = new ResizeObserver(() => setOverflowing(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  const clamp = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[lines];
  return (
    <div>
      <div ref={ref} id={id} className={cn(!expanded && clamp)}>
        {children}
      </div>
      {overflowing && (
        <Button type="button" variant="link" size="xs" className="mt-1 h-auto px-0 font-semibold" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'نمایش کمتر' : 'نمایش بیشتر'}
        </Button>
      )}
    </div>
  );
}
