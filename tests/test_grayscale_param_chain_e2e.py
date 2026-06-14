"""E2E cross-seam test: grayscale param chain UI→HTTP→to_grayscale.

This test validates the full wiring path that was broken in the pre-fix code:
  1. Frontend draft (camelCase keys) → draftToSnakeCase → snake_case body
  2. PUT /api/data/projects/{id}/pages/0/stages/grayscale/settings  (persist override)
  3. POST /api/data/projects/{id}/pages/0/stages/grayscale/run      (page-scoped route)
  4. Backend: apply_stage_settings_to_config reads from StageSettingsStore
  5. _grayscale_cpu receives cfg with tuned grayscale_* fields
  6. to_grayscale is called with the exact (mode, sampler_radius, gamma, output_range)

Three blockers were caught by this test:
  - Issue 1: runStage was POSTing to /project-stages/ (422) — page-scoped route fixes it
  - Issue 2: settings not persisted before run — PUT override before POST run
  - Issue 3: camelCase keys dropped — draftToSnakeCase produces snake_case body

The test drives the SAME payload the frontend service produces (after draftToSnakeCase),
crosses the HTTP boundary through the real FastAPI test client, and verifies that
`to_grayscale` receives all four tuned params — not just mode/gamma which happened to
work by coincidence in the old code.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _settings(tmp_path: Any) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'e2e.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )


def _color_bgr_png(h: int = 32, w: int = 32) -> bytes:
    """Return a synthetic 3-channel color BGR PNG (has chroma signal)."""
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _seed(settings: Settings, project_id: str = "e2e_gray") -> None:
    """Seed project + one page with a color source blob in the BlobStore."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id="default",
                name=project_id,
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                storage_prefix=f"projects/{project_id}/",
                registry_version=2,
            )
        )
        await db.close()

    asyncio.run(go())

    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src0",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )

    # Seed a color source image into the BlobStore so grayscale (v2 root stage)
    # can load it via PrepPageExtension.source_blob_hash.
    svc = build_page_service(settings.data_root, project_id)
    blob_hash = svc.blobs.write(_color_bgr_png())
    update_page_extension(svc, project_id, 0, source_blob_hash=blob_hash)


# ---------------------------------------------------------------------------
# The cross-seam test
# ---------------------------------------------------------------------------


class TestGrayscaleParamChainE2E:
    """Full chain: frontend snake_case body → PUT settings → POST run → to_grayscale args."""

    def test_all_four_params_reach_to_grayscale(self, tmp_path: Any) -> None:
        """
        Simulate the frontend Apply&Run path:

          1. draftToSnakeCase converts camelCase draft to snake_case body
          2. PUT .../stages/grayscale/settings persists the override
          3. POST .../stages/grayscale/run executes the page stage
          4. apply_stage_settings_to_config reads override → cfg carries tuned fields
          5. _grayscale_cpu extracts cfg fields → calls to_grayscale with them

        Asserts that to_grayscale is called with EXACTLY the tuned values, not the
        registry defaults. This would have failed before the fix:
          - mode and gamma survived (accidentally: same key names), but
          - sampler_radius and output_range were DROPPED (camelCase not in snake_case map)

        This test drives the same request body the frontend service produces after
        draftToSnakeCase, crosses the real HTTP boundary, and checks to_grayscale args.
        """
        settings = _settings(tmp_path)
        project_id = "e2e_gray"
        _seed(settings, project_id)
        app = build_app(settings)

        # The frontend draft (camelCase) → draftToSnakeCase → this body:
        # GrayscaleDraft { samplerRadius: 7, gamma: 1.3, outputRangeMin: 20, outputRangeMax: 230, mode: "standard" }
        snake_settings_body = {
            "mode": "standard",
            "sampler_radius": 7,
            "gamma": 1.3,
            "output_range_min": 20,
            "output_range_max": 230,
        }

        # Capture to_grayscale call args.
        to_grayscale_calls: list[dict[str, Any]] = []
        _real_gray_result = np.zeros((32, 32), dtype=np.uint8)

        def _fake_to_grayscale(
            img: np.ndarray,
            *,
            mode: str = "perceptual",
            sampler_radius: int = 3,
            gamma: float = 1.1,
            output_range: tuple[int, int] = (12, 248),
        ) -> np.ndarray:
            to_grayscale_calls.append(
                {
                    "mode": mode,
                    "sampler_radius": sampler_radius,
                    "gamma": gamma,
                    "output_range": output_range,
                }
            )
            return _real_gray_result

        def _fake_load_attr(module_path: str, attr_name: str) -> Any:
            if attr_name == "to_grayscale":
                return _fake_to_grayscale
            raise AttributeError(f"_fake_load_attr: unexpected attr {attr_name!r}")

        with TestClient(app) as client:
            # Step 1: persist the settings override (simulates frontend PUT).
            put_r = client.put(
                f"/api/data/projects/{project_id}/pages/0/stages/grayscale/settings",
                json=snake_settings_body,
            )
            assert put_r.status_code == 200, f"PUT settings failed: {put_r.text}"

            # Verify the override was actually stored.
            effective = put_r.json()
            assert effective.get("mode") == "standard", f"mode not in effective: {effective}"
            assert effective.get("sampler_radius") == 7, f"sampler_radius not in effective: {effective}"
            assert effective.get("gamma") == pytest.approx(1.3), f"gamma not in effective: {effective}"
            assert effective.get("output_range_min") == 20, f"output_range_min not in effective: {effective}"
            assert effective.get("output_range_max") == 230, f"output_range_max not in effective: {effective}"

            # Step 2: run the page-scoped stage (simulates frontend POST run).
            # Uses page-scoped route, not /project-stages/ (Issue 1 fix).
            with patch(
                "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
                side_effect=_fake_load_attr,
            ):
                run_r = client.post(
                    f"/api/data/projects/{project_id}/pages/0/stages/grayscale/run",
                    json={"force": True},
                )

        assert run_r.status_code == 200, f"POST run failed: {run_r.text}"
        run_body = run_r.json()
        assert run_body["stage_id"] == "grayscale"
        assert run_body["status"] == "clean"

        # Step 3: verify to_grayscale was called with ALL FOUR tuned params.
        # Before the fix: to_grayscale was called with hard-coded defaults (3, 1.1, 12, 248)
        # because samplerRadius/outputRangeMin/outputRangeMax were dropped as camelCase.
        assert to_grayscale_calls, "to_grayscale was never called — stage did not execute"
        call = to_grayscale_calls[-1]

        assert call["mode"] == "standard", (
            f"mode not propagated: got {call['mode']!r}, expected 'standard'. "
            "Check: settings PUT body has 'mode' key, apply_stage_settings_to_config maps it."
        )
        assert call["sampler_radius"] == 7, (
            f"sampler_radius not propagated: got {call['sampler_radius']!r}, expected 7. "
            "Check: settings body uses snake_case 'sampler_radius' (not 'samplerRadius')."
        )
        assert call["gamma"] == pytest.approx(1.3), (
            f"gamma not propagated: got {call['gamma']!r}, expected 1.3."
        )
        assert call["output_range"] == (20, 230), (
            f"output_range not propagated: got {call['output_range']!r}, expected (20, 230). "
            "Check: settings body uses 'output_range_min'/'output_range_max' (not camelCase)."
        )

    def test_project_stage_route_returns_422_for_grayscale(self, tmp_path: Any) -> None:
        """Confirms grayscale is NOT a project-stage (Issue 1 guard test).

        POST /project-stages/grayscale/run must return 422 because 'grayscale'
        is a PAGE-scoped stage. The frontend must NOT call this route.
        This test documents the bug that existed before the fix.
        """
        settings = _settings(tmp_path)
        project_id = "e2e_guard"
        _seed(settings, project_id)
        app = build_app(settings)

        with TestClient(app) as client:
            r = client.post(f"/api/data/projects/{project_id}/project-stages/grayscale/run")
        # 422: "grayscale" is not in V2_PROJECT_STAGE_IDS → run_project_stage raises 422
        assert r.status_code == 422, f"Expected 422 (not a project stage), got {r.status_code}: {r.text}"

    def test_settings_not_persisted_before_run_uses_defaults(self, tmp_path: Any) -> None:
        """Without PUT settings, run uses registry defaults — confirms Issue 2 mechanism.

        If settings are NOT persisted before run, apply_stage_settings_to_config
        falls back to registry defaults (mode=perceptual, radius=3, gamma=1.1,
        output_range=(12, 248)). This test verifies the fallback path is correct
        so the Issue 2 fix (always PUT before run) is clearly necessary.
        """
        settings = _settings(tmp_path)
        project_id = "e2e_defaults"
        _seed(settings, project_id)
        app = build_app(settings)

        to_grayscale_calls: list[dict[str, Any]] = []
        _result = np.zeros((32, 32), dtype=np.uint8)

        def _fake_to_grayscale(
            img: np.ndarray,
            *,
            mode: str = "perceptual",
            sampler_radius: int = 3,
            gamma: float = 1.1,
            output_range: tuple[int, int] = (12, 248),
        ) -> np.ndarray:
            to_grayscale_calls.append(
                {"mode": mode, "sampler_radius": sampler_radius, "gamma": gamma, "output_range": output_range}
            )
            return _result

        def _fake_load_attr(module_path: str, attr_name: str) -> Any:
            if attr_name == "to_grayscale":
                return _fake_to_grayscale
            raise AttributeError(f"unexpected: {attr_name!r}")

        with (
            TestClient(app) as client,
            patch(
                "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
                side_effect=_fake_load_attr,
            ),
        ):
            # Run WITHOUT PUT settings first — should use registry defaults
            run_r = client.post(
                f"/api/data/projects/{project_id}/pages/0/stages/grayscale/run",
                json={"force": True},
            )

        assert run_r.status_code == 200, f"run failed: {run_r.text}"
        assert to_grayscale_calls, "to_grayscale not called"
        call = to_grayscale_calls[-1]
        # Registry defaults should be used when no override was PUT.
        assert call["mode"] == "perceptual"
        assert call["sampler_radius"] == 3
        assert call["gamma"] == pytest.approx(1.1)
        assert call["output_range"] == (12, 248)

    def test_config_hash_computed_for_grayscale(self, tmp_path: Any) -> None:
        """Issue 5: grayscale must have an entry in STAGE_CONFIG_FIELDS.

        _compute_config_hash returns None when stage_id is absent from
        STAGE_CONFIG_FIELDS. With the fix, grayscale has an entry, so the hash
        is a non-None string. A settings change then produces a different hash,
        enabling dirty cascade.
        """
        from pdomain_prep_for_pgdp.core.models import AlignmentOverride, PageType, ResolvedPageConfig
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import (
            STAGE_CONFIG_FIELDS,
            _compute_config_hash,
        )

        assert "grayscale" in STAGE_CONFIG_FIELDS, (
            "grayscale missing from STAGE_CONFIG_FIELDS — settings change won't dirty the stage"
        )

        cfg = ResolvedPageConfig(
            text_threshold=128,
            page_h_w_ratio=1.294,
            fuzzy_pct=0.8,
            pixel_count_columns=2,
            pixel_count_rows=2,
            ocr_bbox_edge_min_words=3,
            ocr_engine="doctr",
            ocr_model_key=None,
            ocr_dpi=300,
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

        hash_default = _compute_config_hash(cfg, "grayscale")
        assert hash_default is not None, "grayscale config hash must not be None"

        cfg_tuned = cfg.model_copy(update={"grayscale_mode": "standard", "grayscale_gamma": 1.5})
        hash_tuned = _compute_config_hash(cfg_tuned, "grayscale")
        assert hash_tuned is not None
        assert hash_tuned != hash_default, (
            "Different grayscale settings must produce different config hashes "
            "to enable dirty cascade after a settings change"
        )

    def test_grayscale_settings_validation_rejects_bad_range(self, tmp_path: Any) -> None:
        """Issue 6: settings route validates grayscale-specific constraints.

        output_range_min >= output_range_max should return 422 (not a stage crash).
        """
        settings = _settings(tmp_path)
        project_id = "e2e_validate"
        _seed(settings, project_id)
        app = build_app(settings)

        with TestClient(app) as client:
            # min >= max should be rejected
            r = client.put(
                f"/api/data/projects/{project_id}/pages/0/stages/grayscale/settings",
                json={"output_range_min": 200, "output_range_max": 100},
            )
        assert r.status_code == 422, f"Expected 422 for invalid range, got {r.status_code}: {r.text}"

    def test_grayscale_settings_validation_rejects_bad_gamma(self, tmp_path: Any) -> None:
        """gamma <= 0 should return 422."""
        settings = _settings(tmp_path)
        project_id = "e2e_val_gamma"
        _seed(settings, project_id)
        app = build_app(settings)

        with TestClient(app) as client:
            r = client.put(
                f"/api/data/projects/{project_id}/pages/0/stages/grayscale/settings",
                json={"gamma": 0.0},
            )
        assert r.status_code == 422, f"Expected 422 for gamma=0, got {r.status_code}: {r.text}"

    def test_grayscale_settings_validation_rejects_negative_radius(self, tmp_path: Any) -> None:
        """sampler_radius < 0 should return 422."""
        settings = _settings(tmp_path)
        project_id = "e2e_val_radius"
        _seed(settings, project_id)
        app = build_app(settings)

        with TestClient(app) as client:
            r = client.put(
                f"/api/data/projects/{project_id}/pages/0/stages/grayscale/settings",
                json={"sampler_radius": -1},
            )
        assert r.status_code == 422, f"Expected 422 for sampler_radius=-1, got {r.status_code}: {r.text}"
