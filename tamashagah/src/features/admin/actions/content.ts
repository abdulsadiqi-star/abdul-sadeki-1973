'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { parse } from '@/lib/validation';
import {
  blockCommenter,
  deleteComment,
  forceDeleteVideo,
  restoreChannel,
  restoreComment,
  restoreVideo,
  suspendChannel,
  takedownVideo,
  unblockCommenter,
  unverifyChannel,
  verifyChannel,
} from '@/features/moderation/content';
import type { CommentStatus } from '@/generated/prisma/enums';
import {
  blockCommenterSchema,
  deleteCommentSchema,
  deleteVideoSchema,
  restoreChannelSchema,
  restoreCommentSchema,
  restoreVideoSchema,
  suspendChannelSchema,
  takedownVideoSchema,
  unblockCommenterSchema,
  unverifyChannelSchema,
  verifyChannelSchema,
} from '../schemas';
import { requireStaff, revalidatePublicSite } from '../guard';

type Resolved = { resolvedReportIds: string[] };

// --- videos ----------------------------------------------------------------

export async function takedownVideoAction(input: unknown): Promise<ActionResult<Resolved>> {
  return runAction(async () => {
    const staff = await requireStaff('video.takedown');
    const data = parse(takedownVideoSchema, input);
    const result = await takedownVideo(staff, data);
    revalidatePublicSite();
    return result;
  });
}

export async function restoreVideoAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('video.restore');
    const data = parse(restoreVideoSchema, input);
    await restoreVideo(staff, data);
    revalidatePublicSite();
  });
}

/** Hard delete — administrators only, strictly rate limited. */
export async function deleteVideoAction(input: unknown): Promise<ActionResult<{ cleanupQueued: boolean }>> {
  return runAction(async () => {
    const staff = await requireStaff('video.delete', 'sensitive');
    const data = parse(deleteVideoSchema, input);
    const result = await forceDeleteVideo(staff, data);
    revalidatePublicSite();
    return result;
  });
}

// --- comments --------------------------------------------------------------

export async function deleteCommentAction(input: unknown): Promise<ActionResult<Resolved>> {
  return runAction(async () => {
    const staff = await requireStaff('comment.delete');
    const data = parse(deleteCommentSchema, input);
    const result = await deleteComment(staff, data);
    revalidatePublicSite();
    return result;
  });
}

export async function restoreCommentAction(input: unknown): Promise<ActionResult<{ restoredTo: CommentStatus }>> {
  return runAction(async () => {
    const staff = await requireStaff('comment.restore');
    const data = parse(restoreCommentSchema, input);
    const result = await restoreComment(staff, data);
    revalidatePublicSite();
    return result;
  });
}

export async function blockCommenterAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('commenter.block');
    await blockCommenter(staff, parse(blockCommenterSchema, input));
  });
}

export async function unblockCommenterAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('commenter.block');
    await unblockCommenter(staff, parse(unblockCommenterSchema, input));
  });
}

// --- channels --------------------------------------------------------------

export async function suspendChannelAction(input: unknown): Promise<ActionResult<Resolved>> {
  return runAction(async () => {
    const staff = await requireStaff('channel.suspend');
    const data = parse(suspendChannelSchema, input);
    const result = await suspendChannel(staff, data);
    revalidatePublicSite();
    return result;
  });
}

export async function restoreChannelAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('channel.restore');
    const data = parse(restoreChannelSchema, input);
    await restoreChannel(staff, data);
    revalidatePublicSite();
  });
}

export async function verifyChannelAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('channel.verify');
    const data = parse(verifyChannelSchema, input);
    await verifyChannel(staff, data);
    revalidatePublicSite();
  });
}

export async function unverifyChannelAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('channel.verify');
    const data = parse(unverifyChannelSchema, input);
    await unverifyChannel(staff, data);
    revalidatePublicSite();
  });
}
