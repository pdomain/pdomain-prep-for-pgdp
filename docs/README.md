# pd-prep-for-pgdp — Architecture Docs

These docs describe **what's actually built**. They complement the design specs
in [`../specs/`](../specs/) (which capture the *target* design).

| Doc | Topic |
|---|---|
| [`01-overview.md`](01-overview.md) | The 30-second tour: what runs where |
| [`02-backend.md`](02-backend.md) | FastAPI app, adapters, settings, lifespan |
| [`03-pipeline.md`](03-pipeline.md) | Steps 0–10, job runner, dispatcher, OCR |
| [`04-frontend.md`](04-frontend.md) | React SPA pages, state, auth |
| [`05-events-and-jobs.md`](05-events-and-jobs.md) | Job events, SSE, in-process priority queue |
| [`06-deployment.md`](06-deployment.md) | Local / self-hosted / managed shapes |
| [`07-testing.md`](07-testing.md) | TDD conventions, test layout, what's covered |
| [`08-roadmap.md`](08-roadmap.md) | What's done + what's next, by priority |
| [`futures/`](futures/) | Future-state design notes (not current milestones) |

## Status snapshot

- **128 tests passing** in `tests/` (`PYTHONPATH=src .venv/bin/python -m pytest tests/ -q`)
- 22 build iterations logged in
  `~/.claude/projects/-workspaces-ocr-container-pd-prep-for-pgdp/memory/project_state.md`
- **Backend** is feature-complete relative to specs 01/02/04/05/07/08; the CPU
  pipeline is wired end-to-end (ingest → process_page → ocr → text_postprocess
  → package), with auto-detect + layout-aware OCR via `pd-book-tools`.
- **Frontend** covers every spec-03 page (ProjectList, ProjectConfigure,
  PageWorkbench, TextReview, ReviewQueue, Jobs, Settings, Login). All pages
  are functional; Vitest tests are deferred (no npm in the devcontainer).
- **Adapters fully wired:** `IStorage` (filesystem + S3), `IDatabase` (SQLite),
  `IAuth` (none / apikey / jwt), `GPUBackend` (CPU + Modal scaffold).
- **Adapters scaffolded:** `IDatabase` Postgres, `GPUBackend` local-CUDA,
  `GPUBackend` shared-container.
- **Repo is not yet a git repo.** User to `git init` + create remote.

## Spec ↔ implementation index

| Spec | Coverage |
|---|---|
| 00 — Overview | Architecture matches; "single FastAPI process" delivered. |
| 01 — Configuration model | `core/models.py`, `core/config_resolver.py`, `core/prefix.py`. |
| 02 — Pipeline steps | `core/ingest.py`, `core/pipeline/{process_page,crop_for_ocr,blank_proof}.py`, `core/text_postprocess.py`, `core/illustrations.py`, `core/packaging.py`. |
| 03 — UI layout | `frontend/src/pages/*.tsx`. |
| 04 — GPU acceleration | `adapters/gpu/{base,cpu,modal_backend,modal_app,local,shared_container}.py`. CPU + Modal scaffold are tested; CUDA + shared-container are scaffolds only. |
| 05 — Illustrations | `core/illustrations.py` + `auto_detect_illustrations` in ingest. |
| 06 — Page workbench | `frontend/src/pages/PageWorkbenchPage.tsx` (Konva + drag-create + drag-resize). |
| 07 — API design | `api/data/`, `api/gpu/`, `api/auth/`, `api/cdn.py`, `api/env_js.py`. |
| 08 — Data models | `core/models.py` (every model from spec 08). |
| 09 — Deployment | `Dockerfile`, `install.sh`, `install.ps1`, `Makefile`, `.github/workflows/release.yml`. |

## How to read these docs

Specs in [`../specs/`](../specs/) are the **source of truth for design**. These
docs are about **the actual code** and may diverge from the spec when an
intentional decision was made; those divergences are called out explicitly.

For a new contributor (or AI assistant), the recommended reading order:
1. [`../CLAUDE.md`](../CLAUDE.md) — quick start
2. [`01-overview.md`](01-overview.md) — high-level shape
3. [`08-roadmap.md`](08-roadmap.md) — what to work on next
4. The spec for whatever layer you're touching, then the docs for that layer
