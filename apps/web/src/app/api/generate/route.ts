import { NextResponse } from 'next/server';
import { briefSignature, buildMasterPrompt } from '@tattoo/consultation';
import { validateAgainst, type StudioJob, type StudioJobStatus } from '@tattoo/contracts';
import {
  applyRenewal,
  carryRenewal,
  errorResponse,
  input,
  requireAccount,
  requireConsent,
  RequestError,
  screenText,
  session,
  worker,
  referenceBytes,
  jobStatus,
  replyKept,
  restoreConsultation,
} from '../../../lib/studio-server';
import type { Authenticated } from '../../../lib/auth';
type Session = ReturnType<typeof session>;
export async function POST(request: Request): Promise<NextResponse> {
  let current: Session | undefined;
  let locked = false;
  try {
    // TASK-0045: generation is the expensive path; it never runs unauthenticated.
    const caller = await requireAccount(request);
    // TASK-0064: age and image consent were accepted at sign-in; nothing proceeds without them.
    requireConsent(request, caller);
    const body = await input(request);
    await restoreConsultation(request, caller.account.id);
    // TASK-0134: a change to a stored design belongs to the account, like reading it (TASK-0046).
    // The consultation is only where its job is remembered, when this browser still has one; its
    // absence (expired after 24 hours, another device) is not an expired sign-in.
    current = body['edit']
      ? consultationIfAny(request, caller.account.id)
      : session(request, false, caller.account.id);
    if (current) carryRenewal(current, caller);
    if (current?.busy) throw new RequestError('Espera a que termine la operación anterior.', 409);
    if (current) {
      current.busy = true;
      locked = true;
    }
    if (
      typeof body['idempotencyKey'] !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body['idempotencyKey'])
    )
      throw new RequestError('Identificador de solicitud inválido.', 422);
    if (body['edit']) {
      // TASK-0070: a change request is the client's words, checked like the idea.
      const instruction = (body['edit'] as Record<string, unknown> | null)?.['instruction'];
      await screenText(typeof instruction === 'string' ? instruction : undefined);
      const response = await worker(caller.account.id, '/jobs', 'POST', {
        edit: body['edit'],
        idempotencyKey: body['idempotencyKey'],
        referencesReviewed: true,
      });
      const status = await jobStatus(response);
      if (!current) return read(status, caller, 202);
      current.jobId = status.jobId;
      return await replyKept(status, current, 202);
    }
    if (!current) throw new RequestError('Inicia una nueva consulta.', 401);
    if (!current.state.brief || current.state.phase !== 'ready_to_generate')
      throw new RequestError('Completa el brief y sus medidas antes de generar.', 422);
    // TASK-0037: the interface gate was presentational. Recompute the brief as it stands now and
    // compare it with what was accepted, so a change after accepting withdraws the acceptance.
    const standing = briefSignature(
      buildMasterPrompt(current.state.slots, current.state.references, current.state.stylePick),
    );
    if (current.acceptedBrief !== standing)
      throw new RequestError('Acepta el resumen de tu tatuaje antes de generarlo.', 409);
    if (body['referencesReviewed'] !== true)
      throw new RequestError('Revisa las referencias antes de continuar.', 422);
    const referenceIds: string[] = [];
    for (const reference of current.state.references) {
      if (!reference.assetId) {
        const res = await worker(caller.account.id, '/media', 'POST', {
          data: await referenceBytes(reference.source),
          kind: 'reference',
          consent: true,
          adult: true,
        });
        reference.assetId = (await res.json()).assetId;
      }
      if (reference.assetId) referenceIds.push(reference.assetId);
    }
    const payload = {
      brief: current.state.brief,
      referenceIds,
      idempotencyKey: body['idempotencyKey'],
      referencesReviewed: true,
      ...(body['bodyPhotoId'] ? { bodyPhotoId: body['bodyPhotoId'] } : {}),
      ...(body['placement'] ? { placement: body['placement'] } : {}),
    };
    const validated = validateAgainst<StudioJob>('studio-job', payload);
    if (!validated.valid)
      throw new RequestError('Revisa las referencias, la posición y las medidas.', 422);
    const response = await worker(caller.account.id, '/jobs', 'POST', validated.value);
    const status = await jobStatus(response);
    current.jobId = status.jobId;
    return await replyKept(status, current, 202);
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (current && locked) current.busy = false;
  }
}
/**
 * Read the account's work (TASK-0046).
 *
 * No consultation session is required here. Stored work belongs to the account, so a second
 * device that has just signed in — and therefore has no `inkcraft` cookie — must still see its
 * designs rather than be told its session expired.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    const parameters = new URL(request.url).searchParams;
    const body = parameters.get('history') === 'true' ? await history(caller.account.id) : null;
    if (body === null) {
      const id = parameters.get('id');
      if (!id || !/^[a-f0-9]{32}$/.test(id)) throw new RequestError('Trabajo inválido.');
      return read(await jobStatus(await worker(caller.account.id, `/jobs/${id}`)), caller);
    }
    return read(body, caller);
  } catch (error) {
    return errorResponse(error);
  }
}

async function history(owner: string): Promise<StudioJobStatus[]> {
  const items = await (await worker(owner, '/jobs')).json();
  if (!Array.isArray(items))
    throw new RequestError('No hemos podido cargar tus diseños. Recarga la página.', 502);
  return items.map((item) => {
    const checked = validateAgainst<StudioJobStatus>('studio-status', item);
    if (!checked.valid)
      throw new RequestError('No hemos podido cargar tus diseños. Recarga la página.', 502);
    return checked.value;
  });
}

function read(value: unknown, caller: Authenticated, status = 200): NextResponse {
  return applyRenewal(
    NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } }),
    caller,
  );
}

/** This browser's consultation for the account, or none. Never starts one. */
function consultationIfAny(request: Request, owner: string): Session | undefined {
  try {
    return session(request, false, owner);
  } catch {
    return undefined;
  }
}
