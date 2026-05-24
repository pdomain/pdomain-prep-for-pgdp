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

# Keep only ASCII alphanumeric, underscore, hyphen, dot, parens, brackets, space.
# Using [a-zA-Z0-9_] rather than \w to exclude Unicode word characters — the
# stated goal is "ASCII safe-slug only" and \w in Python 3 matches all Unicode
# letters/digits, which would allow non-ASCII chars to pass silently.
_UNSAFE_CHARS = re.compile(r'[^a-zA-Z0-9_\-.()\[\] ]')

def _safe_package_slug(book_name: str, fallback: str) -> str:
    """Return a filesystem-safe ASCII slug for use in a storage key.

    Strips path separators, control chars, OS-reserved characters, and
    consecutive dot sequences that could form relative-path components (e.g. ..).
    Falls back to `fallback` (typically project.id) if the result is empty.
    """
    # Replace path separators with underscore
    name = re.sub(r'[\\/]', '_', book_name)
    # Remove remaining unsafe characters (anything not in the ASCII safe set)
    name = _UNSAFE_CHARS.sub('', name)
    # Collapse consecutive dots (e.g. ".." from "../../" → ".") so that
    # slash-replaced underscores between dot groups cannot re-form ".." after strip.
    name = re.sub(r'\.{2,}', '.', name)
    # Strip leading/trailing dots, spaces, and underscores.
    # Dots: hidden-file prefix on POSIX, Windows reserved.
    # Leading underscores: left over from stripped path separators (e.g. "../../evil"
    # → ".._.._evil" → after filter+collapse → "._._evil" → strip → "evil").
    name = name.strip('. _')
    return name if name else fallback
```

Replace line 151 in `packaging.py`:

```python
from pd_prep_for_pgdp.app.api.data.storage_keys import assert_project_scoped_key

slug = _safe_package_slug(project.config.book_name, fallback=project.id)
package_key = f"projects/{project.id}/for_zip/{slug}.zip"
# Assertion: key must stay under for_zip/ (belt-and-suspenders).
# Uses shared helper from storage_keys.py (see "Cross-spec coordination" below).
assert_project_scoped_key(project.id, package_key)
await storage.put_bytes(package_key, package_bytes, "application/zip")
```

The `assert_project_scoped_key` call is a programmer-error guard; it should never fire if
`_safe_package_slug` is correct, but it makes the invariant explicit and testable. Note that
`assert_project_scoped_key` checks the `projects/{id}/` prefix only; the tighter `for_zip/`
scoping is ensured by `_safe_package_slug` producing a flat slug (no path separators) before
interpolation.

Also expose `package_key` (or `slug`) in the `PackagingResult` so the frontend and download route
can construct the correct URL without re-running the slug logic.

## Implementation Plan

**Slice 1 — `_safe_package_slug` unit tests + implementation (TDD):**

- `tests/test_packaging.py`: parametrized over (showing the transformation chain):
  - `"../../evil"`:
    slash→`_`: `".._.._evil"` →
    char filter: unchanged →
    collapse `..`: `"._._evil"` →
    `strip('. _')`: `"evil"` ✓
  - `"My Book"` → all steps pass through → `"My Book"` (unchanged)
  - `"book/name"` → slash→`_`: `"book_name"` → no further change → `"book_name"`
  - `"../../../"`:
    slash→`_`: `".._.._.._"` →
    char filter: unchanged →
    collapse `..`: `"._._._"` →
    `strip('. _')`: `""` → fallback project ID
  - `"  .  "` → strip: `""` → fallback (only dots and spaces)
  - Control characters `"\x00title"` → char filter removes `\x00` → `"title"`
  - Unicode word char `"café"` → char filter removes `é` (non-ASCII) → `"caf"`
    (demonstrates `[a-zA-Z0-9_]` tightening vs `\w`)
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
    assert not slug.startswith("_")   # no leading underscores from stripped slashes
    assert slug == "evil"             # exact expected output after full transform chain
    assert slug  # non-empty

def test_safe_package_slug_traversal_book_name_stays_in_for_zip(tmp_path):
    # Compose the key as packaging.py does after the fix
    slug = _safe_package_slug("../../evil", fallback="proj123")
    project_id = "proj123"
    key = f"projects/{project_id}/for_zip/{slug}.zip"
    assert key.startswith(f"projects/{project_id}/for_zip/")

def test_safe_package_slug_strips_unicode_word_chars():
    # \w in Python 3 matches Unicode; [a-zA-Z0-9_] must be used instead
    slug = _safe_package_slug("café", fallback="proj123")
    assert slug == "caf"   # 'é' (non-ASCII) is removed; not "café"
```

Before the fix, `_safe_package_slug` does not exist and the key is `projects/proj123/for_zip/../../evil.zip`
which does not start with `projects/proj123/for_zip/`.

**Transformation chain reminder for `"../../evil"` (the tricky case):**

```
"../../evil"
  → slash→_ :       ".._.._evil"
  → char filter:    ".._.._evil"   (unchanged — dots and _ are both in safe set)
  → collapse ..:    "._._evil"     (each ".." → ".")
  → strip('. _'):   "evil"         (leading ., _, . stripped left-to-right)
```

The intermediate `".._..evil"` or `"..evil"` (which earlier versions of this spec showed) was
incorrect because the `_` characters from slash substitution were not accounted for before the
strip step. The added `.strip('. _')` (underscore included) and `re.sub(r'\.{2,}', '.', name)`
collapse step make the correct output `"evil"`, not `"__evil"` or `"_.._evil"`.

**Regression:**

- Normal book names produce expected keys: `"My Book"` → `projects/{id}/for_zip/My Book.zip`.
- `PackagingResult` still carries the correct key for the frontend download URL.

## Cross-spec coordination with #127

Both #128 and #127 need to assert that a storage key is scoped to a specific project prefix.
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

This spec (#128) uses `assert_project_scoped_key` as the belt-and-suspenders containment
assertion after `_safe_package_slug` (see Decision section above). Issue #127 wraps the same
function in `_validate_source_key` and re-raises as `HTTPException(400, ...)` at the API
boundary.

## Open Questions

1. **Download URL construction:** the frontend constructs the package download URL from either
   `PackagingResult.package_key` or by re-deriving it from `book_name`. Which approach is in use?
   If re-derived, the frontend must use the same slug logic or receive the canonicalized key.
   Verify before Slice 2.

2. **Existing projects with path-separator book names:** are there any? If a project's `book_name`
   in the DB contains `/` (e.g. "Author / Title"), the slug replaces the slash with underscore.
   The package key changes on the next packaging run. The old file (if any) is not deleted. Is
   this acceptable, or should a migration normalize existing names?
