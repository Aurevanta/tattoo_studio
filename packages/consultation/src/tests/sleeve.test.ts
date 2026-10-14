import { describe, expect, it } from 'vitest';

import { isSleeve } from '@tattoo/contracts';

import { extractPreferences, proposeSize, sleeveLimb } from '../agents/researcher';
import { brief } from '../state-machine';

// TASK-0104 (ADR-0034): a sleeve asked in the client's own words.

const from = (input: string, existing = {}) => extractPreferences(input, existing);

describe('a sleeve in the client’s words', () => {
  it('reads a lower-leg sleeve and gives it the leg’s unrolled size', () => {
    for (const idea of [
      'una manga de rosas de la rodilla al tobillo en la pierna izquierda',
      'quiero que rodee toda la pierna, un bosque',
      'olas japonesas alrededor de la pantorrilla',
    ]) {
      const slots = from(idea);
      expect(slots.placement?.orientation, idea).toBe('wrapping');
      expect(slots.placement?.bodyPart, idea).toBe('calf');
      expect(slots.size, idea).toEqual({ widthMm: 344, heightMm: 310 });
      expect(isSleeve(slots.placement, slots.size), idea).toBe(true);
    }
  });

  it('keeps the shin when that is the zone named', () => {
    const slots = from('una manga en la espinilla, alrededor de la pierna');
    expect(slots.placement?.orientation).toBe('wrapping');
    expect(['calf', 'shin']).toContain(slots.placement?.bodyPart);
  });

  it('reads a forearm sleeve', () => {
    const slots = from('un diseño tribal que envuelva todo el antebrazo, del codo a la muñeca');
    expect(slots.placement?.orientation).toBe('wrapping');
    expect(slots.placement?.bodyPart).toBe('inner_forearm');
    expect(slots.size).toEqual({ widthMm: 255, heightMm: 215 });
  });

  it('takes a bare «manga» from the zone already chosen', () => {
    const slots = from('mejor que sea una manga', { placement: { bodyPart: 'outer_forearm' } });
    expect(slots.placement?.orientation).toBe('wrapping');
    expect(slots.placement?.bodyPart).toBe('outer_forearm');
  });

  it('never reads the comic style, a band or the upper arm as a sleeve', () => {
    expect(sleeveLimb('un personaje estilo manga en el gemelo', 'calf')).toBeUndefined();
    expect(sleeveLimb('dibujos manga y anime', 'calf')).toBeUndefined();
    expect(sleeveLimb('una manga en el brazo', 'upper_arm_outer')).toBeUndefined();
    expect(sleeveLimb('una flor en el gemelo', 'calf')).toBeUndefined();
    const comic = from('un tatuaje estilo manga en el gemelo');
    expect(comic.placement?.orientation).not.toBe('wrapping');
  });

  it('keeps the sleeve’s size against a later «grande» and against the size proposal', () => {
    const sleeve = from('una manga de la rodilla al tobillo');
    const later = from('que sea grande y a color', sleeve);
    expect(later.size).toEqual({ widthMm: 344, heightMm: 310 });
    expect(proposeSize(later, { widthMm: 80, heightMm: 150 }).size).toEqual(later.size);
  });

  it('builds a valid brief for a sleeve', () => {
    const slots = {
      ...from('una manga de rosas de la rodilla al tobillo, linea fina, en negro'),
      linework: { weight: 'fine' as const },
      shading: { technique: 'none' as const, intensity: 'light' as const },
    };
    const result = brief({
      sessionId: '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
      revision: 1,
      slots,
      history: [],
    } as never);
    expect(result.complete, JSON.stringify(result)).toBe(true);
  });
});
