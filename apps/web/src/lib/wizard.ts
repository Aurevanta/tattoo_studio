/**
 * The guided studio (TASK-0065, ADR-0029): four pop-ups from an idea to a design.
 *
 *   1 idea → 2 details (every one, pre-selected as read) → 3 references → 4 summary → generate
 *
 * Pure, so the order and what each step asks can be tested without a page. The page holds which
 * step is open; `resumeStep` is where a reload lands, read from the consultation the server holds.
 */

import type { OrchestrationSession } from '@tattoo/consultation';

export type WizardStep = 'idea' | 'details' | 'references' | 'summary';

export const STEP_NUMBER: Record<WizardStep, number> = {
  idea: 1,
  details: 2,
  references: 3,
  summary: 4,
};

/** What step 2 can ask. The size is never asked: the studio proposes it (ADR-0010). */
export type DetailField = 'style' | 'zone' | 'side' | 'body' | 'colour';

export const ALL_DETAILS: DetailField[] = ['style', 'zone', 'side', 'body', 'colour'];

type Slots = OrchestrationSession['slots'];

/** The details still unanswered, in the order step 2 asks them. */
export function missingDetails(slots: Slots | undefined): DetailField[] {
  const missing: DetailField[] = [];
  if (!slots?.style?.primary) missing.push('style');
  if (!slots?.placement?.bodyPart) missing.push('zone');
  if (!slots?.placement?.side) missing.push('side');
  if (!slots?.placement?.bodyType) missing.push('body');
  if (!slots?.colour?.mode) missing.push('colour');
  return missing;
}

/** Labels of the essential references still missing (TASK-0034): the only thing step 3 blocks on. */
export function essentialMissing(session: OrchestrationSession | null): string[] {
  return (session?.missingFields ?? [])
    .filter((field) => field.startsWith('referencia: '))
    .map((field) => field.slice('referencia: '.length));
}

/**
 * The step after the idea has been read: always the details (TASK-0099). Style and zone read from
 * the idea, or proposed by the architect, are shown chosen so the client sees and can change them;
 * skipping them hid a style the client never picked.
 */
export function afterIdea(): WizardStep {
  return 'details';
}

/**
 * Where a reload lands. A consultation with an idea resumes at its details or, with those
 * answered, at its references, which the client then confirms again rather than skipping silently.
 */
export function resumeStep(session: OrchestrationSession | null): WizardStep {
  if (!session?.slots.subject?.description) return 'idea';
  return missingDetails(session.slots).length ? 'details' : 'references';
}
