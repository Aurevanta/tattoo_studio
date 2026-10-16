import { describe, expect, it } from 'vitest';

import { IMAGES_VERSION, LEGAL_DRAFT, LEGAL_ENTITY, PRIVACY, TERMS } from './legal';

const text = (sections: { paragraphs: string[] }[]) =>
  sections.flatMap((s) => s.paragraphs).join(' ');

describe('legal readiness (TASK-0131)', () => {
  it('cannot leave draft without the holder data Spanish law asks for (LSSI art. 10)', () => {
    if (!LEGAL_DRAFT) {
      expect(LEGAL_ENTITY.taxId.trim()).not.toBe('');
      expect(LEGAL_ENTITY.address.trim()).not.toBe('');
    }
    expect(LEGAL_ENTITY.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  });

  it('shows no empty field as a gap', () => {
    const all = `${text(TERMS)} ${text(PRIVACY)}`;
    expect(all).not.toMatch(/NIF\s*[,)]|\(\s*\)|undefined|null/);
  });

  it('names who receives the IP, the search text, the cookies and the consultation life', () => {
    const privacy = text(PRIVACY);
    for (const party of [
      'Supabase',
      'OpenAI',
      'Anthropic',
      'Black Forest Labs',
      'Brave',
      'Wikimedia',
      'Openverse',
      'Google Fonts',
    ])
      expect(privacy).toContain(party);
    expect(privacy).not.toContain('solo recibe el texto de la búsqueda');
    for (const cookie of ['inkcraft_at', 'inkcraft_rt', 'inkcraft_ok'])
      expect(privacy).toContain(cookie);
    expect(privacy).toMatch(/consulta en curso se borra 24 horas/);
    expect(IMAGES_VERSION).toBe('2026-10-16');
  });
});
