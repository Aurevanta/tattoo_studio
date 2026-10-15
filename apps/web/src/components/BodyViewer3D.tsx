'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  BODY_NOTICE,
  BODY_ZONE_NOUN,
  COMPLEX_NOTICE,
  defaultBodyPlacement,
  moveRange,
  type BodyPlacement,
  type BodySide,
  type BodyZoneModel,
} from '@/lib/body-zones';
import { SKIN_TONES, type SkinTone } from '@/lib/limb-wrap';
import type { BodyScene } from '@/lib/body-scene';
import { BODY_LABEL, BODY_TYPES, type BodyType } from '@/lib/body-type';
import { BODY_ZONE_SPANS } from '@tattoo/contracts';
import { mockupOffset, visibleSize, type MockupPose } from '@/lib/mockup-pose';

/**
 * The rotatable 3D preview of a design on a reference body, on any zone the limb viewer does not
 * cover (TASK-0109, ADR-0037). It draws the design's master at its real size in mm; it is
 * illustrative, and it is never the deliverable.
 */
export function BodyViewer3D({
  designUrl,
  size,
  zone,
  side: initialSide = 'left',
  body: initialBody,
  pose,
  wholeCanvas = false,
}: {
  designUrl: string;
  size: { widthMm: number; heightMm: number };
  zone: string;
  side?: BodySide;
  /** TASK-0110 (ADR-0038): the body it starts on; the client may switch. */
  body: BodyType;
  /** TASK-0111: where the 2D mockup shows the design, on a generated plate. */
  pose?: MockupPose | undefined;
  /** A calibrated photograph draws the whole canvas, margins included. */
  wholeCanvas?: boolean;
}): ReactNode {
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<BodyScene | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
  const [model, setModel] = useState<BodyZoneModel | null>(null);
  const [placement, setPlacement] = useState<BodyPlacement>(() => defaultBodyPlacement(size));
  const [side, setSide] = useState<BodySide>(initialSide);
  const [tone, setTone] = useState<SkinTone>('medium');
  const [body, setBody] = useState<BodyType>(initialBody);
  const [bodyHeight, setBodyHeight] = useState(0);
  // TASK-0111: the artwork's size as the mockup draws it, known once the master is read.
  const [drawn, setDrawn] = useState(size);
  const placed = useRef(false);
  const noun = BODY_ZONE_NOUN[zone] ?? 'la zona';

  useEffect(() => {
    let cancelled = false;
    let created: BodyScene | null = null;
    void (async () => {
      const { createBodyScene } = await import('@/lib/body-scene');
      const { webglAvailable } = await import('@/lib/limb-scene');
      if (cancelled) return;
      if (!webglAvailable()) return setState('unsupported');
      try {
        const { loadArtwork } = await import('@/lib/design-art');
        const art = await loadArtwork(designUrl, wholeCanvas);
        const artSize = visibleSize(size, art.box, wholeCanvas);
        // The first view starts where the mockup shows the design; a later one (another body)
        // keeps where the client put it.
        let start = placement;
        if (!placed.current) {
          start = defaultBodyPlacement(artSize);
          const span = BODY_ZONE_SPANS[zone];
          const offset = pose && span ? mockupOffset(pose, art.box, span.heightMm) : undefined;
          if (offset) start = { ...start, ...offset };
        }
        created = await createBodyScene(
          stage.current!,
          zone,
          art.canvas,
          { placement: start, side, tone },
          body,
        );
        if (cancelled) return created.dispose();
        const zoneModel = created.model.zones[zone];
        if (!placed.current && zoneModel) {
          const range = moveRange(zoneModel, artSize);
          start = {
            ...start,
            xMm: Math.max(-range.x, Math.min(range.x, start.xMm)),
            yMm: Math.max(-range.y, Math.min(range.y, start.yMm)),
          };
        }
        placed.current = true;
        created.setPlacement(start);
        created.view(false);
        setDrawn(artSize);
        setPlacement(start);
        if (cancelled) return created.dispose();
        scene.current = created;
        setModel(created.model.zones[zone] ?? null);
        setBodyHeight(created.model.heightMm);
        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
      created?.dispose();
      scene.current = null;
    };
    // The scene is built once per design and body; later changes go through its setters.
  }, [designUrl, zone, body]);

  function move(next: BodyPlacement) {
    setPlacement(next);
    scene.current?.setPlacement(next);
  }

  const range = model ? moveRange(model, drawn) : null;

  return (
    <section className="leg-viewer" aria-label={`Vista 3D en ${noun}`}>
      <div
        ref={stage}
        className="leg-stage"
        role="img"
        aria-label={`Cuerpo de referencia en 3D con el diseño en ${noun}. Arrastra para girarlo.`}
      >
        {state === 'loading' && <p className="leg-stage-note">Cargando la vista 3D…</p>}
        {state === 'unsupported' && (
          <p className="leg-stage-note">
            Este navegador no puede mostrar 3D (WebGL). El mockup sobre piel sigue disponible.
          </p>
        )}
        {state === 'failed' && (
          <p className="leg-stage-note">
            No se ha podido cargar la vista 3D. El mockup sobre piel sigue disponible.
          </p>
        )}
      </div>
      <p className="leg-notice">{BODY_NOTICE}</p>
      {model?.complex && <p className="leg-notice">{COMPLEX_NOTICE}</p>}
      {state === 'ready' && model && range && (
        <div className="leg-controls">
          <div className="leg-views" role="group" aria-label="Ver">
            <button type="button" onClick={() => scene.current?.view(false)}>
              Ver {noun}
            </button>
            <button type="button" onClick={() => scene.current?.view(true)}>
              Ver el cuerpo entero
            </button>
          </div>
          <label>
            Mover a los lados: {Math.round(placement.xMm / 10)} cm
            <input
              type="range"
              aria-label="Mover a los lados, en milímetros"
              min={-range.x}
              max={range.x}
              step={1}
              value={placement.xMm}
              onChange={(e) => move({ ...placement, xMm: Number(e.target.value) })}
            />
          </label>
          <label>
            Subir o bajar: {Math.round(placement.yMm / 10)} cm
            <input
              type="range"
              aria-label="Subir o bajar, en milímetros"
              min={-range.y}
              max={range.y}
              step={1}
              value={placement.yMm}
              onChange={(e) => move({ ...placement, yMm: Number(e.target.value) })}
            />
          </label>
          <label>
            Giro: {Math.round(placement.angle)}°
            <input
              type="range"
              aria-label="Giro, en grados"
              min={-180}
              max={180}
              step={1}
              value={placement.angle}
              onChange={(e) => move({ ...placement, angle: Number(e.target.value) })}
            />
          </label>
          <div className="leg-toggles">
            {model.paired && (
              <div role="group" aria-label="Lado">
                {(['left', 'right'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={side === s}
                    onClick={() => {
                      setSide(s);
                      scene.current?.setSide(s);
                    }}
                  >
                    {s === 'left' ? 'Izquierda' : 'Derecha'}
                  </button>
                ))}
              </div>
            )}
            <div role="group" aria-label="Cuerpo">
              {BODY_TYPES.map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={body === b}
                  onClick={() => {
                    setState('loading');
                    setBody(b);
                  }}
                >
                  {BODY_LABEL[b]}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Tono de piel">
              {SKIN_TONES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={tone === t.key}
                  onClick={() => {
                    setTone(t.key);
                    scene.current?.setTone(t.key);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="small-note">
            Dibujo de {Math.round(drawn.widthMm)} × {Math.round(drawn.heightMm)} mm, como en el
            mockup, sobre {noun} de un cuerpo de referencia de{' '}
            {(bodyHeight / 1000).toFixed(2).replace('.', ',')} m.
          </p>
        </div>
      )}
    </section>
  );
}
