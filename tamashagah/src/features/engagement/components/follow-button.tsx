'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { toggleFollowAction } from '@/features/engagement/actions';

/**
 * Follow / unfollow a channel. Hidden for the channel's own owner. Visitors are sent to the login page and back.
 * Calls `onChange` with the fresh follower count so a parent (e.g. a counter) can update.
 */
export function FollowButton({
  channelId,
  initialFollowing,
  signedIn,
  isOwner = false,
  size = 'default',
  className,
  onChange,
}: {
  channelId: string;
  initialFollowing: boolean;
  signedIn: boolean;
  isOwner?: boolean;
  size?: ButtonProps['size'];
  className?: string;
  onChange?: (state: { following: boolean; followerCount: number }) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  if (isOwner) return null;

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const previous = following;
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      const res = await toggleFollowAction({ channelId, follow: next });
      if (res.ok) {
        setFollowing(res.data.following);
        onChange?.(res.data);
      } else {
        setFollowing(previous);
        toast.error(res.message);
      }
    });
  }

  return (
    <Button
      type="button"
      shape="pill"
      size={size}
      variant={following ? 'secondary' : 'default'}
      aria-pressed={following}
      disabled={pending}
      onClick={onClick}
      className={className}
    >
      {following ? <Check /> : <UserPlus />}
      {following ? 'دنبال می‌کنید' : 'دنبال کردن'}
    </Button>
  );
}
