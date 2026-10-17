import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { applyCommentStatus } from '@/features/comments/moderation-core';
import { createUser, createVideo } from '../helpers/factories';

async function seedThread() {
  const owner = await createUser({ withChannel: true });
  const author = await createUser();
  const video = await createVideo(owner.channel!.id);
  const root = await db.comment.create({ data: { videoId: video.id, authorId: author.id, body: 'دیدگاه اصلی', status: 'APPROVED' } });
  const reply = await db.comment.create({ data: { videoId: video.id, authorId: author.id, body: 'پاسخ', status: 'APPROVED', parentId: root.id, rootId: root.id } });
  // counters as the comment feature maintains them: 2 approved comments, 1 approved reply
  await db.video.update({ where: { id: video.id }, data: { commentCount: 2 } });
  await db.comment.update({ where: { id: root.id }, data: { replyCount: 1 } });
  return { owner, author, video, root, reply };
}

const counters = async (videoId: string, rootId: string) => ({
  video: (await db.video.findUniqueOrThrow({ where: { id: videoId } })).commentCount,
  replies: (await db.comment.findUniqueOrThrow({ where: { id: rootId } })).replyCount,
});

describe('applyCommentStatus', () => {
  it('keeps video and reply counters exact across every transition', async () => {
    const { owner, video, root, reply } = await seedThread();
    const actorId = owner.id;

    await applyCommentStatus(reply.id, 'SPAM', { actorId });
    expect(await counters(video.id, root.id)).toEqual({ video: 1, replies: 0 });

    await applyCommentStatus(reply.id, 'REJECTED', { actorId }); // non-approved → non-approved: no change
    expect(await counters(video.id, root.id)).toEqual({ video: 1, replies: 0 });

    await applyCommentStatus(reply.id, 'APPROVED', { actorId });
    expect(await counters(video.id, root.id)).toEqual({ video: 2, replies: 1 });

    await applyCommentStatus(root.id, 'DELETED', { actorId });
    expect(await counters(video.id, root.id)).toEqual({ video: 1, replies: 1 });
  });

  it('is idempotent and writes a ModerationAction only for real changes', async () => {
    const { owner, video, root } = await seedThread();
    expect(await applyCommentStatus(root.id, 'REJECTED', { actorId: owner.id, note: 'نامربوط' })).toMatchObject({ from: 'APPROVED', to: 'REJECTED' });
    expect(await applyCommentStatus(root.id, 'REJECTED', { actorId: owner.id })).toBeNull();

    const actions = await db.moderationAction.findMany({ where: { commentId: root.id } });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'COMMENT_REJECT', actorId: owner.id, videoId: video.id, reason: 'نامربوط' });
    const row = await db.comment.findUniqueOrThrow({ where: { id: root.id } });
    expect(row).toMatchObject({ status: 'REJECTED', moderatedById: owner.id, moderationNote: 'نامربوط' });
  });

  it('records the channel and the affected author for the audit log', async () => {
    const { owner, author, root } = await seedThread();
    await applyCommentStatus(root.id, 'SPAM', { actorId: owner.id });
    const action = await db.moderationAction.findFirstOrThrow({ where: { commentId: root.id } });
    expect(action).toMatchObject({ type: 'COMMENT_SPAM', channelId: owner.channel!.id, targetUserId: author.id });
  });

  it('fails for unknown comments', async () => {
    await expect(applyCommentStatus('nope', 'APPROVED', { actorId: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
