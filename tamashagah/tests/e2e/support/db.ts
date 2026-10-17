/**
 * Playwright-side client of `db-runner.ts`: runs one fixture command in a child process (`node --import tsx`) and
 * returns its JSON result. Slow-ish (a process per call), so specs batch their setup into a single `seed`.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RUNNER = path.resolve('tests/e2e/support/db-runner.ts');
const RESULT_MARK = '__E2E_RESULT__';

export const E2E_EMAIL_PREFIX = 'insights-e2e-';

export function runFixture<T>(command: Record<string, unknown> & { command: string }): T {
  const stdout = execFileSync(process.execPath, ['--import', 'tsx', RUNNER], {
    input: JSON.stringify(command),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
    timeout: 120_000,
  });
  const line = stdout
    .split('\n')
    .reverse()
    .find((l) => l.startsWith(RESULT_MARK));
  if (!line) throw new Error(`fixture runner returned no result for "${command.command}":\n${stdout}`);
  return JSON.parse(line.slice(RESULT_MARK.length)) as T;
}

export type SeedResult = {
  userId: string;
  channelId: string;
  handle: string;
  videoIds: Record<string, string>;
  fanIds: Record<string, string>;
  commentIds: string[];
};

export type ApplicationRow = {
  id: string;
  status: string;
  contactEmail: string | null;
  acceptedTermsAt: string | null;
  statsSnapshot: { followers: number; totalViews: number; watchHours: number; videoCount: number; capturedAt: string } | null;
  submittedAt: string | null;
  decisionNote: string | null;
  reviewedAt: string | null;
};

export const cleanupFixtures = (userIds: string[]) => runFixture<{ deletedUsers: number }>({ command: 'cleanup', userIds });
