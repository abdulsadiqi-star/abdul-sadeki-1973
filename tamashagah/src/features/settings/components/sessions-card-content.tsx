'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Globe, Loader2, LogOut, Monitor, Smartphone, Tablet, Tv, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import { logoutEverywhereAction } from '@/features/auth/actions';
import { revokeSessionAction } from '../actions';
import type { SessionItem } from '../queries';

const ICONS: Record<SessionItem['kind'], LucideIcon> = { DESKTOP: Monitor, MOBILE: Smartphone, TABLET: Tablet, TV: Tv, OTHER: Globe };

/** The devices currently signed in to the account, with per-device sign-out and "log out everywhere". */
export function SessionsCardContent({ sessions }: { sessions: SessionItem[] }) {
  const f = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = sessions.filter((s) => !s.current);

  function revoke(session: SessionItem) {
    setBusyId(session.id);
    startTransition(async () => {
      const result = await revokeSessionAction({ sessionId: session.id });
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`دستگاه «${session.label}» از حساب شما خارج شد.`);
      router.refresh();
    });
  }

  async function logoutEverywhere(): Promise<boolean> {
    const result = await logoutEverywhereAction();
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    router.push('/login');
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-xl border" data-testid="sessions-list">
        {sessions.map((session) => {
          const Icon = ICONS[session.kind];
          return (
            <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-testid="session-row" data-current={session.current ? 'true' : undefined}>
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span dir="auto">{session.label}</span>
                  {session.current && <Badge variant="success">این دستگاه</Badge>}
                </p>
                <p className="text-[13px] text-muted-foreground" suppressHydrationWarning>
                  ورود: {f.dateTime(session.createdAt, 'short')}
                  <span aria-hidden="true"> · </span>
                  آخرین فعالیت: {f.relative(session.lastUsedAt)}
                </p>
              </div>
              {!session.current && (
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => revoke(session)} aria-label={`خروج دستگاه ${session.label}`}>
                  {busyId === session.id ? <Loader2 className="animate-spin" /> : <LogOut />}
                  خروج این دستگاه
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length === 0 && <p className="text-[13px] text-muted-foreground">دستگاه دیگری وارد حساب شما نشده است.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmAll(true)}>
          <LogOut /> خروج از همه‌ی دستگاه‌ها
        </Button>
        <p className="text-[13px] text-muted-foreground">اگر دستگاهی را نمی‌شناسید، از همه‌ی دستگاه‌ها خارج شوید و گذرواژه‌ی خود را تغییر دهید.</p>
      </div>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        destructive
        title="خروج از همه‌ی دستگاه‌ها؟"
        description="همه‌ی دستگاه‌ها، از جمله همین دستگاه، از حساب شما خارج می‌شوند و باید دوباره وارد شوید."
        confirmLabel="خروج از همه"
        onConfirm={logoutEverywhere}
      />
    </div>
  );
}
