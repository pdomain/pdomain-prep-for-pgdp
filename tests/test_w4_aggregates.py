"""W4 Group 3 — Stage aggregate routes.

Routes tested:
  GET  /api/data/projects/{id}/project-stages/{stage_id}/pages
  POST /api/data/projects/{id}/project-stages/{stage_id}/rerun
  POST /api/data/projects/{id}/project-stages/wordcheck/accept-dict
  POST /api/data/projects/{id}/project-stages/wordcheck/accept-high
  POST /api/data/projects/{id}/project-stages/text_review/approve-low-risk
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    PageStageState,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _make_settings(tmp_path: Path) -> Settings:
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
    registry_version: int = 2,
    page_count: int = 3,
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
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
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
                idx0=i,
                prefix=f"page_{i:04d}",
                source_stem=f"src{i}",
                processing_status=PageProcessingStatus.pending,
            )
            for i in range(page_count)
        ],
    )


def _seed_page_stage(
    settings: Settings,
    project_id: str,
    page_id: str,
    stage_id: str,
    status: PageStageStatus,
    error_message: str | None = None,
) -> None:
    """Seed a single page_stage row into the database."""

    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        await db.put_page_stage(
            PageStageState(
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                status=status,
                error_message=error_message,
            )
        )
        await db.close()

    asyncio.run(go())


class TestGetProjectStagePages:
    """GET /projects/{id}/project-stages/{stage_id}/pages returns page rows."""

    def test_get_stage_pages_returns_200_with_rows(self, tmp_path: Path) -> None:
        """GET stage/pages → 200 with rows list."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", page_count=3)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/ocr/pages")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body
        assert "totals" in body

    def test_get_stage_pages_404_on_missing_project(self, tmp_path: Path) -> None:
        """GET stage/pages → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/NOTEXIST/project-stages/ocr/pages")
        assert r.status_code == 404

    def test_get_stage_pages_409_on_v1_project(self, tmp_path: Path) -> None:
        """GET stage/pages → 409 for v1 project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", registry_version=1, page_count=2)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/ocr/pages")
        assert r.status_code == 409

    def test_get_stage_pages_reflects_stage_status(self, tmp_path: Path) -> None:
        """GET stage/pages reflects actual page_stage status in rows."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", page_count=3)

        # Seed one page with failed status for 'ocr'
        _seed_page_stage(settings, "proj1", "0001", "ocr", PageStageStatus.failed, "timeout")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/ocr/pages")
        assert r.status_code == 200
        body = r.json()
        rows = body["rows"]
        # The failed page should appear in results
        failed = [row for row in rows if row.get("state") == "failed"]
        assert len(failed) >= 1
        # totals.errors should count it
        assert body["totals"]["errors"] >= 1

    def test_get_stage_pages_totals_include_all_counts(self, tmp_path: Path) -> None:
        """GET stage/pages totals has all required keys."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", page_count=2)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/ocr/pages")
        assert r.status_code == 200
        totals = r.json()["totals"]
        # All keys expected by imageStageReview machine
        for key in ("total", "clean", "flagged", "done", "reviewed", "errors", "running"):
            assert key in totals, f"missing key: {key}"

    def test_get_stage_pages_row_shape(self, tmp_path: Path) -> None:
        """Each PageRow has idx, prefix, state, pageNumber."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", page_count=2)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/grayscale/pages")
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert len(rows) == 2
        for row in rows:
            assert "idx" in row
            assert "prefix" in row
            assert "state" in row
            assert "pageNumber" in row


class TestBatchedRerunRoute:
    """POST /projects/{id}/project-stages/{stage_id}/rerun."""

    def test_rerun_returns_200_with_page_rows(self, tmp_path: Path) -> None:
        """POST rerun → 200 with updated rows."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", page_count=3)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/ocr/rerun",
                json={"page_ids": ["0001", "0002"]},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        # Returns queued rows for each requested page
        assert "rows" in body
        rows = body["rows"]
        assert len(rows) == 2

    def test_rerun_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST rerun → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/NOTEXIST/project-stages/ocr/rerun",
                json={"page_ids": ["0001"]},
            )
        assert r.status_code == 404

    def test_rerun_409_on_v1_project(self, tmp_path: Path) -> None:
        """POST rerun → 409 for v1 project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", registry_version=1, page_count=2)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/ocr/rerun",
                json={"page_ids": ["0001"]},
            )
        assert r.status_code == 409


class TestWordcheckAcceptRoutes:
    """POST /project-stages/wordcheck/accept-dict and accept-high."""

    def test_accept_dict_returns_200(self, tmp_path: Path) -> None:
        """POST wordcheck/accept-dict → 200."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/wordcheck/accept-dict",
                json={},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "fixed_ids" in body

    def test_accept_dict_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST wordcheck/accept-dict → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/NOTEXIST/project-stages/wordcheck/accept-dict",
                json={},
            )
        assert r.status_code == 404

    def test_accept_high_returns_200(self, tmp_path: Path) -> None:
        """POST wordcheck/accept-high → 200."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/wordcheck/accept-high",
                json={},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "accepted_ids" in body

    def test_accept_high_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST wordcheck/accept-high → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/NOTEXIST/project-stages/wordcheck/accept-high",
                json={},
            )
        assert r.status_code == 404


class TestTextReviewApproveLowRisk:
    """POST /project-stages/text_review/approve-low-risk."""

    def test_approve_low_risk_returns_200(self, tmp_path: Path) -> None:
        """POST text_review/approve-low-risk → 200."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/text_review/approve-low-risk",
                json={},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "approved_ids" in body

    def test_approve_low_risk_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST text_review/approve-low-risk → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/NOTEXIST/project-stages/text_review/approve-low-risk",
                json={},
            )
        assert r.status_code == 404
