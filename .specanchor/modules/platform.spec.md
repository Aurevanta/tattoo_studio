---
type: module-spec
module: platform
status: draft
source_paths:
  - .gitattributes
  - .github/*
  - .npmrc
  - .prettierignore
  - .prettierrc.json
  - CLAUDE.md
  - eslint.config.mjs
  - infra/*
  - package.json
  - pnpm-workspace.yaml
  - scripts/*
  - services/worker/.python-version
  - services/worker/app/*
  - services/worker/pyproject.toml
  - tsconfig.base.json
last_reviewed: 2026-09-19
---

# Module: platform

TASK-0114 (ADR-0040): the `CONTAINS_PERSON` refusal says «una persona que se puede reconocer», suggests cropping it out, and says small, distant people do not matter.

TASK-0113 (ADR-0039), `app/studio.py`: `GET /studio/media/{id}?preview=1` answers an owned reference as a JPEG of at most `PREVIEW_EDGE_PX` (1568) on its longest side, for the prompt architect; anything else is 404. `DELETE /studio/media/{id}` (`Studio.discard`) deletes an owned reference with its cascade and its asset row and records `deletion/reference`; one any of the account's jobs names is refused with 409, and anything not an owned reference is 404. It frees a place in the account's ten-upload cap.

TASK-0110 (ADR-0038): `design_body` and `design_zone` name a design's body: the plate's body (`plate_body`), or none on the client's own photo. A new result carries `placement` with it. A sleeve's stencil and panels are unrolled on `wrap_region(...).for_body(...)`, which is the neutral profile on an own photo.

TASK-0108: the studio serves every result with its zone (`jobs.queue.body_zone`); `app/tests/test_studio.py` checks it through `get` and `history`.

TASK-0107 (ADR-0036): an edit carrying `placement` is a re-placement (`reposition`). It derives the millimetres from the parent's placement (`manual_layout`) and never from the client. When they change, it rescales the vector per axis and re-exports SVG, PDF and the mirrors. When the proportions change, it resamples the raster master too. It records `transform.placement` and `stretch` (carried by later re-placements), runs the finish graph (ADR-0018), and writes a notice with the millimetres, the stretch and the angle («la plantilla se imprime recta»). A placement mixed with `coverage` or `referenceIds` is refused, and so is a stretch of a design without a vector (`NO_VECTOR_STRETCH`). Besides «Ocupar toda la zona», the editor's confirmed save is the second control that changes the print size (amends TASK-0073).

TASK-0105 (ADR-0035), `app/studio.py` and `app/shares.py`: a sleeve's `stencil`, `stencilMirror`, `pdf` and `pdfMirror` are its unrolled skin, and its result adds `panels` and `panelsMirror`. The tattooer's link shares them when present (`SHARED_IF_PRESENT`).

TASK-0104 (ADR-0034), `app/studio.py`: a sleeve is drawn, cleared of backdrop and has its seam repaired (stage `seam`): once, and again if `seamless` still reads a cut. It is then fitted to its proportions. `compose_sleeve` lays the design's middle half over the zone's plate. The result carries `sleeve_notice` («Manga completa…», and a line when the join may still show). The coverage controls refuse a sleeve with `SLEEVE_FIXED`.

TASK-0100: an upload refused because the moderation provider has no credit says «El estudio no puede revisar imágenes ahora mismo. Inténtalo más tarde…» instead of retrying in seconds.

TASK-0097 (ADR-0032): `app/shares.py` — `ShareLedger` (SHA-256 digest of a 24-byte token, 30 days, 20 open per account, revoke, forget on erasure) and `shared_design`/`shared_files`. Routes: `POST /studio/shares`, `GET /studio/shares/open/{job}`, `DELETE /studio/shares/{job}` (owner); `GET /studio/shares` and `/studio/shares/media/{asset}` with the service token and `X-Share-Token`, rebuilt from the stored job and validated against `shared-design`.

TASK-0095: `GET /studio/quota` answers designs and turns used, limit and remaining for the calling account, and `resetsAt` (next UTC midnight).

TASK-0094: the worker's `/studio/events` accepts `client_error` from the web (`WEB_EVENT_KINDS`); it appears in the overview's recent errors.

TASK-0092 (audit 2026-10-08 SEG-04): the workspace overrides also pin `postcss>source-map-js` ^1.2.2 and `next>sharp` ^0.35.5.

TASK-0090: `make_artwork` reviews every artwork; a misread one is redrawn once with a correction, a second misread fails with `ARTWORK_MISREAD`.

TASK-0089: `make_artwork` returns `clear_backdrop(native)` for every artwork, new or edited.

TASK-0086: `Studio.generate` reports `stencilReview` with each result.

TASK-0085: the runbook test asserts the sign-in requirement and the daily limits come before the deployment steps.

TASK-0083 (audit SEG-03): `pnpm-workspace.yaml` overrides `next>postcss` to `^8.5.28`; `pnpm audit --prod` is clean.

TASK-0081: password recovery needs Supabase SMTP and `/restablecer` among its allowed redirect URLs (`infra/README.md`).

TASK-0080 (audit ARQ-04): `infra/README.md` describes authentication, daily limits, Supabase's role, the security-header check and current troubleshooting.

TASK-0079 (audit ARQ-01): `consultations` table and `GET/PUT/DELETE /studio/consultations/{id}`, per owner, 24 h after the last change, removed on erasure. Prettier uses `endOfLine: auto` and ignores the local `.claude/settings.local.json` (ARQ-04).

TASK-0078: settings `TATTOO_DAILY_DESIGNS`, `TATTOO_DAILY_DESIGNS_TOTAL`, `TATTOO_DAILY_TURNS`; `POST /studio/quota/turns`; a reached limit answers 429. The compose file passes the three settings to the worker.

TASK-0076: `Studio.generate` reports `references`, then each graph node through `NODE_STAGES`; a re-placement reports `placing`.

TASK-0074: ESLint no longer asks plain `.mjs` modules for type annotations they cannot carry; JSDoc documents them.

TASK-0073 (audit UX-01, ADR-0008 amended): `resizes_print` — only an edit with `coverage: "full"` changes print millimetres. An initial design keeps its accepted size; a placement-only whole-zone phrase is refused with `ZONE_NEEDS_CONTROL`.

TASK-0072: the router's 422 answers pass through `for_client`.

TASK-0071: `REFUSED_UPLOAD` in `app/studio.py` gives each gate reason its own message (a real
person, explicit content, a failed check, no check); the refused-upload event records it.

TASK-0070 (ADR-0031): the web service also receives `OPENAI_API_KEY`, for the free text
moderation of the client's words (only with a live consultation backend).

TASK-0068: the compose web service passes `TATTOO_WEB_IMAGE_SEARCH` and `BRAVE_SEARCH_API_KEY`.

TASK-0060 (ADR-0027): `Studio.plate` serves the library plate and falls back to the provider;
`build_studio` passes `PlateLibrary()`. `python -m app.build_plate_library [--zone Z] [--body B]
[--force]` builds the library with OpenAI whatever the configured backend.

TASK-0058 (ADR-0026): a job may carry no reference. `design_parent` returns the first reference or
none, so a reference-free design is its own lineage root; the analysis call is skipped
(`NO_REFERENCES`).

TASK-0056: Coolify injects every variable it holds into every compose service, declared or not,
so the compose file does not decide what the worker receives: the variables in Coolify do. A
placeholder `TATTOO_TELEMETRY_DSN` stopped the worker at startup until it was deleted there.

TASK-0055 (ADR-0025): `/studio/admin/overview`, `/studio/admin/accounts/{id}` and
`/studio/admin/media/{id}`, behind the service token and an administrator id, each recording an
`admin` event. `Studio.admin_asset` serves a file of any account and refuses, with 403, a body
photograph and anything in the photo lifecycle.

TASK-0054 (ADR-0024): the worker opens the event store at startup (`TATTOO_TELEMETRY_DSN` for
Postgres, SQLite otherwise), loads `TATTOO_PRICES`, and exposes `POST /studio/events` for the web
tier. Uploads, kept photos and erasures are recorded; erasure anonymises the account's events.
`infra/supabase/telemetry.sql` creates the table and a least-privilege login. The architecture
test lists `psycopg` as egress and allows it only in `telemetry`.

TASK-0047 (ADR-0023): each stored file follows the lifecycle of what it shows (`lifecycle()` in
`app/studio.py`): composites and backgrounds on the client's own photo are `PHOTO_DERIVED` and
descend from it; everything else is `DESIGN` and descends from the first reference. The purge takes
an optional `now`, keeps successful versions, sweeps failed and cancelled runs after 24 hours, and
drops a kept camera photo's version once its photo is gone. An expired own photo is reported as
`PHOTO_GONE` on generation and on the submit route, instead of an unexplained failure.

TASK-0052: `TATTOO_BFL_BASE_URL` is passed to the worker, EU by default, so the BFL cluster can be
switched from Coolify (to `https://api.bfl.ai` during an EU incident) without a code change. Only a
text prompt goes to BFL. Any URL outside bfl.ai/bfl.ml is refused when the provider is built.

TASK-0050 (ADR-0022): `POST /studio/captures` keeps a camera try-on photograph as a version of the
caller's own design. `Studio.capture` checks the key (a retry returns the stored version without
screening again), the parent (the caller's, succeeded), then stores the photo through `ingest` as a
`body` asset — the own-photo gate, EXIF strip, encryption, the ten-image limit and cascade deletion
all apply unchanged. The version copies the parent's result and adds `capture`; no generation or
edit path reads `capture`, so the photo never reaches an image model.

TASK-0046: the studio's `owner` is the account id, taken from the `X-Owner-Id` header and required
to be a lowercase UUID. The header was `X-Session-Id` and carried the browser's consultation
session; the name follows the meaning now, and uppercase is refused so one account cannot own two
separate piles of work. Deletion no longer blocklists the owner: it records when it happened
(`deleted(owner, at)`), and work that started before that moment refuses to store itself after it
(`still_mine`). A blocklist was harmless for a throwaway session id and a permanent lockout for an
account id. `delete` also clears `design_vector`, whose rows otherwise outlive the assets they
point at.

TASK-0045: `SUPABASE_URL` and `SUPABASE_ANON_KEY` are required by the web service; the compose
file fails the deploy by name when either is missing. The service-role key is deliberately not part
of this deployment. `SUPABASE_URL` is the address Supabase answers on **from inside the web
container**, which is not `localhost` — that is the container itself. On a single host that is the
machine's own LAN address, the Docker bridge gateway, or a service name on a shared Docker network.
The image is `node:22-slim` and carries neither `wget` nor `curl`, so the check is Node's own
`fetch` against `/auth/v1/health` (TASK-0045/ev-003).

TASK-0044: the domain is Coolify's to hold, in **Domains for web** (port 3000); the compose file
must not declare `SERVICE_FQDN_WEB_3000`, because a value there overwrites Coolify's on every
read and the UI then refuses to save, leaving Traefik with no route (404).

TASK-0044: both images build with the compose **project directory at the repository root**, so
`context: .` is correct and `context: ..` points above it; a manual `docker compose` run needs
`--project-directory ..`. The first real deploy failed on exactly this.

TASK-0044: the VM runs **Coolify**, which owns 80/443 and terminates TLS, so our Caddy layer is
removed and **no service binds a host port**; the domain is attached to `web:3000` in Coolify and
secrets live in its environment panel. Required secrets use `${VAR:?}` so a missing one fails the
deploy by name. This amends the TASK-0043 note below.

TASK-0043 (ADR-0020): `infra/` is no longer empty. Two containers —
`web`, `worker` — on one self-hosted node; no service publishes host ports, the worker is pinned to
one replica because its queue is in-process, and state is the `worker-data` volume encrypted with
`TATTOO_MEDIA_KEY`. **Hosting and region are decided: the owner's own hardware.** The web image is
not a Next `standalone` bundle (DEC-003), and contracts are regenerated during the build so a stale
schema cannot ship. `app/tests/test_deployment.py` holds the configuration to its promises.
Sessions stay in memory: a web restart ends every open consultation, documented in the runbook.

TASK-0042: `eslint.config.mjs` gives `**/public/sw.js` the service-worker globals; without it the
app-shell worker fails `no-undef`. PWA assets (`icons/`, `sw.js`) ship from `apps/web/public`.

TASK-0041: no platform code change; `bodyType` flows through the existing job submission to the
worker's `background_prompt`.

TASK-0040 (ADR-0018): the studio wires the finish (`_StudioBlend`, `GeometryCheck(BLEND_TOLERANCE)`)
into new designs and re-placements, marks an own photo as such so the finish declines it, and
reports `generativePostprocess`/`finish` in the transform and a notice line when the finish ships.
`CLAUDE.md`'s geometric-only constraint is replaced accordingly.

TASK-0039: both studio composites (new design and reposition) pass `fit_body=True`, so the mockup
fits the body in the photograph (see `mockup.spec.md`).

TASK-0036: studio job submission checks ownership of `edit.referenceIds`, puts them first in the
design's references (cap 5), re-analyses them, and never short-circuits a change with photos to a
reposition. An edit now takes its millimetres from the parent's **result**: the stored payload
predates a whole-zone resize, so an edit of a resized version had silently shrunk back.

TASK-0031 (ADR-0014): the studio applies the surface attenuation to every body part, not only
the zones the cylinder covers, because the term is read from the photograph rather than assumed.
A revision inherits the parent's value so a re-render does not silently change finish.

TASK-0028 (ADR-0012): `app/build_style_library.py` is the catalogue runner. It lives here, not in
`scripts/` and not in `generation`, because ARCH-INV-001 confines outbound model calls to
`generation` while `generation` may not import `app` without closing a cycle — so the composition
root constructs the provider and hands it over. It is run by hand, never per request, and each
image is a paid call, so it skips anything already on disk unless forced.

TASK-0024 (ADR-0008): `Studio` settles millimetres before anything is drawn at them. A whole-zone
request sets `brief.size` from reference anatomy ahead of the provider call, so the artwork is
composed for the zone rather than scaled into it afterwards. `reposition` re-exports the stencil
and PDF by exact vector scale and makes no provider call, for both zone and nudge requests. The
vector master is kept in an internal `design_vector` table, deliberately outside the
studio-status contract: it is authoritative geometry, not a client artifact. A design stored
before TASK-0024 has no vector, and then keeps its millimetres rather than letting the brief and
the stencil disagree. Auto placement remains calf-only except under a zone request, which extends
it to any zone with reference anatomy.

TASK-0023: initial full-calf text intent and placement revisions compute coverage from
visible artwork bounds. Recomposition retains exact owned master/print/background assets.

TASK-0022: pure coverage revisions bypass artwork generation and stencil tracing entirely,
reuse the owned parent background/master/print assets and store only a new mockup. Legacy
missing backgrounds may be generated. Repeated size operations use the parent result's
actual pixel width, not the original request's stale placement. Initial generated calves
without explicit placement use dimension-responsive illustrative coverage.

TASK-0021 verification isolation: health tests disable .env loading and studio credentials
explicitly; constructing the test app must not open/reset the running local job queue.
The studio boundary resolves edit parents under the same owner, checks master availability,
increments the parent brief revision, and queues the edit idempotently. It saves a background
asset along with the edited master's outputs, with the existing encrypted 24-hour retention.

## Responsibility

Everything that holds the system up rather than being part of it: manifests, workspace wiring, the
worker application shell, configuration, CI, deployment, and the Spec Anchor tooling.

## Source ownership

Root manifests, `scripts/`, `infra/`, `.github/`, `services/worker/app/`, and the project
`CLAUDE.md`.

Note: this module owns files by exact path at the repository root rather than by a recursive glob,
because guard patterns use `fnmatch` where `*` matches slashes. A recursive pattern here would
claim files belonging to other modules.

## Public interfaces

- The worker application entrypoint and its dependency wiring
- Typed settings loaded from environment configuration
- `scripts/check-spec-sync.py`, the documentary coverage guard
- CI workflow definitions

## Inputs and outputs

Inputs: environment configuration. Outputs: a running worker process and CI verdicts.

## Domain invariants

- PLAT-INV-001: `scripts/check-spec-sync.py` is not modified locally. Guard changes come from
  upgrading the `sdd-spec-anchor` skill (SETUP-INV-002).
- PLAT-INV-002: Any new top-level source tree is added to `.specanchor/module-map.json` in the
  same change that introduces it (SETUP-INV-001).
- PLAT-INV-003: Secrets are read from environment configuration and never committed. No spec,
  evidence file or log records a secret value.
- PLAT-INV-004: CI runs the guard and the project test suites as separate checks. A guard pass is
  never reported as functional verification. As of TASK-0002 there are four jobs: `spec-coverage`,
  `typescript`, `python` (a matrix over both Python packages) and `codegen`.
- PLAT-INV-005: Settings are validated at process start. A missing or malformed required setting
  fails startup loudly rather than defaulting.

## Data / persistence

None.

## Dependencies

None at runtime; every other module depends on this one structurally.

## External integrations

CI provider and hosting platform, both undecided.

## Error semantics

Configuration errors fail fast at startup with the offending key named and its value redacted.

## Security and permissions

Dependency and secret scanning run in CI. Deployment credentials live in the CI provider's secret
store, never in the repository.

## Observability

Build and deploy outcomes, guard pass rate, test suite duration, dependency vulnerability counts.

## Performance / operational constraints

CI must stay fast enough to run on every push. The guard itself is near-instant; the test suites
dominate.

## Tests / verification

Settings validation is unit-tested including the failure paths. The guard is exercised in CI on
every change. The skill's own regression suite can be run from the skill folder against temporary
repositories without touching this one.

## Known uncertainties and debt

- Branch protection is not configured, so a passing CI run is advisory rather than enforced;
  `main` accepts direct pushes. Enabling it is an external repository setting requiring its own
  authorization.
- The `--review` coverage gate is not automated in CI. Producing an impact review at CI time from
  a task's recorded classification requires tooling that does not exist. CI runs `--baseline`
  only, and review-based coverage is run locally per task. This is a real gap in enforcement.
- Hosting platform and deployment region are undecided. Region has GDPR residency consequences.
- `esbuild` is the one dependency permitted to run an install script, listed individually in
  `pnpm-workspace.yaml` under `allowBuilds`. Approval is recorded per package rather than
  blanket-enabled, and each future addition is a deliberate decision. Note that pnpm rewrites
  this file itself when `approve-builds` runs, normalising quoting and the key name, so
  hand-formatting it does not survive.
- The worker declares only the settings the shell needs. Engine configuration arrives with each
  engine, so that an unset key always means something genuinely missing.
- Prettier and ESLint now carry a growing exclusion list (Next-generated files, generated
  contract artifacts, corpus fixtures, the pnpm-owned workspace file). Each exclusion is
  justified where it is written, but the list is worth revisiting if it keeps growing.
- There are now two independent Python projects with separate lockfiles. A dependency shared
  between them can drift in version without anything noticing.
- `TATTOO_GENERATION_PROVIDER` defaults to the offline fixture provider. A misconfigured
  deployment therefore produces obviously fake artwork rather than silently spending money
  against a real API. Verify this default is overridden before any real launch.
- The `FAL_KEY` credential is read from the unprefixed variable, matching fal's own
  tooling. It is typed `SecretStr`, so reading it requires an explicit
  `get_secret_value()` call that is visible in review.

- TASK-0025 (ADR-0009): `TATTOO_IMAGE_BACKEND` (`openai`|`bfl`, default `openai`),
  `BFL_API_KEY` (unprefixed, `SecretStr`), `TATTOO_BFL_BASE_URL` (default EU cluster),
  `TATTOO_BFL_BACKGROUND_MODEL`. `build_provider` selects the backend; `bfl` without a key
  raises `SettingsError` rather than silently billing another vendor. `bfl` changes the skin
  background only: `image_model` is still passed through as OpenAI's, because the artwork and
  edit paths are inherited and post to api.openai.com. Two tests pin that, since overwriting
  it with a FLUX model name breaks every design and is invisible until a live call.

## Alignment notes

Aligned as of TASK-0001. The manifests, workspace wiring, worker application shell and CI
workflow listed in `source_paths` now exist and are verified locally.

`infra/*` holds the deployment configuration as of TASK-0043 (ADR-0020): Dockerfiles for the web
and worker, a compose file, the Caddy proxy and the runbook.

This module owns root configuration files by exact path rather than by a recursive glob, because
guard patterns use `fnmatch` where `*` matches slashes. Adding a root config file therefore
requires adding it to the module map by name — TASK-0001 hit exactly this, with five unmapped
files caught by `--baseline`.

## Change history

- 2026-09-27 (TASK-0033): `.claude/launch.json` lets the Claude desktop browser pane start the
  local stack through `scripts/dev.mjs` (web on 3000, worker on 8000). Tooling only; no secrets.
- 2026-09-19: Created during SDD bootstrap.
- 2026-09-19 (TASK-0001): pnpm workspace, uv-managed worker, FastAPI shell with validated
  settings, GitHub Actions workflow with three independent jobs. Module map extended with five
  root configuration files.
- 2026-09-19 (TASK-0013): Egress allowlist in the architectural test widened to
  `generation` and `safety`, matching the amended ARCH-INV-001. Both entries are proven
  non-vacuous by the existing check.
- 2026-09-19 (TASK-0012): Worker gained Pillow and cryptography, plus storage and
  encryption settings. Architectural tests extended with an acyclic-graph check over the
  declared module dependencies and a declared-versus-actual import check.
- 2026-09-19 (TASK-0004): Worker gained the contracts path dependency, an HTTP client for
  the single egress point, and provider settings. Architectural tests added under
  `app/tests/` enforcing ARCH-INV-001 and ARCH-INV-004 by source inspection, because an
  invariant about which modules may do what cannot be owned by one of those modules.
- 2026-09-19 (TASK-0011): Public remote added; CI executed for the first time and passed all five
  jobs on `ubuntu-latest`, confirming the toolchain works outside Windows.
- 2026-09-19 (TASK-0002): `contracts` added to the pnpm workspace and as a uv path dependency of
  the worker. CI grew a Python matrix over both Python packages and a `codegen` job asserting
  generated artifacts match the schema. `.gitattributes` added to normalise line endings, since
  the contracts module asserts two files are byte-identical while development is on Windows and
  CI is on Linux.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| Guard installed verbatim and enforcing | VERIFIED | `--baseline` exit 0; planted-file probe exit 1 | PASS |
| Repository on branch `main` | VERIFIED | `git init` 2026-09-19 | PASS |
| Worker installs, lints, typechecks, tests | VERIFIED | `uv sync`, `ruff`, `mypy`, `pytest` all exit 0 | PASS |
| Settings fail loudly and redact values | VERIFIED | `app/tests/test_settings.py`, 6 tests | PASS |
| CI declares five independent jobs | VERIFIED | Executed; jobs enumerated | PASS |
| CI actually passes | VERIFIED | GitHub Actions run #1, commit 652f938, 5/5 jobs success | PASS |
| Checks pass on Linux | VERIFIED | CI runs on `ubuntu-latest` | PASS |
| Hosting and region | INTENT | ADR-0020: one self-hosted node on the owner's hardware | NOT_RUN (never deployed) |

## TASK-0019 current implementation and remaining intent

scripts/dev.mjs starts local Next.js and one Python worker, generates/preserves ignored local service/encryption secrets, and closes owned child processes on shutdown. app/studio.py is the composition root; settings configure model/runtime/storage. Root commands and Python checks are recorded in TASK-0019 evidence. No commit, deployment or public exposure is part of this task.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.
