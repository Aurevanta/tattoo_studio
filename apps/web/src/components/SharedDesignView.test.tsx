/**
 * What a tattooer sees through a client's link (TASK-0097, ADR-0032).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SharedDesign } from '@tattoo/contracts';

import { SharedDesignView } from './SharedDesignView';

const fixture = (name: string): SharedDesign =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, `../../../../contracts/fixtures/shared-design/valid/${name}.json`),
      'utf8',
    ),
  ) as SharedDesign;

const render = (design: SharedDesign) =>
  renderToStaticMarkup(
    createElement(SharedDesignView, { design, file: (asset) => `/files/${asset.assetId}` }),
  );

describe('the page a tattooer opens (TASK-0097)', () => {
  it('reads the measures, zone, style, colour and idea in Spanish', () => {
    const html = render(fixture('full'));
    expect(html).toContain('80 mm de ancho × 120 mm de alto');
    expect(html).toMatch(/Zona<\/dt><dd>[^<]+\(derecho\)/);
    expect(html).toContain('Tradicional americano');
    expect(html).toContain('Color — rojo, verde, amarillo');
    expect(html).toContain('«Una golondrina tradicional con una rosa en el antebrazo derecho»');
    expect(html).toContain('Descripción profesional');
    expect(html).toContain('contornos aproximados');
  });

  it('offers the stencil to print, mirrored too, and says a professional reviews it', () => {
    const html = render(fixture('full'));
    for (const id of ['f'.repeat(32), 'a'.repeat(32), 'd'.repeat(32), 'e'.repeat(32)])
      expect(html).toContain(`/files/${id}`);
    expect(html).toContain('revísalo y ajústalo con tu criterio');
    expect(html).toContain('al 100 %');
  });

  it('shows no view of the body when the design was placed on the client’s own photo', () => {
    const html = render(fixture('own-photo'));
    expect(html).not.toContain('piel de estudio');
    expect(html).not.toContain(`/files/${'1'.repeat(32)}`);
  });

  it('leaves out what is not there', () => {
    expect(render(fixture('no-refined'))).not.toContain('Descripción profesional');
    const html = render(fixture('black-and-grey-lineart'));
    expect(html).not.toContain('contornos aproximados');
    expect(html).toMatch(/Color<\/dt><dd>Negro y gris<\/dd>/);
  });
});
