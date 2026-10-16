import { NextResponse } from 'next/server';
import { validateAgainst, type StudioJobStatus } from '@tattoo/contracts';

import {
  applyRenewal,
  errorResponse,
  input,
  RequestError,
  requireAccount,
  requireConsent,
  worker,
} from '../../../lib/studio-server';

const ID = /^[a-f0-9]{32}$/;
const KEY = /^[a-f0-9-]{36}$/;
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

/**
 * The client manages their designs (TASK-0116, ADR-0041). Deleting and renaming need only the
 * account — a client can always take their work away — while a new design made from a version
 * stores work and asks for the current consent, as everything that stores does.
 */

/** Rename a design: `{ designId, name }`. An empty name gives it back the client's idea. */
export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    const body = await input(request);
    const designId = body['designId'];
    if (typeof designId !== 'string' || !ID.test(designId))
      throw new RequestError('Diseño inválido.');
    if (typeof body['name'] !== 'string') throw new RequestError('El nombre no es válido.');
    const response = await worker(caller.account.id, `/designs/${designId}`, 'PATCH', {
      name: body['name'],
    });
    const named = (await response.json()) as { name?: unknown };
    if (typeof named.name !== 'string') throw new RequestError('No se ha podido renombrar.', 502);
    return applyRenewal(NextResponse.json({ name: named.name }, NO_STORE), caller);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Delete a whole design (`?designId=`) or one version of it (`?jobId=`). */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    const parameters = new URL(request.url).searchParams;
    const designId = parameters.get('designId');
    const jobId = parameters.get('jobId');
    let path: string;
    if (designId && !jobId && ID.test(designId)) path = `/designs/${designId}`;
    else if (jobId && !designId && ID.test(jobId)) path = `/jobs/${jobId}`;
    else throw new RequestError('Diseño inválido.');
    const answer = (await (await worker(caller.account.id, path, 'DELETE')).json()) as {
      deleted?: unknown;
    };
    return applyRenewal(
      NextResponse.json(
        { deleted: typeof answer.deleted === 'number' ? answer.deleted : 0 },
        NO_STORE,
      ),
      caller,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** A new design made from one version: `{ fromJobId, idempotencyKey }`. Answers its status. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    requireConsent(request, caller);
    const body = await input(request);
    const fromJobId = body['fromJobId'];
    const idempotencyKey = body['idempotencyKey'];
    if (typeof fromJobId !== 'string' || !ID.test(fromJobId))
      throw new RequestError('Propuesta original inválida.');
    if (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey))
      throw new RequestError('Identificador de solicitud inválido.');
    const response = await worker(caller.account.id, '/designs', 'POST', {
      fromJobId,
      idempotencyKey,
    });
    const checked = validateAgainst<StudioJobStatus>('studio-status', await response.json());
    if (!checked.valid) throw new RequestError('No se ha podido crear el diseño.', 502);
    return applyRenewal(NextResponse.json(checked.value, NO_STORE), caller);
  } catch (error) {
    return errorResponse(error);
  }
}
