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
  // The text stays in the foreground colour (tinted backgrounds with coloured text miss WCAG AA in one of the themes);
  // direction is carried by the arrow icon, its colour, the sign-less number and the screen-reader sentence.
  return (
    <Badge variant="outline" className={cn(up ? 'border-success/40 bg-success/10' : 'border-destructive/40 bg-destructive/10', className)}>
      {up ? <ArrowUpRight aria-hidden="true" className="text-success" /> : <ArrowDownRight aria-hidden="true" className="text-destructive" />}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{up ? `${text} افزایش نسبت به بازه‌ی قبل` : `${text} کاهش نسبت به بازه‌ی قبل`}</span>
    </Badge>
  );
}
