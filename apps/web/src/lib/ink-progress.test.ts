import { describe, expect, it } from 'vitest';

import { clock, inkStage, STEPS, type InkTask } from './ink-progress';

const WAITS: InkTask[] = ['idea', 'save', 'search', 'image', 'accept', 'reset', 'preparing'];

describe('inkStage (TASK-0069, TASK-0076)', () => {
  it('a wait the server does not report has one description and no claimed progress', () => {
    for (const task of WAITS) {
      const stage = inkStage(task);
      expect(stage.title).toBeTruthy();
      expect(stage.line).toBeTruthy();
      expect(stage.progress).toBeNull();
    }
  });

  it('a running design shows the step the worker reports, and only that one', () => {
    const stencil = inkStage('running', { stage: 'stencil' });
    expect(stencil.title).toContain('paso 4 de 6');
    expect(stencil.line).toBe('Trazando la plantilla…');
    expect(stencil.progress).toBeCloseTo(3.5 / 6);
    // Audit UX-03: no "retoques" before the worker gets there.
    expect(inkStage('running', { stage: 'drawing' }).line).not.toMatch(/ajustes|retoques/);
  });

  it('moves forward with the steps', () => {
    const seam = inkStage('running', { stage: 'seam' });
    expect(seam.title).toContain('paso 3 de 6');
    expect(seam.line).toBe('Cerrando la vuelta de la manga…');
    expect(seam.progress).toBeGreaterThan(inkStage('running', { stage: 'drawing' }).progress!);
    expect(seam.progress).toBeLessThan(inkStage('running', { stage: 'stencil' }).progress!);
    const progress = STEPS.map((stage) => inkStage('running', { stage }).progress!);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(Math.max(...progress)).toBeLessThan(1);
  });

  it('without a reported step it claims nothing', () => {
    expect(inkStage('running')).toEqual({
      title: 'Creando tu diseño',
      line: 'Empezando…',
      progress: null,
    });
  });

  it('a queued design says how many are ahead', () => {
    expect(inkStage('queued', { queuePosition: 1 }).line).toBe('Eres el siguiente.');
    expect(inkStage('queued', { queuePosition: 2 }).line).toBe('Hay 1 diseño antes que el tuyo.');
    expect(inkStage('queued', { queuePosition: 4 }).line).toBe('Hay 3 diseños antes que el tuyo.');
  });
});

describe('clock', () => {
  it('reads minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(7_900)).toBe('0:07');
    expect(clock(151_000)).toBe('2:31');
  });
});
