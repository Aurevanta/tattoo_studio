/**
 * What an account may still do today (TASK-0095, audit 2026-10-08 UX-04). The daily limits existed
 * (TASK-0078) but were only discovered by being refused, sometimes halfway through a design.
 * The worker answers with the same counts its limits apply.
 */
export interface Allowance {
  used: number;
  limit: number;
  remaining: number;
}

export interface Quota {
  designs: Allowance;
  turns: Allowance;
  resetsAt: string;
}

/** A worker answer that has the expected shape, or null. */
export function asQuota(value: unknown): Quota | null {
  const allowance = (v: unknown): v is Allowance =>
    Boolean(v) &&
    typeof v === 'object' &&
    ['used', 'limit', 'remaining'].every(
      (key) =>
        Number.isInteger((v as Record<string, unknown>)[key]) &&
        (v as Record<string, number>)[key]! >= 0,
    );
  if (!value || typeof value !== 'object') return null;
  const { designs, turns, resetsAt } = value as Record<string, unknown>;
  if (!allowance(designs) || !allowance(turns) || typeof resetsAt !== 'string') return null;
  return { designs, turns, resetsAt };
}

/** Whether a new design can start today. Unknown counts never block: the worker still decides. */
export function canDesign(quota: Quota | null): boolean {
  return quota === null || quota.designs.remaining > 0;
}

/** The line the client reads before spending a design. */
export function designsNote(quota: Quota | null): string | null {
  if (!quota) return null;
  const { used, limit, remaining } = quota.designs;
  if (remaining > 0)
    return remaining === 1
      ? `Te queda 1 diseño de ${limit} hoy.`
      : `Te quedan ${remaining} de ${limit} diseños hoy.`;
  if (used >= limit) return `Has usado tus ${limit} diseños de hoy. Podrás crear más mañana.`;
  return 'El estudio ha llegado a su límite de diseños de hoy. Inténtalo de nuevo mañana.';
}
