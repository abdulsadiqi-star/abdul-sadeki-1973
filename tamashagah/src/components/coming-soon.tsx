import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

/**
 * TEMPORARY placeholder used while a route is still being implemented.
 * Every use of this component must be replaced before release (see docs/status.md).
 */
export function ComingSoon({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-2xl py-10" data-testid="coming-soon">
      <EmptyState icon={Construction} title={`${title} — در حال توسعه`} description={hint ?? 'این بخش در مرحله‌ی بعدی پیاده‌سازی می‌شود.'} />
    </div>
  );
}
