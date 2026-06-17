"""Tests-first for JobType handlers in `core.job_runner`.

Locks in:
  - `build_package` (run_project_stage) job assembles a zip and writes it to
    the stage artifact path: data_root/projects/{id}/stages/build_package/output.zip.
"""

from __future__ import annotations

import io
import json
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
    PageRecord,
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
    """run_project_stage with stage_id=build_package produces output.zip in the
    stage artifact directory.  v2 reads per-page proofing images and text from
    pages/{page_id}/stages/canvas_map/ and text_review/ respectively.
    """
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    data_root = tmp_path / "data"

    project = _project()
    await db.put_project(project)
    page = PageRecord(
        project_id=project.id,
        idx0=0,
        prefix="p001",
        source_stem="src_001",
        outputs=[],
    )
    seed_pages_in_store(data_root, project.id, [page])

    # v2 stage reads proofing image + reviewed text from per-page stage dirs.
    page_stage_base = data_root / "projects" / project.id / "pages" / "0000" / "stages"
    canvas_dir = page_stage_base / "canvas_map"
    canvas_dir.mkdir(parents=True, exist_ok=True)
    (canvas_dir / "output.png").write_bytes(b"\x89PNG-fake")
    text_review_dir = page_stage_base / "text_review"
    text_review_dir.mkdir(parents=True, exist_ok=True)
    (text_review_dir / "output.txt").write_text("page text")

    # page_order naming manifest — required by build_package_v2_cpu.
    manifest_dir = data_root / "projects" / project.id / "stages" / "page_order"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    naming_manifest = {
        "version": 2,
        "pages": [
            {"page_id": "0000", "idx0": 0, "role": "normal", "prefix": "p001"},
        ],
        "skip_ids": [],
    }
    (manifest_dir / "output.json").write_text(json.dumps(naming_manifest))

    job = Job(
        id="j-pkg",
        project_id=project.id,
        owner_id="default",
        type=JobType.run_project_stage,
        status=JobStatus.queued,
        payload={"stage_id": "build_package"},
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=data_root)
    n = await runner.run_pending(max_jobs=1)
    assert n == 1

    refreshed = await db.get_job("j-pkg")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete

    # v2 handler writes the zip bytes to the stage artifact path (dual-write step 1).
    artifact_path = data_root / "projects" / project.id / "stages" / "build_package" / "output.zip"
    assert artifact_path.exists(), f"Expected output.zip at {artifact_path}"
    zip_bytes = artifact_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert "p001.png" in names
        assert "p001.txt" in names
        assert "pgdp.json" in names
