# Issue #129 — ZIP and image processing paths have no resource bounds

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#129

## TL;DR

Five code paths read entire request bodies, source zips, ZIP entries, and image bytes into memory
without any size, entry-count, or decompressed-size limits. A malicious archive (zip bomb) or
oversized upload can exhaust server RAM and CPU. The fix is to enforce concrete limits at each
entry point: max upload body, max source-zip size, max ZIP entry count, max decompressed-bytes per
entry, max decoded image dimensions.

## Context

**Vulnerable paths:**

| Site | What is unbounded |
|------|------------------|
| `api/cdn.py:34` — `body = await request.body()` | Entire PUT body buffered in memory |
| `core/ingest.py:362` — `raw = await storage.get_bytes(source_key)` | Entire source zip in memory before opening |
| `core/ingest.py:364-376` — `zf.infolist()` / `zf.read(info)` | No entry-count or uncompressed-size limit |
| `core/ingest.py:436-458` — `extract_zip_image_thumbnail` | Re-reads full zip; no decompressed-size limit per entry |
| `core/ingest.py:511-533` — `_make_thumbnail_bytes` | Decodes image of arbitrary dimensions |

**Zip bomb mechanics:** a 42 kB `42.zip` decompresses to 4.5 GB in six nested layers. Even
a single-level bomb (1 MB → 1 GB) is trivially constructed. Without a decompressed-size limit,
`zf.read(info)` will attempt to allocate gigabytes of RAM.

**Oversized upload:** without a `content-length` check on `PUT /cdn/{key}`, an attacker can
stream an arbitrarily large file, exhausting disk and memory.

**Huge image decode:** `cv2.imdecode` can be given a valid PNG header advertising a 100000×100000
image. Before decoding is complete, cv2 may allocate tens of GB. There is no pre-decode dimension
check.

**Adapters affected:** all shapes (local, self-hosted, managed). The risk is higher in managed
(multi-tenant) and self-hosted (shared host) modes. In local solo mode the attacker is the user
themselves, so risk is lower but not zero (accidental zip bomb from a corrupted archive).

## Goals / Non-Goals

**Goals:**

- Max upload body size: `PUT /cdn/{key}` must enforce `MAX_CDN_UPLOAD_BYTES`.
- Max source-zip size: before opening a zip from storage, assert the fetched bytes do not exceed
  `MAX_SOURCE_ZIP_BYTES`.
- Max ZIP entry count: abort extraction if `len(zf.infolist())` exceeds `MAX_ZIP_ENTRIES`.
- Max decompressed size per entry: track running decompressed bytes; abort if any single entry
  exceeds `MAX_ENTRY_UNCOMPRESSED_BYTES` or total exceeds `MAX_TOTAL_UNCOMPRESSED_BYTES`.
- Max decoded image pixels: read image header dimensions before full decode; reject if
  `width * height > MAX_IMAGE_PIXELS`.
- All limits must be configurable via `Settings` (env vars) so they can be tuned per deployment.
- Provide clear HTTP error responses (413, 422) for limit violations rather than OOM/timeout.

**Non-Goals:**

- Streaming uploads to disk before calling `storage.put_bytes` (desirable but a larger refactor;
  body-size limit is the immediate fix).
- Deferred: processing thumbnails with bounded queues (the pool already exists; queue bounding
  is a follow-on).
- Nested zip detection (zip-within-zip bombs that evade single-level decompressed-size limits).

## Constraints

- `FilesystemStorage.put_bytes` writes bytes synchronously from a `bytes` argument — the API
  currently buffers the whole body. The max-body check must happen before `await request.body()`.
- `cv2.imdecode` does not support pre-decode dimension checks; use `imagesize` or `Pillow`'s
  lazy open to read dimensions from the header without full decode, or decode in a subprocess
  with memory limits.
- The `extract_zip_image_thumbnail` function is called by the preview endpoint and re-reads the
  entire zip each time. The input `raw: bytes` is already in memory; the limit here is on the
  uncompressed entry size, not on re-reading.
- All limit constants must be in `settings.py` with sane defaults. They should be overridable
  per deployment (managed tenants may want tighter limits; local users may want looser).

## Proposed Limits

| Constant | Default | Rationale |
|----------|---------|-----------|
| `MAX_CDN_UPLOAD_BYTES` | 300 MB | Max single page scan at 600 DPI |
| `MAX_SOURCE_ZIP_BYTES` | 2 GB | A 500-page book at ~4 MB/page compressed |
| `MAX_ZIP_ENTRIES` | 2000 | No book has more than ~1500 scans |
| `MAX_ENTRY_UNCOMPRESSED_BYTES` | 100 MB | Single uncompressed TIFF page |
| `MAX_TOTAL_UNCOMPRESSED_BYTES` | 5 GB | All pages for one book |
| `MAX_IMAGE_PIXELS` | 200_000_000 | ~14142 × 14142 px; well above 600 DPI A4 |

## Options Considered

**Option A — Hard-coded limits in each code path:**
Insert size checks inline at each vulnerable site. Quick to implement. Weakness: limits are
scattered across five files and cannot be adjusted per deployment.

**Option B — Settings-based limits injected at each call site (chosen):**
Add limit fields to `Settings` with the defaults above. Pass settings (or limit values) to the
relevant functions. Limits are configured once and can be overridden by env vars. The `ingest`
functions already receive a `project` argument; they can also receive limit kwargs (defaulting to
the settings values).

**Option C — Middleware-level request size limit:**
FastAPI / Starlette does not have a built-in request body size limit middleware. A custom ASGI
middleware can limit `content-length` or track streamed bytes. This solves only the upload case;
zip and image limits still need inline checks.

## Decision

**Option B** for all five sites, plus a `content-length` guard in the CDN PUT handler.

**Changes in `src/pd_prep_for_pgdp/settings.py`:**

Add limit fields with the defaults from the table above:

```python
max_cdn_upload_bytes: int = 300 * 1024 * 1024
max_source_zip_bytes: int = 2 * 1024 * 1024 * 1024
max_zip_entries: int = 2000
max_entry_uncompressed_bytes: int = 100 * 1024 * 1024
max_total_uncompressed_bytes: int = 5 * 1024 * 1024 * 1024
max_image_pixels: int = 200_000_000
```

**Changes in `src/pd_prep_for_pgdp/api/cdn.py` (upload body limit):**

Before `await request.body()`:

```python
content_length = request.headers.get("content-length")
if content_length is not None and int(content_length) > settings.max_cdn_upload_bytes:
    raise HTTPException(413, "upload too large")
body = await request.body()
if len(body) > settings.max_cdn_upload_bytes:
    raise HTTPException(413, "upload too large")
```

**Changes in `src/pd_prep_for_pgdp/core/ingest.py` (`_enumerate_zip`):**

After `raw = await storage.get_bytes(source_key)`:

```python
if len(raw) > limits.max_source_zip_bytes:
    raise ValueError(f"source zip exceeds limit ({len(raw)} > {limits.max_source_zip_bytes})")
```

Inside the `infolist()` loop:

```python
if len(zf.infolist()) > limits.max_zip_entries:
    raise ValueError(f"zip has too many entries ({len(zf.infolist())} > {limits.max_zip_entries})")
total_uncompressed = 0
for info in zf.infolist():
    if info.file_size > limits.max_entry_uncompressed_bytes:
        raise ValueError(f"zip entry too large: {info.filename}")
    total_uncompressed += info.file_size
    if total_uncompressed > limits.max_total_uncompressed_bytes:
        raise ValueError("zip total uncompressed size exceeds limit")
    ...
```

**Changes in `src/pd_prep_for_pgdp/core/ingest.py` (`_make_thumbnail_bytes`):**

Before `cv2.imdecode`:

```python
# Decode image header dimensions without full decode using imagesize or Pillow
from PIL import Image
import io
with Image.open(io.BytesIO(src)) as img_meta:
    w, h = img_meta.size
if w * h > limits.max_image_pixels:
    raise _CorruptImageError(f"image too large: {w}x{h} = {w*h} pixels")
```

Note: `Pillow` is already available as an optional dependency; confirm it is in the core
requirements before using it here. If not, use `imagesize` (lightweight header reader) instead.

The `limits` object is a dataclass or Settings subobject passed through the call stack.

## Implementation Plan

**Slice 1 — Settings limits + CDN upload guard (TDD):**

- `tests/test_cdn.py`: `PUT /cdn/…` with `content-length: 999999999` → 413.
- `tests/test_cdn.py`: `PUT /cdn/…` with 1-byte body → 204 (normal).
- Add limit fields to `Settings`. Add the guard in `cdn.py`.

**Slice 2 — Zip entry-count and decompressed-size limits:**

- `tests/test_ingest_zip_limits.py` (new): construct a zip with `MAX_ZIP_ENTRIES + 1` tiny
  entries → `ValueError` raised.
- `tests/test_ingest_zip_limits.py`: construct a zip with one entry reporting
  `file_size = MAX_ENTRY_UNCOMPRESSED_BYTES + 1` in the central directory → `ValueError` raised.
- `tests/test_ingest_zip_limits.py`: source zip bytes larger than `MAX_SOURCE_ZIP_BYTES` →
  `ValueError` raised.
- Implement all three checks in `_enumerate_zip`.

**Slice 3 — Image dimension limit in thumbnail decode:**

- `tests/test_ingest_thumbnail.py`: synthetic PNG with 10001×10001 header → `_CorruptImageError`.
- Implement the pre-decode dimension check in `_make_thumbnail_bytes`.

## Test Plan

**Failing tests (prove the bugs before fix):**

```python
# tests/test_ingest_zip_limits.py
def test_zip_bomb_entry_size_rejected(tmp_path):
    """A zip entry whose central-directory file_size exceeds the limit raises."""
    import zipfile, io, struct
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("page0001.png")
        info.file_size = 200 * 1024 * 1024  # 200 MB in header only
        zf.writestr(info, b"fake")  # actual data is tiny
    raw = buf.getvalue()
    # Before fix: _enumerate_zip reads the entry without checking file_size
    # After fix: raises ValueError
    with pytest.raises(ValueError, match="too large"):
        asyncio.run(_enumerate_zip_with_limits(raw, limits=test_limits))
```

**Regression:**

- Normal 10-page book zip (small images) extracts without error.
- CDN upload within limits returns 204.
- Thumbnail generation for normal-sized images returns JPEG bytes.

## Open Questions

1. **Pillow vs imagesize:** is `Pillow` already in the production dependencies? If yes, use
   `Image.open` for the pre-decode dimension check. If not, add `imagesize` (pure Python, ~2 kB)
   rather than adding a heavy dependency.

2. **Central-directory `file_size` vs actual decompressed size:** the `ZipInfo.file_size` field
   is the claimed uncompressed size from the central directory, which an attacker can lie about
   (underreport to bypass the check). A more robust check reads the decompressed stream in chunks
   with a byte counter. Is the header-based check sufficient for V1, with streaming decompression
   for V2?

3. **`extract_zip_image_thumbnail` re-reads the full zip on every preview request:** the image
   preview endpoint calls this for each tile in the source-preview strip. For a 500-page book,
   that is 500 zip open+read operations on the same file. Should this be cached (LRU by source
   key)? This is a performance issue more than a security issue, but it amplifies the impact of
   large zips. Defer to a follow-on or address in Slice 3?
