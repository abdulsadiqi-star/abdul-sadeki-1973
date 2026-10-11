'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import { requestVerificationAction } from '@/features/support/verification-actions';
import {
  MAX_EVIDENCE_LINKS,
  VERIFICATION_MESSAGE_MAX,
  VERIFICATION_MESSAGE_MIN,
  verificationRequestSchema,
  type VerificationRequestInput,
} from '@/features/support/schemas';
import { applyServerErrors } from '@/lib/form-utils';

/** Verified-badge request: why the channel should be verified plus up to five https links that prove it. */
export function VerificationForm() {
  const f = useFormatter();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<VerificationRequestInput>({
    resolver: zodResolver(verificationRequestSchema),
    defaultValues: { message: '', evidenceLinks: [] },
  });
  const links = useFieldArray({ control: form.control, name: 'evidenceLinks' });
  const length = useWatch({ control: form.control, name: 'message' })?.length ?? 0;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await requestVerificationAction(values);
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      toast.success('درخواست شما ثبت شد و در صف بررسی قرار گرفت.');
      router.refresh();
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>چرا کانال شما باید تأیید شود؟</FormLabel>
              <FormControl>
                <Textarea rows={6} maxLength={VERIFICATION_MESSAGE_MAX} placeholder="کانال شما درباره‌ی چیست، چه کسی پشت آن است و چرا ممکن است دیگران آن را با کانال دیگری اشتباه بگیرند؟" {...field} />
              </FormControl>
              <FormDescription className="tabular-nums">
                دست‌کم {f.number(VERIFICATION_MESSAGE_MIN)} نویسه · {f.number(length)} از {f.number(VERIFICATION_MESSAGE_MAX)}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">پیوندهای مدرک (اختیاری)</legend>
          <p className="text-[13px] text-muted-foreground">
            نشانی وب‌سایت رسمی، شبکه‌های اجتماعی تأییدشده یا هر صفحه‌ای که مالکیت شما بر کانال را نشان می‌دهد. فقط نشانی‌های https:// پذیرفته می‌شود.
          </p>
          {links.fields.map((item, index) => (
            <div key={item.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-start">
              <FormField
                control={form.control}
                name={`evidenceLinks.${index}.title`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">عنوان پیوند {f.number(index + 1)}</FormLabel>
                    <FormControl>
                      <Input placeholder="عنوان (مثلاً وب‌سایت)" maxLength={80} autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`evidenceLinks.${index}.url`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">نشانی پیوند {f.number(index + 1)}</FormLabel>
                    <FormControl>
                      <Input dir="ltr" className="text-start" placeholder="https://example.org" maxLength={500} inputMode="url" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => links.remove(index)} aria-label={`حذف پیوند ${f.number(index + 1)}`}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          {links.fields.length < MAX_EVIDENCE_LINKS && (
            <Button type="button" variant="outline" size="sm" onClick={() => links.append({ title: '', url: '' })}>
              <Plus aria-hidden="true" />
              افزودن پیوند
            </Button>
          )}
        </fieldset>

        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
          ثبت درخواست
        </Button>
      </form>
    </Form>
  );
}
