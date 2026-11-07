# 05 — Events, Jobs, and the In-Process Queue

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
- **Read when:** changing persistence, jobs, queues, or event delivery.
- **Search terms:** events, jobs, queue, event store, page aggregate.

## Two durable event stores

Generic Page and Project aggregates use pdomain-ops `PagesApplication`, a local page store, and BlobStore.
Each project owns `.pd-pages/events.db`. Prep-specific page fields live in the `prep` extension.
Page listing sorts `PrepPageExtension.idx0`; reorder changes that field, not generic membership order or
`PageRecord.page_index`.

Prep workflow history uses the separate project `events.db` and `PrepProjectAggregate`.
Its events include stage runs, settings, review decisions, gates, reorder, insertion, and numbering changes.
Page-stage rows and jobs remain in `IDatabase`; project-stage rows use a separate `project_stages.db`.
Transient SSE messages are coordination signals, not either durable event store.

## Coordination layers

| Layer | Function | Current integration |
|---|---|---|
| `InProcessJobRunner` | Polls durable jobs, bounds concurrency, emits progress | Runs the five current job types |
| `JobEventBroker` | Fans job events out to active subscribers | In-memory and unbuffered before subscription |
| `StageEventBroker` | Distributes page/project stage changes | Feeds pipeline stage channels |
| `SingleExecutor` | Single worker with priority ordering | Constructed and drained at startup; not the universal stage scheduler |
| `BatchDispatcher` | Buffers managed items by job | No surviving local job handler submits batch items |

## `SingleExecutor`

The executor collects work in a 200 ms window, then orders it by priority and submission sequence.
INTERACTIVE work precedes BATCH work within that collected window. Its single thread runs queued items serially.

That queue contract does not describe every pipeline call. `run_stage` invokes its implementation directly;
project-stage jobs use the loop's executor for blocking work. Do not infer interactive preemption for every stage.

## `JobEventBroker`

Each subscriber receives its own queue. Events published before subscription are not retained.
Closing a job channel sends a sentinel to its subscribers.

The job SSE route first reads durable state. For a running initial snapshot, the wire event is `snapshot`;
otherwise the wire event names the current job status. That initial body's `type` is still `progress`.
Subsequent messages use status as the wire event name and semantic body types such as `progress`, `complete`,
`error`, or `cancelled`. Consumers must distinguish the SSE event name from the JSON body's `type`.

## `BatchDispatcher`

The dispatcher groups submitted items by job and flushes at its configured interval, invoking callbacks after
each batch. The immediate dispatcher executes submissions without buffering. Bootstrap chooses by dispatch
interval. These classes remain infrastructure; they are not evidence of working multi-instance orchestration.

## Job runner flow

The five current `JobType` values are:

| Type | Handler work |
|---|---|
| `unzip` | Extract/list sources and create page aggregates |
| `thumbnails` | Generate thumbnail blobs and complete source initialization |
| `run_page_stage` | Execute one page's stage |
| `run_project_stage` | Execute a project-scoped stage |
| `run_project_ocr_batch` | Run the project OCR batch |

The poller walks each owner's most recent 200 jobs and selects queued rows.
It marks a claimed job running before invoking its handler. A semaphore bounds concurrency.
The configurable handler timeout defaults to 900 seconds; cancellation of the await does not stop a worker OS thread.

There is no automatic startup reclaim for stranded running rows. After restart, the job-id cancellation API
can change a durable row's status, but it does not repair incomplete artifacts.
See [W3.4](../issues/2026-07-21-w34-reclaim-stuck-running.md).

The retained `awaiting_review` enum value does not establish a live package workflow.
`_check_awaiting_review` is a no-op. Current project-stage gates reject before enqueue rather than parking an
old build-package job for automatic resume.

## Where SSE plugs in

The pipeline shell consumes project-stage and project page-stage streams. Tool bridges refresh artifacts and
state from those messages. The zip tool uses project events and fetches the manifest.
JobsPage polls at five-second intervals instead of opening a stream for every listed job.

Stage cancellation still targets an absent route and swallows errors in the frontend service.
Job-id cancellation exists separately; see [W3.6](../issues/2026-07-21-w36-job-stage-cancel.md).

## Persistence limits

Synchronous page artifact writers can roll back file/row failures. Deferred page writes optimistically mark the
row clean before the background file write; failure then marks it failed and invalidates descendants.
Project-stage jobs write the artifact, update the project-stage row, and record best-effort workflow events.
Those paths do not provide one atomic disk/row/event transaction.

## Evidence

Verified from source on 2026-11-07: `core/job_runner.py`, `core/job_events.py`, `core/queue/single_executor.py`,
`core/stage_events.py`, `core/pipeline/stage_runner.py`, `project_stages.py`, `prep_aggregate.py`,
`api/gpu/jobs.py`, and the pipeline/zip frontend services. These paths are under
`src/pdomain_prep_for_pgdp/` unless explicitly frontend paths.
Tests include `tests/test_job_runner_timeout.py`, `tests/test_concurrent_jobs.py`,
`tests/test_ingest_progress.py`, and `tests/test_w4_confirm_routes.py`.
