import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Brand } from '@/components/Brand';
import { LEGAL_ENTITY } from '@/content/legal';
import { SITE_DESCRIPTION } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Diseña tu tatuaje y llévate la plantilla a tamaño real',
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/inicio' },
};

/**
 * The studio's public face (TASK-0096, audit 2026-10-08 UX-01). A visitor without an account used
 * to land on the sign-in form with nothing to see. Here they see one real result of the studio,
 * from the idea to the stencil, how it works, and how to get in.
 *
 * The example is the studio's own output on a generated skin plate, never a client's photo
 * (ADR-0007). TASK-0101: the owner's own Valencia design replaced the smoke test; it shows the
 * Valencia CF crest, a third-party trademark the owner chose to publish.
 */
const EXAMPLE = [
  {
    src: '/ejemplos/valencia-diseno.webp',
    width: 640,
    height: 1280,
    title: 'El diseño',
    text: 'Dibujado a partir de tu idea y de referencias reales de lo que pides.',
  },
  {
    src: '/ejemplos/valencia-piel.webp',
    width: 720,
    height: 1080,
    title: 'Cómo queda en la piel',
    text: 'A su tamaño real sobre la zona, en piel de estudio o en una foto tuya.',
  },
  {
    src: '/ejemplos/valencia-plantilla.webp',
    width: 640,
    height: 1280,
    title: 'La plantilla 1:1',
    text: 'En SVG y PDF a tamaño real, también por piezas en hojas A4, lista para imprimir.',
  },
];

const STEPS = [
  ['Cuéntanos tu idea', 'Con tus palabras, sin saber de estilos ni dibujar.'],
  ['Te preguntamos lo que falta', 'Solo lo necesario: estilo, zona, color o tamaño.'],
  [
    'Buscamos referencias',
    'Imágenes reales de lo que pides, para que el dibujo se parezca a lo que existe.',
  ],
  ['Revisas y confirmas', 'Una descripción profesional que puedes editar antes de diseñar.'],
];

const REASONS = [
  [
    'Pensado para tu tatuador',
    'Medidas reales, plantilla imprimible y un enlace para compartir el diseño con quien te va a tatuar.',
  ],
  [
    'Lo que pides, no otra cosa',
    'Cada dibujo pasa una revisión automática: si muestra otra cosa, se vuelve a dibujar.',
  ],
  [
    'Tus fotos, protegidas',
    'Las fotos de tu cuerpo se guardan cifradas, se borran a las 24 horas y nunca se envían al generador.',
  ],
  [
    'En español, de principio a fin',
    'Una consulta guiada en cuatro pasos, en el móvil o en el ordenador.',
  ],
];

export default function Landing(): ReactNode {
  const access = `mailto:${LEGAL_ENTITY.email}?subject=${encodeURIComponent('Acceso a Inkcraft')}`;
  return (
    <main className="landing">
      <header className="landing-hero">
        <Brand variant="card" />
        <h1>Diseña tu tatuaje y llévate la plantilla a tamaño real</h1>
        <p className="landing-lead">
          Cuéntanos tu idea con tus palabras. Te devolvemos el diseño, cómo queda en la piel y la
          plantilla 1:1 que usa tu tatuador.
        </p>
        <div className="landing-actions">
          <a className="btn-primary" href="/entrar">
            Entrar al estudio
          </a>
          <a className="landing-secondary" href={access}>
            Solicitar acceso
          </a>
        </div>
      </header>

      <section className="landing-section" aria-labelledby="ejemplo">
        <h2 id="ejemplo">Un encargo real, de la idea a la plantilla</h2>
        <blockquote className="landing-idea">
          «El escudo del Valencia CF, el estadio de Mestalla, la senyera y la Virgen de los
          Desamparados, mezclando color y negro, en todo el gemelo derecho»
        </blockquote>
        <ol className="landing-example">
          {EXAMPLE.map((item) => (
            <li key={item.src}>
              <img
                src={item.src}
                alt={item.title}
                width={item.width}
                height={item.height}
                loading="lazy"
                decoding="async"
              />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="como">
        <h2 id="como">Cómo funciona</h2>
        <ol className="landing-steps">
          {STEPS.map(([title, text], index) => (
            <li key={title}>
              <span className="landing-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="por-que">
        <h2 id="por-que">Por qué Inkcraft</h2>
        <ul className="landing-reasons">
          {REASONS.map(([title, text]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
        <p className="landing-honest">
          Los diseños y las vistas en piel son orientativos: un tatuador profesional debe revisarlos
          antes de tatuar.
        </p>
      </section>

      <footer className="landing-footer">
        <a className="btn-primary" href="/entrar">
          Entrar al estudio
        </a>
        <p>
          <a href="/condiciones">Condiciones de uso</a> · <a href="/privacidad">Privacidad</a> ·{' '}
          <a href={access}>{LEGAL_ENTITY.email}</a>
        </p>
      </footer>
    </main>
  );
}
