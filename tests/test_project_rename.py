"""Test project rename via PATCH /api/data/projects/{id}/config.

Today the create flow sets `Project.name` and never updates it.
Lock in: passing `name` on the PATCH body updates both `Project.name`
and `ProjectConfig.book_name` (which controls the package zip filename).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


def _settings(tmp_path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _seed(settings: Settings) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="rename1",
                owner_id="default",
                name="Old Name",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.configuring,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="old-name", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/rename1/",
            )
        )
        await db.close()

    asyncio.run(go())


def test_patch_name_updates_project_and_book_name(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/rename1/config",
            json={"name": "Belloc — The Four Men", "project_config": {}},
        )
        assert r.status_code == 200, r.text

        proj = client.get("/api/data/projects/rename1").json()
        assert proj["name"] == "Belloc — The Four Men"
        assert proj["config"]["book_name"] == "Belloc — The Four Men"


def test_patch_book_name_alone_updates_project_name(tmp_path) -> None:
    """Symmetric path: setting book_name in the body also lifts Project.name."""
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            "/api/data/projects/rename1/config",
            json={"project_config": {"book_name": "Renamed Book"}},
        )
        assert r.status_code == 200
        proj = client.get("/api/data/projects/rename1").json()
        assert proj["name"] == "Renamed Book"
        assert proj["config"]["book_name"] == "Renamed Book"
