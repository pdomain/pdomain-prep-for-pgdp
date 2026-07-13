# 05 — Events, Jobs, and the In-Process Queue

## Two durable event stores

Generic Page and Project aggregate state is persisted through pdomain-ops
`PageAggregate`, `ProjectAggregate`, and `PagesApplication`. Each project owns
one `.pd-pages/events.db` and content-addressed BlobStore. Ingest, split,
rotation, and extension updates change these aggregates through the page-service
boundary instead of treating a mutable database page row as event history.

Prep display order is app-specific state inside this shared persistence layer.
Each Page aggregate carries `PrepPageExtension.idx0`, and page listing sorts by
that field. Reorder rewrites those extension values. It does not reorder
`ProjectAggregate.page_ids`, which remains membership in insertion order, or
rewrite generic `PageRecord.page_index`.

Prep workflow history uses a separate app-local store at the project-level
`events.db`. Its `PrepProjectAggregate` records `PageReorder`, stage run and
settings history, review decisions, gate confirmations, and other prep-domain
events. `PageReorder` is workflow audit history; the current prep display order
comes from the extension values on the shared Page aggregates.

Prep-specific PageRecord fields remain namespaced in the `prep` extension. The
application database still owns pipeline stage rows, job state, search, project
configuration, and compatibility boundaries. Job progress events described
below are transient SSE coordination; they are distinct from both durable event
stores.

Evidence: `src/pdomain_prep_for_pgdp/core/page_store_factory.py`,
`src/pdomain_prep_for_pgdp/core/page_service_helpers.py`,
`src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py`,
`src/pdomain_prep_for_pgdp/api/data/pages.py`,
`src/pdomain_prep_for_pgdp/core/ingest.py`,
`src/pdomain_prep_for_pgdp/core/split_ops.py`, `tests/test_page_store_factory.py`,
`tests/test_reorder_pages_route.py`, and `tests/test_w4_confirm_routes.py`.
Salvaged source:
`_tbd/ocr-container-docs/plans/2026-06-01-page-split-prep-for-pgdp.md`.

The system has three coordination layers, each solving a different problem:

| Layer | Where | What it serialises |
|---|---|---|
| `SingleExecutor` | `core/queue/single_executor.py` | GPU-bound work onto one thread, with INTERACTIVE-preempts-BATCH ordering. |
| `JobEventBroker` | `core/job_events.py` | Status transitions for SSE consumers. |
| `BatchDispatcher` | `dispatcher/batched.py` | Per-page items grouped by `job_id` for managed-mode flush. |

Plus the orchestration layer:

- `InProcessJobRunner` (`core/job_runner.py`) — polls queued jobs from the
  database, runs them with a semaphore (`max_concurrency`), publishes events
  through the broker, hands batch work to the dispatcher when configured.

## `SingleExecutor`

Spec 07 §"in-process queue" mandates a single GPU thread with a 200ms batch
window. `SingleExecutor` wraps `concurrent.futures.ThreadPoolExecutor(max_workers=1)`:

```python
class Priority(IntEnum):
    INTERACTIVE = 0  # workbench live preview / single-page OCR
    BATCH       = 1  # batch jobs

ex.submit(priority, fn, *args) -> asyncio.Future
ex.run_drain_loop()  # background task; opens a 200ms window per drain
```

Each drain pulls the first item, then collects more until the deadline. The
batch is sorted lexicographically on `(priority, sequence)` so INTERACTIVE
items dispatch before BATCH ones queued at the same time. Items run
serially on the worker thread (the GPU isn't safe to share across threads).

`atexit.register(self._thread.shutdown, wait=False)` runs on interpreter
shutdown so a missed `__aexit__` doesn't pin the process.

`bootstrap.build_app` constructs one `SingleExecutor` and starts its drain
loop in the lifespan handler. `StageRunner` (`core/pipeline/stage_runner.py`)
submits through it for every CPU-bound stage call.

## `JobEventBroker`

```python
broker = JobEventBroker()
await broker.publish(job_id, event_dict)
async for event in broker.subscribe(job_id): ...
await broker.close(job_id)  # signals end-of-stream to subscribers
```

- **Fan-out**: every active subscriber for a `job_id` gets every event.
- **No buffering**: events published before subscribe arrive nowhere.
- **Per-subscriber queue**: each `subscribe()` gets its own
  `asyncio.Queue`. The async iterator yields until a `_CLOSED` sentinel
  arrives.

The runner publishes after every status transition (running → progress
updates → complete/error). The SSE handler in `api/gpu/jobs.py` first emits
a snapshot frame from the database (so a late subscriber sees current state
immediately), then enters `async for ev in events.subscribe(job_id)`. The
event `type` is one of `progress`, `complete`, `error`, `cancelled`.

## `BatchDispatcher`

Managed-mode batching: items are queued in memory grouped by `job_id`,
flushed every `dispatch_interval_seconds` (default 300s) as one
`gpu.run_batch(items)` call. Per-job completion callbacks fire after each
flush so `InProcessJobRunner` can mark the originating job complete.

```python
dispatcher = BatchDispatcher(gpu, interval_seconds=300)
dispatcher.add_completion_callback(runner._on_dispatcher_flush)
await dispatcher.submit(item, job_id="abc")  # buffer
await dispatcher.flush()  # fires completion callback per (job_id, results)
```

`ImmediateDispatcher` is the same shape but `submit` runs the item right
away. Local + self-hosted modes use it.

## Job runner flow

Live `JobType` values (`core/models.py`):

```
unzip                          # extract source archive
thumbnails                     # generate per-page thumbnails (ProcessPool, AD-9)
run_page_stage                 # async per-page stage run (?async=true on POST .../stages/{id}/run)
project_run_dirty              # project fan-out: run every dirty stage on every page (M5)
project_run_stage_all_pages    # project fan-out: run one stage on every page
build_package                  # zip + parks in awaiting_review if proof-range page un-attested (Q7)
```

```
poll → claim queued job → mark running + emit progress
                                      │
                                      ▼
                 unzip? → core.ingest.ingest_source(progress_cb=...)
                 thumbnails? → walk pages + generate (ProcessPool)
                 run_page_stage? → StageRunner.run(stage_id, page, device)
                 project_run_dirty? → walk pages × dirty stages × StageRunner.run
                 project_run_stage_all_pages? → walk pages × one stage × StageRunner.run
                 build_package? → core.packaging.build_package
                       │            (parks awaiting_review if proof-page un-attested)
                       ▼
                       success → mark complete + emit terminal event
                       failure → mark error + emit terminal event
```

`JobStatus.awaiting_review` is the parked state for `build_package` jobs
when any proof-range page lacks a clean `text_review` stage row. The
review-status endpoint (`GET .../review-status`) returns the parked job
id so the SPA can wake users.

`max_concurrency=N` in the runner constructor turns the per-iteration loop
into a semaphore-bounded `asyncio.gather` of `_run_one(job)` coroutines.

## Where SSE plugs in

- **PageWorkbench** doesn't subscribe (it does sync `POST /process-page`).
- **RunPipelinePanel** + **ProjectJobsFeed**'s inline `JobProgressInline`
  open one `EventSource` per active job. Closes the channel on terminal
  status. Falls back to a one-shot GET on connection error so the UI
  reflects terminal state even when SSE is unavailable.
- **JobsPage** uses polling (`refetchInterval: 5s`) because it lists many
  jobs at once.

## What's still hand-rolled

- The runner's `_find_queued()` walks every owner's recent jobs and filters
  to `queued`. Fine for SQLite + small fleets; Postgres should grow a real
  index + query. Logged in roadmap.
- The dispatcher's per-job grouping happens in memory. Across multiple
  FastAPI instances (managed mode with >1 Fargate task), this becomes
  inconsistent — the design expects the BatchDispatcher to be co-resident
  with the runner. Multi-instance managed mode would need Redis or SQS
  fan-out.
