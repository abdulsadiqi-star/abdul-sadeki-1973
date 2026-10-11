'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useFormatter } from '@/components/providers/format-provider';
import { toggleLikeAction } from '@/features/engagement/actions';
import { cn } from '@/lib/utils';

/** Like / unlike with optimistic update; sends visitors to the login page and back. */
export function LikeButton({
  videoId,
  initialLiked,
  initialCount,
  signedIn,
  className,
  variant = 'pill',
}: {
  videoId: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
  className?: string;
  /** `pill` for the watch page action bar, `stacked` for the vertical shorts rail. */
  variant?: 'pill' | 'stacked';
}) {
  const f = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState({ liked: initialLiked, count: initialCount });
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const previous = state;
    const liked = !state.liked;
    setState({ liked, count: Math.max(0, state.count + (liked ? 1 : -1)) });
    startTransition(async () => {
      const res = await toggleLikeAction({ videoId, liked });
      if (res.ok) setState({ liked: res.data.liked, count: res.data.likeCount });
      else {
        setState(previous);
        toast.error(res.message);
      }
    });
  }

  if (variant === 'stacked') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={state.liked}
        aria-label={state.liked ? 'لغو پسندیدن' : 'پسندیدن'}
        className={cn('flex flex-col items-center gap-1 text-xs text-white drop-shadow', className)}
      >
        <span className={cn('flex size-11 items-center justify-center rounded-full bg-black/45 backdrop-blur transition-colors', state.liked && 'bg-primary')}>
          <ThumbsUp className={cn('size-5', state.liked && 'fill-current')} />
        </span>
        {f.compact(state.count)}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={state.liked ? 'soft' : 'outline'}
      shape="pill"
      aria-pressed={state.liked}
      aria-label={state.liked ? 'لغو پسندیدن' : 'پسندیدن'}
      disabled={pending}
      onClick={onClick}
      className={className}
    >
      <ThumbsUp className={cn(state.liked && 'fill-current')} />
      <span className="tabular-nums">{f.compact(state.count)}</span>
    </Button>
  );
}
