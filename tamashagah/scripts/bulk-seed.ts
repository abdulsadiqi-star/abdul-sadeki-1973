/**
 * Scale fixture for performance checks (NOT for production, NOT part of the demo seed).
 *
 *   pnpm seed:bulk                                   # defaults: 300 channels, 12k videos, 120k comments, 1.5M views
 *   pnpm seed:bulk -- --channels 1000 --videos 50000 --comments 500000 --views 5000000
 *   pnpm seed:bulk -- --clean                        # remove everything this script created
 *
 * Everything is generated with set-based SQL (generate_series), so millions of rows take seconds to minutes.
 * Synthetic rows are easy to recognise and remove: users are `bulk-<n>@bulk.test`, their ids start with `bulk`, and
 * every view event carries source = 'SEED' so real analytics are never mixed with it.
 * Refuses to run when NODE_ENV=production.
 */
import { db } from '../src/lib/db';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

async function clean() {
  const removed = await db.$executeRaw`DELETE FROM "User" WHERE email LIKE 'bulk-%@bulk.test'`;
  console.log(`✔ removed ${removed} synthetic users (channels, videos, comments, events and follows cascade)`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to generate synthetic data when NODE_ENV=production.');
  if (process.argv.includes('--clean')) return clean();

  const channels = arg('channels', 300);
  const videos = arg('videos', 12_000);
  const comments = arg('comments', 120_000);
  const views = arg('views', 1_500_000);
  const users = Math.max(arg('users', 5_000), channels);
  const t0 = Date.now();
  const lap = (label: string) => console.log(`  ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  await clean();
  console.log(`Generating ${users} users, ${channels} channels, ${videos} videos, ${comments} comments, ${views} view events …`);

  await db.$executeRaw`
    INSERT INTO "User" (id, email, "emailVerifiedAt", "passwordHash", "displayName", role, "createdAt", "updatedAt")
    SELECT 'bulku' || g, 'bulk-' || g || '@bulk.test', now(), 'not-a-real-hash', 'کاربر ' || g,
           CASE WHEN g <= ${channels} THEN 'CREATOR'::"UserRole" ELSE 'USER'::"UserRole" END,
           now() - (random() * interval '400 days'), now()
    FROM generate_series(1, ${users}) g`;
  lap('users');

  await db.$executeRaw`
    INSERT INTO "Channel" (id, "ownerId", handle, name, description, "followerCount", "searchName", "createdAt", "updatedAt")
    SELECT 'bulkc' || g, 'bulku' || g, 'bulk-channel-' || g, 'کانال شماره ' || g, 'کانال آزمایشی برای سنجش کارایی',
           (power(random(), 4) * 50000)::int, 'کانال شماره ' || g || ' bulk-channel-' || g,
           now() - (random() * interval '380 days'), now()
    FROM generate_series(1, ${channels}) g`;
  lap('channels');

  // Volatile functions (random()) must live in the SELECT list of the row source to be evaluated once per row.
  await db.$executeRaw`
    WITH vocab AS (
           SELECT ARRAY['آموزش','آشپزی','سفر','موسیقی','فوتبال','برنامه نویسی','طنز','مستند','بازی','کودک',
                        'خودرو','سلامت','هنر','خبر','فناوری','کوهنوردی','عکاسی','تاریخ','علم','سینما'] AS ws,
                  (SELECT array_agg(id ORDER BY "sortOrder") FROM "Category") AS cats),
         rows AS (
           SELECT g,
                  'bulkc' || (1 + floor(random() * ${channels})::int) AS channel_id,
                  1 + floor(random() * 20)::int AS w1, 1 + floor(random() * 20)::int AS w2,
                  random() AS r_kind, random() AS r_vis,
                  now() - (power(random(), 2) * interval '365 days') AS at,
                  30 + floor(random() * 3500) AS duration,
                  (power(random(), 5) * 2000000)::int AS views, (power(random(), 5) * 40000)::int AS likes
           FROM generate_series(1, ${videos}) g)
    INSERT INTO "Video" (id, "channelId", "categoryId", kind, title, description, tags, "processingStatus", "publishStatus", visibility,
                         "publishedAt", "durationSeconds", width, height, "viewCount", "likeCount", "searchTitle", "searchBody",
                         "createdAt", "updatedAt")
    SELECT substr(md5('bulkv' || r.g), 1, 11), r.channel_id,
           CASE WHEN v.cats IS NULL THEN NULL ELSE v.cats[1 + (r.g * 7919) % array_length(v.cats, 1)] END,
           CASE WHEN r.r_kind < 0.1 THEN 'SHORT'::"VideoKind" ELSE 'VIDEO'::"VideoKind" END,
           v.ws[r.w1] || ' ' || v.ws[r.w2] || ' شماره ' || r.g,
           'توضیحات ویدیوی آزمایشی شماره ' || r.g,
           ARRAY['آزمایشی', 'bulk'], 'READY', 'PUBLISHED',
           CASE WHEN r.r_vis < 0.9 THEN 'PUBLIC'::"Visibility" ELSE 'UNLISTED'::"Visibility" END,
           r.at, r.duration, 1280, 720, r.views, r.likes,
           v.ws[r.w1] || ' ' || v.ws[r.w2] || ' شماره ' || r.g, 'توضیحات ویدیوی آزمایشی شماره ' || r.g,
           r.at, now()
    FROM rows r CROSS JOIN vocab v`;
  lap('videos');

  await db.$executeRaw`
    INSERT INTO "Comment" (id, "videoId", "authorId", body, status, "createdAt", "updatedAt")
    SELECT 'bulkm' || g, vid, 'bulku' || uid, 'دیدگاه آزمایشی شماره ' || g,
           CASE WHEN r1 < 0.9 THEN 'APPROVED'::"CommentStatus" WHEN r2 < 0.5 THEN 'PENDING'::"CommentStatus" ELSE 'SPAM'::"CommentStatus" END,
           at, now()
    FROM (SELECT g, substr(md5('bulkv' || (1 + floor(random() * ${videos})::int)), 1, 11) AS vid,
                 1 + floor(random() * ${users})::int AS uid, random() AS r1, random() AS r2,
                 now() - (random() * interval '200 days') AS at
          FROM generate_series(1, ${comments}) g) s`;
  lap('comments');

  await db.$executeRaw`
    INSERT INTO "ViewEvent" (id, "videoId", "channelId", "viewerKey", "watchSeconds", device, source, "createdAt", "lastBeatAt")
    SELECT 'bulke' || s.g, v.id, v."channelId", md5('viewer' || (s.g % 200000)), s.secs,
           (ARRAY['DESKTOP','MOBILE','TABLET','OTHER'])[s.dev]::"DeviceType", 'SEED'::"DataSource", s.at, s.at
    FROM (SELECT g, substr(md5('bulkv' || (1 + floor(random() * ${videos})::int)), 1, 11) AS vid,
                 random() * 600 AS secs, 1 + floor(random() * 4)::int AS dev,
                 now() - (random() * interval '90 days') AS at
          FROM generate_series(1, ${views}) g) s
    JOIN "Video" v ON v.id = s.vid`;
  lap('view events');

  // Denormalized counters stay consistent with the rows that exist.
  await db.$executeRaw`
    UPDATE "Video" v SET "commentCount" = c.n
    FROM (SELECT "videoId", count(*)::int AS n FROM "Comment" WHERE status = 'APPROVED' AND id LIKE 'bulkm%' GROUP BY "videoId") c
    WHERE v.id = c."videoId"`;
  await db.$executeRaw`ANALYZE`;
  lap('counters + ANALYZE');

  const [row] = await db.$queryRaw<{ users: bigint; videos: bigint; comments: bigint; views: bigint }[]>`
    SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Video") AS videos,
           (SELECT count(*) FROM "Comment") AS comments, (SELECT count(*) FROM "ViewEvent") AS views`;
  console.log(`✔ database now holds ${row!.users} users, ${row!.videos} videos, ${row!.comments} comments, ${row!.views} view events`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
