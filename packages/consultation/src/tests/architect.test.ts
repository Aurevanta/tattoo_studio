import { describe, expect, it, vi } from 'vitest';
import { BODY_ZONE_SPANS } from '@tattoo/contracts';
import {
  conversationTurns,
  DEFAULT_LINEWORK_NOTE,
  textReadings,
  OrchestratorAgent,
  sanitizeArchitectSlots,
  VisualSearchAgent,
  type ConsultationProvider,
  type MultiAgentMessage,
  type ProviderExtractionOutput,
} from '../index';
import type { ConsultationTurn, ReferenceImage } from '../types';

const reference = {
  source: 'https://upload.wikimedia.org/example.png',
  mimeType: 'image/png' as const,
};

const offlineScout = () =>
  new VisualSearchAgent(vi.fn(async () => Response.json({ query: { pages: {} } })) as typeof fetch);

function fakeArchitect(output: Partial<ProviderExtractionOutput>) {
  const processTurn = vi.fn<(turns: ConsultationTurn[]) => Promise<ProviderExtractionOutput>>(
    async () => ({ extractedSlots: {}, assistantReply: 'ok', ...output }),
  );
  const architect: ConsultationProvider = { processTurn };
  return { architect, processTurn };
}

const samurai = {
  subject: { description: 'a rewrite the client never said', elements: ['samurái', 'olas'] },
  style: { primary: 'irezumi', notes: 'wabori con olas' },
  linework: { weight: 'bold' },
  shading: { technique: 'smooth_blend', intensity: 'heavy' },
  colour: { mode: 'black_and_grey' },
  placement: { bodyPart: 'thigh_front', side: 'right', orientation: 'vertical' },
  size: { widthMm: 300, heightMm: 400 },
} as const;

describe('Prompt architect on the live route (TASK-0033)', () => {
  it('AC-001: fills what a vague idea left open, keeping the client words', async () => {
    const { architect } = fakeArchitect({ extractedSlots: structuredClone(samurai) as never });
    const o = new OrchestratorAgent(offlineScout(), architect);

    const s = await o.handleUserInteraction(o.createSession(), 'Un guerrero samurái sobre olas', [
      reference,
    ]);

    expect(s.slots.subject?.description).toBe('Un guerrero samurái sobre olas');
    expect(s.slots.subject?.elements).toEqual(['samurái', 'olas']);
    expect(s.slots.style).toEqual({ primary: 'irezumi', notes: 'wabori con olas' });
    expect(s.slots.placement).toMatchObject({ bodyPart: 'thigh_front', orientation: 'vertical' });
    // Live finding: the architect guessed a side the client never gave. It is not adopted.
    expect(s.slots.placement?.side).toBeUndefined();
    expect(s.slots.colour).toEqual({ mode: 'black_and_grey' });
    expect(s.slots.linework?.weight).toBe('bold');
    expect(s.slots.shading).toEqual({ technique: 'smooth_blend', intensity: 'heavy' });
    expect(s.questionsAsked).toBe(0);
  });

  it('TASK-0039: the architect rereads the message; side and size stay the client s', async () => {
    // TASK-0033/AC-002 had the keyword rules win over the architect. Live, the rules read
    // "parte en blanco y negro y el resto en color" as black and grey and overrode an architect
    // that had it right, so the owner asked for the agent that understands the prompt to decide.
    const { architect } = fakeArchitect({
      extractedSlots: {
        style: { primary: 'black_and_grey_realism', notes: 'estadio mitad B/N, resto color' },
        colour: { mode: 'black_and_grey_with_accent', palette: ['rojo', 'amarillo'] },
        placement: { bodyPart: 'calf', side: 'left' },
        size: { widthMm: 300, heightMm: 400 },
      },
    });
    const o = new OrchestratorAgent(offlineScout(), architect);
    const s = await o.handleUserInteraction(
      o.createSession(),
      'Mestalla hiper realista, parte en blanco y negro y el resto en color, en el gemelo derecho',
      [reference],
    );
    expect(s.slots.colour).toEqual({
      mode: 'black_and_grey_with_accent',
      palette: ['rojo', 'amarillo'],
    });
    expect(s.slots.style?.primary).toBe('black_and_grey_realism');
    expect(s.slots.placement).toMatchObject({ bodyPart: 'calf', side: 'right' });
    const span = BODY_ZONE_SPANS['calf']!;
    expect(s.slots.size?.proposed).toBe(true);
    expect(s.slots.size?.heightMm).toBeLessThanOrEqual(span.heightMm);
  });

  it('TASK-0039: values chosen in the panel are never reread', () => {
    const before = { colour: { mode: 'colour' as const } };
    const after = { colour: { mode: 'black_and_grey' as const } };
    expect([...textReadings(before, after)]).toEqual(['colour']);
    expect([...textReadings(before, after, { colour: { mode: 'black_and_grey' } })]).toEqual([]);
    // Nothing the message changed is nothing to reread.
    expect([...textReadings(before, before)]).toEqual([]);
  });

  it('AC-002 (superseded by TASK-0039 for style, colour and zone): what the architect did not answer stays as read', async () => {
    const { architect } = fakeArchitect({
      extractedSlots: {
        placement: { side: 'right' },
        size: { widthMm: 300, heightMm: 400 },
      },
    });
    const o = new OrchestratorAgent(offlineScout(), architect);

    const s = await o.handleUserInteraction(
      o.createSession(),
      'Un león de línea fina en el antebrazo izquierdo, solo negro',
      [reference],
    );

    expect(s.slots.style).toEqual({ primary: 'fine_line' });
    expect(s.slots.placement).toMatchObject({ bodyPart: 'inner_forearm', side: 'left' });
    expect(s.slots.colour).toEqual({ mode: 'black_and_grey' });
    // TASK-0034: 300 × 400 mm cannot fit an inner forearm; it is scaled down and flagged.
    const span = BODY_ZONE_SPANS['inner_forearm']!;
    expect(s.slots.size?.proposed).toBe(true);
    expect(s.slots.size?.widthMm).toBeLessThanOrEqual(span.widthMm);
    expect(s.slots.size?.heightMm).toBeLessThanOrEqual(span.heightMm);
  });

  it('TASK-0034: an explicit size always beats the proposal', async () => {
    const { architect } = fakeArchitect({
      extractedSlots: { size: { widthMm: 300, heightMm: 400 } },
    });
    const o = new OrchestratorAgent(offlineScout(), architect);
    const s = await o.handleUserInteraction(
      o.createSession(),
      'Un león en el antebrazo izquierdo, 8 x 15 cm',
      [reference],
    );
    expect(s.slots.size).toEqual({ widthMm: 80, heightMm: 150 });
  });

  it('TASK-0034: a proposal is re-made when the zone changes and survives a panel save', async () => {
    const o = new OrchestratorAgent(offlineScout());
    const first = await o.handleUserInteraction(
      o.createSession(),
      'Un león de línea fina en el gemelo, solo negro',
      [reference],
    );
    expect(first.slots.size?.proposed).toBe(true);
    const moved = await o.handleUserInteraction(first, '', [], {
      placement: { bodyPart: 'upper_back', orientation: 'vertical' },
    });
    expect(moved.slots.size?.proposed).toBe(true);
    expect(moved.slots.size).not.toEqual(first.slots.size);
  });

  it('AC-003: values outside the contract are not adopted', async () => {
    const { architect } = fakeArchitect({
      extractedSlots: {
        subject: { elements: ['ok', 'x'.repeat(200), 42 as never] },
        style: { primary: 'cyberpunk' as never },
        linework: { weight: 'ultra' as never },
        shading: { technique: 'smooth_blend' },
        colour: { mode: 'rainbow' as never },
        placement: {
          bodyPart: 'elbow' as never,
          orientation: 'sideways' as never,
          side: 'up' as never,
        },
      },
    });
    const o = new OrchestratorAgent(offlineScout(), architect);

    const s = await o.handleUserInteraction(o.createSession(), 'Un zorro', [reference]);

    expect(s.slots.subject?.elements).toEqual(['ok']);
    expect(s.slots.style).toBeUndefined();
    expect(s.slots.colour).toBeUndefined();
    expect(s.slots.placement?.bodyPart).toBeUndefined();
    expect(s.slots.linework).toEqual({ weight: 'medium', notes: DEFAULT_LINEWORK_NOTE });
    expect(s.slots.shading).toEqual({ technique: 'none', intensity: 'light' });
    expect(s.questionsAsked).toBe(1);
  });

  it('AC-004: a failing architect gives exactly the deterministic result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: ConsultationProvider = {
      processTurn: vi.fn(async () => {
        throw new Error('network down');
      }),
    };
    const input = 'Un lobo en el gemelo derecho';
    const withFailure = new OrchestratorAgent(offlineScout(), failing);
    const deterministic = new OrchestratorAgent(offlineScout());

    const a = await withFailure.handleUserInteraction(withFailure.createSession(), input, [
      reference,
    ]);
    const b = await deterministic.handleUserInteraction(deterministic.createSession(), input, [
      reference,
    ]);

    expect(a.slots).toEqual(b.slots);
    expect(a.questionsAsked).toBe(b.questionsAsked);
    expect(a.phase).toBe(b.phase);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('lobo');
    warn.mockRestore();
  });

  it('AC-005: a genuine mimicry flag declines imitation; a placeholder does not', async () => {
    const flagged = fakeArchitect({
      extractedSlots: structuredClone(samurai) as never,
      mimicryDetected: {
        artistName: 'Nikko Hurtado',
        suggestedStyle: 'black_and_grey_realism',
        explanation: 'No imitamos artistas vivos.',
      },
    });
    const o = new OrchestratorAgent(offlineScout(), flagged.architect);
    const declined = await o.handleUserInteraction(
      o.createSession(),
      'Un retrato como los de ese artista',
      [reference],
    );
    expect(declined.phase).toBe('needs_details');
    expect(declined.brief).toBeUndefined();
    expect(declined.slots).toEqual({});
    expect(declined.messages.at(-1)?.content).toContain('imitación');

    const placeholder = fakeArchitect({
      extractedSlots: structuredClone(samurai) as never,
      mimicryDetected: { artistName: '  ', suggestedStyle: 'irezumi', explanation: '' },
    });
    const p = new OrchestratorAgent(offlineScout(), placeholder.architect);
    const accepted = await p.handleUserInteraction(
      p.createSession(),
      'Un guerrero samurái sobre olas',
      [reference],
    );
    expect(accepted.slots.style?.primary).toBe('irezumi');
  });

  it('AC-006: not called without text; turns alternate, start with the client, end with the input', async () => {
    const { architect, processTurn } = fakeArchitect({});
    const o = new OrchestratorAgent(offlineScout(), architect);

    const afterPanel = await o.handleUserInteraction(o.createSession(), '', [reference], {
      style: { primary: 'fine_line' },
    });
    expect(processTurn).not.toHaveBeenCalled();

    const first = await o.handleUserInteraction(afterPanel, 'Un león', [reference]);
    await o.handleUserInteraction(first, 'En el antebrazo izquierdo', [reference]);

    const turns = processTurn.mock.calls.at(-1)?.[0] ?? [];
    expect(turns[0]?.role).toBe('user');
    expect(turns.at(-1)?.role).toBe('user');
    expect(turns.at(-1)?.content.endsWith('En el antebrazo izquierdo')).toBe(true);
    for (let i = 1; i < turns.length; i++) expect(turns[i]?.role).not.toBe(turns[i - 1]?.role);
    expect(turns.every((t) => !t.referenceImages)).toBe(true);
  });
});

describe('images attached to the idea (TASK-0113, ADR-0039)', () => {
  it('AC-003: ride on the client message only, and become numbered references', async () => {
    const { architect, processTurn } = fakeArchitect({});
    const o = new OrchestratorAgent(offlineScout(), architect);
    const own = (n: number, source: string): ReferenceImage => ({
      assetId: `${n}`.repeat(32),
      source,
      mimeType: 'image/jpeg',
      verification: 'user_supplied',
      label: `Imagen ${n}`,
    });
    const kept = [own(1, '/api/media?id=1'), own(2, '/api/media?id=2')];
    const seen = [own(1, 'data:image/jpeg;base64,AA=='), own(2, 'data:image/jpeg;base64,AQ==')];

    const first = await o.handleUserInteraction(
      o.createSession(),
      'Como la imagen 1 pero con las rosas de la imagen 2',
      kept,
      undefined,
      false,
      seen,
    );
    const turns = processTurn.mock.calls.at(-1)?.[0] ?? [];
    expect(turns.at(-1)?.referenceImages).toEqual(seen);
    expect(turns.slice(0, -1).every((t) => !t.referenceImages)).toBe(true);
    expect(first.references.map((r) => [r.label, r.source])).toEqual([
      ['Imagen 1', '/api/media?id=1'],
      ['Imagen 2', '/api/media?id=2'],
    ]);
    // The session keeps where the image is, never its bytes.
    expect(JSON.stringify(first)).not.toContain('base64');

    await o.handleUserInteraction(first, 'En el antebrazo');
    expect((processTurn.mock.calls.at(-1)?.[0] ?? []).every((t) => !t.referenceImages)).toBe(true);
  });
});

describe('scout plan on the live route (TASK-0033 live finding)', () => {
  /** Commons answers each query with its own file, or nothing for the listed misses. */
  const commonsPerQuery = (misses: string[] = []) =>
    vi.fn(async (url: string | URL | Request) => {
      const query = new URL(String(url)).searchParams.get('gsrsearch') ?? '';
      if (misses.includes(query)) return Response.json({ query: { pages: {} } });
      const slug = encodeURIComponent(query.replace(/\s+/g, '_'));
      return Response.json({
        query: {
          pages: {
            one: {
              index: 1,
              title: `File:${query}.jpg`,
              imageinfo: [{ url: `https://upload.wikimedia.org/${slug}.jpg`, mime: 'image/jpeg' }],
            },
          },
        },
      });
    }) as unknown as typeof fetch;
  const planner = {
    plan: vi.fn(async () => [
      { query: 'samurai woodblock print', essential: false, label: 'un grabado de samurái' },
      { query: 'Great Wave Hokusai', essential: true, label: 'La gran ola de Hokusai' },
    ]),
  };
  const brief = 'Un león de línea fina en el antebrazo izquierdo, solo negro, 8 x 15 cm';

  it('judges missing references against the planned queries, not the client sentence', async () => {
    const o = new OrchestratorAgent(new VisualSearchAgent(commonsPerQuery(), { planner }));
    const s = await o.handleUserInteraction(o.createSession(), brief);

    expect(s.referencePlan).toEqual(['samurai woodblock print', 'Great Wave Hokusai']);
    expect(s.references).toHaveLength(2);
    expect(s.missingFields.filter((f) => f.startsWith('referencia'))).toEqual([]);
    expect(s.phase).toBe('ready_to_generate');
  });

  it('reports a planned query that found nothing in its planned wording', async () => {
    const o = new OrchestratorAgent(
      new VisualSearchAgent(commonsPerQuery(['Great Wave Hokusai']), { planner }),
    );
    const s = await o.handleUserInteraction(o.createSession(), brief);

    // TASK-0034: an essential miss is named in Spanish, by its label.
    expect(s.missingFields).toContain('referencia: La gran ola de Hokusai');
    expect(s.messages.at(-1)?.content).toContain('La gran ola de Hokusai');
    expect(s.missingFields.some((f) => f.includes(brief))).toBe(false);
    expect(s.phase).toBe('needs_details');
  });

  it('lets the client go on without it once they choose to (TASK-0067)', async () => {
    const o = new OrchestratorAgent(
      new VisualSearchAgent(commonsPerQuery(['Great Wave Hokusai']), { planner }),
    );
    const blocked = await o.handleUserInteraction(o.createSession(), brief);
    expect(blocked.phase).toBe('needs_details');

    const waived = await o.handleUserInteraction({ ...blocked, waivedReferences: true }, '');
    expect(waived.missingFields.filter((f) => f.startsWith('referencia'))).toEqual([]);
    expect(waived.phase).toBe('ready_to_generate');
    // The plan still knows what was essential; only the block is lifted.
    expect(waived.essentialReferences).toEqual(['Great Wave Hokusai']);
  });
});

describe('relevant references (TASK-0034)', () => {
  /** Commons returns three files per query; image URLs answer with a tiny JPEG. */
  const commonsThree = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes('commons.wikimedia.org')) {
      const query = new URL(href).searchParams.get('gsrsearch') ?? '';
      const slug = query.replace(/\W+/g, '_');
      return Response.json({
        query: {
          pages: Object.fromEntries(
            ['unrelated logo', 'right thing', 'another unrelated'].map((title, index) => [
              title,
              {
                index: index + 1,
                title: `File:${title}.jpg`,
                imageinfo: [
                  {
                    url: `https://upload.wikimedia.org/${slug}_${index}.jpg`,
                    mime: 'image/jpeg',
                  },
                ],
              },
            ]),
          ),
        },
      });
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      headers: { 'content-type': 'image/jpeg' },
    });
  }) as unknown as typeof fetch;
  const planner = {
    plan: vi.fn(async () => [{ query: 'howling wolf', essential: false, label: 'un lobo' }]),
  };

  it('keeps only the candidate the judge recognises', async () => {
    const choose = vi.fn(async (_subject: string, candidates: { title: string; data: string }[]) =>
      candidates.flatMap((c, i) => (c.title.includes('right thing') ? [i] : [])),
    );
    const result = await new VisualSearchAgent(commonsThree, {
      planner,
      judge: { choose },
    }).scoutReferenceImages({ userInput: 'Un lobo aullando' });

    expect(choose).toHaveBeenCalledOnce();
    expect(choose.mock.calls[0]?.[1]).toHaveLength(3);
    expect(choose.mock.calls[0]?.[1][0]?.data).toBe(
      Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    );
    expect(result.scoutedImages.map((r) => r.label)).toEqual(['File:right thing.jpg']);
  });

  it('keeps nothing unverified when the judge fails, and says so', async () => {
    const result = await new VisualSearchAgent(commonsThree, {
      planner,
      judge: {
        choose: vi.fn(async () => {
          throw new Error('down');
        }),
      },
    }).scoutReferenceImages({ userInput: 'Un lobo aullando' });
    expect(result.scoutedImages).toEqual([]);
    expect(result.reportMessage).toContain('no he podido comprobar');
  });

  it('a generic motif the judge rejects does not block generation (TASK-0058)', async () => {
    const o = new OrchestratorAgent(
      new VisualSearchAgent(commonsThree, { planner, judge: { choose: vi.fn(async () => []) } }),
    );
    const s = await o.handleUserInteraction(
      o.createSession(),
      'Un lobo aullando de línea fina en el antebrazo izquierdo, solo negro, 8 x 15 cm',
    );
    // Nothing found and nothing essential missing. TASK-0058 (ADR-0026): a generic idea is drawn
    // from the brief, so nothing blocks it; the scout says an upload is still welcome.
    expect(s.missingFields).toEqual([]);
    expect(s.phase).toBe('ready_to_generate');
    expect(s.references).toEqual([]);
    expect(s.messages.map((m) => m.content).join(' ')).toContain('a partir de tu descripción');
    expect(s.messages.at(-1)?.content).toContain('Propuesta lista');
  });

  it('forgets a catalogue pick once the style moves away from it (TASK-0038)', async () => {
    const o = new OrchestratorAgent(
      new VisualSearchAgent(commonsThree, { planner, judge: { choose: vi.fn(async () => []) } }),
    );
    const s = await o.handleUserInteraction(
      o.createSession(),
      'Un lobo aullando de línea fina en el antebrazo izquierdo, solo negro, 8 x 15 cm',
    );
    s.stylePick = { id: 'tribal:maori', style: 'tribal', label: 'Tribal · Maorí' };
    const kept = await o.handleUserInteraction(s, '', [], { style: { primary: 'tribal' } });
    expect(kept.stylePick?.id).toBe('tribal:maori');
    const moved = await o.handleUserInteraction(kept, '', [], { style: { primary: 'blackwork' } });
    expect(moved.stylePick).toBeUndefined();
  });
});

describe('architect helpers (TASK-0033)', () => {
  it('conversationTurns drops a leading studio message and joins adjacent ones', () => {
    const at = '2026-09-26T00:00:00.000Z';
    const msg = (senderLabel: string, content: string): MultiAgentMessage => ({
      sender: 'orchestrator',
      senderLabel,
      content,
      timestamp: at,
    });
    const turns = conversationTurns(
      [
        msg('Asistente de diseño', 'hola'),
        msg('Cliente', 'un león'),
        msg('Asistente de diseño', '¿zona?'),
        msg('Referencias', 'he buscado'),
        msg('Cliente', 'antebrazo'),
      ],
      'antebrazo',
    );
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect(turns[1]?.content).toBe('¿zona?\nhe buscado');
  });

  it('only adopts zones the client panel can show (live: Opus proposed thigh_outer)', () => {
    expect(sanitizeArchitectSlots({ placement: { bodyPart: 'thigh_outer' } })).toEqual({});
    expect(sanitizeArchitectSlots({ placement: { bodyPart: 'thigh_front' } })).toEqual({
      placement: { bodyPart: 'thigh_front' },
    });
  });

  it('sanitizeArchitectSlots never reads a size and keeps palettes off black and grey', () => {
    const slots = sanitizeArchitectSlots({
      size: { widthMm: 100, heightMm: 100 },
      colour: { mode: 'black_and_grey', palette: ['rojo'] },
    });
    expect(slots).toEqual({ colour: { mode: 'black_and_grey' } });
    expect(sanitizeArchitectSlots(null)).toEqual({});
  });
});

describe('body sex (TASK-0041)', () => {
  it('takes the architect proposal but lets the client override it, unlike side', async () => {
    const { architect } = fakeArchitect({
      extractedSlots: { placement: { bodyType: 'feminine', side: 'left' } },
    });
    const o = new OrchestratorAgent(offlineScout(), architect);
    // The client said nothing about sex, so the architect's proposal stands; side never does.
    const proposed = await o.handleUserInteraction(
      o.createSession(),
      'Un lobo en el gemelo derecho, solo negro',
      [reference],
    );
    expect(proposed.slots.placement?.bodyType).toBe('feminine');
    expect(proposed.slots.placement?.side).toBe('right');

    // The client stating it, with the architect silent on sex, keeps the client's word. (When the
    // architect does answer, TASK-0039's reread lets its reading win, like style and colour.)
    const { architect: a2 } = fakeArchitect({ extractedSlots: { linework: { weight: 'bold' } } });
    const stated = await new OrchestratorAgent(offlineScout(), a2).handleUserInteraction(
      new OrchestratorAgent().createSession(),
      'Un lobo en el gemelo de un hombre, solo negro',
      [reference],
    );
    expect(stated.slots.placement?.bodyType).toBe('masculine');
  });

  it('sanitizes an unknown body sex to nothing', () => {
    expect(sanitizeArchitectSlots({ placement: { bodyType: 'other' } }).placement).toBeUndefined();
    expect(
      sanitizeArchitectSlots({ placement: { bodyType: 'feminine' } }).placement?.bodyType,
    ).toBe('feminine');
  });
});

describe('the professional description (TASK-0065, ADR-0029)', () => {
  const refined =
    'Murciélago de frente con las alas abiertas, placas y pistones bajo la piel, encuadre vertical.';

  it('is drafted by the architect, kept beside the client words and bounded', async () => {
    expect(sanitizeArchitectSlots({ subject: { refined: 'x'.repeat(1201) } }).subject).toBe(
      undefined,
    );
    const { architect } = fakeArchitect({
      extractedSlots: { ...structuredClone(samurai), subject: { refined } } as never,
    });
    const o = new OrchestratorAgent(offlineScout(), architect);
    const s = await o.handleUserInteraction(
      o.createSession(),
      'Un murciélago biomecánico en el muslo derecho de un hombre, solo negro',
    );
    expect(s.slots.subject?.description).toBe(
      'Un murciélago biomecánico en el muslo derecho de un hombre, solo negro',
    );
    expect(s.slots.subject?.refined).toBe(refined);
    // It travels in the brief the worker receives.
    expect(s.brief?.subject).toMatchObject({ refined });
  });

  it("the client's edit wins over a later draft", async () => {
    const { architect } = fakeArchitect({
      extractedSlots: { ...structuredClone(samurai), subject: { refined } } as never,
    });
    const o = new OrchestratorAgent(offlineScout(), architect);
    let s = await o.handleUserInteraction(o.createSession(), 'Un murciélago en el muslo');
    const edited = 'Murciélago de perfil, alas plegadas, sin pistones.';
    s = await o.handleUserInteraction(s, '', [], {
      subject: { ...s.slots.subject, refined: edited },
    });
    expect(s.slots.subject?.refined).toBe(edited);
    // A later message refines the same idea; the client's wording of it stays.
    s = await o.handleUserInteraction(s, 'que sea más grande');
    expect(s.slots.subject?.refined).toBe(edited);
  });
});
