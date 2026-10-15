/**
 * The live mockup editor (TASK-0107, ADR-0036).
 *
 * The client moves, sizes, stretches and turns the design over the skin it was composed on, and
 * sees it at once. This module holds the arithmetic the worker repeats when the placement is saved
 * (`mockup/placement.py::manual_layout`, `mockup/engine.py::_manual`) and the per-frame drawing.
 *
 * - **The artwork is resampled, never redrawn** (MOCKUP-INV-001). The only transforms are the
 *   placement the client chooses and the same cylinder the worker wraps it on.
 * - **Nothing leaves the device while adjusting** (ADR-0019). It reads pixels and draws them back;
 *   it makes no request. An own photo stays here.
 * - **The millimetres follow the view on each axis.** They are the parent's millimetres scaled,
 *   so on a generated plate they are as orientative as the parent's projection was.
 */

import { applyInk, DEFAULT_FRESHNESS, DEFAULT_SURFACE } from './skin-blend';
import type { ArtworkBox } from './try-on';

/** A placement as `edit.placement` carries it: fractions of the skin image, degrees clockwise. */
export interface EditorPlacement {
  centreX: number;
  centreY: number;
  /** The design before rotation, as fractions of the image's width and height. */
  width: number;
  height: number;
  angle: number;
}

/** The parts of a result's transform the editor reads. */
export interface EditorTransform {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  curvature?: number | undefined;
  taper?: number | undefined;
  surface?: number | undefined;
  freshness?: number | undefined;
  scaleCalibrated: boolean;
  placement?: EditorPlacement | undefined;
  stretch?: number | undefined;
}

export interface Millimetres {
  widthMm: number;
  heightMm: number;
}

/** ADR-0036: the drawing's width-to-height ratio moves by 25 % at most. */
export const MIN_STRETCH = 0.75;
export const MAX_STRETCH = 1.25;
/** Below this a size counts as unchanged, as `UNCHANGED` in the worker. */
export const UNCHANGED = 0.005;
/** The brief's millimetre bounds. */
export const MIN_MM = 5;
export const MAX_MM = 600;
/** The worker composes on the background thumbnailed to this; transforms are in its pixels. */
export const WORKER_FRAME = 2048;
/** The preview draws at most this wide: enough to judge, cheap enough to redraw on every move. */
export const PREVIEW_WIDTH = 900;

/** The frame the worker composed on: the background thumbnailed to 2048, as PIL does. */
export function workerFrame(width: number, height: number): [number, number] {
  const longest = Math.max(width, height);
  if (longest <= WORKER_FRAME) return [width, height];
  return width >= height
    ? [WORKER_FRAME, Math.max(1, Math.round((height * WORKER_FRAME) / width))]
    : [Math.max(1, Math.round((width * WORKER_FRAME) / height)), WORKER_FRAME];
}

/**
 * Where the result's visible artwork sits, as `parent_placement` reads it in the worker. A box
 * drawn from the whole canvas (no `sourceCropPx`) is narrowed to the artwork inside its margins,
 * which is what the editor and a saved placement draw. A calibrated photo draws the whole canvas.
 */
export function initialPlacement(
  transform: EditorTransform & { sourceCropPx?: unknown },
  frame: [number, number],
  visible?: ArtworkBox,
): EditorPlacement {
  if (transform.placement) return { ...transform.placement };
  const [width, height] = frame;
  let { xPx: x, yPx: y, widthPx: w, heightPx: h } = transform;
  if (visible && !transform.sourceCropPx && !transform.scaleCalibrated) {
    x += (w * visible.left) / visible.canvasWidth;
    y += (h * visible.top) / visible.canvasHeight;
    w = (w * visible.width) / visible.canvasWidth;
    h = (h * visible.height) / visible.canvasHeight;
  }
  return {
    centreX: (x + w / 2) / width,
    centreY: (y + h / 2) / height,
    width: w / width,
    height: h / height,
    angle: 0,
  };
}

/** The scale factors of a placement against the one it started from. */
export function factors(before: EditorPlacement, now: EditorPlacement): [number, number] {
  return [now.width / before.width, now.height / before.height];
}

/** The print size the client would save, rounded as the worker rounds it. */
export function printSize(
  size: Millimetres,
  before: EditorPlacement,
  now: EditorPlacement,
): Millimetres {
  const [sx, sy] = factors(before, now);
  return {
    widthMm: Math.round(size.widthMm * sx * 10) / 10,
    heightMm: Math.round(size.heightMm * sy * 10) / 10,
  };
}

/** How far the drawing's proportions have moved, accumulated over earlier versions. */
export function stretchOf(
  transform: EditorTransform,
  before: EditorPlacement,
  now: EditorPlacement,
): number {
  const [sx, sy] = factors(before, now);
  return (transform.stretch ?? 1) * (sx / sy);
}

/** Whether saving this placement changes the print size. */
export function resizes(before: EditorPlacement, now: EditorPlacement): boolean {
  const [sx, sy] = factors(before, now);
  return Math.abs(sx - 1) > UNCHANGED || Math.abs(sy - 1) > UNCHANGED;
}

/** Whether anything at all changed. */
export function changed(before: EditorPlacement, now: EditorPlacement): boolean {
  return (
    resizes(before, now) ||
    Math.abs(now.centreX - before.centreX) > 0.001 ||
    Math.abs(now.centreY - before.centreY) > 0.001 ||
    Math.abs(now.angle - before.angle) > 0.5
  );
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * Set the width (or the height) of the design, keeping the other, within the stretch bound, the
 * brief's millimetre bounds and the contract's fraction bound. Returns the placement it allows.
 */
export function withAxis(
  axis: 'width' | 'height',
  value: number,
  transform: EditorTransform,
  size: Millimetres,
  before: EditorPlacement,
  now: EditorPlacement,
): EditorPlacement {
  const base = transform.stretch ?? 1;
  const ratio = before.width / before.height;
  // stretch = base * (w / before.width) / (h / before.height), bounded both ways.
  let next: number;
  if (axis === 'width') {
    const low = (MIN_STRETCH / base) * ratio * now.height;
    const high = (MAX_STRETCH / base) * ratio * now.height;
    const mm = [(MIN_MM / size.widthMm) * before.width, (MAX_MM / size.widthMm) * before.width];
    next = clamp(value, Math.max(low, mm[0]!), Math.min(high, mm[1]!, 2));
  } else {
    const low = (base / MAX_STRETCH) * (now.width / ratio);
    const high = (base / MIN_STRETCH) * (now.width / ratio);
    const mm = [(MIN_MM / size.heightMm) * before.height, (MAX_MM / size.heightMm) * before.height];
    next = clamp(value, Math.max(low, mm[0]!), Math.min(high, mm[1]!, 2));
  }
  return { ...now, [axis]: next };
}

/** Scale both axes by `factor` around the current proportions, within the same bounds. */
export function withScale(
  factor: number,
  size: Millimetres,
  before: EditorPlacement,
  now: EditorPlacement,
): EditorPlacement {
  const [sx, sy] = factors(before, now);
  const lowest = Math.max(MIN_MM / (size.widthMm * sx), MIN_MM / (size.heightMm * sy));
  const highest = Math.min(
    MAX_MM / (size.widthMm * sx),
    MAX_MM / (size.heightMm * sy),
    2 / now.width,
    2 / now.height,
  );
  const f = clamp(factor, lowest, highest);
  return { ...now, width: now.width * f, height: now.height * f };
}

/** Keep the centre on the frame, as the contract requires, and the angle within ±180°. */
export function settle(placement: EditorPlacement): EditorPlacement {
  let angle = ((((placement.angle + 180) % 360) + 360) % 360) - 180;
  if (angle === -180 && placement.angle > 0) angle = 180;
  return {
    ...placement,
    centreX: clamp(placement.centreX, 0, 1),
    centreY: clamp(placement.centreY, 0, 1),
    angle: Math.round(angle * 10) / 10,
  };
}

/** Rounded as it is sent, so the saved placement is exactly the one shown. */
export function forSaving(placement: EditorPlacement): EditorPlacement {
  const r = (value: number) => Math.round(value * 10000) / 10000;
  const settled = settle(placement);
  return {
    centreX: r(settled.centreX),
    centreY: r(settled.centreY),
    width: r(settled.width),
    height: r(settled.height),
    angle: settled.angle,
  };
}

/**
 * Where the cylinder warp reads the artwork for an output pixel: `_shape`'s `source_point`.
 * Returns source coordinates in the same box, or values outside it where nothing is drawn.
 */
export function cylinderSource(
  px: number,
  py: number,
  width: number,
  height: number,
  curvature: number,
  taper: number,
): [number, number] {
  const t = py / height;
  const radius = 1 - taper * t * t;
  const u = (2 * px) / width - 1;
  const v = u / radius;
  let sx = Math.asin(clamp(v, -1, 1) * Math.sin(curvature)) / curvature;
  sx += Math.max(0, Math.abs(v) - 1) * (v > 0 ? 1 : -1);
  const bow = 0.035 * height * Math.sin(curvature) * (1 - Math.min(1, v * v));
  const sy = py - bow * Math.sin(Math.PI * t);
  return [((sx + 1) * width) / 2, sy];
}

/** Wrap the box on the cylinder in place: the browser's `_shape`. Transparent where uncovered. */
export function wrapOnCylinder(
  box: ImageData,
  curvature: number,
  taper: number,
): Uint8ClampedArray {
  const { width, height, data } = box;
  if (!curvature) return data;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = cylinderSource(x + 0.5, y + 0.5, width, height, curvature, taper);
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
      const from = (iy * width + ix) * 4;
      const to = (y * width + x) * 4;
      out[to] = data[from]!;
      out[to + 1] = data[from + 1]!;
      out[to + 2] = data[from + 2]!;
      out[to + 3] = data[from + 3]!;
    }
  }
  return out;
}

export interface DrawOptions {
  /** The skin, already drawn at preview size; never changed. */
  skin: HTMLCanvasElement;
  /** The trimmed artwork. */
  design: HTMLCanvasElement;
  /** The visible canvas, sized like `skin`. */
  canvas: HTMLCanvasElement;
  /** Scratch canvas reused between frames. */
  work: HTMLCanvasElement;
  placement: EditorPlacement;
  curvature: number;
  taper: number;
  freshness?: number;
  surface?: number;
}

/**
 * Draw the skin and lay the design on it at `placement`: resize to the chosen width and height,
 * turn, wrap on the cylinder, then the ink treatment. The order `_manual` uses in the worker.
 */
export function drawPlacement({
  skin,
  design,
  canvas,
  work,
  placement,
  curvature,
  taper,
  freshness = DEFAULT_FRESHNESS,
  surface = DEFAULT_SURFACE,
}: DrawOptions): void {
  const width = skin.width;
  const height = skin.height;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(skin, 0, 0);

  const drawWidth = Math.max(2, placement.width * width);
  const drawHeight = Math.max(2, placement.height * height);
  const radians = (placement.angle * Math.PI) / 180;
  const boxWidth = Math.ceil(
    Math.abs(drawWidth * Math.cos(radians)) + Math.abs(drawHeight * Math.sin(radians)),
  );
  const boxHeight = Math.ceil(
    Math.abs(drawWidth * Math.sin(radians)) + Math.abs(drawHeight * Math.cos(radians)),
  );
  work.width = boxWidth;
  work.height = boxHeight;
  const ink = work.getContext('2d', { willReadFrequently: true });
  if (!ink) return;
  ink.clearRect(0, 0, boxWidth, boxHeight);
  ink.save();
  ink.translate(boxWidth / 2, boxHeight / 2);
  ink.rotate(radians);
  ink.drawImage(design, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ink.restore();
  const box = ink.getImageData(0, 0, boxWidth, boxHeight);
  const wrapped = wrapOnCylinder(box, curvature, taper);

  const left = Math.round(placement.centreX * width - boxWidth / 2);
  const top = Math.round(placement.centreY * height - boxHeight / 2);
  const clipLeft = Math.max(0, left);
  const clipTop = Math.max(0, top);
  const clipRight = Math.min(width, left + boxWidth);
  const clipBottom = Math.min(height, top + boxHeight);
  const w = clipRight - clipLeft;
  const h = clipBottom - clipTop;
  if (w < 2 || h < 2) return;
  const artwork = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y + clipTop - top) * boxWidth + (clipLeft - left)) * 4;
    artwork.set(wrapped.subarray(from, from + w * 4), y * w * 4);
  }
  const frame = context.getImageData(clipLeft, clipTop, w, h);
  applyInk(frame.data, artwork, w, h, { freshness, surface });
  context.putImageData(frame, clipLeft, clipTop);
}

/** The skin at preview size, drawn once: the background thumbnailed as the worker sees it. */
export function previewSkin(image: HTMLImageElement): HTMLCanvasElement {
  const width = Math.min(PREVIEW_WIDTH, image.naturalWidth);
  const height = Math.round((width * image.naturalHeight) / image.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);
  return canvas;
}
