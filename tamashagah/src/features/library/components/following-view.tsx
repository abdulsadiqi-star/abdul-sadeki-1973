'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Bell, BellOff, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { EmptyState } from '@/components/empty-state';
import { useFormatter } from '@/components/providers/format-provider';
import { VerifiedBadge } from '@/components/verified-badge';
import { setFollowNotificationsAction } from '@/features/engagement/actions';
import { FollowButton } from '@/features/engagement/components/follow-button';
import type { FollowedChannel } from '@/features/library/queries';

function FollowedCard({ channel }: { channel: FollowedChannel }) {
  const f = useFormatter();
  const [following, setFollowing] = useState(true);
  const [notify, setNotify] = useState(channel.notify);
  const [pending, startTransition] = useTransition();

  function toggleNotify() {
    const next = !notify;
    setNotify(next);
    startTransition(async () => {
      const result = await setFollowNotificationsAction({ channelId: channel.id, enabled: next });
      if (!result.ok) {
        setNotify(!next);
        toast.error(result.message);
      } else {
        toast.success(next ? 'اعلان ویدیوهای جدید این کانال روشن شد.' : 'اعلان ویدیوهای جدید این کانال خاموش شد.');
      }
    });
  }

  return (
    <article className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <Link href={`/channel/${channel.handle}` as Route} aria-label={channel.name} className="shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        <ChannelAvatar name={channel.name} src={channel.avatarUrl} size="lg" />
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 text-base font-bold">
          <Link href={`/channel/${channel.handle}` as Route} dir="auto" className="truncate hover:text-primary">
            {channel.name}
          </Link>
          {channel.isVerified && <VerifiedBadge />}
        </h3>
        <p className="text-[13px] text-muted-foreground" suppressHydrationWarning>
          {f.followers(channel.followerCount)}
          <span aria-hidden="true"> · </span>
          {f.count(channel.videoCount, 'ویدیو')}
        </p>
        {channel.latestAt && (
          <p className="text-[12px] text-muted-foreground" suppressHydrationWarning>
            آخرین ویدیو {f.relative(channel.latestAt)}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <FollowButton channelId={channel.id} initialFollowing signedIn size="sm" onChange={(state) => setFollowing(state.following)} />
          {following && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              shape="pill"
              disabled={pending}
              aria-pressed={notify}
              aria-label={`${notify ? 'خاموش‌کردن' : 'روشن‌کردن'} اعلان ویدیوهای جدید «${channel.name}»`}
              title={notify ? 'اعلان ویدیوهای جدید روشن است' : 'اعلان ویدیوهای جدید خاموش است'}
              onClick={toggleNotify}
            >
              {notify ? <Bell className="fill-current" /> : <BellOff />}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

export function FollowingView({ channels }: { channels: FollowedChannel[] }) {
  if (channels.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="هنوز کانالی را دنبال نمی‌کنید"
        description="کانال‌های موردعلاقه‌تان را دنبال کنید تا ویدیوهای تازه‌شان را در صفحه‌ی اصلی ببینید و از انتشارشان باخبر شوید."
        action={
          <Button asChild shape="pill">
            <Link href="/search?type=channel">کشف کانال‌ها</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {channels.map((channel) => (
        <li key={channel.id}>
          <FollowedCard channel={channel} />
        </li>
      ))}
    </ul>
  );
}
