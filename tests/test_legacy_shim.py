"""Tests for core/jobs/legacy_shim.py — batch_* → STAGE_IMPL routing.

Acceptance:
- BATCH_JOB_TO_STAGES covers all JobType.batch_* values.
- run_legacy_batch_pages calls run_stage per page per stage.
- _handle_batch_process_pages routes through the shim when runner._data_root is set.
- _handle_batch_ocr routes through the shim when runner._data_root is set.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PageRecord,
    PageStageState,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=2,
        proof_page_count=2,
        config=ProjectConfig(
            book_name="t",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=1,
        ),
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


def test_shim_covers_all_batch_job_types() -> None:
    """BATCH_JOB_TO_STAGES must have an entry for every JobType.batch_* value."""
    from pd_prep_for_pgdp.core.jobs.legacy_shim import BATCH_JOB_TO_STAGES

    batch_values = {jt.value for jt in JobType if jt.value.startswith("batch_")}
    assert batch_values == set(BATCH_JOB_TO_STAGES.keys()), (
        f"Shim is missing entries for: {batch_values - set(BATCH_JOB_TO_STAGES.keys())}"
    )


@pytest.mark.asyncio
async def test_run_legacy_batch_pages_calls_run_stage_per_page_per_stage(
    db: SqliteDatabase,
    storage: FilesystemStorage,
    tmp_path: Path,
) -> None:
    """run_legacy_batch_pages invokes run_stage for each stage x each page."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner
    from pd_prep_for_pgdp.core.jobs.legacy_shim import run_legacy_batch_pages

    project = _project()
    await db.put_project(project)
    await db.put_pages(
        [
            PageRecord(project_id="p1", idx0=0, prefix="p000", source_stem="s0"),
            PageRecord(project_id="p1", idx0=1, prefix="p001", source_stem="s1"),
        ]
    )
    job = Job(
        id="j1",
        project_id="p1",
        owner_id="default",
        type=JobType.batch_process_pages,
        status=JobStatus.running,
        payload={},
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    data_root = tmp_path / "data"
    stage_calls: list[tuple[str, str]] = []

    async def fake_run_stage(**kwargs: object) -> PageStageState:
        stage_calls.append((str(kwargs["page_id"]), str(kwargs["stage_id"])))
        return PageStageState(
            project_id="p1",
            page_id=str(kwargs["page_id"]),
            stage_id=str(kwargs["stage_id"]),
            status=PageStageStatus.clean,
            stage_version=1,
        )

    with patch("pd_prep_for_pgdp.core.jobs.legacy_shim.run_stage", fake_run_stage):
        ok, err = await run_legacy_batch_pages(
            runner, job, stage_ids=["grayscale", "threshold"], data_root=data_root
        )

    assert ok == 2
    assert err == 0
    # 2 pages x 2 stages = 4 calls, in page order
    assert stage_calls == [
        ("0000", "grayscale"),
        ("0000", "threshold"),
        ("0001", "grayscale"),
        ("0001", "threshold"),
    ]


@pytest.mark.asyncio
async def test_batch_process_pages_uses_shim_when_data_root_set(
    db: SqliteDatabase,
    storage: FilesystemStorage,
    tmp_path: Path,
) -> None:
    """_handle_batch_process_pages routes through the shim when data_root is set."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner
    from pd_prep_for_pgdp.core.jobs.legacy_shim import BATCH_JOB_TO_STAGES

    project = _project()
    await db.put_project(project)
    await db.put_pages(
        [
            PageRecord(project_id="p1", idx0=0, prefix="p000", source_stem="s0"),
        ]
    )
    job = Job(
        id="j2",
        project_id="p1",
        owner_id="default",
        type=JobType.batch_process_pages,
        status=JobStatus.queued,
        payload={},
    )
    await db.put_job(job)

    data_root = tmp_path / "data"
    runner = InProcessJobRunner(database=db, storage=storage, data_root=data_root)

    stage_calls: list[str] = []

    async def fake_run_stage(**kwargs: object) -> PageStageState:
        stage_calls.append(str(kwargs["stage_id"]))
        return PageStageState(
            project_id="p1",
            page_id=str(kwargs["page_id"]),
            stage_id=str(kwargs["stage_id"]),
            status=PageStageStatus.clean,
            stage_version=1,
        )

    with patch("pd_prep_for_pgdp.core.jobs.legacy_shim.run_stage", fake_run_stage):
        await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j2")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
    # All batch_process_pages stages were called via the shim
    expected_stages = BATCH_JOB_TO_STAGES["batch_process_pages"]
    assert stage_calls == expected_stages


@pytest.mark.asyncio
async def test_batch_ocr_uses_shim_when_data_root_set(
    db: SqliteDatabase,
    storage: FilesystemStorage,
    tmp_path: Path,
) -> None:
    """_handle_batch_ocr routes through the shim when data_root is set."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner
    from pd_prep_for_pgdp.core.jobs.legacy_shim import BATCH_JOB_TO_STAGES

    project = _project()
    await db.put_project(project)
    await db.put_pages(
        [
            PageRecord(project_id="p1", idx0=0, prefix="p000", source_stem="s0"),
        ]
    )
    job = Job(
        id="j3",
        project_id="p1",
        owner_id="default",
        type=JobType.batch_ocr,
        status=JobStatus.queued,
        payload={},
    )
    await db.put_job(job)

    data_root = tmp_path / "data"
    runner = InProcessJobRunner(database=db, storage=storage, data_root=data_root)

    stage_calls: list[str] = []

    async def fake_run_stage(**kwargs: object) -> PageStageState:
        stage_calls.append(str(kwargs["stage_id"]))
        return PageStageState(
            project_id="p1",
            page_id=str(kwargs["page_id"]),
            stage_id=str(kwargs["stage_id"]),
            status=PageStageStatus.clean,
            stage_version=1,
        )

    with patch("pd_prep_for_pgdp.core.jobs.legacy_shim.run_stage", fake_run_stage):
        await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j3")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
    assert stage_calls == BATCH_JOB_TO_STAGES["batch_ocr"]
