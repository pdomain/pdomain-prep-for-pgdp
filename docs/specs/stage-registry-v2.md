# Stage registry v2 contract

**Date:** 2026-06-10
**Status:** Phase 0 gate — frozen. Changes require editing this doc in the
same commit as any code that diverges from it.
**Spec:** `docs/specs/2026-06-10-statechart-convergence-design.md` §4

---

## 1. Registry version constant

```
REGISTRY_VERSION = 2
```

**Module:** `src/pdomain_prep_for_pgdp/core/pipeline/stage_dag.py`
(lives alongside `STAGE_VERSIONS`; same import surface used by the runner).

**Stamped at:** project-row creation time, stored on the `projects` table
(new `registry_version INTEGER NOT NULL DEFAULT 2` column).

**Mismatch response:** HTTP 409 with body:

```json
{
  "error": "registry_version_mismatch",
  "project_version": 1,
  "server_version": 2
}
```

Any API access to a v1 project returns this 409; no stage run proceeds.
`pgdp-prep reindex` also surfaces this instead of silently re-running.

---

## 2. The 24 v2 stages

Two scopes:

- **page** — one row per page in `page_stages` (same table as today).
- **project** — one row per project in the new `project_stages` table (same
  dual-write + event contract as `page_stages`).

### 2.1 Registry table

One row per stage. "Upstream deps" are the dirty-propagation edges (re-running
stage X marks these descendants stale; the `compute_dirty_descendants`
function traverses them). Cross-scope edges are noted explicitly.

| # | stage_id | Launcher group | Scope | Upstream deps | Inputs → Outputs | Folded legacy micro-stages | Status | Owning machine(s) |
|---|----------|---------------|-------|---------------|-----------------|---------------------------|--------|--------------------|
| 01 | `source` | Source | project | _(root)_ | source bytes → ingested pages + thumbnails + page-attrs | `ingest_source`, `thumbnail`, `auto_detect_attrs`, `decode_source` | re-cut | `sourceTool` |
| 02 | `grayscale` | Image prep | page | `source` | image → gray | `manual_deskew_pre` (pre-crop flip/rotate, folded into the source-to-gray path) | re-cut | `grayscaleTool` |
| 03 | `crop` | Image prep | page | `grayscale` | image → cropped binary | `initial_crop`, `find_content_edges`, `crop_to_content` | re-cut | `pagesGrid` |
| 04 | `threshold` | Image prep | page | `crop` | binary → binary (binarised + inverted) | `threshold`, `invert` | re-cut | `imageStageReview` |
| 05 | `deskew` | Image prep | page | `threshold` | binary → binary (deskewed) | `manual_deskew_pre` (post-crop rotation), `auto_deskew` | re-cut | `imageStageReview` |
| 06 | `denoise` | Image prep | page | `deskew` | binary → binary | _(no legacy counterpart)_ | new | `imageStageReview` |
| 07 | `dewarp` | Image prep | page | `denoise` | binary → binary | _(no legacy counterpart)_ | new | `imageStageReview` |
| 08 | `post_transform_crop` | Image prep | page | `dewarp` | binary → binary (final pre-canvas crop) | `initial_crop` (post-deskew trim component — see §3.3) | re-cut | `imageStageReview` |
| 09 | `post_ocr_crop` | Image prep | page | `canvas_map` | image_bytes → image_bytes (OCR-margin trim) | `ocr_crop` | re-cut | `imageStageReview` |
| 10 | `text_zones` | OCR | page | `post_transform_crop` | binary → zone JSON + proofing-image (owns APPLY_SPLIT page-set mutation) | _(no legacy counterpart; zone detection was inside monolith)_ | new | `textZonesTool` |
| 11 | `ocr` | OCR | page | `post_ocr_crop` | image_bytes → words.json + raw.txt | `ocr` | exists | `ocrTool` |
| 12 | `page_order` | Compose | project | `source` (cross-scope), `text_zones` (cross-scope, all pages settled) | reading-order list → ordered page sequence | _(no legacy counterpart; drag-drop reorder was UI-only)_ | new | `pageOrderTool` |
| 13 | `wordcheck` | Text | page | `ocr` | words.json → flagged-words report | _(no legacy counterpart; scannos were in text_postprocess)_ | new | `wordcheckTool` |
| 14 | `canvas_map` | Compose | page | `post_transform_crop`, `blank_proof_synth` (alt path) | binary → image_bytes (proofing image PNG) | `morph_fill`, `rescale`, `canvas_map` (legacy), `blank_proof_synth` | re-cut | `imageStageReview` (+ extras) |
| 15 | `hyphen_join` | Text | page | `wordcheck` | words.json → hyphen-candidate decisions | _(no legacy counterpart)_ | new | `hyphenJoin` |
| 16 | `text_review` | Text | page | `hyphen_join`, `regex` | text → reviewed text + attestation | `text_review` | exists | `textReviewTool` |
| 17 | `illustrations` | Compose | page | `source` (cross-scope, thumbnail artifact) | image_bytes + regions → hi-res crops | `auto_detect_illustrations`, `extract_illustrations` | re-cut | `illustrationsTool` |
| 18 | `regex` | Text | page | `hyphen_join` | text → transformed text | `text_postprocess` | re-cut | `regexPass` |
| 19 | `validation` | Pack | project | `text_review` (all pages), `illustrations` (all pages), `page_order` (cross-scope) | page flags → blockers + warnings report | _(no legacy counterpart; build_package did implicit checks)_ | new | `validationTool` |
| 20 | `proof_pack` | Pack | project | `validation` | pages + reviewed text → proof bundle artifact | _(no legacy counterpart)_ | new | `proofPackTool` |
| 21 | `build_package` | Pack | project | `proof_pack` | proof bundle → PGDP submission zip | `build_package` (existed but page-scoped + implicit gate) | re-cut | `buildPackage` |
| 22 | `zip` | Pack | project | `build_package` | submission zip → deterministic archive + sha256 | _(no legacy counterpart; was part of build_package)_ | new | `zipTool` |
| 23 | `submit_check` | Pack | project | `zip` | archive → dry-run validation report | _(no legacy counterpart)_ | new | `submitCheck` |
| 24 | `archive` | Pack | project | `submit_check` | project → cold-storage manifest (terminal) | _(no legacy counterpart)_ | new | `archiveTool` |

### 2.2 Stage scope summary

**Page-scoped (16):** grayscale, crop, threshold, deskew, denoise, dewarp,
post_transform_crop, post_ocr_crop, text_zones, ocr, wordcheck, canvas_map,
hyphen_join, text_review, illustrations, regex.

**Project-scoped (8):** source, page_order, validation, proof_pack,
build_package, zip, submit_check, archive.

Cross-scope dirty propagation: any page-scoped stage completing a re-run
marks `validation` (and its downstream chain) stale; `page_order` changes
likewise. The `compute_dirty_descendants` implementation must traverse
project-scoped stages as continuations of the page-scoped graph.

---

## 3. Folding analysis — v1 micro-stages vs §4.2

### 3.1 Verified matches (§4.2 matches current registry)

| New stage | §4.2 folding | Current registry micro-stages | Verdict |
|-----------|-------------|-------------------------------|---------|
| `crop` | `initial_crop` + `find_content_edges` + `crop_to_content` | Exists: `initial_crop`, `find_content_edges`, `crop_to_content` in `stage_dag.py` | **Match** |
| `threshold` | `threshold` + `invert` | Exists: `threshold`, `invert` | **Match** |
| `deskew` | `manual_deskew_pre` + `auto_deskew` | Exists: `manual_deskew_pre`, `auto_deskew` | **Match** |
| `source` | `ingest_source` + `thumbnail` + `auto_detect_attrs` + `decode_source` | Exists: all four in registry | **Match** |
| `illustrations` | `auto_detect_illustrations` + `extract_illustrations` | Exists: both in registry | **Match** |

### 3.2 Divergence: `canvas_map` folding

**§4.2 says:** `canvas_map` absorbs `morph_fill` + `rescale` + proofing-image
synthesis.

**Current registry has:** `morph_fill`, `rescale`, `canvas_map` as three
separate stages, plus `blank_proof_synth` (the "blank-page short circuit"
for blank/plate_b/plate_r page types) as a sibling stage producing the same
output type.

**Decision recorded:** The v2 `canvas_map` stage folds `morph_fill` and `rescale`
and the legacy `canvas_map` implementation and the `blank_proof_synth` alt path.
In the v2 design the blank-page short circuit becomes an internal branch of
`canvas_map` (guarded by page type), not a sibling stage. The `any_parent_ok`
DAG edge from `canvas_map`/`blank_proof_synth` → `ocr_crop` (v1) collapses:
v2's `canvas_map` always produces the proofing image via one of its two
internal branches.

### 3.3 Divergence: `post_transform_crop` placement

**§4.2 doesn't mention `post_transform_crop` explicitly** (only lists the
new stages without folding detail).

**Current registry:** `initial_crop` (applied pre-`grayscale`) and `ocr_crop`
(applied post-`canvas_map`) cover two distinct crop moments. The design
introduces `post_transform_crop` between `dewarp` and `text_zones` as a
separate image-review stage.

**Decision recorded:** `post_transform_crop` is a new stage. It absorbs the
"post-deskew optional trim" function that was conceptually part of `initial_crop`
at default config (no-op). The split makes the pre-canvas crop point
user-reviewable (matching the `imageStageReview` pattern). The legacy
`initial_crop` no-op behavior collapses into `crop` (which already handles
initial inset trimming). No v1 micro-stage maps cleanly to `post_transform_crop`.
**Treat as new.**

### 3.4 Divergence: `text_postprocess` → `regex`

**§4.2:** `regex` = re-cut of `text_postprocess`.

**Current registry:** `text_postprocess` (id = `text_postprocess`) with
implementation in `core/text_postprocess.py`. The stage does: curly-quote
normalization + em-dash conversion + (deferred) per-project scanno rules.

**Decision recorded:** v2 renames/re-keys the stage to `regex`; the
implementation is reused. The scanno/wordcheck logic is split off into the
new `wordcheck` stage. The B3 task will extract and wire accordingly.

### 3.5 Not in §4.2 folding table but present in v1

| v1 stage | Disposition in v2 |
|----------|-------------------|
| `blank_proof_synth` | Folded into `canvas_map` (internal branch) — see §3.2 |
| `ocr_crop` | Becomes `post_ocr_crop` (re-keyed) |
| `extract_illustrations` | Folded into `illustrations` — see §3.1 |
| `auto_detect_illustrations` | Folded into `illustrations` — see §3.1 |
| `thumbnail` | Folded into `source` — see §3.1 |
| `auto_detect_attrs` | Folded into `source` — see §3.1 |
| `decode_source` | Folded into `source` — see §3.1 |
| `ingest_source` | Folded into `source` — see §3.1 |
| `morph_fill` | Folded into `canvas_map` — see §3.2 |
| `rescale` | Folded into `canvas_map` — see §3.2 |
| `manual_deskew_pre` | Split: pre-crop component → `grayscale` path; post-crop component → `deskew`. |
| `initial_crop` | Folded into `crop` |
| `find_content_edges` | Folded into `crop` |
| `crop_to_content` | Folded into `crop` |
| `invert` | Folded into `threshold` |
| `auto_deskew` | Folded into `deskew` |
| `text_postprocess` | Re-keyed to `regex` — see §3.4 |

---

## 4. The 23-stageRunners vs 24 stages — resolution

**The registry has 24 stages; `pipelineShell` spawns 23 `stageRunner` instances.**

**Evidence:**

`docs/plans/design_handoff_pgdp_app/statecharts/pipeline-plan.md`, §3 "The
shared, per-instance machine (spawned ×23)":

> "**`stageRunner`** | `stage-runner.yaml` | one per `STAGE_DEFS` entry | …"
> followed by the table header "Instances" = "one per `STAGE_DEFS` entry"

and §8:

> "`stageRunner` is the shared machine, defined once and **spawned ×23** —
> that's where the 'shared' lives."

`docs/plans/design_handoff_pgdp_app/statecharts/README.md`, §"Project pipeline
(spine)":

> "`pipelineShell` | singleton | Spawns the stage runners; …"
> "`stageRunner` | shared ×N stages | One stage's run lifecycle"

The Stage → machine map in `README.md` maps `01 Source` to **`sourceTool`**,
not `stageRunner`. `source` is **project-scoped** (§4.3 of the convergence
spec) and its machine is `sourceTool` — a bespoke tool machine, not a
`stageRunner` instance.

**Resolution:** `source` is the one stage without a `stageRunner` instance.
It has its own `sourceTool` machine. The 23 `stageRunner` instances correspond
to stages 02–24 (all 23 non-source stages). This is not an inconsistency —
it is by design: `source` orchestrates ingest, not a run-lifecycle loop.

**Implication for Task F4 (pipelineShell):** The test `pipelineShell` spawns
one stageRunner per runner-stage with correct `input.stageId` must assert
count == 23, not 24. `sourceTool` is mounted separately (not via
`stageRunner`).

---

## 5. Event vocabulary extension

### 5.1 Existing event infrastructure

Two separate event mechanisms exist today:

1. **SSE pub/sub** (`core/stage_events.py`, `StageEventBroker`): in-memory,
   per-page, not persisted. Payload: `{"type": <event_type>, "stage_id": ..., "status": ...}`.
   Current type strings: `"stage-status"`, `"stage-progress"`, `"snapshot"`.

2. **Event-sourcing store** (`core/page_store_factory.py`, backed by
   `pdomain_ops.page_aggregate`): per-project `events.db` via the
   `eventsourcing` library. Existing event names (from the pinned installed
   wheel's `pdomain_ops/page_aggregate.py`): `ImageIngested`,
   `ImagePreprocessed`, `OcrCompleted`, `GtMapped`, `LabelerEdited`,
   `Exported`, `ExtensionSet`, `ProjectCreated`, `PageAdded`, `PageReordered`,
   `PageRemoved`, `ProjectExported`.
   (`RotationUpdated` exists in the pdomain-ops source repo but is not present
   in the pinned installed release; it is excluded from this collision list.)

The convergence spec §4.4 (D5) says "the existing event store remains the
system of record" and vocabulary extends with new event types. The event-store
here means the `pdomain_ops` eventsourcing store, not the SSE broker.

**Note on naming convention:** Existing eventsourcing event names are
PascalCase (e.g. `PageReordered`). New event names below follow the same
convention. SSE `type` strings keep kebab-case (e.g. `stage-status`) for
wire compatibility — these are distinct from the eventsourcing event names.

### 5.2 New event vocabulary table

All new events are appended to the eventsourcing store. Every event has
implicit fields: `originator_id` (aggregate UUID), `originator_version`
(sequence number), `timestamp` (UTC datetime), `actor_id` (user_id or
`"system"` for automated runs).

| Event name | Trigger | Payload fields | Notes |
|------------|---------|---------------|-------|
| `StageRunStarted` | Stage execution begins | `stage_id: str`, `page_id: str \| None`, `job_id: str` | `page_id` null for project-scoped stages |
| `StageRunCompleted` | Stage execution succeeds | `stage_id: str`, `page_id: str \| None`, `status: Literal["clean","flagged"]`, `duration_ms: int`, `artifact_key: str` | |
| `StageRunFailed` | Stage execution fails | `stage_id: str`, `page_id: str \| None`, `error_message: str`, `duration_ms: int` | |
| `StageForcedStale` | Upstream re-run cascades dirty | `stage_id: str`, `page_id: str \| None`, `caused_by_stage: str` | Emitted per affected stage |
| `ReviewDecision` | Reviewer approves/flags a page within a stage | `stage_id: str`, `page_id: str`, `decision: Literal["clean","flagged","reviewed"]`, `note: str \| None` | |
| `PageReorder` | User reorders pages in page_order stage | `new_order: list[str]`, `previous_order: list[str]` | Full before/after sequence for reindex |
| `GateConfirmation` | Two-step gate confirmed | `gate: Literal["two_step_delete","submit_confirm"]`, `target_id: str` | Used by manageActions + submitCheck |
| `SettingsChange` | Stage or project settings changed | `scope: Literal["stage","project"]`, `stage_id: str \| None`, `before: dict`, `after: dict` | Full before/after for reindex |
| `WordlistPromotion` | Word promoted to project/global word list | `word: str`, `source_stage: str`, `source_page_id: str`, `list_scope: Literal["project","global"]` | Cross-project write |
| `SplitFanout` | text_zones APPLY_SPLIT creates sibling pages | `parent_page_id: str`, `split_stage: str`, `children: list[{"page_id": str, "split_index": int, "source_crop_bbox": list[int]}]` | Downstream stages stale on all children |

### 5.3 Collision check

No name collision found against existing eventsourcing events:

- `PageReordered` exists in pdomain_ops (on ProjectAggregate, for labeler use)
- v2's `PageReorder` differs by name (no past tense suffix) and carries
  full `new_order`/`previous_order` arrays, not a single-page mutation.

**Decision recorded:** the prep-for-pgdp app registers its new event names
on the prep-domain aggregate (a `PrepProjectAggregate` to be created in B1),
not on `pdomain_ops.page_aggregate.ProjectAggregate`. This avoids stomping
ops event names and keeps the event vocabulary namespaced per app. The
eventsourcing library routes by aggregate UUID so both can coexist in the
same `events.db`.

### 5.4 SSE event types (wire protocol, not eventsourcing)

Existing SSE type strings remain unchanged:

- `stage-status` — stage lifecycle transitions
- `stage-progress` — intermediate progress ticks
- `snapshot` — full page state dump on SSE connect

New SSE type strings for v2:

| SSE type string | Payload added | Notes |
|----------------|---------------|-------|
| `project-snapshot` | `{"type": "project-snapshot", "project_stages": [...]}` | On-connect snapshot of all 8 project-stage rows; first frame on the project channel (mirrors per-page `snapshot`) |
| `project-stage-status` | `{"type": "project-stage-status", "stage_id": ..., "status": ..., "job_id": ..., "error_message": ...}` | Project-scoped equivalent of `stage-status`; emitted on the new project-level channel |
| `project-stage-progress` | `{"type": "project-stage-progress", "stage_id": ..., "progress": 0.0–1.0, "message": ...}` | Progress ticks for long-running project stages (build_package, zip); project-scoped equivalent of `stage-progress` |
| `page-reorder` | `{"type": "page-reorder", "new_order": [...]}` | Pushed to all connected clients on the project channel |
| `validation-updated` | `{"type": "validation-updated", "blockers": N, "warnings": N, "status": ...}` | Pushed when validation stage re-runs; `status` is a `ProjectStageStatus` value |

---

## 6. Artifact types reference

| Type string | On-disk encoding | Consumer |
|-------------|-----------------|----------|
| `image_bytes` | PNG (`output.png`) | cv2.imdecode |
| `image` | PNG (`output.png`) | cv2.imdecode (color) |
| `gray` | PNG (`output.png`) | cv2.imdecode (single-channel) |
| `binary` | PNG (`output.png`) | cv2.imdecode (single-channel) |
| `jpeg_bytes` | JPEG (`output.jpg`) | thumbnail display |
| `bbox` | JSON 4-tuple (`output.json`) | runner JSON-loads |
| `page_attrs` | JSON dict (`output.json`) | runner JSON-loads as PageAttrsOutput |
| `illustration_regions` | JSON list (`output.json`) | runner JSON-loads |
| `words+text` | `words.json` + `raw.txt` (compound) | OCR downstream stages |
| `text+attestation` | `output.txt` + `attestation.json` (compound) | packaging |
| `hi_res_crops` | compound dir of PNGs | packaging |
| `zone_json` | JSON (`output.json`) | text_zones consumer (new) |
| `text` | `output.txt` (UTF-8) | text stages |
| `validation_report` | JSON (`output.json`) | build_package gate |
| `proof_bundle` | directory artifact | build_package input |
| `submission_zip` | `.zip` file | zip → submit_check |
| `archive_manifest` | JSON (`output.json`) | terminal |

---

## 7. Placement flags

Items discovered while writing this contract that belong upstream:

1. **`denoise` algorithm** — the `dewarp` implementation already lives in
   `pdomain-book-tools` (textline dewarp shipped as of v0.17.x). The new
   `denoise` stage similarly belongs in pdomain-book-tools if the labeler/CLI
   could reuse it. Task 0.4 (library placement) is the decision point.

2. **`wordcheck` / `hyphen_join` text logic** — if these are
   language-agnostic enough, they belong in pdomain-book-tools (reusable by
   pdomain-ocr-cli). Flag for Task 0.4.

3. **`PrepProjectAggregate` eventsourcing aggregate** — the new event types in
   §5.2 need a home aggregate. This is app-local PGDP logic, not generic
   plumbing, so it stays here (not promoted to pdomain-ops). Placement:
   `src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py` (new in B1).

4. **Project-level SSE channel** — the new `project-stage-status` etc. events
   (§5.4) require a project-level SSE endpoint. This is app-local; noted for
   Task 0.3 (API deltas) and B5 (routes + SSE).

---

## 8. Open questions

None blocking. Items deferred to downstream tasks:

- Exact `WB_MAP` stage control schema definitions → Task 0.5
  (`docs/specs/machine-stage-map.md`).
- SSE channel shape decision (project channel vs join existing per-page
  channel) → Task 0.3 (`docs/specs/api-v2-deltas.md`).
- Whether `wordcheck` / `hyphen_join` belong in pdomain-book-tools →
  Task 0.4 (`docs/specs/library-placement.md`).
