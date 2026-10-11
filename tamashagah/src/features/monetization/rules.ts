import type { MonetizationStatus } from '@/generated/prisma/enums';

/**
 * Application rules of the creator side (pure, unit-tested). The enforcement lives in `service.ts`, inside a
 * transaction guarded by a per-channel advisory lock; these helpers decide what is allowed in a given state.
 *
 *   (none) ──start──▶ DRAFT ──submit (eligible + terms)──▶ SUBMITTED ──(reviewer)──▶ UNDER_REVIEW ──▶ APPROVED
 *                       ▲                                       │                          │            REJECTED
 *                       └───────────── withdraw ◀───────────────┘                          └───────────▶ SUSPENDED
 *
 * - ONE active application per channel: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED and SUSPENDED all block a new one.
 * - Only a reviewer can set UNDER_REVIEW / APPROVED / REJECTED / SUSPENDED: no creator operation takes a status
 *   from the client, and none of them can produce those statuses.
 * - REJECTED is final for that application; the creator may start a NEW one (history is kept).
 * - A creator can withdraw only while the application is SUBMITTED (not yet picked up by a reviewer).
 */
export const ACTIVE_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SUSPENDED'] as const satisfies readonly MonetizationStatus[];

export const isActiveStatus = (status: MonetizationStatus): boolean => (ACTIVE_STATUSES as readonly MonetizationStatus[]).includes(status);

/** What the creator may do next, given their newest application (or `null`). */
export type ApplicationActions = {
  /** Start or edit a draft / submit a (new) application. */
  canApply: boolean;
  canWithdraw: boolean;
  /** Editing the contact details is only possible while nothing has been submitted. */
  canEditDraft: boolean;
};

export function applicationActions(latest: { status: MonetizationStatus } | null): ApplicationActions {
  if (!latest) return { canApply: true, canWithdraw: false, canEditDraft: true };
  switch (latest.status) {
    case 'DRAFT':
      return { canApply: true, canWithdraw: false, canEditDraft: true };
    case 'REJECTED':
      return { canApply: true, canWithdraw: false, canEditDraft: true }; // a NEW application may be started
    case 'SUBMITTED':
      return { canApply: false, canWithdraw: true, canEditDraft: false };
    case 'UNDER_REVIEW':
    case 'APPROVED':
    case 'SUSPENDED':
      return { canApply: false, canWithdraw: false, canEditDraft: false };
  }
}
