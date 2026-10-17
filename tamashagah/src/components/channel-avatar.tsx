import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf } from '@/lib/media-url';
import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-xl',
  xl: 'size-24 text-3xl',
  '2xl': 'size-32 text-4xl',
} as const;

export type AvatarSize = keyof typeof SIZES;

/** Round avatar with an initials fallback. Used for channels and users. */
export function ChannelAvatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <Avatar className={cn(SIZES[size], className)}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="bg-accent font-semibold text-accent-foreground">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}
