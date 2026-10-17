import { describe, expect, it } from 'vitest';

import { blockedSource, pagePath, violations } from './csp-report';

describe('a CSP report keeps only what may be kept (TASK-0127)', () => {
  it('reads the report-uri format', () => {
    const body = {
      'csp-report': {
        'document-uri': 'https://inkcraft.aurevanta.es/t/SECRET-token-123?x=1',
        'violated-directive': 'img-src',
        'effective-directive': 'img-src',
        'blocked-uri': 'https://evil.example/pixel.gif?who=me',
      },
    };
    expect(violations(body)).toEqual([
      { directive: 'img-src', blocked: 'https://evil.example', page: '/t/…' },
    ]);
  });

  it('reads the Reporting API format and ignores other report types', () => {
    const body = [
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://inkcraft.aurevanta.es/probar?design=abc',
          effectiveDirective: 'script-src-elem',
          blockedURL: 'inline',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
    ];
    expect(violations(body)).toEqual([
      { directive: 'script-src-elem', blocked: 'inline', page: '/probar' },
    ]);
  });

  it('never keeps a path, a query or an identifier', () => {
    expect(blockedSource('data:image/png;base64,AAAA')).toBe('data');
    expect(blockedSource('blob:https://inkcraft.aurevanta.es/1234')).toBe('blob');
    expect(blockedSource('eval')).toBe('eval');
    expect(blockedSource('not a url')).toBe('unknown');
    expect(pagePath('https://x.es/api/media/0123456789abcdef0123456789abcdef')).toBe(
      '/api/media/…',
    );
    expect(violations({ nothing: true })).toEqual([]);
    expect(violations('text')).toEqual([]);
  });
});
