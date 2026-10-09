import { NextResponse } from 'next/server';

import { input, requireAccount } from '../../../lib/studio-server';
import { report } from '../../../lib/telemetry';

/** At most this many reports per account and hour: a loop of failures is one problem, not 500. */
const MAX_PER_HOUR = 20;
const HOUR = 60 * 60 * 1000;
const recent = new Map<string, { since: number; count: number }>();

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/**
 * A screen failed in a client's browser (TASK-0094, audit 2026-10-08 ARQ-02). It becomes a
 * `client_error` event in the Panel's recent errors. Only a signed-in account is recorded, so a
 * stranger cannot fill the event store. The answer is always 204: a report never becomes the
 * page's second error.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const done = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  try {
    const caller = await requireAccount(request);
    const body = await input(request, 4000);
    const account = caller.account.id;
    const now = Date.now();
    const seen = recent.get(account);
    const current = seen && now - seen.since < HOUR ? seen : { since: now, count: 0 };
    if (current.count >= MAX_PER_HOUR) return done;
    recent.set(account, { ...current, count: current.count + 1 });
    const path = text(body['path'], 200);
    report(
      {
        kind: 'client_error',
        operation: body['where'] === 'global' ? 'global' : 'render',
        outcome: 'error',
        detail: {
          error: text(body['message'], 300) ?? 'Error sin mensaje',
          path: path?.startsWith('/') ? (path.split(/[?#]/)[0] ?? null) : null,
          digest: text(body['digest'], 64),
        },
      },
      account,
    );
  } catch {
    // Not signed in, too large or malformed: nothing is recorded.
  }
  return done;
}
