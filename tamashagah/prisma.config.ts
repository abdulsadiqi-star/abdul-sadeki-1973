import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is provided through .env (see .env.example). It may be empty for
// commands that never connect (e.g. `prisma generate` during a Docker build).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
