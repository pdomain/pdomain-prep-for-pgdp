# pdomain-prep-for-pgdp — Overview

## Purpose

A web application that converts a folder or zip of scanned book images (e.g.
from Internet Archive) into a PGDP-ready submission package: standard proofing
images, OCR text files, and a zip ready for upload.

Designed for two audiences from one codebase:

- **A solo proofer on a laptop** — one-line `curl … install.sh | sh` (same
  pattern as `pdomain-ocr-cli`). The installer detects NVIDIA CUDA via `nvidia-smi`
  and picks the matching PyTorch wheel; Apple Silicon picks up MPS for free;
  CPU-only systems install a pure-CPU build. `pgdp-prep` then opens a browser
  tab. No AWS, no Docker, no PyPI publish step (installs from the latest
  GitHub tag via `uv tool install`).
- **A hosted offering** — same wheel runs in a CPU-only Fargate container that
  defers all GPU work to Modal (or a shared GPU worker), batching most
  GPU-shaped operations on a configurable schedule (default every 5 minutes)
  to minimise cold starts and keep idle cost near zero.

The same Python pipeline runs in both. The only thing that changes between
modes is which adapter is wired in for storage, database, auth, GPU dispatch,
and batch scheduling.

---

## Deployment Shapes

Three shapes, one codebase. Spec 09 has the full breakdown.

| | Local | Self-hosted | Managed |
|---|---|---|---|
| Target user | Solo proofer | Small team | Hosted offering |
| Install | `curl … install.sh \| sh` (uv tool install from GitHub tag) | systemd unit on a VM | ECS Fargate task |
| Storage | Filesystem | Filesystem or S3 | S3 |
| Database | SQLite | SQLite or Postgres | Postgres / Aurora |
| GPU | Local CUDA / MPS / CPU | Local CUDA / Modal | Modal / shared GPU container |
| Auth | None | API key | JWT (Cognito/Auth0) |
| Batch dispatch | Immediate | Immediate | 5-min flush (configurable) |
| AWS required | No | No | Yes |
| Idle cost | $0 | One VM | ~$10–15/month + GPU usage |

Mode is selected at startup by env vars. There is no "local build" vs "cloud
build" — the same wheel ships everywhere.

---

## Architecture

The entire app is a **single Python process** built around FastAPI:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser — React SPA                                                 │
│  Vite-built bundle, served by the same FastAPI process               │
│  Konva canvas · TanStack Query · Zustand · shadcn/ui                 │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │ HTTP/SSE
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  pgdp-prep (FastAPI + uvicorn) — single process                      │
│                                                                      │
│   /                  static SPA bundle (from package resources)      │
│   /api/data/*        project + page CRUD, presigned URLs, jobs       │
│   /api/gpu/*         image processing + OCR (sync or batched)        │
│   /cdn/*             local image files (filesystem mode only)        │
│   /api/auth/*        identity (none / api-key / JWT verify)          │
│                                                                      │
│   ┌─ core/                                                           │
│   │   resolve_page_config · pipeline · ocr · packaging               │
│   │   (mode-agnostic — used everywhere)                              │
│   │                                                                  │
│   ├─ adapters/                                                       │
│   │   storage  · database · auth · gpu                               │
│   │   (one chosen per process; selected by env vars at startup)      │
│   │                                                                  │
│   └─ dispatcher/                                                     │
│       immediate (local/self-hosted) · batched (managed, 5-min flush) │
└─────────────────────┬────────────────────────────┬───────────────────┘
                      │ IStorage                   │ GPUBackend
                      ▼                            ▼
              ┌───────────────┐          ┌──────────────────┐
              │ Filesystem    │          │ Local CUDA       │
              │ or S3         │          │ CPU fallback     │
              └───────────────┘          │ Modal serverless │
                                         │ Shared container │
                                         └──────────────────┘
```

**Data API and GPU API are routes on the same FastAPI app**, not separate
services. (An earlier draft of this spec had a Hono Lambda data API and a
separate FastAPI GPU API. That is now collapsed — see "Why one process" below.)

In **managed mode**, the same FastAPI process runs in a small CPU-only Fargate
container; the `/api/gpu/*` routes dispatch GPU work to Modal (or a shared GPU
container) instead of running pdomain-book-tools in-process. Workbench/interactive
GPU calls fire immediately; long batch jobs queue up and flush every 5 minutes
to amortise cold starts.

---

## Why one process

| Property | Two-stack design (Hono + FastAPI) | One-stack design (FastAPI only) |
|---|---|---|
| Languages | TypeScript + Python | Python |
| Deploy units | 2 (Lambda zip, EC2 systemd) | 1 (wheel or container) |
| Local install for a non-AWS user | `npm` + `uv` + 3 .env files + 3 terminals | `pip install pgdp-prep` |
| Cold-start (Lambda data API) | ~200 ms | n/a — Fargate stays warm |
| Type sharing | `packages/api-types` workspace | OpenAPI codegen → TS |
| Frontend distribution | Separate static bucket | Bundled into the wheel |

The 200 ms cold-start advantage Hono had on Lambda doesn't matter when the
CPU-only Fargate container is always-on. Local mode never sees Lambda at all.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + TypeScript |
| Canvas | react-konva |
| Frontend state | Zustand (UI) + TanStack Query v5 (server state) |
| Styling | Tailwind + shadcn/ui |
| Routing | React Router v7 |
| Backend | FastAPI (Python 3.13) + uvicorn |
| Pipeline | pdomain-book-tools (CuPy / cv2 / DocTR / Tesseract) |
| Type sharing | OpenAPI spec generated by FastAPI → `openapi-typescript` codegen |
| Build | hatchling + hatch-vcs (version from git tags); static frontend included via `force-include` |
| Distribution | `uv tool install git+https://…@<tag>` — no PyPI publish; install.sh resolves the latest tag from GitHub |

`pdomain-book-tools` is the shared library powering image processing and OCR. It is
used by `pdomain-ocr-cli`, `pd-ocr-labeler`, `pd-ocr-trainer`, and this app.

---

## Configuration

Three resolution tiers (full detail in spec 01):

| Layer | Storage | Edited from |
|---|---|---|
| `SystemDefaults` | `~/.config/pgdp-prep/defaults.json` (local) / `system_defaults` row (hosted) | Settings page |
| `ProjectConfig` | `projects/<id>/project.json` | Configure page Book Settings |
| `PageRecord` | `projects/<id>/pages/<idx0>.json` (one file per page) | Page tagger + PageWorkbench |

A single resolver (`resolve_page_config`) merges all three into a flat
`ResolvedPageConfig` consumed by the pipeline. Pipeline steps never look at
the raw config layers.

---

## GPU Backend Abstraction

```python
class GPUBackend(Protocol):
    async def process_page(self, req: ProcessPageRequest) -> ProcessPageResponse: ...
    async def run_ocr(self, req: OcrPageRequest) -> OcrPageResponse: ...
    async def run_batch(self, items: list[BatchJobItem]) -> list[BatchJobResult]: ...
```

| Backend | Runtime |
|---|---|
| `local` | In-process CuPy + DocTR (CUDA required) |
| `cpu` | NumPy + cv2 + CPU PyTorch DocTR; auto-selected when no CUDA |
| `modal` | Dispatches each call to a Modal function (cold-start ~10–15 s, $0.40/GPU-h T4) |
| `shared_container` | HTTP client to a long-running GPU ECS task shared across tenants |

CPU mode is **first-class**, not a degraded experience. A 400-page book takes
~3 hours of CPU compute on a modern laptop; the UI surfaces "CPU mode — slow"
without blocking any feature.

---

## Pipeline as a per-page DAG of stages

The canonical pipeline shape is a **DAG of named per-page stages**, defined
in `docs/specs/pipeline-task-model.md`. Each page runs through 22 stages
(`ingest_source` → `thumbnail` → `auto_detect_attrs` →
`auto_detect_illustrations` → `decode_source` → `initial_crop` → … →
`canvas_map` → `ocr_crop` → `ocr` → `text_postprocess` → `text_review`,
plus the `blank_proof_synth` alt for blank pages and
`extract_illustrations` parallel chain), each producing a typed
in-memory artifact and a persisted on-disk artifact. Stages have explicit dependency edges; re-running one marks
all downstream stages on the same page `dirty` and they re-execute on
the next "run dirty" sweep.

**Splits are sibling pages, not config.** When the user splits a page
into N regions, the framework creates N child page rows, each with its
own `parent_page_id` and `source_crop_bbox`. Each child runs the full
DAG independently with its own stage state, so the user can re-run
e.g. `auto_deskew` on just one column of a two-column page.

**Long operations** (project-level fan-outs of a stage across all
pages, packaging) are submitted as jobs. The API returns a `job_id`
immediately; the frontend subscribes to
`GET /api/gpu/jobs/{job_id}/events` (SSE) for live progress, including
per-stage transitions.

In **managed mode**, batch jobs go through the `BatchDispatcher` (5-min
default flush window). Interactive operations (single-stage runs from
the workbench) bypass the dispatcher and fire immediately, accepting
the Modal cold-start tax when it happens.

`build_package` is **gated by `text_review.clean` on every page**. When
the user submits `build_package` and any page is unreviewed, the job
transitions to a special `awaiting_review` state and parks until the
last page is marked reviewed (or the user cancels).

See `docs/specs/pipeline-task-model.md` for:

- The full per-stage DAG and dependency map.
- The `page_stages` SQLite schema and dual-write reconciliation rules.
- The bounded deferred-write executor and device-aware in-memory
  artifact model.
- The `STAGE_IMPL[stage_id][device]` registry that replaces the
  former `LocalBackend` / `CpuBackend` class hierarchy.
- Splits as sibling pages (`parent_page_id`, recursive splits,
  unsplit).

---

## Key Flows

### New project from zip

1. `POST /api/data/projects` → server creates project record + project.json
2. Browser uploads zip (presigned PUT in hosted mode; direct upload in local mode)
3. `POST /api/gpu/ingest` → server extracts zip, generates thumbnails, writes
   page records, runs per-page `ingest_source` / `thumbnail` /
   `auto_detect_attrs` / `auto_detect_illustrations` stages → returns `job_id`
4. Browser polls job until complete; page tagger becomes available

### Per-page workbench (interactive editing)

1. User opens a page in the workbench. The stage chain rail shows the
   current state of every stage (`clean`, `dirty`, `failed`, `not-run`,
   `not-applicable`).
2. User clicks "Run stage: threshold" (or adjusts threshold and clicks
   "Apply + Run from here").
3. `POST /api/pages/{page_id}/stages/threshold/run?mode=single` — the
   stage runs synchronously, the rail updates with the new status, and
   downstream stages cascade to `dirty`.
4. The artifact viewer pane fetches `GET /api/pages/{page_id}/stages/threshold/artifact`
   to show the new output side-by-side with the upstream input.

### Project-level fan-out

1. `POST /api/projects/{id}/run-dirty` — submit a project-wide
   "run-everything-dirty" job.
2. In local/self-hosted: starts immediately, fans out per-page
   `page.run_dirty` work through the in-process executor.
3. In managed: queues for the next dispatcher flush (≤5 min).
4. SSE stream pushes per-stage progress events to the UI.

### Build package (with text-review gate)

1. `POST /api/projects/{id}/build-package`.
2. If every proof-range page is `text_review.clean`, the job runs
   immediately.
3. Otherwise the job lands in `awaiting_review` state — the project
   banner shows "N pages awaiting review", with a click-through to the
   next unreviewed page.
4. As the user marks each page reviewed, the runner re-checks the
   gate. When the last page is clean the job auto-resumes.

---

## Scope

**In scope:** the full per-page stage DAG (22 stages from `ingest_source`
through `text_review` + the `blank_proof_synth` and
`extract_illustrations` branches), PageWorkbench with stage-chain rail
and per-stage artifact viewer, visual page tagger with per-page config,
split-as-sibling-pages editor, illustration extraction, PGDP package
assembly with the text-review gate.

**Out of scope:** PGDP project submission (still a manual step on
distributedproofreaders.org), DocTR model training (lives in `pd-ocr-trainer`).

**Stretch goal — multi-user:** the architecture does not block it. `Project`
and `Job` carry `owner_id` (defaults to `"default"` in single-user mode); auth
middleware always resolves a user identity from the token; `GET /projects`
filters by `owner_id`. Swap the auth adapter from `none` to `jwt` and it works.

---

## Relationship to Existing Projects

`pdomain-book-tools` is the shared Python library used here, in `pdomain-ocr-cli`,
`pd-ocr-labeler`, and `pd-ocr-trainer`. They all consume the same OCR/geometry
primitives; this app additionally consumes `core/` (this repo's pipeline
orchestration on top of pdomain-book-tools).
