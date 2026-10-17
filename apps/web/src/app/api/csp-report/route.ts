import { NextResponse } from 'next/server';

import { violations } from '../../../lib/csp-report';
import { report } from '../../../lib/telemetry';

/**
 * Where browsers report what the Content-Security-Policy blocked (TASK-0127, owner's audit item 5).
 *
 * Each distinct violation becomes a `client_error` event (operation `csp`) in the Panel's recent
 * errors, attributed to nobody: browsers send these reports without the session. What is kept is
 * the directive, what was blocked reduced to its origin (or `inline`, `eval`, `data`, `blob`), and
 * the page's path with any token or identifier removed — never a full URL, a query or a link token.
 * The answer is always 204.
 */
const MAX_BYTES = 8000;
/** A broken page can fire a report per element; one problem is recorded once an hour. */
const MAX_PER_HOUR = 60;
const HOUR = 60 * 60 * 1000;
let period = { since: 0, count: 0 };
const seen = new Map<string, number>();

export async function POST(request: Request): Promise<NextResponse> {
  const done = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  try {
    const body = await bounded(request);
    if (body === null) return done;
    const now = Date.now();
    if (now - period.since >= HOUR) {
      period = { since: now, count: 0 };
      seen.clear();
    }
    for (const violation of violations(body)) {
      const signature = `${violation.directive} ${violation.blocked} ${violation.page}`;
      if (seen.has(signature) || period.count >= MAX_PER_HOUR) continue;
      seen.set(signature, now);
      period.count += 1;
      report(
        {
          kind: 'client_error',
          operation: 'csp',
          outcome: 'refused',
          detail: { ...violation },
        },
        null,
      );
    }
  } catch {
    // Malformed: nothing is recorded.
  }
  return done;
}

async function bounded(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
