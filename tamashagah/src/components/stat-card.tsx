import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dashboard metric tile (studio dashboard / analytics), modelled on the
 * creator-studio reference: big centered number, small icon + label below.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  badge,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Secondary line, e.g. a date range. */
  hint?: ReactNode;
  /** Small chip next to the value (e.g. a % change). */
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border bg-card px-4 py-5 text-center shadow-xs', className)}>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-extrabold tabular-nums">{value}</span>
        {badge}
      </div>
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {Icon && <Icon aria-hidden="true" className="size-4" />}
        <span>{label}</span>
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
