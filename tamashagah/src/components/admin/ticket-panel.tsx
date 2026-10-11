'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, LockOpen, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import { closeTicketAction, reopenTicketAction, replyToTicketAction } from '@/features/admin/actions/support';
import type { TicketStatus } from '@/generated/prisma/enums';

const BODY_MAX = 5000;

/** Staff reply form + close / reopen for one ticket. */
export function TicketPanel({ ticketId, number, status, denial }: { ticketId: string; number: number; status: TicketStatus; denial: string | null }) {
  const f = useFormatter();
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmClose, setConfirmClose] = useState(false);
  const closed = status === 'CLOSED';
  const length = Array.from(body.trim()).length;

  function onReply(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (length < 2) return setFieldError('متن پاسخ را بنویسید.');
    if (length > BODY_MAX) return setFieldError(`پاسخ نباید بیش از ${f.number(BODY_MAX)} نویسه باشد.`);
    startTransition(async () => {
      const res = await replyToTicketAction({ ticketId, body: body.trim() }).catch(() => null);
      if (!res) return setError('ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
      if (!res.ok) {
        const field = res.fieldErrors?.body?.[0];
        return field ? setFieldError(field) : setError(res.message);
      }
      setBody('');
      toast.success('پاسخ برای کاربر ارسال شد.');
      router.refresh();
    });
  }

  async function toggle(action: typeof closeTicketAction, success: string): Promise<boolean> {
    const res = await action({ ticketId }).catch(() => null);
    if (!res || !res.ok) {
      toast.error(res ? res.message : 'ارتباط با سرور برقرار نشد.');
      return false;
    }
    toast.success(success);
    router.refresh();
    return true;
  }

  if (denial) {
    return (
      <Alert variant="warning">
        <Lock />
        <AlertDescription className="text-foreground">{denial}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {closed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
          <p>این تیکت بسته است. برای پاسخ‌دادن، ابتدا آن را دوباره باز کنید.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void toggle(reopenTicketAction, 'تیکت دوباره باز شد.')}>
            <LockOpen />
            بازگشایی تیکت
          </Button>
        </div>
      ) : (
        <form onSubmit={onReply} className="grid grid-cols-1 gap-3" noValidate>
          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor={`${id}-body`}>پاسخ شما به تیکت شماره‌ی {f.number(number)}</Label>
            <Textarea
              id={`${id}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              dir="auto"
              disabled={pending}
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? `${id}-error` : undefined}
              placeholder="پاسخ را مؤدبانه و روشن بنویسید؛ کاربر آن را در بخش پشتیبانی می‌بیند و اعلان می‌گیرد."
              className="user-text resize-y"
            />
            <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <span>پس از ارسال، وضعیت تیکت «پاسخ داده شده» می‌شود.</span>
              <span aria-hidden="true" className={length > BODY_MAX ? 'font-semibold text-destructive' : undefined}>
                {f.number(length)}/{f.number(BODY_MAX)}
              </span>
            </div>
            {fieldError && (
              <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
                {fieldError}
              </p>
            )}
          </div>
          <div aria-live="polite">
            <FormError message={error} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
              ارسال پاسخ
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmClose(true)}>
              <Lock />
              بستن تیکت
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={`بستن تیکت شماره‌ی ${f.number(number)}؟`}
        description="با بستن تیکت، دیگر نمی‌توان به آن پاسخ داد مگر آنکه دوباره باز شود."
        confirmLabel="بستن تیکت"
        onConfirm={() => toggle(closeTicketAction, 'تیکت بسته شد.')}
      />
    </div>
  );
}
