import { describe, expect, it } from 'vitest';
import {
  canAccessAdmin,
  canAccessStudio,
  canManageVideo,
  canModerateComments,
  canParticipate,
  canPostComment,
  canViewVideo,
  hasRole,
  isListedPublicly,
  type Actor,
  type VideoAccessInfo,
} from '@/lib/permissions';

const owner: Actor = { id: 'u1', role: 'CREATOR', channelId: 'c1', emailVerified: true };
const stranger: Actor = { id: 'u2', role: 'USER', channelId: null, emailVerified: true };
const otherCreator: Actor = { id: 'u3', role: 'CREATOR', channelId: 'c2', emailVerified: true };
const moderator: Actor = { id: 'u4', role: 'MODERATOR', channelId: null, emailVerified: true };
const admin: Actor = { id: 'u5', role: 'ADMIN', channelId: null, emailVerified: true };
const unverified: Actor = { id: 'u6', role: 'USER', channelId: null, emailVerified: false };

const base: VideoAccessInfo = {
  channelId: 'c1',
  visibility: 'PUBLIC',
  publishStatus: 'PUBLISHED',
  processingStatus: 'READY',
  takedownAt: null,
  channelSuspendedAt: null,
};
const v = (patch: Partial<VideoAccessInfo>): VideoAccessInfo => ({ ...base, ...patch });

describe('roles', () => {
  it('orders roles', () => {
    expect(hasRole(admin, 'MODERATOR')).toBe(true);
    expect(hasRole(moderator, 'ADMIN')).toBe(false);
    expect(hasRole(owner, 'MODERATOR')).toBe(false);
    expect(hasRole(null, 'USER')).toBe(false);
  });
});

describe('canViewVideo', () => {
  it('lets everyone watch a public, ready, published video', () => {
    for (const actor of [null, stranger, owner, moderator]) expect(canViewVideo(actor, base)).toBe(true);
  });
  it('lets anyone with the link watch unlisted videos', () => {
    expect(canViewVideo(null, v({ visibility: 'UNLISTED' }))).toBe(true);
    expect(isListedPublicly(v({ visibility: 'UNLISTED' }))).toBe(false);
  });
  it('hides private videos from everybody except owner and moderators', () => {
    const video = v({ visibility: 'PRIVATE' });
    expect(canViewVideo(null, video)).toBe(false);
    expect(canViewVideo(stranger, video)).toBe(false);
    expect(canViewVideo(otherCreator, video)).toBe(false);
    expect(canViewVideo(owner, video)).toBe(true);
    expect(canViewVideo(moderator, video)).toBe(true);
    expect(canViewVideo(admin, video)).toBe(true);
  });
  it.each([
    ['draft', v({ publishStatus: 'DRAFT' })],
    ['scheduled', v({ publishStatus: 'SCHEDULED' })],
    ['processing', v({ processingStatus: 'PROCESSING' })],
    ['queued', v({ processingStatus: 'QUEUED' })],
    ['failed', v({ processingStatus: 'FAILED' })],
    ['awaiting upload', v({ processingStatus: 'AWAITING_UPLOAD' })],
    ['taken down', v({ takedownAt: new Date() })],
    ['channel suspended', v({ channelSuspendedAt: new Date() })],
  ])('hides %s videos from the public but not from the owner', (_name, video) => {
    expect(canViewVideo(null, video)).toBe(false);
    expect(canViewVideo(stranger, video)).toBe(false);
    expect(canViewVideo(owner, video)).toBe(true);
    expect(canViewVideo(moderator, video)).toBe(true);
    expect(isListedPublicly(video)).toBe(false);
  });
});

describe('management and moderation', () => {
  it('lets only the owner channel and moderators manage a video', () => {
    expect(canManageVideo(owner, base)).toBe(true);
    expect(canManageVideo(otherCreator, base)).toBe(false);
    expect(canManageVideo(stranger, base)).toBe(false);
    expect(canManageVideo(null, base)).toBe(false);
    expect(canManageVideo(moderator, base)).toBe(true);
  });
  it('lets only the owner channel and moderators moderate comments', () => {
    expect(canModerateComments(owner, base)).toBe(true);
    expect(canModerateComments(otherCreator, base)).toBe(false);
    expect(canModerateComments(moderator, base)).toBe(true);
  });
  it('requires a channel for the studio and a staff role for admin', () => {
    expect(canAccessStudio(owner)).toBe(true);
    expect(canAccessStudio(stranger)).toBe(false);
    expect(canAccessStudio(null)).toBe(false);
    expect(canAccessAdmin(moderator)).toBe(true);
    expect(canAccessAdmin(owner)).toBe(false);
  });
});

describe('participation', () => {
  it('requires a verified e-mail', () => {
    expect(canParticipate(stranger)).toBe(true);
    expect(canParticipate(unverified)).toBe(false);
    expect(canParticipate(null)).toBe(false);
  });
  it('respects channel and video comment settings', () => {
    expect(canPostComment(stranger, { commentsMode: 'OPEN' }, { commentsEnabled: true })).toBe(true);
    expect(canPostComment(stranger, { commentsMode: 'APPROVAL_REQUIRED' }, { commentsEnabled: true })).toBe(true);
    expect(canPostComment(stranger, { commentsMode: 'DISABLED' }, { commentsEnabled: true })).toBe(false);
    expect(canPostComment(stranger, { commentsMode: 'OPEN' }, { commentsEnabled: false })).toBe(false);
    expect(canPostComment(unverified, { commentsMode: 'OPEN' }, { commentsEnabled: true })).toBe(false);
  });
});
