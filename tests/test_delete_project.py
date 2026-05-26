"""Test that DELETE /api/data/projects/{id} clears the project + its pages."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
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


def _seed(settings: Settings) -> str:
    async def go() -> str:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        pid = "del1"
        await db.put_project(
            Project(
                id=pid,
                owner_id="default",
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.complete,
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{pid}/",
            )
        )
        await db.put_pages(
            [PageRecord(project_id=pid, idx0=i, prefix=f"p{i:03d}", source_stem=f"s{i}") for i in range(2)]
        )
        await db.close()
        return pid

    return asyncio.run(go())


def test_delete_project_removes_project_and_pages(tmp_path) -> None:
    settings = _settings(tmp_path)
    pid = _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Sanity: project + pages exist.
        assert client.get(f"/api/data/projects/{pid}").status_code == 200
        assert client.get(f"/api/data/projects/{pid}/pages").json()["total"] == 2

        r = client.delete(f"/api/data/projects/{pid}")
        assert r.status_code == 204

        assert client.get(f"/api/data/projects/{pid}").status_code == 404
        # Pages query returns 404 because the project is gone.
        r2 = client.get(f"/api/data/projects/{pid}/pages")
        assert r2.status_code == 404


def test_delete_unknown_project_is_idempotent(tmp_path) -> None:
    """DELETE on a non-existent project returns 204 (current behavior; idempotent)."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/data/projects/does-not-exist")
        assert r.status_code == 204
