"""Test that `PageRecord.processing_error` survives the round-trip
through PUT (PATCH page) → GET. The frontend banner reads this field.
"""

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


def test_processing_error_round_trips(tmp_path) -> None:
    settings = _settings(tmp_path)

    async def seed() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project = Project(
            id="pe1",
            owner_id="default",
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(book_name="t", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix="projects/pe1/",
        )
        await db.put_project(project)
        await db.put_page(
            PageRecord(
                project_id="pe1",
                idx0=0,
                prefix="p001",
                source_stem="s",
                processing_error="deskew failed: image too small",
            )
        )
        await db.close()

    asyncio.run(seed())

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/pe1/pages/0")
        assert r.status_code == 200
        body = r.json()
        assert body["processing_error"] == "deskew failed: image too small"
