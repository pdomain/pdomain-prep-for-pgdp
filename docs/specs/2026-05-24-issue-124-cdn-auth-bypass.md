# Issue #124 — Filesystem CDN bypasses auth for project data reads and writes

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: pdomain/pdomain-prep-for-pgdp#124

## TL;DR

In filesystem mode the CDN is a raw `StaticFiles` mount of the entire data root (`/cdn` → data
directory) plus an unauthenticated `PUT /cdn/{key:path}` route. Anyone who knows a storage key can
`GET /cdn/projects/<other-user-id>/source/...` to read another user's images, or
`PUT /cdn/projects/<other-user-id>/package.zip` to overwrite their outputs — without presenting a
token. The fix is to add an auth check to `PUT /cdn/…`, replace the `StaticFiles` read mount with
an authenticated `GET /cdn/…` FastAPI route, and gate both on project ownership in multi-user
modes.

## Context

**Vulnerable code surface:**

- `src/pdomain_prep_for_pgdp/bootstrap.py:344-354` — mounts `StaticFiles(directory=data_root)` at
  `/cdn` with no auth middleware; Starlette's `StaticFiles` serves any file under that tree to
  any client.
- `src/pdomain_prep_for_pgdp/api/cdn.py:22-39` — `PUT /cdn/{key:path}` has no auth dependency
  (`Depends(get_user)` is absent); any client can overwrite any key.
- `src/pdomain_prep_for_pgdp/adapters/storage/filesystem.py:80-87` — `presign_put` and `presign_get`
  return plain `/cdn/<key>` URLs, so "presigned" is a misnomer; there is no signature.

**Auth modes and impact:**

- `auth_mode=none` (local solo install): single-user; risk is low — there is no other user.
- `auth_mode=apikey` / `auth_mode=jwt` (self-hosted team or managed): multi-user; any authenticated
  user who can observe or guess a storage key can access another user's project data without
  owning it. Unauthenticated requests succeed if the server is network-accessible.

**Why this is hard to fix broadly:** The CDN URLs are embedded in artifact `<img src>` attributes
by the frontend and served directly to the browser. Any replacement must still be served over HTTP
and must support browser image caching. The fix for local mode (single-user, no network auth)
should be minimal. The fix for multi-user modes must include an ownership check per key.

**Adapters affected:** `FilesystemStorage` only. `S3Storage` uses real AWS presigned URLs that
include HMAC signatures and expiry; it is not affected.

## Goals / Non-Goals

**Goals:**

- `PUT /cdn/{key}` must require a valid authenticated session (or be absent in `auth_mode=none`).
- `GET /cdn/{key}` must be served by a FastAPI route (not bare `StaticFiles`) in multi-user modes
  so auth and ownership checks can be enforced.
- `GET /cdn/{key}` in `auth_mode=none` may continue to use `StaticFiles` or a lightweight
  authenticated route (same result since there is only one user).
- All routes must enforce that the key resolves under `data_root` (path traversal prevention).
- Key-to-project ownership check: extract `project_id` from key prefix
  (`projects/{project_id}/…`) and assert `project.owner_id == user.user_id`.

**Non-Goals:**

- Implementing HMAC-signed presigned URLs for filesystem mode (deferred — valid for a future
  hardening pass; this spec targets the high-severity unauth bypass).
- Changing S3 presign behavior.
- Changing `presign_put`/`presign_get` signatures in the `IStorage` protocol.

## Constraints

- `FilesystemStorage.presign_get` returns `/cdn/<key>` and the frontend uses those URLs directly
  in `<img>` tags. Replacing the mount with a FastAPI route must not change URL shape.
- Upload size: the PUT handler currently reads the entire body into memory before calling
  `storage.put_bytes`. A size limit must be applied at this step; the canonical limit value
  is `Settings.max_cdn_upload_bytes`, owned by #129 (see "Coordination with #129" below).
- Local-first priority: the fix must be low-friction for `auth_mode=none` (single-user local
  install). Adding auth to reads when there is only one user should not require token headers for
  simple image viewing.
- `install_cdn_upload` is called before the `StaticFiles` mount in `bootstrap.py`; any new read
  route must also be registered before (or instead of) the mount.

## Options Considered

**Option A — Unauthenticated GET; add auth to PUT only:**
Keep `StaticFiles` for reads (browser `<img>` cache-friendly), add `Depends(get_user)` to
`cdn_put`. Low effort. Weakness: reads are still open; any client who knows a key can read
another user's files. Not sufficient for multi-user modes. Acceptable only for `auth_mode=none`.

**Option B — Mode-split: StaticFiles reads in none mode, authenticated FastAPI route in other modes
(chosen):**
In `auth_mode=none`: keep `StaticFiles` read mount (no real risk, single user). Add `Depends(get_user)`
to `cdn_put` (which in none-mode always succeeds anyway — get_user returns a fixed anonymous user).
In `auth_mode=apikey|jwt`: replace `StaticFiles` with `GET /cdn/{key:path}` FastAPI route that
checks auth + project ownership. Both modes apply path containment on the storage key. This keeps
local UX simple while closing the multi-user bypass.

**Option C — Require authentication on all CDN reads in all modes:**
Simplest code; uniform policy. Weakness: browser `<img>` tags in `auth_mode=none` would need to
carry credentials, which is not how browsers work with plain `src=` attributes. Requires switching
to Blob URLs or adding credentials to fetch calls in the frontend. High frontend change surface.
Deferred to a future hardening pass.

## Decision

**Option B.**

**Changes in `src/pdomain_prep_for_pgdp/api/cdn.py`:**

Add `Depends(get_user)` to `cdn_put` so all auth modes enforce a valid session on writes.

Add a new `cdn_get` route:

```python
@router.get("/cdn/{key:path}", operation_id="download_cdn_asset")
async def cdn_get(
    key: str,
    user: UserContext = Depends(get_user),
    storage: IStorage = Depends(get_storage),
    db: IDatabase = Depends(get_database),
) -> Response:
    """Authenticated CDN read for multi-user modes."""
    _validate_cdn_key(key)
    _check_project_ownership(key, user, db)  # async; raises 403/404 on mismatch
    data = await storage.get_bytes(key)
    content_type = _content_type_for_key(key)
    return Response(content=data, media_type=content_type)
```

Extract `_validate_cdn_key(key)` helper (reused by both GET and PUT):

```python
def _validate_cdn_key(key: str) -> None:
    if ".." in key.split("/") or key.startswith("/"):
        raise HTTPException(400, "invalid key")
```

Extract `_check_project_ownership(key, user, db)` helper:

- Parse project_id from `projects/{project_id}/…` prefix.
- If the key does not start with `projects/`, skip ownership check (shared/system keys).
- `project = await db.get_project(project_id)` — 404 if not found.
- Assert `project.owner_id == user.user_id` — 403 if mismatch.

**Changes in `src/pdomain_prep_for_pgdp/bootstrap.py`:**

- In `auth_mode=none`: keep `StaticFiles` read mount; add the PUT route with auth (no-op for
  none-mode since `get_user` returns a fixed user).
- In `auth_mode=apikey|jwt`: register `cdn_get` route instead of the `StaticFiles` mount.
- The conditional is gated on `settings.auth_mode`, not `settings.cdn_enabled`.

`install_cdn_upload` becomes `install_cdn_routes(app, auth_mode)` to control which read path
is installed.

## Implementation Plan

**Slice 1 — Add `Depends(get_user)` to `cdn_put` + `_validate_cdn_key` helper (auth on writes):**

- `src/pdomain_prep_for_pgdp/api/cdn.py`: add `UserDep` to `cdn_put`, extract `_validate_cdn_key`.
- `tests/test_cdn.py` (new): `PUT /cdn/projects/X/foo.png` without auth in `apikey` mode → 401.
- `tests/test_cdn.py`: `PUT /cdn/../etc/passwd` → 400 (path traversal rejected).

**Slice 2 — `cdn_get` route + ownership check:**

- `src/pdomain_prep_for_pgdp/api/cdn.py`: add `cdn_get` and `_check_project_ownership`.
- `src/pdomain_prep_for_pgdp/bootstrap.py`: install `cdn_get` instead of `StaticFiles` when
  `auth_mode != "none"`. Rename `install_cdn_upload` → `install_cdn_routes`.
- `tests/test_cdn.py`: user A cannot GET project B's key → 403. User A can GET own project key
  → 200 with correct bytes.

**Slice 3 — Upload size limit (also closes part of #129):**

- `src/pdomain_prep_for_pgdp/api/cdn.py`: read `settings.max_cdn_upload_bytes` (owned and
  defaulted by #129's Settings table — do **not** define a local `MAX_CDN_UPLOAD_BYTES`
  constant here). Check `request.headers.get("content-length")` before reading body; also
  enforce during streaming read.
- `tests/test_cdn.py`: PUT with oversized body → 413.

## Test Plan

**Failing tests (prove the bugs before fix):**

```python
# tests/test_cdn.py — new file
async def test_cdn_put_requires_auth(apikey_client, tmp_data_root):
    """PUT /cdn/* without credentials must return 401 in apikey mode."""
    r = await apikey_client.put("/cdn/projects/p1/source/page0001.png", content=b"data")
    assert r.status_code == 401

async def test_cdn_get_ownership_check(apikey_client_user_a, apikey_client_user_b, tmp_data_root):
    """User B cannot GET a key owned by user A's project."""
    # Setup: user A owns project p1, store a file under it
    ...
    r = await apikey_client_user_b.get("/cdn/projects/p1/source/page0001.png")
    assert r.status_code in (403, 404)
```

Both tests fail before the fix (PUT returns 204 without auth; GET returns 200 with file bytes).

**Regression:**

- `test_cdn.py`: `PUT /cdn/{key}` with valid auth → 204 (write succeeds).
- `test_cdn.py`: `GET /cdn/{key}` with valid auth + own project → 200 with correct bytes.
- `test_cdn.py`: path traversal `../` → 400 on both PUT and GET.
- Existing `test_spa_fallback.py` tests unaffected (CDN routes are separate from SPA mount).

## Coordination with #129

`Settings.max_cdn_upload_bytes` is **owned by #129** (resource-bounds spec). That spec's
defaults table sets the value to 300 MB (a single 600 DPI page scan) and adds the field to
`settings.py`. This spec (#124) only **consumes** that setting in `cdn_put`; it must not
declare its own constant or override the default.

No other Settings fields overlap between #124 and #129. The upload-body guard in #129 Slice 1
(the `content-length` check and post-read `len(body)` check in `cdn.py`) and the auth guard
in #124 Slice 3 touch the same function; whichever ships first should leave a clearly-labeled
`# TODO: add settings.max_cdn_upload_bytes guard (tracked in #129)` comment if the limit is
not yet in place, so they compose cleanly when both slices land.

## Open Questions

1. **`auth_mode=none` read path:** keeping `StaticFiles` is the low-friction choice; are there
   plans to make local mode truly single-user-locked (no LAN access)? If yes, Option C
   (authenticated reads everywhere) should replace the mode-split.

2. **Streaming uploads:** Slice 3 proposes a size check on `content-length`; large uploads
   should eventually be streamed to disk rather than buffered. Tracked more specifically in #129.
