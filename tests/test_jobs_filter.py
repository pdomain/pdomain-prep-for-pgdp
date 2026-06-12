"""Tests-first for `GET /api/data/jobs?project_id=...` filter.

The Jobs page lists every job for the current owner; project pages want a
scoped view ("show jobs for this book"). Add a `project_id` query parameter
that filters the recent-jobs response.

Locks in:
  - no filter: every owned job is returned (existing behaviour),
  - `?project_id=X`: only jobs whose `project_id == X`,
  - response shape unchanged.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
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


def _seed(settings: Settings) -> tuple[str, str]:
    """Create two projects + 3 jobs (2 for project_a, 1 for project_b)."""

    async def go() -> tuple[str, str]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)

        for pid in ("a", "b"):
            await db.put_project(
                Project(
                    id=pid,
                    owner_id="default",
                    name=pid,
                    created_at=now,
                    updated_at=now,
                    status=ProjectStatus.processing,
                    page_count=1,
                    proof_page_count=1,
                    config=ProjectConfig(book_name=pid, source_uri=""),
                    storage_prefix=f"projects/{pid}/",
                )
            )

        for i, pid in enumerate(["a", "a", "b"]):
            await db.put_job(
                Job(
                    id=f"j{i}",
                    project_id=pid,
                    owner_id="default",
                    type=JobType.unzip,
                    status=JobStatus.complete,
                )
            )

        await db.close()
        return "a", "b"

    return asyncio.run(go())


def test_no_filter_returns_all_owner_jobs(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/jobs")
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 3


def test_filter_returns_only_matching_project_jobs(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/jobs?project_id=a")
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 2
        assert {j["project_id"] for j in body} == {"a"}

        r = client.get("/api/data/jobs?project_id=b")
        assert len(r.json()) == 1
