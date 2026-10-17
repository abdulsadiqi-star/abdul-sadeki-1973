import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/** Crawlers may read everything public; private areas, APIs and the (unbounded) search result space are off limits. */
export default function robots(): MetadataRoute.Robots {
  const base = env.APP_URL.replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/studio', '/admin', '/library', '/help/tickets', '/search', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
