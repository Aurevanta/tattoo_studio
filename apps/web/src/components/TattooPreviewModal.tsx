'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GeneratedTattooArtifact } from '@/types/generation';
import { ImageDetail } from './ImageDetail';
import { messageForError } from '@/lib/client-errors';
import { zoneProposal } from '@/lib/zone-size';
import { nudgedSize, sizeNudge, type Nudge } from '@/lib/size-step';
import { stencilNotes } from '@/lib/stencil-review';
import { needsA4Pieces } from '@/lib/print-pieces';
import { IMAGE_FAILURE_TEXT, imageFailure, probe, type ImageFailure } from '@/lib/image-failure';
import { Confirm } from './Confirm';
import { ShareWithTattooer } from './ShareWithTattooer';
import { LimbViewer3D } from './LimbViewer3D';
import { BodyViewer3D } from './BodyViewer3D';
import { BODY_ZONE_NOUN, type BodySide } from '@/lib/body-zones';
import { defaultBody, type BodyType } from '@/lib/body-type';
import type { MockupPose } from '@/lib/mockup-pose';
import { workerFrame } from '@/lib/mockup-editor';
import { LIMBS, limbOf, type LimbSide, type LimbZone } from '@/lib/limb-wrap';
import { MockupEditor } from './MockupEditor';
import type { EditorPlacement } from '@/lib/mockup-editor';
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
  limbView,
  bodyView,
}: {
  artifact: GeneratedTattooArtifact;
  /** The version being shown, so a photo taken with the camera can join it (TASK-0050). */
  jobId?: string;
  onClose: () => void;
  onEdit?: (
    instruction: string,
    coverage?: 'larger' | 'smaller' | 'full',
    referenceIds?: string[],
    /** TASK-0107 (ADR-0036): a placement chosen in the live editor. */
    placement?: EditorPlacement,
  ) => void;
  /** Uploads a photo for the change request; resolves to its asset ID (TASK-0036). */
  onAttach?: (file: File) => Promise<string>;
  editingDisabled?: boolean;
  consentControls?: ReactNode;
  /** The reference span of this design's zone, to show what «Ocupar toda la zona» would print. */
  zoneSpan?: { widthMm: number; heightMm: number } | undefined;
  /** What is left today (TASK-0095): a change is a new design. */
  quotaNote?: string | null;
  /** TASK-0102, TASK-0103 (ADR-0033): a lower-leg or forearm design turns round in 3D. */
  limbView?: { zone: LimbZone; side: LimbSide; wraps: boolean; body?: BodyType } | undefined;
  /** TASK-0109 (ADR-0037): every other zone turns round on a reference body. */
  bodyView?: { zone: string; side: BodySide; body?: BodyType } | undefined;
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
  // TASK-0123 (ADR-0043): «más grande» / «más pequeño» written alone is a print change too, shown
  // and confirmed like «Ocupar toda la zona» and the editors' saves.
  const [confirmNudge, setConfirmNudge] = useState<Nudge | null>(null);
  const [nudgeRefusal, setNudgeRefusal] = useState('');
  const [overlay, setOverlay] = useState(false);
  // TASK-0118: the 3D view opens with the result; the client can still hide it.
  const [show3d, setShow3d] = useState(true);
  // TASK-0110 (ADR-0038): the body the design was made for, or the one its plate would show.
  const namedBody = limbView?.body ?? bodyView?.body;
  const [fallbackBody, setFallbackBody] = useState<BodyType>('feminine');
  useEffect(() => {
    if (!namedBody) void defaultBody(artifact.briefId).then(setFallbackBody);
  }, [namedBody, artifact.briefId]);
  const body = namedBody ?? fallbackBody;
  // TASK-0111: the 3D views start where the mockup shows the design, read from the mockup's own
  // picture. Only on a generated plate: an own photograph frames no reference zone.
  const [mockupFrame, setMockupFrame] = useState<[number, number] | null>(null);
  // TASK-0121: whether the skin's size has been read, or cannot be. The 3D views read where the
  // mockup has the design once, when they open; since TASK-0118 they open with the result, so
  // they wait for this rather than opening centred before the skin has arrived.
  const [frameSettled, setFrameSettled] = useState(false);
  const backgroundId = artifact.background?.assetId;
  useEffect(() => {
    if (!backgroundId) return setFrameSettled(true);
    // The transform is in the pixels of the skin as the worker composed on it: the background,
    // thumbnailed to 2048 (`workerFrame`), whatever size the finished mockup came back at.
    const image = new Image();
    image.onload = () => {
      setMockupFrame(workerFrame(image.naturalWidth, image.naturalHeight));
      setFrameSettled(true);
    };
    image.onerror = () => setFrameSettled(true);
    image.src = url(backgroundId);
  }, [backgroundId]);
  const pose: MockupPose | undefined =
    mockupFrame && !artifact.capture && artifact.backgroundKind === 'generated_anatomy'
      ? {
          transform: artifact.transform,
          frame: mockupFrame,
          // TASK-0120 (ADR-0042): the skin's millimetres, so the 3D view places the design as
          // the mockup does.
          skin: artifact.skinFrame,
          size: artifact.size,
        }
      : undefined;
  // TASK-0120: one placement, in the mockup's fractions, for the mockup editor and the 3D view
  // while both are open; moving either moves the other. Null is where the result has it.
  const [shared, setShared] = useState<EditorPlacement | null>(null);
  const wholeCanvas = artifact.transform.scaleCalibrated;
  // TASK-0119: the mockup editor opens with the result, as the 3D view does (TASK-0118).
  const [adjusting, setAdjusting] = useState(true);
  // TASK-0107 (ADR-0036): the design is adjusted over the skin it was composed on. Not for a
  // sleeve (already a full turn), a camera version (the photograph is the composite) or a result
  // stored without its skin.
  const adjustable = Boolean(
    onEdit && artifact.background && !artifact.capture && !limbView?.wraps && !skinGone,
  );
  // TASK-0112: what is adjusted in 3D is saved as the mockup's placement, as the 2D editor saves.
  const save3d = {
    shared: adjustable && pose ? shared : undefined,
    onShared: adjustable && pose ? setShared : undefined,
    baseStretch: artifact.transform.stretch,
    saveDisabled: editingDisabled,
    quotaNote,
    onSave:
      adjustable && onEdit
        ? (placement: EditorPlacement) =>
            onEdit(
              'Ajuste de tamaño, posición y giro en la vista 3D',
              undefined,
              undefined,
              placement,
            )
        : undefined,
  };
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
      {adjustable && (
        <div className="leg-view-toggle" hidden={Boolean(detail)}>
          <button
            type="button"
            aria-expanded={adjusting}
            onClick={() => setAdjusting((value) => !value)}
          >
            {adjusting ? 'Cerrar el ajuste' : 'Ajustar sobre la piel: tamaño, posición y giro'}
          </button>
          {adjusting && onEdit && (
            <MockupEditor
              artifact={artifact}
              disabled={editingDisabled}
              placement={pose ? shared : undefined}
              onPlacement={pose ? setShared : undefined}
              onSave={(placement) =>
                onEdit(
                  'Ajuste manual de tamaño, posición y giro sobre la piel',
                  undefined,
                  undefined,
                  placement,
                )
              }
            />
          )}
          {adjusting && quotaNote && <p className="quota-note">{quotaNote}</p>}
        </div>
      )}
      {bodyView && !limbView && (
        <div className="leg-view-toggle" hidden={Boolean(detail)}>
          <button type="button" aria-expanded={show3d} onClick={() => setShow3d((value) => !value)}>
            {show3d
              ? 'Ocultar la vista 3D'
              : `Ver en 3D sobre ${BODY_ZONE_NOUN[bodyView.zone] ?? 'el cuerpo'}`}
          </button>
          {show3d && !frameSettled && <p className="small-note">Cargando la vista 3D…</p>}
          {show3d && frameSettled && (
            <BodyViewer3D
              designUrl={url(artifact.master.assetId)}
              size={artifact.size}
              zone={bodyView.zone}
              side={bodyView.side}
              body={body}
              pose={pose}
              wholeCanvas={wholeCanvas}
              {...save3d}
            />
          )}
        </div>
      )}
      {limbView && (
        <div className="leg-view-toggle" hidden={Boolean(detail)}>
          <button type="button" aria-expanded={show3d} onClick={() => setShow3d((value) => !value)}>
            {show3d
              ? 'Ocultar la vista 3D'
              : `Ver en 3D alrededor de ${LIMBS[limbOf(limbView.zone)].noun}`}
          </button>
          {show3d && !frameSettled && <p className="small-note">Cargando la vista 3D…</p>}
          {show3d && frameSettled && (
            <LimbViewer3D
              designUrl={url(artifact.master.assetId)}
              size={artifact.size}
              zone={limbView.zone}
              side={limbView.side}
              wraps={limbView.wraps}
              body={body}
              pose={pose}
              wholeCanvas={wholeCanvas}
              {...save3d}
            />
          )}
        </div>
      )}
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
      {reviewed && artifact.panels && (
        <p className="small-note">
          {/* TASK-0105 */}
          Es una manga: la plantilla es su piel desenrollada, más estrecha donde el miembro es más
          fino. Para colocarla, el PDF de paneles la divide en 4 piezas de un cuarto de vuelta, cada
          una con su nombre, 1 cm de solape y marcas numeradas para alinearlas.
        </p>
      )}
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
          {/* TASK-0105 (ADR-0035): a sleeve's stencil in four panels to place round the limb. */}
          {artifact.panels && (
            <a href={url(artifact.panels.assetId)} download="inkcraft-manga-paneles.pdf">
              Manga en 4 paneles (PDF)
            </a>
          )}
          {artifact.panelsMirror && (
            <a
              href={url(artifact.panelsMirror.assetId)}
              download="inkcraft-manga-paneles-espejo.pdf"
            >
              Paneles en espejo
            </a>
          )}
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
      {/* TASK-0097 (ADR-0032): the design goes to the tattooer as a link, not as loose files. */}
      {jobId && <ShareWithTattooer jobId={jobId} />}
      {/* TASK-0051: changes come after the design, so a new version opens on its pictures. */}
      {onEdit && (
        <form
          className="proposal-edit proposal-edit-last"
          onSubmit={(event) => {
            event.preventDefault();
            if (instruction.trim().length < 3 || editingDisabled || attaching) return;
            const nudge = attached.length ? null : sizeNudge(instruction);
            setNudgeRefusal('');
            if (nudge && limbView?.wraps)
              return setNudgeRefusal(
                'Una manga ya da la vuelta completa: su tamaño es el de la extremidad.',
              );
            if (nudge && artifact.transform.scaleCalibrated)
              return setNudgeRefusal(
                'La foto está calibrada: el tamaño es tu medida. Cámbialo en las medidas físicas.',
              );
            if (nudge && !nudgedSize(artifact.size, nudge))
              return setNudgeRefusal(
                'El tamaño queda fuera de lo que se puede tatuar (de 5 a 600 mm).',
              );
            if (nudge) return setConfirmNudge(nudge);
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
            onChange={(event) => {
              setInstruction(event.target.value);
              setNudgeRefusal('');
            }}
            placeholder="Por ejemplo: haz el escudo más pequeño, o «quiero una virgen como en la foto adjunta»."
          />
          {nudgeRefusal && <p role="alert">{nudgeRefusal}</p>}
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
          {/* TASK-0104: a sleeve already goes all the way round; its size is the limb's. */}
          {!limbView?.wraps && (
            <div className="coverage-controls">
              <strong>Tamaño del tatuaje sobre la piel</strong>
              <p>
                {/* TASK-0107: the live editor replaced «Más pequeño» and «Más grande». */}
                {adjustable
                  ? 'Para agrandarlo, ensancharlo, alargarlo, moverlo o girarlo, usa el ajuste sobre la piel, arriba. '
                  : ''}
                {/* TASK-0123 (ADR-0043): written alone, they are confirmed as a print change. */}
                También puedes escribir solo «más grande» o «más pequeño»: te diremos las medidas
                nuevas antes de cambiarlas. «Ocupar toda la zona» ajusta las medidas de impresión a
                la zona del cuerpo, con anatomía de referencia adulta que debes confirmar con tu
                tatuador. No vuelve a dibujar el tatuaje.
              </p>
              <div>
                <button
                  type="button"
                  disabled={editingDisabled}
                  onClick={() => setConfirmZone(true)}
                >
                  Ocupar toda la zona
                </button>
              </div>
            </div>
          )}
          <button
            className="btn-primary"
            type="submit"
            disabled={editingDisabled || attaching || instruction.trim().length < 3}
          >
            Crear versión con estos cambios
          </button>
        </form>
      )}
      {confirmNudge && onEdit && (
        <Confirm
          title="¿Cambiar las medidas de impresión?"
          onCancel={() => setConfirmNudge(null)}
          actions={[
            { label: 'Cancelar', onClick: () => setConfirmNudge(null) },
            {
              label: 'Cambiar las medidas',
              primary: true,
              onClick: () => {
                const nudge = confirmNudge;
                setConfirmNudge(null);
                onEdit(instruction.trim(), nudge);
              },
            },
          ]}
        >
          <p>
            Ahora mide {artifact.size.widthMm} × {artifact.size.heightMm} mm. Pasará a{' '}
            {nudgedSize(artifact.size, confirmNudge)?.widthMm} ×{' '}
            {nudgedSize(artifact.size, confirmNudge)?.heightMm} mm: el mockup, la vista 3D, la
            plantilla y los PDF usarán esa medida. El dibujo no se vuelve a dibujar. La medida sobre
            la piel es orientativa: confírmala con tu tatuador.
          </p>
        </Confirm>
      )}
      {confirmZone && onEdit && (
        <Confirm
          title="¿Cambiar las medidas de impresión?"
          onCancel={() => setConfirmZone(false)}
          actions={[
            { label: 'Cancelar', onClick: () => setConfirmZone(false) },
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
