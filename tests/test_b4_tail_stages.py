"""B4: Project-scoped tail stages — TDD tests.

Covers:
  1. page_order stage (PageReorder events, ordered page-id manifest)
  2. validation stage (ValidationReport, blockers/warnings, data-driven rules)
  3. proof_pack stage (bundles proofing images + text per ordered pages)
  4. build_package stage re-keyed onto project_stages
  5. zip stage (deterministic archive + sha256, identical across two runs)
  6. submit_check stage (SubmitCheckReport, GateConfirmation event)
  7. archive stage (cold-storage manifest, terminal)
  8. Gate chain: validation→build→zip→submit_check→archive ordering

Specs:
  docs/specs/stage-registry-v2.md §2, §5
  docs/specs/api-v2-deltas.md §3 (ValidationReport, SubmitCheckReport)
  docs/specs/library-placement.md §4.2 (LongJobRunner seam)

All stages are project-scoped (V2_PROJECT_STAGE_IDS).
"""

from __future__ import annotations

import hashlib
import json
import uuid
import zipfile
from pathlib import Path
from typing import Any

import pytest

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _make_pages_data(
    tmp_path: Path,
    project_id: str,
    page_ids: list[str],
    *,
    with_text: bool = True,
    text_review_clean: bool = True,
    with_illustrations: bool = False,
) -> Path:
    """Create minimal page artifacts under tmp_path/projects/<project_id>/."""
    proj_dir = tmp_path / "projects" / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)

    for page_id in page_ids:
        # proofing image (canvas_map output) — minimal PNG (1x1 white)
        img_dir = proj_dir / "pages" / page_id / "stages" / "canvas_map"
        img_dir.mkdir(parents=True, exist_ok=True)
        # 1x1 white PNG bytes
        png_bytes = (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
            b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
            b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        (img_dir / "output.png").write_bytes(png_bytes)

        if with_text:
            text_dir = proj_dir / "pages" / page_id / "stages" / "text_review"
            text_dir.mkdir(parents=True, exist_ok=True)
            (text_dir / "output.txt").write_text(f"Page {page_id} text.\n", encoding="utf-8")
            attestation: dict[str, Any] = {}
            if text_review_clean:
                attestation = {"status": "clean", "reviewed_at": "2026-06-10T00:00:00Z"}
            (text_dir / "attestation.json").write_bytes(json.dumps(attestation).encode())

        if with_illustrations:
            ill_dir = proj_dir / "pages" / page_id / "stages" / "illustrations"
            ill_dir.mkdir(parents=True, exist_ok=True)
            (ill_dir / "regions.json").write_bytes(b"[]")

    return proj_dir


# ────────────────────────────────────────────────────────────────────────────
# 1. page_order — PageReorder events + ordered page-id manifest
# ────────────────────────────────────────────────────────────────────────────


class TestPageOrderStep:
    def test_page_order_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "page_order" in V2_STAGE_IMPL

    def test_page_order_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("page_order", "cpu")
        try:
            fn(page_ids=["0001", "0002"], project_id="test-proj", data_root=Path("/tmp"))
        except StageNotImplemented:
            pytest.fail("page_order raised StageNotImplemented — B4 should wire a real impl")
        except Exception:  # noqa: S110
            pass  # Other errors are expected without real data

    def test_page_order_materializes_manifest(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_page_order

        project_id = str(uuid.uuid4())
        page_ids = ["0003", "0001", "0002"]

        result = materialize_page_order(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
        )

        assert isinstance(result, bytes)
        decoded = result.decode("utf-8")
        lines = [l.strip() for l in decoded.splitlines() if l.strip()]
        assert lines == page_ids

    def test_page_order_reorder_produces_event(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import make_page_reorder_event

        new_order = ["0002", "0001", "0003"]
        previous_order = ["0001", "0002", "0003"]

        event = make_page_reorder_event(
            new_order=new_order,
            previous_order=previous_order,
            actor_id="user-1",
        )

        assert event["event_type"] == "PageReorder"
        assert event["new_order"] == new_order
        assert event["previous_order"] == previous_order
        assert event["actor_id"] == "user-1"

    def test_page_order_rerun_recomputes_from_current_page_set(self, tmp_path: Path) -> None:
        """Re-running page_order after adding a page picks up the new page."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import materialize_page_order

        project_id = str(uuid.uuid4())
        # First run: 2 pages
        r1 = materialize_page_order(project_id=project_id, page_ids=["0001", "0002"], data_root=tmp_path)
        assert r1.decode().strip().splitlines() == ["0001", "0002"]

        # Second run: 3 pages (page 0003 added)
        r2 = materialize_page_order(
            project_id=project_id, page_ids=["0001", "0002", "0003"], data_root=tmp_path
        )
        assert r2.decode().strip().splitlines() == ["0001", "0002", "0003"]


# ────────────────────────────────────────────────────────────────────────────
# 2. validation — aggregates page facts → ValidationReport
# ────────────────────────────────────────────────────────────────────────────


class TestValidationStep:
    def test_validation_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "validation" in V2_STAGE_IMPL

    def test_validation_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("validation", "cpu")
        try:
            fn(project_id="test", page_ids=[], data_root=Path("/tmp"))
        except StageNotImplemented:
            pytest.fail("validation raised StageNotImplemented")
        except Exception:  # noqa: S110
            pass

    def test_validation_no_pages_passes(self, tmp_path: Path) -> None:
        """Empty project (no pages) → no blockers, passed=True."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = str(uuid.uuid4())
        result = validate_project(project_id=project_id, page_ids=[], data_root=tmp_path)

        assert result["passed"] is True
        assert result["blocker_count"] == 0

    def test_validation_missing_text_review_is_blocker(self, tmp_path: Path) -> None:
        """Page without text_review artifact → blocker 'missing_text_review'."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        # Create page dir without text_review artifact
        (tmp_path / "projects" / project_id / "pages" / "0001").mkdir(parents=True, exist_ok=True)

        result = validate_project(project_id=project_id, page_ids=page_ids, data_root=tmp_path)

        assert result["passed"] is False
        assert result["blocker_count"] > 0
        blockers = result["blockers"]
        assert any(b["code"] == "missing_text_review" for b in blockers)

    def test_validation_unattested_text_review_is_blocker(self, tmp_path: Path) -> None:
        """text_review present but no attestation → blocker 'unattested_text_review'."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=False)

        result = validate_project(project_id=project_id, page_ids=page_ids, data_root=tmp_path)

        assert result["passed"] is False
        assert any(b["code"] == "unattested_text_review" for b in result["blockers"])

    def test_validation_all_clean_pages_passes(self, tmp_path: Path) -> None:
        """All pages with clean text_review attestation → passed=True."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = str(uuid.uuid4())
        page_ids = ["0001", "0002"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = validate_project(project_id=project_id, page_ids=page_ids, data_root=tmp_path)

        assert result["passed"] is True
        assert result["blocker_count"] == 0

    def test_validation_report_schema(self, tmp_path: Path) -> None:
        """validate_project result matches ValidationReport shape."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = str(uuid.uuid4())
        result = validate_project(project_id=project_id, page_ids=[], data_root=tmp_path)

        required_keys = {
            "project_id",
            "run_at",
            "blockers",
            "warnings",
            "blocker_count",
            "warning_count",
            "passed",
        }
        assert required_keys.issubset(result.keys())

    def test_validation_stage_callable_returns_json_bytes(self, tmp_path: Path) -> None:
        """validation stage callable returns JSON bytes of ValidationReport."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

        project_id = str(uuid.uuid4())
        fn = get_v2_stage_impl("validation", "cpu")
        result = fn(project_id=project_id, page_ids=[], data_root=tmp_path)

        assert isinstance(result, bytes)
        parsed = json.loads(result.decode())
        assert "passed" in parsed


# ────────────────────────────────────────────────────────────────────────────
# 3. proof_pack — bundles proofing images + reviewed text per ordered pages
# ────────────────────────────────────────────────────────────────────────────


class TestProofPackStep:
    def test_proof_pack_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "proof_pack" in V2_STAGE_IMPL

    def test_proof_pack_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("proof_pack", "cpu")
        try:
            fn(project_id="test", page_ids=[], data_root=Path("/tmp"))
        except StageNotImplemented:
            pytest.fail("proof_pack raised StageNotImplemented")
        except Exception:  # noqa: S110
            pass

    def test_proof_pack_creates_bundle_dir(self, tmp_path: Path) -> None:
        """proof_pack writes a bundle directory with page images + texts."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.proof_pack import build_proof_pack

        project_id = str(uuid.uuid4())
        page_ids = ["0001", "0002"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = build_proof_pack(project_id=project_id, page_ids=page_ids, data_root=tmp_path)

        assert isinstance(result, bytes)
        manifest = json.loads(result.decode())
        assert manifest["project_id"] == project_id
        assert len(manifest["pages"]) == 2

    def test_proof_pack_deterministic(self, tmp_path: Path) -> None:
        """Two runs with same input produce identical page inventory (timestamps may differ)."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.proof_pack import build_proof_pack

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        r1 = json.loads(build_proof_pack(project_id=project_id, page_ids=page_ids, data_root=tmp_path))
        r2 = json.loads(build_proof_pack(project_id=project_id, page_ids=page_ids, data_root=tmp_path))

        # Pages content must be identical (excluding the built_at timestamp)
        assert r1["pages"] == r2["pages"]
        assert r1["project_id"] == r2["project_id"]


# ────────────────────────────────────────────────────────────────────────────
# 4. build_package — PGDP submission zip (re-keyed onto project_stages)
# ────────────────────────────────────────────────────────────────────────────


class TestBuildPackageStep:
    def test_build_package_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "build_package" in V2_STAGE_IMPL

    def test_build_package_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("build_package", "cpu")
        try:
            fn(project_id="test", page_ids=[], data_root=Path("/tmp"), book_name="test")
        except StageNotImplemented:
            pytest.fail("build_package raised StageNotImplemented")
        except Exception:  # noqa: S110
            pass

    def test_build_package_produces_valid_zip(self, tmp_path: Path) -> None:
        """build_package callable produces valid ZIP bytes."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            book_name="Test Book",
        )

        assert isinstance(result, bytes)
        assert zipfile.is_zipfile(
            Path(result) if isinstance(result, (str, Path)) else __import__("io").BytesIO(result)
        )

    def test_build_package_contains_pgdp_json(self, tmp_path: Path) -> None:
        """build_package zip contains pgdp.json manifest."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = build_submission_zip(
            project_id=project_id, page_ids=page_ids, data_root=tmp_path, book_name="Test Book"
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            assert "pgdp.json" in zf.namelist()
            manifest = json.loads(zf.read("pgdp.json").decode())
            assert manifest["book_name"] == "Test Book"


# ────────────────────────────────────────────────────────────────────────────
# 5. zip — deterministic archive + sha256
# ────────────────────────────────────────────────────────────────────────────


class TestZipStep:
    def test_zip_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "zip" in V2_STAGE_IMPL

    def test_zip_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("zip", "cpu")
        try:
            fn(zip_bytes=b"PK\x05\x06" + b"\x00" * 18, project_id="test", data_root=Path("/tmp"))
        except StageNotImplemented:
            pytest.fail("zip raised StageNotImplemented")
        except Exception:  # noqa: S110
            pass

    def test_zip_produces_deterministic_output(self, tmp_path: Path) -> None:
        """Same zip bytes → same sha256 across two calls."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import make_deterministic_zip

        project_id = str(uuid.uuid4())
        zip_bytes = b"some fake zip content"

        r1 = make_deterministic_zip(zip_bytes=zip_bytes, project_id=project_id, data_root=tmp_path)
        r2 = make_deterministic_zip(zip_bytes=zip_bytes, project_id=project_id, data_root=tmp_path)

        assert r1["sha256"] == r2["sha256"]
        assert r1["sha256"] == hashlib.sha256(zip_bytes).hexdigest()

    def test_zip_manifest_structure(self, tmp_path: Path) -> None:
        """zip stage returns a manifest with sha256, size_bytes, file_count."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import make_deterministic_zip

        project_id = str(uuid.uuid4())
        zip_bytes = b"test zip content"

        result = make_deterministic_zip(zip_bytes=zip_bytes, project_id=project_id, data_root=tmp_path)

        assert "sha256" in result
        assert "size_bytes" in result
        assert result["size_bytes"] == len(zip_bytes)

    def test_zip_different_content_different_sha256(self, tmp_path: Path) -> None:
        """Different content → different sha256."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import make_deterministic_zip

        project_id = str(uuid.uuid4())

        r1 = make_deterministic_zip(zip_bytes=b"content A", project_id=project_id, data_root=tmp_path)
        r2 = make_deterministic_zip(zip_bytes=b"content B", project_id=project_id, data_root=tmp_path)

        assert r1["sha256"] != r2["sha256"]


# ────────────────────────────────────────────────────────────────────────────
# 6. submit_check — dry-run SubmitCheckReport + GateConfirmation
# ────────────────────────────────────────────────────────────────────────────


class TestSubmitCheckStep:
    def test_submit_check_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "submit_check" in V2_STAGE_IMPL

    def test_submit_check_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("submit_check", "cpu")
        try:
            fn(
                project_id="test",
                zip_sha256="abc",
                zip_size_bytes=100,
                page_count=1,
                data_root=Path("/tmp"),
            )
        except StageNotImplemented:
            pytest.fail("submit_check raised StageNotImplemented")
        except Exception:  # noqa: S110
            pass

    def test_submit_check_report_schema(self, tmp_path: Path) -> None:
        """submit_check produces SubmitCheckReport with required fields."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.submit_check import run_submit_check

        project_id = str(uuid.uuid4())
        result = run_submit_check(
            project_id=project_id,
            zip_sha256=hashlib.sha256(b"content").hexdigest(),
            zip_size_bytes=1024,
            page_count=5,
            data_root=tmp_path,
        )

        required_keys = {
            "project_id",
            "run_at",
            "zip_sha256",
            "zip_size_bytes",
            "file_count",
            "issues",
            "passed",
        }
        assert required_keys.issubset(result.keys())

    def test_submit_check_passes_valid_submission(self, tmp_path: Path) -> None:
        """Valid submission (non-empty, positive page_count) → passed=True."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.submit_check import run_submit_check

        project_id = str(uuid.uuid4())
        result = run_submit_check(
            project_id=project_id,
            zip_sha256=hashlib.sha256(b"content").hexdigest(),
            zip_size_bytes=1024,
            page_count=5,
            data_root=tmp_path,
        )

        assert result["passed"] is True

    def test_submit_check_fails_zero_pages(self, tmp_path: Path) -> None:
        """Zero pages → not passed (blocker: zero_page_count)."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.submit_check import run_submit_check

        project_id = str(uuid.uuid4())
        result = run_submit_check(
            project_id=project_id,
            zip_sha256=hashlib.sha256(b"").hexdigest(),
            zip_size_bytes=0,
            page_count=0,
            data_root=tmp_path,
        )

        assert result["passed"] is False
        assert len(result["issues"]) > 0

    def test_gate_confirmation_event(self) -> None:
        """GateConfirmation event has correct shape."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.submit_check import make_gate_confirmation_event

        event = make_gate_confirmation_event(
            gate="submit_confirm",
            target_id="proj-123",
            actor_id="user-1",
        )

        assert event["event_type"] == "GateConfirmation"
        assert event["gate"] == "submit_confirm"
        assert event["target_id"] == "proj-123"
        assert event["actor_id"] == "user-1"

    def test_submit_check_callable_returns_json_bytes(self, tmp_path: Path) -> None:
        """submit_check callable returns JSON bytes."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

        project_id = str(uuid.uuid4())
        fn = get_v2_stage_impl("submit_check", "cpu")

        result = fn(
            project_id=project_id,
            zip_sha256=hashlib.sha256(b"x").hexdigest(),
            zip_size_bytes=1,
            page_count=1,
            data_root=tmp_path,
        )

        assert isinstance(result, bytes)
        parsed = json.loads(result.decode())
        assert "passed" in parsed


# ────────────────────────────────────────────────────────────────────────────
# 7. archive — terminal cold-storage manifest
# ────────────────────────────────────────────────────────────────────────────


class TestArchiveStep:
    def test_archive_in_v2_registry(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "archive" in V2_STAGE_IMPL

    def test_archive_wired_not_placeholder(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
            StageNotImplemented,
            get_v2_stage_impl,
        )

        fn = get_v2_stage_impl("archive", "cpu")
        try:
            fn(project_id="test", data_root=Path("/tmp"))
        except StageNotImplemented:
            pytest.fail("archive raised StageNotImplemented")
        except Exception:  # noqa: S110
            pass

    def test_archive_produces_manifest(self, tmp_path: Path) -> None:
        """archive stage produces an artifact inventory manifest."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.archive_stage import build_archive_manifest

        project_id = str(uuid.uuid4())
        _make_pages_data(tmp_path, project_id, ["0001"], text_review_clean=True)

        result = build_archive_manifest(project_id=project_id, data_root=tmp_path)

        assert isinstance(result, bytes)
        manifest = json.loads(result.decode())
        assert "project_id" in manifest
        assert "archived_at" in manifest
        assert "artifacts" in manifest
        assert isinstance(manifest["artifacts"], list)

    def test_archive_manifest_marks_pipeline_complete(self, tmp_path: Path) -> None:
        """archive manifest has pipeline_complete=True (terminal stage)."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.archive_stage import build_archive_manifest

        project_id = str(uuid.uuid4())
        result = build_archive_manifest(project_id=project_id, data_root=tmp_path)

        manifest = json.loads(result.decode())
        assert manifest.get("pipeline_complete") is True

    def test_archive_stage_is_terminal(self) -> None:
        """archive is the only terminal stage in V2_STAGE_DAG."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

        terminals = [s for s in V2_STAGE_DAG if s.is_terminal]
        assert len(terminals) == 1
        assert terminals[0].id == "archive"

    def test_archive_callable_returns_json_bytes(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

        project_id = str(uuid.uuid4())
        fn = get_v2_stage_impl("archive", "cpu")

        result = fn(project_id=project_id, data_root=tmp_path)

        assert isinstance(result, bytes)
        parsed = json.loads(result.decode())
        assert "pipeline_complete" in parsed


# ────────────────────────────────────────────────────────────────────────────
# 8a. build_package — deterministic timestamp (review finding #1)
# ────────────────────────────────────────────────────────────────────────────


class TestBuildPackageDeterminism:
    """build_submission_zip must be byte-deterministic when given a fixed built_at."""

    def test_same_built_at_produces_identical_archive(self, tmp_path: Path) -> None:
        """Two runs with same input + same built_at → identical bytes + sha256."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001", "0002"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        fixed_ts = "2026-06-10T00:00:00+00:00"
        zip1 = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            book_name="Test Book",
            built_at=fixed_ts,
        )
        zip2 = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            book_name="Test Book",
            built_at=fixed_ts,
        )

        assert zip1 == zip2, "Archives must be byte-identical for same input + built_at"
        assert hashlib.sha256(zip1).hexdigest() == hashlib.sha256(zip2).hexdigest()

    def test_different_built_at_produces_different_archive(self, tmp_path: Path) -> None:
        """Different built_at → different archive bytes."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        zip1 = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            built_at="2026-06-10T00:00:00+00:00",
        )
        zip2 = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            built_at="2026-06-11T00:00:00+00:00",
        )

        assert zip1 != zip2, "Different built_at must produce different archive"

    def test_built_at_stored_in_manifest(self, tmp_path: Path) -> None:
        """built_at in pgdp.json matches the supplied timestamp."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        fixed_ts = "2026-06-10T12:34:56+00:00"
        result = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            built_at=fixed_ts,
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            manifest = json.loads(zf.read("pgdp.json").decode())
        assert manifest["built_at"] == fixed_ts

    def test_build_zip_chain_determinism(self, tmp_path: Path) -> None:
        """End-to-end: build→zip twice with same timestamp → same sha256."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip
        from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import make_deterministic_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001", "0002"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        fixed_ts = "2026-06-10T00:00:00+00:00"

        # Run 1
        zip1 = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            book_name="Determinism Test",
            built_at=fixed_ts,
        )
        manifest1 = make_deterministic_zip(
            zip_bytes=zip1,
            project_id=project_id,
            data_root=tmp_path,
            recorded_at=fixed_ts,
        )

        # Run 2 — identical inputs + same timestamp
        zip2 = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            book_name="Determinism Test",
            built_at=fixed_ts,
        )
        manifest2 = make_deterministic_zip(
            zip_bytes=zip2,
            project_id=project_id,
            data_root=tmp_path,
            recorded_at=fixed_ts,
        )

        assert zip1 == zip2, "ZIP archive must be byte-identical"
        assert manifest1["sha256"] == manifest2["sha256"], "sha256 must be identical"
        assert manifest1 == manifest2, "Full manifest must be identical"


# ────────────────────────────────────────────────────────────────────────────
# 8b. build_package — PGDP prefix layout (review finding #2)
# ────────────────────────────────────────────────────────────────────────────


def _make_illustration_crops(
    tmp_path: Path,
    project_id: str,
    page_id: str,
    crops: list[tuple[str, bytes]],
) -> None:
    """Write synthetic illustration crop files under stages/extract_illustrations/."""
    ill_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "extract_illustrations"
    ill_dir.mkdir(parents=True, exist_ok=True)
    for filename, data in crops:
        (ill_dir / filename).write_bytes(data)


# Minimal 1x1 JPEG bytes (smallest valid JPEG: SOI + APP0 + EOI).
_MINIMAL_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"

# Minimal 1x1 PNG bytes (reused from _make_pages_data).
_MINIMAL_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
    b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestBuildPackagePrefixLayout:
    """build_submission_zip must use prefix-based filenames (PGDP requirement)."""

    def test_prefix_names_used_for_images_and_text(self, tmp_path: Path) -> None:
        """Files named <prefix>.png / <prefix>.txt, not <page_id>.*."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001", "0002"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        prefixes = {"0001": "f001", "0002": "p001"}

        result = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            book_name="Prefix Test",
            page_prefixes=prefixes,
            built_at="2026-06-10T00:00:00+00:00",
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()

        assert "f001.png" in names, "Expected f001.png in zip"
        assert "p001.png" in names, "Expected p001.png in zip"
        assert "f001.txt" in names, "Expected f001.txt in zip"
        assert "p001.txt" in names, "Expected p001.txt in zip"
        # Must NOT use bare page_id when prefixes are supplied
        assert "0001.png" not in names, "Bare page_id should not appear when prefixes supplied"
        assert "0002.png" not in names

    def test_page_id_fallback_when_no_prefixes(self, tmp_path: Path) -> None:
        """Without page_prefixes, files are named by page_id (legacy/test path)."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            built_at="2026-06-10T00:00:00+00:00",
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()

        assert "0001.png" in names
        assert "0001.txt" in names

    def test_prefix_recorded_in_pgdp_json(self, tmp_path: Path) -> None:
        """pgdp.json manifest records the prefix for each page."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            page_prefixes={"0001": "p045"},
            built_at="2026-06-10T00:00:00+00:00",
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            manifest = json.loads(zf.read("pgdp.json").decode())

        assert manifest["pages"][0]["prefix"] == "p045"

    def test_illustration_crops_land_in_images_dir(self, tmp_path: Path) -> None:
        """Illustration crops appear under images/<prefix>_NN.ext in the zip."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_id = "0001"
        _make_pages_data(tmp_path, project_id, [page_id], text_review_clean=True)
        # Create synthetic crop files in extract_illustrations stage dir
        _make_illustration_crops(
            tmp_path,
            project_id,
            page_id,
            [("crop_01.jpg", _MINIMAL_JPEG), ("crop_02.jpg", _MINIMAL_JPEG)],
        )

        result = build_submission_zip(
            project_id=project_id,
            page_ids=[page_id],
            data_root=tmp_path,
            page_prefixes={page_id: "p001"},
            built_at="2026-06-10T00:00:00+00:00",
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()

        # Two crops → images/p001_01.jpg + images/p001_02.jpg
        assert "images/p001_01.jpg" in names, f"Expected images/p001_01.jpg; got {names}"
        assert "images/p001_02.jpg" in names

    def test_no_images_dir_when_no_crops(self, tmp_path: Path) -> None:
        """When no illustration crops exist, images/ directory is absent."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_ids = ["0001"]
        _make_pages_data(tmp_path, project_id, page_ids, text_review_clean=True)

        result = build_submission_zip(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            page_prefixes={"0001": "p001"},
            built_at="2026-06-10T00:00:00+00:00",
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()

        image_entries = [n for n in names if n.startswith("images/")]
        assert image_entries == [], f"Expected no images/ entries; got {image_entries}"

    def test_illustration_count_in_manifest(self, tmp_path: Path) -> None:
        """illustration_count in pgdp.json reflects actual crops included."""
        import io

        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_id = "0001"
        _make_pages_data(tmp_path, project_id, [page_id], text_review_clean=True)
        _make_illustration_crops(
            tmp_path,
            project_id,
            page_id,
            [("crop_01.png", _MINIMAL_PNG)],
        )

        result = build_submission_zip(
            project_id=project_id,
            page_ids=[page_id],
            data_root=tmp_path,
            page_prefixes={page_id: "p001"},
            built_at="2026-06-10T00:00:00+00:00",
        )

        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            manifest = json.loads(zf.read("pgdp.json").decode())

        assert manifest["illustration_count"] == 1
        assert manifest["pages"][0]["illustration_count"] == 1

    def test_prefix_layout_determinism_with_illustrations(self, tmp_path: Path) -> None:
        """Prefix layout + illustrations: two runs → byte-identical archive."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = str(uuid.uuid4())
        page_id = "0001"
        _make_pages_data(tmp_path, project_id, [page_id], text_review_clean=True)
        _make_illustration_crops(
            tmp_path,
            project_id,
            page_id,
            [("crop_01.jpg", _MINIMAL_JPEG)],
        )

        fixed_ts = "2026-06-10T00:00:00+00:00"
        prefixes = {page_id: "p001"}

        zip1 = build_submission_zip(
            project_id=project_id,
            page_ids=[page_id],
            data_root=tmp_path,
            page_prefixes=prefixes,
            built_at=fixed_ts,
        )
        zip2 = build_submission_zip(
            project_id=project_id,
            page_ids=[page_id],
            data_root=tmp_path,
            page_prefixes=prefixes,
            built_at=fixed_ts,
        )

        assert zip1 == zip2
        assert hashlib.sha256(zip1).hexdigest() == hashlib.sha256(zip2).hexdigest()
