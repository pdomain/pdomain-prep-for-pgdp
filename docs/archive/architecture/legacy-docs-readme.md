# pdomain-prep-for-pgdp — Docs

Three kinds of docs live here:

1. **[`architecture/`](architecture/)** — "this is how the system works now."
   Reference docs for the as-shipped code. Validated against source.
2. **[`specs/`](specs/)** — design docs and proposals. Authoritative for
   *intent*; the architecture docs are authoritative for *as-built*.
3. **Roadmap** — open work in [`08-roadmap.md`](08-roadmap.md); chronological
   shipped log in [`08-roadmap-shipped.md`](08-roadmap-shipped.md).

## Architecture reference (`architecture/`)

| Doc | Topic |
|---|---|
| [`architecture/01-overview.md`](architecture/01-overview.md) | The 30-second tour: what runs where |
| [`architecture/02-backend.md`](architecture/02-backend.md) | FastAPI app, adapters, settings, lifespan |
| [`architecture/03-pipeline.md`](architecture/03-pipeline.md) | Per-page stage DAG, OCR, packaging |
| [`architecture/04-frontend.md`](architecture/04-frontend.md) | React SPA pages, state, auth |
| [`architecture/05-events-and-jobs.md`](architecture/05-events-and-jobs.md) | Job events, SSE, in-process priority queue |
| [`architecture/06-deployment.md`](architecture/06-deployment.md) | Local / self-hosted / managed shapes |
| [`architecture/07-testing.md`](architecture/07-testing.md) | TDD conventions, test layout, what's covered |
| [`architecture/architecture-decisions.md`](architecture/architecture-decisions.md) | Locked decisions (AD-1 … AD-10) |
| [`architecture/dev-local-upgrade-flow.md`](architecture/dev-local-upgrade-flow.md) | `dev-local`-aware `upgrade-deps` guard |

## Specs (`specs/`)

Design docs for in-flight or recently-landed features. The pipeline
task-model spec ([`specs/pipeline-task-model.md`](specs/pipeline-task-model.md))
is the long-form record behind AD-1 — treat it as a canonical reference,
not a draft.

## Other directories

- [`design-brief/`](design-brief/) — design-system brief for the hi-fi
  redesign (active).
- [`futures/`](futures/) — future-state design notes (not current milestones).
- [`archive/`](archive/) — completed implementation plans and process docs
  kept for historical context. Not authoritative for current state — read
  `architecture/` for as-built reference.

## How to read these docs

Specs in [`specs/`](specs/) are the **source of truth for design**. Docs in
[`architecture/`](architecture/) are about **the actual code** and may diverge
from the spec when an intentional decision was made; those divergences are
called out explicitly.

For a new contributor (or AI assistant), the recommended reading order:

1. [`../CLAUDE.md`](../CLAUDE.md) — quick start
2. [`architecture/01-overview.md`](architecture/01-overview.md) — high-level shape
3. [`architecture/architecture-decisions.md`](architecture/architecture-decisions.md) — locked decisions
4. [`08-roadmap.md`](08-roadmap.md) — what to work on next
5. The spec for whatever layer you're touching, then the architecture doc for that layer

## Spec ↔ implementation index

| Spec | Coverage |
|---|---|
| 00 — Overview | Architecture matches; "single FastAPI process" delivered. |
| 01 — Configuration model | `core/models.py`, `core/config_resolver.py`, `core/prefix.py`. |
| 02 — Pipeline steps | `core/ingest.py`, `core/pipeline/{stage_dag,stage_registry,stage_runner,crop_for_ocr,blank_proof}.py`, `core/text_postprocess.py`, `core/illustrations.py`, `core/packaging.py`. Proofing-chain sub-steps are individual `STAGE_IMPL` entries (AD-7). |
| 03 — UI layout | `frontend/src/pages/*.tsx`. |
| 04 — GPU acceleration | `adapters/gpu/{base,modal_backend,modal_app,shared_container}.py` + `bootstrap._NoOpGPUBackend`. CPU/Local backends deleted M6 — per-page stages run through `STAGE_IMPL[stage_id][device]`. |
| 05 — Illustrations | `core/illustrations.py` + `auto_detect_illustrations` in ingest. |
| 06 — Page workbench | `frontend/src/pages/PageWorkbenchPage.tsx` (Konva + drag-create + drag-resize + rotate handle). |
| 07 — API design | `api/data/`, `api/gpu/`, `api/auth/`, `api/cdn.py`, `api/env_js.py`, `api/healthz.py`, `api/server_info.py`. |
| 08 — Data models | `core/models.py` (every model from spec 08). |
| 09 — Deployment | `Dockerfile`, `install.sh`, `install.ps1`, `Makefile`, `.github/workflows/{ci,release}.yml`. |
