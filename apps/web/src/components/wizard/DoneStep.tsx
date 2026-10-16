'use client';

import type { ReactNode } from 'react';

import { Confirm } from '../Confirm';
import { DesignLibrary, type DesignActions } from '../DesignLibrary';
import { GenerationProgress } from '../GenerationProgress';
import type { InkStep } from '@/lib/ink-progress';
import type { StudioJobStatus } from '@/types/generation';

/** The account's designs and their versions (TASK-0046; grouped and managed since TASK-0116). */
export function VersionList({
  versions,
  onOpen,
  actions,
}: {
  versions: StudioJobStatus[];
  onOpen: (version: StudioJobStatus) => void;
  actions?: DesignActions | undefined;
}): ReactNode {
  return <DesignLibrary versions={versions} onOpen={onOpen} actions={actions} />;
}

/** While the studio works (TASK-0065): nothing to answer, only progress. */
export function WorkingStep({
  phase,
  stage,
  queuePosition,
}: {
  phase: 'preparing' | 'queued' | 'running';
  stage?: InkStep | undefined;
  queuePosition?: number | undefined;
}): ReactNode {
  return (
    <Confirm belowHeader title="Estamos creando tu diseño" onCancel={() => undefined} actions={[]}>
      <p>Puede tardar unos minutos. Cuando esté listo verás la vista en piel y la plantilla.</p>
      <GenerationProgress phase={phase} stage={stage} queuePosition={queuePosition} />
    </Confirm>
  );
}

/** After a design (TASK-0065): open it again, start another, or open an earlier one. */
export function DoneStep({
  versions,
  onView,
  onNew,
  onOpen,
  onAdvanced,
  actions,
}: {
  versions: StudioJobStatus[];
  onView: () => void;
  onNew: () => void;
  onOpen: (version: StudioJobStatus) => void;
  onAdvanced: () => void;
  actions?: DesignActions | undefined;
}): ReactNode {
  return (
    <Confirm
      belowHeader
      wide
      title="Tu diseño está listo"
      onCancel={() => undefined}
      actions={[
        { label: 'Modo avanzado', onClick: onAdvanced },
        { label: 'Nuevo diseño', onClick: onNew },
        { label: 'Ver mi diseño', primary: true, onClick: onView },
      ]}
    >
      <p>
        Ábrelo para verlo sobre la piel, descargar la plantilla, pedir cambios o probarlo con la
        cámara.
      </p>
      <VersionList versions={versions} onOpen={onOpen} actions={actions} />
    </Confirm>
  );
}
