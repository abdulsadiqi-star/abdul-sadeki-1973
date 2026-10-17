'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { startReportReviewAction } from '@/features/admin/actions/reports';
import { startMonetizationReviewAction, startVerificationReviewAction } from '@/features/admin/actions/requests';

const ACTIONS = {
  report: startReportReviewAction,
  monetization: startMonetizationReviewAction,
  verification: startVerificationReviewAction,
} as const;

/**
 * "Mark as under review on open". Done from the browser — not while rendering the page — so link prefetching or crawlers can never
 * flip a status; only a person who really opened the page triggers it. The action is idempotent and only moves the first state.
 */
export function MarkReviewing({ kind, id, pending }: { kind: keyof typeof ACTIONS; id: string; pending: boolean }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (!pending || done.current) return;
    done.current = true;
    void ACTIONS[kind]({ id })
      .then((res) => {
        if (res.ok && res.data.changed) router.refresh();
      })
      .catch(() => undefined);
  }, [kind, id, pending, router]);

  return null;
}
