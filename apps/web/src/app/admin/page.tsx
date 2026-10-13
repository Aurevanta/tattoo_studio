'use client';

/**
 * The administrator's panel (TASK-0055, ADR-0024).
 *
 * Everything here is read from the event record and from the accounts' stored designs, through
 * routes that check the administrator role with Supabase on every request. Files that show a body
 * are never requested: the worker marks them, and would refuse them anyway.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Brand } from '@/components/Brand';

interface Durations {
  avg: number | null;
  p50: number | null;
  p95: number | null;
}

interface Overview {
  days: number;
  totals: {
    generations: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    durationMs: Durations;
    /** TASK-0085 (audit REN-01): time in the queue before a job started. */
    waitMs?: Durations;
    calls: number;
    callErrors: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
    costUsd: number | null;
    unpricedCalls: number;
    accounts: number;
    signIns: number;
    signInRefusals: number;
    uploads: number;
    uploadRefusals: number;
    captures: number;
    messages: number;
    erasures: number;
  };
  byModel: {
    provider: string;
    model: string;
    operation: string;
    calls: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
    costUsd: number | null;
    durationMs: Durations;
  }[];
  byDay: {
    day: string;
    generations: number;
    failed: number;
    calls: number;
    tokens: number;
    costUsd: number | null;
    accounts: number;
  }[];
  byAccount: {
    account: string;
    email: string | null;
    lastSeen: string;
    generations: number;
    failed: number;
    messages: number;
    uploads: number;
    tokens: number;
    costUsd: number | null;
  }[];
  errors: {
    ts: string;
    kind: string;
    operation: string;
    provider: string | null;
    model: string | null;
    account: string | null;
    reason: string | null;
  }[];
  /** TASK-0100: providers that stopped answering for lack of credit. Absent from older workers. */
  alerts?: { kind: 'out_of_credit'; provider: string; since: string; calls: number }[];
}

interface Asset {
  assetId: string;
}

interface Version {
  jobId: string;
  adminHidden: string[];
  result: {
    designId: string;
    master: Asset;
    mockup: Asset;
    stencil: Asset;
    backgroundKind: string;
    edit?: { instruction: string };
    capture?: unknown;
  } | null;
}

interface AccountDetail {
  account: string;
  email: string | null;
  versions: Version[];
  events: {
    ts: string;
    kind: string;
    operation: string;
    outcome: string;
    provider: string | null;
    model: string | null;
    durationMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    text: string | null;
    detail: Record<string, unknown>;
  }[];
}

const number = new Intl.NumberFormat('es-ES');
const when = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });

const PROVIDER: Record<string, string> = {
  openai: 'OpenAI',
  bfl: 'Black Forest Labs',
  anthropic: 'Anthropic',
};

function seconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const total = Math.round(ms / 1000);
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`;
}

function dollars(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(value < 1 ? 4 : 2)} $`;
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

const OPERATION: Record<string, string> = {
  artwork: 'Dibujo',
  edit: 'Cambio',
  finish: 'Acabado',
  background: 'Piel de fondo',
  analyze: 'Análisis de referencias',
  moderation: 'Revisión de contenido',
  consultation: 'Conversación',
  scout_plan: 'Búsqueda: plan',
  scout_judge: 'Búsqueda: juez',
  web_image_search: 'Búsqueda web de imágenes',
  artwork_check: 'Revisión del dibujo',
  text_moderation: 'Revisión del texto',
  // TASK-0094: a screen that failed in a client's browser.
  render: 'Error en el navegador',
  global: 'Error en el navegador (página entera)',
};

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 401) {
    window.location.replace('/entrar');
    throw new Error('Inicia sesión.');
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'No se ha podido cargar.');
  return body as T;
}

export default function AdminPage(): ReactNode {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);

  useEffect(() => {
    setError('');
    read<Overview>(`/api/admin/overview?days=${days}`)
      .then(setReport)
      .catch((failure: Error) => setError(failure.message));
  }, [days]);

  const open = useCallback(
    (account: string) => {
      setSelected(account);
      setDetail(null);
      read<AccountDetail>(`/api/admin/accounts/${account}?days=${Math.max(days, 90)}`)
        .then(setDetail)
        .catch((failure: Error) => setError(failure.message));
    },
    [days],
  );

  const totals = report?.totals;
  const busiest = Math.max(1, ...(report?.byDay.map((day) => day.generations) ?? [1]));

  return (
    <div className="admin">
      <header className="studio-header">
        <Brand variant="header" />
        <div className="header-end">
          <span className="model-badge">Administración</span>
          <a className="try-on-back" href="/">
            <span aria-hidden="true">←</span> Estudio
          </a>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-title">
          <h1>Uso del estudio</h1>
          <div className="admin-range" role="group" aria-label="Periodo">
            {[7, 30, 90].map((option) => (
              <button
                key={option}
                type="button"
                className={option === days ? 'active' : ''}
                onClick={() => setDays(option)}
              >
                {option} días
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="sign-in-error" role="alert">
            {error}
          </p>
        )}
        {!report && !error && <p className="small-note">Cargando…</p>}

        {totals && report && (
          <>
            {report.alerts?.map((alert) => (
              <p key={alert.provider} className="admin-alert" role="alert">
                <strong>
                  {PROVIDER[alert.provider] ?? alert.provider} se ha quedado sin crédito
                </strong>{' '}
                desde el {when.format(new Date(alert.since))} ({alert.calls}{' '}
                {alert.calls === 1 ? 'llamada rechazada' : 'llamadas rechazadas'}). Mientras tanto
                no se pueden revisar imágenes ni generar diseños. Añade crédito en la facturación de
                tu cuenta del proveedor; el aviso desaparece con la primera llamada que responda.
              </p>
            ))}
            <section className="admin-cards" aria-label="Totales">
              <Card label="Generaciones" value={number.format(totals.generations)}>
                {percent(totals.successRate)} con éxito · {totals.failed} fallidas
              </Card>
              <Card label="Tiempo por diseño" value={seconds(totals.durationMs.avg)}>
                mediana {seconds(totals.durationMs.p50)} · p95 {seconds(totals.durationMs.p95)}
              </Card>
              {totals.waitMs && (
                <Card label="Espera en cola" value={seconds(totals.waitMs.p50)}>
                  mediana · p95 {seconds(totals.waitMs.p95)}
                </Card>
              )}
              <Card label="Llamadas a modelos" value={number.format(totals.calls)}>
                {totals.callErrors} con error · {number.format(totals.images)} imágenes
              </Card>
              <Card label="Tokens" value={number.format(totals.inputTokens + totals.outputTokens)}>
                {number.format(totals.inputTokens)} entrada · {number.format(totals.outputTokens)}{' '}
                salida
              </Card>
              <Card label="Coste estimado" value={dollars(totals.costUsd)}>
                {totals.unpricedCalls > 0
                  ? `${totals.unpricedCalls} llamadas sin precio configurado`
                  : 'Según los precios configurados'}
              </Card>
              <Card label="Usuarios activos" value={number.format(totals.accounts)}>
                {totals.signIns} entradas · {totals.signInRefusals} rechazadas
              </Card>
              <Card label="Mensajes" value={number.format(totals.messages)}>
                {totals.uploads} subidas · {totals.uploadRefusals} rechazadas
              </Card>
              <Card label="Fotos de cámara" value={number.format(totals.captures)}>
                {totals.erasures} borrados de datos
              </Card>
            </section>

            <section className="admin-panel" aria-labelledby="by-day">
              <h2 id="by-day">Actividad por día</h2>
              {report.byDay.length === 0 ? (
                <p className="small-note">Sin actividad en este periodo.</p>
              ) : (
                <div className="admin-days">
                  {report.byDay.map((day) => (
                    <div key={day.day} className="admin-day" title={day.day}>
                      <span
                        className="admin-bar"
                        style={{ height: `${(day.generations / busiest) * 100}%` }}
                      />
                      <small>{day.day.slice(5)}</small>
                      <small>{day.generations}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="admin-panel" aria-labelledby="by-model">
              <h2 id="by-model">Consumo por modelo</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>Modelo</th>
                      <th>Uso</th>
                      <th>Llamadas</th>
                      <th>Errores</th>
                      <th>Tokens entrada</th>
                      <th>Tokens salida</th>
                      <th>Imágenes</th>
                      <th>Tiempo medio</th>
                      <th>Coste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byModel.map((row) => (
                      <tr key={`${row.provider}-${row.model}-${row.operation}`}>
                        <td>{row.provider}</td>
                        <td>{row.model}</td>
                        <td>{OPERATION[row.operation] ?? row.operation}</td>
                        <td>{number.format(row.calls)}</td>
                        <td>{row.errors}</td>
                        <td>{number.format(row.inputTokens)}</td>
                        <td>{number.format(row.outputTokens)}</td>
                        <td>{row.images}</td>
                        <td>{seconds(row.durationMs.avg)}</td>
                        <td>{dollars(row.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-panel" aria-labelledby="by-account">
              <h2 id="by-account">Usuarios</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th>Última actividad</th>
                      <th>Diseños</th>
                      <th>Mensajes</th>
                      <th>Subidas</th>
                      <th>Tokens</th>
                      <th>Coste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byAccount.map((row) => (
                      <tr key={row.account} className={row.account === selected ? 'selected' : ''}>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => open(row.account)}
                          >
                            {row.email ?? `${row.account.slice(0, 8)}…`}
                          </button>
                        </td>
                        <td>{when.format(new Date(row.lastSeen))}</td>
                        <td>
                          {row.generations}
                          {row.failed ? ` (${row.failed} fallidos)` : ''}
                        </td>
                        <td>{row.messages}</td>
                        <td>{row.uploads}</td>
                        <td>{number.format(row.tokens)}</td>
                        <td>{dollars(row.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {selected && (
              <section className="admin-panel" aria-labelledby="account-detail">
                <h2 id="account-detail">
                  {detail?.email ?? selected}
                  <button type="button" className="link-button" onClick={() => setSelected(null)}>
                    Cerrar
                  </button>
                </h2>
                {!detail ? (
                  <p className="small-note">Cargando…</p>
                ) : (
                  <AccountView detail={detail} />
                )}
              </section>
            )}

            <section className="admin-panel" aria-labelledby="errors">
              <h2 id="errors">Errores recientes</h2>
              {report.errors.length === 0 ? (
                <p className="small-note">Ninguno en este periodo.</p>
              ) : (
                <ul className="admin-errors">
                  {report.errors.map((item) => (
                    <li key={`${item.ts}-${item.operation}`}>
                      <time>{when.format(new Date(item.ts))}</time>{' '}
                      <strong>{OPERATION[item.operation] ?? item.operation}</strong>
                      {item.provider ? ` · ${item.provider}` : ''}
                      {item.reason ? ` — ${item.reason}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Card({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="admin-card">
      <span className="admin-card-label">{label}</span>
      <strong>{value}</strong>
      <small>{children}</small>
    </div>
  );
}

function AccountView({ detail }: { detail: AccountDetail }): ReactNode {
  const media = (id: string) => `/api/admin/media?id=${id}`;
  return (
    <div className="admin-account">
      <h3>Diseños</h3>
      {detail.versions.length === 0 ? (
        <p className="small-note">Sin diseños guardados.</p>
      ) : (
        <div className="admin-versions">
          {detail.versions.map((version) =>
            version.result ? (
              <figure key={version.jobId}>
                <div className="admin-version-images">
                  <img src={media(version.result.master.assetId)} alt="Diseño maestro" />
                  {version.adminHidden.includes('mockup') ||
                  version.adminHidden.includes('capture') ? (
                    <div className="admin-hidden">Foto corporal oculta</div>
                  ) : (
                    <img src={media(version.result.mockup.assetId)} alt="Vista sobre piel" />
                  )}
                </div>
                <figcaption>
                  {version.result.capture
                    ? 'Foto con la cámara'
                    : (version.result.edit?.instruction ?? 'Diseño inicial')}
                </figcaption>
              </figure>
            ) : null,
          )}
        </div>
      )}

      <h3>Actividad</h3>
      <ol className="admin-timeline">
        {detail.events.map((event, index) => (
          <li key={`${event.ts}-${index}`} className={`admin-event ${event.outcome}`}>
            <time>{when.format(new Date(event.ts))}</time>
            <Describe event={event} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Describe({ event }: { event: AccountDetail['events'][number] }): ReactNode {
  if (event.kind === 'consultation_turn' && event.text)
    return (
      <p className={event.operation === 'reply' ? 'admin-reply' : 'admin-message'}>
        <strong>{event.operation === 'reply' ? 'Estudio' : 'Cliente'}:</strong> {event.text}
      </p>
    );
  if (event.kind === 'provider_call')
    return (
      <p>
        {OPERATION[event.operation] ?? event.operation} · {event.provider} {event.model} ·{' '}
        {seconds(event.durationMs)}
        {event.inputTokens !== null || event.outputTokens !== null
          ? ` · ${number.format(event.inputTokens ?? 0)}/${number.format(event.outputTokens ?? 0)} tokens`
          : ''}
        {event.outcome !== 'ok' ? ` · error: ${String(event.detail['error'] ?? '')}` : ''}
      </p>
    );
  const label: Record<string, string> = {
    job: 'Generación',
    upload: 'Subida',
    capture: 'Foto de cámara guardada',
    sign_in: 'Inicio de sesión',
    deletion: 'Borró sus datos',
    consultation_turn: 'Consulta',
  };
  const reason = event.detail['reason'] ?? event.detail['error'];
  return (
    <p>
      {label[event.kind] ?? event.kind}
      {event.kind === 'upload' ? ` (${event.operation})` : ''}
      {event.kind === 'job' ? ` · ${seconds(event.durationMs)}` : ''}
      {event.outcome !== 'ok' ? ` · ${event.outcome}` : ''}
      {reason ? ` — ${String(reason)}` : ''}
    </p>
  );
}
