import { NextResponse } from 'next/server';

import { asQuota } from '../../../lib/quota';
import {
  applyRenewal,
  errorResponse,
  RequestError,
  requireAccount,
  STUDIO_UNAVAILABLE,
  worker,
} from '../../../lib/studio-server';

/**
 * What the signed-in account may still do today (TASK-0095, audit 2026-10-08 UX-04). The worker
 * keeps the counts and answers with the rule its limits apply.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const caller = await requireAccount(request);
    const response = await worker(caller.account.id, '/quota');
    const quota = asQuota(await response.json().catch(() => null));
    if (!quota) throw new RequestError(STUDIO_UNAVAILABLE, 503);
    return applyRenewal(
      NextResponse.json(quota, { headers: { 'Cache-Control': 'no-store' } }),
      caller,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
