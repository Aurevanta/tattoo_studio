import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WRAP_REGIONS } from '@tattoo/contracts';

import {
  band,
  defaultPlacement,
  designCoordinate,
  heightRange,
  isLimbZone,
  LIMBS,
  limbOf,
  nearestView,
  perimeterAt,
  readLimbModel,
  sleeveNote,
  wrapFraction,
  type LimbModel,
  type LimbPlacement,
} from './limb-wrap';

// TASK-0102, TASK-0103: the maths the 3D preview's shader runs, and the reference limbs it runs on.

const model: LimbModel = {
  limb: 'leg',
  proximalMm: 380,
  topMm: 450,
  endMm: -72,
  bellyMm: 265,
  circumferenceMm: { proximal: 330, belly: 344, distal: 204, distalAtMm: 60 },
};
const forearm: LimbModel = {
  limb: 'forearm',
  proximalMm: 226,
  topMm: 286,
  endMm: -168,
  bellyMm: 181,
  circumferenceMm: { proximal: 217, belly: 218, distal: 136, distalAtMm: 30 },
};
const back: LimbPlacement = { around: 0.5, heightMm: 250, widthMm: 80, lengthMm: 150 };

describe('where a point of skin samples the design (TASK-0102/AC-002)', () => {
  it('puts the design centre at its placement', () => {
    expect(designCoordinate(0.5, 250, 344, back)).toEqual({ u: 0.5, v: 0.5 });
  });

  it('keeps the width in millimetres of skin, not in angle', () => {
    // 40 mm of arc from the centre is the design's edge on a 344 mm leg and on a 204 mm one.
    for (const perimeter of [344, 204]) {
      const edge = designCoordinate(0.5 + 40 / perimeter, 250, perimeter, back)!;
      expect(edge.u).toBeCloseTo(1, 6);
    }
    expect(designCoordinate(0.5 + 41 / 344, 250, 344, back)).toBeNull();
  });

  it('runs the design top towards the knee', () => {
    expect(designCoordinate(0.5, 250 + 75, 344, back)!.v).toBeCloseTo(0, 6);
    expect(designCoordinate(0.5, 250 - 75, 344, back)!.v).toBeCloseTo(1, 6);
    expect(designCoordinate(0.5, 250 + 76, 344, back)).toBeNull();
  });

  it('crosses the front of the leg without a seam', () => {
    const front = { ...back, around: 0 };
    const before = designCoordinate(0.999, 250, 344, front)!;
    const after = designCoordinate(0.001, 250, 344, front)!;
    expect(after.u - before.u).toBeCloseTo((0.002 * 344) / 80, 6);
  });

  it('mirrors the design back on the right leg, so it reads the right way round', () => {
    const left = designCoordinate(0.52, 250, 344, back, 'left')!;
    const right = designCoordinate(0.52, 250, 344, back, 'right')!;
    expect(left.u + right.u).toBeCloseTo(1, 6);
    expect(left.v).toBe(right.v);
  });

  it('lays each row of a sleeve once round the limb at its own height (TASK-0105)', () => {
    const sleeve = { ...back, widthMm: 344, lengthMm: 300, wraps: true };
    // A quarter turn from the centre is a quarter of the design, on a wide or a narrow row alike.
    for (const perimeter of [344, 204]) {
      expect(designCoordinate(0.75, 250, perimeter, sleeve)!.u).toBeCloseTo(0.75, 9);
      expect(designCoordinate(0.75, 250, perimeter, sleeve, 'right')!.u).toBeCloseTo(0.25, 9);
    }
    // The whole turn is the whole design: nothing is cut off on a narrow row.
    expect(designCoordinate(0.0001, 250, 204, sleeve)).not.toBeNull();
    // Without `wraps`, millimetres across the skin: a narrow row reaches less of the design.
    expect(designCoordinate(0.9, 250, 204, { ...sleeve, wraps: false })!.u).toBeCloseTo(
      (0.4 * 204) / 344 + 0.5,
      9,
    );
  });

  it('says how far round the leg a design reaches', () => {
    expect(wrapFraction(86, 344)).toBeCloseTo(0.25, 6);
    expect(wrapFraction(344, 344)).toBe(1);
  });
});

describe('what the summary says of a sleeve (TASK-0104)', () => {
  it('says it goes round, its size and that it counts as two designs', () => {
    const leg = sleeveNote(
      { bodyPart: 'calf', orientation: 'wrapping' },
      { widthMm: 344, heightMm: 310 },
    );
    expect(leg).toContain('la pierna entera');
    expect(leg).toContain('34,4 × 31 cm');
    expect(leg).toContain('2 diseños');
    const arm = sleeveNote(
      { bodyPart: 'outer_forearm', orientation: 'wrapping' },
      { widthMm: 255, heightMm: 215 },
    );
    expect(arm).toContain('el antebrazo entero');
  });

  it('says nothing of a band or of an ordinary design', () => {
    expect(sleeveNote({ bodyPart: 'calf', orientation: 'wrapping' }, { widthMm: 120 })).toBeNull();
    expect(sleeveNote({ bodyPart: 'calf', orientation: 'vertical' }, { widthMm: 344 })).toBeNull();
    expect(sleeveNote(undefined, undefined)).toBeNull();
  });
});

describe('where a design starts', () => {
  it('puts a calf piece on the back of the calf, a shin piece in front', () => {
    expect(defaultPlacement('calf', model, { widthMm: 80, heightMm: 150 })).toMatchObject({
      around: 0.5,
      heightMm: 265,
    });
    expect(defaultPlacement('shin', model, { widthMm: 60, heightMm: 120 }).around).toBe(0);
    expect(defaultPlacement('ankle', model, { widthMm: 50, heightMm: 50 }).around).toBe(0.25);
  });

  it('keeps the whole design between the ankle bone and the knee', () => {
    const tall = defaultPlacement('calf', model, { widthMm: 80, heightMm: 300 });
    const range = heightRange(model, 300);
    expect(tall.heightMm).toBeLessThanOrEqual(range.max);
    expect(tall.heightMm + 150).toBeLessThanOrEqual(model.proximalMm - 30 + 1e-9);
    expect(tall.heightMm - 150).toBeGreaterThanOrEqual(40 - 1e-9);
  });

  it('centres a design longer than the lower leg instead of failing', () => {
    const range = heightRange(model, 400);
    expect(range.min).toBe(range.max);
  });

  it('names the nearest view and the zones it covers (TASK-0103)', () => {
    expect(nearestView('leg', 0.27).key).toBe('outside');
    expect(nearestView('leg', 0.97).key).toBe('front');
    expect(nearestView('forearm', 0.52).label).toBe('Exterior');
    expect(isLimbZone('calf')).toBe(true);
    expect(isLimbZone('inner_forearm')).toBe(true);
    expect(isLimbZone('upper_arm_outer')).toBe(false);
    expect(isLimbZone('constructor')).toBe(false);
    expect(isLimbZone(undefined)).toBe(false);
    expect(limbOf('outer_forearm')).toBe('forearm');
    expect(limbOf('shin')).toBe('leg');
  });

  it('names the sides as the contracts do, so the stencil panels match the 3D view (TASK-0105)', () => {
    for (const [limb, region] of [
      ['leg', 'lower_leg'],
      ['forearm', 'forearm'],
    ] as const) {
      expect(LIMBS[limb].views.map(({ around, label }) => ({ around, label }))).toEqual(
        WRAP_REGIONS[region]!.views,
      );
    }
    for (const [zone, around] of Object.entries({
      ...WRAP_REGIONS['lower_leg']!.zoneAround,
      ...WRAP_REGIONS['forearm']!.zoneAround,
    }))
      expect(defaultPlacement(zone as 'calf', model, { widthMm: 60, heightMm: 60 }).around).toBe(
        around,
      );
  });

  it('starts a forearm piece on its own side, between the wrist and the elbow (TASK-0103)', () => {
    const inner = defaultPlacement('inner_forearm', forearm, { widthMm: 60, heightMm: 120 });
    const outer = defaultPlacement('outer_forearm', forearm, { widthMm: 60, heightMm: 120 });
    expect(inner.around).toBe(0);
    expect(outer.around).toBe(0.5);
    expect(inner.heightMm - 60).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(inner.heightMm + 60).toBeLessThanOrEqual(226 - 30 + 1e-9);
  });

  it('centres a design that goes all the way round on the band (TASK-0104)', () => {
    const sleeve = defaultPlacement('calf', model, { widthMm: 344, heightMm: 300 }, true);
    const { low, high } = band(model);
    expect(sleeve.heightMm).toBeCloseTo((low + high) / 2, 6);
    expect(sleeve.around).toBe(0.5);
    expect(sleeve.wraps).toBe(true);
  });

  it('interpolates the perimeter between the measured heights', () => {
    expect(perimeterAt(forearm, 10)).toBe(136);
    expect(perimeterAt(model, 0)).toBe(204);
    expect(perimeterAt(model, 265)).toBe(344);
    expect(perimeterAt(model, 1000)).toBe(330);
  });

  it('refuses a model without its measurements', () => {
    expect(() => readLimbModel({})).toThrow();
    expect(() => readLimbModel({ ...model, proximalMm: 'x' })).toThrow();
    expect(() => readLimbModel({ ...model, limb: 'arm' })).toThrow();
  });
});

// An adult reference limb: proximal joint, widest and distal circumferences, mm (TASK-0103/AC-001).
const ADULT = {
  leg: { file: 'lower-leg.glb', length: [300, 450], belly: [280, 450], distal: [170, 280] },
  forearm: { file: 'forearm.glb', length: [200, 300], belly: [180, 320], distal: [120, 200] },
} as const;

describe.each(Object.entries(ADULT))('the reference %s model (TASK-0102/AC-001)', (limb, adult) => {
  const glb = readFileSync(
    fileURLToPath(new URL(`../../public/models/${adult.file}`, import.meta.url)),
  );
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
    scenes: { extras: unknown }[];
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { bufferView: number; count: number; componentType: number }[];
    bufferViews: { byteOffset: number; byteLength: number }[];
  };
  const binStart = 20 + jsonLength + 8;
  const read = (accessor: number, width: number): Float32Array => {
    const view = gltf.bufferViews[gltf.accessors[accessor]!.bufferView]!;
    const bytes = glb.subarray(
      binStart + view.byteOffset,
      binStart + view.byteOffset + view.byteLength,
    );
    return new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ).subarray(0, gltf.accessors[accessor]!.count * width);
  };
  const attributes = gltf.meshes[0]!.primitives[0]!.attributes;

  it('carries its measurements, its licence and the attributes the shader reads', () => {
    const extras = gltf.scenes[0]!.extras as { licence: string; source: string };
    const leg = readLimbModel(extras);
    expect(leg.limb).toBe(limb);
    expect(extras.licence).toBe('CC0 1.0 Universal');
    expect(extras.source).toContain('MakeHuman');
    expect(Object.keys(attributes).sort()).toEqual(
      ['NORMAL', 'POSITION', '_HEIGHT', '_PERIM', '_RING'].sort(),
    );
    expect(leg.proximalMm).toBeGreaterThan(adult.length[0]);
    expect(leg.proximalMm).toBeLessThan(adult.length[1]);
    expect(leg.circumferenceMm.belly).toBeGreaterThan(adult.belly[0]);
    expect(leg.circumferenceMm.belly).toBeLessThan(adult.belly[1]);
    expect(leg.circumferenceMm.distal).toBeGreaterThan(adult.distal[0]);
    expect(leg.circumferenceMm.distal).toBeLessThan(adult.distal[1]);
  });

  it('gives every vertex a unit ring vector and the perimeter of its height', () => {
    const ring = read(attributes._RING!, 2);
    const perim = read(attributes._PERIM!, 1);
    const height = read(attributes._HEIGHT!, 1);
    const leg = readLimbModel(gltf.scenes[0]!.extras);
    for (let i = 0; i < perim.length; i++) {
      expect(Math.hypot(ring[2 * i]!, ring[2 * i + 1]!)).toBeCloseTo(1, 4);
      if (Math.abs(height[i]! - leg.bellyMm) < 2)
        expect(perim[i]! / leg.circumferenceMm.belly).toBeCloseTo(1, 1);
    }
  });

  it('agrees with an independent slice of its own surface where it is widest', () => {
    // Slice the triangles at the calf height and measure the outline, sorted by angle.
    const position = read(attributes.POSITION!, 3);
    const indexAccessor = gltf.accessors[gltf.meshes[0]!.primitives[0]!.indices]!;
    const view = gltf.bufferViews[indexAccessor.bufferView]!;
    const raw = glb.subarray(
      binStart + view.byteOffset,
      binStart + view.byteOffset + view.byteLength,
    );
    const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const index =
      indexAccessor.componentType === 5123 ? new Uint16Array(copy) : new Uint32Array(copy);
    const leg = readLimbModel(gltf.scenes[0]!.extras);
    const h = leg.bellyMm;
    const points: [number, number][] = [];
    for (let t = 0; t < indexAccessor.count; t += 3) {
      for (const [a, b] of [
        [index[t]!, index[t + 1]!],
        [index[t + 1]!, index[t + 2]!],
        [index[t + 2]!, index[t]!],
      ] as const) {
        const ya = position[3 * a + 1]!;
        const yb = position[3 * b + 1]!;
        if ((ya - h) * (yb - h) >= 0) continue;
        const k = (h - ya) / (yb - ya);
        points.push([
          position[3 * a]! + k * (position[3 * b]! - position[3 * a]!),
          position[3 * a + 2]! + k * (position[3 * b + 2]! - position[3 * a + 2]!),
        ]);
      }
    }
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
    points.sort((p, q) => Math.atan2(p[0] - cx, p[1] - cz) - Math.atan2(q[0] - cx, q[1] - cz));
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const [x0, z0] = points[i]!;
      const [x1, z1] = points[(i + 1) % points.length]!;
      perimeter += Math.hypot(x1 - x0, z1 - z0);
    }
    expect(
      Math.abs(perimeter - leg.circumferenceMm.belly) / leg.circumferenceMm.belly,
    ).toBeLessThan(0.005);
  });
});
