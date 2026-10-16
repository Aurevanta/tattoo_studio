import { randomUUID } from 'node:crypto';
import type { ConsultationProvider } from '../providers/types';
import { brief as extractBrief } from '../state-machine';
import type { ConsultationSlots, ReferenceImage } from '../types';
import type { MultiAgentMessage, OrchestrationSession } from './types';
import { consultArchitect, mergeArchitect, textReadings } from './architect';
import { ContentRefusedError, type TextScreen } from './content-screen';
import { VisualSearchAgent, referenceQueries, type ScoutResult } from './image-scout';
import { buildMasterPrompt, ofSpanish, proposalSummary, spanishList } from './master-prompt';
import {
  extractPreferences,
  missingPreferences,
  proposeSize,
  withTechnicalDefaults,
} from './researcher';

const MIMICRY_MESSAGE =
  'Elige un estilo general del panel, sin pedir la imitación de un artista concreto. Conserva los motivos que quieras representar.';

const MISSING_REFERENCE = 'referencia: ';

const message = (sender: MultiAgentMessage['sender'], content: string): MultiAgentMessage => ({
  sender,
  senderLabel: sender === 'image_scout' ? 'Referencias' : 'Asistente de diseño',
  content,
  timestamp: new Date().toISOString(),
});

/**
 * The one message that closes a turn (TASK-0034): what the studio has settled, and the single
 * next thing the client should do. It is built from the state actually adopted — never from a
 * model's free-text reply, which can claim things the merge rules refused.
 */
function closingMessage(session: OrchestrationSession): string {
  const summary = proposalSummary(session.slots);
  if (session.phase === 'ready_to_generate')
    return `Propuesta lista: ${summary}. Siguiente paso: pulsa «Generar diseño y plantilla»; antes verás el resumen para confirmarlo. Puedes cambiar cualquier valor en el panel.`;
  const lead = summary ? `Propuesta: ${summary}. ` : '';
  const essential = session.missingFields
    .filter((field) => field.startsWith(MISSING_REFERENCE))
    .map((field) => field.slice(MISSING_REFERENCE.length));
  if (essential.length)
    return `${lead}Para ser fiel necesito una imagen ${ofSpanish(spanishList(essential))}. Siguiente paso: adjúntala en «Referencias» o pulsa «Buscar las referencias pendientes».`;
  const gaps = buildMasterPrompt(session.slots, session.references, session.stylePick).missing;
  if (gaps.length)
    return `${lead}Siguiente paso: indica ${spanishList(gaps)} en el panel y pulsa «Guardar preferencias».`;
  return `${lead}Revisa los valores del panel y pulsa «Guardar preferencias».`;
}

export class OrchestratorAgent {
  /**
   * `architect` is the prompt architect (TASK-0033): when present, chat turns with text are
   * enriched by it after the explicit extraction. Absent, the route is fully deterministic.
   * `screen` (TASK-0070) checks each message for sexually explicit content before anything runs.
   */
  constructor(
    private readonly scout = new VisualSearchAgent(),
    private readonly architect?: ConsultationProvider,
    private readonly screen?: TextScreen,
  ) {}
  createSession(sessionId: string = randomUUID()): OrchestrationSession {
    return {
      sessionId,
      revision: 0,
      phase: 'investigation',
      questionsAsked: 0,
      maxQuestions: 3,
      slots: {},
      references: [],
      messages: [],
      missingFields: [],
    };
  }
  async handleUserInteraction(
    session: OrchestrationSession,
    input: string,
    references: ReferenceImage[] = [],
    preferences?: ConsultationSlots,
    retryReferences = false,
    /**
     * TASK-0113 (ADR-0039): the client's screened images for this message, as data URLs labelled
     * «Imagen N». Only the architect sees them; the session keeps `references`, not these bytes.
     */
    images: ReferenceImage[] = [],
  ): Promise<OrchestrationSession> {
    // TASK-0070 (ADR-0031): an explicit idea is refused before any model or search is paid for,
    // and the session is left as it was, so the refused message is not kept.
    if (input.trim() && (await this.screen?.refuses(input))) throw new ContentRefusedError();
    const next = structuredClone(session);
    next.revision++;
    if (input.trim())
      next.messages.push({ ...message('orchestrator', input), senderLabel: 'Cliente' });
    if (/(?:estilo de|style of)\s+\S/i.test(input)) {
      delete next.brief;
      next.phase = 'needs_details';
      next.messages.push(message('orchestrator', MIMICRY_MESSAGE));
      return next;
    }
    const held = { ...next.slots, ...preferences };
    let slots = extractPreferences(input, held);
    // TASK-0039: what the keyword rules read from this message alone; the architect may reread it.
    const guessed = textReadings(held, slots, preferences);

    // The architect never rewrites the subject, so whether to search is known before it answers.
    let merged = [...next.references, ...references]
      .filter((r, i, a) => a.findIndex((x) => x.source === r.source) === i)
      .slice(0, 5);
    const subjectChanged = Boolean(
      session.slots.subject?.description &&
      slots.subject?.description !== session.slots.subject.description,
    );
    const plan = subjectChanged ? undefined : next.referencePlan;
    if (subjectChanged) merged = merged.filter((r) => r.verification === 'user_supplied');
    const search =
      retryReferences ||
      Boolean(
        (!session.slots.subject?.description || subjectChanged) && !merged.length && input.trim(),
      );
    const planned = () => plan ?? referenceQueries(slots.subject?.description ?? input);

    // TASK-0034: architect and scout run concurrently; neither waits for the other.
    const [proposal, scouted] = await Promise.all([
      this.architect && input.trim()
        ? consultArchitect(this.architect, next.messages, input, slots, images)
        : Promise.resolve(undefined),
      search
        ? this.scout
            .scoutReferenceImages({
              userInput: slots.subject?.description ?? input,
              ...(retryReferences
                ? {
                    queries: planned().filter(
                      (query) => !merged.some((ref) => ref.referenceQuery === query),
                    ),
                  }
                : {}),
            })
            .then(
              (result): ScoutResult | 'failed' => result,
              (): 'failed' => 'failed',
            )
        : Promise.resolve(undefined),
    ]);
    // TASK-0070: the architect read what the moderation scored too low.
    if (proposal?.refused) throw new ContentRefusedError();
    if (proposal?.mimicry) {
      delete next.brief;
      next.phase = 'needs_details';
      next.messages.push(message('orchestrator', MIMICRY_MESSAGE));
      return next;
    }
    // TASK-0033: the architect proposes what the client left open; explicit values still win.
    if (proposal) slots = mergeArchitect(slots, proposal.slots, guessed);
    // TASK-0034: with a zone and no stated size, the studio proposes one and says so.
    slots = proposeSize(slots, proposal?.size, session.slots.placement?.bodyPart);
    next.slots = withTechnicalDefaults(slots);
    // TASK-0038: a pick from a style the client has since moved away from no longer describes it.
    if (next.stylePick && next.stylePick.style !== next.slots.style?.primary) delete next.stylePick;

    next.references = merged;
    if (subjectChanged) {
      delete next.referencePlan; // the plan belonged to the previous subject
      delete next.essentialReferences;
      delete next.referenceLabels;
      delete next.waivedReferences;
    }
    if (scouted === 'failed') {
      next.messages.push(
        message(
          'image_scout',
          'La búsqueda no está disponible. Puedes adjuntar referencias; no se ha verificado ninguna imagen.',
        ),
      );
    } else if (scouted) {
      // A retry searches part of the plan; only a fresh search defines it.
      if (!retryReferences) {
        next.referencePlan = scouted.queries;
        next.essentialReferences = scouted.essential;
        next.referenceLabels = scouted.labels;
      }
      next.references = [...next.references, ...scouted.scoutedImages]
        .filter((r, i, all) => all.findIndex((other) => other.source === r.source) === i)
        .slice(0, 5);
      next.messages.push({
        ...message('image_scout', scouted.reportMessage),
        referenceImages: scouted.scoutedImages,
      });
    }

    const missing = missingPreferences(next.slots);
    const result = extractBrief({
      sessionId: next.sessionId,
      revision: next.revision,
      status: 'active',
      slots: next.slots,
      turns: [],
      nextQuestion: '',
    });
    delete next.brief;
    if (result.complete && missing.length === 0) next.brief = result.brief;
    next.missingFields = [...missing];
    // TASK-0026 (ADR-0010): size is not a missing client answer. The design process proposes
    // it from the anatomy and the idea, and the client may override it.
    // TASK-0058 (ADR-0026): a generic idea no longer needs a reference; it is drawn from the brief.
    // TASK-0034: only an essential reference blocks — a specific emblem, flag, landmark or artwork
    // whose exact look matters. A generic motif can be drawn without one. A reference of the
    // client's own settles it.
    // TASK-0067: nor does it once the client has chosen to go on without it.
    if (
      !next.waivedReferences &&
      !next.references.some((r) => r.verification === 'user_supplied')
    ) {
      for (const query of next.essentialReferences ?? []) {
        if (!next.references.some((r) => r.referenceQuery === query))
          next.missingFields.push(`${MISSING_REFERENCE}${next.referenceLabels?.[query] ?? query}`);
      }
    }
    if (input.trim() && missing.length && next.questionsAsked < 3) {
      const questions: Record<string, string> = {
        tema: '¿Qué quieres representar?',
        zona: '¿En qué zona del cuerpo lo quieres? Si te importa el lado, dímelo también.',
        estilo: '¿Qué estilo prefieres? También puedes elegirlo en el panel.',
        color: '¿Lo quieres en negro y gris, en color o en negro con algún acento de color?',
      };
      next.questionsAsked++;
      next.phase = 'investigation';
      next.messages.push(message('prompt_architect', questions[missing[0]!]!));
    } else {
      next.phase = next.brief && !next.missingFields.length ? 'ready_to_generate' : 'needs_details';
      next.messages.push(message('orchestrator', closingMessage(next)));
    }
    next.messages = next.messages.slice(-30);
    return next;
  }
}
