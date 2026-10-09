import type { ReactNode } from 'react';

import { LegalPage } from '@/components/LegalPage';
import { TERMS, TERMS_VERSION } from '@/content/legal';

export const metadata = { title: 'Condiciones de uso' };

export default function TermsPage(): ReactNode {
  return <LegalPage title="Condiciones de uso" version={TERMS_VERSION} sections={TERMS} />;
}
