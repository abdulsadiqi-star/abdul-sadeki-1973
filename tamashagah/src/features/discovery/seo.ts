import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

/**
 * Canonical URL plus Open Graph / Twitter card for a list-style page. A page that sets `openGraph` replaces the root
 * layout's one (Next.js merges metadata only at the top level), so site name and locale are repeated here.
 * `path` is site-relative (`/category/music?tab=hot`); `metadataBase` in the root layout makes it absolute.
 */
export function socialMetadata(opts: { title: string; description: string; path: string; image?: string | null }): Pick<Metadata, 'alternates' | 'openGraph' | 'twitter'> {
  const images = opts.image ? [{ url: opts.image }] : undefined;
  return {
    alternates: { canonical: opts.path },
    openGraph: {
      type: 'website',
      locale: 'fa_IR',
      siteName: siteConfig.name,
      title: `${opts.title} | ${siteConfig.name}`,
      description: opts.description,
      url: opts.path,
      images,
    },
    twitter: { card: images ? 'summary_large_image' : 'summary', title: opts.title, description: opts.description, images: opts.image ? [opts.image] : undefined },
  };
}
