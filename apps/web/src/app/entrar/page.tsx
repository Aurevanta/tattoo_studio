'use client';

/**
 * Sign in (TASK-0045, ADR-0021).
 *
 * There is no sign-up here on purpose: accounts are created by the studio owner in Supabase. A
 * studio that lets anyone register is a studio that lets anyone spend its generation credits.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { Brand } from '@/components/Brand';
import { ConsentDialog } from '@/components/ConsentDialog';
import { IMAGES_VERSION, LEGAL_ENTITY, TERMS_VERSION } from '@/content/legal';
import { isPlain } from '@/lib/client-errors';

export default function SignInPage(): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // TASK-0064: «Entrar» asks for the terms and image consent; only accepting signs in.
  const [asking, setAsking] = useState(false);

  // Someone already signed in has no business on this page.
  useEffect(() => {
    void fetch('/api/auth', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body: { account?: { email?: string } | null }) => {
        if (body.account) window.location.replace('/');
      })
      .catch(() => undefined);
  }, []);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    setError('');
    setAsking(true);
  }

  async function enter(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          accepted: { terms: TERMS_VERSION, images: IMAGES_VERSION },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setAsking(false);
        // TASK-0072: the auth route words its refusals; anything else is said plainly.
        setError(
          isPlain(body.error) ? body.error : 'No se ha podido iniciar sesión. Inténtalo de nuevo.',
        );
        return;
      }
      // A full load, so the server sees the new cookies on the first request.
      window.location.replace('/');
    } catch {
      setAsking(false);
      setError('No se ha podido contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sign-in">
      <form onSubmit={submit}>
        <Brand variant="card" />
        <h1>Entra al estudio</h1>
        {/* TASK-0081 (audit UX-04): a visitor without an account knows how to ask for one. */}
        <p className="sign-in-note">
          Las cuentas las crea el estudio.{' '}
          <a
            href={`mailto:${LEGAL_ENTITY.email}?subject=${encodeURIComponent('Acceso a Inkcraft')}`}
          >
            Solicitar acceso
          </a>
        </p>
        {/* TASK-0054: what is recorded is said before anyone signs in, not discovered later. */}
        <p className="sign-in-note sign-in-privacy">
          Registramos el uso del estudio —tus mensajes, tus diseños, los tiempos y el consumo— para
          mantenerlo y mejorarlo. Las fotos de tu cuerpo nunca se registran. Al eliminar tus datos,
          lo registrado deja de estar asociado a ti.
        </p>

        {error && (
          <p className="sign-in-error" role="alert">
            {error}
          </p>
        )}

        <label htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />

        <button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="sign-in-legal">
          <a href="/recuperar">¿Has olvidado tu contraseña?</a>
        </p>
        <p className="sign-in-legal">
          <a href="/inicio">Qué es Inkcraft</a> · <a href="/condiciones">Condiciones de uso</a> ·{' '}
          <a href="/privacidad">Privacidad</a>
        </p>
      </form>
      {asking && (
        <ConsentDialog
          confirmLabel="Acepto y entro"
          busy={busy}
          onAccept={() => void enter()}
          onCancel={() => setAsking(false)}
        />
      )}
    </main>
  );
}
