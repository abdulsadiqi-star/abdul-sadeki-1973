'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/forms/password-input';
import { FormError } from '@/components/forms/form-error';
import { registerAction } from '@/features/auth/actions';
import { registerSchema, type RegisterInput } from '@/features/auth/schemas';
import { applyServerErrors } from '@/lib/form-utils';

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', acceptTerms: false },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await registerAction(values);
      if (!res.ok) {
        setFormError(applyServerErrors(form, res));
        return;
      }
      toast.success('ثبت‌نام انجام شد. ایمیل تأیید برای شما ارسال شد.');
      router.replace('/');
      router.refresh();
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نام نمایشی</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="مثلاً: علی رضایی" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ایمیل</FormLabel>
              <FormControl>
                <Input type="email" inputMode="email" autoComplete="email" dir="ltr" className="text-start" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>گذرواژه</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>حداقل ۸ نویسه، شامل حرف و عدد.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="acceptTerms"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-2.5">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className="mt-1" />
                </FormControl>
                <FormLabel className="block text-[13px] leading-6 font-normal">
                  <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
                    قوانین و مقررات
                  </Link>{' '}
                  و{' '}
                  <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
                    حریم خصوصی
                  </Link>{' '}
                  را خوانده‌ام و می‌پذیرم.
                </FormLabel>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          ساخت حساب کاربری
        </Button>
      </form>
    </Form>
  );
}
