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
from collections.abc import Callable
from typing import Any

from ..models import PAGE_STAGE_IDS

# ─── Sentinel exception ─────────────────────────────────────────────────────


class StageNotImplemented(RuntimeError):  # noqa: N818  # intentional: signals "not yet wired", not an error state
    """Raised by placeholder stage callables when invoked.

    The runner catches this and records the page_stages row as `failed`
    with a clear "not yet implemented in registry" message. **Not** a
    subclass of `NotImplementedError` (Q9 rationale above).
    """


def _make_placeholder(stage_id: str) -> Callable[..., Any]:
    """Build a placeholder callable for stages without a real impl yet.

    Returns a function that, when called, raises ``StageNotImplemented``
    naming the stage. Closure-bound so the message is correct without
    relying on traceback-walk hacks.
    """

    def _placeholder(*_args: Any, **_kwargs: Any) -> Any:
        raise StageNotImplemented(
            f"stage {stage_id!r} has no implementation registered for cpu yet "
            "(M2 placeholder — wire up in a future slice)"
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
# default-config "no-op" branches in `process_page_cpu` (no crop / no
# rotation) until ResolvedPageConfig plumbing lands. Carving them out
# now — even as no-ops — is the load-bearing change: it makes the chain
# runnable end-to-end from `ingest_source` through `invert` without
# manual SQLite seeding, which is the M2 smoke-test pass criterion.


def _grayscale_cpu(image: Any) -> Any:
    """Convert a 3-channel BGR ndarray to a 2-D grayscale ndarray.

    Wraps ``pd_book_tools.image_processing.cv2_processing.cv2_convert_to_grayscale``
    so the CPU image-processing path stays consistent with the monolithic
    process_page chain.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        cv2_convert_to_grayscale,
    )

    return cv2_convert_to_grayscale(image)


def _threshold_cpu(image: Any) -> Any:
    """Otsu binarisation of a 2-D grayscale ndarray.

    The full `Stage.threshold` in the monolithic chain also handles a
    user-set ``threshold_level`` override — that lands when the runner
    wires `ResolvedPageConfig` into stage inputs (Slice 3 / M3). For
    now, plain Otsu is the documented behavior and the test fixture.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        otsu_binary_thresh,
    )

    return otsu_binary_thresh(image)


def _invert_cpu(image: Any) -> Any:
    """Bitwise complement of a uint8 ndarray (`255 - x`).

    Wraps ``pd_book_tools.image_processing.cv2_processing.invert_image``.
    Idempotent under double-application (Q3-friendly: `invert(invert(x)) == x`).
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        invert_image,
    )

    return invert_image(image)


def _ingest_source_cpu(source_bytes: bytes) -> bytes:
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
    return source_bytes


def _decode_source_cpu(image: Any) -> Any:
    """Pass through the already-decoded source image unchanged.

    The runner cv2.imdecodes parent bytes before calling the impl, so by
    the time `decode_source` runs the input is already a 3-channel uint8
    ndarray. Persisting it as its own artifact (Q3 every-intermediate-
    persistence) gives `initial_crop` a well-defined parent path while
    keeping the registry impl pure in ndarray space.
    """
    return image


def _initial_crop_cpu(image: Any) -> Any:
    """Apply project/per-page initial-crop insets, or pass through at default.

    Mirrors `process_page_cpu`'s 4d branch: when the resolved
    `(left, right, top, bottom)` insets are all zero the image is
    forwarded unchanged. ResolvedPageConfig plumbing through the runner
    isn't wired yet (Q5 follow-up), so this iteration's impl always
    takes the no-crop branch — that's the documented default and the
    one the M2 smoke-test exercises. When the config plumbing lands the
    signature gains a `cfg: ResolvedPageConfig` kwarg and the actual
    `crop_edges` call moves here.
    """
    return image


def _manual_deskew_pre_cpu(image: Any) -> Any:
    """Apply the optional pre-crop manual rotation, or pass through at default.

    Mirrors `process_page_cpu`'s 4e branch: rotation only fires when
    `cfg.deskew_before_crop is not None`. At default the image is
    forwarded unchanged. Same ResolvedPageConfig follow-up as
    `initial_crop` — the impl learns about cfg later.
    """
    return image


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


def _find_content_edges_cpu(image: Any) -> tuple[int, int, int, int]:
    """Find the bounding box of the content region in a binary inverted image.

    Returns (minX, maxX, minY, maxY) — the four edge coordinates passed to
    `crop_to_rectangle` in step 4j. Wraps `find_edges` from pd_book_tools
    using the same default parameters as `process_page_cpu` (4i).

    The runner encodes this as a JSON list and writes it to `output.json`.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        find_edges,
    )

    return find_edges(image)


def _crop_to_content_cpu(image: Any, bbox: tuple[int, int, int, int]) -> Any:
    """Crop the binary image to the content bounding box (step 4j).

    `image` is the inverted binary ndarray (from `invert`);
    `bbox` is (minX, maxX, minY, maxY) from `find_content_edges`.

    Wraps `crop_to_rectangle`. The optional whitespace-pad step in
    `process_page_cpu` 4j fires only when `cfg.white_space_additional`
    is set — at default config (no override) it is skipped.
    ResolvedPageConfig plumbing into the runner lands later; this
    iteration always takes the no-pad branch.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        crop_to_rectangle,
    )

    minX, maxX, minY, maxY = bbox
    return crop_to_rectangle(image, minX, maxX, minY, maxY)


def _auto_deskew_cpu(image: Any) -> Any:
    """Auto-deskew the binary content image (step 4k).

    Mirrors `process_page_cpu`'s 4k branch for the common case
    (no manual override, non-special alignment, standard orientation).
    ResolvedPageConfig skip conditions land when config plumbing is wired;
    for now, always attempt auto-deskew via `auto_deskew(pct=0.30)`.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        auto_deskew,
    )

    out = auto_deskew(image, pct=0.30)
    # `auto_deskew` may return either a bare ndarray or a (ndarray, angle) tuple.
    return out[0] if isinstance(out, tuple) else out


def _morph_fill_cpu(image: Any) -> Any:
    """Apply morphological fill to close small gaps in text strokes (step 4l).

    Optional in `process_page_cpu` via `cfg.do_morph`; default is False,
    but wiring the impl now means the stage can run harmlessly via morph_fill
    at its default call — pd_book_tools' `morph_fill` is idempotent on
    already-clean binary images. ResolvedPageConfig plumbing will expose
    the do_morph toggle; until then the impl always runs.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        morph_fill,
    )

    return morph_fill(image)


def _rescale_cpu(image: Any) -> Any:
    """Re-invert + rescale to canonical aspect ratio (step 4m).

    `process_page_cpu` calls `rescale_image(invert_image(img_deskewed), target_short_side=1000)`.
    The inversion here is intentional: `morph_fill` outputs a binary image with
    text=255/bg=0; `rescale_image` expects text=0/bg=255 (white-on-black).
    The inversion restores that convention before scaling.
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        invert_image,
        rescale_image,
    )

    return rescale_image(invert_image(image), target_short_side=1000)


def _canvas_map_cpu(image: Any) -> Any:
    """Map the rescaled image onto a canonical canvas (step 4n).

    Wraps `map_content_onto_scaled_canvas` with the default alignment
    (Alignment.DEFAULT) and the canonical h/w ratio used in `process_page_cpu`.
    ResolvedPageConfig plumbing (alignment override, page_h_w_ratio from
    per-page config) lands when the runner passes cfg into impls; for now,
    DEFAULT alignment and ratio=1.294 (US Letter ~8.5:11) are the documented
    defaults and the ones the M2/Slice-11 smoke-test exercises.

    Returns an ndarray; the runner encodes it to PNG (output_type='image_bytes').
    """
    from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
        Alignment,
        map_content_onto_scaled_canvas,
    )

    return map_content_onto_scaled_canvas(
        image,
        force_align=Alignment.DEFAULT,
        height_width_ratio=1.294,
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


def _auto_detect_attrs_cpu(image: Any) -> dict[str, Any]:
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
    import cv2  # type: ignore[import-not-found]

    from ...core.auto_detect import detect_page_attributes

    # Re-encode the ndarray to PNG bytes so detect_page_attributes can parse.
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("cv2.imencode failed in auto_detect_attrs")
    png_bytes = bytes(buf.tobytes())

    suggestion = detect_page_attributes(png_bytes)
    height, width = image.shape[:2]
    h_w_ratio = height / width if width > 0 else 1.65

    return {
        "suggested_type": suggestion.suggested_type.value,
        "suggested_alignment": suggestion.suggested_alignment.value,
        "confidence": suggestion.confidence,
        "height": height,
        "width": width,
        "h_w_ratio": h_w_ratio,
    }


def _blank_proof_synth_cpu(page_attrs: dict[str, Any]) -> Any:
    """Synthesise a blank proofing image for blank / plate-b / plate-r pages.

    Takes the `page_attrs` dict from `auto_detect_attrs` and returns an
    ndarray of a white page at the detected aspect ratio. The runner
    PNG-encodes the result (output_type='image_bytes').

    Mirrors `process_page_cpu`'s 4b branch: `blank_proof.create_blank_proof`
    with `h_w_ratio` from the detected page attributes. Falls back to 1.65
    (US-Letter proportions) when the field is absent or zero.
    """
    import numpy as np  # type: ignore[import-not-found]

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


def _ocr_crop_cpu(image: Any) -> Any:
    """Apply the OCR-crop margin and page-split logic to the proofing image.

    At default config (`cfg.ocr_crop == (0,0,0,0)`, no splits) this is a
    pass-through — the proofing ndarray is forwarded unchanged. The runner
    PNG-encodes the result (output_type='image_bytes').

    The full `crop_for_ocr` function (which handles `cfg.ocr_crop` trims
    and `page.splits` into multiple crops) is the M3 target; this iteration
    only wires the no-config default so the chain is runnable end-to-end
    from `ingest_source` through `ocr_crop`.
    """
    return image


# ─── Real implementations: thumbnail + auto_detect_illustrations + text_postprocess (Slice 13) ──

# These three complete the set of single-artifact stages in the DAG.
# The remaining placeholder (`extract_illustrations`) requires compound
# output (hi_res_crops); its multi-artifact path is wired but the
# illustration-crop logic is deferred until M3.


def _thumbnail_cpu(image: Any) -> bytes:
    """Resize and JPEG-encode the source image for workbench thumbnail display.

    The runner loads the `ingest_source` artifact as an ndarray (output_type
    'image_bytes' is in `_IMAGE_OUTPUT_TYPES` → cv2.imdecode). This impl
    resizes to fit inside 300px on the short side and encodes to JPEG at
    quality 85 — matching `_make_thumbnail_bytes` in `core/ingest.py`.

    Returns bytes; the runner's `jpeg_bytes` output-type path writes them
    verbatim as `output.jpg`.
    """
    import cv2  # type: ignore[import-not-found]

    _THUMBNAIL_MAX_DIM = 300
    _THUMBNAIL_QUALITY = 85

    img = image
    h, w = img.shape[:2]
    short = min(h, w)
    if short > _THUMBNAIL_MAX_DIM:
        scale = _THUMBNAIL_MAX_DIM / short
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), _THUMBNAIL_QUALITY])
    if not ok:
        raise RuntimeError("cv2.imencode(.jpg) failed in _thumbnail_cpu")
    return bytes(buf.tobytes())


def _auto_detect_illustrations_cpu(image: Any) -> list[Any]:
    """Detect illustration regions in a source image ndarray.

    Loads the layout detector (the same process-singleton as in
    `auto_detect_attrs`) and runs it on the image. If the layout model is
    not installed / available, returns an empty list — the stage transitions
    to `clean` with `[]` JSON, which is the correct representation of
    "no illustrations detected".

    Returns a list of dicts; the runner JSON-serialises this list and writes
    it to `output.json` (output_type='illustration_regions').
    """
    import cv2  # type: ignore[import-not-found]

    # Try loading the layout detector from pd_book_tools. This is a heavy
    # optional dependency (model weights); if absent, fall back to no-op.
    try:
        from pd_book_tools.layout import get_layout_detector  # type: ignore[import-not-found]

        detector = get_layout_detector()
    except Exception:
        detector = None

    if detector is None:
        return []

    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("cv2.imencode failed in _auto_detect_illustrations_cpu")

    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(bytes(buf.tobytes()))
        tmp_path = Path(tmp.name)

    try:
        from ...core.illustrations import auto_detect_illustrations

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


def _text_postprocess_cpu(text_bytes: Any) -> str:
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
    from ...core.text_postprocess import normalize_curly_quotes, normalize_em_dash

    if isinstance(text_bytes, (bytes, bytearray)):
        text = text_bytes.decode(errors="replace")
    else:
        text = str(text_bytes)

    text = normalize_curly_quotes(text)
    text = normalize_em_dash(text)
    return text


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


def _default_resolved_page_config() -> Any:
    """Build a minimal ResolvedPageConfig with all-default values.

    Used by stage impls that haven't yet received ResolvedPageConfig plumbing
    (M3 work). Callers must not assume any per-page override fields are set.
    """
    from ...core.models import AlignmentOverride, PageType, ResolvedPageConfig

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
    )


def _ocr_cpu(image: Any) -> dict[str, bytes]:
    """Run OCR on the proofing image and emit words.json + raw.txt.

    Accepts the ndarray from `ocr_crop` (output_type='image_bytes' decoded
    by the runner). Writes the image to a temp file, calls `ocr_page` with
    default config, serialises OcrPageResult.words to ``words.json`` (JSON
    array of OcrWord dicts) and OcrPageResult.text to ``raw.txt`` (UTF-8).

    The multi-artifact writer (Slice 14) routes the returned
    ``dict[str, bytes]`` via ``commit_stage_artifacts_multi``.

    OCR engine: defaults to doctr (system default). Tests override by
    passing an image through the runner with PGDP_OCR_ENGINE=tesseract
    (handled inside ``ocr_page`` via ``SystemDefaults``).
    """
    import json
    import os
    import tempfile

    import cv2  # type: ignore[import-not-found]

    from ...core.models import SystemDefaults
    from ...core.ocr import ocr_page

    cfg = _default_resolved_page_config()

    # Honour PGDP_OCR_ENGINE env var so tests can force tesseract without
    # loading DocTR weights.
    ocr_engine = os.environ.get("PGDP_OCR_ENGINE")
    if ocr_engine in ("tesseract", "doctr"):
        cfg = cfg.model_copy(update={"ocr_engine": ocr_engine})

    system = SystemDefaults(ocr_engine=cfg.ocr_engine)

    # Write ndarray to a temp PNG that ocr_page can read via cv2/doctr.
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp_path_str = f.name
    try:
        cv2.imwrite(tmp_path_str, image)
        from pathlib import Path

        result = ocr_page(Path(tmp_path_str), cfg=cfg, system=system)
    finally:
        try:
            import os as _os

            _os.unlink(tmp_path_str)
        except OSError:
            pass

    words_data = [w.model_dump() for w in result.words]
    words_json = json.dumps(words_data).encode()
    raw_txt = (result.text or "").encode()
    return {"words.json": words_json, "raw.txt": raw_txt}


def _text_review_cpu(text_bytes: Any) -> dict[str, bytes]:
    """Gate stage — copy text_postprocess output as the reviewed text.

    At default config (no human edit) this is an identity pass: the
    output.txt artifact is the text_postprocess result verbatim, and
    attestation.json records an empty object. The 'Mark clean' UI button
    (`POST .../text_review/clean`) short-circuits this by marking the DB
    row clean directly without running the stage; this impl exists so
    batch-mode callers can fire the stage programmatically.

    Returns dict[str, bytes] with 'output.txt' and 'attestation.json'.
    """
    import json

    text = bytes(text_bytes) if isinstance(text_bytes, (bytes, bytearray)) else str(text_bytes).encode()

    attestation = json.dumps({}).encode()
    return {"output.txt": text, "attestation.json": attestation}


# ─── Registry assembly ──────────────────────────────────────────────────────

# Real implementations registered for cpu. Keys must be in `PAGE_STAGE_IDS`.
_REAL_CPU_IMPLS: dict[str, Callable[..., Any]] = {
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


def _build_registry() -> dict[str, dict[str, Callable[..., Any]]]:
    """Materialise STAGE_IMPL once at import time.

    For every canonical stage_id, register a `'cpu'` entry — either the
    real implementation if listed in `_REAL_CPU_IMPLS`, or a placeholder
    that raises `StageNotImplemented`.

    CUDA entries are intentionally absent at M2 Slice 2; later slices
    register them alongside the cpu ones (Q10 auto-bridge handles the
    fallback from a `'cuda'` request to `'cpu'` when the cuda entry is
    missing — that fallback lives in the runner, not here).
    """
    registry: dict[str, dict[str, Callable[..., Any]]] = {}
    for sid in PAGE_STAGE_IDS:
        impl = _REAL_CPU_IMPLS.get(sid) or _make_placeholder(sid)
        registry[sid] = {"cpu": impl}
    return registry


STAGE_IMPL: dict[str, dict[str, Callable[..., Any]]] = _build_registry()
"""Module-level dispatch table. Keys: stage_id (str) → device (str) → callable.

Stable in-process; no expectation of mutation at runtime. Tests assert
exhaustiveness via `PAGE_STAGE_IDS`.
"""


def get_stage_impl(stage_id: str, device: str) -> Callable[..., Any]:
    """Return the callable registered for ``(stage_id, device)``.

    Raises ``KeyError`` for unknown stage_ids or unregistered devices —
    callers are expected to validate first (the runner does, before it
    starts the dual-write transaction).
    """
    devices = STAGE_IMPL[stage_id]
    return devices[device]
