"""/api/data/projects/{id}/pages/* — page CRUD."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Annotated, Literal, cast

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.models import Project
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore
    from pdomain_prep_for_pgdp.settings import Settings

from fastapi import APIRouter, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import pdomain_prep_for_pgdp.core.pipeline.stage_dag as _stage_dag
from pdomain_prep_for_pgdp.api.dependencies import (
    DatabaseDep,
    PageServiceDep,
    SettingsDep,
    StageEventsDep,
    StorageDep,
    UserDep,
)
from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    AlignmentOverride,
    IllustrationRegion,
    Job,
    JobStatus,
    JobType,
    OcrWord,
    PageConfigOverrides,
    PageProcessingStatus,
    PageRecord,
    PageSplit,
    PageStageState,
    PageStageStatus,
    PageType,
    StageRunRequest,
)
from pdomain_prep_for_pgdp.core.ocr_artifacts import load_words_from_storage, words_key_for
from pdomain_prep_for_pgdp.core.page_service_helpers import (
    _to_uuid as _project_id_to_uuid,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import (
    get_page_record,
    list_page_records,
    put_page_records,
    update_page_extension,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    StageArtifactWriteError,
    stage_artifact_path,
    stage_thumbnail_path,
)
from pdomain_prep_for_pgdp.core.pipeline.registry_version import (
    RegistryVersionMismatchError,
    check_registry_version,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_dag import get_v2_stage
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import (
    StageDependenciesNotMet,
    StageOutputUnsupported,
    StageRunFailed,
    cascade_dirty_for_config_change,
    run_stage,
)
from pdomain_prep_for_pgdp.core.prefix import compute_prefix
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

log = logging.getLogger(__name__)

router = APIRouter(tags=["pages"])


def _check_registry_page(project: Project) -> JSONResponse | None:
    """Return 409 JSONResponse if the project is on a legacy registry version.

    Page-stage routes return the same 409 shape as project-stage routes
    per api-v2-deltas.md §1.3.
    """
    try:
        check_registry_version(project)
        return None
    except RegistryVersionMismatchError as exc:
        return JSONResponse(status_code=409, content=exc.as_dict())


class ListPagesResponse(BaseModel):
    pages: list[PageRecord]
    next_cursor: str | None = None
    total: int


class UpdatePageRequest(BaseModel):
    page_type: PageType | None = None
    alignment: AlignmentOverride | None = None
    config_overrides: PageConfigOverrides | None = None
    splits: list[PageSplit] | None = None
    illustration_regions: list[IllustrationRegion] | None = None


class UpdatePageTextRequest(BaseModel):
    split_suffix: str | None = None
    text: str


class UpdatePageTextResponse(BaseModel):
    text_key: str


class GetPageTextResponse(BaseModel):
    text: str
    text_key: str
    # Bboxes for the TextReviewPage overlay. Empty list for legacy pages
    # OCR'd before the words blob was written (or for pages whose words
    # file was lost). The frontend treats `[]` and "no overlay" as the
    # same case, so empty-list is the more idiomatic shape than None.
    words: list[OcrWord] = []
    words_partial: bool = False  # True when words blob existed but decode failed
    words_error: str | None = None  # human-readable reason for partial/missing words


class DeleteWordsRequest(BaseModel):
    # Whole-page edits use "" / omit; per-split edits pass the suffix
    # (matches `UpdatePageTextRequest`).
    split_suffix: str | None = None
    # Idempotent: unknown ids are silently skipped — the response's
    # `deleted_count` lets the client see how many actually applied.
    word_ids: list[str]


class DeleteWordsResponse(BaseModel):
    text_key: str
    words_key: str
    deleted_count: int
    remaining_words: list[OcrWord]
    text: str


class RestoreWordsRequest(BaseModel):
    # Whole-page edits use "" / omit; per-split edits pass the suffix.
    split_suffix: str | None = None
    word_ids: list[str]


class RestoreWordsResponse(BaseModel):
    text_key: str
    words_key: str
    restored_count: int
    remaining_words: list[OcrWord]
    text: str


class ReorderPagesRequest(BaseModel):
    """Request to reorder pages in a project.

    page_ids: Ordered list of current idx0 values (zero-padded, e.g. '0000')
              representing the desired page order. Must include all pages in
              the project exactly once and match the project's page count.
    """

    page_ids: list[str] = Field(..., min_length=1)


class ReorderPagesResponse(BaseModel):
    """Response after reordering pages."""

    pages: list[PageRecord]


@router.get(
    "/projects/{project_id}/pages",
    response_model=ListPagesResponse,
    operation_id="list_pages",
)
async def list_pages(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    page_type: Annotated[PageType | None, Query()] = None,
    has_splits: Annotated[bool | None, Query()] = None,
    status: Annotated[PageProcessingStatus | None, Query()] = None,
    review_needed: Annotated[bool | None, Query()] = None,
) -> ListPagesResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    # ── Event-store path ──────────────────────────────────────────────────
    all_pages = list_page_records(page_service, project_id)
    filtered = all_pages
    if page_type is not None:
        filtered = [p for p in filtered if p.page_type == page_type]
    if has_splits is not None:
        filtered = [p for p in filtered if bool(p.splits) == has_splits]
    if status is not None:
        filtered = [p for p in filtered if p.processing_status == status]
    if review_needed is True:
        filtered = [p for p in filtered if _needs_review(p)]
    if review_needed is False:
        filtered = [p for p in filtered if not _needs_review(p)]

    total = len(filtered)
    offset = int(cursor) if cursor else 0
    page_slice = filtered[offset : offset + limit]
    next_cursor_out = str(offset + limit) if offset + limit < total else None
    return ListPagesResponse(pages=page_slice, next_cursor=next_cursor_out, total=total)


def _needs_review(page: PageRecord) -> bool:
    """Spec 03 review-queue heuristic: any output not complete, or has an error."""
    if page.processing_status == PageProcessingStatus.error:
        return True
    if not page.outputs:
        # Pre-OCR pages don't need review yet.
        return False
    for o in page.outputs:
        if o.ocr_status != PageProcessingStatus.complete:
            return True
        if o.ocr_error:
            return True
    return False


def _ext_to_page_record(ext: PrepPageExtension) -> PageRecord:
    """Assemble a prep PageRecord wire shape from PrepPageExtension."""
    return PageRecord(
        project_id=ext.project_id,
        idx0=ext.idx0,
        prefix=ext.prefix,
        source_stem=ext.source_stem,
        ignore=ext.ignore,
        page_type=ext.page_type,
        alignment=ext.alignment,
        config_overrides=ext.config_overrides,
        splits=ext.splits,
        illustration_regions=ext.illustration_regions,
        source_key=None,
        thumbnail_key=None,
        processing_status=ext.processing_status,
        processing_job_id=ext.processing_job_id,
        processing_error=ext.processing_error,
        last_processed_at=ext.last_processed_at,
        outputs=ext.outputs,
        parent_page_id=ext.parent_page_id,
        source_crop_bbox=ext.source_crop_bbox,
        split_index=ext.split_index,
        split_at_stage=ext.split_at_stage,
        split_suffix=ext.split_suffix,
        reading_order=ext.reading_order,
    )


@router.get(
    "/projects/{project_id}/pages/{idx0}",
    response_model=PageRecord,
    operation_id="get_page",
)
async def get_page(
    project_id: str,
    idx0: int,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> PageRecord:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    # ── Event-store path ──────────────────────────────────────────────────
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")
    return page


@router.patch(
    "/projects/{project_id}/pages/reorder",
    response_model=ReorderPagesResponse,
    operation_id="reorder_pages",
)
async def reorder_pages(
    project_id: str,
    body: ReorderPagesRequest,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> ReorderPagesResponse:
    """Reorder pages in a project.

    Takes a list of idx0 values in the desired order and updates idx0 and
    prefix for all pages accordingly. All pages must be from this project
    and appear exactly once.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    # Validate: must have correct count
    if len(body.page_ids) != project.page_count:
        raise HTTPException(
            422,
            f"page count mismatch: expected {project.page_count}, got {len(body.page_ids)}",
        )

    # Validate: no duplicate page_ids
    if len(body.page_ids) != len(set(body.page_ids)):
        raise HTTPException(422, detail="page_ids contains duplicates")

    # Fetch all pages and validate all IDs belong to this project
    pages_by_id: dict[str, PageRecord] = {}
    for page_id in body.page_ids:
        try:
            idx0 = int(page_id)
        except ValueError as err:
            raise HTTPException(422, f"invalid page_id format: {page_id}") from err
        page = get_page_record(page_service, project_id, idx0)
        if page is None:
            raise HTTPException(404, f"page not found: {page_id}")
        pages_by_id[page_id] = page

    # Update idx0 and prefix for each page based on new order
    updated_pages: list[PageRecord] = []
    pages_by_idx: dict[int, PageRecord] = {}

    for new_idx0, page_id in enumerate(body.page_ids):
        page = pages_by_id[page_id]
        page.idx0 = new_idx0
        # Build the by-idx mapping with updated idx0 for compute_prefix to work
        pages_by_idx[new_idx0] = page
        updated_pages.append(page)

    # Recompute prefix for all pages using existing compute_prefix logic
    for page in updated_pages:
        new_prefix = compute_prefix(page.idx0, project.config, pages_by_idx)
        page.prefix = new_prefix or ""

    # Write all updated pages to the event store in a batch
    put_page_records(page_service, updated_pages)

    return ReorderPagesResponse(pages=updated_pages)


@router.patch(
    "/projects/{project_id}/pages/{idx0}",
    response_model=PageRecord,
    operation_id="update_page",
)
async def update_page(
    project_id: str,
    idx0: int,
    body: UpdatePageRequest,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> PageRecord:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")
    updated_fields = body.model_fields_set
    old_overrides = cast(dict[str, object], page.config_overrides.model_dump())
    if "config_overrides" in updated_fields and body.config_overrides is not None:
        page.config_overrides = body.config_overrides
    if "page_type" in updated_fields:
        page.page_type = body.page_type or page.page_type
    if "alignment" in updated_fields:
        page.alignment = body.alignment or page.alignment
    if "splits" in updated_fields and body.splits is not None:
        page.splits = body.splits
    if "illustration_regions" in updated_fields and body.illustration_regions is not None:
        page.illustration_regions = body.illustration_regions
    updated = update_page_extension(
        page_service,
        project_id,
        idx0,
        config_overrides=page.config_overrides,
        page_type=page.page_type,
        alignment=page.alignment,
        splits=page.splits,
        illustration_regions=page.illustration_regions,
    )
    if updated is not None:
        page = updated

    # Cascade dirty to stages whose config-field sets overlap with the changed
    # config_overrides fields, so the chip rail reflects staleness immediately.
    new_overrides = cast(dict[str, object], page.config_overrides.model_dump())
    changed_fields = {field for field, value in new_overrides.items() if value != old_overrides.get(field)}
    if changed_fields:
        page_id = f"{idx0:04d}"
        await cascade_dirty_for_config_change(
            database=db,
            project_id=project_id,
            page_id=page_id,
            changed_fields=changed_fields,
        )

    return page


@router.patch(
    "/projects/{project_id}/pages/{idx0}/text",
    response_model=UpdatePageTextResponse,
    operation_id="update_page_text",
)
async def update_page_text(
    project_id: str,
    idx0: int,
    body: UpdatePageTextRequest,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
    page_service: PageServiceDep,
) -> UpdatePageTextResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    # Step 9 must write to the same key the OCR step wrote to, so the package
    # stage picks up the edits. Prefer the recorded `output.ocr_text_key` when
    # available; fall back to the synthesised path for pre-OCR edits.
    suffix = body.split_suffix or ""
    text_key: str | None = None
    for output in page.outputs:
        if (output.split_suffix or "") == suffix and output.ocr_text_key:
            text_key = output.ocr_text_key
            break
    if text_key is None:
        full_prefix = f"{page.prefix}{suffix}"
        stem_prefix = f"{page.source_stem}_{full_prefix}" if page.source_stem else full_prefix
        text_key = f"projects/{project_id}/ocr_text/{stem_prefix}.txt"
    await storage.put_bytes(text_key, body.text.encode("utf-8"), "text/plain")
    return UpdatePageTextResponse(text_key=text_key)


@router.get(
    "/projects/{project_id}/pages/{idx0}/text/{suffix}",
    response_model=GetPageTextResponse,
    operation_id="get_page_text",
)
async def get_page_text(
    project_id: str,
    idx0: int,
    suffix: str,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
    page_service: PageServiceDep,
) -> GetPageTextResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")
    real_suffix = "" if suffix == "_" else suffix
    text_key: str | None = None
    for output in page.outputs:
        if (output.split_suffix or "") == real_suffix and output.ocr_text_key:
            text_key = output.ocr_text_key
            break
    if text_key is None:
        full_prefix = f"{page.prefix}{real_suffix}"
        stem_prefix = f"{page.source_stem}_{full_prefix}" if page.source_stem else full_prefix
        text_key = f"projects/{project_id}/ocr_text/{stem_prefix}.txt"
    if not await storage.exists(text_key):
        raise HTTPException(404, "text not found")
    text = (await storage.get_bytes(text_key)).decode("utf-8")

    # Try to load the sibling words blob. Legacy pages OCR'd before
    # `cpu.run_ocr` started persisting words won't have one — return [].
    # Filter out soft-deleted words so the overlay reflects the current
    # visible word set after any delete operations.
    words: list[OcrWord] = []
    words_partial = False
    words_error: str | None = None
    words_key = words_key_for(text_key)
    if await storage.exists(words_key):
        try:
            raw = await storage.get_bytes(words_key)
        except (OSError, ConnectionError) as exc:
            log.exception("storage error fetching words blob at %s", words_key)
            raise HTTPException(503, "words storage temporarily unavailable") from exc
        try:
            words = [w for w in load_words_from_storage(raw) if not w.deleted]
        except Exception as exc:
            log.exception("failed to decode words blob at %s", words_key)
            words_partial = True
            words_error = f"{type(exc).__name__}: {exc}"

    return GetPageTextResponse(
        text=text,
        text_key=text_key,
        words=words,
        words_partial=words_partial,
        words_error=words_error,
    )


def _rebuild_text_from_words(words: list[OcrWord]) -> str:
    """Reconstruct page text from a `list[OcrWord]` after a delete.

    Callers are expected to pass only the survivor words (non-deleted).
    No internal filtering is applied.

    v1 strategy (deliberately simple, see roadmap §9a "Open questions"):

    - Group words into lines via y-midpoint clustering, where two words
      share a line if their bbox y-midpoints differ by less than half
      the smaller word's height.
    - Sort each line left-to-right, join words with single spaces.
    - Join lines with `\n`.

    Paragraph breaks are NOT reconstructed — `OcrWord` doesn't carry
    paragraph boundary metadata, and round-tripping through the
    pdomain-book-tools layout pipeline would require re-running OCR. For
    the §9a "delete obvious noise" use case this is acceptable; the
    proofer's textarea is still the source of truth for the final
    `<root>.txt` once they save.
    """
    if not words:
        return ""

    # Sort by y-midpoint, then x-left as a stable secondary key.
    def y_mid(w: OcrWord) -> float:
        return w.bounding_box.top + w.bounding_box.height / 2.0

    ordered = sorted(words, key=lambda w: (y_mid(w), w.bounding_box.left))

    lines: list[list[OcrWord]] = []
    for w in ordered:
        if not lines:
            lines.append([w])
            continue
        current = lines[-1]
        # Compare against the line's "anchor" (smallest height word's
        # y-midpoint) so a tall capital doesn't drag the threshold up.
        anchor = min(current, key=lambda x: x.bounding_box.height)
        anchor_mid = y_mid(anchor)
        threshold = max(1.0, min(anchor.bounding_box.height, w.bounding_box.height) / 2.0)
        if abs(y_mid(w) - anchor_mid) <= threshold:
            current.append(w)
        else:
            lines.append([w])

    rebuilt_lines: list[str] = []
    for line in lines:
        line_sorted = sorted(line, key=lambda w: w.bounding_box.left)
        rebuilt_lines.append(" ".join(w.text for w in line_sorted))
    return "\n".join(rebuilt_lines)


@router.delete(
    "/projects/{project_id}/pages/{idx0}/words",
    response_model=DeleteWordsResponse,
    operation_id="delete_page_words",
)
async def delete_page_words(
    project_id: str,
    idx0: int,
    body: DeleteWordsRequest,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
    page_service: PageServiceDep,
) -> DeleteWordsResponse:
    """Soft-delete OCR words from a page's `<root>.words.json` and
    rewrite `<root>.txt` from the survivors (roadmap §9a).

    Words are marked ``deleted=True`` rather than removed — the full word
    list (including deleted entries) is written back to the words blob so
    that a subsequent restore call can flip them back. Unknown ``word_ids``
    are silently skipped and words already marked deleted are not recounted;
    the response's ``deleted_count`` reports how many ids were newly flipped.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    suffix = body.split_suffix or ""

    # Mirror the same key-resolution logic as `update_page_text` /
    # `get_page_text` so we operate on the canonical OCR output.
    text_key: str | None = None
    for output in page.outputs:
        if (output.split_suffix or "") == suffix and output.ocr_text_key:
            text_key = output.ocr_text_key
            break
    if text_key is None:
        full_prefix = f"{page.prefix}{suffix}"
        stem_prefix = f"{page.source_stem}_{full_prefix}" if page.source_stem else full_prefix
        text_key = f"projects/{project_id}/ocr_text/{stem_prefix}.txt"

    words_key = words_key_for(text_key)
    if not await storage.exists(words_key):
        # No words blob means there's nothing to delete from; surface
        # this as 404 so the client doesn't silently no-op.
        raise HTTPException(404, "words blob not found")

    raw = await storage.get_bytes(words_key)
    try:
        words = load_words_from_storage(raw)
    except Exception as exc:
        log.exception("failed to decode words blob at %s", words_key)
        raise HTTPException(
            422,
            detail={"error_code": "words_blob_corrupt", "message": "words blob is corrupt"},
        ) from exc

    drop = set(body.word_ids)
    updated_words: list[OcrWord] = []
    deleted_count = 0
    for w in words:
        if w.id in drop and not w.deleted:
            updated_words.append(w.model_copy(update={"deleted": True}))
            deleted_count += 1
        else:
            updated_words.append(w)
    words = updated_words

    survivors: list[OcrWord] = [word for word in words if not word.deleted]

    # Even when deleted_count == 0 we rewrite — keeps the response
    # contract uniform and lets the client treat this as the canonical
    # "current state of the page" round-trip.
    new_text = _rebuild_text_from_words(survivors)
    payload = json.dumps([word.model_dump(mode="json") for word in words]).encode("utf-8")
    await storage.put_bytes(words_key, payload, "application/json")
    await storage.put_bytes(text_key, new_text.encode("utf-8"), "text/plain")

    return DeleteWordsResponse(
        text_key=text_key,
        words_key=words_key,
        deleted_count=deleted_count,
        remaining_words=survivors,
        text=new_text,
    )


@router.post(
    "/projects/{project_id}/pages/{idx0}/words/restore",
    response_model=RestoreWordsResponse,
    operation_id="restore_page_words",
)
async def restore_page_words(
    project_id: str,
    idx0: int,
    body: RestoreWordsRequest,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
    page_service: PageServiceDep,
) -> RestoreWordsResponse:
    """Restore previously soft-deleted OCR words for a page (roadmap §9a).

    Flips ``deleted=True`` back to ``deleted=False`` for matching ``word_ids``.
    Only words that were actually marked deleted count toward ``restored_count``;
    unknown ids and already-active words are silently skipped.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    suffix = body.split_suffix or ""

    text_key: str | None = None
    for output in page.outputs:
        if (output.split_suffix or "") == suffix and output.ocr_text_key:
            text_key = output.ocr_text_key
            break
    if text_key is None:
        full_prefix = f"{page.prefix}{suffix}"
        stem_prefix = f"{page.source_stem}_{full_prefix}" if page.source_stem else full_prefix
        text_key = f"projects/{project_id}/ocr_text/{stem_prefix}.txt"

    words_key = words_key_for(text_key)
    if not await storage.exists(words_key):
        raise HTTPException(404, "words blob not found")

    raw = await storage.get_bytes(words_key)
    try:
        words = load_words_from_storage(raw)
    except Exception as exc:
        log.exception("failed to decode words blob at %s", words_key)
        raise HTTPException(
            422,
            detail={"error_code": "words_blob_corrupt", "message": "words blob is corrupt"},
        ) from exc

    restore = set(body.word_ids)
    updated_words: list[OcrWord] = []
    restored_count = 0
    for w in words:
        if w.id in restore and w.deleted:
            updated_words.append(w.model_copy(update={"deleted": False}))
            restored_count += 1
        else:
            updated_words.append(w)
    words = updated_words

    survivors: list[OcrWord] = [word for word in words if not word.deleted]
    new_text = _rebuild_text_from_words(survivors)
    payload = json.dumps([word.model_dump(mode="json") for word in words]).encode("utf-8")
    await storage.put_bytes(words_key, payload, "application/json")
    await storage.put_bytes(text_key, new_text.encode("utf-8"), "text/plain")

    return RestoreWordsResponse(
        text_key=text_key,
        words_key=words_key,
        restored_count=restored_count,
        remaining_words=survivors,
        text=new_text,
    )


# ─── Split: POST /pages/{idx0}/split ─────────────────────────────────────────


class SplitPageRequest(BaseModel):
    bbox: tuple[int, int, int, int]  # x, y, w, h in parent source-image coords
    split_at_stage: str
    suffixes: list[str]  # one suffix per child, e.g. ["a", "b"]


class SplitPageResponse(BaseModel):
    children: list[PageRecord]


@router.post(
    "/projects/{project_id}/pages/{idx0}/split",
    response_model=SplitPageResponse,
    operation_id="split_page",
)
async def split_page(
    project_id: str,
    idx0: int,
    body: SplitPageRequest,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> SplitPageResponse:
    """Create N sibling child pages by splitting a parent page.

    Spec: docs/specs/pipeline-task-model.md §"Splits as sibling pages (Q6)".
    Each child is a first-class PageRecord that runs the full DAG independently.
    Children start at post-ingest state; page_stages rows are lazy-init'd on
    first access (same contract as root pages).
    """
    if body.split_at_stage not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown split_at_stage: {body.split_at_stage!r}")
    if not body.suffixes:
        raise HTTPException(422, "suffixes must not be empty")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    # ── Event-store path ──────────────────────────────────────────────────
    from pdomain_ops.pages import get_extension as _ops_get_ext

    from pdomain_prep_for_pgdp.core.split_ops import split_page_in_store

    project_uuid = _project_id_to_uuid(project_id)
    proj_agg = page_service.store.get_project(project_uuid)
    parent_page_uuid = None
    parent_ext = None
    for pid in proj_agg.record.page_ids:
        try:
            page_agg = page_service.store.get_page(pid)
        except Exception:
            continue
        ext = _ops_get_ext(page_agg.record, "prep", PrepPageExtension)
        if ext is not None and ext.idx0 == idx0:
            parent_page_uuid = pid
            parent_ext = ext
            break

    if parent_page_uuid is None or parent_ext is None:
        raise HTTPException(404, "page not found")

    child_records = split_page_in_store(
        service=page_service,
        project_id=project_id,
        parent_page_id=parent_page_uuid,
        parent_idx0=parent_ext.idx0,
        parent_prefix=parent_ext.prefix,
        parent_source_stem=parent_ext.source_stem,
        bbox=body.bbox,
        split_at_stage=body.split_at_stage,
        suffixes=body.suffixes,
    )
    children_wire = []
    for ops_rec in child_records:
        child_ext = _ops_get_ext(ops_rec, "prep", PrepPageExtension)
        if child_ext is not None:
            children_wire.append(_ext_to_page_record(child_ext))
    return SplitPageResponse(children=children_wire)


# ─── Unsplit: DELETE /pages/{idx0}/split ────────────────────────────────────


@router.delete(
    "/projects/{project_id}/pages/{idx0}/split",
    response_model=PageRecord,
    operation_id="unsplit_page",
)
async def unsplit_page(
    project_id: str,
    idx0: int,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> PageRecord:
    """Reverse a split: delete all sibling child pages and return the parent.

    Spec: docs/specs/pipeline-task-model.md §"Splits as sibling pages (Q6)".
    After this call:
    - All sibling pages (same parent_page_id) are deleted from the DB.
    - Their page_stages rows are deleted, making any on-disk artifacts
      orphans that ``pgdp-prep reindex --heal`` will quarantine.
    - The parent page is unchanged and visible in list_pages again.
    - The parent's own page_stages rows are NOT touched (per spec §"Reverse split").
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    # ── Event-store path ──────────────────────────────────────────────────
    from pdomain_ops.pages import get_extension as _ops_get_ext

    from pdomain_prep_for_pgdp.core.split_ops import unsplit_page_in_store

    project_uuid = _project_id_to_uuid(project_id)
    proj_agg = page_service.store.get_project(project_uuid)
    target_page_uuid = None
    target_ext = None
    for pid in proj_agg.record.page_ids:
        try:
            page_agg = page_service.store.get_page(pid)
        except Exception:
            continue
        ext = _ops_get_ext(page_agg.record, "prep", PrepPageExtension)
        if ext is not None and ext.idx0 == idx0:
            target_page_uuid = pid
            target_ext = ext
            break

    if target_page_uuid is None or target_ext is None:
        raise HTTPException(404, "page not found")

    if target_ext.parent_page_id is None:
        raise HTTPException(422, "page is not a split child")

    # The parent_page_id may be either a UUID string (from production split)
    # or a zero-padded idx0 string (from legacy/test seeding).
    parent_page_id_str = target_ext.parent_page_id

    # Clean up page_stages for children before removing from event store.
    # page_stages rows use the zero-padded idx0 as page_id, not the event-store UUID.
    for pid in list(proj_agg.record.page_ids):
        try:
            page_agg = page_service.store.get_page(pid)
        except Exception:
            continue
        ext = _ops_get_ext(page_agg.record, "prep", PrepPageExtension)
        if ext is not None and ext.parent_page_id == parent_page_id_str:
            # Use zero-padded idx0 for page_stages lookup (the legacy page_id format).
            child_page_stages_id = f"{ext.idx0:04d}"
            await db.delete_page_stages_for_page(project_id, child_page_stages_id)

    # Remove children from the project aggregate.
    # parent_page_id_str might be a UUID (production) or zero-padded idx0 (test).
    try:
        parent_uuid = _project_id_to_uuid(parent_page_id_str)
        from pdomain_prep_for_pgdp.core.split_ops import unsplit_page_in_store

        unsplit_page_in_store(
            service=page_service,
            project_id=project_id,
            parent_page_id=parent_uuid,
            parent_page_id_str=parent_page_id_str,
        )
    except Exception:
        pass  # Children already cleaned up above; project aggregate update failed

    # Return the parent page — look up by finding the page with no parent_page_id
    # that matches the parent_page_id_str context.
    # Try to parse as idx0 (zero-padded string like "0000" → idx0=0).
    try:
        parent_idx0 = int(parent_page_id_str)
        parent_rec = get_page_record(page_service, project_id, parent_idx0)
        if parent_rec is not None:
            return parent_rec
    except (ValueError, TypeError):
        pass

    # Try as UUID — find page whose aggregate UUID matches parent_page_id_str
    for pid in proj_agg.record.page_ids:
        if str(pid) == parent_page_id_str:
            try:
                parent_agg = page_service.store.get_page(pid)
                parent_ext = _ops_get_ext(parent_agg.record, "prep", PrepPageExtension)
                if parent_ext is not None:
                    return _ext_to_page_record(parent_ext)
            except Exception:
                pass

    raise HTTPException(404, "parent page not found after unsplit")


# ─── Per-page DAG stages (M1 §C) ─────────────────────────────────────────────


def _page_id_for_idx0(idx0: int) -> str:
    """Canonical page_id for a root page — zero-padded 4-digit idx0.

    Spec §"SQLite schema": `page_id` is "zero-padded idx0 for root, with
    /splits/<suffix> chain for children". Root-only at M1 (no splits yet).
    """
    return f"{idx0:04d}"


@router.get(
    "/projects/{project_id}/pages/{idx0}/stages",
    response_model=list[PageStageState],
    operation_id="list_page_stages",
)
async def list_page_stages(
    project_id: str,
    idx0: int,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> list[PageStageState]:
    """Return ordered per-page stage state for the v2 16-stage page DAG.

    Spec: `docs/specs/api-v2-deltas.md` §1.1 — returns the 16 v2 page-scoped
    stages in V2_PAGE_STAGE_IDS topological order (sources first). Project-
    scoped stages (source, page_order, validation, …) are served via the
    /project-stages routes.

    Lazy-init contract (Q1-followup): if no rows exist yet for this page,
    materialise 16 ``not-run`` rows in one transaction (`INSERT OR IGNORE`)
    and return them in topological order. Concurrent first-touch reads
    converge on exactly 16 rows.

    Auth follows the existing pattern — every project read is filtered
    by `user.user_id`. 404 (not 403) is returned on miss to avoid leaking
    project existence to non-owners.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv  # type: ignore[return-value]  # pyright: ignore[reportReturnType]

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    # Lazy-init: idempotent + concurrency-safe via `INSERT OR IGNORE` on the
    # composite PK.
    _ = await db.init_page_stages_for_page(project_id, page_id)
    rows = await db.list_page_stages_for_page(project_id, page_id)

    # Order by v2 page-scoped DAG topological order (V2_PAGE_STAGE_IDS).
    # Only the 16 page-scoped v2 stages are returned; project-scoped stages
    # (source, page_order, validation, etc.) are served via /project-stages.
    by_id: dict[str, PageStageState] = {r.stage_id: r for r in rows}
    ordered: list[PageStageState] = []
    for sid in V2_PAGE_STAGE_IDS:
        row = by_id.get(sid)
        if row is None:
            # Lazy-init row missing — create a not-run placeholder in-memory.
            row = PageStageState(
                project_id=project_id,
                page_id=page_id,
                stage_id=sid,
                status=PageStageStatus.not_run,
            )
        current_version = _stage_dag.STAGE_VERSIONS.get(row.stage_id, 1)
        if row.stage_version < current_version and row.status == PageStageStatus.clean:
            row = row.model_copy(update={"status": PageStageStatus.dirty})
        ordered.append(row)
    return ordered


# ─── Per-page DAG: run a stage (M2 Slice 4) ────────────────────────────────


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/run",
    response_model=Job | PageStageState,
    operation_id="run_page_stage",
)
async def run_page_stage(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
    page_service: PageServiceDep,
    body: StageRunRequest | None = None,
    async_: Annotated[bool, Query(alias="async")] = False,
) -> Job | PageStageState:
    """Run one stage on one page and return the new row or a Job.

    Spec: `docs/specs/api-v2-deltas.md` §1.1 — page-stage run, v2 stage IDs.
    Accepts a `StageRunRequest` body (B5: force, async fields). The `?async`
    query-param form is deprecated; the body form is canonical in v2. Both
    are accepted during the B5→I1 transition window.

    Status codes:

    - 200: stage ran cleanly; body is the freshly-committed PageStageState.
    - 202: async=True (body or query param); body is a Job.
    - 404: project not found, page not found, or cross-user access.
    - 422: unknown `stage_id` (validated against V2_PAGE_STAGE_IDS).
    - 409 Conflict: the stage's `depends_on` rows aren't all `clean`.
      Body names the missing parents so the UI can prompt the user to
      run them first.
    - 501 Not Implemented: compound output stage or no impl yet.
    - 500: stage impl raised, or dual-write commit failed.
    """
    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    # Resolve async flag: body form takes precedence over deprecated query-param form.
    _async = (body.async_ if body is not None else False) or async_

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv  # type: ignore[return-value]  # pyright: ignore[reportReturnType]

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)

    # Return 422 immediately if the stage is marked not-applicable for this page.
    existing_row = await db.get_page_stage(project_id, page_id, stage_id)
    if existing_row is not None and existing_row.status == PageStageStatus.not_applicable:
        raise HTTPException(422, f"stage {stage_id!r} is not-applicable for this page type")

    if _async:
        job = Job(
            id=uuid.uuid4().hex,
            project_id=project_id,
            owner_id=user.user_id,
            type=JobType.run_page_stage,
            status=JobStatus.queued,
            payload={
                "project_id": project_id,
                "page_id": page_id,
                "stage_id": stage_id,
                "data_root": str(settings.data_root),
            },
        )
        await db.put_job(job)
        return JSONResponse(content=job.model_dump(mode="json"), status_code=202)  # pyright: ignore[reportReturnType]

    # Resolve per-page config here in the route handler so that config-aware
    # stages receive the current DB values. We already fetched `project` and
    # `page` above; pass them directly to avoid a second DB round-trip inside
    # run_stage. The async path intentionally skips this — the job handler
    # will call run_stage itself and must re-resolve at execution time so any
    # config changes that arrived while the job was queued are picked up.
    from pdomain_prep_for_pgdp.core.config_resolver import resolve_page_config

    _system = await db.get_system_defaults(project.owner_id)
    _resolved_config = resolve_page_config(_system, project.config, page)

    try:
        return await run_stage(
            data_root=settings.data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            # Root stage `ingest_source` reads bytes from IStorage at the
            # page's source_key; pass through unconditionally so the runner
            # has them when it needs them (other stages ignore both).
            storage=storage,
            page_source_key=None,  # source_key not stored in event store; stage reads from BlobStore
            stage_events=stage_events,
            resolved_config=_resolved_config,
        )
    except StageDependenciesNotMet as exc:
        raise HTTPException(409, str(exc)) from exc
    except StageOutputUnsupported as exc:
        raise HTTPException(501, str(exc)) from exc
    except StageRunFailed as exc:
        # Q9 fail-loud: the row is already marked `failed` with
        # error_message; raise 500 so the API contract is honest.
        raise HTTPException(500, str(exc)) from exc


# ─── Per-page DAG: GET a stage's on-disk artifact ──────────────────────────


# Maps `Stage.output_type` to a Content-Type for the GET /artifact route.
# Mirrors `OUTPUT_EXT_BY_TYPE` in `page_stage_writer.py` — keep in sync.
# Compound output types are intentionally absent: those stages can't be
# served through the single-file artifact route (multi-artifact writer
# queued for a later slice).
_STAGE_OUTPUT_CONTENT_TYPES: dict[str, str] = {
    "image_bytes": "image/png",
    "image": "image/png",
    "gray": "image/png",
    "binary": "image/png",
    "jpeg_bytes": "image/jpeg",
    "text": "text/plain; charset=utf-8",
    # v2 additional output types
    "zone_json": "application/json",
    "words+text": "application/json",  # compound — served as JSON summary
    "text+attestation": "application/json",
    "hi_res_crops": "application/json",
    # legacy
    "page_attrs": "application/json",
    "illustration_regions": "application/json",
    "bbox": "application/json",
}


@router.get(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/artifact",
    operation_id="get_page_stage_artifact",
    # No response_model — this returns raw bytes via fastapi.Response with
    # an output_type-derived Content-Type. OpenAPI sees a binary response.
    responses={
        200: {
            "content": {
                "image/png": {},
                "image/jpeg": {},
                "text/plain": {},
                "application/json": {},
            },
            "description": "Stage artifact bytes; Content-Type per stage output_type.",
        },
        304: {"description": "ETag matched If-None-Match — body unchanged."},
        404: {"description": "Project/page not found, cross-user, or no clean artifact."},
        422: {"description": "Unknown stage_id."},
    },
)
async def get_page_stage_artifact(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
    _v: str | None = None,  # cache-busting: ?v=<last_run_at>; value is ignored server-side
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Stream the bytes of a clean stage's on-disk artifact.

    Spec: `docs/specs/pipeline-task-model.md` §"API surface" (§Per-page
    stage routes). Lets the workbench (or a direct-link user) view what
    a stage actually produced. M2 ships the minimal single-file shape;
    compound-output stages stay 404 here until the multi-artifact writer
    lands (their bytes don't fit a single file/Content-Type pair).

    Caching: the response carries an ETag header echoing the row's
    `input_hash` (sha256 of the artifact bytes). Browsers re-fetching
    the same artifact pass the value back as `If-None-Match`; we return
    304 in that case so the existing in-browser copy is reused.
    Backend never caches anything itself.

    Status code mapping:

    - 200: row clean, file exists, body is the raw bytes.
    - 304: `If-None-Match` matched the current ETag.
    - 404: project not found (also covers cross-user) / page not found
      / row's status is not `clean` / file missing on disk (drift; the
      reconciler is the right tool to surface that systematically).
    - 422: unknown stage_id (validated against V2_PAGE_STAGE_IDS).
    """
    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    row = await db.get_page_stage(project_id, page_id, stage_id)
    if row is None or row.status != "clean":
        # No clean artifact — either the stage hasn't run, ran but failed,
        # was dirtied by an upstream re-run, or hit not-applicable. The
        # client should re-check stage state and re-run if needed.
        raise HTTPException(404, "no clean artifact for this stage")

    # Resolve canonical path; compound-output stages raise here so we
    # surface a clean 404 instead of leaking the writer's exception.
    try:
        path = stage_artifact_path(settings.data_root, project_id, page_id, stage_id)
    except StageArtifactWriteError as exc:
        # Compound output_type — single-file artifact route can't serve it.
        raise HTTPException(404, f"stage {stage_id!r} has no single-file artifact") from exc

    if not path.exists():
        # Drift: row says clean but file is gone. Treated as 404 so the
        # client can re-run the stage; reconciler is the systematic fix.
        log.warning(
            "artifact GET drift: row clean but file missing at %s (project=%s page=%s stage=%s)",
            path,
            project_id,
            page_id,
            stage_id,
        )
        raise HTTPException(404, "stage artifact missing on disk")

    # ETag uses the row's input_hash (sha256 of the bytes the writer
    # committed). Quoted per RFC 7232 §2.3.
    etag = f'"{row.input_hash}"' if row.input_hash else None

    if etag is not None and if_none_match is not None and if_none_match.strip() == etag:
        return Response(status_code=304, headers={"ETag": etag})

    output_type = get_v2_stage(stage_id).output_type
    content_type = _STAGE_OUTPUT_CONTENT_TYPES.get(output_type, "application/octet-stream")

    body = path.read_bytes()
    headers: dict[str, str] = {}
    if etag is not None:
        headers["ETag"] = etag
    return Response(content=body, media_type=content_type, headers=headers)


@router.get(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/thumbnail",
    operation_id="get_page_stage_thumbnail",
    responses={
        200: {"content": {"image/png": {}}, "description": "Small PNG thumbnail of the stage's output."},
        304: {"description": "ETag matched If-None-Match — body unchanged."},
        404: {"description": "Project/page not found, stage not clean, or no thumbnail generated."},
        422: {"description": "Unknown stage_id."},
    },
)
async def get_page_stage_thumbnail(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Return the pre-generated thumbnail PNG for a clean stage's output.

    Thumbnails are written at stage-write time (not generated on demand).
    404 when the stage row is not-run, not-applicable, failed, or dirty.
    ETag echoes the stage row's input_hash so the browser can revalidate.
    """
    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    row = await db.get_page_stage(project_id, page_id, stage_id)
    if row is None or row.status != "clean":
        raise HTTPException(404, "no clean artifact for this stage")

    thumb_path = stage_thumbnail_path(settings.data_root, project_id, page_id, stage_id)
    if not thumb_path.exists():
        raise HTTPException(404, "thumbnail not available for this stage")

    etag = f'"{row.input_hash}"' if row.input_hash else None
    if etag is not None and if_none_match is not None and if_none_match.strip() == etag:
        return Response(status_code=304, headers={"ETag": etag})

    body = thumb_path.read_bytes()
    headers: dict[str, str] = {"Content-Type": "image/png"}
    if etag is not None:
        headers["ETag"] = etag
    return Response(content=body, media_type="image/png", headers=headers)


# ─── Per-page stage SSE stream ─────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/pages/{idx0}/events",
    operation_id="stream_page_stage_events",
)
async def stream_page_stage_events(
    project_id: str,
    idx0: int,
    user: UserDep,
    db: DatabaseDep,
    stage_events: StageEventsDep,
    page_service: PageServiceDep,
):
    """SSE — push stage-status and stage-progress events for one page.

    Subscribes to the in-process `StageEventBroker` and forwards events as
    `text/event-stream` frames. The first frame is a snapshot of current stage
    states from the database so a late subscriber sees state immediately;
    subsequent frames arrive from the broker (zero-poll).

    Channel scope: per-page (M3). Project-level subscription is deferred to M5.
    """
    from sse_starlette.sse import EventSourceResponse

    from pdomain_prep_for_pgdp.core.stage_events import stage_events_key

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    key = stage_events_key(project_id, page_id)

    async def stream() -> AsyncIterator[dict[str, str]]:
        rows = await db.list_page_stages_for_page(project_id, page_id)
        snapshot = {
            "type": "snapshot",
            "stages": [r.model_dump(mode="json") for r in rows],
        }
        yield {"event": "snapshot", "data": json.dumps(snapshot)}

        async for ev in stage_events.subscribe(key):
            yield {"event": str(ev.get("type", "stage-status")), "data": json.dumps(ev)}

    return EventSourceResponse(stream())


def _stage_settings_store(settings_dep: Settings, project_id: str) -> StageSettingsStore:
    """Return a StageSettingsStore for the given project."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    db_path = settings_dep.data_root / "projects" / project_id / "stage_settings.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return StageSettingsStore(db_path)


def _stage_registry_default(stage_id: str) -> dict[str, object]:
    """Return the registry default settings for a v2 stage.

    V2_STAGE_IMPL entries hold CPU callables only; no defaults key yet.
    Returns an empty dict — StageSettingsStore falls back to registry_default
    when neither override nor saved default exists.
    """
    return {}


@router.get(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/settings",
    operation_id="get_page_stage_settings",
    response_model=None,
)
async def get_page_stage_settings(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
):
    """Return effective settings for a page-scoped stage.

    Resolution: override > saved default > registry default.
    Spec: docs/specs/api-v2-deltas.md §1.8.
    """
    from fastapi.responses import JSONResponse

    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    store = _stage_settings_store(settings, project_id)
    registry_default = _stage_registry_default(stage_id)
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    return JSONResponse(content=effective)


@router.put(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/settings",
    operation_id="put_page_stage_settings",
    response_model=None,
)
async def put_page_stage_settings(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
    body: dict[str, object],
):
    """Save a project override for this stage's settings.

    The override is used for the next run (not saved as "my default").
    Appends a SettingsChange event.
    Spec: docs/specs/api-v2-deltas.md §1.8.
    """
    from fastapi.responses import JSONResponse

    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    store = _stage_settings_store(settings, project_id)
    registry_default = _stage_registry_default(stage_id)
    store.save_override(
        project_id,
        stage_id,
        body,
        registry_default=registry_default,
        actor_id=user.user_id,
    )
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    return JSONResponse(content=effective)


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/settings/save-as-default",
    operation_id="save_page_stage_settings_as_default",
    response_model=None,
)
async def save_page_stage_settings_as_default(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
    body: dict[str, object],
):
    """Save the body as the project-level default for this stage's settings.

    Appends a SettingsChange event.
    Spec: docs/specs/api-v2-deltas.md §1.8.
    """
    from fastapi.responses import JSONResponse

    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    store = _stage_settings_store(settings, project_id)
    registry_default = _stage_registry_default(stage_id)
    store.save_as_default(
        project_id,
        stage_id,
        body,
        registry_default=registry_default,
        actor_id=user.user_id,
    )
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    return JSONResponse(content=effective)


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/settings/revert",
    operation_id="revert_page_stage_settings",
    response_model=None,
)
async def revert_page_stage_settings(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
):
    """Revert the override for this stage, falling back to default or registry.

    Appends a SettingsChange event.
    Spec: docs/specs/api-v2-deltas.md §1.8.
    """
    from fastapi.responses import JSONResponse

    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    store = _stage_settings_store(settings, project_id)
    registry_default = _stage_registry_default(stage_id)
    store.revert(
        project_id,
        stage_id,
        registry_default=registry_default,
        actor_id=user.user_id,
    )
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    return JSONResponse(content=effective)


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/{stage_id}/settings/reset",
    operation_id="reset_page_stage_settings",
    response_model=None,
)
async def reset_page_stage_settings(
    project_id: str,
    idx0: int,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
):
    """Reset both override and saved default, reverting to registry default.

    Appends a SettingsChange event.
    Spec: docs/specs/api-v2-deltas.md §1.8.
    """
    from fastapi.responses import JSONResponse

    if stage_id not in V2_PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    store = _stage_settings_store(settings, project_id)
    registry_default = _stage_registry_default(stage_id)
    store.reset(
        project_id,
        stage_id,
        registry_default=registry_default,
        actor_id=user.user_id,
    )
    effective = store.get_effective(project_id, stage_id, registry_default=registry_default)
    return JSONResponse(content=effective)


# ─── Per-page wordcheck + hyphen_join routes (B5 Group 5) ─────────────────


class WordcheckFlagsResponse(BaseModel):
    page_id: str
    stage_id: str = "wordcheck"
    flags: list[dict[str, object]]
    flagged_count: int
    total_words: int


class WordcheckDecisionsRequest(BaseModel):
    decisions: list[dict[str, object]]


class WordlistPromotionRequest(BaseModel):
    word: str
    source_stage: str = "wordcheck"
    source_page_id: str
    list_scope: str  # "project" | "global"


class HyphenJoinCandidatesResponse(BaseModel):
    page_id: str
    stage_id: str = "hyphen_join"
    candidates: list[dict[str, object]]


class HyphenJoinDecisionsRequest(BaseModel):
    decisions: list[dict[str, object]]


def _read_artifact_bytes(
    settings: Settings,
    project_id: str,
    page_id: str,
    stage_id: str,
    row: PageStageState,
) -> bytes:
    """Read the on-disk artifact bytes for a clean stage row."""
    path = stage_artifact_path(settings.data_root, project_id, page_id, stage_id)
    return path.read_bytes()


@router.get(
    "/projects/{project_id}/pages/{idx0}/stages/wordcheck/flags",
    operation_id="get_wordcheck_flags",
    response_model=None,
)
async def get_wordcheck_flags(
    project_id: str,
    idx0: int,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> WordcheckFlagsResponse | JSONResponse:
    """Return current wordcheck flags projection for a page.

    Reads the wordcheck stage artifact (JSON blob) and returns flags.
    Returns 404 if the wordcheck stage is not clean.
    Spec: docs/specs/api-v2-deltas.md §1.9.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    row = await db.get_page_stage(project_id, page_id, "wordcheck")
    if row is None or row.status != "clean":
        raise HTTPException(404, "wordcheck stage has no clean artifact")

    artifact_path = stage_artifact_path(settings.data_root, project_id, page_id, "wordcheck")
    if not artifact_path.exists():
        raise HTTPException(404, "wordcheck artifact missing on disk")

    raw = artifact_path.read_bytes()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(422, "wordcheck artifact is corrupt") from exc

    return WordcheckFlagsResponse(
        page_id=page_id,
        flags=list(data.get("flags", [])),
        flagged_count=int(data.get("flagged_count", 0)),
        total_words=int(data.get("total_words", 0)),
    )


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/wordcheck/decisions",
    operation_id="post_wordcheck_decisions",
    response_model=None,
)
async def post_wordcheck_decisions(
    project_id: str,
    idx0: int,
    body: WordcheckDecisionsRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> WordcheckFlagsResponse | JSONResponse:
    """Record wordcheck decisions and return the updated flags projection.

    Each decision dict must have {word_id, word_text, decision} where
    decision is "accepted" | "rejected" | "deferred".
    Returns 404 if the wordcheck stage is not clean.
    Spec: docs/specs/api-v2-deltas.md §1.9.
    """
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import (
        make_wordcheck_decision,
        project_flags_from_events,
    )

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    row = await db.get_page_stage(project_id, page_id, "wordcheck")
    if row is None or row.status != "clean":
        raise HTTPException(404, "wordcheck stage has no clean artifact")

    artifact_path = stage_artifact_path(settings.data_root, project_id, page_id, "wordcheck")
    if not artifact_path.exists():
        raise HTTPException(404, "wordcheck artifact missing on disk")

    raw = artifact_path.read_bytes()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(422, "wordcheck artifact is corrupt") from exc

    initial_flags: list[dict[str, object]] = list(data.get("flags", []))

    # Build event dicts from incoming decisions and apply the projection.
    events: list[dict[str, object]] = []
    for d in body.decisions:
        word_id = str(d.get("word_id", ""))
        word_text = str(d.get("word_text", ""))
        raw_dec = str(d.get("decision", "deferred"))
        decision = cast("Literal['accepted', 'rejected', 'deferred']", raw_dec)
        events.append(
            make_wordcheck_decision(
                word_id=word_id,
                word_text=word_text,
                decision=decision,
                actor_id=user.user_id,
                page_id=page_id,
            )
        )

    updated_flags = project_flags_from_events([dict(f) for f in initial_flags], [dict(e) for e in events])

    return WordcheckFlagsResponse(
        page_id=page_id,
        flags=updated_flags,
        flagged_count=sum(1 for f in updated_flags if f.get("status") == "open"),
        total_words=int(data.get("total_words", 0)),
    )


@router.post(
    "/projects/{project_id}/wordlist-promotion",
    operation_id="post_wordlist_promotion",
    response_model=None,
)
async def post_wordlist_promotion(
    project_id: str,
    body: WordlistPromotionRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Promote a word to the project or global word list.

    Appends a WordlistPromotion event and updates the persistent word list store
    at data_root/projects/{project_id}/wordlists.json.
    Spec: docs/specs/api-v2-deltas.md §1.9.
    """
    import json as _json

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    if not body.word or not body.word.strip():
        raise HTTPException(422, "word must not be empty")

    wordlists_path = settings.data_root / "projects" / project_id / "wordlists.json"
    wordlists_path.parent.mkdir(parents=True, exist_ok=True)

    wordlists: dict[str, list[str]] = {}
    if wordlists_path.exists():
        try:
            wordlists = _json.loads(wordlists_path.read_bytes().decode("utf-8"))
        except Exception:
            wordlists = {}

    scope = body.list_scope
    if scope not in wordlists:
        wordlists[scope] = []
    if body.word not in wordlists[scope]:
        wordlists[scope].append(body.word)

    wordlists_path.write_bytes(_json.dumps(wordlists).encode("utf-8"))

    return JSONResponse(content={"promoted": True})


@router.get(
    "/projects/{project_id}/pages/{idx0}/stages/hyphen-join/candidates",
    operation_id="get_hyphen_join_candidates",
    response_model=None,
)
async def get_hyphen_join_candidates(
    project_id: str,
    idx0: int,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> HyphenJoinCandidatesResponse | JSONResponse:
    """Return hyphen-join candidates detected from the stage artifact.

    Reads the hyphen_join stage artifact (text) and detects end-of-line
    hyphen candidates. Returns 404 if no clean artifact is available.
    Spec: docs/specs/api-v2-deltas.md §1.9.
    """
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    row = await db.get_page_stage(project_id, page_id, "hyphen_join")
    if row is None or row.status != "clean":
        raise HTTPException(404, "hyphen_join stage has no clean artifact")

    artifact_path = stage_artifact_path(settings.data_root, project_id, page_id, "hyphen_join")
    if not artifact_path.exists():
        raise HTTPException(404, "hyphen_join artifact missing on disk")

    text = artifact_path.read_bytes().decode("utf-8")
    raw_candidates = detect_candidates(text)
    candidates: list[dict[str, object]] = [dict(c) for c in raw_candidates]

    return HyphenJoinCandidatesResponse(
        page_id=page_id,
        candidates=candidates,
    )


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/hyphen-join/decisions",
    operation_id="post_hyphen_join_decisions",
    response_model=None,
)
async def post_hyphen_join_decisions(
    project_id: str,
    idx0: int,
    body: HyphenJoinDecisionsRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> HyphenJoinCandidatesResponse | JSONResponse:
    """Record hyphen-join decisions and return updated candidates.

    Reads the hyphen_join stage artifact, re-detects candidates, and
    annotates each with the submitted decision where applicable.
    Returns 404 if no clean artifact is available.
    Spec: docs/specs/api-v2-deltas.md §1.9.
    """
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry_page(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    row = await db.get_page_stage(project_id, page_id, "hyphen_join")
    if row is None or row.status != "clean":
        raise HTTPException(404, "hyphen_join stage has no clean artifact")

    artifact_path = stage_artifact_path(settings.data_root, project_id, page_id, "hyphen_join")
    if not artifact_path.exists():
        raise HTTPException(404, "hyphen_join artifact missing on disk")

    text = artifact_path.read_bytes().decode("utf-8")
    raw_candidates = detect_candidates(text)

    decision_map: dict[str, str] = {}
    for d in body.decisions:
        cid = str(d.get("candidate_id", ""))
        dec = str(d.get("decision", "keep"))
        if cid:
            decision_map[cid] = dec

    candidates: list[dict[str, object]] = []
    for c in raw_candidates:
        entry: dict[str, object] = dict(c)
        cid = str(c.get("candidate_id", ""))
        if cid in decision_map:
            entry["decision"] = decision_map[cid]
        candidates.append(entry)

    return HyphenJoinCandidatesResponse(
        page_id=page_id,
        candidates=candidates,
    )
