"""W4 Group 4 — Persistence routes.

Routes tested:
  GET  /api/data/projects/{id}/activity
  GET  /api/data/projects/{id}/attributes
  PATCH /api/data/projects/{id}/attributes/{section}
  POST /api/data/projects/{id}/clean
  POST /api/data/projects/{id}/export
  POST /api/data/projects/{id}/pipeline/reset
  POST /api/data/projects/{id}/pipeline/purge
  POST /api/data/projects/{id}/project-stages/validation/waive
  PATCH /api/data/projects/{id}/project-stages/archive/items/{name}
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


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
    author: str = "Test Author",
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
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(
                    book_name=project_id,
                    source_uri="",
                    author=author,
                ),
                storage_prefix=f"projects/{project_id}/",
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())


class TestProjectActivity:
    """GET /projects/{id}/activity → activity feed."""

    def test_activity_returns_200_with_entries(self, tmp_path: Path) -> None:
        """GET /activity → 200 with entries list."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/activity")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)

    def test_activity_404_on_missing_project(self, tmp_path: Path) -> None:
        """GET /activity → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/NOTEXIST/activity")
        assert r.status_code == 404

    def test_activity_accepts_limit_param(self, tmp_path: Path) -> None:
        """GET /activity?limit=5 → 200 (limit query param accepted)."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/activity?limit=5")
        assert r.status_code == 200


class TestProjectAttributes:
    """GET + PATCH /projects/{id}/attributes."""

    def test_get_attributes_returns_200(self, tmp_path: Path) -> None:
        """GET /attributes → 200 with bib/pgdp/fmt/comments keys."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", author="Jane Austen")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/attributes")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "bib" in body
        assert "pgdp" in body
        assert "fmt" in body
        assert "comments" in body

    def test_get_attributes_derives_author(self, tmp_path: Path) -> None:
        """GET /attributes → bib.Author derived from project config."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1", author="Jane Austen")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/attributes")
        body = r.json()
        assert body["bib"].get("Author") == "Jane Austen"

    def test_get_attributes_404_on_missing_project(self, tmp_path: Path) -> None:
        """GET /attributes → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/NOTEXIST/attributes")
        assert r.status_code == 404

    def test_patch_attributes_returns_200(self, tmp_path: Path) -> None:
        """PATCH /attributes/{section} → 200 with updated attrs."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.patch(
                "/api/data/projects/proj1/attributes/bib",
                json={"Author": "New Author", "Title": "Updated Title"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "bib" in body

    def test_patch_attributes_persists_change(self, tmp_path: Path) -> None:
        """PATCH /attributes/bib then GET /attributes → change reflected."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            client.patch(
                "/api/data/projects/proj1/attributes/bib",
                json={"Author": "Persisted Author"},
            )
            r = client.get("/api/data/projects/proj1/attributes")
        assert r.status_code == 200
        body = r.json()
        assert body["bib"].get("Author") == "Persisted Author"

    def test_patch_attributes_404_on_missing_project(self, tmp_path: Path) -> None:
        """PATCH /attributes/{section} → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.patch(
                "/api/data/projects/NOTEXIST/attributes/bib",
                json={"Author": "X"},
            )
        assert r.status_code == 404


class TestManageClean:
    """POST /projects/{id}/clean — reclaim stage artifacts."""

    def test_clean_returns_200_with_reclaimed_bytes(self, tmp_path: Path) -> None:
        """POST /clean → 200 with reclaimedBytes."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/proj1/clean")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reclaimed_bytes" in body

    def test_clean_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST /clean → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/NOTEXIST/clean")
        assert r.status_code == 404


class TestManageExport:
    """POST /projects/{id}/export — save copy."""

    def test_export_returns_200(self, tmp_path: Path) -> None:
        """POST /export → 200 with export info."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/proj1/export")
        assert r.status_code == 200, r.text

    def test_export_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST /export → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/NOTEXIST/export")
        assert r.status_code == 404


class TestPipelineReset:
    """POST /projects/{id}/pipeline/reset — reset pipeline state."""

    def test_reset_returns_200(self, tmp_path: Path) -> None:
        """POST /pipeline/reset → 200."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/proj1/pipeline/reset")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "project_id" in body

    def test_reset_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST /pipeline/reset → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/NOTEXIST/pipeline/reset")
        assert r.status_code == 404


class TestPipelinePurge:
    """POST /projects/{id}/pipeline/purge — destructive purge."""

    def test_purge_returns_200(self, tmp_path: Path) -> None:
        """POST /pipeline/purge → 200."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/proj1/pipeline/purge")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "project_id" in body

    def test_purge_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST /pipeline/purge → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post("/api/data/projects/NOTEXIST/pipeline/purge")
        assert r.status_code == 404


class TestValidationWaiver:
    """POST .../validation/waive — persist validation rule waiver."""

    def test_waive_returns_200(self, tmp_path: Path) -> None:
        """POST /validation/waive → 200."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/proj1/project-stages/validation/waive",
                json={"rule_id": "W001", "note": "Acknowledged typo variant"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True

    def test_waive_404_on_missing_project(self, tmp_path: Path) -> None:
        """POST /validation/waive → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.post(
                "/api/data/projects/NOTEXIST/project-stages/validation/waive",
                json={"rule_id": "W001", "note": ""},
            )
        assert r.status_code == 404


class TestArchiveItemToggle:
    """PATCH .../archive/items/{name} — toggle archive item keep/drop."""

    def test_toggle_returns_200(self, tmp_path: Path) -> None:
        """PATCH /archive/items/{name} → 200 with ok."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings, "proj1")

        # Create the archive stage dir so the manifest can be written
        archive_dir = tmp_path / "data" / "projects" / "proj1" / "stages" / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.patch(
                "/api/data/projects/proj1/project-stages/archive/items/page_001",
                json={"keep": False},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ok" in body

    def test_toggle_404_on_missing_project(self, tmp_path: Path) -> None:
        """PATCH /archive/items/{name} → 404 for unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        app = build_app(settings)
        with TestClient(app) as client:
            r = client.patch(
                "/api/data/projects/NOTEXIST/project-stages/archive/items/page_001",
                json={"keep": False},
            )
        assert r.status_code == 404
