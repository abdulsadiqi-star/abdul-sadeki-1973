'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { FormError } from '@/components/forms/form-error';
import { applyServerErrors } from '@/lib/form-utils';
import { saveAccountSettingsAction } from '../actions';
import { accountSettingsSchema, type AccountSettingsInput } from '../schemas';

/** Display name · numeral style · e-mail notification preference. */
export function AccountProfileForm({ initial }: { initial: AccountSettingsInput }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<AccountSettingsInput>({ resolver: zodResolver(accountSettingsSchema), defaultValues: initial });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveAccountSettingsAction(values);
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      toast.success('تغییرات ذخیره شد.');
      form.reset(values);
      router.refresh(); // header, menu and numerals follow the new values
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نام نمایشی</FormLabel>
              <FormControl>
                <Input autoComplete="name" maxLength={60} {...field} />
              </FormControl>
              <FormDescription>این نام کنار دیدگاه‌های شما نمایش داده می‌شود (۲ تا ۵۰ نویسه).</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="digitStyle"
          render={({ field }) => (
            <FormItem>
              <FormLabel id="digit-style-label">نوع ارقام</FormLabel>
              <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby="digit-style-label" className="flex flex-wrap gap-x-6 gap-y-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="FA" id="digits-fa" />
                  <Label htmlFor="digits-fa">فارسی (۱۲۳)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="EN" id="digits-en" />
                  <Label htmlFor="digits-en">انگلیسی (123)</Label>
                </div>
              </RadioGroup>
              <FormDescription>روی همه‌ی عددها و تاریخ‌های سایت اعمال می‌شود.</FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notifyByEmail"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start justify-between gap-4 rounded-xl border p-4">
              <div className="space-y-1">
                <FormLabel>اعلان‌ها از طریق ایمیل</FormLabel>
                <FormDescription>ترجیح شما برای دریافت اعلان‌های مهم از طریق ایمیل. ایمیل‌های امنیتی مثل تأیید ایمیل و بازیابی گذرواژه همیشه ارسال می‌شوند.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        <Button type="submit" disabled={pending || !form.formState.isDirty}>
          {pending && <Loader2 className="animate-spin" />}
          ذخیره‌ی تغییرات
        </Button>
      </form>
    </Form>
  );
}
