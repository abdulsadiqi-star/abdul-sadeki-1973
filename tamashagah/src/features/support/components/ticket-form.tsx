'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import { createTicketAction } from '@/features/support/actions';
import {
  TICKET_CATEGORIES,
  TICKET_MESSAGE_MAX,
  TICKET_SUBJECT_MAX,
  createTicketSchema,
  type CreateTicketInput,
} from '@/features/support/schemas';
import { applyServerErrors } from '@/lib/form-utils';
import { labels } from '@/lib/i18n/fa';

type Category = (typeof TICKET_CATEGORIES)[number];

/** New support ticket. Validated in the browser and again on the server; on success the new thread opens. */
export function TicketForm({ defaultCategory, defaultSubject }: { defaultCategory?: Category; defaultSubject?: string }) {
  const f = useFormatter();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<CreateTicketInput>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { category: defaultCategory ?? ('' as Category), subject: defaultSubject ?? '', message: '' },
  });
  const messageLength = useWatch({ control: form.control, name: 'message' })?.length ?? 0;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await createTicketAction(values);
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      toast.success(`تیکت شماره‌ی ${f.number(result.data.number)} ثبت شد.`);
      router.push(`/help/tickets/${result.data.id}` as Route);
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>دسته‌بندی</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} name={field.name}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="موضوع تیکت را انتخاب کنید" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TICKET_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {labels.ticketCategory[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>موضوع</FormLabel>
              <FormControl>
                <Input maxLength={TICKET_SUBJECT_MAX} autoComplete="off" placeholder="مثلاً: ویدیوی من پردازش نمی‌شود" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>توضیح</FormLabel>
              <FormControl>
                <Textarea rows={7} maxLength={TICKET_MESSAGE_MAX} placeholder="چه کاری می‌کردید، چه اتفاقی افتاد و (در صورت امکان) نشانی صفحه را بنویسید." {...field} />
              </FormControl>
              <FormDescription className="tabular-nums">
                {f.number(messageLength)} از {f.number(TICKET_MESSAGE_MAX)} نویسه
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
          ثبت تیکت
        </Button>
      </form>
    </Form>
  );
}
