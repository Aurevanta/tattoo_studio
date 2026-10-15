import { describe, expect, it } from 'vitest';
import { bodyViewOf, designZone, limbViewOf, zoneSpanOf } from './design-zone';

const calf = { bodyPart: 'calf', orientation: 'vertical', side: 'left' } as const;

describe('where a design goes (TASK-0108)', () => {
  it('takes the zone from the design, whatever consultation is open', () => {
    const fromHistory = { briefId: 'old', placement: calf };
    const open = { sessionId: 'new', placement: { bodyPart: 'chest', orientation: 'vertical' } };
    expect(designZone(fromHistory, open)).toEqual(calf);
    expect(designZone(fromHistory, undefined)).toEqual(calf);
  });

  it('falls back to the open consultation only for its own designs', () => {
    const served = { briefId: 'b' };
    const open = { sessionId: 'b', placement: calf };
    expect(designZone(served, open)?.bodyPart).toBe('calf');
    expect(designZone(served, { ...open, sessionId: 'other' })).toBeUndefined();
  });

  it('opens the 3D view for a lower leg or a forearm, on its side', () => {
    expect(limbViewOf(calf, { widthMm: 120 })).toEqual({
      zone: 'calf',
      side: 'left',
      wraps: false,
    });
    expect(limbViewOf({ ...calf, side: 'right' }, { widthMm: 120 })?.side).toBe('right');
    expect(limbViewOf({ ...calf, orientation: 'wrapping' }, { widthMm: 344 })?.wraps).toBe(true);
    expect(limbViewOf({ bodyPart: 'chest' }, { widthMm: 120 })).toBeUndefined();
    expect(limbViewOf(undefined, { widthMm: 120 })).toBeUndefined();
  });

  it('gives the zone its reference span', () => {
    expect(zoneSpanOf(calf)?.heightMm).toBeGreaterThan(0);
    expect(zoneSpanOf(undefined)).toBeUndefined();
  });
});

describe('the whole-body 3D view (TASK-0109)', () => {
  it('opens for every zone the limb view does not cover, on its side', () => {
    expect(bodyViewOf({ bodyPart: 'chest', side: 'right' })).toEqual({
      zone: 'chest',
      side: 'right',
    });
    expect(bodyViewOf({ bodyPart: 'upper_back' })).toEqual({ zone: 'upper_back', side: 'left' });
    expect(bodyViewOf({ bodyPart: 'calf' })).toBeUndefined();
    expect(bodyViewOf(undefined)).toBeUndefined();
  });
});
