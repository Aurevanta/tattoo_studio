/**
 * Step 1 takes images the idea can point at by number (TASK-0113, ADR-0039).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IdeaStep, MAX_IDEA_IMAGES } from './IdeaStep';

const render = (images: string[]) =>
  renderToStaticMarkup(
    createElement(IdeaStep, {
      initial: '',
      images,
      busy: false,
      onSubmit: () => undefined,
      onAttach: () => undefined,
      onRemoveImage: () => undefined,
      onAdvanced: () => undefined,
      versions: [],
      onOpen: () => undefined,
    }),
  );

const id = (n: number) => `${n}`.repeat(32);

describe('IdeaStep images (TASK-0113)', () => {
  it('AC-005: offers the control and says what is accepted', () => {
    const html = render([]);
    expect(html).toContain('Adjuntar imágenes (0/5)');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain('No se aceptan fotos en las que aparezcan personas');
  });

  it('AC-005: numbers the images in order and explains how to cite them', () => {
    const html = render([id(1), id(2)]);
    expect(html.indexOf('Imagen 1')).toBeLessThan(html.indexOf('Imagen 2'));
    expect(html).toContain(`src="/api/media?id=${id(1)}"`);
    expect(html).toContain('aria-label="Quitar la imagen 2"');
    expect(html).toContain('como la imagen 1 pero con las rosas de la imagen 2');
    expect(html).toContain('Adjuntar imágenes (2/5)');
  });

  it('AC-005: does not offer a sixth image', () => {
    const html = render(Array.from({ length: MAX_IDEA_IMAGES }, (_, n) => id(n + 1)));
    expect(MAX_IDEA_IMAGES).toBe(5);
    expect(html).toContain('Máximo 5 imágenes');
    expect(html).toMatch(/<button type="button" disabled="">Máximo 5 imágenes<\/button>/);
  });
});
