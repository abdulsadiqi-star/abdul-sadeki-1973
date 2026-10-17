'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { useFormatter } from '@/components/providers/format-provider';
import { VerifiedBadge } from '@/components/verified-badge';
import { FollowButton } from '@/features/engagement/components/follow-button';

export type ChannelHeaderData = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  isVerified: boolean;
  followerCount: number;
  videoCount: number;
  totalViews: number;
};

/** Banner, avatar, name, counts and the follow / manage action of a channel page. */
export function ChannelHeader({
  channel,
  signedIn,
  isOwner,
  following,
}: {
  channel: ChannelHeaderData;
  signedIn: boolean;
  isOwner: boolean;
  following: boolean;
}) {
  const f = useFormatter();
  const [followers, setFollowers] = useState(channel.followerCount);

  return (
    <header>
      <div className="relative h-28 overflow-hidden rounded-2xl bg-brand-gradient sm:h-44 lg:h-52">
        {channel.bannerUrl && <img src={channel.bannerUrl} alt="" width={1280} height={300} decoding="async" className="size-full object-cover" />}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-72 items-center gap-4">
          <ChannelAvatar name={channel.name} src={channel.avatarUrl} size="2xl" className="size-20 shrink-0 text-2xl ring-4 ring-background sm:size-28 sm:text-4xl" />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-extrabold sm:text-2xl">
              <span dir="auto" className="truncate">
                {channel.name}
              </span>
              {channel.isVerified && <VerifiedBadge className="size-5" />}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground sm:text-sm" suppressHydrationWarning>
              <span className="ltr-isolate">@{channel.handle}</span>
              <span aria-hidden="true">·</span>
              <span>{f.followers(followers)}</span>
              <span aria-hidden="true">·</span>
              <span>{f.count(channel.videoCount, 'ویدیو')}</span>
              <span aria-hidden="true">·</span>
              <span>{f.views(channel.totalViews)}</span>
            </p>
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          {isOwner ? (
            <Button asChild variant="outline" shape="pill" className="w-full sm:w-auto">
              <Link href="/studio">
                <Settings2 /> مدیریت کانال
              </Link>
            </Button>
          ) : (
            <FollowButton
              channelId={channel.id}
              initialFollowing={following}
              signedIn={signedIn}
              isOwner={isOwner}
              className="w-full sm:w-auto"
              onChange={(state) => setFollowers(state.followerCount)}
            />
          )}
        </div>
      </div>
    </header>
  );
}
