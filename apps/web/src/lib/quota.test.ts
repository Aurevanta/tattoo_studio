import { describe, expect, it } from 'vitest';

import { asQuota, canDesign, designsNote, type Quota } from './quota';

const quota = (used: number, limit: number, remaining: number): Quota => ({
  designs: { used, limit, remaining },
  turns: { used: 0, limit: 100, remaining: 100 },
  resetsAt: '2026-10-10T00:00:00+00:00',
});

describe('the daily counter (TASK-0095)', () => {
  it('says how many designs are left, in the singular too', () => {
    expect(designsNote(quota(2, 20, 18))).toBe('Te quedan 18 de 20 diseños hoy.');
    expect(designsNote(quota(19, 20, 1))).toBe('Te queda 1 diseño de 20 hoy.');
  });

  it('tells the account it has used its own allowance apart from the studio being full', () => {
    expect(designsNote(quota(20, 20, 0))).toBe(
      'Has usado tus 20 diseños de hoy. Podrás crear más mañana.',
    );
    expect(designsNote(quota(3, 20, 0))).toMatch(/El estudio ha llegado a su límite/);
  });

  it('blocks a new design only when the worker said nothing is left', () => {
    expect(canDesign(quota(20, 20, 0))).toBe(false);
    expect(canDesign(quota(1, 20, 19))).toBe(true);
    // An unknown count (the worker did not answer) never blocks: the limit is still enforced there.
    expect(canDesign(null)).toBe(true);
    expect(designsNote(null)).toBeNull();
  });

  it('accepts only a well-formed answer', () => {
    expect(asQuota(quota(1, 20, 19))).toEqual(quota(1, 20, 19));
    expect(asQuota({ designs: { used: -1, limit: 20, remaining: 21 } })).toBeNull();
    expect(asQuota({ ...quota(1, 20, 19), resetsAt: 5 })).toBeNull();
    expect(asQuota('nope')).toBeNull();
  });
});
