'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { parse } from '@/lib/validation';
import { dismissReport, startReportReview, warnCreator } from '@/features/moderation/reports';
import { dismissReportSchema, startReviewSchema, warnCreatorSchema } from '../schemas';
import { requireStaff, revalidatePublicSite } from '../guard';

/** Opening a report moves OPEN → REVIEWING (idempotent workflow marker; deciding is a separate action). */
export async function startReportReviewAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const staff = await requireStaff('reports.handle');
    const { id } = parse(startReviewSchema, input);
    return startReportReview(staff, id);
  });
}

export async function dismissReportAction(input: unknown): Promise<ActionResult<{ resolvedReportIds: string[] }>> {
  return runAction(async () => {
    const staff = await requireStaff('reports.handle');
    const data = parse(dismissReportSchema, input);
    const result = await dismissReport(staff, data);
    revalidatePublicSite();
    return result;
  });
}

export async function warnCreatorAction(input: unknown): Promise<ActionResult<{ resolvedReportIds: string[] }>> {
  return runAction(async () => {
    const staff = await requireStaff('creator.warn');
    const data = parse(warnCreatorSchema, input);
    const result = await warnCreator(staff, data);
    revalidatePublicSite();
    return result;
  });
}
