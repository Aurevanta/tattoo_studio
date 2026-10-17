/**
 * What a Content-Security-Policy report says, reduced to what may be kept (TASK-0127): the
 * directive, the blocked source as a keyword or an origin, and the page's path without tokens.
 */
export interface Violation {
  directive: string;
  blocked: string;
  page: string | null;
}

/** Both report formats: `application/csp-report` (report-uri) and `application/reports+json`. */
export function violations(body: unknown): Violation[] {
  const raw: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const entry of body.slice(0, 20)) {
      if (isRecord(entry) && entry['type'] === 'csp-violation' && isRecord(entry['body']))
        raw.push(entry['body']);
    }
  } else if (isRecord(body) && isRecord(body['csp-report'])) {
    raw.push(body['csp-report']);
  }
  return raw.flatMap((entry) => {
    const directive = text(
      entry['effectiveDirective'] ?? entry['effective-directive'] ?? entry['violated-directive'],
    );
    if (!directive) return [];
    return [
      {
        directive: directive.split(' ')[0]!.slice(0, 40),
        blocked: blockedSource(text(entry['blockedURL'] ?? entry['blocked-uri'])),
        page: pagePath(text(entry['documentURL'] ?? entry['document-uri'])),
      },
    ];
  });
}

/** What was blocked, without its path or query: a keyword or an origin. */
export function blockedSource(value: string | null): string {
  if (!value) return 'unknown';
  if (['inline', 'eval', 'wasm-eval', 'trusted-types-policy'].includes(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1);
    return url.origin === 'null' ? url.protocol.slice(0, -1) : url.origin;
  } catch {
    return 'unknown';
  }
}

/** The page's path with a tattooer link's token and any identifier taken out. */
export function pagePath(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).pathname
      .replace(/^\/t\/[^/]+/, '/t/…')
      .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/…')
      .slice(0, 120);
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
