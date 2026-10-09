'use client';

import type { ReactNode } from 'react';

/** Print the page a tattooer is reading (TASK-0097). */
export function PrintButton(): ReactNode {
  return (
    <button type="button" className="btn-primary shared-print" onClick={() => window.print()}>
      Imprimir ficha
    </button>
  );
}
