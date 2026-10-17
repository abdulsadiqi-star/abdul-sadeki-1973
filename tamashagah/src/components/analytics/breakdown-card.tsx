import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getFormatter } from '@/lib/format-server';

export type BreakdownItem = { key: string; label: ReactNode; value: number };

/**
 * Share-of-total breakdown (devices, traffic sources). The text IS the data — number and percentage are printed
 * next to every label — and the bar is purely decorative (`aria-hidden`), so nothing depends on colour or on sight.
 */
export async function BreakdownCard({
  title,
  description,
  items,
  unit,
  empty,
}: {
  title: string;
  description?: string;
  items: BreakdownItem[];
  /** e.g. "بازدید" — used in the screen-reader sentence. */
  unit: string;
  empty: string;
}) {
  const f = await getFormatter();
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-3.5">
            {items.map((item) => {
              const share = item.value / total;
              return (
                <li key={item.key}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{item.label}</span>
                    <span className="shrink-0 tabular-nums">
                      {f.number(item.value)} <span className="sr-only">{unit}،</span>
                      <span className="text-muted-foreground"> ({f.percent(share, share < 0.1 ? 1 : 0)})</span>
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
