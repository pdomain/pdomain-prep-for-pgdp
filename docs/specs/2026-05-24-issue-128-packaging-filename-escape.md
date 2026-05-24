# Issue #128 — Packaging filename can escape the project prefix

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#128

## TL;DR

`book_name` is a user-controlled `ProjectConfig` field. It is interpolated directly into the
storage key `projects/{id}/for_zip/{book_name}.zip` in `core/packaging.py`. In filesystem mode,
a `book_name` containing path separators (e.g. `../../evil`) can escape the `for_zip/` directory
and overwrite arbitrary files under the data root. The fix is to treat `book_name` as display
text only and generate the package filename from a sanitized slug that is validated to remain
under the project's `for_zip/` prefix.

## Context

**Vulnerable code — packaging:** `src/pd_prep_for_pgdp/core/packaging.py:151`

```python
package_key = f"projects/{project.id}/for_zip/{project.config.book_name}.zip"
await storage.put_bytes(package_key, package_bytes, "application/zip")
```

`book_name` is accepted from the client via `PUT /api/data/projects/{id}/config` (see
`api/data/projects.py:199-211`), validated only by Pydantic as a non-empty string.

**Vulnerable code — model:** `src/pd_prep_for_pgdp/core/models.py:68`

```python
book_name: str
```

No length, character, or path-safety constraints.

**Attack scenario (filesystem mode):**

1. User sets `book_name = "../../evil"` on their project.
2. User runs packaging.
3. The package is written to `data_root/projects/{id}/for_zip/../../evil.zip` which resolves to
   `data_root/projects/evil.zip` — outside the `for_zip/` directory, potentially overwriting
   another project's package or other data.

`FilesystemStorage._path()` would normally block traversal. However, `projects/{id}/for_zip/../../evil`
resolves to `projects/evil` which is still inside `data_root/projects/` — the storage adapter's
containment check (`data_root` not in parents) passes because `projects/evil` is under `data_root`.
The overwrite lands in a wrong location but does not escape the data root on POSIX. On Windows,
depending on path component processing, the results can differ.

In S3 mode, the `..` segments produce a literal key `projects/{id}/for_zip/../../evil.zip` which
S3 stores verbatim, potentially landing the object at an unexpected path depending on how the
bucket is navigated.

**Adapters affected:** both filesystem and S3. Different exploitation vectors but both store the
file at a wrong location.

## Goals / Non-Goals

**Goals:**

- Generate the package filename from a sanitized slug derived from `book_name`.
- The slug must reject: path separators (`/`, `\`, `..`), null bytes and other control characters
  (`\x00`–`\x1f`), characters illegal in common filesystems (`*`, `?`, `"`, `<`, `>`, `|`, `:`).
- Validate the composed key stays under `projects/{project.id}/for_zip/`.
- `book_name` remains a display-only field; the sanitized slug is used for storage only.
- Add regression tests for traversal inputs.

**Non-Goals:**

- Changing how `book_name` is stored in `ProjectConfig` or displayed to the user — it remains
  the user-visible name.
- Generating globally unique package filenames (the slug is deterministic from `book_name`).
- Internationalization / Unicode slug normalization (basic ASCII safe-slug only for now).

## Constraints

- The sanitized slug must be stable: the same `book_name` always produces the same slug so that
  the same project always writes to the same key. This is important for the download URL the
  frontend constructs.
- The slug must be non-empty. If `book_name` sanitizes to empty, fall back to the project ID.
- The sanitization function is a pure helper — it belongs in `core/packaging.py` or a new
  `core/slugify.py` and can be unit-tested without storage.
- The storage adapter (`FilesystemStorage._path`) already blocks keys that escape `data_root`
  entirely; the slug check adds an additional layer scoped to `for_zip/`.

## Options Considered

**Option A — Sanitize in-place at packaging call:**
Apply a `_slugify(book_name)` call at line 151 of `packaging.py`. No API change. Weakness:
`book_name` is still stored as-is in the DB; the package key could drift if sanitization logic
changes between runs.

**Option B — Validate `book_name` at config-write time (input validation):**
Add a `book_name` validator in `ProjectConfig` (Pydantic `field_validator`) that rejects illegal
characters. Enforces the constraint at the data-entry point. Weakness: existing projects in the
DB may have illegal names; adding a strict validator could break config reads for those projects.
A validator on `model_validate` would reject existing data.

**Option C — Sanitize at packaging + containment assertion (chosen):**
Keep `book_name` unrestricted in the model (preserves existing data). Apply `_safe_package_slug`
at the packaging call only. Assert the composed key stays under the `for_zip/` prefix before
calling `storage.put_bytes`. This is defence-in-depth: even if sanitization has an edge case,
the assertion catches it.

## Decision

**Option C.**

Add `_safe_package_slug(book_name: str, fallback: str) -> str` to
`src/pd_prep_for_pgdp/core/packaging.py`:

```python
import re

_UNSAFE_CHARS = re.compile(r'[^\w\-.()\[\] ]')  # keep: word chars, hyphen, dot, parens, space

def _safe_package_slug(book_name: str, fallback: str) -> str:
    """Return a filesystem-safe slug for use in a storage key.

    Strips path separators, control chars, and OS-reserved characters.
    Falls back to `fallback` (typically project.id) if the result is empty.
    """
    # Collapse any path separators to underscore
    name = re.sub(r'[\\/]', '_', book_name)
    # Remove remaining unsafe characters
    name = _UNSAFE_CHARS.sub('', name)
    # Remove leading/trailing dots and whitespace (hides files, Windows reserved)
    name = name.strip('. ')
    return name if name else fallback
```

Replace line 151 in `packaging.py`:

```python
slug = _safe_package_slug(project.config.book_name, fallback=project.id)
package_key = f"projects/{project.id}/for_zip/{slug}.zip"
# Assertion: key must stay under for_zip/ (belt-and-suspenders)
expected_prefix = f"projects/{project.id}/for_zip/"
if not package_key.startswith(expected_prefix):
    raise ValueError(f"package_key escapes for_zip prefix: {package_key!r}")
await storage.put_bytes(package_key, package_bytes, "application/zip")
```

The assertion after `_safe_package_slug` is a programmer-error guard; it should never fire if
`_safe_package_slug` is correct, but it makes the invariant explicit and testable.

Also expose `package_key` (or `slug`) in the `PackagingResult` so the frontend and download route
can construct the correct URL without re-running the slug logic.

## Implementation Plan

**Slice 1 — `_safe_package_slug` unit tests + implementation (TDD):**

- `tests/test_packaging.py`: parametrized over:
  - `"../../evil"` → `"..evil"` → after strip-dots → `"evil"` (no separators, no leading dots)
  - `"My Book"` → `"My Book"` (unchanged)
  - `"book/name"` → `"book_name"` (slash → underscore)
  - `"../../../"` → after strip-separators and strip-dots → fallback project ID
  - `"  .  "` → fallback (only dots and spaces)
  - Control characters `"\x00title"` → `"title"`
- Implement `_safe_package_slug` in `packaging.py`.

**Slice 2 — Wire into packaging + assertion:**

- Replace the interpolation at `packaging.py:151`.
- Add the `startswith` assertion.
- Expose `slug` or `package_key` in `PackagingResult`.
- `tests/test_packaging.py`: end-to-end packaging test with a traversal `book_name` confirms
  the file is written to `for_zip/evil.zip`, not a traversal path.

## Test Plan

**Failing test (proves the bug before fix):**

```python
# tests/test_packaging.py
def test_safe_package_slug_rejects_traversal():
    slug = _safe_package_slug("../../evil", fallback="proj123")
    assert "/" not in slug
    assert "\\" not in slug
    assert not slug.startswith(".")
    assert slug  # non-empty

def test_safe_package_slug_traversal_book_name_stays_in_for_zip(tmp_path):
    # Compose the key as packaging.py does after the fix
    slug = _safe_package_slug("../../evil", fallback="proj123")
    project_id = "proj123"
    key = f"projects/{project_id}/for_zip/{slug}.zip"
    assert key.startswith(f"projects/{project_id}/for_zip/")
```

Before the fix, `_safe_package_slug` does not exist and the key is `projects/proj123/for_zip/../../evil.zip`
which does not start with `projects/proj123/for_zip/`.

**Regression:**

- Normal book names produce expected keys: `"My Book"` → `projects/{id}/for_zip/My Book.zip`.
- `PackagingResult` still carries the correct key for the frontend download URL.

## Open Questions

1. **Download URL construction:** the frontend constructs the package download URL from either
   `PackagingResult.package_key` or by re-deriving it from `book_name`. Which approach is in use?
   If re-derived, the frontend must use the same slug logic or receive the canonicalized key.
   Verify before Slice 2.

2. **Existing projects with path-separator book names:** are there any? If a project's `book_name`
   in the DB contains `/` (e.g. "Author / Title"), the slug replaces the slash with underscore.
   The package key changes on the next packaging run. The old file (if any) is not deleted. Is
   this acceptable, or should a migration normalize existing names?
