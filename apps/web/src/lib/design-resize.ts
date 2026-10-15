/**
 * Size, width and height in the 3D views (TASK-0112), with the live mockup editor's rules
 * (ADR-0036): the print millimetres follow the view on each axis, the drawing's proportions move
 * by 25 % at most (counting earlier versions), and a calibrated photo keeps its scale.
 *
 * The views keep two factors against the size they opened with, so the same factors give the
 * size drawn in 3D and the size that would be printed.
 */
import { MAX_MM, MAX_STRETCH, MIN_MM, MIN_STRETCH } from './mockup-editor';

/** Scale on each axis against the size the view opened with; [1, 1] is unchanged. */
export type Factors = readonly [number, number];

export const UNCHANGED_FACTORS: Factors = [1, 1];

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** The print size those factors give, rounded as the worker rounds it. */
export function printSizeOf(
  print: { widthMm: number; heightMm: number },
  [sx, sy]: Factors,
): { widthMm: number; heightMm: number } {
  return { widthMm: round1(print.widthMm * sx), heightMm: round1(print.heightMm * sy) };
}

/** How far the drawing's proportions have moved, with the earlier versions' stretch. */
export function stretchOf([sx, sy]: Factors, base = 1): number {
  return base * (sx / sy);
}

/** Both axes by `factor` of the current size, keeping the print within what can be tattooed. */
export function scaleFactors(
  factor: number,
  now: Factors,
  print: { widthMm: number; heightMm: number },
): Factors {
  const [sx, sy] = now;
  const low = Math.max(MIN_MM / (print.widthMm * sx), MIN_MM / (print.heightMm * sy));
  const high = Math.min(MAX_MM / (print.widthMm * sx), MAX_MM / (print.heightMm * sy));
  const f = clamp(factor, low, high);
  return [sx * f, sy * f];
}

/**
 * One axis set to a print size in mm, the other kept, within the stretch bound and the brief's
 * millimetre bounds.
 */
export function axisFactors(
  axis: 'width' | 'height',
  printMm: number,
  now: Factors,
  print: { widthMm: number; heightMm: number },
  base = 1,
): Factors {
  const [sx, sy] = now;
  if (axis === 'width') {
    const low = Math.max(MIN_MM / print.widthMm, (MIN_STRETCH / base) * sy);
    const high = Math.min(MAX_MM / print.widthMm, (MAX_STRETCH / base) * sy);
    return [clamp(printMm / print.widthMm, low, high), sy];
  }
  const low = Math.max(MIN_MM / print.heightMm, (base / MAX_STRETCH) * sx);
  const high = Math.min(MAX_MM / print.heightMm, (base / MIN_STRETCH) * sx);
  return [sx, clamp(printMm / print.heightMm, low, high)];
}

/** Whether saving those factors changes the print size. */
export function resizesPrint([sx, sy]: Factors): boolean {
  return Math.abs(sx - 1) > 0.005 || Math.abs(sy - 1) > 0.005;
}
