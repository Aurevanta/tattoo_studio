/**
 * Browser defences for every response (TASK-0074, audit SEG-01; enforced by TASK-0127).
 *
 * TASK-0074 enforced a minimum (no framing, no plugins, no foreign base URL) and sent the complete
 * policy as Report-Only, as the audit advised, until what the studio really loads was confirmed.
 * TASK-0127 confirmed it against a production build (Google Fonts, reference thumbnails from
 * several hosts, the 3D models and their blob textures, camera frames, the service worker) and
 * enforces the complete policy. Violations are reported to `/api/csp-report`, which records them
 * for the Panel.
 *
 * Residual: scripts still allow 'unsafe-inline', because Next's own bootstrap scripts are inline;
 * nonces would make every page dynamic. Development adds 'unsafe-eval' for React Refresh only.
 *
 * @param {boolean} production
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(production) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // The camera try-on (TASK-0050) needs the camera on this origin; nothing else is used.
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(production) },
    // Where `report-to csp` sends violations (Reporting API); `report-uri` covers older browsers.
    { key: 'Reporting-Endpoints', value: `csp="${CSP_REPORT_PATH}"` },
    // Only over HTTPS in production: a local http:// preview must not be pinned to HTTPS.
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
  ];
}

export const CSP_REPORT_PATH = '/api/csp-report';

/**
 * @param {boolean} production
 * @returns {string}
 */
export function contentSecurityPolicy(production) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // References come from Wikimedia, Openverse, Brave and club sites; generated media is ours.
    // The 3D models' embedded textures are decoded through blob: URLs.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    // Every call goes to this origin's API; the browser talks to no provider (ADR-0005).
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(production ? ['upgrade-insecure-requests'] : []),
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ');
}
