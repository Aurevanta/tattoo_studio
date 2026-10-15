import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changed,
  cylinderSource,
  forSaving,
  initialPlacement,
  MAX_STRETCH,
  MIN_STRETCH,
  printSize,
  resizes,
  settle,
  stretchOf,
  withAxis,
  withScale,
  workerFrame,
  type EditorTransform,
} from './mockup-editor';

const transform: EditorTransform = {
  xPx: 100,
  yPx: 50,
  widthPx: 200,
  heightPx: 400,
  scaleCalibrated: false,
};
const size = { widthMm: 100, heightMm: 200 };

describe('the live mockup editor (TASK-0107, ADR-0036)', () => {
  it('starts where the worker composed the design, as parent_placement reads it', () => {
    expect(initialPlacement(transform, [1000, 1000])).toEqual({
      centreX: 0.2,
      centreY: 0.25,
      width: 0.2,
      height: 0.4,
      angle: 0,
    });
    // A saved placement is taken as it was recorded.
    const placement = { centreX: 0.5, centreY: 0.5, width: 0.3, height: 0.2, angle: 30 };
    expect(initialPlacement({ ...transform, placement }, [1000, 1000])).toEqual(placement);
  });

  it('narrows a box drawn with its white margins to the visible artwork', () => {
    const visible = {
      left: 100,
      top: 0,
      width: 200,
      height: 100,
      canvasWidth: 400,
      canvasHeight: 100,
    };
    const box = { xPx: 100, yPx: 100, widthPx: 400, heightPx: 200, scaleCalibrated: false };
    const start = initialPlacement(box, [1000, 1000], visible);
    expect(start.width).toBeCloseTo(0.2);
    expect(start.centreX).toBeCloseTo(0.3);
    // Already trimmed, or calibrated: the box is what was drawn.
    expect(initialPlacement({ ...box, sourceCropPx: {} }, [1000, 1000], visible).width).toBe(0.4);
    expect(initialPlacement({ ...box, scaleCalibrated: true }, [1000, 1000], visible).width).toBe(
      0.4,
    );
  });

  it('reads the frame the worker composed on: the background thumbnailed to 2048', () => {
    expect(workerFrame(1024, 1536)).toEqual([1024, 1536]);
    expect(workerFrame(4096, 3072)).toEqual([2048, 1536]);
    expect(workerFrame(3000, 4000)).toEqual([1536, 2048]);
  });

  it('turns the view into millimetres on each axis, as the worker does', () => {
    const start = initialPlacement(transform, [1000, 1000]);
    const wider = { ...start, width: 0.24 };
    expect(printSize(size, start, wider)).toEqual({ widthMm: 120, heightMm: 200 });
    expect(stretchOf(transform, start, wider)).toBeCloseTo(1.2);
    expect(stretchOf({ ...transform, stretch: 1.1 }, start, wider)).toBeCloseTo(1.32);
    expect(resizes(start, wider)).toBe(true);
    expect(resizes(start, { ...start, centreX: 0.6, angle: 45 })).toBe(false);
    expect(changed(start, { ...start, angle: 45 })).toBe(true);
    expect(changed(start, start)).toBe(false);
  });

  it('keeps the stretch within 25 %, counting earlier versions', () => {
    const start = initialPlacement(transform, [1000, 1000]);
    const wide = withAxis('width', 1, transform, size, start, start);
    expect(stretchOf(transform, start, wide)).toBeCloseTo(MAX_STRETCH);
    const tall = withAxis('height', 2, transform, size, start, start);
    expect(stretchOf(transform, start, tall)).toBeCloseTo(MIN_STRETCH);
    const already = { ...transform, stretch: 1.2 };
    const more = withAxis('width', 1, already, size, start, start);
    expect(stretchOf(already, start, more)).toBeCloseTo(MAX_STRETCH);
  });

  it('keeps the size within what can be tattooed', () => {
    const start = initialPlacement(transform, [1000, 1000]);
    const huge = withScale(100, size, start, start);
    expect(printSize(size, start, huge).heightMm).toBeLessThanOrEqual(600);
    const tiny = withScale(0.001, size, start, start);
    expect(printSize(size, start, tiny).widthMm).toBeGreaterThanOrEqual(5);
    // Scaling keeps the proportions it has.
    expect(stretchOf(transform, start, withScale(1.5, size, start, start))).toBeCloseTo(1);
  });

  it('keeps the centre on the frame and the angle within ±180°', () => {
    const start = initialPlacement(transform, [1000, 1000]);
    expect(settle({ ...start, centreX: -0.2, centreY: 1.3 })).toMatchObject({
      centreX: 0,
      centreY: 1,
    });
    expect(settle({ ...start, angle: 190 }).angle).toBe(-170);
    expect(settle({ ...start, angle: 180 }).angle).toBe(180);
    expect(forSaving({ ...start, width: 0.123456 }).width).toBe(0.1235);
  });

  it('wraps on the same cylinder as the worker (`_shape`), point for point', () => {
    // Values from `mockup/engine.py::_shape.source_point` at 200 x 300, curvature 1.05, taper 0.25.
    const expected: [number, number, number, number][] = [
      [10, 20, 14.557578, 19.643621],
      [100, 150, 100.0, 140.892056],
      [170, 280, 184.636941, 279.622826],
      [199, 5, 198.375198, 4.990579],
      [50, 240, 48.328363, 236.54328],
    ];
    for (const [px, py, sx, sy] of expected) {
      const [x, y] = cylinderSource(px, py, 200, 300, 1.05, 0.25);
      expect(x).toBeCloseTo(sx, 4);
      expect(y).toBeCloseTo(sy, 4);
    }
  });

  it('makes no request and serialises nothing while adjusting (ADR-0019)', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
    const EGRESS =
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|RTCPeerConnection|FormData|new\s+Worker\b/;
    for (const source of [read('./mockup-editor.ts'), read('../components/MockupEditor.tsx')]) {
      expect(source).not.toMatch(EGRESS);
      expect(source).not.toMatch(/toDataURL|toBlob/);
    }
    // Its only reads are the result's own skin and master, by asset id.
    const editor = read('../components/MockupEditor.tsx');
    expect([...editor.matchAll(/loadImage\(`([^`]+)`\)/g)].map((m) => m[1])).toEqual([
      '/api/media?id=${background.assetId}',
      '/api/media?id=${artifact.master.assetId}',
    ]);
  });
});
