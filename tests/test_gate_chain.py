"""Gate chain tests — B4 project-scoped tail stages.

Spec: docs/plans/2026-06-10-statechart-convergence.md (Task B4)
      docs/specs/stage-registry-v2.md §2.2 (cross-scope dirty propagation)

Gate contract:
  1. validation must be clean before build_package can run.
  2. build_package must be clean before zip can run.
  3. zip must be clean before submit_check can run.
  4. submit_check must be clean (+ GateConfirmation) before archive can run.
  5. Any upstream re-run (page-scoped OR project-scoped) marks everything
     downstream stale via compute_v2_dirty_descendants + ProjectStageStore.

These tests use ProjectStageStore in a tmp SQLite DB to assert the cascade.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _make_store(tmp_path: Path) -> tuple[ProjectStageStore, str]:  # noqa: F821
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
        ProjectStageStore,
        init_project_stages,
    )

    project_id = str(uuid.uuid4())
    db_path = tmp_path / "project_stages.db"
    store = ProjectStageStore(db_path)
    for row in init_project_stages(project_id):
        store.write(row)
    return store, project_id


def _set_status(store: ProjectStageStore, project_id: str, stage_id: str, status: str) -> None:  # noqa: F821
    from pdomain_prep_for_pgdp.core.models import ProjectStageStatus

    state = store.read(project_id, stage_id)
    assert state is not None, f"Stage {stage_id} not found"
    updated = state.model_copy(update={"status": ProjectStageStatus(status)})
    store.write(updated)


# ────────────────────────────────────────────────────────────────────────────
# 1. Dependency order: gate enforcement
# ────────────────────────────────────────────────────────────────────────────


class TestGateDependencyOrder:
    def test_v2_dag_has_validation_before_build_package(self) -> None:
        """validation is a direct dep of proof_pack which is a dep of build_package."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

        by_id = {s.id: s for s in V2_STAGE_DAG}
        proof_pack = by_id["proof_pack"]
        assert "validation" in proof_pack.depends_on

        build_package = by_id["build_package"]
        assert "proof_pack" in build_package.depends_on

    def test_v2_dag_has_build_before_zip(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

        by_id = {s.id: s for s in V2_STAGE_DAG}
        zip_stage = by_id["zip"]
        assert "build_package" in zip_stage.depends_on

    def test_v2_dag_has_zip_before_submit_check(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

        by_id = {s.id: s for s in V2_STAGE_DAG}
        submit_check = by_id["submit_check"]
        assert "zip" in submit_check.depends_on

    def test_v2_dag_has_submit_check_before_archive(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

        by_id = {s.id: s for s in V2_STAGE_DAG}
        archive = by_id["archive"]
        assert "submit_check" in archive.depends_on


# ────────────────────────────────────────────────────────────────────────────
# 2. compute_v2_dirty_descendants — gate chain staleness cascade
# ────────────────────────────────────────────────────────────────────────────


class TestDirtyDescendantsCascade:
    def test_text_review_page_rerun_marks_validation_stale(self) -> None:
        """text_review re-run → validation is in its dirty descendants."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

        descendants = compute_v2_dirty_descendants("text_review")
        # validation depends on text_review (cross-scope)
        assert "validation" in descendants

    def test_text_review_page_rerun_marks_full_chain_stale(self) -> None:
        """text_review re-run → all pack stages become stale."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

        descendants = compute_v2_dirty_descendants("text_review")
        tail_stages = {"validation", "proof_pack", "build_package", "zip", "submit_check", "archive"}
        assert tail_stages.issubset(descendants)

    def test_validation_rerun_marks_pack_chain_stale_not_upstream(self) -> None:
        """validation re-run → pack chain stale; text_review NOT stale."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

        descendants = compute_v2_dirty_descendants("validation")
        assert "proof_pack" in descendants
        assert "build_package" in descendants
        assert "zip" in descendants
        assert "submit_check" in descendants
        assert "archive" in descendants
        # upstream NOT stale
        assert "text_review" not in descendants
        assert "ocr" not in descendants

    def test_build_package_rerun_marks_zip_through_archive_stale(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

        descendants = compute_v2_dirty_descendants("build_package")
        assert {"zip", "submit_check", "archive"}.issubset(descendants)
        assert "validation" not in descendants  # upstream

    def test_zip_rerun_marks_submit_check_and_archive_stale(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

        descendants = compute_v2_dirty_descendants("zip")
        assert {"submit_check", "archive"}.issubset(descendants)
        assert "build_package" not in descendants  # upstream

    def test_page_order_rerun_marks_validation_chain_stale(self) -> None:
        """page_order re-run (project-scoped) cascades to validation and pack."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

        descendants = compute_v2_dirty_descendants("page_order")
        tail_stages = {"validation", "proof_pack", "build_package", "zip", "submit_check", "archive"}
        assert tail_stages.issubset(descendants)


# ────────────────────────────────────────────────────────────────────────────
# 3. ProjectStageStore — mark_dirty cascade
# ────────────────────────────────────────────────────────────────────────────


class TestProjectStageCascade:
    def test_mark_downstream_dirty_after_upstream_rerun(self, tmp_path: Path) -> None:
        """After upstream stage re-runs, mark_dirty_descendants updates all downstream rows."""
        from pdomain_prep_for_pgdp.core.models import ProjectStageStatus
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            mark_dirty_descendants,
        )

        store, project_id = _make_store(tmp_path)

        # Simulate: upstream page-scoped stage (text_review) just ran.
        # We call mark_dirty_descendants for "text_review" on the project store.
        mark_dirty_descendants(
            project_id=project_id,
            caused_by_stage_id="text_review",
            store=store,
        )

        # All pack stages should now be dirty
        for stage_id in ("validation", "proof_pack", "build_package", "zip", "submit_check", "archive"):
            row = store.read(project_id, stage_id)
            assert row is not None, f"Stage {stage_id} not found"
            assert row.status == ProjectStageStatus.dirty, (
                f"Expected {stage_id} to be dirty after text_review re-run, got {row.status}"
            )

    def test_mark_downstream_dirty_does_not_affect_upstream(self, tmp_path: Path) -> None:
        """mark_dirty_descendants for validation does not affect page_order (upstream)."""
        from pdomain_prep_for_pgdp.core.models import ProjectStageStatus
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            mark_dirty_descendants,
        )

        store, project_id = _make_store(tmp_path)
        # Set page_order to clean first
        _set_status(store, project_id, "page_order", "clean")

        mark_dirty_descendants(
            project_id=project_id,
            caused_by_stage_id="validation",
            store=store,
        )

        # page_order is upstream of validation → should NOT be dirtied
        page_order_row = store.read(project_id, "page_order")
        assert page_order_row is not None
        assert page_order_row.status == ProjectStageStatus.clean

    def test_build_package_gate_clear_failed_state_on_upstream_change(self, tmp_path: Path) -> None:
        """If build_package failed and validation re-runs, build_package becomes dirty (not stays failed)."""
        from pdomain_prep_for_pgdp.core.models import ProjectStageStatus
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            mark_dirty_descendants,
        )

        store, project_id = _make_store(tmp_path)
        # Simulate build_package previously failed
        _set_status(store, project_id, "build_package", "failed")

        # validation re-runs → should cascade to build_package
        mark_dirty_descendants(
            project_id=project_id,
            caused_by_stage_id="validation",
            store=store,
        )

        build_row = store.read(project_id, "build_package")
        assert build_row is not None
        # After upstream change, build_package should be dirty (ready to re-run), not failed
        assert build_row.status == ProjectStageStatus.dirty


# ────────────────────────────────────────────────────────────────────────────
# 4. Gate check functions
# ────────────────────────────────────────────────────────────────────────────


class TestGateCheckFunctions:
    def test_gate_check_validation_passed(self, tmp_path: Path) -> None:
        """check_stage_gate: validation=clean → build_package may run."""
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            ProjectStageStore,
            check_stage_gate,
            init_project_stages,
        )

        project_id = str(uuid.uuid4())
        db_path = tmp_path / "proj.db"
        store = ProjectStageStore(db_path)
        for row in init_project_stages(project_id):
            store.write(row)

        # Set validation=clean, proof_pack=clean
        _set_status(store, project_id, "validation", "clean")
        _set_status(store, project_id, "proof_pack", "clean")

        ok, reason = check_stage_gate(project_id=project_id, stage_id="build_package", store=store)
        assert ok is True, f"Expected gate to pass, got reason={reason}"

    def test_gate_check_validation_not_run_blocks_build(self, tmp_path: Path) -> None:
        """check_stage_gate: validation=not-run → build_package blocked."""
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            ProjectStageStore,
            check_stage_gate,
            init_project_stages,
        )

        project_id = str(uuid.uuid4())
        db_path = tmp_path / "proj.db"
        store = ProjectStageStore(db_path)
        for row in init_project_stages(project_id):
            store.write(row)

        # validation is not-run (default); proof_pack needs validation first
        ok, reason = check_stage_gate(project_id=project_id, stage_id="build_package", store=store)
        assert ok is False
        assert reason is not None

    def test_gate_check_zip_requires_build_package_clean(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            ProjectStageStore,
            check_stage_gate,
            init_project_stages,
        )

        project_id = str(uuid.uuid4())
        db_path = tmp_path / "proj.db"
        store = ProjectStageStore(db_path)
        for row in init_project_stages(project_id):
            store.write(row)

        # build_package not clean
        ok, _reason = check_stage_gate(project_id=project_id, stage_id="zip", store=store)
        assert ok is False

    def test_gate_check_submit_check_requires_zip_clean(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            ProjectStageStore,
            check_stage_gate,
            init_project_stages,
        )

        project_id = str(uuid.uuid4())
        db_path = tmp_path / "proj.db"
        store = ProjectStageStore(db_path)
        for row in init_project_stages(project_id):
            store.write(row)

        ok, _reason = check_stage_gate(project_id=project_id, stage_id="submit_check", store=store)
        assert ok is False

    def test_gate_check_archive_requires_submit_check_clean(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
            ProjectStageStore,
            check_stage_gate,
            init_project_stages,
        )

        project_id = str(uuid.uuid4())
        db_path = tmp_path / "proj.db"
        store = ProjectStageStore(db_path)
        for row in init_project_stages(project_id):
            store.write(row)

        ok, _reason = check_stage_gate(project_id=project_id, stage_id="archive", store=store)
        assert ok is False


# ────────────────────────────────────────────────────────────────────────────
# 5. V2_STAGE_IMPL completeness for project-scoped stages
# ────────────────────────────────────────────────────────────────────────────


class TestV2RegistryCompleteness:
    def test_all_project_stage_ids_in_v2_registry(self) -> None:
        """All 8 project-scoped stage IDs have cpu entries in V2_STAGE_IMPL."""
        from pdomain_prep_for_pgdp.core.models import V2_PROJECT_STAGE_IDS
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        for sid in V2_PROJECT_STAGE_IDS:
            assert sid in V2_STAGE_IMPL, f"Missing project-stage {sid!r} in V2_STAGE_IMPL"
            assert "cpu" in V2_STAGE_IMPL[sid], f"Missing cpu entry for {sid!r}"

    def test_b4_stages_not_placeholder(self) -> None:
        """B4 stages raise REAL impl callables, not StageNotImplemented."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            V2_STAGE_IMPL,
            StageNotImplemented,
        )

        b4_stages = (
            "page_order",
            "validation",
            "proof_pack",
            "build_package",
            "zip",
            "submit_check",
            "archive",
        )
        for sid in b4_stages:
            fn = V2_STAGE_IMPL[sid]["cpu"]
            # A placeholder raises StageNotImplemented when called with no args.
            # A real impl will raise TypeError (missing args) — both are fine,
            # but StageNotImplemented means B4 wasn't wired.
            try:
                fn()
            except StageNotImplemented:
                pytest.fail(f"Stage {sid!r} is still a placeholder — B4 must wire a real impl")
            except Exception:  # noqa: S110
                pass  # TypeError, etc. = real function exists
