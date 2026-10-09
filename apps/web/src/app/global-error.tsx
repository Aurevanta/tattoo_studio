'use client';

import { type ReactNode, useEffect } from 'react';

import { ErrorCard } from '@/components/ErrorCard';
import { reportClientError } from '@/lib/client-error';
import './globals.css';

/**
 * The root layout itself failed (TASK-0094). It replaces the whole document, so it brings its own
 * `<html>`, `<body>` and styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  useEffect(() => reportClientError(error, 'global'), [error]);
  return (
    <html lang="es">
      <body>
        <ErrorCard
          title="Algo ha fallado"
          note="Lo que ya tenías guardado sigue ahí. Prueba otra vez en unos segundos."
        >
          <button type="button" className="btn-primary" onClick={reset}>
            Reintentar
          </button>
          <a href="/">Volver al estudio</a>
        </ErrorCard>
      </body>
    </html>
  );
}
