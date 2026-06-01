"""Tests-first for JobType handlers in `core.job_runner`.

Locks in:
  - `build_package` job assembles a zip and stores it under for_zip/<book>.zip.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PageOutput,
    PageRecord,
    PageStageState,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from pathlib import Path


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.packaging,
        page_count=1,
        proof_page_count=1,
        config=ProjectConfig(book_name="four-men", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_build_package_handler_writes_zip(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    page = PageRecord(
        project_id=project.id,
        idx0=0,
        prefix="p001",
        source_stem="src_001",
        outputs=[
            PageOutput(
                full_prefix="p001",
                split_suffix=None,
                reading_order=0,
                for_zip_image_key=f"projects/{project.id}/for_zip/p001.png",
                for_zip_text_key=f"projects/{project.id}/for_zip/p001.txt",
            )
        ],
    )
    seed_pages_in_store(tmp_path / "data", project.id, [page])
    await storage.put_bytes(page.outputs[0].for_zip_image_key, b"\x89PNG-fake")
    await storage.put_bytes(page.outputs[0].for_zip_text_key, b"page text")
    # Mark page as reviewed so build_package is not gated.
    await db.put_page_stage(
        PageStageState(
            project_id=project.id,
            page_id="0000",
            stage_id="text_review",
            status=PageStageStatus.clean,
        )
    )

    job = Job(
        id="j-pkg",
        project_id=project.id,
        owner_id="default",
        type=JobType.build_package,
        status=JobStatus.queued,
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")
    n = await runner.run_pending(max_jobs=1)
    assert n == 1

    refreshed = await db.get_job("j-pkg")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete

    zip_key = f"projects/{project.id}/for_zip/four-men.zip"
    assert await storage.exists(zip_key)
    zip_bytes = await storage.get_bytes(zip_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert "p001.png" in names
        assert "p001.txt" in names
        assert "pgdp.json" in names
