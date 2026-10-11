import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Checkmark shown next to verified channels. */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center" title="کانال تأییدشده">
      <BadgeCheck aria-hidden="true" className={cn('size-4 fill-verified/15 text-verified', className)} />
      <span className="sr-only">کانال تأییدشده</span>
    </span>
  );
}
