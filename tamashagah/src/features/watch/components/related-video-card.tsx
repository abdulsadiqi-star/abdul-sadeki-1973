'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { PosterPlaceholder } from '@/components/video/video-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { useFormatter } from '@/components/providers/format-provider';
import type { VideoCardData } from '@/features/videos/card';

/** Compact horizontal card for the "related videos" column: small poster on one side, text on the other. */
export function RelatedVideoCard({ video }: { video: VideoCardData }) {
  const f = useFormatter();
  const href = `/watch/${video.id}` as Route;
  return (
    <article className="group/related flex gap-3">
      <Link
        href={href}
        aria-label={video.title}
        tabIndex={-1}
        className="relative block aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-muted outline-none sm:w-44 lg:w-40 xl:w-44"
      >
        {video.posterUrl ? (
          <img src={video.posterUrl} alt="" width={320} height={180} loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-300 group-hover/related:scale-[1.04]" />
        ) : (
          <PosterPlaceholder />
        )}
        {video.durationSeconds != null && (
          <span className="absolute end-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">{f.duration(video.durationSeconds)}</span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-sm leading-6 font-semibold">
          <Link href={href} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
            {video.title}
          </Link>
        </h3>
        <Link href={`/channel/${video.channel.handle}` as Route} className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <span className="truncate">{video.channel.name}</span>
          {video.channel.isVerified && <VerifiedBadge className="size-3.5" />}
        </Link>
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          {f.views(video.viewCount)}
          <span aria-hidden="true"> · </span>
          {f.relative(video.publishedAt)}
        </p>
      </div>
    </article>
  );
}
