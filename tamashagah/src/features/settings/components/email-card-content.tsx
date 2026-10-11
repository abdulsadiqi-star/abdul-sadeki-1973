'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, MailWarning, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resendVerificationAction } from '@/features/auth/actions';

/** Read-only e-mail address with its verification status and a "send again" action. */
export function EmailCardContent({ email, verified }: { email: string; verified: boolean }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function resend() {
    startTransition(async () => {
      const result = await resendVerificationAction();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSent(true);
      toast.success('ایمیل تأیید دوباره ارسال شد. صندوق ورودی خود را بررسی کنید.');
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="ltr-isolate rounded-lg border bg-muted/50 px-3 py-2 text-sm" data-testid="account-email">
          {email}
        </span>
        {verified ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden="true" /> تأیید شده
          </Badge>
        ) : (
          <Badge variant="warning">
            <MailWarning aria-hidden="true" /> تأیید نشده
          </Badge>
        )}
      </div>
      {!verified && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={resend}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            ارسال دوباره‌ی ایمیل تأیید
          </Button>
          <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground">
            {sent ? 'ایمیل ارسال شد؛ پیوند تا ۲۴ ساعت معتبر است.' : 'برای بارگذاری ویدیو، دیدگاه‌گذاری و ساخت کانال باید ایمیل شما تأیید شده باشد.'}
          </p>
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">تغییر نشانی ایمیل فعلاً پشتیبانی نمی‌شود.</p>
    </div>
  );
}
