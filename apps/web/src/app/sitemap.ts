import type { MetadataRoute } from 'next';

import { PUBLIC_PAGES, SITE_URL } from '../lib/site';

/** TASK-0093: the pages a visitor can read without an account. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path) => ({ url: `${SITE_URL}${path}` }));
}
