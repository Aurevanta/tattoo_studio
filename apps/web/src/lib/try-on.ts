/**
 * One frame of the live try-on (TASK-0042, ADR-0019).
 *
 * The page owns the camera and the animation loop; this owns what a single frame looks like —
 * where the design sits and how its ink meets the skin. Separating them keeps the per-frame work
 * callable on its own, which is how it is verified without a camera.
 *
 * It touches the DOM (canvases) but makes no request: a frame is read, blended and drawn back.
 */

import { applyInk, DEFAULT_SURFACE } from './skin-blend';

/** The preview runs at this width at most: a phone does not need more, and the blend is per frame. */
export const MAX_CANVAS_WIDTH = 640;

/** Below this the artwork counts as bare paper, as `visible_artwork` reads it in the worker. */
const PAPER = 245;

export interface Placement {
  /** Centre of the design, as a fraction of the canvas. */
  x: number;
  y: number;
  /** Width as a fraction of the canvas width. */
  scale: number;
  /** Degrees. */
  angle: number;
}

/**
 * Trim the white margin off the artwork, so the client places the design and not its padding.
 * The same rule the worker's `visible_artwork` uses, and likewise it never edits the master.
 */
export function trimArtwork(
  image: CanvasImageSource & { width: number; height: number },
): HTMLCanvasElement {
  return trimmedArtwork(image).canvas;
}

/** Where the artwork sits inside its canvas, white margin aside (TASK-0107). */
export interface ArtworkBox {
  left: number;
  top: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** `trimArtwork`, also saying where the crop was taken, as `visible_artwork` records it. */
export function trimmedArtwork(image: CanvasImageSource & { width: number; height: number }): {
  canvas: HTMLCanvasElement;
  box: ArtworkBox;
} {
  const width = Number(image.width);
  const height = Number(image.height);
  const full = document.createElement('canvas');
  full.width = width;
  full.height = height;
  const context = full.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (data[p + 3]! > 0 && Math.min(data[p]!, data[p + 1]!, data[p + 2]!) < PAPER) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const whole = { left: 0, top: 0, width, height, canvasWidth: width, canvasHeight: height };
  if (right < left || bottom < top) return { canvas: full, box: whole };
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const cropped = document.createElement('canvas');
  cropped.width = right - left + 1;
  cropped.height = bottom - top + 1;
  cropped
    .getContext('2d')!
    .drawImage(full, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return {
    canvas: cropped,
    box: {
      left,
      top,
      width: cropped.width,
      height: cropped.height,
      canvasWidth: width,
      canvasHeight: height,
    },
  };
}

export interface FrameOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  /** The trimmed artwork. */
  design: HTMLCanvasElement;
  /** Scratch canvas reused between frames. */
  work: HTMLCanvasElement;
  placement: Placement;
  freshness: number;
  surface?: number;
  /**
   * The widest the frame is drawn. The live preview keeps the default so the per-frame blend stays
   * cheap; a kept photograph (ADR-0022) is composed once, at the camera's own resolution up to this.
   */
  maxWidth?: number;
}

/**
 * Draw the camera frame and lay the design into it. Returns false when there is nothing to draw
 * yet — no frame decoded, or the design placed entirely off the canvas.
 */
export function composeFrame({
  video,
  canvas,
  design,
  work,
  placement,
  freshness,
  surface = DEFAULT_SURFACE,
  maxWidth = MAX_CANVAS_WIDTH,
}: FrameOptions): boolean {
  if (video.readyState < 2 || !video.videoWidth) return false;

  const width = Math.min(maxWidth, video.videoWidth);
  const height = Math.round((width * video.videoHeight) / video.videoWidth);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(video, 0, 0, width, height);

  const { x, y, scale, angle } = placement;
  const drawWidth = Math.max(8, width * scale);
  const drawHeight = (drawWidth * design.height) / design.width;
  const radians = (angle * Math.PI) / 180;
  // The blend box is the rotated artwork's bounding box. Its padding stays transparent, which
  // `applyInk` reads as no ink at all, so rotating never paints a corner onto the skin.
  const boxWidth = Math.ceil(
    Math.abs(drawWidth * Math.cos(radians)) + Math.abs(drawHeight * Math.sin(radians)),
  );
  const boxHeight = Math.ceil(
    Math.abs(drawWidth * Math.sin(radians)) + Math.abs(drawHeight * Math.cos(radians)),
  );
  const left = Math.round(x * width - boxWidth / 2);
  const top = Math.round(y * height - boxHeight / 2);
  const clipLeft = Math.max(0, left);
  const clipTop = Math.max(0, top);
  const clipRight = Math.min(width, left + boxWidth);
  const clipBottom = Math.min(height, top + boxHeight);
  if (clipRight - clipLeft < 4 || clipBottom - clipTop < 4) return true;

  work.width = clipRight - clipLeft;
  work.height = clipBottom - clipTop;
  const ink = work.getContext('2d', { willReadFrequently: true });
  if (!ink) return true;
  ink.clearRect(0, 0, work.width, work.height);
  ink.save();
  ink.translate(left + boxWidth / 2 - clipLeft, top + boxHeight / 2 - clipTop);
  ink.rotate(radians);
  ink.drawImage(design, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ink.restore();

  const frame = context.getImageData(clipLeft, clipTop, work.width, work.height);
  const artwork = ink.getImageData(0, 0, work.width, work.height);
  applyInk(frame.data, artwork.data, work.width, work.height, { freshness, surface });
  context.putImageData(frame, clipLeft, clipTop);
  return true;
}

/** What a camera state means to the client (TASK-0042). */
export type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unsupported' | 'failed';

/**
 * Classify a `getUserMedia` rejection. A refusal is the client's decision and gets its own
 * message and retry; anything else is a failure of the device or the browser.
 */
export function cameraFailure(error: unknown): Extract<CameraState, 'denied' | 'failed'> {
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed';
}

/** True when this browser exposes a camera at all. */
export function cameraAvailable(devices: MediaDevices | undefined): boolean {
  return typeof devices?.getUserMedia === 'function';
}
