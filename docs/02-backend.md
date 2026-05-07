# 02 — Backend

## `Settings` and bootstrap

`src/pd_prep_for_pgdp/settings.py` is a single `pydantic-settings` model that
reads `PGDP_*` env vars (and `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`/etc.). It's
read once per process; `build_app()` accepts an explicit `Settings` instance
so tests can pass hermetic config.

`bootstrap.build_app(settings)` does, in order:

1. `build_storage(settings)` — `FilesystemStorage` or `S3Storage`.
2. `build_database(settings)` — `SqliteDatabase` (Postgres is deferred).
3. `build_auth(settings)` — `NoneAuth` / `ApiKeyAuth` / `JwtAuth`.
4. Construct a process-wide `SingleExecutor` (the GPU priority queue).
5. `build_gpu_backend(settings, storage=, database=, executor=)` — `CpuBackend`
   / `LocalBackend` / `ModalBackend` / `SharedContainerBackend`.
6. `build_dispatcher(settings, gpu)` — `ImmediateDispatcher` (interval=0) or
   `BatchDispatcher` (managed mode, 5-min default flush).
7. `JobEventBroker()` — in-memory pub/sub for SSE.
8. `InProcessJobRunner(database=, storage=, gpu=, dispatcher=, events=)`.
9. Build the FastAPI app with a `lifespan` context manager that:
   - calls `database.initialize()`,
   - starts `dispatcher.run_forever()` as a task,
   - starts `job_runner.run_forever()` as a task,
   - starts `executor.run_drain_loop()` as a task,
   - cancels all three + closes the DB on shutdown.
10. `install_error_handlers(app)` — uniform `ApiError` JSON envelope.
11. `install_auth_routes(app)` (`/api/auth/*`).
12. `install_data_routes(app)` (`/api/data/*`).
13. `install_gpu_routes(app)` (`/api/gpu/*`).
14. If not `gpu_worker_only` mode: install `/env.js`, `/cdn` PUT, `/cdn`
    StaticFiles, then the SPA mount at `/`.

Everything on `app.state` (`storage`, `database`, `auth`, `gpu_backend`,
`dispatcher`, `job_events`, `settings`) is what FastAPI dependencies pull
through `api/dependencies.py`.

## Adapter Protocols

Each adapter is a `Protocol` so anything that quacks like one works:

### `IStorage` (`adapters/storage/base.py`)

```python
async def put_bytes(key, data, content_type="") -> None
async def get_bytes(key) -> bytes
async def exists(key) -> bool
async def delete(key) -> None
async def list_prefix(prefix) -> AsyncIterator[ObjectInfo]
async def presign_put(key, content_type, expires_in=3600) -> str
async def presign_get(key, expires_in=3600) -> str
```

- **`FilesystemStorage`** writes under `Settings.data_root`. `presign_put`
  returns `/cdn/<key>` so the SPA can XHR-PUT through the FastAPI process.
  `_path()` defends against path-traversal.
- **`S3Storage`** lazy-imports `boto3` (only when `[s3]` extra is installed).

### `IDatabase` (`adapters/database/base.py`)

System defaults, projects, pages (paginated via cursor), jobs (recent-by-owner).
Every method is `async def`. Implementations:

- **`SqliteDatabase`** — stdlib `sqlite3` with `check_same_thread=False`,
  WAL mode, and a `threading.Lock` around the cursor so the concurrent job
  runner doesn't race on commit. Each table stores the Pydantic model as a
  JSON-text column (so model evolution doesn't need migrations).
- **`PostgresDatabase`** — scaffold landed (commit `77072c6`); raw
  async psycopg, mirrors SQLite JSON-per-record. Live-DB integration
  tests are parked under roadmap §D2 (Deferred — remote / cloud mode)
  while the local-first push lands. `tests/test_postgres_adapter.py`
  `importorskip`s psycopg cleanly.

### `IAuth` (`adapters/auth/base.py`)

```python
async def verify(credentials: str | None) -> UserContext
```

`UserContext` is `BaseModel(user_id: str = "default")`.

- **`NoneAuth`** — always returns `UserContext()`.
- **`ApiKeyAuth`** — `hmac.compare_digest`-checks against `Settings.api_key`.
- **`JwtAuth`** — OIDC discovery + JWKS verify (lazy-imports `pyjwt`). The
  user identity becomes `claims["sub"]`.

### `GPUBackend` (`adapters/gpu/base.py`)

```python
async def process_page(req: ProcessPageRequest) -> ProcessPageResponse
async def run_ocr(req: OcrPageRequest) -> OcrPageResponse
async def run_batch(items: list[BatchJobItem]) -> list[BatchJobResult]
```

- **`CpuBackend`** — fully wired. `process_page` reads source bytes via
  `IStorage`, runs `core.pipeline.process_page_cpu` through the
  `SingleExecutor`, writes the proofing image, returns the presigned URL.
  `run_ocr` reads the OCR-cropped image, calls `core.ocr.ocr_page` on the
  executor, writes text. `run_batch` dispatches each item sequentially.
- **`LocalBackend`** — placeholder; CUDA path raises `NotImplementedError`.
- **`ModalBackend`** — wire shape verified by 3 TDD tests using a fake
  `modal` module. `Function.lookup("pgdp-prep", "...").remote.aio(payload)`
  carries Pydantic models as plain dicts. The Modal-side function bodies
  in `modal_app.py` still raise `NotImplementedError` (S3 wiring TODO).
- **`SharedContainerBackend`** — placeholder.

## API surface

All routes share auth middleware (`get_user`), an error envelope, and the
generated OpenAPI document.

### `/api/auth/*`

- `GET /me` — returns `UserContext` (works in every auth mode).

### `/api/data/*`

Project + page CRUD, system defaults, presigned URLs, job index.

| Route | Notes |
|---|---|
| `POST /projects` | Creates project. For `source_type=zip`, returns a presigned PUT URL. |
| `GET /projects` | Filtered by current `user_id`. |
| `GET /projects/{id}` | Returns the full Project (config + pipeline state). |
| `PATCH /projects/{id}/config` | Partial-merge update of `ProjectConfig`. Optional `name` on the body keeps `Project.name` and `book_name` in sync. Triggers `assign_prefixes` after each call. |
| `DELETE /projects/{id}` | Cascades to pages. Idempotent. |
| `GET /projects/{id}/pages` | Paginated (cursor + limit). Filters: `page_type`, `has_splits`, `status`, `review_needed`. |
| `GET /projects/{id}/pages/{idx0}` | One PageRecord. |
| `PATCH /projects/{id}/pages/{idx0}` | Update page_type, alignment, config_overrides, splits, illustration_regions. |
| `PATCH /projects/{id}/pages/{idx0}/text` | Step-9 review: writes to the recorded `output.ocr_text_key` when present. |
| `GET /projects/{id}/pages/{idx0}/text/{suffix}` | Reads same path. `suffix="_"` means whole-page. |
| `GET /system/defaults` / `PUT` / `DELETE` | SystemDefaults CRUD. DELETE resets to spec defaults. |
| `GET /system/defaults/export` | JSON download (Content-Disposition attachment). |
| `POST /system/defaults/import` | Parses + replaces. |
| `POST /projects/{id}/assets/upload-url` / `GET .../download-url` | Presigned URL passthrough. |
| `GET /jobs` | Recent jobs by owner. Filter: `project_id`. |
| `GET /jobs/{id}` | One Job. |

### `/api/gpu/*`

| Route | Notes |
|---|---|
| `POST /ingest` | Creates an `ingest` job (runs Step 0/1/2 + auto-detect). |
| `POST /process-page` | Sync per-page Step 4. Used by the workbench live preview. |
| `POST /run-ocr-page` | Sync per-page (or per-split) OCR. |
| `POST /suggest-splits` / `/suggest-illustrations` / `/extract-illustration` | Spec-05 helpers (mostly stubs that return [] for now). |
| `POST /jobs` | Submit a batch job (`batch_process_pages`, `batch_ocr`, `batch_text_postprocess`, `batch_extract_illustrations`, `build_package`). |
| `GET /jobs/{id}` | Job status. |
| `DELETE /jobs/{id}` | Cancel. |
| `POST /jobs/{id}/retry` | Create a fresh `queued` copy of an `error`/`cancelled` job. |
| `GET /jobs/{id}/events` | SSE — first frame is a snapshot, subsequent come from the broker (no polling). |

### `/cdn/*` (filesystem mode only)

`PUT /cdn/{key:path}` writes through `IStorage.put_bytes`. Path-traversal
guarded. The matching read is the `StaticFiles` mount over `Settings.data_root`.

### `/env.js`

Returns a JS shim that sets `window.__ENV__` from `Settings`. In `apikey`
mode it includes `API_TOKEN`; in `jwt` mode it publishes `JWT_ISSUER` /
`JWT_AUDIENCE`. Loaded by `index.html` before the SPA bundle. No-store cache.

## Error envelope

`api/middleware/error_handler.py` registers handlers for `StarletteHTTPException`,
`RequestValidationError`, and `Exception`. Every error returns:

```json
{ "error": "<code>", "message": "<human>", "details": <any> }
```

Validation failures return 400 with details from Pydantic; HTTP exceptions
preserve their status code; everything else becomes 500 with a 3-line
traceback tail.

## Concurrency model

- **HTTP** is async (FastAPI/uvicorn).
- **DB** writes go through a single SQLite connection with a `threading.Lock`
  around the cursor (set in iteration 10 to fix a commit race once the
  job runner started fanning out).
- **GPU work** goes through a process-wide `SingleExecutor` (one worker
  thread, 200ms batch-collection window, INTERACTIVE preempts BATCH within
  the window). All `process_page` / `run_ocr` calls funnel through it so
  the workbench live preview never gets stuck behind a 400-page batch.
- **Job runner** has a `max_concurrency` knob (default 1, semaphore-bounded
  fan-out for >1). Jobs claimed in one `run_pending` call run as
  `asyncio.gather(*sem-bounded coroutines)`.
- **Dispatcher** in managed mode batches `BatchJobItem`s by `job_id` and
  flushes every `dispatch_interval_seconds` (default 300). On flush the
  registered completion callback marks each originating job complete or
  error.
