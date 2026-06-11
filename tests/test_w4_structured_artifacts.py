"""W4 Group 5 — Structured artifact routes.

Routes tested:
  GET /api/data/projects/{id}/project-stages/proof_pack/artifact
      → { tree: TreeRow[], completeness: { complete, total } }
  GET /api/data/projects/{id}/project-stages/build_package/artifact
      → { deliverable: { files, count }, manifest: { ... } }
  GET /api/data/projects/{id}/project-stages/archive/artifact
      → archive manifest JSON

All return 404 when stage is not clean or artifact file does not exist.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStageStatus,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore
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


def _seed_project(settings: Settings, project_id: str = "proj1") -> None:
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
                config=ProjectConfig(book_name=project_id, source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
                registry_version=2,
            )
        )
        await db.close()

    asyncio.run(go())


def _mark_stage_clean(settings: Settings, project_id: str, stage_id: str) -> None:
    """Mark a project stage as clean in the store."""
    db_path = settings.data_root / "projects" / project_id / "project_stages.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    from pdomain_prep_for_pgdp.core.models import ProjectStageState

    store = ProjectStageStore(db_path)
    store.write(
        ProjectStageState(
            project_id=project_id,
            stage_id=stage_id,
            status=ProjectStageStatus.clean,
        )
    )


def _write_artifact(settings: Settings, project_id: str, stage_id: str, data: object) -> None:
    """Write an artifact JSON file for a stage."""
    stage_dir = settings.data_root / "projects" / project_id / "stages" / stage_id
    stage_dir.mkdir(parents=True, exist_ok=True)
    if stage_id == "build_package":
        (stage_dir / "output.zip").write_bytes(b"PK\x03\x04fake")
    else:
        (stage_dir / "output.json").write_text(json.dumps(data))


class TestProofPackArtifact:
    """GET /project-stages/proof_pack/artifact → structured tree/completeness."""

    def test_proof_pack_artifact_404_when_not_clean(self, tmp_path: Path) -> None:
        """GET proof_pack/artifact → 404 when stage is not clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/proof_pack/artifact")
        assert r.status_code == 404

    def test_proof_pack_artifact_returns_json_when_clean(self, tmp_path: Path) -> None:
        """GET proof_pack/artifact → JSON with tree and completeness when clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "proof_pack")
        _write_artifact(
            settings,
            "proj1",
            "proof_pack",
            {
                "tree": [{"name": "001.png", "dir": False, "d": 0}],
                "completeness": {"complete": 1, "total": 2},
            },
        )

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/proof_pack/artifact")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tree" in body
        assert "completeness" in body
        assert isinstance(body["tree"], list)
        assert "complete" in body["completeness"]
        assert "total" in body["completeness"]


class TestBuildPackageArtifact:
    """GET /project-stages/build_package/artifact → ZIP bytes."""

    def test_build_package_artifact_404_when_not_clean(self, tmp_path: Path) -> None:
        """GET build_package/artifact → 404 when stage is not clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/artifact")
        assert r.status_code == 404

    def test_build_package_artifact_returns_zip_when_clean(self, tmp_path: Path) -> None:
        """GET build_package/artifact → ZIP bytes when stage is clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "build_package")
        _write_artifact(settings, "proj1", "build_package", {})

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/artifact")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/zip")


class TestArchiveArtifact:
    """GET /project-stages/archive/artifact → archive manifest JSON."""

    def test_archive_artifact_404_when_not_clean(self, tmp_path: Path) -> None:
        """GET archive/artifact → 404 when stage is not clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/archive/artifact")
        assert r.status_code == 404

    def test_archive_artifact_returns_json_when_clean(self, tmp_path: Path) -> None:
        """GET archive/artifact → JSON manifest when stage is clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "archive")
        _write_artifact(
            settings,
            "proj1",
            "archive",
            {"project_id": "proj1", "items": [], "archived_at": "2026-06-11T00:00:00Z"},
        )

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/archive/artifact")
        assert r.status_code == 200
        body = r.json()
        assert "project_id" in body
