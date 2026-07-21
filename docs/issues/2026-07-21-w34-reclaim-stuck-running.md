---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Jobs stuck `running` after crash; job_runner poll only picks `queued` (W3.4)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — crash leaves work permanently stranded until manual DB edit
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** diagnosing hung jobs after process kill, startup recovery, or Wave 3 ops.
- **Search terms:** JobStatus.running, reclaim, stuck job, run_pending, `_find_queued`, crash recovery, W3.4
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`InProcessJobRunner` only dequeues jobs with `status == queued`. When a
handler marks a job `running` and the process dies (kill, OOM, laptop sleep
with unclean shutdown), the row stays `running` forever: no startup reclaim
rewrites it to `queued`/`error`, and the poll loop never selects it again.
Page/project stage rows can similarly remain mid-flight without a heal path
tied to process start.

## Impact

- Users see perpetual “running” jobs after a crash; Run stage appears dead.
- Downstream stages never start; book path stalls silently.
- Manual SQLite/DB surgery or re-enqueue is the only recovery today.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
core: src/pdomain_prep_for_pgdp/core/job_runner.py
models: JobStatus.queued | running | complete | error | cancelled
storage: SQLite jobs table (local-first)
```

## Evidence

### 1. Poll selects only `queued`

```
# core/job_runner.py ~237–248
async def `_find_queued`(self) -> list[Job]:
    out: list[Job] = []
    for owner_id in await `_distinct_owner_ids`(self.`_db`):
        for job in await self.`_db`.list_recent_jobs(owner_id, 200):
            if job.status == JobStatus.queued:
                out.append(job)
    return out
```

`run_pending` only calls `_find_queued` — no branch for stale `running`.

### 2. Transition to running is durable before handler completes

```
# core/job_runner.py ~250–258
async def `_run_one`(self, job: Job) -> None:
    job = job.model_copy(
        update={
            "status": JobStatus.running,
            "started_at": datetime.now(UTC),
        }
    )
    await self.`_db`.put_job(job)
```

Crash after `put_job` leaves `running` + `started_at` with no worker.

### 3. No reclaim on bootstrap

Grep across `src/pdomain_prep_for_pgdp` finds no startup pass that resets
orphaned `running` jobs. Parent plan §Adapter / ops risks: “Stuck `running`
jobs after process crash (no reclaim).” W3.4 done-when: crash recovery test.

### 4. Cancel path does not help stranded rows

Cancel only applies when something can mark the job cancelled while a worker
is alive (`JobStatus.cancelled` guards in `_run_one`). Dead process = no
canceler for stuck `running`.

## Root-cause hypotheses

1. **(Most likely) Missing startup reclaim policy** — design assumed process
   lifetime equals job lifetime; no TTL or boot-time sweep was implemented.
2. **Page-stage dual-write mid-flight** — separate but related: stage rows
   `running` without a matching live job need the same boot heal or
   `reindex --heal` (W3.5).

## Defects to fix

1. **Reclaim stuck `running` jobs on startup** — e.g. mark `error` or requeue
   with a clear `error_message` / reclaim reason when `started_at` is older
   than a threshold or any `running` at sole-process boot. (Primary)
2. **Crash recovery test** — put_job running → new runner → job not stuck.
3. **Decide stage-row reclaim** — either same boot path or document reliance
   on `pgdp-prep reindex --heal` (W3.5).

## Next steps

1. Define policy: requeue vs fail stuck `running` (recommend fail + message
   for safety; optional requeue for idempotent stage jobs).
2. Implement reclaim in lifespan / job runner start.
3. TDD crash recovery; document in self-host runbook.

## What is NOT broken

- Live `queued` jobs still run under a healthy process.
- Handler timeout (review-fixes task 4 / parallel track) fails in-process
  hung handlers; it does not recover cross-process stuck `running`.
- GPU `DELETE /api/gpu/jobs/{id}` cancel for live jobs is separate (W3.6).

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link
reclaim commit + test, route retirement through `doc-retirer`.
