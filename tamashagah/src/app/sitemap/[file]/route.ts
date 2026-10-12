import { renderSitemapFile } from '@/features/discovery/sitemap';

export const dynamic = 'force-dynamic';

/** One sitemap file: `/sitemap/<id>.xml` (the index at `/sitemap.xml` lists them all). Unknown ids are 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = /^(\d{1,4})\.xml$/.exec(file);
  const xml = match ? await renderSitemapFile(Number(match[1])) : null;
  if (xml === null) return new Response('Not found', { status: 404 });
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
