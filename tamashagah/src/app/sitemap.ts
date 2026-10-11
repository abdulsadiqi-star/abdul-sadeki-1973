import type { MetadataRoute } from 'next';
import { getSitemapEntries, getSitemapIds } from '@/features/discovery/sitemap';

// Rows change all the time and the build must not need a database.
export const dynamic = 'force-dynamic';

/** `/sitemap/<id>.xml` files (the index lives at `/sitemap.xml`, see `sitemap.xml/route.ts`). */
export async function generateSitemaps() {
  return (await getSitemapIds()).map((id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  return getSitemapEntries(Number(await props.id));
}
