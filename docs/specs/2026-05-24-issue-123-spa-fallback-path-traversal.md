# Issue #123 — Unauthenticated SPA fallback can serve absolute host files

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: pdomain/pdomain-prep-for-pgdp#123

## TL;DR

The SPA catch-all route in `bootstrap.py` (`spa_fallback`) uses `os.path.join(static_root,
full_path)` and serves the resulting file if it exists. When `full_path` is URL-decoded to an
absolute path (e.g. `%2Fetc%2Fpasswd` → `/etc/passwd`), `os.path.join` silently discards the
static root and returns the absolute path. Any unauthenticated HTTP client can therefore read
arbitrary host files this way. The fix is to resolve the candidate path and assert containment
before serving it.

## Context

**Vulnerable code:** `src/pdomain_prep_for_pgdp/bootstrap.py:392-397`

```python
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    candidate = os.path.join(path, full_path)
    if full_path and os.path.isfile(candidate):
        return FileResponse(candidate)
    return FileResponse(index_file)
```

FastAPI decodes the URL before passing `full_path` to the handler. A request for
`GET /%2Fetc%2Fpasswd` arrives with `full_path = "/etc/passwd"`.
`os.path.join("/some/static/dir", "/etc/passwd")` returns `"/etc/passwd"` because Python's
`os.path.join` ignores all earlier components once any component is absolute.
`os.path.isfile("/etc/passwd")` is then `True` on most Linux hosts, and `FileResponse` streams it
without any authentication check.

**Why the auth check is missing:** the SPA fallback intentionally bypasses auth — React router
paths like `/projects/123` must be publicly servable before the in-browser auth flow runs. But
"publicly servable" must be scoped to files within the static bundle directory.

**Adapters affected:** all deployment shapes — local, self-hosted, managed. The vulnerability is in
the FastAPI application layer and is independent of storage/DB/auth adapter.

**Severity:** High. No authentication required; any file readable by the server process is exposed.

## Goals / Non-Goals

**Goals:**

- Reject any `full_path` that resolves outside the static bundle directory before serving.
- Reject URL-encoded absolute paths (`%2F`-prefixed, drive letters on Windows).
- Reject traversal segments (`..`, `../`).
- Add regression tests that prove both attack vectors (encoded absolute, traversal) return `404`,
  not file content.
- Zero change to normal SPA route behavior (existing client-side paths continue to serve
  `index.html`; existing static assets like `/assets/abc.js` still serve from the bundle).

**Non-Goals:**

- Adding authentication to SPA routes (intentionally unauthenticated by design).
- Changing how the static assets (`/assets/`, `/favicon.ico`) are served via the `StaticFiles`
  mount — that mount comes after the fallback and is already safe.

## Constraints

- The fix must work on both POSIX and Windows paths.
- `FileResponse` is synchronous-safe in Starlette; `Path.resolve()` requires no async IO.
- The fix belongs only in `_mount_static_frontend`; no changes needed in other adapters.
- `tests/test_spa_fallback.py` already exists and exercises the basic route — regression tests
  extend that file.

## Options Considered

**Option A — Reject before join (input validation):**
Before calling `os.path.join`, check whether `full_path.startswith("/")` or contains `..`
components. Simple, readable. Weakness: Windows paths with drive letters (e.g. `C:/foo`) require
additional checks; encoded slashes in path segments that FastAPI does not decode need separate
consideration.

**Option B — Resolve and assert containment (chosen):**
Build the candidate normally, then call `Path(candidate).resolve()` and assert the resolved path
starts with `Path(static_root).resolve()`. This is identical to the defense already in
`FilesystemStorage._path()`. It works for all OS, handles symlinks inside the bundle correctly,
and requires no knowledge of encoding edge cases — the OS resolver handles them.

**Option C — Explicit Starlette `StaticFiles` + `html=True` only, no fallback function:**
Remove the `spa_fallback` function entirely and rely solely on the `StaticFiles(html=True)` mount.
`StaticFiles` with `html=True` already serves `index.html` for missing paths. Weakness: the
current code registers the fallback before the mount so it can serve static files AND fall through
to `index.html`; using `html=True` alone changes behavior for asset paths (the mount handles those
too, but the ordering changes). Requires more careful restructuring and a wider test surface.
Overkill for this S-effort fix.

## Decision

**Option B.** Replace `os.path.isfile(candidate)` branch with a `_safe_static_file` helper:

```python
# bootstrap.py

def _safe_static_file(static_root: str, full_path: str) -> str | None:
    """Return resolved path iff it is a file inside static_root, else None.

    Handles URL-decoded absolute paths and traversal segments by resolving
    both paths and asserting containment.
    """
    import os
    from pathlib import Path
    candidate = os.path.join(static_root, full_path)
    try:
        resolved = Path(candidate).resolve()
        root_resolved = Path(static_root).resolve()
    except (OSError, ValueError):
        return None
    if root_resolved not in resolved.parents and resolved != root_resolved:
        return None
    if resolved.is_file():
        return str(resolved)
    return None
```

Replace the inline check inside `spa_fallback`:

```python
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    safe = _safe_static_file(path, full_path) if full_path else None
    if safe is not None:
        return FileResponse(safe)
    return FileResponse(index_file)
```

The helper is a pure function and can be unit-tested without a running server.
`_safe_static_file` mirrors the logic in `FilesystemStorage._path()` so both paths share the same
defense pattern.

## Implementation Plan

**Slice 1 — Unit-test `_safe_static_file` (new helper, TDD):**

- File: `tests/test_spa_fallback.py`
- Add `_safe_static_file` to `bootstrap.py` (extract helper only; do not change the live handler
  yet so the test can run before the route changes).
- Tests:
  - `full_path = "/etc/passwd"` with a real `tmp_path` static root → returns `None`
  - `full_path = "../../etc/passwd"` → returns `None`
  - `full_path = "%2Fetc%2Fpasswd"` (pre-decoded by FastAPI) → returns `None`
  - `full_path = "assets/app.js"` with that file present → returns the resolved path
  - `full_path = ""` → returns `None` (blank path case)

**Slice 2 — Wire into `spa_fallback`:**

- Replace the inline `os.path.isfile(candidate)` branch with `_safe_static_file`.
- Run `make ci AI=1` to confirm existing `test_spa_fallback.py` still passes.

## Test Plan

**Failing test (proves the bug before fix):**

```python
# tests/test_spa_fallback.py
def test_spa_fallback_blocks_absolute_path_traversal(tmp_path):
    root = str(tmp_path)
    # No file named "etc/passwd" in the static root
    # But /etc/passwd may exist on the host — the helper must reject it
    result = _safe_static_file(root, "/etc/passwd")
    assert result is None

def test_spa_fallback_blocks_dotdot_traversal(tmp_path):
    root = str(tmp_path)
    result = _safe_static_file(root, "../../etc/passwd")
    assert result is None
```

Before the fix, `os.path.join(root, "/etc/passwd")` → `"/etc/passwd"`, and
`os.path.isfile("/etc/passwd")` is `True` on a standard Linux host — so the original inline logic
would serve the file. After the fix the helper returns `None`.

**Regression:**

- `test_spa_fallback.py` — existing tests for `GET /` → 200 HTML, React router paths → 200 HTML,
  `/api/*` not shadowed, 503 when frontend dir absent. All must still pass.
- New parametrized test covering `["/etc/passwd", "../../etc/passwd", "%2Fetc%2Fpasswd"]` →
  all return `None` from `_safe_static_file`.

## Open Questions

None. The attack vector is clear and the fix is well-bounded.
