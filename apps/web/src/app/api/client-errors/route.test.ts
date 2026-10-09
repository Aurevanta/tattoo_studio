/**
 * A screen that failed in a client's browser reaches the Panel (TASK-0094, audit 2026-10-08).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import {
  authOnlyFetch,
  configureAuth,
  OTHER_ACCOUNT,
  signedInAs,
  TEST_ACCOUNT,
} from '../../../lib/auth.testing';
import { routeEvents, type WebEvent } from '../../../lib/telemetry';

let sent: { event: WebEvent; account: string | undefined }[] = [];

beforeEach(() => {
  configureAuth();
  sent = [];
  routeEvents((event, account) => sent.push({ event, account }));
  vi.stubGlobal('fetch', authOnlyFetch());
});
afterEach(() => {
  routeEvents(() => undefined);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const failure = (body: unknown, cookie?: string) =>
  POST(
    new Request('http://localhost:3000/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

describe('errors from the browser (TASK-0094)', () => {
  it('records a failed screen as the account, without the query string', async () => {
    const response = await failure(
      { where: 'render', message: 'x is undefined', digest: 'abc', path: '/probar?job=secret' },
      signedInAs(TEST_ACCOUNT),
    );
    expect(response.status).toBe(204);
    expect(sent).toEqual([
      {
        event: {
          kind: 'client_error',
          operation: 'render',
          outcome: 'error',
          detail: { error: 'x is undefined', path: '/probar', digest: 'abc' },
        },
        account: TEST_ACCOUNT.id,
      },
    ]);
  });

  it('records nothing for a stranger, and still answers quietly', async () => {
    const response = await failure({ where: 'render', message: 'boom', path: '/' });
    expect(response.status).toBe(204);
    expect(sent).toEqual([]);
  });

  it('bounds what it keeps and accepts only known places', async () => {
    await failure(
      { where: 'elsewhere', message: 'm'.repeat(1000), path: 'not-a-path' },
      signedInAs(TEST_ACCOUNT),
    );
    const detail = sent[0]!.event.detail!;
    expect(sent[0]!.event.operation).toBe('render');
    expect(String(detail['error']).length).toBe(300);
    expect(detail['path']).toBeNull();
  });

  it('keeps at most twenty reports an hour per account', async () => {
    for (let i = 0; i < 25; i++)
      await failure(
        { where: 'global', message: `loop ${i}`, path: '/' },
        signedInAs(OTHER_ACCOUNT),
      );
    expect(sent.filter((s) => s.account === OTHER_ACCOUNT.id)).toHaveLength(20);
  });
});
