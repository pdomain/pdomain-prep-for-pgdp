"""Behavior 2 — Composed page-scoped stages execute folded micro-steps.

Spec: docs/specs/stage-registry-v2.md §3 (folding analysis)
      - crop folds: initial_crop + find_content_edges + crop_to_content
      - threshold folds: threshold + invert
      - deskew folds: manual_deskew_pre (post-crop) + auto_deskew
      - canvas_map folds: morph_fill + rescale + canvas_map + blank_proof_synth branch
      - grayscale folds: manual_deskew_pre (pre-crop) + grayscale
      - post_ocr_crop = ocr_crop re-key
      - regex = text_postprocess re-key

Equivalence contract: V2 composed stage output == v1 micro-step chain output
on the same synthetic input (black text on white background).
"""

from __future__ import annotations

import numpy as np
import pytest


def _solid_bgr(h: int = 60, w: int = 80) -> np.ndarray:
    """Synthetic color image for testing."""
    img = np.full((h, w, 3), [200, 190, 180], dtype=np.uint8)
    # Add some "text" marks for edge detection
    img[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4] = [10, 10, 10]
    return img


def _binary_image(h: int = 80, w: int = 60) -> np.ndarray:
    """Synthetic binary image (black text on white)."""
    img = np.full((h, w), 255, dtype=np.uint8)
    img[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4] = 0
    return img


# ─── V2 grayscale: absorbs manual_deskew_pre (pre-crop) ────────────────────


def test_grayscale_v2_returns_2d_array() -> None:
    """v2 grayscale stage returns a 2D grayscale array."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("grayscale", "cpu")
    img = _solid_bgr()
    out = fn(img)
    assert isinstance(out, np.ndarray)
    assert out.ndim == 2
    assert out.dtype == np.uint8


def test_grayscale_v2_equivalent_to_v1_chain() -> None:
    """v2 grayscale output == deskew_pre(no-op) + grayscale on default config."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    img = _solid_bgr()
    # v2 output
    v2_fn = get_v2_stage_impl("grayscale", "cpu")
    v2_out = v2_fn(img)

    # v1 chain output (manual_deskew_pre at default = pass-through, then grayscale)
    deskew_fn = get_stage_impl("manual_deskew_pre", "cpu")
    gray_fn = get_stage_impl("grayscale", "cpu")
    v1_out = gray_fn(deskew_fn(img))

    assert np.array_equal(v2_out, v1_out), "v2 grayscale must equal v1 chain output"


# ─── V2 crop: absorbs initial_crop + find_content_edges + crop_to_content ───


def test_crop_v2_returns_2d_binary() -> None:
    """v2 crop stage returns a 2D array."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("crop", "cpu")
    # crop takes gray (2D) as input per stage-registry-v2.md §2.1
    gray = np.full((80, 60), 200, dtype=np.uint8)
    gray[20:60, 10:50] = 0  # some content
    out = fn(gray)
    assert isinstance(out, np.ndarray)
    assert out.ndim == 2


def test_crop_v2_equivalent_to_v1_chain() -> None:
    """v2 crop output == initial_crop(no-op) + find_edges + crop_to_content."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    gray = np.full((80, 60), 200, dtype=np.uint8)
    gray[20:60, 10:50] = 0

    # v2 output
    v2_fn = get_v2_stage_impl("crop", "cpu")
    v2_out = v2_fn(gray)

    # v1 chain: initial_crop (no-op) → find_content_edges → crop_to_content
    initial_crop_fn = get_stage_impl("initial_crop", "cpu")
    edges_fn = get_stage_impl("find_content_edges", "cpu")
    crop_fn = get_stage_impl("crop_to_content", "cpu")
    cropped = initial_crop_fn(gray)
    bbox = edges_fn(cropped)
    v1_out = crop_fn(cropped, bbox)

    assert np.array_equal(v2_out, v1_out), "v2 crop must equal v1 chain output"


# ─── V2 threshold: absorbs threshold + invert ───────────────────────────────


def test_threshold_v2_returns_binary_values() -> None:
    """v2 threshold stage returns values in {0, 255} only."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("threshold", "cpu")
    gray = np.tile(np.linspace(0, 255, 60, dtype=np.uint8)[None, :], (40, 1))
    out = fn(gray)
    assert isinstance(out, np.ndarray)
    unique_vals = {int(v) for v in np.unique(out)}
    assert unique_vals.issubset({0, 255}), f"unexpected values: {unique_vals}"


def test_threshold_v2_equivalent_to_v1_chain() -> None:
    """v2 threshold output == v1 threshold + invert."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    gray = np.tile(np.linspace(0, 255, 60, dtype=np.uint8)[None, :], (40, 1))

    v2_fn = get_v2_stage_impl("threshold", "cpu")
    v2_out = v2_fn(gray)

    thresh_fn = get_stage_impl("threshold", "cpu")
    invert_fn = get_stage_impl("invert", "cpu")
    v1_out = invert_fn(thresh_fn(gray))

    assert np.array_equal(v2_out, v1_out), "v2 threshold must equal v1 threshold+invert"


# ─── V2 canvas_map: absorbs morph_fill + rescale + canvas_map ───────────────


def test_canvas_map_v2_returns_array() -> None:
    """v2 canvas_map stage returns an ndarray."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("canvas_map", "cpu")
    binary = _binary_image(h=100, w=80)
    out = fn(binary)
    assert isinstance(out, np.ndarray)
    assert out.ndim >= 2


def test_canvas_map_v2_equivalent_to_v1_chain() -> None:
    """v2 canvas_map output == v1 morph_fill + rescale + canvas_map."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    binary = _binary_image(h=100, w=80)

    v2_fn = get_v2_stage_impl("canvas_map", "cpu")
    v2_out = v2_fn(binary)

    morph_fn = get_stage_impl("morph_fill", "cpu")
    rescale_fn = get_stage_impl("rescale", "cpu")
    canvas_fn = get_stage_impl("canvas_map", "cpu")
    v1_out = canvas_fn(rescale_fn(morph_fn(binary)))

    assert np.array_equal(v2_out, v1_out), "v2 canvas_map must equal v1 chain output"


def test_canvas_map_v2_blank_page_short_circuit() -> None:
    """v2 canvas_map uses internal blank branch for blank page type."""
    from pdomain_prep_for_pgdp.core.models import PageType
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("canvas_map", "cpu")

    class _BlankCfg:
        page_type = PageType.blank

    binary = _binary_image(h=100, w=80)
    out_blank = fn(binary, _BlankCfg())
    _ = fn(binary)  # normal branch — invoke to verify it does not raise

    # Blank branch produces a white image
    assert out_blank.min() >= 250, "blank branch should produce white image"


# ─── V2 post_ocr_crop: re-key of ocr_crop ───────────────────────────────────


def test_post_ocr_crop_v2_equivalent_to_ocr_crop() -> None:
    """v2 post_ocr_crop is equivalent to v1 ocr_crop at default config."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    img = np.full((200, 150), 180, dtype=np.uint8)

    v2_fn = get_v2_stage_impl("post_ocr_crop", "cpu")
    v1_fn = get_stage_impl("ocr_crop", "cpu")

    v2_out = v2_fn(img)
    v1_out = v1_fn(img)
    assert np.array_equal(v2_out, v1_out)


# ─── V2 regex: re-key of text_postprocess ───────────────────────────────────


def test_regex_v2_equivalent_to_text_postprocess() -> None:
    """v2 regex is equivalent to v1 text_postprocess for curly-quote normalization."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    text = "\u201cHello\u201d \u2013 world.".encode("utf-8")
    v2_fn = get_v2_stage_impl("regex", "cpu")
    v1_fn = get_stage_impl("text_postprocess", "cpu")

    v2_out = v2_fn(text)
    v1_out = v1_fn(text)
    assert v2_out == v1_out


# ─── V2 text_review: re-key ─────────────────────────────────────────────────


def test_text_review_v2_passes_through() -> None:
    """v2 text_review returns dict with output.txt and attestation.json."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("text_review", "cpu")
    out = fn(b"Hello world")
    assert isinstance(out, dict)
    assert "output.txt" in out
    assert "attestation.json" in out


# ─── New stages: NotImplemented placeholders ─────────────────────────────────


@pytest.mark.skip(reason="B4 implemented all project-scoped tail stages — no placeholder stubs remain")
def test_new_stage_placeholder_raises_stage_not_implemented() -> None:
    """Formerly checked that B4 stages were placeholder stubs.

    B4 (Task B4: Project-scoped tail stages) implemented all 7 stages:
    page_order, validation, proof_pack, build_package, zip, submit_check, archive.
    Coverage moved to tests/test_b4_tail_stages.py and tests/test_gate_chain.py.
    """


# ─── V2 illustrations: registers without crashing ────────────────────────────


def test_illustrations_v2_runs_auto_detect() -> None:
    """v2 illustrations stage runs auto_detect and returns regions json."""
    import json

    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("illustrations", "cpu")
    img = np.full((200, 150, 3), 200, dtype=np.uint8)
    out = fn(img)
    assert isinstance(out, dict)
    assert "regions.json" in out
    regions = json.loads(out["regions.json"])
    assert isinstance(regions, list)
