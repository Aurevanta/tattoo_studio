import { NextResponse } from 'next/server';

import {
  applyRenewal,
  errorResponse,
  input,
  RequestError,
  requireAccount,
  requireConsent,
  worker,
} from '../../../lib/studio-server';

const JOB = /^[a-f0-9]{32}$/;

/**
 * Share a finished design with the client's tattooer (TASK-0097, ADR-0032). Answers the link's path,
 * which the page turns into a full address with its own origin, and when it ends.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    requireConsent(request, caller);
    const body = await input(request);
    const jobId = body['jobId'];
    if (typeof jobId !== 'string' || !JOB.test(jobId)) throw new RequestError('Diseño inválido.');
    const response = await worker(caller.account.id, '/shares', 'POST', { jobId });
    const made = (await response.json()) as { token?: unknown; expiresAt?: unknown };
    if (typeof made.token !== 'string' || typeof made.expiresAt !== 'string')
      throw new RequestError('No se ha podido crear el enlace.', 503);
    return applyRenewal(
      NextResponse.json(
        { path: `/t/${made.token}`, expiresAt: made.expiresAt },
        { headers: { 'Cache-Control': 'no-store' } },
      ),
      caller,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** Whether a design has links out, and until when (TASK-0097). */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    const jobId = new URL(request.url).searchParams.get('jobId');
    if (!jobId || !JOB.test(jobId)) throw new RequestError('Diseño inválido.');
    const response = await worker(caller.account.id, `/shares/open/${jobId}`);
    const status = (await response.json()) as { open?: unknown; expiresAt?: unknown };
    return applyRenewal(
      NextResponse.json(
        {
          open: typeof status.open === 'number' ? status.open : 0,
          expiresAt: typeof status.expiresAt === 'string' ? status.expiresAt : null,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      ),
      caller,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** Stop sharing a design: every link to it stops opening. */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    const jobId = new URL(request.url).searchParams.get('jobId');
    if (!jobId || !JOB.test(jobId)) throw new RequestError('Diseño inválido.');
    await worker(caller.account.id, `/shares/${jobId}`, 'DELETE');
    return applyRenewal(NextResponse.json({ ok: true }), caller);
  } catch (error) {
    return errorResponse(error);
  }
}
