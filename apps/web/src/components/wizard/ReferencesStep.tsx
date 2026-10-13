'use client';

import { useRef, type ReactNode } from 'react';

import type { OrchestrationSession } from '@tattoo/consultation';

import { ofSpanish } from '@tattoo/consultation/master-prompt';

import { Confirm } from '../Confirm';
import { InkWorking } from '../InkWorking';
import type { InkTask } from '@/lib/ink-progress';

type Reference = OrchestrationSession['references'][number];

/** Step 3 (TASK-0065): the references to use; remove any, add your own, then confirm. */
export function ReferencesStep({
  references,
  essential,
  busy,
  working,
  error,
  onRemove,
  onAdd,
  onSearchAgain,
  onWaive,
  onBack,
  onContinue,
}: {
  references: Reference[];
  /** Essential references still missing (a named emblem, flag, landmark…). */
  essential: string[];
  busy: boolean;
  /** What the studio is doing while `busy`, for the tattooing hand (TASK-0069). */
  working?: InkTask | null;
  error?: string;
  onRemove: (source: string) => void;
  onAdd: (file: File) => void;
  onSearchAgain: () => void;
  /** Go on without the essential references, once the client has been warned (TASK-0067). */
  onWaive: () => void;
  onBack: () => void;
  onContinue: () => void;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Confirm
      belowHeader
      wide
      title="Tus referencias"
      onCancel={onBack}
      actions={
        essential.length
          ? // TASK-0067: never a dead end. Adding the image is what keeps the design faithful, so
            // it leads; going on without it stays possible, behind a warning.
            [
              { label: 'Atrás', onClick: onBack, disabled: busy },
              { label: 'Buscar otra vez', onClick: onSearchAgain, disabled: busy },
              { label: 'Continuar sin ella', onClick: onWaive, disabled: busy },
              {
                label: 'Añadir la imagen',
                primary: true,
                onClick: () => input.current?.click(),
                disabled: busy,
              },
            ]
          : [
              { label: 'Atrás', onClick: onBack, disabled: busy },
              { label: 'Añadir imagen', onClick: () => input.current?.click(), disabled: busy },
              {
                label: references.length ? 'Usar estas referencias' : 'Continuar sin referencias',
                primary: true,
                disabled: busy,
                onClick: onContinue,
              },
            ]
      }
    >
      <p className="eyebrow">Paso 3 de 4</p>
      <p className="wizard-lead">
        {references.length
          ? 'Estas son las imágenes que guiarán el diseño. Quita las que no encajen o añade la tuya.'
          : 'No hemos encontrado imágenes adecuadas. Puedes añadir la tuya o seguir sin referencias: el diseño partirá de tu descripción.'}
      </p>
      {essential.length > 0 && (
        <p role="status" className="notice-banner">
          Para que sea fiel necesitamos una imagen {ofSpanish(essential.join(', '))}. Si la tienes,
          añádela; si no, puedes buscar otra vez o continuar sin ella.
        </p>
      )}
      {references.length > 0 && (
        <div className="reference-grid wizard-references">
          {references.map((reference, index) => (
            <figure key={reference.source}>
              <img src={reference.source} alt={reference.label ?? `Referencia ${index + 1}`} />
              <figcaption>
                {reference.sourcePage ? (
                  <a href={reference.sourcePage} target="_blank" rel="noreferrer">
                    {reference.label}
                  </a>
                ) : (
                  reference.label
                )}
                <small>{reference.license || 'Aportada por ti'}</small>
              </figcaption>
              <button type="button" disabled={busy} onClick={() => onRemove(reference.source)}>
                Quitar
              </button>
            </figure>
          ))}
        </div>
      )}
      {working && <InkWorking task={working} />}
      {error && <p role="alert">{error}</p>}
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAdd(file);
          event.target.value = '';
        }}
      />
    </Confirm>
  );
}
