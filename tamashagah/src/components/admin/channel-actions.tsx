'use client';

import { useState } from 'react';
import { Ban, BadgeCheck, BadgeX, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReasonDialog, type ReasonDialogProps } from '@/components/admin/reason-dialog';
import { restoreChannelAction, suspendChannelAction, unverifyChannelAction, verifyChannelAction } from '@/features/admin/actions/content';

type Kind = 'verify' | 'unverify' | 'suspend' | 'restore';
type Base = Omit<ReasonDialogProps, 'open' | 'onOpenChange'>;

/** Channel actions (list rows and detail page): badge and suspension. */
export function ChannelActions({
  channelId,
  name,
  isVerified,
  suspended,
  openReports,
  denial,
}: {
  channelId: string;
  name: string;
  isVerified: boolean;
  suspended: boolean;
  openReports: number;
  denial: string | null;
}) {
  const [active, setActive] = useState<Kind | null>(null);
  const userFacing = 'این متن ثبت می‌شود و برای سازنده نمایش داده می‌شود.';

  const dialogs: Record<Kind, Base> = {
    verify: {
      title: `تیک تأیید برای «${name}»`,
      description: 'نشان تأیید کنار نام کانال نمایش داده می‌شود و سازنده مطلع می‌شود.',
      confirmLabel: 'تأیید کانال',
      required: false,
      reasonLabel: 'توضیح',
      reasonHint: userFacing,
      submit: ({ reason }) => verifyChannelAction({ channelId, note: reason }),
      success: 'نشان تأیید به کانال داده شد.',
    },
    unverify: {
      title: `برداشتن تیک تأیید از «${name}»`,
      description: 'نشان تأیید از کانال برداشته می‌شود و سازنده با ذکر دلیل مطلع می‌شود.',
      confirmLabel: 'برداشتن تیک',
      destructive: true,
      reasonHint: userFacing,
      submit: ({ reason }) => unverifyChannelAction({ channelId, reason }),
      success: 'نشان تأیید برداشته شد.',
    },
    suspend: {
      title: `تعلیق کانال «${name}»`,
      description: `کانال و همه‌ی ویدیوهای آن از دید عموم پنهان می‌شوند.${openReports > 0 ? ' گزارش‌های باز درباره‌ی این کانال هم بسته می‌شوند.' : ''}`,
      confirmLabel: 'تعلیق کانال',
      destructive: true,
      reasonHint: userFacing,
      reasonPlaceholder: 'دلیل تعلیق را بنویسید.',
      submit: ({ reason }) => suspendChannelAction({ channelId, reason }),
      success: 'کانال تعلیق شد.',
    },
    restore: {
      title: `رفع تعلیق کانال «${name}»`,
      description: 'کانال و ویدیوهای عمومی آن دوباره نمایش داده می‌شوند.',
      confirmLabel: 'رفع تعلیق',
      reasonHint: userFacing,
      submit: ({ reason }) => restoreChannelAction({ channelId, reason }),
      success: 'تعلیق کانال برداشته شد.',
    },
  };

  if (denial) return <span className="text-xs text-muted-foreground">{denial}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isVerified ? (
        <Button type="button" variant="outline" size="xs" onClick={() => setActive('unverify')}>
          <BadgeX />
          برداشتن تیک
        </Button>
      ) : (
        <Button type="button" variant="outline" size="xs" disabled={suspended} onClick={() => setActive('verify')}>
          <BadgeCheck />
          تأیید کانال
        </Button>
      )}
      {suspended ? (
        <Button type="button" variant="outline" size="xs" onClick={() => setActive('restore')}>
          <ShieldCheck />
          رفع تعلیق
        </Button>
      ) : (
        <Button type="button" variant="destructive" size="xs" onClick={() => setActive('suspend')}>
          <Ban />
          تعلیق
        </Button>
      )}
      {active && <ReasonDialog key={active} open onOpenChange={(open) => !open && setActive(null)} {...dialogs[active]} />}
    </div>
  );
}
