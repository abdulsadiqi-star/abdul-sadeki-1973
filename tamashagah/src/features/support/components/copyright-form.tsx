'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CircleCheck, Loader2, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import { createCopyrightNoticeAction } from '@/features/support/copyright-actions';
import { copyrightNoticeSchema, type CopyrightNoticeInput } from '@/features/support/schemas';
import { applyServerErrors } from '@/lib/form-utils';

/** Copyright takedown notice. Creates a ticket (so the claimant can follow it) and a report for the moderators. */
export function CopyrightForm({ defaultEmail, defaultVideo }: { defaultEmail: string; defaultVideo?: string }) {
  const f = useFormatter();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticketId: string; number: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CopyrightNoticeInput>({
    resolver: zodResolver(copyrightNoticeSchema),
    defaultValues: {
      videoRef: defaultVideo ?? '',
      claimantName: '',
      contactEmail: defaultEmail,
      workDescription: '',
      originalUrl: '',
      goodFaith: false,
      accuracy: false,
      signature: '',
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await createCopyrightNoticeAction(values);
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      setDone(result.data);
    });
  });

  if (done) {
    return (
      <Alert variant="success" role="status">
        <CircleCheck aria-hidden="true" />
        <AlertTitle>شکایت شما ثبت شد</AlertTitle>
        <AlertDescription>
          <p>
            شماره‌ی پیگیری: <span className="font-semibold tabular-nums">{f.number(done.number)}</span>. ناظران آن را بررسی می‌کنند و نتیجه را در همان تیکت می‌نویسند.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link href={`/help/tickets/${done.ticketId}` as Route}>پیگیری تیکت</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="videoRef"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نشانی ویدیوی مورد شکایت</FormLabel>
              <FormControl>
                <Input dir="ltr" className="text-start" placeholder="https://…/watch/aB3dE5gH7jK یا فقط شناسه‌ی ۱۱ نویسه‌ای" autoComplete="off" maxLength={300} {...field} />
              </FormControl>
              <FormDescription>نشانی صفحه‌ی پخش (…/watch/…) یا پیوند شورت را از نوار نشانی مرورگر کپی کنید.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="claimantName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>نام و نام خانوادگی شاکی</FormLabel>
                <FormControl>
                  <Input autoComplete="name" maxLength={100} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ایمیل تماس</FormLabel>
                <FormControl>
                  <Input type="email" dir="ltr" className="text-start" autoComplete="email" maxLength={254} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="workDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>اثر شما کدام است و چگونه نقض شده؟</FormLabel>
              <FormControl>
                <Textarea rows={5} maxLength={2000} placeholder="اثر را توصیف کنید و بگویید کدام بخش ویدیو از آن برداشته شده است." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="originalUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نشانی اثر اصلی (اختیاری)</FormLabel>
              <FormControl>
                <Input dir="ltr" className="text-start" placeholder="https://example.org/my-work" inputMode="url" autoComplete="off" maxLength={500} {...field} />
              </FormControl>
              <FormDescription>اگر اثرتان جای دیگری منتشر شده، پیوند آن به بررسی کمک می‌کند. فقط https:// پذیرفته می‌شود.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <fieldset className="space-y-3 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">بیانیه‌ها</legend>
          {(
            [
              ['goodFaith', 'با حسن نیت معتقدم استفاده‌ی مورد شکایت از اثرم مجاز نیست؛ یعنی نه خودم اجازه داده‌ام، نه قانون اجازه می‌دهد.'],
              ['accuracy', 'اطلاعات این شکایت دقیق است و من مالک اثر هستم یا از طرف مالک اختیار قانونی دارم.'],
            ] as const
          ).map(([name, label]) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-3">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} className="mt-1.5" />
                    </FormControl>
                    <FormLabel className="font-normal leading-7">{label}</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </fieldset>

        <FormField
          control={form.control}
          name="signature"
          render={({ field }) => (
            <FormItem>
              <FormLabel>امضای الکترونیک</FormLabel>
              <FormControl>
                <Input maxLength={100} autoComplete="off" placeholder="نام کامل خود را به‌عنوان امضا بنویسید" {...field} />
              </FormControl>
              <FormDescription>ثبت شکایت خلاف واقع تخلف است و ممکن است به محدودیت حساب شما بینجامد.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
          ثبت شکایت
        </Button>
      </form>
    </Form>
  );
}
