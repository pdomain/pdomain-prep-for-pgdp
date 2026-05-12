"""/api/data/projects/{id}/pages/* — page CRUD."""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel

import pd_prep_for_pgdp.core.pipeline.stage_dag as _stage_dag

from ...adapters.auth import UserContext
from ...adapters.database import IDatabase
from ...adapters.gpu.cpu import load_words_from_storage, words_key_for
from ...adapters.storage import IStorage
from ...core.models import (
    PAGE_STAGE_IDS,
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
)
from ...core.pipeline.page_stage_writer import (
    StageArtifactWriteError,
    stage_artifact_path,
    stage_thumbnail_path,
)
from ...core.pipeline.stage_dag import get_stage, topological_order
from ...core.pipeline.stage_runner import (
    StageDependenciesNotMet,
    StageOutputUnsupported,
    StageRunFailed,
    cascade_dirty_for_config_change,
    run_stage,
)
from ...settings import Settings
from ..dependencies import get_database, get_settings, get_stage_events, get_storage, get_user

log = logging.getLogger(__name__)

router = APIRouter(tags=["pages"])


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


@router.get(
    "/projects/{project_id}/pages",
    response_model=ListPagesResponse,
    operation_id="list_pages",
)
async def list_pages(
    project_id: str,
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    page_type: PageType | None = Query(None),
    has_splits: bool | None = Query(None),
    status: PageProcessingStatus | None = Query(None),
    review_needed: bool | None = Query(None),
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> ListPagesResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    pages, next_cursor, total = await db.list_pages(project_id, cursor, limit)
    if page_type is not None:
        pages = [p for p in pages if p.page_type == page_type]
    if has_splits is not None:
        pages = [p for p in pages if bool(p.splits) == has_splits]
    if status is not None:
        pages = [p for p in pages if p.processing_status == status]
    if review_needed is True:
        pages = [p for p in pages if _needs_review(p)]
    if review_needed is False:
        pages = [p for p in pages if not _needs_review(p)]
    # When the caller filters, total reflects the visible page count so the
    # UI can render "N of M pages need review".
    filtered_total = (
        len(pages) if any(f is not None for f in (page_type, has_splits, status, review_needed)) else total
    )
    return ListPagesResponse(pages=pages, next_cursor=next_cursor, total=filtered_total)


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


@router.get(
    "/projects/{project_id}/pages/{idx0}",
    response_model=PageRecord,
    operation_id="get_page",
)
async def get_page(
    project_id: str,
    idx0: int,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> PageRecord:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")
    return page


@router.patch(
    "/projects/{project_id}/pages/{idx0}",
    response_model=PageRecord,
    operation_id="update_page",
)
async def update_page(
    project_id: str,
    idx0: int,
    body: UpdatePageRequest,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> PageRecord:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")
    update = body.model_dump(exclude_unset=True)
    old_overrides = page.config_overrides.model_dump()
    if "config_overrides" in update and update["config_overrides"] is not None:
        page.config_overrides = PageConfigOverrides.model_validate(update["config_overrides"])
    if "page_type" in update:
        page.page_type = body.page_type or page.page_type
    if "alignment" in update:
        page.alignment = body.alignment or page.alignment
    if "splits" in update and body.splits is not None:
        page.splits = body.splits
    if "illustration_regions" in update and body.illustration_regions is not None:
        page.illustration_regions = body.illustration_regions
    await db.put_page(page)

    # Cascade dirty to stages whose config-field sets overlap with the changed
    # config_overrides fields, so the chip rail reflects staleness immediately.
    new_overrides = page.config_overrides.model_dump()
    changed_fields = {f for f, v in new_overrides.items() if v != old_overrides.get(f)}
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
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    storage: IStorage = Depends(get_storage),
) -> UpdatePageTextResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
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
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    storage: IStorage = Depends(get_storage),
) -> GetPageTextResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
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
    words: list[OcrWord] = []
    words_key = words_key_for(text_key)
    if await storage.exists(words_key):
        try:
            raw = await storage.get_bytes(words_key)
            words = load_words_from_storage(raw)
        except Exception:
            log.exception("failed to decode words blob at %s; returning empty list", words_key)
            words = []

    return GetPageTextResponse(text=text, text_key=text_key, words=words)


def _rebuild_text_from_words(words: list[OcrWord]) -> str:
    """Reconstruct page text from a `list[OcrWord]` after a delete.

    v1 strategy (deliberately simple, see roadmap §9a "Open questions"):

    - Group words into lines via y-midpoint clustering, where two words
      share a line if their bbox y-midpoints differ by less than half
      the smaller word's height.
    - Sort each line left-to-right, join words with single spaces.
    - Join lines with `\n`.

    Paragraph breaks are NOT reconstructed — `OcrWord` doesn't carry
    paragraph boundary metadata, and round-tripping through the
    pd-book-tools layout pipeline would require re-running OCR. For
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
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    storage: IStorage = Depends(get_storage),
) -> DeleteWordsResponse:
    """Hard-delete OCR words from a page's `<root>.words.json` and
    rewrite `<root>.txt` from the survivors (roadmap §9a).

    v1 is intentionally a hard rewrite — the soft-delete-flag
    alternative is recorded in the roadmap as deferred. Unknown
    `word_ids` are silently skipped so the call is idempotent across
    retries; the response's `deleted_count` reports how many ids
    actually applied.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
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
        raise HTTPException(500, "words blob is corrupt") from exc

    drop = set(body.word_ids)
    survivors = [w for w in words if w.id not in drop]
    deleted_count = len(words) - len(survivors)

    # Even when deleted_count == 0 we rewrite — keeps the response
    # contract uniform and lets the client treat this as the canonical
    # "current state of the page" round-trip.
    new_text = _rebuild_text_from_words(survivors)
    payload = json.dumps([w.model_dump(mode="json") for w in survivors]).encode("utf-8")
    await storage.put_bytes(words_key, payload, "application/json")
    await storage.put_bytes(text_key, new_text.encode("utf-8"), "text/plain")

    return DeleteWordsResponse(
        text_key=text_key,
        words_key=words_key,
        deleted_count=deleted_count,
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
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> SplitPageResponse:
    """Create N sibling child pages by splitting a parent page.

    Spec: docs/specs/pipeline-task-model.md §"Splits as sibling pages (Q6)".
    Each child is a first-class PageRecord that runs the full DAG independently.
    Children start at post-ingest state; page_stages rows are lazy-init'd on
    first access (same contract as root pages).
    """
    if body.split_at_stage not in PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown split_at_stage: {body.split_at_stage!r}")
    if not body.suffixes:
        raise HTTPException(422, "suffixes must not be empty")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    parent = await db.get_page(project_id, idx0)
    if parent is None:
        raise HTTPException(404, "page not found")

    # Allocate idx0 values after the current maximum across all pages.
    all_pages, _, _ = await db.list_pages(project_id, cursor=None, limit=10000)
    next_idx0 = max((p.idx0 for p in all_pages), default=-1) + 1

    parent_page_id = _page_id_for_idx0(idx0)
    children: list[PageRecord] = []
    for i, suffix in enumerate(body.suffixes):
        child = PageRecord(
            project_id=project_id,
            idx0=next_idx0 + i,
            prefix=f"{parent.prefix}{suffix}",
            source_stem=parent.source_stem,
            parent_page_id=parent_page_id,
            source_crop_bbox=body.bbox,
            split_index=i + 1,
            split_at_stage=body.split_at_stage,
            split_suffix=suffix,
            reading_order=i,
        )
        children.append(child)

    await db.put_pages(children)
    return SplitPageResponse(children=children)


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
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> list[PageStageState]:
    """Return ordered per-page stage state for the 22-stage DAG.

    Spec: `docs/specs/pipeline-task-model.md` §"API surface" (§Per-page
    stage routes). Lazy-init contract (Q1-followup): if no rows exist
    yet for this page, materialise 22 ``not-run`` rows in one
    transaction (`INSERT OR IGNORE`) and return them in topological
    order. Concurrent first-touch reads converge on exactly 22 rows.

    Auth follows the existing pattern — every project read is filtered
    by `user.user_id`. 404 (not 403) is returned on miss to avoid leaking
    project existence to non-owners.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    # Lazy-init: idempotent + concurrency-safe via `INSERT OR IGNORE` on the
    # composite PK.
    await db.init_page_stages_for_page(project_id, page_id)
    rows = await db.list_page_stages_for_page(project_id, page_id)

    # Order by topological order — matches spec §"Per-page stage DAG"
    # (sources first). Stages absent from the DAG (shouldn't happen because
    # the CHECK constraint pins to PAGE_STAGE_IDS) are silently dropped.
    # Apply stage-version check: rows whose stored stage_version is behind
    # STAGE_VERSIONS are served as dirty so the UI queues a rerun.
    by_id: dict[str, PageStageState] = {r.stage_id: r for r in rows}
    ordered: list[PageStageState] = []
    for stage in topological_order():
        row = by_id.get(stage.id)
        if row is None:
            continue
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
    async_: bool = Query(False, alias="async"),
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    storage: IStorage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> Job | PageStageState:
    """Run one stage on one page synchronously and return the new row.

    Spec: `docs/specs/pipeline-task-model.md` §"Per-page stage runner"
    + §"API surface". Slice 4 ships the synchronous path for the simple
    image-processing stages (grayscale/threshold/invert today; more land
    stage-by-stage). When slow stages (`ocr`, `extract_illustrations`)
    get wired, this route gains an optional `?async=true` that returns a
    Job id instead — the chip rail will poll the job's status.

    Status codes:

    - 200: stage ran cleanly; body is the freshly-committed PageStageState.
    - 404: project not found, page not found, or cross-user access (the
      404-not-403 pattern matches the list endpoint and avoids leaking
      project existence).
    - 422: unknown `stage_id` (validated against PAGE_STAGE_IDS).
    - 409 Conflict: the stage's `depends_on` rows aren't all `clean`.
      Body names the missing parents so the UI can prompt the user to
      run them first.
    - 501 Not Implemented: the stage emits a compound output (`ocr`,
      `extract_illustrations`, `text_review`) and the multi-artifact
      writer hasn't shipped yet. Body has a clear "queued for a future
      slice" message.
    - 500: the registered stage impl raised, OR the dual-write commit
      failed. The page_stages row is already marked `failed` with the
      error_message — the chip rail's next refresh will show the
      failure inline.
    """
    if stage_id not in PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)

    # Return 422 immediately if the stage is marked not-applicable for this page.
    existing_row = await db.get_page_stage(project_id, page_id, stage_id)
    if existing_row is not None and existing_row.status == PageStageStatus.not_applicable:
        raise HTTPException(422, f"stage {stage_id!r} is not-applicable for this page type")

    if async_:
        from fastapi.responses import JSONResponse

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
        return JSONResponse(content=job.model_dump(mode="json"), status_code=202)

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
            page_source_key=page.source_key,
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
    v: str | None = None,  # cache-busting: ?v=<last_run_at>; value is ignored server-side
    if_none_match: str | None = Header(None, alias="If-None-Match"),
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    settings: Settings = Depends(get_settings),
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
    - 422: unknown stage_id (validated against PAGE_STAGE_IDS).
    """
    if stage_id not in PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
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

    output_type = get_stage(stage_id).output_type
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
    if_none_match: str | None = Header(None, alias="If-None-Match"),
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Return the pre-generated thumbnail PNG for a clean stage's output.

    Thumbnails are written at stage-write time (not generated on demand).
    404 when the stage row is not-run, not-applicable, failed, or dirty.
    ETag echoes the stage row's input_hash so the browser can revalidate.
    """
    if stage_id not in PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
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
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    stage_events=Depends(get_stage_events),
):
    """SSE — push stage-status and stage-progress events for one page.

    Subscribes to the in-process `StageEventBroker` and forwards events as
    `text/event-stream` frames. The first frame is a snapshot of current stage
    states from the database so a late subscriber sees state immediately;
    subsequent frames arrive from the broker (zero-poll).

    Channel scope: per-page (M3). Project-level subscription is deferred to M5.
    """
    from sse_starlette.sse import EventSourceResponse

    from ...core.stage_events import stage_events_key

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    page = await db.get_page(project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = _page_id_for_idx0(idx0)
    key = stage_events_key(project_id, page_id)

    async def stream():
        rows = await db.list_page_stages_for_page(project_id, page_id)
        snapshot = {
            "type": "snapshot",
            "stages": [r.model_dump(mode="json") for r in rows],
        }
        yield {"event": "snapshot", "data": json.dumps(snapshot)}

        async for ev in stage_events.subscribe(key):
            yield {"event": ev.get("type", "stage-status"), "data": json.dumps(ev)}

    return EventSourceResponse(stream())
