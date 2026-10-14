import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  defaultPlacement,
  designCoordinate,
  heightRange,
  isLegZone,
  nearestView,
  perimeterAt,
  readLegModel,
  wrapFraction,
  type LegModel,
  type LegPlacement,
} from './leg-wrap';

// TASK-0101: the maths the 3D preview's shader runs, and the reference leg it runs on.

const model: LegModel = {
  kneeMm: 380,
  topMm: 450,
  soleMm: -72,
  calfMm: 265,
  circumferenceMm: { belowKnee: 330, calf: 344, ankle: 204 },
};
const back: LegPlacement = { around: 0.5, heightMm: 250, widthMm: 80, lengthMm: 150 };

describe('where a point of skin samples the design (TASK-0101/AC-002)', () => {
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

  it('says how far round the leg a design reaches', () => {
    expect(wrapFraction(86, 344)).toBeCloseTo(0.25, 6);
    expect(wrapFraction(344, 344)).toBe(1);
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
    expect(tall.heightMm + 150).toBeLessThanOrEqual(model.kneeMm - 30 + 1e-9);
    expect(tall.heightMm - 150).toBeGreaterThanOrEqual(40 - 1e-9);
  });

  it('centres a design longer than the lower leg instead of failing', () => {
    const range = heightRange(model, 400);
    expect(range.min).toBe(range.max);
  });

  it('names the nearest view and the zones it covers', () => {
    expect(nearestView(0.27).key).toBe('outside');
    expect(nearestView(0.97).key).toBe('front');
    expect(isLegZone('calf')).toBe(true);
    expect(isLegZone('inner_forearm')).toBe(false);
    expect(isLegZone(undefined)).toBe(false);
  });

  it('interpolates the perimeter between the measured heights', () => {
    expect(perimeterAt(model, 0)).toBe(204);
    expect(perimeterAt(model, 265)).toBe(344);
    expect(perimeterAt(model, 1000)).toBe(330);
  });

  it('refuses a model without its measurements', () => {
    expect(() => readLegModel({})).toThrow();
    expect(() => readLegModel({ ...model, kneeMm: 'x' })).toThrow();
  });
});

describe('the reference leg model (TASK-0101/AC-001)', () => {
  const glb = readFileSync(
    fileURLToPath(new URL('../../public/models/lower-leg.glb', import.meta.url)),
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
    const leg = readLegModel(extras);
    expect(extras.licence).toBe('CC0 1.0 Universal');
    expect(extras.source).toContain('MakeHuman');
    expect(Object.keys(attributes).sort()).toEqual(
      ['NORMAL', 'POSITION', '_HEIGHT', '_PERIM', '_RING'].sort(),
    );
    // An adult lower leg: knee 30–45 cm above the ankle, calf 28–45 cm round, ankle 17–28 cm.
    expect(leg.kneeMm).toBeGreaterThan(300);
    expect(leg.kneeMm).toBeLessThan(450);
    expect(leg.circumferenceMm.calf).toBeGreaterThan(280);
    expect(leg.circumferenceMm.calf).toBeLessThan(450);
    expect(leg.circumferenceMm.ankle).toBeGreaterThan(170);
    expect(leg.circumferenceMm.ankle).toBeLessThan(280);
  });

  it('gives every vertex a unit ring vector and the perimeter of its height', () => {
    const ring = read(attributes._RING!, 2);
    const perim = read(attributes._PERIM!, 1);
    const height = read(attributes._HEIGHT!, 1);
    const leg = readLegModel(gltf.scenes[0]!.extras);
    for (let i = 0; i < perim.length; i++) {
      expect(Math.hypot(ring[2 * i]!, ring[2 * i + 1]!)).toBeCloseTo(1, 4);
      if (Math.abs(height[i]! - leg.calfMm) < 2)
        expect(perim[i]! / leg.circumferenceMm.calf).toBeCloseTo(1, 1);
    }
  });

  it('agrees with an independent slice of its own surface at the calf', () => {
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
    const leg = readLegModel(gltf.scenes[0]!.extras);
    const h = leg.calfMm;
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
    expect(Math.abs(perimeter - leg.circumferenceMm.calf) / leg.circumferenceMm.calf).toBeLessThan(
      0.005,
    );
  });
});
