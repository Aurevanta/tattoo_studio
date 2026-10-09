import type { ReactNode } from 'react';

import { Brand } from './Brand';

/**
 * A page that could not be shown (TASK-0094, audit 2026-10-08 UX-06): in Spanish, in the studio's
 * own card, with a way out. Next's defaults were a bare English «404: This page could not be found».
 */
export function ErrorCard({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}): ReactNode {
  return (
    <main className="sign-in">
      <section className="error-card" aria-labelledby="error-title">
        <Brand variant="card" />
        <h1 id="error-title">{title}</h1>
        <p className="sign-in-note">{note}</p>
        <div className="error-actions">{children}</div>
      </section>
    </main>
  );
}
