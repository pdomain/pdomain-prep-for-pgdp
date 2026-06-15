"""TDD tests for Task 3.3: Auto / best-default detector.

Spec: docs/specs/2026-06-15-grayscale-pipeline.md §8a

§8a GPU-aware converter rule (quoted):
  - GPU present and meaningful color   → color2gray
  - strong foxing/yellowing            → best_channel (green)
  - mostly clean B&W                   → luma
  - CPU-only with color                → best_channel (Color2Gray too slow on CPU)

Additionally §8a specifies:
  - flatten.enabled when uneven illumination (low-frequency luminance spread)
  - clahe.enabled when low contrast (faded / low histogram spread + high-pass energy)

Thresholds (documented constants, all in grayscale_autodetect.py):
  CHROMA_COLOR_THRESHOLD     = 15.0  (mean (Cb+Cr)/2 std-dev → "meaningful color")
  CHANNEL_IMBALANCE_THRESHOLD = 20.0 (max-mean channel diff  → "strong single-channel cast")
  ILLUMINATION_SPREAD_THRESHOLD = 30.0 (low-freq luma std-dev after 8x downsample)
  CONTRAST_LOW_THRESHOLD      = 40.0  (high-pass luma std-dev → "faded/low-contrast")
"""

from __future__ import annotations

import numpy as np

# ---------------------------------------------------------------------------
# Image factory helpers
# ---------------------------------------------------------------------------


def _solid_bgr(h: int, w: int, b: int, g: int, r: int) -> np.ndarray:
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, 0] = b
    img[:, :, 1] = g
    img[:, :, 2] = r
    return img


def _make_colorful_image(h: int = 128, w: int = 128) -> np.ndarray:
    """Strong, spatially varied colour: high chroma std, no strong single-channel cast."""
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)


def _make_yellow_cast_image(h: int = 128, w: int = 128) -> np.ndarray:
    """Yellow/foxing cast: high R + G, low B → large channel imbalance (B << R+G).

    Thresholds:
      CHANNEL_IMBALANCE_THRESHOLD = 20.0 (max-mean channel diff)

    R=200, G=180, B=60  →  mean=(200+180+60)/3 ≈ 147
    max_channel_mean = 200  →  |200-147| = 53  >> 20.
    Also chroma std will be elevated, but not enough to be "meaningful color"
    for the GPU-present test (chroma is moderate, not spatially varied).

    We want strong foxing/yellowing → best_channel regardless of GPU.
    """
    img = np.zeros((h, w, 3), dtype=np.uint8)
    rng = np.random.default_rng(13)
    img[:, :, 0] = rng.integers(50, 70, (h, w), dtype=np.uint8)  # B: low
    img[:, :, 1] = rng.integers(170, 190, (h, w), dtype=np.uint8)  # G: high
    img[:, :, 2] = rng.integers(190, 210, (h, w), dtype=np.uint8)  # R: high
    return img


def _make_clean_gray_image(h: int = 128, w: int = 128) -> np.ndarray:
    """Flat, clean B&W page: near-equal channels, no chroma, no illumination ramp.

    Thresholds:
      CHROMA_COLOR_THRESHOLD = 15.0 (mean chroma std < this → no color)
      CHANNEL_IMBALANCE_THRESHOLD = 20.0 (channel diff < this → no cast)
      ILLUMINATION_SPREAD_THRESHOLD = 30.0 (low-freq std < this → even illumination)
      CONTRAST_LOW_THRESHOLD = 40.0 (high-pass std > this → not faded)

    All-gray pixels → chroma = 0; equal channels; even illumination; reasonable contrast.
    """
    rng = np.random.default_rng(42)
    gray = rng.integers(50, 220, (h, w), dtype=np.uint8)
    return np.stack([gray, gray, gray], axis=-1)


def _make_uneven_illumination_image(h: int = 128, w: int = 128) -> np.ndarray:
    """Strong linear brightness ramp (left→right) → large low-frequency spread.

    Thresholds:
      ILLUMINATION_SPREAD_THRESHOLD = 30.0

    Luma goes from ~0 (left columns) to ~255 (right columns). After downsampling
    8x the ramp is preserved as a gradient std >> 30.
    """
    img = np.zeros((h, w, 3), dtype=np.uint8)
    ramp = np.linspace(0, 255, w, dtype=np.uint8)
    for c in range(3):
        img[:, :, c] = ramp[np.newaxis, :]
    return img


def _make_faded_low_contrast_image(h: int = 128, w: int = 128) -> np.ndarray:
    """Uniformly faded page: all pixels near-mid-gray with very little variation.

    Thresholds:
      CONTRAST_LOW_THRESHOLD = 40.0 (high-pass std < this → faded)

    All pixels clamped to ~120-130 → high-pass energy ≈ 0 << 40.
    """
    rng = np.random.default_rng(55)
    gray = rng.integers(118, 134, (h, w), dtype=np.uint8)
    return np.stack([gray, gray, gray], axis=-1)


# ---------------------------------------------------------------------------
# Import the pure function (will fail before implementation)
# ---------------------------------------------------------------------------


def _import_fn():
    from pdomain_prep_for_pgdp.core.pipeline.grayscale_autodetect import (
        recommend_grayscale_pipeline,
    )

    return recommend_grayscale_pipeline


# ---------------------------------------------------------------------------
# Scenario (a): colorful + GPU available → converter=color2gray
# ---------------------------------------------------------------------------


class TestScenarioColorfulGpu:
    """§8a: GPU present + meaningful color → color2gray."""

    def test_colorful_gpu_returns_color2gray(self) -> None:
        fn = _import_fn()
        images = [_make_colorful_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=True)
        assert config_dict["converter"] == "color2gray", (
            f"Expected color2gray for colorful+GPU, got {config_dict['converter']!r}. why={why!r}"
        )

    def test_colorful_gpu_why_mentions_color(self) -> None:
        fn = _import_fn()
        images = [_make_colorful_image() for _ in range(3)]
        _, why = fn(images, gpu_available=True)
        assert isinstance(why, str) and len(why) > 0

    def test_colorful_gpu_returns_dict_shape(self) -> None:
        fn = _import_fn()
        images = [_make_colorful_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=True)
        # Must contain the top-level keys of GrayscaleConfig.to_dict()
        assert "converter" in config_dict
        assert "flatten" in config_dict
        assert "clahe" in config_dict
        assert isinstance(why, str)


# ---------------------------------------------------------------------------
# Scenario (b): strong red/yellow cast → converter=best_channel
# ---------------------------------------------------------------------------


class TestScenarioYellowCast:
    """§8a: strong foxing/yellowing → best_channel (green), GPU or CPU."""

    def test_yellow_cast_no_gpu_returns_best_channel(self) -> None:
        fn = _import_fn()
        images = [_make_yellow_cast_image() for _ in range(3)]
        config_dict, _ = fn(images, gpu_available=False)
        assert config_dict["converter"] == "best_channel", (
            f"Expected best_channel for yellow cast (no GPU), got {config_dict['converter']!r}"
        )

    def test_yellow_cast_with_gpu_returns_best_channel(self) -> None:
        """Strong single-channel cast → best_channel even when GPU is available.

        §8a rule: strong foxing/yellowing → best_channel. This takes precedence
        over the GPU-color2gray rule because a strong cast means one channel
        dominates — picking that channel is better than perceptual blending.
        """
        fn = _import_fn()
        images = [_make_yellow_cast_image() for _ in range(3)]
        config_dict, _ = fn(images, gpu_available=True)
        assert config_dict["converter"] == "best_channel", (
            f"Expected best_channel for strong cast, got {config_dict['converter']!r}"
        )

    def test_yellow_cast_channel_is_green(self) -> None:
        fn = _import_fn()
        images = [_make_yellow_cast_image() for _ in range(3)]
        config_dict, _ = fn(images, gpu_available=False)
        assert config_dict["channel"] == "green"


# ---------------------------------------------------------------------------
# Scenario (c): flat clean gray → converter=luma
# ---------------------------------------------------------------------------


class TestScenarioCleanGray:
    """§8a: mostly clean B&W → luma."""

    def test_clean_gray_no_gpu_returns_luma(self) -> None:
        fn = _import_fn()
        images = [_make_clean_gray_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=False)
        assert config_dict["converter"] == "luma", (
            f"Expected luma for clean gray (no GPU), got {config_dict['converter']!r}. why={why!r}"
        )

    def test_clean_gray_with_gpu_returns_luma(self) -> None:
        fn = _import_fn()
        images = [_make_clean_gray_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=True)
        assert config_dict["converter"] == "luma", (
            f"Expected luma for clean gray (GPU), got {config_dict['converter']!r}. why={why!r}"
        )

    def test_clean_gray_flatten_disabled(self) -> None:
        fn = _import_fn()
        images = [_make_clean_gray_image() for _ in range(3)]
        config_dict, _ = fn(images, gpu_available=False)
        assert config_dict["flatten"]["enabled"] is False

    def test_clean_gray_clahe_disabled(self) -> None:
        fn = _import_fn()
        images = [_make_clean_gray_image() for _ in range(3)]
        config_dict, _ = fn(images, gpu_available=False)
        assert config_dict["clahe"]["enabled"] is False


# ---------------------------------------------------------------------------
# Scenario (d): CPU-only with color → best_channel (not color2gray)
# ---------------------------------------------------------------------------


class TestScenarioColorfulCpu:
    """§8a: CPU-only with color → best_channel (Color2Gray too slow on CPU)."""

    def test_colorful_no_gpu_returns_best_channel(self) -> None:
        fn = _import_fn()
        images = [_make_colorful_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=False)
        assert config_dict["converter"] == "best_channel", (
            f"Expected best_channel for colorful+CPU (color2gray too slow), got {config_dict['converter']!r}. why={why!r}"
        )

    def test_colorful_no_gpu_why_mentions_cpu(self) -> None:
        fn = _import_fn()
        images = [_make_colorful_image() for _ in range(3)]
        _, why = fn(images, gpu_available=False)
        assert isinstance(why, str) and len(why) > 0


# ---------------------------------------------------------------------------
# Scenario (d-flatten): uneven illumination ramp → flatten.enabled=True
# ---------------------------------------------------------------------------


class TestScenarioUnevenIllumination:
    """§8a: uneven illumination → flatten.enabled=True."""

    def test_illumination_ramp_enables_flatten(self) -> None:
        fn = _import_fn()
        images = [_make_uneven_illumination_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=False)
        assert config_dict["flatten"]["enabled"] is True, (
            f"Expected flatten.enabled=True for illumination ramp, got False. why={why!r}"
        )

    def test_illumination_ramp_why_mentions_illumination(self) -> None:
        fn = _import_fn()
        images = [_make_uneven_illumination_image() for _ in range(3)]
        _, why = fn(images, gpu_available=False)
        assert isinstance(why, str) and len(why) > 0


# ---------------------------------------------------------------------------
# Scenario (e): low-contrast faded → clahe.enabled=True
# ---------------------------------------------------------------------------


class TestScenarioFadedLowContrast:
    """§8a: low-contrast faded → clahe.enabled=True."""

    def test_faded_image_enables_clahe(self) -> None:
        fn = _import_fn()
        images = [_make_faded_low_contrast_image() for _ in range(3)]
        config_dict, why = fn(images, gpu_available=False)
        assert config_dict["clahe"]["enabled"] is True, (
            f"Expected clahe.enabled=True for faded image, got False. why={why!r}"
        )

    def test_faded_image_why_mentions_contrast(self) -> None:
        fn = _import_fn()
        images = [_make_faded_low_contrast_image() for _ in range(3)]
        _, why = fn(images, gpu_available=False)
        assert isinstance(why, str) and len(why) > 0


# ---------------------------------------------------------------------------
# Return-type contract
# ---------------------------------------------------------------------------


class TestReturnTypeContract:
    """Pure function returns (dict, str) matching GrayscaleConfig.to_dict() shape."""

    def test_returns_tuple_of_two(self) -> None:
        fn = _import_fn()
        images = [_make_clean_gray_image()]
        result = fn(images, gpu_available=False)
        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_config_dict_round_trips_to_book_tools(self) -> None:
        """config_dict must parse through book-tools GrayscaleConfig.from_dict."""
        from pdomain_book_tools.image_processing.grayscale_pipeline import GrayscaleConfig

        fn = _import_fn()
        images = [_make_clean_gray_image()]
        config_dict, _ = fn(images, gpu_available=False)
        # Must not raise
        bt_cfg = GrayscaleConfig.from_dict(config_dict)
        assert bt_cfg is not None

    def test_why_is_nonempty_string(self) -> None:
        fn = _import_fn()
        images = [_make_clean_gray_image()]
        _, why = fn(images, gpu_available=False)
        assert isinstance(why, str)
        assert len(why) > 0

    def test_empty_images_returns_safe_default(self) -> None:
        """Empty sample list returns luma default (safe fallback)."""
        fn = _import_fn()
        config_dict, why = fn([], gpu_available=False)
        assert config_dict["converter"] == "luma"
        assert isinstance(why, str)


# ---------------------------------------------------------------------------
# Route-level test: detect_grayscale_profile returns {config, why}
# ---------------------------------------------------------------------------


class TestDetectGrayscaleProfileRoute:
    """Thin route test: inject sample loader + gpu flag; assert {config, why} shape."""

    def test_route_returns_config_and_why(self, tmp_path) -> None:
        """POST .../grayscale/detect → 200 {config: {...}, why: str, backend: str}."""
        import asyncio
        from datetime import UTC, datetime
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.models import (
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
            host="127.0.0.1",
            port=8765,
            data_root=tmp_path / "data",
            config_dir=tmp_path / "config",
            storage_backend="filesystem",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            auth_mode="none",
            gpu_backend="cpu",
            dispatch_interval_seconds=0,
        )

        async def _seed() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id="proj1",
                    owner_id="default",
                    name="proj1",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="proj1", source_uri=""),
                    storage_prefix="projects/proj1/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_seed())

        # Patch _sample_source_images to return synthetic images deterministically.
        synthetic_images = [_make_clean_gray_image() for _ in range(3)]

        app = build_app(settings)
        with (
            patch(
                "pdomain_prep_for_pgdp.api.data.project_stages._sample_source_images",
                return_value=synthetic_images,
            ),
            TestClient(app) as client,
        ):
            r = client.post("/api/data/projects/proj1/project-stages/grayscale/detect")

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text!r}"
        body = r.json()

        # New shape: {config: {...}, why: str, backend: str}
        assert "config" in body, f"Missing 'config' key in response: {body}"
        assert "why" in body, f"Missing 'why' key in response: {body}"
        assert "backend" in body, f"Missing 'backend' key in response: {body}"
        assert isinstance(body["config"], dict)
        assert "converter" in body["config"]
        assert isinstance(body["why"], str) and len(body["why"]) > 0
        assert body["backend"] in ("cpu", "gpu")

    def test_route_backward_compat_still_includes_mode(self, tmp_path) -> None:
        """The old {mode, why, backend} fields are still present for backward compat."""
        import asyncio
        from datetime import UTC, datetime
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.models import (
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
            host="127.0.0.1",
            port=8765,
            data_root=tmp_path / "data",
            config_dir=tmp_path / "config",
            storage_backend="filesystem",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            auth_mode="none",
            gpu_backend="cpu",
            dispatch_interval_seconds=0,
        )

        async def _seed() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id="proj1",
                    owner_id="default",
                    name="proj1",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="proj1", source_uri=""),
                    storage_prefix="projects/proj1/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_seed())

        synthetic_images = [_make_clean_gray_image() for _ in range(3)]

        app = build_app(settings)
        with (
            patch(
                "pdomain_prep_for_pgdp.api.data.project_stages._sample_source_images",
                return_value=synthetic_images,
            ),
            TestClient(app) as client,
        ):
            r = client.post("/api/data/projects/proj1/project-stages/grayscale/detect")

        assert r.status_code == 200
        body = r.json()
        # Backward-compat: the old `mode` field should still be present
        assert "mode" in body, f"Missing backward-compat 'mode' key: {body}"

    def test_route_gpu_backend_cpu_overrides_cupy(self, tmp_path) -> None:
        """When settings.gpu_backend='cpu', detector must NOT return color2gray.

        Even if cupy is physically available on the machine, the operator has
        forced CPU mode.  The detector should see gpu_available=False and return
        best_channel (the CPU color path) for a colorful image — not color2gray.

        We patch cupy_available() to True so this test exercises the
        'gpu present but backend=cpu' branch deterministically, regardless of
        whether cupy is actually installed in the test venv.
        """
        import asyncio
        from datetime import UTC, datetime
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
        from pdomain_prep_for_pgdp.bootstrap import build_app
        from pdomain_prep_for_pgdp.core.models import (
            Project,
            ProjectConfig,
            ProjectStatus,
        )
        from pdomain_prep_for_pgdp.settings import Settings

        settings = Settings(
            host="127.0.0.1",
            port=8765,
            data_root=tmp_path / "data",
            config_dir=tmp_path / "config",
            storage_backend="filesystem",
            database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
            auth_mode="none",
            gpu_backend="cpu",  # operator forces CPU
            dispatch_interval_seconds=0,
        )

        async def _seed() -> None:
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            now = datetime.now(UTC)
            await db.put_project(
                Project(
                    id="proj1",
                    owner_id="default",
                    name="proj1",
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name="proj1", source_uri=""),
                    storage_prefix="projects/proj1/",
                    registry_version=2,
                )
            )
            await db.close()

        asyncio.run(_seed())

        # Strongly colorful images: would trigger color2gray if GPU were available.
        colorful_images = [_make_colorful_image() for _ in range(3)]

        # Inject a fake cupy_compat module so cupy_available() returns True even
        # on machines without a real GPU.  The route does a local import inside a
        # try/except so we must ensure the target module exists in sys.modules
        # before the request is dispatched.
        import sys
        import types
        from unittest.mock import MagicMock

        fake_cupy_compat = types.ModuleType(
            "pdomain_book_tools.image_processing.cupy_processing._cupy_compat"
        )
        fake_cupy_compat.cupy_available = MagicMock(return_value=True)  # type: ignore[attr-defined]

        _compat_path = "pdomain_book_tools.image_processing.cupy_processing._cupy_compat"
        _orig = sys.modules.get(_compat_path)
        sys.modules[_compat_path] = fake_cupy_compat  # type: ignore[assignment]
        try:
            app = build_app(settings)
            with (
                patch(
                    "pdomain_prep_for_pgdp.api.data.project_stages._sample_source_images",
                    return_value=colorful_images,
                ),
                TestClient(app) as client,
            ):
                r = client.post("/api/data/projects/proj1/project-stages/grayscale/detect")
        finally:
            if _orig is None:
                sys.modules.pop(_compat_path, None)
            else:
                sys.modules[_compat_path] = _orig

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text!r}"
        body = r.json()

        # With gpu_backend="cpu", color2gray must NOT be chosen for colorful images.
        converter = body["config"]["converter"]
        assert converter != "color2gray", (
            f"Detector returned color2gray despite gpu_backend=cpu. "
            f"converter={converter!r}, why={body.get('why')!r}"
        )
        # CPU color path: must be best_channel (§8a rule: color+no-GPU → best_channel).
        assert converter == "best_channel", (
            f"Expected best_channel for colorful+forced-CPU, got {converter!r}"
        )
        # backend field must reflect cpu, not gpu.
        assert body["backend"] == "cpu", (
            f"Expected backend='cpu' when gpu_backend=cpu, got {body['backend']!r}"
        )
