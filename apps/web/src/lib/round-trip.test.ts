/**
 * Reopening a saved version shows it where and as large as it was saved (TASK-0124).
 *
 * The worker half of the round trip is `services/worker/app/tests/test_round_trip.py`: it saves,
 * restarts and reads the version back, its PDF included. This is the browser half: from what that
 * version's status carries, the mockup editor and the 3D view open at the saved place, turn and
 * millimetres, and nothing would be saved again by opening it.
 */
import { describe, expect, it } from 'vitest';

import { changed, initialPlacement, printSize, type EditorTransform } from './mockup-editor';
import { mockupStart, offsetOf, visibleSize, type MockupPose } from './mockup-pose';

// A version saved from the editor on the calibrated masculine upper-back plate, 225 × 350 mm.
const skin = { widthMm: 432.9, heightMm: 649.4, centreX: 0.5, centreY: 0.43, calibrated: true };
const frame: [number, number] = [1024, 1536];
const size = { widthMm: 225, heightMm: 350 };
// The visible artwork fills its canvas (no white margins).
const box = { left: 0, top: 0, width: 225, height: 350, canvasWidth: 225, canvasHeight: 350 };
// What the worker recorded (`frame_placement`): the visible millimetres over the skin's frame.
const placement = {
  centreX: 0.62,
  centreY: 0.4,
  width: 225 / 432.9,
  height: 350 / 649.4,
  angle: 12,
};
const transform: EditorTransform = {
  xPx: 500,
  yPx: 300,
  widthPx: 240,
  heightPx: 560,
  scaleCalibrated: false,
  placement,
};

describe('a saved version reopens as it was saved (TASK-0124)', () => {
  it('opens the mockup editor at the saved place, turn and size, with nothing to save', () => {
    const start = initialPlacement(transform, frame, box, { size, skin });
    expect(start.centreX).toBeCloseTo(placement.centreX, 6);
    expect(start.centreY).toBeCloseTo(placement.centreY, 6);
    expect(start.angle).toBe(12);
    expect(start.width * skin.widthMm).toBeCloseTo(225, 6);
    expect(start.height * skin.heightMm).toBeCloseTo(350, 6);
    expect(printSize(size, start, start)).toEqual(size);
    expect(changed(start, start)).toBe(false);
  });

  it('opens the 3D view at the same millimetres from the zone centre', () => {
    const pose: MockupPose = { transform, frame, skin, size };
    const start = mockupStart(pose, box);
    expect(offsetOf(pose, start, 366)).toEqual({
      xMm: Math.round(0.12 * 432.9),
      yMm: Math.round(0.03 * 649.4),
      angle: 12,
    });
    expect(visibleSize(size, box, false)).toEqual(size);
  });
});
