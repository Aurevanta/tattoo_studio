'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { messageForError, messageForResponse } from '@/lib/client-errors';

interface Link {
  url: string;
  expiresAt: string;
}

/**
 * «Compartir con mi tatuador» (TASK-0097, ADR-0032): a link that opens this design, its stencils
 * and its measurements for 30 days, until the client withdraws it. It says what it shares before
 * it is made, and that photographs of the body are never part of it.
 */
export function ShareWithTattooer({ jobId }: { jobId: string }): ReactNode {
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // Links made on another day: their address is not kept, but they can still be withdrawn.
  const [earlier, setEarlier] = useState<{ open: number; expiresAt: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/shares?jobId=${jobId}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body && typeof body.open === 'number') setEarlier(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await action();
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const response = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageForResponse(response.status, body));
      setLink({ url: `${window.location.origin}${body.path}`, expiresAt: body.expiresAt });
    });

  const stop = () =>
    run(async () => {
      const response = await fetch(`/api/shares?jobId=${jobId}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageForResponse(response.status, body));
      setLink(null);
      setEarlier(null);
      setNote('Has dejado de compartir este diseño: sus enlaces ya no se abren.');
    });

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(link!.url);
      setNote('Enlace copiado. Pégalo en el mensaje a tu tatuador.');
    });

  const send = () =>
    run(async () => {
      try {
        await navigator.share({ title: 'Mi diseño de tatuaje', url: link!.url });
      } catch (failure) {
        // Closing the share sheet is not an error.
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        throw failure;
      }
    });

  const until = link
    ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(new Date(link.expiresAt))
    : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section className="share-tattooer" aria-labelledby="share-title">
      <h3 id="share-title">Para tu tatuador</h3>
      {link ? (
        <>
          <p className="small-note">
            Quien tenga este enlace verá el diseño, la plantilla y las medidas hasta el {until}.
          </p>
          <input
            className="share-url"
            readOnly
            value={link.url}
            aria-label="Enlace para tu tatuador"
            onFocus={(event) => event.target.select()}
          />
          <div className="share-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={copy}>
              Copiar enlace
            </button>
            {canShare && (
              <button type="button" disabled={busy} onClick={send}>
                Enviar…
              </button>
            )}
            <button type="button" className="link-button" disabled={busy} onClick={stop}>
              Dejar de compartir
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small-note">
            Crea un enlace con el diseño, la plantilla para imprimir y las medidas, para que tu
            tatuador lo vea sin cuenta. Dura 30 días y puedes retirarlo cuando quieras. Nunca
            incluye fotos de tu cuerpo.
          </p>
          {earlier && earlier.open > 0 && (
            <p className="small-note">
              {earlier.open === 1
                ? 'Ya compartiste este diseño: hay un enlace abierto'
                : `Ya compartiste este diseño: hay ${earlier.open} enlaces abiertos`}
              {earlier.expiresAt
                ? ` hasta el ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(new Date(earlier.expiresAt))}.`
                : '.'}
            </p>
          )}
          <div className="share-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={create}>
              {busy
                ? 'Creando enlace…'
                : earlier && earlier.open > 0
                  ? 'Crear otro enlace'
                  : 'Compartir con mi tatuador'}
            </button>
            {earlier && earlier.open > 0 && (
              <button type="button" className="link-button" disabled={busy} onClick={stop}>
                Dejar de compartir
              </button>
            )}
          </div>
        </>
      )}
      {note && (
        <p className="small-note" role="status">
          {note}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
