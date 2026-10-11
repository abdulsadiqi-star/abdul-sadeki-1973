'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ReportDialog } from './report-dialog';

/** "گزارش" in the watch page action bar. Visitors are sent to the login page and back; unverified users are told why they cannot. */
export function ReportVideoButton({
  videoId,
  signedIn,
  verified,
  isOwner,
  className,
}: {
  videoId: string;
  signedIn: boolean;
  verified: boolean;
  /** You cannot report your own video, so the button is not offered. */
  isOwner: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (isOwner) return null;

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!verified) {
      toast.error('برای گزارش دادن ابتدا ایمیل خود را تأیید کنید.');
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <Button type="button" variant="outline" shape="pill" onClick={onClick} className={className}>
        <Flag />
        گزارش
      </Button>
      <ReportDialog target={{ type: 'video', videoId }} open={open} onOpenChange={setOpen} />
    </>
  );
}
