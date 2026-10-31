import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { answerAuth, authOnlyFetch, configureAuth, signedIn } from '../../../lib/auth.testing';
import { POST as consult } from '../consultation/route';
import { briefSignature, buildMasterPrompt, type OrchestrationSession } from '@tattoo/consultation';

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
describe('generation boundary', () => {
  it('rejects client-authored dossier without server session', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: { cookie: signedIn() },
        body: JSON.stringify({
          dossier: { masterDiffusionPrompt: 'forged' },
          slots: { subject: { description: 'forged' } },
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).stencil).toBeUndefined();
  });
  it('accepts a change to a stored design with no consultation in this browser (TASK-0134)', async () => {
    // The consultation expires 24 hours after its last change, and a second device never had one.
    // Neither is an expired sign-in: the edit belongs to the account, like reading the design.
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        if (target.includes('/consultations/')) return Response.json({}, { status: 404 });
        if (target.endsWith('/studio/jobs')) {
          submitted = JSON.parse(String(init?.body));
          return Response.json({
            jobId: 'c'.repeat(32),
            state: 'queued',
            result: null,
            error: null,
          });
        }
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const edit = { parentJobId: 'b'.repeat(32), instruction: 'Haz el león más pequeño' };
    const response = await POST(
      new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: {
          cookie: `${signedIn()}; inkcraft=00000000-0000-4000-8000-000000000000`,
        },
        body: JSON.stringify({ edit, idempotencyKey: '55555555-5555-4555-8555-555555555555' }),
      }),
    );
    expect(response.status).toBe(202);
    expect((await response.json()).jobId).toBe('c'.repeat(32));
    expect(submitted).toEqual({
      edit,
      referencesReviewed: true,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });
    // No consultation is started for it.
    expect(response.headers.get('set-cookie') ?? '').not.toContain('inkcraft=');
  });
  it('rejects malformed JSON', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: { cookie: signedIn() },
        body: '{',
      }),
    );
    expect(response.status).toBe(400);
  });
  it.each(['solo negro', 'con color', 'con toques de color'])(
    'queues %s using the server brief and actual references',
    async (colour) => {
      vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
      let submitted: Record<string, unknown> | undefined;
      const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        if (target.includes('commons.wikimedia.org/w/api'))
          return Response.json({
            query: {
              pages: {
                one: {
                  title: 'File:Lion.png',
                  imageinfo: [{ url: 'https://upload.wikimedia.org/lion.png', mime: 'image/png' }],
                },
              },
            },
          });
        if (target === 'https://upload.wikimedia.org/lion.png')
          return new Response(new Uint8Array([1, 2, 3]));
        if (target.endsWith('/studio/media')) {
          expect(JSON.parse(String(init?.body)).data).toBe('AQID');
          return Response.json({ assetId: 'a'.repeat(32), mimeType: 'image/png' });
        }
        if (target.endsWith('/studio/jobs')) {
          submitted = JSON.parse(String(init?.body));
          return Response.json({
            jobId: 'b'.repeat(32),
            state: 'queued',
            result: null,
            error: null,
          });
        }
        throw new Error('Unexpected request');
      });
      vi.stubGlobal('fetch', request);
      const started = await consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn() },
          body: JSON.stringify({
            action: 'orchestrate',
            userMessage: `Un león de línea fina en el antebrazo izquierdo de un hombre, ${colour}, 8 x 15 cm`,
          }),
        }),
      );
      expect(started.status).toBe(200);
      const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
      const refused = await POST(
        new Request('http://localhost:3000/api/generate', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({
            adult: true,
            consent: true,
            referencesReviewed: true,
            idempotencyKey: '33333333-3333-4333-8333-333333333333',
          }),
        }),
      );
      // TASK-0037/AC-001: no acceptance, no job.
      expect(refused.status).toBe(409);
      expect(submitted).toBeUndefined();
      const state = (await started.json()).session as OrchestrationSession;
      const accepted = await consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({
            action: 'accept_brief',
            signature: briefSignature(buildMasterPrompt(state.slots, state.references)),
          }),
        }),
      );
      expect(accepted.status).toBe(200);
      const response = await POST(
        new Request('http://localhost:3000/api/generate', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({
            adult: true,
            consent: true,
            referencesReviewed: true,
            idempotencyKey: '11111111-1111-4111-8111-111111111111',
            brief: { subject: { description: 'forged' } },
          }),
        }),
      );
      expect(response.status).toBe(202);
      expect(submitted?.['brief']).toMatchObject({
        subject: { description: expect.stringContaining('Un león') },
        size: { widthMm: 80, heightMm: 150 },
      });
      expect(submitted?.['referenceIds']).toEqual(['a'.repeat(32)]);
      // TASK-0037/AC-004: a change after accepting withdraws the acceptance. Asserted on the
      // message too, so the refusal is proven to be the acceptance guard and not an earlier one.
      const resized = await consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({
            action: 'preferences',
            preferences: { size: { widthMm: 60, heightMm: 110 } },
          }),
        }),
      );
      expect(resized.status).toBe(200);
      expect(((await resized.json()).session as OrchestrationSession).phase).toBe(
        'ready_to_generate',
      );
      submitted = undefined;
      const withdrawn = await POST(
        new Request('http://localhost:3000/api/generate', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({
            adult: true,
            consent: true,
            referencesReviewed: true,
            idempotencyKey: '44444444-4444-4444-8444-444444444444',
          }),
        }),
      );
      expect(withdrawn.status).toBe(409);
      expect(JSON.stringify(await withdrawn.json())).toContain('Acepta el resumen');
      expect(submitted).toBeUndefined();
      const edit = { parentJobId: 'b'.repeat(32), instruction: 'Haz el león más pequeño' };
      const edited = await POST(
        new Request('http://localhost:3000/api/generate', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({
            adult: true,
            consent: true,
            edit,
            idempotencyKey: '22222222-2222-4222-8222-222222222222',
            masterAssetId: 'forged',
            brief: { subject: 'forged' },
          }),
        }),
      );
      expect(edited.status).toBe(202);
      expect(submitted).toEqual({
        edit,
        referencesReviewed: true,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      });
      const denied = await POST(
        new Request('http://localhost:3000/api/generate', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify({ adult: false, consent: true, edit }),
        }),
      );
      expect(denied.status).toBe(422);
    },
  );

  it('refuses a stale or incomplete acceptance, and a change withdraws it (TASK-0037)', async () => {
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        calls.push(target);
        if (target.includes('commons.wikimedia.org/w/api')) return Response.json({ query: {} });
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const post = (cookie: string | undefined, body: unknown) =>
      consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify(body),
        }),
      );

    const partial = await post(undefined, { action: 'orchestrate', userMessage: 'Un lobo' });
    const cookie = partial.headers.get('set-cookie')!.split(';')[0]!;
    const incomplete = (await partial.json()).session as OrchestrationSession;
    // AC-002: an incomplete brief cannot be accepted, whatever signature is sent.
    const early = await post(cookie, {
      action: 'accept_brief',
      signature: briefSignature(buildMasterPrompt(incomplete.slots, incomplete.references)),
    });
    expect(early.status).toBe(422);

    const filled = await post(cookie, {
      action: 'preferences',
      preferences: {
        style: { primary: 'blackwork' },
        placement: {
          bodyPart: 'calf',
          side: 'right',
          orientation: 'vertical',
          bodyType: 'masculine',
        },
        colour: { mode: 'black_and_grey' },
        size: { widthMm: 90, heightMm: 150 },
      },
    });
    expect(filled.status).toBe(200);
    const complete = (await filled.json()).session as OrchestrationSession;
    const signature = briefSignature(buildMasterPrompt(complete.slots, complete.references));

    // AC-002: a signature for something the server would not send is refused.
    const stale = await post(cookie, { action: 'accept_brief', signature: `${signature}x` });
    expect(stale.status).toBe(409);

    // TASK-0079: keeping the consultation is a write to the studio's own store, not a model call.
    const outbound = () => calls.filter((call) => !call.includes('/studio/consultations/')).length;
    const before = outbound();
    const accepted = await post(cookie, { action: 'accept_brief', signature });
    expect(accepted.status).toBe(200);
    // AC-005: accepting makes no outbound call at all, model or otherwise.
    expect(outbound()).toBe(before);
  });

  it('a generic idea with no reference is generated with none (TASK-0058)', async () => {
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    const searched: string[] = [];
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        if (target.includes('commons.wikimedia.org/w/api')) {
          searched.push('commons');
          return Response.json({ query: {} });
        }
        if (target.startsWith('https://api.openverse.org/v1/images/?')) {
          searched.push('openverse');
          return Response.json({ results: [] });
        }
        if (target.endsWith('/studio/jobs')) {
          submitted = JSON.parse(String(init?.body));
          return Response.json({
            jobId: 'c'.repeat(32),
            state: 'queued',
            result: null,
            error: null,
          });
        }
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const post = (cookie: string | undefined, body: unknown) =>
      consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify(body),
        }),
      );
    const started = await post(undefined, {
      action: 'orchestrate',
      userMessage:
        'Un tatuaje biomecánico en el muslo derecho de un hombre, negro con acentos de color',
    });
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const state = (await started.json()).session as OrchestrationSession;
    // Both licensed sources were asked and had nothing; nothing essential is missing.
    expect(searched).toEqual(['commons', 'openverse']);
    expect(state.references).toEqual([]);
    expect(state.missingFields).toEqual([]);
    expect(state.phase).toBe('ready_to_generate');

    const accepted = await post(cookie, {
      action: 'accept_brief',
      signature: briefSignature(buildMasterPrompt(state.slots, state.references, state.stylePick)),
    });
    expect(accepted.status).toBe(200);
    const response = await POST(
      new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: { cookie: signedIn(cookie) },
        body: JSON.stringify({
          adult: true,
          consent: true,
          referencesReviewed: true,
          idempotencyKey: '66666666-6666-4666-8666-666666666666',
        }),
      }),
    );
    expect(response.status).toBe(202);
    expect(submitted?.['referenceIds']).toEqual([]);
    expect(submitted?.['brief']).toMatchObject({ style: { primary: 'biomechanical' } });
  });

  it('a catalogue pick sets the style and is never uploaded (TASK-0038)', async () => {
    vi.stubEnv('TATTOO_WORKER_TOKEN', 'test-only-token');
    const uploads: string[] = [];
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        const authenticated = answerAuth(target);
        if (authenticated) return authenticated;
        if (target.includes('commons.wikimedia.org/w/api'))
          return Response.json({
            query: {
              pages: {
                one: {
                  title: 'File:Tiger.png',
                  imageinfo: [{ url: 'https://upload.wikimedia.org/tiger.png', mime: 'image/png' }],
                },
              },
            },
          });
        if (target === 'https://upload.wikimedia.org/tiger.png')
          return new Response(new Uint8Array([1, 2, 3]));
        if (target.endsWith('/studio/media')) {
          uploads.push(JSON.parse(String(init?.body)).data);
          return Response.json({ assetId: 'a'.repeat(32), mimeType: 'image/png' });
        }
        if (target.endsWith('/studio/jobs')) {
          submitted = JSON.parse(String(init?.body));
          return Response.json({
            jobId: 'b'.repeat(32),
            state: 'queued',
            result: null,
            error: null,
          });
        }
        throw new Error(`Unexpected request ${target}`);
      }),
    );
    const post = (cookie: string | undefined, body: unknown) =>
      consult(
        new Request('http://localhost:3000/api/consultation', {
          method: 'POST',
          headers: { cookie: signedIn(cookie) },
          body: JSON.stringify(body),
        }),
      );
    const started = await post(undefined, {
      action: 'orchestrate',
      userMessage:
        'Un tigre de línea fina en el antebrazo izquierdo de un hombre, solo negro, 8 x 15 cm',
    });
    const cookie = started.headers.get('set-cookie')!.split(';')[0]!;
    const before = ((await started.json()).session as OrchestrationSession).references;

    const picked = await post(cookie, {
      action: 'style_variant',
      variantId: 'neo_traditional:animal',
    });
    expect(picked.status).toBe(200);
    const state = (await picked.json()).session as OrchestrationSession;
    // AC-001: the style is set and remembered; the references are exactly what they were.
    expect(state.slots.style?.primary).toBe('neo_traditional');
    expect(state.stylePick?.id).toBe('neo_traditional:animal');
    expect(state.references).toEqual(before);
    expect(JSON.stringify(state.references)).not.toContain('style-library');
    // AC-002: the brief the client reads names the variant.
    const prompt = buildMasterPrompt(state.slots, state.references, state.stylePick);
    expect(prompt.lines.find((l) => l.label === 'Estilo')?.value).toBe('Neotradicional · Animal');

    expect(state.phase).toBe('ready_to_generate');
    const accepted = await post(cookie, {
      action: 'accept_brief',
      signature: briefSignature(prompt),
    });
    expect(accepted.status).toBe(200);
    const response = await POST(
      new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: { cookie: signedIn(cookie) },
        body: JSON.stringify({
          adult: true,
          consent: true,
          referencesReviewed: true,
          idempotencyKey: '55555555-5555-4555-8555-555555555555',
        }),
      }),
    );
    expect(response.status).toBe(202);
    // AC-003: only the real reference was uploaded; the catalogue picture never left the app.
    expect(uploads).toEqual(['AQID']);
    expect(submitted?.['referenceIds']).toEqual(['a'.repeat(32)]);
    expect(submitted?.['brief']).toMatchObject({ style: { primary: 'neo_traditional' } });

    // An unknown pick is refused and changes nothing.
    const invented = await post(cookie, { action: 'style_variant', variantId: 'tribal:invented' });
    expect(invented.status).toBe(400);
  });
});
