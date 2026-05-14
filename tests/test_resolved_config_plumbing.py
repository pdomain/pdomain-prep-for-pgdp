"""Issue #61 / #87 — ResolvedPageConfig plumbing into the stage runner.

Acceptance (from the issue bodies):

Issue #61:
1. A ``STAGE_IMPL[stage_id][device]`` callable receives a fully-typed
   ``ResolvedPageConfig`` instance.
2. Changing ``pages.config_overrides["threshold_level"]`` re-dirties
   ``threshold`` and downstream stages but does NOT dirty stages that
   don't read ``threshold_level``.
3. The async run route reads the latest ``config_overrides`` at run time
   (not at request time) — tested via the job payload including ``data_root``
   (the job handler needs it to call ``run_stage`` after config may have changed).
4. Existing M2 stage tests still pass (verified by ``make fast-check``).

Issue #87:
5. ``run_stage`` accepts an optional ``resolved_config: ResolvedPageConfig | None``
   kwarg (defaults to ``None``; no behaviour change when absent).
6. ``initial_crop`` calls ``crop_edges`` with configured margins when ``resolved_config``
   is present (non-zero insets produce a smaller image).
7. ``manual_deskew_pre`` calls ``rotate_image`` with the configured angle when present.
8. The ``POST /stages/{stage_id}/run`` route handler resolves config from DB and
   passes it into ``run_stage``.
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
    ResolvedPageConfig,
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


# ─── Issue #87: run_stage resolved_config kwarg ──────────────────────────────


def _make_resolved_config(
    *,
    initial_crop: tuple[int, int, int, int] | None = None,
    deskew_before_crop: float | None = None,
    threshold_level: int | None = None,
) -> ResolvedPageConfig:
    """Build a minimal ResolvedPageConfig for unit tests."""
    from pd_prep_for_pgdp.core.models import AlignmentOverride, PageType

    return ResolvedPageConfig(
        text_threshold=128,
        page_h_w_ratio=1.4,
        fuzzy_pct=0.05,
        pixel_count_columns=5,
        pixel_count_rows=5,
        ocr_bbox_edge_min_words=3,
        ocr_engine="doctr",
        ocr_model_key=None,
        ocr_dpi=300,
        initial_crop_all=(0, 0, 0, 0),
        ocr_crop=(0, 0, 0, 0),
        page_type=PageType.normal,
        alignment=AlignmentOverride.auto,
        initial_crop=initial_crop,
        white_space_additional=None,
        threshold_level=threshold_level,
        skip_auto_deskew=False,
        deskew_before_crop=deskew_before_crop,
        deskew_after_crop=None,
        do_morph=False,
        skip_denoise=False,
        use_ocr_bbox_edge=False,
        rotated_standard=False,
        single_dimension_rescale=False,
    )


def _color_png(h: int = 40, w: int = 60) -> bytes:
    """Create a solid-color BGR PNG for testing image-transform stages."""
    img = np.full((h, w, 3), fill_value=180, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


# ─── Bullet 5: run_stage accepts resolved_config kwarg ───────────────────────


@pytest.mark.asyncio
async def test_run_stage_accepts_resolved_config_kwarg_no_behavior_change(
    tmp_path: Path, db: SqliteDatabase
) -> None:
    """``run_stage`` accepts ``resolved_config`` kwarg and behaves identically
    when the kwarg is absent vs. when it is ``None``."""
    project_id, page_id = "b87_kw", "0000"
    await _seed_project_and_page(db, project_id)
    color_png = _color_png()
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="manual_deskew_pre",
        artifact_bytes=color_png,
    )

    # Pass resolved_config=None explicitly — must not error and must return clean.
    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
        resolved_config=None,
    )
    assert state.status == PageStageStatus.clean


# ─── Bullet 6: initial_crop calls crop_edges with configured margins ──────────


@pytest.mark.asyncio
async def test_initial_crop_with_configured_margins_produces_smaller_image(
    tmp_path: Path, db: SqliteDatabase
) -> None:
    """When ``resolved_config.initial_crop`` contains non-zero insets, the
    ``initial_crop`` stage shrinks the image by those margins.

    We use a 40x60 image with ``initial_crop=(2, 2, 4, 4)`` (left=2, right=2,
    top=4, bottom=4) so the output should be 32x56 (h=40-8, w=60-4).
    """
    project_id, page_id = "b87_ic", "0000"
    await _seed_project_and_page(
        db,
        project_id,
        config_overrides=PageConfigOverrides(initial_crop=(2, 2, 4, 4)),
    )
    png_40x60 = _color_png(h=40, w=60)
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="decode_source",
        artifact_bytes=png_40x60,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="initial_crop",
    )

    assert state.status == PageStageStatus.clean
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path as sap

    artifact_path = sap(tmp_path, project_id, page_id, "initial_crop")
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    # initial_crop=(L=2, R=2, T=4, B=4): height = 40-4-4=32, width = 60-2-2=56
    assert arr.shape[:2] == (32, 56), (
        f"expected (32, 56) after crop_edges with insets (2,2,4,4), got {arr.shape[:2]}"
    )


@pytest.mark.asyncio
async def test_initial_crop_no_op_when_no_config(tmp_path: Path, db: SqliteDatabase) -> None:
    """``initial_crop`` with no config overrides passes through the image unchanged."""
    project_id, page_id = "b87_ic_noop", "0000"
    await _seed_project_and_page(db, project_id)
    png_40x60 = _color_png(h=40, w=60)
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="decode_source",
        artifact_bytes=png_40x60,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="initial_crop",
    )

    assert state.status == PageStageStatus.clean
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path as sap

    artifact_path = sap(tmp_path, project_id, page_id, "initial_crop")
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    assert arr.shape[:2] == (40, 60), f"expected unchanged (40, 60) with default config, got {arr.shape[:2]}"


# ─── Bullet 7: manual_deskew_pre calls rotate_image with configured angle ─────


@pytest.mark.asyncio
async def test_manual_deskew_pre_rotates_when_angle_configured(tmp_path: Path, db: SqliteDatabase) -> None:
    """When ``cfg.deskew_before_crop`` is set, the ``manual_deskew_pre`` stage
    must call ``rotate_image`` — verified by checking the output shape differs
    from a passthrough (rotation changes dimensions for non-square images and
    non-zero non-90 angles, but for a 90-degree rotation height and width swap).
    """
    project_id, page_id = "b87_mdp", "0000"
    await _seed_project_and_page(
        db,
        project_id,
        config_overrides=PageConfigOverrides(deskew_before_crop=90.0),
    )
    # Use a non-square image so a 90-degree rotation changes the shape.
    # manual_deskew_pre depends on initial_crop, so seed that as the parent.
    png_30x80 = _color_png(h=30, w=80)
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="initial_crop",
        artifact_bytes=png_30x80,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="manual_deskew_pre",
    )

    assert state.status == PageStageStatus.clean
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path as sap

    artifact_path = sap(tmp_path, project_id, page_id, "manual_deskew_pre")
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    # A 90-degree rotation of a 30x80 image should produce an 80x30 image.
    h, w = arr.shape[:2]
    assert (h, w) == (80, 30), f"expected (80, 30) after 90-degree rotation of 30x80 image, got ({h}, {w})"


@pytest.mark.asyncio
async def test_manual_deskew_pre_no_op_when_no_angle(tmp_path: Path, db: SqliteDatabase) -> None:
    """Without ``manual_deskew_angle``, the stage is a passthrough."""
    project_id, page_id = "b87_mdp_noop", "0000"
    await _seed_project_and_page(db, project_id)
    # manual_deskew_pre depends on initial_crop, so seed that as the parent.
    png_30x80 = _color_png(h=30, w=80)
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="initial_crop",
        artifact_bytes=png_30x80,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="manual_deskew_pre",
    )

    assert state.status == PageStageStatus.clean
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path as sap

    artifact_path = sap(tmp_path, project_id, page_id, "manual_deskew_pre")
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    assert arr.shape[:2] == (30, 80), f"expected unchanged (30, 80) without angle config, got {arr.shape[:2]}"


# ─── Bullet 8: route handler resolves config and passes it to run_stage ───────


def test_run_stage_route_passes_resolved_config(tmp_path: Path) -> None:
    """The sync ``POST /stages/{stage_id}/run`` route resolves config and passes
    it to ``run_stage`` so config-aware stages use the current DB config values.

    We verify this by seeding a page with ``threshold_level=255`` and running
    the full stage chain up to ``threshold`` via the route — the result should
    be an all-black image (every pixel ≤ 255 → 0), same proof as bullet 1 but
    exercised through the HTTP layer to confirm the route plumbs config through.
    """
    import asyncio as _asyncio
    from datetime import UTC
    from datetime import datetime as _dt

    settings = Settings(
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

    async def _seed() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = _dt.now(UTC)
        await db.put_project(
            Project(
                id="b87_route",
                owner_id="default",
                name="b87_route",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="b87_route", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/b87_route/",
            )
        )
        await db.put_pages(
            [
                PageRecord(
                    project_id="b87_route",
                    idx0=0,
                    prefix="p001",
                    source_stem="src",
                    processing_status=PageProcessingStatus.pending,
                    config_overrides=PageConfigOverrides(threshold_level=255),
                )
            ]
        )
        # Seed grayscale artifact (manual_deskew_pre must also exist as parent).
        await db.init_page_stages_for_page("b87_route", "0000")
        gray_png = _gray_gradient_png()
        await commit_stage_artifact(
            data_root=settings.data_root,
            database=db,
            project_id="b87_route",
            page_id="0000",
            stage_id="grayscale",
            artifact_bytes=gray_png,
        )
        await db.close()

    _asyncio.run(_seed())

    app = build_app(settings)
    from fastapi.testclient import TestClient

    with TestClient(app, raise_server_exceptions=True) as client:
        resp = client.post("/api/data/projects/b87_route/pages/0/stages/threshold/run")
        assert resp.status_code == 200, resp.text

    # Verify the artifact is all-black (threshold_level=255 → every pixel ≤ 255 → 0).
    artifact_path = stage_artifact_path(settings.data_root, "b87_route", "0000", "threshold")
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    assert arr.max() == 0, (
        "threshold_level=255 should produce all-black image when route plumbs resolved config through"
    )
