'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GeneratedTattooArtifact } from '@/types/generation';
import { ImageDetail } from './ImageDetail';
import { messageForError } from '@/lib/client-errors';
import { zoneProposal } from '@/lib/zone-size';
import { stencilNotes } from '@/lib/stencil-review';
import { needsA4Pieces } from '@/lib/print-pieces';
import { IMAGE_FAILURE_TEXT, imageFailure, probe, type ImageFailure } from '@/lib/image-failure';
import { Confirm } from './Confirm';
export function TattooPreviewModal({
  artifact,
  jobId,
  onClose,
  onEdit,
  onAttach,
  editingDisabled = false,
  consentControls,
  zoneSpan,
  quotaNote,
}: {
  artifact: GeneratedTattooArtifact;
  /** The version being shown, so a photo taken with the camera can join it (TASK-0050). */
  jobId?: string;
  onClose: () => void;
  onEdit?: (
    instruction: string,
    coverage?: 'larger' | 'smaller' | 'full',
    referenceIds?: string[],
  ) => void;
  /** Uploads a photo for the change request; resolves to its asset ID (TASK-0036). */
  onAttach?: (file: File) => Promise<string>;
  editingDisabled?: boolean;
  consentControls?: ReactNode;
  /** The reference span of this design's zone, to show what «Ocupar toda la zona» would print. */
  zoneSpan?: { widthMm: number; heightMm: number } | undefined;
  /** What is left today (TASK-0095): a change is a new design. */
  quotaNote?: string | null;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reviewed, setReviewed] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [attached, setAttached] = useState<{ assetId: string; name: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<'mockup' | 'stencil' | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  function closeDetail() {
    setDetail(null);
    requestAnimationFrame(() => detailTrigger.current?.focus());
  }
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const url = (id: string) => `/api/media?id=${id}`;
  // TASK-0050: a version kept from the camera shows the photograph; the design is the parent's.
  const skin = artifact.capture?.photo ?? artifact.mockup;
  // TASK-0047: a design lasts, a photo of the body expires after 24 hours. When the skin view was
  // composed on that photo it goes with it, and the design is shown without it, saying why.
  // TASK-0077 (audit UX-05): why the skin view did not load, asked of its own address.
  const [skinFailure, setSkinFailure] = useState<ImageFailure | null>(null);
  const [skinAttempt, setSkinAttempt] = useState(0);
  const skinGone = skinFailure !== null;
  const fromOwnPhoto = Boolean(artifact.capture) || artifact.backgroundKind === 'own_photo';
  // TASK-0073 (audit UX-01): a new print size is shown and confirmed before it is applied.
  const [confirmZone, setConfirmZone] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const stencil = stencilNotes(artifact.stencilReview);
  const proposal = zoneProposal(artifact.size, zoneSpan);
  return (
    <dialog
      ref={dialog}
      className="studio-dialog"
      onCancel={(event) => {
        if (detail) {
          event.preventDefault();
          closeDetail();
        } else onClose();
      }}
      aria-labelledby="preview-title"
    >
      <header className="result-header">
        <div>
          <p className="eyebrow">DISEÑO MAESTRO · REVISIÓN {artifact.briefRevision}</p>
          <h2 id="preview-title">Revisa tu diseño</h2>
        </div>
        <button onClick={onClose} aria-label="Cerrar vista previa">
          Cerrar ✕
        </button>
      </header>
      {artifact.edit && (
        <p>
          Cambio solicitado: {artifact.edit.instruction}
          {artifact.edit.referenceIds?.length
            ? ` · con ${artifact.edit.referenceIds.length} foto${artifact.edit.referenceIds.length > 1 ? 's' : ''} adjunta${artifact.edit.referenceIds.length > 1 ? 's' : ''}`
            : ''}
        </p>
      )}
      {detail && (
        <ImageDetail
          key={detail}
          src={url(detail === 'mockup' ? skin.assetId : artifact.stencil.assetId)}
          label={
            detail === 'mockup'
              ? artifact.capture
                ? 'Foto con la cámara'
                : 'Mockup sobre piel'
              : 'Plantilla a escala'
          }
          onClose={closeDetail}
        />
      )}
      <div className="result-grid" hidden={Boolean(detail)}>
        {skinGone ? (
          <figure className="skin-gone">
            <p role="status">{IMAGE_FAILURE_TEXT[skinFailure]}</p>
            {skinFailure === 'retry' && (
              <button
                type="button"
                onClick={() => {
                  setSkinFailure(null);
                  setSkinAttempt((n) => n + 1);
                }}
              >
                Reintentar
              </button>
            )}
            {skinFailure === 'session' && <a href="/entrar">Entrar de nuevo</a>}
          </figure>
        ) : (
          <figure>
            <button
              className="image-open"
              aria-label="Ampliar mockup"
              onClick={(event) => {
                detailTrigger.current = event.currentTarget;
                setDetail('mockup');
              }}
            >
              <img
                key={skinAttempt}
                src={url(skin.assetId)}
                onError={() =>
                  void probe(url(skin.assetId)).then((status) =>
                    setSkinFailure(imageFailure(status, fromOwnPhoto)),
                  )
                }
                alt={
                  artifact.capture
                    ? 'Tu foto con la cámara, con el tatuaje superpuesto'
                    : 'Diseño maestro colocado geométricamente sobre piel'
                }
              />
              <span>{artifact.capture ? 'Ampliar foto ↗' : 'Ampliar mockup ↗'}</span>
            </button>
            <figcaption>
              {artifact.capture ? (
                'Tu foto con la cámara · el tatuaje está superpuesto, no hecho'
              ) : (
                <>
                  {artifact.backgroundKind === 'own_photo'
                    ? 'Tu fotografía'
                    : 'Anatomía generada, no es tu fotografía'}{' '}
                  ·{' '}
                  {artifact.transform.scaleCalibrated
                    ? 'Escala según tu calibración'
                    : 'Tamaño sobre piel orientativo'}
                </>
              )}
            </figcaption>
          </figure>
        )}
        <figure>
          <button
            className="image-open"
            aria-label="Ampliar plantilla"
            onClick={(event) => {
              detailTrigger.current = event.currentTarget;
              setDetail('stencil');
            }}
          >
            {/* TASK-0086 (audit ARQ-03): the stencil over its design shows what was left out. */}
            <span className="stencil-stack">
              {overlay && (
                <img src={url(artifact.master.assetId)} alt="" className="stencil-under" />
              )}
              <img
                src={url(artifact.stencil.assetId)}
                alt="Stencil vectorial del mismo diseño maestro"
                className={overlay ? 'stencil-over' : undefined}
              />
            </span>
            <span>Ampliar plantilla ↗</span>
          </button>
          <figcaption>
            {stencil.preliminary ? 'Plantilla preliminar' : 'Plantilla'} · formato{' '}
            {artifact.size.widthMm} × {artifact.size.heightMm} mm
            {artifact.transform.sourceCropPx && ' · puede incluir márgenes blancos'}
            {stencil.notes.map((note) => (
              <small key={note} className="stencil-note">
                {note}
              </small>
            ))}
            <button
              type="button"
              className="link-button"
              aria-pressed={overlay}
              onClick={() => setOverlay((value) => !value)}
            >
              {overlay ? 'Ver solo la plantilla' : 'Superponer sobre el diseño'}
            </button>
          </figcaption>
        </figure>
      </div>
      {/* TASK-0084 (audit): the result first, then three short notices; the long one folds. */}
      <ul className="result-notices" aria-label="Lo que debes saber">
        <li>
          {artifact.capture
            ? 'Foto de tu cámara con el diseño superpuesto'
            : artifact.backgroundKind === 'own_photo'
              ? 'Sobre tu propia foto'
              : 'Piel generada, no es tu cuerpo'}
        </li>
        <li>
          {artifact.transform.scaleCalibrated
            ? 'Escala según tu calibración'
            : 'Tamaño sobre la piel orientativo'}
        </li>
        <li>Un tatuador debe revisar el diseño y la plantilla</li>
      </ul>
      <details className="result-details">
        <summary>Detalles del resultado</summary>
        <p>{artifact.notice}</p>
        <p>
          Ambos archivos proceden del mismo maestro. Esto acredita el origen compartido, no la
          exactitud cultural ni la idoneidad para tatuar.
        </p>
      </details>
      <details>
        <summary>Referencias y trazabilidad</summary>
        <p>{artifact.referenceAnalysis}</p>
        <p className="hash">Diseño: {artifact.designId}</p>
        <p>Colocación geométrica; sin regeneración de líneas después de colocar.</p>
      </details>
      {/* TASK-0042: the try-on runs on the client's own device; the design travels as its id. */}
      <p className="try-on-link">
        <a
          className="btn-primary"
          href={`/probar?design=${artifact.master.assetId}${jobId ? `&job=${jobId}` : ''}`}
        >
          Pruébalo con la cámara
        </a>
        <small>
          Se procesa en tu dispositivo. Solo se guarda una foto si tú la haces y decides guardarla.
        </small>
      </p>
      <label className="check-row">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        He revisado los símbolos. El tatuador debe validar el trazo y la impresión antes de
        utilizarlo.
      </label>
      {reviewed && needsA4Pieces(artifact.size) && (
        <p className="small-note">
          {/* TASK-0088 (audit, «Impresión profesional»). */}
          Este diseño no cabe en un A4. La primera página del PDF tiene su tamaño real; si imprimes
          en A4, imprime desde la página 2: son piezas a escala 1:1 con 10 mm de solape y marcas
          para unirlas. Imprime siempre al 100 %, sin ajustar a la página.
        </p>
      )}
      {reviewed && (
        <div className="download-row">
          <a
            className="btn-primary"
            href={url(artifact.pdf.assetId)}
            download="inkcraft-stencil.pdf"
          >
            PDF a escala 1:1
          </a>
          <a href={url(artifact.pdfMirror.assetId)} download="inkcraft-stencil-espejo.pdf">
            PDF espejo
          </a>
          <a href={url(artifact.stencil.assetId)} download="inkcraft-stencil.svg">
            SVG
          </a>
          <a href={url(artifact.stencilMirror.assetId)} download="inkcraft-stencil-espejo.svg">
            SVG espejo
          </a>
          {skinGone ? null : artifact.capture ? (
            <a href={url(artifact.capture.photo.assetId)} download="inkcraft-foto.jpg">
              Foto
            </a>
          ) : (
            <a href={url(artifact.mockup.assetId)} download="inkcraft-mockup.png">
              Mockup
            </a>
          )}
        </div>
      )}
      <p>Imprime a tamaño real, sin “ajustar a página”, y mide la barra de 50 mm del PDF.</p>
      {/* TASK-0051: changes come after the design, so a new version opens on its pictures. */}
      {onEdit && (
        <form
          className="proposal-edit proposal-edit-last"
          onSubmit={(event) => {
            event.preventDefault();
            if (instruction.trim().length >= 3 && !editingDisabled && !attaching)
              onEdit(
                instruction.trim(),
                undefined,
                attached.length ? attached.map((a) => a.assetId) : undefined,
              );
          }}
        >
          <label htmlFor="proposal-change">¿Qué quieres cambiar de esta propuesta?</label>
          {quotaNote && <p className="quota-note">{quotaNote}</p>}
          <textarea
            id="proposal-change"
            value={instruction}
            maxLength={1000}
            minLength={3}
            required
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Por ejemplo: haz el escudo más pequeño, o «quiero una virgen como en la foto adjunta»."
          />
          {onAttach && (
            <div className="edit-attachments">
              <button
                type="button"
                disabled={editingDisabled || attaching || attached.length >= 3}
                onClick={() => fileInput.current?.click()}
              >
                {attaching ? 'Subiendo foto…' : 'Adjuntar foto de referencia'}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  setAttaching(true);
                  setAttachError('');
                  try {
                    const assetId = await onAttach(file);
                    setAttached((list) => [...list, { assetId, name: file.name }]);
                  } catch (error) {
                    setAttachError(messageForError(error));
                  } finally {
                    setAttaching(false);
                  }
                }}
              />
              <span>
                {attached.length >= 3
                  ? 'Máximo tres fotos por cambio.'
                  : 'Opcional, hasta tres. Di en el texto qué quieres tomar de ella.'}
              </span>
              {attachError && <p role="alert">{attachError}</p>}
              {attached.length > 0 && (
                <ul>
                  {attached.map((photo) => (
                    <li key={photo.assetId}>
                      <img src={url(photo.assetId)} alt={`Foto adjunta: ${photo.name}`} />
                      <button
                        type="button"
                        aria-label={`Quitar ${photo.name}`}
                        onClick={() =>
                          setAttached((list) => list.filter((a) => a.assetId !== photo.assetId))
                        }
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p>
            Crearemos otra versión a partir de este dibujo. La anterior se conservará. Revisa
            también los detalles que no hayas pedido cambiar.
          </p>
          {consentControls}
          <div className="coverage-controls">
            <strong>Tamaño del tatuaje sobre la piel</strong>
            <p>
              «Más pequeño» y «Más grande» cambian solo la vista: las medidas del PDF no cambian.
              «Ocupar toda la zona» sí ajusta las medidas de impresión a la zona del cuerpo, con
              anatomía de referencia adulta que debes confirmar con tu tatuador. Ninguna de las tres
              vuelve a dibujar el tatuaje.
            </p>
            <div>
              <button
                type="button"
                disabled={editingDisabled}
                onClick={() => onEdit('Reducir la cobertura del tatuaje sobre piel', 'smaller')}
              >
                Más pequeño
              </button>
              <button
                type="button"
                disabled={editingDisabled}
                onClick={() => onEdit('Ampliar la cobertura del tatuaje sobre piel', 'larger')}
              >
                Más grande
              </button>
              <button type="button" disabled={editingDisabled} onClick={() => setConfirmZone(true)}>
                Ocupar toda la zona
              </button>
            </div>
          </div>
          <button
            className="btn-primary"
            type="submit"
            disabled={editingDisabled || attaching || instruction.trim().length < 3}
          >
            Crear versión con estos cambios
          </button>
        </form>
      )}
      {confirmZone && onEdit && (
        <Confirm
          title="¿Cambiar las medidas de impresión?"
          onCancel={() => setConfirmZone(false)}
          actions={[
            { label: 'Cancelar', onClick: () => setConfirmZone(false) },
            {
              label: 'Solo ampliar la vista',
              onClick: () => {
                setConfirmZone(false);
                onEdit('Ampliar la cobertura del tatuaje sobre piel', 'larger');
              },
            },
            {
              label: 'Cambiar las medidas',
              primary: true,
              onClick: () => {
                setConfirmZone(false);
                onEdit('Que ocupe toda la zona', 'full');
              },
            },
          ]}
        >
          <p>
            Ahora mide {artifact.size.widthMm} × {artifact.size.heightMm} mm.{' '}
            {proposal
              ? `Para ocupar toda la zona pasará a unos ${proposal.widthMm} × ${proposal.heightMm} mm`
              : 'Para ocupar toda la zona cambiará a las medidas de la zona'}{' '}
            (anatomía adulta de referencia, no la tuya: confírmalas con tu tatuador). La plantilla y
            el PDF se volverán a exportar a esa medida; el dibujo no cambia.
          </p>
        </Confirm>
      )}
    </dialog>
  );
}
