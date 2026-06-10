"""Behavior 3 — project_stages store: ProjectStageState rows with dual-write contract.

Spec: docs/specs/api-v2-deltas.md §3 (ProjectStageState, ProjectStageStatus).
spec: docs/specs/stage-registry-v2.md §2.2 (8 project-scoped stages).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def test_project_stage_status_has_no_not_applicable() -> None:
    """ProjectStageStatus must NOT have not_applicable (api-v2-deltas §3)."""
    from pdomain_prep_for_pgdp.core.models import ProjectStageStatus

    values = {e.value for e in ProjectStageStatus}
    assert "not-applicable" not in values, "ProjectStageStatus must not have not_applicable"
    # Must have the 5 other values
    assert values == {"not-run", "running", "clean", "dirty", "failed"}


def test_project_stage_state_model_fields() -> None:
    """ProjectStageState must have the fields from api-v2-deltas §3."""
    from pdomain_prep_for_pgdp.core.models import ProjectStageState

    state = ProjectStageState(project_id="proj1", stage_id="source")
    assert state.project_id == "proj1"
    assert state.stage_id == "source"
    assert state.status.value == "not-run"
    assert state.stage_version == 2
    assert state.artifact_key is None
    assert state.config_hash is None
    assert state.input_hash is None
    assert state.last_run_at is None
    assert state.duration_ms is None
    assert state.error_message is None
    assert state.job_id is None


def test_project_stage_state_no_page_id_field() -> None:
    """ProjectStageState must NOT have a page_id field."""
    from pdomain_prep_for_pgdp.core.models import ProjectStageState

    state = ProjectStageState(project_id="proj1", stage_id="source")
    assert not hasattr(state, "page_id"), "ProjectStageState must not have page_id"


def test_init_project_stages_creates_8_rows(tmp_path: Path) -> None:
    """init_project_stages creates exactly 8 rows (one per project-scoped stage)."""
    from pdomain_prep_for_pgdp.core.models import V2_PROJECT_STAGE_IDS
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import init_project_stages

    rows = init_project_stages(project_id="p1")
    assert len(rows) == 8
    assert {r.stage_id for r in rows} == set(V2_PROJECT_STAGE_IDS)


def test_init_project_stages_all_not_run(tmp_path: Path) -> None:
    """All initialized project stage rows start as 'not-run'."""
    from pdomain_prep_for_pgdp.core.models import ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import init_project_stages

    rows = init_project_stages(project_id="p2")
    for row in rows:
        assert row.status == ProjectStageStatus.not_run, f"{row.stage_id}: expected not-run"


def test_project_stage_store_write_and_read(tmp_path: Path) -> None:
    """ProjectStageStore write+read round-trip returns correct state."""
    from pdomain_prep_for_pgdp.core.models import ProjectStageState, ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    store = ProjectStageStore(db_path=tmp_path / "stages.db")
    state = ProjectStageState(
        project_id="proj1",
        stage_id="source",
        status=ProjectStageStatus.clean,
        artifact_key="projects/proj1/stages/source/output.json",
        last_run_at=1000.0,
        duration_ms=200,
    )
    store.write(state)
    loaded = store.read(project_id="proj1", stage_id="source")
    assert loaded is not None
    assert loaded.status == ProjectStageStatus.clean
    assert loaded.artifact_key == "projects/proj1/stages/source/output.json"
    assert loaded.last_run_at == 1000.0
    assert loaded.duration_ms == 200


def test_project_stage_store_list_for_project(tmp_path: Path) -> None:
    """list_for_project returns all stage rows for a project."""
    from pdomain_prep_for_pgdp.core.models import V2_PROJECT_STAGE_IDS
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore, init_project_stages

    store = ProjectStageStore(db_path=tmp_path / "stages.db")
    rows = init_project_stages(project_id="proj1")
    for row in rows:
        store.write(row)

    listed = store.list_for_project("proj1")
    assert len(listed) == 8
    assert {r.stage_id for r in listed} == set(V2_PROJECT_STAGE_IDS)


def test_project_stage_store_read_missing_returns_none(tmp_path: Path) -> None:
    """Reading a non-existent row returns None."""
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    store = ProjectStageStore(db_path=tmp_path / "stages.db")
    result = store.read(project_id="no_such_project", stage_id="source")
    assert result is None


class _FakeWriteFailsError(Exception):
    pass


def test_dual_write_crash_leaves_reindex_recoverable(tmp_path: Path) -> None:
    """Crash between artifact write and row write leaves reindex-recoverable state.

    The artifact lands on disk, but the DB row is not written. reindex should
    be able to detect the artifact and repair the row to 'clean'.
    This test simulates the artifact-present / row-absent scenario.
    """
    from pdomain_prep_for_pgdp.core.models import ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    store = ProjectStageStore(db_path=tmp_path / "stages.db")

    # Simulate: artifact was written to disk
    artifact_dir = tmp_path / "projects" / "proj1" / "stages" / "source"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "output.json").write_text('{"status": "complete"}')

    # But DB row was never written (crash between artifact + row write)
    row = store.read(project_id="proj1", stage_id="source")
    assert row is None, "row should be absent after simulated crash"

    # reindex should detect artifact and return 'clean' recommendation
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import infer_project_stage_from_artifact

    inferred = infer_project_stage_from_artifact(
        project_id="proj1",
        stage_id="source",
        data_root=tmp_path,
    )
    assert inferred is not None
    assert inferred.status == ProjectStageStatus.clean, f"expected clean from artifact, got {inferred.status}"
