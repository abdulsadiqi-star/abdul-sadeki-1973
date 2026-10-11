import 'server-only';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { publicVideoWhere } from '@/features/videos/visibility';

/** URLs per sitemap file (the protocol allows 50 000; smaller files keep every query cheap). */
export const SITEMAP_CHUNK = 5000;

/** Pages that are not tied to a row. Private areas (library, studio, tickets, search results) are deliberately absent. */
const STATIC_PAGES = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/shorts', priority: 0.7, changeFrequency: 'daily' },
  { path: '/help', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/apps', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/verification', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/copyright', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
] as const;

const channelWhere = { suspendedAt: null, videos: { some: publicVideoWhere } };
const videoWhere = { ...publicVideoWhere, kind: 'VIDEO' as const };

const base = () => env.APP_URL.replace(/\/$/, '');

/**
 * File layout: id 0 = static pages + active categories, then the channel files, then the video files.
 * Counts are cached for an hour, so crawling never hits the database hard.
 */
export const getSitemapPlan = unstable_cache(
  async () => {
    const [channels, videos] = await Promise.all([db.channel.count({ where: channelWhere }), db.video.count({ where: videoWhere })]);
    return { channelFiles: Math.ceil(channels / SITEMAP_CHUNK), videoFiles: Math.ceil(videos / SITEMAP_CHUNK) };
  },
  ['discovery:sitemap-plan:v1'],
  { revalidate: 3600, tags: ['videos'] },
);

export async function getSitemapIds(): Promise<number[]> {
  const plan = await getSitemapPlan();
  return Array.from({ length: 1 + plan.channelFiles + plan.videoFiles }, (_, i) => i);
}

const channelEntries = unstable_cache(
  async (file: number) =>
    (
      await db.channel.findMany({
        where: channelWhere,
        orderBy: { id: 'asc' },
        skip: file * SITEMAP_CHUNK,
        take: SITEMAP_CHUNK,
        select: { handle: true, updatedAt: true },
      })
    ).map((c) => ({ handle: c.handle, updatedAt: c.updatedAt.toISOString() })),
  ['discovery:sitemap-channels:v1'],
  { revalidate: 3600, tags: ['videos'] },
);

const videoEntries = unstable_cache(
  async (file: number) =>
    (
      await db.video.findMany({
        where: videoWhere,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: file * SITEMAP_CHUNK,
        take: SITEMAP_CHUNK,
        select: { id: true, updatedAt: true },
      })
    ).map((v) => ({ id: v.id, updatedAt: v.updatedAt.toISOString() })),
  ['discovery:sitemap-videos:v1'],
  { revalidate: 3600, tags: ['videos'] },
);

const categoryEntries = unstable_cache(
  async () => db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { slug: true } }),
  ['discovery:sitemap-categories:v1'],
  { revalidate: 3600, tags: ['categories'] },
);

type SitemapEntry = { url: string; lastModified?: string; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; priority: number };

/** The URLs of one sitemap file (see `getSitemapPlan` for the layout). */
export async function getSitemapEntries(id: number): Promise<SitemapEntry[]> {
  const origin = base();
  const plan = await getSitemapPlan();
  if (id === 0) {
    const categories = await categoryEntries();
    return [
      ...STATIC_PAGES.map((p) => ({ url: p.path === '/' ? origin : `${origin}${p.path}`, changeFrequency: p.changeFrequency, priority: p.priority })),
      ...categories.map((c) => ({ url: `${origin}/category/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.6 })),
    ];
  }
  if (id >= 1 && id <= plan.channelFiles) {
    return (await channelEntries(id - 1)).map((c) => ({
      url: `${origin}/channel/${c.handle}`,
      lastModified: c.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));
  }
  const videoFile = id - 1 - plan.channelFiles;
  if (videoFile >= 0 && videoFile < plan.videoFiles) {
    return (await videoEntries(videoFile)).map((v) => ({
      url: `${origin}/watch/${v.id}`,
      lastModified: v.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  }
  return [];
}

const xmlEscape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** `<urlset>` XML of one file; `null` for an id outside the current layout (the route answers 404). */
export async function renderSitemapFile(id: number): Promise<string | null> {
  const ids = await getSitemapIds();
  if (!ids.includes(id)) return null;
  const entries = await getSitemapEntries(id);
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${xmlEscape(e.url)}</loc>${e.lastModified ? `<lastmod>${e.lastModified}</lastmod>` : ''}<changefreq>${e.changeFrequency}</changefreq><priority>${e.priority}</priority></url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** `<sitemapindex>` XML pointing at every file. */
export async function renderSitemapIndex(): Promise<string> {
  const origin = base();
  const ids = await getSitemapIds();
  const items = ids.map((id) => `  <sitemap><loc>${origin}/sitemap/${id}.xml</loc></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}
