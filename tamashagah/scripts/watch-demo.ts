/**
 * Local demo data for looking at the watch page and the studio comment tools (development only).
 *
 *   pnpm exec tsx --conditions=react-server --env-file-if-exists=.env scripts/watch-demo.ts
 *
 * Creates a few playable HLS videos on the demo channels and drives the REAL services (comments, replies, spam rules,
 * likes, follows, notifications) as the seeded demo users, so counters and notifications stay consistent.
 * Idempotent per title: videos that already exist are reused, comments are only added to a video without any.
 */
import { db } from '@/lib/db';
import { postComment } from '@/features/comments/service';
import { moderateComment } from '@/features/comments/moderation-service';
import { setFollow, setLike, type Viewer } from '@/features/engagement/service';
import { createHlsFixtureVideo } from './lib/hls-fixture';

async function viewerOf(email: string): Promise<Viewer & { channelId: string | null }> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { channel: { select: { id: true } } } });
  return { id: u.id, displayName: u.displayName, role: u.role, channelId: u.channel?.id ?? null, emailVerified: u.emailVerifiedAt !== null };
}

async function ensureVideo(handle: string, title: string, extra: { description?: string; tags?: string[]; category?: string } = {}) {
  const channel = await db.channel.findUniqueOrThrow({ where: { handle }, select: { id: true } });
  const existing = await db.video.findFirst({ where: { channelId: channel.id, title }, select: { id: true } });
  if (existing) return existing.id;
  const category = extra.category ? await db.category.findUnique({ where: { slug: extra.category }, select: { id: true } }) : null;
  const created = await createHlsFixtureVideo({ channelId: channel.id, title, description: extra.description, tags: extra.tags, categoryId: category?.id, heights: [360, 240], durationSeconds: 24 });
  return created.id;
}

async function main() {
  const sara = await viewerOf('sara@tamashagah.test');
  const arman = await viewerOf('arman@tamashagah.test');
  const nika = await viewerOf('nika@tamashagah.test');
  const viewer = await viewerOf('viewer@tamashagah.test');

  const main = await ensureVideo('sara-cooks', 'پلو با ته‌دیگ طلایی', {
    description: 'دستور پخت پلو با ته‌دیگ سیب‌زمینی؛ ساده و خوشمزه.\nلینک دستور کامل: https://example.com/recipe?id=12\nاگر خوشتان آمد حتماً دنبال کنید #آشپزی #پلو',
    tags: ['آشپزی', 'پلو', 'ته‌دیگ'],
    category: 'cooking',
  });
  await ensureVideo('sara-cooks', 'قورمه‌سبزی خانگی با طعم اصیل', { tags: ['آشپزی', 'قورمه‌سبزی'], category: 'cooking' });
  await ensureVideo('arman-tech', 'نقد و بررسی گوشی‌های میان‌رده', { tags: ['فناوری', 'گوشی'], category: 'technology' });
  await ensureVideo('nika-travel', 'سفر به شمال؛ از رامسر تا ماسوله', { tags: ['سفر', 'شمال'], category: 'travel' });
  await ensureVideo('sara-cooks', 'کباب تابه‌ای در ده دقیقه', { tags: ['آشپزی', 'کباب'], category: 'cooking' });
  console.log(`✔ videos ready (main: /watch/${main})`);

  if ((await db.comment.count({ where: { videoId: main } })) > 0) {
    console.log('✔ demo comments already exist');
    return;
  }

  const first = (await postComment(viewer, { videoId: main, body: 'خیلی عالی بود، ممنون از آموزش خوبتون. ته‌دیگش دقیقاً مثل مادربزرگم شد 😍' })).comment!;
  const second = (await postComment(nika, { videoId: main, body: 'می‌شه لطفاً مقدار دقیق زعفران رو هم بگید؟\nمن همیشه زیادش می‌کنم و تلخ می‌شه.' })).comment!;
  await postComment(arman, { videoId: main, body: 'یک سؤال: بجای سیب‌زمینی نان لواش هم جواب می‌ده؟ https://example.com/lavash' });
  const reply = (await postComment(sara, { videoId: main, body: 'یک قاشق چای‌خوری زعفران دم‌کرده برای چهار نفر کافیه.', parentId: second.id })).comment!;
  await postComment(nika, { videoId: main, body: 'خیلی ممنون، حتماً امتحان می‌کنم!', parentId: reply.id });
  await postComment(viewer, { videoId: main, body: 'ممنون از شما', parentId: first.id });
  await postComment(sara, { videoId: main, body: 'خوشحالم که خوشتون اومده، قربانتون 🌷', parentId: first.id });

  // One held comment (approval mode) and one spam comment, so the studio tabs have something to show.
  await db.channel.update({ where: { handle: 'sara-cooks' }, data: { commentsMode: 'APPROVAL_REQUIRED' } });
  await postComment(arman, { videoId: main, body: 'کانال شما واقعاً حرفه‌ای است، پیشنهاد همکاری دارم.' });
  await db.channel.update({ where: { handle: 'sara-cooks' }, data: { commentsMode: 'OPEN' } });
  await postComment(viewer, { videoId: main, body: 'کسب درآمد روزانه بدون سرمایه، برای اطلاعات پیام بدید' });
  void moderateComment;

  await setLike(viewer, main, true);
  await setLike(nika, main, true);
  await setLike(arman, main, true);
  await setFollow(viewer, sara.channelId!, true);
  await setFollow(nika, sara.channelId!, true);
  console.log('✔ demo comments, likes and follows created');
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
