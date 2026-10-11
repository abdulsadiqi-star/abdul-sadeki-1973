'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import { applyServerErrors } from '@/lib/form-utils';
import { labels } from '@/lib/i18n/fa';
import { updateChannelAction } from '../actions';
import { MAX_CHANNEL_LINKS, channelSettingsSchema, type ChannelSettingsInput } from '../schemas';

const COMMENT_HINTS = {
  OPEN: 'دیدگاه‌ها بلافاصله منتشر می‌شوند (هرزنامه‌های مشکوک ممکن است برای تأیید نگه داشته شوند).',
  APPROVAL_REQUIRED: 'هر دیدگاه پیش از انتشار منتظر تأیید شما می‌ماند.',
  DISABLED: 'بینندگان نمی‌توانند زیر ویدیوهای کانال دیدگاه بگذارند.',
} as const;

const VISIBILITIES = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const;
const COMMENT_MODES = ['OPEN', 'APPROVAL_REQUIRED', 'DISABLED'] as const;

/** Channel profile form: name, description, links, comment policy and default visibility (the handle is read-only). */
export function ChannelForm({ handle, initial }: { handle: string; initial: ChannelSettingsInput }) {
  const router = useRouter();
  const f = useFormatter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ChannelSettingsInput>({ resolver: zodResolver(channelSettingsSchema), defaultValues: initial });
  const links = useFieldArray({ control: form.control, name: 'links' });
  const description = useWatch({ control: form.control, name: 'description' }) ?? '';

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await updateChannelAction(values);
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      toast.success('اطلاعات کانال ذخیره شد.');
      form.reset(values);
      router.refresh();
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <FormError message={formError} />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نام کانال</FormLabel>
              <FormControl>
                <Input maxLength={80} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-2">
          <Label htmlFor="channel-handle">شناسه‌ی کانال</Label>
          <Input id="channel-handle" value={handle} readOnly aria-readonly="true" dir="ltr" className="bg-muted/50 text-start" />
          <p className="text-[13px] text-muted-foreground">
            نشانی کانال شما <bdi className="ltr-isolate font-medium">/channel/{handle}</bdi> است. تغییر شناسه‌ی کانال فعلاً پشتیبانی نمی‌شود.
          </p>
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>توضیحات کانال</FormLabel>
              <FormControl>
                <Textarea rows={5} maxLength={1100} {...field} />
              </FormControl>
              <FormDescription>
                <span className="tabular-nums">
                  {f.number(description.length)} از {f.number(1000)} نویسه
                </span>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">پیوندهای کانال</legend>
          <p className="text-[13px] text-muted-foreground">
            تا {f.number(MAX_CHANNEL_LINKS)} پیوند امن (<bdi className="ltr-isolate">https://</bdi>) به شبکه‌های اجتماعی یا وب‌سایت خود اضافه کنید.
          </p>
          <ul className="space-y-3">
            {links.fields.map((item, index) => (
              <li key={item.id} className="grid items-start gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
                <FormField
                  control={form.control}
                  name={`links.${index}.title`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input placeholder="عنوان (مثلاً اینستاگرام)" aria-label={`عنوان پیوند ${f.number(index + 1)}`} maxLength={60} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`links.${index}.url`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="https://example.com"
                          aria-label={`نشانی پیوند ${f.number(index + 1)}`}
                          dir="ltr"
                          className="text-start"
                          inputMode="url"
                          autoCapitalize="none"
                          spellCheck={false}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={`حذف پیوند ${f.number(index + 1)}`} onClick={() => links.remove(index)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {links.fields.length === 0 && <p className="text-[13px] text-muted-foreground">پیوندی اضافه نشده است.</p>}
          <Button type="button" variant="outline" size="sm" disabled={links.fields.length >= MAX_CHANNEL_LINKS} onClick={() => links.append({ title: '', url: '' })}>
            <Plus /> افزودن پیوند
          </Button>
        </fieldset>

        <FormField
          control={form.control}
          name="commentsMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel id="comments-mode-label">دیدگاه‌ها</FormLabel>
              <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby="comments-mode-label" className="gap-2">
                {COMMENT_MODES.map((mode) => (
                  <div key={mode} className="flex items-start gap-3 rounded-xl border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40">
                    <RadioGroupItem value={mode} id={`comments-${mode}`} className="mt-1" />
                    <Label htmlFor={`comments-${mode}`} className="grid cursor-pointer gap-1 leading-6">
                      <span>{labels.commentsMode[mode]}</span>
                      <span className="text-[13px] font-normal text-muted-foreground">{COMMENT_HINTS[mode]}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="defaultVisibility"
          render={({ field }) => (
            <FormItem>
              <FormLabel id="default-visibility-label">وضعیت پیش‌فرض ویدیوهای تازه</FormLabel>
              <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby="default-visibility-label" className="gap-2">
                {VISIBILITIES.map((visibility) => (
                  <div key={visibility} className="flex items-start gap-3 rounded-xl border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40">
                    <RadioGroupItem value={visibility} id={`visibility-${visibility}`} className="mt-1" />
                    <Label htmlFor={`visibility-${visibility}`} className="grid cursor-pointer gap-1 leading-6">
                      <span>{labels.visibility[visibility]}</span>
                      <span className="text-[13px] font-normal text-muted-foreground">{labels.visibilityHint[visibility]}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <FormDescription>در صفحه‌ی ویرایش هر ویدیو می‌توانید آن را جداگانه تغییر دهید.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={pending || !form.formState.isDirty}>
          {pending && <Loader2 className="animate-spin" />}
          ذخیره‌ی اطلاعات کانال
        </Button>
      </form>
    </Form>
  );
}
