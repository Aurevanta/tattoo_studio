/**
 * TypeScript half of the shared fixture corpus.
 *
 * The Python suite reads the same manifests and the same fixture files. Both must reach
 * the identical verdict on every case; that agreement is what ARCH-INV-005 asks for, and
 * is why the corpus lives outside either runtime.
 *
 * The suite is driven by `schemaNames`, so a new schema is covered the moment it is
 * generated — there is no per-schema test to forget to write.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertDesign,
  assertTattooBrief,
  ContractValidationError,
  type SchemaName,
  schemaNames,
  validateAgainst,
  validateTattooBrief,
  circumferenceAt,
  isSleeve,
  WRAP_REGIONS,
  wrapRegionOf,
  wrapSize,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../fixtures');

interface Case {
  name: string;
  file: string;
  valid: boolean;
  why: string;
}

function manifest(schema: SchemaName): { cases: Case[] } {
  return JSON.parse(readFileSync(resolve(fixtures, schema, 'manifest.json'), 'utf8'));
}

function load(schema: SchemaName, file: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtures, schema, file), 'utf8'));
}

function cases(valid: boolean): Array<[string, SchemaName, Case]> {
  return schemaNames.flatMap((schema) =>
    manifest(schema)
      .cases.filter((c) => c.valid === valid)
      .map((c) => [`${schema}:${c.name}`, schema, c] as [string, SchemaName, Case]),
  );
}

describe.each(schemaNames)('corpus for %s', (schema) => {
  it('is substantial enough to be meaningful', () => {
    // Guards against a corpus being quietly emptied, which would make every other
    // test in this file pass vacuously.
    const all = manifest(schema).cases;
    expect(all.filter((c) => c.valid).length).toBeGreaterThanOrEqual(5);
    expect(all.filter((c) => !c.valid).length).toBeGreaterThanOrEqual(12);
  });
});

describe('shared fixture corpus', () => {
  it.each(cases(true))('accepts %s', (_id, schema, testCase) => {
    const result = validateAgainst(schema, load(schema, testCase.file));
    if (!result.valid) {
      throw new Error(`expected valid (${testCase.why}) but got: ${JSON.stringify(result.issues)}`);
    }
    expect(result.valid).toBe(true);
  });

  it.each(cases(false))('rejects %s', (_id, schema, testCase) => {
    const result = validateAgainst(schema, load(schema, testCase.file));
    expect(result.valid, `expected rejection because ${testCase.why}`).toBe(false);
  });
});

describe('validation surface', () => {
  it('rejects an unknown schema name rather than silently passing', () => {
    expect(() => validateAgainst('not-a-schema' as SchemaName, {})).toThrow(/unknown schema/);
  });

  it('reports every problem at once rather than only the first', () => {
    const payload = load('tattoo-brief', 'invalid/size-below-minimum.json') as Record<
      string,
      unknown
    >;

    const result = validateTattooBrief({ ...payload, revision: 0 });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(1);
    }
  });

  it('names the failing path in a thrown brief error', () => {
    try {
      assertTattooBrief(load('tattoo-brief', 'invalid/size-below-minimum.json'));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      const issues = (error as ContractValidationError).issues;
      expect(issues.some((i) => i.path.includes('widthMm'))).toBe(true);
    }
  });

  it('names the schema in a thrown design error', () => {
    try {
      assertDesign(load('design', 'invalid/missing-provenance.json'));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).schemaName).toBe('Design');
    }
  });

  it('rejects pixel dimensions on a brief (CONTRACTS-INV-001)', () => {
    const result = validateAgainst(
      'tattoo-brief',
      load('tattoo-brief', 'invalid/pixel-dimensions-instead-of-mm.json'),
    );

    expect(result.valid).toBe(false);
  });

  it('rejects physical size on a design (CONTRACTS-INV-001, mirrored)', () => {
    // A design's raster has pixels and no millimetres. Putting mm on a design would
    // create a second source of truth for the tattoo's size.
    const result = validateAgainst(
      'design',
      load('design', 'invalid/unknown-top-level-field.json'),
    );

    expect(result.valid).toBe(false);
  });

  it('rejects a signed URL as a storage key (SEC-INV-008)', () => {
    const result = validateAgainst('design', load('design', 'invalid/storage-key-is-a-url.json'));

    expect(result.valid).toBe(false);
  });

  it('rejects a style outside the closed vocabulary (CONTRACTS-INV-002)', () => {
    const result = validateAgainst(
      'tattoo-brief',
      load('tattoo-brief', 'invalid/style-free-text.json'),
    );

    expect(result.valid).toBe(false);
  });
});

describe('embedded brief', () => {
  // TASK-0057: studio-job carries its own copy of the brief. TASK-0027 widened the style
  // vocabulary in tattoo-brief only, so every job for six styles was refused for months while the
  // consultation offered them. A copy must stay identical to its source.
  const schemas = resolve(here, '../schemas');
  const read = (file: string): Record<string, unknown> =>
    JSON.parse(readFileSync(resolve(schemas, file), 'utf8'));
  const source = read('tattoo-brief.schema.json');
  const sourceDefs = source['$defs'] as Record<string, unknown>;
  const body = Object.fromEntries(
    Object.entries(source).filter(([key]) => !['$schema', '$id', 'title', '$defs'].includes(key)),
  );

  it.each(['studio-job.schema.json'])('%s matches tattoo-brief', (file) => {
    const schema = read(file);
    expect((schema['properties'] as Record<string, unknown>)['brief']).toEqual(body);
    const defs = schema['$defs'] as Record<string, unknown>;
    for (const name of Object.keys(sourceDefs).filter((key) => key in defs))
      expect(defs[name], name).toEqual(sourceDefs[name]);
  });
});

describe('sleeves (TASK-0104)', () => {
  it('resolve a sleeve size for the lower leg and the forearm, and none elsewhere', () => {
    expect(wrapSize('calf')).toEqual({ widthMm: 344, heightMm: 310 });
    expect(wrapSize('shin')).toEqual(wrapSize('calf'));
    expect(wrapSize('inner_forearm')).toEqual({ widthMm: 255, heightMm: 215 });
    expect(wrapSize('outer_forearm')).toEqual(wrapSize('inner_forearm'));
    expect(wrapSize('chest')).toBeUndefined();
    expect(wrapSize(undefined)).toBeUndefined();
    expect(wrapRegionOf('ankle')).toBeUndefined();
    expect(Object.keys(WRAP_REGIONS).sort()).toEqual(['forearm', 'lower_leg']);
  });

  it('tell a sleeve from a band that also wraps', () => {
    const calf = { bodyPart: 'calf', orientation: 'wrapping' };
    expect(isSleeve(calf, { widthMm: 344 })).toBe(true);
    expect(isSleeve(calf, { widthMm: 310 })).toBe(true);
    expect(isSleeve(calf, { widthMm: 120 })).toBe(false);
    expect(isSleeve({ ...calf, orientation: 'vertical' }, { widthMm: 344 })).toBe(false);
    expect(isSleeve({ bodyPart: 'ankle', orientation: 'wrapping' }, { widthMm: 344 })).toBe(false);
    expect(isSleeve(undefined, undefined)).toBe(false);
  });
});

describe('the circumference down a sleeve (TASK-0105)', () => {
  it('interpolates the profile as the Python twin does', () => {
    const leg = WRAP_REGIONS['lower_leg']!;
    const profile = leg.circumferenceProfileMm;
    expect(profile.length).toBe(leg.lengthMm / leg.profileStepMm + 1);
    expect(circumferenceAt(leg, 0)).toBe(profile[0]);
    expect(circumferenceAt(leg, 5)).toBeCloseTo((profile[0]! + profile[1]!) / 2, 9);
    expect(circumferenceAt(leg, -10)).toBe(profile[0]);
    expect(circumferenceAt(leg, 1e6)).toBe(profile[profile.length - 1]);
    expect(Math.abs(Math.max(...profile) - leg.circumferenceMm)).toBeLessThan(1);
  });
});
