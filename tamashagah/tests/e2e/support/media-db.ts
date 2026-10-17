/**
 * Database fixtures for the e2e specs, run as a separate process (`tsx`): Playwright's own loader cannot load the
 * generated Prisma client, and registration through the UI is rate limited to 5 per hour per address.
 *
 *   tsx tests/e2e/support/media-db.ts creator <label> <password>   → { email, handle, userId, channelId }
 *   tsx tests/e2e/support/media-db.ts upload-row <channelHandle>   → { id }   (an unfinished upload of that channel)
 *   tsx tests/e2e/support/media-db.ts cleanup <handle> [<handle>]  → removes those channels, their videos and users
 *   tsx tests/e2e/support/media-db.ts fixture <name> [<seconds>]   → { file }   (a generated clip, see scripts/make-test-video.mjs)
 *
 * The result is printed as one JSON line.
 */
import { hashPassword } from '../../../src/lib/auth/password';
import { db } from '../../../src/lib/db';
import { newVideoId } from '../../../src/lib/ids';
import os from 'node:os';
import path from 'node:path';
import { buildChannelSearchName } from '../../../src/lib/persian';
import type { FixtureName } from '../../../scripts/make-test-video.mjs';

async function creator(label: string, password: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${label}-${suffix}@example.test`;
  const handle = `${label}-${suffix}`;
  const user = await db.user.create({
    data: { email, displayName: 'سازنده‌ی آزمایشی', role: 'CREATOR', passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
  const channel = await db.channel.create({
    data: { ownerId: user.id, handle, name: 'کانال آزمایشی', searchName: buildChannelSearchName('کانال آزمایشی', handle) },
  });
  return { email, handle, userId: user.id, channelId: channel.id };
}

async function uploadRow(handle: string) {
  const channel = await db.channel.findUniqueOrThrow({ where: { handle }, select: { id: true } });
  const video = await db.video.create({
    data: {
      id: newVideoId(),
      channelId: channel.id,
      title: 'ویدیوی خصوصی من',
      visibility: 'PRIVATE',
      processingStatus: 'AWAITING_UPLOAD',
      sourceSizeBytes: 1000n,
    },
  });
  return { id: video.id };
}

async function cleanup(handles: string[]) {
  const channels = await db.channel.findMany({ where: { handle: { in: handles } }, select: { id: true, ownerId: true } });
  await db.video.deleteMany({ where: { channelId: { in: channels.map((c) => c.id) } } });
  await db.channel.deleteMany({ where: { id: { in: channels.map((c) => c.id) } } });
  await db.user.deleteMany({ where: { id: { in: channels.map((c) => c.ownerId) } } });
  return { removed: channels.length };
}

async function fixture(name: FixtureName, seconds?: number) {
  // Dynamic import: the generator is an ES module with top-level await, this helper runs as CommonJS.
  const { generateFixture } = await import('../../../scripts/make-test-video.mjs');
  const file = await generateFixture(name, { dir: path.join(os.tmpdir(), 'tg-e2e-fixtures'), ...(seconds ? { seconds } : {}) });
  return { file };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  if (command === 'creator') result = await creator(args[0]!, args[1]!);
  else if (command === 'upload-row') result = await uploadRow(args[0]!);
  else if (command === 'cleanup') result = await cleanup(args);
  else if (command === 'fixture') result = await fixture(args[0] as FixtureName, args[1] ? Number(args[1]) : undefined);
  else throw new Error(`unknown command ${command}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit();
  });
