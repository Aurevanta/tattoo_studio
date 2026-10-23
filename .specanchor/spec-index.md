# Specification Index

| Module | Source paths | Persistent spec | Status | Last reviewed |
|---|---|---|---|---|
| contracts | `contracts/*` | `.specanchor/modules/contracts.spec.md` | draft | 2026-09-19 |
| web | `apps/web/*` | `.specanchor/modules/web.spec.md` | draft | 2026-09-19 |
| consultation | `packages/consultation/*` | `.specanchor/modules/consultation.spec.md` | draft | 2026-09-19 |
| generation | `services/worker/generation/*` | `.specanchor/modules/generation.spec.md` | draft | 2026-09-19 |
| flash | `services/worker/flash/*` | `.specanchor/modules/flash.spec.md` | draft | 2026-09-19 |
| stencil | `services/worker/stencil/*` | `.specanchor/modules/stencil.spec.md` | draft | 2026-09-19 |
| mockup | `services/worker/mockup/*` | `.specanchor/modules/mockup.spec.md` | draft | 2026-09-19 |
| orchestration | `services/worker/orchestration/*` | `.specanchor/modules/orchestration.spec.md` | draft | 2026-09-26 |
| media | `services/worker/media/*` | `.specanchor/modules/media.spec.md` | draft | 2026-09-19 |
| safety | `services/worker/safety/*` | `.specanchor/modules/safety.spec.md` | draft | 2026-09-19 |
| jobs | `services/worker/jobs/*` | `.specanchor/modules/jobs.spec.md` | draft | 2026-09-19 |
| platform | root manifests, `scripts/*`, `infra/*`, `.github/*`, `services/worker/app/*` | `.specanchor/modules/platform.spec.md` | draft | 2026-09-19 |

Every module remains `draft` at product level. All have source code. TASK-0019 connects
the local studio and records current checks. A bounded live public-reference generation
has produced artifacts; that is integration evidence, not a cultural/print-quality certification.

No module is `verified` as a whole. `contracts` comes closest, but its remaining schemas do not
exist and its field set is unproven against any consumer.

## Global specifications

- `.specanchor/global/architecture.spec.md`
- `.specanchor/global/coding-standards.spec.md`
- `.specanchor/global/project-setup.spec.md`
- `.specanchor/global/product-behavior.spec.md`
- `.specanchor/global/quality-and-security.spec.md`

## Tasks

| Task | Title | Status |
|---|---|---|
| TASK-0001 | Repository skeleton, toolchain and CI | verified |
| TASK-0019 | Audit remediation and common-master local studio | in_progress; product target PARTIAL |
| TASK-0002 | TattooBrief contract and dual-runtime validation | verified |
| TASK-0003 | Consultation state machine and OpenAI GPT-6 Astra engine | verified |
| TASK-0004 | Generation provider adapter and the flash render path | verified |
| TASK-0011 | Record first CI execution and the existence of a remote | verified |
| TASK-0012 | Safe photo ingestion: media storage and the safety gate | verified |
| TASK-0014 | Web Consultation Surface and Reference Image Ingestion | verified |
| TASK-0015 | Client-Centric Generation of Stencil and Hyperrealistic Body Mockup | verified |
| TASK-0016 | Multi-Agent Orchestrator with Specialized Research and Visual Creation Agents | verified |
| TASK-0017 | Visual Internet Scout Agent and 3-Agent Triad for Historical Fidelity | verified |
| TASK-0032 | Model-backed agent triad, worker LangGraph pipeline and the AI blend | in_progress; all but the real blend landed (blocked on TASK-0008) |
| TASK-0033 | Claude architect and scout on the live consultation route | verified (local checks) |
| TASK-0034 | Proposed size, relevant references (vision judge), clear next step | verified (live + local checks) |
| TASK-0035 | Misspelt whole-zone request left the tattoo the same size | verified (local checks) |
| TASK-0036 | Attach photos to a change request; an edit keeps a resized size | in_progress (local checks pass; live check pending) |
| TASK-0008 | Mockup blend spike: geometry tolerance and provider selection | blocked (method + harness ready; needs credentials, corpus, terms review) |

## Findings

| Finding | Summary | Status |
|---|---|---|
| FINDING-0001 | OpenAI's image model offers editing, relevant to the ADR-0002 mockup blend | open |
| FINDING-0002 | The brief contract permits size combinations flash cannot render | open |
| FINDING-0003 | `media` and `safety` declared a circular dependency | resolved (TASK-0012) |
| FINDING-0004 | Live consultation route bypasses `ConsultationProvider`; Claude agents not yet active | resolved (TASK-0033) |
| FINDING-0005 | `design_vector` is keyed by the design hash alone; a repeated store orphans a vector | resolved (TASK-0126) |
| FINDING-0006 | A changed letter in a heavy font escapes the geometry check's tile limit | open |

## Decisions

| ADR | Decision | Status |
|---|---|---|
| ADR-0001 | Hosted image models behind a provider adapter | proposed |
| ADR-0002 | Hybrid mockup: geometric warp then constrained AI blend | proposed |
| ADR-0003 | Stencil via native line-art pass and centerline vector trace | proposed |
| ADR-0004 | One JSON Schema as the source of truth for both runtimes | accepted (validated TASK-0002) |
| ADR-0005 | Next.js BFF and Python worker separated by a job queue | proposed |
| ADR-0006 | Privacy posture for body photographs | proposed |
| ADR-0015 | Two-tier agent orchestration: TS triad + worker LangGraph pipeline | proposed |
| ADR-0016 | Activate the constrained AI blend for the mockup (supersedes an ADR-0007 clause) | proposed |
| ADR-0017 | A catalogue pick settles the style; it is not a reference (amends ADR-0012) | accepted |
| ADR-0018 | The AI finish runs on generated plates, chosen by measurement, and falls back (amends ADR-0016) | accepted |
| ADR-0019 | The camera try-on runs entirely on the client's device | accepted |
| ADR-0020 | One self-hosted node, on the owner's own hardware (decides hosting and region) | accepted |
| ADR-0021 | Accounts come from Supabase; the studio asks it who is calling | accepted |
| ADR-0025 | The administrator sees the studio's use and its designs, never a body | accepted |
| ADR-0026 | A generic idea needs no reference; Openverse joins Commons | accepted |
| ADR-0027 | Skin plates come from a reviewed library | accepted |
| ADR-0028 | Terms and image consent are accepted at sign-in | accepted |
| ADR-0029 | The studio is guided by pop-ups; a professional description is drafted and editable | accepted |
| ADR-0030 | Brave web image search, only for essential references, judged | accepted |
| ADR-0031 | Sexually explicit ideas are refused when they are told | accepted |
| ADR-0032 | A client shares a design with their tattooer through a link | accepted |
| ADR-0033 | A design can be turned round a reference lower leg in 3D | accepted |
| ADR-0034 | A sleeve goes all the way round a lower leg or a forearm | accepted |
| ADR-0035 | A sleeve's stencil follows the limb and comes in four panels | accepted |
| ADR-0036 | The client places, sizes, stretches and turns the design on the skin, live | accepted |
| ADR-0037 | Every tattooable zone can be seen in 3D, on one reference body | accepted |
| ADR-0038 | The 3D views show a masculine or a feminine body, as the design was made for | accepted |
| ADR-0039 | Images attached to the idea are numbered and read by the prompt architect | accepted |
| ADR-0040 | A reference may show people who cannot be identified; an identifiable person is refused | accepted |
| ADR-0041 | A client names, deletes and copies their designs one by one (amends ADR-0023) | accepted |
| ADR-0042 | The mockup and the 3D views place a design by the same millimetres (amends ADR-0036, ADR-0027) | accepted |
| ADR-0043 | A size change is a print change, confirmed, and every view follows it (amends ADR-0008, ADR-0042) | accepted |
| ADR-0044 | Two stencil regimes: native line art, and approximate contours of a colour design (amends ADR-0003) | accepted |
| ADR-0024 | The studio records what it does, and never what a body looks like | accepted |
| ADR-0023 | Designs last; photographs of a body expire (refines MEDIA-INV-006) | accepted |
| ADR-0022 | One camera photograph may be kept, when the client takes it and chooses to (amends ADR-0019) | accepted |

## Invariant ownership

Cross-cutting invariants are declared in the global specs and enforced in named modules:

| Invariant | Declared in | Enforced by |
|---|---|---|
| ARCH-INV-001 sole outbound model call | architecture | generation (VERIFIED, TASK-0004) |
| ARCH-INV-005 schema parity across runtimes | architecture | contracts (VERIFIED, TASK-0002) |
| PROD-INV-001 design geometry preserved in mockup | product-behavior | mockup |
| PROD-INV-002 stencil prints 1:1 | product-behavior | stencil |
| PROD-INV-003 aging is illustrative | product-behavior | mockup, web |
| PROD-INV-004 no living-artist mimicry | product-behavior | safety, consultation, flash (PARTIAL: constructions only) |
| SEC-INV-001 no training on user photos | quality-and-security | generation |
| SEC-INV-002 EXIF stripped | quality-and-security | media (VERIFIED, TASK-0012) |
| SEC-INV-004 cascade deletion | quality-and-security | media (VERIFIED, TASK-0012) |
| SEC-INV-006 gates always active | quality-and-security | safety (PARTIAL: denies all) |
| SEC-INV-007 no unscreened photo leaves the system | quality-and-security | safety, media, generation |
