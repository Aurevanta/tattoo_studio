import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AGING_DISCLAIMER,
  ARTIST_STYLE_NOTICE,
  SKIN_SCALE_NOTE_ES,
  stencilSizeNote,
  VISUALIZATION_DISCLAIMER,
} from './disclaimers';

describe('required disclaimer copy (WEB-INV-003)', () => {
  it('states that output is a visualization rather than a guarantee', () => {
    expect(VISUALIZATION_DISCLAIMER).toContain('visualization');
    expect(VISUALIZATION_DISCLAIMER).toContain('not a guarantee');
  });

  it('marks aging output as illustrative and explicitly not a prediction', () => {
    expect(AGING_DISCLAIMER).toContain('Illustrative');
    expect(AGING_DISCLAIMER).toContain('not a prediction');
  });

  it('declines living-artist style mimicry (PROD-INV-004)', () => {
    expect(ARTIST_STYLE_NOTICE).toContain('do not imitate');
  });

  it('has no empty disclaimer, which would silently satisfy a naive render check', () => {
    for (const copy of [VISUALIZATION_DISCLAIMER, AGING_DISCLAIMER, ARTIST_STYLE_NOTICE]) {
      expect(copy.trim().length).toBeGreaterThan(40);
    }
  });
});

describe('what «real size» means (TASK-0125)', () => {
  it('says the skin view is approximate unless calibrated, and the stencil is exact', () => {
    expect(SKIN_SCALE_NOTE_ES).toMatch(/orientativa salvo que calibres/);
    expect(SKIN_SCALE_NOTE_ES).toMatch(/plantilla y los PDF sí se exportan a las medidas/);
    expect(stencilSizeNote({ widthMm: 100, heightMm: 188 })).toBe(
      'Tamaño sobre la piel orientativo · la plantilla sí mide 100 × 188 mm',
    );
  });

  it('is not undone by a page that still promises real size on the skin', () => {
    const pages = ['src/app/inicio/page.tsx', 'src/app/page.tsx', 'src/app/probar/page.tsx'];
    for (const page of pages) {
      const source = readFileSync(resolve(__dirname, '../..', page), 'utf8');
      expect(source).not.toMatch(/tamaño real sobre|escala real sobre/i);
    }
  });
});
