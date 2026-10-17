'use client';

/**
 * Live camera try-on (TASK-0042, ADR-0019), with a shutter (TASK-0050, ADR-0022).
 *
 * The live frames stay in the page: they are drawn to a canvas, blended with the design by
 * `try-on`/`skin-blend` and thrown away. The one exception is a photograph the client takes with
 * the shutter and then chooses to keep, under the consent given at sign-in; `lib/capture` is
 * the only code that can compose it into bytes or send it, and this page calls it only from those
 * two buttons. Otherwise the only request is the GET that fetches the client's own design.
 *
 * This file owns the camera, the loop and the controls; the per-frame composite lives in
 * `lib/try-on.ts` so it can be exercised without a camera.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Brand } from '@/components/Brand';
import { SKIN_SCALE_NOTE_ES, VISUALIZATION_DISCLAIMER_ES } from '@/content/disclaimers';
import { CaptureRefused, saveCapture, snapshot, type Snapshot } from '@/lib/capture';
import { DEFAULT_FRESHNESS } from '@/lib/skin-blend';
import {
  cameraAvailable,
  cameraFailure,
  composeFrame,
  trimArtwork,
  type CameraState,
  type Placement,
} from '@/lib/try-on';

export default function TryOnPage(): ReactNode {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const design = useRef<HTMLCanvasElement | null>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const frameRequest = useRef<number>(0);
  const placement = useRef<Placement>({ x: 0.5, y: 0.5, scale: 0.55, angle: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const freshness = useRef<number>(DEFAULT_FRESHNESS);

  const [camera, setCamera] = useState<CameraState>('idle');
  const [designError, setDesignError] = useState('');
  const [ready, setReady] = useState(false);
  const [fresh, setFresh] = useState(true);
  const [view, setView] = useState<Placement>(placement.current);

  // TASK-0050: the version this design belongs to, so a kept photo can join it.
  const [parentJobId, setParentJobId] = useState('');
  const [shot, setShot] = useState<Snapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const saveKey = useRef('');
  const review = useRef<HTMLElement | null>(null);

  // On a phone the review sits below the camera, out of view: bring it to the client, or the
  // shutter would seem to have done nothing. An instant jump, not a smooth scroll, which some
  // browsers skip altogether (a smooth scroll that never moved was observed while testing this).
  useEffect(() => {
    if (shot) review.current?.scrollIntoView({ block: 'start' });
  }, [shot]);

  const update = useCallback((next: Partial<Placement>) => {
    placement.current = { ...placement.current, ...next };
    setView(placement.current);
  }, []);

  // The design: the client's own master artwork, fetched once. This is the page's only request.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const job = query.get('job') ?? '';
    if (/^[a-f0-9]{32}$/.test(job)) setParentJobId(job);
    const id = query.get('design') ?? '';
    if (!/^[a-f0-9]{32}$/.test(id)) {
      setDesignError('Falta el diseño. Abre esta página desde tu diseño generado.');
      return;
    }
    const image = new Image();
    image.onload = () => {
      design.current = trimArtwork(image);
      setReady(true);
    };
    image.onerror = () =>
      setDesignError('No se ha podido cargar tu diseño. Vuelve a abrirlo desde el estudio.');
    image.src = `/api/media?id=${id}`;
  }, []);

  /** One frame, against whatever the refs hold now. Also the loop's body. */
  const paint = useCallback((): boolean => {
    const source = video.current;
    const target = canvas.current;
    const art = design.current;
    if (!source || !target || !art) return false;
    return composeFrame({
      video: source,
      canvas: target,
      design: art,
      work: (work.current ??= document.createElement('canvas')),
      placement: placement.current,
      freshness: freshness.current,
    });
  }, []);

  const loop = useCallback(() => {
    frameRequest.current = requestAnimationFrame(loop);
    paint();
  }, [paint]);

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRequest.current);
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!cameraAvailable(navigator.mediaDevices)) {
      setCamera('unsupported');
      return;
    }
    setCamera('starting');
    try {
      const live = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      stream.current = live;
      const element = video.current;
      if (element) {
        element.srcObject = live;
        await element.play().catch(() => undefined);
      }
      setCamera('live');
      cancelAnimationFrame(frameRequest.current);
      frameRequest.current = requestAnimationFrame(loop);
    } catch (error) {
      setCamera(cameraFailure(error));
    }
  }, [loop]);

  useEffect(() => stop, [stop]);

  // A hidden tab stops `requestAnimationFrame`, so the preview resumes when the page comes back.
  useEffect(() => {
    const resume = (): void => {
      if (document.visibilityState !== 'visible' || !stream.current) return;
      cancelAnimationFrame(frameRequest.current);
      frameRequest.current = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [loop]);

  // A handle for driving one frame without the loop, which is how the composite is checked where
  // there is no camera and no visible tab (TASK-0042/ev-003).
  useEffect(() => {
    (window as unknown as { __tryOnPaint?: () => boolean }).__tryOnPaint = paint;
    return () => {
      delete (window as unknown as { __tryOnPaint?: () => boolean }).__tryOnPaint;
    };
  }, [paint]);

  /** The shutter: one frame, composed locally. Nothing leaves the phone here. */
  async function takePhoto(): Promise<void> {
    const source = video.current;
    const art = design.current;
    if (!source || !art) return;
    setCaptureError('');
    setSaved(false);
    const taken = await snapshot({
      video: source,
      design: art,
      placement: placement.current,
      freshness: freshness.current,
    });
    if (!taken) {
      setCaptureError('No se ha podido hacer la foto. Espera a que se vea la cámara.');
      return;
    }
    if (shot) URL.revokeObjectURL(shot.preview);
    saveKey.current = crypto.randomUUID();
    setShot(taken);
  }

  function discard(): void {
    if (shot) URL.revokeObjectURL(shot.preview);
    setShot(null);
    setCaptureError('');
  }

  /** Keep it: the only moment a picture from the camera leaves the device (ADR-0022). */
  async function keep(): Promise<void> {
    if (!shot) return;
    setSaving(true);
    setCaptureError('');
    try {
      await saveCapture({
        blob: shot.blob,
        parentJobId,
        idempotencyKey: saveKey.current,
      });
      URL.revokeObjectURL(shot.preview);
      setShot(null);
      setSaved(true);
    } catch (error) {
      setCaptureError(
        error instanceof CaptureRefused ? error.message : 'No se ha podido guardar la foto.',
      );
    } finally {
      setSaving(false);
    }
  }

  function pointer(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  }

  return (
    <main className="try-on">
      {/* TASK-0053: installed as an app there is no browser back button, so the way out is here. */}
      <nav className="try-on-bar" aria-label="Navegación">
        <a className="try-on-back" href="/">
          <span aria-hidden="true">←</span> Volver al estudio
        </a>
        <Brand variant="header" />
      </nav>
      <header>
        <h1>Pruébalo con la cámara</h1>
        <p className="privacy">
          La cámara se procesa en tu propio dispositivo. Solo se guarda una foto si tú la haces y
          decides guardarla.
        </p>
        {/* TASK-0125: the size on the camera is the client's own, so it is approximate. */}
        <p className="small-note">{SKIN_SCALE_NOTE_ES}</p>
      </header>

      {designError && <p role="alert">{designError}</p>}

      <div className="try-on-stage">
        <video ref={video} playsInline muted hidden />
        <canvas
          ref={canvas}
          className="try-on-canvas"
          aria-label="Vista de la cámara con el tatuaje superpuesto"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragging.current = pointer(event);
          }}
          onPointerMove={(event) => {
            if (!dragging.current) return;
            const now = pointer(event);
            update({
              x: Math.min(1, Math.max(0, placement.current.x + (now.x - dragging.current.x))),
              y: Math.min(1, Math.max(0, placement.current.y + (now.y - dragging.current.y))),
            });
            dragging.current = now;
          }}
          onPointerUp={() => (dragging.current = null)}
          onPointerCancel={() => (dragging.current = null)}
        />
        {camera !== 'live' && (
          <div className="try-on-overlay">
            {camera === 'denied' && (
              <p>No has dado permiso para la cámara. Actívalo y reintenta.</p>
            )}
            {camera === 'unsupported' && (
              <p>Este navegador no da acceso a la cámara. Prueba en el móvil, con HTTPS.</p>
            )}
            {camera === 'failed' && <p>No se ha podido abrir la cámara.</p>}
            <button onClick={() => void start()} disabled={!ready || camera === 'starting'}>
              {camera === 'starting' ? 'Abriendo…' : 'Abrir la cámara'}
            </button>
          </div>
        )}
        {camera === 'live' && parentJobId && !shot && (
          <button
            type="button"
            className="try-on-shutter"
            onClick={() => void takePhoto()}
            aria-label="Hacer foto"
          >
            <span aria-hidden="true" />
          </button>
        )}
      </div>

      {saved && (
        <p className="try-on-saved" role="status">
          Foto guardada en tus versiones. <a href="/">Volver al estudio</a>
        </p>
      )}

      {shot && (
        <section ref={review} className="try-on-review" aria-label="Revisa la foto">
          {/* A local object URL: the picture has not left the phone yet. */}
          <img src={shot.preview} alt="Tu foto con el tatuaje superpuesto" />
          {/* TASK-0064: age and consent were accepted at sign-in; this says what keeping means. */}
          <p className="small-note">
            Se guarda en tu cuenta, cifrada. Se revisa su contenido, no se usa para generar imágenes
            y se borra a las 24 horas o al eliminar tus datos.
          </p>
          {captureError && <p role="alert">{captureError}</p>}
          <div className="try-on-review-actions">
            <button type="button" onClick={() => void keep()} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar como propuesta'}
            </button>
            <button type="button" className="link-button" onClick={discard} disabled={saving}>
              Descartar
            </button>
          </div>
        </section>
      )}
      {!shot && captureError && <p role="alert">{captureError}</p>}

      <div className="try-on-controls">
        <label>
          Tamaño
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(view.scale * 100)}
            onChange={(event) => update({ scale: Number(event.target.value) / 100 })}
          />
        </label>
        <label>
          Giro
          <input
            type="range"
            min={-180}
            max={180}
            value={Math.round(view.angle)}
            onChange={(event) => update({ angle: Number(event.target.value) })}
          />
        </label>
        <label className="try-on-toggle">
          <input
            type="checkbox"
            checked={fresh}
            onChange={(event) => {
              setFresh(event.target.checked);
              freshness.current = event.target.checked ? DEFAULT_FRESHNESS : 0;
            }}
          />
          Tinta recién hecha
        </label>
      </div>

      <p className="notice-banner">{VISUALIZATION_DISCLAIMER_ES}</p>
    </main>
  );
}
