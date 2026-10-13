'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { OrchestrationSession } from '@tattoo/consultation';

import { BODY_OPTIONS, STYLE_OPTIONS } from '@tattoo/consultation/preferences';

import { styleOffers } from '@tattoo/consultation/style-library';

import { briefSignature, buildMasterPrompt, ofSpanish } from '@tattoo/consultation/master-prompt';

import { Brand } from '@/components/Brand';

import { SessionMenu } from '@/components/SessionMenu';

import { TattooPreviewModal } from '@/components/TattooPreviewModal';
import { GenerationProgress } from '@/components/GenerationProgress';
import { InkWorking } from '@/components/InkWorking';
import { BODY_ZONE_SPANS } from '@tattoo/contracts';
import { messageForError, messageForResponse } from '@/lib/client-errors';
import type { InkTask } from '@/lib/ink-progress';
import { StepFlow } from '@/components/StepFlow';
import { StylePicker } from '@/components/StylePicker';
import { MasterBrief } from '@/components/MasterBrief';
import { Confirm } from '@/components/Confirm';
import { ConsentDialog } from '@/components/ConsentDialog';
import { IMAGES_VERSION, TERMS_VERSION } from '@/content/legal';
import { missingBeyondDialogs, nextDialog, type GenerationDialog } from '@/lib/generation-flow';
import {
  afterIdea,
  ALL_DETAILS,
  essentialMissing,
  resumeStep,
  type WizardStep,
} from '@/lib/wizard';
import { IdeaStep } from '@/components/wizard/IdeaStep';
import { DetailsStep } from '@/components/wizard/DetailsStep';
import { ReferencesStep } from '@/components/wizard/ReferencesStep';
import { SummaryStep } from '@/components/wizard/SummaryStep';
import { DoneStep, WorkingStep } from '@/components/wizard/DoneStep';

import { buildSteps } from '@/lib/steps';
import { generationBlockers, nextAction } from '@/lib/next-step';

import { isCurrentDesign, openingFor, reopensNewest } from '@/lib/opening';
import { asQuota, canDesign, designsNote, type Quota } from '@/lib/quota';

import type { StudioJobStatus, GeneratedTattooArtifact } from '@/types/generation';

interface Form {
  style: string;

  body: string;

  side: string;

  bodyType: string;

  color: string;

  palette: string;

  width: string;

  height: string;

  /** TASK-0065: the professional description, editable in the summary. */
  refined: string;
}

const empty: Form = {
  style: '',

  body: '',

  side: '',

  bodyType: '',

  color: '',

  palette: '',

  width: '',

  height: '',

  refined: '',
};

/**
 * TASK-0065 (ADR-0029): the guided studio by default; the chat and panel are «Modo avanzado».
 * TASK-0091: the choice is not remembered, so every entry to the studio opens guided.
 */
type Mode = 'guided' | 'advanced';
type GuidedStep = WizardStep | 'done';

export default function ConsultationPage(): ReactNode {
  const [session, setSession] = useState<OrchestrationSession | null>(null);

  const [text, setText] = useState('');

  const [form, setForm] = useState<Form>(empty);

  const [savedForm, setSavedForm] = useState<Form>(empty);

  const [busy, setBusy] = useState(false);
  // TASK-0069: what the studio is doing while busy, for the tattooing hand to say it.
  const [task, setTask] = useState<InkTask>('save');
  const [submittingGeneration, setSubmittingGeneration] = useState(false);

  const [error, setError] = useState('');

  // TASK-0064 (ADR-0028): age and image consent are accepted at sign-in. A session opened before
  // that existed, or after the texts changed version, is asked here once.
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);

  const [mode, setMode] = useState<Mode>('guided');
  const [step, setStep] = useState<GuidedStep>('idea');
  // TASK-0067: asking before going on without an essential reference.
  const [waiving, setWaiving] = useState(false);

  // TASK-0064: «Generar» walks through the pop-ups that apply, one at a time (generation-flow.ts).
  const [flowing, setFlowing] = useState(false);
  const [dialog, setDialog] = useState<GenerationDialog | null>(null);

  const [bodyPhotoId, setBodyPhotoId] = useState('');

  const [placement, setPlacement] = useState({ x: 0.32, y: 0.22, width: 0.36, photoWidthMm: '' });
  const [manualPlacement, setManualPlacement] = useState(false);

  const [job, setJob] = useState<StudioJobStatus | null>(null);

  const [artifact, setArtifact] = useState<GeneratedTattooArtifact | null>(null);
  const [versions, setVersions] = useState<StudioJobStatus[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');

  async function refreshVersions(restoreLatest = false, sessionId?: string) {
    try {
      const response = await fetch('/api/generate?history=true');
      if (response.ok) {
        const history: StudioJobStatus[] = await response.json();
        setVersions(history);
        const latest = history[0];
        // TASK-0075 (audit UX-02): only a design of the consultation on screen is restored as
        // its result; an older one stays in «Tus diseños».
        if (restoreLatest && latest?.result && isCurrentDesign(latest.result, sessionId)) {
          setArtifact(latest.result);
          setSelectedJobId(latest.jobId);
        }
      }
    } catch {
      setError('No se ha podido cargar el historial. Tu propuesta actual sigue disponible.');
    }
  }

  const [showResult, setShowResult] = useState(false);

  // TASK-0095 (audit 2026-10-08 UX-04): what is left today, shown before a design is spent.
  const [quota, setQuota] = useState<Quota | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/quota', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled) setQuota(asQuota(body));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [job?.jobId, job?.state]);

  const referenceInput = useRef<HTMLInputElement>(null);

  const bodyInput = useRef<HTMLInputElement>(null);

  const messagesEnd = useRef<HTMLDivElement>(null);

  const activeJob = job?.state === 'queued' || job?.state === 'running';

  useEffect(() => {
    void fetch('/api/auth', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body: { account?: { consented?: boolean } | null }) => {
        if (body.account && body.account.consented === false) setNeedsConsent(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch('/api/consultation')
      .then((r) => {
        // TASK-0045: a stale or forged cookie gets past the cheap page gate; the API is the real
        // check, so its refusal is what sends the visitor to sign in.
        if (r.status === 401) {
          window.location.replace('/entrar');
          return { session: null };
        }
        return r.json();
      })

      .then(async (data) => {
        if (cancelled) return;
        // TASK-0046: designs belong to the account and the conversation to this browser, so the
        // two are restored independently. `openingFor` holds that branch, tested in lib/opening.
        const opening = openingFor(data);
        let jobState: string | undefined;

        if (opening.restore === 'conversation') {
          accept(data.session);
          setBodyPhotoId(data.bodyPhotoId ?? '');

          if (opening.jobId) {
            const response = await fetch(`/api/generate?id=${opening.jobId}`);

            if (response.ok && !cancelled) {
              const status: StudioJobStatus = await response.json();

              setJob(status);
              jobState = status.state;

              if (status.state === 'succeeded') {
                setArtifact(status.result);
                setSelectedJobId(status.jobId);
              } else if (status.state === 'failed') {
                // TASK-0075: a design that failed while the page was closed says so on return.
                setError(messageForError(status.error));
              }
            }
          }
        }
        if (!cancelled) {
          // TASK-0065: the guided studio resumes where the consultation left off.
          setStep(
            opening.restore !== 'conversation'
              ? 'idea'
              : jobState === 'succeeded'
                ? 'done'
                : resumeStep(data.session),
          );
          await refreshVersions(
            reopensNewest(opening, jobState),
            opening.restore === 'conversation' ? data.session?.sessionId : undefined,
          );
        }
      })

      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [session?.messages.length]);

  useEffect(() => {
    if (submittingGeneration)
      document.querySelector('[role="progressbar"]')?.scrollIntoView({ block: 'center' });
  }, [submittingGeneration]);

  useEffect(() => {
    if (!activeJob || !job) return;

    let stopped = false;

    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/generate?id=${job.jobId}`);

        // TASK-0072: a proxy's error page is not JSON; it must not become the message.
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (res.status === 401 || res.status === 404) {
            setJob(null);

            setError(messageForResponse(res.status, data));

            return;
          }

          throw new Error(messageForResponse(res.status, data));
        }

        if (stopped) return;

        setJob(data);

        if (data.state === 'succeeded') {
          setArtifact(data.result);
          setSelectedJobId(data.jobId);
          void refreshVersions();

          setShowResult(true);
        } else if (data.state === 'failed') setError(messageForError(data.error));

        if (data.state === 'queued' || data.state === 'running') timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!stopped) {
          setError(messageForError(e));

          timer = setTimeout(poll, 5000);
        }
      }
    };

    timer = setTimeout(poll, 1000);

    return () => {
      stopped = true;

      clearTimeout(timer);
    };
  }, [activeJob, job?.jobId]);

  function accept(next: OrchestrationSession) {
    setSession(next);

    const s = next.slots;

    const nextForm = {
      style: s.style?.primary ?? '',

      body: s.placement?.bodyPart ?? '',

      side: s.placement?.side ?? '',

      bodyType: s.placement?.bodyType ?? '',

      color: s.colour?.mode ?? '',

      palette: s.colour?.palette?.join(', ') ?? '',

      width: s.size?.widthMm?.toString() ?? '',

      height: s.size?.heightMm?.toString() ?? '',

      refined: s.subject?.refined ?? '',
    };

    setForm(nextForm);

    setSavedForm(nextForm);

    setArtifact(null);
  }

  async function call(url: string, body: unknown, method = 'POST') {
    const res = await fetch(url, {
      method,

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify(body),
    });

    // TASK-0072: plain words for every failure, whatever the server or the network answered.
    const data = await res.json().catch(() => ({}));

    if (res.status === 428) setNeedsConsent(true);

    if (!res.ok) throw new Error(messageForResponse(res.status, data));

    return data;
  }

  async function run(action: () => Promise<void>, doing: InkTask = 'save'): Promise<boolean> {
    setError('');

    setTask(doing);
    setBusy(true);

    try {
      await action();
      return true;
    } catch (e) {
      setError(messageForError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function acceptConsent() {
    setConsentBusy(true);
    const ok = await run(async () => {
      await call('/api/consent', { accepted: { terms: TERMS_VERSION, images: IMAGES_VERSION } });
    });
    setConsentBusy(false);
    if (ok) setNeedsConsent(false);
  }

  async function send() {
    if (!text.trim()) return;

    await run(async () => {
      const data = await call('/api/consultation', { action: 'orchestrate', userMessage: text });

      accept(data.session);

      setText('');
    }, 'idea');
  }

  async function save(values: Form = form): Promise<OrchestrationSession | null> {
    const preferences: Record<string, unknown> = {};

    if (values.style) preferences['style'] = { primary: values.style };

    if (values.body)
      preferences['placement'] = {
        bodyPart: values.body,

        orientation: 'vertical',

        ...(values.side ? { side: values.side } : {}),

        ...(values.bodyType ? { bodyType: values.bodyType } : {}),
      };

    if (values.color)
      preferences['colour'] = {
        mode: values.color,

        ...(values.color === 'black_and_grey' || !values.palette.trim()
          ? {}
          : {
              palette: values.palette

                .split(',')

                .map((x) => x.trim())

                .filter(Boolean),
            }),
      };

    // TASK-0034: an untouched studio proposal stays a proposal, so it is re-made if the zone
    // changes; only a size the client typed becomes their measurement.
    const sizeTouched = values.width !== savedForm.width || values.height !== savedForm.height;
    if (values.width && values.height && (sizeTouched || !session?.slots.size?.proposed))
      preferences['size'] = { widthMm: Number(values.width), heightMm: Number(values.height) };

    // TASK-0065: an edited professional description travels with the subject it describes. The
    // brief's description is used because it already meets the contract's minimum length.
    const subject = session?.slots.subject;
    if (values.refined !== savedForm.refined && subject?.description) {
      const refined = values.refined.trim();
      preferences['subject'] = {
        description: session?.brief?.subject.description ?? subject.description,
        ...(subject.elements?.length ? { elements: subject.elements } : {}),
        ...(refined ? { refined } : {}),
      };
    }

    let saved = null as OrchestrationSession | null;
    const ok = await run(async () => {
      saved = (await call('/api/consultation', { action: 'preferences', preferences })).session;
      accept(saved!);
    });
    return ok ? saved : null;
  }

  async function upload(file: File | undefined, kind: 'reference' | 'body') {
    if (!file) return;

    await run(async () => {
      if (file.size > 8000000) throw new Error('La imagen supera 8 MB.');

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(String(reader.result).split(',')[1]!);

        reader.onerror = reject;

        reader.readAsDataURL(file);
      });

      const data = await call('/api/media', { data: base64, kind });

      accept(data.session);

      if (kind === 'body') setBodyPhotoId(data.assetId);
    }, 'image');
  }

  async function generate(): Promise<boolean> {
    setSubmittingGeneration(true);
    try {
      return await run(async () => {
        const data = await call('/api/generate', {
          idempotencyKey: crypto.randomUUID(),

          // TASK-0064: confirmed in the final pop-up, with the summary they belong to.
          referencesReviewed: true,

          ...(bodyPhotoId ? { bodyPhotoId } : {}),

          ...(manualPlacement || bodyPhotoId
            ? {
                placement: {
                  x: placement.x,

                  y: placement.y,

                  width: placement.width,

                  ...(placement.photoWidthMm
                    ? { photoWidthMm: Number(placement.photoWidthMm) }
                    : {}),
                },
              }
            : {}),
        });

        setJob(data);

        setShowResult(false);
      });
    } finally {
      setSubmittingGeneration(false);
    }
  }

  const disabled = busy || activeJob;

  /**
   * TASK-0036: a photo for a change request, screened by the worker; not added to the brief.
   * Throws, so the open dialog can show the reason instead of the page behind it.
   */
  async function attachForEdit(file: File): Promise<string> {
    if (file.size > 8000000) throw new Error('La imagen supera 8 MB.');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]!);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const data = await call('/api/media', {
      data: base64,
      kind: 'reference',
      purpose: 'edit',
    });
    return data.assetId;
  }

  async function editProposal(
    instruction: string,
    coverage?: 'larger' | 'smaller' | 'full',
    referenceIds?: string[],
  ) {
    setSubmittingGeneration(true);
    setShowResult(false);
    try {
      await run(async () => {
        const data = await call('/api/generate', {
          idempotencyKey: crypto.randomUUID(),
          edit: {
            parentJobId: selectedJobId,
            instruction,
            ...(coverage ? { coverage, mode: 'placement' } : {}),
            ...(referenceIds?.length ? { referenceIds } : {}),
          },
        });
        setJob(data);
      });
    } finally {
      setSubmittingGeneration(false);
    }
  }

  const unsaved = JSON.stringify(form) !== JSON.stringify(savedForm);

  // TASK-0026: the rail reads state the page already holds; it decides nothing (WEB-INV-001).
  const slots = session?.slots;
  const hasBrief = Boolean(
    slots?.style?.primary && slots?.placement?.bodyPart && slots?.colour?.mode,
  );
  // TASK-0029: a reading of the brief that will be sent, not a second description of it.
  const masterPrompt = buildMasterPrompt(
    slots ?? {},
    session?.references ?? [],
    session?.stylePick,
  );

  // TASK-0037: the same function the server uses, so a correct acceptance cannot be refused.
  const currentSignature = briefSignature(masterPrompt);

  // TASK-0028: offer catalogue variants once a style is known, so the client chooses by
  // looking rather than by imagining.
  const offers = styleOffers(slots?.style?.primary);
  // TASK-0038: the pick settles the style; it is not listed among the references.
  const chosenOfferId = offers.find((o) => o.id === session?.stylePick?.id)?.id;

  // TASK-0034: name what stands between the client and generation, and the one next action.
  const missingFields = session?.missingFields ?? [];
  const gate = {
    hasSession: Boolean(slots?.subject?.description),
    busy,
    activeJob,
    hasArtifact: isCurrentDesign(artifact, session?.sessionId),
    // TASK-0064: the body is asked in a pop-up when «Generar» is pressed, so it does not block.
    briefMissing: session ? missingBeyondDialogs(masterPrompt.missing) : [],
    missingReferences: missingFields
      .filter((f) => f.startsWith('referencia: '))
      .map((f) => f.slice('referencia: '.length)),
    phaseReady: session?.phase === 'ready_to_generate',
  };
  const blockers = generationBlockers(gate);
  const action = nextAction(gate);

  // TASK-0037: marked accepted only once the server has recorded it; the server is what
  // generation checks, so a local-only acceptance would be a promise it does not keep.
  // TASK-0064: the final pop-up accepts what it shows and generates, in one answer.
  async function acceptAndGenerate() {
    const signature = currentSignature;
    const accepted = await run(async () => {
      accept((await call('/api/consultation', { action: 'accept_brief', signature })).session);
    }, 'accept');
    if (accepted) await generate();
  }

  // TASK-0064: the next pop-up is chosen from the state as it is after the last answer, so the
  // summary shown last is the brief that will actually be sent.
  const missingKey = masterPrompt.missing.join('|');
  useEffect(() => {
    if (!flowing || busy || dialog) return;
    setDialog(nextDialog({ unsaved, briefMissing: masterPrompt.missing }));
    // `missingKey` stands for `masterPrompt.missing`, a new array on every render.
  }, [flowing, busy, dialog, unsaved, missingKey]);

  // TASK-0065: the guided studio's answers.
  async function submitIdea(idea: string) {
    await run(async () => {
      // An idea sent again (after «Atrás») starts a clean consultation, not a refinement.
      if (session) await call('/api/consultation', {}, 'DELETE');
      const data = await call('/api/consultation', { action: 'orchestrate', userMessage: idea });
      accept(data.session);
      setStep(afterIdea());
    }, 'idea');
  }

  // Step 2 offers every detail, with what the idea already decided chosen (TASK-0099).
  const detailFields = ALL_DETAILS;

  async function continueDetails() {
    if (await save(form)) setStep('references');
  }

  async function changeReferences(body: Record<string, unknown>) {
    await run(async () =>
      accept((await call('/api/consultation', { action: 'references', ...body })).session),
    );
  }

  async function confirmSummary() {
    // What is accepted is the brief as saved, so a change made here is saved first and the
    // signature is read from the session the server returns.
    const current = unsaved ? await save(form) : session;
    if (!current) return;
    const signature = briefSignature(
      buildMasterPrompt(current.slots, current.references, current.stylePick),
    );
    const accepted = await run(async () => {
      accept((await call('/api/consultation', { action: 'accept_brief', signature })).session);
    }, 'accept');
    if (!accepted) return;
    // «Listo» only once the design is really queued; a refusal leaves the summary and its reason.
    if (await generate()) setStep('done');
  }

  async function newDesign() {
    await run(async () => {
      await call('/api/consultation', {}, 'DELETE');
      setSession(null);
      setForm(empty);
      setSavedForm(empty);
      setBodyPhotoId('');
      setArtifact(null);
      setSelectedJobId('');
      setJob(null);
      setStep('idea');
    }, 'reset');
  }

  function openVersion(version: StudioJobStatus) {
    setArtifact(version.result);
    setSelectedJobId(version.jobId);
    setShowResult(true);
  }

  function stopFlow() {
    setFlowing(false);
    setDialog(null);
  }

  async function answer(step: () => Promise<unknown>) {
    setDialog(null);
    if (!(await step())) setFlowing(false);
  }

  async function chooseStyleVariant(variantId: string) {
    await run(async () =>
      accept((await call('/api/consultation', { action: 'style_variant', variantId })).session),
    );
  }

  const steps = buildSteps({
    hasIdea: Boolean(slots?.subject?.description),
    hasBrief,
    referenceCount: session?.references.length ?? 0,
    hasArtifact: isCurrentDesign(artifact, session?.sessionId),
    proposedSize: slots?.size,
  });

  function goToStep(id: string) {
    document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      <header className="studio-header">
        <Brand variant="header" />

        <div className="header-end">
          <button
            type="button"
            className="mode-switch"
            onClick={() => setMode(mode === 'guided' ? 'advanced' : 'guided')}
          >
            {mode === 'guided' ? '⚙ Modo avanzado' : '✦ Modo guiado'}
          </button>
          <SessionMenu />
        </div>
      </header>

      {mode === 'advanced' && <StepFlow steps={steps} onSelect={goToStep} />}

      <main className="studio-container" hidden={mode !== 'advanced'}>
        <section id="step-idea" className="chat-surface" aria-label="Consulta de diseño">
          <div className="studio-intro">
            <p className="eyebrow">DE LA IDEA AL TRAZO</p>

            <h1>Tu idea, un solo diseño.</h1>

            <p>
              Describe el tatuaje que imaginas. Usaremos referencias reales y un mismo maestro para
              la plantilla y la vista en piel.
            </p>

            <p className="small-note">
              Hasta 3 preguntas. Proponemos el tamaño según la zona del cuerpo; puedes cambiarlo en
              el panel cuando quieras.
            </p>
          </div>

          <div className="studio-messages" aria-live="polite">
            {session?.messages.map((m, i) => (
              <article
                key={i}

                className={m.senderLabel === 'Cliente' ? 'studio-message user' : 'studio-message'}
              >
                <strong>{m.senderLabel}</strong>

                <p>{m.content}</p>
              </article>
            ))}

            <div ref={messagesEnd} />
          </div>

          {/* TASK-0069: the advanced studio shows the same hand while an agent works. */}
          {mode === 'advanced' && busy && !submittingGeneration && <InkWorking task={task} />}

          <form
            className="studio-composer"

            onSubmit={(e) => {
              e.preventDefault();

              void send();
            }}
          >
            <label htmlFor="idea">Describe tu idea</label>

            <textarea
              id="idea"

              value={text}

              onChange={(e) => setText(e.target.value)}

              disabled={disabled}

              maxLength={2000}

              placeholder="Un león de línea fina en el antebrazo izquierdo, en negro, de 8 × 15 cm…"
            />

            <button className="btn-primary" disabled={disabled || !text.trim()}>
              {busy ? 'Procesando…' : 'Enviar idea'}
            </button>
          </form>

          <p className="small-note">
            Visualización orientativa. El tatuador debe revisar el diseño y el stencil antes de
            utilizarlos.
          </p>
        </section>

        <aside className="brief-panel" aria-label="Preferencias y entrega">
          <h2 id="step-brief">Tu proyecto</h2>

          <div className="next-step" role="status" aria-live="polite">
            <strong>{action.title}</strong>
            <p>{action.detail}</p>
            {action.step && action.step !== 'brief' && (
              <button type="button" className="link-button" onClick={() => goToStep(action.step!)}>
                Ir ahí
              </button>
            )}
          </div>

          <div className="studio-fields">
            <label>
              Estilo
              <select
                value={form.style}

                onChange={(e) => setForm({ ...form, style: e.target.value })}

                disabled={disabled}
              >
                <option value="">Seleccionar</option>

                {Object.entries(STYLE_OPTIONS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Zona
              <select
                value={form.body}

                onChange={(e) => setForm({ ...form, body: e.target.value })}

                disabled={disabled}
              >
                <option value="">Seleccionar</option>

                {Object.entries(BODY_OPTIONS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Lado
              <select
                value={form.side}

                onChange={(e) => setForm({ ...form, side: e.target.value })}

                disabled={disabled}
              >
                <option value="">Sin especificar</option>

                <option value="left">Izquierdo</option>

                <option value="right">Derecho</option>

                <option value="centre">Centro</option>
              </select>
            </label>

            <label>
              Cuerpo
              <select
                value={form.bodyType}
                onChange={(e) => setForm({ ...form, bodyType: e.target.value })}
                disabled={disabled}
              >
                <option value="">Seleccionar</option>

                <option value="masculine">Hombre</option>

                <option value="feminine">Mujer</option>
              </select>
            </label>

            <label>
              Color
              <select
                value={form.color}

                onChange={(e) => setForm({ ...form, color: e.target.value })}

                disabled={disabled}
              >
                <option value="">Seleccionar</option>

                <option value="black_and_grey">Negro y gris</option>

                <option value="colour">Color</option>

                <option value="black_and_grey_with_accent">Negro con acentos</option>
              </select>
            </label>

            {form.color && form.color !== 'black_and_grey' && (
              <label className="wide">
                ¿Algún color que quieras incluir? (opcional)
                <input
                  placeholder="Por ejemplo: rojo, azul"

                  value={form.palette}

                  onChange={(e) => setForm({ ...form, palette: e.target.value })}

                  disabled={disabled}
                />
                <small>
                  Puedes dejarlo vacío. La idea y las referencias guiarán la elección de colores.
                </small>
              </label>
            )}

            <label>
              Ancho (mm) <span className="field-optional">opcional</span>
              <input
                type="number"
                min="5"
                max="600"
                placeholder={
                  slots?.size?.widthMm ? String(slots.size.widthMm) : 'Lo propone el estudio'
                }
                value={form.width}
                onChange={(e) => setForm({ ...form, width: e.target.value })}
                disabled={disabled}
              />
            </label>

            <label>
              Alto (mm) <span className="field-optional">opcional</span>
              <input
                type="number"
                min="5"
                max="600"
                placeholder={
                  slots?.size?.heightMm ? String(slots.size.heightMm) : 'Lo propone el estudio'
                }
                value={form.height}
                onChange={(e) => setForm({ ...form, height: e.target.value })}

                disabled={disabled}
              />
            </label>
          </div>

          {slots?.size?.proposed && (
            <p className="small-note">
              Tamaño propuesto por el estudio según la zona y tu idea. Puedes cambiarlo y guardar.
            </p>
          )}

          <button onClick={() => void save()} disabled={disabled || !session}>
            Guardar preferencias
          </button>

          <p className="small-note">
            Trazo técnico propuesto: {session?.slots.linework?.weight === 'fine' ? 'fino' : 'medio'}
            . El diseño usará el modo de color elegido y un acabado de tinta reciente sobre piel. La
            curvatura y el tamaño son orientativos. El tatuador debe revisar los símbolos y los
            contornos de la plantilla.
          </p>

          <StylePicker
            offers={offers}
            selected={chosenOfferId}
            disabled={disabled}
            onSelect={(id) => void chooseStyleVariant(id)}
          />

          <MasterBrief prompt={masterPrompt} brief={session?.brief} />

          <h3 id="step-referencias">Referencias</h3>
          {session?.missingFields.some((field) => field.startsWith('referencia')) && (
            <button
              disabled={disabled}
              onClick={() =>
                void run(
                  async () =>
                    accept(
                      (await call('/api/consultation', { action: 'retry_references' })).session,
                    ),
                  'search',
                )
              }
            >
              Buscar las referencias pendientes
            </button>
          )}

          <div className="reference-grid">
            {session?.references.map((r, i) => (
              <figure key={r.source}>
                <img src={r.source} alt={r.label ?? `Referencia ${i + 1}`} />

                <figcaption>
                  {r.sourcePage ? (
                    <a href={r.sourcePage} target="_blank" rel="noreferrer">
                      {r.label}
                    </a>
                  ) : (
                    r.label
                  )}

                  <small>{r.license || 'Aportada por ti'}</small>
                </figcaption>

                <button
                  disabled={disabled}

                  onClick={() =>
                    void run(async () =>
                      accept(
                        (
                          await call('/api/consultation', {
                            action: 'references',

                            removeReference: r.source,
                          })
                        ).session,
                      ),
                    )
                  }
                >
                  Quitar
                </button>
              </figure>
            ))}
          </div>

          <div className="upload-actions">
            <button disabled={disabled} onClick={() => referenceInput.current?.click()}>
              Adjuntar referencia
            </button>

            <button disabled={disabled} onClick={() => bodyInput.current?.click()}>
              Mi foto de piel
            </button>

            <input
              hidden

              ref={referenceInput}

              type="file"

              accept="image/png,image/jpeg,image/webp"

              onChange={(e) => {
                void upload(e.target.files?.[0], 'reference');

                e.target.value = '';
              }}
            />

            <input
              hidden

              ref={bodyInput}

              type="file"

              accept="image/png,image/jpeg,image/webp"

              onChange={(e) => {
                void upload(e.target.files?.[0], 'body');

                e.target.value = '';
              }}
            />
          </div>

          {bodyPhotoId && (
            <figure className="body-preview">
              <img
                src={`/api/media?id=${bodyPhotoId}`}

                alt="Tu fotografía para colocar el diseño"
              />

              <figcaption>Tu foto · la generación del diseño no recibe esta imagen</figcaption>
            </figure>
          )}

          <details>
            <summary>Posición y escala sobre piel</summary>

            <p className="small-note">
              Sin foto propia se genera una anatomía ilustrativa. La escala sobre piel solo es
              orientativa si no calibras.
              {!manualPlacement &&
                !bodyPhotoId &&
                ' Colocación automática según las medidas. Mover un control activa la colocación manual.'}
            </p>

            {(['x', 'y', 'width'] as const).map((key) => (
              <label key={key}>
                {key === 'x'
                  ? 'Posición horizontal'
                  : key === 'y'
                    ? 'Posición vertical'
                    : 'Anchura en foto'}
                : {Math.round(placement[key] * 100)} %
                <input
                  type="range"

                  min={key === 'width' ? 0.05 : 0}

                  max={key === 'width' ? 0.8 : 0.9}

                  step="0.01"

                  value={placement[key]}

                  onChange={(e) => {
                    setManualPlacement(true);
                    setPlacement({ ...placement, [key]: Number(e.target.value) });
                  }}
                />
              </label>
            ))}

            <label>
              Anchura real de toda la foto (mm, opcional)
              <input
                type="number"

                min="20"

                max="3000"

                value={placement.photoWidthMm}

                onChange={(e) => {
                  setManualPlacement(true);
                  setPlacement({ ...placement, photoWidthMm: e.target.value });
                }}
              />
            </label>
          </details>

          <button
            id="step-diseno"
            className="btn-primary generate-button"
            disabled={disabled || session?.phase !== 'ready_to_generate' || blockers.length > 0}
            onClick={() => setFlowing(true)}
          >
            {activeJob ? 'Generando…' : 'Generar diseño y plantilla'}
          </button>

          {(submittingGeneration || activeJob) && (
            <GenerationProgress
              phase={
                submittingGeneration ? 'preparing' : job?.state === 'queued' ? 'queued' : 'running'
              }
              stage={job?.stage}
              queuePosition={job?.queuePosition}
            />
          )}

          {session && !activeJob && blockers.length > 0 && (
            <div className="blockers">
              <p className="small-note">Para generar falta:</p>
              <ul>
                {blockers.map((blocker) => (
                  <li key={blocker.text}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => goToStep(blocker.step)}
                    >
                      {blocker.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {artifact && <button onClick={() => setShowResult(true)}>Ver diseño y descargar</button>}
          {versions.length > 0 && (
            <section aria-label="Historial de propuestas">
              <h2>Tus versiones</h2>
              <p className="small-note">
                Se guardan en tu cuenta. Las fotos de tu cuerpo, y lo que se ve sobre ellas, se
                borran a las 24 horas. Abre cualquiera para seguir cambiándola.
              </p>
              {versions.map(
                (version, index) =>
                  version.result && (
                    <button
                      key={version.jobId}
                      onClick={() => {
                        setArtifact(version.result);
                        setSelectedJobId(version.jobId);
                        setShowResult(true);
                      }}
                    >
                      Propuesta {versions.length - index} ·{' '}
                      {version.result.capture
                        ? 'Foto con la cámara'
                        : (version.result.edit?.instruction ?? 'Diseño inicial')}
                    </button>
                  ),
              )}
            </section>
          )}

          <button
            className="delete-session"

            disabled={busy}

            onClick={() =>
              void run(async () => {
                await call('/api/media', {}, 'DELETE');

                setSession(null);

                setForm(empty);

                setBodyPhotoId('');

                setArtifact(null);
                setVersions([]);
                setSelectedJobId('');

                setJob(null);
              })
            }
          >
            Eliminar sesión y archivos
          </button>
        </aside>
      </main>

      {error && (
        <div className="studio-error" role="alert">
          <span>{error}</span>

          <button onClick={() => setError('')} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      )}

      {showResult && artifact && (
        <TattooPreviewModal
          key={selectedJobId}
          artifact={artifact}
          jobId={selectedJobId}
          onClose={() => setShowResult(false)}
          onEdit={(instruction, coverage, referenceIds) =>
            void editProposal(instruction, coverage, referenceIds)
          }
          onAttach={attachForEdit}
          editingDisabled={Boolean(
            disabled || submittingGeneration || !selectedJobId || !canDesign(quota),
          )}
          quotaNote={designsNote(quota)}
          zoneSpan={
            // TASK-0073: the zone is known only when this design belongs to the open consultation.
            artifact.briefId === session?.sessionId && session?.slots.placement?.bodyPart
              ? BODY_ZONE_SPANS[session.slots.placement.bodyPart]
              : undefined
          }
        />
      )}

      {mode === 'guided' && !needsConsent && !showResult && !waiving && (
        <>
          {activeJob || submittingGeneration ? (
            <WorkingStep
              phase={
                submittingGeneration ? 'preparing' : job?.state === 'queued' ? 'queued' : 'running'
              }
              stage={job?.stage}
              queuePosition={job?.queuePosition}
            />
          ) : step === 'idea' ? (
            <IdeaStep
              initial={session?.slots.subject?.description ?? ''}
              busy={busy}
              working={busy ? task : null}
              error={error}
              onSubmit={(idea) => void submitIdea(idea)}
              onAdvanced={() => setMode('advanced')}
              versions={versions}
              onOpen={openVersion}
            />
          ) : step === 'details' ? (
            <DetailsStep
              fields={detailFields}
              values={form}
              busy={busy}
              working={busy ? task : null}
              onChange={(patch) => setForm({ ...form, ...patch })}
              onBack={() => setStep('idea')}
              onContinue={() => void continueDetails()}
            />
          ) : step === 'references' ? (
            <ReferencesStep
              references={session?.references ?? []}
              essential={essentialMissing(session)}
              busy={busy}
              working={busy ? task : null}
              error={error}
              onRemove={(source) => void changeReferences({ removeReference: source })}
              onAdd={(file) => void upload(file, 'reference')}
              onSearchAgain={() =>
                void run(
                  async () =>
                    accept(
                      (await call('/api/consultation', { action: 'retry_references' })).session,
                    ),
                  'search',
                )
              }
              onWaive={() => setWaiving(true)}
              onBack={() => setStep('details')}
              onContinue={() => setStep('summary')}
            />
          ) : step === 'summary' ? (
            <SummaryStep
              idea={session?.slots.subject?.description ?? ''}
              values={form}
              referenceCount={session?.references.length ?? 0}
              bodyPhotoId={bodyPhotoId}
              busy={busy}
              working={busy ? task : null}
              error={error}
              quotaNote={designsNote(quota)}
              outOfDesigns={!canDesign(quota)}
              onChange={(patch) => setForm({ ...form, ...patch })}
              onOwnPhoto={(file) => void upload(file, 'body')}
              onStudioSkin={() => setBodyPhotoId('')}
              onBack={() => setStep('references')}
              onConfirm={() => void confirmSummary()}
            />
          ) : (
            <DoneStep
              versions={versions}
              onView={() => artifact && setShowResult(true)}
              onNew={() => void newDesign()}
              onOpen={openVersion}
              onAdvanced={() => setMode('advanced')}
            />
          )}
        </>
      )}

      {waiving && (
        <Confirm
          belowHeader
          title="¿Continuar sin esa imagen?"
          onCancel={() => setWaiving(false)}
          actions={[
            { label: 'Volver', onClick: () => setWaiving(false), disabled: busy },
            {
              label: 'Continuar igualmente',
              primary: true,
              disabled: busy,
              onClick: () =>
                void run(async () => {
                  accept((await call('/api/consultation', { action: 'waive_references' })).session);
                  setWaiving(false);
                  setStep('summary');
                }),
            },
          ]}
        >
          <p>
            Sin una imagen {ofSpanish(essentialMissing(session).join(', '))}, el diseño será una
            interpretación y puede no parecerse al original.
          </p>
        </Confirm>
      )}

      {needsConsent && (
        <ConsentDialog
          confirmLabel="Acepto y continúo"
          busy={consentBusy}
          onAccept={() => void acceptConsent()}
          onCancel={() => {
            // Declining means leaving: the studio cannot process images without it.
            void fetch('/api/auth', { method: 'DELETE' }).finally(() =>
              window.location.replace('/entrar'),
            );
          }}
        />
      )}

      {dialog === 'save' && (
        <Confirm
          title="¿Quieres guardar tus preferencias?"
          onCancel={stopFlow}
          actions={[
            {
              label: 'Descartar cambios',
              onClick: () =>
                void answer(async () => {
                  setForm(savedForm);
                  return true;
                }),
            },
            { label: 'Guardar', primary: true, onClick: () => void answer(() => save()) },
          ]}
        >
          <p>Has cambiado valores del panel que aún no se han guardado.</p>
        </Confirm>
      )}

      {dialog === 'body' && (
        <Confirm
          title="¿Sobre qué cuerpo lo vemos?"
          onCancel={stopFlow}
          actions={[
            { label: 'Cancelar', onClick: stopFlow },
            {
              label: 'Hombre',
              primary: true,
              onClick: () => void answer(() => save({ ...form, bodyType: 'masculine' })),
            },
            {
              label: 'Mujer',
              primary: true,
              onClick: () => void answer(() => save({ ...form, bodyType: 'feminine' })),
            },
          ]}
        >
          <p>Lo usamos para la vista sobre piel. Puedes cambiarlo después en el panel.</p>
        </Confirm>
      )}

      {dialog === 'confirm' && (
        <Confirm
          wide
          title="¿Generamos tu diseño?"
          onCancel={stopFlow}
          actions={[
            { label: 'Cancelar', onClick: stopFlow },
            {
              label: 'Generar diseño y plantilla',
              primary: true,
              onClick: () => {
                stopFlow();
                void acceptAndGenerate();
              },
            },
          ]}
        >
          <MasterBrief prompt={masterPrompt} />
          {(session?.references.length ?? 0) > 0 && (
            <div className="reference-grid confirm-references">
              {session?.references.map((r, i) => (
                <figure key={r.source}>
                  <img src={r.source} alt={r.label ?? `Referencia ${i + 1}`} />
                  <figcaption>{r.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <p className="small-note">
            Al generar aceptas este resumen
            {(session?.references.length ?? 0) > 0
              ? ' y confirmas que estas referencias corresponden a tu idea'
              : ''}
            .
          </p>
        </Confirm>
      )}
    </div>
  );
}
