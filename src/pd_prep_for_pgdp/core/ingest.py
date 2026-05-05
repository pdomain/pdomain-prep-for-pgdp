"""Step 0/1/2 — ingest, JP2->JPG (when needed), thumbnails.

Driven by `IStorage` so the same path works for filesystem and S3 backends.
The function is async because storage is async; image work happens on a
worker thread via anyio.
"""

from __future__ import annotations

import io
import logging
import re
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import anyio.to_thread

from ..adapters.database import IDatabase
from ..adapters.storage import IStorage
from .auto_detect import detect_page_attributes, median_aspect_ratio
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


async def ingest_source(
    *,
    project: Project,
    source_type: str,
    source_key: str,
    storage: IStorage,
    database: IDatabase,
    auto_detect: bool = True,
    layout_detector: Any | None = None,
    layout_confidence: float = 0.5,
    progress_cb: Any | None = None,
) -> IngestResult:
    """Run Step 0/1/2: extract / list source images, write per-page records and thumbnails.

    `source_type`:
      - `"zip"`: `source_key` points at an uploaded zip; extract entries to
        `projects/<id>/source/`.
      - `"local_folder"` / `"s3_folder"`: `source_key` is a storage prefix
        already containing source images; just list it.

    Page idx0 is assigned in lexicographic source-filename order.

    `auto_detect=True` (default) applies spec-01 §"Auto-detection" suggestions
    to each page (`page_type`, `alignment`) and seeds the project's median
    aspect ratio into `default_overrides["page_h_w_ratio"]`.

    When `layout_detector` is provided, it's run on each source image (per
    spec 05); detected illustration / decoration / table regions above
    `layout_confidence` land on `PageRecord.illustration_regions`.
    """
    if source_type == "zip":
        entries = await _enumerate_zip(storage, source_key, project.id)
    else:
        entries = await _enumerate_folder(storage, source_key)

    pages, errors = await _build_page_records(
        project,
        entries,
        storage,
        auto_detect=auto_detect,
        layout_detector=layout_detector,
        layout_confidence=layout_confidence,
        progress_cb=progress_cb,
    )

    if pages:
        await database.put_pages(pages)

    config_update = project.config.model_dump()
    if auto_detect and entries:
        median_ratio = await anyio.to_thread.run_sync(
            median_aspect_ratio, [e.bytes_ for e in entries]
        )
        new_overrides = dict(project.config.default_overrides)
        new_overrides["page_h_w_ratio"] = float(median_ratio)
        config_update["default_overrides"] = new_overrides

    project = project.model_copy(
        update={
            "page_count": len(pages),
            "proof_page_count": len(pages),
            "status": ProjectStatus.configuring if pages else ProjectStatus.ingesting,
            "updated_at": datetime.now(UTC),
            "pipeline_state": _record_step(project.pipeline_state, step_id=0, errors=errors),
            "config": project.config.model_validate(config_update),
        }
    )
    await database.put_project(project)

    return IngestResult(page_count=len(pages), errors=errors)


# ─── enumerate sources ─────────────────────────────────────────────────────


@dataclass
class _SourceEntry:
    key: str
    stem: str
    bytes_: bytes


_VALID_NAME_RE = re.compile(r"[^\x00-\x1f\\/:\*\?\"<>\|]+")


async def _enumerate_zip(
    storage: IStorage, source_key: str, project_id: str
) -> list[_SourceEntry]:
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


async def _enumerate_folder(
    storage: IStorage, prefix: str
) -> list[_SourceEntry]:
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


# ─── page records + thumbnails ─────────────────────────────────────────────


async def _build_page_records(
    project: Project,
    entries: list[_SourceEntry],
    storage: IStorage,
    *,
    auto_detect: bool = True,
    layout_detector: Any | None = None,
    layout_confidence: float = 0.5,
    progress_cb: Any | None = None,
) -> tuple[list[PageRecord], list[str]]:
    from .illustrations import auto_detect_illustrations

    pages: list[PageRecord] = []
    errors: list[str] = []
    valid_idx0 = 0
    total = len(entries)
    processed = 0
    for entry in entries:
        try:
            thumb_bytes = await anyio.to_thread.run_sync(
                _make_thumbnail_bytes, entry.bytes_
            )
        except _CorruptImageError as e:
            errors.append(f"{entry.stem}: {e}")
            continue

        thumb_key = f"projects/{project.id}/thumbnails/{entry.stem}.jpg"
        await storage.put_bytes(thumb_key, thumb_bytes, "image/jpeg")

        page_type = None
        alignment = None
        if auto_detect:
            suggestion = await anyio.to_thread.run_sync(
                detect_page_attributes, entry.bytes_
            )
            page_type = suggestion.suggested_type
            alignment = suggestion.suggested_alignment

        # Layout detector — operates on the raw source bytes via a temp file
        # because pd_book_tools' detector takes a path. Cheap relative to the
        # detector's inference cost.
        regions: list[Any] = []
        if layout_detector is not None:
            with tempfile.NamedTemporaryFile(
                suffix=Path(entry.key).suffix or ".png", delete=False
            ) as tmp:
                tmp.write(entry.bytes_)
                tmp_path = Path(tmp.name)
            try:
                regions = await anyio.to_thread.run_sync(
                    # Bind tmp_path explicitly so the closure captures the
                    # current iteration's path, not the loop variable.
                    lambda lp=tmp_path, det=layout_detector, conf=layout_confidence: (
                        auto_detect_illustrations(
                            lp, layout_detector=det, confidence_threshold=conf
                        )
                    )
                )
            except Exception as e:  # detector failures shouldn't abort ingest
                log.warning("layout detector failed on %s: %s", entry.stem, e)
            finally:
                tmp_path.unlink(missing_ok=True)

        page_kwargs = {
            "project_id": project.id,
            "idx0": valid_idx0,
            "prefix": "",
            "source_stem": entry.stem,
            "ignore": (
                valid_idx0 < project.config.proof_start_idx0
                or valid_idx0 > project.config.proof_end_idx0
            ),
            "source_key": entry.key,
            "thumbnail_key": thumb_key,
            "illustration_regions": regions,
        }
        if page_type is not None:
            page_kwargs["page_type"] = page_type
        if alignment is not None:
            page_kwargs["alignment"] = alignment
        pages.append(PageRecord(**page_kwargs))
        valid_idx0 += 1
        processed += 1
        if progress_cb is not None:
            try:
                await progress_cb(processed, total, entry.stem)
            except Exception:
                # Progress reporting failures should never abort ingest.
                log.exception("ingest progress_cb raised; continuing")
    return pages, errors


# ─── thumbnail (in-memory bytes -> bytes) ──────────────────────────────────


class _CorruptImageError(ValueError):
    """Raised when cv2 cannot decode the source bytes."""


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
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), THUMBNAIL_QUALITY])
    if not ok:
        raise _CorruptImageError("cv2.imencode failed")
    return bytes(buf.tobytes())


# ─── pipeline state bookkeeping ────────────────────────────────────────────


def _record_step(
    state: PipelineState, *, step_id: int, errors: list[str]
) -> PipelineState:
    new_steps = dict(state.steps)
    new_steps[step_id] = StepState(
        status=StepStatus.error if errors else StepStatus.complete,
        completed_at=datetime.now(UTC),
    )
    return PipelineState(steps=new_steps)
