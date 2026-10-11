'use client';

import { useId, useState, useTransition } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { useFormatter } from '@/components/providers/format-provider';
import { labels } from '@/lib/i18n/fa';
import { reportCommentAction, reportVideoAction } from '../actions';
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReasonValue } from '../schemas';

export type ReportTarget = { type: 'video'; videoId: string } | { type: 'comment'; commentId: string };

/**
 * Report a video or a comment: pick a reason (required) and optionally add details (≤ 500 characters).
 * The server decides everything that matters (verified e-mail, visibility, duplicates, rate limit); its message
 * is shown here. Controlled: the caller owns `open`.
 */
export function ReportDialog({
  target,
  open,
  onOpenChange,
  onReported,
}: {
  target: ReportTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReported?: () => void;
}) {
  const f = useFormatter();
  const uid = useId();
  const [reason, setReason] = useState<ReportReasonValue | ''>('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const isVideo = target.type === 'video';
  const noun = isVideo ? 'ویدیو' : 'دیدگاه';

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // reset after the closing animation so the content does not flash
      setTimeout(() => {
        setReason('');
        setDetails('');
        setError(null);
        setDone(false);
      }, 200);
    }
  }

  function submit() {
    if (!reason) {
      setError('دلیل گزارش را انتخاب کنید.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const input = { reason, details: details.trim() || undefined };
      const res = isVideo
        ? await reportVideoAction({ ...input, videoId: target.videoId })
        : await reportCommentAction({ ...input, commentId: target.commentId });
      if (res.ok) {
        setDone(true);
        toast.success('گزارش شما ثبت شد.');
        onReported?.();
      } else {
        setError(res.fieldErrors?.details?.[0] ?? res.fieldErrors?.reason?.[0] ?? res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
            <CheckCircle2 aria-hidden="true" className="size-12 text-success" />
            <DialogTitle>گزارش شما ثبت شد</DialogTitle>
            <DialogDescription>ممنون که به امن‌تر شدن تماشاگاه کمک می‌کنید. تیم نظارت آن را بررسی خواهد کرد.</DialogDescription>
            <Button type="button" onClick={() => handleOpenChange(false)} className="mt-2">
              بستن
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>گزارش {noun}</DialogTitle>
              <DialogDescription>دلیل گزارش را انتخاب کنید. گزارش‌ها محرمانه‌اند و توسط تیم نظارت بررسی می‌شوند.</DialogDescription>
            </DialogHeader>

            <RadioGroup value={reason} onValueChange={(v) => setReason(v as ReportReasonValue)} aria-label="دلیل گزارش" className="gap-2.5">
              {REPORT_REASONS.map((r) => (
                <div key={r} className="flex items-center gap-3">
                  <RadioGroupItem id={`${uid}-${r}`} value={r} />
                  <Label htmlFor={`${uid}-${r}`} className="cursor-pointer text-[15px] leading-6 font-normal">
                    {labels.reportReason[r]}
                  </Label>
                </div>
              ))}
            </RadioGroup>

            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-details`}>توضیحات بیشتر (اختیاری)</Label>
              <Textarea
                id={`${uid}-details`}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={REPORT_DETAILS_MAX}
                rows={3}
                dir="auto"
                placeholder="اگر لازم است، توضیح دهید چرا این مورد را گزارش می‌کنید."
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {f.number(details.length)} از {f.number(REPORT_DETAILS_MAX)}
              </p>
            </div>

            <FormError message={error} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                انصراف
              </Button>
              <Button type="button" onClick={submit} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                ارسال گزارش
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
