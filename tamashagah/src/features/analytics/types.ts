/**
 * Serializable result shapes of the analytics engine (no Dates, no BigInt: these cross the
 * Server → Client Component boundary).
 */
import type { DeviceType, ProcessingStatus, PublishStatus, VideoKind, Visibility } from '@/generated/prisma/enums';
import type { Granularity, RangePreset } from '@/lib/analytics/ranges';
import type { SeriesPoint } from '@/lib/analytics/series';

/** A count split by data provenance (`ViewEvent.source` / `FollowEvent.source`). */
export type SourceSplit = { real: number; seed: number };

export type AnalyticsScope = {
  /** ALWAYS derived server-side from the session — never from request input. */
  channelId: string;
  /** Narrow every metric to one video (ownership is verified by `findOwnedVideo`). */
  videoId?: string | null;
};

export type RangeTotals = {
  views: number;
  /** Distinct viewers over the WHOLE period (not the sum of daily values). */
  uniqueViewers: number;
  watchSeconds: number;
  /** watchSeconds / views (0 when there are no views). */
  avgViewSeconds: number;
  likes: number;
  comments: number;
  newFollowers: number;
  unfollows: number;
  netFollowers: number;
};

/** % change versus the previous period; `null` = undefined (the previous period had none). */
export type RangeChanges = Record<'views' | 'uniqueViewers' | 'watchSeconds' | 'avgViewSeconds' | 'likes' | 'comments' | 'newFollowers' | 'netFollowers', number | null>;

export type CardStats = {
  /** Views since 00:00 Tehran time today (independent of the selected range). */
  todayViews: number;
  /** Views since the 1st of the current Jalali month. */
  monthViews: number;
  /** True when SEED events are part of the figure (the card shows a "sample" marker). */
  seedToday: boolean;
  seedMonth: boolean;
  /** Channel-level figures: `null` when the scope is a single video. */
  followers: number | null;
  notifySubscribers: number | null;
};

export type DeviceShare = { device: DeviceType; views: number };

/** `source` is a referrer host, `direct`, `internal` (our own pages) or `other` (the long tail). */
export type SourceShare = { source: string; views: number };

export type TopVideo = { id: string; title: string; posterKey: string | null; views: number; watchSeconds: number };

export type AnalyticsOverview = {
  video: { id: string; title: string } | null;
  range: {
    preset: RangePreset;
    granularity: Granularity;
    fromKey: string;
    toKey: string;
    days: number;
    previous: { fromKey: string; toKey: string; days: number };
  };
  series: SeriesPoint[];
  totals: RangeTotals;
  previous: RangeTotals;
  changes: RangeChanges;
  cards: CardStats;
  devices: DeviceShare[];
  sources: SourceShare[];
  topVideos: TopVideo[];
  /** Provenance of the rows inside the selected range. The seed notice is shown iff `seed > 0` in either. */
  data: { views: SourceSplit; followEvents: SourceSplit };
};

export const VIDEO_SORT_KEYS = ['views', 'watch', 'avg', 'likes', 'comments', 'published', 'title'] as const;
export type VideoSortKey = (typeof VIDEO_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export type VideoPerformanceRow = {
  id: string;
  title: string;
  kind: VideoKind;
  posterKey: string | null;
  durationSeconds: number | null;
  /** ISO string or null. */
  publishedAt: string | null;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  views: number;
  uniqueViewers: number;
  watchSeconds: number;
  avgViewSeconds: number;
  likes: number;
  comments: number;
};

export type VideoPerformancePage = {
  rows: VideoPerformanceRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};
