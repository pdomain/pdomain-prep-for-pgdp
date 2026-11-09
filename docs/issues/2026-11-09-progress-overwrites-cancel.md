---
Status: active
Owner: CT
Created: 2026-11-09
Last verified: 2026-11-09
Kind: issue
Level: I1
---

# Progress updates overwrite a cancelled job and let side effects continue

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-09
- **Resolution:** Open
- **Severity:** Medium — a cancelled job can come back as running or complete and enqueue follow-up work
- **Affected version:** pdomain-prep-for-pgdp master @ `14f0ba8`
- **Read when:** working on job cancellation, `update_progress`, the job runner, or chained jobs such as unzip → thumbnails.
- **Search terms:** `update_progress`, cancelled, `JobStatus.cancelled`, `_mark_complete`, `_handle_unzip`,
  thumbnails, CAS, cooperative cancellation, former GH #132
- **Relates to:** [Job/stage cancel path (W3.6)](2026-07-21-w36-job-stage-cancel.md)

## Summary

`DELETE /api/gpu/jobs/{job_id}` writes `status=cancelled`, but a running handler keeps a copy of the job from
before the cancel. Its next `update_progress()` call writes that stale copy back, which restores
`status=running`. The runner then sees no cancel and marks the job complete, and the unzip handler enqueues a
thumbnails job anyway. Migrated from GitHub issue #132, which came from the 2026-05-22 deep code review.

[W3.6](2026-07-21-w36-job-stage-cancel.md) covers the separate gap that the stage-scoped cancel route does not
exist. This report covers what happens after a job-id cancel succeeds.

## Impact

- A user cancels an import and later sees it complete, with thumbnails generated.
- Jobs page state is wrong after a cancel during any handler that reports progress.
- The existing cancel guards in `_mark_complete()` and `_mark_failed()` do not help once progress has
  overwritten the cancel.

## Environment / versions

```
src/pdomain_prep_for_pgdp/api/gpu/jobs.py     DELETE /jobs/{job_id} → status=cancelled
src/pdomain_prep_for_pgdp/core/job_runner.py  InProcessJobRunner.update_progress, _run_one,
                                              _mark_complete, _handle_unzip, _handle_thumbnails
```

## Evidence

### 1. update_progress writes the caller's stale job — checked 2026-11-09

```python
# core/job_runner.py InProcessJobRunner.update_progress
progress = job.progress.model_copy(update={...})
updated = job.model_copy(update={"progress": progress})
await self._db.put_job(updated)
```

`job` is the copy `_run_one()` set to `running` before calling the handler. Nothing re-reads the stored row,
so a cancel written in the meantime is replaced.

### 2. The completion guard runs too late

`_run_one()` re-reads the job after the handler returns, and `_mark_complete()` skips completion only if the
stored status is `cancelled`. After evidence 1 the stored status is `running` again, so the job is marked
`complete`. The code's own comment notes the SQLite adapter has no compare-and-set.

### 3. Unzip chains work without checking for a cancel

`_handle_unzip()` calls `update_progress()` per page, then always enqueues a `thumbnails` job when
`page_count > 0`. It never checks whether the job was cancelled.

## Root-cause hypotheses

1. **(Most likely) Job writes are last-writer-wins.** Progress, completion, and cancel all write a whole `Job`
   row with no status condition, so whichever writer runs last decides the status.

## Defects to fix

1. **Preserve terminal status in `update_progress()`.** Re-read the row, or use a conditional update, and keep
   `cancelled` once set. (Primary)
2. **Check for cancellation cooperatively** before expensive steps and before creating follow-up jobs, starting
   with the unzip → thumbnails chain.
3. **Add tests** that cancel mid-handler and assert the job stays `cancelled` and no follow-up job is queued.

## Next steps

1. Write the failing test: start an unzip job, cancel after the first progress report, and assert the final
   status and the absence of a thumbnails job.
2. Fix `update_progress()`, then add the cancellation check in `_handle_unzip()`.

## What is NOT broken

- The cancel route itself, which writes `cancelled` correctly.
- The `_mark_complete()` and `_mark_failed()` guards, when no progress write follows the cancel.

## Resolution

_Open._ When fixed: set frontmatter and Agent Index `Status: retired`, add the resolving commit here, and
route the retirement through `doc-retirer`.
