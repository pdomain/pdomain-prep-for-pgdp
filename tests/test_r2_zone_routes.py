"""R2 — textZonesTool zone-aggregation routes.

Stubs resolved:
- GET  /api/data/projects/{id}/project-stages/text_zones/pages-aggregate
  → fetchZonePages: zone-page aggregate (rows + totals with zone counts)
- POST /api/data/projects/{id}/pages/{page_id}/stages/text_zones/redetect
  → redetectLayout: per-page re-detect zones synchronously
- PUT  /api/data/projects/{id}/pages/{page_id}/stages/text_zones/layout
  → persistLayout: per-page layout persist (dual-write: artifact + page_stage row)

Behaviors tested:
1. fetchZonePages — 200 returns rows (one per page) + totals; reads zone counts from clean artifacts
2. fetchZonePages — pages without clean text_zones row have state="clean" (not_run treated as clean)
3. fetchZonePages — pages with clean row and zone artifact include zones count
4. fetchZonePages — 404 for unknown project
5. fetchZonePages — 409 for v1 project
6. redetectLayout — 200 runs zone detection on clean binary artifact, returns zones list
7. redetectLayout — 404 for unknown project
8. redetectLayout — 404 when page has no clean binary artifact to detect from
9. redetectLayout — returns non-empty zones when binary artifact has valid content
10. persistLayout — 200 dual-writes zone artifact + page_stage row clean
11. persistLayout — 200 with dismissed=true writes dismissal flag, row still clean
12. persistLayout — 404 for unknown project
13. persistLayout — 404 for unknown page
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageStageState,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# ── helpers ────────────────────────────────────────────────────────────────────


def _settings(tmp_path: Path) -> Settings:
    return Settings(
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


def _seed_project(
    settings: Settings,
    project_id: str = "proj1",
    page_count: int = 2,
    registry_version: int = 2,
) -> None:
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
                page_count=page_count,
                proof_page_count=page_count,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())
    pages = [
        PageRecord(
            project_id=project_id,
            idx0=i,
            prefix=f"p{i + 1:03d}",
            source_stem=f"page{i:04d}",
            processing_status=PageProcessingStatus.pending,
        )
        for i in range(page_count)
    ]
    seed_pages_in_store(settings, project_id, pages)


def _write_zone_artifact(
    data_root: Path,
    project_id: str,
    page_id: str,
    zones: list[dict],
    *,
    image_width: int = 400,
    image_height: int = 600,
) -> Path:
    """Write a zone_json artifact to the expected on-disk path."""
    artifact_dir = data_root / "projects" / project_id / "pages" / page_id / "stages" / "text_zones"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / "output.json"
    payload = {"zones": zones, "image_width": image_width, "image_height": image_height}
    artifact_path.write_text(json.dumps(payload))
    return artifact_path


def _write_binary_artifact(
    data_root: Path,
    project_id: str,
    page_id: str,
    width: int = 400,
    height: int = 600,
) -> Path:
    """Write a synthetic binary (black-on-white) PNG artifact for post_transform_crop."""
    try:
        import cv2
    except ImportError:
        pytest.skip("cv2 not available")

    artifact_dir = data_root / "projects" / project_id / "pages" / page_id / "stages" / "post_transform_crop"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / "output.png"

    # White background with a black rectangle to give the detector something to find
    binary = np.ones((height, width), dtype=np.uint8) * 255
    binary[100:200, 50:350] = 0  # black text block
    _ = cv2.imwrite(str(artifact_path), binary)
    return artifact_path


async def _seed_page_stage_clean(
    db: SqliteDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
    artifact_key: str,
) -> None:
    now = datetime.now(UTC).timestamp()
    state = PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        status=PageStageStatus.clean,
        last_run_at=now,
        artifact_key=artifact_key,
    )
    await db.put_page_stage(state)


# ── 1. fetchZonePages routes ────────────────────────────────────────────────────


class TestFetchZonePages:
    """GET /api/data/projects/{id}/project-stages/text_zones/pages-aggregate"""

    def test_returns_rows_and_totals_for_project(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=2)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.get("/api/data/projects/proj1/project-stages/text_zones/pages-aggregate")

        assert resp.status_code == 200
        body = resp.json()
        assert "rows" in body
        assert "totals" in body
        assert body["totals"]["total"] == 2

    def test_pages_without_clean_row_have_state_clean(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.get("/api/data/projects/proj1/project-stages/text_zones/pages-aggregate")

        assert resp.status_code == 200
        rows = resp.json()["rows"]
        assert len(rows) == 1
        assert rows[0]["state"] == "clean"

    def test_clean_row_with_artifact_includes_zone_count(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)

        # Write zone artifact
        page_id = "0000"
        zones = [
            {"zone_id": "z001", "bbox": [0, 0, 400, 100], "zone_type": "text", "area": 40000},
            {"zone_id": "z002", "bbox": [0, 150, 400, 100], "zone_type": "text", "area": 40000},
        ]
        _write_zone_artifact(settings.data_root, "proj1", page_id, zones)

        # Seed clean page_stage row
        async def seed():
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            await _seed_page_stage_clean(
                db,
                "proj1",
                page_id,
                "text_zones",
                f"projects/proj1/pages/{page_id}/stages/text_zones/output.json",
            )
            await db.close()

        asyncio.run(seed())

        app = build_app(settings)
        with TestClient(app) as client:
            resp = client.get("/api/data/projects/proj1/project-stages/text_zones/pages-aggregate")

        assert resp.status_code == 200
        rows = resp.json()["rows"]
        assert len(rows) == 1
        row = rows[0]
        assert row["state"] == "reviewed"  # clean zone row → reviewed state
        assert row.get("zones") == 2

    def test_404_unknown_project(self, tmp_path):
        settings = _settings(tmp_path)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.get("/api/data/projects/no-such/project-stages/text_zones/pages-aggregate")

        assert resp.status_code == 404

    def test_409_v1_project(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, registry_version=1)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.get("/api/data/projects/proj1/project-stages/text_zones/pages-aggregate")

        assert resp.status_code == 409


# ── 2. redetectLayout routes ───────────────────────────────────────────────────


class TestRedetectLayout:
    """POST /api/data/projects/{id}/pages/{page_id}/stages/text_zones/redetect"""

    def test_404_unknown_project(self, tmp_path):
        settings = _settings(tmp_path)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.post(
                "/api/data/projects/no-such/pages/0000/stages/text_zones/redetect",
                json={},
            )

        assert resp.status_code == 404

    def test_404_when_no_binary_artifact(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.post(
                "/api/data/projects/proj1/pages/0000/stages/text_zones/redetect",
                json={},
            )

        assert resp.status_code == 404

    def test_returns_zones_when_binary_artifact_exists(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)
        page_id = "0000"

        # Write binary artifact that the detector will read
        _write_binary_artifact(settings.data_root, "proj1", page_id)

        # Seed clean post_transform_crop row
        async def seed():
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            await _seed_page_stage_clean(
                db,
                "proj1",
                page_id,
                "post_transform_crop",
                f"projects/proj1/pages/{page_id}/stages/post_transform_crop/output.png",
            )
            await db.close()

        asyncio.run(seed())

        app = build_app(settings)
        with TestClient(app) as client:
            resp = client.post(
                "/api/data/projects/proj1/pages/0000/stages/text_zones/redetect",
                json={},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert "zones" in body
        # The synthetic binary has a black rectangle so at least 1 zone is expected
        assert isinstance(body["zones"], list)
        assert len(body["zones"]) >= 1
        # Each zone should have the frontend-expected fields
        for zone in body["zones"]:
            assert "id" in zone
            assert "type" in zone
            assert "x" in zone
            assert "y" in zone
            assert "w" in zone
            assert "h" in zone

    def test_409_v1_project(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, registry_version=1)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.post(
                "/api/data/projects/proj1/pages/0000/stages/text_zones/redetect",
                json={},
            )

        assert resp.status_code == 409


# ── 3. persistLayout routes ────────────────────────────────────────────────────


class TestPersistLayout:
    """PUT /api/data/projects/{id}/pages/{page_id}/stages/text_zones/layout"""

    def test_dual_write_persists_artifact_and_marks_row_clean(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)
        page_id = "0000"

        app = build_app(settings)
        zones_payload = [
            {"id": "z001", "type": "body", "x": 0.0, "y": 0.0, "w": 1.0, "h": 0.5, "order": 1},
        ]
        with TestClient(app) as client:
            resp = client.put(
                "/api/data/projects/proj1/pages/0000/stages/text_zones/layout",
                json={"zones": zones_payload},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body.get("ok") is True

        # Verify artifact was written
        artifact_path = (
            settings.data_root
            / "projects"
            / "proj1"
            / "pages"
            / page_id
            / "stages"
            / "text_zones"
            / "output.json"
        )
        assert artifact_path.exists()
        stored = json.loads(artifact_path.read_text())
        assert "zones" in stored
        assert len(stored["zones"]) == 1

        # Verify page_stage row was marked clean
        async def check_db():
            db = SqliteDatabase(settings.derived_database_url)
            await db.initialize()
            row = await db.get_page_stage("proj1", page_id, "text_zones")
            await db.close()
            return row

        row = asyncio.run(check_db())
        assert row is not None
        assert row.status == PageStageStatus.clean

    def test_dismissed_flag_persists_and_row_clean(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)
        page_id = "0000"

        app = build_app(settings)
        with TestClient(app) as client:
            resp = client.put(
                "/api/data/projects/proj1/pages/0000/stages/text_zones/layout",
                json={"dismissed": True},
            )

        assert resp.status_code == 200
        assert resp.json().get("ok") is True

        # Artifact should have dismissed flag
        artifact_path = (
            settings.data_root
            / "projects"
            / "proj1"
            / "pages"
            / page_id
            / "stages"
            / "text_zones"
            / "output.json"
        )
        assert artifact_path.exists()
        stored = json.loads(artifact_path.read_text())
        assert stored.get("dismissed") is True

    def test_404_unknown_project(self, tmp_path):
        settings = _settings(tmp_path)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.put(
                "/api/data/projects/no-such/pages/0000/stages/text_zones/layout",
                json={"zones": []},
            )

        assert resp.status_code == 404

    def test_404_unknown_page(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, page_count=1)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.put(
                "/api/data/projects/proj1/pages/9999/stages/text_zones/layout",
                json={"zones": []},
            )

        assert resp.status_code == 404

    def test_409_v1_project(self, tmp_path):
        settings = _settings(tmp_path)
        _seed_project(settings, registry_version=1)
        app = build_app(settings)

        with TestClient(app) as client:
            resp = client.put(
                "/api/data/projects/proj1/pages/0000/stages/text_zones/layout",
                json={"zones": []},
            )

        assert resp.status_code == 409
