'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ListVideo } from 'lucide-react';
import { PosterImage } from '@/components/video/video-card';
import { useFormatter } from '@/components/providers/format-provider';

/** A playlist tile: cover of the first listed video, a count badge, title and description. */
export function PlaylistCard({
  id,
  title,
  description,
  videoCount,
  coverUrl,
  badge,
  href: hrefOverride,
}: {
  id: string;
  title: string;
  description?: string;
  videoCount: number;
  coverUrl: string | null;
  /** Optional extra badge text on the cover (e.g. "خصوصی"). */
  badge?: string;
  /** Override the link target (the system "watch later" list lives at /library/watch-later). */
  href?: string;
}) {
  const f = useFormatter();
  const href = (hrefOverride ?? `/playlist/${id}`) as Route;
  return (
    <article className="group/playlist flex min-w-0 flex-col gap-3">
      <Link
        href={href}
        aria-label={`${title}؛ ${f.count(videoCount, 'ویدیو')}`}
        className="relative block aspect-video overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <PosterImage src={coverUrl} className="transition-transform duration-300 group-hover/playlist:scale-[1.04]" />
        <span className="absolute inset-y-0 end-0 flex w-1/3 flex-col items-center justify-center gap-1 bg-black/65 text-white backdrop-blur-[2px]">
          <ListVideo aria-hidden="true" className="size-5" />
          <span className="text-sm font-semibold tabular-nums">{f.number(videoCount)}</span>
        </span>
        {badge && <span className="absolute start-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{badge}</span>}
      </Link>
      <div className="min-w-0">
        <h3 className="line-clamp-2 text-[15px] leading-6 font-semibold">
          <Link href={href} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
            {title}
          </Link>
        </h3>
        <p className="text-[13px] text-muted-foreground">{description ? <span dir="auto" className="line-clamp-1">{description}</span> : f.count(videoCount, 'ویدیو')}</p>
      </div>
    </article>
  );
}
