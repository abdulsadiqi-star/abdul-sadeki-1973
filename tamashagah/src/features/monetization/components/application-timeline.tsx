import { Check, Circle, CircleDot, X } from 'lucide-react';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import type { ApplicationView } from '../queries';

type StepState = 'done' | 'current' | 'upcoming' | 'negative';

/**
 * Status timeline of ONE application, built only from what is persisted (dates exist for creation, submission and
 * the decision; "under review" has no timestamp of its own, so none is invented).
 */
export async function ApplicationTimeline({ application }: { application: ApplicationView }) {
  const f = await getFormatter();
  const { status } = application;
  const decided = status === 'APPROVED' || status === 'REJECTED' || status === 'SUSPENDED';
  // Which step the application is at: 1 = waiting to be sent, 2 = waiting for the review, 3 = decided.
  const stage = status === 'DRAFT' ? 1 : decided ? 3 : 2;
  const stateOf = (index: number): StepState => (index < stage ? 'done' : index === stage ? 'current' : 'upcoming');

  const steps: { key: string; title: string; detail?: string; state: StepState }[] = [
    { key: 'created', title: 'ایجاد درخواست', detail: f.dateTime(application.createdAt, 'short'), state: 'done' },
    {
      key: 'submitted',
      title: 'ارسال درخواست',
      detail: application.submittedAt ? f.dateTime(application.submittedAt, 'short') : 'هنوز ارسال نشده',
      state: stateOf(1),
    },
    {
      key: 'review',
      title: 'بررسی توسط تیم تماشاگاه',
      detail: status === 'SUBMITTED' ? 'در صف بررسی' : status === 'UNDER_REVIEW' ? 'در حال بررسی' : undefined,
      state: stateOf(2),
    },
    {
      key: 'decision',
      title: decided ? `تصمیم نهایی: ${labels.monetization[status]}` : 'تصمیم نهایی',
      detail: application.reviewedAt ? f.dateTime(application.reviewedAt, 'short') : undefined,
      state: decided ? (status === 'APPROVED' ? 'done' : 'negative') : 'upcoming',
    },
  ];

  return (
    <ol className="space-y-0" aria-label="مراحل درخواست" data-testid="application-timeline">
      {steps.map((step, index) => {
        const Icon = step.state === 'done' ? Check : step.state === 'negative' ? X : step.state === 'current' ? CircleDot : Circle;
        return (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0" aria-current={step.state === 'current' ? 'step' : undefined} data-state={step.state}>
            {index < steps.length - 1 && <span aria-hidden="true" className="absolute start-[0.9rem] top-8 bottom-0 w-px bg-border" />}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground',
                step.state === 'done' && 'border-success bg-success/15 text-success',
                step.state === 'negative' && 'border-destructive bg-destructive/10 text-destructive',
                step.state === 'current' && 'border-primary bg-accent text-primary',
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn('text-sm', step.state === 'upcoming' ? 'text-muted-foreground' : 'font-semibold')}>{step.title}</p>
              {step.detail && (
                <p className="text-[13px] text-muted-foreground" suppressHydrationWarning>
                  {step.detail}
                </p>
              )}
              {step.key === 'decision' && decided && application.decisionNote && (
                <p className="user-text mt-1.5 rounded-lg bg-muted/60 px-3 py-2 text-[13px] whitespace-pre-line" dir="auto" data-testid="decision-note">
                  {application.decisionNote}
                </p>
              )}
            </div>
            <span className="sr-only">
              {step.state === 'done' ? '(انجام شده)' : step.state === 'current' ? '(مرحله‌ی فعلی)' : step.state === 'negative' ? '(پایان با نتیجه‌ی منفی)' : '(در انتظار)'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
