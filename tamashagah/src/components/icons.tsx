import { ChevronLeft, ChevronRight, type LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Direction-aware chevrons. In RTL "forward" points LEFT, so we flip the glyph
 * with the `rtl:` variant instead of picking left/right by hand.
 *
 *   <ChevronEnd />    → points toward the END of the line (→ in LTR, ← in RTL)
 *   <ChevronStart />  → points toward the START of the line (← in LTR, → in RTL)
 */
export function ChevronEnd({ className, ...props }: LucideProps) {
  return <ChevronRight aria-hidden="true" className={cn('rtl:rotate-180', className)} {...props} />;
}

export function ChevronStart({ className, ...props }: LucideProps) {
  return <ChevronLeft aria-hidden="true" className={cn('rtl:rotate-180', className)} {...props} />;
}
