/**
 * «Más grande» / «Más pequeño» written as a change (TASK-0123, ADR-0043).
 *
 * A nudge is a print change: the millimetres, the stencil, the PDFs, the mockup and the 3D view all
 * take the new size. The result view recognises a change request that is only a nudge and shows
 * the new millimetres for confirmation before sending it as `coverage`. The step and the rounding
 * are the worker's (`mockup.placement.NUDGE_STEP`, `nudged_size`); the phrase is its `_NUDGE`.
 */
import { MAX_MM, MIN_MM } from './mockup-editor';

export type Nudge = 'larger' | 'smaller';

/** The two steps are inverse, so one undoes the other up to whole-millimetre rounding. */
export const SIZE_STEP: Record<Nudge, number> = { larger: 1.25, smaller: 0.8 };

const NUDGE =
  /^(?:haz(?:l[oa])? |(?:l[oa] )?quiero (?:el tatuaje )?)?(?:el tatuaje )?(?:un poco |mucho )?mas (grande|pequeno)$/;

/** Lower case without accents, trimmed of the punctuation the worker strips (`_fold`). */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/^[ .!¡?¿]+|[ .!¡?¿]+$/g, '');
}

/** Which nudge a change request is, when it says nothing else. */
export function sizeNudge(instruction: string): Nudge | null {
  const match = NUDGE.exec(fold(instruction));
  if (!match) return null;
  return match[1] === 'grande' ? 'larger' : 'smaller';
}

/** The print size after a nudge, or null when it would leave 5–600 mm. Rounds half up. */
export function nudgedSize(
  size: { widthMm: number; heightMm: number },
  nudge: Nudge,
): { widthMm: number; heightMm: number } | null {
  const step = SIZE_STEP[nudge];
  const widthMm = Math.floor(size.widthMm * step + 0.5);
  const heightMm = Math.floor(size.heightMm * step + 0.5);
  if (Math.min(widthMm, heightMm) < MIN_MM || Math.max(widthMm, heightMm) > MAX_MM) return null;
  return { widthMm, heightMm };
}
