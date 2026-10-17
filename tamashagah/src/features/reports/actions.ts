'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { toViewer } from '@/features/engagement/viewer';
import { reportCommentSchema, reportVideoSchema } from './schemas';
import { reportComment, reportVideo } from './service';

// Reporting needs a verified e-mail (like commenting and uploading).
const viewer = async () => toViewer(await requireVerifiedUser());

export async function reportVideoAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = await viewer();
    const data = parse(reportVideoSchema, input);
    await enforceRateLimit('report:user', v.id, limits.report);
    await reportVideo(v, data.videoId, data);
  });
}

export async function reportCommentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = await viewer();
    const data = parse(reportCommentSchema, input);
    await enforceRateLimit('report:user', v.id, limits.report);
    await reportComment(v, data.commentId, data);
  });
}
