# 01 — Architecture Overview

## What this app does

Take a folder or zip of scanned book images (e.g. an Internet Archive scan)
and produce a PGDP-ready submission package: standard proofing images, OCR
text files, illustrations, and the final zip. The full pipeline lives in
`core/` and runs identically on a laptop, a self-hosted VM, or a hosted
Fargate container — only the storage / database / auth / GPU adapters change.

## The single-process picture

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser — React 19 SPA (Vite, TanStack Query, Konva, Tailwind)   │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ HTTP + SSE
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│  pgdp-prep — single Python process (FastAPI + uvicorn)            │
│                                                                   │
│   /                  Static SPA bundle (from package resources)   │
│   /env.js            Runtime config shim (window.__ENV__)         │
│   /api/auth/*        /me + JWT/apikey/none verification           │
│   /api/data/*        Project + page CRUD, presigned URLs, jobs    │
│   /api/gpu/*         Process page, OCR, ingest, packaging, jobs   │
│   /cdn/*             Local image PUT/GET (filesystem mode only)   │
│                                                                   │
│   ┌─ core/            ─ pipeline + OCR + packaging (mode-agnostic)│
│   ├─ adapters/        ─ storage / db / auth / gpu (swappable)     │
│   ├─ dispatcher/      ─ immediate / batched (managed mode)        │
│   ├─ core/job_runner  ─ async poll, fan-out, status broker        │
│   ├─ core/job_events  ─ in-memory pub/sub for SSE                 │
│   └─ core/queue       ─ single-thread executor + 200ms batch win  │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
              ┌───────────────────┼────────────────┐
              ▼                   ▼                ▼
        IStorage             IDatabase       GPUBackend
        ┌──────────┐         ┌──────────┐    ┌────────────────┐
        │filesystem│         │SQLite    │    │CPU (cv2/DocTR) │
        │   or S3  │         │ (or PG)  │    │Local CUDA stub │
        └──────────┘         └──────────┘    │Modal scaffold  │
                                              │Shared container│
                                              └────────────────┘
```

The wheel ships everywhere. The same code runs in every shape; only adapter
selection differs (driven by env vars, see [`06-deployment.md`](06-deployment.md)).

## Module layout

```
src/pdomain_prep_for_pgdp/
├── __init__.py             # version (hatch-vcs-derived)
├── __main__.py             # `pgdp-prep` console entry point
├── settings.py             # pydantic-settings — single Settings instance
├── bootstrap.py            # build_app() — wires adapters, mounts routes
│
├── core/                   # mode-agnostic — used by every shape
│   ├── models.py           # all spec-08 Pydantic models
│   ├── config_resolver.py  # SystemDefaults + ProjectConfig + PageRecord -> ResolvedPageConfig
│   ├── prefix.py           # compute_prefix()
│   ├── assign_prefixes.py  # rewrite prefixes after Step-3 config patch
│   ├── auto_detect.py      # spec-01 page-attribute heuristics
│   ├── ingest.py           # Step 0/1/2 — extract zip, thumbnails, page records
│   ├── pipeline/
│   │   ├── stage_dag.py            # Per-page stage DAG (AD-1, spec pipeline-task-model)
│   │   ├── stage_registry.py       # STAGE_IMPL[stage_id][device] — only execution path (AD-7)
│   │   ├── stage_runner.py         # Runs a single stage; dirty-cascades descendants
│   │   ├── stage_write_executor.py # Bounded ThreadPool + semaphore (AD-6)
│   │   ├── page_stage_writer.py    # commit_stage_artifact{,_multi} dual-write (AD-2)
│   │   ├── crop_for_ocr.py         # ocr_crop stage
│   │   └── blank_proof.py          # blank_proof_synth stage
│   ├── ocr.py              # mirrors pdomain-ocr-cli OCR flow
│   ├── illustrations.py    # extract_illustration + auto-detect via layout model
│   ├── text_postprocess.py # Step 8 — quotes, scannos, hyphenation, regex
│   ├── packaging.py        # Step 10 — build PGDP zip with manifest
│   ├── hf_models.py        # HF Hub download helpers (DocTR + layout)
│   ├── job_runner.py       # InProcessJobRunner — polls, fans out, emits events
│   ├── job_events.py       # JobEventBroker — in-memory SSE pub/sub
│   └── queue/single_executor.py  # Priority queue + 200ms window for GPU work
│
├── adapters/               # one per process — selected at startup
│   ├── storage/{base,filesystem,s3}.py
│   ├── database/{base,sqlite}.py        # postgres deferred
│   ├── auth/{base,none_,apikey,jwt_}.py
│   └── gpu/{base,modal_backend,modal_app,shared_container}.py  # cpu/local deleted M6 (AD-7)
│
├── dispatcher/{base,immediate,batched}.py
│
└── api/
    ├── auth/me.py                   # /api/auth/me
    ├── cdn.py                       # PUT /cdn/{key:path} (filesystem upload)
    ├── env_js.py                    # GET /env.js (runtime config shim)
    ├── dependencies.py              # FastAPI deps (storage, db, auth, gpu, ...)
    ├── data/{projects,pages,system_defaults,assets,jobs,pipeline,search}.py
    ├── gpu/{ingest,illustrations,jobs,schemas}.py   # legacy process-page/ocr routes deleted M6
    ├── healthz.py
    ├── server_info.py
    └── middleware/{error_handler,request_id}.py  # Uniform ApiError envelope + X-Request-Id
```

## What changes between deployment shapes

Per spec 09, **only adapter selection** changes:

| Layer | Local | Self-hosted | Managed |
|---|---|---|---|
| `IStorage` | filesystem | filesystem or S3 | S3 |
| `IDatabase` | SQLite | SQLite or Postgres | Postgres |
| `IAuth` | none | apikey | jwt |
| `GPUBackend` | cpu / local | local / modal | modal / shared_container |
| Dispatcher | `ImmediateDispatcher` | immediate | `BatchDispatcher` (5-min flush) |

`bootstrap.build_app()` reads `Settings`, picks one of each, and assembles
the FastAPI app. Everything in `core/` and `api/` is shape-agnostic.

## Dependency surface

- **Backend** (Python 3.13): FastAPI, uvicorn, pydantic, pydantic-settings,
  sse-starlette, anyio, huggingface_hub, transformers, **pdomain-book-tools** (the
  shared OCR/geometry/image-processing primitive lib pinned to v0.9.0).
  Optional extras: `[s3]` boto3, `[postgres]` psycopg + SQLAlchemy,
  `[modal]` modal, `[jwt]` pyjwt, `[cuda]` cupy + nvimgcodec.
- **Frontend** (Node 20): React 19, Vite, TypeScript, TanStack Query v5,
  react-konva, react-router v7, Zustand, Tailwind, openapi-typescript.

## Where state lives

| Kind | Storage | Notes |
|---|---|---|
| `SystemDefaults` | DB row keyed by `owner_id` | One per user (managed mode); admin row is fallback. |
| `Project` (incl. config + pipeline state) | DB row | Stored as JSON-document column. |
| `PageRecord` (one per page, per project) | DB row | One row per `(project_id, idx0)`. |
| `Job` | DB row | Status / progress / payload. |
| Source images, thumbnails, processed PNGs, OCR text, illustrations, zip | `IStorage` | Filesystem in local mode; S3 in managed. Spec-08 storage layout. |

The whole user-visible state for a project is reconstructible from
`projects.body` + `pages.body[*]` + the storage tree. Jobs are append-only.
