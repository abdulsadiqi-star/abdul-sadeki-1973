/**
 * Development seed (idempotent).
 *
 *   pnpm db:seed
 *
 * Creates the category catalogue and a few demo accounts. Passwords are NEVER
 * hard-coded: set SEED_PASSWORD to choose one, otherwise a random password is
 * generated and written (once) to .data/seed-credentials.json (git-ignored).
 *
 * Demo videos / comments / analytics are produced by `pnpm seed:media`, which
 * runs the real transcoding pipeline on generated, license-free clips and tags
 * every synthetic metric with source=SEED.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../src/lib/db';
import { randomToken } from '../src/lib/ids';
import { hashPassword } from '../src/lib/auth/password';
import { buildChannelSearchName } from '../src/lib/persian';
import type { UserRole } from '../src/generated/prisma/enums';
import { categories } from './reference-data';

type DemoUser = {
  email: string;
  displayName: string;
  role: UserRole;
  channel?: { handle: string; name: string; description: string };
};

// ".test" is a reserved TLD: these addresses can never receive real mail.
const demoUsers: DemoUser[] = [
  { email: 'admin@tamashagah.test', displayName: 'مدیر سیستم', role: 'ADMIN' },
  { email: 'moderator@tamashagah.test', displayName: 'ناظر محتوا', role: 'MODERATOR' },
  {
    email: 'sara@tamashagah.test',
    displayName: 'سارا احمدی',
    role: 'CREATOR',
    channel: { handle: 'sara-cooks', name: 'آشپزی با سارا', description: 'دستور پخت‌های ساده و خوشمزه برای هر روز هفته.' },
  },
  {
    email: 'arman@tamashagah.test',
    displayName: 'آرمان کریمی',
    role: 'CREATOR',
    channel: { handle: 'arman-tech', name: 'آرمان تک', description: 'نقد و بررسی گجت‌ها و آموزش برنامه‌نویسی.' },
  },
  {
    email: 'nika@tamashagah.test',
    displayName: 'نیکا موسوی',
    role: 'CREATOR',
    channel: { handle: 'nika-travel', name: 'سفرنامه‌ی نیکا', description: 'از شهرهای ایران و جهان؛ مقصدهای دیدنی و تجربه‌های سفر.' },
  },
  { email: 'viewer@tamashagah.test', displayName: 'بیننده‌ی نمونه', role: 'USER' },
];

async function main() {
  for (const [index, c] of categories.entries()) {
    await db.category.upsert({
      where: { slug: c.slug },
      create: { ...c, sortOrder: index },
      update: { nameFa: c.nameFa, nameEn: c.nameEn, icon: c.icon, sortOrder: index },
    });
  }
  console.log(`✔ ${categories.length} categories`);

  const sharedPassword = process.env.SEED_PASSWORD?.trim();
  const generated = new Map<string, string>();

  for (const u of demoUsers) {
    const existing = await db.user.findUnique({ where: { email: u.email }, select: { id: true } });
    let userId = existing?.id;
    if (!userId) {
      const password = sharedPassword || `${randomToken(9)}-A1`;
      generated.set(u.email, password);
      const created = await db.user.create({
        data: {
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          emailVerifiedAt: new Date(),
          passwordHash: await hashPassword(password),
        },
        select: { id: true },
      });
      userId = created.id;
    }
    if (u.channel) {
      await db.channel.upsert({
        where: { handle: u.channel.handle },
        create: {
          ownerId: userId,
          handle: u.channel.handle,
          name: u.channel.name,
          description: u.channel.description,
          searchName: buildChannelSearchName(u.channel.name, u.channel.handle),
        },
        update: {},
      });
    }
  }
  console.log(`✔ ${demoUsers.length} demo accounts`);

  if (generated.size > 0 && !sharedPassword) {
    const file = path.resolve('.data/seed-credentials.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(Object.fromEntries(generated), null, 2), { mode: 0o600 });
    console.log(`  Generated passwords were written to ${path.relative(process.cwd(), file)} (git-ignored).`);
  } else if (sharedPassword) {
    console.log('  Demo accounts use the password from SEED_PASSWORD.');
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
