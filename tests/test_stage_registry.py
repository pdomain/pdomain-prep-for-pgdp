"""M2 Slice 2 — STAGE_IMPL[stage_id][device] registry.

Spec: `docs/specs/pipeline-task-model.md` §"Q5 — STAGE_IMPL registry"
(locked 2026-05-07).

Replaces the LocalBackend / CpuBackend method-dispatch hierarchy with a
flat `STAGE_IMPL[stage_id][device]` callable map. M2 ships:

- Every canonical stage_id registered for `"cpu"` (placeholders raise
  `StageNotImplemented` until extracted).
- Three simple stages with real implementations: `grayscale`, `threshold`,
  `invert`. These are pure cv2 / pd_book_tools wrappers; the runner in
  Slice 3 will fan them out and dual-write their artifacts.

Auto-bridging (Q10) between numpy and cupy at type boundaries is the
runner's job — the registry-level callables are typed against their
canonical device representation.

Q9 fail-loudly: placeholders raise `StageNotImplemented`, which the
runner catches and translates to `status=failed` + a clear error
message. `NotImplementedError` is reserved for "the engine path has
a real bug"; we want this to be a typed sentinel callers can
distinguish.
"""

from __future__ import annotations

import shutil

import numpy as np
import pytest

from pd_prep_for_pgdp.core.models import PAGE_STAGE_IDS
from pd_prep_for_pgdp.core.pipeline.stage_registry import (
    STAGE_IMPL,
    StageNotImplemented,
    get_stage_impl,
)

# ─── Registry shape ─────────────────────────────────────────────────────────


def test_registry_covers_every_canonical_stage() -> None:
    """Every stage_id in PAGE_STAGE_IDS has at least one registered device."""
    for sid in PAGE_STAGE_IDS:
        assert sid in STAGE_IMPL, f"stage {sid!r} missing from STAGE_IMPL"
        assert STAGE_IMPL[sid], f"stage {sid!r} has no device entries"


def test_registry_has_cpu_for_every_stage() -> None:
    """Every stage_id has a `'cpu'` callable. CUDA entries land later."""
    for sid in PAGE_STAGE_IDS:
        assert "cpu" in STAGE_IMPL[sid], f"stage {sid!r} has no cpu impl"
        assert callable(STAGE_IMPL[sid]["cpu"]), f"stage {sid!r} cpu impl not callable"


def test_get_stage_impl_returns_registered_callable() -> None:
    """The lookup helper returns the registered callable."""
    fn = get_stage_impl("grayscale", "cpu")
    assert callable(fn)


def test_get_stage_impl_raises_keyerror_for_unknown_stage() -> None:
    """Unknown stage_id is a KeyError (caller is expected to validate)."""
    with pytest.raises(KeyError, match="not_a_real_stage"):
        get_stage_impl("not_a_real_stage", "cpu")


def test_get_stage_impl_raises_keyerror_for_unknown_device() -> None:
    """`mps` and other unregistered devices fall through to KeyError."""
    with pytest.raises(KeyError):
        get_stage_impl("grayscale", "mps")


# ─── Placeholder behavior ───────────────────────────────────────────────────


def test_placeholder_stages_raise_stage_not_implemented() -> None:
    """Stages without a real impl raise StageNotImplemented when invoked.

    The runner uses this sentinel to record `status=failed` with a clear
    user-facing reason rather than the generic "an exception occurred".
    """
    # `extract_illustrations` is a known placeholder stage as of Slice 2.
    fn = get_stage_impl("extract_illustrations", "cpu")
    with pytest.raises(StageNotImplemented, match="extract_illustrations"):
        fn(None)


def test_stage_not_implemented_is_not_notimplemented_error() -> None:
    """StageNotImplemented is a distinct typed sentinel.

    Q9 rationale: NotImplementedError is reserved for "the engine path has
    a real bug". `StageNotImplemented` means "this stage_id has no impl
    registered yet" — different signal, different recovery.
    """
    assert not issubclass(StageNotImplemented, NotImplementedError)


# ─── Real impl: grayscale ───────────────────────────────────────────────────


def _solid_color_bgr(h: int = 30, w: int = 40) -> np.ndarray:
    """3-channel BGR ndarray; cv2 expects (h, w, 3) uint8."""
    return np.full((h, w, 3), [10, 20, 30], dtype=np.uint8)


def test_grayscale_cpu_returns_2d_uint8() -> None:
    """grayscale on a BGR ndarray returns a 2-D uint8 ndarray."""
    fn = get_stage_impl("grayscale", "cpu")
    out = fn(_solid_color_bgr())
    assert isinstance(out, np.ndarray)
    assert out.dtype == np.uint8
    assert out.ndim == 2


def test_grayscale_cpu_dimensions_match_input() -> None:
    """Grayscale preserves height and width."""
    fn = get_stage_impl("grayscale", "cpu")
    out = fn(_solid_color_bgr(h=50, w=60))
    assert out.shape == (50, 60)


# ─── Real impl: threshold ───────────────────────────────────────────────────


def test_threshold_cpu_returns_2d_binary() -> None:
    """threshold on a grayscale ndarray returns a 2-D uint8 binary image.

    cv2's binary thresholds output values in {0, 255}.
    """
    fn = get_stage_impl("threshold", "cpu")
    # Build a gradient grayscale image.
    gray = np.tile(np.linspace(0, 255, 50, dtype=np.uint8)[None, :], (30, 1))
    out = fn(gray)
    assert isinstance(out, np.ndarray)
    assert out.ndim == 2
    assert out.dtype == np.uint8
    # Otsu binarisation produces only 0 or 255 values.
    unique_vals = set(int(v) for v in np.unique(out))
    assert unique_vals.issubset({0, 255}), f"got values {unique_vals!r}"


def test_threshold_cpu_deterministic_on_fixed_input() -> None:
    """Same input -> same output (no random state)."""
    fn = get_stage_impl("threshold", "cpu")
    gray = np.tile(np.linspace(0, 255, 50, dtype=np.uint8)[None, :], (30, 1))
    a = fn(gray)
    b = fn(gray)
    assert np.array_equal(a, b)


# ─── Real impl: invert ──────────────────────────────────────────────────────


def test_invert_cpu_returns_2d_uint8_complement() -> None:
    """invert is the bitwise complement on a uint8 image (255 - x)."""
    fn = get_stage_impl("invert", "cpu")
    binary = np.array([[0, 255], [255, 0]], dtype=np.uint8)
    out = fn(binary)
    assert np.array_equal(out, np.array([[255, 0], [0, 255]], dtype=np.uint8))


def test_invert_cpu_idempotent_after_two_applications() -> None:
    """invert(invert(x)) == x."""
    fn = get_stage_impl("invert", "cpu")
    binary = np.random.default_rng(seed=42).integers(0, 256, size=(10, 10), dtype=np.uint8)
    out = fn(fn(binary))
    assert np.array_equal(out, binary)


# ─── Real impl: ingest_source ──────────────────────────────────────────────
#
# `ingest_source` (chain root, depends_on=()) reads the per-page upload's
# raw bytes via IStorage and persists them at the canonical
# `pages/<page_id>/stages/ingest_source/output.png` path. The registry
# impl itself is bytes->bytes identity — the runner does the storage
# read; the impl runs in pure-bytes space. See `stage_runner.run_stage`
# for the special root-path that calls this with source_bytes.


def test_ingest_source_cpu_passes_through_bytes_unchanged() -> None:
    """ingest_source returns its input bytes unchanged (identity)."""
    fn = get_stage_impl("ingest_source", "cpu")
    payload = b"\x89PNG\r\n\x1a\n" + b"X" * 100
    out = fn(payload)
    assert out == payload


def test_ingest_source_cpu_returns_bytes_type() -> None:
    """ingest_source's output must be bytes (output_type='image_bytes')."""
    fn = get_stage_impl("ingest_source", "cpu")
    out = fn(b"some-jpg-bytes")
    assert isinstance(out, (bytes, bytearray))


# ─── Real impl: decode_source ───────────────────────────────────────────────
#
# `decode_source` sits between `ingest_source` (raw source bytes on disk)
# and `initial_crop`. The runner already decodes parent bytes via cv2.imdecode
# when loading parent artifacts, so by the time decode_source's impl is
# called the input is *already* a decoded ndarray. This stage's contract
# at the registry layer is therefore "pass through the decoded image" —
# the decode happened in the runner. Persisting it as its own artifact
# keeps Q3 (every-intermediate-persistence) honest and gives downstream
# stages a well-defined parent path.


def test_decode_source_cpu_passes_through_image() -> None:
    """decode_source returns the input ndarray unchanged.

    The runner decodes parent bytes before calling the impl; decode_source's
    job at the registry layer is to crystallise that decode as a persisted
    artifact. The transformation is identity in ndarray space.
    """
    fn = get_stage_impl("decode_source", "cpu")
    img = _solid_color_bgr()
    out = fn(img)
    assert isinstance(out, np.ndarray)
    assert out.dtype == np.uint8
    assert np.array_equal(out, img)


def test_decode_source_cpu_preserves_dimensions() -> None:
    """decode_source is shape-preserving."""
    fn = get_stage_impl("decode_source", "cpu")
    img = _solid_color_bgr(h=50, w=70)
    out = fn(img)
    assert out.shape == img.shape


# ─── Real impl: initial_crop ───────────────────────────────────────────────
#
# `initial_crop` reads cfg.initial_crop / cfg.initial_crop_all (4-tuple of
# pixel insets per side). When neither is set / both are zero — the
# default for a fresh project before the user configures crop — the
# stage is a no-op. ResolvedPageConfig plumbing through the runner lands
# in a later slice; for now the registered impl honours the default
# (no-crop) behavior so the chain is runnable end-to-end.


def test_initial_crop_cpu_passes_through_when_no_config() -> None:
    """initial_crop with default config is a no-op pass-through.

    Matches `process_page_cpu`'s 4d branch: `if any(crop): img =
    crop_edges(...)`. When `crop == (0,0,0,0)` (the default), the image
    is forwarded unchanged. Until ResolvedPageConfig is wired into the
    runner, the registered impl always takes the no-crop branch.
    """
    fn = get_stage_impl("initial_crop", "cpu")
    img = _solid_color_bgr()
    out = fn(img)
    assert isinstance(out, np.ndarray)
    assert np.array_equal(out, img)


def test_initial_crop_cpu_preserves_dimensions_at_default() -> None:
    """At default config initial_crop is shape-preserving."""
    fn = get_stage_impl("initial_crop", "cpu")
    img = _solid_color_bgr(h=80, w=120)
    out = fn(img)
    assert out.shape == img.shape


# ─── Real impl: manual_deskew_pre ───────────────────────────────────────────
#
# `manual_deskew_pre` reads cfg.deskew_before_crop (a degree value, default
# None). When None, the stage is a no-op. ResolvedPageConfig plumbing
# through the runner lands later; for now the impl honours the default
# (no-rotation) behavior so the chain is runnable.


def test_manual_deskew_pre_cpu_passes_through_when_no_config() -> None:
    """manual_deskew_pre with default config (no rotation) is a no-op.

    Matches `process_page_cpu`'s 4e branch: rotation only fires when
    cfg.deskew_before_crop is not None. Until ResolvedPageConfig reaches
    the runner the impl always takes the no-rotation branch.
    """
    fn = get_stage_impl("manual_deskew_pre", "cpu")
    img = _solid_color_bgr()
    out = fn(img)
    assert isinstance(out, np.ndarray)
    assert np.array_equal(out, img)


def test_manual_deskew_pre_cpu_preserves_dimensions_at_default() -> None:
    """At default config manual_deskew_pre is shape-preserving."""
    fn = get_stage_impl("manual_deskew_pre", "cpu")
    img = _solid_color_bgr(h=40, w=50)
    out = fn(img)
    assert out.shape == img.shape


# ─── Real impl: find_content_edges (Slice 9) ───────────────────────────────


def _binary_with_content(h: int = 100, w: int = 100) -> np.ndarray:
    """Binary image with white pixels in a centre rectangle (simulates text content)."""
    img = np.zeros((h, w), dtype=np.uint8)
    img[h // 5 : 4 * h // 5, w // 10 : 9 * w // 10] = 255
    return img


def test_find_content_edges_cpu_returns_four_tuple() -> None:
    """find_content_edges returns a 4-tuple (minX, maxX, minY, maxY)."""
    fn = get_stage_impl("find_content_edges", "cpu")
    out = fn(_binary_with_content())
    assert isinstance(out, tuple)
    assert len(out) == 4


def test_find_content_edges_cpu_values_within_image_bounds() -> None:
    """The returned bbox coordinates must be within the image dimensions."""
    h, w = 100, 120
    fn = get_stage_impl("find_content_edges", "cpu")
    minX, maxX, minY, maxY = fn(_binary_with_content(h=h, w=w))
    assert 0 <= minX <= maxX <= w, f"X range out of bounds: {minX}, {maxX}"
    assert 0 <= minY <= maxY <= h, f"Y range out of bounds: {minY}, {maxY}"


def test_find_content_edges_cpu_finds_content_rect() -> None:
    """Edges found roughly enclose the white content area (not the whole image)."""
    fn = get_stage_impl("find_content_edges", "cpu")
    img = _binary_with_content(h=100, w=100)
    minX, maxX, minY, maxY = fn(img)
    # Content is in [10:90, 20:80] → the detected region should be inside
    # the image bounds and narrower than the full image in at least one dim.
    assert maxX - minX < 100 or maxY - minY < 100


# ─── Real impl: crop_to_content (Slice 10) ─────────────────────────────────


def test_crop_to_content_cpu_shrinks_image() -> None:
    """crop_to_content(image, bbox) crops the image to the bbox region."""
    fn = get_stage_impl("crop_to_content", "cpu")
    img = np.zeros((100, 120), dtype=np.uint8)
    img[20:80, 15:105] = 255
    # Pass in a tight bbox.
    out = fn(img, (15, 105, 20, 80))
    assert isinstance(out, np.ndarray)
    h, w = out.shape[:2]
    # The crop should be smaller than the original in at least one dimension.
    assert h < 100 or w < 120


def test_crop_to_content_cpu_returns_ndarray() -> None:
    """crop_to_content returns a numpy ndarray."""
    fn = get_stage_impl("crop_to_content", "cpu")
    img = np.zeros((50, 60), dtype=np.uint8)
    out = fn(img, (5, 55, 5, 45))
    assert isinstance(out, np.ndarray)


# ─── Real impl: auto_deskew (Slice 10) ─────────────────────────────────────


def test_auto_deskew_cpu_returns_ndarray() -> None:
    """auto_deskew returns a numpy ndarray (not a tuple)."""
    fn = get_stage_impl("auto_deskew", "cpu")
    img = _binary_with_content()
    out = fn(img)
    assert isinstance(out, np.ndarray)


def test_auto_deskew_cpu_shape_reasonable() -> None:
    """auto_deskew output has positive dimensions."""
    fn = get_stage_impl("auto_deskew", "cpu")
    img = _binary_with_content(h=80, w=100)
    out = fn(img)
    h, w = out.shape[:2]
    assert h > 0 and w > 0


# ─── Real impl: morph_fill (Slice 10) ──────────────────────────────────────


def test_morph_fill_cpu_returns_ndarray() -> None:
    """morph_fill returns a numpy ndarray."""
    fn = get_stage_impl("morph_fill", "cpu")
    img = _binary_with_content()
    out = fn(img)
    assert isinstance(out, np.ndarray)


def test_morph_fill_cpu_preserves_dtype() -> None:
    """morph_fill preserves the uint8 dtype."""
    fn = get_stage_impl("morph_fill", "cpu")
    img = _binary_with_content()
    out = fn(img)
    assert out.dtype == np.uint8


# ─── Real impl: rescale (Slice 11) ─────────────────────────────────────────


def test_rescale_cpu_returns_ndarray() -> None:
    """rescale returns a numpy ndarray."""
    fn = get_stage_impl("rescale", "cpu")
    img = _binary_with_content()
    out = fn(img)
    assert isinstance(out, np.ndarray)


def test_rescale_cpu_targets_canonical_short_side() -> None:
    """rescale produces an image whose short side is ~1000px (canonical target)."""
    fn = get_stage_impl("rescale", "cpu")
    img = _binary_with_content(h=80, w=60)
    out = fn(img)
    h, w = out.shape[:2]
    short = min(h, w)
    assert short >= 900, f"rescale short side too small: {short}"


# ─── Real impl: canvas_map (Slice 11) ──────────────────────────────────────


def test_canvas_map_cpu_returns_ndarray() -> None:
    """canvas_map returns a numpy ndarray."""
    fn = get_stage_impl("canvas_map", "cpu")
    # canvas_map expects a re-inverted rescaled image (output of `rescale`).
    img = np.full((1000, 600), 200, dtype=np.uint8)
    out = fn(img)
    assert isinstance(out, np.ndarray)


def test_canvas_map_cpu_produces_canonical_aspect_ratio() -> None:
    """canvas_map places content onto a canvas with the canonical 1.65 h/w ratio."""
    fn = get_stage_impl("canvas_map", "cpu")
    img = np.full((1000, 600), 200, dtype=np.uint8)
    out = fn(img)
    h, w = out.shape[:2]
    ratio = h / w
    # Default h/w ratio is 1.65; allow ±20% for canvas padding.
    assert 1.0 <= ratio <= 2.5, f"unexpected canvas aspect ratio h/w={ratio:.2f}"


# ─── Real impl: auto_detect_attrs (Slice 12) ───────────────────────────────


def _png_from_array(arr: np.ndarray) -> bytes:
    """Encode an ndarray as PNG bytes for testing."""
    import cv2

    ok, buf = cv2.imencode(".png", arr)
    assert ok
    return bytes(buf.tobytes())


def test_auto_detect_attrs_cpu_returns_dict() -> None:
    """auto_detect_attrs returns a dict with page attribute fields.

    The impl receives an ndarray (the runner decodes the ingest_source
    image_bytes parent via cv2.imdecode before calling it).
    """
    fn = get_stage_impl("auto_detect_attrs", "cpu")
    img = np.full((100, 80, 3), 200, dtype=np.uint8)
    out = fn(img)
    assert isinstance(out, dict)


def test_auto_detect_attrs_cpu_has_required_fields() -> None:
    """auto_detect_attrs output must contain suggested_type, h_w_ratio, height, width."""
    fn = get_stage_impl("auto_detect_attrs", "cpu")
    img = np.full((120, 80, 3), 200, dtype=np.uint8)
    out = fn(img)
    assert "suggested_type" in out, f"missing 'suggested_type' in {out.keys()!r}"
    assert "h_w_ratio" in out, f"missing 'h_w_ratio' in {out.keys()!r}"
    assert "height" in out
    assert "width" in out


def test_auto_detect_attrs_cpu_blank_page_suggests_blank() -> None:
    """A mostly-white image should be detected as 'blank'."""
    fn = get_stage_impl("auto_detect_attrs", "cpu")
    white = np.full((100, 80, 3), 250, dtype=np.uint8)
    out = fn(white)
    assert out["suggested_type"] == "blank"


def test_auto_detect_attrs_cpu_h_w_ratio_from_dimensions() -> None:
    """h_w_ratio should match height/width of the input ndarray."""
    fn = get_stage_impl("auto_detect_attrs", "cpu")
    img = np.full((160, 100, 3), 180, dtype=np.uint8)
    out = fn(img)
    expected = 160 / 100
    assert abs(out["h_w_ratio"] - expected) < 0.01, f"h_w_ratio {out['h_w_ratio']} != {expected}"


# ─── Real impl: blank_proof_synth (Slice 12) ───────────────────────────────


def test_blank_proof_synth_cpu_returns_ndarray() -> None:
    """blank_proof_synth takes a page_attrs dict and returns an ndarray."""
    fn = get_stage_impl("blank_proof_synth", "cpu")
    page_attrs = {"suggested_type": "blank", "h_w_ratio": 1.5, "height": 150, "width": 100}
    out = fn(page_attrs)
    assert isinstance(out, np.ndarray)


def test_blank_proof_synth_cpu_produces_white_image() -> None:
    """blank_proof_synth returns a white (255-filled) image."""
    fn = get_stage_impl("blank_proof_synth", "cpu")
    page_attrs = {"suggested_type": "blank", "h_w_ratio": 1.65, "height": 165, "width": 100}
    out = fn(page_attrs)
    assert out.min() >= 250, f"expected white image, got min={out.min()}"


def test_blank_proof_synth_cpu_aspect_ratio_matches_attrs() -> None:
    """blank_proof_synth scales image to h_w_ratio from page_attrs."""
    fn = get_stage_impl("blank_proof_synth", "cpu")
    h_w = 2.0
    page_attrs = {"suggested_type": "blank", "h_w_ratio": h_w, "height": 200, "width": 100}
    out = fn(page_attrs)
    h, w = out.shape[:2]
    actual_ratio = h / w
    assert abs(actual_ratio - h_w) < 0.2, f"aspect ratio {actual_ratio:.2f} vs expected {h_w}"


# ─── Real impl: ocr_crop (Slice 13) ────────────────────────────────────────


def test_ocr_crop_cpu_passes_through_at_default_config() -> None:
    """ocr_crop is a pass-through at default config (no margin, no splits)."""
    fn = get_stage_impl("ocr_crop", "cpu")
    img = np.full((200, 120), 180, dtype=np.uint8)
    out = fn(img)
    assert isinstance(out, np.ndarray)
    assert np.array_equal(out, img)


def test_ocr_crop_cpu_preserves_dimensions() -> None:
    """ocr_crop at default config preserves height and width."""
    fn = get_stage_impl("ocr_crop", "cpu")
    img = np.full((300, 200), 100, dtype=np.uint8)
    out = fn(img)
    assert out.shape == img.shape


# ─── Real impl: thumbnail (Slice 14) ────────────────────────────────────────


def test_thumbnail_cpu_returns_jpeg_bytes() -> None:
    """thumbnail returns JPEG bytes (output_type='jpeg_bytes')."""
    fn = get_stage_impl("thumbnail", "cpu")
    img = _solid_color_bgr(h=400, w=300)
    out = fn(img)
    assert isinstance(out, bytes)
    # JPEG magic bytes: FF D8 FF
    assert out[:3] == b"\xff\xd8\xff", f"not a JPEG: first bytes = {out[:3]!r}"


def test_thumbnail_cpu_small_images_not_upscaled() -> None:
    """Images smaller than the max dim are not upscaled."""
    fn = get_stage_impl("thumbnail", "cpu")
    img = _solid_color_bgr(h=100, w=80)
    out = fn(img)
    assert isinstance(out, bytes)
    # Decode and check dimensions.
    import cv2

    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    h, w = arr.shape[:2]
    assert h == 100 and w == 80, f"small image was resized: {h}x{w}"


# ─── Real impl: auto_detect_illustrations (Slice 15) ────────────────────────


def test_auto_detect_illustrations_cpu_returns_list() -> None:
    """auto_detect_illustrations returns a list (of dicts or empty)."""
    fn = get_stage_impl("auto_detect_illustrations", "cpu")
    img = _solid_color_bgr(h=200, w=150)
    out = fn(img)
    assert isinstance(out, list)


# ─── Real impl: ocr (Slice 14) ───────────────────────────────────────────────


@pytest.mark.skipif(
    shutil.which("tesseract") is None,
    reason="tesseract not installed — skipped in CI; run locally with tesseract in PATH",
)
def test_ocr_cpu_returns_words_json_and_raw_txt(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """_ocr_cpu returns dict with 'words.json' and 'raw.txt' keys.

    Forces PGDP_OCR_ENGINE=tesseract via monkeypatch so DocTR weights are
    not loaded during the test suite.
    """
    import json

    monkeypatch.setenv("PGDP_OCR_ENGINE", "tesseract")
    fn = get_stage_impl("ocr", "cpu")
    # Small white image with a 'B' drawn in black — tesseract can read it.
    import cv2

    img = np.full((60, 60, 3), 255, dtype=np.uint8)
    cv2.putText(img, "B", (10, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 2)
    out = fn(img)
    assert isinstance(out, dict), f"expected dict, got {type(out).__name__}"
    assert "words.json" in out, f"missing 'words.json' in keys: {list(out.keys())}"
    assert "raw.txt" in out, f"missing 'raw.txt' in keys: {list(out.keys())}"
    # words.json must be a valid JSON list.
    words = json.loads(out["words.json"])
    assert isinstance(words, list), f"words.json must be a list, got {type(words).__name__}"
    # raw.txt must be bytes.
    assert isinstance(out["raw.txt"], bytes), "raw.txt must be bytes"


# ─── Real impl: text_review (Slice 14) ───────────────────────────────────────


def test_text_review_cpu_returns_output_txt_and_attestation(monkeypatch: pytest.MonkeyPatch) -> None:
    """_text_review_cpu returns dict with 'output.txt' and 'attestation.json'."""
    import json

    fn = get_stage_impl("text_review", "cpu")
    input_bytes = b"Hello world."
    out = fn(input_bytes)
    assert isinstance(out, dict), f"expected dict, got {type(out).__name__}"
    assert "output.txt" in out
    assert "attestation.json" in out
    assert out["output.txt"] == b"Hello world."
    attestation = json.loads(out["attestation.json"])
    assert isinstance(attestation, dict)
