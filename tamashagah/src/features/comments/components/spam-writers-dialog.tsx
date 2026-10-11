'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ChannelAvatar } from '@/components/channel-avatar';
import { useFormatter } from '@/components/providers/format-provider';
import { blockCommenterAction, unblockCommenterAction } from '../studio-actions';
import type { SpamWriter } from '../studio-queries';

/**
 * "کاربران هرزنویس": people who posted spam on this channel (with counts) and everybody currently blocked, each
 * with a block / unblock toggle. Blocked users cannot comment on any video of the channel (enforced by the server).
 */
export function SpamWritersDialog({ writers }: { writers: SpamWriter[] }) {
  const f = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(writer: SpamWriter) {
    setPendingId(writer.userId);
    startTransition(async () => {
      const res = writer.blocked ? await unblockCommenterAction({ userId: writer.userId }) : await blockCommenterAction({ userId: writer.userId, reason: 'هرزنویسی' });
      setPendingId(null);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(writer.blocked ? `«${writer.name}» از مسدودیت خارج شد.` : `«${writer.name}» مسدود شد و دیگر نمی‌تواند دیدگاه بگذارد.`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" shape="pill" size="sm">
          <TriangleAlert />
          کاربران هرزنویس
          {writers.length > 0 && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{f.number(writers.length)}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>کاربران هرزنویس</DialogTitle>
          <DialogDescription>کاربرانی که در کانال شما دیدگاه هرز نوشته‌اند یا مسدود شده‌اند. کاربر مسدودشده نمی‌تواند زیر هیچ‌یک از ویدیوهای شما دیدگاه بگذارد.</DialogDescription>
        </DialogHeader>

        {writers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-8" />
            تا الان کسی در کانال شما هرزنامه ننوشته است.
          </div>
        ) : (
          <ul className="max-h-[22rem] space-y-1 overflow-y-auto" aria-label="کاربران هرزنویس">
            {writers.map((w) => (
              <li key={w.userId} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/40">
                <ChannelAvatar name={w.name} src={w.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" dir="auto">
                    {w.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {w.spamCount > 0 ? `${f.number(w.spamCount)} دیدگاه هرز` : 'بدون دیدگاه هرز'}
                    {w.blocked && ' · مسدود'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  shape="pill"
                  variant={w.blocked ? 'outline' : 'destructive'}
                  disabled={pendingId === w.userId}
                  onClick={() => toggle(w)}
                  aria-label={`${w.blocked ? 'رفع مسدودیت' : 'مسدود کردن'} ${w.name}`}
                >
                  {pendingId === w.userId ? <Loader2 className="animate-spin" /> : w.blocked ? <ShieldCheck /> : <Ban />}
                  {w.blocked ? 'رفع مسدودیت' : 'مسدود کردن'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
