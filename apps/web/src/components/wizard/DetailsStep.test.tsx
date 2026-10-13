/**
 * Step 2 shows every detail, with what the idea decided already chosen (TASK-0099).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ALL_DETAILS } from '@/lib/wizard';

import { DetailsStep } from './DetailsStep';

const render = (values: Parameters<typeof DetailsStep>[0]['values']) =>
  renderToStaticMarkup(
    createElement(DetailsStep, {
      fields: ALL_DETAILS,
      values,
      busy: false,
      onChange: () => undefined,
      onBack: () => undefined,
      onContinue: () => undefined,
    }),
  );

describe('DetailsStep (TASK-0099)', () => {
  it('shows style and zone chosen when the idea already set them', () => {
    const html = render({
      style: 'black_and_grey_realism',
      body: 'calf',
      side: 'right',
      bodyType: '',
      color: '',
    });
    for (const legend of [
      'Estilo',
      'Zona del cuerpo',
      'Lado',
      'Cuerpo para la vista previa',
      'Color',
    ])
      expect(html).toContain(`<legend>${legend}</legend>`);
    expect(html).toContain('Hemos marcado lo que entendimos de tu idea');
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:<img[^>]*>)?<span>Realismo<\/span>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*><span>Gemelo<\/span>/);
  });

  it('asks plainly when nothing is chosen yet', () => {
    const html = render({ style: '', body: '', side: '', bodyType: '', color: '' });
    expect(html).toContain('Elige cómo quieres tu tatuaje.');
    expect(html).not.toContain('aria-pressed="true"');
  });
});
