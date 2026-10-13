import type { ReferenceImage } from '../types';

/**
 * Specific entities whose searches were verified against Commons (TASK-0020, TASK-0098). They match
 * the Spanish and Valencian names and the common slip "Valencia CG", since a live request asking for
 * "la virgen de los desamparados" and "el escudo del valencia CG" found neither.
 */
export function curatedQueries(subject: string): string[] {
  const queries: string[] = [];
  if (/mare de d[eé]u|desampara(?:ts|dos)|geperudeta/i.test(subject))
    queries.push('"Estàtua de la mare de Déu dels Desemparats" -darrere');
  if (/senyera valenciana|real senyera|senyera/i.test(subject))
    queries.push('"Flag of the Valencian Community" -simplified');
  if (
    /valencia\s*c\.?\s*[fg]\.?(?![a-z])|\bvcf\b|valencia club de f[uú]tbol|escudo del valencia/i.test(
      subject,
    )
  )
    queries.push('Valencia CF crest');
  if (/mestalla/i.test(subject)) queries.push('Mestalla stadium');
  return queries;
}

/** The curated queries, or the client's own words when none applies (the deterministic plan). */
export function referenceQueries(subject: string): string[] {
  const queries = curatedQueries(subject);
  return queries.length ? queries : [subject.slice(0, 180)];
}
const plain = (value: unknown) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, 500) : '';

/** Spanish labels for the curated entity queries, for messages to the client (TASK-0034). */
const CURATED_LABELS: Record<string, string> = {
  '"Estàtua de la mare de Déu dels Desemparats" -darrere':
    'la imagen de la Mare de Déu dels Desamparats',
  '"Flag of the Valencian Community" -simplified': 'la Senyera valenciana',
  'Valencia CF crest': 'el escudo del Valencia CF',
  'Mestalla stadium': 'el estadio de Mestalla',
};

/**
 * How the studio identifies itself to image sources (TASK-0100). Wikimedia's robot policy
 * (https://w.wiki/4wJS) refuses clients without a contact; a download without one answered 403.
 */
export const REFERENCE_USER_AGENT =
  'InkCraft/0.1 (https://inkcraft.aurevanta.es; reference research)';

/** The Valencia CF crest fetched from the club's own site: verified by source, not by a judge. */
const OFFICIAL_VALENCIA_CREST = 'https://www.valenciacf.com/svg/escudo.svg';

/**
 * One search the scout will run (TASK-0034). `essential` marks a specific real-world entity whose
 * exact look matters — a named emblem, flag, landmark, statue, artwork or logo. Only a missing
 * essential reference blocks generation; a generic motif can be drawn without one.
 */
export interface PlannedQuery {
  query: string;
  essential: boolean;
  /** Spanish name of what the image should show, for messages to the client. */
  label?: string | undefined;
}

/** Decides the search queries for a subject. Claude Sonnet 5 in production (ADR-0015). */
export interface ScoutQueryPlanner {
  plan(subject: string): Promise<PlannedQuery[]>;
}

/** One candidate image, as the relevance judge sees it. */
export interface JudgeCandidate {
  query: string;
  title: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Base64 image bytes, downloaded by the scout so the judge never fetches a URL itself. */
  data: string;
}

/**
 * Looks at the candidates and returns the indices of those that actually depict what the client
 * asked for (TASK-0034). Without one, the scout keeps the first hit per query, which a live survey
 * showed is often unrelated ("Red Moon logo" for a howling wolf).
 */
export interface ReferenceJudge {
  choose(subject: string, candidates: JudgeCandidate[]): Promise<number[]>;
}

/** Bounded open-web image search, used only when licensed sources return nothing (REQ-005). */
export interface OpenWebImageSearch {
  search(query: string): Promise<ReferenceImage[]>;
}

/** Safety screen for scouted candidates: true keeps it, false rejects it (e.g. a real person). */
export interface CandidateScreen {
  screen(image: ReferenceImage): Promise<boolean>;
}

export interface ScoutOptions {
  planner?: ScoutQueryPlanner;
  judge?: ReferenceJudge;
  openWeb?: OpenWebImageSearch;
  screen?: CandidateScreen;
}

export interface ScoutResult {
  scoutedImages: ReferenceImage[];
  reportMessage: string;
  /** Every query searched, in plan order. */
  queries: string[];
  /** The subset whose absence blocks generation. */
  essential: string[];
  /** Spanish label per query, for messages. */
  labels: Record<string, string>;
}

const FOUND =
  'He localizado referencias con su fuente de procedencia. Revisa que representan los elementos que has pedido; la selección automática no certifica su exactitud.';
const NONE =
  'No he encontrado una referencia adecuada en Wikimedia Commons ni en Openverse. Puedes adjuntar una imagen tuya; si tu idea no depende de un elemento concreto, el diseño se hará a partir de tu descripción.';
const UNCHECKED =
  'He encontrado imágenes, pero no he podido comprobar que correspondan a tu idea, así que no las he añadido. Puedes adjuntar una imagen tuya; si tu idea no depende de un elemento concreto, el diseño se hará a partir de tu descripción.';

/**
 * Openverse thumbnails (TASK-0058, ADR-0026). Only this exact shape is taken from Openverse: one
 * host, no query, the image's own UUID. It is also what the web tier accepts to download.
 */
const OPENVERSE_THUMBNAIL =
  /^https:\/\/api\.openverse\.org\/v1\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/thumb\/$/;

export function isOpenverseThumbnail(source: string): boolean {
  return OPENVERSE_THUMBNAIL.test(source);
}

/** "by-nc" 4.0 → "CC BY-NC 4.0"; public domain marks spelled out. */
function openverseLicence(item: Record<string, unknown>): string {
  const code = typeof item['license'] === 'string' ? item['license'].toLowerCase() : '';
  const version = typeof item['license_version'] === 'string' ? ` ${item['license_version']}` : '';
  if (code === 'cc0') return 'CC0 1.0';
  if (code === 'pdm') return 'Dominio público';
  return code ? `CC ${code.toUpperCase()}${version}`.slice(0, 40) : 'Licencia abierta';
}

/** Candidates the judge sees per query, the most it may keep overall, and the most searches. */
const CANDIDATES_PER_QUERY = 3;
const MAX_REFERENCES = 5;
const MAX_QUERIES = MAX_REFERENCES;

function curatedPlan(query: string): PlannedQuery {
  return { query, essential: true, label: CURATED_LABELS[query] };
}

/**
 * The curated query a planned one stands for, when exactly one does: its Spanish label is read
 * first ("el escudo del Valencia CF"), then the query itself.
 */
function curatedEntity(item: PlannedQuery): string | undefined {
  for (const text of [item.label ?? '', item.query]) {
    const found = curatedQueries(text);
    if (found.length === 1) return found[0];
    if (found.length > 1) return undefined;
  }
  return undefined;
}
const JUDGE_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export class VisualSearchAgent {
  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly options: ScoutOptions = {},
  ) {}

  /**
   * The queries to search (TASK-0098). Curated queries name specific entities and were verified
   * against Commons (TASK-0020): they always run. The planner adds every other thing the client
   * named — a request for four elements once searched only the one the curated list knew — and a
   * planned query that names a curated entity is replaced by the verified one. Without a planner,
   * or when it fails, the curated queries stand alone, else the client's own words, not essential.
   */
  private async plannedQueries(subject: string): Promise<PlannedQuery[]> {
    const curated = curatedQueries(subject).map(curatedPlan);
    const fallback = (): PlannedQuery[] =>
      curated.length ? curated : [{ query: subject.slice(0, 180), essential: false }];
    if (!this.options.planner) return fallback();
    let planned: PlannedQuery[];
    try {
      planned = await this.options.planner.plan(subject);
    } catch {
      // A planner failure must never block the search: fall back to the deterministic queries.
      return fallback();
    }
    const plan = [...curated];
    for (const item of planned) {
      const known = curatedEntity(item);
      const next = known ? curatedPlan(known) : item;
      if (!plan.some((p) => p.query === next.query)) plan.push(next);
    }
    return plan.length ? plan.slice(0, MAX_QUERIES) : fallback();
  }

  /** Screen a candidate before it can become a reference. Fails closed (SAFETY-INV-007 spirit). */
  private async screened(image: ReferenceImage): Promise<ReferenceImage | undefined> {
    if (!this.options.screen) return image;
    try {
      return (await this.options.screen.screen(image)) ? image : undefined;
    } catch {
      return undefined;
    }
  }

  async scoutReferenceImages(params: {
    userInput: string;
    userUploadedImages?: ReferenceImage[];
    queries?: string[];
  }): Promise<ScoutResult> {
    if (params.userUploadedImages?.length)
      return {
        scoutedImages: [],
        queries: [],
        essential: [],
        labels: {},
        reportMessage:
          'Se usarán tus referencias. Su contenido se analizará durante la preparación del diseño.',
      };
    const plan: PlannedQuery[] = params.queries
      ? params.queries.map((query) => ({ query, essential: true }))
      : await this.plannedQueries(params.userInput);
    const queries = plan.map((p) => p.query);
    const result = (images: ReferenceImage[], message: string): ScoutResult => ({
      scoutedImages: images,
      queries,
      essential: plan.filter((p) => p.essential).map((p) => p.query),
      labels: Object.fromEntries(plan.map((p) => [p.query, p.label ?? p.query])),
      reportMessage: message,
    });

    if (this.options.judge) {
      const judged = await this.judgedImages(params.userInput, queries);
      if (!judged) return result([], UNCHECKED);
      const images = [...judged];
      // TASK-0068 (ADR-0030): the open web only for an essential reference the licensed sources
      // lacked — a named logo, crest or flag — and its candidates face the same judge.
      const essential = new Set(plan.filter((p) => p.essential).map((p) => p.query));
      const lacking = queries.filter(
        (query) => essential.has(query) && !images.some((image) => image.referenceQuery === query),
      );
      if (lacking.length && this.options.openWeb && images.length < MAX_REFERENCES) {
        const web = await this.judgedWebImages(params.userInput, lacking);
        images.push(...web.slice(0, MAX_REFERENCES - images.length));
      }
      return result(images, images.length ? FOUND : NONE);
    }

    const images: ReferenceImage[] = [];
    for (const query of queries) {
      const found = (await this.candidates(query, 1))[0];
      // Every candidate is screened before it can become a reference (REQ-005).
      const kept =
        (found ? await this.screened(found) : undefined) ?? (await this.openWebFallback(query));
      if (kept) images.push(kept);
    }
    return result(images, images.length ? FOUND : NONE);
  }

  /**
   * Gather candidates for every query, let the judge look at them, and keep at most one accepted
   * image per query. Returns `undefined` when the judge could not decide: nothing unverified is
   * kept, because an unrelated reference would steer the design itself.
   */
  private async judgedImages(
    subject: string,
    queries: string[],
  ): Promise<ReferenceImage[] | undefined> {
    const pools = await Promise.all(queries.map((q) => this.candidates(q, CANDIDATES_PER_QUERY)));
    // An official source is verified by where it came from; the judge sees the rest.
    const trusted = pools.flat().filter((image) => image.source === OFFICIAL_VALENCIA_CREST);
    const pool = pools.flat().filter((image) => !trusted.includes(image));
    const accepted: ReferenceImage[] = [];
    for (const image of trusted) {
      const screened = await this.screened(image);
      if (screened) accepted.push(screened);
    }
    return this.judge(subject, pool, accepted);
  }

  /** Open-web candidates for essential queries, judged like licensed ones (TASK-0068). */
  private async judgedWebImages(subject: string, queries: string[]): Promise<ReferenceImage[]> {
    const pools = await Promise.all(
      queries.map(async (query) => {
        try {
          const found = await this.options.openWeb!.search(query);
          return found
            .slice(0, CANDIDATES_PER_QUERY)
            .map((image) => ({ ...image, referenceQuery: query }));
        } catch {
          // The web search is a last resort; its failure leaves the client to add the image.
          return [];
        }
      }),
    );
    return (await this.judge(subject, pools.flat(), [])) ?? [];
  }

  /**
   * Show the pool to the judge and keep at most one accepted image per query, after `accepted`.
   * `undefined` when the judge could not decide and nothing was accepted beforehand.
   */
  private async judge(
    subject: string,
    pool: ReferenceImage[],
    accepted: ReferenceImage[],
  ): Promise<ReferenceImage[] | undefined> {
    if (!pool.length) return accepted;
    const downloaded = await Promise.all(pool.map((image) => this.thumbnail(image)));
    const shown = pool
      .map((image, index) => ({ image, bytes: downloaded[index] }))
      .filter((c): c is { image: ReferenceImage; bytes: Omit<JudgeCandidate, 'query' | 'title'> } =>
        Boolean(c.bytes),
      );
    if (!shown.length) return accepted;
    let chosen: number[];
    try {
      chosen = await this.options.judge!.choose(
        subject,
        shown.map(({ image, bytes }) => ({
          query: image.referenceQuery ?? '',
          title: image.label ?? '',
          ...bytes,
        })),
      );
    } catch {
      // Verified official sources still stand; nothing the judge was meant to check is kept.
      return accepted.length ? accepted : undefined;
    }
    const kept: ReferenceImage[] = [...accepted];
    for (const index of chosen) {
      const image = shown[index]?.image;
      if (!image || kept.some((k) => k.referenceQuery === image.referenceQuery)) continue;
      const screened = await this.screened(image);
      if (screened) kept.push(screened);
      if (kept.length >= MAX_REFERENCES) break;
    }
    return kept;
  }

  /** Download a candidate's thumbnail for the judge; skip anything unusable. */
  private async thumbnail(
    image: ReferenceImage,
  ): Promise<Omit<JudgeCandidate, 'query' | 'title'> | undefined> {
    try {
      const response = await this.request(image.source, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': REFERENCE_USER_AGENT },
      });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!response.ok || !(JUDGE_MEDIA as readonly string[]).includes(type)) return undefined;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 4_000_000) return undefined;
      return { mediaType: type as JudgeCandidate['mediaType'], data: bytes.toString('base64') };
    } catch {
      return undefined;
    }
  }

  private async openWebFallback(query: string): Promise<ReferenceImage | undefined> {
    // Licensed sources first; the open web is a bounded fallback only when they yield nothing.
    if (!this.options.openWeb) return undefined;
    try {
      for (const candidate of await this.options.openWeb.search(query)) {
        const kept = await this.screened(candidate);
        if (kept) return kept;
      }
    } catch {
      // The fallback is best-effort; its failure must not discard earlier references.
    }
    return undefined;
  }

  /**
   * Licensed candidates for one query, best first: Wikimedia Commons, then Openverse (TASK-0058).
   * With a judge (`limit` > 1) both sources are offered, since Commons answers a generic style with
   * scientific figures; without one, Openverse is consulted only when Commons has nothing.
   */
  private async candidates(query: string, limit: number): Promise<ReferenceImage[]> {
    if (query === 'Valencia CF crest') {
      const official = await this.valenciaCrest(query);
      if (official) return [official];
    }
    const alternatives =
      query === 'Valencia CF crest'
        ? ['"Valencia CF" (logo OR crest OR escudo)', '"Valencia" "escudo"']
        : [query];
    const found: ReferenceImage[] = [];
    for (const search of alternatives) {
      try {
        const hits = await this.commons(search, query, limit);
        if (hits.length) {
          found.push(...hits);
          break;
        }
      } catch {
        // A failed entity/source must not discard references already found.
      }
    }
    if (limit > 1 || !found.length) {
      try {
        found.push(...(await this.openverse(query, limit)));
      } catch {
        // Openverse is a second source; its failure leaves Commons' answer standing.
      }
    }
    return found;
  }

  /**
   * Openverse: openly licensed images, restricted to licences that allow derivative works, since a
   * reference shapes a new design. Mature results are excluded. Only the Openverse-hosted
   * thumbnail is used, so every download goes to one known host.
   */
  private async openverse(query: string, limit: number): Promise<ReferenceImage[]> {
    const url = new URL('https://api.openverse.org/v1/images/');
    url.search = new URLSearchParams({
      q: query,
      page_size: '10',
      license_type: 'modification',
      mature: 'false',
    }).toString();
    const response = await this.request(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': REFERENCE_USER_AGENT },
    });
    if (!response.ok) throw new Error('Openverse no está disponible.');
    const data = (await response.json()) as { results?: unknown };
    const results = Array.isArray(data.results) ? data.results : [];
    const found: ReferenceImage[] = [];
    for (const item of results as Array<Record<string, unknown>>) {
      if (found.length >= limit) break;
      const source = typeof item['thumbnail'] === 'string' ? item['thumbnail'] : '';
      if (!isOpenverseThumbnail(source)) continue;
      const landing =
        typeof item['foreign_landing_url'] === 'string' ? item['foreign_landing_url'] : '';
      const creator = plain(item['creator']);
      found.push({
        source,
        referenceQuery: query,
        mimeType: 'image/jpeg',
        label: plain(item['title']) || 'Imagen de Openverse',
        sourcePage: landing.startsWith('https://') ? landing : 'https://openverse.org',
        license: `${openverseLicence(item)}${creator ? ` · ${creator.slice(0, 60)}` : ''}`,
        retrievedAt: new Date().toISOString(),
        verification: 'candidate',
      });
    }
    return found;
  }

  private async valenciaCrest(query: string): Promise<ReferenceImage | undefined> {
    // Official navigation crest, verified on /es/club/escudos. Check it live, never fake success.
    const source = OFFICIAL_VALENCIA_CREST;
    try {
      const response = await this.request(source, {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('image/svg+xml')) return;
      return {
        source,
        referenceQuery: query,
        mimeType: 'image/png', // BFF rasterizes this exact SVG.
        label: 'Escudo Valencia CF · web oficial',
        sourcePage: 'https://www.valenciacf.com/es/club/escudos',
        license: 'Derechos del Valencia CF',
        retrievedAt: new Date().toISOString(),
        verification: 'candidate',
      };
    } catch {
      return;
    }
  }

  private async commons(search: string, query: string, limit: number): Promise<ReferenceImage[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: search,
      gsrnamespace: '6',
      gsrlimit: limit > 1 ? '10' : '5',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '1200',
      origin: '*',
    }).toString();
    const response = await this.request(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': REFERENCE_USER_AGENT },
    });
    if (!response.ok)
      throw new Error(
        'La búsqueda de referencias no está disponible. Adjunta una referencia o inténtalo de nuevo.',
      );
    const data = await response.json();
    const pages = Object.values(data.query?.pages ?? {}) as Array<{
      title?: string;
      index?: number;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        mime?: string;
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: string }>;
      }>;
    }>;
    const found: ReferenceImage[] = [];
    for (const page of pages.sort((a, b) => (a.index ?? 999) - (b.index ?? 999))) {
      if (found.length >= limit) break;
      if (
        query === 'Valencia CF crest' &&
        !/valencia.*(?:crest|logo|escudo)|(?:crest|logo|escudo).*valencia/i.test(page.title ?? '')
      )
        continue;
      const info = page.imageinfo?.[0];
      const source = info?.thumburl ?? info?.url;
      if (!source) continue;
      const imageUrl = new URL(source);
      if (
        imageUrl.protocol !== 'https:' ||
        !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(imageUrl.hostname)
      )
        continue;
      imageUrl.search = '';
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(info?.mime ?? ''))
        continue;
      // SVG thumbnails are rasterized by Wikimedia, never run supplied SVG code.
      if (info?.mime === 'image/svg+xml' && !info.thumburl) continue;
      found.push({
        source: imageUrl.toString(),
        referenceQuery: query,
        mimeType: info?.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        label: plain(page.title),
        sourcePage: info?.descriptionurl ?? 'https://commons.wikimedia.org',
        license: plain(info?.extmetadata?.['LicenseShortName']?.value),
        retrievedAt: new Date().toISOString(),
        verification: 'candidate',
      });
    }
    return found;
  }
}
