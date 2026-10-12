'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { BarChart3, ExternalLink, MoreVertical, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { StudioVideoItem } from '@/features/videos-studio/queries';
import { cn } from '@/lib/utils';

type ActionVideo = Pick<StudioVideoItem, 'id' | 'title' | 'processingStatus'>;

/**
 * Per-video actions. The `icons` variant (grid tiles) is four icon buttons — edit, statistics, view / retry, delete —
 * the `full` variant (list rows) shows labelled edit and statistics plus a menu. Deleting is confirmed by the caller
 * (the library owns the dialog).
 */
export function VideoItemActions({
  video,
  onDelete,
  onRetry,
  variant = 'full',
  className,
}: {
  video: ActionVideo;
  onDelete: () => void;
  onRetry?: () => void;
  variant?: 'icons' | 'full';
  className?: string;
}) {
  const editHref = `/studio/videos/${video.id}/edit` as const;
  const statsHref = `/studio/analytics?video=${video.id}` as Route;
  const watchHref = `/watch/${video.id}` as const;

  if (variant === 'icons') {
    return (
      <div className={cn('flex items-center justify-between', className)}>
        <Button asChild size="icon-xs" variant="ghost">
          <Link href={editHref} aria-label={`ویرایش «${video.title}»`} title="ویرایش">
            <Pencil />
          </Link>
        </Button>
        <Button asChild size="icon-xs" variant="ghost">
          <Link href={statsHref} aria-label={`آمار «${video.title}»`} title="آمار">
            <BarChart3 />
          </Link>
        </Button>
        {video.processingStatus === 'READY' && (
          <Button asChild size="icon-xs" variant="ghost">
            <Link href={watchHref} aria-label={`مشاهده‌ی «${video.title}» در سایت`} title="مشاهده در سایت">
              <ExternalLink />
            </Link>
          </Button>
        )}
        {video.processingStatus === 'FAILED' && onRetry && (
          <Button size="icon-xs" variant="ghost" aria-label={`تلاش دوباره برای پردازش «${video.title}»`} title="تلاش دوباره" onClick={onRetry}>
            <RotateCcw />
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`حذف «${video.title}»`} title="حذف" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    );
  }

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
