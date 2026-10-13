import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_SCOUT_MODEL,
  ClaudeScoutQueryPlanner,
  isOpenverseThumbnail,
  JUDGE_PROMPT,
  PLANNER_PROMPT,
  subjectQuery,
  curatedQueries,
  referenceQueries,
  VisualSearchAgent,
  type CandidateScreen,
  type OpenWebImageSearch,
} from '../index';
import type { ReferenceImage } from '../types';

/** Commons returns nothing, so every query falls through to the open-web fallback. */
const emptyCommons = vi.fn(async () =>
  Response.json({ query: { pages: {} } }),
) as unknown as typeof fetch;

/** Commons returns one licensed file for any query. */
const commonsHit = vi.fn(async () =>
  Response.json({
    query: {
      pages: {
        one: {
          index: 1,
          title: 'File:Fox.png',
          imageinfo: [{ url: 'https://upload.wikimedia.org/fox.png', mime: 'image/png' }],
        },
      },
    },
  }),
) as unknown as typeof fetch;

const webCandidate = (source: string, label: string): ReferenceImage => ({
  source,
  mimeType: 'image/jpeg',
  label,
  referenceQuery: 'q',
  verification: 'candidate',
});

describe('Visual scout on Claude Sonnet (TASK-0032/REQ-005)', () => {
  it('uses the injected planner to decide the queries', async () => {
    const plan = vi.fn(async () => [{ query: 'red fox illustration', essential: false }]);
    const request = vi.fn(async (url: string | URL | Request) => {
      expect(decodeURIComponent(String(url))).toContain('red fox illustration');
      return Response.json({ query: { pages: {} } });
    }) as unknown as typeof fetch;

    await new VisualSearchAgent(request, { planner: { plan } }).scoutReferenceImages({
      userInput: 'un zorro',
    });

    expect(plan).toHaveBeenCalledWith('un zorro');
    // Commons had nothing, so Openverse was asked too (TASK-0058).
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('falls back to the deterministic queries when the planner fails', async () => {
    const request = vi.fn(async (url: string | URL | Request) => {
      expect(decodeURIComponent(String(url))).toContain('Escudo del Real Madrid');
      return Response.json({ query: { pages: {} } });
    }) as unknown as typeof fetch;
    const planner = {
      plan: vi.fn(async () => {
        throw new Error('down');
      }),
    };

    await new VisualSearchAgent(request, { planner }).scoutReferenceImages({
      userInput: 'Escudo del Real Madrid',
    });

    expect(referenceQueries('Escudo del Real Madrid')).toEqual(['Escudo del Real Madrid']);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('searches every element of a request, not only the ones it knows (TASK-0098)', async () => {
    const idea =
      'quiero el escudo del valencia CG, el estadio de mestalla, la senyera valenciana y la virgen de los desamparados';
    const searched: string[] = [];
    const request = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.includes('commons.wikimedia.org'))
        searched.push(new URL(text).searchParams.get('gsrsearch') ?? '');
      return Response.json({ query: { pages: {} } });
    }) as unknown as typeof fetch;
    const plan = vi.fn(async () => [
      { query: 'Valencia CF crest', essential: true, label: 'el escudo del Valencia CF' },
      { query: 'Mestalla Stadium', essential: true, label: 'el estadio de Mestalla' },
      { query: 'Valencian flag', essential: true, label: 'la senyera valenciana' },
      {
        query: 'Our Lady of the Forsaken',
        essential: true,
        label: 'la Virgen de los Desamparados',
      },
      { query: 'football', essential: false, label: 'un balón' },
    ]);

    const result = await new VisualSearchAgent(request, { planner: { plan } }).scoutReferenceImages(
      { userInput: idea },
    );

    expect(plan).toHaveBeenCalledWith(idea);
    // The four named entities run as their verified queries, once each; the planner adds the rest.
    expect(result.queries).toEqual([
      '"Estàtua de la mare de Déu dels Desemparats" -darrere',
      '"Flag of the Valencian Community" -simplified',
      'Valencia CF crest',
      'Mestalla stadium',
      'football',
    ]);
    expect(result.essential).toHaveLength(4);
    expect(result.labels['Mestalla stadium']).toBe('el estadio de Mestalla');
    expect(searched).toContain('Mestalla stadium');
    expect(searched).toContain('"Estàtua de la mare de Déu dels Desemparats" -darrere');
  });

  it('recognises the Spanish names and the "Valencia CG" slip without a planner', () => {
    expect(curatedQueries('la virgen de los desamparados')).toEqual([
      '"Estàtua de la mare de Déu dels Desemparats" -darrere',
    ]);
    expect(curatedQueries('el escudo del valencia CG')).toEqual(['Valencia CF crest']);
    expect(curatedQueries('Valencia C.F.')).toEqual(['Valencia CF crest']);
    expect(curatedQueries('una vista de Valencia con gatos')).toEqual([]);
    expect(curatedQueries('el estadio de Mestalla')).toEqual(['Mestalla stadium']);
  });

  it('keeps the curated queries when the planner fails', async () => {
    const request = vi.fn(async () =>
      Response.json({ query: { pages: {} } }),
    ) as unknown as typeof fetch;
    const planner = {
      plan: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const result = await new VisualSearchAgent(request, { planner }).scoutReferenceImages({
      userInput: 'la senyera y Mestalla',
    });
    expect(result.queries).toEqual([
      '"Flag of the Valencian Community" -simplified',
      'Mestalla stadium',
    ]);
  });

  it('prefers licensed sources and never consults the open web when Commons answers', async () => {
    const openWeb: OpenWebImageSearch = { search: vi.fn(async () => []) };
    const result = await new VisualSearchAgent(commonsHit, { openWeb }).scoutReferenceImages({
      userInput: 'fox',
    });
    expect(result.scoutedImages[0]?.source).toBe('https://upload.wikimedia.org/fox.png');
    expect(openWeb.search).not.toHaveBeenCalled();
  });

  it('uses the open web only as a fallback when licensed sources return nothing', async () => {
    const openWeb: OpenWebImageSearch = {
      search: vi.fn(async () => [webCandidate('https://example.org/fox.jpg', 'fox drawing')]),
    };
    const result = await new VisualSearchAgent(emptyCommons, { openWeb }).scoutReferenceImages({
      userInput: 'fox',
    });
    expect(openWeb.search).toHaveBeenCalledOnce();
    expect(result.scoutedImages[0]?.source).toBe('https://example.org/fox.jpg');
    expect(result.scoutedImages[0]?.verification).toBe('candidate');
  });

  it('rejects an open-web candidate depicting a real person (AC-004)', async () => {
    const person = webCandidate('https://example.org/person.jpg', 'photo of a real person');
    const drawing = webCandidate('https://example.org/fox.jpg', 'fox drawing');
    const openWeb: OpenWebImageSearch = { search: vi.fn(async () => [person, drawing]) };
    const screen: CandidateScreen = {
      screen: vi.fn(async (image: ReferenceImage) => !image.label?.includes('real person')),
    };

    const result = await new VisualSearchAgent(emptyCommons, {
      openWeb,
      screen,
    }).scoutReferenceImages({ userInput: 'fox' });

    expect(result.scoutedImages.map((r) => r.source)).toEqual(['https://example.org/fox.jpg']);
    expect(screen.screen).toHaveBeenCalledWith(person);
  });

  it('screens licensed candidates too, and fails closed when the screen errors', async () => {
    const screen: CandidateScreen = {
      screen: vi.fn(async () => {
        throw new Error('moderation unavailable');
      }),
    };
    const result = await new VisualSearchAgent(commonsHit, { screen }).scoutReferenceImages({
      userInput: 'fox',
    });
    expect(result.scoutedImages).toEqual([]);
  });
});

const OPENVERSE_THUMB =
  'https://api.openverse.org/v1/images/0ab10347-24ca-470a-83f1-4e07d5bae69b/thumb/';

/** Commons answers with a fox; Openverse with a usable thumbnail and one from another host. */
function bothSources(asked: string[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    asked.push(href);
    if (href.startsWith('https://api.openverse.org/v1/images/?'))
      return Response.json({
        results: [
          {
            thumbnail: 'https://evil.example/v1/images/x/thumb/',
            title: 'Elsewhere',
            license: 'by',
          },
          {
            thumbnail: OPENVERSE_THUMB,
            title: 'Biomechanical flash',
            license: 'by-nc',
            license_version: '2.0',
            creator: 'Ana',
            foreign_landing_url: 'https://www.flickr.com/photos/ana/1',
          },
        ],
      });
    if (href === OPENVERSE_THUMB || href === 'https://upload.wikimedia.org/fox.png')
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    return (commonsHit as unknown as (u: string) => Promise<Response>)(href);
  }) as unknown as typeof fetch;
}

describe('Openverse as a second licensed source (TASK-0058, ADR-0026)', () => {
  it('offers Openverse candidates to the judge beside Commons', async () => {
    const asked: string[] = [];
    const choose = vi.fn(async () => [1]);
    const result = await new VisualSearchAgent(bothSources(asked), {
      planner: { plan: async () => [{ query: 'biomechanical tattoo', essential: false }] },
      judge: { choose },
    }).scoutReferenceImages({ userInput: 'un biomecánico' });

    const search = new URL(
      asked.find((u) => u.startsWith('https://api.openverse.org/v1/images/?'))!,
    );
    // Only licences that allow derivative works, and nothing flagged mature.
    expect(search.searchParams.get('license_type')).toBe('modification');
    expect(search.searchParams.get('mature')).toBe('false');
    // The judge saw the Commons fox and the Openverse thumbnail, never the foreign host.
    expect((choose.mock.calls[0] as unknown[])[1]).toHaveLength(2);
    expect(asked).not.toContain('https://evil.example/v1/images/x/thumb/');
    expect(result.scoutedImages).toEqual([
      expect.objectContaining({
        source: OPENVERSE_THUMB,
        license: 'CC BY-NC 2.0 · Ana',
        sourcePage: 'https://www.flickr.com/photos/ana/1',
        verification: 'candidate',
      }),
    ]);
  });

  it('without a judge, asks Openverse only when Commons has nothing', async () => {
    const asked: string[] = [];
    const result = await new VisualSearchAgent(bothSources(asked)).scoutReferenceImages({
      userInput: 'fox',
    });
    expect(result.scoutedImages[0]?.source).toBe('https://upload.wikimedia.org/fox.png');
    expect(asked.some((u) => u.includes('openverse'))).toBe(false);
  });

  it('keeps Commons answers when Openverse is down', async () => {
    const request = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('openverse')) return new Response('down', { status: 503 });
      if (String(url) === 'https://upload.wikimedia.org/fox.png')
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      return (commonsHit as unknown as (u: string) => Promise<Response>)(String(url));
    }) as unknown as typeof fetch;
    const result = await new VisualSearchAgent(request, {
      planner: { plan: async () => [{ query: 'fox', essential: false }] },
      judge: { choose: async () => [0] },
    }).scoutReferenceImages({ userInput: 'un zorro' });
    expect(result.scoutedImages.map((r) => r.source)).toEqual([
      'https://upload.wikimedia.org/fox.png',
    ]);
  });

  it('recognises only Openverse thumbnails of one exact shape', () => {
    expect(isOpenverseThumbnail(OPENVERSE_THUMB)).toBe(true);
    for (const bad of [
      `${OPENVERSE_THUMB}?x=1`,
      'http://api.openverse.org/v1/images/0ab10347-24ca-470a-83f1-4e07d5bae69b/thumb/',
      'https://api.openverse.org.evil.test/v1/images/0ab10347-24ca-470a-83f1-4e07d5bae69b/thumb/',
      'https://api.openverse.org/v1/images/../../admin/thumb/',
    ])
      expect(isOpenverseThumbnail(bad), bad).toBe(false);
  });
});

describe('ClaudeScoutQueryPlanner (TASK-0032/REQ-005)', () => {
  it('asks Sonnet 5 for schema-constrained queries and keeps at most five', async () => {
    let body: Record<string, unknown> = {};
    const request = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}'));
      return Response.json({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              queries: [
                { query: ' red fox ', essential: false, label: 'un zorro rojo' },
                { query: 'fox head', essential: false, label: 'cabeza de zorro' },
                { query: 'FC Barcelona crest', essential: true, label: 'el escudo del Barça' },
                { query: 'fox tail', essential: false, label: 'cola de zorro' },
                { query: 'fox den', essential: false, label: 'madriguera' },
                { query: 'extra', essential: false, label: 'extra' },
              ],
            }),
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    }) as unknown as typeof fetch;

    const queries = await new ClaudeScoutQueryPlanner({ apiKey: 'k' }, request).plan('un zorro');

    expect(body['model']).toBe(CLAUDE_SCOUT_MODEL);
    expect(body['model']).toBe('claude-sonnet-5');
    expect((body['output_config'] as { effort: string }).effort).toBe('low');
    expect(queries).toEqual([
      { query: 'red fox', essential: false, label: 'un zorro rojo' },
      { query: 'fox head', essential: false, label: 'cabeza de zorro' },
      { query: 'FC Barcelona crest', essential: true, label: 'el escudo del Barça' },
      { query: 'fox tail', essential: false, label: 'cola de zorro' },
      { query: 'fox den', essential: false, label: 'madriguera' },
    ]);
    expect(PLANNER_PROMPT).toContain('every one of them gets its own query');
  });

  it('searches for the subject, never the style or a tattoo (TASK-0061)', async () => {
    const request = (async () =>
      Response.json({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              queries: [
                { query: 'biomechanical bat', essential: false, label: 'murciélago' },
                { query: 'mechanical gears texture', essential: false, label: 'engranajes' },
                { query: 'owl tattoo design', essential: false, label: 'búho' },
                { query: 'traditional american rose', essential: false, label: 'rosa' },
              ],
            }),
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 },
      })) as unknown as typeof fetch;

    const queries = await new ClaudeScoutQueryPlanner({ apiKey: 'k' }, request).plan('x');
    // The gears query held nothing but style: it is dropped, not searched.
    expect(queries.map((q) => q.query)).toEqual(['bat', 'owl', 'rose']);
  });

  it('keeps a subject whole and drops only the words that are not one', () => {
    expect(subjectQuery('howling wolf')).toBe('howling wolf');
    expect(subjectQuery('Great Wave off Kanagawa')).toBe('Great Wave off Kanagawa');
    expect(subjectQuery('geometric owl')).toBe('owl');
    expect(subjectQuery('octopus tattoo')).toBe('octopus');
    expect(subjectQuery('watercolor splash pattern')).toBe('splash');
    expect(subjectQuery('mechanical gears texture')).toBe('');
  });

  it('tells the judge to read the whole idea and refuse style parts and tattoos', () => {
    expect(JUDGE_PROMPT).toContain("client's whole idea");
    expect(JUDGE_PROMPT).toContain('gears or machinery for "biomechanical"');
    expect(JUDGE_PROMPT).toContain('Reject every tattoo, tattoo design, flash sheet');
    expect(JUDGE_PROMPT).not.toContain('flash sheet, a painting, a sculpture or an object is fine');
    expect(PLANNER_PROMPT).toContain('Never search for tattoos');
  });

  it('throws without a credential so the scout falls back', async () => {
    await expect(new ClaudeScoutQueryPlanner({ apiKey: '' }).plan('x')).rejects.toThrow();
  });
});
