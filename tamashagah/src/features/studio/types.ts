import type { CommentStatus, ProcessingStatus, PublishStatus, VideoKind, Visibility } from '@/generated/prisma/enums';
import type { NotificationItem } from '@/features/notifications/queries';
import type { SourceSplit } from '@/features/analytics/types';

/** Lifecycle axes of a video that decide its status badge (see `features/studio/status.ts`). */
export type VideoLifecycle = {
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  takedownAt: string | null;
  scheduledFor: string | null;
};

export type DashboardVideo = VideoLifecycle & {
  id: string;
  title: string;
  kind: VideoKind;
  posterKey: string | null;
  durationSeconds: number | null;
  /** ISO string (publishedAt, falling back to createdAt). */
  date: string;
  /** All-time, from ViewEvent rows. */
  views: number;
  /** All-time, from VideoLike rows. */
  likes: number;
};

export type DashboardComment = {
  id: string;
  body: string;
  status: Extract<CommentStatus, 'PENDING' | 'APPROVED'>;
  /** ISO string */
  createdAt: string;
  author: { name: string; avatarUrl: string | null };
  video: { id: string; title: string };
};

export type UploadAlertVideo = {
  id: string;
  title: string;
  status: ProcessingStatus;
  /** Latest transcode job progress (0–100) when known. */
  progress: number | null;
  /** Creator-visible failure reason (only for FAILED). */
  failureReason: string | null;
};

export type DashboardData = {
  counts: {
    /** Videos that exist as real uploads (placeholders of unfinished uploads are not counted). */
    videos: number;
    published: number;
    followers: number;
    /** All-time views from ViewEvent rows, and today's (Tehran day). */
    totalViews: number;
    todayViews: number;
  };
  /** SEED rows inside the two view figures (the cards show a "sample" marker). */
  sample: { totalViews: SourceSplit; todayViews: SourceSplit };
  recentVideos: DashboardVideo[];
  recentComments: DashboardComment[];
  pendingComments: number;
  notifications: { unread: number; items: NotificationItem[] };
  alerts: { processing: UploadAlertVideo[]; failed: UploadAlertVideo[] };
};
