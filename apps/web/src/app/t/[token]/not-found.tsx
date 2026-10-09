import type { ReactNode } from 'react';

import { ErrorCard } from '@/components/ErrorCard';

/** A link that has expired, was withdrawn or never existed (TASK-0097): said plainly, with a 404. */
export default function SharedNotFound(): ReactNode {
  return (
    <ErrorCard
      title="Este enlace ya no está disponible"
      note="Puede que haya caducado o que quien lo compartió lo haya retirado. Pídele un enlace nuevo."
    >
      <a className="btn-primary" href="/inicio">
        Qué es Inkcraft
      </a>
    </ErrorCard>
  );
}
