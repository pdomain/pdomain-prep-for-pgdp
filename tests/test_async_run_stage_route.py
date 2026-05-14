"""M2 Slice 15 — `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run?async=true`.

When the slow stages (`ocr`, `extract_illustrations`) are requested with
`?async=true`, the route:
1. Creates a `JobType.run_page_stage` Job (status=queued).
2. Returns HTTP 202 Accepted with the Job as the body.
3. The InProcessJobRunner picks it up, runs `run_stage`, marks it complete
   or failed.

Fast stages with `?async=true` still enqueue a job and return 202 — the
flag is a hint that the caller wants async delivery, not a promise that
it will run synchronously in either case.

This test file uses a monkeypatched `app.state.job_runner` so tests stay
hermetic (no background thread or asyncio event-loop gymnastics).
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    JobStatus,
    JobType,
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pd_prep_for_pgdp.settings import Settings

# ─── Fixtures ───────────────────────────────────────────────────────────────


def _settings(tmp_path: Path) -> Settings:
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


def _seed(settings: Settings, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="async_proj",
                owner_id=owner_id,
                name="async_proj",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="async_proj", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/async_proj/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id="async_proj",
                    idx0=0,
                    prefix="p001",
                    source_stem="src1",
                    processing_status=PageProcessingStatus.pending,
                ),
            ]
        )
        await db.close()

    asyncio.run(go())


@pytest.fixture
def seeded_client(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    _seed(settings)
    app = build_app(settings)
    with TestClient(app) as c:
        yield c, settings


# ─── ?async=true returns 202 with a job ────────────────────────────────────


def test_async_flag_returns_202_with_job_id(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """`?async=true` on the `ocr` stage (a known slow stage) returns 202
    Accepted with a job body containing an `id` and `status=queued`.

    The caller can poll GET /api/gpu/jobs/{id} to watch the job.
    """
    client, _ = seeded_client
    r = client.post("/api/data/projects/async_proj/pages/0/stages/ocr/run?async=true")
    assert r.status_code == 202, r.text
    body = r.json()
    assert "id" in body
    assert body["type"] == JobType.run_page_stage.value
    assert body["status"] == JobStatus.queued.value
    # payload must carry routing info for the runner
    assert body["payload"]["project_id"] == "async_proj"
    assert body["payload"]["stage_id"] == "ocr"
    assert "page_id" in body["payload"]


def test_async_flag_returns_202_for_fast_stages_too(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """?async=true returns 202 even for fast stages like `grayscale`.

    The flag is a caller hint: 'I want async delivery'. The server always
    honours it and enqueues a job rather than deciding on the caller's behalf.
    """
    client, _ = seeded_client
    r = client.post("/api/data/projects/async_proj/pages/0/stages/grayscale/run?async=true")
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["type"] == JobType.run_page_stage.value
    assert body["payload"]["stage_id"] == "grayscale"


def test_async_flag_false_stays_synchronous(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """`?async=false` (explicit) is the same as omitting the flag — sync path."""
    client, _ = seeded_client
    # No parent seeded, so dependency-not-met → 409 via the sync path.
    r = client.post("/api/data/projects/async_proj/pages/0/stages/grayscale/run?async=false")
    assert r.status_code == 409, r.text


def test_async_flag_omitted_stays_synchronous(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """Omitting ?async keeps the current sync behaviour (409 when deps missing)."""
    client, _ = seeded_client
    r = client.post("/api/data/projects/async_proj/pages/0/stages/grayscale/run")
    assert r.status_code == 409, r.text


# ─── 202 job is queryable immediately via jobs route ──────────────────────


def test_async_job_visible_in_jobs_list(
    seeded_client: tuple[TestClient, Settings],
) -> None:
    """After the 202 response, the job appears in GET /api/gpu/jobs."""
    client, _ = seeded_client
    r = client.post("/api/data/projects/async_proj/pages/0/stages/ocr/run?async=true")
    assert r.status_code == 202
    job_id = r.json()["id"]

    jobs_resp = client.get("/api/gpu/jobs?owner_id=default")
    assert jobs_resp.status_code == 200
    ids = [j["id"] for j in jobs_resp.json()]
    assert job_id in ids


# ─── Validation still rejects before enqueuing ────────────────────────────


def test_async_422_for_unknown_stage(seeded_client: tuple[TestClient, Settings]) -> None:
    """Unknown stage_id is rejected 422 even with ?async=true."""
    client, _ = seeded_client
    r = client.post("/api/data/projects/async_proj/pages/0/stages/not_a_stage/run?async=true")
    assert r.status_code == 422


def test_async_404_for_unknown_project(seeded_client: tuple[TestClient, Settings]) -> None:
    client, _ = seeded_client
    r = client.post("/api/data/projects/nope/pages/0/stages/ocr/run?async=true")
    assert r.status_code == 404


def test_async_404_for_unknown_page(seeded_client: tuple[TestClient, Settings]) -> None:
    client, _ = seeded_client
    r = client.post("/api/data/projects/async_proj/pages/99/stages/ocr/run?async=true")
    assert r.status_code == 404


# ─── Integration: job runner processes the queued job ─────────────────────


def _checkerboard_bgr_png() -> bytes:
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    img[::2, ::2] = (200, 200, 200)
    img[1::2, 1::2] = (200, 200, 200)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_parent_async(
    settings: Settings, project_id: str, page_id: str, stage_id: str, payload: bytes
) -> None:
    """Seed a clean stage row + on-disk artifact via the canonical writer."""
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        await db.init_page_stages_for_page(project_id, page_id)
        await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            artifact_bytes=payload,
        )
    finally:
        await db.close()


def test_async_job_runs_to_completion_and_stage_is_clean(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Integration: `?async=true` on `ocr` enqueues a job; the job runner
    processes it; the stage row transitions to `clean`.

    The `ocr` impl is monkeypatched to avoid loading DocTR weights in CI.
    The test exercises the full route → DB job insert → InProcessJobRunner →
    run_stage → DB stage row = clean path.
    """
    import json

    from pd_prep_for_pgdp.core.pipeline import stage_registry as reg_module

    fake_words = [
        {
            "id": "w0",
            "text": "Hello",
            "confidence": 0.9,
            "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
        }
    ]
    fake_result = {
        "words.json": json.dumps(fake_words).encode(),
        "raw.txt": b"Hello",
    }
    monkeypatch.setitem(reg_module.STAGE_IMPL["ocr"], "cpu", lambda image: fake_result)

    settings = _settings(tmp_path)
    _seed(settings)

    # Seed ocr_crop as a clean parent so the ocr stage can run.
    asyncio.run(_seed_clean_parent_async(settings, "async_proj", "0000", "ocr_crop", _checkerboard_bgr_png()))

    app = build_app(settings)
    with TestClient(app) as client:
        # POST async=true on ocr — should return 202 with a queued job.
        r = client.post("/api/data/projects/async_proj/pages/0/stages/ocr/run?async=true")
        assert r.status_code == 202, r.text
        job_id = r.json()["id"]

        # Drive the job runner directly: run_pending picks up the queued job.
        job_runner = app.state.job_runner
        asyncio.run(job_runner.run_pending())

    # After the runner completes, verify the stage row is clean.
    async def _check() -> PageStageStatus:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            row = await db.get_page_stage("async_proj", "0000", "ocr")
            return row.status if row is not None else PageStageStatus.not_run
        finally:
            await db.close()

    status = asyncio.run(_check())
    assert status == PageStageStatus.clean, f"expected clean, got {status!r}"

    # Job row should be marked complete too.
    async def _check_job() -> JobStatus:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        try:
            job = await db.get_job(job_id)
            return job.status if job is not None else JobStatus.queued
        finally:
            await db.close()

    job_status = asyncio.run(_check_job())
    assert job_status == JobStatus.complete, f"expected job complete, got {job_status!r}"
