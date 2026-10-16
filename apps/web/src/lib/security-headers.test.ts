import { describe, expect, it } from 'vitest';

import { securityHeaders } from '../../security-headers.mjs';

type Header = { key: string; value: string };
const byKey = (headers: Header[]) => Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe('security headers (TASK-0074, audit SEG-01)', () => {
  it('sends the browser defences the audit found missing', () => {
    const headers = byKey(securityHeaders(true));
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
  });

  it('keeps the camera for the try-on and nothing else', () => {
    expect(byKey(securityHeaders(true))['Permissions-Policy']).toBe(
      'camera=(self), microphone=(), geolocation=()',
    );
  });

  it('enforces the complete policy, allowing what the studio loads (TASK-0127)', () => {
    const headers = byKey(securityHeaders(true));
    const policy = headers['Content-Security-Policy']!;
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain('https://fonts.googleapis.com');
    expect(policy).toContain('https://fonts.gstatic.com');
    expect(policy).toContain("img-src 'self' data: blob: https:");
    expect(policy).toContain("worker-src 'self'");
    expect(policy).toContain('upgrade-insecure-requests');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('reports violations to the studio, by both reporting mechanisms', () => {
    const headers = byKey(securityHeaders(true));
    expect(headers['Content-Security-Policy']).toContain('report-uri /api/csp-report');
    expect(headers['Content-Security-Policy']).toContain('report-to csp');
    expect(headers['Reporting-Endpoints']).toBe('csp="/api/csp-report"');
  });

  it('allows eval only in development, for React Refresh', () => {
    const local = byKey(securityHeaders(false))['Content-Security-Policy']!;
    expect(local).toContain("'unsafe-eval'");
    expect(local).not.toContain('upgrade-insecure-requests');
  });

  it('does not pin a local http preview to HTTPS', () => {
    expect(byKey(securityHeaders(false))['Strict-Transport-Security']).toBeUndefined();
  });
});
