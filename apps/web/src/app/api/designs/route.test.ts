/**
 * The client manages their designs (TASK-0116, ADR-0041).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, PATCH, POST } from './route';
import {
  answerAuth,
  configureAuth,
  signedIn,
  signedInWithoutConsent,
  TEST_ACCOUNT,
} from '../../../lib/auth.testing';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  configureAuth();
  vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
});

const DESIGN = 'a'.repeat(32);
const JOB = 'b'.repeat(32);
const KEY = '77777777-7777-4777-8777-777777777777';

interface Asked {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function workerAnswering(answer: () => Response, asked: Asked[] = []) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const auth = answerAuth(String(url), init);
    if (auth) return auth;
    asked.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return answer();
  });
}

const send = (method: string, body: unknown, cookie: string, query = '') =>
  new Request(`http://localhost:3000/api/designs${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('managing designs (TASK-0116)', () => {
  it('renames a design as the account', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => Response.json({ name: 'Lobo de Ana' }), asked),
    );
    const response = await PATCH(
      send('PATCH', { designId: DESIGN, name: 'Lobo de Ana' }, signedIn()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Lobo de Ana' });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.method).toBe('PATCH');
    expect(asked[0]!.url).toBe(`http://127.0.0.1:8000/studio/designs/${DESIGN}`);
    expect(asked[0]!.headers.get('X-Owner-Id')).toBe(TEST_ACCOUNT.id);
    expect(asked[0]!.body).toEqual({ name: 'Lobo de Ana' });
  });

  it('refuses an impossible design or name before the worker', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => Response.json({}), asked),
    );
    expect((await PATCH(send('PATCH', { designId: '../x', name: 'a' }, signedIn()))).status).toBe(
      400,
    );
    expect((await PATCH(send('PATCH', { designId: DESIGN, name: 3 }, signedIn()))).status).toBe(
      400,
    );
    expect(
      (await DELETE(send('DELETE', undefined, signedIn(), `?designId=${DESIGN}&jobId=${JOB}`)))
        .status,
    ).toBe(400);
    expect((await DELETE(send('DELETE', undefined, signedIn(), '?jobId=nope'))).status).toBe(400);
    expect(asked).toHaveLength(0);
  });

  it('deletes a whole design or one version, without asking for consent', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => Response.json({ deleted: 3 }), asked),
    );
    const whole = await DELETE(
      send('DELETE', undefined, signedInWithoutConsent(), `?designId=${DESIGN}`),
    );
    expect(await whole.json()).toEqual({ deleted: 3 });
    await DELETE(send('DELETE', undefined, signedIn(), `?jobId=${JOB}`));
    expect(asked.map((a) => [a.method, a.url])).toEqual([
      ['DELETE', `http://127.0.0.1:8000/studio/designs/${DESIGN}`],
      ['DELETE', `http://127.0.0.1:8000/studio/jobs/${JOB}`],
    ]);
  });

  it('passes on the worker’s refusal while a version is being made', async () => {
    vi.stubGlobal(
      'fetch',
      workerAnswering(() =>
        Response.json({ detail: 'Espera a que termine para eliminarlo.' }, { status: 409 }),
      ),
    );
    const response = await DELETE(send('DELETE', undefined, signedIn(), `?designId=${DESIGN}`));
    expect(response.status).toBe(409);
  });

  it('makes a new design from a version, with consent, and checks what comes back', async () => {
    const asked: Asked[] = [];
    const status = { jobId: JOB, state: 'cancelled', result: null, error: null };
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => Response.json(status, { status: 201 }), asked),
    );
    const made = await POST(send('POST', { fromJobId: DESIGN, idempotencyKey: KEY }, signedIn()));
    expect(made.status).toBe(200);
    expect(await made.json()).toEqual(status);
    expect(asked[0]!.url).toBe('http://127.0.0.1:8000/studio/designs');
    expect(asked[0]!.body).toEqual({ fromJobId: DESIGN, idempotencyKey: KEY });

    expect(
      (
        await POST(
          send('POST', { fromJobId: DESIGN, idempotencyKey: KEY }, signedInWithoutConsent()),
        )
      ).status,
    ).toBe(428);
    expect((await POST(send('POST', { fromJobId: DESIGN }, signedIn()))).status).toBe(400);

    vi.stubGlobal(
      'fetch',
      workerAnswering(() => Response.json({ jobId: 'nope' }, { status: 201 })),
    );
    expect(
      (await POST(send('POST', { fromJobId: DESIGN, idempotencyKey: KEY }, signedIn()))).status,
    ).toBe(502);
  });
});
