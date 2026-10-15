import { describe, expect, it } from 'vitest';

import {
  axisFactors,
  printSizeOf,
  resizesPrint,
  scaleFactors,
  stretchOf,
  UNCHANGED_FACTORS,
} from './design-resize';

const print = { widthMm: 100, heightMm: 200 };

describe('size in the 3D views follows the mockup editor rules (TASK-0112)', () => {
  it('turns factors into the print size, as the worker rounds it', () => {
    expect(printSizeOf(print, [1.2, 1])).toEqual({ widthMm: 120, heightMm: 200 });
    expect(resizesPrint(UNCHANGED_FACTORS)).toBe(false);
    expect(resizesPrint([1.2, 1])).toBe(true);
  });

  it('scales both axes and keeps the print tattooable', () => {
    expect(scaleFactors(1.5, UNCHANGED_FACTORS, print)).toEqual([1.5, 1.5]);
    expect(printSizeOf(print, scaleFactors(100, UNCHANGED_FACTORS, print)).heightMm).toBe(600);
    expect(printSizeOf(print, scaleFactors(0.001, UNCHANGED_FACTORS, print)).widthMm).toBe(5);
  });

  it('stretches one axis by 25 % at most, counting earlier versions', () => {
    expect(stretchOf(axisFactors('width', 1000, UNCHANGED_FACTORS, print))).toBeCloseTo(1.25);
    expect(stretchOf(axisFactors('height', 1000, UNCHANGED_FACTORS, print))).toBeCloseTo(0.75);
    const already = axisFactors('width', 1000, UNCHANGED_FACTORS, print, 1.2);
    expect(stretchOf(already, 1.2)).toBeCloseTo(1.25);
  });
});
