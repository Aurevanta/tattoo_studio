import { describe, expect, it } from 'vitest';

import { mockupOffset, SKIN_FRAME_FRACTION, toMockupPlacement, visibleSize } from './mockup-pose';

const box = { left: 100, top: 50, width: 200, height: 400, canvasWidth: 500, canvasHeight: 600 };

describe('the 3D views read the mockup (TASK-0111)', () => {
  it('draw the visible artwork at the brief height, as the mockup does', () => {
    expect(visibleSize({ widthMm: 150, heightMm: 300 }, box, false)).toEqual({
      widthMm: 150,
      heightMm: 300,
    });
    expect(visibleSize({ widthMm: 200, heightMm: 240 }, box, false)).toEqual({
      widthMm: 120,
      heightMm: 240,
    });
    // A calibrated photo or a sleeve draws the whole canvas.
    expect(visibleSize({ widthMm: 200, heightMm: 240 }, box, true)).toEqual({
      widthMm: 200,
      heightMm: 240,
    });
  });

  it('place the design where the mockup does, in mm from the zone centre', () => {
    const frame: [number, number] = [1000, 1500];
    // A trimmed box (sourceCropPx) centred on the plate: no offset.
    const centred = {
      xPx: 400,
      yPx: 550,
      widthPx: 200,
      heightPx: 400,
      scaleCalibrated: false,
      sourceCropPx: {},
    };
    expect(mockupOffset({ transform: centred, frame }, box, 400)).toEqual({
      xMm: 0,
      yMm: 0,
      angle: 0,
    });
    // A tenth of the frame higher and to the right: a tenth of the zone's frame in mm.
    const moved = { ...centred, xPx: 500, yPx: 400 };
    const frameMm = 400 / SKIN_FRAME_FRACTION;
    expect(mockupOffset({ transform: moved, frame }, box, 400)).toEqual({
      xMm: Math.round(0.1 * frameMm * (1000 / 1500)),
      yMm: Math.round(0.1 * frameMm),
      angle: 0,
    });
  });

  it('take the turn of a placement saved from the editor', () => {
    const transform = {
      xPx: 0,
      yPx: 0,
      widthPx: 1,
      heightPx: 1,
      scaleCalibrated: false,
      placement: { centreX: 0.5, centreY: 0.5, width: 0.2, height: 0.3, angle: -30 },
    };
    expect(mockupOffset({ transform, frame: [800, 1200] }, box, 300)).toEqual({
      xMm: 0,
      yMm: 0,
      angle: -30,
    });
    expect(mockupOffset({ transform, frame: [0, 0] }, box, 300)).toBeUndefined();
  });
});

describe('a 3D adjustment goes back to the mockup (TASK-0112)', () => {
  const frame: [number, number] = [1000, 1500];
  const transform = {
    xPx: 450,
    yPx: 300,
    widthPx: 200,
    heightPx: 400,
    scaleCalibrated: false,
    sourceCropPx: {},
  };

  it('is the inverse of where the 3D view opened', () => {
    // The offsets are whole millimetres, so the way back is within a millimetre.
    const at = mockupOffset({ transform, frame }, box, 400)!;
    const back = toMockupPlacement({ transform, frame }, box, 400, at, [1, 1]);
    expect(back.centreX).toBeCloseTo(0.55, 2);
    expect(back.centreY).toBeCloseTo(1 / 3, 2);
    expect(back.width).toBeCloseTo(0.2, 4);
    expect(back.height).toBeCloseTo(0.2667, 4);
    expect(back.angle).toBe(0);
  });

  it('carries the move, the turn and the size', () => {
    const frameMm = 400 / SKIN_FRAME_FRACTION;
    const moved = toMockupPlacement(
      { transform, frame },
      box,
      400,
      { xMm: 0, yMm: -0.1 * frameMm, angle: 15 },
      [1.2, 1],
    );
    expect(moved.centreX).toBe(0.5);
    expect(moved.centreY).toBeCloseTo(0.6, 3);
    expect(moved.angle).toBe(15);
    expect(moved.width).toBeCloseTo(0.24, 3);
    // A limb view does not move across: the mockup's own centre is kept.
    expect(
      toMockupPlacement({ transform, frame }, box, 400, { yMm: 0, angle: 0 }, [1, 1]).centreX,
    ).toBe(0.55);
  });
});
