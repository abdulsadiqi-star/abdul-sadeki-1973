import type { Prisma } from '@/generated/prisma/client';
import type { ModerationActionType } from '@/generated/prisma/enums';
import type { Tx } from './types';

export type AuditInput = {
  actorId: string;
  type: ModerationActionType;
  videoId?: string | null;
  commentId?: string | null;
  channelId?: string | null;
  /** The affected account (blocked commenter, suspended user, channel owner, ...). */
  targetUserId?: string | null;
  reportId?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown>;
};

/** JSON columns reject `undefined`; drop such keys (and keep everything else as-is). */
export function cleanMeta(meta: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  if (!meta) return undefined;
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as Prisma.InputJsonObject) : undefined;
}

/**
 * Write the audit row of a staff mutation. ALWAYS call it with the transaction client of the change it
 * describes, so the change and its audit trail commit (or roll back) together — "exactly one row per mutation".
 */
export async function writeAudit(tx: Tx, input: AuditInput): Promise<string> {
  const row = await tx.moderationAction.create({
    data: {
      actorId: input.actorId,
      type: input.type,
      videoId: input.videoId ?? null,
      commentId: input.commentId ?? null,
      channelId: input.channelId ?? null,
      targetUserId: input.targetUserId ?? null,
      reportId: input.reportId ?? null,
      reason: input.reason ?? null,
      meta: cleanMeta(input.meta),
    },
    select: { id: true },
  });
  return row.id;
}
