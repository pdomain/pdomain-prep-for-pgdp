---
kind: handoff
status: "active"
created: "2026-11-11"
created_at: "2026-11-11T05:28:44Z"
owner: "CT"
branch: "fix/job-reliability"
scope: "job-reliability"
worktree: "/mnt/work/projects/pdomain/pdomain-prep-for-pgdp/.worktrees/fix-job-reliability"
base_commit: "6bc1a072594ef45f905711057b5ad5c14672d140"
supersedes: "2026-11-11-032238-job-reliability-work-stopped-before-the-first-commit.md"
handoff_reason: "stopping"
host: "claude-code"
---

# Job reliability fixes are committed on the branch and await owner review

## Goal

Make job handling reliable: a cancel survives later writes, stage cancel is real (W3.6), work left running by a dead
process is reclaimed (W3.4), and the session cookie and CORS are configurable (W3.7). The JWT SSE report stays open.

## Done

All six commits are on `fix/job-reliability`, ahead of master. Nothing was pushed, merged, tagged, released or deployed.

- `c85a128` keeps a cancelled job cancelled through later writes. The new tests moved into
  `tests/test_cancelled_job_protected.py` and its docstring is fixed.
- `e162f93` fixes the intermittent event-store failure. See Decisions for the cause.
- `6b8afe5` adds `POST /api/data/projects/{id}/stages/{stage}/cancel` (W3.6). OCR also covers the batch job.
- `66c5ed2` fails jobs and stage rows left running, at startup (W3.4).
- `7a96382` adds `PGDP_SESSION_COOKIE_SECURE` and `PGDP_CORS_ALLOW_ORIGINS` (W3.7) and the self-host checklist.
- `6bc1a07` records the zip timestamp bug as an issue.
- `make ci AI=1` exited 0 before each code commit, from the recorded exit status, not a pipe. `c85a128` and `e162f93`
  were gated together, because the first commit alone still has the event-store failure. The status files are
  `prep-ci2.status` to `prep-ci6.status` in the night artifacts folder.
- One independent reviewer checked the code and one checked the issue record. All accepted findings are fixed and both
  focused rechecks came back with no findings.

## Not done

- The four issue records stay open: W3.6, W3.4, W3.7 and `2026-11-09-progress-overwrites-cancel`. Retire them through
  `doc-retirer` after this branch reaches master.
- The zip timestamp bug is recorded, not fixed.
- The Wave 2 interface items were out of scope.

## Failed approaches

- The earlier theory that background load caused the event-store failure was wrong. It reproduced at low load.
- The earlier theory that the new test file caused it was also wrong. The error appeared in five different tests.
- Without the fix the error appeared in 3 of 11 full test runs. A single clean run proves little.

## Decisions

- Event-store cause: `eventsourcing` runs `PRAGMA journal_mode=WAL` on a new connection and leaves that cursor open
  until its frame is released. A diagnostic captured the frame still alive at the failed commit, always with the
  coverage tracer active. `event_store_env` sets WAL first, so the library only reads the mode. After the fix: 10 of
  10 full runs clean, with zero commit errors captured. What keeps the frame alive was not identified.
- W3.4 policy: fail interrupted work rather than requeue it, as the issue recommends, because a partial run may have
  left incomplete artifacts.

## Decisions the owner still needs to make

1. Local CORS default. An unset loopback host still allows any origin, as the W3.7 issue says to keep. A reviewer
   noted that any web page open in the browser can then call the unauthenticated local API, including run, delete and
   the new cancel route. The alternative is to allow only the Vite dev and app origins by default.
2. Stage Cancel button. No control on the pipeline page sends `CANCEL` to a stage runner yet, and `runAllStale` is
   not mounted. The route and the error banner work and are tested, but a user cannot reach them from the page today.
3. Interrupted synchronous page runs. A page-stage row left `running` by a synchronous request has no job, so
   startup does not reset it. `pgdp-prep reindex --heal` also skips `running` rows.

## State

The working tree is clean after the handoff commit. All work ran on CPU with the GPU hidden. The Postgres versions of
`update_job_unless_cancelled`, `cancel_active_stage_jobs` and `fail_running_jobs` were reviewed but never executed,
because the postgres extra is not installed. Reclaim assumes one server per data root, which the deployment doc states.
The scratch diagnostic plugin is outside the repo at
`/mnt/work/projects/pdomain/.artifacts/night-20261110/tmp/prep/diag/diag_wal.py`.

## Pointers

- `docs/architecture/06-deployment.md`
- `docs/issues/2026-11-11-submission-zip-entry-timestamps.md`
- `docs/issues/2026-11-09-progress-overwrites-cancel.md`
- `docs/issues/2026-07-21-w36-job-stage-cancel.md`
- `docs/issues/2026-07-21-w34-reclaim-stuck-running.md`
- `docs/issues/2026-07-21-w37-cookie-cors-hardening.md`
- `src/pdomain_prep_for_pgdp/core/page_store_factory.py`
- `src/pdomain_prep_for_pgdp/core/job_runner.py`
- `src/pdomain_prep_for_pgdp/api/data/project_stages.py`
- `src/pdomain_prep_for_pgdp/settings.py`
- `frontend/src/pages/pipeline/StageCancelError.tsx`
- `/mnt/work/projects/pdomain/.artifacts/night-20261110/prep-ci6.status`

## Resume steps

1. Review the six commits with `git log master..fix/job-reliability`.
2. Answer the three owner decisions above.
3. Merge when satisfied, then retire the four issue records through `doc-retirer`.
4. Fix the zip timestamp bug from its issue record.
