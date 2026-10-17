import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createUser } from '../helpers/factories';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');

/** Runs scripts/promote-user.ts exactly like `pnpm user:promote` does (separate process, same test database). */
async function promote(...args: string[]) {
  try {
    const { stdout, stderr } = await run(path.join(root, 'node_modules/.bin/tsx'), ['scripts/promote-user.ts', ...args], {
      cwd: root,
      env: { ...process.env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('scripts/promote-user.ts (first-administrator bootstrap)', () => {
  it('promotes a registered user, writes an audit row, and is idempotent', async () => {
    const user = await createUser({ email: 'boss@example.test' });

    const first = await promote('Boss@Example.test', 'admin');
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('USER → ADMIN');
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('ADMIN');

    const audit = await db.moderationAction.findMany({ where: { targetUserId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'USER_ROLE_CHANGE', actorId: null });
    expect(audit[0]!.meta).toMatchObject({ from: 'USER', to: 'ADMIN', via: 'cli' });

    const again = await promote('boss@example.test', 'admin');
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('Nothing to do');
    expect(await db.moderationAction.count({ where: { targetUserId: user.id } })).toBe(1);
  });

  it('rejects unknown e-mails, bad roles and suspended accounts without touching the database', async () => {
    const suspended = await createUser({ email: 'gone@example.test' });
    await db.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });

    expect((await promote('nobody@example.test', 'admin')).code).toBe(1);
    const badRole = await promote('gone@example.test', 'superuser');
    expect(badRole.code).toBe(2);
    expect(badRole.stderr).toContain('Usage');
    const blocked = await promote('gone@example.test', 'moderator');
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain('suspended');

    expect((await db.user.findUniqueOrThrow({ where: { id: suspended.id } })).role).toBe('USER');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('never removes the last active administrator unless --force is given', async () => {
    const only = await createUser({ email: 'only@example.test', role: 'ADMIN' });

    const refused = await promote('only@example.test', '--demote');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('last active administrator');
    expect((await db.user.findUniqueOrThrow({ where: { id: only.id } })).role).toBe('ADMIN');

    const forced = await promote('only@example.test', '--demote', '--force');
    expect(forced.code).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: only.id } })).role).toBe('USER');
  });

  it('demotes to CREATOR when the account owns a channel, otherwise to USER, and lists staff', async () => {
    await createUser({ email: 'root@example.test', role: 'ADMIN' });
    const owner = await createUser({ email: 'owner@example.test', role: 'MODERATOR', withChannel: true });
    const plain = await createUser({ email: 'plain@example.test', role: 'MODERATOR' });

    const listed = await promote('--list');
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('root@example.test');
    expect(listed.stdout).toContain('owner@example.test');

    expect((await promote('owner@example.test', '--demote')).code).toBe(0);
    expect((await promote('plain@example.test', '--demote')).code).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe('CREATOR');
    expect((await db.user.findUniqueOrThrow({ where: { id: plain.id } })).role).toBe('USER');
  });
});
