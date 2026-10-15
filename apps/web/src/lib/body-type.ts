/**
 * The reference body a 3D view shows (TASK-0110, ADR-0038): a masculine or a feminine adult.
 *
 * A result names the body its plate was made for (`placement.bodyType`). One that names none, an
 * older result or one on the client's own photograph, starts on the body the plate library would
 * have chosen for the same design (`generation/plate_library.py::plate_body`), so the 3D view and
 * the 2D skin agree. The client may always switch.
 */
import type { BodyType } from '@tattoo/contracts';

export type { BodyType };

/** The order the plate library picks from, as `BODIES` in the worker. */
export const BODY_TYPES: readonly BodyType[] = ['masculine', 'feminine'];

export const BODY_LABEL: Readonly<Record<BodyType, string>> = {
  masculine: 'Hombre',
  feminine: 'Mujer',
};

export function isBodyType(value: unknown): value is BodyType {
  return value === 'masculine' || value === 'feminine';
}

/** The body the plate library picks for a design that names none: the same for every version. */
export async function defaultBody(briefId: string): Promise<BodyType> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(briefId)),
  );
  return BODY_TYPES[digest[0]! % 2]!;
}
