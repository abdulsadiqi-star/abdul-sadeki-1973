import 'server-only';
import { db } from '@/lib/db';
import type { UserRole } from '@/generated/prisma/enums';
import { OPEN_REPORT_STATUSES, PENDING_MONETIZATION_STATUSES, PENDING_VERIFICATION_STATUSES, roleCan } from '../policy';

export type NavCounts = {
  reports: number;
  verification: number;
  /** null for roles that cannot review monetization */
  monetization: number | null;
  support: number;
};

/** The numbers shown as sidebar badges: how much waits for a human. Cheap indexed counts. */
export async function getNavCounts(role: UserRole): Promise<NavCounts> {
  const [reports, verification, monetization, support] = await Promise.all([
    db.report.count({ where: { status: { in: [...OPEN_REPORT_STATUSES] } } }),
    db.verificationRequest.count({ where: { status: { in: [...PENDING_VERIFICATION_STATUSES] } } }),
    roleCan(role, 'monetization.review') ? db.monetizationApplication.count({ where: { status: { in: [...PENDING_MONETIZATION_STATUSES] } } }) : Promise.resolve(null),
    db.supportTicket.count({ where: { status: 'OPEN' } }),
  ]);
  return { reports, verification, monetization, support };
}

export type Overview = {
  counts: {
    openReports: number;
    reviewingReports: number;
    pendingVerification: number;
    /** null when the viewer cannot review monetization */
    pendingMonetization: number | null;
    openTickets: number;
    processingVideos: number;
    failedVideos: number;
  };
  /** When the oldest unresolved report was filed. */
  oldestPendingReportAt: Date | null;
  oldestOpenTicketAt: Date | null;
};

/** Everything that "needs attention", straight from the tables — no cached or invented numbers. */
export async function getOverview(role: UserRole): Promise<Overview> {
  const pendingReports = { status: { in: [...OPEN_REPORT_STATUSES] } };
  const [openReports, reviewingReports, pendingVerification, pendingMonetization, openTickets, processingVideos, failedVideos, oldestReport, oldestTicket] =
    await Promise.all([
      db.report.count({ where: { status: 'OPEN' } }),
      db.report.count({ where: { status: 'REVIEWING' } }),
      db.verificationRequest.count({ where: { status: { in: [...PENDING_VERIFICATION_STATUSES] } } }),
      roleCan(role, 'monetization.review') ? db.monetizationApplication.count({ where: { status: { in: [...PENDING_MONETIZATION_STATUSES] } } }) : Promise.resolve(null),
      db.supportTicket.count({ where: { status: 'OPEN' } }),
      db.video.count({ where: { processingStatus: { in: ['QUEUED', 'PROCESSING'] } } }),
      db.video.count({ where: { processingStatus: 'FAILED' } }),
      db.report.findFirst({ where: pendingReports, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } }),
      db.supportTicket.findFirst({ where: { status: 'OPEN' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { updatedAt: true } }),
    ]);
  return {
    counts: { openReports, reviewingReports, pendingVerification, pendingMonetization, openTickets, processingVideos, failedVideos },
    oldestPendingReportAt: oldestReport?.createdAt ?? null,
    oldestOpenTicketAt: oldestTicket?.updatedAt ?? null,
  };
}
