-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationActionType" ADD VALUE 'CREATOR_WARN';
ALTER TYPE "ModerationActionType" ADD VALUE 'VERIFICATION_REJECT';
ALTER TYPE "ModerationActionType" ADD VALUE 'TICKET_REPLY';
ALTER TYPE "ModerationActionType" ADD VALUE 'TICKET_CLOSE';
ALTER TYPE "ModerationActionType" ADD VALUE 'TICKET_REOPEN';

-- CreateIndex
CREATE INDEX "ModerationAction_videoId_createdAt_idx" ON "ModerationAction"("videoId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ModerationAction_commentId_createdAt_idx" ON "ModerationAction"("commentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ModerationAction_targetUserId_createdAt_idx" ON "ModerationAction"("targetUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ModerationAction_type_createdAt_idx" ON "ModerationAction"("type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Report_videoId_idx" ON "Report"("videoId");

-- CreateIndex
CREATE INDEX "Report_commentId_idx" ON "Report"("commentId");

-- CreateIndex
CREATE INDEX "Report_channelId_idx" ON "Report"("channelId");
