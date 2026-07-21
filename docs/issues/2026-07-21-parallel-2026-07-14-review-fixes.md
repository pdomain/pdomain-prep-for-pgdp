---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Parallel track: residual work from 2026-07-14 review fixes

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Low — most plan tasks shipped; residual is docs drift only
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** closing the 2026-07-14 review-fixes plan or auditing suite auth / device / timeout history.
- **Search terms:** suite auth, resolve_job_device, job timeout, rerun put_job, 2026-07-14 review fixes residual
- **Relates to:** [2026-07-14 review fixes](../plans/2026-07-14-review-fixes.md),
  [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md),
  [stale docs refresh W3.8](2026-07-21-w38-stale-docs-refresh.md)

## Summary

The nine bugs listed in
[`docs/plans/2026-07-14-review-fixes.md`](../plans/2026-07-14-review-fixes.md)
were written as open work. Adversarial re-check on 2026-07-21 against current
code shows **tasks 1–7 and 9 already shipped**. Treat this issue as a residual
tracker: update the draft plan status and finish any remaining doc truth
(task 8 / broader W3.8).

## Impact

- Leaving the plan/issue text as “open defects” misleads implementers into
  redoing suite auth, device threading, timeout, zip offload, and rerun enqueue.
- Multi-page work (W0.4) can rely on existing `rerun_project_stage_pages` enqueue
  rather than reimplementing task 6.

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
verified: 2026-07-21 against source + tests named below
pyproject: pdomain-ops>=0.11.2
plan file still Status: draft (needs update)
```

## Evidence

### Shipped (re-verified 2026-07-21)

| # | Plan task | Code evidence |
|---|-----------|---------------|
| 1 | Suite mutating auth | `api/middleware/suite_auth.py` `SuiteAuthMiddleware`; `bootstrap.py` mounts it; `tests/test_suite_routes_auth.py` |
| 2 | Real suite `app_id` | `bootstrap.py` `_build_suite_app()` + `mount_routes(..., suite_app=...)` |
| 3 | Device into job payloads | `core/device_resolution.py` `resolve_job_device`; used in `project_stages.py` / `pages.py` enqueue; `tests/test_device_resolution.py` |
| 4 | Job handler timeout | `Settings.job_handler_timeout_seconds`; `job_runner.py` `asyncio.wait_for`; `tests/test_job_runner_timeout.py` |
| 5 | Zip off event loop | `ingest.py` `_read_zip_entries` + `anyio.to_thread.run_sync`; `tests/test_ingest_zip_thread_offload.py` |
| 6 | Rerun enqueues jobs | `rerun_project_stage_pages` loops `put_job` with `resolve_job_device()` (~1499–1529) |
| 7 | AppShell authenticated client | `frontend/src/App.tsx` suite calls via `api.get` / `api.put` / `api.post` |
| 9 | pdomain-ops pin | `pyproject.toml` `pdomain-ops>=0.11.2` (ahead of plan’s 0.11.1) |

### Residual

| # | Plan task | Status |
|---|-----------|--------|
| 8 | Stale `04-frontend.md` | **Partial** — doc already notes former PageWorkbench routes as removed; broader stale-doc work is [W3.8](2026-07-21-w38-stale-docs-refresh.md). Plan file itself still `Status: draft` and lists all nine as open work. |

## Root-cause hypotheses

1. **(Most likely) Plan text not updated after implementation landed** — code and
   tests shipped; docs/plans still describe pre-fix state.
2. Task 8 was intentionally deferred into general doc refresh (W3.8).

## Defects to fix

1. **Update or retire** `docs/plans/2026-07-14-review-fixes.md` — mark tasks 1–7
   and 9 shipped with evidence; leave only residual doc work open.
2. **Fold task 8** into [W3.8 stale docs](2026-07-21-w38-stale-docs-refresh.md)
   or complete a targeted `04-frontend.md` verify pass.
3. **Do not re-open** suite auth / device / timeout / zip offload / rerun enqueue
   as greenfield work unless a regression is proven.

## Next steps

1. Edit the 2026-07-14 plan to a shipped/residual status (or route through
   doc-retirer when fully closed).
2. Complete residual architecture doc accuracy under W3.8.
3. Retire this umbrella when plan + residual docs match code.

## What is NOT broken

- Tasks 1–7 and 9 as listed in the 2026-07-14 plan are implemented on current main.
- W0.4 multi-page shell run is still open (page-0 only in `pipeline.ts`); that is
  separate from task 6, which already enqueues when the batch rerun route is used.

## Resolution

*Open (residual docs only).* When the 2026-07-14 plan is updated and residual
doc work closed: set `Status: retired`, link commits, route via `doc-retirer`.
