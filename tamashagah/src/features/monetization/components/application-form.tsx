'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Loader2, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { FormError } from '@/components/forms/form-error';
import { applyServerErrors } from '@/lib/form-utils';
import { saveApplicationDraftAction, submitApplicationAction } from '../actions';
import { applicationInputSchema, type ApplicationFormInput } from '../schemas';

/**
 * Terms + contact e-mail. "Save draft" is always possible; "Submit" only when the channel is eligible RIGHT NOW (the
 * server re-checks everything, including eligibility at that moment, so this is a convenience, not the guard).
 */
export function ApplicationForm({ initial, eligible }: { initial: ApplicationFormInput; eligible: boolean }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'draft' | 'submit' | null>(null);
  const form = useForm<ApplicationFormInput>({ resolver: zodResolver(applicationInputSchema), defaultValues: initial });

  function run(kind: 'draft' | 'submit') {
    setFormError(null);
    void form.handleSubmit((values) => {
      if (kind === 'submit' && !values.acceptTerms) {
        form.setError('acceptTerms', { type: 'manual', message: 'برای ارسال درخواست باید شرایط برنامه‌ی درآمدزایی را بپذیرید.' });
        return;
      }
      setMode(kind);
      startTransition(async () => {
        const result = kind === 'submit' ? await submitApplicationAction(values) : await saveApplicationDraftAction(values);
        setMode(null);
        if (!result.ok) {
          setFormError(applyServerErrors(form, result));
          return;
        }
        toast.success(kind === 'submit' ? 'درخواست شما ارسال شد.' : 'پیش‌نویس ذخیره شد.');
        form.reset(values);
        router.refresh();
      });
    })();
  }

  return (
    <Form {...form}>
      <form onSubmit={(event) => event.preventDefault()} noValidate className="space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="contactEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ایمیل تماس</FormLabel>
              <FormControl>
                <Input type="email" inputMode="email" autoComplete="email" dir="ltr" className="max-w-md text-start" {...field} />
              </FormControl>
              <FormDescription>نتیجه‌ی بررسی و پیگیری‌ها به این نشانی اطلاع داده می‌شود.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 rounded-xl border p-4">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={(value) => field.onChange(value === true)} className="mt-1" />
              </FormControl>
              <div className="space-y-1.5">
                <FormLabel className="leading-6 font-normal">
                  شرایط برنامه‌ی درآمدزایی و{' '}
                  <Link href="/terms" target="_blank" rel="noopener" className="font-medium text-primary underline-offset-4 hover:underline">
                    قوانین و مقررات تماشاگاه
                  </Link>{' '}
                  را خوانده‌ام و می‌پذیرم.
                </FormLabel>
                <FormDescription>
                  ارسال درخواست به‌معنای تأیید آن نیست و تا اتصال به سرویس پرداخت، مبلغی ثبت یا پرداخت نمی‌شود.
                </FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={pending || !eligible} onClick={() => run('submit')} data-testid="submit-application">
            {pending && mode === 'submit' ? <Loader2 className="animate-spin" /> : <Send />}
            ارسال درخواست
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => run('draft')} data-testid="save-draft">
            {pending && mode === 'draft' ? <Loader2 className="animate-spin" /> : <Save />}
            ذخیره‌ی پیش‌نویس
          </Button>
          {!eligible && <p className="text-[13px] text-muted-foreground">ارسال پس از برقراری هر سه شرط ممکن می‌شود؛ تا آن زمان می‌توانید پیش‌نویس را ذخیره کنید.</p>}
        </div>
      </form>
    </Form>
  );
}
