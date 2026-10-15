import type { ReactNode } from 'react';

import type { SharedAsset, SharedDesign } from '@tattoo/contracts';
import { BODY_OPTIONS, STYLE_OPTIONS } from '@tattoo/consultation/preferences';

import { Brand } from './Brand';
import { PrintButton } from './PrintButton';
import { COLOUR_CHOICES, SIDE_CHOICES } from './wizard/options';

const label = (choices: { value: string; label: string }[], value: string | undefined) =>
  choices.find((choice) => choice.value === value)?.label;

const mm = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} mm`;

/**
 * What a tattooer sees through a client's link (TASK-0097, ADR-0032): the design, its stencils
 * and what is needed to read them, ready to print. Never a photograph of the client's body.
 */
export function SharedDesignView({
  design,
  file,
}: {
  design: SharedDesign;
  /** The address of one of the design's files through this link. */
  file: (asset: SharedAsset) => string;
}): ReactNode {
  const zone =
    (BODY_OPTIONS as Record<string, string | undefined>)[design.placement.bodyPart] ??
    design.placement.bodyPart;
  const side = label(SIDE_CHOICES, design.placement.side);
  const style = (STYLE_OPTIONS as Record<string, string>)[design.style] ?? design.style;
  const colour = label(COLOUR_CHOICES, design.colourMode) ?? design.colourMode;
  const until = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(
    new Date(design.expiresAt),
  );
  return (
    <main className="shared">
      <header className="shared-header">
        <Brand variant="header" />
        <PrintButton />
      </header>
      <h1>Diseño para tatuar</h1>
      <p className="shared-lead">
        Un cliente de Inkcraft te comparte su diseño. Este enlace funciona hasta el {until}.
      </p>
      <p className="shared-review" role="note">
        Diseño preliminar hecho con ayuda de inteligencia artificial: revísalo y ajústalo con tu
        criterio antes de tatuar.
        {design.stencilMethod === 'colour_contours'
          ? ' La plantilla son contornos aproximados de un diseño a color o sombreado.'
          : ''}
      </p>

      <section className="shared-sheet" aria-label="Ficha del diseño">
        <dl>
          <dt>Medidas</dt>
          <dd>
            {mm(design.size.widthMm)} de ancho × {mm(design.size.heightMm)} de alto
          </dd>
          <dt>Zona</dt>
          <dd>{side ? `${zone} (${side.toLowerCase()})` : zone}</dd>
          <dt>Estilo</dt>
          <dd>{style}</dd>
          <dt>Color</dt>
          <dd>
            {colour}
            {design.palette?.length ? ` — ${design.palette.join(', ')}` : ''}
          </dd>
        </dl>
        <h2>La idea del cliente</h2>
        <blockquote>«{design.idea}»</blockquote>
        {design.refined && (
          <>
            <h2>Descripción profesional</h2>
            <p>{design.refined}</p>
          </>
        )}
      </section>

      <section className="shared-images" aria-label="Diseño y plantilla">
        <figure>
          <img src={file(design.master)} alt="El diseño" />
          <figcaption>El diseño</figcaption>
        </figure>
        <figure>
          <img src={file(design.stencil)} alt="La plantilla" />
          <figcaption>La plantilla a tamaño real</figcaption>
        </figure>
        {design.mockup && (
          <figure>
            <img src={file(design.mockup)} alt="Vista orientativa en piel de estudio" />
            <figcaption>Vista orientativa en piel de estudio</figcaption>
          </figure>
        )}
      </section>

      <section className="shared-downloads" aria-labelledby="descargas">
        <h2 id="descargas">Plantilla para imprimir</h2>
        <p>
          Imprime los PDF al 100 %, sin «ajustar a la página»: la barra de 50 mm del PDF sirve para
          comprobar la escala. Si no cabe en un A4, el PDF añade además la plantilla repartida en
          piezas A4.
        </p>
        <ul>
          <li>
            <a href={file(design.pdf)} download="plantilla.pdf">
              Plantilla en PDF
            </a>
          </li>
          <li>
            <a href={file(design.pdfMirror)} download="plantilla-espejo.pdf">
              Plantilla en PDF, en espejo (para papel de transfer)
            </a>
          </li>
          {design.panels && (
            <li>
              {/* TASK-0105 (ADR-0035) */}
              <a href={file(design.panels)} download="manga-paneles.pdf">
                Manga en 4 paneles, para colocarla alrededor del miembro (PDF)
              </a>
              {design.panelsMirror && (
                <>
                  {' · '}
                  <a href={file(design.panelsMirror)} download="manga-paneles-espejo.pdf">
                    en espejo
                  </a>
                </>
              )}
            </li>
          )}
          <li>
            <a href={file(design.stencil)} download="plantilla.svg">
              Plantilla en SVG
            </a>
            {' · '}
            <a href={file(design.stencilMirror)} download="plantilla-espejo.svg">
              en espejo
            </a>
          </li>
          <li>
            <a href={file(design.master)} download="diseno.png">
              Diseño en PNG
            </a>
          </li>
        </ul>
      </section>

      <footer className="shared-footer">
        <a href="/inicio">Hecho con Inkcraft by Aurevanta Labs</a>
      </footer>
    </main>
  );
}
