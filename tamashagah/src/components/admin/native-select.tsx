import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A native <select> dressed like our inputs. Native on purpose for dense filter bars: perfect keyboard support,
 * OS pickers on phones, no portal needed. The chevron sits on the inline-end side (RTL-safe).
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        data-slot="native-select"
        className={cn(
          'h-10 w-full appearance-none rounded-lg border border-input bg-background ps-3 pe-9 text-sm shadow-xs transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
