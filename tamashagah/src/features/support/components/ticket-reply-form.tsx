'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { replyTicketAction } from '@/features/support/actions';
import { TICKET_MESSAGE_MAX, replyTicketSchema, type ReplyTicketInput } from '@/features/support/schemas';
import { applyServerErrors } from '@/lib/form-utils';

/** Reply on an existing ticket (a reply re-opens a closed ticket). */
export function TicketReplyForm({ ticketId, closed }: { ticketId: string; closed: boolean }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ReplyTicketInput>({ resolver: zodResolver(replyTicketSchema), defaultValues: { ticketId, body: '' } });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await replyTicketAction(values);
      if (!result.ok) {
        setFormError(applyServerErrors(form, result));
        return;
      }
      form.reset({ ticketId, body: '' });
      toast.success('پاسخ شما ثبت شد.');
      router.refresh();
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{closed ? 'ارسال پاسخ و بازکردن دوباره‌ی تیکت' : 'پاسخ شما'}</FormLabel>
              <FormControl>
                <Textarea rows={4} maxLength={TICKET_MESSAGE_MAX} placeholder="پیام خود را بنویسید…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
          ارسال پاسخ
        </Button>
      </form>
    </Form>
  );
}
