"""Tests-first: per-call `engine=` override on `core.ocr.ocr_page`.

`OcrPageRequest.engine` was already on the wire shape, but the ocr_page
function ignored it and always trusted `cfg.ocr_engine`. These tests lock
in that the kwarg now overrides the resolved config for that one call.

Also covers narrowed exception handling added in Task 5:
- `_detect_torch_device` must not silently swallow RuntimeError from CUDA.
- `OcrPageResult.words_error` surfaces Tesseract bbox failures to callers.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from pd_prep_for_pgdp.core.models import (
    AlignmentOverride,
    PageType,
    ResolvedPageConfig,
    SystemDefaults,
)


def _cfg(*, engine: str = "doctr") -> ResolvedPageConfig:
    return ResolvedPageConfig(
        text_threshold=140,
        page_h_w_ratio=1.65,
        fuzzy_pct=0.02,
        pixel_count_columns=150,
        pixel_count_rows=75,
        ocr_bbox_edge_min_words=5,
        ocr_engine=engine,  # type: ignore[arg-type]
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
    )


def test_engine_kwarg_overrides_resolved_config(monkeypatch: pytest.MonkeyPatch) -> None:
    from pd_prep_for_pgdp.core import ocr as ocr_module

    captured: dict[str, Any] = {}

    def fake_tesseract(image_path: Path, *, cfg: ResolvedPageConfig, system: SystemDefaults):
        captured["used"] = "tesseract"
        captured["engine_in_cfg"] = cfg.ocr_engine
        return ocr_module.OcrPageResult(text="t", words=[], page=None)

    monkeypatch.setattr(ocr_module, "_ocr_page_tesseract", fake_tesseract)

    # Resolved config says doctr, but the call passes engine="tesseract".
    ocr_module.ocr_page(
        Path("/tmp/does-not-need-to-exist.png"),
        cfg=_cfg(engine="doctr"),
        system=SystemDefaults(),
        engine="tesseract",
    )
    assert captured["used"] == "tesseract"
    assert captured["engine_in_cfg"] == "tesseract"


def test_no_engine_kwarg_uses_resolved_config(monkeypatch: pytest.MonkeyPatch) -> None:
    from pd_prep_for_pgdp.core import ocr as ocr_module

    captured: dict[str, Any] = {}

    def fake_tesseract(image_path: Path, *, cfg: ResolvedPageConfig, system: SystemDefaults):
        captured["used"] = "tesseract"
        return ocr_module.OcrPageResult(text="t", words=[], page=None)

    monkeypatch.setattr(ocr_module, "_ocr_page_tesseract", fake_tesseract)

    # No engine kwarg + cfg says tesseract -> tesseract path runs.
    ocr_module.ocr_page(
        Path("/tmp/x.png"),
        cfg=_cfg(engine="tesseract"),
        system=SystemDefaults(),
    )
    assert captured["used"] == "tesseract"


# ─── Task 5: Narrowed exception handling ────────────────────────────────────


def test_detect_torch_device_returns_cpu_on_cuda_runtime_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """RuntimeError from cuda.is_available() must be logged at WARNING, not silently swallowed."""
    from pd_prep_for_pgdp.core import ocr as ocr_module

    mock_torch = MagicMock()
    mock_torch.cuda.is_available.side_effect = RuntimeError("CUDA driver not loaded")

    with (
        patch.dict(sys.modules, {"torch": mock_torch}),
        caplog.at_level(logging.WARNING, logger="pd_prep_for_pgdp.core.ocr"),
    ):
        result = ocr_module._detect_torch_device()

    assert result == "cpu"
    assert any("CUDA" in r.message and r.levelno == logging.WARNING for r in caplog.records), (
        f"Expected a WARNING mentioning CUDA, got: {[r.message for r in caplog.records]}"
    )


def test_detect_torch_device_import_error_returns_cpu() -> None:
    """If torch is not importable, _detect_torch_device must return 'cpu' silently."""
    from pd_prep_for_pgdp.core import ocr as ocr_module

    # Temporarily hide torch from sys.modules.
    saved = sys.modules.pop("torch", None)
    try:
        with patch.dict(sys.modules, {"torch": None}):  # type: ignore[dict-item]
            result = ocr_module._detect_torch_device()
    finally:
        if saved is not None:
            sys.modules["torch"] = saved

    assert result == "cpu"


def test_ocr_page_result_has_words_error_field() -> None:
    """OcrPageResult must expose a words_error field (None by default)."""
    from pd_prep_for_pgdp.core.ocr import OcrPageResult

    r = OcrPageResult(text="hello", words=[], page=None)
    assert r.words_error is None


def test_tesseract_image_to_data_failure_sets_words_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """When image_to_data raises, the result must carry words_error and words=[]."""
    from pd_prep_for_pgdp.core import ocr as ocr_module

    # Create a tiny real image so PIL.Image.open succeeds.
    img_path = tmp_path / "test.png"
    try:
        from PIL import Image  # type: ignore[import-not-found]

        img = Image.new("L", (10, 10), color=255)
        img.save(img_path)
    except ImportError:
        pytest.skip("Pillow not installed")

    import types

    fake_pytesseract = types.ModuleType("pytesseract")
    fake_pytesseract.image_to_string = lambda img, config="": "some text"  # type: ignore[attr-defined]
    fake_pytesseract.image_to_data = MagicMock(  # type: ignore[attr-defined]
        side_effect=RuntimeError("Tesseract segfault simulation")
    )

    class _Output:
        DICT = "dict"

    fake_pytesseract.Output = _Output()  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)

    result = ocr_module._ocr_page_tesseract(
        img_path,
        cfg=_cfg(engine="tesseract"),
        system=SystemDefaults(),
    )

    assert result.words == []
    assert result.words_error is not None
    assert "RuntimeError" in result.words_error


# ─── Issue 1: words_error is logged in the OCR stage pipeline ───────────────


def test_ocr_cpu_stage_logs_words_error(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When ocr_page returns a result with words_error set, _ocr_cpu must emit
    a WARNING so the user knows why words.json will be empty."""
    from pd_prep_for_pgdp.core import ocr as ocr_module

    error_msg = "TestError: something failed"

    def fake_ocr_page(image_path, *, cfg, system, **kwargs):
        return ocr_module.OcrPageResult(
            text="",
            words=[],
            page=None,
            words_error=error_msg,
        )

    # _ocr_cpu uses a local `from ...core.ocr import ocr_page`, so patch
    # the function on the source module so the local re-import picks it up.
    monkeypatch.setattr(ocr_module, "ocr_page", fake_ocr_page)

    import numpy as np

    blank_image = np.zeros((10, 10), dtype=np.uint8)
    cfg = _cfg(engine="tesseract")

    import cv2  # type: ignore[import-not-found]

    # Patch cv2.imwrite so no real file I/O is needed for the temp PNG.
    monkeypatch.setattr(cv2, "imwrite", lambda path, img: True)

    with caplog.at_level(logging.WARNING, logger="pd_prep_for_pgdp.core.pipeline.stage_registry"):
        from pd_prep_for_pgdp.core.pipeline.stage_registry import _ocr_cpu

        _ocr_cpu(blank_image, cfg=cfg)

    warning_messages = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    assert any(error_msg in m for m in warning_messages), (
        f"Expected WARNING containing {error_msg!r}, got: {warning_messages}"
    )
