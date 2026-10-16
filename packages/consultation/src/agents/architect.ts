/**
 * The prompt architect on the live route (TASK-0033, resolves FINDING-0004).
 *
 * The orchestrator extracts what the client said explicitly (regex, `researcher.ts`) and then asks
 * a `ConsultationProvider` — Claude Opus 5.5 in production — to propose the rest. This module owns
 * the three things that make that safe:
 *
 * - **Turns:** conversation text is sent, in the alternating shape the providers require. The one
 *   exception is the images a client attaches to the idea (TASK-0113, ADR-0039): screened by the
 *   input gate, they ride on that message alone, each labelled «Imagen N». No other reference
 *   image, and no body photograph, reaches a language model.
 * - **Sanitizing:** every proposed value is checked against the contract vocabulary and bounds;
 *   anything else is dropped rather than passed through (CONSULT-INV-003).
 * - **Merging:** explicit statements and earlier decisions win. The architect fills gaps, and may
 *   replace only the untouched technical defaults. Its size recommendation is never taken as the
 *   client's measurement: `proposeSize` fits it to the zone and flags it as a proposal, shown as
 *   such (TASK-0034, ADR-0010). It never sets the side of the body, which only the client states.
 */

import type { BodyPart, StyleName } from '@tattoo/contracts';

import type { ConsultationProvider } from '../providers/types';
import type { ConsultationSlots, ConsultationTurn, ReferenceImage } from '../types';
import type { MultiAgentMessage } from './types';
import { BODY_OPTIONS, DEFAULT_LINEWORK_NOTE, STYLE_OPTIONS } from './researcher';

const WEIGHTS = ['fine', 'medium', 'bold', 'mixed'] as const;
const TECHNIQUES = ['none', 'whip', 'dotwork', 'smooth_blend', 'solid_fill', 'mixed'] as const;
const INTENSITIES = ['light', 'medium', 'heavy'] as const;
const COLOUR_MODES = ['black_and_grey', 'colour', 'black_and_grey_with_accent'] as const;
const ORIENTATIONS = ['vertical', 'horizontal', 'diagonal', 'wrapping'] as const;
const SIDES = ['left', 'right', 'centre'] as const;
const BODY_TYPES = ['masculine', 'feminine'] as const;

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const list = (value: unknown, maxItems: number, maxLength: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => text(item, maxLength))
    .filter((item): item is string => Boolean(item));
  return items.length ? items.slice(0, maxItems) : undefined;
};

const isStyle = (value: unknown): value is StyleName =>
  typeof value === 'string' && Object.hasOwn(STYLE_OPTIONS, value);

/**
 * A zone the client panel offers. The contract has 26 zones but the panel lists 16; a proposal
 * outside them could be neither shown nor edited there, and the brief would print its raw id.
 */
const isBodyPart = (value: unknown): value is BodyPart =>
  typeof value === 'string' && Object.hasOwn(BODY_OPTIONS, value);

/**
 * Keep only what the TattooBrief contract accepts. Unknown shapes, values outside the closed
 * vocabularies and oversized text are dropped. `size` is deliberately never read.
 */
export function sanitizeArchitectSlots(raw: unknown): ConsultationSlots {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, Record<string, unknown> | undefined>;
  const slots: ConsultationSlots = {};

  const elements = list(input['subject']?.['elements'], 20, 120);
  // TASK-0065: the professional description, bounded like the contract (1200 characters).
  const refined = text(input['subject']?.['refined'], 1200);
  if (elements || refined)
    slots.subject = { ...(elements ? { elements } : {}), ...(refined ? { refined } : {}) };

  const primary = input['style']?.['primary'];
  if (isStyle(primary)) {
    const secondary = input['style']?.['secondary'];
    const notes = text(input['style']?.['notes'], 600);
    slots.style = {
      primary,
      ...(isStyle(secondary) && secondary !== primary ? { secondary } : {}),
      ...(notes ? { notes } : {}),
    };
  }

  const weight = oneOf(WEIGHTS, input['linework']?.['weight']);
  if (weight) {
    const notes = text(input['linework']?.['notes'], 400);
    slots.linework = { weight, ...(notes ? { notes } : {}) };
  }

  const technique = oneOf(TECHNIQUES, input['shading']?.['technique']);
  const intensity = oneOf(INTENSITIES, input['shading']?.['intensity']);
  if (technique && intensity) slots.shading = { technique, intensity };

  const mode = oneOf(COLOUR_MODES, input['colour']?.['mode']);
  if (mode) {
    const palette =
      mode === 'black_and_grey' ? undefined : list(input['colour']?.['palette'], 8, 40);
    slots.colour = { mode, ...(palette ? { palette } : {}) };
  }

  const bodyPart = input['placement']?.['bodyPart'];
  const orientation = oneOf(ORIENTATIONS, input['placement']?.['orientation']);
  const side = oneOf(SIDES, input['placement']?.['side']);
  const bodyType = oneOf(BODY_TYPES, input['placement']?.['bodyType']);
  if (isBodyPart(bodyPart) || orientation || side || bodyType) {
    slots.placement = {
      ...(isBodyPart(bodyPart) ? { bodyPart } : {}),
      ...(orientation ? { orientation } : {}),
      ...(side ? { side } : {}),
      ...(bodyType ? { bodyType } : {}),
    };
  }

  const avoid = list(input['constraints']?.['avoid'], 20, 120);
  const coverUp = input['constraints']?.['coverUp'];
  if (avoid || typeof coverUp === 'boolean') {
    slots.constraints = {
      ...(avoid ? { avoid } : {}),
      ...(typeof coverUp === 'boolean' ? { coverUp } : {}),
    };
  }

  return slots;
}

/** A field the keyword rules can read from free text, which the architect may reread. */
export type TextReading = 'style' | 'colour' | 'bodyPart' | 'bodyType';

/**
 * Which fields the keyword rules set from the current message alone (TASK-0039): changed from
 * what the session held, and not chosen in the panel in the same request. The side is absent on
 * purpose: only the client states it, and the architect never sets it.
 */
export function textReadings(
  before: ConsultationSlots,
  after: ConsultationSlots,
  panel: ConsultationSlots = {},
): Set<TextReading> {
  const read = new Set<TextReading>();
  if (!panel.style && after.style?.primary !== before.style?.primary) read.add('style');
  if (!panel.colour && JSON.stringify(after.colour) !== JSON.stringify(before.colour))
    read.add('colour');
  if (!panel.placement && after.placement?.bodyPart !== before.placement?.bodyPart)
    read.add('bodyPart');
  if (!panel.placement && after.placement?.bodyType !== before.placement?.bodyType)
    read.add('bodyType');
  return read;
}

const isDefaultShading = (s: ConsultationSlots['shading']): boolean =>
  s?.technique === 'none' && s.intensity === 'light';

/**
 * Fill the gaps in `explicit` with `proposed`. Explicit values always win; the technical
 * proposals (linework, shading) may replace only their untouched defaults. Size and side are
 * never merged: both are facts the client states, not proposals.
 */
export function mergeArchitect(
  stated: ConsultationSlots,
  proposed: ConsultationSlots,
  guessed: ReadonlySet<TextReading> = new Set(),
): ConsultationSlots {
  // TASK-0039: a value the keyword rules pulled out of this very message is a guess at what the
  // client wrote, not something they chose in the panel. The architect read the same sentence
  // whole, so where it answered, its reading replaces the guess. Live, the rules took
  // "parte en blanco y negro y el resto en color" as black and grey while Opus had it right.
  const explicit: ConsultationSlots = { ...stated };
  if (guessed.has('style') && proposed.style?.primary) delete explicit.style;
  if (guessed.has('colour') && proposed.colour?.mode) delete explicit.colour;
  if (guessed.has('bodyPart') && proposed.placement?.bodyPart && explicit.placement) {
    explicit.placement = { ...explicit.placement };
    delete explicit.placement.bodyPart;
  }
  if (guessed.has('bodyType') && proposed.placement?.bodyType && explicit.placement) {
    explicit.placement = { ...explicit.placement };
    delete explicit.placement.bodyType;
  }
  const merged: ConsultationSlots = { ...explicit };

  if (proposed.subject?.elements && !explicit.subject?.elements?.length) {
    merged.subject = { ...explicit.subject, elements: proposed.subject.elements };
  }
  // TASK-0065: the architect drafts the professional description once; the client's edit wins.
  if (proposed.subject?.refined && !explicit.subject?.refined) {
    merged.subject = { ...merged.subject, refined: proposed.subject.refined };
  }

  if (!explicit.style?.primary && proposed.style) {
    merged.style = proposed.style;
  } else if (
    explicit.style?.primary &&
    proposed.style?.primary === explicit.style.primary &&
    !explicit.style.notes &&
    proposed.style.notes
  ) {
    // Same style the client chose: the architect's technical notes are pure added detail.
    merged.style = { ...explicit.style, notes: proposed.style.notes };
  }

  if (
    proposed.linework &&
    (!explicit.linework || explicit.linework.notes === DEFAULT_LINEWORK_NOTE)
  ) {
    merged.linework = proposed.linework;
  }

  if (proposed.shading && (!explicit.shading || isDefaultShading(explicit.shading))) {
    merged.shading = proposed.shading;
  }

  if (!explicit.colour?.mode && proposed.colour) merged.colour = proposed.colour;

  if (proposed.placement) {
    // The side is never taken from the architect: it is the client's choice about their own body,
    // not a design proposal. Live, Opus picked "right" for "la pierna" and said so only in a reply
    // the live route never shows, so the brief would have presented a guess as the client's word.
    merged.placement = {
      ...explicit.placement,
      bodyPart: explicit.placement?.bodyPart ?? proposed.placement.bodyPart,
      orientation: explicit.placement?.orientation ?? proposed.placement.orientation,
      // TASK-0041: body sex is proposed by the architect (unlike side), the client overriding it.
      bodyType: explicit.placement?.bodyType ?? proposed.placement.bodyType,
    };
  }

  if (!explicit.constraints && proposed.constraints) merged.constraints = proposed.constraints;

  return merged;
}

/**
 * The conversation as provider turns: client messages are `user`, everything the studio said is
 * `assistant`; adjacent same-role messages are joined, a leading assistant is dropped, and the turn
 * list always ends with the client's current input. Text only.
 */
export function conversationTurns(
  messages: MultiAgentMessage[],
  input: string,
): ConsultationTurn[] {
  const turns: ConsultationTurn[] = [];
  for (const message of messages.slice(-20)) {
    const role = message.senderLabel === 'Cliente' ? 'user' : 'assistant';
    const content = message.content.slice(0, 2000);
    const last = turns[turns.length - 1];
    if (last?.role === role) last.content = `${last.content}\n${content}`;
    else if (turns.length || role === 'user') {
      turns.push({ role, content, timestamp: message.timestamp });
    }
  }
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'user' || !last.content.endsWith(input.slice(0, 2000))) {
    if (last?.role === 'user') last.content = `${last.content}\n${input}`;
    else turns.push({ role: 'user', content: input, timestamp: new Date().toISOString() });
  }
  return turns;
}

export interface ArchitectProposal {
  slots: ConsultationSlots;
  /**
   * The architect's size recommendation (TASK-0034). Never merged as a client value: it only
   * feeds `proposeSize`, which fits it to the zone and flags it as a proposal.
   */
  size?: { widthMm: number; heightMm: number };
  /** Set only for a genuine request to imitate a named living artist (PROD-INV-004). */
  mimicry?: { artistName: string; explanation?: string };
  /** TASK-0070: the idea asks for sexually explicit content (rule 11). */
  refused?: true;
}

/** A usable size recommendation: both dimensions within the contract's 5–600 mm. */
export function sanitizeArchitectSize(
  raw: unknown,
): { widthMm: number; heightMm: number } | undefined {
  const size = (raw as { size?: { widthMm?: unknown; heightMm?: unknown } } | undefined)?.size;
  const ok = (v: unknown): v is number => typeof v === 'number' && v >= 5 && v <= 600;
  return size && ok(size.widthMm) && ok(size.heightMm)
    ? { widthMm: size.widthMm, heightMm: size.heightMm }
    : undefined;
}

/**
 * Ask the architect for a proposal. Returns `undefined` on any failure so the caller keeps the
 * deterministic path: an unavailable model must never break a consultation.
 */
export async function consultArchitect(
  architect: ConsultationProvider,
  messages: MultiAgentMessage[],
  input: string,
  current: ConsultationSlots,
  images: ReferenceImage[] = [],
): Promise<ArchitectProposal | undefined> {
  try {
    const turns = conversationTurns(messages, input);
    const last = turns[turns.length - 1];
    if (images.length && last) last.referenceImages = images;
    const output = await architect.processTurn(turns, current);
    const artistName = text(output.mimicryDetected?.artistName, 120);
    const explanation = text(output.mimicryDetected?.explanation, 600);
    const size = sanitizeArchitectSize(output.extractedSlots);
    return {
      slots: sanitizeArchitectSlots(output.extractedSlots),
      ...(size ? { size } : {}),
      ...(artistName ? { mimicry: { artistName, ...(explanation ? { explanation } : {}) } } : {}),
      ...(output.contentRefused ? { refused: true as const } : {}),
    };
  } catch (error) {
    // No user text, response body or credential in the log line.
    console.warn(
      `Architect unavailable (${error instanceof Error ? error.name : 'error'}); ` +
        'using deterministic extraction.',
    );
    return undefined;
  }
}
