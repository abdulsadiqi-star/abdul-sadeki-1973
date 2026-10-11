import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getFormatter } from '@/lib/format-server';
import { cn } from '@/lib/utils';

/**
 * % change versus the previous period. Never colour-only: an arrow, the signed number and a screen-reader sentence.
 * `value === null` means there was nothing to compare with (the previous period had no data).
 */
export async function ChangeBadge({ value, className }: { value: number | null; className?: string }) {
  const f = await getFormatter();
  if (value === null) {
    return (
      <Badge variant="muted" className={className} title="در بازه‌ی قبل داده‌ای برای مقایسه نبود">
        <Minus aria-hidden="true" />
        <span aria-hidden="true">—</span>
        <span className="sr-only">در بازه‌ی قبل داده‌ای برای مقایسه نبود</span>
      </Badge>
    );
  }
  const rounded = Math.round(value * 10) / 10;
  const text = f.percent(Math.abs(rounded) / 100);
  if (rounded === 0) {
    return (
      <Badge variant="muted" className={className}>
        <Minus aria-hidden="true" />
        <span aria-hidden="true">{text}</span>
        <span className="sr-only">بدون تغییر نسبت به بازه‌ی قبل</span>
      </Badge>
    );
  }
  const up = rounded > 0;
  return (
    <Badge variant={up ? 'success' : 'outline'} className={cn(!up && 'border-transparent bg-destructive/10 text-destructive', className)}>
      {up ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{up ? `${text} افزایش نسبت به بازه‌ی قبل` : `${text} کاهش نسبت به بازه‌ی قبل`}</span>
    </Badge>
  );
}
