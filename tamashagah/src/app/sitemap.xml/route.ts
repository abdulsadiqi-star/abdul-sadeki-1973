import { renderSitemapIndex } from '@/features/discovery/sitemap';

export const dynamic = 'force-dynamic';

/** Sitemap index: one entry per `/sitemap/<id>.xml` file (home, categories, channels and videos are split by size). */
export async function GET() {
  return new Response(await renderSitemapIndex(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
