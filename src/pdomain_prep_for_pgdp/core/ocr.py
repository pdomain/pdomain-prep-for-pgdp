"""OCR orchestration — mirrors pdomain-ocr-cli/pdomain_ocr_cli/ocr_to_txt.py.

Canonical flow (per `feedback_ocr_follows_pdomain_ocr_cli.md`):

  1. Resolve detection + recognition models (HF Hub or local files).
  2. Load the DocTR predictor ONCE per process.
  3. Load the layout detector (default: PP-DocLayout-plus-L) ONCE per process.
  4. For each page:
       a. `Document.from_image_ocr_via_doctr(img_path, ..., predictor)`
       b. `page_layout = layout_detector.detect(img_path)`
       c. `page.reorganize_page(layout=page_layout)`
       d. (optional) validate_word_preservation(pre, post)
  5. Hand `page.text` to `text_postprocess.postprocess_text()`.

Predictors and detectors are heavy (hundreds of MB of weights). Loading them
per-page is wasteful — a process-level singleton keyed by (det, reco, layout)
amortises that cost across an entire book.
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from pdomain_book_tools.hf import (
    resolve_layout_source,
    silence_transformers_load_chatter,
)
from pdomain_book_tools.hf import (
    resolve_ocr_models as resolve_ocr_models_fn,
)

from .models import BoundingBox, OcrWord, ResolvedPageConfig, SystemDefaults

if TYPE_CHECKING:
    from pathlib import Path

log = logging.getLogger(__name__)


# ─── Process-singleton predictor + layout cache ──────────────────────────────


@dataclass(frozen=True)
class _OcrModelKey:
    repo: str
    revision: str | None
    det_filename: str
    reco_filename: str
    detection_path: str | None
    recognition_path: str | None


@dataclass(frozen=True)
class _LayoutModelKey:
    layout_model: str  # "none" | "contour" | "pp-doclayout-plus-l"
    layout_checkpoint: str | None
    confidence: float
    device: str


_predictor_cache: dict[_OcrModelKey, Any] = {}
_layout_cache: dict[_LayoutModelKey, Any] = {}
_cache_lock = threading.Lock()


def _detect_torch_device() -> str:
    """Pick the best available torch device (CUDA -> MPS -> CPU)."""
    try:
        import torch  # pyright: ignore[reportMissingImports]
    except ImportError:
        return "cpu"

    try:
        if torch.cuda.is_available():
            return "cuda"
    except RuntimeError:
        log.warning("CUDA availability check raised RuntimeError; falling back to CPU", exc_info=True)
        return "cpu"

    try:
        from torch.backends import mps  # pyright: ignore[reportMissingImports]

        if mps.is_available():
            return "mps"
    except ImportError:
        pass

    return "cpu"


def get_predictor(
    *,
    repo: str = "pdomain/pdomain-ocr-models",
    revision: str | None = None,
    det_filename: str = "detection/pdomain-all-detection-model-finetuned.pt",
    reco_filename: str = "recognition/pdomain-all-recognition-model-finetuned.pt",
    detection_path: Path | None = None,
    recognition_path: Path | None = None,
) -> Any:
    """Return the process-wide DocTR predictor for these model paths.

    Loads + caches on first call. Subsequent calls with the same key are
    cheap. Thread-safe.
    """
    key = _OcrModelKey(
        repo=repo,
        revision=revision,
        det_filename=det_filename,
        reco_filename=reco_filename,
        detection_path=str(detection_path) if detection_path else None,
        recognition_path=str(recognition_path) if recognition_path else None,
    )
    with _cache_lock:
        cached = _predictor_cache.get(key)
        if cached is not None:
            return cached

        det_path, reco_path = resolve_ocr_models_fn(
            repo=repo,
            revision=revision,
            det_filename=det_filename,
            reco_filename=reco_filename,
            detection_path=detection_path,
            recognition_path=recognition_path,
        )
        from pdomain_book_tools.ocr.doctr_support import (  # pyright: ignore[reportMissingImports]
            get_finetuned_torch_doctr_predictor,
        )

        log.info("Loading DocTR predictor (det=%s, reco=%s)", det_path.name, reco_path.name)
        predictor = get_finetuned_torch_doctr_predictor(det_path, reco_path)
        if predictor is None:
            raise RuntimeError("get_finetuned_torch_doctr_predictor returned None")
        _predictor_cache[key] = predictor
        return predictor


def get_layout_detector(
    layout_model: str,
    *,
    layout_checkpoint: str | None = None,
    confidence: float = 0.5,
    device: str | None = None,
) -> Any | None:
    """Return the process-wide layout detector. None when `layout_model == "none"`."""
    if layout_model == "none":
        return None

    dev = device or _detect_torch_device()
    key = _LayoutModelKey(
        layout_model=layout_model,
        layout_checkpoint=layout_checkpoint,
        confidence=confidence,
        device=dev,
    )
    with _cache_lock:
        cached = _layout_cache.get(key)
        if cached is not None:
            return cached

        # Pre-fetch HF files so transformers' from_pretrained() is a cache hit.
        repo, revision, descriptor = resolve_layout_source(layout_model, layout_checkpoint)
        if repo is not None:
            from pdomain_book_tools.hf import prefetch_layout_files

            prefetch_layout_files(repo, revision)

        silence_transformers_load_chatter()
        from pdomain_book_tools.layout import get_detector  # pyright: ignore[reportMissingImports]

        log.info("Loading layout detector: %s (device=%s)", descriptor or layout_model, dev)
        detector = get_detector(
            layout_model,
            device=dev,
            confidence=confidence,
            checkpoint_path=layout_checkpoint,
        )
        _layout_cache[key] = detector
        return detector


# ─── Public OCR entry points ────────────────────────────────────────────────


@dataclass
class OcrPageResult:
    """In-memory result of OCR-ing a single page (or split)."""

    text: str
    words: list[OcrWord]
    page: Any  # the underlying pdomain_book_tools Page object (for serialisation)
    layout_regions: int = 0
    pre_reorg_word_count: int = 0
    post_reorg_word_count: int = 0
    dropped_word_count: int | None = None
    words_error: str | None = None  # set when bbox extraction fails (Tesseract path)


def ocr_page(
    image_path: Path,
    *,
    cfg: ResolvedPageConfig,
    system: SystemDefaults,
    predictor: Any | None = None,
    layout_detector: Any | None = None,
    do_reorg: bool = True,
    validate_reorg: bool = True,
    engine: OcrEngine | None = None,
) -> OcrPageResult:
    """OCR a single page image, mirroring `ocr_to_txt.main`'s per-page block.

    `engine=` overrides `cfg.ocr_engine` for this call only — used by
    `OcrPageRequest.engine` so the caller can force tesseract on a stubborn
    page without rewriting the per-page config.

    Steps 1-5 of `pdomain-ocr-cli/pdomain_ocr_cli/ocr_to_txt.py:430-484`:
      1. `Document.from_image_ocr_via_doctr(image_path, ..., predictor)`.
      2. `layout_detector.detect(image_path)` (when provided).
      3. snapshot pre-reorg words if `validate_reorg`.
      4. `page.reorganize_page(layout=...)`.
      5. emit warning when reorg dropped words.
    """
    if engine is not None and engine != cfg.ocr_engine:
        cfg = cfg.model_copy(update={"ocr_engine": engine})

    if cfg.ocr_engine == "tesseract":
        return _ocr_page_tesseract(image_path, cfg=cfg, system=system)

    if predictor is None:
        predictor = get_predictor()
    if layout_detector is None:
        layout_detector = get_layout_detector(
            system.layout_detector,
            layout_checkpoint=system.layout_checkpoint,
            confidence=system.layout_detector_confidence,
        )

    from pdomain_book_tools.ocr.document import Document  # pyright: ignore[reportMissingImports]

    doc = Document.from_image_ocr_via_doctr(
        image_path,
        source_identifier=image_path.name,
        predictor=predictor,
    )
    if not doc.pages:
        raise RuntimeError(f"DocTR produced no pages for {image_path}")
    page = doc.pages[0]

    page_layout = None
    layout_regions = 0
    if layout_detector is not None:
        page_layout = layout_detector.detect(image_path)
        layout_regions = len(getattr(page_layout, "regions", []) or [])

    pre_reorg = list(page.words) if validate_reorg else []
    pre_count = len(pre_reorg)

    if do_reorg and callable(getattr(page, "reorganize_page", None)):
        if page_layout is not None:
            page.reorganize_page(layout=page_layout)
        else:
            page.reorganize_page()

    post_words = list(page.words)
    post_count = len(post_words)
    dropped = 0
    if validate_reorg and do_reorg:
        try:
            from pdomain_book_tools.ocr.reorganize_page_utils import (  # pyright: ignore[reportMissingImports]
                validate_word_preservation,
            )

            drops = validate_word_preservation(pre_reorg, post_words)
            dropped = len(drops or [])
            if dropped:
                log.warning(
                    "reorganize_page dropped %d/%d words on %s",
                    dropped,
                    pre_count,
                    image_path.name,
                )
        except Exception:
            log.exception("validate_word_preservation failed; dropped_word_count set to None (unknown)")
            dropped = None  # sentinel: unknown, not "zero drops"

    return OcrPageResult(
        text=page.text or "",
        words=[_to_ocr_word(w) for w in post_words],
        page=page,
        layout_regions=layout_regions,
        pre_reorg_word_count=pre_count,
        post_reorg_word_count=post_count,
        dropped_word_count=dropped,
    )


# ─── Tesseract path ─────────────────────────────────────────────────────────


def _ocr_page_tesseract(
    image_path: Path,
    *,
    cfg: ResolvedPageConfig,
    system: SystemDefaults,
) -> OcrPageResult:
    """OCR via Tesseract — bypasses DocTR / layout / reorganize_page."""
    try:
        import pytesseract  # pyright: ignore[reportMissingImports]
        from PIL import Image  # pyright: ignore[reportMissingImports]
    except ImportError as e:
        raise RuntimeError("Tesseract path requires pytesseract + Pillow") from e

    img = Image.open(image_path)
    text = pytesseract.image_to_string(img, config=f"--dpi {cfg.ocr_dpi}")
    words: list[OcrWord] = []
    try:
        data = pytesseract.image_to_data(
            img, output_type=pytesseract.Output.DICT, config=f"--dpi {cfg.ocr_dpi}"
        )
        for i, txt in enumerate(data.get("text", [])):  # pyright: ignore[reportAttributeAccessIssue, reportArgumentType]
            if not txt or not txt.strip():
                continue
            words.append(
                OcrWord(
                    id=uuid.uuid4().hex,
                    text=txt,  # pyright: ignore[reportArgumentType]
                    confidence=float(data["conf"][i]) / 100.0  # pyright: ignore[reportArgumentType, reportCallIssue]
                    if data["conf"][i] not in (-1, "-1", "")  # pyright: ignore[reportArgumentType, reportCallIssue]
                    else 0.0,
                    bounding_box=BoundingBox(
                        left=int(data["left"][i]),  # pyright: ignore[reportArgumentType, reportCallIssue]
                        top=int(data["top"][i]),  # pyright: ignore[reportArgumentType, reportCallIssue]
                        width=int(data["width"][i]),  # pyright: ignore[reportArgumentType, reportCallIssue]
                        height=int(data["height"][i]),  # pyright: ignore[reportArgumentType, reportCallIssue]
                    ),
                )
            )
    except Exception as exc:
        log.exception("Tesseract image_to_data failed; returning text-only result")
        return OcrPageResult(
            text=text,  # pyright: ignore[reportArgumentType]  -- pytesseract returns bytes|str|dict; str is the actual return for image_to_string
            words=[],
            page=None,
            layout_regions=0,
            pre_reorg_word_count=0,
            post_reorg_word_count=0,
            dropped_word_count=0,
            words_error=f"{type(exc).__name__}: {exc}",
        )

    return OcrPageResult(
        text=text,  # pyright: ignore[reportArgumentType]  -- pytesseract returns bytes|str|dict; str is the actual return for image_to_string
        words=words,
        page=None,
        layout_regions=0,
        pre_reorg_word_count=len(words),
        post_reorg_word_count=len(words),
        dropped_word_count=0,
    )


# ─── pdomain-book-tools Word -> our OcrWord ──────────────────────────────────────


def _to_ocr_word(w: Any, split_suffix: str | None = None) -> OcrWord:
    """Adapt a ``pdomain_book_tools.ocr.word.Word`` into our wire-shape ``OcrWord``.

    Raises ``TypeError`` if ``w`` is not the expected type — silent zeros
    from a renamed API are worse than a loud crash at the boundary.
    """
    try:
        from pdomain_book_tools.ocr.word import Word as PdWord
    except ImportError as exc:
        raise RuntimeError("pdomain_book_tools is not installed") from exc

    if not isinstance(w, PdWord):
        raise TypeError(f"expected pdomain_book_tools.ocr.word.Word, got {type(w).__qualname__!r}")

    bb = w.bounding_box
    L = int(bb.minX)
    T = int(bb.minY)
    R = int(bb.maxX)
    B = int(bb.maxY)
    width = max(0, R - L)
    height = max(0, B - T)
    return OcrWord(
        id=uuid.uuid4().hex,
        text=w.text,
        confidence=float(w.ocr_confidence or 0.0),
        bounding_box=BoundingBox(left=L, top=T, width=width, height=height),
        split_suffix=split_suffix,
    )


# ─── Type re-export for callers ─────────────────────────────────────────────

OcrEngine = Literal["doctr", "tesseract"]
