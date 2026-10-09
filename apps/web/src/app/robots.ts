import type { MetadataRoute } from 'next';

import { PUBLIC_PAGES, SITE_URL } from '../lib/site';

/** TASK-0093: only the public pages are crawled; the studio and the API never are. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: [...PUBLIC_PAGES], disallow: ['/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
