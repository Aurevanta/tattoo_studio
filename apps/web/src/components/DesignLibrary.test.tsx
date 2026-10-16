/**
 * «Tus diseños» lists designs with their versions and what can be done with them (TASK-0116).
 * Rendered statically: the confirmation in place is exercised in the browser, not here.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { StudioJobStatus } from '@/types/generation';

import { DesignLibrary, type DesignActions } from './DesignLibrary';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

const version = (jobId: string, design: string, name: string, instruction?: string) =>
  ({
    jobId,
    state: 'succeeded',
    error: null,
    result: instruction ? { edit: { parentJobId: design, instruction } } : {},
    design: { id: design, name },
  }) as unknown as StudioJobStatus;

const history = [
  version('c'.repeat(32), A, 'Lobo geométrico', 'Más grande'),
  version(A, A, 'Lobo geométrico'),
  version(B, B, 'Una rosa'),
];

const actions: DesignActions = {
  rename: async () => undefined,
  remove: async () => undefined,
  copy: async () => undefined,
};

const render = (withActions: boolean) =>
  renderToStaticMarkup(
    createElement(DesignLibrary, {
      versions: history,
      onOpen: () => undefined,
      actions: withActions ? actions : undefined,
    }),
  );

describe('DesignLibrary (TASK-0116)', () => {
  it('shows one card per design, named, with its versions numbered within it', () => {
    const html = render(true);
    expect(html.match(/class="design-card"/g)).toHaveLength(2);
    expect(html).toContain('Lobo geométrico');
    expect(html).toContain('2 versiones');
    expect(html).toContain('1 versión');
    expect(html).toContain('Versión 2 · Más grande');
    expect(html).toContain('Versión 1 · Diseño inicial');
    expect(html).not.toContain('Propuesta');
  });

  it('offers renaming, deleting and a new design from any version', () => {
    const html = render(true);
    expect(html.match(/Renombrar/g)).toHaveLength(2);
    expect(html.match(/Eliminar diseño/g)).toHaveLength(2);
    // A design with a single version is deleted whole, not a version at a time.
    expect(html.match(/Eliminar versión/g)).toHaveLength(2);
    expect(html.match(/Diseño nuevo a partir de esta/g)).toHaveLength(3);
  });

  it('only lists, without the page’s actions', () => {
    const html = render(false);
    expect(html).toContain('Lobo geométrico');
    expect(html).not.toContain('Eliminar');
    expect(html).not.toContain('Renombrar');
  });

  it('renders nothing for an account without designs', () => {
    expect(
      renderToStaticMarkup(createElement(DesignLibrary, { versions: [], onOpen: () => undefined })),
    ).toBe('');
  });
});
