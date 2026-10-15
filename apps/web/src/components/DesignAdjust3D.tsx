'use client';
/**
 * Size, width and height, and saving, in the 3D views (TASK-0112): the live mockup editor's
 * controls (ADR-0036), so a design is adjusted the same way in 2D and in 3D and saved as the same
 * placement.
 */
import { useState, type ReactNode } from 'react';
import {
  axisFactors,
  printSizeOf,
  resizesPrint,
  scaleFactors,
  stretchOf,
  type Factors,
} from '@/lib/design-resize';
import { MAX_STRETCH, MIN_STRETCH } from '@/lib/mockup-editor';
import { Confirm } from './Confirm';

export function DesignAdjust3D({
  print,
  factors,
  onFactors,
  baseStretch = 1,
  calibrated = false,
  save,
}: {
  /** The print size the view opened with. */
  print: { widthMm: number; heightMm: number };
  factors: Factors;
  onFactors: (next: Factors) => void;
  /** How far earlier versions already stretched the drawing (`transform.stretch`). */
  baseStretch?: number | undefined;
  /** A calibrated photograph keeps its scale: only position and turn change. */
  calibrated?: boolean;
  /** Present when the adjustment can be saved as a new version of the mockup. */
  save?:
    | {
        changed: boolean;
        disabled: boolean;
        onSave: () => void;
        quotaNote?: string | null | undefined;
      }
    | undefined;
}): ReactNode {
  const [confirm, setConfirm] = useState(false);
  const size = printSizeOf(print, factors);
  const scale = Math.round(Math.sqrt(factors[0] * factors[1]) * 100);
  const stretch = stretchOf(factors, baseStretch);
  const deformed = Math.round((stretch - 1) * 100);
  return (
    <div className="design-adjust-3d">
      {!calibrated && (
        <div className="mockup-editor-controls">
          <label>
            <span>
              Tamaño <output>{scale} %</output>
            </span>
            <input
              type="range"
              aria-label="Tamaño en porcentaje"
              min={30}
              max={250}
              step={1}
              value={scale}
              onChange={(e) =>
                onFactors(scaleFactors(Number(e.target.value) / scale, factors, print))
              }
            />
          </label>
          <label>
            <span>
              Ancho <output>{size.widthMm} mm</output>
            </span>
            <input
              type="range"
              aria-label="Ancho en milímetros"
              min={Math.round(print.widthMm * 0.3)}
              max={Math.round(print.widthMm * 2.5)}
              step={1}
              value={Math.round(size.widthMm)}
              onChange={(e) =>
                onFactors(axisFactors('width', Number(e.target.value), factors, print, baseStretch))
              }
            />
          </label>
          <label>
            <span>
              Alto <output>{size.heightMm} mm</output>
            </span>
            <input
              type="range"
              aria-label="Alto en milímetros"
              min={Math.round(print.heightMm * 0.3)}
              max={Math.round(print.heightMm * 2.5)}
              step={1}
              value={Math.round(size.heightMm)}
              onChange={(e) =>
                onFactors(
                  axisFactors('height', Number(e.target.value), factors, print, baseStretch),
                )
              }
            />
          </label>
        </div>
      )}
      <p className="mockup-editor-size" aria-live="polite">
        {calibrated
          ? `Foto calibrada: el tamaño es tu medida (${print.widthMm} × ${print.heightMm} mm).`
          : `≈ ${size.widthMm} × ${size.heightMm} mm`}
        {deformed !== 0 &&
          ` · proporciones ${deformed > 0 ? 'ensanchadas' : 'alargadas'} un ${Math.abs(deformed)} %`}
        {(stretch >= MAX_STRETCH - 0.005 || stretch <= MIN_STRETCH + 0.005) && ' (límite: 25 %)'}
      </p>
      {deformed !== 0 && (
        <p className="small-note" role="note">
          Estirar deforma el dibujo: círculos, letras y caras dejan de ser proporcionales. Tu
          tatuador debe revisarlo.
        </p>
      )}
      {save && (
        <>
          <p className="small-note">
            Al guardar, el mockup se vuelve a componer con esta posición, giro y tamaño, y la
            plantilla y los PDF pasan a las medidas que ves. La plantilla se imprime recta.
          </p>
          {save.quotaNote && <p className="quota-note">{save.quotaNote}</p>}
          <div className="mockup-editor-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={save.disabled || !save.changed}
              onClick={() => (resizesPrint(factors) ? setConfirm(true) : save.onSave())}
            >
              Guardar esta colocación en el mockup
            </button>
          </div>
          {confirm && (
            <Confirm
              title="¿Cambiar las medidas de impresión?"
              onCancel={() => setConfirm(false)}
              actions={[
                { label: 'Cancelar', onClick: () => setConfirm(false) },
                {
                  label: 'Guardar y cambiar las medidas',
                  primary: true,
                  onClick: () => {
                    setConfirm(false);
                    save.onSave();
                  },
                },
              ]}
            >
              <p>
                Ahora mide {print.widthMm} × {print.heightMm} mm. La nueva versión medirá{' '}
                {size.widthMm} × {size.heightMm} mm: la plantilla y los PDF se volverán a exportar a
                esa medida. El dibujo no se vuelve a dibujar
                {deformed !== 0 ? ', pero sus proporciones cambian' : ''}. La medida sobre la piel
                es orientativa: confírmala con tu tatuador.
              </p>
            </Confirm>
          )}
        </>
      )}
    </div>
  );
}
