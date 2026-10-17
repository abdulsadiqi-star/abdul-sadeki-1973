/**
 * Prisma client singleton (Prisma 7 + node-postgres driver adapter).
 *
 * Import `db` anywhere on the server (Next.js app, worker, scripts, tests).
 * The pool connects lazily, so importing this module never touches the network.
 *
 * Raw SQL tips (see docs/conventions.md):
 *  - identifiers are camelCase → quote them: "Video"."viewCount"
 *  - cast aggregates: count(*)::int, sum(x)::float8
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from './env';

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
  });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const db: PrismaClient = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = createClient());

export type Db = PrismaClient;
export type { Prisma } from '@/generated/prisma/client';
