'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  defaultPlacement,
  heightRange,
  nearestView,
  perimeterAt,
  SKIN_TONES,
  VIEWS,
  wrapFraction,
  type LegModel,
  type LegPlacement,
  type LegSide,
  type LegZone,
  type SkinTone,
} from '@/lib/leg-wrap';
import type { LegScene } from '@/lib/leg-scene';

/** Text that goes wherever the 3D view does (ADR-0033): what it is and what it is not. */
export const LEG_VIEW_NOTICE =
  'Vista orientativa sobre una pierna de referencia, no la tuya. Las medidas del diseño son reales; la forma de tu pierna no lo es.';

/**
 * The rotatable 3D preview of a design on a reference lower leg (TASK-0101, ADR-0033). It draws the
 * design's master at its real size in mm; it is illustrative, and it is never the deliverable.
 */
export function LegViewer3D({
  designUrl,
  size,
  zone,
  side: initialSide = 'left',
}: {
  designUrl: string;
  size: { widthMm: number; heightMm: number };
  zone: LegZone;
  side?: LegSide;
}): ReactNode {
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<LegScene | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
  const [model, setModel] = useState<LegModel | null>(null);
  const [placement, setPlacement] = useState<LegPlacement | null>(null);
  const [side, setSide] = useState<LegSide>(initialSide);
  const [tone, setTone] = useState<SkinTone>('medium');

  useEffect(() => {
    let cancelled = false;
    let created: LegScene | null = null;
    void (async () => {
      const { createLegScene, webglAvailable } = await import('@/lib/leg-scene');
      if (cancelled) return;
      if (!webglAvailable()) return setState('unsupported');
      try {
        // The first placement needs the model's measurements; the scene starts with a neutral one
        // and is moved as soon as they are read.
        const neutral = {
          around: 0,
          heightMm: 200,
          widthMm: size.widthMm,
          lengthMm: size.heightMm,
        };
        created = await createLegScene(stage.current!, designUrl, {
          placement: neutral,
          side: initialSide,
          tone: 'medium',
        });
        if (cancelled) return created.dispose();
        scene.current = created;
        const start = defaultPlacement(zone, created.model, size);
        created.setPlacement(start);
        created.view(start.around);
        setModel(created.model);
        setPlacement(start);
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
    // The scene is built once per design; later changes go through its setters.
  }, [designUrl]);

  function move(next: LegPlacement) {
    setPlacement(next);
    scene.current?.setPlacement(next);
  }

  const range = model && placement ? heightRange(model, placement.lengthMm) : null;
  const perimeter = model && placement ? perimeterAt(model, placement.heightMm) : null;
  const wraps = perimeter && placement ? wrapFraction(placement.widthMm, perimeter) : 0;

  return (
    <section className="leg-viewer" aria-label="Vista 3D en la pierna">
      <div
        ref={stage}
        className="leg-stage"
        role="img"
        aria-label="Pierna de referencia en 3D con el diseño. Arrastra para girarla."
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
      <p className="leg-notice">{LEG_VIEW_NOTICE}</p>
      {state === 'ready' && placement && range && (
        <div className="leg-controls">
          <div className="leg-views" role="group" aria-label="Ver desde">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" onClick={() => scene.current?.view(v.around)}>
                {v.label}
              </button>
            ))}
          </div>
          <label>
            Alrededor de la pierna: {nearestView(placement.around).label.toLowerCase()}
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={placement.around}
              onChange={(e) => move({ ...placement, around: Number(e.target.value) })}
            />
          </label>
          <label>
            Altura: {Math.round(placement.heightMm / 10)} cm sobre el tobillo
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={1}
              value={placement.heightMm}
              disabled={range.min === range.max}
              onChange={(e) => move({ ...placement, heightMm: Number(e.target.value) })}
            />
          </label>
          <div className="leg-toggles">
            <div role="group" aria-label="Pierna">
              {(['left', 'right'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  onClick={() => {
                    setSide(s);
                    scene.current?.setSide(s);
                    scene.current?.view(placement.around);
                  }}
                >
                  {s === 'left' ? 'Izquierda' : 'Derecha'}
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
          {perimeter && (
            <p className="small-note">
              {placement.widthMm} × {placement.lengthMm} mm · la pierna de referencia mide{' '}
              {Math.round(perimeter / 10)} cm de contorno a esa altura: el diseño rodea{' '}
              {wraps >= 1 ? 'la pierna entera y se solapa' : `${Math.round(wraps * 100)} % de ella`}
              .
            </p>
          )}
        </div>
      )}
    </section>
  );
}
