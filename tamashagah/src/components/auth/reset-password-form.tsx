'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { PasswordInput } from '@/components/forms/password-input';
import { FormError } from '@/components/forms/form-error';
import { resetPasswordAction } from '@/features/auth/actions';
import { passwordSchema } from '@/features/auth/schemas';
import { applyServerErrors } from '@/lib/form-utils';

const schema = z
  .object({ password: passwordSchema, confirm: z.string().min(1, 'تکرار گذرواژه را وارد کنید.') })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'تکرار گذرواژه با گذرواژه یکسان نیست.' });
type Values = z.input<typeof schema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await resetPasswordAction({ token, password: values.password });
      if (!res.ok) {
        setFormError(applyServerErrors(form, res));
        return;
      }
      toast.success('گذرواژه‌ی شما تغییر کرد. اکنون وارد شوید.');
      router.replace('/login');
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>گذرواژه‌ی جدید</FormLabel>
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
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>تکرار گذرواژه</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          ثبت گذرواژه‌ی جدید
        </Button>
      </form>
    </Form>
  );
}
