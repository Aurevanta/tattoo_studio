/**
 * What the web tier reports for monitoring (TASK-0054).
 *
 * The web tier makes paid calls of its own — the consultation's Claude calls — and sees things the
 * worker cannot: sign-ins and the turns of a conversation. It reports them to the worker, which
 * keeps the only connection to the event database. This tier, which faces the internet, never
 * holds that credential.
 *
 * Reporting is fire-and-forget: it never delays a response and never fails one.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { onProviderUsage } from '@tattoo/consultation';

export interface WebEvent {
  kind: 'provider_call' | 'consultation_turn' | 'sign_in' | 'client_error';
  operation: string;
  outcome?: 'ok' | 'error' | 'refused';
  provider?: string;
  model?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  text?: string;
  detail?: Record<string, string | number | boolean | null>;
}

type Transport = (event: WebEvent, account: string | undefined) => void;

/** The account of the request in progress, set once the guard has identified it. */
const scope = new AsyncLocalStorage<{ account: string }>();

/** Everything reported in this request, from here on, belongs to this account. */
export function attribute(account: string): void {
  scope.enterWith({ account });
}

/** Deliver to the worker's event route over the service token. */
const toWorker: Transport = (event, account) => {
  const token = process.env['TATTOO_WORKER_TOKEN'];
  if (!token) return;
  void fetch(`${process.env['TATTOO_WORKER_URL'] ?? 'http://127.0.0.1:8000'}/studio/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(account ? { 'X-Owner-Id': account } : {}),
    },
    body: JSON.stringify({ events: [event] }),
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  }).catch(() => undefined);
};

let transport: Transport = toWorker;

/** Tests route events to a collector instead of the worker; `undefined` restores the worker. */
export function routeEvents(next: Transport | undefined): void {
  transport = next ?? toWorker;
}

/**
 * Report one event. With no `account`, it is the current request's; with `null`, it is nobody's —
 * a refused sign-in must never be attributed to whoever the context happens to hold.
 */
export function report(event: WebEvent, account?: string | null): void {
  try {
    transport(event, account === undefined ? scope.getStore()?.account : (account ?? undefined));
  } catch {
    // Monitoring must not break a request.
  }
}

// The consultation package announces its model calls; they are forwarded as the account's.
onProviderUsage((usage) =>
  report({
    kind: 'provider_call',
    operation: usage.operation,
    provider: usage.provider,
    model: usage.model,
    outcome: usage.outcome,
    duration_ms: usage.durationMs,
    ...(usage.inputTokens === undefined ? {} : { input_tokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { output_tokens: usage.outputTokens }),
    ...(usage.error ? { detail: { error: usage.error } } : {}),
  }),
);
