import type { Prisma } from '@/generated/prisma/client';

/**
 * Prisma `where` fragments that encode who may see a video. ALWAYS use these
 * instead of re-writing the conditions, so feeds, search, recommendations and
 * channel pages can never disagree (see also src/lib/permissions.ts).
 */

/** Listed in feeds / search / category / channel pages for everyone. */
export const publicVideoWhere = {
  processingStatus: 'READY',
  publishStatus: 'PUBLISHED',
  visibility: 'PUBLIC',
  takedownAt: null,
  channel: { suspendedAt: null },
} satisfies Prisma.VideoWhereInput;

/** Playable by anyone who has the link (PUBLIC or UNLISTED). */
export const linkableVideoWhere = {
  processingStatus: 'READY',
  publishStatus: 'PUBLISHED',
  visibility: { in: ['PUBLIC', 'UNLISTED'] },
  takedownAt: null,
  channel: { suspendedAt: null },
} satisfies Prisma.VideoWhereInput;

/** Raw-SQL twin of `publicVideoWhere` for queries on "Video" aliased as v (joins "Channel" as c). */
export const PUBLIC_VIDEO_SQL = `
  v."processingStatus" = 'READY' AND v."publishStatus" = 'PUBLISHED' AND v."visibility" = 'PUBLIC'
  AND v."takedownAt" IS NULL AND c."suspendedAt" IS NULL`;
