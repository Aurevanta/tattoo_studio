import type { ReactNode } from 'react';

import { LegalPage } from '@/components/LegalPage';
import { IMAGES_VERSION, PRIVACY } from '@/content/legal';

export const metadata = { title: 'Privacidad' };

export default function PrivacyPage(): ReactNode {
  return <LegalPage title="Política de privacidad" version={IMAGES_VERSION} sections={PRIVACY} />;
}
