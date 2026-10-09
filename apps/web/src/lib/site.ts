import type { Metadata } from 'next';

/**
 * The public face of the studio (TASK-0093, audit 2026-10-08 SEO-02): its address, and the pages
 * a search engine may index. Everything else is behind sign-in and is never listed.
 */
export const SITE_URL = 'https://inkcraft.aurevanta.es';

export const SITE_NAME = 'Inkcraft by Aurevanta Labs';

/** What the studio delivers, in the client's words. No provider or model names: they change. */
export const SITE_DESCRIPTION =
  'Cuenta tu idea y recibe el diseño de tu tatuaje, cómo queda en la piel y la plantilla a tamaño real para tu tatuador.';

export const PUBLIC_PAGES = ['/inicio', '/entrar', '/condiciones', '/privacidad'] as const;

/** The root layout's metadata: an accurate description and a preview when a link is shared. */
export const siteMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — Estudio de tatuaje`, template: '%s · Inkcraft' },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Estudio de tatuaje`,
    description: SITE_DESCRIPTION,
    images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: { card: 'summary_large_image' },
};
