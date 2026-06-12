"""R2 — zip manifest endpoint.

Route tested:
  GET /api/data/projects/{id}/project-stages/zip/manifest
      → { archive: { name, entries, bytes, ratio, sha256 }, tree: TreeRow[] }

Returns 404 when zip stage is not clean or artifact is missing.
Derives ZipArchive metadata from stages/zip/output.json (sha256, size_bytes,
file_count) and tree listing from stages/build_package/output.zip entries.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
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
    entries: list[str] | None = None,
) -> bytes:
    """Write a fake build_package output.zip and return its bytes."""
    stage_dir = settings.data_root / "projects" / project_id / "stages" / "build_package"
    stage_dir.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pgdp.json", json.dumps({"project_id": project_id, "pages": []}))
        for name in entries or []:
            zf.writestr(name, b"dummy")
    zip_bytes = buf.getvalue()
    (stage_dir / "output.zip").write_bytes(zip_bytes)
    return zip_bytes


def _write_zip_manifest(
    settings: Settings,
    project_id: str,
    zip_bytes: bytes,
) -> None:
    """Write a fake zip stage output.json derived from the given zip bytes."""
    sha256 = hashlib.sha256(zip_bytes).hexdigest()
    stage_dir = settings.data_root / "projects" / project_id / "stages" / "zip"
    stage_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "project_id": project_id,
        "sha256": sha256,
        "size_bytes": len(zip_bytes),
        "file_count": sum(1 for _ in zipfile.ZipFile(io.BytesIO(zip_bytes)).infolist()),
        "recorded_at": "2026-06-12T10:00:00+00:00",
    }
    (stage_dir / "output.json").write_text(json.dumps(manifest))


class TestZipManifest:
    """GET /project-stages/zip/manifest → { archive, tree }."""

    def test_404_when_zip_stage_not_clean(self, tmp_path: Path) -> None:
        """Returns 404 when zip stage is not clean."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/zip/manifest")
        assert r.status_code == 404

    def test_404_when_zip_artifact_missing(self, tmp_path: Path) -> None:
        """Returns 404 when zip stage is clean but output.json is missing."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "zip")
        # Do NOT write the zip stage manifest

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/zip/manifest")
        assert r.status_code == 404

    def test_404_for_unknown_project(self, tmp_path: Path) -> None:
        """Returns 404 for an unknown project."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/nobody/project-stages/zip/manifest")
        assert r.status_code == 404

    def test_returns_archive_and_tree(self, tmp_path: Path) -> None:
        """Returns { archive, tree } when zip stage is clean with artifacts."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "zip")

        zip_bytes = _write_build_package_zip(settings, "proj1", entries=["p001.png", "p001.txt"])
        _write_zip_manifest(settings, "proj1", zip_bytes)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/zip/manifest")

        assert r.status_code == 200, r.text
        body = r.json()

        # archive shape
        assert "archive" in body
        a = body["archive"]
        assert "name" in a
        assert "entries" in a
        assert "bytes" in a
        assert "ratio" in a
        assert "sha256" in a
        assert isinstance(a["entries"], int)
        assert isinstance(a["bytes"], int)
        assert isinstance(a["sha256"], str)
        assert len(a["sha256"]) == 64  # hex sha256

        # tree shape
        assert "tree" in body
        assert isinstance(body["tree"], list)

    def test_archive_sha256_matches_zip(self, tmp_path: Path) -> None:
        """archive.sha256 is the SHA-256 hash of the build_package output.zip."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "zip")

        zip_bytes = _write_build_package_zip(settings, "proj1")
        _write_zip_manifest(settings, "proj1", zip_bytes)
        expected_sha256 = hashlib.sha256(zip_bytes).hexdigest()

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/zip/manifest")

        assert r.status_code == 200, r.text
        assert r.json()["archive"]["sha256"] == expected_sha256

    def test_tree_contains_build_package_zip_entries(self, tmp_path: Path) -> None:
        """tree contains filenames from the build_package output.zip."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "zip")

        zip_bytes = _write_build_package_zip(settings, "proj1", entries=["f001.png", "f001.txt"])
        _write_zip_manifest(settings, "proj1", zip_bytes)

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/zip/manifest")

        assert r.status_code == 200, r.text
        body = r.json()
        names = [row["name"] for row in body["tree"]]
        assert "f001.png" in names
        assert "f001.txt" in names

    def test_tree_empty_when_build_package_zip_missing(self, tmp_path: Path) -> None:
        """tree is empty list when build_package output.zip is missing (graceful)."""
        from fastapi.testclient import TestClient

        settings = _make_settings(tmp_path)
        _seed_project(settings)
        _mark_stage_clean(settings, "proj1", "zip")

        # Write zip stage output.json directly (no build_package zip)
        stage_dir = settings.data_root / "projects" / "proj1" / "stages" / "zip"
        stage_dir.mkdir(parents=True, exist_ok=True)
        (stage_dir / "output.json").write_text(
            json.dumps(
                {
                    "project_id": "proj1",
                    "sha256": "a" * 64,
                    "size_bytes": 100,
                    "file_count": 2,
                    "recorded_at": "2026-06-12T00:00:00+00:00",
                }
            )
        )

        app = build_app(settings)
        with TestClient(app) as client:
            r = client.get("/api/data/projects/proj1/project-stages/zip/manifest")

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tree"] == []
