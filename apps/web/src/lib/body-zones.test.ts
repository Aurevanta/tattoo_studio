import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BODY_ZONE_SPANS } from '@tattoo/contracts';

import {
  BODY_ZONE_NOUN,
  defaultBodyPlacement,
  designCoordinate,
  isBodyZone,
  moveRange,
  readBodyModel,
  viewDistance,
  type BodyZoneModel,
} from './body-zones';
import { isLimbZone } from './limb-wrap';

/** The JSON chunk of a GLB: its scene extras are what the viewer reads. */
function glbExtras(path: string): unknown {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  return json.scenes[0].extras;
}

const plane: BodyZoneModel = {
  mode: 'plane',
  origin: [0, 1000, 100],
  normal: [0, 0, 1],
  up: [0, 1, 0],
  right: [1, 0, 0],
  surface: [0, 1000, 100],
  behindMm: 140,
  frontMm: 40,
  paired: true,
  complex: false,
};
const out: [number, number, number] = [0, 0, 1];
const size = { widthMm: 100, heightMm: 200 };

describe('every tattooable zone has a 3D view (TASK-0109, ADR-0037)', () => {
  it('splits the brief zones between the limb viewer and the body', () => {
    const zones = Object.keys(BODY_ZONE_SPANS);
    expect(zones).toHaveLength(26);
    for (const zone of zones) expect(isLimbZone(zone) !== isBodyZone(zone)).toBe(true);
    expect(zones.filter(isBodyZone)).toHaveLength(21);
    expect(isBodyZone('calf')).toBe(false);
    expect(isBodyZone(undefined)).toBe(false);
  });

  it('the committed body carries all 21 zones, its source and its licence', () => {
    const extras = glbExtras(resolve(__dirname, '../../public/models/body.glb')) as {
      source: string;
      licence: string;
    };
    expect(extras.source).toMatch(/MakeHuman base mesh hm08/);
    expect(extras.licence).toBe('CC0 1.0 Universal');
    const model = readBodyModel(extras);
    expect(model.heightMm).toBeGreaterThan(1500);
    expect(Object.keys(model.zones).sort()).toEqual(
      Object.keys(BODY_ZONE_NOUN).filter(isBodyZone).sort(),
    );
    for (const zone of Object.values(model.zones)) {
      // Unit vectors, and the camera's target on the skin.
      for (const v of [zone.normal, zone.up, zone.right])
        expect(Math.hypot(...v)).toBeCloseTo(1, 2);
    }
    expect(() => readBodyModel({ units: 'cm' })).toThrow();
  });
});

describe('where skin samples the design, as the shader does', () => {
  it('lays a plane decal in millimetres round the zone centre', () => {
    const p = defaultBodyPlacement(size);
    expect(designCoordinate(plane, [0, 1000, 100], out, p)).toEqual([0.5, 0.5]);
    // 40 mm right and 80 mm up of the centre: four tenths across, a tenth from the top.
    const [u, v] = designCoordinate(plane, [40, 1080, 100], out, p)!;
    expect(u).toBeCloseTo(0.9);
    expect(v).toBeCloseTo(0.1);
    expect(designCoordinate(plane, [60, 1000, 100], out, p)).toBeNull();
  });

  it('never reaches skin facing away or far behind the zone', () => {
    const p = defaultBodyPlacement(size);
    expect(designCoordinate(plane, [0, 1000, 100], [0, 0, -1], p)).toBeNull();
    expect(designCoordinate(plane, [0, 1000, -60], out, p)).toBeNull();
    expect(designCoordinate(plane, [0, 1000, 160], out, p)).toBeNull();
  });

  it('moves, turns and mirrors the design', () => {
    const moved = { ...defaultBodyPlacement(size), xMm: 30, yMm: -20 };
    expect(designCoordinate(plane, [30, 980, 100], out, moved)).toEqual([0.5, 0.5]);
    // Turned a quarter clockwise: the design's top now points right.
    const turned = { ...defaultBodyPlacement(size), angle: 90 };
    const [, v] = designCoordinate(plane, [80, 1000, 100], out, turned)!;
    expect(v).toBeCloseTo(0.1);
    const [u] = designCoordinate(plane, [40, 1000, 100], out, defaultBodyPlacement(size), -1)!;
    expect(u).toBeCloseTo(0.1);
  });

  it('measures round a limb along the skin at its own radius', () => {
    const limb: BodyZoneModel = {
      ...plane,
      mode: 'cylinder',
      origin: [0, 500, 0],
      normal: [0, 0, 1],
      up: [0, 1, 0],
      right: [1, 0, 0],
      radiusMm: 90,
    };
    const p = defaultBodyPlacement(size);
    expect(designCoordinate(limb, [0, 500, 60], out, p)).toEqual([0.5, 0.5]);
    // A quarter of a radian round a 60 mm limb is 15 mm of skin.
    const a = 0.25;
    const [u] = designCoordinate(limb, [60 * Math.sin(a), 500, 60 * Math.cos(a)], out, p)!;
    expect(u).toBeCloseTo(0.5 + 15 / 100);
    expect(designCoordinate(limb, [0, 500, 120], out, p)).toBeNull();
  });

  it('frames and bounds the view sensibly', () => {
    expect(viewDistance({ widthMm: 20, heightMm: 30 })).toBe(380);
    expect(viewDistance({ widthMm: 300, heightMm: 2000 })).toBe(2600);
    const range = moveRange(plane, size);
    expect(range.x).toBeGreaterThan(0);
    expect(range.y).toBeGreaterThan(0);
  });
});
