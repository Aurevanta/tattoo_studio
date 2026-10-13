import { describe, expect, it } from 'vitest';

import type { OrchestrationSession } from '@tattoo/consultation';

import { afterIdea, essentialMissing, missingDetails, resumeStep } from './wizard';

const session = (patch: Partial<OrchestrationSession>): OrchestrationSession => ({
  sessionId: '0b8c3a5e-1f2d-4c3b-8a9e-1234567890ab',
  revision: 1,
  phase: 'needs_details',
  questionsAsked: 0,
  maxQuestions: 3,
  slots: {},
  references: [],
  messages: [],
  missingFields: [],
  ...patch,
});

const complete = {
  subject: { description: 'Un murciélago biomecánico' },
  style: { primary: 'biomechanical' as const },
  placement: {
    bodyPart: 'thigh_front' as const,
    orientation: 'vertical' as const,
    side: 'right' as const,
    bodyType: 'feminine' as const,
  },
  colour: { mode: 'black_and_grey' as const },
};

describe('the guided studio (TASK-0065)', () => {
  it('lists what the idea left open, in a fixed order', () => {
    expect(missingDetails({})).toEqual(['style', 'zone', 'side', 'body', 'colour']);
    expect(missingDetails(complete)).toEqual([]);
    expect(
      missingDetails({ ...complete, placement: { ...complete.placement, side: undefined } }),
    ).toEqual(['side']);
  });

  it('always opens step 2 after the idea, even when nothing is missing (TASK-0099)', () => {
    expect(afterIdea()).toBe('details');
  });

  it('blocks step 3 only on an essential reference', () => {
    expect(
      essentialMissing(
        session({ missingFields: ['referencia: el escudo del FC Barcelona', 'color'] }),
      ),
    ).toEqual(['el escudo del FC Barcelona']);
    expect(essentialMissing(session({}))).toEqual([]);
  });

  it('resumes where a reload left the client', () => {
    expect(resumeStep(null)).toBe('idea');
    expect(resumeStep(session({}))).toBe('idea');
    expect(resumeStep(session({ slots: { subject: complete.subject } }))).toBe('details');
    expect(resumeStep(session({ slots: complete }))).toBe('references');
  });
});
