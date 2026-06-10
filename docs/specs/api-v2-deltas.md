# API v2 deltas — registry v2

**Date:** 2026-06-10
**Status:** Phase 0 gate — frozen alongside `stage-registry-v2.md`. Changes
require editing this doc in the same commit as any code that diverges from it.
**Feeds into:** Track B Task B5 (routes + SSE + OpenAPI regen), Task F2 (XState
foundation — SSE actor wrapping).

---

## 1. Route deltas table

All routes under `/api/data/`. Every project-scoped route returns HTTP 409
with the registry-version mismatch body (see §1.3) when the project's
`registry_version` is not equal to `REGISTRY_VERSION = 2`.

### 1.1 Page-stage routes (re-keyed to v2 stage IDs)

These routes exist today keyed to v1 micro-stage IDs (e.g. `ingest_source`,
`morph_fill`). In v2 they continue to exist but the valid `stage_id` set
changes to the 24 v2 IDs in `stage-registry-v2.md §2`.

| Method | Path | Request schema | Response schema | Emitted events | Notes |
|--------|------|----------------|-----------------|----------------|-------|
| GET | `/projects/{id}/pages/{idx0}/stages` | — | `list[PageStageState]` | — | Returns 16 page-scoped stages in topological order. Lazy-init unchanged. |
| POST | `/projects/{id}/pages/{idx0}/stages/{stage_id}/run` | `StageRunRequest` (new) | `Job \| PageStageState` | `StageRunStarted`, `StageRunCompleted` / `StageRunFailed` (eventsourcing) + `stage-status` SSE | `stage_id` validated against v2 page-scoped IDs only (16 IDs). 409 on dep not-met. |
| GET | `/projects/{id}/pages/{idx0}/stages/{stage_id}/artifact` | — | `bytes` | — | Same contract; stage_id now a v2 ID. |
| GET | `/projects/{id}/pages/{idx0}/stages/{stage_id}/thumbnail` | — | `bytes (PNG)` | — | Same contract; stage_id now a v2 ID. |
| GET | `/projects/{id}/pages/{idx0}/events` | — | `text/event-stream` | `stage-status`, `stage-progress`, `snapshot` | Per-page SSE channel — UNCHANGED shape. Sends `StageForcedStale` to eventsourcing when a push arrives via the project channel and propagates. |

**Stage-ID migration:** the 16 v2 page-scoped IDs replace the 22 v1 micro-stage IDs.
Mapping table in `stage-registry-v2.md §3.5`. Any `stage_id` not in the 16
v2 page-scoped IDs returns HTTP 422.

### 1.2 New project-stage routes (v2 only)

Project-scoped stages (`source`, `page_order`, `validation`, `proof_pack`,
`build_package`, `zip`, `submit_check`, `archive`) get their own route group
under `/projects/{id}/project-stages/`.

| Method | Path | Request schema | Response schema | Emitted events | Notes |
|--------|------|----------------|-----------------|----------------|-------|
| GET | `/projects/{id}/project-stages` | — | `list[ProjectStageState]` | — | Returns 8 project-scoped stages. Lazy-init mirrors page-stage contract. user_id check on project. |
| GET | `/projects/{id}/project-stages/{stage_id}` | — | `ProjectStageState` | — | Single stage row. 404 if not found. |
| POST | `/projects/{id}/project-stages/{stage_id}/run` | `StageRunRequest` | `Job` | `StageRunStarted` (eventsourcing) + `project-stage-status` SSE | Always async (project-scoped stages may be long-running). Returns 202 + `Job`. 409 on dep not-met OR registry version mismatch. |
| GET | `/projects/{id}/project-stages/{stage_id}/artifact` | — | varies (see §1.4) | — | Returns artifact bytes or redirect to storage key. 404 if stage not clean. |
| GET | `/projects/{id}/pipeline` | — | `PipelineSnapshot` (new) | — | Single fetch to hydrate `pipelineShell`: `{ project, page_stages_summary, project_stages, automation }`. Replaces the fragmented load. See §1.5. |

All project-stage routes return 409 on registry version mismatch (§1.3).
All project-stage routes filter by `user.user_id` via the project ownership check.

### 1.3 Registry-version 409 shape

From `stage-registry-v2.md §1`. Body for every project-scoped stage route when
`project.registry_version != 2`:

```json
{
  "error": "registry_version_mismatch",
  "project_version": 1,
  "server_version": 2
}
```

The page-stage routes (`/pages/{idx0}/stages/...`) also return this 409 — any
request to a v2 app with a v1 project is rejected uniformly.

### 1.4 Artifact fetch — project-scoped stage outputs

| stage_id | Artifact type | Content-Type | Notes |
|----------|--------------|--------------|-------|
| `source` | `page_attrs` JSON | `application/json` | Per-project attribute summary |
| `page_order` | `text/plain` (ordered page-id list) | `text/plain` | Newline-separated |
| `validation` | `validation_report` JSON | `application/json` | `ValidationReport` shape (§3) |
| `proof_pack` | directory artifact | redirect to storage | Presigned GET URL |
| `build_package` | submission zip | redirect to storage | Presigned GET URL |
| `zip` | submission zip + SHA256 | redirect to storage | Presigned GET URL; `X-Artifact-SHA256` header |
| `submit_check` | `SubmitCheckReport` JSON | `application/json` | (§3) |
| `archive` | `archive_manifest` JSON | `application/json` | Terminal stage |

The artifact route for `proof_pack`, `build_package`, and `zip` returns HTTP 302
to a presigned storage URL rather than streaming bytes, matching the pattern in
`assets.py`.

### 1.5 `GET /projects/{id}/pipeline` — pipelineShell hydration

The `pipeline-shell.yaml` `fetchPipeline` service is annotated as:

```
GET /api/projects/:id/pipeline -> { project, stages: StageState[23], automation }
```

(The YAML uses Express-style `:id` shorthand. The registered FastAPI route is
`GET /api/data/projects/{id}/pipeline` — under the `/api/data/` router prefix.)

This consolidates what would otherwise be 3 sequential fetches
(`GET /project`, `GET /pages/{idx0}/stages` ×N, `GET /project-stages`).

Response schema: `PipelineSnapshot`

```
{
  project: Project,
  page_stages_summary: list[PageStageSummary],
    # per-page: one row per stage_id, aggregated across pages
    # { stage_id, worst_status, stale_count, flagged_count }
  project_stages: list[ProjectStageState],
  automation: ProjectAutomation
}
```

`ProjectAutomation` mirrors the `automation` context block in `pipeline-shell.yaml`:

```
{
  auto_run_after_ingest: bool,
  rerun_downstream_on_stale: bool,
  notify_on_error: bool,
  pause_on_flag_pct: int
}
```

**RESOLVED (B5, 2026-06-10):** `stale_count` is per-stage-ID — the count of
pages where that stage has `status = dirty`. One summary row per stage ID;
`stale_count = len([p for p in all_pages if p.stage[stage_id].status == dirty])`.
Implemented in `api/data/project_stages.py` `_build_pipeline_snapshot()`.

### 1.6 Page-order mutation route (re-keyed from v1)

The existing `PATCH /projects/{id}/pages/reorder` route in `pages.py` continues
to exist with its current shape (`ReorderPagesRequest` / `ReorderPagesResponse`).

In v2 this route must additionally:

1. Append a `PageReorder` eventsourcing event (before/after order arrays).
2. Mark the `page_order` project stage dirty (`StageForcedStale` event).
3. Broadcast a `page-reorder` SSE event on the project channel (§2).

The request/response shape is **unchanged**; no new route is needed. The
`page_order` project stage (`POST .../project-stages/page_order/run`) invokes
the same underlying logic but as a pipeline stage with a `PageReorder` event
and a `page_order` artifact.

### 1.8 Stage settings routes (B5 — Group 4)

Per-stage settings management for page-scoped stages. The `StageSettingsStore`
(B2, `core/pipeline/stage_settings.py`) provides three-tier resolution:
override > saved default > registry default. Routes supply the registry default
from `V2_STAGE_IMPL` + an empty dict fallback; mutations append a `SettingsChange`
event to `PrepProjectAggregate` with `actor_id` from `user.user_id`.

All routes enforce the registry-version 409 guard. `stage_id` is validated
against `V2_PAGE_STAGE_IDS` (422 for unknown).

| Method | Path | Request schema | Response schema | Emitted events |
|--------|------|----------------|-----------------|----------------|
| GET | `/projects/{id}/pages/{idx0}/stages/{stage_id}/settings` | — | `dict[str, Any]` | — |
| PUT | `/projects/{id}/pages/{idx0}/stages/{stage_id}/settings` | `dict[str, Any]` | `dict[str, Any]` | `SettingsChange` |
| POST | `/projects/{id}/pages/{idx0}/stages/{stage_id}/settings/save-as-default` | `dict[str, Any]` | `dict[str, Any]` | `SettingsChange` |
| POST | `/projects/{id}/pages/{idx0}/stages/{stage_id}/settings/revert` | — | `dict[str, Any]` | `SettingsChange` |
| POST | `/projects/{id}/pages/{idx0}/stages/{stage_id}/settings/reset` | — | `dict[str, Any]` | `SettingsChange` |

- `GET .../settings` returns the current effective settings (override > default > registry).
- `PUT .../settings` saves a project override (one-time per-run, not persistent as "my default").
- `POST .../save-as-default` saves the body as the project-level default for this stage.
- `POST .../revert` deletes the override, reverting to saved default or registry default.
- `POST .../reset` deletes both override and saved default, reverting to registry default.

All mutation responses return the new effective settings after the write.

The `StageSettingsStore` is backed by a per-project SQLite DB at
`data_root/projects/{project_id}/stage_settings.db`.

### 1.9 Wordcheck and hyphen_join decision routes (B5 — Group 5)

Text review routes backed by B3's step modules. All enforce the 409 guard.
`stage_id` on wordcheck routes is always `"wordcheck"`; on hyphen-join routes
always `"hyphen_join"`.

| Method | Path | Request schema | Response schema | Emitted events |
|--------|------|----------------|-----------------|----------------|
| GET | `/projects/{id}/pages/{idx0}/stages/wordcheck/flags` | — | `WordcheckFlagsResponse` | — |
| POST | `/projects/{id}/pages/{idx0}/stages/wordcheck/decisions` | `WordcheckDecisionsRequest` | `WordcheckFlagsResponse` | `ReviewDecision` per decision |
| POST | `/projects/{id}/wordlist-promotion` | `WordlistPromotionRequest` | `{"promoted": true}` | `WordlistPromotion` |
| GET | `/projects/{id}/pages/{idx0}/stages/hyphen-join/candidates` | — | `HyphenJoinCandidatesResponse` | — |
| POST | `/projects/{id}/pages/{idx0}/stages/hyphen-join/decisions` | `HyphenJoinDecisionsRequest` | `HyphenJoinCandidatesResponse` | `ReviewDecision` per decision |

#### Request/response schemas (route-local unless reused)

```python
class WordcheckFlagsResponse(ApiModel):
    page_id: str
    stage_id: str = "wordcheck"
    flags: list[dict[str, Any]]   # [{word_id, word_text, flag_reason, status}, ...]
    flagged_count: int
    total_words: int

class WordcheckDecisionsRequest(ApiModel):
    decisions: list[dict[str, Any]]  # [{word_id, decision: "accepted"|"rejected"|"deferred"}, ...]

class WordlistPromotionRequest(ApiModel):
    word: str
    source_stage: str = "wordcheck"
    source_page_id: str
    list_scope: Literal["project", "global"]

class HyphenJoinCandidatesResponse(ApiModel):
    page_id: str
    stage_id: str = "hyphen_join"
    candidates: list[dict[str, Any]]  # [{candidate_id, prefix, suffix, offset, match_text, decision?}, ...]

class HyphenJoinDecisionsRequest(ApiModel):
    decisions: list[dict[str, Any]]  # [{candidate_id, decision: "join"|"keep"}, ...]
```

`GET .../wordcheck/flags` reads the wordcheck artifact (if stage is clean) and
projects `WordCheckDecision` events from the aggregate to compute current flag statuses.
Returns 404 if the wordcheck stage is not clean.

`POST .../wordcheck/decisions` appends `ReviewDecision` events for each decision and
returns the updated flags projection.

`POST .../wordlist-promotion` appends a `WordlistPromotion` event and updates the
project-scoped wordlist store (at `data_root/projects/{project_id}/wordlists.json`).

`GET .../hyphen-join/candidates` reads the hyphen_join input text (wordcheck artifact
or ocr text) and detects candidates. Projects `HyphenJoinDecision` events to show
current decision state. Returns 404 if no text artifact is available.

`POST .../hyphen-join/decisions` appends `ReviewDecision` events (disambiguation by
`stage_id="hyphen_join"`) and returns updated candidates.

### 1.7 Deprecations

Routes and patterns that die with the legacy surfaces:

| Deprecated | Replaced by | When |
|------------|-------------|------|
| `POST /projects/{id}/build-package` (flat job submit) | `POST /projects/{id}/project-stages/build_package/run` | When Track B4 lands |
| `POST /projects/{id}/run-dirty` (batch-all fan-out) | `pipelineShell` + `runAllStale.yaml` driving per-stage `stageRunner` runs | When Track F4 + B5 land |
| `GET /projects/{id}/review-status` (unreviewed count + awaiting_review job) | `GET /projects/{id}/pipeline` `project_stages` + `page_stages_summary` | When B5 lands |
| v1 page-stage IDs in `PAGE_STAGE_IDS` tuple | v2 IDs from `stage-registry-v2.md §2` | When B1 lands |
| `project_run_stage_all_pages` JobType | `runAllStale` coordinator (frontend-driven) + per-stage run routes | When F4 + B5 land |

The deprecated routes remain functional until the integration checkpoint (Task I1)
for their launcher group. They are removed in the same commit as the replacement
surfaces.

---

## 2. SSE decision — project channel

### 2.1 Decision

**Add a new project-level SSE channel** at
`GET /api/data/projects/{id}/events`.

Do NOT extend the per-page channel for project-scoped events.

### 2.2 Rationale

The `pipelineShell` machine is a singleton that monitors all 23 stage runners
simultaneously. If project-scoped events (source completion, page_order changes,
validation results, archive terminal) were multiplexed onto the existing
per-page channel, `pipelineShell` would need one SSE subscription per page —
potentially hundreds for a large book. That is impractical.

The alternative is routing project-scoped events through one page's channel
(e.g. a sentinel page), but that is non-obvious and couples unrelated concerns.

A single `GET /api/data/projects/{id}/events` channel:

- Gives `pipelineShell` one subscription regardless of page count.
- The `sseActor` in XState wraps it cleanly (`src: projectEventsSSE`).
- Event type names are distinct from the per-page channel's types (prefixed
  `project-stage-*`, not `stage-*`) so clients can route by type string.
- The per-page channel is unchanged; page workbench tools continue to use it
  for their fine-grained per-stage row updates.

### 2.3 Event payload schema

#### On-connect snapshot

The first frame on the project channel is a full snapshot of all 8
project-stage rows (mirrors the per-page channel's `snapshot` frame pattern):

```json
{
  "type": "project-snapshot",
  "project_stages": [
    {
      "project_id": "...",
      "stage_id": "source",
      "status": "clean",
      "stage_version": 2,
      "artifact_key": "projects/.../stages/source/output.json",
      "last_run_at": 1234567890.0,
      "duration_ms": 4200,
      "error_message": null,
      "job_id": null
    },
    ...
  ]
}
```

#### Incremental events

| SSE type string | When emitted | Payload fields |
|-----------------|-------------|----------------|
| `project-stage-status` | Any project-stage status transition | `stage_id: str`, `status: str` (ProjectStageStatus value), `job_id: str \| null`, `error_message: str \| null` |
| `project-stage-progress` | Long-running project stage (build_package, zip) emits progress ticks | `stage_id: str`, `progress: float` (0–1), `message: str` |
| `page-reorder` | `PageReorder` event appended (any page reorder mutation) | `new_order: list[str]` (ordered page idx0 strings) |
| `validation-updated` | `validation` stage run completes | `blockers: int`, `warnings: int`, `status: str` |

These type strings match `stage-registry-v2.md §5.4`.

### 2.4 Implementation note for the SSE actor (Track F2)

The XState `sseActor` in `frontend/src/machines/lib/sseActor.ts` should accept
a `channelUrl` parameter so both channels share the same actor factory:

```typescript
// Per-page channel (existing behavior, new actor wrapping)
sseActor({ url: `/api/data/projects/${pid}/pages/${idx0}/events` })

// Project channel (new)
sseActor({ url: `/api/data/projects/${pid}/events` })
```

The actor emits `STAGE_PUSH` (for `stage-status` / `stage-progress` frames) and
`STATUS_PUSH` (for `project-stage-status` / `page-reorder` / `validation-updated`
frames) into the machine. `pipelineShell` subscribes to the project channel and
routes `STAGE_PUSH` to the matching `stageRunner` via `routeStagePush`.

---

## 3. Pydantic schema inventory

All new schemas go in `src/pdomain_prep_for_pgdp/core/models.py` unless noted.
Names follow existing `ApiModel`-subclass conventions (PascalCase, `ApiModel`
base, `model_config = ConfigDict(json_schema_serialization_defaults_required=True)`).

### `ProjectStageState`

Mirrors `PageStageState` but scoped to a project (no `page_id` field; `project_id`
is the scope). Added to `core/models.py` and the new `project_stages` DB table.

```python
class ProjectStageState(ApiModel):
    project_id: str
    stage_id: str                               # one of the 8 project-scoped IDs
    status: ProjectStageStatus = ProjectStageStatus.not_run
    stage_version: int = 2
    artifact_key: str | None = None
    config_hash: str | None = None
    input_hash: str | None = None
    last_run_at: float | None = None            # epoch seconds
    duration_ms: int | None = None
    error_message: str | None = None
    job_id: str | None = None
```

### `StageRunRequest`

Request body for both `POST .../stages/{stage_id}/run` (page) and
`POST .../project-stages/{stage_id}/run` (project).

```python
class StageRunRequest(ApiModel):
    force: bool = False
    """Re-run even if the stage is already clean. Defaults False."""
    async_: bool = Field(False, alias="async")
    """Return a Job immediately rather than blocking. Always True for project-scoped stages."""
```

**Note:** The existing `run_page_stage` route currently uses `async_` as a query
parameter. In v2 it moves into the request body for consistency with the new
project-stage run route. The query parameter form is deprecated in B5 (new body
form added, old form still accepted) and removed at I1.

### `PageOrderUpdate`

Payload for the `page_order` project-stage artifact and `PageReorder` eventsourcing
event. Not a request body — this is the stored artifact + event payload shape.

```python
class PageOrderUpdate(ApiModel):
    new_order: list[str]       # ordered list of page idx0 strings, e.g. ["0000", "0001", ...]
    previous_order: list[str]  # full list before the reorder (required for reindex)
    actor_id: str = "default"  # user_id or "system"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
```

### `ValidationReport`

Artifact written by the `validation` project-stage. Also the response body for
`GET .../project-stages/validation/artifact`.

```python
class ValidationBlocker(ApiModel):
    page_id: str | None          # null for project-level blockers
    stage_id: str
    message: str
    code: str                    # machine-readable, e.g. "missing_text_review"

class ValidationWarning(ApiModel):
    page_id: str | None
    stage_id: str
    message: str
    code: str

class ValidationReport(ApiModel):
    project_id: str
    run_at: datetime
    blockers: list[ValidationBlocker]
    warnings: list[ValidationWarning]
    blocker_count: int
    warning_count: int
    passed: bool                 # True when blocker_count == 0
```

### `SubmitCheckReport`

Artifact written by the `submit_check` project-stage. Dry-run validation result
before the user commits to the `archive` terminal stage.

```python
class SubmitCheckReport(ApiModel):
    project_id: str
    run_at: datetime
    zip_sha256: str
    zip_size_bytes: int
    file_count: int
    issues: list[str]            # human-readable warnings or errors
    passed: bool                 # True when no blocking issues
```

### Additional schemas

| Schema | Purpose | Location |
|--------|---------|----------|
| `PipelineSnapshot` | Response for `GET /projects/{id}/pipeline` | `api/data/projects.py` (route-local) or `models.py` if reused |
| `PageStageSummary` | Per-stage-ID aggregate for `PipelineSnapshot.page_stages_summary` | `models.py` |
| `ProjectAutomation` | Automation toggles embedded in `PipelineSnapshot` and `ProjectSettings` | `models.py` |
| `ProjectStageStatus` | Enum: `not_run \| running \| clean \| dirty \| failed` | `models.py` — distinct from `PageStageStatus` (no `not_applicable` value); used by `ProjectStageState.status` and by the `project-stage-status` and `project-snapshot` SSE payloads |

**Decision on `ProjectStageStatus` vs `PageStageStatus`:** `PageStageStatus`
includes `not_applicable` (blank-page short-circuit). Project-scoped stages do
not have a `not_applicable` state — all 8 project stages apply to every project.
`ProjectStageStatus` is a separate enum: `not_run | running | clean | dirty |
failed`. Do not alias or reuse `PageStageStatus` for project-scoped stage fields.

---

## 4. Deprecations

### Full deprecation schedule

| Deprecated item | File | Replaced by | Removal task |
|----------------|------|-------------|--------------|
| `PAGE_STAGE_IDS` tuple (22 v1 IDs) | `core/models.py` | `V2_PAGE_STAGE_IDS` (16 IDs) + `V2_PROJECT_STAGE_IDS` (8 IDs) | B1 |
| `STAGE_CONFIG_FIELDS` keyed to v1 IDs | `core/pipeline/stage_runner.py` | Re-keyed to v2 IDs | B1 |
| `GET /pipeline/stages/{stage_id}/fields` | `api/data/pipeline.py` | Moved under `GET /projects/{id}/pipeline` or explicit v2 stage-fields route | B5 |
| `JobType.build_package` | `core/models.py` | `project-stages/build_package/run` (project-stage route) | B4/B5 |
| `JobType.project_run_dirty` | `core/models.py` | `runAllStale` + per-stage run routes | B5 |
| `JobType.project_run_stage_all_pages` | `core/models.py` | Per-stage run route | B5 |
| `POST /projects/{id}/build-package` | `api/data/projects.py` | `POST /projects/{id}/project-stages/build_package/run` | I1 (Pack group) |
| `POST /projects/{id}/run-dirty` | `api/data/projects.py` | `pipelineShell.RUN_ALL_STALE` + per-stage run routes | I1 (final) |
| `GET /projects/{id}/review-status` | `api/data/projects.py` | `GET /projects/{id}/pipeline` `page_stages_summary` | I1 (Text group) |
| `async` query param on stage run | `api/data/pages.py` | `StageRunRequest.async_` body field | I1 (deprecated B5, body form added; old form removed I1) |
| `PipelineState` + `StepState` + `StepId` | `core/models.py` | `ProjectStageState` + `PageStageState` | B1/I3 |
| v1 SSE-only per-page channel covering all stages | `core/stage_events.py` | Per-page channel (page-scoped stages only) + new project channel | B5 |

### Legacy batch job shape

The existing `POST /projects/{id}/run-dirty` accepted an optional `stage_filter`
query param to narrow the fan-out. The v2 replacement is the frontend-driven
`runAllStale` machine (which already sorts by stage index and calls individual
run routes). The backend `project_run_dirty` job type is deprecated; any in-flight
jobs at migration time are orphaned (no data migration, per spec D3).

---

## 5. Placement flags

Items discovered while writing this contract that belong upstream.

1. **`ProjectAutomation` shape** — if a second SPA in the pd-* suite needs
   "pipeline automation settings" (auto-run / downstream rerun toggles), this
   belongs in `pdomain-ops` or `pdomain-ui`. Currently PGDP-specific; flag for
   Task 0.4 review.

2. **`PageStageSummary` aggregation logic** — the per-stage-ID status aggregation
   across all pages (worst_status, stale_count, flagged_count) is generic
   pipeline math. If `pdomain-ops` grows a `StageDispatcher` protocol that tracks
   cross-page runs, this belongs there. Flag for Task 0.4.

3. **SSE `StageEventBroker`** (`core/stage_events.py`) — the in-memory pub/sub
   broker is currently per-page. Extending it to a project-level channel is
   app-local; no upstream movement needed. Noting here because Task B5 will
   modify it.

4. **`SubmitCheckReport` validation logic** — the actual pgdp.net upload
   pre-flight checks (file naming, zip structure) are PGDP-specific; stays here.

---

## 6. Summary of what does NOT change

To help implementers avoid unnecessary churn:

- `PageStageState` wire shape is unchanged (new fields may be added in B1, but
  existing fields are stable).
- Per-page SSE channel path and event type strings (`stage-status`,
  `stage-progress`, `snapshot`) are unchanged.
- `Project`, `PageRecord`, `ProjectConfig` models are unchanged.
- `JobStatus` enum is unchanged.
- Auth/user_id filtering pattern is unchanged on all routes.
- `PATCH /projects/{id}/pages/reorder` request/response shape is unchanged
  (side effects expand in B4).
- `GET /projects/{id}/pages` and all page-CRUD routes are unchanged.
