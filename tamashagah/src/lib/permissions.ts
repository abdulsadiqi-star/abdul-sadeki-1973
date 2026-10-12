/**
 * Pure authorization rules shared by server code and UI (no I/O, easy to test).
 *
 * Roles form a hierarchy: USER < CREATOR < MODERATOR < ADMIN.
 * "Visitor" is simply `actor === null`.
 *
 * UI may use these helpers to *hide* controls, but the server MUST call them
 * (through guards or inside actions) before performing any privileged operation.
 */
import type { CommentsMode, ProcessingStatus, PublishStatus, UserRole, Visibility } from '@/generated/prisma/enums';

export type Actor = {
  id: string;
  role: UserRole;
  /** Id of the channel the actor owns, if any. */
  channelId?: string | null;
  emailVerified?: boolean;
} | null;

const RANK: Record<UserRole, number> = { USER: 0, CREATOR: 1, MODERATOR: 2, ADMIN: 3 };

export const hasRole = (actor: Actor, min: UserRole): boolean => !!actor && RANK[actor.role] >= RANK[min];
export const isModerator = (actor: Actor): boolean => hasRole(actor, 'MODERATOR');
export const isAdmin = (actor: Actor): boolean => hasRole(actor, 'ADMIN');

export type VideoAccessInfo = {
  channelId: string;
  visibility: Visibility;
  publishStatus: PublishStatus;
  processingStatus: ProcessingStatus;
  takedownAt: Date | null;
  channelSuspendedAt?: Date | null;
};

export const ownsChannel = (actor: Actor, channelId: string): boolean => !!actor && actor.channelId === channelId;

/** Owner or moderator may manage (edit/delete/see studio data of) a video. */
export const canManageVideo = (actor: Actor, video: Pick<VideoAccessInfo, 'channelId'>): boolean =>
  ownsChannel(actor, video.channelId) || isModerator(actor);

/**
 * Can `actor` open the watch page / receive the media of this video?
 *  - owner & moderators: always (any state)
 *  - everyone else: only READY + PUBLISHED, not taken down, channel not suspended,
 *    and visibility PUBLIC or UNLISTED (unlisted = reachable by link)
 */
export function canViewVideo(actor: Actor, video: VideoAccessInfo): boolean {
  if (canManageVideo(actor, video)) return true;
  if (video.takedownAt || video.channelSuspendedAt) return false;
  if (video.processingStatus !== 'READY' || video.publishStatus !== 'PUBLISHED') return false;
  return video.visibility === 'PUBLIC' || video.visibility === 'UNLISTED';
}

/** Appears in feeds, search, category pages and recommendations. */
export function isListedPublicly(video: VideoAccessInfo): boolean {
  return (
    video.visibility === 'PUBLIC' &&
    video.processingStatus === 'READY' &&
    video.publishStatus === 'PUBLISHED' &&
    !video.takedownAt &&
    !video.channelSuspendedAt
  );
}

/**
 * Only the channel owner moderates comments through the studio. Platform moderators act through the staff panel
 * (`features/moderation`), which applies the policy matrix (never on admins/self) and writes the audit row.
 */
export const canModerateComments = (actor: Actor, video: Pick<VideoAccessInfo, 'channelId'>): boolean =>
  ownsChannel(actor, video.channelId);

export const canAccessStudio = (actor: Actor): boolean => !!actor && !!actor.channelId;
export const canAccessAdmin = (actor: Actor): boolean => isModerator(actor);

/** Registered users with a verified e-mail may comment, upload and report. */
export const canParticipate = (actor: Actor): boolean => !!actor && actor.emailVerified === true;

export function canPostComment(
  actor: Actor,
  channel: { commentsMode: CommentsMode },
  video: { commentsEnabled: boolean },
): boolean {
  return canParticipate(actor) && channel.commentsMode !== 'DISABLED' && video.commentsEnabled;
}
