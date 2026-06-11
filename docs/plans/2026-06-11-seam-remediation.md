---
repo: pdomain/pdomain-prep-for-pgdp
spec: docs/specs/2026-06-10-statechart-convergence-design.md
status: ready
---

# Seam Remediation Plan

Three parallel audits (frontend wiring, backend execution, contract/e2e) hunted
for "designed-but-never-wired" seams after the page-naming gap was found
(capability existed, live path never called it). This plan consolidates every
finding into prioritized workstreams. Audit date: 2026-06-11, main @ 3035364.

**Method note for executors:** each item names file:line evidence from the
audit; verify against current code before fixing (lines drift). TDD per item.
Dual-write + event contracts (stage-registry-v2.md §5) apply to every new
route.

---

## W0 — CRITICAL: execution-path breakage (fix first, sequential)

| # | Seam | Evidence | Fix |
|---|------|----------|-----|
| W0.1 | **Async project-stage runs explode on dequeue**: `run_project_stage` enqueues `JobType.run_page_stage` with `scope:"project"` and NO `page_id`; `_handle_run_page_stage` reads `payload["page_id"]` → KeyError. (Sync path works; async is broken.) | project_stages.py:390-402; job_runner.py:481 | New `JobType.run_project_stage` + dedicated handler calling the project-stage impls; wire LongJobRunner here (W0.3) |
| W0.2 | **"Build Package" job runs the LEGACY v1 packaging path** — `_handle_build_package` imports `core.packaging.build_package` (no naming manifest, no PGDP validation, no v2 artifacts) | job_runner.py:426-446 | Point the handler at `build_package_v2_cpu` with manifest + built_at args, or delete `JobType.build_package` in favor of W0.1's handler |
| W0.3 | **LongJobRunner never wired** — proof_pack/build_package/zip/archive run synchronously in the request thread (once W0.1 fixed they'd block the event loop) | steps/*.py seam notes; project_stages.py | Dispatch long project stages via `pdomain_ops.gpu` LongJobRunner from the W0.1 handler; emit `project-stage-progress` ticks (W3.3) |
| W0.4 | **Gate chain not enforced at route layer** — build_package can run with dirty validation; `check_stage_gate` exists, no route calls it | project_stages.py:296-428 | Call `check_stage_gate` in `run_project_stage`; 409/422 with the gate reason |
| W0.5 | **`built_at` never passed** → zip non-deterministic in production despite B4's determinism work | build_package.py:296-318 | Pass the StageRunStarted event timestamp through the run path |

## W1 — Settings exist but are never applied (silent-wrong-behavior)

`StageSettingsStore` (3-tier, events) + settings routes + Source tool UI all
exist — but `run_stage` never reads the store; stage impls hardcode params.
User-saved settings are stored and **ignored**.

| # | Item | Evidence |
|---|------|----------|
| W1.1 | Thread effective settings into execution: `run_stage` loads StageSettingsStore → merge into the cfg handed to V2_STAGE_IMPL; include settings in `config_hash` so changes dirty the stage | stage_runner.py:968-973 |
| W1.2 | `_denoise_cpu` hardcodes `min_component_area=6` | stage_registry.py:711 |
| W1.3 | `_auto_deskew_cpu` ignores `skip_auto_deskew` (default True — deskew forced) | stage_registry.py:343-359 |
| W1.4 | `morph_fill` ignores `cfg.do_morph` | stage_registry.py:362-375 |
| W1.5 | `_canvas_map_cpu` hardcodes alignment + 1.294 ratio (per-page overrides ignored) | stage_registry.py:398-423 |
| W1.6 | `_post_transform_crop_cpu` is a pass-through (insets never applied) | stage_registry.py:778-787 |
| W1.7 | `_ocr_crop_cpu` is a pass-through (trims/splits never applied) | stage_registry.py:526-539 |
| W1.8 | `_crop_to_content_cpu` ignores `white_space_additional` | stage_registry.py:323-340 |

## W2 — Event log incomplete (breaks the D5 historization requirement)

| # | Item | Evidence |
|---|------|----------|
| W2.1 | `StageRunStarted/Completed/Failed` never recorded from `run_stage` | prep_aggregate.py:68-103, zero callers |
| W2.2 | `PageReorder` never recorded by the reorder route | pages.py:291-350 |
| W2.3 | `GateConfirmation` never recorded (mark-as-submitted swallows the POST in `catch {}` — frontend C10) | submit_check.py:107; submitCheckTool.ts:113-130 |
| W2.4 | `SettingsChange` never recorded — settings routes pass `aggregate=None` | pages.py:1480-1486 |
| W2.5 | `reindex` CLI ignores project_stages/naming manifest/validation report/settings (`reindex_project_stages` exists, never called from CLI) | cli/reindex.py |

## W3 — SSE types documented but never emitted

| # | Item |
|---|------|
| W3.1 | `page-reorder` — reorder route has no broker injection |
| W3.2 | `validation-updated` — nothing publishes it after validation completes |
| W3.3 | `project-stage-progress` — no project-stage progress emitter (wire via W0.3) |
| W3.4 | Frontend: `STATUS_PUSH` variants (snapshot/stage-status/page-reorder/validation-updated) not forwarded by PipelinePage (DIVERGENCES F4-8) — wire once W3.1/W3.2 emit |

## W4 — Missing backend routes for tool operations (frontend services are no-ops)

Confirm routes (machines advance, server never told — stage rows never go clean
from the UI): imageStageReview/text_zones/ocr/text_review/wordcheck/page_order/
source `confirmStage` + submit_check confirm (W2.3). **CT decision 2026-06-11:
bespoke routes** — one explicit route per stage, each typed to its stage's
payload (clear OpenAPI surface; no generic dispatch).

Aggregates (tools render empty on real projects): stage-pages aggregate
(`GET /project-stages/{stage_id}/pages` — replaces the pipeline-snapshot
workaround), ocr low-confidence tokens, hyphen scan, wordcheck accept-dict /
accept-high, text_review approve-low-risk, batched rerun (`POST .../rerun`
with pageIds — replaces the per-page loop).

Persistence (edits silently lost): page_order runs + naming — **CT decisions
2026-06-11: (a) N-run schema now** (new runs model supporting arbitrary folio
runs roman/arabic/letter-starts, replacing the two-range ProjectConfig mapping;
prefix computation reads the runs model); **(b) filename format gets a
universal 3–4 digit binding-order sequence number BEFORE the type code** —
target shape `<seq:3-4><type><folio?>` per the design's naming.jsx parts
{seq, type, folio} (e.g. `012f003`, 4-digit seq for >999 pages; total ≤8 chars
holds at 4+1+3); **(c) cover pages use type letter `e`** (free in the design
code table; the seq prefix makes sort=binding order regardless of letter, so
front AND back covers both work). compute_prefix/assign_prefixes + the naming
manifest + pgdp_naming validator + tests all update to this format. Also:
validation waiver, archive item toggles, text_zones
redetect/persist-layout + illustrations detect/persist-region (per-page),
project activity/attributes GET+PATCH, manage clean/saveCopy, pipeline
reset/purge destructive routes.

Structured artifacts: build_package deliverable JSON, proof_pack
tree/completeness, archive manifest — replace scaffold returns in services.

## W5 — Frontend wiring fixes (no backend needed)

| # | Item |
|---|------|
| W5.1 | **Dead controls** (workspace rule violation): OcrTool engine/backend selectors render but have no onClick; TextZonesTool splitsOn/granularity are local-state-only. Wire to machine + stageSettings (route exists). |
| W5.2 | Settings tabs G1–G6: wire `buildRealStageSettingsServices` into grayscale/ocr/text_zones/wordcheck/text_review/regex tools (Source is the wired reference) |
| W5.3 | `emitOrderChanged` no-op → notify pipelineShell (UPSTREAM_CHANGED fan-out after reorder) |
| W5.4 | WordcheckTool mounts a setTimeout feeding MOCK_SUSPECTS in production (mock-leak, breaks real flow) |
| W5.5 | pageOrderTool FOLIO_PUSH/FOLIOS_DONE never arrive — **CT decision 2026-06-11: initial fetch**. Drop the streaming design; fetch manifest + detected folios in one GET on mount; record the divergence. |
| W5.6 | Mock-leak imports: move computeDownstream/STAGE_DEPS + shared types out of `@/mocks/` into `lib/`+`types/` (5 machines + sse.ts + PostImportPage import from mocks) |
| W5.7 | MANIFEST_PUSH refetch gap after confirm (PageOrderTool effect only fires on workspace re-entry) |
| W5.8 | **`post_ocr_crop` missing from TOOL_REGISTRY** — renders placeholder; registry doc says imageStageReview (add schema entry + registration) |

## W6 — Contracts, tests, docs

| # | Item |
|---|------|
| W6.1 | testids contract: add pipeline-shell + all F5 tool testids (e2e already selects `archive-tool` etc. with zero contract protection); fix the stale "e2e does not use data-testid" comment |
| W6.2 | E2E gap tests (15 named in the audit): top priority — `test_create_project_and_import_source`, `test_all_stage_tool_slots_render_non_placeholder`, `test_image_stage_review_flag_then_accept`, `test_staleness_fanout_dot_color`, `test_submit_check_manual_attestation`, `test_source_tool_settings_save_as_default` |
| W6.3 | Deprecations table executions: `POST build-package`/`run-dirty`/`review-status` routes + `JobType.build_package`/`project_run_dirty`/`project_run_stage_all_pages` + `PipelineState`/`StepState`/`StepId` + the v1 22-stage DAG block in stage_dag.py — all still present, all marked for removal (fold into W0.1/W0.2) |
| W6.4 | DIVERGENCES ledger refresh: mark F5.6-12 + #10 resolved; correct F5-3-5's stale "stageSettings.ts not present" claim |

## Sequencing

1. **W0 first, sequential** (one agent — job handler + LongJobRunner + gates + built_at are one coherent change to the run path).
2. Then parallel: **W1** (settings threading, backend), **W2+W3** (events+SSE, backend), **W4** (routes, backend — coordinate with W2 on which routes record which events), **W5** (frontend), **W6.1/W6.4** (contracts).
3. **W6.2 e2e** last (it verifies the others); W6.3 folds into W0.

Estimated: W0 one heavy task; W1–W5 one task each; W6 one task. Same
orchestration rules as the convergence plan (worktrees, TDD, spec review per
task, orchestrator merges).
