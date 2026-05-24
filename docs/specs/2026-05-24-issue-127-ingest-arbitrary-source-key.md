# Issue #127 — Ingest accepts arbitrary storage keys for an owned project

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#127

## TL;DR

The ingest route verifies that the caller owns `project_id`, but it stores the caller-supplied
`source_key` in the queued job without validating that the key falls within the project's own
storage prefix. The job runner later reads that key from storage. By submitting a `source_key`
pointing to another user's project prefix, a caller can enumerate, copy, and extract another
user's source images into their own project — effectively a cross-project data-theft primitive.
The fix is to bind `source_key` to the authenticated project's storage prefix before enqueuing.

## Context

**Vulnerable code — ingest route:** `src/pd_prep_for_pgdp/api/gpu/ingest.py:28-49`

```python
job = Job(
    ...
    progress=JobProgress(message=body.source_key),
)
await db.put_job(job)
```

`body.source_key` is user-controlled. The route checks `project.owner_id == user.user_id` but
never checks whether `body.source_key` starts with the project's storage prefix.

**Vulnerable code — unzip handler:** `src/pd_prep_for_pgdp/core/job_runner.py:340-344`

```python
source_key = job.progress.message
source_type = "zip" if source_key.endswith(".zip") else "local_folder"
```

The handler derives `source_type` from the key suffix and calls `ingest_source` with the raw key.

**Vulnerable code — enumerate_zip:** `src/pd_prep_for_pgdp/core/ingest.py:361-376`

```python
raw = await storage.get_bytes(source_key)
```

No check that `source_key` is scoped to the project. If the key is valid and readable, the bytes
are extracted and written as page source files under the victim project's prefix.

**Attack scenario:**

1. User A uploads a zip for project P_A; the zip lands at
   `projects/P_A/uploads/source.zip`.
2. User B owns project P_B. User B calls `POST /ingest` with
   `{"project_id": "P_B", "source_key": "projects/P_A/uploads/source.zip"}`.
3. The route confirms B owns P_B and enqueues a job with `source_key =
   "projects/P_A/uploads/source.zip"`.
4. The runner fetches and extracts P_A's zip, writing pages into P_B.

User A's source images are now accessible to User B. The attack also works with
`_enumerate_folder` if `source_key` points to `projects/P_A/source/`.

**Adapters affected:** `FilesystemStorage` (concrete paths) and `S3Storage` (S3 key prefixes).
Both adapters are affected because the key validation is missing at the API layer, before the
storage adapter is called.

## Goals / Non-Goals

**Goals:**

- Validate that `source_key` falls under `project.storage_prefix` (or a known upload prefix) for
  the authenticated project before the job is enqueued.
- For zip uploads, accept only keys under `projects/{project_id}/uploads/`.
- For folder source, accept only keys under `projects/{project_id}/source/` or the project's
  storage prefix.
- Reject any `source_key` that would escape the project prefix.
- Add regression tests for cross-project `source_key` attacks.

**Non-Goals:**

- Changing the `IStorage` interface or the underlying storage adapters.
- Moving the source_key from `progress.message` to a typed payload field (desirable cleanup but
  separate from the security fix).

## Constraints

- `project.storage_prefix` is the canonical project-scoped prefix. If the `Project` model does
  not currently expose a `storage_prefix` property, derive it as `f"projects/{project.id}/"`.
- The ingest route already has `project` loaded from `db.get_project`. The prefix check is
  therefore a pure string operation — no additional DB or storage calls needed.
- `source_key` may be submitted as a CDN-relative path (starting with `cdn/`) or as a bare
  storage key. The check must handle both forms consistently.
- Source zips uploaded via the browser CDN upload flow land at a server-assigned key. The
  ingest route (or its calling flow) must provide the validated key; the client should not be
  able to supply an arbitrary key in the normal flow. If the current API contract allows the
  client to specify an arbitrary key, this must be changed.

## Options Considered

**Option A — Server-assigns source_key, client submits project_id only:**
The ingest route generates the source key server-side from the project prefix. The client never
submits a `source_key`. The route looks up a "pending upload" record or reads the most recent
zip under the project's upload prefix. Eliminates the attack surface entirely. Weakness: requires
tracking pending uploads server-side; more complex flow.

**Option B — Client submits source_key, server validates it is within project prefix (chosen):**
Keep the existing API shape. Add a prefix check in the ingest route:

```python
project_prefix = f"projects/{project.id}/"
clean_key = body.source_key.lstrip("/")
if not clean_key.startswith(project_prefix):
    raise HTTPException(400, "source_key outside project storage prefix")
```

Simple, backward-compatible, single-point enforcement. The client must still supply a key, but
the key is constrained to the project's own prefix — which the client already knows (it just
uploaded there).

**Option C — Validate in the job runner handler:**
Keep the route unchanged; add the prefix check in `_handle_unzip`. Defence-in-depth, but puts
security logic deeper than necessary. If a different code path enqueues an unzip job it would
bypass the check. Prefer enforcement at the API boundary.

## Decision

**Option B**, enforced at the API boundary, with Option C as additional defence-in-depth.

**Changes in `src/pd_prep_for_pgdp/api/gpu/ingest.py`:**

Add a `_validate_source_key(project_id, source_key)` helper:

```python
def _validate_source_key(project_id: str, source_key: str) -> None:
    clean = source_key.lstrip("/")
    expected_prefix = f"projects/{project_id}/"
    if not clean.startswith(expected_prefix):
        raise HTTPException(
            400,
            f"source_key must be under projects/{project_id}/; got: {source_key!r}",
        )
```

Call this after the ownership check and before creating the job:

```python
_validate_source_key(body.project_id, body.source_key)
```

**Defence-in-depth in `src/pd_prep_for_pgdp/core/job_runner.py`:**

In `_handle_unzip`, after resolving `project_id` and `source_key`:

```python
expected_prefix = f"projects/{project.id}/"
if not source_key.lstrip("/").startswith(expected_prefix):
    raise ValueError(f"source_key escapes project prefix: {source_key!r}")
```

This catches any job that was enqueued without going through the API route (e.g. direct DB
writes in tests).

## Implementation Plan

**Slice 1 — `_validate_source_key` helper + route check (TDD):**

- `tests/test_ingest_route.py` (new or extend existing): assert that
  `POST /api/gpu/ingest` with `source_key = "projects/other-project/uploads/foo.zip"` returns
  `400` when the authenticated user owns a different project.
- `tests/test_ingest_route.py`: assert that a valid `source_key = "projects/{own_id}/uploads/foo.zip"`
  returns `202`.
- Implement `_validate_source_key` in `api/gpu/ingest.py`.

**Slice 2 — Defence-in-depth in job runner:**

- `tests/test_job_runner.py`: assert that `_handle_unzip` with a cross-project `source_key`
  raises `ValueError` before calling storage.
- Add the prefix check in `core/job_runner.py:_handle_unzip`.

## Test Plan

**Failing test (proves the bug before fix):**

```python
# tests/test_ingest_route.py
async def test_ingest_rejects_cross_project_source_key(client, project_a, project_b_key):
    """User owning project_a cannot use project_b's source key."""
    r = await client.post("/api/gpu/ingest", json={
        "project_id": project_a.id,
        "source_key": f"projects/{project_b_key}/uploads/source.zip",
    })
    assert r.status_code == 400
```

Before the fix the route returns `202`; after the fix it returns `400`.

**Regression:**

- `POST /api/gpu/ingest` with own-project source key → `202`.
- `POST /api/gpu/ingest` with missing project → `404`.
- `POST /api/gpu/ingest` with other user's project_id → `404` (unchanged — ownership already
  enforced).

## Cross-spec coordination with #128

Both #127 and #128 need to assert that a storage key is scoped to a specific project prefix.
Rather than duplicating the logic, both specs share a single helper module:

**Shared module: `src/pd_prep_for_pgdp/app/api/data/storage_keys.py`**

```python
def assert_project_scoped_key(project_id: str, key: str) -> None:
    """Raise ValueError if `key` does not fall under projects/{project_id}/.

    Strips a leading slash before checking so both CDN-relative and bare
    storage keys are handled consistently.
    """
    clean = key.lstrip("/")
    expected_prefix = f"projects/{project_id}/"
    if not clean.startswith(expected_prefix):
        raise ValueError(
            f"key must be under projects/{project_id}/; got: {key!r}"
        )
```

**Ownership rule:** whichever issue (#127 or #128) ships first introduces
`storage_keys.py`. The other issue then imports from it rather than
re-implementing the check.

`_validate_source_key` in `api/gpu/ingest.py` (this spec) wraps
`assert_project_scoped_key` and re-raises as `HTTPException(400, ...)`:

```python
from pd_prep_for_pgdp.app.api.data.storage_keys import assert_project_scoped_key

def _validate_source_key(project_id: str, source_key: str) -> None:
    try:
        assert_project_scoped_key(project_id, source_key)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
```

The `packaging.py` assertion in #128 calls `assert_project_scoped_key` directly
(it raises `ValueError`, which is the right error type for a programmer-error guard
inside the packaging pipeline).

## Open Questions

1. **Upload flow source key contract:** how is `source_key` communicated to the ingest call after
   a browser upload? If the frontend constructs the key after a successful CDN PUT, does the key
   match the `projects/{id}/uploads/…` pattern already? Needs verification before Slice 1 coding.

2. **Folder ingest source key:** for `source_type = "local_folder"`, the source key is a directory
   prefix, not a zip path. The prefix check (`startswith("projects/{id}/"`) handles this correctly
   already, but the runner also calls `_enumerate_folder(storage, source_key)` which lists all
   objects under that prefix. Confirm there is no deeper traversal needed.
