"""Tests for issue #53: split-child decode_source bbox crop + (parent_id, bbox) input_hash.

Spec: docs/specs/pipeline-task-model.md §"Splits as sibling pages (Q6 lock)"
§"Cross-page dirty propagation: split children".

Three acceptance bullets:
1. Running `decode_source` on a split child produces a cropped PNG matching the
   bbox region of the parent's source image.
2. The child's `decode_source` `input_hash` is a deterministic function of
   `(parent_page_id, source_crop_bbox)` and changes if either changes.
3. Re-running `ingest_source` on the parent dirties the child's `decode_source`
   (cross-page dirty propagation works through the bbox-input dependency).
"""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING

import cv2
import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import PageRecord, PageStageStatus
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import (
    StageDependenciesNotMet,
    run_stage,
)
from tests.fixtures.seed_pages import seed_page_in_store

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _solid_color_png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    """BGR PNG of a solid-color image at the given dimensions."""
    img = np.full((height, width, 3), color, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _expected_input_hash(parent_page_id: str, source_crop_bbox: tuple[int, int, int, int]) -> str:
    """Reproduce the deterministic hash the runner should compute."""
    payload = json.dumps(
        {"parent_page_id": parent_page_id, "source_crop_bbox": list(source_crop_bbox)},
        sort_keys=True,
    ).encode()
    return hashlib.sha256(payload).hexdigest()


async def _make_parent_page(
    db: SqliteDatabase, project_id: str, data_root: Path, idx0: int = 0
) -> PageRecord:
    parent = PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=f"p{idx0:03d}",
        source_stem=f"page_{idx0}",
    )
    seed_page_in_store(data_root, parent.project_id, parent)
    return parent


async def _make_child_page(
    db: SqliteDatabase,
    project_id: str,
    data_root: Path,
    parent_page_id: str,
    source_crop_bbox: tuple[int, int, int, int],
    idx0: int = 1,
    split_suffix: str = "a",
) -> PageRecord:
    child = PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=f"p{idx0:03d}{split_suffix}",
        source_stem=f"page_{idx0}",
        parent_page_id=parent_page_id,
        source_crop_bbox=source_crop_bbox,
        split_index=1,
        split_at_stage="auto_detect_attrs",
        split_suffix=split_suffix,
    )
    seed_page_in_store(data_root, child.project_id, child)
    return child


@pytest.mark.asyncio
async def test_decode_source_on_split_child_produces_cropped_png(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Running `decode_source` on a split child produces a PNG cropped to
    `source_crop_bbox` from the parent's `ingest_source` artifact.

    The parent's source is a 200x150 BGR image; the child's bbox is the
    top-left quadrant (x=0, y=0, w=100, h=75). The output must have
    dimensions h=75, w=100.
    """
    project_id = "proj1"
    parent_page_id = "0000"
    source_crop_bbox = (0, 0, 100, 75)  # (x, y, w, h)

    await _make_parent_page(db, project_id, tmp_path, idx0=0)
    child = await _make_child_page(
        db, project_id, tmp_path, parent_page_id=parent_page_id, source_crop_bbox=source_crop_bbox, idx0=1
    )
    child_page_id = f"{child.idx0:04d}"

    # Seed parent's ingest_source: a 200x150 BGR PNG.
    parent_png = _solid_color_png(200, 150, (0, 128, 255))
    await db.init_page_stages_for_page(project_id, parent_page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        artifact_bytes=parent_png,
    )

    # Init child stages (so dep rows exist).
    await db.init_page_stages_for_page(project_id, child_page_id)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=child_page_id,
        stage_id="decode_source",
    )

    assert state.status == PageStageStatus.clean, f"expected clean, got: {state.error_message}"

    # Output artifact must exist.
    artifact_path = stage_artifact_path(tmp_path, project_id, child_page_id, "decode_source")
    assert artifact_path.exists(), "decode_source artifact missing for child page"

    # Dimensions must match the bbox (h=75, w=100).
    raw = artifact_path.read_bytes()
    arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None, "decode_source output is not a valid image"
    assert arr.shape[:2] == (75, 100), (
        f"expected crop shape (75, 100) from bbox {source_crop_bbox!r}, got {arr.shape[:2]}"
    )


@pytest.mark.asyncio
async def test_decode_source_on_split_child_crops_correct_region(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """The cropped PNG content matches the exact pixel region from the parent.

    The parent image has a distinctive red square at (x=50, y=30, w=40, h=40).
    The child's bbox targets that square; the output must be dominated by red.
    """
    project_id = "proj2"
    parent_page_id = "0000"
    # Bbox targets the red square exactly.
    source_crop_bbox = (50, 30, 40, 40)  # (x=50, y=30, w=40, h=40)

    await _make_parent_page(db, project_id, tmp_path, idx0=0)
    child = await _make_child_page(
        db, project_id, tmp_path, parent_page_id=parent_page_id, source_crop_bbox=source_crop_bbox, idx0=1
    )
    child_page_id = f"{child.idx0:04d}"

    # Build parent image: white background, red square at (50..90, 30..70).
    parent_img = np.full((200, 200, 3), 255, dtype=np.uint8)
    parent_img[30:70, 50:90] = (0, 0, 200)  # BGR red
    ok, buf = cv2.imencode(".png", parent_img)
    assert ok
    parent_png = bytes(buf.tobytes())

    await db.init_page_stages_for_page(project_id, parent_page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        artifact_bytes=parent_png,
    )
    await db.init_page_stages_for_page(project_id, child_page_id)

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=child_page_id,
        stage_id="decode_source",
    )

    artifact_path = stage_artifact_path(tmp_path, project_id, child_page_id, "decode_source")
    raw = artifact_path.read_bytes()
    arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)

    # The output must be the red square: shape (40, 40).
    # In BGR format: red = (0, 0, 200) → channel[0]=B≈0, channel[2]=R≈200.
    assert arr.shape[:2] == (40, 40)
    assert arr[:, :, 2].mean() > 150, "crop R channel (idx 2) should be ~200 (BGR red)"
    assert arr[:, :, 0].mean() < 50, "crop B channel (idx 0) should be ~0 (BGR red)"


@pytest.mark.asyncio
async def test_decode_source_on_child_fails_when_parent_ingest_source_not_clean(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """If the parent's `ingest_source` is not clean, running the child's
    `decode_source` raises `StageDependenciesNotMet` before any mutation."""
    project_id = "proj3"
    parent_page_id = "0000"
    source_crop_bbox = (0, 0, 50, 50)

    await _make_parent_page(db, project_id, tmp_path, idx0=0)
    child = await _make_child_page(
        db, project_id, tmp_path, parent_page_id=parent_page_id, source_crop_bbox=source_crop_bbox, idx0=1
    )
    child_page_id = f"{child.idx0:04d}"

    # Init parent stages but do NOT run ingest_source (so it stays not-run).
    await db.init_page_stages_for_page(project_id, parent_page_id)
    await db.init_page_stages_for_page(project_id, child_page_id)

    with pytest.raises(StageDependenciesNotMet):
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=child_page_id,
            stage_id="decode_source",
        )


@pytest.mark.asyncio
async def test_split_child_decode_source_input_hash_encodes_parent_and_bbox(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """The child's `decode_source` `input_hash` must equal
    sha256(json({"parent_page_id": ..., "source_crop_bbox": ...})).
    """
    project_id = "proj4"
    parent_page_id = "0000"
    source_crop_bbox = (10, 20, 80, 60)

    await _make_parent_page(db, project_id, tmp_path, idx0=0)
    child = await _make_child_page(
        db, project_id, tmp_path, parent_page_id=parent_page_id, source_crop_bbox=source_crop_bbox, idx0=1
    )
    child_page_id = f"{child.idx0:04d}"

    parent_png = _solid_color_png(200, 150, (100, 100, 100))
    await db.init_page_stages_for_page(project_id, parent_page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        artifact_bytes=parent_png,
    )
    await db.init_page_stages_for_page(project_id, child_page_id)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=child_page_id,
        stage_id="decode_source",
    )

    expected_hash = _expected_input_hash(parent_page_id, source_crop_bbox)
    assert state.input_hash == expected_hash, (
        f"input_hash should be sha256 of (parent_page_id, source_crop_bbox); "
        f"expected {expected_hash!r}, got {state.input_hash!r}"
    )


@pytest.mark.asyncio
async def test_split_child_decode_source_input_hash_changes_when_bbox_changes(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Different `source_crop_bbox` values produce different `input_hash` values."""
    project_id = "proj5"
    parent_page_id = "0000"
    bbox_a = (0, 0, 50, 50)
    bbox_b = (50, 50, 50, 50)  # different position

    await _make_parent_page(db, project_id, tmp_path, idx0=0)

    parent_png = _solid_color_png(200, 200, (128, 128, 128))
    await db.init_page_stages_for_page(project_id, parent_page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        artifact_bytes=parent_png,
    )

    # Child A with bbox_a.
    child_a = await _make_child_page(
        db,
        project_id,
        tmp_path,
        parent_page_id=parent_page_id,
        source_crop_bbox=bbox_a,
        idx0=1,
        split_suffix="a",
    )
    child_a_pid = f"{child_a.idx0:04d}"
    await db.init_page_stages_for_page(project_id, child_a_pid)

    state_a = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=child_a_pid,
        stage_id="decode_source",
    )

    # Child B with bbox_b.
    child_b = await _make_child_page(
        db,
        project_id,
        tmp_path,
        parent_page_id=parent_page_id,
        source_crop_bbox=bbox_b,
        idx0=2,
        split_suffix="b",
    )
    child_b_pid = f"{child_b.idx0:04d}"
    await db.init_page_stages_for_page(project_id, child_b_pid)

    state_b = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=child_b_pid,
        stage_id="decode_source",
    )

    assert state_a.input_hash != state_b.input_hash, (
        "Different source_crop_bbox values must produce different input_hash values"
    )
    assert state_a.input_hash == _expected_input_hash(parent_page_id, bbox_a)
    assert state_b.input_hash == _expected_input_hash(parent_page_id, bbox_b)


@pytest.mark.asyncio
async def test_parent_ingest_source_rerun_dirties_child_decode_source(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running `ingest_source` on the parent marks all child pages'
    `decode_source` rows as `dirty` (cross-page dirty propagation).

    Spec: §"Cross-page dirty propagation: split children".
    """
    project_id = "proj6"
    parent_page_id = "0000"
    source_crop_bbox = (0, 0, 50, 50)
    storage = FilesystemStorage(tmp_path)

    await _make_parent_page(db, project_id, tmp_path, idx0=0)
    child = await _make_child_page(
        db, project_id, tmp_path, parent_page_id=parent_page_id, source_crop_bbox=source_crop_bbox, idx0=1
    )
    child_page_id = f"{child.idx0:04d}"

    # Stage both parent and child.
    await db.init_page_stages_for_page(project_id, parent_page_id)
    await db.init_page_stages_for_page(project_id, child_page_id)

    # Stash the source image in storage so ingest_source can read it.
    parent_png = _solid_color_png(100, 100, (200, 100, 50))
    source_key = f"projects/{project_id}/source/page0.png"
    await storage.put_bytes(source_key, parent_png, "image/png")

    # Run parent's ingest_source for the first time.
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        storage=storage,
        page_source_key=source_key,
    )

    # Run child's decode_source (so the row becomes clean).
    state_clean = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=child_page_id,
        stage_id="decode_source",
    )
    assert state_clean.status == PageStageStatus.clean

    # Verify child's decode_source is clean before the re-run.
    child_ds_before = await db.get_page_stage(project_id, child_page_id, "decode_source")
    assert child_ds_before is not None
    assert child_ds_before.status == PageStageStatus.clean

    # Re-run parent's ingest_source.
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        storage=storage,
        page_source_key=source_key,
    )

    # Child's decode_source must now be dirty.
    child_ds_after = await db.get_page_stage(project_id, child_page_id, "decode_source")
    assert child_ds_after is not None
    assert child_ds_after.status == PageStageStatus.dirty, (
        f"Expected child decode_source to be dirty after parent ingest_source re-run, "
        f"got {child_ds_after.status!r}"
    )


@pytest.mark.asyncio
async def test_parent_ingest_source_does_not_dirty_child_decode_source_if_not_clean(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Cross-page cascade only flips `clean` or `failed` rows to `dirty`.
    A child's `decode_source` that is `not-run` must stay `not-run`.
    """
    project_id = "proj7"
    parent_page_id = "0000"
    storage = FilesystemStorage(tmp_path)

    await _make_parent_page(db, project_id, tmp_path, idx0=0)
    child = await _make_child_page(
        db, project_id, tmp_path, parent_page_id=parent_page_id, source_crop_bbox=(0, 0, 50, 50), idx0=1
    )
    child_page_id = f"{child.idx0:04d}"

    await db.init_page_stages_for_page(project_id, parent_page_id)
    await db.init_page_stages_for_page(project_id, child_page_id)

    # v2: init_page_stages_for_page only creates v2 stage rows (no decode_source).
    # Manually seed a not-run decode_source row for the child so the cross-page
    # cascade test can assert that not-run rows are not flipped to dirty.
    from pdomain_prep_for_pgdp.core.models import PageStageState

    await db.put_page_stage(
        PageStageState(
            project_id=project_id,
            page_id=child_page_id,
            stage_id="decode_source",
            status=PageStageStatus.not_run,
            stage_version=1,
        )
    )

    parent_png = _solid_color_png(100, 100, (100, 100, 100))
    source_key = f"projects/{project_id}/source/page0.png"
    await storage.put_bytes(source_key, parent_png, "image/png")

    # Run parent's ingest_source. Child's decode_source is still not-run.
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="ingest_source",
        storage=storage,
        page_source_key=source_key,
    )

    child_ds = await db.get_page_stage(project_id, child_page_id, "decode_source")
    assert child_ds is not None
    assert child_ds.status == PageStageStatus.not_run, (
        "not-run rows must not be flipped to dirty by cross-page cascade"
    )
