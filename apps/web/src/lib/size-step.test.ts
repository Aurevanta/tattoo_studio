import { describe, expect, it } from 'vitest';

import { nudgedSize, sizeNudge, SIZE_STEP } from './size-step';

describe('a written nudge is a confirmed print change (TASK-0123, ADR-0043)', () => {
  it('recognises the phrases the worker reads as a nudge, and nothing more', () => {
    expect(sizeNudge('Más grande')).toBe('larger');
    expect(sizeNudge('hazlo un poco más grande!')).toBe('larger');
    expect(sizeNudge('lo quiero mas pequeño')).toBe('smaller');
    expect(sizeNudge('el tatuaje mucho más pequeño.')).toBe('smaller');
    // Anything else is a change of the drawing, sent as it is.
    expect(sizeNudge('más grande y con rosas')).toBeNull();
    expect(sizeNudge('que ocupe toda la zona')).toBeNull();
    expect(sizeNudge('haz el escudo más pequeño')).toBeNull();
  });

  it('uses the worker step and rounding, and one step undoes the other', () => {
    expect(SIZE_STEP.larger * SIZE_STEP.smaller).toBe(1);
    // Same values as services/worker/app/tests/test_studio.py (nudged_size).
    expect(nudgedSize({ widthMm: 80, heightMm: 150 }, 'larger')).toEqual({
      widthMm: 100,
      heightMm: 188,
    });
    expect(nudgedSize({ widthMm: 100, heightMm: 188 }, 'smaller')).toEqual({
      widthMm: 80,
      heightMm: 150,
    });
  });

  it('refuses a size that cannot be tattooed', () => {
    expect(nudgedSize({ widthMm: 200, heightMm: 500 }, 'larger')).toBeNull();
    expect(nudgedSize({ widthMm: 5, heightMm: 40 }, 'smaller')).toBeNull();
  });
});
