'use client';

import { useState, type ReactNode } from 'react';

import { Confirm } from '../Confirm';
import { InkWorking } from '../InkWorking';
import type { InkTask } from '@/lib/ink-progress';
import { VersionList } from './DoneStep';
import type { StudioJobStatus } from '@/types/generation';

const EXAMPLES = [
  'Un lobo aullando a la luna en el antebrazo',
  'Una rosa atravesada por una daga, tradicional americano',
  'Un búho geométrico en la espalda',
];

/** Step 1 (TASK-0065): the idea, in the client's own words. */
export function IdeaStep({
  initial,
  busy,
  working,
  error,
  onSubmit,
  onAdvanced,
  versions,
  onOpen,
}: {
  /** The idea already sent, when the client comes back to change it. */
  initial: string;
  busy: boolean;
  /** What the studio is doing while `busy`, for the tattooing hand (TASK-0069). */
  working?: InkTask | null;
  error?: string;
  onSubmit: (idea: string) => void;
  onAdvanced: () => void;
  /** Earlier designs of the account, to open instead of starting one (TASK-0046). */
  versions: StudioJobStatus[];
  onOpen: (version: StudioJobStatus) => void;
}): ReactNode {
  const [idea, setIdea] = useState(initial);
  const ready = idea.trim().length > 0 && !busy;
  return (
    <Confirm
      belowHeader
      wide
      title="¿Qué quieres tatuarte?"
      onCancel={() => undefined}
      actions={[
        { label: 'Modo avanzado', onClick: onAdvanced, disabled: busy },
        {
          label: busy ? 'Preparando tu propuesta…' : 'Continuar',
          primary: true,
          disabled: !ready,
          onClick: () => onSubmit(idea.trim()),
        },
      ]}
    >
      <p className="eyebrow">Paso 1 de 4</p>
      <p className="wizard-lead">
        Cuéntalo con tus palabras: qué quieres, y si ya lo sabes, el estilo, la zona o el color. Lo
        que falte te lo preguntamos después.
      </p>
      <textarea
        className="wizard-idea"
        aria-label="Tu idea"
        value={idea}
        maxLength={2000}
        disabled={busy}
        onChange={(event) => setIdea(event.target.value)}
        placeholder="Un león de línea fina en el antebrazo izquierdo, en negro…"
      />
      {/* TASK-0069: while the idea is studied, the hand takes the place of the examples. */}
      {working ? (
        <InkWorking task={working} />
      ) : (
        <div className="wizard-chips" aria-label="Ejemplos">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => setIdea(example)}
            >
              {example}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!working && <VersionList versions={versions} onOpen={onOpen} />}
    </Confirm>
  );
}
