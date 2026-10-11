/**
 * Create real, playable HLS test videos on a channel (see scripts/lib/hls-fixture.ts).
 *
 *   pnpm exec tsx --env-file-if-exists=.env scripts/watch-fixture.ts --channel=sara-cooks --title="پلو با ته‌دیگ"
 *
 * Options
 *   --channel=HANDLE        channel handle (default sara-cooks)
 *   --title=TEXT            video title (default: generated)
 *   --description=TEXT      description (multi-line with \n)
 *   --tags=a,b,c
 *   --count=N               create N videos (default 1; titles get a numeric suffix)
 *   --heights=360,240       rendition ladder
 *   --duration=24           seconds
 *   --visibility=PUBLIC|UNLISTED|PRIVATE
 *   --comments-mode=OPEN|APPROVAL_REQUIRED|DISABLED   also updates the channel setting
 *   --codec=vp9|h264        vp9 (default): VP9 + Opus in fMP4 — plays in Playwright's Chromium (it has no H.264 decoder);
 *                           h264: H.264 + AAC in MPEG-TS like the production pipeline (needs Chrome / Safari / Firefox)
 *   --no-subtitles
 *   --json                  print machine-readable output (used by the e2e specs)
 */
import { db } from '@/lib/db';
import { createHlsFixtureVideo } from './lib/hls-fixture';
import type { CommentsMode, Visibility } from '@/generated/prisma/enums';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => args.includes(`--${name}`);

async function main() {
  const handle = opt('channel') ?? 'sara-cooks';
  const channel = await db.channel.findUnique({ where: { handle }, select: { id: true } });
  if (!channel) throw new Error(`Channel "${handle}" not found (run pnpm db:seed or create it first).`);

  const commentsMode = opt('comments-mode') as CommentsMode | undefined;
  if (commentsMode) {
    if (!['OPEN', 'APPROVAL_REQUIRED', 'DISABLED'].includes(commentsMode)) throw new Error('Invalid --comments-mode');
    await db.channel.update({ where: { id: channel.id }, data: { commentsMode } });
  }

  const codec = opt('codec') ?? 'vp9';
  if (codec !== 'vp9' && codec !== 'h264') throw new Error('Invalid --codec (vp9 or h264)');

  const count = Math.max(1, Number(opt('count') ?? 1));
  const heights = (opt('heights') ?? '360,240').split(',').map(Number).filter(Boolean);
  const created = [];
  for (let i = 0; i < count; i++) {
    const baseTitle = opt('title');
    created.push(
      await createHlsFixtureVideo({
        channelId: channel.id,
        title: baseTitle ? (count > 1 ? `${baseTitle} ${i + 1}` : baseTitle) : undefined,
        description: opt('description')?.replace(/\\n/g, '\n'),
        tags: opt('tags')?.split(',').filter(Boolean),
        heights,
        durationSeconds: Number(opt('duration') ?? 24),
        visibility: (opt('visibility') as Visibility | undefined) ?? 'PUBLIC',
        subtitles: !flag('no-subtitles'),
        codec,
      }),
    );
  }

  if (flag('json')) console.log(JSON.stringify(created.length === 1 ? created[0] : created));
  else for (const v of created) console.log(`✔ ${v.id}  ${v.title}  (${v.heights.join('p, ')}p, ${v.durationSeconds}s)  → /watch/${v.id}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
