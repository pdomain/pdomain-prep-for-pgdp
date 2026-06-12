"""R2 — build_package manifest endpoint.

Route tested:
  GET /api/data/projects/{id}/project-stages/build_package/manifest
      → { deliverable: { files, count }, manifest: { project, pages, ... } }

Returns 404 when stage is not clean or artifact ZIP is missing.
Returns structured JSON parsed from the pgdp.json embedded in the artifact ZIP.
"""

from __future__ import annotations

import asyncio
import io
import json
import zipfile
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


def _write_build_package_zip(
    settings: Settings,
    project_id: str,
    pgdp_manifest: dict,
    extra_entries: list[str] | None = None,
) -> None:
    """Write a fake build_package output.zip with embedded pgdp.json."""
    stage_dir = settings.data_root / "projects" / project_id / "stages" / "build_package"
    stage_dir.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pgdp.json", json.dumps(pgdp_manifest))
        for name in extra_entries or []:
            zf.writestr(name, b"dummy")
    (stage_dir / "output.zip").write_bytes(buf.getvalue())


class TestBuildPackageManifest:
    """GET /project-stages/build_package/manifest → structured JSON."""

    def test_404_when_stage_not_clean(self, tmp_path: Path) -> None:
        """Returns 404 when build_package stage is not clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/manifest")
        assert r.status_code == 404

    def test_404_when_artifact_zip_missing(self, tmp_path: Path) -> None:
        """Returns 404 when stage is clean but output.zip does not exist."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "build_package")
        # Do NOT write the zip

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/manifest")
        assert r.status_code == 404

    def test_404_for_unknown_project(self, tmp_path: Path) -> None:
        """Returns 404 for an unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/nobody/project-stages/build_package/manifest")
        assert r.status_code == 404

    def test_returns_deliverable_and_manifest_json(self, tmp_path: Path) -> None:
        """Returns structured { deliverable, manifest } JSON from clean artifact."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "build_package")

        pgdp_manifest = {
            "book_name": "My Book",
            "project_id": "proj1",
            "built_at": "2026-06-12T10:00:00+00:00",
            "page_count": 2,
            "illustration_count": 0,
            "pages": [
                {
                    "page_id": "0001",
                    "prefix": "p001",
                    "has_image": True,
                    "has_text": True,
                    "illustration_count": 0,
                },
                {
                    "page_id": "0002",
                    "prefix": "p002",
                    "has_image": True,
                    "has_text": True,
                    "illustration_count": 0,
                },
            ],
        }
        _write_build_package_zip(
            settings,
            "proj1",
            pgdp_manifest,
            extra_entries=["p001.png", "p001.txt", "p002.png", "p002.txt"],
        )

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/manifest")

        assert r.status_code == 200, r.text
        body = r.json()

        # deliverable shape
        assert "deliverable" in body
        assert "files" in body["deliverable"]
        assert isinstance(body["deliverable"]["files"], list)
        assert body["deliverable"]["count"] == 5  # pgdp.json + p001.png p001.txt p002.png p002.txt

        # manifest shape
        assert "manifest" in body
        m = body["manifest"]
        assert m["project"] == "proj1"
        assert m["pages"] == 2
        assert "built" in m
        assert "sha256" in m

    def test_deliverable_tree_contains_zip_entries(self, tmp_path: Path) -> None:
        """Deliverable tree includes all zip entries as TreeRow items."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "build_package")

        pgdp_manifest = {
            "book_name": "Test Book",
            "project_id": "proj1",
            "built_at": "2026-06-12T00:00:00+00:00",
            "page_count": 1,
            "illustration_count": 0,
            "pages": [],
        }
        _write_build_package_zip(
            settings,
            "proj1",
            pgdp_manifest,
            extra_entries=["f001.png", "f001.txt"],
        )

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/manifest")

        assert r.status_code == 200, r.text
        body = r.json()
        names = [row["name"] for row in body["deliverable"]["files"]]
        assert "f001.png" in names
        assert "f001.txt" in names
        assert "pgdp.json" in names

    def test_manifest_sha256_matches_zip(self, tmp_path: Path) -> None:
        """Manifest sha256 is the SHA-256 of the output.zip bytes."""
        import hashlib

        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "build_package")

        pgdp_manifest = {
            "book_name": "",
            "project_id": "proj1",
            "built_at": "2026-06-12T00:00:00+00:00",
            "page_count": 0,
            "illustration_count": 0,
            "pages": [],
        }
        _write_build_package_zip(settings, "proj1", pgdp_manifest)

        # Compute expected sha256 from the written zip
        zip_path = settings.data_root / "projects" / "proj1" / "stages" / "build_package" / "output.zip"
        expected_sha256 = hashlib.sha256(zip_path.read_bytes()).hexdigest()

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/build_package/manifest")

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["manifest"]["sha256"] == expected_sha256
