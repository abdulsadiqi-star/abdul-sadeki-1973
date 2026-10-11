'use client';

import { useState, useTransition } from 'react';
import { MailWarning, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { resendVerificationAction } from '@/features/auth/actions';

/** Shown to signed-in users whose e-mail is not verified yet (uploads and comments need it). */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  if (hidden) return null;

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning/15 px-4 py-2.5 text-sm">
      <MailWarning aria-hidden="true" className="size-5 shrink-0" />
      <p className="min-w-0 flex-1">
        ایمیل شما هنوز تأیید نشده است. برای بارگذاری ویدیو و ثبت دیدگاه، پیوند ارسالی به{' '}
        <bdi className="ltr-isolate font-medium">{email}</bdi> را باز کنید.
      </p>
      <Button
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await resendVerificationAction();
            if (res.ok) toast.success('ایمیل تأیید دوباره ارسال شد.');
            else toast.error(res.message);
          })
        }
      >
        ارسال مجدد
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="بستن" onClick={() => setHidden(true)}>
        <X />
      </Button>
    </div>
  );
}
