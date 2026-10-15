import { describe, expect, it } from 'vitest';

import { NextRequest } from 'next/server';

import { config, middleware } from './middleware';

/**
 * Which paths the sign-in gate covers. Next evaluates the matcher as a regular expression over the
 * pathname, so the same expression is checked here directly.
 */
const gated = (path: string): boolean =>
  config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));

describe('the page gate (TASK-0045, TASK-0048)', () => {
  it('covers the studio pages', () => {
    for (const path of ['/', '/probar']) expect(gated(path), path).toBe(true);
  });

  it('lets the sign-in page and everything it shows load before anyone is signed in', () => {
    // The brand assets were once redirected to /entrar: the sign-in page showed a broken logo on
    // a plain background, because its own images required the sign-in it was offering.
    for (const path of [
      '/entrar',
      '/brand/background.webp',
      '/brand/aurevanta-labs.png',
      '/brand/aurevanta-mark.png',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
      '/sw.js',
    ])
      expect(gated(path), path).toBe(false);
  });

  it('lets the terms and the privacy policy be read before signing in (TASK-0064)', () => {
    for (const path of ['/condiciones', '/privacidad']) expect(gated(path), path).toBe(false);
  });

  it('leaves the API to answer 401 itself rather than redirecting it', () => {
    expect(gated('/api/generate')).toBe(false);
  });
});

describe('crawlers see only the public pages (TASK-0093)', () => {
  it('serves robots.txt and the sitemap without a session', () => {
    for (const path of ['/robots.txt', '/sitemap.xml', '/brand/og.png'])
      expect(gated(path), path).toBe(false);
  });
});

describe('the front door (TASK-0096)', () => {
  const visit = (path: string, cookie?: string) =>
    middleware(
      new NextRequest(`http://localhost:3000${path}`, {
        headers: cookie ? { cookie } : {},
      }),
    );

  it('shows a stranger the landing at the root, and asks to sign in anywhere deeper', () => {
    expect(visit('/').headers.get('location')).toBe('http://localhost:3000/inicio');
    expect(visit('/probar?job=1').headers.get('location')).toBe('http://localhost:3000/entrar');
  });

  it('lets a signed-in client straight into the studio', () => {
    expect(visit('/', 'inkcraft_at=token').headers.get('location')).toBeNull();
  });

  it('serves the landing and its example images without a session', () => {
    for (const path of ['/inicio', '/ejemplos/cronos-piel.webp', '/models/lower-leg.glb'])
      expect(gated(path), path).toBe(false);
  });
});

describe('a link for the tattooer (TASK-0097)', () => {
  it('opens without a session', () => {
    expect(gated('/t/Abc_def-0123456789abcdefghijklmn')).toBe(false);
  });
});
