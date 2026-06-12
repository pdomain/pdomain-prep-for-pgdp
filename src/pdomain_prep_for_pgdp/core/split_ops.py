"""Pure event-store split + unsplit operations for prep pages.

Decoupled from the API layer so tests can call them directly.
"""

from __future__ import annotations

import logging
import uuid as _uuid
from typing import TYPE_CHECKING

from pdomain_ops.page_aggregate import PageAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import get_extension, set_extension

from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService

log = logging.getLogger(__name__)


def _to_uuid(s: str) -> _uuid.UUID:
    """Convert a string to UUID, falling back to MD5 for non-UUID strings."""
    try:
        return _uuid.UUID(s)
    except (ValueError, AttributeError):
        return _uuid.uuid5(_uuid.NAMESPACE_OID, s)


def _crop_source_blob(
    *,
    service: PageService,
    parent_source_blob_hash: str,
    bbox: tuple[int, int, int, int],
) -> str:
    """Crop the parent's source image to ``bbox`` and write the result as a new blob.

    Reads the parent's source bytes from the BlobStore, decodes to an ndarray,
    crops to ``bbox`` (``(x, y, w, h)`` in parent source-image coords), re-encodes
    to PNG, and writes the cropped bytes back to the BlobStore. Returns the new
    blob hash (the CHILD's own ``source_blob_hash``).

    This mirrors how ``ingest.unzip_source`` records a normal page's
    ``source_blob_hash`` via ``page_service.blobs.write(...)`` — only here the
    bytes are the cropped parent region rather than a verbatim source file. The
    v2 ``grayscale`` root stage then reads the child's own ``source_blob_hash``
    with no per-stage child special-case (option B: crop at split time).

    The bbox is clamped to the parent image bounds so an out-of-range split
    region produces the in-bounds intersection rather than an empty / error
    crop.
    """
    import cv2  # pyright: ignore[reportMissingImports]
    import numpy as np  # pyright: ignore[reportMissingImports]

    src_bytes = service.blobs.read(parent_source_blob_hash)
    arr = np.frombuffer(src_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("split crop: cv2.imdecode returned None for parent source blob")

    h_img, w_img = img.shape[:2]
    x, y, w, h = bbox
    x0 = max(0, min(x, w_img))
    y0 = max(0, min(y, h_img))
    x1 = max(x0, min(x + w, w_img))
    y1 = max(y0, min(y + h, h_img))
    cropped = img[y0:y1, x0:x1]

    ok, buf = cv2.imencode(".png", cropped)
    if not ok:
        raise RuntimeError("split crop: cv2.imencode failed for child crop")
    return service.blobs.write(bytes(buf.tobytes()))


def split_page_in_store(
    *,
    service: PageService,
    project_id: str,
    parent_page_id: _uuid.UUID,
    parent_idx0: int,
    parent_prefix: str,
    parent_source_stem: str,
    bbox: tuple[int, int, int, int],
    split_at_stage: str,
    suffixes: list[str],
    parent_source_blob_hash: str | None = None,
) -> list[OpsPageRecord]:
    """Create N sibling child pages in the event store. Returns child OpsPageRecords.

    Each child gets its own UUID PageAggregate. The parent's ProjectAggregate gains
    each child via ProjectAggregate.add_page. All children inherit the parent's project.

    When ``parent_source_blob_hash`` is provided (the production path — the route
    reads it off the parent's ``PrepPageExtension``), each child's source image is
    cropped from the parent's source blob to ``bbox`` at split time and stored as
    the child's own ``source_blob_hash``. This makes the v2 ``grayscale`` root
    uniform: both normal pages and split children simply read their own
    ``source_blob_hash`` (option B — crop at split time). When the parent has no
    source blob yet (``None`` — e.g. a split issued before ingest, or a bare
    unit-test parent), the child's ``source_blob_hash`` is left ``None`` and
    ``grayscale`` will report the missing-source dependency just like an
    un-ingested root page.
    """
    project_uuid = _to_uuid(project_id)
    proj_agg = service.store.get_project(project_uuid)

    child_source_hash: str | None = None
    if parent_source_blob_hash is not None:
        child_source_hash = _crop_source_blob(
            service=service,
            parent_source_blob_hash=parent_source_blob_hash,
            bbox=bbox,
        )

    children: list[OpsPageRecord] = []
    # Children start at page_index = current max + 1
    current_max_index = len(proj_agg.record.page_ids)

    for i, suffix in enumerate(suffixes):
        child_page_id = _uuid.uuid4()
        child_record = OpsPageRecord(
            page_id=child_page_id,
            page_index=current_max_index + i,
            source="raw",
        )
        child_ext = PrepPageExtension(
            project_id=project_id,
            idx0=current_max_index + i,
            prefix=f"{parent_prefix}{suffix}",
            source_stem=parent_source_stem,
            parent_page_id=str(parent_page_id),
            source_crop_bbox=bbox,
            split_index=i + 1,
            split_at_stage=split_at_stage,
            split_suffix=suffix,
            reading_order=i,
            source_blob_hash=child_source_hash,
        )
        set_extension(child_record, "prep", child_ext)
        child_agg = PageAggregate(record=child_record)
        service.store.save_page(child_agg)
        proj_agg.add_page(page_id=child_page_id, page_index=current_max_index + i)
        children.append(child_record)

    service.store.save_project(proj_agg)
    return children


def unsplit_page_in_store(
    *,
    service: PageService,
    project_id: str,
    parent_page_id: _uuid.UUID,
    parent_page_id_str: str | None = None,
) -> None:
    """Remove all split children of parent_page_id from the ProjectAggregate.

    Uses ProjectAggregate.remove_page (ops 0.7.0 PageRemoved event).
    Child PageAggregates remain in the event store as historical records;
    they are simply removed from the project's page_ids ordering.
    The prep page_stages rows for removed children should be cleaned up
    by the caller (pass child page_ids to IDatabase.delete_page_stages_for_page).

    parent_page_id_str: optional string form of the parent ID as stored in
        child extensions (may differ from str(parent_page_id) for legacy data).
    """
    project_uuid = _to_uuid(project_id)
    proj_agg = service.store.get_project(project_uuid)

    # Match children by either UUID string or the provided parent_page_id_str
    match_ids = {str(parent_page_id)}
    if parent_page_id_str is not None:
        match_ids.add(parent_page_id_str)

    # Find all child pages: load each page_id, check parent_page_id in extension
    to_remove: list[_uuid.UUID] = []
    for page_id in list(proj_agg.record.page_ids):
        try:
            page_agg = service.store.get_page(page_id)
        except Exception:
            log.warning("unsplit_page_in_store: could not load page %s", page_id)
            continue
        ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        if ext is not None and ext.parent_page_id in match_ids:
            to_remove.append(page_id)

    for child_id in to_remove:
        proj_agg.remove_page(page_id=child_id)

    if to_remove:
        service.store.save_project(proj_agg)
