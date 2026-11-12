# 02 — Backend

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-11
- **Read when:** changing bootstrap, adapters, routes, or backend concurrency.
- **Search terms:** backend, FastAPI, bootstrap, adapters, concurrency.

Current page-stage IDs dispatch through `get_stage_impl` into `V2_STAGE_IMPL`.
Project-stage jobs read `V2_STAGE_IMPL` directly.
The retained legacy `STAGE_IMPL` table is not the current registry contract.
See [pipeline architecture](03-pipeline.md) for the 24-stage DAG.

## `Settings` and bootstrap

`Settings` reads environment configuration; `build_app(settings)` accepts an explicit instance for tests.
Bootstrap builds storage, database, authentication, the compatibility GPU backend, dispatcher, and job/stage brokers.
It constructs the job runner with the local data root and configured timeout.

The lifespan initializes the database and starts runner, dispatcher, and priority-executor tasks.
Shutdown stops the runner, cancels and awaits background tasks, then closes the database.
The app mounts auth/data/GPU routes, suite routes, health/server info, runtime config, assets, and the SPA.

Dependencies read `app.state` entries including storage, database, auth, GPU backend, dispatcher,
job/stage event brokers, runner, and settings. The Postgres builder selects an adapter that implements the
full `IDatabase` contract; it is checked against a live Postgres only when the contract test is pointed at one.

## Suite identity, authentication, and job safeguards

Suite routes mount with the bundled app identity `pdomain-prep-for-pgdp`.
Startup migrates an old `unknown` app's compute preference without overwriting an existing real-app value.

`SuiteAuthMiddleware` guards POST, PUT, PATCH, and DELETE under `/api/suite/`.
It uses the shared user resolver, including cookie-first verification in API-key mode.
Suite GET requests and `/healthz` remain open. The middleware checks method and path because included routers
need not appear as ordinary `APIRoute` objects; adding dependencies through an `app.routes` loop misses mutations.

Job enqueue resolves the device from app preference, suite preference, then automatic detection.
The payload carries that decision. The batched page-stage rerun route creates one job per requested page,
rather than only marking rows dirty.

`PGDP_JOB_HANDLER_TIMEOUT_SECONDS` defaults to 900 seconds. Setting `job_handler_timeout_seconds=None`
disables the bound. A timeout marks the job failed and releases its runner slot.
Cancelling the await does not terminate an underlying worker OS thread.

ZIP decompression runs through `anyio.to_thread.run_sync`; async storage writes and collision bookkeeping
stay on the event loop. Size-limit checks still apply.

The SPA's suite preference, installed-app, and launch calls use the authenticated API client.
See [frontend authentication](04-frontend.md#auth-in-the-spa) for mode-specific behavior.

### Safeguard evidence

- Code: `bootstrap.py`, `api/middleware/suite_auth.py`, `core/device_resolution.py`, `core/job_runner.py`,
  `core/ingest.py`, and `api/data/project_stages.py` under `src/pdomain_prep_for_pgdp/`; `frontend/src/App.tsx`.
- Tests: `tests/test_suite_routes_auth.py`, `tests/test_bootstrap_suite_app.py`, `tests/test_device_resolution.py`,
  `tests/test_job_runner_timeout.py`, `tests/test_ingest_zip_thread_offload.py`, `tests/test_w4_aggregates.py`,
  and `frontend/src/App.test.tsx`.
- History: `e575a58`, `5c51cbd`, `2138459`, `5486c4b`, `3b45464`, `6aadd44`, `7dbf3fa`, and `29f60ca`.
- Verified: 2026-11-07 by source inspection and the repository CI gate. This section does not re-verify
  every older route description below.

## Adapter Protocols

### `IStorage` (`adapters/storage/base.py`)

The storage contract provides byte reads/writes, existence/deletion, prefix listing, and presigned URLs.
Filesystem storage confines paths beneath the configured root. S3 lazily loads its optional dependency.

### `IDatabase` (`adapters/database/base.py`)

The application database owns project configuration, page-stage rows, jobs, search, and compatibility boundaries.
SQLite uses a connection protected by a lock. The Postgres adapter uses one async psycopg connection, stores
page stages in a normalised table, and searches with a `simple` tsvector index. Managed persistence remains deferred.

### Page lifecycle service (`core/page_store_factory.py`)

`build_page_service(data_root, project_id)` creates a local pdomain-ops page service.
Each project has `.pd-pages/events.db`, a local aggregate store, and BlobStore.
Ingest and mutations save Page/Project aggregates; prep-specific fields live in the `prep` extension.

Display order is `PrepPageExtension.idx0`, sorted by `list_page_records`.
Reorder does not change generic `ProjectAggregate.page_ids` membership order or `PageRecord.page_index`.
A separate project `events.db` stores prep workflow audit history.
Project-stage rows live in `project_stages.db`, outside `IDatabase`.
See [state ownership](01-overview.md#state-ownership).

### `IAuth` (`adapters/auth/base.py`)

`verify(credentials)` returns a `UserContext`. None mode supplies the default user.
API-key mode uses key verification and its session-cookie path; JWT uses OIDC/JWKS and the subject claim.
The shared resolver supports cookie-first API-key requests. These mechanisms do not establish complete
multi-tenant deployment support.

### GPU backend wiring

Local/cpu/mps startup uses `_NoOpGPUBackend` for compatibility; current page execution uses registry callables.
Shared Modal/container GPU classes and dispatchers come from `pdomain_ops.gpu`, not removed local backend files.
Configure a new stage through the current registry, not a new legacy batch job type.

## API surface

Data and ordinary GPU routes use user dependencies. Suite mutations use middleware.
Health, runtime configuration, suite GETs, and login have deliberately public paths.
The committed `openapi.json` is the operation inventory; `tests/test_openapi_spec_committed.py` checks drift.

### `/api/auth/*`

`GET /me` returns the user context. API-key mode also mounts `POST /session` and `POST /session/logout`.
JWT login is handled by the SPA's OIDC flow.

### `/api/data/*`

Routes cover project/page CRUD, system defaults, search, source preview, assets, stage settings/artifacts,
numbering, and review operations. Page mutations address scan indices under `projects/{id}/pages/{idx0}`.
Split/unsplit and word-delete/restore routes use the page-service boundary.

Current orchestration includes:

```text
GET  /api/data/projects/{project_id}/pipeline
POST /api/data/projects/{project_id}/project-stages/{stage_id}/run
POST /api/data/projects/{project_id}/project-stages/{stage_id}/rerun
POST /api/data/projects/{project_id}/page-stages/ocr/run-batch
POST /api/data/projects/{project_id}/pages/{idx0}/stages/{stage_id}/run
POST /api/data/projects/{project_id}/pages/{idx0}/stages/text_review/attest
POST /api/data/projects/{project_id}/project-stages/text_review/confirm
```

The old project `build-package` and `review-status` routes are removed.
Current gates are enforced before project-stage enqueue; the old awaiting-review auto-resume model is inactive.

### `/api/gpu/*`

The router retains ingest, illustration helpers, and job operations.
The extraction helper returns 501; it is separate from the functioning registry illustrations stage.
Jobs can be listed, fetched, cancelled, retried, and streamed.
The five job types are `unzip`, `thumbnails`, `run_page_stage`, `run_project_stage`,
and `run_project_ocr_batch`; see [job flow](05-events-and-jobs.md#job-runner-flow).

### `/cdn/*` (filesystem mode only)

Uploads use a user dependency and path confinement. None mode uses a StaticFiles read mount.
API-key/JWT deployments use authenticated reads with ownership checks.

### `/env.js`

Runtime config supplies API base and auth mode, plus JWT issuer/audience when configured.
It never emits the API key as `API_TOKEN`. The SPA loads it before its bundle; the response is no-store.

## Error envelope

Errors use `{error, message, details}`. Validation errors return 400 with Pydantic details.
HTTP exceptions preserve their status; unexpected errors return 500.
Traceback details are included only in debug mode; otherwise details is null.

## Concurrency model

HTTP handling is async. Page-stage implementations are called directly by the runner; project-stage jobs
offload blocking work through the loop's executor. The constructed `SingleExecutor` is not a universal
priority scheduler for these paths.

Synchronous page artifact writers can roll back failures. The deferred write path marks a row clean before
its queued file write and marks it failed if that write fails. Project-stage jobs write file, row, then
best-effort workflow events without a shared rollback transaction.
See [persistence limits](05-events-and-jobs.md#persistence-limits).

The job semaphore bounds handler concurrency. The managed batch dispatcher remains infrastructure without
a surviving local batch submission path.

## Evidence

Verified from source on 2026-11-07: `bootstrap.py`, `settings.py`, `api/dependencies.py`,
`api/env_js.py`, `api/cdn.py`, `api/data/projects.py`, `api/data/project_stages.py`,
`core/job_runner.py`, `core/page_store_factory.py`, and stage writers under `core/pipeline/`.
Paths are relative to `src/pdomain_prep_for_pgdp/`. No live remote deployment is claimed.
