import type { ReactNode } from 'react';

/**
 * Grid cell around a `StatCard`: gives tests/e2e a stable hook (`data-testid="stat-<id>"`) and stretches the card to the
 * row height. (A real block, not `display: contents`, so the hook is also visible to Playwright.)
 */
export function StatCell({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div data-testid={`stat-${id}`} className="min-w-0 [&>div]:h-full">
      {children}
    </div>
  );
}
