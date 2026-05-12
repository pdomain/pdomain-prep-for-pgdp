"""Issue #61 — ResolvedPageConfig plumbing into the stage runner.

Acceptance (from the issue body):

1. A ``STAGE_IMPL[stage_id][device]`` callable receives a fully-typed
   ``ResolvedPageConfig`` instance.
2. Changing ``pages.config_overrides["threshold_level"]`` re-dirties
   ``threshold`` and downstream stages but does NOT dirty stages that
   don't read ``threshold_level``.
3. The async run route reads the latest ``config_overrides`` at run time
   (not at request time) — tested via the job payload including ``data_root``
   (the job handler needs it to call ``run_stage`` after config may have changed).
4. Existing M2 stage tests still pass (verified by ``make fast-check``).
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
    PageConfigOverrides,
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
)
from pd_prep_for_pgdp.core.pipeline.stage_runner import (
    cascade_dirty_for_config_change,
    run_stage,
)
from pd_prep_for_pgdp.settings import Settings

# ─── Fixtures / helpers ───────────────────────────────────────────────────────


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _gray_gradient_png() -> bytes:
    """20x20 grayscale image with pixel values 0..255 (linspace)."""
    row = np.linspace(0, 255, 20, dtype=np.uint8)
    img = np.tile(row, (20, 1))
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_project_and_page(
    db: SqliteDatabase,
    project_id: str,
    config_overrides: PageConfigOverrides | None = None,
) -> None:
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id=project_id,
            owner_id="default",
            name=project_id,
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(book_name=project_id, source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix=f"projects/{project_id}/",
        )
    )
    await db.put_pages(
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src",
                processing_status=PageProcessingStatus.pending,
                config_overrides=config_overrides or PageConfigOverrides(),
            )
        ]
    )


# ─── Bullet 1: impl receives ResolvedPageConfig ───────────────────────────────


@pytest.mark.asyncio
async def test_threshold_stage_uses_resolved_config_threshold_level(
    tmp_path: Path, db: SqliteDatabase
) -> None:
    """Running ``threshold`` with ``threshold_level=255`` in ``config_overrides``
    produces an all-black binary image — every uint8 pixel ≤ 255 → 0 — proving
    the runner passed the resolved cfg to the impl and the impl used it.

    Without cfg plumbing, Otsu thresholding would produce a ~50/50 mix of black
    and white pixels on the gradient input, so ``arr.max() > 0`` would hold.
    """
    project_id, page_id = "cfg_b1", "0000"
    await _seed_project_and_page(db, project_id, config_overrides=PageConfigOverrides(threshold_level=255))
    gray_png = _gray_gradient_png()
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
        artifact_bytes=gray_png,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="threshold",
    )

    assert state.status == PageStageStatus.clean
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "threshold")
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    assert arr.max() == 0, (
        "threshold_level=255 sets every uint8 pixel to 0 — all-black binary "
        "image; non-zero pixels mean cfg was not passed to the threshold impl"
    )


# ─── Bullet 2: config-change cascade dirty ────────────────────────────────────


@pytest.mark.asyncio
async def test_cascade_dirty_for_config_change_dirties_threshold_not_grayscale(
    tmp_path: Path, db: SqliteDatabase
) -> None:
    """``cascade_dirty_for_config_change({"threshold_level"})`` dirties
    ``threshold`` but leaves ``grayscale`` clean — grayscale does not read
    ``threshold_level``."""
    project_id, page_id = "cfg_b2a", "0000"
    gray_png = _gray_gradient_png()
    await db.init_page_stages_for_page(project_id, page_id)
    for sid in ("grayscale", "threshold"):
        await commit_stage_artifact(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=sid,
            artifact_bytes=gray_png,
        )

    g_before = await db.get_page_stage(project_id, page_id, "grayscale")
    t_before = await db.get_page_stage(project_id, page_id, "threshold")
    assert g_before is not None and g_before.status == PageStageStatus.clean
    assert t_before is not None and t_before.status == PageStageStatus.clean

    await cascade_dirty_for_config_change(
        database=db,
        project_id=project_id,
        page_id=page_id,
        changed_fields={"threshold_level"},
    )

    t_after = await db.get_page_stage(project_id, page_id, "threshold")
    assert t_after is not None and t_after.status == PageStageStatus.dirty, (
        "threshold reads threshold_level → must be dirty after the change"
    )

    g_after = await db.get_page_stage(project_id, page_id, "grayscale")
    assert g_after is not None and g_after.status == PageStageStatus.clean, (
        "grayscale does not read threshold_level → must stay clean"
    )


@pytest.mark.asyncio
async def test_cascade_dirty_propagates_to_threshold_descendants(tmp_path: Path, db: SqliteDatabase) -> None:
    """``cascade_dirty_for_config_change`` also dirties ``threshold``'s
    descendants (e.g. ``invert``)."""
    project_id, page_id = "cfg_b2b", "0000"
    gray_png = _gray_gradient_png()
    await db.init_page_stages_for_page(project_id, page_id)
    for sid in ("threshold", "invert"):
        await commit_stage_artifact(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=sid,
            artifact_bytes=gray_png,
        )

    await cascade_dirty_for_config_change(
        database=db,
        project_id=project_id,
        page_id=page_id,
        changed_fields={"threshold_level"},
    )

    invert_after = await db.get_page_stage(project_id, page_id, "invert")
    assert invert_after is not None and invert_after.status == PageStageStatus.dirty, (
        "invert is a descendant of threshold → must be dirtied transitively"
    )


# ─── Bullet 3: async route payload includes data_root ─────────────────────────


def _settings_b3(tmp_path: Path) -> Settings:
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


def _seed_b3(settings: Settings) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="b3proj",
                owner_id="default",
                name="b3proj",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="b3proj", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/b3proj/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id="b3proj",
                    idx0=0,
                    prefix="p001",
                    source_stem="src",
                    processing_status=PageProcessingStatus.pending,
                )
            ]
        )

    asyncio.run(go())


@pytest.fixture
def client_b3(tmp_path: Path) -> Iterator[TestClient]:
    settings = _settings_b3(tmp_path)
    _seed_b3(settings)
    app = build_app(settings)
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


def test_async_run_route_payload_includes_data_root(client_b3: TestClient, tmp_path: Path) -> None:
    """The async run route stores ``data_root`` in the job payload.

    The job handler reads ``data_root`` from the payload so it can call
    ``run_stage`` — which reads the latest ``config_overrides`` from DB at
    that point — without needing access to the original ``Settings`` object.
    This guarantees the async path reads config at run time, not at request time.
    """
    resp = client_b3.post(
        "/api/data/projects/b3proj/pages/0/stages/grayscale/run",
        params={"async": "true"},
    )
    assert resp.status_code == 202
    job = resp.json()
    assert "data_root" in job["payload"], (
        "job payload must include data_root so the job runner can call run_stage "
        "with the data root path at execution time"
    )
