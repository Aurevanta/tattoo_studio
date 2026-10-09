'use client';

import { type ReactNode, useEffect } from 'react';

import { ErrorCard } from '@/components/ErrorCard';
import { reportClientError } from '@/lib/client-error';

/**
 * A screen that failed to render (TASK-0094, audit 2026-10-08 UX-06 and ARQ-02). The client gets
 * a plain message and a way on; the studio hears about it in the Panel.
 */
export default function ScreenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  useEffect(() => reportClientError(error, 'render'), [error]);
  return (
    <ErrorCard
      title="Algo ha fallado en esta pantalla"
      note="Lo que ya tenías guardado sigue ahí. Prueba otra vez; si se repite, vuelve al estudio."
    >
      <button type="button" className="btn-primary" onClick={reset}>
        Reintentar
      </button>
      <a href="/">Volver al estudio</a>
    </ErrorCard>
  );
}
