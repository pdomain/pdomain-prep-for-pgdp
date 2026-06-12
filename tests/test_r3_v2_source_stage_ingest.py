"""TDD: ingest writes the v2 'source' project stage after thumbnails complete.

R3 — W6.3 leftovers: ingest path migrated onto v2 stage state.

After `unzip_source`:
  - project_stages row for 'source' is NOT yet clean (thumbnails not done).

After `generate_thumbnails`:
  - project_stages row for 'source' is 'clean'.
  - artifact at stages/source/output.json exists.
  - Project.status == ProjectStatus.configuring.

Project model no longer has pipeline_state field (PipelineState removed).
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
    Project,
    ProjectConfig,
    ProjectStageStatus,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service


def _png_bytes(h: int = 50, w: int = 50) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _make_project(project_id: str = "p1") -> Project:
    """Construct a minimal Project — no pipeline_state field (removed at R3)."""
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="Test Book",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="test-book", source_uri=""),
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path: Path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


# ─── R3.1: Project model no longer has pipeline_state ──────────────────────


def test_project_model_has_no_pipeline_state_field() -> None:
    """Project must not have a pipeline_state field after R3 removal."""
    p = _make_project()
    assert not hasattr(p, "pipeline_state"), "Project still has pipeline_state — PipelineState not removed"


def test_pipeline_state_not_importable() -> None:
    """PipelineState / StepState / StepId must be removed from core.models."""
    import pdomain_prep_for_pgdp.core.models as m

    assert not hasattr(m, "PipelineState"), "PipelineState still exported from core.models"
    assert not hasattr(m, "StepState"), "StepState still exported from core.models"
    assert not hasattr(m, "StepId"), "StepId still exported from core.models"


# ─── R3.2: After thumbnails, source stage row is clean ──────────────────────


@pytest.mark.asyncio
async def test_generate_thumbnails_marks_source_stage_clean(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    """After generate_thumbnails, project_stages row for 'source' is 'clean'."""
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    project = _make_project()
    await db.put_project(project)

    zip_bytes = _make_zip([("page_001.png", _png_bytes())])
    source_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(source_key, zip_bytes)

    svc = build_page_service(tmp_path / "data", project.id)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key=source_key,
        storage=storage,
        database=db,
        page_service=svc,
    )

    # After unzip only: source stage is not yet clean
    data_root = tmp_path / "data"
    db_path = data_root / "projects" / project.id / "project_stages.db"
    # Row may not exist yet; that's fine — we check after thumbnails.

    await generate_thumbnails(
        project=project,
        storage=storage,
        database=db,
        page_service=svc,
        data_root=tmp_path / "data",
    )

    # After thumbnails: source stage row must be clean
    assert db_path.exists(), "project_stages.db not created by generate_thumbnails"
    store = ProjectStageStore(db_path)
    row = store.read(project.id, "source")
    assert row is not None, "No 'source' row in project_stages after generate_thumbnails"
    assert row.status == ProjectStageStatus.clean, f"source stage status is {row.status!r}, expected 'clean'"


@pytest.mark.asyncio
async def test_generate_thumbnails_writes_source_artifact(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    """After generate_thumbnails, stages/source/output.json exists on disk."""
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _make_project()
    await db.put_project(project)
    zip_bytes = _make_zip([("page_001.png", _png_bytes())])
    source_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(source_key, zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key=source_key,
        storage=storage,
        database=db,
        page_service=svc,
    )
    await generate_thumbnails(
        project=project,
        storage=storage,
        database=db,
        page_service=svc,
        data_root=tmp_path / "data",
    )

    artifact_path = tmp_path / "data" / "projects" / project.id / "stages" / "source" / "output.json"
    assert artifact_path.exists(), f"source stage artifact not written: {artifact_path}"

    # Artifact must be valid JSON with page_count
    data = json.loads(artifact_path.read_text())
    assert "page_count" in data, f"source artifact missing page_count: {data}"
    assert data["page_count"] == 1


@pytest.mark.asyncio
async def test_generate_thumbnails_source_row_has_artifact_key(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    """source row artifact_key points to the output.json relative path."""
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    project = _make_project()
    await db.put_project(project)
    zip_bytes = _make_zip([("page_001.png", _png_bytes())])
    source_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(source_key, zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key=source_key,
        storage=storage,
        database=db,
        page_service=svc,
    )
    await generate_thumbnails(
        project=project,
        storage=storage,
        database=db,
        page_service=svc,
        data_root=tmp_path / "data",
    )

    data_root = tmp_path / "data"
    db_path = data_root / "projects" / project.id / "project_stages.db"
    store = ProjectStageStore(db_path)
    row = store.read(project.id, "source")
    assert row is not None
    # artifact_key should be the relative path from data_root
    expected_rel = f"projects/{project.id}/stages/source/output.json"
    assert row.artifact_key == expected_rel, f"artifact_key={row.artifact_key!r}, expected {expected_rel!r}"


@pytest.mark.asyncio
async def test_unzip_source_does_not_write_source_stage_row(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    """unzip_source alone must NOT write the source stage row (thumbnails not done)."""
    from pdomain_prep_for_pgdp.core.ingest import unzip_source
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    project = _make_project()
    await db.put_project(project)
    zip_bytes = _make_zip([("page_001.png", _png_bytes())])
    source_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(source_key, zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key=source_key,
        storage=storage,
        database=db,
        page_service=svc,
    )

    data_root = tmp_path / "data"
    db_path = data_root / "projects" / project.id / "project_stages.db"
    if db_path.exists():
        store = ProjectStageStore(db_path)
        row = store.read(project.id, "source")
        # Row may not exist yet, or may be not-run — must NOT be clean
        if row is not None:
            assert row.status != ProjectStageStatus.clean, (
                "source stage is already 'clean' after unzip — should only be clean after thumbnails"
            )
