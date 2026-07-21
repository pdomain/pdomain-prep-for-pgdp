---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# FE stage cancel soft-fails; no data stage cancel route (W3.6)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — Cancel UI looks live but cannot stop stage work
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** implementing cancel, stageRunner/runAllStale, or Wave 3 ops.
- **Search terms:** requestCancel, stages/cancel, soft-fail, stageRunner, runAllStale, cancel job, W3.6
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Pipeline shell machines call `POST /api/data/projects/{id}/stages/{stageId}/cancel`
via `requestCancel`, which **swallows all errors**. No matching route exists
under the data API (grep of `src/` finds no stages cancel handler). GPU job
cancel (`DELETE /api/gpu/jobs/{id}`) exists and JobsPage uses it, but that is
not the stage-scoped contract the XState YAML / stageRunner expect. Product
must either implement stage/job cancel for queued (and optionally running)
work or explicitly defer and align the FE so Cancel is not a silent no-op.

## Impact

- User clicks Cancel / run-all-stale cancel; UI may leave running state while
  backend keeps processing.
- False confidence during multi-page runs (especially after W0.4 fan-out).
- Statechart design docs still specify a cancel POST that 404s.

## Environment / versions

```
FE: frontend/src/services/pipeline.ts requestCancel
    frontend/src/machines/stageRunner.ts
    frontend/src/machines/runAllStale.ts
GPU cancel: src/pdomain_prep_for_pgdp/api/gpu/jobs.py DELETE /jobs/{job_id}
data API: no /stages/{stageId}/cancel
```

## Evidence

### 1. Soft-fail cancel client

```
# frontend/src/services/pipeline.ts ~173–184
async function requestCancel(
  projectId: string,
  stageId: string,
): Promise<void> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/cancel`,
    );
  } catch {
    // Cancel is a best-effort hint — ignore errors.
  }
}
```

### 2. No backend data route

```
rg 'stages/.*/cancel|cancel_stage' src/pdomain_prep_for_pgdp
# (no matches for a stage cancel route)
```

OpenAPI/data routers expose stage **run** paths; cancel is absent.

### 3. Statecharts still promise the route

- `docs/plans/design_handoff_pgdp_app/statecharts/stage-runner.yaml` —
  `requestCancel: // POST /api/projects/:pid/stages/:stageId/cancel`
- `run-all-stale.yaml` — same cancelInFlight POST

### 4. Partial cancel exists only on GPU jobs router

```
# api/gpu/jobs.py
@router.delete("/jobs/{job_id}", …)
async def cancel_job(...):
    … job.status = JobStatus.cancelled
```

JobsPage uses `api.delete(\`/api/gpu/jobs/${id}\`)`. Job runner honors
`JobStatus.cancelled` mid-flight best-effort when re-reading the row — but
stage shell does not call that path with the stage’s job id.

## Root-cause hypotheses

1. **(Most likely) I1 best-effort stub never finished** — FE wired cancel for
   statechart parity; backend deferred; soft-fail hid the 404.
2. **Wrong surface** — product may intend job-id cancel only; stage-id cancel
   was design fiction and should be removed from FE rather than implemented.

## Defects to fix

1. **Implement stage cancel OR document product defer** and remove soft-fail
   success illusion. (Primary)
2. **If implement:** cancel queued `run_page_stage` / `run_project_stage` jobs
   for that project+stage; define running semantics (cooperative flag vs
   mark-cancelled only).
3. **Align FE** — surface failure when cancel is unsupported; stop swallowing
   all errors if cancel is a real feature.

## Next steps

1. Product choice: real cancel vs explicit “cannot cancel once started” UX.
2. If real: API route + job_runner cooperation + tests (queued job never runs).
3. If defer: change requestCancel to no-op with user-visible copy; update
   statechart notes / DIVERGENCES.

## What is NOT broken

- GPU job cancel/retry routes and JobsPage wiring for `/api/gpu/jobs/*`.
- Job runner cancelled-status guards when status is already cancelled.
- Pause is already an honest no-op (`requestPause` comment: not implemented).

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link
implement or defer commit, route retirement through `doc-retirer`.
