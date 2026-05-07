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
