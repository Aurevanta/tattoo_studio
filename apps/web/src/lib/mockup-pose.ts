/**
 * The 3D views start where the 2D mockup shows the design (TASK-0111).
 *
 * The mockup draws the design's visible artwork, its white margin trimmed, with the artwork's
 * height at the brief's millimetres (`mockup.engine.visible_size`). A generated plate frames its
 * zone so the zone's reference height is `SKIN_FRAME_FRACTION` of the picture
 * (`mockup.placement.fit_coverage`). From those two conventions, the design's place and turn on
 * the plate become an offset in millimetres from the zone's centre, which the 3D views apply. It is
 * the same reading, not a measurement of anyone's body.
 */
import type { ArtworkBox } from './try-on';
import { initialPlacement, type EditorTransform } from './mockup-editor';

/** As `SKIN_FRAME_FRACTION` in `mockup/placement.py`. */
export const SKIN_FRAME_FRACTION = 0.82;

/** The mockup's design as the 3D views read it: its transform and the picture it is drawn in. */
export interface MockupPose {
  transform: EditorTransform & { sourceCropPx?: unknown };
  /** The mockup's own size in pixels, the frame its transform is measured in. */
  frame: [number, number];
}

/** The artwork's size as the mockup draws it: the visible part at the brief's height. */
export function visibleSize(
  size: { widthMm: number; heightMm: number },
  box: ArtworkBox | undefined,
  wholeCanvas: boolean,
): { widthMm: number; heightMm: number } {
  if (wholeCanvas || !box || box.height <= 0) return size;
  return {
    widthMm: Math.round(((size.heightMm * box.width) / box.height) * 10) / 10,
    heightMm: size.heightMm,
  };
}

/**
 * Where the mockup puts the design, as millimetres from the zone's centre (x to the right and y up,
 * seen from outside) and a clockwise turn. Undefined when it cannot be read.
 */
export function mockupOffset(
  pose: MockupPose,
  box: ArtworkBox | undefined,
  zoneHeightMm: number,
): { xMm: number; yMm: number; angle: number } | undefined {
  const [width, height] = pose.frame;
  if (!width || !height || !zoneHeightMm) return undefined;
  const at = initialPlacement(pose.transform, pose.frame, box);
  const frameMm = zoneHeightMm / SKIN_FRAME_FRACTION;
  // `+ 0` turns a rounded -0 into 0.
  return {
    xMm: Math.round((at.centreX - 0.5) * frameMm * (width / height)) + 0,
    yMm: Math.round((0.5 - at.centreY) * frameMm) + 0,
    angle: Math.round(at.angle) + 0,
  };
}
