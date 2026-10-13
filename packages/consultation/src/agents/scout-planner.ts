import Anthropic from '@anthropic-ai/sdk';

import { completedText } from '../providers/claude';
import { metered } from '../usage';
import type {
  JudgeCandidate,
  PlannedQuery,
  ReferenceJudge,
  ScoutQueryPlanner,
} from './image-scout';

/**
 * The visual scout's two Claude Sonnet 5 roles (TASK-0032/REQ-005, TASK-0034).
 *
 * - The **planner** decides what to search for: short queries of concrete nouns, marked essential
 *   only for a specific entity whose exact look matters, each with a Spanish label for messages.
 * - The **judge** looks at the candidate images and keeps only those that actually show what the
 *   client asked for. A live survey showed why: the first Commons hit for a howling wolf was a
 *   "Red Moon logo", for a rose an Adenium flower.
 *
 * Both use structured outputs, so replies always parse. Any failure surfaces as an exception;
 * `VisualSearchAgent` catches it (planner → deterministic queries; judge → keep nothing unverified).
 * `fetch` is injectable so both are testable offline.
 */

export const CLAUDE_SCOUT_MODEL = 'claude-sonnet-5';

export const PLANNER_PROMPT = `You plan image searches on Wikimedia Commons and Openverse (openly licensed photos and artwork) that find visual references for a tattoo design.
Return 1 to 5 queries, one per concrete thing the client wants depicted: the subject, never the way it will be drawn.
When the client names several things, every one of them gets its own query; never merge or leave one out. Read past spelling slips: "escudo del Valencia CG" is the Valencia CF crest.
Each query is 1 to 4 English words naming that thing, as a Commons file might be titled: "howling wolf", "red rose", "human skull", "nautical compass", "Great Wave off Kanagawa".
The tattoo style is already chosen and is drawn by the studio. Never search for a style, a technique or what makes it up: no "biomechanical", "geometric", "watercolour", "traditional", "tribal", "blackwork", "chicano", "realistic", and no style ingredients such as gears, circuits, polygons, mandalas, filigree or paint splashes. "Un murciélago biomecánico" is one query: "bat animal".
Never search for tattoos: no "tattoo", "tattoo design", "flash", "sketch". A reference shows the thing itself, never someone else's tattoo of it.
When a name has other meanings, add the kind of thing: "bat animal" (not a baseball bat or the Flying Bat nebula), "anchor ship".
Never add words about the medium or the source: no "photo", "illustration", "image", "picture", "drawing", "art", "Wikimedia", "Commons", "public domain", "high resolution", "official", "logo design".
Set "essential" to true only for a specific real-world entity whose exact appearance matters: a named emblem, crest, flag, landmark, statue, artwork or logo. Generic animals, plants, objects and scenes are false.
"label" is a short Spanish name for what the image must show, e.g. "el escudo del FC Barcelona", "un lobo aullando".
Never search for a real private person or for another tattoo artist's work.`;

const PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queries'],
  properties: {
    queries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['query', 'essential', 'label'],
        properties: {
          query: { type: 'string' },
          essential: { type: 'boolean' },
          label: { type: 'string' },
        },
      },
    },
  },
};

export const JUDGE_PROMPT = `You check candidate reference images for a tattoo design.
Each image is numbered and tagged with the search that found it. Keep only images that clearly and literally depict the thing that search was for, as the client described it.
Judge every image against the client's whole idea, not only its search: keep it only if it shows the main subject of the idea, or a named thing the idea asks to depict.
Reject materials, textures, mechanisms, patterns or decorations that only express a style, such as gears or machinery for "biomechanical", polygons for "geometric", paint splashes for "watercolour": the style is drawn by the studio.
Reject logos or text of unrelated things, maps, nebulae or scenes that merely share a word, different species or objects, and anything unclear.
Reject every tattoo, tattoo design, flash sheet or tattoo sketch, on skin or on paper: it is another artist's work, and copying it is not allowed.
Reject every image in which a person or any part of a human body appears, including skin, a face, hands, or a tattooed arm, leg, back or torso: the studio cannot use a stranger's body, and its safety check refuses it. A photograph of the animal, plant or object itself, a painting, a sculpture or a technical drawing is fine.
For a specific emblem, crest, flag or logo, keep only its current official design: reject historical, retired, simplified, fan-made or alternative versions unless the client asked for that version.
Return the numbers of the images to keep, best first. Returning none is correct when none fit.`;

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['keep'],
  properties: { keep: { type: 'array', items: { type: 'integer' } } },
};

export interface ClaudeScoutConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

function client(config: ClaudeScoutConfig, timeout: number, request?: typeof fetch) {
  const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  return apiKey
    ? new Anthropic({
        apiKey,
        timeout: config.timeoutMs ?? timeout,
        maxRetries: 0,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        ...(request ? { fetch: request } : {}),
      })
    : undefined;
}

/**
 * Words that name a style, a tattoo or a style's ingredients (TASK-0061). The planner is told not to
 * use them; this removes them when it does, since a search for "mechanical gears texture" found a
 * music box that then steered a biomechanical bat, and "owl tattoo design" found another artist's
 * tattoo. A query left empty is dropped.
 */
const NOT_A_SUBJECT = new Set([
  'tattoo',
  'tattoos',
  'flash',
  'sketch',
  'design',
  'designs',
  'style',
  'texture',
  'pattern',
  'biomechanical',
  'biomechanic',
  'mechanical',
  'gears',
  'gear',
  'cogs',
  'circuit',
  'circuits',
  'geometric',
  'polygon',
  'polygonal',
  'low-poly',
  'watercolour',
  'watercolor',
  'tribal',
  'blackwork',
  'chicano',
  'traditional',
  'neotraditional',
  'neo-traditional',
  'ornamental',
  'illustrative',
  'realistic',
  'realism',
  'surreal',
  'surrealist',
  'irezumi',
  'lettering',
  'mandala',
  'filigree',
]);

export function subjectQuery(query: string): string {
  const words = query.trim().split(/\s+/);
  const kept = words.filter(
    (word) => !NOT_A_SUBJECT.has(word.toLowerCase().replace(/[^a-z-]/g, '')),
  );
  // "american traditional rose" leaves "american rose"; the nationality only named the style.
  const subject =
    kept.length < words.length ? kept.filter((w) => w.toLowerCase() !== 'american') : kept;
  return subject.join(' ').slice(0, 120);
}

/** One query per named element, up to the references the scout may keep (TASK-0098). */
const MAX_PLANNED = 5;

export class ClaudeScoutQueryPlanner implements ScoutQueryPlanner {
  private readonly client: Anthropic | undefined;
  private readonly model: string;

  constructor(config: ClaudeScoutConfig = {}, request?: typeof fetch) {
    this.client = client(config, 15000, request);
    this.model = config.model ?? CLAUDE_SCOUT_MODEL;
  }

  async plan(subject: string): Promise<PlannedQuery[]> {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY is not configured for the scout.');
    const client = this.client;
    const message = await metered(
      { provider: 'anthropic', operation: 'scout_plan', model: this.model },
      () =>
        client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: PLANNER_PROMPT,
          messages: [{ role: 'user', content: subject.slice(0, 500) }],
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: PLANNER_SCHEMA },
          },
        }),
    );
    const parsed = JSON.parse(completedText(message)) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) throw new Error('Scout planner did not return queries.');
    const planned = parsed.queries
      .map((item) => item as { query?: unknown; essential?: unknown; label?: unknown })
      .filter((item) => typeof item.query === 'string')
      .map((item) => ({
        query: subjectQuery(String(item.query)),
        essential: item.essential === true,
        ...(typeof item.label === 'string' && item.label.trim()
          ? { label: item.label.trim().slice(0, 120) }
          : {}),
      }))
      .filter((item) => item.query.length > 0);
    return planned
      .filter((item, index) => planned.findIndex((other) => other.query === item.query) === index)
      .slice(0, MAX_PLANNED);
  }
}

export class ClaudeReferenceJudge implements ReferenceJudge {
  private readonly client: Anthropic | undefined;
  private readonly model: string;

  constructor(config: ClaudeScoutConfig = {}, request?: typeof fetch) {
    this.client = client(config, 30000, request);
    this.model = config.model ?? CLAUDE_SCOUT_MODEL;
  }

  async choose(subject: string, candidates: JudgeCandidate[]): Promise<number[]> {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY is not configured for the judge.');
    if (!candidates.length) return [];
    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: `Idea del cliente: ${subject.slice(0, 500)}` },
    ];
    candidates.forEach((candidate, index) => {
      content.push({
        type: 'text',
        text: `Imagen ${index} · búsqueda "${candidate.query}" · archivo "${candidate.title.slice(0, 160)}"`,
      });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: candidate.mediaType, data: candidate.data },
      });
    });
    const client = this.client;
    const message = await metered(
      { provider: 'anthropic', operation: 'scout_judge', model: this.model },
      () =>
        client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: JUDGE_PROMPT,
          messages: [{ role: 'user', content }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
        }),
    );
    const parsed = JSON.parse(completedText(message)) as { keep?: unknown };
    if (!Array.isArray(parsed.keep)) throw new Error('Reference judge did not return a list.');
    return parsed.keep.filter(
      (i): i is number => Number.isInteger(i) && i >= 0 && i < candidates.length,
    );
  }
}
