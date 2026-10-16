/**
 * The browser's CSP reports reach the Panel, once per problem, attributed to nobody (TASK-0127).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';
import { routeEvents, type WebEvent } from '../../../lib/telemetry';

let sent: { event: WebEvent; account: string | undefined }[] = [];
beforeEach(() => {
  sent = [];
  routeEvents((event, account) => sent.push({ event, account }));
});
afterEach(() => routeEvents(undefined));

const post = (body: string, type = 'application/csp-report') =>
  POST(
    new Request('http://localhost:3000/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    }),
  );

const violation = (blocked: string) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': 'http://localhost:3000/inicio',
      'effective-directive': 'connect-src',
      'blocked-uri': blocked,
    },
  });

describe('CSP reports (TASK-0127)', () => {
  it('records each distinct violation once, as nobody', async () => {
    expect((await post(violation('https://a.example/x'))).status).toBe(204);
    await post(violation('https://a.example/y'));
    await post(violation('https://b.example/'));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      account: undefined,
      event: {
        kind: 'client_error',
        operation: 'csp',
        outcome: 'refused',
        detail: { directive: 'connect-src', blocked: 'https://a.example', page: '/inicio' },
      },
    });
  });

  it('answers 204 and records nothing for a malformed or oversized report', async () => {
    expect((await post('{not json')).status).toBe(204);
    expect((await post('x'.repeat(9000))).status).toBe(204);
    expect(sent.filter((s) => s.event.detail?.['blocked'] === 'unknown')).toHaveLength(0);
  });
});
