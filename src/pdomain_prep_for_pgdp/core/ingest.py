"""Step 0/1/2 — ingest split into two stages: unzip then thumbnails.

`unzip_source(...)` (Step 0): pulls the zip / lists the storage prefix,
writes raw source files into `projects/<id>/source/<stem>.<ext>`, and
creates one PageRecord per source image with no thumbnail and no
auto-detection. Pages start with `page_type=normal` so the user picks
their own typing later.

`generate_thumbnails(...)` (Step 2): walks every page that doesn't yet
have a `thumbnail_key`, decodes + resizes + encodes each one, writes the
JPGs to `projects/<id>/thumbnails/<stem>.jpg`, and updates the page rows.
The whole batch runs inside ONE `anyio.to_thread.run_sync` dispatch so
cv2 stays warm and the per-page overhead stays low.

Both functions are async because storage is async; image work happens on
a worker thread.
"""

from __future__ import annotations

import inspect
import io
import logging
import os
import re
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, cast

from .models import (
    Project,
    ProjectStatus,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from pdomain_prep_for_pgdp.adapters.database import IDatabase
    from pdomain_prep_for_pgdp.adapters.storage import IStorage, ObjectInfo
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService

log = logging.getLogger(__name__)

# Source file types we recognise as page images.
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".jp2", ".tif", ".tiff")
THUMBNAIL_MAX_DIM = 400
THUMBNAIL_QUALITY = 85


@dataclass
class IngestResult:
    page_count: int
    errors: list[str] = field(default_factory=list)


ProgressCb = Callable[[int, int, str], Awaitable[None]]


# ─── Step 0: unzip / enumerate ─────────────────────────────────────────────


async def unzip_source(
    *,
    project: Project,
    source_type: str,
    source_key: str,
    storage: IStorage,
    database: IDatabase,
    progress_cb: ProgressCb | None = None,
    zip_limits: _ZipLimitsProto | None = None,
    page_service: PageService,
) -> IngestResult:
    """Extract source files (or list a folder), create one PageRecord per image.

    Pages land with `page_type=normal`, `ignore=False`, no thumbnail, no
    auto-detection. A follow-up `generate_thumbnails` job creates the JPGs and
    seeds a default numbering run (P1.9 — page ranges were removed; numbering
    lives in the NumberingRun runs model).

    ``zip_limits`` is forwarded to ``_check_zip_limits`` when extracting a
    zip source. When ``None``, limits are read from env vars via a fresh
    ``Settings()`` instance.
    """
    if source_type == "zip":
        entries = await _enumerate_zip(storage, source_key, project.id, limits=zip_limits)
    else:
        entries = await _enumerate_folder(storage, source_key)

    total = len(entries)
    _unzip_cb_failures = 0
    _progress_cb_max_failures = 3

    # Pages live in the event store only.
    import uuid as _uuid

    from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
    from pdomain_ops.pages import (
        PageRecord as OpsPageRecord,
    )
    from pdomain_ops.pages import (
        ProjectRecord,
        set_extension,
    )

    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    def _to_uuid(s: str) -> _uuid.UUID:
        try:
            return _uuid.UUID(s)
        except (ValueError, AttributeError):
            return _uuid.uuid5(_uuid.NAMESPACE_OID, s)

    project_uuid = _to_uuid(project.id)
    proj_record = ProjectRecord(project_id=project_uuid, name=project.config.book_name)
    proj_agg = ProjectAggregate(record=proj_record)

    for valid_idx0, entry in enumerate(entries):
        page_id = _uuid.uuid4()
        ops_record = OpsPageRecord(
            page_id=page_id,
            page_index=valid_idx0,
            source="raw",
        )
        source_hash = page_service.blobs.write(entry.bytes_)
        ext = PrepPageExtension(
            project_id=project.id,
            idx0=valid_idx0,
            prefix="",
            source_stem=entry.stem,
            # P1.9: proof ranges deleted from ProjectConfig.  All ingested pages
            # start in-proof (ignore=False); the user excludes pages via the
            # Source tool (page_role back/duplicate -> page_type=skip) instead.
            ignore=False,
            source_blob_hash=source_hash,
        )
        set_extension(ops_record, "prep", ext)
        page_agg = PageAggregate(record=ops_record)
        page_service.store.save_page(page_agg)
        proj_agg.add_page(page_id=page_id, page_index=valid_idx0)

        if progress_cb is not None:
            try:
                await progress_cb(valid_idx0 + 1, total, entry.stem)
                _unzip_cb_failures = 0
            except Exception:
                _unzip_cb_failures += 1
                if _unzip_cb_failures >= _progress_cb_max_failures:
                    log.error(
                        "progress_cb failed %d times consecutively; disabling for this job",
                        _unzip_cb_failures,
                    )
                    progress_cb = None
                else:
                    log.exception(
                        "unzip progress_cb raised (failure %d/%d)",
                        _unzip_cb_failures,
                        _progress_cb_max_failures,
                    )

    page_service.store.save_project(proj_agg)
    project = project.model_copy(
        update={
            "page_count": total,
            "proof_page_count": total,
            "status": ProjectStatus.ingesting,
            "updated_at": datetime.now(UTC),
        }
    )
    await database.put_project(project)
    return IngestResult(page_count=total, errors=[])


# ─── Step 2: thumbnails (batched in one threadpool call) ───────────────────


def _resolve_thumbnail_workers(*, override: int | None) -> int:
    """Decide how many worker processes to spawn for thumbnail generation.

    Resolution order: explicit ``override`` arg → ``PGDP_THUMBNAIL_WORKERS``
    env var (read directly here so the function stays pure / non-importing
    of pydantic-settings on the hot path) → ``os.cpu_count()``. Values
    below 1 clamp to 1 — the pool path is opt-out by setting workers to 1
    rather than 0/negative, so the meaning is always "how many workers,
    minimum one".
    """
    if override is not None:
        return max(1, int(override))
    raw = os.environ.get("PGDP_THUMBNAIL_WORKERS")
    if raw is not None and raw.strip():
        try:
            return max(1, int(raw))
        except ValueError:
            log.error(
                (
                    "PGDP_THUMBNAIL_WORKERS=%r is not a valid integer; using cpu_count. "
                    "Set a valid integer to silence this."
                ),
                raw,
            )
    return max(1, os.cpu_count() or 1)


async def generate_thumbnails(
    *,
    project: Project,
    storage: IStorage,
    database: IDatabase,
    progress_cb: ProgressCb | None = None,
    thumbnail_workers: int | None = None,
    page_service: PageService,
    data_root: os.PathLike[str] | None = None,
) -> IngestResult:
    """Walk every page without a thumbnail, generate + persist JPGs in batch.

    Reads source bytes once per page (skipping pages that already have a
    thumbnail), then either runs the per-page work on a single worker
    thread (``thumbnail_workers=1``, the test-suite default) or dispatches
    across a ``ProcessPoolExecutor`` (``thumbnail_workers>=2``). JPEG
    decode/resize/encode is CPU-bound and trivially data-parallel, so the
    pool path scales near-linearly with cores on a real book; the
    single-thread path keeps test runs cheap and avoids a fork on tiny
    inputs.

    Worker count is resolved by ``_resolve_thumbnail_workers`` —
    ``thumbnail_workers`` arg → ``PGDP_THUMBNAIL_WORKERS`` env →
    ``os.cpu_count()``. Pass ``thumbnail_workers=1`` to disable the pool.
    """
    # Pages live in the event store only.
    import uuid as _uuid

    from pdomain_ops.pages import ProvenanceNode, get_extension

    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    def _to_uuid_thumb(s: str) -> _uuid.UUID:
        try:
            return _uuid.UUID(s)
        except (ValueError, AttributeError):
            return _uuid.uuid5(_uuid.NAMESPACE_OID, s)

    project_uuid = _to_uuid_thumb(project.id)
    try:
        proj_agg = page_service.store.get_project(project_uuid)
    except Exception:
        # No pages in event store — advance project and mark source clean.
        project = project.model_copy(
            update={
                "status": ProjectStatus.configuring,
                "updated_at": datetime.now(UTC),
            }
        )
        await database.put_project(project)
        _write_source_stage(project.id, page_count=0, data_root=data_root)
        return IngestResult(page_count=0, errors=[])

    todo_evt: list[tuple[_uuid.UUID, str, bytes]] = []
    errors_evt: list[str] = []
    for page_id in proj_agg.record.page_ids:
        try:
            page_agg = page_service.store.get_page(page_id)
        except Exception:
            log.warning("generate_thumbnails: could not load page %s", page_id)
            continue
        ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        if ext is None or ext.thumbnail_blob_hash is not None:
            continue
        if ext.source_blob_hash is None:
            continue
        try:
            source_bytes = page_service.blobs.read(ext.source_blob_hash)
        except Exception as e:
            log.warning("generate_thumbnails: blob read failed for %s: %s", ext.source_stem, e)
            errors_evt.append(f"{ext.source_stem}: blob read error: {e!r}")
            continue
        todo_evt.append((page_id, ext.source_stem, source_bytes))

    total_evt = len(todo_evt)
    if total_evt == 0:
        project = project.model_copy(
            update={
                "status": ProjectStatus.configuring,
                "updated_at": datetime.now(UTC),
            }
        )
        await database.put_project(project)
        _write_source_stage(project.id, page_count=0, data_root=data_root)
        return IngestResult(page_count=0, errors=errors_evt)

    updated_count = 0
    for page_id, stem, source_bytes in todo_evt:
        try:
            thumb_bytes = _make_thumbnail_bytes(source_bytes)
        except _CorruptImageError as e:
            errors_evt.append(f"{stem}: {e!r}")
            continue
        thumb_hash = page_service.blobs.write(thumb_bytes)

        # Reload page aggregate, attach provenance node, update extension
        page_agg = page_service.store.get_page(page_id)
        node = ProvenanceNode(
            id=f"thumbnail:{page_id}",
            source="thumbnail",
            tool="prep-for-pgdp",
            blob_refs=[thumb_hash],
        )
        page_agg.preprocess(provenance_node=node, blob_refs=[thumb_hash])

        # Persist thumbnail_blob_hash via event-backed set_extension so it
        # survives reload/replay (ops 0.7.1+: fires ExtensionSet event).
        # Re-fetch ext from the reloaded aggregate (it may have changed).
        current_ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        if current_ext is not None:
            updated_ext_data = current_ext.model_copy(update={"thumbnail_blob_hash": thumb_hash})
            page_agg.set_extension("prep", updated_ext_data)
        page_service.store.save_page(page_agg)
        updated_count += 1

    # Seed a default numbering run so the new project is numbered out of the
    # box (P1.9 — replaces the old default front/body ranges).  Needs a
    # concrete data_root to reach the runs store + page extensions.
    if data_root is not None:
        from pathlib import Path as _Path

        from pdomain_prep_for_pgdp.core.numbering_migration import seed_default_runs

        try:
            seed_default_runs(_Path(data_root), project.id)
        except Exception as _e_seed:  # pragma: no cover - non-fatal
            log.warning("seed_default_runs failed (non-fatal): %s", _e_seed)

    # Advance project to configuring — thumbnails are done.
    project = project.model_copy(
        update={
            "status": ProjectStatus.configuring,
            "updated_at": datetime.now(UTC),
        }
    )
    await database.put_project(project)
    # Dual-write: artifact + project_stages DB row for the 'source' stage.
    # The source stage represents "pages ingested + thumbnails generated".
    _write_source_stage(project.id, page_count=updated_count, data_root=data_root)
    return IngestResult(page_count=updated_count, errors=errors_evt)


# ─── enumerate sources ─────────────────────────────────────────────────────


@dataclass
class _SourceEntry:
    key: str
    stem: str
    bytes_: bytes


_VALID_NAME_RE = re.compile(r"[^\x00-\x1f\\/:\*\?\"<>\|]+")


class _ZipLimitsProto(Protocol):
    """Structural Protocol for zip resource limits.

    Any object with these four ``int`` attributes satisfies the contract —
    both ``Settings`` and the test-local ``_ZipLimits`` dataclass qualify.
    """

    max_source_zip_bytes: int
    max_zip_entries: int
    max_entry_uncompressed_bytes: int
    max_total_uncompressed_bytes: int


def _check_zip_limits(raw: bytes, limits: _ZipLimitsProto) -> None:
    """Validate a source-zip byte buffer against resource limits.

    Raises ``ValueError`` if any limit is exceeded:

    - Source zip size (``max_source_zip_bytes``): checked before opening
      the zip to catch large payloads early.
    - Entry count (``max_zip_entries``): checked against the central
      directory; no entry payload is decompressed.
    - Per-entry uncompressed size (``max_entry_uncompressed_bytes``):
      checked against ``ZipInfo.file_size`` from the central directory.
      Note: this is the *claimed* size; an attacker can underreport.
      Streaming decompression with a byte counter is the V2 hardening.
    - Total uncompressed size (``max_total_uncompressed_bytes``):
      running sum of ``ZipInfo.file_size`` for all entries.

    This function reads only the zip central directory — no entry payload
    is decompressed.  Call it before any ``zf.read(info)`` operations.
    """
    if len(raw) > limits.max_source_zip_bytes:
        raise ValueError(f"source zip exceeds limit ({len(raw)} > {limits.max_source_zip_bytes} bytes)")
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        infos = zf.infolist()
        if len(infos) > limits.max_zip_entries:
            raise ValueError(f"zip has too many entries ({len(infos)} > {limits.max_zip_entries})")
        total_uncompressed = 0
        for info in infos:
            if info.file_size > limits.max_entry_uncompressed_bytes:
                raise ValueError(
                    f"zip entry too large: {info.filename!r} claims "
                    f"{info.file_size} uncompressed bytes "
                    f"(limit {limits.max_entry_uncompressed_bytes})"
                )
            total_uncompressed += info.file_size
            if total_uncompressed > limits.max_total_uncompressed_bytes:
                raise ValueError(
                    f"zip total uncompressed size exceeds limit "
                    f"({total_uncompressed} > {limits.max_total_uncompressed_bytes} bytes)"
                )


async def _enumerate_zip(
    storage: IStorage,
    source_key: str,
    project_id: str,
    limits: _ZipLimitsProto | None = None,
) -> list[_SourceEntry]:
    raw = await storage.get_bytes(source_key)
    resolved: _ZipLimitsProto
    if limits is None:
        # Construct limits from env vars at call time so PGDP_MAX_* overrides
        # apply even when the caller doesn't thread settings through explicitly.
        from pdomain_prep_for_pgdp.settings import Settings  # late import avoids circularity

        resolved = Settings()
    else:
        resolved = limits
    _check_zip_limits(raw, resolved)
    out: list[_SourceEntry] = []
    # Track stems that have already been assigned to detect sanitisation
    # collisions (e.g. ``a/img.jpg`` and ``a__img.jpg`` both map to
    # ``a__img``).  The happy path — two entries in different subdirs with
    # the same basename — is handled by ``_stem_from_zip_path`` producing
    # distinct stems (``001__img`` vs ``002__img``).  The collision counter
    # is only reached in the pathological case where the sanitised stems
    # themselves clash.
    seen_stems: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename
            ext = _ext_lower(name)
            if ext not in _IMAGE_EXTS:
                continue
            data = zf.read(info)
            stem = _stem_from_zip_path(name)
            # Resolve sanitisation collisions with a deterministic counter
            # suffix so no entry is silently overwritten.
            if stem in seen_stems:
                counter = 2
                candidate = f"{stem}_{counter}"
                while candidate in seen_stems:
                    counter += 1
                    candidate = f"{stem}_{counter}"
                log.warning(
                    "ZIP stem collision: %r already used; remapping %r → %r",
                    stem,
                    name,
                    candidate,
                )
                stem = candidate
            seen_stems.add(stem)
            target_key = f"projects/{project_id}/source/{stem}{ext}"
            await storage.put_bytes(target_key, data)
            out.append(_SourceEntry(key=target_key, stem=stem, bytes_=data))
    out.sort(key=lambda e: e.stem)
    return out


async def _enumerate_folder(storage: IStorage, prefix: str) -> list[_SourceEntry]:
    entries: list[_SourceEntry] = []
    listing = storage.list_prefix(prefix)
    if inspect.isawaitable(listing):
        listing = await listing
    listing = cast("AsyncIterator[ObjectInfo]", listing)
    async for obj in listing:
        ext = _ext_lower(obj.key)
        if ext not in _IMAGE_EXTS:
            continue
        stem = _stem_from_zipname(obj.key)
        data = await storage.get_bytes(obj.key)
        entries.append(_SourceEntry(key=obj.key, stem=stem, bytes_=data))
    entries.sort(key=lambda e: e.stem)
    return entries


def peek_zip_image_names(raw: bytes, limit: int) -> tuple[list[str], int]:
    """Inspect a zip's central directory and return image filenames.

    Used by the source-preview endpoint (P2 #8) to render a thumbnail strip
    before ingest runs, so a user with the wrong zip catches the mistake
    early. Pure: no storage, no decoding, no thumbnail generation. Reads
    only the central directory — no per-entry payload is decompressed.

    Returns
    -------
    (names, total_image_count)
        ``names`` is the first ``limit`` image filenames sorted by name (so
        the preview order matches the eventual ingest enumeration).
        ``total_image_count`` is the count of all image entries in the zip,
        useful for showing "showing 5 of 12".
    """
    limit = max(limit, 0)
    image_names: list[str] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            if _ext_lower(info.filename) not in _IMAGE_EXTS:
                continue
            image_names.append(info.filename)
    image_names.sort()
    return image_names[:limit], len(image_names)


class ZipImageEntryNotFound(LookupError):  # noqa: N818  # intentional: not an Error, maps to HTTP 404
    """Raised when the requested filename is not an image entry in the zip.

    Distinct from a generic ``KeyError`` so callers can map to HTTP 404
    without confusing it with database lookup failures. The route layer
    converts this into a 404 response.
    """


def extract_zip_image_thumbnail(raw: bytes, filename: str) -> bytes:
    """Return JPEG thumbnail bytes for a single image entry inside ``raw``.

    Used by the source-preview thumbnail endpoint (P2 #8 slice 3) to render
    one tile of the SPA preview strip. Pure: takes the zip bytes + entry
    name, returns JPEG bytes.

    Refuses to thumbnail non-image entries even if they exist in the zip
    — the caller should never request one (the slice-2 list route filters
    them out), but a hand-rolled request for ``notes.txt`` should look like
    "not found" rather than 500. Both branches raise ``ZipImageEntryNotFound``
    so the route layer maps them to a single 404.

    Decode errors on a corrupt-but-named entry surface as ``_CorruptImageError``
    from ``_make_thumbnail_bytes`` — the route layer treats those as 404 too,
    on the principle that we don't owe the caller a distinction between
    "no such image" and "image bytes are unreadable".
    """
    if _ext_lower(filename) not in _IMAGE_EXTS:
        raise ZipImageEntryNotFound(filename)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        try:
            data = zf.read(filename)
        except KeyError as e:
            raise ZipImageEntryNotFound(filename) from e
    return _make_thumbnail_bytes(data)


def _ext_lower(name: str) -> str:
    if "." not in name:
        return ""
    return "." + name.rsplit(".", 1)[1].lower()


def _stem_from_zipname(name: str) -> str:
    """Last path segment without extension.

    Used for folder entries where the storage key is already unique (the full
    object key acts as the source of truth).  For ZIP entries use
    ``_stem_from_zip_path`` instead, which preserves directory components so
    that two files with the same basename in different subdirs produce distinct
    stems.
    """
    segment = name.replace("\\", "/").rsplit("/", 1)[-1]
    if "." in segment:
        segment = segment.rsplit(".", 1)[0]
    return segment


def _stem_from_zip_path(name: str) -> str:
    """Full relative ZIP path converted to a flat, safe stem.

    Replaces the path separator (``/``) with a double-underscore (``__``) so
    that ``001/img.jpg`` and ``002/img.jpg`` produce distinct stems
    (``001__img`` and ``002__img``) rather than both collapsing to ``img``.

    Backslashes are normalised to forward slashes first (Windows-created ZIPs
    sometimes use them).  The final component's extension is stripped.

    Examples
    --------
    >>> _stem_from_zip_path("page0001.png")
    'page0001'
    >>> _stem_from_zip_path("imgs/page0001.png")
    'imgs__page0001'
    >>> _stem_from_zip_path("vol1/ch2/page0001.jpg")
    'vol1__ch2__page0001'
    """
    normalised = name.replace("\\", "/")
    # Strip the extension from the last component only.
    if "." in normalised.rsplit("/", 1)[-1]:
        normalised = normalised.rsplit(".", 1)[0]
    # Flatten the path hierarchy with a safe double-underscore separator.
    return normalised.replace("/", "__")


# ─── thumbnail (in-memory bytes -> bytes) ──────────────────────────────────


class _CorruptImageError(ValueError):
    """Raised when cv2 cannot decode the source bytes."""


def thumbnail_for_page(idx0: int, stem: str, src: bytes) -> tuple[int, str, bytes | None, str | None]:
    """Pool-friendly per-page thumbnail worker.

    Top-level module function (not a closure, not a method) with all-picklable
    args + return so it can be dispatched to a `concurrent.futures.ProcessPoolExecutor`
    without surprises. No shared state, no storage handles — the parent
    process owns I/O bookkeeping and is responsible for persisting the
    returned JPEG bytes under the project's thumbnails prefix.

    Returns
    -------
    (idx0, stem, jpg_bytes, error_message)
        On success ``error_message is None`` and ``jpg_bytes`` is set.
        On a corrupt-image failure ``jpg_bytes is None`` and
        ``error_message`` carries the cv2 reason. Errors are returned —
        not raised — so a single bad page in a pool batch doesn't kill
        the rest of the work; the orchestrator decides how to surface
        per-page failures.
    """
    try:
        jpg = _make_thumbnail_bytes(src)
    except _CorruptImageError as e:
        return idx0, stem, None, str(e)
    return idx0, stem, jpg, None


def _make_thumbnail_bytes(src: bytes, max_image_pixels: int | None = None) -> bytes:
    """Decode ``src``, resize to fit ``THUMBNAIL_MAX_DIM``, encode back to JPG.

    ``max_image_pixels`` caps the pixel count (width * height) read from the
    image header via Pillow *before* cv2.imdecode is called. This prevents a
    maliciously crafted image with huge advertised dimensions from causing
    cv2 to allocate gigabytes of RAM. When ``None``, the limit is read from
    the ``PGDP_MAX_IMAGE_PIXELS`` env var via a fresh ``Settings()`` instance.

    Raises ``_CorruptImageError`` if the image header cannot be parsed or the
    pixel count exceeds the limit.
    """
    import io as _io

    import numpy as np  # pyright: ignore[reportMissingImports]

    if max_image_pixels is None:
        from pdomain_prep_for_pgdp.settings import Settings

        max_image_pixels = Settings().max_image_pixels

    # Pre-decode dimension check via Pillow header read — no pixels decoded.
    try:
        import warnings as _warnings

        from PIL import Image

        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore")  # suppress PIL DecompressionBombWarning
            with Image.open(_io.BytesIO(src)) as img_meta:
                w, h = img_meta.size
        if w * h > max_image_pixels:
            raise _CorruptImageError(f"image too large: {w}x{h} = {w * h} pixels (limit {max_image_pixels})")
    except _CorruptImageError:
        raise
    except Exception as e:
        raise _CorruptImageError(f"cannot read image header: {e}") from e

    try:
        import cv2  # pyright: ignore[reportMissingImports]
    except ImportError as e:
        raise RuntimeError("cv2 required for thumbnail generation") from e

    arr = np.frombuffer(src, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise _CorruptImageError("cv2.imdecode returned None")

    h: int
    w: int
    h, w = img.shape[:2]
    short = min(h, w)
    if short > THUMBNAIL_MAX_DIM:
        scale = THUMBNAIL_MAX_DIM / short
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), THUMBNAIL_QUALITY])
    if not ok:
        raise _CorruptImageError("cv2.imencode failed")
    return bytes(buf.tobytes())


# ─── v2 source stage bookkeeping ───────────────────────────────────────────


def _write_source_stage(project_id: str, *, page_count: int, data_root: os.PathLike[str] | None) -> None:
    """Dual-write the v2 'source' project-stage: artifact + DB row.

    Called at the end of ``generate_thumbnails`` to mark the source stage
    clean once ingestion (unzip + thumbnails) is complete.

    ``data_root`` may be ``None`` in contexts where the caller does not have
    access to the filesystem path (e.g. test fixtures that only exercise the
    DB path). When ``None``, only the DB row write is skipped — the artifact
    write requires a concrete path, so neither write happens. This is safe:
    ``pgdp-prep reindex`` will recover the row from the on-disk artifact on
    the next reconciliation pass.
    """
    import json as _json
    from pathlib import Path as _Path
    from time import time as _time

    if data_root is None:
        return

    data_root_path = _Path(data_root)
    artifact_dir = data_root_path / "projects" / project_id / "stages" / "source"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / "output.json"
    artifact_payload = {"page_count": page_count, "stage": "source"}
    artifact_path.write_text(_json.dumps(artifact_payload))

    artifact_key = f"projects/{project_id}/stages/source/output.json"

    from pdomain_prep_for_pgdp.core.models import ProjectStageState, ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    db_path = data_root_path / "projects" / project_id / "project_stages.db"
    store = ProjectStageStore(db_path)
    store.write(
        ProjectStageState(
            project_id=project_id,
            stage_id="source",
            status=ProjectStageStatus.clean,
            artifact_key=artifact_key,
            last_run_at=_time(),
        )
    )
