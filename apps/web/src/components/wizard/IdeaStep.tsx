'use client';

import { useRef, useState, type ReactNode } from 'react';

import { Confirm } from '../Confirm';
import { InkWorking } from '../InkWorking';
import type { InkTask } from '@/lib/ink-progress';
import { VersionList } from './DoneStep';
import type { StudioJobStatus } from '@/types/generation';

/** TASK-0113 (owner's decision): as many images as a design's references. */
export const MAX_IDEA_IMAGES = 5;

const EXAMPLES = [
  'Un lobo aullando a la luna en el antebrazo',
  'Una rosa atravesada por una daga, tradicional americano',
  'Un búho geométrico en la espalda',
];

/**
 * Step 1 (TASK-0065): the idea, in the client's own words. TASK-0113 (ADR-0039): with images the
 * text can point at by number, «Imagen 1» to «Imagen 5» in the order attached.
 */
export function IdeaStep({
  initial,
  images = [],
  busy,
  working,
  error,
  onSubmit,
  onAttach,
  onRemoveImage,
  onAdvanced,
  versions,
  onOpen,
}: {
  /** The idea already sent, when the client comes back to change it. */
  initial: string;
  /** Asset ids of the images attached so far, already screened and stored, in order. */
  images?: string[];
  busy: boolean;
  /** What the studio is doing while `busy`, for the tattooing hand (TASK-0069). */
  working?: InkTask | null;
  error?: string;
  onSubmit: (idea: string) => void;
  /** Upload the chosen images; the page screens and stores each and adds its id to `images`. */
  onAttach?: (files: File[]) => void;
  onRemoveImage?: (assetId: string) => void;
  onAdvanced: () => void;
  /** Earlier designs of the account, to open instead of starting one (TASK-0046). */
  versions: StudioJobStatus[];
  onOpen: (version: StudioJobStatus) => void;
}): ReactNode {
  const [idea, setIdea] = useState(initial);
  const picker = useRef<HTMLInputElement>(null);
  const room = MAX_IDEA_IMAGES - images.length;
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
      {onAttach && (
        <div className="idea-images">
          {images.length > 0 && (
            <div className="reference-grid idea-images-grid" aria-label="Imágenes adjuntas">
              {images.map((assetId, index) => (
                <figure key={assetId}>
                  <img src={`/api/media?id=${assetId}`} alt={`Imagen ${index + 1}`} />
                  <figcaption>Imagen {index + 1}</figcaption>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Quitar la imagen ${index + 1}`}
                    onClick={() => onRemoveImage?.(assetId)}
                  >
                    Quitar
                  </button>
                </figure>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={busy || room <= 0}
            onClick={() => picker.current?.click()}
          >
            {room > 0
              ? `Adjuntar imágenes (${images.length}/${MAX_IDEA_IMAGES})`
              : `Máximo ${MAX_IDEA_IMAGES} imágenes`}
          </button>
          <p className="idea-images-hint">
            {images.length
              ? 'Puedes citarlas por su número, por ejemplo: «como la imagen 1 pero con las rosas de la imagen 2». Si quitas una, las siguientes cambian de número.'
              : 'Opcional: añade hasta cinco imágenes (JPG, PNG o WebP, 8 MB cada una) y cítalas en el texto por su número. No se aceptan fotos en las que aparezcan personas.'}
          </p>
          <input
            ref={picker}
            hidden
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []).slice(0, room);
              if (files.length) onAttach(files);
              event.target.value = '';
            }}
          />
        </div>
      )}
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
