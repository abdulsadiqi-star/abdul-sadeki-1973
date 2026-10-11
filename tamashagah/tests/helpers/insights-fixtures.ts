/**
 * Fixtures for the studio/analytics/monetization tests: rows with EXPLICIT timestamps, so tests can place events
 * exactly on Tehran-day boundaries and compute their expectations independently of the code under test.
 */
import { db } from '@/lib/db';
import { randomToken } from '@/lib/ids';
import type { CommentStatus, DataSource, DeviceType, FollowEventType } from '@/generated/prisma/enums';

export type ViewSpec = {
  channelId: string;
  videoId: string;
  at: string | Date;
  /** Same label ⇒ same viewer. */
  viewer?: string;
  watch?: number;
  device?: DeviceType;
  /** `undefined` ⇒ 'direct'; `null` ⇒ stored as NULL. */
  referrer?: string | null;
  source?: DataSource;
};

export async function addViews(specs: ViewSpec[]): Promise<void> {
  if (specs.length === 0) return;
  await db.viewEvent.createMany({
    data: specs.map((s) => ({
      channelId: s.channelId,
      videoId: s.videoId,
      viewerKey: `vk_${s.viewer ?? randomToken(6)}`,
      watchSeconds: s.watch ?? 0,
      device: s.device ?? 'DESKTOP',
      referrer: s.referrer === undefined ? 'direct' : s.referrer,
      source: s.source ?? 'REAL',
      createdAt: new Date(s.at),
      lastBeatAt: new Date(s.at),
    })),
  });
}

export async function addLike(userId: string, videoId: string, at: string | Date): Promise<void> {
  await db.videoLike.create({ data: { userId, videoId, createdAt: new Date(at) } });
}

export async function addComment(
  videoId: string,
  authorId: string,
  at: string | Date,
  status: CommentStatus = 'APPROVED',
  body = 'دیدگاه آزمایشی',
) {
  return db.comment.create({ data: { videoId, authorId, body, status, createdAt: new Date(at) } });
}

export async function addFollowEvent(
  channelId: string,
  type: FollowEventType,
  at: string | Date,
  source: DataSource = 'REAL',
): Promise<void> {
  await db.followEvent.create({ data: { channelId, type, source, createdAt: new Date(at) } });
}

/** Independent Tehran-day oracle: ICU's own time-zone database, no code from `lib/analytics`. */
const tehranFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
export const oracleTehranDay = (instant: Date): string => tehranFormat.format(instant);

/** Small deterministic PRNG so randomized tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
