'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { MessageCircle, Share2, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { ChannelAvatar } from '@/components/channel-avatar';
import { useFormatter } from '@/components/providers/format-provider';
import { ShortPlayer } from '@/components/shorts/short-player';
import { VerifiedBadge } from '@/components/verified-badge';
import { PosterImage } from '@/components/video/video-card';
import type { ShortItem } from '@/features/discovery/shorts';
import { FollowButton } from '@/features/engagement/components/follow-button';
import { LikeButton } from '@/features/engagement/components/like-button';

export type SlideMode = 'active' | 'preload' | 'idle';

const railButton = 'flex flex-col items-center gap-1 text-xs text-white drop-shadow outline-none focus-visible:[&>span]:ring-[3px] focus-visible:[&>span]:ring-ring';
const railCircle = 'flex size-11 items-center justify-center rounded-full bg-black/45 backdrop-blur transition-colors hover:bg-black/60';

/**
 * One full-height slide of the shorts feed: poster, (when active or next) the player, title, channel + follow and the
 * action rail (like, comments, share, mute). Interactive overlay parts opt back into pointer events so a tap anywhere
 * else reaches the pause/play area of the player below.
 */
export function ShortSlide({
  item,
  index,
  mode,
  muted,
  signedIn,
  onToggleMute,
  onSoundBlocked,
  onSkip,
}: {
  item: ShortItem;
  index: number;
  mode: SlideMode;
  /** Effective state: the stored preference OR a browser-imposed mute. */
  muted: boolean;
  signedIn: boolean;
  onToggleMute: () => void;
  onSoundBlocked: () => void;
  onSkip: () => void;
}) {
  const f = useFormatter();

  async function share() {
    const url = `${window.location.origin}/shorts?v=${item.id}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: item.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('پیوند شورت کپی شد.');
    } catch (error) {
      if ((error as DOMException | undefined)?.name === 'AbortError') return; // the viewer closed the share sheet
      toast.error('اشتراک‌گذاری ممکن نشد. پیوند را از نوار نشانی کپی کنید.');
    }
  }

  return (
    <article
      aria-posinset={index + 1}
      aria-setsize={-1}
      aria-label={item.title}
      data-short-id={item.id}
      data-active={mode === 'active'}
      className="relative flex h-full snap-start snap-always items-center justify-center lg:py-3"
    >
      <div className="relative h-full max-w-full aspect-[9/16] overflow-hidden bg-black text-white lg:rounded-2xl">
        <div className="absolute inset-0">
          <PosterImage src={item.posterUrl} width={360} height={640} priority={index < 2} className={item.landscape ? 'object-contain' : 'object-cover'} />
        </div>
        {mode !== 'idle' && (
          <ShortPlayer hlsUrl={item.hlsUrl} landscape={item.landscape} mode={mode} muted={muted} onSoundBlocked={onSoundBlocked} onSkip={onSkip} />
        )}

        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-3/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end gap-3 p-4 pb-5">
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="pointer-events-auto flex items-center gap-2">
              <Link
                href={`/channel/${item.channel.handle}` as Route}
                className="flex min-w-0 items-center gap-2 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <ChannelAvatar name={item.channel.name} src={item.channel.avatarUrl} size="sm" className="ring-2 ring-white/70" />
                <span className="flex min-w-0 items-center gap-1 text-sm font-semibold drop-shadow">
                  <span dir="auto" className="truncate">
                    {item.channel.name}
                  </span>
                  {item.channel.isVerified && <VerifiedBadge className="size-3.5" />}
                </span>
              </Link>
              <FollowButton channelId={item.channel.id} initialFollowing={item.following} signedIn={signedIn} isOwner={item.isOwner} size="xs" />
            </div>
            <h2 dir="auto" className="line-clamp-2 text-[15px] leading-6 font-semibold drop-shadow">
              {item.title}
            </h2>
          </div>

          <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-4">
            <LikeButton videoId={item.id} initialLiked={item.liked} initialCount={item.likeCount} signedIn={signedIn} variant="stacked" />
            <Link href={`/watch/${item.id}#comments` as Route} aria-label={`دیدگاه‌ها (${f.number(item.commentCount)})`} className={railButton}>
              <span className={railCircle}>
                <MessageCircle aria-hidden="true" className="size-5" />
              </span>
              <span suppressHydrationWarning>{f.compact(item.commentCount)}</span>
            </Link>
            <button type="button" onClick={share} aria-label="اشتراک‌گذاری" className={railButton}>
              <span className={railCircle}>
                <Share2 aria-hidden="true" className="size-5" />
              </span>
              اشتراک
            </button>
            <button type="button" onClick={onToggleMute} aria-pressed={muted} aria-label={muted ? 'پخش صدا' : 'قطع صدا'} className={railButton}>
              <span className={railCircle}>{muted ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}</span>
              {muted ? 'بی‌صدا' : 'صدادار'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
