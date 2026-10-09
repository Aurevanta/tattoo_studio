/**
 * The daily counter (TASK-0095, audit 2026-10-08 UX-04).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';
import { answerAuth, configureAuth, signedIn, TEST_ACCOUNT } from '../../../lib/auth.testing';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  configureAuth();
  vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
});

const COUNTS = {
  designs: { used: 2, limit: 20, remaining: 18 },
  turns: { used: 5, limit: 100, remaining: 95 },
  resetsAt: '2026-10-10T00:00:00+00:00',
};

function workerAnswering(body: unknown, asked: { url: string; owner: string | null }[] = []) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const auth = answerAuth(String(url), init);
    if (auth) return auth;
    asked.push({ url: String(url), owner: new Headers(init?.headers).get('X-Owner-Id') });
    return Response.json(body);
  });
}

const ask = (cookie?: string) =>
  GET(new Request('http://localhost:3000/api/quota', { headers: cookie ? { cookie } : {} }));

describe('what is left today (TASK-0095)', () => {
  it("asks the worker as the signed-in account and passes on the account's counts", async () => {
    const asked: { url: string; owner: string | null }[] = [];
    vi.stubGlobal('fetch', workerAnswering(COUNTS, asked));
    const response = await ask(signedIn());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(COUNTS);
    expect(asked).toEqual([{ url: 'http://127.0.0.1:8000/studio/quota', owner: TEST_ACCOUNT.id }]);
  });

  it('asks a stranger to sign in', async () => {
    vi.stubGlobal('fetch', workerAnswering(COUNTS));
    expect((await ask()).status).toBe(401);
  });

  it('says the studio is unavailable rather than passing on a malformed answer', async () => {
    vi.stubGlobal('fetch', workerAnswering({ designs: 'many' }));
    expect((await ask(signedIn())).status).toBe(503);
  });
});
