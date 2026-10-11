'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { useFormatter } from '@/components/providers/format-provider';
import { FollowButton } from '@/features/engagement/components/follow-button';

/**
 * The channel line under the title: avatar, name (+ verified badge), live follower count and the follow button.
 * Owners and moderators additionally get the shortcut to the studio editor. Client component because the follower
 * count updates the moment the viewer follows.
 */
export function ChannelRow({
  channel,
  initialFollowing,
  signedIn,
  isOwner,
  studioHref,
}: {
  channel: { id: string; handle: string; name: string; avatarUrl: string | null; isVerified: boolean; followerCount: number };
  initialFollowing: boolean;
  signedIn: boolean;
  isOwner: boolean;
  /** Set for owners / moderators: the video's edit page in the studio. */
  studioHref?: string;
}) {
  const f = useFormatter();
  const [followers, setFollowers] = useState(channel.followerCount);
  const href = `/channel/${channel.handle}` as Route;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={href} aria-label={`کانال ${channel.name}`} className="shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ChannelAvatar name={channel.name} src={channel.avatarUrl} size="md" />
        </Link>
        <div className="min-w-0">
          <Link href={href} className="flex items-center gap-1 leading-6 font-bold hover:text-primary">
            <span className="truncate" dir="auto">
              {channel.name}
            </span>
            {channel.isVerified && <VerifiedBadge />}
          </Link>
          <p className="text-xs text-muted-foreground tabular-nums" data-testid="follower-count">
            {f.followers(followers)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {studioHref && (
          <Button asChild variant="outline" shape="pill" size="sm">
            <Link href={studioHref as Route}>
              <Pencil /> ویرایش در استودیو
            </Link>
          </Button>
        )}
        <FollowButton
          channelId={channel.id}
          initialFollowing={initialFollowing}
          signedIn={signedIn}
          isOwner={isOwner}
          onChange={(state) => setFollowers(state.followerCount)}
        />
      </div>
    </div>
  );
}
