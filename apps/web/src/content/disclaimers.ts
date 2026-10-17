/**
 * Required user-facing copy.
 *
 * WEB-INV-003: the UI never presents a generated artifact without the visualization
 * disclaimer, and never presents aged output as a prediction. These strings are the
 * single source of that copy so the invariant is testable rather than aspirational.
 */

export const VISUALIZATION_DISCLAIMER =
  'This is a visualization, not a guarantee of the final tattoo. Your artist decides what is ' +
  'achievable on your skin.';

export const AGING_DISCLAIMER =
  'Illustrative only. This is not a prediction of how your tattoo will heal or age, which ' +
  'depends on your skin, your artist, the ink and sun exposure.';

export const ARTIST_STYLE_NOTICE =
  'We do not imitate the style of named living tattoo artists. Tell us the style instead.';

export const VISUALIZATION_DISCLAIMER_ES =
  'Esta es una visualización previa, no una garantía del resultado final. Tu tatuador decide qué es realizable en tu piel.';

export const AGING_DISCLAIMER_ES =
  'Solo con fines ilustrativos. Esto no es una predicción de cómo sanará o envejecerá tu tatuaje, lo cual depende de tu piel, tu tatuador, la tinta y la exposición solar.';

export const ARTIST_STYLE_NOTICE_ES =
  'Por ética profesional no imitamos el estilo de artistas vivos reconocidos. Cuéntanos la técnica o el estilo general en su lugar.';

/**
 * TASK-0125 (owner's audit list, item 3): what «real size» means. The views on skin (mockup, 3D,
 * camera) lay the design at its millimetres on reference anatomy or on an uncalibrated photo, so
 * the size they show is approximate; only a calibrated photo carries a real scale. The stencil and
 * its PDFs are exported at the stated millimetres and print at 1:1 (PROD-INV-002).
 */
export const SKIN_SCALE_NOTE_ES =
  'La vista sobre la piel es orientativa salvo que calibres tu foto; la plantilla y los PDF sí se exportan a las medidas indicadas.';

/** The short form beside a result: the skin view is approximate, the stencil is not. */
export function stencilSizeNote(size: { widthMm: number; heightMm: number }): string {
  return `Tamaño sobre la piel orientativo · la plantilla sí mide ${size.widthMm} × ${size.heightMm} mm`;
}
