"""Behaviors 4, 5, 6 — registry version guard, dirty propagation, reindex.

Spec:
  - stage-registry-v2.md §1 (REGISTRY_VERSION, 409 shape)
  - stage-registry-v2.md §2.2 (cross-scope dirty propagation)
  - api-v2-deltas.md §4 (deprecations — V2_PAGE_STAGE_IDS replaces PAGE_STAGE_IDS)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path


def test_registry_version_mismatch_error_shape() -> None:
    """RegistryVersionMismatchError carries the correct structured 409 body shape."""
    from pdomain_prep_for_pgdp.core.pipeline.registry_version import (
        REGISTRY_VERSION,
        RegistryVersionMismatchError,
    )

    err = RegistryVersionMismatchError(project_version=1)
    body = err.as_dict()
    assert body == {
        "error": "registry_version_mismatch",
        "project_version": 1,
        "server_version": REGISTRY_VERSION,
    }
    assert REGISTRY_VERSION == 3  # P1.9 bumped REGISTRY_VERSION from 2 → 3


def test_new_project_row_stamped_registry_version_3(tmp_path: Path) -> None:
    """Projects created against v3 get registry_version=3 stamped on their row."""
    import asyncio
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.models import (
        Project,
        ProjectConfig,
        ProjectStatus,
    )

    db = SqliteDatabase(f"sqlite:///{tmp_path}/test.db")

    async def _run() -> None:
        await db.initialize()
        project = Project(
            id="proj-v2-test",
            owner_id="default",
            name="V2 Test",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            status=ProjectStatus.configuring,
            page_count=0,
            proof_page_count=0,
            config=ProjectConfig(book_name="Test Book", source_uri="test://"),
            storage_prefix="projects/proj-v2-test",
        )
        await db.put_project(project)
        loaded = await db.get_project("proj-v2-test")
        assert loaded is not None
        assert loaded.registry_version == 3  # P1.9 bumped REGISTRY_VERSION from 2 → 3

    asyncio.run(_run())


def test_v1_project_access_raises_registry_version_mismatch(tmp_path: Path) -> None:
    """Reading a v1 project raises RegistryVersionMismatchError (structured 409 guard)."""
    import asyncio
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.models import (
        Project,
        ProjectConfig,
        ProjectStatus,
    )
    from pdomain_prep_for_pgdp.core.pipeline.registry_version import (
        RegistryVersionMismatchError,
        check_registry_version,
    )

    db = SqliteDatabase(f"sqlite:///{tmp_path}/test2.db")

    async def _run() -> None:
        await db.initialize()
        project = Project(
            id="proj-v1-test",
            owner_id="default",
            name="V1 Test",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            status=ProjectStatus.configuring,
            page_count=0,
            proof_page_count=0,
            config=ProjectConfig(book_name="Test Book", source_uri="test://"),
            storage_prefix="projects/proj-v1-test",
            registry_version=1,  # v1 project
        )
        await db.put_project(project)
        loaded = await db.get_project("proj-v1-test")
        assert loaded is not None

        # The guard must raise for v1 projects
        with pytest.raises(RegistryVersionMismatchError) as exc_info:
            check_registry_version(loaded)
        assert exc_info.value.as_dict()["project_version"] == 1

    asyncio.run(_run())


def test_dirty_propagation_page_to_project_scope() -> None:
    """Re-running a page-scoped stage marks downstream project-scoped stages dirty.

    After text_review (page) completes, validation (project) should be stale.
    After source (project) re-runs, page_order (project) and downstream should be stale.
    """
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import (
        compute_v2_dirty_descendants,
    )

    # text_review is page-scoped; validation is the first project-scoped stage
    # in its downstream chain
    descendants = compute_v2_dirty_descendants("text_review")
    assert "validation" in descendants, (
        "text_review re-run must mark validation stale (cross-scope propagation)"
    )
    assert "proof_pack" in descendants
    assert "build_package" in descendants
    assert "zip" in descendants
    assert "submit_check" in descendants
    assert "archive" in descendants


def test_dirty_propagation_illustrations_to_validation() -> None:
    """illustrations (page) re-run must mark validation (project) stale."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

    descendants = compute_v2_dirty_descendants("illustrations")
    assert "validation" in descendants


def test_dirty_propagation_page_order_to_validation() -> None:
    """page_order (project) re-run must mark validation (project) stale."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

    descendants = compute_v2_dirty_descendants("page_order")
    assert "validation" in descendants
    assert "proof_pack" in descendants


def test_dirty_propagation_source_marks_grayscale_stale() -> None:
    """source (project) re-run marks grayscale (page) stale."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

    descendants = compute_v2_dirty_descendants("source")
    assert "grayscale" in descendants


def test_dirty_propagation_does_not_include_stage_itself() -> None:
    """compute_v2_dirty_descendants does not include the trigger stage."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

    descendants = compute_v2_dirty_descendants("crop")
    assert "crop" not in descendants


def test_reindex_rebuilds_v2_project_stage_state(tmp_path: Path) -> None:
    """pgdp-prep reindex rebuilds project stage state from artifacts under v2 IDs."""
    # Simulate: artifact exists for 'source' project stage
    artifact_dir = tmp_path / "projects" / "p1" / "stages" / "source"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "output.json").write_text('{"pages": []}')

    from pdomain_prep_for_pgdp.core.models import ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
        ProjectStageStore,
        reindex_project_stages,
    )

    store = ProjectStageStore(db_path=tmp_path / "stages.db")

    # Run reindex
    reindex_project_stages(project_id="p1", data_root=tmp_path, store=store)

    # source should now be clean (artifact found)
    row = store.read(project_id="p1", stage_id="source")
    assert row is not None
    assert row.status == ProjectStageStatus.clean

    # archive should still be not-run (no artifact)
    archive_row = store.read(project_id="p1", stage_id="archive")
    assert archive_row is not None
    assert archive_row.status == ProjectStageStatus.not_run
