import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { NextResponse } from 'next/server';
import {
  ClaudeConsultationProvider,
  ClaudeReferenceJudge,
  ClaudeScoutQueryPlanner,
  OpenAIAstraProvider,
  OrchestratorAgent,
  VisualSearchAgent,
  type ConsultationProvider,
  type OrchestrationSession,
  isOpenverseThumbnail,
  isBraveThumbnail,
  BraveImageSearch,
  ContentRefusedError,
  OpenAITextModeration,
  REFERENCE_USER_AGENT,
  type TextScreen,
} from '@tattoo/consultation';
import { validateAgainst, type StudioJobStatus } from '@tattoo/contracts';
import { CONSENT_REQUIRED, hasConsent } from './consent';

import {
  authConfigured,
  authenticate,
  setAuthCookies,
  type Account,
  type Authenticated,
  type Tokens,
} from './auth';
import { GENERIC_FAILURE } from './client-errors';

interface Session {
  /**
   * The account that started this consultation (TASK-0049). The consultation lives in the browser,
   * so without this a second person signing in on the same browser would be handed the first
   * person's conversation.
   */
  owner?: string;
  state: OrchestrationSession;
  touched: number;
  busy: boolean;
  bodyPhotoId?: string;
  jobId?: string;
  /** Signature of the brief the client accepted (TASK-0037). Stale as soon as the brief moves. */
  acceptedBrief?: string;
  /** Tokens renewed while identifying the caller, to be re-issued with the next reply (TASK-0045). */
  renewedAuth?: Tokens;
}
const root = globalThis as typeof globalThis & { inkcraftSessions?: Map<string, Session> };
const sessions = (root.inkcraftSessions ??= new Map<string, Session>());

export interface LiveAgentConfig {
  architect: 'claude' | 'openai' | undefined;
  scoutPlanner: boolean;
  /** TASK-0068: Brave image search for essential references, when opted in with a key. */
  webImageSearch: 'brave' | undefined;
  /** TASK-0070: OpenAI's free text moderation on the client's words, with the live agents. */
  textModeration: 'openai' | undefined;
}

/**
 * Which model-backed agents the live consultation uses (TASK-0033). Opt-in only: a credential in
 * the environment enables nothing by itself, so a developer's key cannot make the test suite call a
 * paid API, and `fixture` (canned replies) is never used on the live route.
 */
export function liveAgentConfig(
  env: Record<string, string | undefined> = process.env,
): LiveAgentConfig {
  const backend = env['TATTOO_CONSULTATION_BACKEND'];
  return {
    architect: backend === 'claude' || backend === 'openai' ? backend : undefined,
    scoutPlanner: env['TATTOO_SCOUT_PLANNER'] === 'claude',
    // Opt-in and judged: it needs the Claude judge, the switch and the key.
    webImageSearch:
      env['TATTOO_SCOUT_PLANNER'] === 'claude' &&
      env['TATTOO_WEB_IMAGE_SEARCH'] === 'brave' &&
      Boolean(env['BRAVE_SEARCH_API_KEY'])
        ? 'brave'
        : undefined,
    // With a live architect only, so a developer's key alone still calls nothing in tests.
    textModeration:
      (backend === 'claude' || backend === 'openai') && Boolean(env['OPENAI_API_KEY'])
        ? 'openai'
        : undefined,
  };
}

/** The check on the client's words (TASK-0070), or none. */
export function buildTextScreen(
  env: Record<string, string | undefined> = process.env,
): TextScreen | undefined {
  return liveAgentConfig(env).textModeration === 'openai'
    ? new OpenAITextModeration(env['OPENAI_API_KEY']!)
    : undefined;
}

export const textScreen = buildTextScreen();

/** Refuses sexually explicit text with the studio's message (TASK-0070). */
export async function screenText(text: string | undefined): Promise<void> {
  if (text?.trim() && (await textScreen?.refuses(text))) throw new ContentRefusedError();
}

export function buildOrchestrator(
  env: Record<string, string | undefined> = process.env,
): OrchestratorAgent {
  const config = liveAgentConfig(env);
  const architect: ConsultationProvider | undefined =
    config.architect === 'claude'
      ? new ClaudeConsultationProvider()
      : config.architect === 'openai'
        ? new OpenAIAstraProvider()
        : undefined;
  // TASK-0034: the Sonnet scout plans the searches and checks the images it found.
  const scout = new VisualSearchAgent(
    undefined,
    config.scoutPlanner
      ? {
          planner: new ClaudeScoutQueryPlanner(),
          judge: new ClaudeReferenceJudge(),
          ...(config.webImageSearch === 'brave'
            ? { openWeb: new BraveImageSearch(env['BRAVE_SEARCH_API_KEY']!) }
            : {}),
        }
      : {},
  );
  return new OrchestratorAgent(scout, architect, buildTextScreen(env));
}

export const orchestrator = buildOrchestrator();
/**
 * TASK-0072: the client never reads "worker", a status or a setup instruction. The worker's own
 * refusals are already worded for the client (`jobs/client_messages.py`).
 */
export const STUDIO_UNAVAILABLE =
  'El estudio no está disponible en este momento. Inténtalo de nuevo en unos minutos.';

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function jobStatus(response: Response): Promise<StudioJobStatus> {
  const result = validateAgainst<StudioJobStatus>('studio-status', await response.json());
  if (!result.valid) throw new RequestError(STUDIO_UNAVAILABLE, 502);
  return result.value;
}
function consultationCookie(request: Request): string | undefined {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('inkcraft='))
    ?.slice(9);
}

/**
 * The consultation in progress in this browser.
 *
 * `owner` is the signed-in account (TASK-0049). A consultation started by a different account is
 * treated as absent — never handed over — so the next person on a shared browser starts clean.
 */
export function session(request: Request, create = false, owner?: string): Session {
  const cookie = consultationCookie(request);
  for (const [id, value] of sessions)
    if (Date.now() - value.touched > 86400000) sessions.delete(id);
  const found = cookie ? sessions.get(cookie) : undefined;
  const current = found && (!owner || !found.owner || found.owner === owner) ? found : undefined;
  if (current) {
    current.touched = Date.now();
    if (owner && !current.owner) current.owner = owner;
    return current;
  }
  if (!create) throw new RequestError('La sesión ha caducado. Inicia una nueva consulta.', 401);
  if (sessions.size >= 1000) throw new RequestError('El servicio está ocupado.', 503);
  const fresh: Session = {
    ...(owner ? { owner } : {}),
    state: orchestrator.createSession(randomUUID()),
    touched: Date.now(),
    busy: false,
  };
  sessions.set(fresh.state.sessionId, fresh);
  return fresh;
}

/** Forget this browser's consultation, if it has one (sign-out, TASK-0049). */
export function forgetConsultation(request: Request): void {
  const cookie = consultationCookie(request);
  if (cookie) sessions.delete(cookie);
}

/**
 * TASK-0079 (audit ARQ-01): the consultation is kept by the worker as well as in memory, so a web
 * restart or a second replica does not lose it, nor the generation it is following. Memory is the
 * cache; the worker is what survives. Both directions are best effort: a worker that cannot be
 * reached leaves the consultation working from memory, as before.
 */
const CONSULTATION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function kept(current: Session): Record<string, unknown> {
  return {
    state: current.state,
    ...(current.bodyPhotoId ? { bodyPhotoId: current.bodyPhotoId } : {}),
    ...(current.jobId ? { jobId: current.jobId } : {}),
    ...(current.acceptedBrief ? { acceptedBrief: current.acceptedBrief } : {}),
  };
}

export async function persistConsultation(current: Session): Promise<void> {
  if (!current.owner || !process.env['TATTOO_WORKER_TOKEN']) return;
  try {
    await worker(current.owner, `/consultations/${current.state.sessionId}`, 'PUT', {
      data: kept(current),
    });
  } catch {
    console.warn('Consultation not persisted; it stays in this replica only.');
  }
}

/** Bring this browser's consultation back from the worker when this replica does not hold it. */
export async function restoreConsultation(request: Request, owner: string): Promise<void> {
  const cookie = consultationCookie(request);
  if (!cookie || sessions.has(cookie) || !CONSULTATION_ID.test(cookie)) return;
  if (!process.env['TATTOO_WORKER_TOKEN']) return;
  try {
    const response = await worker(owner, `/consultations/${cookie}`);
    const { data } = (await response.json()) as {
      data?: {
        state?: OrchestrationSession;
        bodyPhotoId?: string;
        jobId?: string;
        acceptedBrief?: string;
      };
    };
    if (data?.state?.sessionId !== cookie) return;
    sessions.set(cookie, {
      owner,
      state: data.state,
      touched: Date.now(),
      busy: false,
      ...(data.bodyPhotoId ? { bodyPhotoId: data.bodyPhotoId } : {}),
      ...(data.jobId ? { jobId: data.jobId } : {}),
      ...(data.acceptedBrief ? { acceptedBrief: data.acceptedBrief } : {}),
    });
  } catch {
    // None kept, or the worker cannot be reached: the studio starts a new consultation.
  }
}

/** «Nuevo diseño» and sign-out: the kept copy goes too. */
export async function dropConsultation(request: Request, owner: string): Promise<void> {
  const cookie = consultationCookie(request);
  forgetConsultation(request);
  if (!cookie || !CONSULTATION_ID.test(cookie) || !process.env['TATTOO_WORKER_TOKEN']) return;
  try {
    await worker(owner, `/consultations/${cookie}`, 'DELETE');
  } catch {
    // It expires on its own a day after its last change.
  }
}

/** `reply`, after keeping the consultation it answers for. */
export async function replyKept(
  value: unknown,
  current: Session,
  status = 200,
): Promise<NextResponse> {
  await persistConsultation(current);
  return reply(value, current, status);
}
export function clearSession(id: string): void {
  sessions.delete(id);
}
/**
 * The account behind this request (TASK-0045, ADR-0021).
 *
 * Every route that can spend money or read stored work calls this first. An unconfigured
 * deployment refuses rather than opening: a studio that cannot tell who is asking must say no.
 */
/**
 * TASK-0064 (ADR-0028): the account accepted the current terms and image consent when it signed
 * in. Routes that process images ask for this instead of checkboxes on each action.
 */
export function requireConsent(request: Request, caller: Authenticated): void {
  if (!hasConsent(request, caller.account.id))
    throw new RequestError(
      'Acepta las condiciones y el uso de tus imágenes para continuar.',
      CONSENT_REQUIRED,
    );
}

export async function requireAccount(request: Request): Promise<Authenticated> {
  if (!authConfigured())
    throw new RequestError('La autenticación no está configurada en el servidor.', 503);
  const found = await authenticate(request);
  if (!found) throw new RequestError('Inicia sesión para continuar.', 401);
  return found;
}

/**
 * An administrator of the studio (TASK-0055). Checked with Supabase on every request, like any
 * account, and then against `app_metadata.role`; the header's link to the panel decides nothing.
 */
export async function requireAdmin(request: Request): Promise<Authenticated> {
  const caller = await requireAccount(request);
  if (!caller.account.admin)
    throw new RequestError('Esta sección es solo para administración.', 403);
  return caller;
}

/**
 * Ask the worker's administrator routes, as this administrator. The worker records every look in
 * the audit trail under this id; the body photographs it refuses to serve stay refused here.
 */
export async function adminWorker(admin: string, path: string): Promise<Response> {
  const token = process.env['TATTOO_WORKER_TOKEN'];
  if (!token) throw new RequestError(STUDIO_UNAVAILABLE, 503);
  let response: Response;
  try {
    response = await fetch(
      `${process.env['TATTOO_WORKER_URL'] ?? 'http://127.0.0.1:8000'}/studio/admin${path}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'X-Admin-Id': admin },
        signal: AbortSignal.timeout(30000),
        cache: 'no-store',
      },
    );
  } catch {
    throw new RequestError(STUDIO_UNAVAILABLE, 503);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new RequestError(
      typeof data.detail === 'string' ? data.detail : GENERIC_FAILURE,
      response.status,
    );
  }
  return response;
}

/** Re-issue renewed tokens on a response built outside `reply`. */
export function applyRenewal(response: NextResponse, caller: Authenticated): NextResponse {
  return caller.renewed ? setAuthCookies(response, caller.renewed) : response;
}

/** Remember tokens renewed during this request so the next reply re-issues them. */
export function carryRenewal(current: Session, caller: Authenticated): Account {
  if (caller.renewed) current.renewedAuth = caller.renewed;
  return caller.account;
}

export function reply(value: unknown, current: Session, status = 200): NextResponse {
  const response = NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (current.renewedAuth) {
    setAuthCookies(response, current.renewedAuth);
    delete current.renewedAuth;
  }
  response.cookies.set('inkcraft', current.state.sessionId, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: 86400,
  });
  return response;
}
export async function input(request: Request, maxBytes = 15000): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== (request.headers.get('host') ?? new URL(request.url).host))
    throw new RequestError('Origen no permitido.', 403);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Falta el contenido de la solicitud.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RequestError('La solicitud es demasiado grande.', 413);
    }
    chunks.push(value);
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch {
    throw new RequestError('JSON inválido.');
  }
}
export function errorResponse(error: unknown): NextResponse {
  return NextResponse.json(
    {
      error:
        error instanceof RequestError || error instanceof ContentRefusedError
          ? error.message
          : 'No se pudo completar la solicitud. Inténtalo de nuevo.',
    },
    {
      status:
        error instanceof RequestError
          ? error.status
          : error instanceof ContentRefusedError
            ? 422
            : 500,
    },
  );
}
/** Bounded server-side fetch of a search candidate; never accept arbitrary hosts/redirects. */
export async function referenceBytes(source: string): Promise<string> {
  const url = new URL(source);
  const officialCrest = url.href === 'https://www.valenciacf.com/svg/escudo.svg';
  // TASK-0058: an Openverse thumbnail of one exact shape, the only form the scout produces.
  const openverse = isOpenverseThumbnail(url.href);
  // TASK-0068: a Brave-proxied thumbnail, the only form the web search produces.
  const brave = isBraveThumbnail(url.href);
  if (
    url.protocol !== 'https:' ||
    (!officialCrest &&
      !openverse &&
      !brave &&
      !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) ||
    url.username ||
    url.password ||
    url.port ||
    url.search
  )
    throw new RequestError('Referencia externa no permitida.', 422);
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': REFERENCE_USER_AGENT },
  });
  if (!response.ok || !response.body)
    throw new RequestError('No se puede descargar la referencia. Adjunta una imagen.', 422);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8000000) {
      await reader.cancel();
      throw new RequestError('La referencia supera 8 MB.', 422);
    }
    parts.push(value);
  }
  const data = Buffer.concat(parts);
  if (officialCrest) {
    const svg = data.toString('utf8');
    // This allowlisted vector is rasterized before moderation/storage. No external resources.
    if (
      !svg.includes('<svg') ||
      /<!DOCTYPE|<!ENTITY|<script|<image|<foreignObject|href\s*=|url\s*\(\s*[^#\s]/i.test(svg)
    )
      throw new RequestError('La referencia oficial tiene un formato no admitido.', 422);
    return (
      await sharp(data, { density: 300, limitInputPixels: 16000000 })
        .resize({ width: 1200, height: 1600, fit: 'inside' })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer()
    ).toString('base64');
  }
  return data.toString('base64');
}
/**
 * Call the worker on behalf of an account (TASK-0046).
 *
 * `owner` is the account id, not the consultation session id. It is what the worker scopes every
 * stored asset, job and vector master by, so it is the reason the same person sees the same work
 * on a second device — and the reason one account can never reach another's.
 */
/**
 * Count one paid consultation turn before spending on it (TASK-0078, audit SEG-02).
 *
 * Only when the consultation calls paid models; the deterministic one spends nothing. The worker
 * keeps the daily count, so it survives restarts and is shared by every web replica, and answers
 * 429 with a plain message when the account's limit is reached.
 */
export async function reserveTurn(
  owner: string,
  kind: 'message' | 'search',
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const config = liveAgentConfig(env);
  if (!config.architect && !config.scoutPlanner) return;
  await worker(owner, '/quota/turns', 'POST', { id: randomUUID(), kind });
}

/**
 * Open a link a client gave their tattooer (TASK-0097, ADR-0032): with the service token alone,
 * since whoever holds the link may open it, and with the link's token in a header so it never
 * sits in the worker's access log. An impossible token is not worth a call.
 */
export async function sharedWorker(shareToken: string, path = ''): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(shareToken))
    throw new RequestError('Este enlace no está disponible.', 404);
  const token = process.env['TATTOO_WORKER_TOKEN'];
  if (!token) throw new RequestError(STUDIO_UNAVAILABLE, 503);
  let response: Response;
  try {
    response = await fetch(
      `${process.env['TATTOO_WORKER_URL'] ?? 'http://127.0.0.1:8000'}/studio/shares${path}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'X-Share-Token': shareToken },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      },
    );
  } catch {
    throw new RequestError(STUDIO_UNAVAILABLE, 503);
  }
  if (!response.ok)
    throw new RequestError('Este enlace no está disponible.', response.status === 404 ? 404 : 503);
  return response;
}

export async function worker(
  owner: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  const token = process.env['TATTOO_WORKER_TOKEN'];
  if (!token) throw new RequestError(STUDIO_UNAVAILABLE, 503);
  let response: Response;
  try {
    response = await fetch(
      `${process.env['TATTOO_WORKER_URL'] ?? 'http://127.0.0.1:8000'}/studio${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Owner-Id': owner,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Uploads and kept photos are screened by the moderation provider before they are stored.
        signal: AbortSignal.timeout(path === '/media' || path === '/captures' ? 180000 : 15000),
        cache: 'no-store',
      },
    );
  } catch {
    throw new RequestError(STUDIO_UNAVAILABLE, 503);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new RequestError(
      typeof data.detail === 'string' ? data.detail : GENERIC_FAILURE,
      response.status,
    );
  }
  return response;
}
