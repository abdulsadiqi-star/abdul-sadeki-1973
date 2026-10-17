import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from '../helpers/test-env';

/**
 * Runs once before the integration project: applies all migrations to the test
 * database (created beforehand — see docs/testing.md).
 */
export default function setup() {
  const url = testDatabaseUrl();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
