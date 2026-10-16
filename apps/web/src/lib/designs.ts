import type { StudioJobStatus } from '@/types/generation';

/**
 * The account's designs, each with its versions (TASK-0116, ADR-0041).
 *
 * The worker says which design each version belongs to and what it is called; this only groups the
 * history it served, newest first, so the design touched last comes first.
 */
export interface DesignGroup {
  id: string;
  name: string;
  /** Newest first. */
  versions: StudioJobStatus[];
}

export function groupDesigns(history: StudioJobStatus[]): DesignGroup[] {
  const groups = new Map<string, DesignGroup>();
  for (const version of history) {
    if (!version.result) continue;
    // A version served without its design (an older worker) is a design of its own.
    const id = version.design?.id ?? version.jobId;
    const group = groups.get(id) ?? { id, name: version.design?.name ?? 'Diseño', versions: [] };
    group.versions.push(version);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** What a version is, in the client's words: `Versión 2 · Ajuste de tamaño`. */
export function versionLabel(group: DesignGroup, version: StudioJobStatus): string {
  const what = version.result?.capture
    ? 'Foto con la cámara'
    : (version.result?.edit?.instruction ?? 'Diseño inicial');
  return `Versión ${versionNumber(group, version)} · ${what}`;
}

/** A version's place in its design, the first one made being 1. */
export function versionNumber(group: DesignGroup, version: StudioJobStatus): number {
  return group.versions.length - group.versions.indexOf(version);
}

/** The longest name a design may have; the worker refuses longer ones. */
export const MAX_DESIGN_NAME = 60;

/** Whether what was deleted takes the version on screen with it. */
export function deletes(
  target: { designId: string } | { jobId: string },
  history: StudioJobStatus[],
  shown: string,
): boolean {
  if ('jobId' in target) return target.jobId === shown;
  return history.some(
    (version) =>
      version.jobId === shown && (version.design?.id ?? version.jobId) === target.designId,
  );
}
