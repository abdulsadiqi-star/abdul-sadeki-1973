'use client';

import { useState, useTransition } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { PasswordInput } from '@/components/forms/password-input';
import { FormError } from '@/components/forms/form-error';
import { changePasswordAction } from '@/features/auth/actions';
import { changePasswordSchema } from '@/features/auth/schemas';
import { applyServerErrors } from '@/lib/form-utils';

const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string().min(1, 'گذرواژه‌ی جدید را دوباره وارد کنید.') })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'تکرار گذرواژه با گذرواژه‌ی جدید یکسان نیست.' });
type FormValues = z.input<typeof formSchema>;

/** Change password (current + new + confirm). The server revokes every OTHER session on success. */
export function PasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await changePasswordAction({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      toast.success('گذرواژه تغییر کرد. از سایر دستگاه‌ها خارج شدید.');
      form.reset();
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="max-w-md space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>گذرواژه‌ی فعلی</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>گذرواژه‌ی جدید</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>حداقل ۸ نویسه، شامل حداقل یک حرف و یک عدد.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>تکرار گذرواژه‌ی جدید</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className="text-[13px] text-muted-foreground">پس از تغییر گذرواژه، از همه‌ی دستگاه‌های دیگر خارج می‌شوید.</p>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          تغییر گذرواژه
        </Button>
      </form>
    </Form>
  );
}
