# Spec 07 — API Design

One FastAPI app, three route namespaces, one OpenAPI schema. The Pydantic
models in this spec are the **source of truth**; the TypeScript types in the
frontend are generated from `openapi.json` via `openapi-typescript`.

```
/api/auth/*    Identity (none / api-key / JWT verify)
/api/data/*    Project + page CRUD, presigned URLs, job status reads
/api/gpu/*     Image processing, OCR, ingest, packaging, batch jobs
/cdn/*         Local image files (filesystem storage backend only)
/              Static React SPA (from package resources)
```

All routes share auth middleware, error format, and the OpenAPI document. There
is no separate "data API" service — what was previously the Hono Lambda data
API is now the `/api/data` namespace on this same FastAPI process.

---

## Auth

```python
# api/middleware/auth.py
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer(auto_error=False)

class UserContext(BaseModel):
    user_id: str = "default"

async def get_user(
    creds: HTTPAuthorizationCredentials | None = Depends(security),
    auth = Depends(get_auth_adapter),
) -> UserContext:
    return await auth.verify(creds)
```

Three adapters (selected at startup; spec 09):

| Adapter | Verify | Returned `user_id` |
|---|---|---|
| `none` | always succeeds | `"default"` |
| `apikey` | `creds.credentials == settings.api_key` | `"default"` |
| `jwt` | OIDC discovery + signature check | claim `sub` |

Routes always inject `user: UserContext = Depends(get_user)`. Today
`user.user_id` is `"default"` in single-user mode; swap the adapter and
the existing route filtering becomes per-user without code changes.

---

## `/api/data` — Project + Page CRUD

### Projects

```
POST   /api/data/projects                Create project; returns upload URL if zip source
GET    /api/data/projects                List projects owned by current user
GET    /api/data/projects/{id}           Get project + config + pipeline state
PATCH  /api/data/projects/{id}/config    Partial-merge update of ProjectConfig
DELETE /api/data/projects/{id}           Delete project + all assets
```

```python
class CreateProjectRequest(BaseModel):
    name: str
    source_type: Literal["zip", "s3_folder", "local_folder"]
    source_uri: str | None = None             # required for s3_folder / local_folder

class CreateProjectResponse(BaseModel):
    project: Project
    upload_url: str | None = None             # presigned PUT for zip source
    upload_key: str | None = None
```

`owner_id` is set from the resolved `UserContext` — never from the request body.
`GET /projects` filters by `owner_id` so users cannot see each other's projects
when JWT auth is wired in.

```python
class UpdateConfigRequest(BaseModel):
    """Partial update of ProjectConfig — only provided fields are merged."""
    project_config: dict[str, Any]   # validated against ProjectConfig schema

class UpdateConfigResponse(BaseModel):
    project_config: ProjectConfig
    updated_at: datetime
```

### Pages

```
GET    /api/data/projects/{id}/pages              List (paginated, filterable)
GET    /api/data/projects/{id}/pages/{idx0}       Get one PageRecord
PATCH  /api/data/projects/{id}/pages/{idx0}       Update page (overrides, type, splits, regions)
PATCH  /api/data/projects/{id}/pages/{idx0}/text  Update OCR text for a split
GET    /api/data/projects/{id}/pages/{idx0}/text/{suffix}   Get OCR text for a split
```

```python
class ListPagesQuery(BaseModel):
    cursor: str | None = None
    limit: int = 50
    page_type: PageType | None = None
    has_splits: bool | None = None
    status: PageProcessingStatus | None = None

class ListPagesResponse(BaseModel):
    pages: list[PageRecord]
    next_cursor: str | None
    total: int

class UpdatePageRequest(BaseModel):
    page_type: PageType | None = None
    alignment: AlignmentOverride | None = None
    config_overrides: PageConfigOverrides | None = None
    splits: list[PageSplit] | None = None
    illustration_regions: list[IllustrationRegion] | None = None
```

### System defaults

```
GET    /api/data/system/defaults    Get current SystemDefaults
PUT    /api/data/system/defaults    Replace SystemDefaults
```

In hosted mode this is per-user (multi-user) or admin-only (single managed
instance); the auth adapter decides.

### Assets (presigned URLs)

```
POST   /api/data/projects/{id}/assets/upload-url      Get presigned PUT for an upload
GET    /api/data/projects/{id}/assets/download-url    Get presigned GET (or direct URL in local mode)
```

In **filesystem** storage mode, `presign_get` returns the direct `/cdn/<key>`
URL on this same process — no signing required. In **S3** storage mode it
returns an S3 presigned URL. Routes don't care which.

```python
class UploadUrlRequest(BaseModel):
    key: str
    content_type: str

class UploadUrlResponse(BaseModel):
    upload_url: str
    expires_in: int = 3600
```

### Jobs (read-only here; created by `/api/gpu`)

```
GET    /api/data/jobs/{id}    Job status + progress
GET    /api/data/jobs         Recent jobs for current user
```

---

## `/api/gpu` — Image processing + OCR

The same FastAPI process owns these routes. In modes where the configured
`GPUBackend` is `local` or `cpu`, the work runs in the same Python interpreter.
In modes where it's `modal` or `shared_container`, the route handler dispatches
out and awaits the result.

### Ingest

```
POST   /api/gpu/ingest                 Extract zip, generate thumbnails, write PageRecords
```

```python
class IngestRequest(BaseModel):
    project_id: str
    source_key: str                  # uploaded zip key, or source-folder prefix
    source_type: Literal["zip", "s3_folder", "local_folder"]

class JobResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running"] = "queued"
```

### Per-page stage operations (synchronous, for workbench)

These bypass the batch dispatcher and fire immediately. Cold start is paid by
the user when it happens.

```
GET    /api/pages/{page_id}/stages                            List stage state for one page
POST   /api/pages/{page_id}/stages/{stage_id}/run             Run one stage (mode: single | from)
GET    /api/pages/{page_id}/stages/{stage_id}/artifact        Stream the on-disk artifact
POST   /api/pages/{page_id}/split                             Create N child pages
POST   /api/pages/{page_id}/unsplit                           Reverse a split
POST   /api/pages/{page_id}/text_review/clean                 Mark page reviewed (Q7 gate)
POST   /api/gpu/suggest-illustrations                         Detect illustration regions on source image
POST   /api/gpu/extract-illustration                          Extract one illustration region (workbench preview)
```

`page_id` accepts either the zero-padded `idx0` (root pages) or a
structured split-child id (`0042/splits/a`).

```python
class RunStageRequest(BaseModel):
    page_id: str
    stage_id: str
    mode: Literal["single", "from"] = "single"
    config_overrides: PageConfigOverrides | None = None  # PATCH page first, then run

class RunStageResponse(BaseModel):
    page_id: str
    stage_id: str
    status: PageStageStatus           # 'clean' | 'failed' | 'dirty' (downstream)
    artifact_url: str | None          # for image-producing stages
    duration_ms: int
    backend: Literal["local", "cpu", "modal", "shared_container"]
    cold_start_ms: int = 0            # > 0 if Modal warmed up this call

class PageStageState(BaseModel):
    stage_id: str
    status: PageStageStatus
    stage_version: int
    last_run_at: datetime | None
    duration_ms: int | None
    error_message: str | None
    artifact_url: str | None          # presigned GET when status='clean' and stage produces an artifact
```

### Project-level stage operations

```
GET    /api/projects/{id}/stages                                 Project-wide stage state (filterable)
POST   /api/projects/{id}/stages/{stage_id}/run-all              Fan out one stage across all pages
POST   /api/projects/{id}/run-dirty                              Fan out everything dirty
POST   /api/projects/{id}/build-package                          Build PGDP zip; gated by text_review.clean
```

```python
class RunAllStageRequest(BaseModel):
    only_dirty: bool = True
    page_id_filter: list[str] | None = None      # None = all proof-range pages

class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    estimated_pages: int
    dispatch_mode: Literal["immediate", "scheduled"]
    next_dispatch_at: datetime | None = None     # set when dispatch_mode == "scheduled"
```

In local/self-hosted modes `dispatch_mode == "immediate"`. In managed mode
project-level jobs are `"scheduled"` with `next_dispatch_at` showing when
the next flush will fire (≤5 minutes).

### `awaiting_review` status

`build_package` lands in `JobStatus.awaiting_review` when any
proof-range page is unreviewed. The job stays parked (heartbeat SSE
events emit a count of remaining unreviewed pages) until either every
page is `text_review.clean` (auto-resume) or the user explicitly
cancels. See canonical pipeline-task-model spec for the full
workflow.

### Legacy endpoints (deprecated)

The following endpoints remain through M5 as thin shims onto the
per-stage runner; they are removed in M6:

| Legacy endpoint | Replacement |
|---|---|
| `POST /api/gpu/process-page` | `POST /api/pages/{page_id}/stages/canvas_map/run?mode=from` |
| `POST /api/gpu/run-ocr-page` | `POST /api/pages/{page_id}/stages/ocr/run?mode=single` |
| `POST /api/gpu/jobs` with `job_type=batch_process_pages` | `POST /api/projects/{id}/stages/canvas_map/run-all` |
| `POST /api/gpu/jobs` with `job_type=batch_ocr` | `POST /api/projects/{id}/stages/ocr/run-all` |
| `POST /api/gpu/jobs` with `job_type=batch_text_postprocess` | `POST /api/projects/{id}/stages/text_postprocess/run-all` |
| `POST /api/gpu/jobs` with `job_type=batch_extract_illustrations` | `POST /api/projects/{id}/stages/extract_illustrations/run-all` |
| `POST /api/gpu/jobs` with `job_type=build_package` | `POST /api/projects/{id}/build-package` |

### SSE progress events

`GET /api/gpu/jobs/{id}/events` streams `text/event-stream`:

```
data: {"type":"progress","page":45,"total":386,"step":"process_page"}

data: {"type":"progress","page":46,"total":386,"step":"process_page"}

data: {"type":"warming","backend":"modal","etaSeconds":12}

data: {"type":"error","page":48,"message":"deskew failed: image too small"}

data: {"type":"complete","pagesOk":385,"pagesError":1,"elapsedSeconds":142}
```

The `warming` event appears in managed mode when a Modal cold start is in
progress; the UI shows a non-blocking indicator. TanStack Query polling
serves as a fallback when SSE is unavailable.

---

## `/cdn` — Local image serving

Mounted only when `STORAGE_BACKEND=filesystem`:

```python
app.mount(
    "/cdn",
    StaticFiles(directory=settings.data_root),
    name="cdn",
)
```

In S3 mode this mount is absent; presigned URLs and CloudFront URLs are
returned directly to the browser.

---

## In-process queue (local/self-hosted GPU backend)

For backends running GPU work in-process (`local`, `cpu`), a small priority
queue with a 200 ms batch-collection window dispatches into a single-threaded
executor. The GPU is not safe to use from multiple threads simultaneously.

```python
# core/queue/single_executor.py
import asyncio
from concurrent.futures import ThreadPoolExecutor
from enum import IntEnum

class Priority(IntEnum):
    INTERACTIVE = 0      # workbench live preview
    BATCH       = 1      # batch jobs

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu")
_queue: asyncio.PriorityQueue = asyncio.PriorityQueue()

async def enqueue(priority: Priority, work_fn, *args):
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    await _queue.put((priority, (work_fn, args, fut)))
    return await fut

async def drain_loop():
    """Background task; runs for the lifetime of the process."""
    loop = asyncio.get_running_loop()
    BATCH_WINDOW_S = 0.2
    while True:
        first = await _queue.get()
        items = [first]
        deadline = loop.time() + BATCH_WINDOW_S
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                items.append(await asyncio.wait_for(_queue.get(), timeout=remaining))
            except asyncio.TimeoutError:
                break
        await _dispatch(items)
```

Interactive items are reordered to the front of any collected window. If all
items in a window are batch-OCR requests, the executor runs DocTR on them in a
single forward pass for ~5–10× throughput.

This queue is **process-local**. In managed mode the `BatchDispatcher` (spec
09) replaces it for batch work — interactive requests still pass through the
in-process queue for routing but skip any 5-min wait.

---

## Errors

```python
class ApiError(BaseModel):
    error: str           # machine-readable code
    message: str         # human-readable
    details: Any = None
```

| Status | Meaning |
|---|---|
| 400 | Validation error |
| 401 | Auth missing or invalid |
| 403 | Authenticated but not authorised (wrong owner_id) |
| 404 | Resource not found |
| 409 | Conflict (job already running for this project) |
| 422 | Unprocessable (corrupt image, invalid config combination) |
| 202 | Async job queued |
| 503 | GPU backend unavailable / cold-starting (with `Retry-After`) |

---

## Type sharing — OpenAPI codegen

FastAPI generates `/openapi.json` from the Pydantic models. The frontend
build runs:

```bash
npx openapi-typescript http://localhost:8765/openapi.json -o src/api/types.ts
```

Result: a single `types.ts` file with every request/response interface and
embedded model. CI regenerates this file before `npm run build` and fails
the build if it differs from the committed copy — catches contract drift.

There is no `packages/api-types` workspace. There is no monorepo coordination
across language stacks. Pydantic is the source of truth; TypeScript follows.

---

## File layout

```
src/pd_prep_for_pgdp/api/
├── auth/
│   └── routes.py
├── data/
│   ├── projects.py
│   ├── pages.py
│   ├── system_defaults.py
│   ├── assets.py
│   └── jobs.py
├── gpu/
│   ├── ingest.py
│   ├── process_page.py
│   ├── ocr.py
│   ├── illustrations.py
│   ├── jobs.py
│   ├── sse.py
│   └── schemas.py            ← Pydantic request/response models
├── middleware/
│   ├── auth.py
│   ├── cors.py
│   └── error_handler.py
└── _bootstrap.py             ← install_data_routes / install_gpu_routes
```
