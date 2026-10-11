'use client';

import { useId, useState } from 'react';
import { Ban, ShieldCheck, UserCog } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/admin/native-select';
import { ReasonDialog, type ReasonDialogProps } from '@/components/admin/reason-dialog';
import { changeUserRoleAction, restoreUserAction, suspendUserAction } from '@/features/admin/actions/users';
import { labels } from '@/lib/i18n/fa';
import type { UserRole, UserStatus } from '@/generated/prisma/enums';

type Kind = 'role' | 'suspend' | 'restore';
type Base = Omit<ReasonDialogProps, 'open' | 'onOpenChange'>;

/**
 * Role + suspension controls of the user page. Rendered for administrators only; the server enforces the same rules
 * (no self-action, last administrator, moderators cannot grant roles) and the messages are shown inline.
 */
export function UserActions({
  userId,
  name,
  role,
  status,
  hasChannel,
  isSelf,
  isLastAdmin,
}: {
  userId: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  hasChannel: boolean;
  isSelf: boolean;
  isLastAdmin: boolean;
}) {
  const id = useId();
  const memberRole: UserRole = hasChannel ? 'CREATOR' : 'USER';
  const [selected, setSelected] = useState<UserRole>(role);
  const [active, setActive] = useState<Kind | null>(null);
  const locked = isSelf || isLastAdmin;
  const lockReason = isLastAdmin
    ? 'این حساب آخرین مدیر فعال سامانه است؛ نقش و وضعیت آن قابل تغییر نیست.'
    : isSelf
      ? 'نمی‌توانید نقش یا وضعیت حساب خودتان را تغییر دهید.'
      : null;

  const dialogs: Record<Kind, Base> = {
    role: {
      title: `تغییر نقش «${name}»`,
      description: `نقش از «${labels.role[role]}» به «${labels.role[selected]}» تغییر می‌کند و کاربر مطلع می‌شود. دسترسی‌ها از همین درخواست بعدی اعمال می‌شود.`,
      confirmLabel: 'ثبت نقش جدید',
      destructive: selected === 'ADMIN',
      reasonPlaceholder: 'دلیل تغییر نقش را بنویسید.',
      reasonHint: 'این متن در گزارش فعالیت‌ها ثبت می‌شود و برای کاربر نمایش داده می‌شود.',
      submit: ({ reason }) => changeUserRoleAction({ userId, role: selected, reason }),
      success: (data) => `نقش به «${labels.role[(data as { to: UserRole }).to]}» تغییر کرد.`,
    },
    suspend: {
      title: `تعلیق حساب «${name}»`,
      description: 'نشست‌های فعال کاربر همین حالا بسته می‌شوند و تا رفع تعلیق نمی‌تواند وارد شود. کانال و ویدیوهای او خودکار پنهان نمی‌شوند؛ برای آن، کانال را جداگانه تعلیق کنید.',
      confirmLabel: 'تعلیق حساب',
      destructive: true,
      reasonPlaceholder: 'دلیل تعلیق حساب را بنویسید.',
      reasonHint: 'این متن در گزارش فعالیت‌ها ثبت می‌شود و پس از رفع تعلیق برای کاربر نمایش داده می‌شود.',
      submit: ({ reason }) => suspendUserAction({ userId, reason }),
      success: (data) => `حساب تعلیق شد (${(data as { revokedSessions: number }).revokedSessions} نشست بسته شد).`,
    },
    restore: {
      title: `رفع تعلیق حساب «${name}»`,
      description: 'کاربر دوباره می‌تواند وارد حساب خود شود.',
      confirmLabel: 'رفع تعلیق',
      reasonHint: 'این متن در گزارش فعالیت‌ها ثبت می‌شود و برای کاربر نمایش داده می‌شود.',
      submit: ({ reason }) => restoreUserAction({ userId, reason }),
      success: 'تعلیق حساب برداشته شد.',
    },
  };

  return (
    <div className="space-y-4">
      {lockReason && (
        <Alert variant="warning">
          <Ban />
          <AlertDescription className="text-foreground">{lockReason}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-44 flex-1 gap-1.5 sm:flex-none">
          <Label htmlFor={`${id}-role`}>نقش کاربر</Label>
          <NativeSelect id={`${id}-role`} value={selected} disabled={locked || status === 'SUSPENDED'} onChange={(e) => setSelected(e.target.value as UserRole)}>
            <option value={memberRole}>{labels.role[memberRole]}</option>
            <option value="MODERATOR">{labels.role.MODERATOR}</option>
            <option value="ADMIN">{labels.role.ADMIN}</option>
          </NativeSelect>
        </div>
        <Button type="button" variant="outline" disabled={locked || selected === role || status === 'SUSPENDED'} onClick={() => setActive('role')}>
          <UserCog />
          تغییر نقش
        </Button>
        {status === 'ACTIVE' ? (
          <Button type="button" variant="destructive" disabled={locked} onClick={() => setActive('suspend')}>
            <Ban />
            تعلیق حساب
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={isSelf} onClick={() => setActive('restore')}>
            <ShieldCheck />
            رفع تعلیق حساب
          </Button>
        )}
      </div>
      {status === 'SUSPENDED' && <p className="text-xs text-muted-foreground">تا رفع تعلیق، نقش این حساب قابل تغییر نیست.</p>}
      {active && <ReasonDialog key={active} open onOpenChange={(open) => !open && setActive(null)} {...dialogs[active]} />}
    </div>
  );
}
