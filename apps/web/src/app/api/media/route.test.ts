import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { answerAuth, authOnlyFetch, configureAuth, signedIn } from '../../../lib/auth.testing';
import { POST as consult } from '../consultation/route';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
// TASK-0045: these routes require an account. Every request below carries one and every stub
// answers the auth module, so the real guard runs in each test rather than being mocked away.
beforeEach(() => {
  configureAuth();
  vi.stubGlobal('fetch', authOnlyFetch());
});

describe('media upload for a change request (TASK-0036)', () => {
  it('forwards only the image and consent, and leaves the consultation untouched', async () => {
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    const uploads: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        if (target.includes('commons.wikimedia.org/w/api')) return Response.json({ query: {} });
        if (target.endsWith('/studio/media')) {
          uploads.push(JSON.parse(String(init?.body)));
          return Response.json({ assetId: 'c'.repeat(32), mimeType: 'image/png' });
        }
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const started = await consult(
      new Request('http://localhost:3000/api/consultation', {
        method: 'POST',
        headers: { cookie: signedIn() },
        body: JSON.stringify({
          action: 'orchestrate',
          userMessage: 'Una virgen de realismo en el gemelo derecho',
        }),
      }),
    );
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const before = (await started.json()).session;
    const response = await POST(
      new Request('http://localhost:3000/api/media', {
        method: 'POST',
        headers: { cookie: signedIn(cookie) },
        body: JSON.stringify({
          data: 'AQID',
          kind: 'reference',
          purpose: 'edit',
          adult: true,
          consent: true,
          label: 'forged',
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assetId).toBe('c'.repeat(32));
    expect(uploads).toEqual([{ data: 'AQID', kind: 'reference', adult: true, consent: true }]);
    // The accepted brief is not reopened: no reference joins the consultation session.
    expect(body.session).toBeUndefined();
    expect(before.references.some((r: { assetId?: string }) => r.assetId === 'c'.repeat(32))).toBe(
      false,
    );
  });
});

describe('images attached to the idea (TASK-0113, ADR-0039)', () => {
  const asset = 'd'.repeat(32);

  it('AC-001: an idea image is screened and stored without touching the consultation', async () => {
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    const uploads: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        if (target.endsWith('/studio/media')) {
          uploads.push(JSON.parse(String(init?.body)));
          return Response.json({ assetId: asset, mimeType: 'image/png' });
        }
        if (target.includes('/studio/consultations/')) return new Response(null, { status: 204 });
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const response = await POST(
      new Request('http://localhost:3000/api/media', {
        method: 'POST',
        headers: { cookie: signedIn() },
        body: JSON.stringify({ data: 'AQID', kind: 'body', purpose: 'idea', label: 'forged' }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assetId).toBe(asset);
    // A body photograph cannot come in this way: the kind is fixed to a reference.
    expect(uploads).toEqual([{ data: 'AQID', kind: 'reference', adult: true, consent: true }]);
    expect(body.session).toBeUndefined();
  });

  it.each([204, 409])(
    'AC-001: a removed image is discarded (worker %i) and leaves the consultation',
    async (status) => {
      vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
      const deletes: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          const target = String(url);
          const authenticated = answerAuth(target);
          if (authenticated) return authenticated;
          if (target.includes('/studio/media/') && init?.method === 'DELETE') {
            deletes.push(target);
            return status === 204
              ? new Response(null, { status })
              : Response.json({ detail: 'Esa imagen ya forma parte de un diseño.' }, { status });
          }
          if (target.includes('/studio/media/')) return new Response(new Uint8Array([1]));
          if (target.includes('/studio/consultations/')) return new Response(null, { status: 204 });
          throw new Error(`Unexpected request ${target}`);
        }),
      );
      const started = await consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn() },
          body: JSON.stringify({
            action: 'orchestrate',
            userMessage: 'Como la imagen 1',
            referenceIds: [asset],
          }),
        }),
      );
      const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
      expect((await started.json()).session.references).toHaveLength(1);
      const response = await POST(
        new Request('http://localhost:3000/api/media', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({ purpose: 'discard', assetId: asset }),
        }),
      );
      expect(response.status).toBe(200);
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.endsWith(`/studio/media/${asset}`)).toBe(true);
      expect((await response.json()).session.references).toEqual([]);
    },
  );

  it('AC-001: a malformed id is refused without calling the worker', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/media', {
        method: 'POST',
        headers: { cookie: signedIn() },
        body: JSON.stringify({ purpose: 'discard', assetId: '../all' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
