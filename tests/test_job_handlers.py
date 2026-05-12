"""Tests-first for the rest of the JobType handlers in `core.job_runner`.

Locks in:
  - `build_package` job assembles a zip and stores it under for_zip/<book>.zip,
  - `batch_text_postprocess` rewrites text files for every page that has one,
  - `batch_extract_illustrations` writes hi_res/ crops for every region.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    IllustrationRegion,
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


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


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
async def test_build_package_handler_writes_zip(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

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
    await db.put_pages([page])
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

    runner = InProcessJobRunner(database=db, storage=storage)
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


@pytest.mark.asyncio
async def test_batch_text_postprocess_handler_rewrites_text(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    project = project.model_copy(
        update={"config": project.config.model_copy(update={"custom_scannos": {"foo": "FOO"}})}
    )
    await db.put_project(project)
    page = PageRecord(project_id=project.id, idx0=0, prefix="p001", source_stem="src_001")
    await db.put_pages([page])
    text_key = f"projects/{project.id}/ocr_text/src_001_p001.txt"
    await storage.put_bytes(text_key, b"He said \xe2\x80\x9chi\xe2\x80\x9d to foo.")

    job = Job(
        id="j-tpp",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_text_postprocess,
        status=JobStatus.queued,
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    out = (await storage.get_bytes(text_key)).decode("utf-8")
    assert '"hi"' in out  # curly quotes -> straight
    assert "FOO" in out  # custom scanno applied


@pytest.mark.asyncio
async def test_batch_extract_illustrations_handler_writes_hi_res(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)

    # Source image — pretend this is the proofing source.
    src_bytes = _png(200, 300)
    src_key = f"projects/{project.id}/source/src_007.png"
    await storage.put_bytes(src_key, src_bytes)

    page = PageRecord(
        project_id=project.id,
        idx0=0,
        prefix="p007",
        source_stem="src_007",
        source_key=src_key,
        illustration_regions=[
            IllustrationRegion(index=1, L=10, R=100, T=10, B=100, output_format="jpg"),
            IllustrationRegion(index=2, L=50, R=200, T=50, B=150, output_format="png"),
        ],
    )
    await db.put_pages([page])

    job = Job(
        id="j-ill",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_extract_illustrations,
        status=JobStatus.queued,
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j-ill")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
    assert await storage.exists(f"projects/{project.id}/hi_res/p007_01.jpg")
    assert await storage.exists(f"projects/{project.id}/hi_res/p007_02.png")
