import Anthropic from '@anthropic-ai/sdk';

import { BODY_OPTIONS, STYLE_OPTIONS } from '../agents/researcher';
import type { ConsultationSlots, ConsultationTurn, ReferenceImage } from '../types';
import { CONSULTATION_SYSTEM_PROMPT } from './system-prompt';
import type { ConsultationProvider, ProviderExtractionOutput } from './types';
import { metered } from '../usage';

/**
 * Claude reasoning backend for the consultation (TASK-0032/0033, ADR-0015).
 *
 * This is the prompt architect: it reads the conversation and returns the structured slots, the
 * assistant reply and the readiness flag. It never generates imagery (CONSULT-INV-001).
 *
 * Built on the official SDK with **structured outputs**: the response is constrained to
 * `CONSULTATION_OUTPUT_SCHEMA`, so it is always parseable JSON whose enums are the contract
 * vocabulary. A live run (2026-09-26) showed why prose JSON is not enough: Opus 5.5 always thinks,
 * its reasoning counts against `max_tokens`, and a 1024-token cap cut the reply mid-object. Effort
 * defaults to `low` because this is an interactive turn; `max_tokens` leaves room for reasoning.
 *
 * `fetch` is injectable so tests exercise the request and parsing offline.
 */

export interface ClaudeConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  /** A consultation turn is interactive; a slow model must not hold it open. */
  timeoutMs?: number;
  maxRetries?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/** Opus 5.5: the prompt architect (ADR-0015). The scout uses Sonnet via its own planner. */
export const CLAUDE_ARCHITECT_MODEL = 'claude-opus-5-5';

const STYLES = Object.keys(STYLE_OPTIONS);
const text = { type: 'string' } as const;
const strings = { type: 'array', items: text } as const;
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

/**
 * The API rejects a structured-output schema with more than this many optional parameters
 * ("would make grammar compilation inefficient", observed live 2026-09-26 at 26).
 */
export const MAX_OPTIONAL_SCHEMA_PARAMETERS = 24;

const SLOT_GROUPS = [
  'subject',
  'style',
  'linework',
  'shading',
  'colour',
  'placement',
  'size',
  'constraints',
];

/**
 * The provider-output contract, enforced at decode time. Each slot group is required but may be
 * an empty object; the fields inside stay optional so the model can leave anything undecided.
 * Requiring the groups keeps the optional-parameter count under the API limit.
 */
export const CONSULTATION_OUTPUT_SCHEMA = object(
  {
    assistantReply: text,
    readyForGeneration: { type: 'boolean' },
    mimicryDetected: {
      anyOf: [
        { type: 'null' },
        object(
          {
            artistName: text,
            suggestedStyle: { type: 'string', enum: STYLES },
            explanation: text,
          },
          ['artistName', 'suggestedStyle', 'explanation'],
        ),
      ],
    },
    // TASK-0070: required but nullable, like `mimicryDetected`, so it adds no optional parameter.
    contentRefused: {
      anyOf: [{ type: 'null' }, object({ explanation: text }, ['explanation'])],
    },
    extractedSlots: object(
      {
        subject: object({ description: text, elements: strings, refined: text }),
        style: object({
          primary: { type: 'string', enum: STYLES },
          secondary: { type: 'string', enum: STYLES },
          notes: text,
        }),
        linework: object({
          weight: { type: 'string', enum: ['fine', 'medium', 'bold', 'mixed'] },
          notes: text,
        }),
        shading: object({
          technique: {
            type: 'string',
            enum: ['none', 'whip', 'dotwork', 'smooth_blend', 'solid_fill', 'mixed'],
          },
          intensity: { type: 'string', enum: ['light', 'medium', 'heavy'] },
        }),
        colour: object({
          mode: {
            type: 'string',
            enum: ['black_and_grey', 'colour', 'black_and_grey_with_accent'],
          },
          palette: strings,
        }),
        placement: object({
          // Only zones the client panel offers, so a proposal is always shown and editable there.
          bodyPart: { type: 'string', enum: Object.keys(BODY_OPTIONS) },
          orientation: { type: 'string', enum: ['vertical', 'horizontal', 'diagonal', 'wrapping'] },
          side: { type: 'string', enum: ['left', 'right', 'centre'] },
        }),
        size: object({ widthMm: { type: 'number' }, heightMm: { type: 'number' } }),
        constraints: object({ coverUp: { type: 'boolean' }, avoid: strings }),
      },
      SLOT_GROUPS,
    ),
  },
  ['assistantReply', 'readyForGeneration', 'mimicryDetected', 'contentRefused', 'extractedSlots'],
);

function imageBlock(reference: ReferenceImage): Anthropic.ImageBlockParam {
  // A data: URL is inlined as base64; a hosted https reference is sent by URL.
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/s.exec(reference.source);
  if (match) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: match[2] ?? '',
      },
    };
  }
  return { type: 'image', source: { type: 'url', url: reference.source } };
}

/** Plain text of a response, after refusing to read a response that did not finish. */
export function completedText(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') throw new ClaudeError('Claude declined the request.');
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeError('Claude response was truncated (max_tokens).');
  }
  const out = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!out) throw new ClaudeError('Model did not return message content.');
  return out;
}

export class ClaudeConsultationProvider implements ConsultationProvider {
  private readonly apiKey: string | undefined;
  private readonly client: Anthropic | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly effort: NonNullable<ClaudeConfig['effort']>;

  constructor(config: ClaudeConfig = {}, request?: typeof fetch) {
    this.apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    this.model = config.model ?? CLAUDE_ARCHITECT_MODEL;
    this.maxTokens = config.maxTokens ?? 16000;
    this.effort = config.effort ?? 'low';
    this.client = this.apiKey
      ? new Anthropic({
          apiKey: this.apiKey,
          timeout: config.timeoutMs ?? 30000,
          maxRetries: config.maxRetries ?? 1,
          ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
          ...(request ? { fetch: request } : {}),
        })
      : undefined;
  }

  async processTurn(
    turns: ConsultationTurn[],
    currentSlots?: ConsultationSlots,
  ): Promise<ProviderExtractionOutput> {
    if (!this.client) {
      throw new ClaudeError(
        'ANTHROPIC_API_KEY is not configured. For testing without credentials, use FixtureConsultationProvider.',
      );
    }

    let message: Anthropic.Message;
    try {
      const client = this.client;
      message = await metered(
        { provider: 'anthropic', operation: 'consultation', model: this.model },
        () =>
          client.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: `${CONSULTATION_SYSTEM_PROMPT}\n\nSlots extraídos acumulados hasta ahora: ${JSON.stringify(
              currentSlots ?? {},
            )}`,
            messages: turns.map((turn) => this.formatTurn(turn)),
            output_config: {
              effort: this.effort,
              format: { type: 'json_schema', schema: CONSULTATION_OUTPUT_SCHEMA },
            },
          }),
      );
    } catch (error) {
      // Typed SDK errors carry the status; never forward the body, which can echo the request.
      const status = error instanceof Anthropic.APIError ? ` (${error.status ?? 'network'})` : '';
      throw new ClaudeError(`Claude API error${status}.`);
    }

    try {
      const parsed = JSON.parse(completedText(message));
      return {
        extractedSlots: parsed.extractedSlots ?? {},
        assistantReply:
          parsed.assistantReply ??
          'Entendido. ¿Deseas que preparemos tu diseño para generar la plantilla y el mockup real?',
        readyForGeneration: Boolean(parsed.readyForGeneration),
        mimicryDetected: parsed.mimicryDetected ?? undefined,
        contentRefused: parsed.contentRefused ?? undefined,
      };
    } catch (err) {
      if (err instanceof ClaudeError) throw err;
      throw new ClaudeError(`Failed to parse Claude JSON response: ${String(err)}`);
    }
  }

  private formatTurn(turn: ConsultationTurn): Anthropic.MessageParam {
    if (turn.role === 'assistant') return { role: 'assistant', content: turn.content };
    if (turn.referenceImages && turn.referenceImages.length > 0) {
      // TASK-0113 (ADR-0039): each image follows its label, so «la imagen 2» in the text names
      // one picture; the text comes last, after what it refers to.
      return {
        role: 'user',
        content: [
          ...turn.referenceImages.flatMap((image): Anthropic.ContentBlockParam[] => [
            ...(image.label ? [{ type: 'text' as const, text: `${image.label}:` }] : []),
            imageBlock(image),
          ]),
          { type: 'text', text: turn.content },
        ],
      };
    }
    return { role: 'user', content: turn.content };
  }
}
