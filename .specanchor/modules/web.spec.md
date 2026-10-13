---
type: module-spec
module: web
status: draft
source_paths:
  - apps/web/*
last_reviewed: 2026-09-19
---

# Module: web

TASK-0099 (amends ADR-0029): step 2 always follows the idea and shows all five details (`ALL_DETAILS`), preselected from the consultation, with «Hemos marcado lo que entendimos de tu idea…» when any is set. `afterIdea()` always answers `details`; `resumeStep` still skips to the references when nothing is missing. `vitest.config.ts` resolves the `@/` alias.

TASK-0097 (ADR-0032): «Para tu tatuador» in the result (`ShareWithTattooer`) creates, shows, copies, sends and withdraws links through `/api/shares` (creating needs the current consent). `/t/<token>` is public, `noindex`, no referrer, outside the page gate; it renders `SharedDesignView` (sheet, images, print, downloads) or a 404 «Este enlace ya no está disponible». `/api/shared/<token>/<asset>` serves files with a `sandbox` CSP. The token reaches the worker in `X-Share-Token` (`sharedWorker`). The privacy policy names sharing; `IMAGES_VERSION` is 2026-10-09.

TASK-0096 (audit 2026-10-08 UX-01): `/inicio` is the public landing — one real studio result (design, skin view on a generated plate, 1:1 stencil from `public/ejemplos/`), how it works, why Inkcraft, the review note, and «Entrar al estudio» / «Solicitar acceso». The page gate sends a signed-out `/` there and every other studio path to `/entrar`; `/inicio` and `/ejemplos/` are public and `/inicio` is in the sitemap. Access stays by invitation (ADR-0021).

TASK-0095 (audit 2026-10-08 UX-04): `GET /api/quota` passes on the worker's counts; `lib/quota.ts` words them. Step 4 and the result's change request show «Te quedan N de M diseños hoy» and are disabled when nothing is left (an unknown count never blocks). Read on load and whenever a design starts or ends.

TASK-0094 (audit 2026-10-08 UX-06, ARQ-02): `app/not-found.tsx`, `app/error.tsx` and `app/global-error.tsx` show the studio's card (`ErrorCard`) in Spanish with a way back. A failed screen posts to `/api/client-errors`, which records a `client_error` event (`render` | `global`) for a signed-in account only — message ≤ 300 chars, path without query, digest — at most 20 per account and hour, always 204. The Panel labels it «Error en el navegador».

TASK-0093 (audit 2026-10-08 SEO-02): `lib/site.ts` holds the address, the description (no provider names) and the root metadata (Open Graph with `/brand/og.png`); `app/robots.ts` and `app/sitemap.ts` expose only `/entrar`, `/condiciones` and `/privacidad`, and the page gate lets `robots.txt` and `sitemap.xml` through. Titles read «<page> · Inkcraft».

TASK-0092 (audit 2026-10-08 SEG-01, SEG-04): `next` ≥ 15.5.27 and `sharp` ≥ 0.35.5; workspace overrides pin Next's `sharp` and PostCSS's `source-map-js` to patched lines. `pnpm audit --prod` is clean.

TASK-0091: every load of the studio opens guided; the mode is not remembered (amends TASK-0066's per-tab `sessionStorage`). «Modo avanzado» lasts until the page is left.

TASK-0090: the panel labels `artwork_check` «Revisión del dibujo».

TASK-0088: the viewer explains the A4 pieces beside the downloads when they apply (`lib/print-pieces.ts`).

TASK-0086: `lib/stencil-review.ts`; the viewer marks a preliminary stencil, says why, and overlays it on the design on request.

TASK-0085: the panel shows «Espera en cola» (median and p95).

TASK-0084 (audit): the result viewer shows the images, then three short notices, and folds the long notice; the style picker shows `content/style-hints.ts` (Spanish) instead of the English prompt characteristics.

TASK-0082 (audit ACC-01): `Confirm belowHeader` no longer sets `aria-modal`; while any is open the `main` regions it covers are `inert`.

TASK-0081 (audit UX-04): «Solicitar acceso» (mailto) and «¿Has olvidado tu contraseña?» on `/entrar`; `/recuperar` → `/api/auth/recover` (Supabase `/recover`, same answer for any address); `/restablecer` → `/api/auth/password` (Supabase `PUT /user` with the link token). Both pages are public in the middleware.

TASK-0080: `app/api/persistence.test.ts` restores a consultation from the worker after emptying the process memory.

TASK-0079 (audit ARQ-01): `restoreConsultation` before `session()`, `replyKept` after changes, `dropConsultation` on «Nuevo diseño»; memory is the cache, the worker what survives a restart.

TASK-0078: `reserveTurn` counts a paid consultation turn (message or reference search) in the worker before the models are called, only when the consultation uses paid models.

TASK-0077 (audit UX-05): `lib/image-failure.ts` — a skin view that fails to load is probed: 401 session, 404/410 the 24-hour expiry only for an own photo or capture, otherwise unavailable; no answer or 5xx offers «Reintentar».

TASK-0076 (audit UX-03, supersedes TASK-0069's timed lines): `inkStage(task, {stage, queuePosition})` shows the worker's step («paso N de 6») or the queue place; other waits show one description and an indeterminate bar (`.ink-bar-waiting`).

TASK-0075 (audit UX-02): `isCurrentDesign` (`lib/opening.ts`): with a consultation open only a design with its `briefId` is restored as its result or counted by the "design ready" gates; a restored failed job shows its plain message.

TASK-0074 (audit SEG-01): `security-headers.mjs`, applied by `next.config.mjs` to every path: nosniff, frame denial, referrer policy, camera-only permissions, a minimal enforced CSP and the complete CSP as Report-Only; HSTS in production.

TASK-0073 (audit UX-01): «Ocupar toda la zona» opens a confirmation with the current and approximate new size (`lib/zone-size.ts`), offering «Solo ampliar la vista» instead.

TASK-0072: `lib/client-errors.ts` words every failure the client sees (status, body, dropped
connection, non-JSON answer); the worker helpers say `STUDIO_UNAVAILABLE` instead of naming the
worker. The admin panel keeps technical detail.

TASK-0070 (ADR-0031): `liveAgentConfig.textModeration` is `openai` with a live architect and
`OPENAI_API_KEY`; `buildTextScreen` feeds the orchestrator and `screenText`, which the consultation
route applies to an edited `subject.refined` and the generate route to a change request.
`errorResponse` answers `ContentRefusedError` with 422 and its message.

TASK-0069: while an agent works, `InkWorking` shows a gloved hand tattooing a rose, the task's
title, a timed line about its stages, a bar and the clock (`lib/ink-progress.ts`). Nothing in it is
reported by the server: the lines stay on the last stage and the bar never passes 94 %. Used by every
wizard step while busy, by `GenerationProgress` and by the advanced chat; `run()` names the task.

TASK-0068 (ADR-0030): `liveAgentConfig.webImageSearch` is `brave` only with the Claude scout,
`TATTOO_WEB_IMAGE_SEARCH=brave` and `BRAVE_SEARCH_API_KEY`; `referenceBytes` accepts a Brave
thumbnail. The privacy policy names Brave and `IMAGES_VERSION` is `2026-10-01.2`.

TASK-0067: step 3 never dead-ends: with an essential reference missing it leads with «Añadir la
imagen» and offers «Buscar otra vez» and «Continuar sin ella», which warns first and sends
`waive_references`. Disabled answers are visibly dimmed.

TASK-0066: the wizard's pop-ups open below the header (`Confirm belowHeader`: non-modal, own
backdrop), so «Modo avanzado», «Panel» and «Salir» stay usable; the header wraps on a phone. Every
visit starts guided; the mode lasts for the tab (`sessionStorage`). The switch is a pill.

TASK-0065 (ADR-0029): the studio opens on the guided pop-ups (`components/wizard/*`, `lib/wizard.ts`):
idea, missing details, references, editable summary, then progress, result and «listo». The step
resumes from the server's state. `DELETE /api/consultation` starts a new design. The chat and panel
are «Modo avanzado» (remembered in `localStorage`). `save(values)` returns the saved session and
sends an edited professional description with its subject.

TASK-0064 (ADR-0028): signing in opens «Antes de entrar» (terms with age, and image use, two
sections, one button); `/api/auth` refuses without the current versions and sets the signed
`inkcraft_ok` cookie (`lib/consent.ts`); `/api/consent` accepts for an open session. `/api/media`,
`/api/generate` and `/api/captures` answer 428 without it. The studio, the change dialog and the
camera try-on have no consent checkboxes; «Generar» asks through `Confirm` pop-ups only what applies
(`lib/generation-flow.ts`: save, body, summary). `/condiciones` and `/privacidad` are public.

TASK-0062: the sign-in card's brand (`.brand-card`) is centred, its trailing letter-spacing balanced.

TASK-0058 (ADR-0026): `referenceBytes` also downloads an Openverse thumbnail (and no other Openverse
URL). With no reference the review checkbox is hidden and not required, and the "no reference"
blocker is gone from `next-step.ts`.

TASK-0055 (ADR-0025): `/admin` is the administrator's panel. `requireAdmin` checks
`app_metadata.role` with Supabase on every request; `user_metadata` never grants it. The three
`/api/admin/*` routes proxy the worker's admin routes as the administrator (`X-Admin-Id`), and the
panel never requests a file a version marks as showing a body. The header offers "Panel" to
administrators. A successful sign-in records its address, which erasure clears.

TASK-0054 (ADR-0024): `lib/telemetry.ts` forwards the consultation's model calls, each turn (what
the client wrote and what the studio answered) and each sign-in to the worker's event route. The
account is set in the handler (`attribute`) and passed explicitly to turn events; a refused
sign-in carries neither address nor account. Tests route events to a collector (`test-setup.ts`).
The sign-in page states what is recorded.

TASK-0047 (ADR-0023): the history note says versions are kept and body photos expire after 24
hours. When a version's skin view has gone with its photo, the design dialog shows a notice in its
place and hides that download, instead of a broken image.

TASK-0053: `/probar` opens with a sticky bar holding "← Volver al estudio" and the brand. As an
installed app there is no browser back button, and the try-on was a dead end without it.

TASK-0051: the studio header is sticky and nothing may override that (a shared `position: relative`
once did, so the brand scrolled away). The design dialog reads images first, then downloads and
the camera, then the change form, so a finished design opens on its pictures. Both are held by
`components/reading-order.test.ts`.

TASK-0049: the header greets the signed-in person ("Hola, <name>": the account's name in Supabase,
else the address before the @) and offers "Salir". Signing out ends the session at Supabase
(`/auth/v1/logout?scope=local`), clears both tokens and the consultation cookie, and cannot fail
for want of Supabase. A consultation now records the account that started it; another account on
the same browser gets none of it and starts clean. Before this, stored work followed the account
(TASK-0046) but the conversation followed the browser.

TASK-0048: the product is "Inkcraft by Aurevanta Labs". `components/Brand.tsx` renders it in two
forms — the Aurevanta symbol as a hallmark in the studio header, the full lockup as a signature on
the sign-in card — with both assets recoloured to the rose gold of the background's veins. The
background photograph and the grain are fixed pseudo-elements under all content. `/brand/*` is
outside the page gate: the sign-in page shows those images to people who are not signed in yet,
and gating them once left it with a broken logo on a plain background.

TASK-0045 (ADR-0021): the studio requires an account. `lib/auth.ts` exchanges credentials for
`HttpOnly`, `SameSite=strict` cookies server side and asks Supabase who a token belongs to rather
than verifying a signature here, so no signing secret lives in this deployment. `requireAccount`
guards every route that spends money or reads stored work; an unconfigured deployment answers 503
rather than opening. An expired access token is renewed from the refresh token and re-issued on the
same response. `middleware.ts` is a cheap cookie-presence gate, **not** the boundary: a forged
cookie reaches the HTML shell and nothing else. There is no sign-up; accounts are created in
Supabase.

TASK-0046: stored work belongs to the account. `worker()` sends the account id as `X-Owner-Id` —
the header the worker scopes every asset, job and vector master by — instead of the consultation
session id, which made the same person on a second device a stranger to their own designs. The
consultation itself stays in the browser's session and keeps the `inkcraft` cookie: only ownership
moved. Reading stored work (history, job status, an image, deletion) therefore no longer requires
a consultation in progress, and those routes answer without one. Retention is unchanged, so "your
designs on another device" means the last 24 hours until TASK-0047 gives them a durable home.

TASK-0042 (ADR-0019): `/probar` is the live camera try-on. `lib/skin-blend.ts` ports the worker's
ink treatment (multiply, ADR-0014 attenuation, TASK-0031 ring) as pure functions; `lib/try-on.ts`
does one frame (placement, rotation box, blend) and the page owns the camera and the loop. **No
camera frame leaves the device**, with one exception (TASK-0050, ADR-0022): a photograph the client
takes with the shutter and then keeps, with adult consent, through `lib/capture.ts` and
`POST /api/captures`, becomes a version of its design (`capture` on the artifact). A source scan
(`probar/no-upload.test.ts`) fails the suite if the page, compositor or blend gain any egress, or if
`lib/capture.ts` sends anywhere else, more than once, or on a timer. The app is
installable (`app/manifest.ts`, `public/sw.js`), and the worker never caches or intercepts `/api/`.
**Known limitation:** no body segmentation yet, so the design follows the pointer rather than the
limb and ink placed off the body draws on the background.

TASK-0041: the panel has a "Cuerpo" selector (hombre/mujer) that sends `placement.bodyType`; the
master brief shows it and blocks acceptance until it is chosen.

TASK-0038 (ADR-0017): a catalogue pick sets the style and is recorded as `session.stylePick`; it
is not a reference and is never uploaded. `catalogueBytes` and `isCatalogueSource` are removed, so
the TASK-0030 note below describes code that no longer exists. With no reference at all, the
blocker points to «Referencias».

TASK-0037: the acceptance gate is enforced by the server, no longer only by the interface.
`accept_brief` recomputes the brief from server state, refuses an incomplete brief (422) and a
signature differing from what the client read (409), and records the server's signature; it
returns before the orchestrator, which now calls a model. `POST /api/generate` refuses a new
design (409) unless the stored acceptance matches the brief as it now stands, so a change after
accepting withdraws it. Edits to an accepted design do not pass through this guard.

TASK-0036: the change form in the preview can attach up to three reference photos. They upload
through `/api/media` with `purpose: 'edit'`, which forwards only the image and consent to the
worker and does not add them to the consultation (the accepted brief is not reopened); upload
errors show inside the dialog. Their IDs travel as `edit.referenceIds`.

TASK-0034: the panel shows a "Siguiente paso" banner and, under "Generar diseño y plantilla", the
list of what still blocks generation — each item links to its section (`lib/next-step.ts`, pure
and unit-tested; the gates themselves are unchanged, WEB-INV-001). Anchors `step-permisos` and
`step-diseno` now exist, so the progress rail's last two steps also scroll somewhere. A proposed
size is pre-filled with a note, and saving the panel sends a size only if the client changed it,
so an untouched proposal stays a proposal. With `TATTOO_SCOUT_PLANNER=claude` the scout also gets
the Sonnet vision judge.

TASK-0033: `studio-server.ts` composes the live orchestrator with `buildOrchestrator(env)`.
Model-backed agents are **opt-in**: `TATTOO_CONSULTATION_BACKEND=claude|openai` enables the prompt
architect, `TATTOO_SCOUT_PLANNER=claude` enables the Sonnet query planner. A credential alone
enables nothing, so a developer key cannot make tests call a paid API, and the canned fixture is
never used on the live route. This is composition only; the merge rules live in `consultation`
(WEB-INV-001). With both unset the route behaves exactly as before.

TASK-0030: a catalogue pick is read from disk by `catalogueBytes`, not fetched. Its identifier
must resolve in the catalogue and the path is rebuilt from the resolved entry, so traversal fails
at resolution rather than at the filesystem. `referenceBytes` and its allowlist are untouched:
that allowlist is the SSRF control, and widening it to read a file already on disk would be a
poor trade. Introduced by TASK-0028, which wrote a web-relative `source` into a field
`referenceBytes` parses with `new URL`, throwing before the worker was ever reached.

TASK-0029 (ADR-0013): generation is gated on the client accepting the master brief. Acceptance is
stored as a signature of the lines they read, so any later change withdraws it on its own rather
than leaving a stale flag. The technical disclosure shows the brief the studio receives, not the
assembled prompt string, which embeds anti-injection framing. **The gate is presentational**: a
caller bypassing the interface can still submit a job. It is a usability control, not a security
one, and server-side enforcement remains open.

TASK-0028 (ADR-0012): the preferences panel offers three catalogue variants once a style is
known, labelled as illustrative renders rather than photographs of real work. The pick travels
as an identifier and is resolved against the catalogue by the BFF route, which refuses anything
that does not resolve, so no caller can introduce an arbitrary image as a studio reference. The
48 catalogue images are static assets under `public/style-library/`.

TASK-0026 (ADR-0010): a persistent progress rail names the five steps and marks each completed,
current or pending, with optional steps labelled. It is derived from the session the page already
holds and gates nothing (WEB-INV-001); its conditions read the same values the panel gates on, so
it cannot report readiness the panel would refuse. The millimetre fields are labelled optional and
show the proposed size as placeholder. Above 1024px the preferences panel is sticky with its own
scroll, so it cannot outgrow the viewport and the primary action stays reachable. The background is
authored in CSS with an inline SVG grain rather than a shipped image asset.

TASK-0024 (ADR-0008): the coverage controls no longer describe themselves as uniformly visual.
Smaller/larger remain view-only; "Ocupar toda la zona" states that it changes the print
millimetres and that the figure comes from reference adult anatomy to be confirmed with a
tattooer. The displayed sheet size follows the returned brief, so it changes on a zone revision
and not on a nudge. No business rule moved here (WEB-INV-001).

TASK-0023: print preview labels refer to sheet format and disclose possible white margins
when the mockup used a source crop. On reload restore the latest successful history result
unless the current job is still active, avoiding stale-result display after correction.

TASK-0022: preview offers smaller/larger/fill-zone controls explicitly labeled as visual
coverage, leaving PDF millimetres unchanged. Initial submission omits untouched placement
for generated anatomy; touching sliders or adding a body photo retains manual placement.

TASK-0021: the preview accepts a bounded natural-language change request and an explicit
create-version action, preserving prior results on failure. The session's latest 20 successful
jobs can be reopened/branched while retained. BFF forwards only parent job ID, request and
idempotency key for edits; worker resolves owned source data. Adult/processing consent remains
required. Existing progress and zoom apply to revisions.

TASK-0020/REQ-001..003: official crest is fetched only at the exact allowlisted HTTPS path,
bounded and rasterized locally before worker moderation. Reject embedded external SVG resources.
Missing-reference retry is explicit. Submission and queued/running jobs show indeterminate
progress, phase and elapsed time. Both output previews offer keyboard-accessible 100..400%
detail views with pan/scroll/reset. No invented completion percentage.

TASK-0019/REQ-011: submit colour/accent briefs without the obsolete colour rejection.
The action reads "Generar diseño y plantilla". Surface the worker's approximation notice.

TASK-0019/REQ-009: preference errors identify the schema field that failed. A palette
failure must not be presented as a size error; 200 x 300 mm is valid. Explicit invalid values still fail; optional colours follow REQ-010.

## Responsibility

Presentation and backend-for-frontend. Renders the consultation, the design gallery, the placement
editor and the handoff sheet, and brokers requests to the worker. It holds no domain logic.

## Source ownership

`apps/web/`

## Public interfaces

HTTP routes consumed by the browser:
- consultation turn exchange
- design listing and version history
- upload initiation and consent capture
- placement editing (position, rotation, scale in mm)
- job submission and status polling
- handoff sheet download

## Inputs and outputs

Inputs: user interaction and uploads. Outputs: rendered UI and job references. Long operations
return a `JobRef` immediately; the UI polls or subscribes for completion.

## Domain invariants

- WEB-INV-006: Every route that spends money or reads stored work verifies the account with
  Supabase before acting, and refuses when authentication is unconfigured (TASK-0045, ADR-0021).
  The middleware is a convenience and never the check.
- WEB-INV-001: No business rule lives here. Anything that needs testing without a browser belongs
  in another module.
- WEB-INV-002: Every request crossing into the worker is validated against its contract schema at
  the boundary (CODE-INV-001).
- WEB-INV-003: The UI never presents a generated artifact without the visualization disclaimer
  (PROD-INV-005), and never presents aged output as a prediction (PROD-INV-003).
- WEB-INV-004: Consent and age affirmation are collected before any upload control is enabled
  (SEC-INV-005, SAFETY-INV-003).
- WEB-INV-005: A user can reach deletion of their photos and derived artifacts from the UI without
  contacting support, and deleting them does not cost them the account (TASK-0046).
- WEB-INV-007: The owner the worker is told about is the account id and nothing else. A browser
  session never determines whose stored work a request reaches (TASK-0046).

## Data / persistence

Session and auth state only. No domain persistence.

## Dependencies

`contracts`, `consultation`, and the worker via HTTP and job references.

## External integrations

None directly. When opted in (TASK-0033), the server process runs `consultation`'s reasoning
calls (Anthropic or OpenAI) with the client's chat text; no image leaves through that path.

## Error semantics

Job failures render as the typed failure reason from `jobs`, in user-facing language. Provider
internals are never surfaced.

## Security and permissions

Enforces authentication and authorization on every route. Signed media URLs are requested per
view and never embedded in cacheable markup.

## Observability

Route latency and error rates, consultation abandonment, upload funnel completion, deletion
request counts, handoff sheet download counts. The last is the product's key success metric.

## Performance / operational constraints

The placement editor must stay responsive while manipulating high-resolution assets; it works on
downscaled proxies and applies the transform at full resolution server-side.

## Tests / verification

Component and route tests. End-to-end tests over the critical paths: idea to handoff sheet, and
upload to deletion. Accessibility checks to WCAG 2.1 AA on the primary flows.

## Known uncertainties and debt

- Authentication is Supabase, decided by ADR-0021 (TASK-0045). Exercised against the real service
  once, for sign-in only (TASK-0045/ev-003); renewal is still proven only against the fake.
- Work owned by an account from TASK-0046 onward is unreachable to work stored before it, which was
  keyed by session id. Nothing migrates it; it expires on the normal 24-hour schedule.
- Whether job completion uses polling or server-sent events is undecided.
- The placement editor interaction model is undesigned.
- The shell has no styling, no layout system and no accessibility work. The WCAG 2.1 AA
  commitment under *Tests / verification* is unaddressed and currently unmeasured.
- `vitest` runs in a `node` environment. Component rendering tests will need a DOM environment,
  which is added by the first task that renders something worth asserting on.

## Alignment notes

Partially aligned as of TASK-0014. The consultation turn exchange and real-time brief tracking
surface are implemented in `apps/web` via the Next.js BFF route `/api/consultation`, backed by
`@tattoo/consultation`. Image references are supported. Design gallery, placement editor and
handoff sheet remain planned for future tasks.

## Change history

- 2026-09-19: Created during SDD bootstrap.
- 2026-09-19 (TASK-0001): Next.js shell added, building under TypeScript strict mode. Disclaimer
  copy established with tests.
- 2026-09-19 (TASK-0014): Added consultation turn exchange BFF route, reference image upload,
  and real-time brief tracker UI.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| BFF with no domain logic | OBSERVED | Delegated to @tattoo/consultation | PASS |
| App builds under strict TypeScript | VERIFIED | `pnpm --filter web build`, `tsc --noEmit` exit 0 | PASS |
| Disclaimer copy exists and is non-empty | VERIFIED | `src/content/disclaimers.test.ts`, 4 tests | PASS |
| Consultation turn exchange route | VERIFIED | `src/app/api/consultation/route.test.ts` | PASS |
| Disclaimer shown on every artifact | INTENT | WEB-INV-003; no artifacts exist yet | NOT_RUN |
| Authentication approach | INTENT | ADR-0021: Supabase, server-side cookies | NOT_RUN against the real service |

## TASK-0019 current implementation and remaining intent

The active page uses server-owned HttpOnly sessions, bounded input, same-origin checks and worker service authentication. Generation submits server brief revisions and owned references; uploads, job polling, restored current job, geometric placement, explicit mm, review-gated downloads and deletion are wired. Black contour limitations are visible; unsupported colour fails before generation. Desktop rendered checks and 390px overflow check are in TASK-0019 evidence.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.

TASK-0019/REQ-010: Palette is optional for colour and accents. Missing palette delegates selection to the design process using the idea and reviewed references; it is not a missing client answer. Empty panel input is omitted. Explicit palettes remain bounded and validated. Colour rendering remains pending.
