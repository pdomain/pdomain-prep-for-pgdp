---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Shell runStage only runs page 0000 for non-OCR page stages

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — multi-page books never process beyond page 0 from the shell
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** implementing Run stage / run-all-stale for multi-page projects, or batched rerun enqueue
- **Search terms:** pages/0000, runStage, multi-page, batch fan-out, pipeline.ts, B4, W0.4, rerun_project_stage_pages
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md) (W0.4, B4); [review
  fixes task 6](../plans/2026-07-14-review-fixes.md); [golden-path CI](2026-07-21-w06-golden-path-ci.md)

## Summary

The frontend `runStage` service posts non-OCR page stages only to `pages/0000/stages/{id}/run`. The comment says full
per-page orchestration is I2. OCR has a project-wide `run-batch` path; other page stages do not. A multi-page book
cannot clean crop, threshold, or later page stages from the shell without calling the API per page by hand.

## Impact

- Run stage / run-all-stale processes only idx0 `0000`.
- Pages 0001+ stay dirty or not_run while the shell reports success for page 0.
- Blocks real-book walk and Wave 0 multi-page exit criteria.
- If multi-page API uses batched rerun, review-fixes task 6 (enqueue jobs) is required on that path.

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
branch: master (docs baseline 2026-07-21)
scope: frontend/src/services/pipeline.ts; optional api/data/project_stages.py rerun batch
```

## Evidence

### 1. Hard-coded page 0000

`frontend/src/services/pipeline.ts` ~140–148:

```typescript
// Other page-scoped stages: POST .../pages/0000/stages/{stageId}/run (sync)
// Uses idx0=0 as placeholder — full per-page orchestration is I2.
await api.post(
  `/api/data/projects/${encodeURIComponent(projectId)}/pages/0000/stages/${encodeURIComponent(stageId)}/run`,
  request ? { force: request.force } : null,
);
```

### 2. OCR is the only fan-out exception

Same file ~125–138: OCR uses `POST …/page-stages/ocr/run-batch`. No equivalent for crop, threshold, wordcheck, etc.

### 3. Batched rerun enqueue already exists (use it)

`rerun_project_stage_pages` **does** enqueue `run_page_stage` jobs with
`resolve_job_device()` (`project_stages.py` ~1499–1529). Former review-fixes
task 6 is shipped. W0.4 should call this (or equivalent fan-out), not re-fix enqueue.

## Root-cause hypotheses

1. **(Most likely) Intentional I2 placeholder left in production shell** — OCR batch was prioritized; other stages kept
   the page-0 stub.
2. **Missing shell wiring to existing batch/rerun routes** — backend batch rerun works; `pipeline.ts` still hardcodes
   page 0.

## Defects to fix

1. **Multi-page page-stage run from shell** (primary) — batch or fan-out jobs for all pages (or all dirty pages), not
   page 0 only.
2. **Wire shell to existing batch/enqueue APIs** (`rerun_project_stage_pages` and/or per-page async run) rather than
   inventing a parallel path.
3. **UI outcome** — report per-page failure/flagged counts, not a single page-0 result.

## Next steps

1. Decide API shape: N parallel per-page runs vs project batch rerun vs one project job.
2. Failing test: 3-page book run crop (or threshold) cleans all pages.
3. Update `pipeline.ts` (and any run-all-stale caller) to use batch/fan-out.
4. Cover in golden-path / multi-page fixture (W0.6 exit criterion 4).

## What is NOT broken (to scope the fix)

- Per-page `POST …/pages/{idx0}/stages/{id}/run` when called with a real idx0.
- OCR `run-batch` project path (separate, already fan-out shaped).
- Backend dual-write for a single page stage run.

## Done when

3-page book: run crop (or threshold) cleans **all** pages. Shell no longer hard-codes `0000` for non-OCR page stages.

## Resolution

*Open.*
