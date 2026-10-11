'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Zap } from 'lucide-react';
import { ChannelAvatar } from '@/components/channel-avatar';
import { HighlightedText } from '@/components/search/highlighted-text';
import { useFormatter } from '@/components/providers/format-provider';
import { VerifiedBadge } from '@/components/verified-badge';
import { PosterPlaceholder } from '@/components/video/video-card';
import type { VideoResult } from '@/features/search/queries';
import { cn } from '@/lib/utils';

/** One row of the search results: poster, highlighted title, meta, channel and a description excerpt. */
export function SearchResultItem({ result, priority = false }: { result: VideoResult; priority?: boolean }) {
  const f = useFormatter();
  const { card } = result;
  const isShort = card.kind === 'SHORT';
  const href = (isShort ? `/shorts?v=${card.id}` : `/watch/${card.id}`) as Route;
  const channelHref = `/channel/${card.channel.handle}` as Route;

  return (
    <article className="group/result flex gap-3 sm:gap-4">
      <Link
        href={href}
        aria-label={card.title}
        tabIndex={-1}
        className={cn(
          'relative block shrink-0 overflow-hidden rounded-xl bg-muted outline-none',
          isShort ? 'aspect-[9/16] w-24 sm:w-32' : 'aspect-video w-40 sm:w-72',
        )}
      >
        {card.posterUrl ? (
          <img
            src={card.posterUrl}
            alt=""
            width={isShort ? 360 : 640}
            height={isShort ? 640 : 360}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover/result:scale-[1.04]"
          />
        ) : (
          <PosterPlaceholder />
        )}
        {isShort ? (
          <span className="absolute end-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Zap aria-hidden="true" className="size-3 fill-current" /> شورتس
          </span>
        ) : (
          card.durationSeconds != null && (
            <span className="absolute end-1.5 bottom-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
              {f.duration(card.durationSeconds)}
            </span>
          )
        )}
      </Link>

      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="line-clamp-2 text-[15px] leading-6 font-semibold sm:text-lg sm:leading-7">
          <Link href={href} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
            <HighlightedText segments={result.titleSegments} />
          </Link>
        </h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground" suppressHydrationWarning>
          {f.views(card.viewCount)}
          <span aria-hidden="true"> · </span>
          {f.relative(card.publishedAt)}
        </p>
        <Link href={channelHref} className="mt-1.5 inline-flex max-w-full items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ChannelAvatar name={card.channel.name} src={card.channel.avatarUrl} size="xs" />
          <span className="truncate">{card.channel.name}</span>
          {card.channel.isVerified && <VerifiedBadge className="size-3.5" />}
        </Link>
        {result.snippet.length > 0 && (
          <p dir="auto" className="user-text mt-1.5 hidden line-clamp-2 text-sm leading-6 text-muted-foreground sm:block">
            <HighlightedText segments={result.snippet} />
          </p>
        )}
      </div>
    </article>
  );
}
