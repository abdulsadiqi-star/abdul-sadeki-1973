'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toggleWatchLaterAction } from '@/features/engagement/actions';
import { cn } from '@/lib/utils';

/** "Watch later" toggle (system playlist). */
export function SaveButton({
  videoId,
  initialSaved,
  signedIn,
  className,
}: {
  videoId: string;
  initialSaved: boolean;
  signedIn: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const previous = saved;
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const res = await toggleWatchLaterAction({ videoId, saved: next });
      if (res.ok) {
        setSaved(res.data.saved);
        toast.success(res.data.saved ? 'به «بعداً تماشا می‌کنم» اضافه شد.' : 'از «بعداً تماشا می‌کنم» حذف شد.');
      } else {
        setSaved(previous);
        toast.error(res.message);
      }
    });
  }

  return (
    <Button type="button" variant={saved ? 'soft' : 'outline'} shape="pill" aria-pressed={saved} disabled={pending} onClick={onClick} className={className}>
      <Bookmark className={cn(saved && 'fill-current')} />
      {saved ? 'ذخیره شد' : 'ذخیره'}
    </Button>
  );
}
