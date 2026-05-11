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

import asyncio
import io
import logging
import os
import re
import zipfile
from collections.abc import Awaitable, Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime

import anyio.to_thread

from ..adapters.database import IDatabase
from ..adapters.storage import IStorage
from .models import (
    PageRecord,
    PipelineState,
    Project,
    ProjectStatus,
    StepState,
    StepStatus,
)

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
) -> IngestResult:
    """Extract source files (or list a folder), create one PageRecord per image.

    Pages land with `page_type=normal`, no thumbnail, no auto-detection. A
    follow-up `generate_thumbnails` job creates the JPGs. Page ranges
    (`proof_start_idx0`, `proof_end_idx0`) on the project default to 0 and
    will be updated after the user clicks through the Configure page.
    """
    if source_type == "zip":
        entries = await _enumerate_zip(storage, source_key, project.id)
    else:
        entries = await _enumerate_folder(storage, source_key)

    total = len(entries)
    pages: list[PageRecord] = []
    for valid_idx0, entry in enumerate(entries):
        pages.append(
            PageRecord(
                project_id=project.id,
                idx0=valid_idx0,
                prefix="",
                source_stem=entry.stem,
                ignore=(
                    valid_idx0 < project.config.proof_start_idx0 or valid_idx0 > project.config.proof_end_idx0
                ),
                source_key=entry.key,
            )
        )
        if progress_cb is not None:
            try:
                await progress_cb(valid_idx0 + 1, total, entry.stem)
            except Exception:
                log.exception("unzip progress_cb raised; continuing")

    if pages:
        await database.put_pages(pages)

    project = project.model_copy(
        update={
            "page_count": len(pages),
            "proof_page_count": len(pages),
            # Stay in `ingesting` until thumbnails finish — the project page
            # decides what to render based on the active job, not status.
            "status": ProjectStatus.ingesting,
            "updated_at": datetime.now(UTC),
            "pipeline_state": _record_step(project.pipeline_state, step_id=0, errors=[]),
        }
    )
    await database.put_project(project)
    return IngestResult(page_count=len(pages), errors=[])


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
            log.warning("PGDP_THUMBNAIL_WORKERS=%r not an int; falling back to cpu_count", raw)
    return max(1, os.cpu_count() or 1)


async def generate_thumbnails(
    *,
    project: Project,
    storage: IStorage,
    database: IDatabase,
    progress_cb: ProgressCb | None = None,
    thumbnail_workers: int | None = None,
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
    pages_in, _, _ = await database.list_pages(project.id, None, 1_000_000)

    # Read source bytes for every page that still needs a thumbnail. We
    # gather all bytes first so the threadpool task only does CPU work.
    todo: list[tuple[int, str, bytes]] = []
    for page in pages_in:
        if page.thumbnail_key:
            continue
        if not page.source_key:
            continue
        try:
            data = await storage.get_bytes(page.source_key)
        except Exception as e:
            log.warning("thumbnail: source missing for %s: %s", page.source_stem, e)
            continue
        todo.append((page.idx0, page.source_stem, data))

    total = len(todo)
    if total == 0:
        await _mark_step_complete(project, database, step_id=2)
        return IngestResult(page_count=0, errors=[])

    workers = _resolve_thumbnail_workers(override=thumbnail_workers)

    # idx0 → JPEG bytes, populated as workers complete (pool path) or in
    # one batch on the worker thread (single-process path). Persist after
    # all results are in, in idx0 order, so the on-disk file order matches
    # source order regardless of completion order.
    jpgs_by_idx: dict[int, bytes] = {}
    errors: list[str] = []

    if workers <= 1:
        # ── Single-thread path ────────────────────────────────────────────
        # Used by the test suite (no env override) and by users who explicitly
        # opt out of the pool. Runs the whole batch on one worker thread so
        # cv2 stays warm — much faster than N round-trips when total is small.
        def _make_all() -> tuple[dict[int, bytes], list[str]]:
            results: dict[int, bytes] = {}
            errs: list[str] = []
            for idx0, stem, data in todo:
                _i, _s, jpg, err = thumbnail_for_page(idx0, stem, data)
                if err is not None:
                    errs.append(f"{_s}: {err}")
                    continue
                assert jpg is not None
                results[_i] = jpg
            return results, errs

        jpgs_by_idx, errors = await anyio.to_thread.run_sync(_make_all)

        # Persist in idx0 order; report progress per page after each write.
        pages_by_idx = {p.idx0: p for p in pages_in}
        updated: list[PageRecord] = []
        done = 0
        for idx0, stem, _data in todo:
            jpg = jpgs_by_idx.get(idx0)
            if jpg is None:
                continue
            done += 1
            thumb_key = f"projects/{project.id}/thumbnails/{stem}.jpg"
            await storage.put_bytes(thumb_key, jpg, "image/jpeg")
            page = pages_by_idx[idx0]
            updated.append(page.model_copy(update={"thumbnail_key": thumb_key}))
            if progress_cb is not None:
                try:
                    await progress_cb(done, total, stem)
                except Exception:
                    log.exception("thumbnails progress_cb raised; continuing")
    else:
        # ── ProcessPoolExecutor path ──────────────────────────────────────
        # CPU-bound JPEG encode is trivially data-parallel; one worker per
        # page, no shared state, results streamed back via the running
        # event loop's default executor + `loop.run_in_executor`. We persist
        # in idx0 order at the end so on-disk thumbnails line up with
        # source pages even if the pool returned futures out of order.
        loop = asyncio.get_running_loop()
        cap = min(workers, total)
        # Local alias so tests can `patch.object(ingest_mod, "ProcessPoolExecutor", ...)`
        # and have the production import path actually exercised.
        executor_cls = ProcessPoolExecutor
        with executor_cls(max_workers=cap) as pool:
            futures = [
                loop.run_in_executor(pool, thumbnail_for_page, idx0, stem, data) for idx0, stem, data in todo
            ]
            done = 0
            for fut in asyncio.as_completed(futures):
                r_idx0, r_stem, jpg, err = await fut
                done += 1
                if err is not None:
                    errors.append(f"{r_stem}: {err}")
                    if progress_cb is not None:
                        try:
                            await progress_cb(done, total, r_stem)
                        except Exception:
                            log.exception("thumbnails progress_cb raised; continuing")
                    continue
                assert jpg is not None
                jpgs_by_idx[r_idx0] = jpg
                if progress_cb is not None:
                    try:
                        await progress_cb(done, total, r_stem)
                    except Exception:
                        log.exception("thumbnails progress_cb raised; continuing")

        # Persist in idx0 order so output is deterministic regardless of
        # which worker finished first.
        pages_by_idx = {p.idx0: p for p in pages_in}
        updated = []
        for idx0, stem, _data in todo:
            jpg = jpgs_by_idx.get(idx0)
            if jpg is None:
                continue
            thumb_key = f"projects/{project.id}/thumbnails/{stem}.jpg"
            await storage.put_bytes(thumb_key, jpg, "image/jpeg")
            page = pages_by_idx[idx0]
            updated.append(page.model_copy(update={"thumbnail_key": thumb_key}))

    if updated:
        await database.put_pages(updated)

    # Once thumbnails finish the user can productively use the Configure page.
    project = project.model_copy(
        update={
            "status": ProjectStatus.configuring,
            "updated_at": datetime.now(UTC),
            "pipeline_state": _record_step(project.pipeline_state, step_id=2, errors=errors),
        }
    )
    await database.put_project(project)
    return IngestResult(page_count=len(updated), errors=errors)


# ─── enumerate sources ─────────────────────────────────────────────────────


@dataclass
class _SourceEntry:
    key: str
    stem: str
    bytes_: bytes


_VALID_NAME_RE = re.compile(r"[^\x00-\x1f\\/:\*\?\"<>\|]+")


async def _enumerate_zip(storage: IStorage, source_key: str, project_id: str) -> list[_SourceEntry]:
    raw = await storage.get_bytes(source_key)
    out: list[_SourceEntry] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename
            ext = _ext_lower(name)
            if ext not in _IMAGE_EXTS:
                continue
            data = zf.read(info)
            stem = _stem_from_zipname(name)
            target_key = f"projects/{project_id}/source/{stem}{ext}"
            await storage.put_bytes(target_key, data)
            out.append(_SourceEntry(key=target_key, stem=stem, bytes_=data))
    out.sort(key=lambda e: e.stem)
    return out


async def _enumerate_folder(storage: IStorage, prefix: str) -> list[_SourceEntry]:
    entries: list[_SourceEntry] = []
    async for obj in storage.list_prefix(prefix):
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
    if limit < 0:
        limit = 0
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
    """Last path segment without extension."""
    segment = name.replace("\\", "/").rsplit("/", 1)[-1]
    if "." in segment:
        segment = segment.rsplit(".", 1)[0]
    return segment


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


def _make_thumbnail_bytes(src: bytes) -> bytes:
    """Decode `src`, resize to fit `THUMBNAIL_MAX_DIM`, encode back to JPG."""
    import numpy as np  # type: ignore[import-not-found]

    try:
        import cv2  # type: ignore[import-not-found]
    except ImportError as e:
        raise RuntimeError("cv2 required for thumbnail generation") from e

    arr = np.frombuffer(src, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise _CorruptImageError("cv2.imdecode returned None")

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


# ─── pipeline-state bookkeeping ────────────────────────────────────────────


def _record_step(state: PipelineState, *, step_id: int, errors: list[str]) -> PipelineState:
    new_steps = dict(state.steps)
    new_steps[step_id] = StepState(
        status=StepStatus.error if errors else StepStatus.complete,
        completed_at=datetime.now(UTC),
    )
    return PipelineState(steps=new_steps)


async def _mark_step_complete(project: Project, database: IDatabase, *, step_id: int) -> None:
    project = project.model_copy(
        update={
            "pipeline_state": _record_step(project.pipeline_state, step_id=step_id, errors=[]),
            "updated_at": datetime.now(UTC),
        }
    )
    await database.put_project(project)
