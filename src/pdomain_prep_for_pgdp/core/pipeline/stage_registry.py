"""STAGE_IMPL[stage_id][device] registry — flat dispatch for the per-page DAG.

Spec: `docs/specs/pipeline-task-model.md` §"Q5 — STAGE_IMPL registry"
(locked 2026-05-07).

Replaces the old GPU-backend method-dispatch hierarchy
(`LocalBackend.process_page` / `CpuBackend.process_page` / etc.) with a
flat map keyed by `(stage_id, device)`. The runner (Slice 3) will:

1. Resolve the stage's depends_on artifacts off disk.
2. Bridge them to the chosen device's canonical in-memory type
   (numpy.ndarray for cpu, cupy.ndarray for cuda — Q10).
3. Look up the callable here via `get_stage_impl(stage_id, device)`.
4. Call it.
5. Take the returned artifact, dual-write it (existing
   `commit_stage_artifact`).

This module is intentionally **thin and side-effect free**. It must not
import the runner, the writer, or anything that would create an import
cycle. The signatures here are device-canonical types only — the
runner is the one place that decides numpy-vs-cupy.

## Why a typed `StageNotImplemented` sentinel

Spec Q9 says "fail loudly" — every stage failure marks the page_stages
row `failed` with an `error_message`. The runner needs to distinguish:

- **Real bug in a registered stage** → bubble up; Q9 fail-loud, the
  message is whatever the implementation raised.
- **Stage has no implementation registered yet** → record a clear
  user-facing message ("not yet implemented in registry"), don't claim
  the engine is broken.

Built-in `NotImplementedError` is conventionally raised by abstract
methods to signal "subclass must implement this" — which is the wrong
shape for "we know this stage exists but no one wrote the code yet."
A separate exception class also lets us subclass `RuntimeError`, so
`except Exception` paths catch it without needing to know the sentinel
exists.
"""

from __future__ import annotations

import contextlib
import importlib
import logging
from collections.abc import Callable
from typing import Literal, NoReturn, Protocol, TypedDict, cast

import numpy as np
import numpy.typing as npt

from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    V2_PROJECT_STAGE_IDS,
    ResolvedPageConfig,
)

log = logging.getLogger(__name__)

type ImageArray = npt.NDArray[np.uint8]
type BBox = tuple[int, int, int, int]


class PageAttrsOutput(TypedDict):
    suggested_type: str
    suggested_alignment: str
    confidence: float
    height: int
    width: int
    h_w_ratio: float


class IllustrationRegionOutput(TypedDict):
    index: int
    label: str
    type: Literal["illustration", "decoration", "plate"]
    L: int | None
    T: int | None
    R: int | None
    B: int | None


class _AlignmentNamespace(Protocol):
    DEFAULT: object
    TOP: object
    CENTER: object
    BOTTOM: object


type JsonStageOutput = BBox | PageAttrsOutput | list[IllustrationRegionOutput]
type CompoundStageOutput = dict[str, bytes]
type StageArtifact = ImageArray | bytes | str | JsonStageOutput | CompoundStageOutput
type StageConfig = ResolvedPageConfig | None
type StageImpl = Callable[..., StageArtifact]


def _load_attr(module_path: str, attr_name: str) -> object:
    module = importlib.import_module(module_path)
    return cast("object", getattr(module, attr_name))


# ─── Sentinel exception ─────────────────────────────────────────────────────


class StageNotImplemented(RuntimeError):  # noqa: N818  # intentional: signals "not yet wired", not an error state
    """Raised by placeholder stage callables when invoked.

    The runner catches this and records the page_stages row as `failed`
    with a clear "not yet implemented in registry" message. **Not** a
    subclass of `NotImplementedError` (Q9 rationale above).
    """


def _make_placeholder(stage_id: str) -> StageImpl:
    """Build a placeholder callable for stages without a real impl yet.

    Returns a function that, when called, raises ``StageNotImplemented``
    naming the stage. Closure-bound so the message is correct without
    relying on traceback-walk hacks.
    """

    def _placeholder(*_args: object, **_kwargs: object) -> NoReturn:
        raise StageNotImplemented(
            f"stage {stage_id!r} has no implementation registered for cpu yet "
            + "(M2 placeholder — wire up in a future slice)"
        )

    _placeholder.__name__ = f"placeholder_{stage_id}"
    _placeholder.__doc__ = f"Placeholder for stage {stage_id!r} — raises StageNotImplemented."
    return _placeholder


# ─── Real implementations: pure-function chain (M2 Slice 2 + 6) ─────────────
#
# The full image-processing chain still lives in process_page.py for now;
# extracting all 22 stages atomically would be a 500-line refactor. These
# stages are the simplest pure-function transformations on a single image
# and are independent enough to wire into the registry without touching
# process_page yet.
#
# Each takes the canonical input type per `Stage.input_type` (an ndarray
# at the right shape) and returns the canonical output type. The runner
# is responsible for hashing, dual-writing, and decoding/encoding bytes
# at the disk boundary.
#
# `decode_source` / `initial_crop` / `manual_deskew_pre` are pass-through
# stages at this iteration: the runner already cv2.imdecodes parent bytes
# before calling the impl (so `decode_source` is identity in ndarray
# space), and `initial_crop` / `manual_deskew_pre` honour their
# default-config "no-op" branches (no crop / no rotation) until
# ResolvedPageConfig plumbing lands. Carving them out
# now — even as no-ops — is the load-bearing change: it makes the chain
# runnable end-to-end from `ingest_source` through `invert` without
# manual SQLite seeding, which is the M2 smoke-test pass criterion.


def _grayscale_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Convert a 3-channel BGR ndarray to a 2-D grayscale ndarray.

    Calls ``run_grayscale_pipeline(img, config, use_gpu=False)`` from
    ``pdomain_book_tools.image_processing.grayscale_pipeline`` (requires
    pdomain-book-tools >= 0.21.0, which is the pinned minimum).

    When ``cfg`` is provided, ``cfg.grayscale.model_dump()`` is passed to
    ``GrayscaleConfig.from_dict()`` to build the full pipeline config.
    When ``cfg`` is None, the default ``GrayscaleConfig()`` is used.

    Raises ``RuntimeError`` (fail-loud) if the pipeline module or its symbols
    are absent — a downgrade or incomplete install must be loud rather than
    silently discarding all grayscale tuning parameters.
    """
    from typing import Any

    try:
        run_grayscale_pipeline = cast(
            "Callable[..., ImageArray]",
            _load_attr(
                "pdomain_book_tools.image_processing.grayscale_pipeline",
                "run_grayscale_pipeline",
            ),
        )
        # GrayscaleConfig is a dynamically loaded class; use Any so the type checker
        # accepts from_dict() and __call__() without needing a stub or Protocol.
        GrayscaleConfigCls: Any = _load_attr(
            "pdomain_book_tools.image_processing.grayscale_pipeline",
            "GrayscaleConfig",
        )
    except AttributeError as exc:
        raise RuntimeError(
            "pdomain_book_tools.image_processing.grayscale_pipeline is missing "
            "run_grayscale_pipeline or GrayscaleConfig. "
            "pdomain-book-tools >= 0.21.0 is required. "
            "A downgrade or incomplete install would silently discard all grayscale "
            "tuning parameters — aborting instead."
        ) from exc

    if cfg is not None:
        gcfg = GrayscaleConfigCls.from_dict(cfg.grayscale.model_dump())
    else:
        gcfg = GrayscaleConfigCls()

    return run_grayscale_pipeline(image, gcfg, use_gpu=False)


def _threshold_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Binarise a 2-D grayscale ndarray.

    When ``cfg.threshold_level`` is set, applies a fixed-level binary threshold.
    Otherwise falls back to Otsu auto-thresholding.
    """
    if cfg is not None and cfg.threshold_level is not None:
        binary_thresh = cast(
            "Callable[..., ImageArray]",
            _load_attr("pdomain_book_tools.image_processing.cv2_processing", "binary_thresh"),
        )
        return binary_thresh(image, level=cfg.threshold_level)

    otsu_binary_thresh = cast(
        "Callable[[ImageArray], ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "otsu_binary_thresh"),
    )
    return otsu_binary_thresh(image)


def _invert_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Bitwise complement of a uint8 ndarray (`255 - x`).

    Wraps ``pdomain_book_tools.image_processing.cv2_processing.invert_image``.
    Idempotent under double-application (Q3-friendly: `invert(invert(x)) == x`).
    """
    _ = cfg
    invert_image = cast(
        "Callable[[ImageArray], ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "invert_image"),
    )
    return invert_image(image)


def _ingest_source_cpu(source_bytes: bytes, cfg: StageConfig = None) -> bytes:
    """Pass through the per-page source bytes unchanged.

    The runner reads the bytes from IStorage at the page's `source_key`
    and passes them in here. Persisting them at the canonical
    `pages/<page_id>/stages/ingest_source/output.png` path crystallises
    the chain root as a real on-disk artifact (Q3 every-intermediate-
    persistence) and gives `decode_source` a well-defined parent. The
    bytes themselves are written verbatim — the runner does NOT
    re-encode for output_type='image_bytes' stages.

    Note that the canonical filename is `output.png` regardless of the
    upload's actual format (jpg, jpeg, etc) — the writer's
    `OUTPUT_EXT_BY_TYPE` maps `image_bytes` to a single canonical
    extension. cv2.imdecode handles either format transparently when
    downstream stages read it back.
    """
    _ = cfg
    return source_bytes


def _decode_source_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Pass through the already-decoded source image unchanged.

    The runner cv2.imdecodes parent bytes before calling the impl, so by
    the time `decode_source` runs the input is already a 3-channel uint8
    ndarray. Persisting it as its own artifact (Q3 every-intermediate-
    persistence) gives `initial_crop` a well-defined parent path while
    keeping the registry impl pure in ndarray space.
    """
    _ = cfg
    return image


def _initial_crop_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Apply project/per-page initial-crop insets, or pass through at default.

    Resolves the effective crop insets from ``cfg.initial_crop`` (per-page) or
    ``cfg.initial_crop_all`` (project-wide). When all four insets are zero the
    image is forwarded unchanged.
    """
    if cfg is None:
        return image

    # Per-page override wins over project-wide default.
    crop = cfg.initial_crop or cfg.initial_crop_all
    if not any(crop):
        return image

    crop_edges = cast(
        "Callable[..., ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "crop_edges"),
    )

    L_, R_, T_, B_ = crop
    return crop_edges(image, top=T_, bottom=B_, left=L_, right=R_)


def _manual_deskew_pre_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Apply optional pre-crop flip and/or manual rotation, or pass through.

    Transform order: flip first (in source image space), then rotate.
    This matches the UI preview where CSS applies transforms left-to-right
    (``scaleX/scaleY`` before ``rotate``).

    - ``cfg.flip_horizontal`` (truthy): mirror left-right (np.flip axis=1).
    - ``cfg.flip_vertical`` (truthy): mirror top-bottom (np.flip axis=0).
    - ``cfg.deskew_before_crop`` (float, not None): rotate by that angle.
    """
    import numpy as np

    result: ImageArray = image

    if cfg is not None:
        if cfg.flip_horizontal:
            result = np.flip(result, axis=1)
        if cfg.flip_vertical:
            result = np.flip(result, axis=0)

    if cfg is not None and cfg.deskew_before_crop is not None:
        rotate_image = cast(
            "Callable[[ImageArray, float], ImageArray]",
            _load_attr("pdomain_book_tools.image_processing.cv2_processing", "rotate_image"),
        )
        result = rotate_image(result, cfg.deskew_before_crop)

    return result


# ─── Real implementations: post-invert chain (Slice 9-11) ───────────────────
#
# `find_content_edges` returns a bbox tuple (4 ints), not an ndarray.
# The runner handles this by branching on `Stage.output_type == 'bbox'`:
# it JSON-encodes the tuple and writes it as `output.json`.
#
# `crop_to_content` has two parents: an image (binary ndarray) and a bbox
# (4-tuple loaded from the JSON artifact). The runner passes both in the
# order declared in `Stage.depends_on`: (invert_image, bbox).
#
# `auto_deskew`, `morph_fill`, `rescale`, `canvas_map` are single-parent
# image->image transforms that carve out the remainder of the 4i-4n chain.


def _find_content_edges_cpu(image: ImageArray, cfg: StageConfig = None) -> BBox:
    """Find the bounding box of the content region in a binary inverted image.

    Returns (minX, maxX, minY, maxY) — the four edge coordinates passed to
    `crop_to_rectangle`. Wraps `find_edges` from pdomain_book_tools.

    The runner encodes this as a JSON list and writes it to `output.json`.
    """
    _ = cfg
    find_edges = cast(
        "Callable[[ImageArray], BBox]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "find_edges"),
    )
    return find_edges(image)


def _crop_to_content_cpu(image: ImageArray, bbox: BBox, cfg: StageConfig = None) -> ImageArray:
    """Crop the binary image to the content bounding box (W1.8).

    ``image`` is the inverted binary ndarray (from ``invert``);
    ``bbox`` is (minX, maxX, minY, maxY) from ``find_content_edges``.

    Wraps ``crop_to_rectangle``.  When ``cfg.white_space_additional`` is set,
    an additional fractional whitespace pad is added around the bbox before
    cropping.  The pad tuple is ``(top, bottom, left, right)`` fractions of the
    image height/width respectively.  For example (0.05, 0.05, 0.05, 0.05)
    adds 5% padding on each side.
    """
    crop_to_rectangle = cast(
        "Callable[[ImageArray, int, int, int, int], ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "crop_to_rectangle"),
    )
    minX, maxX, minY, maxY = bbox

    # W1.8: apply fractional whitespace padding when configured.
    pad = cfg.white_space_additional if cfg is not None else None
    if pad is not None:
        h, w = cast("tuple[int, int]", image.shape[:2])
        pad_top, pad_bottom, pad_left, pad_right = pad
        minY = max(0, minY - int(h * pad_top))
        maxY = min(h, maxY + int(h * pad_bottom))
        minX = max(0, minX - int(w * pad_left))
        maxX = min(w, maxX + int(w * pad_right))

    return crop_to_rectangle(image, minX, maxX, minY, maxY)


def _auto_deskew_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Auto-deskew the binary content image.

    Respects ``cfg.skip_auto_deskew`` (W1.3).  When True the image is returned
    unchanged.  Registry default is ``skip_auto_deskew=True`` (i.e. deskew is
    OFF by default; users opt in via settings or per-page override).
    """
    # W1.3: honour skip flag (default True = skip).
    if cfg is None or cfg.skip_auto_deskew:
        return image

    auto_deskew = cast(
        "Callable[..., ImageArray | tuple[ImageArray, object, object]]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "auto_deskew"),
    )
    out = auto_deskew(image, pct=0.30)
    # `auto_deskew` may return either a bare ndarray or a (ndarray, angle) tuple.
    if isinstance(out, tuple):
        return out[0]
    return out


def _morph_fill_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Apply morphological fill to close small gaps in text strokes.

    Controlled by ``cfg.do_morph`` (W1.4).  When False (the default) the
    image is returned unchanged — this is the safe opt-in pattern: users
    enable morph_fill when they see disconnected glyphs in the deskewed image.
    """
    # W1.4: honour do_morph flag (default False = skip).
    if cfg is None or not cfg.do_morph:
        return image

    morph_fill = cast(
        "Callable[[ImageArray], ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "morph_fill"),
    )
    return morph_fill(image)


def _rescale_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Re-invert + rescale to canonical aspect ratio.

    Calls `rescale_image(invert_image(img_deskewed), target_short_side=1000)`.
    The inversion here is intentional: `morph_fill` outputs a binary image with
    text=255/bg=0; `rescale_image` expects text=0/bg=255 (white-on-black).
    The inversion restores that convention before scaling.
    """
    _ = cfg
    invert_image = cast(
        "Callable[[ImageArray], ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "invert_image"),
    )
    rescale_image = cast(
        "Callable[..., ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "rescale_image"),
    )
    return rescale_image(invert_image(image), target_short_side=1000)


def _canvas_map_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Map the rescaled image onto a canonical canvas.

    Wraps ``map_content_onto_scaled_canvas`` with alignment and h/w ratio
    read from ``cfg`` (W1.5).

    - ``cfg.alignment`` — ``AlignmentOverride`` enum; maps to Alignment.DEFAULT,
      Alignment.CENTER, Alignment.TOP, or Alignment.BOTTOM.
    - ``cfg.page_h_w_ratio`` — canvas aspect ratio.  Defaults to 1.294 (US Letter
      ~8.5:11).  Stage settings can supply a different ratio (e.g. A4 = 1.414).

    Returns an ndarray; the runner encodes it to PNG (output_type='image_bytes').
    """
    from pdomain_prep_for_pgdp.core.models import AlignmentOverride

    # Resolve cfg values (W1.5)
    ratio = cfg.page_h_w_ratio if cfg is not None else 1.294
    alignment_override = cfg.alignment if cfg is not None else AlignmentOverride.default

    alignment_ns = cast(
        "_AlignmentNamespace",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "Alignment"),
    )
    map_content_onto_scaled_canvas = cast(
        "Callable[..., ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "map_content_onto_scaled_canvas"),
    )

    # Map AlignmentOverride enum values to the book-tools Alignment constants.
    _align_map: dict[str, object] = {
        AlignmentOverride.default.value: alignment_ns.DEFAULT,
        AlignmentOverride.top.value: alignment_ns.TOP,
        AlignmentOverride.center.value: alignment_ns.CENTER,
        AlignmentOverride.bottom.value: alignment_ns.BOTTOM,
    }
    force_align = _align_map.get(alignment_override.value, alignment_ns.DEFAULT)

    return map_content_onto_scaled_canvas(
        image,
        force_align=force_align,
        height_width_ratio=ratio,
    )


# ─── Real implementations: blank-page branch (M2 Slice 12) ─────────────────
#
# `auto_detect_attrs` runs immediately after `ingest_source` and outputs a
# JSON dict (output_type='page_attrs') with page-type hints and the source
# image's h/w ratio. The runner JSON-encodes this dict and writes it to
# output.json.
#
# `blank_proof_synth` reads the page_attrs dict and returns an ndarray of
# a synthesised blank white page at the detected aspect ratio. The runner
# PNG-encodes the ndarray (output_type='image_bytes').


def _auto_detect_attrs_cpu(image: ImageArray, cfg: StageConfig = None) -> PageAttrsOutput:
    """Detect page attributes from a decoded source image ndarray.

    The runner loads the `ingest_source` parent artifact as an ndarray (via
    cv2.imdecode, because `ingest_source` has `output_type='image_bytes'`
    which is in `_IMAGE_OUTPUT_TYPES`). This impl therefore receives a
    BGR ndarray and re-encodes it to PNG bytes so `detect_page_attributes`
    can run its heuristics. This double encode/decode round-trip is
    intentional — it keeps the impl pure in ndarray space (matching the
    runner's contract for all other image-in stages) while reusing the
    existing heuristic function that accepts bytes.

    Returns a dict with:

    - ``suggested_type``: string page type ("blank", "normal", "plate_p", …)
    - ``suggested_alignment``: string alignment hint ("default", "center")
    - ``confidence``: float detection confidence
    - ``height``, ``width``: source image dimensions in pixels
    - ``h_w_ratio``: height / width (used by blank_proof_synth + canvas_map)

    The runner JSON-serialises this dict and writes it to `output.json`.
    """
    import cv2

    from pdomain_prep_for_pgdp.core.auto_detect import detect_page_attributes

    _ = cfg
    # Re-encode the ndarray to PNG bytes so detect_page_attributes can parse.
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("cv2.imencode failed in auto_detect_attrs")
    png_bytes = bytes(buf.tobytes())

    suggestion = detect_page_attributes(png_bytes)
    height, width = cast("tuple[int, int]", image.shape[:2])
    h_w_ratio = height / width if width > 0 else 1.65

    return {
        "suggested_type": suggestion.suggested_type.value,
        "suggested_alignment": suggestion.suggested_alignment.value,
        "confidence": suggestion.confidence,
        "height": height,
        "width": width,
        "h_w_ratio": h_w_ratio,
    }


def _blank_proof_synth_cpu(page_attrs: PageAttrsOutput, cfg: StageConfig = None) -> ImageArray:
    """Synthesise a blank proofing image for blank / plate-b / plate-r pages.

    Takes the `page_attrs` dict from `auto_detect_attrs` and returns an
    ndarray of a white page at the detected aspect ratio. The runner
    PNG-encodes the result (output_type='image_bytes').

    Uses `h_w_ratio` from the detected page attributes. Falls back to 1.65
    (US-Letter proportions) when the field is absent or zero.
    """
    import numpy as np

    _ = cfg
    h_w_ratio = float(page_attrs.get("h_w_ratio") or 1.65)
    short_side = 1000
    if h_w_ratio >= 1.0:
        height = max(short_side, int(short_side * h_w_ratio))
        width = short_side
    else:
        width = max(short_side, int(short_side / h_w_ratio))
        height = short_side

    return np.full((height, width), 255, dtype=np.uint8)


# ─── Real implementations: ocr_crop (M2 Slice 13) ───────────────────────────
#
# `ocr_crop` reads the proofing image (from either `canvas_map` or
# `blank_proof_synth`) and applies the uniform OCR crop margin and any
# configured page splits. The runner passes the proofing artifact as an
# ndarray (decoded from the image_bytes parent).
#
# At default config (no ocr_crop margin, no splits), `ocr_crop` is a
# pass-through: the ndarray is returned unchanged. The runner PNG-encodes
# the result (output_type='image_bytes').
#
# ResolvedPageConfig plumbing (actual `cfg.ocr_crop` values and per-page
# splits for sibling-page crops) lands when the runner wires cfg into
# stage impls (M3). Until then the impl always takes the no-crop branch.


def _ocr_crop_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Apply the OCR-crop margin to the proofing image (W1.7).

    Reads ``cfg.ocr_crop``: a 4-tuple ``(top, bottom, left, right)`` in pixels.
    All-zero is a pass-through (default).

    The page-split branch (multiple crops → sibling pages) is handled at the
    project level and is NOT part of this stage impl.  That path remains on the
    W4 routes backlog.

    Trims are clamped so they cannot exceed the image bounds.
    """
    ocr_crop = cfg.ocr_crop if cfg is not None else (0, 0, 0, 0)
    top, bottom, left, right = ocr_crop
    if top == 0 and bottom == 0 and left == 0 and right == 0:
        return image

    h, w = cast("tuple[int, int]", image.shape[:2])
    y1 = max(0, top)
    y2 = max(y1 + 1, h - bottom)
    x1 = max(0, left)
    x2 = max(x1 + 1, w - right)
    return cast("ImageArray", image[y1:y2, x1:x2])


# ─── Real implementations: thumbnail + auto_detect_illustrations + text_postprocess (Slice 13) ──

# These three complete the set of single-artifact stages in the DAG.
# The remaining placeholder (`extract_illustrations`) requires compound
# output (hi_res_crops); its multi-artifact path is wired but the
# illustration-crop logic is deferred until M3.


def _thumbnail_cpu(image: ImageArray, cfg: StageConfig = None) -> bytes:
    """Resize and JPEG-encode the source image for workbench thumbnail display.

    The runner loads the `ingest_source` artifact as an ndarray (output_type
    'image_bytes' is in `_IMAGE_OUTPUT_TYPES` → cv2.imdecode). This impl
    resizes to fit inside 300px on the short side and encodes to JPEG at
    quality 85 — matching `_make_thumbnail_bytes` in `core/ingest.py`.

    Returns bytes; the runner's `jpeg_bytes` output-type path writes them
    verbatim as `output.jpg`.
    """
    import cv2

    _ = cfg
    _THUMBNAIL_MAX_DIM = 300
    _THUMBNAIL_QUALITY = 85

    img: ImageArray = image
    h, w = cast("tuple[int, int]", img.shape[:2])
    short = min(h, w)
    if short > _THUMBNAIL_MAX_DIM:
        scale = _THUMBNAIL_MAX_DIM / short
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
        img = cast("ImageArray", cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA))

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), _THUMBNAIL_QUALITY])
    if not ok:
        raise RuntimeError("cv2.imencode(.jpg) failed in _thumbnail_cpu")
    return bytes(buf.tobytes())


def _auto_detect_illustrations_cpu(
    image: ImageArray, cfg: StageConfig = None
) -> list[IllustrationRegionOutput]:
    """Detect illustration regions in a source image ndarray.

    Loads the layout detector (the same process-singleton as in
    `auto_detect_attrs`) and runs it on the image. If the layout model is
    not installed / available, returns an empty list — the stage transitions
    to `clean` with `[]` JSON, which is the correct representation of
    "no illustrations detected".

    Returns a list of dicts; the runner JSON-serialises this list and writes
    it to `output.json` (output_type='illustration_regions').
    """
    import cv2

    _ = cfg
    # Try loading the layout detector from pdomain_book_tools. This is a heavy
    # optional dependency (model weights); if absent, fall back to no-op.
    # Only ImportError is caught — runtime errors (CUDA init, OOM, …) propagate
    # so the stage is marked `failed` rather than silently producing no regions.
    try:
        get_layout_detector = cast(
            "Callable[[], object | None]", _load_attr("pdomain_book_tools.layout", "get_layout_detector")
        )
        detector = get_layout_detector()
    except (AttributeError, ImportError):
        detector = None

    if detector is None:
        return []

    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("cv2.imencode failed in _auto_detect_illustrations_cpu")

    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        _ = tmp.write(bytes(buf.tobytes()))
        tmp_path = Path(tmp.name)

    try:
        from pdomain_prep_for_pgdp.core.illustrations import auto_detect_illustrations

        regions = auto_detect_illustrations(
            tmp_path,
            layout_detector=detector,
            confidence_threshold=0.5,
        )
    finally:
        with contextlib.suppress(OSError):
            tmp_path.unlink()

    return [
        {"index": r.index, "label": r.label, "type": r.type, "L": r.L, "T": r.T, "R": r.R, "B": r.B}
        for r in regions
    ]


def _text_postprocess_cpu(text_bytes: object, cfg: StageConfig = None) -> str:
    """Apply step-8 normalisation to OCR text at default config.

    At default config (no per-project scannos, no custom regex, no
    hyphenation word list), applies only the two universal transforms:
    curly-quote normalisation and em-dash → double-hyphen conversion.
    The full `postprocess_text` function requires `SystemDefaults` and
    `ProjectConfig` which the runner doesn't have yet (M3 config plumbing).

    `text_bytes` is raw bytes from the `ocr` stage's artifact dir; the
    runner scans the dir for `output.*` and passes the first file's bytes.
    With `ocr` now handled by the multi-artifact writer (Slice 14), this
    stage is fully runnable end-to-end.

    Returns a str; the runner's `text` output-type path encodes it to UTF-8
    and writes `output.txt`.
    """
    from pdomain_prep_for_pgdp.core.text_postprocess import normalize_curly_quotes, normalize_em_dash

    _ = cfg
    if isinstance(text_bytes, (bytes, bytearray)):
        text = text_bytes.decode(errors="replace")
    else:
        text = str(text_bytes)

    text = normalize_curly_quotes(text)
    return normalize_em_dash(text)


# ─── Real implementations: denoise (B2) ─────────────────────────────────────
#
# `denoise` sits between `deskew` and `dewarp` in the v2 DAG.
# Polarity contract: the v2 pipeline after `threshold` uses text=255/bg=0
# (inverted binary). `denoise_binary` in pdomain-book-tools expects text=0/bg=255.
# The impl inverts, calls denoise_binary, inverts back.
#
# Requires: pdomain-book-tools local main (not in pinned v0.17.1 release).
# See B2 commit for DEP APPROACH details.


def _denoise_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Remove speckle noise from the deskewed binary page image.

    Polarity bridge: the v2 pipeline carries text=255/bg=0 (from threshold+invert).
    ``denoise_binary`` in pdomain-book-tools expects text=0/bg=255.
    This impl:
      1. Inverts the input to text=0/bg=255.
      2. Calls ``denoise_binary`` (connected-component area filter).
      3. Inverts the result back to text=255/bg=0.

    At default config (``cfg.skip_denoise`` is False, ``min_component_area=6``)
    speckle is removed while genuine glyphs (area ≥ 6 px²) are preserved.
    When ``cfg.skip_denoise`` is True (or cfg is None and the stage is configured
    to skip), the image is passed through unchanged.
    """
    import cv2

    # Skip if explicitly configured
    if cfg is not None and cfg.skip_denoise:
        return image

    # Resolve tunable params from cfg (W1.2) — fall back to registry defaults
    # when cfg is None (direct test calls without a full ResolvedPageConfig).
    min_area = cfg.denoise_min_component_area if cfg is not None else 6
    med_kernel = cfg.denoise_median_kernel_size if cfg is not None else 0

    # Bridge: text=255→text=0 for denoise_binary
    inverted = cast("ImageArray", cv2.bitwise_not(image))

    denoise_binary = cast(
        "Callable[..., ImageArray]",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "denoise_binary"),
    )
    cleaned_inv = denoise_binary(inverted, min_component_area=min_area, median_kernel_size=med_kernel)

    # Bridge back: text=0→text=255
    return cast("ImageArray", cv2.bitwise_not(cleaned_inv))


# ─── Real implementations: dewarp (B2) ───────────────────────────────────────
#
# `dewarp` sits between `denoise` and `post_transform_crop` in the v2 DAG.
# Uses ``TextlineDisparityDewarp`` from pdomain-book-tools geometry_correction.
# Polarity: receives text=255/bg=0 — the dewarp backend handles binary images by
# internally using Otsu if needed; since the image is already binary (all values
# are 0 or 255), the disparity maps are computed from the existing intensity.
# The ``apply`` method (cv2.remap) is polarity-neutral; the output keeps the
# same text=255/bg=0 convention.
# If fewer than min_textlines are found, DewarpResult.confidence=0 and
# GeometryTransform.identity is returned → identity pass-through.
#
# Requires: pdomain-book-tools local main (geometry_correction package).


def _dewarp_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Apply textline-disparity dewarp to the denoised binary page.

    Wraps ``TextlineDisparityDewarp`` from pdomain-book-tools
    ``geometry_correction``.  On insufficient textlines (low confidence),
    returns an identity pass-through.

    Polarity: input and output are text=255/bg=0 — the cv2.remap in
    ``GeometryTransform.apply`` is polarity-neutral; no conversion needed.

    After applying the warp, the output is thresholded back to binary
    (0/255) because remap introduces sub-pixel interpolation artifacts.
    """
    import cv2

    _ = cfg
    TextlineDisparityDewarp = cast(
        "type",
        _load_attr("pdomain_book_tools.geometry_correction", "TextlineDisparityDewarp"),
    )

    dewarper = TextlineDisparityDewarp(prefer_gpu=False)
    result = dewarper.estimate(image)

    # identity when confidence is 0 (not enough textlines)
    transform = result.transform  # type: ignore[attr-defined]
    warped = transform.apply(image)

    # Re-binarise after interpolation (remap may introduce intermediate values)
    _, binary = cv2.threshold(
        cast("ImageArray", warped).astype(np.uint8),
        127,
        255,
        cv2.THRESH_BINARY,
    )
    return cast("ImageArray", binary)


# ─── Real implementations: post_transform_crop (B2) ─────────────────────────
#
# `post_transform_crop` sits between `dewarp` and `text_zones` / `canvas_map`
# in the v2 DAG. At default config it is a pass-through; the full crop logic
# (user-adjustable post-transform insets) lands when config plumbing is wired
# (B5 routes). This is structurally identical to `post_ocr_crop`.


def _post_transform_crop_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """Apply optional post-transform crop insets to the dewarped binary image.

    Reads ``cfg.post_transform_crop_insets`` (W1.6): a 4-tuple
    ``(top, bottom, left, right)`` in pixels.  All-zero is a pass-through.

    Insets are clamped so they cannot exceed the image bounds.  The result is
    always at least a 1-row, 1-column slice.
    """
    # Default: no-op when cfg is absent or all insets are zero.
    insets = cfg.post_transform_crop_insets if cfg is not None else (0, 0, 0, 0)
    top, bottom, left, right = insets
    if top == 0 and bottom == 0 and left == 0 and right == 0:
        return image

    h, w = cast("tuple[int, int]", image.shape[:2])
    y1 = max(0, top)
    y2 = max(y1 + 1, h - bottom)
    x1 = max(0, left)
    x2 = max(x1 + 1, w - right)
    return cast("ImageArray", image[y1:y2, x1:x2])


# ─── Real implementations: ocr + text_review (Slice 14) ─────────────────────
#
# `ocr` is the first compound-output stage in the registry: it emits
# `words.json` (JSON array of OcrWord dicts) + `raw.txt` (plain OCR text).
# The runner's compound-output branch (added Slice 14) routes the returned
# dict[str, bytes] through `commit_stage_artifacts_multi`.
#
# `text_review` is a gate stage: the human reviewer has confirmed the text.
# At default config (no edit) it trivially copies the `text_postprocess`
# output into `output.txt` and writes an empty `attestation.json`.  The
# workbench's "Mark clean" button fires the `POST .../text_review/clean`
# route which bypasses the runner entirely; this impl exists so `run_stage`
# can be called programmatically (e.g. in batch mode) without raising
# StageNotImplemented.


def default_resolved_page_config() -> ResolvedPageConfig:
    """Build a minimal ResolvedPageConfig with all-default values.

    Used by stage impls that haven't yet received ResolvedPageConfig plumbing
    (M3 work). Callers must not assume any per-page override fields are set.
    """
    from pdomain_prep_for_pgdp.core.models import AlignmentOverride, PageType, ResolvedPageConfig

    return ResolvedPageConfig(
        text_threshold=140,
        page_h_w_ratio=1.65,
        fuzzy_pct=0.02,
        pixel_count_columns=150,
        pixel_count_rows=75,
        ocr_bbox_edge_min_words=5,
        ocr_engine="doctr",
        ocr_model_key=None,
        ocr_dpi=150,
        initial_crop_all=(0, 0, 0, 0),
        ocr_crop=(0, 0, 0, 0),
        page_type=PageType.normal,
        alignment=AlignmentOverride.default,
        initial_crop=None,
        white_space_additional=None,
        threshold_level=None,
        skip_auto_deskew=True,
        deskew_before_crop=None,
        deskew_after_crop=None,
        do_morph=False,
        skip_denoise=False,
        use_ocr_bbox_edge=False,
        rotated_standard=False,
        single_dimension_rescale=False,
        flip_horizontal=False,
        flip_vertical=False,
        # W1 stage-settings fields
        denoise_min_component_area=6,
        denoise_median_kernel_size=0,
        post_transform_crop_insets=(0, 0, 0, 0),
    )


def _ocr_cpu(image: ImageArray, cfg: StageConfig = None) -> CompoundStageOutput:
    """Run OCR on the proofing image and emit words.json + raw.txt.

    Accepts the ndarray from `ocr_crop` (output_type='image_bytes' decoded
    by the runner or passed directly from the stage cache). Calls
    ``ocr_page_from_image`` with the ndarray — no temp file I/O (Phase 1).

    Serialises OcrPageResult.words to ``words.json`` (JSON array of OcrWord
    dicts) and OcrPageResult.text to ``raw.txt`` (UTF-8).

    The multi-artifact writer (Slice 14) routes the returned
    ``dict[str, bytes]`` via ``commit_stage_artifacts_multi``.

    OCR engine: defaults to doctr (system default). Tests override by
    passing an image through the runner with PGDP_OCR_ENGINE=tesseract
    (handled inside ``ocr_page_from_image`` via ``SystemDefaults``).
    """
    import json
    import os

    from pdomain_prep_for_pgdp.core.models import SystemDefaults
    from pdomain_prep_for_pgdp.core.ocr import ocr_page_from_image

    if cfg is None:
        cfg = default_resolved_page_config()

    # Honour PGDP_OCR_ENGINE env var so tests can force tesseract without
    # loading DocTR weights.
    ocr_engine = os.environ.get("PGDP_OCR_ENGINE")
    if ocr_engine in ("tesseract", "doctr"):
        cfg = cfg.model_copy(update={"ocr_engine": ocr_engine})

    system = SystemDefaults(ocr_engine=cfg.ocr_engine)

    # Phase 1: call the ndarray API directly — no cv2.imwrite / tempfile.
    result = ocr_page_from_image(image, cfg=cfg, system=system)
    if result.words_error:
        log.warning(
            "OCR words extraction failed (words.json will be empty): %s",
            result.words_error,
        )

    words_data = [w.model_dump() for w in result.words]
    words_json = json.dumps(words_data).encode()
    raw_txt = (result.text or "").encode()
    return {"words.json": words_json, "raw.txt": raw_txt}


def _text_review_cpu(
    text_bytes: object,
    regex_bytes: object = None,
    cfg: StageConfig = None,
) -> CompoundStageOutput:
    """Gate stage — copy the final reviewed text as the output.

    In v1 the single parent is ``text_postprocess`` and ``text_bytes`` is that
    output.  In v2 the two parents are ``hyphen_join`` (positional arg 0) and
    ``regex`` (positional arg 1 = ``regex_bytes``).  When called from the v2
    runner, ``regex_bytes`` is the final processed text and is used as the
    reviewed text; ``text_bytes`` (the hyphen_join output) is available for
    context but not currently surfaced in the output.

    At default config (no human edit) this is an identity pass: the
    output.txt artifact is the final text result verbatim, and
    attestation.json records an empty object.  The 'Mark clean' UI button
    (``POST .../text_review/clean``) short-circuits this by marking the DB
    row clean directly without running the stage; this impl exists so
    batch-mode callers can fire the stage programmatically.

    Returns dict[str, bytes] with 'output.txt' and 'attestation.json'.
    """
    import json

    _ = cfg
    # v2 path: use regex_bytes (the regex-processed text) as the reviewed text.
    # v1 path: use text_bytes directly (text_postprocess output).
    primary = regex_bytes if regex_bytes is not None else text_bytes
    text = bytes(primary) if isinstance(primary, (bytes, bytearray)) else str(primary).encode()

    attestation = json.dumps({}).encode()
    return {"output.txt": text, "attestation.json": attestation}


# ─── Registry assembly ──────────────────────────────────────────────────────

# Real implementations registered for cpu. Keys must be in `V2_PAGE_STAGE_IDS`.
_REAL_CPU_IMPLS: dict[str, StageImpl] = {
    "ingest_source": _ingest_source_cpu,
    "decode_source": _decode_source_cpu,
    "initial_crop": _initial_crop_cpu,
    "manual_deskew_pre": _manual_deskew_pre_cpu,
    "grayscale": _grayscale_cpu,
    "threshold": _threshold_cpu,
    "invert": _invert_cpu,
    # Slices 9-11: post-invert proofing chain through canvas_map.
    "find_content_edges": _find_content_edges_cpu,
    "crop_to_content": _crop_to_content_cpu,
    "auto_deskew": _auto_deskew_cpu,
    "morph_fill": _morph_fill_cpu,
    "rescale": _rescale_cpu,
    "canvas_map": _canvas_map_cpu,
    # Slice 12: blank-page branch.
    "auto_detect_attrs": _auto_detect_attrs_cpu,
    "blank_proof_synth": _blank_proof_synth_cpu,
    # Slice 13: ocr_crop + remaining single-artifact stages.
    "ocr_crop": _ocr_crop_cpu,
    "thumbnail": _thumbnail_cpu,
    "auto_detect_illustrations": _auto_detect_illustrations_cpu,
    "text_postprocess": _text_postprocess_cpu,
    # Slice 14: compound-output stages (multi-artifact writer).
    "ocr": _ocr_cpu,
    "text_review": _text_review_cpu,
}


def _build_registry() -> dict[str, dict[str, StageImpl]]:
    """Materialise STAGE_IMPL once at import time (v1 stage IDs → v1 impls).

    V1 registry is retained for use by stage_runner.run_stage() which handles
    both v1 and v2 stage IDs. For v2 IDs, get_stage_impl() falls through to
    V2_STAGE_IMPL. See V2 registry section below for the v2 path.
    """
    registry: dict[str, dict[str, StageImpl]] = {}
    for sid, impl in _REAL_CPU_IMPLS.items():
        registry[sid] = {"cpu": impl}
    return registry


STAGE_IMPL: dict[str, dict[str, StageImpl]] = _build_registry()
"""V1 dispatch table (legacy). Keys: v1 stage_id (str) → device (str) → callable.

get_stage_impl() routes v2 stage IDs to V2_STAGE_IMPL instead.
"""


_DEVICE_TO_IMPL_KEY: dict[str, str] = {
    "cuda": "gpu",
    "gpu": "gpu",
    "cpu": "cpu",
}
"""Normalize an arbitrary device string to the registry impl key.

The GPU dispatcher / ``pick_device`` produces ``"cuda"`` for CUDA devices,
but registry entries are keyed ``"gpu"``.  Any unrecognised device string
(e.g. ``"mps"``, ``"xpu"``) falls back to ``"cpu"`` — the stage is always
runnable on CPU and it is safer to degrade than to raise a ``KeyError``.
"""


def get_stage_impl(stage_id: str, device: str) -> StageImpl:
    """Return the callable registered for ``(stage_id, device)``.

    Routes v2 stage IDs (V2_PAGE_STAGE_IDS + V2_PROJECT_STAGE_IDS) to
    V2_STAGE_IMPL. Routes legacy v1 IDs to STAGE_IMPL (still used by
    page_stage_writer fallback path).

    Device normalization:
      - ``"cuda"`` / ``"gpu"`` → look up ``"gpu"`` impl key.
      - ``"cpu"`` → ``"cpu"`` impl key.
      - Any unknown device string → ``"cpu"`` (safe fallback).
    If a stage has no GPU impl (``"gpu"`` key absent), falls back to the
    ``"cpu"`` impl rather than raising ``KeyError``.
    """
    # Normalize the device string to an impl key.
    impl_key = _DEVICE_TO_IMPL_KEY.get(device, "cpu")

    # V2 IDs always route to V2_STAGE_IMPL (defined after this function;
    # by call-time the module is fully loaded so the name resolves).
    if stage_id in V2_PAGE_STAGE_IDS or stage_id in V2_PROJECT_STAGE_IDS:
        devices = V2_STAGE_IMPL[stage_id]
        # CPU fallback: if the requested impl key is absent, use "cpu".
        return devices.get(impl_key) or devices["cpu"]
    devices = STAGE_IMPL[stage_id]
    return devices.get(impl_key) or devices["cpu"]


# ─── V2 registry (stage-registry-v2.md §2) ──────────────────────────────────
#
# V2_STAGE_IMPL maps every v2 stage ID (24 total: 16 page-scoped + 8
# project-scoped) to its cpu callable. Stages that already have a real
# implementation in _REAL_CPU_IMPLS are reused — the v2 runner dispatches
# them after mapping v2 stage IDs to the correct v1 impls via _V2_IMPL_MAP.
# Genuinely new stages (denoise, dewarp, text_zones, wordcheck, hyphen_join,
# post_transform_crop, page_order, validation, proof_pack, build_package,
# zip, submit_check, archive) get placeholders until B2-B4 land.
#
# Composed stage mappings (v2 stage → v1 step functions):
#   source       → (_ingest_source_cpu + _thumbnail_cpu + _auto_detect_attrs_cpu + _decode_source_cpu)
#   grayscale    → (_manual_deskew_pre_cpu [pre-crop] + _grayscale_cpu)
#   crop         → (_initial_crop_cpu + _find_content_edges_cpu + _crop_to_content_cpu)
#   threshold    → (_threshold_cpu + _invert_cpu)
#   deskew       → (_manual_deskew_pre_cpu [post-crop] + _auto_deskew_cpu)
#   canvas_map   → (_morph_fill_cpu + _rescale_cpu + _canvas_map_cpu [+ blank_proof_synth branch])
#   post_ocr_crop → _ocr_crop_cpu
#   ocr          → _ocr_cpu
#   regex        → _text_postprocess_cpu
#   text_review  → _text_review_cpu
#   illustrations → (_auto_detect_illustrations_cpu + extract_illustrations placeholder)
#
# See Behavior 2 tests (test_composed_stage_execution.py) for the artifact
# equivalence contract.

# Composed stage impls that chain the v1 step functions in order.
# Each receives the input artifact appropriate for the v2 stage's input_type.


def _source_cpu(source_bytes: bytes, cfg: StageConfig = None) -> bytes:
    """v2 source stage: pass through source bytes (project-scope, ingest is separate).

    The full source stage (ingest + thumbnail + attrs + decode) runs via the
    project-stage runner. This cpu impl is a placeholder that passes through
    the bytes; the runner handles the four sub-steps separately.
    """
    return _ingest_source_cpu(source_bytes, cfg)


def _grayscale_v2_cpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 grayscale stage: pre-crop flip/rotate then grayscale.

    Folds manual_deskew_pre (pre-crop component) into the source-to-gray path.
    """
    flipped = _manual_deskew_pre_cpu(image, cfg)
    return _grayscale_cpu(flipped, cfg)


def _crop_v2_cpu(gray: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 crop stage: initial_crop → find_content_edges → crop_to_content."""
    cropped = _initial_crop_cpu(gray, cfg)
    bbox = _find_content_edges_cpu(cropped, cfg)
    return _crop_to_content_cpu(cropped, bbox, cfg)


def _threshold_v2_cpu(binary: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 threshold stage: threshold + invert."""
    thresh = _threshold_cpu(binary, cfg)
    return _invert_cpu(thresh, cfg)


def _deskew_v2_cpu(binary: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 deskew stage: post-crop manual rotation + auto_deskew.

    manual_deskew_pre in post-crop mode means deskew_after_crop (the second
    rotation point). For default config this is a no-op.
    """
    # Build a post-crop rotation config stub that only applies deskew_after_crop.

    if cfg is not None and hasattr(cfg, "deskew_after_crop") and cfg.deskew_after_crop is not None:
        rotate_image = cast(
            "Callable[[ImageArray, float], ImageArray]",
            _load_attr("pdomain_book_tools.image_processing.cv2_processing", "rotate_image"),
        )
        binary = rotate_image(binary, cfg.deskew_after_crop)
    return _auto_deskew_cpu(binary, cfg)


def _canvas_map_v2_cpu(binary: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 canvas_map stage: morph_fill + rescale + canvas_map (+ blank branch internal).

    The blank-page short-circuit (blank_proof_synth) is an internal branch:
    if cfg.page_type is blank/plate_b/plate_r, synthesise a blank proof instead
    of running the morph→rescale→canvas chain.
    """

    # Check page type for blank branch
    if cfg is not None and hasattr(cfg, "page_type"):
        from pdomain_prep_for_pgdp.core.models import PageType

        if cfg.page_type in (PageType.blank, PageType.plate_b, PageType.plate_r):
            # Internal blank branch: synthesise a blank proof image
            h, w = cast("tuple[int, int]", binary.shape[:2])
            h_w_ratio = h / w if w > 0 else 1.65
            page_attrs: PageAttrsOutput = {
                "suggested_type": "blank",
                "suggested_alignment": "default",
                "confidence": 1.0,
                "height": h,
                "width": w,
                "h_w_ratio": h_w_ratio,
            }
            return _blank_proof_synth_cpu(page_attrs, cfg)

    # Normal branch: morph_fill + rescale + canvas_map
    filled = _morph_fill_cpu(binary, cfg)
    rescaled = _rescale_cpu(filled, cfg)
    return _canvas_map_cpu(rescaled, cfg)


def _illustrations_v2_cpu(image: ImageArray, cfg: StageConfig = None) -> CompoundStageOutput:
    """v2 illustrations stage: auto_detect + extract (placeholder for extract).

    auto_detect_illustrations runs and returns regions; extract_illustrations
    is a B3 placeholder until hi_res_crops wiring lands.
    """
    import json

    regions = _auto_detect_illustrations_cpu(image, cfg)
    # Persist both regions JSON and a stub for hi_res_crops (B3 fills in real crops)
    return {
        "regions.json": json.dumps(regions).encode(),
    }


# ─── B3 stage callables (OCR/Text group) ────────────────────────────────────
# Imported lazily at module load to avoid heavy deps at import time.
# Each is a thin wrapper delegating to core/pipeline/steps/


def _get_text_zones_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.text_zones import text_zones_v2_cpu

    return cast("StageImpl", text_zones_v2_cpu)


def _get_wordcheck_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import wordcheck_v2_cpu

    return cast("StageImpl", wordcheck_v2_cpu)


def _get_hyphen_join_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import hyphen_join_v2_cpu

    return cast("StageImpl", hyphen_join_v2_cpu)


# ─── B4 stage getters (project-scoped tail stages) ──────────────────────────


def _get_page_order_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import page_order_v2_cpu

    return cast("StageImpl", page_order_v2_cpu)


def _get_validation_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validation_v2_cpu

    return cast("StageImpl", validation_v2_cpu)


def _get_proof_pack_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.proof_pack import proof_pack_v2_cpu

    return cast("StageImpl", proof_pack_v2_cpu)


def _get_build_package_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu

    return cast("StageImpl", build_package_v2_cpu)


def _get_zip_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import zip_v2_cpu

    return cast("StageImpl", zip_v2_cpu)


def _get_submit_check_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.submit_check import submit_check_v2_cpu

    return cast("StageImpl", submit_check_v2_cpu)


def _get_archive_cpu() -> StageImpl:
    from pdomain_prep_for_pgdp.core.pipeline.steps.archive_stage import archive_v2_cpu

    return cast("StageImpl", archive_v2_cpu)


# Map of v2 stage IDs to their composed cpu impls.
_V2_REAL_CPU_IMPLS: dict[str, StageImpl] = {
    "source": _source_cpu,
    "grayscale": _grayscale_v2_cpu,
    "crop": _crop_v2_cpu,
    "threshold": _threshold_v2_cpu,
    "deskew": _deskew_v2_cpu,
    # B2: new image-prep stages
    "denoise": _denoise_cpu,
    "dewarp": _dewarp_cpu,
    "post_transform_crop": _post_transform_crop_cpu,
    "canvas_map": _canvas_map_v2_cpu,
    "post_ocr_crop": _ocr_crop_cpu,
    "ocr": _ocr_cpu,
    "regex": _text_postprocess_cpu,
    "text_review": _text_review_cpu,
    "illustrations": _illustrations_v2_cpu,
    # B3: OCR/Text group
    "text_zones": _get_text_zones_cpu(),
    "wordcheck": _get_wordcheck_cpu(),
    "hyphen_join": _get_hyphen_join_cpu(),
    # B4: Project-scoped tail stages
    "page_order": _get_page_order_cpu(),
    "validation": _get_validation_cpu(),
    "proof_pack": _get_proof_pack_cpu(),
    "build_package": _get_build_package_cpu(),
    "zip": _get_zip_cpu(),
    "submit_check": _get_submit_check_cpu(),
    "archive": _get_archive_cpu(),
}

_ALL_V2_STAGE_IDS: tuple[str, ...] = V2_PAGE_STAGE_IDS + V2_PROJECT_STAGE_IDS


def _build_v2_registry() -> dict[str, dict[str, StageImpl]]:
    """Build V2_STAGE_IMPL: 24 v2 stage IDs → cpu callables."""
    registry: dict[str, dict[str, StageImpl]] = {}
    for sid in _ALL_V2_STAGE_IDS:
        impl = _V2_REAL_CPU_IMPLS.get(sid) or _make_placeholder(sid)
        registry[sid] = {"cpu": impl}
    return registry


V2_STAGE_IMPL: dict[str, dict[str, StageImpl]] = _build_v2_registry()
"""V2 dispatch table. Keys: v2 stage_id (str) → device (str) → callable.

Covers all 24 v2 stage IDs (16 page-scoped + 8 project-scoped). New stages
without a real implementation raise StageNotImplemented; B2-B4 will wire them.
"""


def get_v2_stage_impl(stage_id: str, device: str) -> StageImpl:
    """Return the v2 callable registered for ``(stage_id, device)``.

    Applies the same device normalization as ``get_stage_impl``:
    ``"cuda"``/``"gpu"`` → ``"gpu"``; unknown → ``"cpu"``; CPU fallback when
    no GPU impl is registered for the stage.
    """
    impl_key = _DEVICE_TO_IMPL_KEY.get(device, "cpu")
    devices = V2_STAGE_IMPL[stage_id]
    return devices.get(impl_key) or devices["cpu"]


# ─── Phase 2: GPU-resident segment execution ─────────────────────────────────
#
# GPU impls for the image-prep chain.  Each wraps the corresponding CuPy mirror
# from ``pdomain_book_tools.image_processing.cupy_processing``.  They accept a
# *numpy* ndarray (the runner converts from ndarray as needed) OR a CuPy
# ndarray (when the segment runner keeps data on-device between stages).
#
# Availability: all GPU impls are import-guarded.  When CuPy is absent (the
# default CI environment), ``_build_gpu_entries`` returns an empty dict and the
# V2_STAGE_IMPL entries retain only the ``cpu`` key.  Every stage must run
# identically on CPU regardless of whether the ``[gpu]`` extra is installed.
#
# Stage-to-mirror mapping (book-tools 0.19.0):
#   threshold (v2: threshold+invert)  → otsu_binary_thresh/binary_thresh_gpu +
#                                        invert_image
#   deskew    (v2: post-crop rot + auto_deskew) → auto_deskew_gpu
#   dewarp    (TextlineDisparityDewarp prefer_gpu=True) → GPU textline_dewarp
#   canvas_map (morph_fill + invert + rescale_image + canvas_map) →
#               morph_fill + invert_image + rescale_image_gpu + canvas_map_gpu
#   denoise   → denoise_binary_gpu (cupy_processing.denoise, ships in 0.19.0)
#   post_transform_crop → array slicing; trivially GPU-resident (in-place slice
#                          on CuPy array; no book-tools call needed)
#
# GPU-capable stages (book-tools 0.19.0 — full single island):
#   threshold, deskew, denoise, dewarp, post_transform_crop, canvas_map
#
# NOT GPU-capable:
#   grayscale, crop, ocr, post_ocr_crop, text_zones, wordcheck, hyphen_join,
#   page_order, validation, proof_pack, build_package, zip, submit_check, archive


def _threshold_v2_gpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 threshold stage (threshold + invert) on GPU.

    Accepts either a numpy ndarray (uploaded from runner) or a CuPy ndarray
    (passed from a prior GPU stage in the same segment).  Returns a CuPy array.

    GPU path:
      1. If cfg.threshold_level: binary_thresh_gpu at fixed level.
         Else: otsu_binary_thresh (auto-threshold on GPU).
      2. invert_image (bitwise NOT on GPU).

    Polarity contract: output is text=255/bg=0 (same as _threshold_v2_cpu).
    """
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        cp,
        require_cupy,
    )
    from pdomain_book_tools.image_processing.cupy_processing.invert import invert_image
    from pdomain_book_tools.image_processing.cupy_processing.threshold import (
        binary_thresh_gpu,
        otsu_binary_thresh,
    )

    require_cupy()
    assert cp is not None  # narrowed: require_cupy raises if CuPy absent
    img_cp = cp.asarray(image)

    if cfg is not None and cfg.threshold_level is not None:
        binary = binary_thresh_gpu(img_cp, level=cfg.threshold_level)
    else:
        binary = otsu_binary_thresh(img_cp)

    return invert_image(binary)  # pyright: ignore[reportReturnType]


def _deskew_v2_gpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 deskew stage (post-crop rotation + auto_deskew) on GPU.

    When skip_auto_deskew=True (default), returns the input unchanged (on GPU).
    When skip_auto_deskew=False, runs auto_deskew_gpu.

    Polarity: input text=255/bg=0; output same convention.
    """
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        cp,
        require_cupy,
    )
    from pdomain_book_tools.image_processing.cupy_processing.deskew import auto_deskew_gpu
    from pdomain_book_tools.image_processing.cupy_processing.rotate import rotate_image_gpu

    require_cupy()
    assert cp is not None
    img_cp = cp.asarray(image)

    # Apply post-crop manual rotation if configured.
    if cfg is not None and hasattr(cfg, "deskew_after_crop") and cfg.deskew_after_crop is not None:
        img_cp = rotate_image_gpu(img_cp, angle_deg=cfg.deskew_after_crop)

    # auto_deskew: honour skip flag (default True = skip).
    if cfg is None or cfg.skip_auto_deskew:
        return img_cp  # pyright: ignore[reportReturnType]

    deskewed, _, _ = auto_deskew_gpu(img_cp, pct=0.30)
    return deskewed  # pyright: ignore[reportReturnType]


def _dewarp_gpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 dewarp stage on GPU (prefer_gpu=True path of TextlineDisparityDewarp).

    Re-binarises the output (same as _dewarp_cpu) because the remap introduces
    sub-pixel interpolation artefacts.  The threshold is applied via
    otsu_binary_thresh on the GPU to keep data on-device.

    Polarity: input text=255/bg=0; output text=255/bg=0.
    """
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        cp,
        require_cupy,
    )
    from pdomain_book_tools.image_processing.cupy_processing.threshold import (
        binary_thresh_gpu,
    )

    require_cupy()
    assert cp is not None

    _ = cfg

    # Download for TextlineDisparityDewarp (it uses cv2.remap internally
    # even in prefer_gpu=True mode for the actual warp step).
    img_np = cp.asnumpy(image) if isinstance(image, cp.ndarray) else image

    TextlineDisparityDewarp = cast(
        "type",
        _load_attr("pdomain_book_tools.geometry_correction", "TextlineDisparityDewarp"),
    )
    dewarper = TextlineDisparityDewarp(prefer_gpu=True)
    result = dewarper.estimate(img_np)

    transform = result.transform  # type: ignore[attr-defined]
    warped = transform.apply(img_np)

    # Re-binarise on GPU to keep output on device.
    warped_cp = cp.asarray(warped.astype(np.uint8))
    return binary_thresh_gpu(warped_cp, level=127)  # pyright: ignore[reportReturnType]


def _post_transform_crop_gpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 post_transform_crop on GPU — array slice (CuPy or numpy both work).

    When cfg has non-zero insets, applies a slice to the GPU array.  When all
    insets are zero (default) returns the input unchanged.  This operation is
    trivially GPU-resident: CuPy array slicing returns a CuPy view.
    """
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        cp,
        require_cupy,
    )

    require_cupy()
    assert cp is not None

    insets = cfg.post_transform_crop_insets if cfg is not None else (0, 0, 0, 0)
    top, bottom, left, right = insets
    if top == 0 and bottom == 0 and left == 0 and right == 0:
        return cp.asarray(image)  # pyright: ignore[reportReturnType]

    img_cp = cp.asarray(image)
    h, w = cast("tuple[int, int]", img_cp.shape[:2])
    y1 = max(0, top)
    y2 = max(y1 + 1, h - bottom)
    x1 = max(0, left)
    x2 = max(x1 + 1, w - right)
    return cast("ImageArray", img_cp[y1:y2, x1:x2])


def _canvas_map_v2_gpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 canvas_map stage (morph_fill + invert + rescale + canvas_map) on GPU.

    GPU version of _canvas_map_v2_cpu.  Uses CuPy mirrors for all four steps.
    The blank-page branch (blank_proof_synth) falls through to CPU (returns np).

    Polarity contract:
      Input:  text=255/bg=0 (inverted binary from threshold stage)
      Output: text=0/bg=255 (proofing image convention; same as CPU path)
    """
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        cp,
        require_cupy,
    )
    from pdomain_book_tools.image_processing.cupy_processing.canvas import (
        map_content_onto_scaled_canvas_gpu,
    )
    from pdomain_book_tools.image_processing.cupy_processing.invert import invert_image
    from pdomain_book_tools.image_processing.cupy_processing.morph import morph_fill
    from pdomain_book_tools.image_processing.cupy_processing.rescale import rescale_image_gpu

    require_cupy()
    assert cp is not None

    # Blank-page branch: fall through to CPU to avoid synthesising a
    # blank proof on GPU (trivial white array; not worth the complexity).
    if cfg is not None and hasattr(cfg, "page_type"):
        from pdomain_prep_for_pgdp.core.models import PageType

        if cfg.page_type in (PageType.blank, PageType.plate_b, PageType.plate_r):
            return _canvas_map_v2_cpu(cp.asnumpy(image) if isinstance(image, cp.ndarray) else image, cfg)

    from pdomain_prep_for_pgdp.core.models import AlignmentOverride

    ratio = cfg.page_h_w_ratio if cfg is not None else 1.294
    alignment_override = cfg.alignment if cfg is not None else AlignmentOverride.default

    alignment_ns = cast(
        "_AlignmentNamespace",
        _load_attr("pdomain_book_tools.image_processing.cv2_processing", "Alignment"),
    )
    _align_map: dict[str, object] = {
        AlignmentOverride.default.value: alignment_ns.DEFAULT,
        AlignmentOverride.top.value: alignment_ns.TOP,
        AlignmentOverride.center.value: alignment_ns.CENTER,
        AlignmentOverride.bottom.value: alignment_ns.BOTTOM,
    }
    force_align = _align_map.get(alignment_override.value, alignment_ns.DEFAULT)

    img_cp = cp.asarray(image)

    # morph_fill (optional; default do_morph=False)
    if cfg is not None and cfg.do_morph:
        img_cp = morph_fill(img_cp)

    # rescale: invert (text=255→0) then scale, then invert back would differ
    # from the CPU path. Match _rescale_cpu exactly:
    # _rescale_cpu does invert_image first (text=255→0) then rescale.
    # The cupy invert_image (255 - x) matches cv2 bitwise_not on uint8.
    inverted = invert_image(img_cp)
    rescaled = rescale_image_gpu(inverted, target_short_side=1000)

    # canvas_map — force_align is object (from dict lookup); ignore type mismatch.
    from typing import Any
    from typing import cast as _cast

    _force_align_typed: Any = force_align
    return _cast(  # pyright: ignore[reportReturnType]
        "ImageArray",
        map_content_onto_scaled_canvas_gpu(
            rescaled, force_align=_force_align_typed, height_width_ratio=ratio
        ),
    )


def _denoise_v2_gpu(image: ImageArray, cfg: StageConfig = None) -> ImageArray:
    """v2 denoise stage on GPU (book-tools 0.19.0+: denoise_binary_gpu).

    Polarity bridge: the v2 pipeline carries text=255/bg=0 (from threshold).
    ``denoise_binary_gpu`` expects text=0/bg=255 (same as the CPU counterpart).
    This impl:
      1. Passes ``skip_denoise`` check — returns input unchanged if True.
      2. Uploads to CuPy if not already a device array.
      3. Inverts to text=0/bg=255 (CuPy bitwise_not).
      4. Calls ``denoise_binary_gpu`` with ``min_component_area`` and
         ``median_kernel_size`` from resolved config (W1 settings).
      5. Inverts back to text=255/bg=0.

    Bit-exact with ``_denoise_cpu`` on binary images: connected-component
    filtering is deterministic (no floating-point arithmetic).

    Availability guard: falls back to CPU if CuPy is absent at import time.
    """
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        cp as _cp,
    )
    from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
        require_cupy,
    )
    from pdomain_book_tools.image_processing.cupy_processing.denoise import (  # pyright: ignore[reportMissingImports]
        denoise_binary_gpu,
    )

    require_cupy()
    assert _cp is not None  # narrowed: require_cupy() raises if CuPy absent

    # Skip if explicitly configured
    if cfg is not None and cfg.skip_denoise:
        return image  # pyright: ignore[reportReturnType]

    # Resolve tunable params from cfg (W1.2 — same as CPU counterpart)
    min_area = cfg.denoise_min_component_area if cfg is not None else 6
    med_kernel = cfg.denoise_median_kernel_size if cfg is not None else 0

    # Ensure input is on GPU
    img_cp = _cp.asarray(image) if not isinstance(image, _cp.ndarray) else image

    # Bridge: text=255/bg=0 → text=0/bg=255 for denoise_binary_gpu
    inverted = _cp.bitwise_not(img_cp)

    cleaned_inv = denoise_binary_gpu(
        inverted,  # pyright: ignore[reportArgumentType]
        min_component_area=min_area,
        median_kernel_size=med_kernel,
    )

    # Bridge back: text=0/bg=255 → text=255/bg=0
    return _cp.bitwise_not(cleaned_inv)  # pyright: ignore[reportReturnType]


# ─── GPU capability table ─────────────────────────────────────────────────────
#
# A stage is GPU-capable if and only if ALL its internal micro-steps have
# CuPy mirrors in book-tools 0.19.0.
#
# Stage           GPU-capable?  Reason if not
# --------------- ------------- -------------------------------------------------
# threshold       YES           otsu_binary_thresh + invert_image (cupy_processing)
# invert          YES           invert_image (cupy_processing)
# deskew          YES           auto_deskew_gpu (cupy_processing.deskew)
# dewarp          YES           TextlineDisparityDewarp prefer_gpu=True
# post_transform_crop YES       CuPy array slice (trivial)
# canvas_map      YES           morph_fill + rescale_image_gpu + canvas_map_gpu
# denoise         YES           denoise_binary_gpu (cupy_processing.denoise) — book-tools 0.19.0
# crop            NO            find_edges uses cv2 projections; no cupy mirror
# grayscale       NO            bgr-to-gray (cupy exists but not wired here)
# post_ocr_crop   NO            array slice only; not in image-prep hot path
#
# With denoise GPU-capable, the image-prep chain is a SINGLE GPU island:
#   threshold → deskew → denoise → dewarp → post_transform_crop → canvas_map
#
# The set below drives:
#   1. _build_gpu_entries: which stages get a ``gpu`` key in V2_STAGE_IMPL.
#   2. segment_runner.is_gpu_capable_stage: which stages can run on-device.

_GPU_CAPABLE_STAGE_IDS: frozenset[str] = frozenset(
    {"threshold", "deskew", "dewarp", "post_transform_crop", "canvas_map", "denoise"}
)

GPU_CAPABLE_STAGES: frozenset[str] = _GPU_CAPABLE_STAGE_IDS
"""Set of v2 stage IDs that have GPU-resident implementations in book-tools 0.19.0.

A stage is included only when ALL its internal micro-steps have CuPy mirrors.
Stages absent from this set run on CPU regardless of the selected device.

With book-tools 0.19.0 (``denoise_binary_gpu`` shipped), the entire
image-prep chain is a single GPU island:
  threshold -> deskew -> denoise -> dewarp -> post_transform_crop -> canvas_map

Import this to check whether a stage can participate in a GPU segment.
"""

_GPU_IMPL_MAP: dict[str, StageImpl] = {
    "threshold": _threshold_v2_gpu,
    "deskew": _deskew_v2_gpu,
    "dewarp": _dewarp_gpu,
    "post_transform_crop": _post_transform_crop_gpu,
    "canvas_map": _canvas_map_v2_gpu,
    "denoise": _denoise_v2_gpu,
}


def _build_gpu_entries() -> dict[str, StageImpl]:
    """Return GPU impls keyed by stage_id, or {} when CuPy is unavailable."""
    try:
        from pdomain_book_tools.image_processing.cupy_processing._cupy_compat import (
            cupy_available,
        )

        if not cupy_available():
            return {}
    except ImportError:
        return {}
    return dict(_GPU_IMPL_MAP)


def register_gpu_impls() -> None:
    """Add ``gpu`` entries to V2_STAGE_IMPL for GPU-capable stages.

    Called once at module load time.  When CuPy is absent (CI default) this is
    a no-op: all stages retain only the ``cpu`` key and every GPU-path request
    raises ``KeyError`` (the runner must fall back to ``cpu``).

    Called again after the module is loaded (this module-level call runs first,
    then the individual stage's cpu impl is set). The function is idempotent.
    """
    gpu_entries = _build_gpu_entries()
    for stage_id, impl in gpu_entries.items():
        if stage_id in V2_STAGE_IMPL:
            V2_STAGE_IMPL[stage_id]["gpu"] = impl


# Register GPU impls at module load time.
register_gpu_impls()
