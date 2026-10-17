'use client';

import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { VideoStatusDto } from '../queries';

/** Videos whose processing is still going on (the status keeps changing, so the browser keeps asking). */
export const isInFlight = (status: Pick<VideoStatusDto, 'processingStatus'>): boolean =>
  status.processingStatus === 'AWAITING_UPLOAD' || status.processingStatus === 'QUEUED' || status.processingStatus === 'PROCESSING';

/** The batch endpoint accepts at most this many ids per request. */
const BATCH = 30;

async function fetchStatuses(ids: string[], signal?: AbortSignal): Promise<VideoStatusDto[]> {
  const out: VideoStatusDto[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const res = await fetch(`/api/studio/videos/status?ids=${ids.slice(i, i + BATCH).join(',')}`, { cache: 'no-store', signal });
    if (!res.ok) throw Object.assign(new Error('status'), { status: res.status });
    out.push(...((await res.json()) as { items: VideoStatusDto[] }).items);
  }
  return out;
}

/**
 * Live processing state of a set of videos with ONE request per poll (not one per card). Polls every couple of seconds
 * while anything is still being processed and stops by itself afterwards; ids the user may not manage are absent.
 */
export function useVideoStatuses(ids: readonly string[], options: { intervalMs?: number } = {}) {
  const interval = options.intervalMs ?? 2_500;
  const key = useMemo(() => [...new Set(ids)].sort(), [ids]);
  const query = useQuery({
    queryKey: ['studio', 'video-statuses', key],
    enabled: key.length > 0,
    queryFn: ({ signal }) => fetchStatuses(key, signal),
    // Keep asking until every video reached a final state. Ids that are absent from an answer (deleted meanwhile, or not
    // the caller's) never become final, so they must not keep the poll alive.
    refetchInterval: (q) => {
      const data = q.state.data;
      return !data || data.some(isInFlight) ? interval : false;
    },
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const statuses = useMemo(() => new Map((query.data ?? []).map((s) => [s.id, s])), [query.data]);
  return { statuses, isError: query.isError };
}
