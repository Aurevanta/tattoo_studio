/**
 * Where a design sits on a reference limb of the 3D preview (TASK-0102, TASK-0103, ADR-0033).
 *
 * The models (`public/models/lower-leg.glb` and `forearm.glb`, built by
 * `scripts/build-limb-model.py` from the CC0 MakeHuman base mesh) give every vertex its height
 * along the limb axis, the perimeter of the limb at that height and its arc-length fraction `s`
 * around it. With those, a design is laid in true millimetres: its width runs along the skin's own
 * perimeter, not along a projected angle, so 80 mm of design is 80 mm of skin at any height.
 *
 * This module is the maths the shader runs, kept pure so it is verified without a GPU. It never
 * moves a line of the artwork (MOCKUP-INV-001): it only says where each point of skin samples it.
 */

import { isSleeve } from '@tattoo/contracts';

export type Limb = 'leg' | 'forearm';
export type LimbSide = 'left' | 'right';

/** What a model's scene carries in its extras, in mm along the limb axis (distal joint = 0). */
export interface LimbModel {
  limb: Limb;
  /** The knee or the elbow. */
  proximalMm: number;
  topMm: number;
  /** The sole or the fingertips, below the distal joint. */
  endMm: number;
  /** Where the limb is widest: the calf, the belly of the forearm. */
  bellyMm: number;
  circumferenceMm: { proximal: number; belly: number; distal: number; distalAtMm: number };
}

/** Where the client puts the design. */
export interface LimbPlacement {
  /** Fraction around the limb of the design's centre (see `LIMBS[limb].views`). */
  around: number;
  /** Height of the design's centre above the distal joint (ankle, wrist), mm. */
  heightMm: number;
  widthMm: number;
  lengthMm: number;
}

interface View {
  key: string;
  label: string;
  around: number;
}

interface LimbSpec {
  model: string;
  /** Spanish noun with its article, for the labels. */
  noun: string;
  /** What the view is and is not (ADR-0033), shown wherever it is. */
  notice: string;
  stageLabel: string;
  /** How far round the design reaches: all of it, or a share of it. */
  whole: string;
  part: (percent: number) => string;
  /** The four views a tattooer looks at the limb from, as fractions around it. */
  views: readonly [View, View, View, View];
  /** The design keeps clear of the distal bone and of the proximal fold, mm. */
  distalClearanceMm: number;
  proximalClearanceMm: number;
  distalJoint: string;
}

export const LIMBS: Readonly<Record<Limb, LimbSpec>> = {
  leg: {
    model: '/models/lower-leg.glb',
    noun: 'la pierna',
    notice:
      'Vista orientativa sobre una pierna de referencia, no la tuya. Las medidas del diseño son reales; la forma de tu pierna no lo es.',
    stageLabel: 'Pierna de referencia en 3D con el diseño. Arrastra para girarla.',
    whole: 'la pierna entera y se solapa',
    part: (percent) => `${percent} % de ella`,
    views: [
      { key: 'front', label: 'Delante', around: 0 },
      { key: 'outside', label: 'Exterior', around: 0.25 },
      { key: 'back', label: 'Detrás', around: 0.5 },
      { key: 'inside', label: 'Interior', around: 0.75 },
    ],
    distalClearanceMm: 40,
    proximalClearanceMm: 30,
    distalJoint: 'el tobillo',
  },
  forearm: {
    model: '/models/forearm.glb',
    noun: 'el antebrazo',
    notice:
      'Vista orientativa sobre un antebrazo de referencia, no el tuyo. Las medidas del diseño son reales; la forma de tu antebrazo no lo es.',
    stageLabel: 'Antebrazo de referencia en 3D con el diseño. Arrastra para girarlo.',
    whole: 'el antebrazo entero y se solapa',
    part: (percent) => `${percent} % de él`,
    views: [
      { key: 'inner', label: 'Interior', around: 0 },
      { key: 'thumb', label: 'Lado del pulgar', around: 0.25 },
      { key: 'outer', label: 'Exterior', around: 0.5 },
      { key: 'little', label: 'Lado del meñique', around: 0.75 },
    ],
    distalClearanceMm: 20,
    proximalClearanceMm: 30,
    distalJoint: 'la muñeca',
  },
};

/** Zones the preview covers, and the limb each is on. */
const ZONE_LIMB = {
  calf: 'leg',
  shin: 'leg',
  ankle: 'leg',
  inner_forearm: 'forearm',
  outer_forearm: 'forearm',
} as const satisfies Record<string, Limb>;
export type LimbZone = keyof typeof ZONE_LIMB;

export function isLimbZone(zone: string | undefined | null): zone is LimbZone {
  return Object.prototype.hasOwnProperty.call(ZONE_LIMB, zone ?? '');
}

export function limbOf(zone: LimbZone): Limb {
  return ZONE_LIMB[zone];
}

/** Skin tones offered in the preview: light, medium, dark. Reference tones, not the client's. */
export const SKIN_TONES = [
  { key: 'light', label: 'Clara', colour: '#e8b99a' },
  { key: 'medium', label: 'Media', colour: '#c08a64' },
  { key: 'dark', label: 'Oscura', colour: '#7a4f36' },
] as const;
export type SkinTone = (typeof SKIN_TONES)[number]['key'];

/** The view nearest a fraction around the limb, to name where the design sits. */
export function nearestView(limb: Limb, around: number): View {
  const distance = (a: number) => Math.abs(fract(around - a + 0.5) - 0.5);
  return LIMBS[limb].views.reduce((best, v) =>
    distance(v.around) < distance(best.around) ? v : best,
  );
}

export function readLimbModel(extras: unknown): LimbModel {
  const e = extras as Partial<LimbModel> | null | undefined;
  const c = e?.circumferenceMm;
  const numbers = [
    e?.proximalMm,
    e?.topMm,
    e?.endMm,
    e?.bellyMm,
    c?.proximal,
    c?.belly,
    c?.distal,
    c?.distalAtMm,
  ];
  if (
    !e ||
    !c ||
    (e.limb !== 'leg' && e.limb !== 'forearm') ||
    numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  )
    throw new Error('The limb model carries no measurements.');
  return {
    limb: e.limb,
    proximalMm: e.proximalMm!,
    topMm: e.topMm!,
    endMm: e.endMm!,
    bellyMm: e.bellyMm!,
    circumferenceMm: {
      proximal: c.proximal!,
      belly: c.belly!,
      distal: c.distal!,
      distalAtMm: c.distalAtMm!,
    },
  };
}

/** The band a design may cover, between the distal and the proximal clearances, mm. */
export function band(model: LimbModel): { low: number; high: number } {
  const spec = LIMBS[model.limb];
  return { low: spec.distalClearanceMm, high: model.proximalMm - spec.proximalClearanceMm };
}

/** Heights the design's centre may take so the whole design stays within the band. */
export function heightRange(model: LimbModel, lengthMm: number): { min: number; max: number } {
  const { low, high } = band(model);
  const min = low + lengthMm / 2;
  const max = high - lengthMm / 2;
  if (max >= min) return { min, max };
  const middle = (low + high) / 2;
  return { min: middle, max: middle };
}

/**
 * Where a design starts on this zone: a calf piece on the back of the calf, a shin piece on the
 * front, an ankle piece on the outside just above the bone, a forearm piece on its own side. A
 * design that goes all the way round starts centred on that side and on the band. The client
 * moves it from there.
 */
export function defaultPlacement(
  zone: LimbZone,
  model: LimbModel,
  size: { widthMm: number; heightMm: number },
  wraps = false,
): LimbPlacement {
  const range = heightRange(model, size.heightMm);
  const clamp = (h: number) => Math.min(range.max, Math.max(range.min, h));
  const around = {
    calf: 0.5,
    shin: 0,
    ankle: 0.25,
    inner_forearm: 0,
    outer_forearm: 0.5,
  }[zone];
  const { low, high } = band(model);
  const height = wraps
    ? (low + high) / 2
    : zone === 'calf'
      ? model.bellyMm
      : zone === 'ankle'
        ? low + size.heightMm / 2
        : model.proximalMm * 0.55;
  return { around, heightMm: clamp(height), widthMm: size.widthMm, lengthMm: size.heightMm };
}

/**
 * The design coordinate a point of skin samples, or null when it falls outside the design.
 * `s` is the point's fraction around the limb, `heightMm` its height and `perimeterMm` the limb's
 * perimeter there. On the right side the model is a mirror image, so the design is mirrored back
 * and reads the right way round.
 *
 * Returns (u, v) in [0, 1]: u left to right across the artwork as seen from outside the limb, v
 * top (towards the knee or the elbow) to bottom.
 */
export function designCoordinate(
  s: number,
  heightMm: number,
  perimeterMm: number,
  placement: LimbPlacement,
  side: LimbSide = 'left',
): { u: number; v: number } | null {
  const turn = fract(s - placement.around + 0.5) - 0.5;
  // On the left limb s grows towards +X, which a viewer facing that skin sees as rightwards on the
  // fraction-0 side and leftwards on the opposite one; arc length along the skin is what the
  // design keeps.
  const acrossMm = turn * perimeterMm * (side === 'left' ? 1 : -1);
  const u = acrossMm / placement.widthMm + 0.5;
  const v = 0.5 - (heightMm - placement.heightMm) / placement.lengthMm;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** How much of the way round the limb a design reaches, as a fraction of the perimeter. */
export function wrapFraction(widthMm: number, perimeterMm: number): number {
  return widthMm / perimeterMm;
}

/** Linear interpolation of the limb's perimeter between the model's three measured heights. */
export function perimeterAt(model: LimbModel, heightMm: number): number {
  const c = model.circumferenceMm;
  const points: [number, number][] = [
    [c.distalAtMm, c.distal],
    [model.bellyMm, c.belly],
    [model.proximalMm - 40, c.proximal],
  ];
  if (heightMm <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [h0, p0] = points[i - 1]!;
    const [h1, p1] = points[i]!;
    if (heightMm <= h1) return h1 === h0 ? p1 : p0 + ((p1 - p0) * (heightMm - h0)) / (h1 - h0);
  }
  return points[points.length - 1]![1];
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * What the summary says before a sleeve is drawn (TASK-0104, ADR-0034): that it goes all the way
 * round, at a reference limb's size, and that it counts as two designs. Nothing for any other
 * design.
 */
export function sleeveNote(
  placement: { bodyPart?: string | undefined; orientation?: string | undefined } | undefined,
  size: { widthMm?: number | undefined; heightMm?: number | undefined } | undefined,
): string | null {
  if (!isSleeve(placement, size) || !isLimbZone(placement?.bodyPart)) return null;
  const cm = (mm: number | undefined) => String((mm ?? 0) / 10).replace('.', ',');
  return (
    `Es una manga completa: el diseño rodea ${LIMBS[limbOf(placement.bodyPart)].whole.replace(' y se solapa', '')} y mide ${cm(size?.widthMm)} × ` +
    `${cm(size?.heightMm)} cm desenrollado, con medidas de referencia. Cuenta como 2 diseños del ` +
    'límite diario, porque se dibuja y después se cierra su junta.'
  );
}
