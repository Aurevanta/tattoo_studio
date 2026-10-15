/**
 * The design's artwork as the 3D views draw it (TASK-0111): the master with its white margin
 * trimmed, as the 2D mockup draws it, so both show the same drawing at the same size. A sleeve or a
 * calibrated photograph draws the whole canvas, as the mockup does there.
 *
 * Reads the design's own master (same origin) and draws it into a canvas; it sends nothing.
 */
import { trimmedArtwork, type ArtworkBox } from './try-on';

export async function loadArtwork(
  url: string,
  wholeCanvas: boolean,
): Promise<{ canvas: HTMLCanvasElement; box: ArtworkBox }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const trimmed = trimmedArtwork(image);
  if (!wholeCanvas) return trimmed;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return { canvas, box: trimmed.box };
}
