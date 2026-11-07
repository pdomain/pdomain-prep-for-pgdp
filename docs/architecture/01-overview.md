# 01 — Architecture Overview

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
- **Read when:** orienting to the system or tracing its main components.
- **Search terms:** architecture overview, FastAPI, pipeline, adapters.

## What this app does

The app turns scanned book images into proofing PNGs, OCR text, illustration crops, and a PGDP submission ZIP.
The supported implementation is local-first: filesystem storage, SQLite, and registry-selected CPU/GPU stages.
Remote adapters are extension points, not proof of equivalent hosted behavior. Page lifecycle and project-stage
execution still depend on local project stores.

## The single-process picture

The React SPA talks to FastAPI through HTTP and Server-Sent Events (SSE). FastAPI serves the bundled SPA,
runtime configuration, auth, data routes, ingest/helpers/job routes, and filesystem asset access.

- `/env.js` exposes runtime settings without publishing an API key.
- `/api/data/*` owns projects, pages, stage execution/settings, ordering, search, and artifacts.
- `/api/gpu/*` owns ingest, illustration helpers, and job access; it has no legacy process-page or OCR-page route.
- `/cdn/*` serves filesystem assets. Authenticated deployments use ownership-checked reads.
- `/api/suite/*` supplies shared suite settings and discovery, with middleware guarding mutations.

The in-process runner polls queued jobs. Current page stages dispatch through `get_stage_impl` into
`V2_STAGE_IMPL`; the retained `STAGE_IMPL` table is legacy vocabulary. Bootstrap constructs a priority
executor, but current stage calls do not all run through that executor.

## Module layout

| Location under `src/pdomain_prep_for_pgdp/` | Responsibility |
|---|---|
| `bootstrap.py`, `settings.py`, `__main__.py` | Startup wiring, environment settings, and CLI entry point |
| `core/ingest.py`, `core/page_store_factory.py`, `core/prep_extension.py` | Import and shared page lifecycle |
| `core/pipeline/stage_dag.py`, `stage_registry.py`, `stage_runner.py` | 24-stage vocabulary, implementations, and execution |
| `core/pipeline/page_stage_writer.py`, `stage_write_executor.py` | Synchronous rollback-capable writes and deferred writes |
| `core/pipeline/project_stages.py`, `prep_aggregate.py` | Project-stage rows and workflow events |
| `core/numbering*.py`, `core/pipeline/steps/` | Numbering, text products, validation, and packaging |
| `core/ocr.py`, `hf_models.py`, `illustrations.py` | OCR, model resolution, and image regions |
| `core/job_runner.py`, `core/job_events.py`, `dispatcher/` | Jobs, transient progress events, and dispatcher infrastructure |
| `adapters/storage/`, `database/`, `auth/` | Configurable application adapters |
| `api/` | Auth, data, GPU/job, asset, suite, and runtime routes |

Shared remote GPU classes come from `pdomain_ops.gpu`; local `adapters/gpu/` no longer contains the former
backend modules. The frontend lives in `frontend/src/`, with XState machines, typed services, and a tool registry.

## What changes between deployment shapes

Settings selects storage, database, authentication, and GPU mode. The database builder can select a partial
Postgres adapter, while page lifecycle remains local. Dispatcher selection follows the configured dispatch
interval; it is not inferred from a deployment label. Managed multi-instance behavior remains deferred.

See [backend wiring](02-backend.md), [deployment](06-deployment.md), and the
[deferred roadmap](../plans/roadmap.md#deferred--remote--cloud-mode).

## Dependency surface

The backend uses Python 3.13, FastAPI, Pydantic, uvicorn, anyio, and OCR/image libraries.
Current dependency minimums include `pdomain-book-tools>=0.28.0`, `pdomain-ops>=0.11.2`,
`pdomain-book-contracts>=0.2.0`, and `eventsourcing>=9.5`. See `pyproject.toml` for the full constraints and extras.

The frontend uses React 19, Vite, TypeScript, XState v5, TanStack Query, react-konva, React Router, and Tailwind.
The repo toolchain pins Node 24 and pnpm 11. OpenAPI generation writes `frontend/src/api/types.gen.ts`;
some consumers still use the handwritten `types.ts` surface.

## State ownership

| State | Owner | Storage |
|---|---|---|
| Generic page/project lifecycle, blobs, prep page extensions | Per-project pdomain-ops page service | `.pd-pages/events.db` and content-addressed blobs |
| Prep workflow history | `PrepProjectAggregate` | Per-project `events.db` |
| Page-stage rows, jobs, configuration, search | `IDatabase` | Application database |
| Project-stage rows | `ProjectStageStore` | Per-project `project_stages.db` |
| Stage artifacts | Page/project stage writers | Files under `<data_root>/projects/<id>/` |

Prep display order is `PrepPageExtension.idx0`, sorted by page listing. Reorder updates those extensions;
it does not reorder generic project membership or rewrite generic `PageRecord.page_index`.
This split ownership does not constitute a single atomic transaction across every store.

## Evidence

Verified from source on 2026-11-07: `bootstrap.py`, `settings.py`, `core/page_store_factory.py`,
`core/pipeline/stage_dag.py`, `stage_registry.py`, `project_stages.py`, `core/job_runner.py`, and `pyproject.toml`.
The [pipeline](03-pipeline.md), [events/jobs](05-events-and-jobs.md), and [numbering](08-page-numbering.md)
docs describe the execution contracts. This audit does not claim a live remote deployment was tested.
