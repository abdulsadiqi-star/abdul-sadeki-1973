'use client';

import { useState, useTransition } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, MailCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { FormError } from '@/components/forms/form-error';
import { requestPasswordResetAction } from '@/features/auth/actions';
import { forgotPasswordSchema } from '@/features/auth/schemas';
import { applyServerErrors } from '@/lib/form-utils';

type Values = { email: string };

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await requestPasswordResetAction(values);
      if (!res.ok) {
        setFormError(applyServerErrors(form, res));
        return;
      }
      setSentTo(values.email);
    });
  });

  if (sentTo) {
    return (
      <Alert variant="success">
        <MailCheck />
        <AlertTitle>درخواست ثبت شد</AlertTitle>
        <AlertDescription className="text-foreground">
          اگر حسابی با ایمیل <bdi className="ltr-isolate font-medium">{sentTo}</bdi> وجود داشته باشد، پیوند تعیین گذرواژه‌ی جدید برای شما ارسال می‌شود. پوشه‌ی هرزنامه را هم بررسی کنید.
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ایمیل حساب کاربری</FormLabel>
              <FormControl>
                <Input type="email" inputMode="email" autoComplete="email" dir="ltr" className="text-start" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          ارسال پیوند بازیابی
        </Button>
      </form>
    </Form>
  );
}
