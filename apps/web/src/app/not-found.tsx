import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ErrorCard } from '@/components/ErrorCard';

export const metadata: Metadata = { title: 'Página no encontrada' };

/** TASK-0094 (audit 2026-10-08 UX-06): a wrong address says so, in Spanish, with a way back. */
export default function NotFound(): ReactNode {
  return (
    <ErrorCard
      title="Esta página no existe"
      note="Puede que el enlace esté mal escrito o que la página ya no esté disponible."
    >
      <a className="btn-primary" href="/">
        Volver al estudio
      </a>
    </ErrorCard>
  );
}
