'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Zap } from 'lucide-react';
import { PosterPlaceholder } from '@/components/video/video-card';
import { useFormatter } from '@/components/providers/format-provider';
import type { VideoCardData } from '@/features/videos/card';
import { cn } from '@/lib/utils';

/** Portrait (9:16) tile for a short: opens the shorts feed at that video. */
export function ShortCard({ video, className, priority = false }: { video: VideoCardData; className?: string; priority?: boolean }) {
  const f = useFormatter();
  return (
    <article className={cn('group/short relative aspect-[9/16] overflow-hidden rounded-xl bg-muted', className)}>
      {video.posterUrl ? (
        <img
          src={video.posterUrl}
          alt=""
          width={360}
          height={640}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="size-full object-cover transition-transform duration-300 group-hover/short:scale-[1.04]"
        />
      ) : (
        <PosterPlaceholder />
      )}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 to-transparent" />
      <Zap aria-hidden="true" className="absolute end-2 top-2 size-4 fill-white text-white drop-shadow" />
      <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
        <h3 className="line-clamp-2 text-[13px] leading-5 font-semibold">
          <Link
            href={`/shorts?v=${video.id}` as Route}
            dir="auto"
            className="outline-none after:absolute after:inset-0 after:z-10 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring"
          >
            {video.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-[11px] text-white/80" suppressHydrationWarning>
          {f.views(video.viewCount)}
        </p>
      </div>
    </article>
  );
}
