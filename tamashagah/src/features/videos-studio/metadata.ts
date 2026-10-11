/**
 * The metadata form's value shape and how it is derived from a stored video. Pure and client-safe (used by the
 * upload cards, the edit page and the server queries that feed them).
 */
import type { ProcessingStatus, PublishStatus, Visibility } from '@/generated/prisma/enums';

export type MetadataFormValues = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  visibility: Visibility;
  publishMode: 'PUBLISH' | 'SCHEDULE' | 'DRAFT';
  /** ISO instant, only meaningful for SCHEDULE. */
  scheduledFor: string | null;
  commentsEnabled: boolean;
  ageRestricted: boolean;
  language: string;
  kindChoice: 'auto' | 'VIDEO' | 'SHORT';
};

/** What a brand-new upload starts with (the server stored the same title and the channel's default visibility). */
export function defaultMetadata(input: { title: string; visibility: Visibility }): MetadataFormValues {
  return {
    title: input.title,
    description: '',
    tags: [],
    categoryId: null,
    visibility: input.visibility,
    publishMode: 'PUBLISH',
    scheduledFor: null,
    commentsEnabled: true,
    ageRestricted: false,
    language: 'fa',
    kindChoice: 'auto',
  };
}

/**
 * Which "when to publish" option describes the stored state. A video that is still being processed has no
 * publication yet, only the creator's intent (`publishOnReady`).
 */
export function publishModeOf(video: { processingStatus: ProcessingStatus; publishStatus: PublishStatus; publishOnReady: boolean }): MetadataFormValues['publishMode'] {
  if (video.publishStatus === 'PUBLISHED') return 'PUBLISH';
  if (video.publishStatus === 'SCHEDULED') return 'SCHEDULE';
  return video.processingStatus !== 'READY' && video.publishOnReady ? 'PUBLISH' : 'DRAFT';
}

export type StoredMetadata = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  language: string;
  visibility: Visibility;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  publishOnReady: boolean;
  scheduledFor: Date | string | null;
  commentsEnabled: boolean;
  ageRestricted: boolean;
  kindChoice: 'auto' | 'VIDEO' | 'SHORT';
};

export function metadataFromStored(video: StoredMetadata): MetadataFormValues {
  return {
    title: video.title,
    description: video.description,
    tags: video.tags,
    categoryId: video.categoryId,
    visibility: video.visibility,
    publishMode: publishModeOf(video),
    scheduledFor: video.scheduledFor ? new Date(video.scheduledFor).toISOString() : null,
    commentsEnabled: video.commentsEnabled,
    ageRestricted: video.ageRestricted,
    language: video.language,
    kindChoice: video.kindChoice,
  };
}
