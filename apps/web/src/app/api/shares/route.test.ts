/**
 * Sharing a design with the client's tattooer (TASK-0097, ADR-0032).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, POST } from './route';
import { GET as media } from '../shared/[token]/[asset]/route';
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

const JOB = 'a'.repeat(32);
const TOKEN = 'Abc_def-0123456789abcdefghijklmn';

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

const share = (body: unknown, cookie: string) =>
  POST(
    new Request('http://localhost:3000/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    }),
  );

describe('sharing with the tattooer (TASK-0097)', () => {
  it('asks the worker as the account and answers the link’s path', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(
        () => Response.json({ token: TOKEN, expiresAt: '2026-11-08T10:00:00+00:00' }),
        asked,
      ),
    );
    const response = await share({ jobId: JOB }, signedIn());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: `/t/${TOKEN}`,
      expiresAt: '2026-11-08T10:00:00+00:00',
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe('http://127.0.0.1:8000/studio/shares');
    expect(asked[0]!.headers.get('X-Owner-Id')).toBe(TEST_ACCOUNT.id);
    expect(asked[0]!.body).toEqual({ jobId: JOB });
  });

  it('needs the current consent and a real design id', async () => {
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => Response.json({})),
    );
    expect((await share({ jobId: JOB }, signedInWithoutConsent())).status).toBe(428);
    expect((await share({ jobId: '../x' }, signedIn())).status).toBe(400);
  });

  it('says whether a design has links out, for a later visit', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(
        () => Response.json({ open: 2, expiresAt: '2026-11-08T10:00:00+00:00' }),
        asked,
      ),
    );
    const response = await GET(
      new Request(`http://localhost:3000/api/shares?jobId=${JOB}`, {
        headers: { cookie: signedIn() },
      }),
    );
    expect(await response.json()).toEqual({ open: 2, expiresAt: '2026-11-08T10:00:00+00:00' });
    expect(asked[0]!.url).toBe(`http://127.0.0.1:8000/studio/shares/open/${JOB}`);
    expect(asked[0]!.headers.get('X-Owner-Id')).toBe(TEST_ACCOUNT.id);
  });

  it('stops sharing every link to a design', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => new Response(null, { status: 204 }), asked),
    );
    const response = await DELETE(
      new Request(`http://localhost:3000/api/shares?jobId=${JOB}`, {
        method: 'DELETE',
        headers: { cookie: signedIn() },
      }),
    );
    expect(response.status).toBe(200);
    expect(asked.map((a) => [a.method, a.url])).toEqual([
      ['DELETE', `http://127.0.0.1:8000/studio/shares/${JOB}`],
    ]);
  });
});

describe('a file through a link (TASK-0097)', () => {
  const open = (token: string, asset: string) =>
    media(new Request(`http://localhost:3000/api/shared/${token}/${asset}`), {
      params: Promise.resolve({ token, asset }),
    });

  it('passes the link in a header, as the service, and serves the file inert', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(
        () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
        asked,
      ),
    );
    const response = await open(TOKEN, 'd'.repeat(32));
    expect(response.status).toBe(200);
    expect(asked[0]!.url).toBe(`http://127.0.0.1:8000/studio/shares/media/${'d'.repeat(32)}`);
    expect(asked[0]!.url).not.toContain(TOKEN);
    expect(asked[0]!.headers.get('X-Share-Token')).toBe(TOKEN);
    expect(asked[0]!.headers.get('X-Owner-Id')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('opens nothing for an impossible token or file, and says a closed link is gone', async () => {
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      workerAnswering(() => new Response(null, { status: 404 }), asked),
    );
    expect((await open('short', 'd'.repeat(32))).status).toBe(404);
    expect((await open(TOKEN, 'not-a-file')).status).toBe(404);
    expect(asked).toHaveLength(0);
    expect((await open(TOKEN, 'd'.repeat(32))).status).toBe(404);
  });
});
