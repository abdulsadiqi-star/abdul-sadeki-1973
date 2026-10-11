'use client';

import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import type { ActionResult } from '@/lib/errors';

export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;

export type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Red confirm button + stronger wording for irreversible / user-facing penalties. */
  destructive?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonHint?: string;
  /** Approvals may omit the note. Default: the reason is mandatory (3–500 characters). */
  required?: boolean;
  checkbox?: { label: string; defaultChecked?: boolean };
  /** Calls the Server Action. Rejected promises are shown as a generic error. */
  submit: (input: { reason: string; checked: boolean }) => Promise<ActionResult<unknown>>;
  /** Toast shown on success. */
  success: string | ((data: unknown) => string);
};

/**
 * The confirmation every staff decision goes through: a dialog with a mandatory reason (stored, audited and shown to the
 * affected user). Validates on the client for instant feedback; the server validates again and its message is shown inline.
 * The form lives INSIDE the dialog content, so its state resets every time the dialog opens.
 */
export function ReasonDialog(props: ReasonDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(next) => (pending ? undefined : props.onOpenChange(next))}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(e) => pending && e.preventDefault()} onEscapeKeyDown={(e) => pending && e.preventDefault()}>
        <ReasonForm {...props} setPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  reasonLabel = 'دلیل',
  reasonPlaceholder,
  reasonHint,
  required = true,
  checkbox,
  submit,
  success,
  setPending,
}: ReasonDialogProps & { setPending: (pending: boolean) => void }) {
  const f = useFormatter();
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(checkbox?.defaultChecked ?? false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const length = Array.from(reason.trim()).length;
  const overLimit = length > REASON_MAX_LENGTH;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (required && length < REASON_MIN_LENGTH) {
      setFieldError(`${reasonLabel} باید دست‌کم ${f.number(REASON_MIN_LENGTH)} نویسه باشد.`);
      return;
    }
    if (overLimit) {
      setFieldError(`${reasonLabel} نباید بیش از ${f.number(REASON_MAX_LENGTH)} نویسه باشد.`);
      return;
    }
    setPending(true);
    startTransition(async () => {
      try {
        const res = await submit({ reason: reason.trim(), checked });
        if (!res.ok) {
          const first = Object.values(res.fieldErrors ?? {})[0]?.[0];
          if (res.fieldErrors?.reason?.[0] || res.fieldErrors?.note?.[0]) setFieldError(res.fieldErrors?.reason?.[0] ?? res.fieldErrors?.note?.[0] ?? null);
          else setError(first && res.code === 'VALIDATION' ? first : res.message);
          return;
        }
        toast.success(typeof success === 'function' ? success(res.data) : success);
        onOpenChange(false);
        router.refresh();
      } catch {
        setError('ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription asChild><div>{description}</div></DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-reason`}>
          {reasonLabel}
          {!required && <span className="text-xs font-normal text-muted-foreground">(اختیاری)</span>}
        </Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={reasonPlaceholder}
          rows={4}
          dir="auto"
          disabled={isPending}
          aria-invalid={!!fieldError || overLimit}
          aria-describedby={`${id}-hint${fieldError ? ` ${id}-error` : ''}`}
          autoFocus
          className="user-text resize-y"
        />
        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <p id={`${id}-hint`}>{reasonHint ?? 'این متن در گزارش فعالیت‌ها ثبت می‌شود.'}</p>
          <span className={overLimit ? 'font-semibold text-destructive' : undefined} aria-hidden="true">
            {f.number(length)}/{f.number(REASON_MAX_LENGTH)}
          </span>
        </div>
        {fieldError && (
          <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
            {fieldError}
          </p>
        )}
      </div>

      {checkbox && (
        <div className="flex items-center gap-2.5">
          <Checkbox id={`${id}-check`} checked={checked} onCheckedChange={(v) => setChecked(v === true)} disabled={isPending} />
          <Label htmlFor={`${id}-check`} className="cursor-pointer font-normal leading-relaxed">
            {checkbox.label}
          </Label>
        </div>
      )}

      <div aria-live="polite">
        <FormError message={error} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
          انصراف
        </Button>
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
