import { describe, expect, it } from 'vitest';

import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { config } from '../middleware';
import { PUBLIC_PAGES, SITE_DESCRIPTION, SITE_URL, siteMetadata as metadata } from './site';

/** TASK-0093 (audit 2026-10-08 SEO-02). */
describe('the public face of the studio', () => {
  it('describes the studio without naming a model or provider', () => {
    // The description once advertised "OpenAI GPT-6 Astra", which is not what runs the studio.
    expect(metadata.description).toBe(SITE_DESCRIPTION);
    expect(SITE_DESCRIPTION).not.toMatch(/openai|gpt|astra|claude|anthropic/i);
  });

  it('gives a shared link a preview image', () => {
    const images = metadata.openGraph?.images;
    expect(JSON.stringify(images)).toContain('/brand/og.png');
    expect(String(metadata.metadataBase)).toBe(`${SITE_URL}/`);
  });

  it('lists only pages a visitor can open without an account', () => {
    const gated = (path: string): boolean =>
      config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(PUBLIC_PAGES.map((path) => `${SITE_URL}${path}`));
    for (const path of PUBLIC_PAGES) expect(gated(path), path).toBe(false);
  });

  it('keeps crawlers out of the studio and the API', () => {
    const rules = robots().rules;
    expect(rules).toMatchObject({ disallow: ['/'], allow: [...PUBLIC_PAGES] });
  });
});
