---
repo: pdomain/pdomain-prep-for-pgdp
spec: docs/plans/2026-06-11-seam-remediation.md
status: ready
---

# Residue Cleanup — run-after-clear prompt

Paste the **Mission** section below into a fresh Claude Code session at
`/workspaces/ocr-container`. It carries everything left unfinished or
explicitly deferred from the statechart-convergence + seam-remediation +
GPU-pipeline arcs (all shipped and pushed through 2026-06-12,
prep-for-pgdp main `1417161`, book-tools v0.19.0).

---

## Mission

Work repo: `pdomain-prep-for-pgdp`. Finish the deferred residue from the
seam-remediation arc. Authoritative context (read first):

- `docs/plans/2026-06-11-seam-remediation.md` — the parent plan; this prompt
  is its leftover list.
- `docs/plans/2026-06-11-gpu-memory-pipeline.md` — GPU plan (all 3 phases
  shipped; perf item below).
- `frontend/src/machines/DIVERGENCES.md` — deviation ledger; grep `I2` and
  `future` tags.
- `docs/architecture/statechart-convergence-notes.md` — shipped-design notes.

Workspace rules apply (CLAUDE.md): worktrees, TDD, per-repo agents, spec
review per task, orchestrator merges, commit local / push only on say-so.
Recurring trap to actively hunt: **capability built but live path not wired**
(this arc found five: page_prefixes, compute_prefix_v2, batch-OCR job type,
segment runner, StageSettingsStore). Every task below must end wired,
not built.

### R1 — SourceTool settings persistence (W5.2 residue; user-facing)

`SourceToolSettings` (frontend/src/pages/pipeline/tools/SourceToolSettings.tsx)
holds `thumbQuality`/`workers`/`autoConfirm` in local React state; nothing
feeds the sourceTool machine's settings region, so `_settingsDraft` never
populates and `settings-save-btn` never renders — save-as-default is
unreachable in the UI even though machine + routes + store all work. Wire
form `onChange → CHANGE_SETTING`, verify the full flow (change → save-as-
default → reload → persisted), and un-skip/extend the W6.2 e2e
`test_source_tool_settings_save_as_default` to the full round-trip.

### R2 — Remaining I2 DRIFT service stubs (grep `DRIFT` in frontend/src/services/)

Each is a typed no-op/scaffold; add the backend route + wire, or (only if the
data truly cannot exist yet) record an explicit decision in DIVERGENCES:

- `textZonesTool`: `fetchZonePages` (zone-page aggregate — derive from
  text_zones artifacts), `redetectLayout`, `persistLayout` (per-page zone
  routes).
- `ocrTool.fetchPageTokens` — low-confidence token aggregate (from words.json
  artifacts).
- `hyphenJoin.scanHyphenation` — project-level hyphen scan (B3's
  detect_candidates over all pages).
- `buildPackageTool` — structured deliverable/manifest JSON (artifact route
  exists since W4-G5 for proof_pack/archive; build_package still returns a
  scaffold).
- `pagesGrid.fetchPages` — dedicated aggregate (currently snapshot-derived;
  also its error-catch silently returns `[]` — surface errors).
- `regexPass` fetchRules/applyRules, `grayscaleTool.detectProfile`,
  `illustrationsTool` detect/persist-region, `zipTool` rebuild — routes never
  scoped into W4; scope and ship them now.

### R3 — W6.3 leftovers (v1 model removal)

`PipelineState`/`StepState`/`StepId` remain in `core/models.py`, actively
used by `core/ingest.py` + `api/data/projects.py`; the v1 22-stage
`STAGE_DAG`/`_STAGE_DAG_TABLE` block remains in `stage_dag.py`. Migrate the
ingest path onto v2 stage state (ingest = the `source` project stage), then
delete all four. This is its own design slice — read how ingest writes
PipelineState today before cutting.

### R4 — pipelineShell STATUS_PUSH seeding

`routeStatusPush` in `frontend/src/machines/pipelineShell.ts` is a
placeholder (W2/W3 note: "full I2 snapshot seeding deferred"). Implement:
`snapshot` frames seed/reconcile all runner states on (re)connect;
`stage-status`/`page-reorder`/`validation-updated` already forward — verify
each consumer actually reacts (validationTool refetch, pageOrder manifest
refetch) with machine tests.

### R5 — LongJobRunner adoption + progress fidelity

Project stages run via `asyncio.run_in_executor` with coarse 0.0/1.0
progress ticks. Adopt `pdomain_ops.gpu` LongJobRunner for proof_pack /
build_package / zip / archive with real incremental `project-stage-progress`
(page-count granularity for build; byte/file ticks for zip), or record a
decision that run_in_executor is the permanent mechanism and delete the
LongJobRunner seam docstrings.

### R6 — E2E residue (tests/e2e/)

- The four W6.2 skips: page-reorder drag (try Playwright drag_and_drop or
  keyboard reorder), validation-waiver UI flow (UI exists since W4 — verify
  wiring first), text_review approval (needs a tiny real-OCR fixture — one
  2-page CPU run is acceptable locally), naming-preview shows v2
  `000f001`-style prefixes after a page_order run.
- Strengthen `test_create_project_and_import_source` into the full
  UI-click pipeline walk the convergence plan originally wanted (import →
  run-all → flag-resolve → attest → validate → build → zip → submit-confirm
  → archive through the UI; OCR on 2 pages CPU). Timebox: if the full walk
  exceeds ~3 min, split into two tests at the OCR boundary.

### R7 — GPU follow-through

- End-to-end perf benchmark: a 20-page synthetic book through run-all on the
  local RTX 3070 vs CPU-only (`PD_GPU_BACKEND=cpu`) — wall-clock + VRAM
  ceiling, recorded in the GPU plan doc as-built section. (No benchmark has
  ever been run; the plan's savings are estimates.)
- Consider widening the island: `crop` (find_content_edges/crop_to_content)
  and `rescale` have no CuPy mirrors — measure first; only build mirrors if
  the boundary transfer actually costs (benchmark decides; placement:
  book-tools).
- Phase-1 leftover: `get_bytes_for_write`/`encode_count` in
  stage_write_executor are dead code (encode still on hot path for
  content_hash). Either wire hash-from-raw-bytes so encode truly defers, or
  delete the dead hooks (reviewer note A1/A2 in the GPU plan history).

### R8 — DIVERGENCES "genuinely future" items (pick with CT, don't all-do)

`VALIDATE_WORD_GROUP` word-grouping panel; `ADD_WORD_RULE` global library
dialog; paste-URL / import-archive project entry points (need backend
ingest-by-URL/archive); machine-side child spawning (F3-4/F4-1/F4-2);
promote `createSseActor` + `bindQueryClient` to pdomain-ui (cross-repo);
N>2 folio-run UI affordances. Present these to CT as a checklist before
implementing any.

### R9 — Hygiene

- Untracked stray: `docs/plans/2026-06-08-compute-settings-panel-backlog.md`
  (predates this arc — ask CT: adopt into a plan or delete).
- Stale worktrees: prep-for-pgdp `.claude/worktrees/{fix-spa-catchall-
  traversal, pdomain-hf-model-defaults}`, pdomain-ui has ~6, plus
  `/workspaces/ocr-container/.worktrees/pdomain-config-release-remediation-*`
  — run `/workspace-cleanup` or triage with CT (some may hold live work).
- `.claire/` junk dirs in prep-for-pgdp canonical (agent typo artifacts;
  `rm -rf` was permission-denied for agents — CT removes or grants).
- `specs/02-pipeline-steps.md` carries a v2-staleness banner; consider a
  proper rewrite against stage-registry-v2.md (docs-only slice).

### Suggested order

R1 + R4 (small, user-facing) → R2 (routes batch, parallel-friendly) →
R6 (e2e validates R1/R2) → R3 (its own design slice) → R5 + R7 (decide-then-
do) → R8 (CT checklist) → R9 (hygiene). Verify with `make ci AI=1` +
`make e2e AI=1` per merge; GPU tests on the local card for R7.

### Done when

Every R-item is either shipped+tested or has an explicit CT decision recorded
(DIVERGENCES/plan doc); `grep -rn "DRIFT" frontend/src/services/` returns
only deliberate, decision-backed entries; the plan docs' status lines updated.
