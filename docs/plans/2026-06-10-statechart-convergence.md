---
repo: pdomain/pdomain-prep-for-pgdp
spec: docs/specs/2026-06-10-statechart-convergence-design.md
status: ready
---

# Statechart Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge the app onto the design package — backend re-cut to the 24
design stages, frontend rebuilt on XState v5 per the 28 statecharts, generic UI
promoted into pdomain-ui — while preserving the event-sourced historized data
model.

**Architecture:** Contract-first parallel tracks. A short sequential Phase 0
freezes the contracts (registry v2, OpenAPI deltas, machine↔stage map,
pdomain-ui promotion list, mock fixtures). Then backend Track B and frontend
Track F run as parallel subagents against the frozen contracts, converging per
launcher group. Statecharts are authoritative for behavior; `final/` canvases
for appearance; `design-system/` + pdomain-ui for the visual language.

**Tech Stack:** FastAPI + Python 3.13 + SQLite/event store (backend); React 19
+ Vite + TS + **XState v5** + TanStack Query + Konva (frontend);
`@pdomain/pdomain-ui` (shared kit); Playwright (e2e).

**Authoritative inputs (every task reads its slice of these first):**

- Spec: `docs/specs/2026-06-10-statechart-convergence-design.md` (decisions D1–D6)
- Design package: `docs/plans/design_handoff_pgdp_app/`
  (`statecharts/README.md` is the architecture document;
  `statecharts/pipeline-plan.md` the rationale; `PROMPT.md` the convergence brief)
- Current backend: `src/pdomain_prep_for_pgdp/core/pipeline/`
  (`stage_registry.py`, `stage_dag.py`, `stage_runner.py`), `api/data/`
- Current frontend: `frontend/src/`

**Plan-shape note:** Tasks here are sized for one subagent dispatch each (hours,
not minutes). Inside a task, the executing agent follows TDD micro-steps
(failing test → run → implement → run → commit) per behavior; this plan
specifies the behaviors, files, interfaces, and acceptance gates rather than
repeating the design package's content inline. Where a later task depends on a
Phase 0 artifact, the artifact path is the contract — read it, don't guess.

**Orchestration rules (apply to every task):**

- Dispatch implementation subagents with `isolation: "worktree"`; agents commit
  on their branch and return path + branch; **the orchestrator owns
  rebase + ff-merge to main** (no agent self-merges, no PRs, no pushes).
- Run `make ci AI=1` green in the worktree before returning.
- Tasks marked ∥ within a phase may be dispatched concurrently (separate
  worktrees). Tasks listed as gates must merge before dependents dispatch.
- pdomain-ui work (Task F1b) is dispatched to the `pdomain-ui` repo agent, not
  this repo's agent.
- **Library placement rule (spec §6):** before implementing anything in-repo,
  each task checks the placement contract (`docs/specs/library-placement.md`,
  Task 0.4): image/OCR/text primitives → pdomain-book-tools; eventsourcing /
  dispatch plumbing → pdomain-ops; shared frontend kit → pdomain-ui;
  PGDP-specific logic stays here. A task that discovers an unlisted placement
  candidate mid-flight reports it in its return summary instead of silently
  implementing locally; the orchestrator routes it to the owning repo's agent.

**Dependency graph:**

```
Phase 0:  T0.1 ──► T0.2 ∥ T0.3 ∥ T0.4 ∥ T0.5
                     │
Track B:  B1 (core) ──► B2 ∥ B3 ∥ B4 ∥ B5
Track F:  F1a ∥ F1b ──► F2 (foundation) ──► F3 ∥ F4 ∥ F5.1–F5.6
                     (F2 needs T0.5 mocks; F1b needs T0.4 list)
Integrate: I1 per group (needs matching B group + F group) ──► I2 ──► I3
```

---

## Phase 0 — Freeze the contracts (sequential gate)

### Task 0.1: Stage registry v2 contract

**Files:**
- Create: `docs/specs/stage-registry-v2.md`
- Read: `docs/plans/design_handoff_pgdp_app/statecharts/README.md`,
  `src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py`,
  `src/pdomain_prep_for_pgdp/core/pipeline/stage_dag.py`, spec §4

- [ ] **Step 1:** Write the contract doc: one table row per design stage (all
  24) with columns: `stage_id`, launcher group, scope (`page`|`project`),
  upstream deps (the dirty-propagation edges), inputs → outputs (artifact
  types), folded legacy micro-stages (per spec §4.2), status
  (`exists`/`re-cut`/`new`), event types emitted, owning statechart machine(s).
- [ ] **Step 2:** Resolve the 24-stages-vs-23-stageRunners question against
  `statecharts/README.md` (which stage has no runner — likely `source` or
  `archive`) and record the answer with a quote.
- [ ] **Step 3:** Define the registry-version contract: constant name
  (`REGISTRY_VERSION = 2`), where it's stamped (project row at creation), the
  structured 409 error shape for version mismatch
  (`{"error": "registry_version_mismatch", "project_version": 1, "server_version": 2}`).
- [ ] **Step 4:** Define the event-vocabulary extension table: new event type
  names per spec §4.4 (stage runs under new IDs, `review_decision`,
  `page_reorder`, `gate_confirmation`, `settings_change` with before/after,
  `wordlist_promotion`, `split_fanout`).
- [ ] **Step 5:** Commit: `docs(spec): stage registry v2 contract`.

### Task 0.2 ∥: Statechart YAML hygiene

All 31 statechart YAMLs currently **fail strict YAML parsing** ("mapping values
are not allowed here" — unquoted scalars containing `: `). The porting to
XState is supposed to be mechanical; that requires parseable YAML.

**Files:**
- Modify: `docs/plans/design_handoff_pgdp_app/statecharts/*.yaml` (quote
  offending scalars only — no semantic edits)
- Create: `scripts/check_statecharts.py` (parses every YAML under
  `statecharts/`, exits non-zero on failure, prints file:line)
- Test: `tests/test_statecharts_parse.py` (parametrized over the YAML files,
  asserts `yaml.safe_load` succeeds and top-level `machine` key exists)

- [ ] **Step 1:** Write `tests/test_statecharts_parse.py`; run
  `uv run pytest tests/test_statecharts_parse.py -v` — expect ~31 failures.
- [ ] **Step 2:** Fix each file by quoting the offending scalar values
  (`yamllint`/parser line numbers from the test output guide you). Do not
  rename keys, states, events, guards, or actions.
- [ ] **Step 3:** Run the test again — all pass. Spot-check 3 files' diffs to
  confirm quoting-only changes.
- [ ] **Step 4:** Remove the `check-yaml` exclude for
  `docs/plans/design_handoff_pgdp_app/` from `.pre-commit-config.yaml` (added
  2026-06-10 to unblock the package commit) so strict YAML is enforced
  from now on.
- [ ] **Step 5:** Commit: `docs(statecharts): make all statechart YAMLs strict-parseable`.

### Task 0.3 ∥: OpenAPI contract deltas

**Files:**
- Create: `docs/specs/api-v2-deltas.md`
- Read: `src/pdomain_prep_for_pgdp/api/data/` route modules, Task 0.1 contract

- [ ] **Step 1:** Document route deltas: re-keyed stage routes
  (`…/stages/{stage_id}/run` with v2 IDs), new project-scoped stage routes
  (`GET/POST /api/data/projects/{id}/project-stages/{stage_id}[/run]`), the
  page-order mutation route, validation/proof-pack/zip/submit-check/archive
  run+artifact routes, registry-version error responses.
- [ ] **Step 2:** Document SSE deltas: project-scoped stage events join the
  existing per-page stage event channel or a new
  `/api/data/projects/{id}/events` project channel (decide here; record
  rationale — recommend the project channel so `pipelineShell` has one
  subscription).
- [ ] **Step 3:** Document Pydantic schema names for new payloads
  (`ProjectStageState`, `StageRunRequest`, `PageOrderUpdate`,
  `ValidationReport`, `SubmitCheckReport`).
- [ ] **Step 4:** Commit: `docs(spec): API v2 deltas for registry v2`.

### Task 0.4 ∥: Library placement contract (pdomain-ui / book-tools / ops)

**Files:**
- Create: `docs/specs/library-placement.md`
- Read: `docs/plans/design_handoff_pgdp_app/design-system/ui-base.jsx`,
  `design-system/template.jsx`, `design-system/tokens.css`,
  `COMPONENT_INDEX.md`; pdomain-ui exports (dispatch `pdomain-ui-docs` agent
  for the current export list + tokens); pdomain-ops eventsourcing + dispatch
  surface (dispatch `pdomain-ops-docs`: PageRecord/BlobStore aggregates,
  StageDispatcher/LongJobRunner); pdomain-book-tools image/text primitives
  (dispatch `pdomain-book-tools-docs`: dewarp/denoise/deskew availability,
  text post-processing helpers)

- [ ] **Step 1 (frontend):** Three-way disposition table: design component →
  `exists in pdomain-ui (reuse/extend)` | `promote to pdomain-ui` |
  `stays app-local`. Cover every identifier in `ui-base.jsx` + `template.jsx`
  and the multi-file identifiers in `COMPONENT_INDEX.md`.
- [ ] **Step 2 (tokens):** Token reconciliation table: each `tokens.css`
  custom property → existing pdomain-ui token | new token to add. No new token
  where an equivalent exists (spec §6).
- [ ] **Step 3 (backend — book-tools):** For each new/re-cut stage (denoise,
  dewarp, wordcheck, hyphen_join, regex, validation checks): does the
  algorithm belong in pdomain-book-tools (reusable by labeler/CLI) or is it
  PGDP-specific? Record disposition + the book-tools API to call or the
  proposed book-tools addition (routed to the `pdomain-book-tools` agent as
  upstream work before the consuming B task).
- [ ] **Step 4 (backend — ops):** Decide the event-store relationship: adopt /
  wrap pdomain-ops eventsourcing aggregates vs keep the in-repo event log
  (record rationale either way — D5 traceability is the requirement, not a
  specific library); decide whether stage execution uses ops
  StageDispatcher/LongJobRunner protocols for GPU/long-job dispatch.
- [ ] **Step 5:** Commit: `docs(spec): library placement contract (ui/book-tools/ops)`.

### Task 0.5 ∥: Mock fixtures + machine↔stage map

**Files:**
- Create: `frontend/src/mocks/server.ts` (thin mock of the v2 API surface from
  Task 0.3 — in-memory project/pages/stage states, deterministic; the
  `*-data.js` files in the design package inform shapes but the OpenAPI
  contract wins), `frontend/src/mocks/fixtures.ts`
- Create: `docs/specs/machine-stage-map.md` (the Stage → machine lookup from
  `statecharts/README.md`, confirmed against Task 0.1's table)
- Test: `frontend/src/mocks/server.test.ts` (mock serves a project with 24
  stage states; run-stage flips status notrun→running→clean and bumps
  downstream to stale)

- [ ] **Step 1:** Write the map doc.
- [ ] **Step 2:** Write the failing mock-server test; run
  `cd frontend && pnpm vitest run src/mocks` — fails.
- [ ] **Step 3:** Implement the mock; test passes.
- [ ] **Step 4:** Commit: `feat(mocks): v2 API mock server for frontend track`.

**Phase 0 exit gate:** all five artifacts merged to main. From here, contract
changes require editing the contract doc in the same commit as the code change
and flagging both tracks in the plan checklist.

---

## Track B — Backend re-cut (dispatch after Phase 0)

### Task B1: Registry + DAG core (gate for B2–B5)

**Files:**
- Modify: `src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py` (24
  stages per Task 0.1, scope field, folded-step composition),
  `stage_dag.py` (cross-scope dirty edges), `stage_runner.py`
- Create: `src/pdomain_prep_for_pgdp/core/pipeline/project_stages.py`
  (`ProjectStageState` model + dual-write store, mirroring `page_stages`),
  migration of DB schema (new table, registry_version column on projects)
- Modify: event-store vocabulary module (new event types per Task 0.1 step 4);
  `reindex` command for v2 IDs + project stages
- Test: `tests/test_stage_registry_v2.py`, `tests/test_project_stages.py`,
  `tests/test_registry_version.py`, update `tests/test_stage_dag.py`

**Behaviors (TDD each):**

- [ ] Registry exposes exactly the 24 v2 stage IDs with scope + group + deps
  matching `docs/specs/stage-registry-v2.md` (test asserts the full table).
- [ ] Composed stages execute their folded micro-steps in order (e.g. `crop`
  runs initial_crop → find_content_edges → crop_to_content reusing existing
  step functions; assert artifact equivalence on a synthetic page).
- [ ] `project_stages` rows follow the dual-write contract: state change =
  artifact + row + event in one transaction (test: crash between writes leaves
  reindex-recoverable state).
- [ ] Dirty propagation crosses scopes: re-running a page-scoped stage marks
  downstream project-scoped stages (validation→archive chain) stale.
- [ ] Projects are stamped `registry_version=2` at creation; API access to a
  v1 project returns the structured 409 from Task 0.1.
- [ ] `pgdp-prep reindex` rebuilds page + project stage state from events +
  artifacts under v2 IDs.
- [ ] New event types append with payloads per the vocabulary table; every
  event has actor + timestamp + payload (historization requirement, spec D5).
- [ ] Commit per behavior; final `make ci AI=1` green.

### Task B2 ∥: Image-prep stage group

**Files:**
- Modify: `src/pdomain_prep_for_pgdp/core/pipeline/` stage step modules for
  grayscale, crop, threshold, deskew, post_transform_crop, post_ocr_crop
  (re-key + folding glue only — implementations exist)
- Create: `core/pipeline/steps/denoise.py`, `core/pipeline/steps/dewarp.py`
  (new; thin wrappers — the algorithms live where
  `docs/specs/library-placement.md` (Task 0.4) put them, expected
  pdomain-book-tools, which already ships textline dewarp; any book-tools
  additions land upstream first via the `pdomain-book-tools` agent)
- Test: extend the synthetic-page integration tests
  (`tests/test_process_page.py` pattern) per stage; settings
  default/modified/preset persistence per stage (the design's settings
  inheritance pattern needs per-stage settings rows + `settings_change` events)

- [ ] One TDD slice per stage: synthetic input → expected artifact + stage
  state + appended event. Denoise/dewarp get golden-image tolerance tests.
- [ ] Per-stage settings: save-as-default / revert / reset endpoints write
  `settings_change` events with before/after.
- [ ] Commit per stage; `make ci AI=1` green.

### Task B3 ∥: OCR/Compose/Text stage group

**Files:**
- Modify: steps for text_zones, ocr, canvas_map, illustrations; re-key
  `text_postprocess` → `regex`
- Create: `core/pipeline/steps/wordcheck.py` (project word lists + per-page
  flag generation; word-list promotion is a cross-project write → its own
  event), `core/pipeline/steps/hyphen_join.py` (end-of-line hyphen candidates +
  join decisions as events)
- Test: per-stage tests as B2; `APPLY_SPLIT` regression — text_zones split
  produces sibling pages with full v2 DAGs and fans staleness wider than
  normal (existing splits machinery re-keyed, asserted under v2 IDs)

- [ ] TDD per stage; wordcheck and hyphen_join decisions are events first,
  projections second (no stored derived state).
- [ ] Commit per stage; `make ci AI=1` green.

### Task B4 ∥: Project-scoped tail stages

**Files:**
- Create: `core/pipeline/steps/page_order.py` (reading-order mutations as
  `page_reorder` events; current drag-drop reorder logic re-keyed),
  `steps/validation.py` (aggregates page flags → blockers/warnings report
  artifact), `steps/proof_pack.py`, `steps/zip_stage.py` (deterministic
  archive + sha256), `steps/submit_check.py` (dry-run report),
  `steps/archive_stage.py` (cold-storage manifest; terminal)
- Modify: `build_package` re-key onto `project_stages`; its gate becomes
  validation-passed instead of raw text_review scan
- Test: per-stage tests + the **gate chain**: validation must pass before
  build_package runs; build before zip; zip before submit_check; any upstream
  event invalidates everything downstream (assert stale cascade)

- [ ] TDD per stage; gate chain has its own test module
  (`tests/test_gate_chain.py`).
- [ ] Commit per stage; `make ci AI=1` green.

### Task B5 ∥: Routes + SSE + OpenAPI regen

**Files:**
- Modify: `src/pdomain_prep_for_pgdp/api/data/` per Task 0.3 (new
  project-stage routes, re-keyed stage routes, version-mismatch handler)
- Create: project-level SSE channel per Task 0.3 decision
- Modify: OpenAPI codegen → `frontend/src/api/types.gen.ts` regenerated
- Test: route tests per endpoint (status, payload shape, event appended,
  user_id filtering preserved); SSE test (run stage → push observed)

- [ ] TDD per route group; depends only on B1 (stages not yet implemented
  surface as `not_run` — routes still testable).
- [ ] Commit per route group; `make ci AI=1` green.

---

## Track F — Frontend rebuild (dispatch after Phase 0; parallel with Track B)

### Task F1a ∥: App-local design system

**Files:**
- Create: `frontend/src/design/tokens.css` (only tokens that stay app-local
  per Task 0.4 — everything else imports pdomain-ui), app-local atoms from
  `ui-base.jsx` dispositioned `stays app-local`
- Test: Storybook (or vitest + testing-library render) story per atom variant;
  lint rule/check: no hard-coded colors/spacing in `frontend/src` (grep-based
  test is fine)

- [ ] Port per the disposition table; typed props — tone/variant props are
  string-literal unions from the canonical token lists, no `any`.
- [ ] Commit per atom batch; frontend CI green.

### Task F1b ∥: pdomain-ui promotion (dispatch to `pdomain-ui` repo agent)

**Files (pdomain-ui repo):** per Task 0.4 promotion list — new components
(candidates: KeyCap, Segmented, StepDots, JobsDrawer/JobsPill), token additions.

- [ ] Implement + test in pdomain-ui conventions (Storybook + vitest), release
  a version; this repo consumes via `make local-dev` until the integration
  checkpoint, then `make update-pdomain-deps`.
- [ ] Acceptance: every `promote` row in the disposition table exists in a
  pdomain-ui release; no token duplicated between repos.

### Task F2: XState foundation + shared machines (gate for F3–F5)

**Files:**
- Modify: `frontend/package.json` (+ `xstate`, `@xstate/react`)
- Create: `frontend/src/machines/lib/sseActor.ts` (wraps the existing SSE
  hooks/EventSource as an XState actor emitting `STAGE_PUSH`/`STATUS_PUSH`),
  `frontend/src/machines/lib/query.ts` (the pinned XState ↔ TanStack Query
  wiring: services delegate fetches to the query client; machines never cache
  server data),
  `frontend/src/machines/stageRunner.ts`,
  `frontend/src/machines/imageStageReview.ts`,
  `frontend/src/machines/pageWorkbench.ts` (one definition each,
  `input: { stageId, … }`; YAML → XState v5 per the porting guide in
  `statecharts/README.md`)
- Test: `frontend/src/machines/*.test.ts` — **the invariant suite** (spec
  §5.2): staleness fan-out (re-run marks all downstream runners stale;
  auto-queue only when the setting is on); stageRunner full lifecycle
  notrun→queued→running→clean|flagged|error + stale; imageStageReview
  exclusive inline editor + confirm gate (flagged === reviewed);
  pageWorkbench tune → re-detect → Apply-&-Continue loop

- [ ] TDD per machine: write the invariant tests from the YAML's states/events
  (use `createActor` + simulated events; no DOM).
- [ ] The first machine merged (stageRunner) is the **pattern-setting review**:
  orchestrator reviews the YAML→XState mapping + query wiring before F3–F5
  fan out.
- [ ] Commit per machine; frontend CI green.

### Task F3 ∥: Projects surfaces

**Files:**
- Create: `frontend/src/machines/projects/` — `projectDetail.ts`,
  `railList.ts`, `recentActivity.ts`, `attributesPanel.ts`,
  `manageActions.ts`, `postImport.ts`, `projectLifecycle.ts` (per YAMLs)
- Create: `frontend/src/pages/projects/` components per `final/projects/`
  canvases (rail + tabs + manage + post-import JobsDrawer placement)
- Delete (when replacement lands): `ProjectListPage` and its route
- Test: machine tests — **two-step delete** (DELETE on active archives;
  DELETE on archived requires confirmingDanger gate),
  selection re-keying (rail SELECT re-keys detail children),
  `PROJECT_MUTATED` resync; component fixtures per `DCArtboard` state

- [ ] Machines first (TDD), then components against mock server (Task 0.5),
  one canvas section at a time.
- [ ] Commit per machine/surface; frontend CI green.

### Task F4 ∥: Pipeline shell

**Files:**
- Create: `frontend/src/machines/pipelineShell.ts`, `runAllStale.ts`,
  `projectSettings.ts`
- Create: `frontend/src/pages/pipeline/` — shell, StageStrip (dots are
  projections of runner state — no per-dot machine), stage selection +
  Prev/Next + dropdown, settings panel, PipelineMini
- Test: shell spawns one stageRunner per runner-stage with correct
  `input.stageId` (count per Task 0.1's 23/24 resolution); runAllStale orders
  + sequences stale runners and aggregates progress; OPEN_SETTINGS swap;
  fixtures per `final/pipeline/` artboard

- [ ] Machines TDD first, then surfaces on mocks. Depends on F2's stageRunner.
- [ ] Commit per machine/surface; frontend CI green.

### Tasks F5.1–F5.6 ∥: Stage tools by launcher group

One subagent per launcher group. For each stage in the group: implement the
bespoke machine (if any — shared-machine stages come free from F2 with
`WB_MAP`/schema data), recreate the components from `final/<stage>/<stage>.jsx`,
wire to the machine per `docs/specs/machine-stage-map.md`, reproduce every
artboard as fixture/story. All against the mock server.

- [ ] **F5.1 Source:** `tool-source.yaml` → `machines/tools/source.ts` + the
  settings-inheritance pattern (default|modified|preset — defined once here,
  parameterized by stageId, reused by all stages).
- [ ] **F5.2 Image prep:** grayscale bespoke tool; threshold/deskew/denoise/
  dewarp/post_transform_crop/post_ocr_crop from shared `imageStageReview` +
  per-stage schema; crop's `pagesGrid` (`tool-pages-grid.yaml`).
- [ ] **F5.3 OCR:** `textZonesTool` (incl. **APPLY_SPLIT** page-set mutation —
  machine test asserts the page-set re-key + wide staleness fan-out),
  `ocrTool`.
- [ ] **F5.4 Compose:** `pageOrderTool`, `canvas_map` review extras,
  `illustrationsTool`.
- [ ] **F5.5 Text:** `wordcheckTool` (word-list promotion = explicit
  cross-project write), `hyphenJoin`, `textReviewTool` (confirm gate needs
  zero open discussions), `regexPass`.
- [ ] **F5.6 Pack:** `validationTool`, `proofPackTool`, `buildPackage`,
  `zipTool`, `submitCheck` (SUBMIT → confirming → submitted final),
  `archiveTool` — machine tests cover the **validation→build→zip→submit gate
  chain** invariant end-to-end at the UI layer.
- [ ] Each group: commit per stage; frontend CI green.

---

## Integration (per launcher group, then global)

### Task I1 (×6): Flip group from mock to real

For each launcher group, once its Track B stages and Track F tools are merged:

- [ ] Point the group's services at the real API (mock stays for tests).
- [ ] Run the group's flows against `make run` locally; fix contract drift
  (any fix that changes a contract edits the contract doc in the same commit).
- [ ] Delete the superseded legacy route/page for that surface area
  (`PageWorkbenchPage`, `TextReviewPage`, `CropsGridPage`,
  `ProjectReviewQueuePage` fall as their replacements land).
- [ ] `make ci AI=1` green; commit per group.

### Task I2: Browser verification (MANDATORY — FastAPI + SPA)

**Files:**
- Modify/extend: `tests/e2e/` (Playwright suite exists — `make e2e AI=1`)
- Verify: `data-testid` attributes on key interactive elements landed with
  F3–F5 (testids are part of each surface's acceptance, mirroring the design's
  `data-screen-label` anchors)

- [ ] App-loads test: Chromium against the real served wheel-mode server;
  `[data-testid]` root visible; no console errors on load.
- [ ] Full pipeline walk: create project → import → run all stages → resolve
  a flag in an imageStageReview stage → page order → text review attest →
  validate → build → zip → submit-check → archive. Assert the
  terminal archived state and the downloadable zip.
- [ ] Invariant flows in-browser: two-step delete; staleness fan-out (re-run
  an upstream stage, assert downstream dots flip stale).
- [ ] Direct sub-path route test (e.g. `/projects/{id}/pipeline/threshold`)
  renders the stage tool, not a 404; `test_spa_fallback.py` contract tests
  still green.
- [ ] `make e2e AI=1` green and wired into local release preflight (NOT into
  GitHub workflows — heavy suites are local-only per workspace policy).
- [ ] Commit.

### Task I3: Notes + docs realignment

- [ ] Write `IMPLEMENTATION_NOTES.md` (repo root or docs/architecture/):
  what landed where, every canvas↔statechart contradiction found and how it
  was flagged (never silently resolved), conscious omissions, open questions.
- [ ] Update `CLAUDE.md` (stage IDs/quick-orientation), `specs/02` pipeline
  step references, `docs/plans/roadmap.md` (move shipped items out).
- [ ] Sync this plan's tasks to GH issues: `/decompose-spec --sync
  docs/plans/2026-06-10-statechart-convergence.md`.
- [ ] Commit.

---

## Self-review checklist (done at plan-write time)

- Spec coverage: D1–D6 all mapped (D1→whole plan; D2→B1–B4; D3→B1
  registry-version behaviors; D4→F1a/F1b + Task 0.4; D5→B1 event behaviors +
  B3/B4 events-first rules; D6→phase structure). Spec §5.2 invariants each
  have a named test home (F2, F3, F5.3, F5.6, I2). Spec §8 testing rows each
  have a task. ✔
- FastAPI+SPA browser-verification milestone present (I2). ✔
- Known open items deliberately deferred to Phase 0 artifacts (not
  placeholders): exact 23-vs-24 runner count (T0.1), SSE channel shape (T0.3),
  promotion list contents (T0.4). Downstream tasks reference the artifact
  paths, never assumptions.
