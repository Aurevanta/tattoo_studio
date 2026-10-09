import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { validateAgainst, type SharedDesign } from '@tattoo/contracts';

import { SharedDesignView } from '@/components/SharedDesignView';
import { sharedWorker } from '@/lib/studio-server';

export const dynamic = 'force-dynamic';

/** A link is private to whoever holds it: never indexed, never sent on as a referrer. */
export const metadata: Metadata = {
  title: 'Diseño para tu tatuador',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

async function load(token: string): Promise<SharedDesign | null> {
  try {
    const response = await sharedWorker(token);
    const checked = validateAgainst<SharedDesign>('shared-design', await response.json());
    return checked.valid ? checked.value : null;
  } catch {
    return null;
  }
}

/** A design a client shared with their tattooer (TASK-0097, ADR-0032). */
export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<ReactNode> {
  const { token } = await params;
  const design = await load(token);
  if (!design) notFound();
  return (
    <SharedDesignView design={design} file={(asset) => `/api/shared/${token}/${asset.assetId}`} />
  );
}
