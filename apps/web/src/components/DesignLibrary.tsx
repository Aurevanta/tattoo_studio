'use client';

import { useState, type ReactNode } from 'react';

import {
  groupDesigns,
  MAX_DESIGN_NAME,
  versionLabel,
  versionNumber,
  type DesignGroup,
} from '@/lib/designs';
import type { StudioJobStatus } from '@/types/generation';

/** What the library may ask the page to do with a design (TASK-0116, ADR-0041). */
export interface DesignActions {
  rename: (designId: string, name: string) => Promise<void>;
  remove: (target: { designId: string } | { jobId: string }) => Promise<void>;
  /** A new design made from this version, which then opens. */
  copy: (jobId: string) => Promise<void>;
}

type Pending =
  | { kind: 'design'; group: DesignGroup }
  | { kind: 'version'; group: DesignGroup; version: StudioJobStatus };

const plural = (count: number) => (count === 1 ? '1 versión' : `${count} versiones`);

/**
 * «Tus diseños» (TASK-0116): the account's designs, each with its versions. A design can be opened
 * at any version, renamed, deleted whole or a version at a time, and used to start a new design.
 * Deleting asks first, in place, and says what goes with it.
 */
export function DesignLibrary({
  versions,
  onOpen,
  actions,
}: {
  versions: StudioJobStatus[];
  onOpen: (version: StudioJobStatus) => void;
  actions?: DesignActions | undefined;
}): ReactNode {
  const groups = groupDesigns(versions);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  if (!groups.length) return null;

  async function act(step: () => Promise<void>) {
    setError('');
    setWorking(true);
    try {
      await step();
      setPending(null);
      setRenaming(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se ha podido hacer el cambio.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="wizard-versions design-library" aria-label="Tus diseños">
      <h3>Tus diseños</h3>
      {error && (
        <p role="alert" className="design-library-error">
          {error}
        </p>
      )}
      <ul className="design-list">
        {groups.map((group) => (
          <li key={group.id} className="design-card">
            <details>
              <summary>
                <span className="design-name">{group.name}</span>
                <span className="design-count">{plural(group.versions.length)}</span>
              </summary>
              <ul className="design-versions">
                {group.versions.map((version) => (
                  <li key={version.jobId}>
                    <button type="button" className="wizard-choice" onClick={() => onOpen(version)}>
                      {versionLabel(group, version)}
                    </button>
                    {actions && (
                      <span className="design-version-actions">
                        <button
                          type="button"
                          className="link-button"
                          disabled={working}
                          onClick={() => void act(() => actions.copy(version.jobId))}
                        >
                          Diseño nuevo a partir de esta
                        </button>
                        {group.versions.length > 1 && (
                          <button
                            type="button"
                            className="link-button"
                            disabled={working}
                            onClick={() => setPending({ kind: 'version', group, version })}
                          >
                            Eliminar versión
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {actions && renaming?.id === group.id && (
                <form
                  className="design-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(() => actions.rename(group.id, renaming.name));
                  }}
                >
                  <label>
                    Nombre del diseño
                    <input
                      autoFocus
                      value={renaming.name}
                      maxLength={MAX_DESIGN_NAME}
                      onChange={(event) => setRenaming({ id: group.id, name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        // The dialog around the list closes on Escape; here it only cancels this.
                        event.stopPropagation();
                        setRenaming(null);
                      }}
                    />
                  </label>
                  <p className="small-note">Déjalo vacío para volver a llamarlo como tu idea.</p>
                  <div className="design-actions">
                    <button type="button" disabled={working} onClick={() => setRenaming(null)}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn-primary" disabled={working}>
                      Guardar nombre
                    </button>
                  </div>
                </form>
              )}
              {actions && pending?.group.id === group.id && (
                <div
                  className="design-confirm"
                  role="alertdialog"
                  aria-labelledby={`delete-${group.id}`}
                  aria-describedby={`delete-${group.id}-what`}
                >
                  <p id={`delete-${group.id}`} className="design-confirm-title">
                    {pending.kind === 'design'
                      ? `¿Eliminar «${group.name}»${group.versions.length > 1 ? ` y sus ${plural(group.versions.length)}` : ''}?`
                      : `¿Eliminar la versión ${versionNumber(group, pending.version)} de «${group.name}»?`}
                  </p>
                  <p id={`delete-${group.id}-what`}>
                    {pending.kind === 'design'
                      ? 'Se borran el dibujo, las plantillas, las vistas en piel y las imágenes que solo usaba este diseño. Los enlaces que compartiste con tu tatuador dejan de abrirse.'
                      : 'Las demás versiones conservan todo lo que usan. Si compartiste esta versión con tu tatuador, ese enlace deja de abrirse.'}{' '}
                    No se puede deshacer, y lo creado hoy sigue contando para tu límite diario.
                  </p>
                  {/* The destructive answer is never where «Eliminar» was: a double click on it
                      lands on «Cancelar», which also has the focus. */}
                  <div className="design-actions">
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={working}
                      onClick={() =>
                        void act(() =>
                          actions.remove(
                            pending.kind === 'design'
                              ? { designId: group.id }
                              : { jobId: pending.version.jobId },
                          ),
                        )
                      }
                    >
                      {pending.kind === 'design' ? 'Eliminar diseño' : 'Eliminar versión'}
                    </button>
                    <button
                      type="button"
                      autoFocus
                      disabled={working}
                      onClick={() => setPending(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {actions && !pending && renaming?.id !== group.id && (
                <div className="design-actions">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => setRenaming({ id: group.id, name: group.name })}
                  >
                    Renombrar
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => setPending({ kind: 'design', group })}
                  >
                    Eliminar diseño
                  </button>
                </div>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
