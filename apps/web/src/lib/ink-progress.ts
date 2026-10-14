/**
 * What the studio says while an agent works (TASK-0069; TASK-0076, audit UX-03).
 *
 * The first version advanced its lines and bar on a clock, so it could announce «últimos
 * retoques» while the worker was still drawing. Now nothing is attributed that the server has not
 * confirmed: a generation shows the step the worker reports (`stage`) and its place in the queue
 * (`queuePosition`); every other wait shows one plain description of the whole task and an
 * indeterminate bar. The tattooing hand and the clock still say that the page is alive.
 */
import type { StudioJobStatus } from '@tattoo/contracts';

export type InkTask =
  'idea' | 'save' | 'search' | 'image' | 'accept' | 'reset' | 'preparing' | 'queued' | 'running';

export type InkStep = NonNullable<StudioJobStatus['stage']>;

/** The worker's steps, in the order it runs them. */
export const STEPS: readonly InkStep[] = [
  'references',
  'skin',
  'drawing',
  'stencil',
  'placing',
  'finishing',
];

const STEP_LINES: Record<InkStep, string> = {
  references: 'Analizando tus referencias…',
  skin: 'Preparando la piel…',
  drawing: 'Dibujando el diseño…',
  // TASK-0104: only a sleeve takes this step.
  seam: 'Cerrando la vuelta de la manga…',
  stencil: 'Trazando la plantilla…',
  placing: 'Colocándolo sobre la piel…',
  finishing: 'Últimos ajustes y revisión…',
};

const TASKS: Record<Exclude<InkTask, 'queued' | 'running'>, { title: string; line: string }> = {
  idea: {
    title: 'Estudiando tu idea',
    line: 'Leemos tu idea, buscamos referencias y preparamos la propuesta.',
  },
  save: { title: 'Guardando tus respuestas', line: 'Un momento…' },
  search: { title: 'Buscando referencias', line: 'Buscamos imágenes que encajen con tu idea.' },
  image: { title: 'Revisando tu imagen', line: 'Comprobamos que es apta antes de guardarla.' },
  accept: { title: 'Preparando el encargo', line: 'Fijamos el resumen que has aceptado.' },
  reset: { title: 'Preparando una hoja en blanco', line: 'Un momento…' },
  preparing: { title: 'Enviando el encargo', line: 'Enviamos tu encargo al estudio.' },
};

export interface InkStage {
  title: string;
  line: string;
  /** From 0 to 1 when a confirmed step says how far along it is; `null` when nothing does. */
  progress: number | null;
}

export function inkStage(
  task: InkTask,
  status: { stage?: InkStep | undefined; queuePosition?: number | undefined } = {},
): InkStage {
  if (task === 'queued') {
    const ahead = (status.queuePosition ?? 1) - 1;
    return {
      title: 'Tu diseño está en cola',
      line:
        ahead > 0
          ? `Hay ${ahead} ${ahead === 1 ? 'diseño' : 'diseños'} antes que el tuyo.`
          : 'Eres el siguiente.',
      progress: null,
    };
  }
  if (task === 'running') {
    // TASK-0104: only a sleeve closes its seam, as part of drawing it; the count stays the same
    // for every design.
    const counted = status.stage === 'seam' ? 'drawing' : status.stage;
    const index = counted ? STEPS.indexOf(counted) : -1;
    if (index < 0) return { title: 'Creando tu diseño', line: 'Empezando…', progress: null };
    return {
      title: `Creando tu diseño · paso ${index + 1} de ${STEPS.length}`,
      line: STEP_LINES[status.stage!],
      // Half a step in: the step has started, not finished. The seam is drawing's second half.
      progress: (index + (status.stage === 'seam' ? 0.8 : 0.5)) / STEPS.length,
    };
  }
  return { ...TASKS[task], progress: null };
}

/** «0:07», «2:31». */
export function clock(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
