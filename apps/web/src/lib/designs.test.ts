import { describe, expect, it } from 'vitest';

import type { StudioJobStatus } from '@/types/generation';

import { deletes, groupDesigns, versionLabel } from './designs';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

function version(
  jobId: string,
  design: string | null,
  extra: Record<string, unknown> = {},
): StudioJobStatus {
  return {
    jobId,
    state: 'succeeded',
    error: null,
    result: { ...extra } as unknown as StudioJobStatus['result'],
    ...(design ? { design: { id: design, name: `Diseño ${design[0]}` } } : {}),
  } as StudioJobStatus;
}

describe('the account’s designs (TASK-0116)', () => {
  const history = [
    version('3'.repeat(32), A, { edit: { parentJobId: A, instruction: 'Más grande' } }),
    version(B, B),
    version('2'.repeat(32), A, { capture: {} }),
    version(A, A),
  ];

  it('groups versions by design, the design touched last first', () => {
    const groups = groupDesigns(history);
    expect(groups.map((group) => group.id)).toEqual([A, B]);
    expect(groups[0]!.name).toBe('Diseño a');
    expect(groups[0]!.versions).toHaveLength(3);
  });

  it('numbers versions within their design', () => {
    const [first] = groupDesigns(history);
    expect(first!.versions.map((v) => versionLabel(first!, v))).toEqual([
      'Versión 3 · Más grande',
      'Versión 2 · Foto con la cámara',
      'Versión 1 · Diseño inicial',
    ]);
  });

  it('keeps a version served without its design as a design of its own', () => {
    const groups = groupDesigns([version(B, null), { ...version(A, A), result: null }]);
    expect(groups.map((group) => group.id)).toEqual([B]);
  });

  it('knows when a deletion takes the version on screen with it', () => {
    expect(deletes({ designId: A }, history, '2'.repeat(32))).toBe(true);
    expect(deletes({ designId: B }, history, '2'.repeat(32))).toBe(false);
    expect(deletes({ jobId: A }, history, A)).toBe(true);
    expect(deletes({ jobId: A }, history, B)).toBe(false);
  });
});
