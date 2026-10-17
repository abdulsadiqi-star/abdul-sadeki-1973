/**
 * Database fixtures for `tests/e2e/insights.spec.ts`.
 *
 * Playwright's loader cannot import the generated Prisma client (it uses `import.meta`), so the spec runs this file
 * with `node --import tsx` and talks to it through JSON: one command on stdin, one result line on stdout. It writes to
 * the database named by `.env` (the one the server under test uses) and only ever touches rows it created itself:
 * every e-mail starts with `insights-e2e-` and `cleanup` deletes by that prefix.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { buildChannelSearchName } from '@/lib/persian';
import { createVideo, type VideoState } from '../../helpers/factories';
import { addComment, addFollowEvent, addLike, addViews } from '../../helpers/insights-fixtures';
import type { CommentStatus, DataSource, DeviceType, FollowEventType } from '@/generated/prisma/enums';

const EMAIL_PREFIX = 'insights-e2e-';
const RESULT_MARK = '__E2E_RESULT__';

type SeedCommand = {
  command: 'seed';
  email: string;
  password: string;
  displayName: string;
  handle: string;
  channelName: string;
  /** Stored as the follower counter (what the dashboard and the eligibility check read). */
  followerCount?: number;
  /** Fan accounts (commenters, likers, followers), referenced by key below. */
  fans?: string[];
  videos?: { key: string; title: string; state?: VideoState }[];
  views?: { video: string; at: string; viewer: string; watch?: number; source?: DataSource; device?: DeviceType; referrer?: string | null }[];
  /** Bulk, anonymous REAL views: `count` events of `watch` seconds on `video`, spread over the last `spreadDays` days. */
  bulkViews?: { video: string; count: number; watch: number; spreadDays: number; source?: DataSource }[];
  likes?: { video: string; fan: string; at: string }[];
  comments?: { video: string; fan: string; at: string; status: CommentStatus; body: string }[];
  followEvents?: { type: FollowEventType; at: string; source?: DataSource }[];
  follows?: { fan: string; notify: boolean }[];
};

type Command =
  | SeedCommand
  | { command: 'plainUser'; email: string; password: string }
  | { command: 'decide'; channelId: string; status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; note: string | null }
  | { command: 'application'; channelId: string }
  | { command: 'comment'; id: string }
  | { command: 'user'; id: string }
  | { command: 'channel'; id: string }
  | { command: 'cleanup'; userIds: string[] };

async function seed(spec: SeedCommand) {
  const user = await db.user.create({
    data: {
      email: spec.email,
      displayName: spec.displayName,
      role: 'CREATOR',
      passwordHash: await hashPassword(spec.password),
      emailVerifiedAt: new Date(),
    },
  });
  const channel = await db.channel.create({
    data: {
      ownerId: user.id,
      handle: spec.handle,
      name: spec.channelName,
      searchName: buildChannelSearchName(spec.channelName, spec.handle),
      followerCount: spec.followerCount ?? 0,
    },
  });

  const fanIds: Record<string, string> = {};
  for (const key of spec.fans ?? []) {
    const fan = await db.user.create({
      data: { email: `${EMAIL_PREFIX}fan-${key}-${Date.now().toString(36)}@example.test`, displayName: `بیننده ${key}`, passwordHash: 'not-a-real-hash', emailVerifiedAt: new Date() },
    });
    fanIds[key] = fan.id;
  }

  const videoIds: Record<string, string> = {};
  for (const v of spec.videos ?? []) {
    const video = await createVideo(channel.id, { title: v.title, state: v.state ?? 'public' });
    videoIds[v.key] = video.id;
  }
  const videoId = (key: string) => {
    const id = videoIds[key];
    if (!id) throw new Error(`unknown video key ${key}`);
    return id;
  };
  const fanId = (key: string) => {
    const id = fanIds[key];
    if (!id) throw new Error(`unknown fan key ${key}`);
    return id;
  };

  await addViews((spec.views ?? []).map((v) => ({ channelId: channel.id, videoId: videoId(v.video), at: v.at, viewer: v.viewer, watch: v.watch, source: v.source, device: v.device, referrer: v.referrer })));

  for (const bulk of spec.bulkViews ?? []) {
    const now = Date.now();
    await addViews(
      Array.from({ length: bulk.count }, (_, i) => ({
        channelId: channel.id,
        videoId: videoId(bulk.video),
        // spread over the window, never in the future
        at: new Date(now - ((i % bulk.spreadDays) + 1) * 86_400_000 - (i % 7) * 60_000),
        viewer: `bulk${i}`,
        watch: bulk.watch,
        source: bulk.source,
      })),
    );
  }

  for (const like of spec.likes ?? []) await addLike(fanId(like.fan), videoId(like.video), like.at);
  const commentIds: string[] = [];
  for (const c of spec.comments ?? []) commentIds.push((await addComment(videoId(c.video), fanId(c.fan), c.at, c.status, c.body)).id);
  for (const e of spec.followEvents ?? []) await addFollowEvent(channel.id, e.type, e.at, e.source ?? 'REAL');
  for (const f of spec.follows ?? []) await db.follow.create({ data: { userId: fanId(f.fan), channelId: channel.id, notify: f.notify } });

  return { userId: user.id, channelId: channel.id, handle: spec.handle, videoIds, fanIds, commentIds };
}

async function run(input: Command): Promise<unknown> {
  switch (input.command) {
    case 'seed':
      return seed(input);

    case 'plainUser': {
      // A verified account without a channel (the settings page then offers the account tab only).
      const user = await db.user.create({
        data: { email: input.email, displayName: 'کاربر بدون کانال', role: 'USER', passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() },
      });
      return { userId: user.id };
    }

    case 'decide': {
      // What the admin panel does: a conditional update, so a decision can never overwrite a withdrawal.
      const reviewer = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
      const { count } = await db.monetizationApplication.updateMany({
        where: { channelId: input.channelId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        data: { status: input.status, decisionNote: input.note, reviewedAt: new Date(), reviewedById: reviewer?.id ?? null },
      });
      return { updated: count };
    }

    case 'application':
      return db.monetizationApplication.findMany({
        where: { channelId: input.channelId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, contactEmail: true, acceptedTermsAt: true, statsSnapshot: true, submittedAt: true, decisionNote: true, reviewedAt: true },
      });

    case 'comment':
      return db.comment.findUnique({ where: { id: input.id }, select: { id: true, status: true } });

    case 'user':
      return db.user.findUnique({ where: { id: input.id }, select: { id: true, avatarKey: true, displayName: true, digitStyle: true } });

    case 'channel':
      return db.channel.findUnique({ where: { id: input.id }, select: { name: true, description: true, links: true, searchName: true, avatarKey: true, bannerKey: true } });

    case 'cleanup': {
      // Channels, videos, events, sessions, comments, follows and applications all cascade from the user. Besides the
      // accounts of this run, leftovers of crashed runs (older than three hours) are swept; both only ever match the prefix.
      const stale = new Date(Date.now() - 3 * 3_600_000);
      const { count } = await db.user.deleteMany({
        where: { email: { startsWith: EMAIL_PREFIX }, OR: [{ id: { in: input.userIds } }, { createdAt: { lt: stale } }] },
      });
      return { deletedUsers: count };
    }
  }
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8')) as Command;
  const result = await run(input);
  process.stdout.write(`\n${RESULT_MARK}${JSON.stringify(result ?? null)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
