"""OCR orchestration — mirrors pd-ocr-cli/pd_ocr_cli/ocr_to_txt.py.

Canonical flow (per `feedback_ocr_follows_pd_ocr_cli.md`):

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
from pathlib import Path
from typing import Any, Literal

from .hf_models import (
    resolve_layout_source,
    silence_transformers_load_chatter,
)
from .hf_models import (
    resolve_ocr_models as resolve_ocr_models_fn,
)
from .models import BoundingBox, OcrWord, ResolvedPageConfig, SystemDefaults

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
        import torch  # type: ignore[import-not-found]

        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def get_predictor(
    *,
    repo: str = "CT2534/pd-ocr-models",
    revision: str | None = None,
    det_filename: str = "detection/pd-all-detection-model-finetuned.pt",
    reco_filename: str = "recognition/pd-all-recognition-model-finetuned.pt",
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
        from pd_book_tools.ocr.doctr_support import (  # type: ignore[import-not-found]
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
            from .hf_models import prefetch_layout_files

            prefetch_layout_files(repo, revision)

        silence_transformers_load_chatter()
        from pd_book_tools.layout import get_detector  # type: ignore[import-not-found]

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
    page: Any  # the underlying pd_book_tools Page object (for serialisation)
    layout_regions: int = 0
    pre_reorg_word_count: int = 0
    post_reorg_word_count: int = 0
    dropped_word_count: int = 0


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

    Steps 1-5 of `pd-ocr-cli/pd_ocr_cli/ocr_to_txt.py:430-484`:
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

    from pd_book_tools.ocr.document import Document  # type: ignore[import-not-found]

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
            from pd_book_tools.ocr.reorganize_page_utils import (  # type: ignore[import-not-found]
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
            log.exception("validate_word_preservation failed (continuing)")

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
        import pytesseract  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as e:
        raise RuntimeError("Tesseract path requires pytesseract + Pillow") from e

    img = Image.open(image_path)
    text = pytesseract.image_to_string(img, config=f"--dpi {cfg.ocr_dpi}")
    words: list[OcrWord] = []
    try:
        data = pytesseract.image_to_data(
            img, output_type=pytesseract.Output.DICT, config=f"--dpi {cfg.ocr_dpi}"
        )
        for i, txt in enumerate(data.get("text", [])):
            if not txt or not txt.strip():
                continue
            words.append(
                OcrWord(
                    id=uuid.uuid4().hex,
                    text=txt,
                    confidence=float(data["conf"][i]) / 100.0
                    if data["conf"][i] not in (-1, "-1", "")
                    else 0.0,
                    bounding_box=BoundingBox(
                        left=int(data["left"][i]),
                        top=int(data["top"][i]),
                        width=int(data["width"][i]),
                        height=int(data["height"][i]),
                    ),
                )
            )
    except Exception:
        log.exception("Tesseract image_to_data failed (returning text only)")

    return OcrPageResult(
        text=text,
        words=words,
        page=None,
        layout_regions=0,
        pre_reorg_word_count=len(words),
        post_reorg_word_count=len(words),
        dropped_word_count=0,
    )


# ─── pd-book-tools Word -> our OcrWord ──────────────────────────────────────


def _to_ocr_word(w: Any, split_suffix: str | None = None) -> OcrWord:
    """Adapt a `pd_book_tools.ocr.word.Word` into our wire-shape `OcrWord`."""
    bbox = getattr(w, "bounding_box", None) or getattr(w, "bbox", None)
    if bbox is None:
        # Fall back to attributes named L/R/T/B (the layout convention).
        L = int(getattr(w, "L", 0) or 0)
        T = int(getattr(w, "T", 0) or 0)
        R = int(getattr(w, "R", 0) or 0)
        B = int(getattr(w, "B", 0) or 0)
    else:
        L = int(getattr(bbox, "left", getattr(bbox, "L", 0)) or 0)
        T = int(getattr(bbox, "top", getattr(bbox, "T", 0)) or 0)
        R = int(
            getattr(bbox, "right", L + getattr(bbox, "width", 0))
            if hasattr(bbox, "width")
            else getattr(bbox, "R", L)
        )
        B = int(
            getattr(bbox, "bottom", T + getattr(bbox, "height", 0))
            if hasattr(bbox, "height")
            else getattr(bbox, "B", T)
        )
    width = max(0, R - L)
    height = max(0, B - T)
    return OcrWord(
        id=str(getattr(w, "id", None) or uuid.uuid4().hex),
        text=str(getattr(w, "text", "") or ""),
        confidence=float(getattr(w, "confidence", 0.0) or 0.0),
        bounding_box=BoundingBox(left=L, top=T, width=width, height=height),
        split_suffix=split_suffix,
    )


# ─── Type re-export for callers ─────────────────────────────────────────────

OcrEngine = Literal["doctr", "tesseract"]
