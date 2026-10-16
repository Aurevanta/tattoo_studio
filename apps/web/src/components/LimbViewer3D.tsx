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
import { BODY_LABEL, BODY_TYPES, type BodyType } from '@/lib/body-type';
import { BODY_ZONE_SPANS } from '@tattoo/contracts';
import {
  mockupOffset,
  mockupStart,
  offsetOf,
  toMockupPlacement,
  visibleSize,
  type MockupPose,
} from '@/lib/mockup-pose';
import { UNCHANGED_FACTORS, type Factors } from '@/lib/design-resize';
import type { EditorPlacement } from '@/lib/mockup-editor';
import type { ArtworkBox } from '@/lib/try-on';
import { DesignAdjust3D } from './DesignAdjust3D';

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
  body: initialBody,
  pose,
  wholeCanvas = false,
  baseStretch,
  onSave,
  saveDisabled = false,
  quotaNote,
  shared,
  onShared,
}: {
  designUrl: string;
  size: { widthMm: number; heightMm: number };
  zone: LimbZone;
  side?: LimbSide;
  /** TASK-0104: the design goes all the way round; it starts centred on the band. */
  wraps?: boolean;
  /** TASK-0110: a masculine or a feminine limb, which the client may switch; none on the landing. */
  body?: BodyType | undefined;
  /** TASK-0111: where the 2D mockup shows the design, on a generated plate. */
  pose?: MockupPose | undefined;
  /** A calibrated photograph draws the whole canvas, margins included. */
  wholeCanvas?: boolean;
  /** TASK-0112: how far earlier versions already stretched the drawing. */
  baseStretch?: number | undefined;
  /** TASK-0112: saves the adjustment as the mockup's placement (a new version). */
  onSave?: ((placement: EditorPlacement) => void) | undefined;
  saveDisabled?: boolean;
  quotaNote?: string | null | undefined;
  /** TASK-0120: the placement shared with the mockup editor (its fractions); null: the result's. */
  shared?: EditorPlacement | null | undefined;
  onShared?: ((placement: EditorPlacement) => void) | undefined;
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
  const [body, setBody] = useState<BodyType | undefined>(initialBody);
  // TASK-0112: size against the opening size, the artwork's drawn size and box, where the view
  // opened, and the height the zone's centre maps to (the mockup's offsets are taken from it).
  const [factors, setFactors] = useState<Factors>(UNCHANGED_FACTORS);
  const [drawn, setDrawn] = useState(size);
  const artBox = useRef<ArtworkBox | undefined>(undefined);
  const opened = useRef<LimbPlacement | null>(null);
  const zoneHeight = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let created: LimbScene | null = null;
    void (async () => {
      const { createLimbScene, webglAvailable } = await import('@/lib/limb-scene');
      if (cancelled) return;
      if (!webglAvailable()) return setState('unsupported');
      try {
        // TASK-0111: the artwork as the mockup draws it, its margin trimmed; a sleeve is its
        // whole unrolled skin.
        const { loadArtwork } = await import('@/lib/design-art');
        const whole = wholeCanvas || wraps;
        const art = await loadArtwork(designUrl, whole);
        const artSize = visibleSize(size, art.box, whole);
        artBox.current = art.box;
        // The first placement needs the model's measurements; the scene starts with a neutral one
        // and is moved as soon as they are read.
        const neutral = {
          around: 0,
          heightMm: 150,
          widthMm: artSize.widthMm,
          lengthMm: artSize.heightMm,
        };
        created = await createLimbScene(
          stage.current!,
          limb,
          art.canvas,
          {
            placement: neutral,
            side,
            tone,
          },
          body,
        );
        if (cancelled) return created.dispose();
        scene.current = created;
        // TASK-0110: switching the body keeps where the design was; the limb has the same length.
        let start = placement ?? defaultPlacement(zone, created.model, artSize, wraps);
        if (!placement) zoneHeight.current = start.heightMm;
        // TASK-0111: the first view starts at the height the mockup shows the design at.
        const span = BODY_ZONE_SPANS[zone];
        const offset =
          !placement && !wraps && pose && span
            ? mockupOffset(pose, art.box, span.heightMm)
            : undefined;
        if (offset) {
          const range = heightRange(created.model, artSize.heightMm);
          start = {
            ...start,
            heightMm: Math.min(range.max, Math.max(range.min, start.heightMm + offset.yMm)),
            angle: offset.angle,
          };
        }
        if (!placement) {
          opened.current = start;
          setDrawn(artSize);
        }
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
    // The scene is built once per design and body; later changes go through its setters.
  }, [designUrl, limb, body]);

  const span = BODY_ZONE_SPANS[zone];
  // TASK-0120: what this view last told the mockup editor, so it does not move itself back.
  const sent = useRef('');

  function move(next: LimbPlacement, nextFactors: Factors = factors) {
    setPlacement(next);
    scene.current?.setPlacement(next);
    if (onShared && pose && span && !wraps) {
      // Round the limb is this view's own: the mockup keeps where it has the design across.
      const shown = toMockupPlacement(
        pose,
        artBox.current,
        span.heightMm,
        { yMm: next.heightMm - zoneHeight.current, angle: next.angle ?? 0 },
        nextFactors,
        shared,
      );
      sent.current = JSON.stringify(shown);
      onShared(shown);
    }
  }

  const range = model && placement ? heightRange(model, placement.lengthMm) : null;

  function resize(next: Factors) {
    setFactors(next);
    if (placement)
      move(
        {
          ...placement,
          widthMm: drawn.widthMm * next[0],
          lengthMm: drawn.heightMm * next[1],
        },
        next,
      );
  }

  // TASK-0120: the mockup editor moved the design; this view follows its height, turn and size.
  useEffect(() => {
    if (shared === undefined || wraps || !pose || !span || state !== 'ready') return;
    if (!opened.current || !placement) return;
    if (shared && JSON.stringify(shared) === sent.current) return;
    let next: LimbPlacement = { ...opened.current, around: placement.around };
    let nextFactors: Factors = UNCHANGED_FACTORS;
    if (shared) {
      const start = mockupStart(pose, artBox.current);
      const at = offsetOf(pose, shared, span.heightMm);
      nextFactors = [shared.width / start.width, shared.height / start.height];
      next = {
        ...placement,
        heightMm: zoneHeight.current + at.yMm,
        angle: at.angle,
        widthMm: drawn.widthMm * nextFactors[0],
        lengthMm: drawn.heightMm * nextFactors[1],
      };
    }
    setFactors(nextFactors);
    setPlacement(next);
    scene.current?.setPlacement(next);
    // Only a change of what is shared moves this view; its own moves were sent from `move`.
  }, [shared, state]);

  const start = opened.current;
  const changed = Boolean(
    start &&
    placement &&
    (factors[0] !== 1 ||
      factors[1] !== 1 ||
      Math.abs(placement.heightMm - start.heightMm) > 1 ||
      Math.abs((placement.angle ?? 0) - (start.angle ?? 0)) > 0.5),
  );
  // Round a limb the plate shows one side: the height and the turn go back to the mockup, and the
  // fraction round it stays the mockup's own.
  const save =
    onSave && pose && span && placement && !wraps
      ? {
          changed,
          disabled: saveDisabled,
          quotaNote,
          onSave: () =>
            onSave(
              toMockupPlacement(
                pose,
                artBox.current,
                span.heightMm,
                {
                  yMm: placement.heightMm - zoneHeight.current,
                  angle: placement.angle ?? 0,
                },
                factors,
              ),
            ),
        }
      : undefined;
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
          {!placement.wraps && (
            <>
              <label>
                Giro: {Math.round(placement.angle ?? 0)}°
                <input
                  type="range"
                  aria-label="Giro, en grados"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round(placement.angle ?? 0)}
                  onChange={(e) => move({ ...placement, angle: Number(e.target.value) })}
                />
              </label>
              <DesignAdjust3D
                print={size}
                factors={factors}
                onFactors={resize}
                baseStretch={baseStretch}
                calibrated={wholeCanvas}
                save={save}
              />
            </>
          )}
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
            {initialBody && (
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
            )}
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
              {placement.wraps ? (
                // TASK-0105: a sleeve takes the limb's own circumference at every height.
                <>
                  Manga de {placement.lengthMm / 10} cm de alto · a esta altura {spec.noun} de
                  referencia mide {Math.round(perimeter / 10)} cm de contorno, y el diseño da la
                  vuelta entera, sin sobrar ni faltar.
                </>
              ) : (
                <>
                  {placement.widthMm} × {placement.lengthMm} mm · {spec.noun} de referencia mide{' '}
                  {Math.round(perimeter / 10)} cm de contorno a esa altura: el diseño rodea{' '}
                  {reach >= 1 ? spec.whole : spec.part(Math.round(reach * 100))}. {/* TASK-0125 */}
                  Vista orientativa sobre un miembro de referencia; la plantilla sí se imprime a esa
                  medida.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
