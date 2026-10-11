'use client';

import { useState } from 'react';
import { Ban, MessageSquareOff, RotateCcw, ShieldAlert, ShieldCheck, TriangleAlert, UserRoundX, UserRoundCheck, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ReasonDialog, type ReasonDialogProps } from '@/components/admin/reason-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import {
  blockCommenterAction,
  deleteCommentAction,
  restoreChannelAction,
  restoreCommentAction,
  restoreVideoAction,
  suspendChannelAction,
  takedownVideoAction,
  unblockCommenterAction,
} from '@/features/admin/actions/content';
import { dismissReportAction, warnCreatorAction } from '@/features/admin/actions/reports';
import { labels } from '@/lib/i18n/fa';
import type { CommentStatus } from '@/generated/prisma/enums';

export type ReportActionTarget =
  | { type: 'VIDEO'; id: string; takenDown: boolean; channelId: string; channelName: string; channelSuspended: boolean }
  | { type: 'COMMENT'; id: string; status: CommentStatus; deletedByAuthor: boolean; channelId: string; channelName: string; authorId: string; authorBlocked: boolean }
  | { type: 'CHANNEL'; id: string; name: string; suspended: boolean };

type Kind =
  | 'dismiss'
  | 'warn'
  | 'takedown'
  | 'restoreVideo'
  | 'deleteComment'
  | 'restoreComment'
  | 'block'
  | 'unblock'
  | 'suspendChannel'
  | 'restoreChannel';

type Base = Omit<ReasonDialogProps, 'open' | 'onOpenChange'>;

/**
 * Decision panel of a report. Every button opens a dialog that demands a reason; the server re-checks the role,
 * the self / administrator rules and the report state, so a stale or tampered page can do no harm.
 */
export function ReportActions({
  reportId,
  reportOpen,
  otherOpenReports,
  denial,
  target,
}: {
  reportId: string;
  reportOpen: boolean;
  /** Other open reports about the same target (they can be closed together with this one). */
  otherOpenReports: number;
  /** Why the viewer may not act on this target (own content / administrator's); null when allowed. */
  denial: string | null;
  target: ReportActionTarget;
}) {
  const f = useFormatter();
  const [active, setActive] = useState<Kind | null>(null);
  const disabled = !!denial;

  const closeAll = otherOpenReports > 0 ? { label: `بستن ${f.number(otherOpenReports)} گزارش باز دیگر درباره‌ی همین مورد`, defaultChecked: true } : undefined;
  const userFacing = 'این متن ثبت می‌شود و برای کاربر مربوط نمایش داده می‌شود.';

  const dialogs: Partial<Record<Kind, Base>> = {
    dismiss: {
      title: 'رد گزارش',
      description: 'گزارش بی‌اساس است یا نیازی به اقدام ندارد. دلیل رد را بنویسید؛ سازنده از این تصمیم مطلع نمی‌شود.',
      confirmLabel: 'رد گزارش',
      reasonPlaceholder: 'مثلاً: محتوا با قوانین سایت مغایرتی ندارد.',
      checkbox: closeAll && { ...closeAll, label: `رد ${f.number(otherOpenReports)} گزارش باز دیگر درباره‌ی همین مورد` },
      submit: ({ reason, checked }) => dismissReportAction({ reportId, reason, resolveAll: checked }),
      success: 'گزارش رد شد.',
    },
    warn: {
      title: 'هشدار به سازنده',
      description: 'یک هشدار به سازنده‌ی این مورد ارسال می‌شود و گزارش «اقدام شد» ثبت می‌گردد. خود محتوا تغییری نمی‌کند.',
      confirmLabel: 'ارسال هشدار',
      reasonHint: userFacing,
      reasonPlaceholder: 'به سازنده بگویید کدام قانون نقض شده و چه باید بکند.',
      checkbox: closeAll,
      submit: ({ reason, checked }) => warnCreatorAction({ reportId, reason, resolveAll: checked }),
      success: 'هشدار برای سازنده ارسال شد.',
    },
  };

  if (target.type === 'VIDEO') {
    const t = target;
    dialogs.takedown = {
      title: 'خارج‌کردن ویدیو از دسترس عمومی',
      description: 'ویدیو برای همه به‌جز صاحب کانال و ناظران پنهان می‌شود (فهرست‌ها، جستجو و صفحه‌ی پخش). هر زمان قابل بازگردانی است.',
      confirmLabel: 'خارج‌کردن از دسترس',
      destructive: true,
      reasonHint: userFacing,
      reasonPlaceholder: 'مثلاً: نقض قانون محتوای خشونت‌آمیز (بند ۳ قوانین).',
      checkbox: closeAll,
      submit: ({ reason, checked }) => takedownVideoAction({ videoId: t.id, reason, reportId, resolveAll: checked }),
      success: 'ویدیو از دسترس عمومی خارج شد.',
    };
    dialogs.restoreVideo = {
      title: 'بازگرداندن ویدیو',
      description: 'ویدیو دوباره برای عموم نمایش داده می‌شود (مطابق نمایش و وضعیت انتشار خودش).',
      confirmLabel: 'بازگرداندن ویدیو',
      reasonHint: userFacing,
      reasonPlaceholder: 'دلیل بازگرداندن را بنویسید.',
      submit: ({ reason }) => restoreVideoAction({ videoId: t.id, reason, reportId }),
      success: 'ویدیو دوباره در دسترس قرار گرفت.',
    };
  }

  if (target.type === 'COMMENT') {
    const t = target;
    dialogs.deleteComment = {
      title: 'حذف دیدگاه',
      description: 'دیدگاه از صفحه‌ی ویدیو برداشته می‌شود و شمارنده‌ها به‌روز می‌شوند. نویسنده با ذکر دلیل مطلع می‌شود.',
      confirmLabel: 'حذف دیدگاه',
      destructive: true,
      reasonHint: userFacing,
      reasonPlaceholder: 'مثلاً: توهین به کاربران دیگر.',
      checkbox: closeAll,
      submit: ({ reason, checked }) => deleteCommentAction({ commentId: t.id, reason, reportId, resolveAll: checked }),
      success: 'دیدگاه حذف شد.',
    };
    dialogs.restoreComment = {
      title: 'بازگرداندن دیدگاه',
      description: 'دیدگاه به وضعیت پیش از حذف برمی‌گردد (معمولاً «تأیید شده»).',
      confirmLabel: 'بازگرداندن دیدگاه',
      reasonHint: userFacing,
      submit: ({ reason }) => restoreCommentAction({ commentId: t.id, reason, reportId }),
      success: (data) => `دیدگاه بازگردانده شد (وضعیت: ${labels.commentStatus[(data as { restoredTo: CommentStatus }).restoredTo]}).`,
    };
    dialogs.block = {
      title: `مسدودکردن دیدگاه‌نویس در کانال «${t.channelName}»`,
      description: 'این کاربر دیگر نمی‌تواند زیر ویدیوهای این کانال دیدگاه بگذارد. دیدگاه‌های قبلی او تغییری نمی‌کنند.',
      confirmLabel: 'مسدودکردن',
      destructive: true,
      reasonHint: userFacing,
      submit: ({ reason }) => blockCommenterAction({ channelId: t.channelId, userId: t.authorId, reason, reportId }),
      success: 'دیدگاه‌نویس در این کانال مسدود شد.',
    };
    dialogs.unblock = {
      title: 'رفع مسدودیت دیدگاه‌نویس',
      description: `کاربر دوباره می‌تواند زیر ویدیوهای کانال «${t.channelName}» دیدگاه بگذارد.`,
      confirmLabel: 'رفع مسدودیت',
      reasonHint: userFacing,
      submit: ({ reason }) => unblockCommenterAction({ channelId: t.channelId, userId: t.authorId, reason, reportId }),
      success: 'مسدودیت دیدگاه‌نویس برداشته شد.',
    };
  }

  const channelTarget = target.type === 'CHANNEL' ? { id: target.id, name: target.name, suspended: target.suspended } : target.type === 'VIDEO' ? { id: target.channelId, name: target.channelName, suspended: target.channelSuspended } : null;
  if (channelTarget) {
    dialogs.suspendChannel = {
      title: `تعلیق کانال «${channelTarget.name}»`,
      description: 'کانال و همه‌ی ویدیوهای آن از دید عموم پنهان می‌شوند. سازنده با ذکر دلیل مطلع می‌شود و می‌تواند از پشتیبانی پیگیری کند.',
      confirmLabel: 'تعلیق کانال',
      destructive: true,
      reasonHint: userFacing,
      reasonPlaceholder: 'مثلاً: تکرار نقض قوانین پس از دو هشدار.',
      checkbox: closeAll,
      submit: ({ reason, checked }) => suspendChannelAction({ channelId: channelTarget.id, reason, reportId, resolveAll: checked }),
      success: 'کانال تعلیق شد.',
    };
    dialogs.restoreChannel = {
      title: `رفع تعلیق کانال «${channelTarget.name}»`,
      description: 'کانال و ویدیوهای عمومی آن دوباره نمایش داده می‌شوند.',
      confirmLabel: 'رفع تعلیق',
      reasonHint: userFacing,
      submit: ({ reason }) => restoreChannelAction({ channelId: channelTarget.id, reason, reportId }),
      success: 'تعلیق کانال برداشته شد.',
    };
  }

  const btn = (kind: Kind, icon: React.ReactNode, label: string, variant: 'default' | 'outline' | 'destructive' | 'secondary' = 'outline') => (
    <Button key={kind} type="button" variant={variant} size="sm" disabled={disabled} onClick={() => setActive(kind)}>
      {icon}
      {label}
    </Button>
  );

  const decision = reportOpen ? [btn('dismiss', <XCircle />, 'رد گزارش'), btn('warn', <TriangleAlert />, 'هشدار به سازنده')] : [];

  const content: React.ReactNode[] = [];
  if (target.type === 'VIDEO') {
    if (!target.takenDown && reportOpen) content.push(btn('takedown', <ShieldAlert />, 'خارج‌کردن ویدیو از دسترس', 'destructive'));
    if (target.takenDown) content.push(btn('restoreVideo', <RotateCcw />, 'بازگرداندن ویدیو'));
  }
  if (target.type === 'COMMENT') {
    if (target.status !== 'DELETED' && reportOpen) content.push(btn('deleteComment', <MessageSquareOff />, 'حذف دیدگاه', 'destructive'));
    if (target.status === 'DELETED' && !target.deletedByAuthor) content.push(btn('restoreComment', <RotateCcw />, 'بازگرداندن دیدگاه'));
    content.push(target.authorBlocked ? btn('unblock', <UserRoundCheck />, 'رفع مسدودیت دیدگاه‌نویس') : btn('block', <UserRoundX />, 'مسدودکردن دیدگاه‌نویس'));
  }
  if (channelTarget) {
    if (!channelTarget.suspended && reportOpen) content.push(btn('suspendChannel', <Ban />, 'تعلیق کانال', 'destructive'));
    if (channelTarget.suspended) content.push(btn('restoreChannel', <ShieldCheck />, 'رفع تعلیق کانال'));
  }

  const current = active ? dialogs[active] : undefined;
  return (
    <div className="space-y-4">
      {denial && (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription className="text-foreground">{denial}</AlertDescription>
        </Alert>
      )}
      {!reportOpen && !denial && (
        <p className="text-sm text-muted-foreground">این گزارش بررسی شده و دیگر تصمیم تازه‌ای برایش ثبت نمی‌شود؛ فقط برگرداندن اقدام‌های قبلی ممکن است.</p>
      )}
      {decision.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">تصمیم درباره‌ی گزارش</h3>
          <div className="flex flex-wrap gap-2">{decision}</div>
        </div>
      )}
      {content.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">اقدام روی محتوا</h3>
          <div className="flex flex-wrap gap-2">{content}</div>
        </div>
      )}
      {current && <ReasonDialog key={active} open onOpenChange={(open) => !open && setActive(null)} {...current} />}
    </div>
  );
}
