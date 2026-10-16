import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ARCHITECT_MODEL,
  ClaudeConsultationProvider,
  ClaudeError,
  CONSULTATION_OUTPUT_SCHEMA,
  CONSULTATION_SYSTEM_PROMPT,
  BODY_OPTIONS,
  FixtureConsultationProvider,
  MAX_OPTIONAL_SCHEMA_PARAMETERS,
  resolveConsultationBackend,
  selectConsultationProvider,
  STYLE_OPTIONS,
} from '../index';
import type { ConsultationTurn, ReferenceImage } from '../types';

const turn = (content: string, referenceImages?: ReferenceImage[]): ConsultationTurn => ({
  role: 'user',
  content,
  timestamp: new Date().toISOString(),
  referenceImages,
});

/** A Messages API response body, shaped as the API returns it. */
const apiMessage = (text: string, stopReason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

/** A fake `fetch` answering like the Messages API and capturing the request body. */
function fakeClaude(
  body: unknown,
  status = 200,
): { fetch: typeof fetch; lastBody: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, lastBody: () => captured };
}

const reply = (payload: unknown, stopReason?: string) =>
  apiMessage(JSON.stringify(payload), stopReason);

describe('ClaudeConsultationProvider (TASK-0032/REQ-004, TASK-0033)', () => {
  it('throws a typed error when the credential is absent', async () => {
    const provider = new ClaudeConsultationProvider({ apiKey: '' });
    await expect(provider.processTurn([], {})).rejects.toThrow(ClaudeError);
  });

  it('asks Opus 5.5 for schema-constrained output at low effort with room to reason', async () => {
    const claude = fakeClaude(
      reply({
        assistantReply: 'Listo para generar.',
        readyForGeneration: true,
        mimicryDetected: null,
        extractedSlots: { subject: { description: 'un zorro geométrico' } },
      }),
    );
    const provider = new ClaudeConsultationProvider({ apiKey: 'k' }, claude.fetch);

    const out = await provider.processTurn([turn('un zorro geométrico en el antebrazo')], {});

    const body = claude.lastBody();
    expect(body['model']).toBe(CLAUDE_ARCHITECT_MODEL);
    expect(body['model']).toBe('claude-opus-5-5');
    expect(body['max_tokens']).toBe(16000);
    expect(body['output_config']).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: CONSULTATION_OUTPUT_SCHEMA },
    });
    expect(body['thinking']).toBeUndefined();
    expect(out.assistantReply).toBe('Listo para generar.');
    expect(out.readyForGeneration).toBe(true);
    expect(out.mimicryDetected).toBeUndefined();
    expect(out.extractedSlots.subject?.description).toBe('un zorro geométrico');
  });

  it('refuses to read a truncated response instead of parsing half an object', async () => {
    const claude = fakeClaude(apiMessage('{"assistantReply": "¡Un samur', 'max_tokens'));
    const provider = new ClaudeConsultationProvider({ apiKey: 'k' }, claude.fetch);
    await expect(provider.processTurn([turn('hola')], {})).rejects.toThrow(/truncated/);
  });

  it('surfaces a refusal as a typed error', async () => {
    const claude = fakeClaude(apiMessage('', 'refusal'));
    const provider = new ClaudeConsultationProvider({ apiKey: 'k' }, claude.fetch);
    await expect(provider.processTurn([turn('hola')], {})).rejects.toThrow(/declined/);
  });

  it('sends reference images as Anthropic image blocks', async () => {
    const claude = fakeClaude(
      reply({
        assistantReply: 'ok',
        readyForGeneration: false,
        mimicryDetected: null,
        extractedSlots: {},
      }),
    );
    const provider = new ClaudeConsultationProvider({ apiKey: 'k' }, claude.fetch);
    const reference: ReferenceImage = {
      source: 'https://upload.wikimedia.org/x.png',
      mimeType: 'image/png',
      verification: 'user_supplied',
    };

    await provider.processTurn([turn('mira esta referencia', [reference])], {});

    const messages = claude.lastBody()['messages'] as Array<{ content: unknown }>;
    const blocks = messages[0]?.content as Array<{ type: string; source?: { type: string } }>;
    expect(blocks.some((b) => b.type === 'image' && b.source?.type === 'url')).toBe(true);
  });

  it('TASK-0113/AC-003: numbered images come each after its label, and the text last', async () => {
    const claude = fakeClaude(
      reply({
        assistantReply: 'ok',
        readyForGeneration: false,
        mimicryDetected: null,
        extractedSlots: {},
      }),
    );
    const provider = new ClaudeConsultationProvider({ apiKey: 'k' }, claude.fetch);
    const image = (n: number): ReferenceImage => ({
      source: `data:image/jpeg;base64,${btoa(`img${n}`)}`,
      mimeType: 'image/jpeg',
      verification: 'user_supplied',
      label: `Imagen ${n}`,
    });

    await provider.processTurn(
      [turn('como la imagen 1 con las rosas de la imagen 2', [image(1), image(2)])],
      {},
    );

    const messages = claude.lastBody()['messages'] as Array<{ content: unknown }>;
    const blocks = messages[0]?.content as Array<{
      type: string;
      text?: string;
      source?: { type: string; data?: string };
    }>;
    expect(blocks.map((b) => (b.type === 'text' ? b.text : `${b.type}:${b.source?.type}`))).toEqual(
      [
        'Imagen 1:',
        'image:base64',
        'Imagen 2:',
        'image:base64',
        'como la imagen 1 con las rosas de la imagen 2',
      ],
    );
    expect(blocks[3]?.source?.data).toBe(btoa('img2'));
    expect(CONSULTATION_SYSTEM_PROMPT).toContain('Numbered images (TASK-0113)');
  });

  it('surfaces an API error as a typed error without echoing the response body', async () => {
    const claude = fakeClaude(
      { type: 'error', error: { type: 'invalid_request_error', message: 'secret-ish detail' } },
      400,
    );
    const provider = new ClaudeConsultationProvider({ apiKey: 'k', maxRetries: 0 }, claude.fetch);
    const failure = await provider.processTurn([turn('hola')], {}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ClaudeError);
    expect(String((failure as Error).message)).toContain('400');
    expect(String((failure as Error).message)).not.toContain('secret-ish');
  });
});

describe('selectConsultationProvider (TASK-0032/REQ-004)', () => {
  it('honours an explicit backend', () => {
    expect(selectConsultationProvider({ backend: 'fixture' })).toBeInstanceOf(
      FixtureConsultationProvider,
    );
    expect(selectConsultationProvider({ backend: 'claude' })).toBeInstanceOf(
      ClaudeConsultationProvider,
    );
  });

  it('resolves an explicit backend over any environment default', () => {
    expect(resolveConsultationBackend('claude')).toBe('claude');
    expect(resolveConsultationBackend('fixture')).toBe('fixture');
  });
});

describe('shared consultation prompt and output schema (TASK-0032/0033)', () => {
  it('carries the closed vocabulary and the anti-mimicry rule', () => {
    expect(CONSULTATION_SYSTEM_PROMPT).toContain('american_traditional');
    expect(CONSULTATION_SYSTEM_PROMPT).toContain('PROD-INV-004');
  });

  it('TASK-0033/REQ-006: names every contract style and asks for a null mimicry flag', () => {
    for (const style of Object.keys(STYLE_OPTIONS))
      expect(CONSULTATION_SYSTEM_PROMPT).toContain(style);
    expect(CONSULTATION_SYSTEM_PROMPT).toContain('"mimicryDetected": null');
  });

  it('stays under the API limit on optional schema parameters (a live 400 at 26)', () => {
    const optional = (node: unknown): number => {
      if (!node || typeof node !== 'object') return 0;
      const n = node as {
        properties?: Record<string, unknown>;
        required?: string[];
        anyOf?: unknown[];
        items?: unknown;
      };
      let count = 0;
      if (n.properties) {
        const required = new Set(n.required ?? []);
        for (const [key, child] of Object.entries(n.properties)) {
          if (!required.has(key)) count++;
          count += optional(child);
        }
      }
      for (const branch of n.anyOf ?? []) count += optional(branch);
      return count + optional(n.items);
    };
    expect(optional(CONSULTATION_OUTPUT_SCHEMA)).toBeLessThanOrEqual(
      MAX_OPTIONAL_SCHEMA_PARAMETERS,
    );
  });

  it('constrains style and body-part enums to the contract vocabulary', () => {
    const slots = CONSULTATION_OUTPUT_SCHEMA.properties['extractedSlots'] as {
      additionalProperties: boolean;
      properties: {
        style: { properties: { primary: { enum: string[] } } };
        placement: { properties: { bodyPart: { enum: string[] } } };
      };
    };
    expect(slots.properties.style.properties.primary.enum).toEqual(Object.keys(STYLE_OPTIONS));
    expect(slots.properties.placement.properties.bodyPart.enum).toEqual(Object.keys(BODY_OPTIONS));
    expect(slots.additionalProperties).toBe(false);
  });
});
