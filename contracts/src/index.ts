/**
 * The contracts module.
 *
 * Validation authority lives here and nowhere else. `validateAgainst` runs a canonical
 * schema document through ajv; the generated types are for editor support and carry no
 * authority (ADR-0004 refinement).
 *
 * Do not add a hand-written type guard alongside this. The whole point of the module is
 * that one document decides what is valid, in both runtimes.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import { type SchemaName, schemaNames, schemas } from './generated/schemas';
import type { Design } from './generated/design';
import type { TattooBrief } from './generated/tattoo-brief';

export type { Design } from './generated/design';
export type {
  StudioJobStatus,
  GeneratedTattooArtifact,
  StudioAsset,
} from './generated/studio-status';
export type { TattooBrief } from './generated/tattoo-brief';
export type { SharedDesign, SharedAsset } from './generated/shared-design';
export type { BodyPart, StyleName } from './generated/tattoo-brief';
export { schemaNames, schemas } from './generated/schemas';
export type { SchemaName } from './generated/schemas';

/** A validation failure, reduced to what a caller can act on. */
export interface ValidationIssue {
  /** JSON Pointer into the payload, e.g. `/size/widthMm`. Empty string means the root. */
  path: string;
  message: string;
  keyword: string;
}

export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; issues: ValidationIssue[] };

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // `strictRequired` expects every property named in `required` to be declared in the
  // same subschema. The colour rules legitimately put `required` inside an if/then
  // branch while `palette` is declared on the parent, which trips it. This is an ajv
  // authoring lint with no counterpart in Python's `jsonschema`, so relaxing it cannot
  // make the two runtimes disagree — the corpus would catch it if it could. Every other
  // strict-mode check stays on.
  strictRequired: false,
  // `format` is deliberately unused in the schemas: it is assertive only when a format
  // checker is wired up, and the two runtimes wire it differently. Patterns are used
  // instead so both reach identical verdicts.
  validateFormats: false,
});

const compiled = new Map<SchemaName, ValidateFunction>(
  schemaNames.map((name) => [name, ajv.compile(schemas[name]!)] as const),
);

function toIssue(error: ErrorObject): ValidationIssue {
  return {
    path: error.instancePath,
    message: error.message ?? 'invalid',
    keyword: error.keyword,
  };
}

/** Validate an unknown payload against a named canonical schema. */
export function validateAgainst<T>(name: SchemaName, payload: unknown): ValidationResult<T> {
  const validate = compiled.get(name);
  if (!validate) {
    throw new Error(`unknown schema '${name}'; known: ${schemaNames.join(', ')}`);
  }
  if (validate(payload)) {
    return { valid: true, value: payload as T };
  }
  return { valid: false, issues: (validate.errors ?? []).map(toIssue) };
}

/** Thrown by the `assert*` helpers. Names the schema and every failing path. */
export class ContractValidationError extends Error {
  readonly issues: ValidationIssue[];
  readonly schemaName: string;

  constructor(schemaName: string, issues: ValidationIssue[]) {
    const detail = issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ');
    super(`${schemaName} failed validation: ${detail}`);
    this.name = 'ContractValidationError';
    this.schemaName = schemaName;
    this.issues = issues;
  }
}

export function validateTattooBrief(payload: unknown): ValidationResult<TattooBrief> {
  return validateAgainst<TattooBrief>('tattoo-brief', payload);
}

export function validateDesign(payload: unknown): ValidationResult<Design> {
  return validateAgainst<Design>('design', payload);
}

export function assertTattooBrief(payload: unknown): TattooBrief {
  const result = validateTattooBrief(payload);
  if (!result.valid) {
    throw new ContractValidationError('TattooBrief', result.issues);
  }
  return result.value;
}

export function assertDesign(payload: unknown): Design {
  const result = validateDesign(payload);
  if (!result.valid) {
    throw new ContractValidationError('Design', result.issues);
  }
  return result.value;
}

export type { StudioJob } from './generated/studio-job';

/**
 * Shared reference anatomy (TASK-0027, ADR-0008). The same document the worker reads, copied
 * byte-identically into the Python package by its generator, so a size resolved during the
 * consultation and one resolved in the worker cannot come from different numbers.
 */
import bodyZones from '../reference/body-zones.json';

export interface BodyZoneSpan {
  widthMm: number;
  heightMm: number;
}

export const BODY_ZONE_SPANS: Readonly<Record<string, BodyZoneSpan>> = bodyZones.zones;

/** Fraction of a zone a qualitative size claims. `large` fills it. */
export const SIZE_SCALES: Readonly<Record<string, number>> = bodyZones.scales;

/**
 * Style catalogue (TASK-0028, ADR-0012). `phrase` is the visual-characteristics string used both
 * to generate the catalogue image and to describe the style to a client, held once so the two
 * cannot drift. Variants describe what a sub-family looks like, never who makes it.
 */
import styleLibrary from '../reference/style-library.json';

export interface StyleCatalogueVariant {
  id: string;
  label: string;
  characteristics: string;
}

export interface StyleCatalogueEntry {
  label: string;
  phrase: string;
  variants: StyleCatalogueVariant[];
}

export const STYLE_CATALOGUE: Readonly<Record<string, StyleCatalogueEntry>> =
  styleLibrary.styles as unknown as Record<string, StyleCatalogueEntry>;
