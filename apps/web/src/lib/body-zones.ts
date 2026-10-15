/**
 * Where a design sits on the reference body of the whole-body 3D preview (TASK-0109, ADR-0037).
 *
 * The bodies (`public/models/body-{masculine,feminine}.glb`, built by `scripts/build-body-model.py` from the CC0 MakeHuman
 * base mesh) carries, per zone, how a design is laid there: projected as a decal from the zone's
 * outward direction (`plane`), or round a limb's axis (`cylinder`). This module is the maths the
 * shader runs, kept pure so it is verified without a GPU. It says where each point of skin samples
 * the design; it never moves a line of the artwork (MOCKUP-INV-001).
 *
 * The lower leg and the forearm keep their own viewer (`limb-wrap.ts`, ADR-0033).
 */

import { isLimbZone } from './limb-wrap';

type Vec3 = readonly [number, number, number];

/** What the model says about one zone, in mm and unit vectors in the body's own frame. */
export interface BodyZoneModel {
  mode: 'plane' | 'cylinder';
  origin: Vec3;
  /** Plane: the outward direction. Cylinder: fraction 0 round the axis. */
  normal: Vec3;
  /** The design's up across the skin (plane) or the limb's axis (cylinder). */
  up: Vec3;
  right: Vec3;
  /** Where the zone's centre meets the skin: the camera looks here. */
  surface: Vec3;
  /** Where the camera looks from, when the outward direction is blocked by the body itself. */
  view?: Vec3;
  behindMm?: number;
  frontMm?: number;
  radiusMm?: number;
  lengthMm?: number;
  paired: boolean;
  complex: boolean;
}

export interface BodyModel {
  heightMm: number;
  zones: Record<string, BodyZoneModel>;
}

/** Where the client puts the design: offsets from the zone's centre across the skin, mm. */
export interface BodyPlacement {
  xMm: number;
  yMm: number;
  /** Degrees, clockwise as seen from outside. */
  angle: number;
  widthMm: number;
  heightMm: number;
}

export type BodySide = 'left' | 'right';

/** TASK-0110 (ADR-0038): a masculine or a feminine reference body. */
export function bodyModelUrl(body: 'masculine' | 'feminine'): string {
  return `/models/body-${body}.glb`;
}

/** Spanish noun for each zone, for the labels. */
export const BODY_ZONE_NOUN: Readonly<Record<string, string>> = {
  chest: 'el pecho',
  sternum: 'el esternón',
  stomach: 'el abdomen',
  ribs: 'las costillas',
  hip: 'la cadera',
  upper_back: 'la espalda alta',
  lower_back: 'la zona lumbar',
  spine: 'la columna',
  shoulder: 'el hombro',
  collarbone: 'la clavícula',
  neck: 'el cuello',
  behind_ear: 'detrás de la oreja',
  hand: 'la mano',
  foot: 'el pie',
  thigh_front: 'el muslo',
  thigh_outer: 'el muslo',
  upper_arm_inner: 'el brazo',
  upper_arm_outer: 'el brazo',
  wrist_inner: 'la muñeca',
  wrist_outer: 'la muñeca',
  finger: 'el dedo',
};

export const BODY_NOTICE =
  'Vista orientativa sobre un cuerpo de referencia, no el tuyo. El tamaño del diseño es real en el centro; donde la piel se curva, el dibujo se estira.';

export const COMPLEX_NOTICE =
  'Aquí la piel se curva en varias direcciones: el dibujo se deforma más de lo que lo hará en tu piel. Tómalo como una idea.';

/** True for every zone the whole-body viewer serves: all but the limb viewer's. */
export function isBodyZone(zone: string | undefined | null): zone is string {
  return Boolean(zone && zone in BODY_ZONE_NOUN && !isLimbZone(zone));
}

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n));

/** Read and check the model's extras; a model that does not say what it is is refused. */
export function readBodyModel(extras: unknown): BodyModel {
  const e = extras as { units?: unknown; heightMm?: unknown; zones?: unknown } | null;
  if (!e || e.units !== 'mm' || typeof e.heightMm !== 'number' || typeof e.zones !== 'object')
    throw new Error('Not a reference body model.');
  const zones = e.zones as Record<string, BodyZoneModel>;
  for (const [name, zone] of Object.entries(zones)) {
    const ok =
      (zone.mode === 'plane' || zone.mode === 'cylinder') &&
      [zone.origin, zone.normal, zone.up, zone.right, zone.surface].every(isVec3);
    if (!ok) throw new Error(`Zone ${name} is malformed.`);
  }
  return { heightMm: e.heightMm, zones };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * The design coordinate of a point of skin: the shader's twin. `[u, v]` in [0, 1] when the point
 * is under the design (u across, v down from its top), or null.
 */
export function designCoordinate(
  zone: BodyZoneModel,
  point: Vec3,
  normal: Vec3,
  placement: BodyPlacement,
  mirror: 1 | -1 = 1,
): [number, number] | null {
  const v = sub(point, zone.origin);
  let x: number;
  let y: number;
  if (zone.mode === 'plane') {
    const depth = dot(v, zone.normal);
    if (depth < -(zone.behindMm ?? 140) || depth > (zone.frontMm ?? 40)) return null;
    if (dot(normal, zone.normal) < 0.15) return null;
    x = dot(v, zone.right);
    y = dot(v, zone.up);
  } else {
    y = dot(v, zone.up);
    const perp: Vec3 = [v[0] - zone.up[0] * y, v[1] - zone.up[1] * y, v[2] - zone.up[2] * y];
    const r = Math.hypot(...perp);
    if (r > (zone.radiusMm ?? 80)) return null;
    x = Math.atan2(dot(perp, zone.right), dot(perp, zone.normal)) * r;
  }
  x *= mirror;
  const dx = x - placement.xMm;
  const dy = y - placement.yMm;
  const a = (placement.angle * Math.PI) / 180;
  // Undo the design's clockwise turn as seen from outside (x right, y up).
  const qx = dx * Math.cos(a) - dy * Math.sin(a);
  const qy = dx * Math.sin(a) + dy * Math.cos(a);
  const u = qx / placement.widthMm + 0.5;
  const w = 0.5 - qy / placement.heightMm;
  return u >= 0 && u <= 1 && w >= 0 && w <= 1 ? [u, w] : null;
}

/** The design starts centred on its zone, upright, at its real size. */
export function defaultBodyPlacement(size: { widthMm: number; heightMm: number }): BodyPlacement {
  return { xMm: 0, yMm: 0, angle: 0, widthMm: size.widthMm, heightMm: size.heightMm };
}

/** How far the client may move the design from the zone's centre, mm, each way. */
export function moveRange(
  zone: BodyZoneModel,
  size: { widthMm: number; heightMm: number },
): { x: number; y: number } {
  const reach = zone.mode === 'cylinder' ? (zone.lengthMm ?? 300) / 2 : 250;
  const across = zone.mode === 'cylinder' ? Math.PI * (zone.radiusMm ?? 80) * 0.6 : 250;
  return {
    x: Math.round(Math.max(20, across)),
    y: Math.round(Math.max(20, reach - Math.min(size.heightMm, reach) / 4)),
  };
}

/** How far the camera stands from the zone so the whole design and its surroundings show. */
export function viewDistance(size: { widthMm: number; heightMm: number }): number {
  return Math.min(2600, Math.max(380, Math.max(size.widthMm, size.heightMm) * 2.6 + 220));
}
