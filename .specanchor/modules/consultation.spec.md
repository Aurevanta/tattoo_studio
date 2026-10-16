---
type: module-spec
module: consultation
status: draft
source_paths:
  - packages/consultation/*
last_reviewed: 2026-09-19
---

# Module: consultation

TASK-0114 (ADR-0040): rule 12 adds that incidental people in an attached image are left out. A figure the client explicitly asks for is described as a generic figure, never as the person in the photograph.

TASK-0113 (ADR-0039, amends TASK-0033's text-only turns): `handleUserInteraction` takes, as its last argument, the screened images attached to the idea (data URLs labelled «Imagen N»). `consultArchitect` puts them on the client's last turn only; the scout, the content screen and later turns never get them, and the session keeps their references (`/api/media?id=…`), never their bytes. The Claude and Astra providers send each image after a text block with its label and the turn's text last. System-prompt rule 12 tells the architect to resolve «la imagen N» into words in `subject.refined`/`elements`, describe only what is visible, and never identify, name or imitate an image's author (PROD-INV-004). No body photograph reaches a language model.

TASK-0104 (ADR-0034): `sleeveLimb` reads a sleeve from the client's words («manga», «de la rodilla al tobillo», «todo el antebrazo», «que rodee…»). `extractPreferences` then sets `orientation: wrapping`, the zone on that limb (the calf or the outer forearm by default) and `wrapSize`. «Estilo manga», «anime» and the upper arm are never sleeves. A later «grande» or the size proposal does not replace a sleeve's size.

TASK-0100: `REFERENCE_USER_AGENT` (`InkCraft/0.1 (https://inkcraft.aurevanta.es; reference research)`) is how the scout and the web identify themselves to image sources.

TASK-0098: curated entity queries **supplement** the planner instead of winning over it (supersedes TASK-0034's rule): they run first, the planner adds every other named element, a planned query naming one curated entity becomes that verified query, at most five. `curatedQueries` also reads «desamparados», «Valencia CG/C.F.» and «Mestalla»; the planner returns one query per named element, up to five.

TASK-0090: rule 10 describes the design as drawn on paper, the zone only as the shape to fill, never the body or skin.

TASK-0073 (audit UX-01): `statedSize` reads compact and labelled sizes in either order; a single dimension is kept as `size.stated` and only the other is proposed (`proposeSize` keeps it across zone changes; the summary says which is the client's).

TASK-0070 (ADR-0031): `agents/content-screen.ts` holds `TextScreen`, `OpenAITextModeration`
(`omni-moderation-latest`, refuses at `sexual` ≥ 0.9 or `sexual/minors`, lets the idea through on
failure) and `ContentRefusedError`. `OrchestratorAgent` takes an optional screen and throws before
any model or search; the architect's required, nullable `contentRefused` (system-prompt rule 11)
throws after it. The session is never changed by a refused message.

TASK-0068 (ADR-0030): `BraveImageSearch` (`agents/brave-search.ts`) is the open-web source. With a
judge, `VisualSearchAgent` asks it only for essential queries the licensed sources lacked and shows
its candidates to the judge (`judgedWebImages`, sharing `judge` with the licensed path).

TASK-0067: `OrchestrationSession.waivedReferences` lifts the essential-reference block once the
client chooses to go on without it (cleared when the idea changes); `ofSpanish` contracts «de el».

TASK-0065 (ADR-0029): the architect drafts `subject.refined`, a professional description in Spanish
that keeps every element the client named (system prompt rule 10); `sanitizeArchitectSlots` bounds
it at 1200 characters, `mergeArchitect` lets the client's edit win, the brief carries it and the
master brief shows it as «Descripción profesional».

TASK-0064: the closing "Propuesta lista" message points at «Generar diseño y plantilla», where the
summary is confirmed; «Aceptar y continuar» no longer exists.

TASK-0061: the planner searches for the subject only, never a style, its ingredients or a tattoo;
`subjectQuery` strips such words from what it returns and drops a query left empty. The judge reads
the client's whole idea and refuses style ingredients and any tattoo, tattoo design or flash
(PROD-INV-004), correcting TASK-0058's rule that called a tattoo design on paper fine.

TASK-0058 (ADR-0026): "referencia visual" is gone: only a missing essential reference blocks, and
the phase is ready once the brief is complete. The scout searches Openverse beside Commons
(`license_type=modification`, `mature=false`, only thumbnails matching `isOpenverseThumbnail`);
with a judge both sources are offered, without one Openverse only when Commons is empty. The judge
rejects any image showing a person or a body part.

TASK-0054 (ADR-0024): `usage.ts` announces every model call — the consultation, the scout's
planner and judge — with tokens, duration and outcome, to one listener the web tier installs. A
listener that throws is ignored; a call's outcome never changes.

TASK-0039: a message naming both black-and-grey and colour reads as
`black_and_grey_with_accent`; "sin color" is not a colour cue. **Supersedes the TASK-0033 merge rule
for style, colour and zone:** `textReadings` finds what the keyword rules read from the current
message alone, and where the architect answered, `mergeArchitect` adopts its reading instead. Panel
choices are never reread; the architect still never sets the side or the size. The system prompt
adds that colour mode decides colour and that a whole-zone request gets the whole zone's size.

TASK-0041: `placement.bodyType` is the presented sex of the generated plate. The keyword rules and
the architect propose it (it is merged from the architect, unlike side); the client sets it in the
panel; TASK-0039's reread applies. `buildMasterPrompt` shows it ("Hombre"/"Mujer") and lists it in
`missing` until chosen, so acceptance is blocked without adding a fourth chat question.

TASK-0038 (ADR-0017): `offerAsPick` replaces `offerAsReference`; a pick is
`OrchestrationSession.stylePick`, not a `ReferenceImage`, and `'style_library'` is gone from
`verification`. `buildMasterPrompt(slots, references, pick?)` names the variant while the style
matches it. The orchestrator forgets a pick when the style changes, and a pick does not satisfy the
"referencia visual" readiness rule. This supersedes the TASK-0028 and TASK-0030 notes below.

TASK-0037: `briefSignature` is the single function client and server use to compare an accepted
brief, so a correct acceptance cannot be refused and a stale one cannot be allowed.

TASK-0034 (user feedback after trying the app): (1) **Proposed size.** Once a zone is known and no
size is stated, `proposeSize` sets one — the architect's recommendation scaled to fit the zone
span, or a medium fraction of the zone — flagged `size.proposed`, shown as "propuesto por
nosotros", re-made when the zone changes, and always beaten by a stated size (within ADR-0010;
amends TASK-0033's "the architect never sets the size" at the user's request). (2) **Relevant
references.** The Sonnet planner returns short concrete-noun queries with `essential` and a
Spanish label; curated entity queries (TASK-0020) win over it. The scout gathers up to three
Commons candidates per query and a Sonnet vision judge (`ClaudeReferenceJudge`, thumbnails sent
as base64) keeps only those that depict the request, rejecting historical emblem versions; a judge
failure keeps nothing unverified; the official Valencia CF crest is trusted by source. (3) **Only
essential references block**, named by label. (4) The closing chat message states the adopted
proposal and the one next action. Architect and scout run concurrently.

TASK-0033 (resolves FINDING-0004): `OrchestratorAgent` takes an optional architect
(`ConsultationProvider`). On a chat turn with text it sends the conversation — text only, no
reference images — and `agents/architect.ts` sanitizes the proposal against the contract
vocabulary (anything else is dropped, CONSULT-INV-003) and merges it: explicit statements and
earlier decisions win, the architect fills gaps, and technical proposals (linework, shading) may
replace only their untouched defaults. **The architect never sets the size or the side of the
body** (ADR-0010/0011; the side rule follows a live run where Opus guessed it). Both Claude agents
use the official `@anthropic-ai/sdk` with structured outputs (`output_config.format`, the schema's
enums are the contract vocabulary), `effort: low`, and refuse to read a `max_tokens` or `refusal`
stop. The schema keeps at most 24 optional parameters, an API limit found live. The session keeps
the scout's searched queries as `referencePlan`; missing references are judged against that plan,
not the deterministic queries (a live end-to-end run showed the old check blocked readiness). A
non-empty mimicry flag declines imitation like the regex branch (CONSULT-INV-005). Any architect
failure falls back to the deterministic path and logs a fixed line with no user text. Architect
proposals are reviewed by the client in the master brief before generation (ADR-0013); they are
not yet flagged as proposals there (known debt). The shared prompt now lists the 16 contract styles
and asks for `mimicryDetected: null` unless a named living artist is requested. Both reasoning
backends time out after 30 s.

TASK-0032 (ADR-0015): this module owns the interactive agent tier. The prompt architect
(`agents/master-prompt.ts` + provider) runs on **Claude Opus 5.5** and the visual scout
(`agents/image-scout.ts`) runs on **Claude Sonnet 5**, both behind `ConsultationProvider`, selected
by configuration alongside the existing GPT-6 Astra backend; the fixture provider stays the offline
path. It remains the only tier that makes a reasoning-LLM call (ARCH-INV-001 clarification), and it
still never generates imagery (CONSULT-INV-001). The scout searches licensed sources first (Commons)
and uses a bounded open-web image search only as a fallback when licensed sources return nothing;
every scouted candidate passes `safety` screening before it can become a reference and is marked a
candidate, never `user_supplied`. The visual creator (`agents/creator.ts`) stays a hard failure
here — creation is the worker `orchestration` graph (ARCH-INV-001).

TASK-0030: a catalogue reference's `label` is the Spanish style and variant name. TASK-0028 put
the English prompt text there, which the interface then showed to the client.

TASK-0029 (ADR-0013): `agents/master-prompt.ts` projects the brief a client accepts from the same
slots and references that are sent for generation, so it cannot drift from what is actually made.
It marks studio decisions as proposals — a size exactly filling the zone span, the technical
linework weight — and names what is still missing rather than presenting an incomplete brief as
ready. Exported on the `./master-prompt` subpath so a client bundle can use it without pulling the
orchestrator.

TASK-0028 (ADR-0012): `agents/style-library.ts` turns a style into three catalogue offers and a
chosen offer into a `ReferenceImage` marked `style_library` — never `user_supplied`, because it
is an illustrative render the studio generated rather than the client's own material. Exported
on the `./style-library` subpath so a client bundle can import it without pulling the
orchestrator, which drags `node:crypto` through the build.

TASK-0027 (ADR-0011): free-text extraction recognises the six added styles, and a qualitative
size (`grande`, `mediano`, `pequeño` and their variants) resolves to millimetres as a fraction
of the named zone, read from the shared contract. No size is proposed when the zone is unknown,
because it would be a guess about a body part the client has not named. An explicit measurement
always wins.

TASK-0026 (ADR-0010): size is no longer pushed into `missingFields`. The provider prompt already
recommends a size per anatomy, and `missingPreferences` never gated on it, so reporting it as
outstanding asked the client to settle a decision that had already been taken for them.

TASK-0020/REQ-001: retrieve Valencia CF's live official navigation crest with provenance,
fall back to filtered Commons queries, isolate per-entity failures, and allow a bounded
retry of missing references preserving the initial subject and existing references.

## Responsibility

Act as an experienced tattoo artist taking a brief. Turn a vague idea into a complete, validated
`TattooBrief` by asking targeted questions. It produces a contract, not a conversation transcript.

## Source ownership

`packages/consultation/`

## Public interfaces

- `start(idea, reference_images?) -> ConsultationState`
- `advance(state, user_message, reference_images?) -> ConsultationState` — a state machine step
- `brief(state) -> TattooBrief | Incomplete` — returns a brief only when every required slot is
  filled and valid

## Inputs and outputs

Input: free-text user messages and optional reference images (sketches, photo references, motifs).
Output: a progressively filled brief plus the next question to ask.

## Domain invariants

- CONSULT-INV-001: This module never generates imagery. It only produces briefs (ARCH-INV-001).
- CONSULT-INV-002: A brief is emitted only when it validates against `tattoo-brief.schema.json`.
  Partial briefs are explicitly typed as incomplete.
- CONSULT-INV-003: Free-text style input is mapped onto the closed curated vocabulary. Unmapped
  styles prompt a clarifying question rather than passing through raw.
- CONSULT-INV-004: Size is captured in millimetres. The design process proposes it from the body
  zone and the idea rather than demanding it, and it is never reported as a missing client answer
  (ADR-0010). An explicit client value always wins, and the proposal is shown rather than applied
  silently. Amended by TASK-0026: the original text required asking explicitly, which contradicted
  the shipped provider prompt and predated the reference anatomy ADR-0008 introduced.
- CONSULT-INV-005: A request to imitate a named living artist is declined in-conversation with an
  explanation, and the brief is steered to the underlying style instead (PROD-INV-004).

## Data / persistence

Consultation state persists per session so a user can resume. Transcripts follow the brief
retention lifecycle, not the photo lifecycle.

## Dependencies

`contracts`, `safety`.

## External integrations

OpenAI API targeting **GPT-6 Astra** (`gpt-6-astra`) for multimodal reasoning, reference image
analysis, and structured tool extraction. Alternatively the Claude API (TASK-0032, ADR-0015):
**Claude Opus 5.5** for the prompt architect and **Claude Sonnet 5** for the visual scout, selected
by configuration, through the official `@anthropic-ai/sdk`. Claude extraction uses structured
outputs (`output_config.format`), not prose JSON: live, prose JSON was truncated by reasoning
tokens. Verified live 2026-09-26 (TASK-0033 EV-006..010).

## Error semantics

Typed errors for: model unavailable, extraction produced invalid data, policy refusal. An
extraction that fails validation retries once with the validation error as feedback, then
surfaces a clarifying question rather than guessing.

## Security and permissions

Reference images (motifs, existing artwork references, sketches) are accepted for style and motif
analysis. In accordance with SEC-INV-007, personal body photographs for mockup placement are
handled by the safety module and do not enter the consultation prompt directly. Since TASK-0113
(ADR-0039) the architect also sees the images a client attaches to the idea, only after the input
gate passed them and only on that message.

## Observability

Turns to a complete brief, slot-fill rates, clarification loops per slot, decline counts by
reason. A slot needing many clarifications indicates a badly worded question.

## Performance / operational constraints

Interactive and synchronous. Each turn must feel conversational, which bounds model latency
choices. This is the one path in the system not routed through `jobs`.

## Tests / verification

The state machine is tested deterministically with recorded model responses (fixture provider). A scripted corpus of
idea-to-brief conversations asserts that each reaches a valid brief. Style mapping is tested
against a labeled fixture set including adversarial artist-name requests.

## Known uncertainties and debt

- The question set and its ordering are designed in TASK-0003.
- How many turns users tolerate before abandoning is unknown.
- Offline fixture provider covers CI test execution.

## Alignment notes

Implementation initiated in TASK-0003.

## Change history

- 2026-09-19: Created during SDD bootstrap.
- 2026-09-19 (TASK-0003): Added OpenAI GPT-6 Astra integration and multimodal reference image support.
- 2026-09-26 (TASK-0032, ADR-0015): Architect backend landed — `ClaudeConsultationProvider`
  (Claude Opus 5.5, Anthropic Messages API), shared `CONSULTATION_SYSTEM_PROMPT` now used by both
  backends, and a config-driven `selectConsultationProvider` with the fixture as the offline path
  (8 tests). Scout landed — `ClaudeScoutQueryPlanner` (Claude Sonnet 5) and injectable
  `ScoutOptions` on `VisualSearchAgent` (licensed first, bounded open-web fallback, every candidate
  screened, fail closed; defaults unchanged, 8 tests). Neither Claude agent is on the live web
  route yet: `OrchestratorAgent` still extracts with regex and builds a default scout
  (FINDING-0004).
- 2026-09-26 (TASK-0033): Architect on the live route via `agents/architect.ts` (sanitize, merge,
  text-only turns, fallback); shared prompt aligned to 16 styles; 30 s provider timeouts. Resolves
  FINDING-0004.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| Typed state machine, not an agent framework | INTENT | TASK-0003 spec | NOT_RUN |
| OpenAI GPT-6 Astra tool-use structured extraction | INTENT | TASK-0003 spec | NOT_RUN |
| Question set design | INFERRED | TASK-0003 implementation | NOT_RUN |

## TASK-0019 current implementation and remaining intent

Active OrchestratorAgent uses cumulative explicit slot extraction, at most three questions, and the canonical TattooBrief validator. Commons search returns candidates with query, source and licence; missing entity references block readiness. The legacy fixture state machine remains test/legacy code, not the active web route. General-language extraction beyond the supported vocabulary remains limited.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.

TASK-0019/REQ-010: Palette is optional for colour and accents. Missing palette delegates selection to the design process using the idea and reviewed references; it is not a missing client answer. Empty panel input is omitted. Explicit palettes remain bounded and validated. Colour rendering remains pending.
