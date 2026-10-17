import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * `Badge` for lifecycle / review statuses. The design system's `info` variant draws the info colour on a 15 % tint of
 * itself, which falls just short of WCAG AA (4.5:1) for 12-13 px text in the light theme; here the text is mixed
 * towards black in light mode (dark mode keeps the stock colour, which passes). Other variants are untouched.
 */
export function StatusBadge({ variant, className, ...props }: ComponentProps<typeof Badge>) {
  return <Badge variant={variant} className={cn(variant === 'info' && 'text-[color-mix(in_oklab,var(--info)_68%,black)] dark:text-info', className)} {...props} />;
}
