'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/forms/form-error';
import { verifyEmailAction } from '@/features/auth/actions';

/**
 * E-mail verification is confirmed with an explicit click (POST) instead of on
 * page load, so link scanners that prefetch URLs cannot burn the one-time token.
 */
export function VerifyEmailCard({ token }: { token: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="space-y-5">
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>ایمیل شما تأیید شد</AlertTitle>
          <AlertDescription className="text-foreground">اکنون می‌توانید کانال بسازید، ویدیو بارگذاری کنید و دیدگاه بگذارید.</AlertDescription>
        </Alert>
        <Button asChild size="lg" className="w-full">
          <Link href="/studio">ادامه</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />
      <div className="flex flex-col items-center gap-3 rounded-xl bg-accent/50 p-6 text-center">
        <MailCheck aria-hidden="true" className="size-10 text-primary" />
        <p className="text-sm leading-7">برای تکمیل تأیید، روی دکمه‌ی زیر بزنید.</p>
      </div>
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await verifyEmailAction({ token });
            if (res.ok) {
              setDone(true);
              router.refresh();
            } else setError(res.message);
          });
        }}
      >
        {pending && <Loader2 className="animate-spin" />}
        تأیید ایمیل
      </Button>
    </div>
  );
}
