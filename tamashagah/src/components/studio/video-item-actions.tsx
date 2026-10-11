'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { BarChart3, ExternalLink, MoreVertical, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { StudioVideoItem } from '@/features/videos-studio/queries';
import { cn } from '@/lib/utils';

/**
 * Per-video actions shared by the grid and the list: edit, statistics, and a menu with "view on site", "retry" (failed
 * videos) and "delete". Deleting is confirmed by the caller (the library owns the dialog).
 */
export function VideoItemActions({
  video,
  onDelete,
  onRetry,
  className,
}: {
  video: Pick<StudioVideoItem, 'id' | 'title' | 'processingStatus'>;
  onDelete: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const editHref = `/studio/videos/${video.id}/edit` as const;
  const statsHref = `/studio/analytics?video=${video.id}` as Route;
  const watchHref = `/watch/${video.id}` as const;

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Button asChild size="sm" variant="outline">
        <Link href={editHref}>
          <Pencil /> ویرایش
        </Link>
      </Button>
      <Button asChild size="icon-sm" variant="ghost">
        <Link href={statsHref} aria-label={`آمار «${video.title}»`} title="آمار">
          <BarChart3 />
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`گزینه‌های بیشتر برای «${video.title}»`}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {video.processingStatus === 'READY' && (
            <DropdownMenuItem asChild>
              <Link href={watchHref}>
                <ExternalLink /> مشاهده در سایت
              </Link>
            </DropdownMenuItem>
          )}
          {video.processingStatus === 'FAILED' && onRetry && (
            <DropdownMenuItem onSelect={onRetry}>
              <RotateCcw /> تلاش دوباره برای پردازش
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> حذف ویدیو
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
