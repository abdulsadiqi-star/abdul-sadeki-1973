import { labels } from '@/lib/i18n/fa';
import type { VideoLifecycle } from './types';

export type VideoStatusBadge = {
  key: 'takedown' | 'failed' | 'awaiting' | 'processing' | 'draft' | 'scheduled' | 'public' | 'unlisted' | 'private';
  label: string;
  variant: 'success' | 'warning' | 'info' | 'muted' | 'destructive';
};

/**
 * One badge summarizing the three independent lifecycle axes of a video (processing × publish × visibility) plus
 * a moderator takedown. The most "blocking" condition wins, so a creator sees what needs attention first.
 */
export function videoStatusBadge(video: VideoLifecycle): VideoStatusBadge {
  if (video.takedownAt) return { key: 'takedown', label: 'از دسترس خارج شده', variant: 'destructive' };
  switch (video.processingStatus) {
    case 'FAILED':
      return { key: 'failed', label: labels.processing.FAILED, variant: 'destructive' };
    case 'AWAITING_UPLOAD':
      return { key: 'awaiting', label: labels.processing.AWAITING_UPLOAD, variant: 'muted' };
    case 'QUEUED':
    case 'PROCESSING':
      return { key: 'processing', label: labels.processing.PROCESSING, variant: 'info' };
    case 'READY':
      break;
  }
  if (video.publishStatus === 'DRAFT') return { key: 'draft', label: labels.publish.DRAFT, variant: 'muted' };
  if (video.publishStatus === 'SCHEDULED') return { key: 'scheduled', label: labels.publish.SCHEDULED, variant: 'warning' };
  switch (video.visibility) {
    case 'PUBLIC':
      return { key: 'public', label: labels.visibility.PUBLIC, variant: 'success' };
    case 'UNLISTED':
      return { key: 'unlisted', label: labels.visibility.UNLISTED, variant: 'info' };
    case 'PRIVATE':
      return { key: 'private', label: labels.visibility.PRIVATE, variant: 'muted' };
  }
}
