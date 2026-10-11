'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Password field with a show/hide toggle. The whole control is LTR (passwords are
 * typed left-to-right), so the toggle sits at the physical right edge and the input
 * reserves padding on that same side.
 */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative" dir="ltr">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        dir="ltr"
        className={cn('pe-11 text-start', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'پنهان‌کردن گذرواژه' : 'نمایش گذرواژه'}
        aria-pressed={visible}
        className="absolute end-1.5 top-1.5 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
