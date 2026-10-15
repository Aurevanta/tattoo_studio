'use client';
/**
 * Adjust the design on the skin, live (TASK-0107, ADR-0036).
 *
 * The result's master is laid over the skin it was composed on (`background`), in the browser:
 * drag to move, and sliders for size, width, height and angle. Nothing is sent while adjusting;
 * an own photo stays on the device (ADR-0019). Saving hands the placement to the caller, which
 * asks the worker for a new version whose stencil and PDFs follow the millimetres shown.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GeneratedTattooArtifact } from '@/types/generation';
import { trimmedArtwork, type ArtworkBox } from '@/lib/try-on';
import {
  changed,
  drawPlacement,
  factors,
  forSaving,
  initialPlacement,
  MAX_STRETCH,
  MIN_STRETCH,
  previewSkin,
  printSize,
  resizes,
  settle,
  stretchOf,
  withAxis,
  withScale,
  workerFrame,
  type EditorPlacement,
} from '@/lib/mockup-editor';
import { Confirm } from './Confirm';

type Loaded = {
  skin: HTMLCanvasElement;
  design: HTMLCanvasElement;
  frame: [number, number];
  box: ArtworkBox;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });

export function MockupEditor({
  artifact,
  disabled,
  onSave,
}: {
  artifact: GeneratedTattooArtifact;
  disabled: boolean;
  onSave: (placement: EditorPlacement) => void;
}): ReactNode {
  const background = artifact.background;
  const canvas = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [placement, setPlacement] = useState<EditorPlacement | null>(null);
  const [confirm, setConfirm] = useState(false);
  const drag = useRef<{ x: number; y: number; start: EditorPlacement } | null>(null);
  const calibrated = artifact.transform.scaleCalibrated;

  useEffect(() => {
    if (!background) return;
    let live = true;
    void Promise.all([
      loadImage(`/api/media?id=${background.assetId}`),
      loadImage(`/api/media?id=${artifact.master.assetId}`),
    ])
      .then(([skin, master]) => {
        if (!live) return;
        // A calibrated photo draws the whole canvas; everything else the visible artwork.
        const trimmed = trimmedArtwork(master);
        const design = calibrated ? wholeCanvas(master) : trimmed.canvas;
        setLoaded({
          skin: previewSkin(skin),
          design,
          frame: workerFrame(skin.naturalWidth, skin.naturalHeight),
          box: trimmed.box,
        });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [background, artifact.master.assetId, calibrated]);

  const start = useMemo(
    () => (loaded ? initialPlacement(artifact.transform, loaded.frame, loaded.box) : null),
    [loaded, artifact.transform],
  );
  const now = placement ?? start;

  const paint = useCallback(() => {
    if (!loaded || !now || !canvas.current) return;
    work.current ??= document.createElement('canvas');
    drawPlacement({
      skin: loaded.skin,
      design: loaded.design,
      canvas: canvas.current,
      work: work.current,
      placement: now,
      curvature: artifact.transform.curvature ?? 0,
      taper: artifact.transform.taper ?? 0,
      ...(artifact.transform.freshness !== undefined
        ? { freshness: artifact.transform.freshness }
        : {}),
      ...(artifact.transform.surface !== undefined ? { surface: artifact.transform.surface } : {}),
    });
  }, [loaded, now, artifact.transform]);

  useEffect(() => {
    const frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [paint]);

  if (!background) return null;
  if (failed)
    return (
      <p role="status" className="small-note">
        No se ha podido cargar la piel de este resultado para ajustarlo.
      </p>
    );
  if (!loaded || !start || !now) return <p role="status">Preparando el editor…</p>;

  const size = printSize(artifact.size, start, now);
  const stretch = stretchOf(artifact.transform, start, now);
  const deformed = Math.round((stretch - 1) * 100);
  const [sx, sy] = factors(start, now);
  const update = (next: EditorPlacement) => setPlacement(settle(next));
  const move = (dx: number, dy: number) =>
    update({ ...now, centreX: now.centreX + dx, centreY: now.centreY + dy });

  return (
    <div className="mockup-editor">
      <p className="small-note">
        Vista orientativa: el tamaño sobre la piel es aproximado. Arrastra el diseño para moverlo.
        Al guardar, la plantilla y los PDF pasan a las medidas que ves.
      </p>
      <canvas
        ref={canvas}
        className="mockup-editor-stage"
        tabIndex={0}
        role="img"
        aria-label={`Diseño sobre la piel, ${size.widthMm} × ${size.heightMm} mm, girado ${Math.round(now.angle)}°. Usa las flechas para moverlo.`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, start: now };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from) return;
          const rect = event.currentTarget.getBoundingClientRect();
          update({
            ...from.start,
            centreX: from.start.centreX + (event.clientX - from.x) / rect.width,
            centreY: from.start.centreY + (event.clientY - from.y) / rect.height,
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.05 : 0.01;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const delta = moves[event.key];
          if (!delta) return;
          event.preventDefault();
          move(...delta);
        }}
      />
      <div className="mockup-editor-controls">
        {!calibrated && (
          <>
            <label>
              <span>
                Tamaño <output>{Math.round(Math.sqrt(sx * sy) * 100)} %</output>
              </span>
              <input
                type="range"
                aria-label="Tamaño en porcentaje"
                min={30}
                max={250}
                step={1}
                value={Math.round(Math.sqrt(sx * sy) * 100)}
                onChange={(event) =>
                  update(
                    withScale(
                      Number(event.target.value) / 100 / Math.sqrt(sx * sy),
                      artifact.size,
                      start,
                      now,
                    ),
                  )
                }
              />
            </label>
            <label>
              <span>
                Ancho <output>{size.widthMm} mm</output>
              </span>
              <input
                type="range"
                aria-label="Ancho en milímetros"
                min={Math.round(artifact.size.widthMm * 0.3)}
                max={Math.round(artifact.size.widthMm * 2.5)}
                step={1}
                value={Math.round(size.widthMm)}
                onChange={(event) =>
                  update(
                    withAxis(
                      'width',
                      (Number(event.target.value) / artifact.size.widthMm) * start.width,
                      artifact.transform,
                      artifact.size,
                      start,
                      now,
                    ),
                  )
                }
              />
            </label>
            <label>
              <span>
                Alto <output>{size.heightMm} mm</output>
              </span>
              <input
                type="range"
                aria-label="Alto en milímetros"
                min={Math.round(artifact.size.heightMm * 0.3)}
                max={Math.round(artifact.size.heightMm * 2.5)}
                step={1}
                value={Math.round(size.heightMm)}
                onChange={(event) =>
                  update(
                    withAxis(
                      'height',
                      (Number(event.target.value) / artifact.size.heightMm) * start.height,
                      artifact.transform,
                      artifact.size,
                      start,
                      now,
                    ),
                  )
                }
              />
            </label>
          </>
        )}
        <label>
          <span>
            Giro <output>{Math.round(now.angle)}°</output>
          </span>
          <input
            type="range"
            aria-label="Giro en grados"
            min={-180}
            max={180}
            step={1}
            value={Math.round(now.angle)}
            onChange={(event) => update({ ...now, angle: Number(event.target.value) })}
          />
        </label>
      </div>
      <p className="mockup-editor-size" aria-live="polite">
        {calibrated
          ? `Foto calibrada: el tamaño es tu medida (${artifact.size.widthMm} × ${artifact.size.heightMm} mm). Puedes moverlo y girarlo.`
          : `≈ ${size.widthMm} × ${size.heightMm} mm`}
        {deformed !== 0 &&
          ` · proporciones ${deformed > 0 ? 'ensanchadas' : 'alargadas'} un ${Math.abs(deformed)} %`}
        {(stretch >= MAX_STRETCH - 0.005 || stretch <= MIN_STRETCH + 0.005) && ' (límite: 25 %)'}
      </p>
      {deformed !== 0 && (
        <p className="small-note" role="note">
          Estirar deforma el dibujo: círculos, letras y caras dejan de ser proporcionales. Tu
          tatuador debe revisarlo.
        </p>
      )}
      <p className="small-note">
        La vista previa no recorta la tinta que cae fuera de la piel; la versión guardada sí.
        {Math.round(now.angle) !== 0 &&
          ' La plantilla se imprime recta: el tatuador la coloca con este giro.'}
      </p>
      <div className="mockup-editor-actions">
        <button type="button" onClick={() => setPlacement(null)} disabled={!changed(start, now)}>
          Restablecer
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={disabled || !changed(start, now)}
          onClick={() => (resizes(start, now) ? setConfirm(true) : onSave(forSaving(now)))}
        >
          Guardar esta colocación
        </button>
      </div>
      {confirm && (
        <Confirm
          title="¿Cambiar las medidas de impresión?"
          onCancel={() => setConfirm(false)}
          actions={[
            { label: 'Cancelar', onClick: () => setConfirm(false) },
            {
              label: 'Guardar y cambiar las medidas',
              primary: true,
              onClick: () => {
                setConfirm(false);
                onSave(forSaving(now));
              },
            },
          ]}
        >
          <p>
            Ahora mide {artifact.size.widthMm} × {artifact.size.heightMm} mm. La nueva versión
            medirá {size.widthMm} × {size.heightMm} mm: la plantilla y los PDF se volverán a
            exportar a esa medida. El dibujo no se vuelve a dibujar
            {deformed !== 0 ? ', pero sus proporciones cambian' : ''}. La medida sobre la piel es
            orientativa: confírmala con tu tatuador.
          </p>
        </Confirm>
      )}
    </div>
  );
}

function wholeCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return canvas;
}
