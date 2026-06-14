---
title: Hi-fi redesign — Loader + Source + Grayscale COMPLETE pass
repo: pdomain-prep-for-pgdp
status: shipped
created: 2026-06-14
shipped: 2026-06-14 (origin/main 6fa6673; deferred items 0aa532f)
---

# Hi-fi redesign: Loader + Source + Grayscale — complete pass

Authoritative design package: `docs/plans/design_handoff_pgdp_app/` (`final/<stage>/<stage>.jsx`
= look; `statecharts/` = behavior). Spec: `docs/specs/2026-06-10-statechart-convergence-design.md`.

## Locked decisions (CT, 2026-06-14)

- **Full complete pass.** Make-honest fixes + Wave-2 backend extensions. NOTHING merges
  until all three slices genuinely work, **verified by running the real app** (CI green ≠ works).
- **Source thumbnails:** add a backend **ingest-thumbnail route** exposing the persisted
  `thumbnail_blob_hash` (not stage-gated). Real images at Source time.
- **Grayscale tuning:** extend backend now — **perceptual grayscale primitive in
  pdomain-book-tools** + grayscale stage honoring sampler/gamma/output-range + mode chooser.
- **Source Remove:** reversible ignore (soft), **tracked in the event history**.
- **Source Insert page:** define + build (real backend create + event).
- Theme is MODAL (light/dark) — NOT a parity criterion.

## Progress log (live)

**2026-06-14 — Wave A done + reviewed + fixed; book-tools v0.20.0 releasing.**

Branch SHAs (all CI-green; NOT yet integrated/merged to prep main):
- book-tools `feat/grayscale-primitive` → ff-merged to book-tools **main** @ f792c15;
  CHANGELOG @ 9e700ec; **releasing v0.20.0** via scripts/do-release.sh (ci-slow preflight,
  then tag+push+dispatch publish to pdomain-index-pip). CT authorized push+release.
- prep `feat/hifi-backend-data` @ 9087ce3 — ingest-thumbnail GET, PATCH page_type/ignore
  (manual_ignore split), POST insert; events PageTypeChanged/PageIgnoreSet/PageInserted.
- prep `feat/hifi-backend-sse` @ d70dfc8 — single project-channel SSE endpoint
  `GET /api/data/projects/{id}/page-stages/events`; bridge `frontend/src/machines/lib/pageToolSseBridge.ts`;
  page_count threaded via ToolSlotProps.pageCount; mode-ref fix.
- prep `feat/hifi-loader` @ f2ba05c — 6 make-honest fixes.
- prep `feat/hifi-source` @ a4ace8f — original Wave-1 (BLOCK: no persistence) — **needs Wave C rewire**.
- prep `feat/hifi-grayscale` @ 98894a1 — original Wave-1 (Settings lies, unreachable runs) — **needs Wave C rewire**.

### Remaining
1. **Release completes** → bump prep book-tools pin to v0.20.0 (`make update-pd-deps` or edit pyproject).
2. **Assemble integration branch** `feat/hifi-integration` from prep main: rebase-stack
   backend-data → backend-sse → loader (resolve pages.py overlap). Single tree for verify-all-together.
3. **Wave B / B1** grayscale stage on integration: rewrite `_grayscale_cpu` in core/pipeline/stage_registry
   to call `pdomain_book_tools...cv2_processing.to_grayscale(mode, sampler_radius, gamma, output_range)`
   from the per-stage run config; real detect endpoint returns mode/why.
4. **Wave C** frontend wiring on integration:
   - C-Source: wire mark/Remove/role/Insert → A2 routes (survive reload); Remove→soft skipped + history;
     thumbnails → ingest route `GET .../pages/{idx0}/thumbnail`; multi-page cursor test.
   - C-Grayscale: consume A3 SSE bridge (single project-channel); ENABLE tuning controls wired to B1
     backend (un-defer mode chooser + params); set lastRunAt from PAGE_PUSH; fix idx0={page.idx0}; banner threading.
5. **Wave D** live verify on 232-page sample (persistence survives reload; grayscale params change output; runs fire).
6. **Wave E** ff-merge integration → prep main; push on CT say-so.

## Current branch state (superseded — see Progress log above)

## Defects to close (from 6 Opus reviews)

**Loader (make-honest):** `approximateCurrentStage` off-by-one (names wrong stage); `flagged`
stubbed to "—" despite intent; archived "Save a copy" reports success but downloads nothing;
wrong-shape attributes test mock; dead-but-wired `/activity` `/export` nav callbacks; `void queryClient`.

**Source (BLOCK):** `patchPageRole`/`patchPageIgnore` are DEAD CODE (never called) AND encode
invalid PageType values (real enum: `{normal,blank,plate_b,plate_p,plate_r,skip,cover}`).
Mark/Remove/role/Insert all in-memory only → lost on reload. `removeSelected` hard-deletes
instead of soft `skipped`. Insert is enabled but not persisted. Thumbnails hardcode
`stage=grayscale` → 404 before grayscale runs. Cursor multi-page loop untested.

**Grayscale (blocker-in-SWF):** Settings-tab mode/param controls are LIVE (not disabled like the
Workbench drawer) → silent no-op. Apply&Run/Re-run unreachable (machine parks in `converting`;
needs `PAGE_PUSH` SSE which isn't wired — the "I1" integration point). `lastRunAt` never set →
cache-buster never busts. Settings auto-detect banner hardcoded. `idx0={i}` filtered-index latent bug.

## Wave plan (dependency-ordered)

### Wave A — independent (parallel)
- **A1 [pdomain-book-tools]** Perceptual grayscale primitive (mode chooser: perceptual/standard;
  sampler/gamma/output-range params) + tests. Upstream, additive. Worktree.
- **A2 [prep backend — pages.py]** Ingest-thumbnail route (`GET .../pages/{idx0}/thumbnail` from
  `thumbnail_blob_hash`); Source persistence: mark-as-page (PATCH page_type, REAL enum),
  Remove→reversible `ignore`/skip **+ event**, Insert page (POST create sibling **+ event**).
  Worktree `feat/hifi-backend-data`.
- **A3 [prep backend — SSE]** Wire the real `PAGE_PUSH`/`STATUS_PUSH` SSE feed so page-workbench
  machines leave `converting` and run handlers are reachable; emit on stage-run completion (sets
  `lastRunAt`). Worktree `feat/hifi-backend-sse`.
- **A4 [prep frontend]** Loader make-honest fixes (existing `feat/hifi-loader` worktree).

### Wave B — backend consumers (after A1)
- **B1 [prep backend]** Grayscale stage (`stage_registry`) honoring the new book-tools primitive
  params + mode; consume book-tools via local-dev linked mode. Detect endpoint returns real mode/why.

### Wave C — frontend wiring (after A2/A3/B1; rebase each onto the backend branches)
- **C-Source** wire PATCH persistence into machine actions (mark/Remove/role/Insert → real routes
  + survive reload), Remove→soft skipped, point thumbnails at A2 ingest route, multi-page cursor test.
- **C-Grayscale** consume A3 PAGE_PUSH (real SSE actor), ENABLE tuning controls wired to B1 backend
  (no longer deferred-disabled), set `lastRunAt`, fix `idx0={page.idx0}`, banner threading, run-POST test.

### Wave D — live verification (orchestrator)
Run the real app on the sample project (`source-ia-data/survivalsnewarri…`). Observe, per slice:
- Loader: real stage/flagged progress; no dead-end nav; save-a-copy honest.
- Source: real thumbnails at source time; mark/Remove/Insert **survive reload**; Remove in history.
- Grayscale: tuning params **change the output image**; run buttons fire; re-run busts cache.

### Wave E — merge
rebase each onto current main → ff-only merge (no merge commit, no squash). Push only on CT say-so.
book-tools primitive: release + bump prep dep per workspace release flow.

## Constraints
- No GitHub PRs. No push without CT say-so. rebase-only linear history, ff-only.
- Orchestrator owns rebase+merge; agents stop at commit on their branch.
- Explicit worktrees for parallel same-repo agents (pass absolute path; don't rely on isolation flag).
- Every mutating route appends its event(s) — event log stays system of record.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
