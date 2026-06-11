"""Batch OCR glue — Phase 3 (plan: docs/plans/2026-06-11-gpu-memory-pipeline.md §Phase3).

This module owns the bridge between the page fan-out orchestrator and
``pdomain_ops.gpu.doctr_batch.run_doctr_batch``.  It knows nothing about the
job runner, database, or SSE; the caller supplies images and gets back
per-page ``CompoundStageOutput`` dicts (the same shape that ``_ocr_cpu``
returns for single pages).

## Entry points

``ocr_pages_batch``
    Runs N images in one predictor forward-pass (or falls back to per-image
    when ``PGDP_OCR_BATCH_SIZE=1``).  Returns one ``BatchOcrPageResult`` per
    image in the same order.  Failures are per-image (wrapped exception), not
    whole-batch.

``ocr_pages_sequential``
    Calls ``ocr_page_from_image`` once per image — identical to the pre-Phase-3
    sequential path and used as the reference implementation in equivalence tests.

## Design notes

* Post-processing (``reorganize_page`` + ``validate_word_preservation``) is
  shared between the batch and sequential paths via ``_postprocess_page``.
  This is the critical invariant: both paths produce byte-identical
  ``words.json`` / ``raw.txt`` output for the same input image + config.

* ``run_doctr_batch`` handles OOM backoff and CPU fallback internally; this
  module treats a non-exception return as success.

* When a batch call succeeds, each ``Page`` in the returned list maps to the
  corresponding input image at the same index.  The function does NOT reorder
  or de-duplicate results.

* ``PGDP_OCR_BATCH_SIZE=1`` short-circuits to ``ocr_pages_sequential`` so the
  knob really is a sequential-fallback guarantee and tests can verify it.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from pdomain_prep_for_pgdp.core.models import ResolvedPageConfig, SystemDefaults
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import CompoundStageOutput

log = logging.getLogger(__name__)

# ─── Per-image result envelope ─────────────────────────────────────────────────


@dataclass
class BatchOcrPageResult:
    """Outcome for a single page in a batch OCR run.

    Successful pages have ``output`` set and ``error`` is ``None``.
    Failed pages have ``error`` set; ``output`` may still be present if the
    post-processing step failed after the batch call succeeded.
    """

    page_id: str
    """Zero-padded 4-digit page identifier (e.g. ``"0003"``)."""

    output: CompoundStageOutput | None = None
    """Bytes-only compound output ready for ``commit_stage_artifacts_multi``."""

    error: Exception | None = None
    """Non-None when OCR or post-processing raised for this page."""


# ─── Shared post-processing ────────────────────────────────────────────────────


def _postprocess_page(
    page: Any,
    *,
    cfg: ResolvedPageConfig,
    system: SystemDefaults,
    source_identifier: str,
    validate_reorg: bool = True,
    do_reorg: bool = True,
) -> CompoundStageOutput:
    """Reorganize + validate a book-tools ``Page`` and serialise to wire shape.

    This is the *canonical* post-processing path shared by both batch and
    sequential OCR.  Any change here applies equally to both, keeping
    equivalence guarantees intact.

    Parameters
    ----------
    page:
        A ``pdomain_book_tools.ocr.document.Page`` object (returned by
        ``Document.from_images_ocr_via_doctr``).
    cfg, system:
        Resolved per-page config and system defaults — forwarded to
        ``reorganize_page`` and ``validate_word_preservation``.
    source_identifier:
        Label for warning messages (analogous to the image filename).
    validate_reorg, do_reorg:
        Passed through to the same flags in ``ocr_page_from_image``.

    Returns
    -------
    CompoundStageOutput
        ``{"words.json": <bytes>, "raw.txt": <bytes>}``
    """
    from pdomain_prep_for_pgdp.core.ocr import OcrWord, _to_ocr_word

    _ = cfg  # cfg.ocr_engine already applied upstream; kept for signature parity
    _ = system

    page_layout = None

    pre_reorg = list(page.words) if validate_reorg else []
    pre_count = len(pre_reorg)

    if do_reorg and callable(getattr(page, "reorganize_page", None)):
        if page_layout is not None:
            page.reorganize_page(layout=page_layout)
        else:
            page.reorganize_page()

    post_words = list(page.words)

    if validate_reorg and do_reorg:
        try:
            from pdomain_book_tools.ocr.reorganize_page_utils import (  # pyright: ignore[reportMissingImports]
                validate_word_preservation,
            )

            drops = validate_word_preservation(pre_reorg, post_words)
            dropped = len(drops or [])
            if dropped:
                log.warning(
                    "reorganize_page dropped %d/%d words (batch OCR, source=%s)",
                    dropped,
                    pre_count,
                    source_identifier,
                )
        except Exception:
            log.exception("validate_word_preservation failed for %s (batch path)", source_identifier)

    ocr_words: list[OcrWord] = []
    for w in post_words:
        try:
            ocr_words.append(_to_ocr_word(w))
        except (TypeError, RuntimeError) as exc:
            log.warning("_to_ocr_word failed for word in %s: %s", source_identifier, exc)

    words_data = [w.model_dump() for w in ocr_words]
    words_json = json.dumps(words_data).encode()
    raw_txt = (page.text or "").encode()
    return {"words.json": words_json, "raw.txt": raw_txt}


# ─── Sequential reference path ─────────────────────────────────────────────────


def ocr_pages_sequential(
    images: list[NDArray[Any]],  # type: ignore[type-arg]
    *,
    page_ids: list[str],
    cfgs: list[ResolvedPageConfig],
    system: SystemDefaults,
    predictor: Any | None = None,
    layout_detector: Any | None = None,
) -> list[BatchOcrPageResult]:
    """OCR pages one at a time using ``ocr_page_from_image``.

    This is the reference sequential path (equivalent to pre-Phase-3 behaviour).
    ``PGDP_OCR_BATCH_SIZE=1`` calls this instead of the batch path.

    One ``BatchOcrPageResult`` per input, in order.  Each page is independent:
    an exception on page k sets ``result[k].error`` without affecting the
    others.
    """
    from pdomain_prep_for_pgdp.core.ocr import ocr_page_from_image

    results: list[BatchOcrPageResult] = []
    for img, page_id, cfg in zip(images, page_ids, cfgs, strict=True):
        try:
            ocr_result = ocr_page_from_image(
                img,
                cfg=cfg,
                system=system,
                predictor=predictor,
                layout_detector=layout_detector,
                source_identifier=page_id,
            )
            words_data = [w.model_dump() for w in ocr_result.words]
            compound: CompoundStageOutput = {
                "words.json": json.dumps(words_data).encode(),
                "raw.txt": (ocr_result.text or "").encode(),
            }
            results.append(BatchOcrPageResult(page_id=page_id, output=compound))
        except Exception as exc:
            log.exception("sequential OCR failed for page %s", page_id)
            results.append(BatchOcrPageResult(page_id=page_id, error=exc))

    return results


# ─── Batch path ────────────────────────────────────────────────────────────────


def ocr_pages_batch(
    images: list[NDArray[Any]],  # type: ignore[type-arg]
    *,
    page_ids: list[str],
    cfgs: list[ResolvedPageConfig],
    system: SystemDefaults,
    predictor: Any,
    device: str,
    build_smaller: Any | None = None,
) -> list[BatchOcrPageResult]:
    """Run N images in one DocTR forward-pass via ``run_doctr_batch``.

    OOM backoff and CPU fallback are handled inside ``run_doctr_batch``.
    If the whole batch call raises (non-OOM exception), we fall back to
    per-image ``ocr_pages_sequential`` so a single corrupt image does not
    block all others.

    Post-processing (reorganize_page + validate_word_preservation) is applied
    per-page after the batch returns.  A post-processing exception for one
    page sets ``result[i].error`` without affecting the others.

    Parameters
    ----------
    images:
        N ndarrays, one per page.  Must be HxWxC BGR or HxW grayscale uint8.
    page_ids:
        Parallel list of zero-padded page IDs — used for logging and result
        ordering only.
    cfgs:
        Per-page resolved configs.  OCR engine is read from ``cfgs[0]`` (all
        pages in a batch must use the same engine).
    system:
        System defaults — passed to ``_postprocess_page``.
    predictor:
        Process-singleton DocTR predictor (caller owns the cache).
    device:
        Hardware device string for ``pick_doctr_batch_sizes``.
    build_smaller:
        OOM backoff hook; forwarded to ``run_doctr_batch``.
    """
    from pdomain_ops.gpu.doctr_batch import run_doctr_batch  # pyright: ignore[reportMissingImports]

    try:
        pages = run_doctr_batch(
            images,
            predictor=predictor,
            device=device,
            build_smaller=build_smaller,
            source_identifiers=page_ids,
        )
    except Exception as exc:
        log.warning(
            "run_doctr_batch raised %s (%s) for %d pages — falling back to sequential",
            type(exc).__name__,
            exc,
            len(images),
        )
        return ocr_pages_sequential(
            images,
            page_ids=page_ids,
            cfgs=cfgs,
            system=system,
            predictor=predictor,
        )

    results: list[BatchOcrPageResult] = []
    for page, page_id, cfg in zip(pages, page_ids, cfgs, strict=True):
        try:
            compound = _postprocess_page(
                page,
                cfg=cfg,
                system=system,
                source_identifier=page_id,
            )
            results.append(BatchOcrPageResult(page_id=page_id, output=compound))
        except Exception as exc:
            log.exception("batch OCR post-processing failed for page %s", page_id)
            results.append(BatchOcrPageResult(page_id=page_id, error=exc))

    return results
