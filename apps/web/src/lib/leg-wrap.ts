/**
 * Where a design sits on the reference leg of the 3D preview (TASK-0101, ADR-0033).
 *
 * The model (`public/models/lower-leg.glb`, built by `scripts/build-leg-model.py` from the CC0
 * MakeHuman base mesh) gives every vertex its height along the limb axis, the perimeter of the leg
 * at that height and its arc-length fraction `s` around it, from the front towards the outside.
 * With those, a design is laid in true millimetres: its width runs along the skin's own perimeter,
 * not along a projected angle, so 80 mm of design is 80 mm of skin at any height.
 *
 * This module is the maths the shader runs, kept pure so it is verified without a GPU. It never
 * moves a line of the artwork (MOCKUP-INV-001): it only says where each point of skin samples it.
 */

/** What the model's scene carries in its extras, in mm along the limb axis (ankle joint = 0). */
export interface LegModel {
  kneeMm: number;
  topMm: number;
  soleMm: number;
  calfMm: number;
  circumferenceMm: { belowKnee: number; calf: number; ankle: number };
}

export type LegSide = 'left' | 'right';

/** Where the client puts the design. */
export interface LegPlacement {
  /** Fraction around the leg of the design's centre: 0 front, 0.25 outside, 0.5 back, 0.75 inside. */
  around: number;
  /** Height of the design's centre above the ankle joint, mm. */
  heightMm: number;
  widthMm: number;
  lengthMm: number;
}

/** The four views a tattooer looks at a lower leg from, as fractions around it. */
export const VIEWS = [
  { key: 'front', label: 'Delante', around: 0 },
  { key: 'outside', label: 'Exterior', around: 0.25 },
  { key: 'back', label: 'Detrás', around: 0.5 },
  { key: 'inside', label: 'Interior', around: 0.75 },
] as const;

/** Skin tones offered in the preview: light, medium, dark. Reference tones, not the client's. */
export const SKIN_TONES = [
  { key: 'light', label: 'Clara', colour: '#e8b99a' },
  { key: 'medium', label: 'Media', colour: '#c08a64' },
  { key: 'dark', label: 'Oscura', colour: '#7a4f36' },
] as const;
export type SkinTone = (typeof SKIN_TONES)[number]['key'];

/** The view nearest a fraction around the leg, to name where the design sits. */
export function nearestView(around: number): (typeof VIEWS)[number] {
  const distance = (a: number) => Math.abs(fract(around - a + 0.5) - 0.5);
  return VIEWS.reduce((best, v) => (distance(v.around) < distance(best.around) ? v : best));
}

/** Zones the preview covers: the lower leg between the knee and the ankle. */
export const LEG_ZONES = ['calf', 'shin', 'ankle'] as const;
export type LegZone = (typeof LEG_ZONES)[number];

export function isLegZone(zone: string | undefined | null): zone is LegZone {
  return (LEG_ZONES as readonly string[]).includes(zone ?? '');
}

export function readLegModel(extras: unknown): LegModel {
  const e = extras as Partial<LegModel> | null | undefined;
  const c = e?.circumferenceMm;
  const numbers = [e?.kneeMm, e?.topMm, e?.soleMm, e?.calfMm, c?.belowKnee, c?.calf, c?.ankle];
  if (!e || !c || numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
    throw new Error('The leg model carries no measurements.');
  return {
    kneeMm: e.kneeMm!,
    topMm: e.topMm!,
    soleMm: e.soleMm!,
    calfMm: e.calfMm!,
    circumferenceMm: { belowKnee: c.belowKnee!, calf: c.calf!, ankle: c.ankle! },
  };
}

/** The design keeps clear of the ankle bone and of the knee's fold. */
const ANKLE_CLEARANCE_MM = 40;
const KNEE_CLEARANCE_MM = 30;

/** Heights the design's centre may take so the whole design stays between ankle and knee. */
export function heightRange(model: LegModel, lengthMm: number): { min: number; max: number } {
  const low = ANKLE_CLEARANCE_MM + lengthMm / 2;
  const high = model.kneeMm - KNEE_CLEARANCE_MM - lengthMm / 2;
  if (high >= low) return { min: low, max: high };
  const middle = (ANKLE_CLEARANCE_MM + model.kneeMm - KNEE_CLEARANCE_MM) / 2;
  return { min: middle, max: middle };
}

/**
 * Where a design starts on this zone: a calf piece on the back of the calf, a shin piece on the
 * front, an ankle piece on the outside just above the bone. The client moves it from there.
 */
export function defaultPlacement(
  zone: LegZone,
  model: LegModel,
  size: { widthMm: number; heightMm: number },
): LegPlacement {
  const range = heightRange(model, size.heightMm);
  const clamp = (h: number) => Math.min(range.max, Math.max(range.min, h));
  const around = zone === 'calf' ? 0.5 : zone === 'shin' ? 0 : 0.25;
  const height =
    zone === 'calf'
      ? model.calfMm
      : zone === 'shin'
        ? model.kneeMm * 0.55
        : ANKLE_CLEARANCE_MM + size.heightMm / 2;
  return { around, heightMm: clamp(height), widthMm: size.widthMm, lengthMm: size.heightMm };
}

/**
 * The design coordinate a point of skin samples, or null when it falls outside the design.
 * `s` is the point's fraction around the leg, `heightMm` its height and `perimeterMm` the leg's
 * perimeter there. On the right leg the model is a mirror image, so the design is mirrored back
 * and reads the right way round.
 *
 * Returns (u, v) in [0, 1]: u left to right across the artwork as seen from outside the leg, v top
 * (towards the knee) to bottom.
 */
export function designCoordinate(
  s: number,
  heightMm: number,
  perimeterMm: number,
  placement: LegPlacement,
  side: LegSide = 'left',
): { u: number; v: number } | null {
  const turn = fract(s - placement.around + 0.5) - 0.5;
  // On the left leg s grows towards the outside, which a viewer facing that skin sees as rightwards
  // on the front and leftwards on the back; arc length along the skin is what the design keeps.
  const acrossMm = turn * perimeterMm * (side === 'left' ? 1 : -1);
  const u = acrossMm / placement.widthMm + 0.5;
  const v = 0.5 - (heightMm - placement.heightMm) / placement.lengthMm;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** How much of the way round the leg a design reaches at a height, as a fraction of the perimeter. */
export function wrapFraction(widthMm: number, perimeterMm: number): number {
  return widthMm / perimeterMm;
}

/** Linear interpolation of the leg's perimeter between the model's three measured heights. */
export function perimeterAt(model: LegModel, heightMm: number): number {
  const points: [number, number][] = [
    [60, model.circumferenceMm.ankle],
    [model.calfMm, model.circumferenceMm.calf],
    [model.kneeMm - 40, model.circumferenceMm.belowKnee],
  ];
  if (heightMm <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [h0, p0] = points[i - 1]!;
    const [h1, p1] = points[i]!;
    if (heightMm <= h1) return p0 + ((p1 - p0) * (heightMm - h0)) / (h1 - h0);
  }
  return points[points.length - 1]![1];
}

function fract(x: number): number {
  return x - Math.floor(x);
}
