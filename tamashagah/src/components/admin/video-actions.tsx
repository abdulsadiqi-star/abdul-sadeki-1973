'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReasonDialog, type ReasonDialogProps } from '@/components/admin/reason-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import { deleteVideoAction, restoreVideoAction, takedownVideoAction } from '@/features/admin/actions/content';

type Kind = 'takedown' | 'restore' | 'delete';
type Base = Omit<ReasonDialogProps, 'open' | 'onOpenChange'>;

/** Row actions of the video list. Buttons are hidden for roles without the capability and replaced by a note when the target rules forbid the action. */
export function VideoActions({
  videoId,
  title,
  takenDown,
  openReports,
  canModerate,
  canDelete,
  denial,
}: {
  videoId: string;
  title: string;
  takenDown: boolean;
  openReports: number;
  canModerate: boolean;
  canDelete: boolean;
  /** Target rule (own content / administrator's) that forbids the action, if any. */
  denial: string | null;
}) {
  const f = useFormatter();
  const [active, setActive] = useState<Kind | null>(null);
  const alsoCloses = openReports > 0 ? ` ${f.number(openReports)} گزارش باز این ویدیو هم به‌عنوان «اقدام شد» بسته می‌شود.` : '';
  const userFacing = 'این متن ثبت می‌شود و برای سازنده نمایش داده می‌شود.';

  const dialogs: Record<Kind, Base> = {
    takedown: {
      title: `خارج‌کردن «${title}» از دسترس`,
      description: `ویدیو برای همه به‌جز صاحب کانال و ناظران پنهان می‌شود.${alsoCloses}`,
      confirmLabel: 'خارج‌کردن از دسترس',
      destructive: true,
      reasonHint: userFacing,
      reasonPlaceholder: 'دلیل خارج‌کردن ویدیو را بنویسید.',
      submit: ({ reason }) => takedownVideoAction({ videoId, reason }),
      success: 'ویدیو از دسترس عمومی خارج شد.',
    },
    restore: {
      title: `بازگرداندن «${title}»`,
      description: 'ویدیو دوباره برای عموم نمایش داده می‌شود (مطابق نمایش و وضعیت انتشار خودش).',
      confirmLabel: 'بازگرداندن ویدیو',
      reasonHint: userFacing,
      submit: ({ reason }) => restoreVideoAction({ videoId, reason }),
      success: 'ویدیو دوباره در دسترس قرار گرفت.',
    },
    delete: {
      title: `حذف قطعی «${title}»`,
      description: 'ویدیو، دیدگاه‌ها، لایک‌ها و گزارش‌های آن برای همیشه از پایگاه داده پاک می‌شوند و فایل‌های آن در پس‌زمینه حذف می‌شود. این کار قابل بازگشت نیست.',
      confirmLabel: 'حذف قطعی',
      destructive: true,
      reasonHint: userFacing,
      reasonPlaceholder: 'دلیل حذف قطعی را بنویسید (مثلاً حکم حق تکثیر).',
      submit: ({ reason }) => deleteVideoAction({ videoId, reason }),
      success: (data) => ((data as { cleanupQueued: boolean }).cleanupQueued ? 'ویدیو برای همیشه حذف شد.' : 'ویدیو حذف شد؛ اما صف پاک‌سازی فایل‌ها در دسترس نبود.'),
    },
  };

  const actionable = denial === null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="xs">
        <Link href={`/watch/${videoId}`} target="_blank" rel="noopener">
          <ExternalLink />
          صفحه‌ی ویدیو
          <span className="sr-only"> (در برگه‌ی جدید)</span>
        </Link>
      </Button>
      {actionable && canModerate && (takenDown ? (
        <Button type="button" variant="outline" size="xs" onClick={() => setActive('restore')}>
          <RotateCcw />
          بازگرداندن
        </Button>
      ) : (
        <Button type="button" variant="outline" size="xs" onClick={() => setActive('takedown')}>
          <ShieldAlert />
          خارج‌کردن از دسترس
        </Button>
      ))}
      {actionable && canDelete && (
        <Button type="button" variant="destructive" size="xs" onClick={() => setActive('delete')}>
          <Trash2 />
          حذف قطعی
        </Button>
      )}
      {!actionable && canModerate && <span className="text-xs text-muted-foreground">{denial}</span>}
      {active && <ReasonDialog key={active} open onOpenChange={(open) => !open && setActive(null)} {...dialogs[active]} />}
    </div>
  );
}
