/**
 * Tell the studio that a screen failed in the client's browser (TASK-0094, audit 2026-10-08
 * ARQ-02). Before this, such a failure reached nobody: the Panel only saw what the servers saw.
 *
 * Fire-and-forget: reporting never throws and never holds the page. Only the path is sent, never
 * the query string, and the message is cut short; the route keeps the event only for an account.
 */
export type ClientErrorWhere = 'render' | 'global';

export function reportClientError(
  error: Error & { digest?: string },
  where: ClientErrorWhere,
): void {
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        where,
        message: String(error?.message ?? '').slice(0, 300),
        digest: typeof error?.digest === 'string' ? error.digest.slice(0, 64) : undefined,
        path: window.location.pathname.slice(0, 200),
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never be the second failure.
  }
}
