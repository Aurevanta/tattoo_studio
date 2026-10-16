import type { ConsultationSlots, ConsultationTurn } from '../types';
import { CONSULTATION_SYSTEM_PROMPT } from './system-prompt';
import type { ConsultationProvider, ProviderExtractionOutput } from './types';
import { reportUsage, tokensOf } from '../usage';

export interface OpenAIAstraConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAIAstraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIAstraError';
  }
}

export class OpenAIAstraProvider implements ConsultationProvider {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OpenAIAstraConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['OPENAI_API_KEY'];
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.model = config.model ?? 'gpt-6-astra';
  }

  async processTurn(
    turns: ConsultationTurn[],
    currentSlots?: ConsultationSlots,
  ): Promise<ProviderExtractionOutput> {
    if (!this.apiKey) {
      throw new OpenAIAstraError(
        'OPENAI_API_KEY is not configured. For testing without credentials, use FixtureConsultationProvider.',
      );
    }

    const messages = [
      { role: 'system', content: CONSULTATION_SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Slots extraídos acumulados hasta ahora: ${JSON.stringify(currentSlots ?? {})}`,
      },
      ...turns.map((turn) => this.formatTurn(turn)),
    ];

    // TASK-0054: timed from the request to the parsed body, which is where the tokens are.
    const started = Date.now();
    const report = (outcome: 'ok' | 'error', body?: unknown, error?: string): void =>
      reportUsage({
        provider: 'openai',
        operation: 'consultation',
        model: this.model,
        outcome,
        durationMs: Date.now() - started,
        ...tokensOf(body),
        ...(error ? { error } : {}),
      });
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      // An interactive turn must not hang on a slow model (TASK-0033).
      signal: AbortSignal.timeout(30000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    if (!response.ok) {
      report('error', undefined, `HTTP ${response.status}`);
      const errorText = await response.text();
      throw new OpenAIAstraError(
        `OpenAI Astra API error (${response.status} ${response.statusText}): ${errorText}`,
      );
    }

    const data = await response.json();
    report('ok', data);
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new OpenAIAstraError('Model did not return message content.');
    }

    try {
      const parsed = JSON.parse(rawContent);
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
      throw new OpenAIAstraError(`Failed to parse Astra JSON response: ${String(err)}`);
    }
  }

  private formatTurn(turn: ConsultationTurn) {
    if (turn.role === 'assistant') {
      return { role: 'assistant', content: turn.content };
    }

    // Multimodal turn
    if (turn.referenceImages && turn.referenceImages.length > 0) {
      const contentParts: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [];

      // TASK-0113 (ADR-0039): labelled images first, then the text that refers to them.
      for (const img of turn.referenceImages) {
        if (img.label) contentParts.push({ type: 'text', text: `${img.label}:` });
        contentParts.push({
          type: 'image_url',
          image_url: { url: img.source },
        });
      }
      contentParts.push({ type: 'text', text: turn.content });

      return { role: 'user', content: contentParts };
    }

    return { role: 'user', content: turn.content };
  }
}
