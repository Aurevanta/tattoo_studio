'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  defaultPlacement,
  heightRange,
  limbOf,
  LIMBS,
  nearestView,
  perimeterAt,
  SKIN_TONES,
  wrapFraction,
  type LimbModel,
  type LimbPlacement,
  type LimbSide,
  type LimbZone,
  type SkinTone,
} from '@/lib/limb-wrap';
import type { LimbScene } from '@/lib/limb-scene';

/**
 * The rotatable 3D preview of a design on a reference lower leg or forearm (TASK-0102, TASK-0103,
 * ADR-0033). It draws the design's master at its real size in mm; it is illustrative, and it is
 * never the deliverable.
 */
export function LimbViewer3D({
  designUrl,
  size,
  zone,
  side: initialSide = 'left',
  wraps = false,
}: {
  designUrl: string;
  size: { widthMm: number; heightMm: number };
  zone: LimbZone;
  side?: LimbSide;
  /** TASK-0104: the design goes all the way round; it starts centred on the band. */
  wraps?: boolean;
}): ReactNode {
  const limb = limbOf(zone);
  const spec = LIMBS[limb];
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<LimbScene | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
  const [model, setModel] = useState<LimbModel | null>(null);
  const [placement, setPlacement] = useState<LimbPlacement | null>(null);
  const [side, setSide] = useState<LimbSide>(initialSide);
  const [tone, setTone] = useState<SkinTone>('medium');

  useEffect(() => {
    let cancelled = false;
    let created: LimbScene | null = null;
    void (async () => {
      const { createLimbScene, webglAvailable } = await import('@/lib/limb-scene');
      if (cancelled) return;
      if (!webglAvailable()) return setState('unsupported');
      try {
        // The first placement needs the model's measurements; the scene starts with a neutral one
        // and is moved as soon as they are read.
        const neutral = {
          around: 0,
          heightMm: 150,
          widthMm: size.widthMm,
          lengthMm: size.heightMm,
        };
        created = await createLimbScene(stage.current!, limb, designUrl, {
          placement: neutral,
          side: initialSide,
          tone: 'medium',
        });
        if (cancelled) return created.dispose();
        scene.current = created;
        const start = defaultPlacement(zone, created.model, size, wraps);
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
  }, [designUrl, limb]);

  function move(next: LimbPlacement) {
    setPlacement(next);
    scene.current?.setPlacement(next);
  }

  const range = model && placement ? heightRange(model, placement.lengthMm) : null;
  const perimeter = model && placement ? perimeterAt(model, placement.heightMm) : null;
  const reach = perimeter && placement ? wrapFraction(placement.widthMm, perimeter) : 0;

  return (
    <section className="leg-viewer" aria-label={`Vista 3D en ${spec.noun}`}>
      <div ref={stage} className="leg-stage" role="img" aria-label={spec.stageLabel}>
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
      <p className="leg-notice">{spec.notice}</p>
      {state === 'ready' && placement && range && (
        <div className="leg-controls">
          <div className="leg-views" role="group" aria-label="Ver desde">
            {spec.views.map((v) => (
              <button key={v.key} type="button" onClick={() => scene.current?.view(v.around)}>
                {v.label}
              </button>
            ))}
          </div>
          <label>
            Alrededor de {spec.noun}: {nearestView(limb, placement.around).label.toLowerCase()}
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
            Altura: {Math.round(placement.heightMm / 10)} cm sobre {spec.distalJoint}
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
            <div role="group" aria-label="Lado">
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
              {placement.widthMm} × {placement.lengthMm} mm · {spec.noun} de referencia mide{' '}
              {Math.round(perimeter / 10)} cm de contorno a esa altura: el diseño rodea{' '}
              {reach >= 1 ? spec.whole : spec.part(Math.round(reach * 100))}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
