/**
 * The 3D views start where the 2D mockup shows the design (TASK-0111).
 *
 * The mockup draws the design's visible artwork, its white margin trimmed, with the artwork's
 * height at the brief's millimetres (`mockup.engine.visible_size`). A generated plate frames its
 * zone so the zone's reference height is `SKIN_FRAME_FRACTION` of the picture
 * (`mockup.placement.fit_coverage`). From those two conventions, the design's place and turn on
 * the plate become an offset in millimetres from the zone's centre, which the 3D views apply. It is
 * the same reading, not a measurement of anyone's body.
 *
 * TASK-0120 (ADR-0042): a library plate is calibrated against the 3D reference body, and the
 * result is served with that frame (`skinFrame`): the picture's millimetres and the zone's centre
 * in it. With it, the mockup and the 3D views place the design by the same millimetres; the
 * convention above is only the fallback for a skin without one.
 */
import type { ArtworkBox } from './try-on';
import {
  forSaving,
  initialPlacement,
  type EditorPlacement,
  type EditorTransform,
  type Millimetres,
  type SkinFrame,
} from './mockup-editor';

/** As `SKIN_FRAME_FRACTION` in `mockup/placement.py`. */
export const SKIN_FRAME_FRACTION = 0.82;

/** The mockup's design as the 3D views read it: its transform and the picture it is drawn in. */
export interface MockupPose {
  transform: EditorTransform & { sourceCropPx?: unknown };
  /** The mockup's own size in pixels, the frame its transform is measured in. */
  frame: [number, number];
  /** TASK-0120 (ADR-0042): the skin's picture in millimetres, and the result's printed size. */
  skin?: SkinFrame | undefined;
  size?: Millimetres | undefined;
}

/**
 * The picture's millimetres and the zone's centre: the calibrated frame when the result has one,
 * else the framing convention (the zone's height is `SKIN_FRAME_FRACTION` of the picture).
 */
function frameOf(pose: MockupPose, zoneHeightMm: number): SkinFrame {
  if (pose.skin) return pose.skin;
  const [width, height] = pose.frame;
  const heightMm = zoneHeightMm / SKIN_FRAME_FRACTION;
  return {
    widthMm: heightMm * (width / height),
    heightMm,
    centreX: 0.5,
    centreY: 0.5,
    calibrated: false,
  };
}

/** Where a result's visible artwork starts, in the mockup's fractions (as the editor starts). */
export function mockupStart(pose: MockupPose, box: ArtworkBox | undefined): EditorPlacement {
  return initialPlacement(
    pose.transform,
    pose.frame,
    box,
    pose.size ? { size: pose.size, skin: pose.skin } : undefined,
  );
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
  return offsetOf(pose, mockupStart(pose, box), zoneHeightMm);
}

/**
 * TASK-0120: a placement in the mockup's fractions as the 3D views place it: millimetres from the
 * zone's centre, the turn, and the size against the result's own (the factors of `DesignAdjust3D`).
 * What the mockup editor and the 3D view share while both are open.
 */
export function offsetOf(
  pose: MockupPose,
  at: EditorPlacement,
  zoneHeightMm: number,
): { xMm: number; yMm: number; angle: number } {
  const skin = frameOf(pose, zoneHeightMm);
  // `+ 0` turns a rounded -0 into 0.
  return {
    xMm: Math.round((at.centreX - skin.centreX) * skin.widthMm) + 0,
    yMm: Math.round((skin.centreY - at.centreY) * skin.heightMm) + 0,
    angle: Math.round(at.angle) + 0,
  };
}

/**
 * TASK-0112: a placement adjusted in 3D, back on the mockup's plate, as `edit.placement` carries
 * it. The inverse of `offsetOf`: the offset from the zone's centre becomes the design's centre on
 * the plate, the factors scale the result's own width and height, and the turn is kept. An axis
 * the view cannot move along (`xMm` undefined on a limb) keeps the mockup's centre.
 */
export function toMockupPlacement(
  pose: MockupPose,
  box: ArtworkBox | undefined,
  zoneHeightMm: number,
  now: { xMm?: number | undefined; yMm: number; angle: number },
  [sx, sy]: readonly [number, number],
  keep?: EditorPlacement | null,
): EditorPlacement {
  const start = mockupStart(pose, box);
  const skin = frameOf(pose, zoneHeightMm);
  const across = keep?.centreX ?? start.centreX;
  return forSaving({
    centreX: now.xMm === undefined ? across : skin.centreX + now.xMm / skin.widthMm,
    centreY: skin.centreY - now.yMm / skin.heightMm,
    width: start.width * sx,
    height: start.height * sy,
    angle: now.angle,
  });
}
