'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { ChannelAvatar } from '@/components/channel-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { useFormatter } from '@/components/providers/format-provider';
import type { VideoCardData } from '@/features/videos/card';
import { cn } from '@/lib/utils';

export type VideoCardProps = {
  video: VideoCardData;
  /** Hide the channel avatar/name (e.g. on a channel page). */
  hideChannel?: boolean;
  className?: string;
  /** Load the poster eagerly (above-the-fold cards). */
  priority?: boolean;
};

/** Poster shown while a video has no thumbnail. */
export function PosterPlaceholder({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex size-full items-center justify-center bg-brand-gradient text-white/80', className)}>
      <Play className="size-10 fill-current" />
    </div>
  );
}

/**
 * Poster image that falls back to {@link PosterPlaceholder} when there is no URL or the file fails to load (404, storage
 * error, corrupt image) — never a blank grey box. The ref callback also catches an image that had already failed before
 * React hydrated (its `error` event is gone by then).
 */
export function PosterImage({
  src,
  priority = false,
  width = 640,
  height = 360,
  className,
}: {
  src: string | null | undefined;
  priority?: boolean;
  width?: number;
  height?: number;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <PosterPlaceholder />;
  return (
    <img
      ref={(img) => {
        if (img && img.complete && img.naturalWidth === 0) setFailedSrc(src);
      }}
      src={src}
      alt=""
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={cn('size-full object-cover', className)}
    />
  );
}

/**
 * The standard video tile used by every grid and list in the product:
 * 16:9 poster with duration badge, 2-line title, channel row, views · age.
 */
export function VideoCard({ video, hideChannel = false, className, priority = false }: VideoCardProps) {
  const f = useFormatter();
  const href = `/watch/${video.id}` as const;
  const channelHref = `/channel/${video.channel.handle}` as const;

  return (
    <article className={cn('group/card flex min-w-0 flex-col gap-3', className)}>
      <Link
        href={href}
        aria-label={video.title}
        className="relative block aspect-video overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <PosterImage src={video.posterUrl} priority={priority} className="transition-transform duration-300 group-hover/card:scale-[1.04]" />
        {video.durationSeconds != null && (
          <span className="absolute end-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {f.duration(video.durationSeconds)}
          </span>
        )}
      </Link>

      <div className="flex gap-3">
        {!hideChannel && (
          <Link href={channelHref} aria-label={video.channel.name} tabIndex={-1} className="shrink-0 self-start">
            <ChannelAvatar name={video.channel.name} src={video.channel.avatarUrl} size="md" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[15px] leading-6 font-semibold">
            <Link href={href} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
              {video.title}
            </Link>
          </h3>
          {!hideChannel && (
            <Link
              href={channelHref}
              className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="truncate">{video.channel.name}</span>
              {video.channel.isVerified && <VerifiedBadge className="size-3.5" />}
            </Link>
          )}
          <p className="text-[13px] text-muted-foreground" suppressHydrationWarning>
            {f.views(video.viewCount)}
            <span aria-hidden="true"> · </span>
            {f.relative(video.publishedAt)}
          </p>
        </div>
      </div>
    </article>
  );
}
