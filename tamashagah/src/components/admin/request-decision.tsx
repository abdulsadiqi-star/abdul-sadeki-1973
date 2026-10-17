'use client';

import { useState } from 'react';
import { BadgeCheck, CircleCheck, CircleX, PauseCircle, PlayCircle, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ReasonDialog, type ReasonDialogProps } from '@/components/admin/reason-dialog';
import { decideMonetizationAction, decideVerificationAction } from '@/features/admin/actions/requests';
import type { MonetizationDecision } from '@/features/admin/policy';

type Decision = MonetizationDecision;
type Base = Omit<ReasonDialogProps, 'open' | 'onOpenChange'>;

const NOTE_HINT = 'این توضیح برای سازنده نمایش داده می‌شود و در گزارش فعالیت‌ها ثبت می‌شود.';

/** Decision buttons of a monetization application or verification request (only the decisions the state machine allows are offered). */
export function RequestDecision({
  kind,
  id,
  channelName,
  decisions,
  denial,
}: {
  kind: 'monetization' | 'verification';
  id: string;
  channelName: string;
  decisions: Decision[];
  denial: string | null;
}) {
  const [active, setActive] = useState<Decision | null>(null);

  const submit = (decision: Decision): Base['submit'] =>
    kind === 'monetization'
      ? ({ reason }) => decideMonetizationAction({ id, decision, note: reason })
      : ({ reason }) => decideVerificationAction({ id, decision: decision === 'APPROVE' ? 'APPROVE' : 'REJECT', note: reason });

  const dialogs: Partial<Record<Decision, Base>> =
    kind === 'monetization'
      ? {
          APPROVE: {
            title: `تأیید درخواست درآمدزایی «${channelName}»`,
            description: 'کانال وارد برنامه‌ی درآمدزایی می‌شود و سازنده مطلع می‌شود.',
            confirmLabel: 'تأیید درخواست',
            required: false,
            reasonLabel: 'توضیح تصمیم',
            reasonHint: NOTE_HINT,
            submit: submit('APPROVE'),
            success: 'درخواست درآمدزایی تأیید شد.',
          },
          REJECT: {
            title: `رد درخواست درآمدزایی «${channelName}»`,
            description: 'درخواست رد می‌شود و سازنده دلیل را می‌بیند. تصمیم نهایی است؛ سازنده می‌تواند بعداً درخواست تازه‌ای ثبت کند.',
            confirmLabel: 'رد درخواست',
            destructive: true,
            reasonLabel: 'توضیح تصمیم',
            reasonHint: NOTE_HINT,
            reasonPlaceholder: 'مثلاً: ساعت تماشای معتبر هنوز به حد نصاب نرسیده است.',
            submit: submit('REJECT'),
            success: 'درخواست درآمدزایی رد شد.',
          },
          SUSPEND: {
            title: `تعلیق درآمدزایی «${channelName}»`,
            description: 'مشارکت کانال در برنامه‌ی درآمدزایی متوقف می‌شود و سازنده با ذکر دلیل مطلع می‌شود.',
            confirmLabel: 'تعلیق درآمدزایی',
            destructive: true,
            reasonLabel: 'توضیح تصمیم',
            reasonHint: NOTE_HINT,
            submit: submit('SUSPEND'),
            success: 'درآمدزایی کانال تعلیق شد.',
          },
          REINSTATE: {
            title: `رفع تعلیق درآمدزایی «${channelName}»`,
            description: 'مشارکت کانال در برنامه‌ی درآمدزایی دوباره فعال می‌شود.',
            confirmLabel: 'رفع تعلیق',
            required: false,
            reasonLabel: 'توضیح تصمیم',
            reasonHint: NOTE_HINT,
            submit: submit('REINSTATE'),
            success: 'تعلیق درآمدزایی برداشته شد.',
          },
        }
      : {
          APPROVE: {
            title: `تأیید درخواست تیک «${channelName}»`,
            description: 'نشان تأیید به کانال داده می‌شود و سازنده مطلع می‌شود.',
            confirmLabel: 'تأیید و دادن تیک',
            required: false,
            reasonLabel: 'توضیح تصمیم',
            reasonHint: NOTE_HINT,
            submit: submit('APPROVE'),
            success: 'درخواست تأیید شد و کانال نشان تأیید گرفت.',
          },
          REJECT: {
            title: `رد درخواست تیک «${channelName}»`,
            description: 'درخواست رد می‌شود و سازنده دلیل را می‌بیند.',
            confirmLabel: 'رد درخواست',
            destructive: true,
            reasonLabel: 'دلیل رد',
            reasonHint: NOTE_HINT,
            reasonPlaceholder: 'مثلاً: مدارک ارائه‌شده برای احراز هویت کافی نیست.',
            submit: submit('REJECT'),
            success: 'درخواست رد شد.',
          },
        };

  const meta: Record<Decision, { label: string; icon: React.ReactNode; variant: 'default' | 'destructive' | 'outline' }> = {
    APPROVE: { label: kind === 'verification' ? 'تأیید و دادن تیک' : 'تأیید درخواست', icon: kind === 'verification' ? <BadgeCheck /> : <CircleCheck />, variant: 'default' },
    REJECT: { label: 'رد درخواست', icon: <CircleX />, variant: 'destructive' },
    SUSPEND: { label: 'تعلیق درآمدزایی', icon: <PauseCircle />, variant: 'destructive' },
    REINSTATE: { label: 'رفع تعلیق', icon: <PlayCircle />, variant: 'default' },
  };

  const dialog = active ? dialogs[active] : undefined;

  if (denial) {
    return (
      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription className="text-foreground">{denial}</AlertDescription>
      </Alert>
    );
  }
  if (decisions.length === 0) {
    return <p className="text-sm text-muted-foreground">این درخواست در وضعیت فعلی خود تصمیم تازه‌ای نمی‌پذیرد.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {decisions.map((d) => (
        <Button key={d} type="button" variant={meta[d].variant} onClick={() => setActive(d)}>
          {meta[d].icon}
          {meta[d].label}
        </Button>
      ))}
      {dialog && <ReasonDialog key={active} open onOpenChange={(open) => !open && setActive(null)} {...dialog} />}
    </div>
  );
}
