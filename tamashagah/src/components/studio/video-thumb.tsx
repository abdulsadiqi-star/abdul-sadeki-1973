import { Play } from 'lucide-react';
import { mediaUrl } from '@/lib/media-url';
import { cn } from '@/lib/utils';

/** 16:9 poster for studio lists (decorative: the title next to it is the accessible name). Falls back to the brand gradient. */
export function VideoThumb({ posterKey, className }: { posterKey: string | null; className?: string }) {
  const src = mediaUrl(posterKey);
  return (
    <div className={cn('relative aspect-video shrink-0 overflow-hidden rounded-lg bg-muted', className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <div aria-hidden="true" className="flex size-full items-center justify-center bg-brand-gradient text-white/85">
          <Play className="size-1/3 fill-current" />
        </div>
      )}
    </div>
  );
}
