'use client';

import { useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { ChannelAvatar } from '@/components/channel-avatar';
import { useFormatter } from '@/components/providers/format-provider';
import { VerifiedBadge } from '@/components/verified-badge';
import { PosterImage } from '@/components/video/video-card';
import { removeFromPlaylistAction } from '@/features/library/actions';
import type { PlaylistItemView } from '@/features/library/queries';
import { cn } from '@/lib/utils';

/** The ordered list of a playlist. The owner can remove videos (optimistic); everyone else just reads. */
export function PlaylistItems({
  playlistId,
  items,
  isOwner,
  startIndex,
}: {
  playlistId: string;
  items: PlaylistItemView[];
  isOwner: boolean;
  /** Number shown for the first row (continues across pages). */
  startIndex: number;
}) {
  const f = useFormatter();
  const [visible, removeLocally] = useOptimistic(items, (state, videoId: string) => state.filter((i) => i.video.id !== videoId));
  const [, startTransition] = useTransition();

  function remove(videoId: string) {
    startTransition(async () => {
      removeLocally(videoId);
      const result = await removeFromPlaylistAction({ playlistId, videoId });
      if (result.ok) toast.success('از لیست حذف شد.');
      else toast.error(result.message);
    });
  }

  return (
    <ol className="divide-y rounded-2xl border bg-card">
      {visible.map(({ video }, i) => {
        const href = (video.kind === 'SHORT' ? `/shorts?v=${video.id}` : `/watch/${video.id}?list=${playlistId}`) as Route;
        return (
          <li key={video.id} className="flex items-center gap-3 p-3 sm:gap-4">
            <span aria-hidden="true" className="w-6 shrink-0 text-center text-sm text-muted-foreground tabular-nums">
              {f.number(startIndex + i)}
            </span>
            <Link href={href} tabIndex={-1} aria-hidden="true" className="relative block aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-44">
              <PosterImage src={video.posterUrl} />
              {video.durationSeconds != null && (
                <span className="absolute end-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">{f.duration(video.durationSeconds)}</span>
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-[15px] leading-6 font-semibold">
                <Link href={href} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
                  {video.title}
                </Link>
              </h3>
              <Link href={`/channel/${video.channel.handle}` as Route} className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
                <ChannelAvatar name={video.channel.name} src={video.channel.avatarUrl} size="xs" />
                <span className="truncate">{video.channel.name}</span>
                {video.channel.isVerified && <VerifiedBadge className="size-3.5" />}
              </Link>
              <p className="text-[12px] text-muted-foreground" suppressHydrationWarning>
                {f.views(video.viewCount)}
              </p>
            </div>
            {isOwner && (
              <button
                type="button"
                onClick={() => remove(video.id)}
                aria-label={`حذف «${video.title}» از لیست`}
                className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50')}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
