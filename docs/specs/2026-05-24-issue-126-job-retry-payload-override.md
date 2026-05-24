# Issue #126 — Job retry payload override can redirect work across projects and data roots

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#126

## TL;DR

The job retry endpoint shallow-merges a caller-supplied `payload_override` dict into the original
job's payload without filtering. Because `_handle_run_page_stage` reads `project_id`, `page_id`,
`stage_id`, and `data_root` directly from the payload, an attacker who owns a cancelled or failed
job can override these fields to redirect retry work to another user's project or to an arbitrary
filesystem path. The fix is to whitelist which keys are override-safe per job type and block
identity/path fields from being overridden.

## Context

**Vulnerable code — retry route:** `src/pd_prep_for_pgdp/api/gpu/jobs.py:89-93`

```python
new_payload = dict(job.payload)
if body is not None and body.payload_override:
    new_payload.update(body.payload_override)
```

No key filtering. `body.payload_override` is typed as `dict[str, object] | None` with no field
constraints in the request model.

**Vulnerable code — handler:** `src/pd_prep_for_pgdp/core/job_runner.py:449-456`

```python
project_id = payload.get("project_id") or job.project_id
page_id = str(payload["page_id"])
stage_id = str(payload["stage_id"])
data_root = Path(payload["data_root"])
```

`project_id` prefers the payload value over `job.project_id` (which is set correctly on the job
row). `data_root` is taken entirely from the payload — no check against `settings.data_root`.
The handler does call `runner.db.get_project(project_id)` to confirm the project exists, but does
NOT verify that the authenticated user who submitted the retry owns that project.

**Attack scenario:**

1. User A submits a valid `run_page_stage` job for their project P1 and lets it fail.
2. User A retries the job with `payload_override = {"project_id": "P2", "data_root": "/tmp/evil"}`.
3. The handler fetches project P2 (owned by User B) without ownership check, then runs a stage
   against P2's data via the attacker-controlled `data_root`.

**Adapters affected:** all deployment shapes. The vulnerability is in the shared pipeline layer,
not an adapter. It matters most in multi-user modes (`auth_mode=apikey|jwt`) but also exists
in `auth_mode=none` if anyone shares a local install.

## Goals / Non-Goals

**Goals:**

- Define a per-job-type allowlist of override-safe keys and enforce it in the retry route.
- Remove `project_id` and `data_root` from all allowlists (they must never be overrideable).
- Add project-ownership check in the retry route before enqueuing the new job.
- Add ownership check in `_handle_run_page_stage` as defence-in-depth (belt-and-suspenders).
- Add regression tests for forbidden `project_id` and `data_root` overrides.

**Non-Goals:**

- Redesigning the job payload schema (typed payload column is a future refactor).
- Restricting which stages a user may run on their own project.

## Constraints

- `job.project_id` is the authoritative project binding on the job row; `payload["project_id"]`
  is redundant and should be removed as the primary source in the handler.
- `data_root` must come from `settings.data_root` (injected via the runner), not the payload.
  The runner already carries `runner._storage` and `runner._db`; it should carry `settings` too,
  or the handler should call `Settings()` (which is already done in the retry route to get
  `dispatch_interval_seconds`).
- The allowlist must cover all current job types: `unzip`, `thumbnails`, `run_page_stage`,
  `package`. Most have no safe override keys; `run_page_stage` allows `device` only.
- Local mode (`auth_mode=none`): ownership check must not crash when `get_user` returns the fixed
  anonymous user — single user owns all projects, so the check should be a no-op or trivially
  pass.

## Options Considered

**Option A — Blocklist (reject identity/path keys, allow all others):**
Check that `payload_override` does not contain `project_id`, `data_root`, `owner_id`, `page_id`.
Simpler to implement. Weakness: any new sensitive key added to a handler in the future is
exploitable until explicitly blocked. Requires ongoing maintenance of the blocklist.

**Option B — Allowlist per job type (chosen):**
Define `_RETRY_SAFE_KEYS: dict[str, frozenset[str]]` in `api/gpu/jobs.py`:

```python
_RETRY_SAFE_KEYS: dict[str, frozenset[str]] = {
    "unzip": frozenset(),
    "thumbnails": frozenset(),
    "run_page_stage": frozenset({"device"}),
    "package": frozenset(),
}
```

In the retry route, before merging, filter `payload_override` to keys in
`_RETRY_SAFE_KEYS[job.type.value]`. Raise `400` if any rejected key is present. Default to empty
set for unknown job types (future-safe: new types start locked down).

**Option C — Drop payload_override entirely:**
Remove the feature; retries always use the original payload unchanged. Zero override attack
surface. Weakness: legitimate use case is re-running with `device=cuda` after a CPU timeout —
this use case requires at least `device` to be overridable. Option B preserves this.

## Decision

**Option B** plus defence-in-depth handler hardening.

**Retry route changes** (`src/pd_prep_for_pgdp/api/gpu/jobs.py`):

Add `_RETRY_SAFE_KEYS` dict as above. In `retry_job`:

```python
safe_keys = _RETRY_SAFE_KEYS.get(job.type.value, frozenset())
if body is not None and body.payload_override:
    rejected = set(body.payload_override) - safe_keys
    if rejected:
        raise HTTPException(400, f"payload keys not overridable: {sorted(rejected)}")
    new_payload.update({k: body.payload_override[k] for k in safe_keys
                        if k in body.payload_override})
```

Add ownership assertion before enqueuing:

```python
if job.project_id:
    project = await db.get_project(job.project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(403, "not authorised to retry this job")
```

**Handler hardening** (`src/pd_prep_for_pgdp/core/job_runner.py`, `_handle_run_page_stage`):

- Use `job.project_id` as the authoritative project id; do not fall back to `payload["project_id"]`.
- Derive `data_root` from `runner._storage` (filesystem adapter exposes `_root`) or from
  `Settings()`. Never from `payload["data_root"]` alone.
- After fetching the project, assert `project.owner_id == job.owner_id`.

## Implementation Plan

**Slice 1 — Allowlist + ownership check in retry route (TDD):**

- `tests/test_job_retry.py` (new): assert `POST /api/gpu/jobs/{id}/retry` with
  `{"payload_override": {"project_id": "other"}}` returns `400`.
- `tests/test_job_retry.py`: assert `{"payload_override": {"data_root": "/evil"}}` returns `400`.
- `tests/test_job_retry.py`: assert user B retrying user A's job returns `403`.
- `tests/test_job_retry.py`: assert `{"payload_override": {"device": "cuda"}}` succeeds (200 or
  202).
- Implement `_RETRY_SAFE_KEYS` and filtering in `api/gpu/jobs.py`.
- Implement ownership check before enqueue.

**Slice 2 — Handler hardening (defence-in-depth):**

- `tests/test_job_runner.py`: add test that `_handle_run_page_stage` uses `job.project_id` even
  if `payload["project_id"]` differs.
- Remove `payload.get("project_id") or job.project_id` fallback in the handler.
- Remove `data_root = Path(payload["data_root"])` — derive from runner settings.
- Add `project.owner_id == job.owner_id` assertion.

## Test Plan

**Failing tests (prove the bugs before fix):**

```python
# tests/test_job_retry.py
async def test_retry_rejects_project_id_override(client, failed_job_fixture):
    r = await client.post(
        f"/api/gpu/jobs/{failed_job_fixture.id}/retry",
        json={"payload_override": {"project_id": "other-project"}},
    )
    assert r.status_code == 400

async def test_retry_rejects_data_root_override(client, failed_job_fixture):
    r = await client.post(
        f"/api/gpu/jobs/{failed_job_fixture.id}/retry",
        json={"payload_override": {"data_root": "/tmp/evil"}},
    )
    assert r.status_code == 400

async def test_retry_cross_owner_rejected(client_user_a, job_owned_by_user_b):
    r = await client_user_a.post(
        f"/api/gpu/jobs/{job_owned_by_user_b.id}/retry", json={}
    )
    assert r.status_code == 403
```

Before the fix all three return `202 Accepted` or `404` (depends on job visibility), not `400/403`.

**Regression:**

- Existing retry tests (if any) must still pass.
- `device` override for `run_page_stage` jobs must continue to be accepted.
- Handler uses correct project and data root; existing integration tests pass unchanged.

## Open Questions

1. **`data_root` removal from payload:** handler currently needs `data_root` to call `run_stage`.
   The runner carries `_storage` (filesystem adapter) which has `_root`. Is it acceptable to
   expose `runner._storage._root` as the data root, or should `Settings` be injected into the
   runner at construction time? Needs a concrete decision before Slice 2.

2. **Job visibility across users:** currently the retry route fetches the job by `job_id` without
   filtering by `owner_id`, so user B can observe user A's job IDs through the retry endpoint
   (even if retries are blocked). Should the `GET /jobs/{id}` and `POST /jobs/{id}/retry` routes
   filter by `owner_id` before returning? Low-severity information-disclosure; could be addressed
   in this issue or a follow-on.
