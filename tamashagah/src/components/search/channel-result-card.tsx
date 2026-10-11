'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ChannelAvatar } from '@/components/channel-avatar';
import { HighlightedText } from '@/components/search/highlighted-text';
import { useFormatter } from '@/components/providers/format-provider';
import { VerifiedBadge } from '@/components/verified-badge';
import type { ChannelResult } from '@/features/search/queries';

/** A channel hit: avatar, highlighted name, handle and counts. The whole card is one link. */
export function ChannelResultCard({ channel }: { channel: ChannelResult }) {
  const f = useFormatter();
  return (
    <article className="relative flex items-center gap-4 rounded-2xl border bg-card p-3 transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent/40 sm:p-4">
      <ChannelAvatar name={channel.name} src={channel.avatarUrl} size="lg" className="size-14 text-lg sm:size-16" />
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 text-base font-bold">
          <Link
            href={`/channel/${channel.handle}` as Route}
            dir="auto"
            className="truncate outline-none after:absolute after:inset-0 after:rounded-2xl"
          >
            <HighlightedText segments={channel.nameSegments} />
          </Link>
          {channel.isVerified && <VerifiedBadge />}
        </h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground" suppressHydrationWarning>
          <span className="ltr-isolate">@{channel.handle}</span>
          <span aria-hidden="true"> · </span>
          {f.followers(channel.followerCount)}
          <span aria-hidden="true"> · </span>
          {f.count(channel.videoCount, 'ویدیو')}
        </p>
        {channel.description && (
          <p dir="auto" className="user-text mt-1 line-clamp-1 text-[13px] text-muted-foreground sm:line-clamp-2">
            {channel.description}
          </p>
        )}
      </div>
    </article>
  );
}
