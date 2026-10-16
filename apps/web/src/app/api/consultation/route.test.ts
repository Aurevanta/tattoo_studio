import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route';
import { answerAuth, authOnlyFetch, configureAuth, signedIn } from '../../../lib/auth.testing';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
// TASK-0045: the route requires an account, so every request here carries one and the stubs
// answer the auth module. A caller without the cookie is refused; that case has its own test.
beforeEach(() => {
  configureAuth();
  vi.stubGlobal('fetch', authOnlyFetch());
});
const req = (body: unknown, cookie = '') =>
  new Request('http://localhost:3000/api/consultation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: signedIn(cookie) },
    body: JSON.stringify(body),
  });
describe('consultation server ownership', () => {
  it('ignores forged state and counts questions on the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string | URL | Request) =>
          answerAuth(String(url)) ?? Response.json({ query: { pages: {} } }),
      ),
    );
    const first = await POST(
      req({
        action: 'start',
        idea: 'Un león',
        orchestrationSession: { questionsAsked: 0, slots: { placement: { bodyPart: 'calf' } } },
      }),
    );
    expect(first.status).toBe(200);
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!;
    const initial = await first.json();
    expect(initial.session.slots.placement.bodyPart).toBeUndefined();
    const second = await POST(
      req({ action: 'advance', userMessage: 'Antebrazo izquierdo' }, cookie),
    );
    const data = await second.json();
    expect(data.session.questionsAsked).toBe(2);
    expect(data.session.slots.subject.description).toBe('Un león');
  });
  it('rejects invalid actions, malformed JSON and invalid preferences', async () => {
    expect((await POST(req({ idea: 'hello' }))).status).toBe(400);
    expect(
      (
        await POST(
          req({ action: 'preferences', preferences: { size: { widthMm: -1, heightMm: 0 } } }),
        )
      ).status,
    ).toBe(400);
  });
  it('rejects cross-origin submissions', async () => {
    const r = req({ action: 'start', idea: 'hello' });
    r.headers.set('origin', 'https://attacker.example');
    expect((await POST(r)).status).toBe(403);
  });
  it.each([undefined, []])(
    'saves optional accent colours (%j) with valid dimensions',
    async (palette) => {
      const response = await POST(
        req({
          action: 'preferences',
          preferences: {
            size: { widthMm: 200, heightMm: 300 },
            colour: { mode: 'black_and_grey_with_accent', palette },
          },
        }),
      );
      expect(response.status).toBe(200);
      const { session } = await response.json();
      expect(session.slots.colour).toEqual({ mode: 'black_and_grey_with_accent' });
      expect(session.slots.size).toEqual({ widthMm: 200, heightMm: 300 });
      expect(session.missingFields).not.toContain('paleta');
      expect(session.questionsAsked).toBe(0);
    },
  );
  it('saves 200 x 300 mm with a valid accent palette', async () => {
    const response = await POST(
      req({
        action: 'preferences',
        preferences: {
          size: { widthMm: 200, heightMm: 300 },
          colour: { mode: 'black_and_grey_with_accent', palette: ['rojo', 'azul'] },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).session.slots.size).toEqual({ widthMm: 200, heightMm: 300 });
  });
  it('reports dimension errors when dimensions actually fail', async () => {
    const response = await POST(
      req({ action: 'preferences', preferences: { size: { widthMm: 601, heightMm: 300 } } }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('entre 5 y 600 mm');
  });
});

describe('a new design (TASK-0065)', () => {
  it('forgets the consultation in this browser, and refuses a stranger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string | URL | Request) =>
          answerAuth(String(url)) ?? Response.json({ query: { pages: {} } }),
      ),
    );
    const started = await POST(req({ action: 'orchestrate', userMessage: 'Un lobo aullando' }));
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const read = () =>
      GET(
        new Request('http://localhost:3000/api/consultation', {
          headers: { cookie: signedIn(cookie) },
        }),
      );
    expect((await (await read()).json()).session.slots.subject.description).toBe(
      'Un lobo aullando',
    );

    const forgot = await DELETE(
      new Request('http://localhost:3000/api/consultation', {
        method: 'DELETE',
        headers: { cookie: signedIn(cookie) },
      }),
    );
    expect(forgot.status).toBe(200);
    expect(forgot.headers.getSetCookie().join(';')).toMatch(/inkcraft=;/);
    expect((await (await read()).json()).session).toBeNull();

    const stranger = await DELETE(
      new Request('http://localhost:3000/api/consultation', { method: 'DELETE' }),
    );
    expect(stranger.status).toBe(401);
  });
});

describe('going on without an essential reference (TASK-0067)', () => {
  it('is recorded on the server session when the client chooses it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string | URL | Request) =>
          answerAuth(String(url)) ?? Response.json({ query: { pages: {} } }),
      ),
    );
    const started = await POST(req({ action: 'orchestrate', userMessage: 'El logo de una banda' }));
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const waived = await POST(req({ action: 'waive_references' }, cookie));
    expect(waived.status).toBe(200);
    expect((await waived.json()).session.waivedReferences).toBe(true);
  });
});

describe('images attached to the idea (TASK-0113, ADR-0039)', () => {
  const one = 'a'.repeat(32);
  const two = 'b'.repeat(32);

  it('AC-002: reads each preview and passes numbered references and images', async () => {
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    const previews: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        const preview = /\/studio\/media\/([a-f0-9]{32})\?preview=1$/.exec(target);
        if (preview) {
          previews.push(preview[1]!);
          return new Response(new Uint8Array([preview[1] === one ? 1 : 2]), {
            headers: { 'content-type': 'image/jpeg' },
          });
        }
        if (target.includes('/studio/consultations/')) return new Response(null, { status: 204 });
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const { orchestrator } = await import('../../../lib/studio-server');
    const spy = vi.spyOn(orchestrator, 'handleUserInteraction');
    try {
      const response = await POST(
        req({
          action: 'orchestrate',
          userMessage: 'Como la imagen 1 pero con las rosas de la imagen 2',
          referenceIds: [one, two],
        }),
      );
      expect(response.status).toBe(200);
      expect(previews).toEqual([one, two]);
      const [, , references, , , images] = spy.mock.calls.at(-1)!;
      expect(references?.map((r) => [r.label, r.source, r.verification])).toEqual([
        ['Imagen 1', `/api/media?id=${one}`, 'user_supplied'],
        ['Imagen 2', `/api/media?id=${two}`, 'user_supplied'],
      ]);
      expect(images?.map((r) => r.source)).toEqual([
        `data:image/jpeg;base64,${Buffer.from([1]).toString('base64')}`,
        `data:image/jpeg;base64,${Buffer.from([2]).toString('base64')}`,
      ]);
      const session = (await response.json()).session;
      expect(session.references.map((r: { assetId: string }) => r.assetId)).toEqual([one, two]);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    [['a', 'b', 'c', 'd', 'e', 'f'].map((c) => c.repeat(32))],
    [['a'.repeat(32), 'a'.repeat(32)]],
    [['../secret']],
    ['a'.repeat(32)],
  ])('AC-002: refuses %j before any model or worker is called', async (referenceIds) => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const authenticated = answerAuth(String(url));
        if (authenticated) return authenticated;
        calls.push(String(url));
        throw new Error('no call expected');
      }),
    );
    const response = await POST(
      req({ action: 'orchestrate', userMessage: 'Un lobo', referenceIds }),
    );
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
