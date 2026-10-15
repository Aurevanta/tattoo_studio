import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultBody, isBodyType } from './body-type';
import { limbModelUrl } from './limb-wrap';
import { bodyModelUrl } from './body-zones';

const glbExtras = (path: string) => {
  const bytes = readFileSync(resolve(__dirname, '../../public', path.replace(/^\//, '')));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')).scenes[0].extras;
};

describe('a masculine or a feminine reference body (TASK-0110, ADR-0038)', () => {
  it('starts where the plate library would: sha256 of the brief, first byte, even = masculine', async () => {
    // Python: hashlib.sha256(b"b").digest()[0] == 0x3e, even.
    expect(await defaultBody('b')).toBe('masculine');
    // hashlib.sha256(b"x").digest()[0] == 0x2d, odd.
    expect(await defaultBody('x')).toBe('feminine');
  });

  it('names its models, and each model says which body it is', () => {
    for (const body of ['masculine', 'feminine'] as const) {
      expect(glbExtras(bodyModelUrl(body)).body).toBe(body);
      for (const limb of ['leg', 'forearm'] as const) {
        const extras = glbExtras(limbModelUrl(limb, body));
        expect(extras.body).toBe(body);
        // The reference length is kept: what a sleeve's band and its stencil are measured on.
        expect(extras.proximalMm).toBe(glbExtras(limbModelUrl(limb)).proximalMm);
      }
    }
    expect(limbModelUrl('leg')).toBe('/models/lower-leg.glb');
    expect(isBodyType('feminine')).toBe(true);
    expect(isBodyType('neutral')).toBe(false);
  });
});
